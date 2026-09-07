// Comprovantes de pagamento do modo Pix MANUAL (Fase 3).
//
// Por que R2 e não Firebase Storage: o Storage exige o plano Blaze (cartão de crédito) no
// projeto Firebase, e o piloto roda no plano gratuito. O bucket R2 da Cloudflare já vem
// junto do Worker que o módulo financeiro usa, então o arquivo vai pra lá.
//
// Consequência importante: R2 NÃO tem "Security Rules". Toda a autorização é o código
// deste arquivo. O navegador nunca fala com o R2 direto — só com estes dois endpoints:
//
//   POST /comprovante            → o ALUNO envia o comprovante da PRÓPRIA cobrança
//                                  manual pendente (multipart/form-data).
//   GET  /comprovante/{id}       → o PROFESSOR (admin) baixa/visualiza o arquivo.
//
// A escrita no Firestore que marca a cobrança como 'aguardando_confirmacao' é feita aqui,
// pelo Worker (service account), e não pelo cliente — por isso não existe (nem deve
// existir) regra de update de aluno em `cobrancas` no firestore.rules.

import { getDocument, patchDocument, tenantPath } from "./firestore.js";
import { verificarIdToken } from "./auth.js";
import { cobrancaIdValido, tenantIdValido } from "./validacao.js";
import { json, corsHeaders, campoString, origensPermitidas } from "./http.js";

// Tipos aceitos → extensão do objeto no bucket. A extensão vem SEMPRE daqui, nunca do
// nome do arquivo enviado pelo navegador (que é texto livre e controlado pelo cliente).
const TIPOS_ACEITOS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf"
};

const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024; // 5 MB

function caminhoTenant(tenantId, path) {
  return tenantPath(tenantId, path);
}

async function resolverTenantAtivo(env, tenantId) {
  if (!tenantIdValido(tenantId)) throw new Error("tenantId inválido.");
  const tenant = await getDocument(env, "tenants/" + tenantId);
  if (!tenant || campoString(tenant, "status") !== "ativo") {
    throw new Error("Tenant inativo ou inexistente.");
  }
  return tenantId;
}

async function usuarioEhAdminTenant(env, uid, tenantId) {
  const membership = await getDocument(env, caminhoTenant(tenantId, "memberships/" + uid));
  const role = campoString(membership, "role");
  const status = campoString(membership, "status");
  if ((role === "admin" || role === "owner") && status === "ativo") return true;
  return false;
}

async function usuarioEhAlunoTenant(env, uid, tenantId) {
  const membership = await getDocument(env, caminhoTenant(tenantId, "memberships/" + uid));
  const role = campoString(membership, "role");
  const status = campoString(membership, "status");
  return status === "ativo" && (role === "aluno" || role === "admin" || role === "owner");
}

function origemHost(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return { origin, host: url.hostname.toLowerCase() };
  } catch (err) {
    return null;
  }
}

async function origemAutorizaTenant(request, env, tenantId) {
  const info = origemHost(request);
  if (!info) return true;

  const permitidoExato = origensPermitidas(env).includes(info.origin);
  if (permitidoExato && (info.host === "localhost" || info.host === "127.0.0.1")) {
    fixarCorsOrigin(request, info.origin);
    return true;
  }
  if (permitidoExato && tenantId === env.DEFAULT_TENANT_ID) {
    fixarCorsOrigin(request, info.origin);
    return true;
  }

  const domainDoc = await getDocument(env, "tenantDomains/" + info.host);
  if (domainDoc && campoString(domainDoc, "status") === "ativo" && campoString(domainDoc, "tenantId") === tenantId) {
    fixarCorsOrigin(request, info.origin);
    return true;
  }

  const sufixo = ".dojopass.com.br";
  if (info.host.endsWith(sufixo) && info.host !== "www.dojopass.com.br") {
    const slug = info.host.slice(0, -sufixo.length);
    const slugDoc = await getDocument(env, "tenantSlugs/" + slug);
    const permitido = !!(slugDoc && campoString(slugDoc, "status") === "ativo" && campoString(slugDoc, "tenantId") === tenantId);
    if (permitido) fixarCorsOrigin(request, info.origin);
    return permitido;
  }

  return false;
}

async function exigirOrigemTenant(request, env, tenantId) {
  if (await origemAutorizaTenant(request, env, tenantId)) return null;
  return json({ erro: "Origem não autorizada para esta academia." }, 403, request, env);
}

async function tenantIdDaUrl(request, env) {
  const valor = new URL(request.url).searchParams.get("tenantId");
  return resolverTenantAtivo(env, valor);
}

function extensaoDoTipo(contentType) {
  return Object.prototype.hasOwnProperty.call(TIPOS_ACEITOS, contentType)
    ? TIPOS_ACEITOS[contentType]
    : null;
}

// "image/jpeg; charset=..." → "image/jpeg". O navegador normalmente manda só o tipo,
// mas normalizar aqui evita que um parâmetro extra fure a lista branca.
function normalizarContentType(valor) {
  if (typeof valor !== "string") return "";
  return valor.split(";")[0].trim().toLowerCase();
}

// Extrai o ID token de um Authorization: Bearer, OU (só no GET) da query string ?token=.
//
// DECISÃO PRAGMÁTICA: o painel do professor abre o comprovante numa aba nova
// (window.open), e uma navegação de aba não permite mandar header Authorization. Em vez de
// inventar um esquema de URL assinada, o GET aceita o mesmo ID token do Firebase na query
// string. Risco conhecido: query strings aparecem em logs de acesso/proxy. Mitigações:
// (1) o ID token do Firebase vale ~1h e não é um segredo de longo prazo; (2) vale só pra
// LEITURA de comprovante e ainda exige que o uid seja admin; (3) o POST de upload NÃO
// aceita token por query string — lá é header e ponto.
function tokenDaRequisicao(request, aceitarQueryString) {
  const header = request.headers.get("Authorization");
  if (header) return header;
  if (!aceitarQueryString) return null;
  const token = new URL(request.url).searchParams.get("token");
  return token ? "Bearer " + token : null;
}

// -----------------------------------------------------------------------------
// POST /comprovante  (aluno envia o comprovante da própria cobrança manual)
// -----------------------------------------------------------------------------
async function handleUploadComprovante(request, env) {
  if (!env.COMPROVANTES_BUCKET) {
    return json({ erro: "Armazenamento de comprovantes não configurado." }, 501, request, env);
  }

  let uid;
  try {
    ({ uid } = await verificarIdToken(env, tokenDaRequisicao(request, false)));
  } catch (err) {
    console.error("Comprovante: falha na verificação do ID token:", err);
    return json({ erro: "Não autenticado." }, 401, request, env);
  }

  let formulario;
  try {
    formulario = await request.formData();
  } catch (err) {
    return json({ erro: "Envio inválido (esperado multipart/form-data)." }, 400, request, env);
  }

  const tenantIdBruto = formulario.get("tenantId");
  let tenantId;
  try {
    tenantId = await resolverTenantAtivo(env, tenantIdBruto);
  } catch (err) {
    return json({ erro: "Academia inválida." }, 400, request, env);
  }
  const origemNegada = await exigirOrigemTenant(request, env, tenantId);
  if (origemNegada) return origemNegada;

  if (!(await usuarioEhAlunoTenant(env, uid, tenantId))) {
    return json({ erro: "Seu vínculo com esta academia não está ativo." }, 403, request, env);
  }

  const cobrancaId = formulario.get("cobrancaId");
  if (!cobrancaIdValido(cobrancaId)) {
    return json({ erro: "Cobrança inválida." }, 400, request, env);
  }

  const arquivo = formulario.get("arquivo");
  if (!arquivo || typeof arquivo !== "object" || typeof arquivo.arrayBuffer !== "function") {
    return json({ erro: "Nenhum arquivo enviado." }, 400, request, env);
  }

  const contentType = normalizarContentType(arquivo.type);
  const extensao = extensaoDoTipo(contentType);
  if (!extensao) {
    return json(
      { erro: "Formato não aceito. Envie uma imagem (JPG, PNG ou WebP) ou um PDF." },
      400,
      request,
      env
    );
  }

  // Tamanho conferido ANTES de ler o corpo pra memória.
  const tamanho = Number(arquivo.size);
  if (!Number.isFinite(tamanho) || tamanho <= 0) {
    return json({ erro: "Arquivo vazio." }, 400, request, env);
  }
  if (tamanho > TAMANHO_MAXIMO_BYTES) {
    return json({ erro: "Arquivo muito grande. O limite é 5 MB." }, 400, request, env);
  }

  // Autorização de verdade: a cobrança tem que existir, ser manual, ser DESTE aluno e
  // ainda estar pendente. Um aluno nunca envia comprovante na cobrança de outro.
  const cobranca = await getDocument(env, caminhoTenant(tenantId, "cobrancas/" + cobrancaId));
  if (!cobranca) return json({ erro: "Cobrança não encontrada." }, 404, request, env);

  // Documento antigo sem 'origem' conta como 'asaas' — mesmo default do firestore.rules.
  const origem = campoString(cobranca, "origem") || "asaas";
  if (origem !== "manual") {
    return json(
      { erro: "Esta cobrança é confirmada automaticamente pelo provedor de pagamento." },
      403,
      request,
      env
    );
  }

  if (campoString(cobranca, "alunoId") !== uid) {
    return json({ erro: "Esta cobrança não é sua." }, 403, request, env);
  }

  const status = campoString(cobranca, "status");
  if (status !== "pendente") {
    return json(
      {
        erro:
          status === "aguardando_confirmacao"
            ? "Já existe um comprovante enviado para esta cobrança."
            : "Esta cobrança não está aberta para envio de comprovante."
      },
      409,
      request,
      env
    );
  }

  // Key derivada de uid + cobrancaId (ambos já validados): um aluno só escreve dentro do
  // próprio prefixo, e um reenvio sobrescreve o próprio arquivo em vez de acumular lixo.
  const key = "tenants/" + tenantId + "/comprovantes/" + uid + "/" + cobrancaId + "." + extensao;

  const conteudo = await arquivo.arrayBuffer();
  if (conteudo.byteLength > TAMANHO_MAXIMO_BYTES) {
    // Segunda checagem: `size` vem do multipart, `byteLength` é o que realmente chegou.
    return json({ erro: "Arquivo muito grande. O limite é 5 MB." }, 400, request, env);
  }

  await env.COMPROVANTES_BUCKET.put(key, conteudo, {
    httpMetadata: { contentType }
  });

  await patchDocument(
    env,
    caminhoTenant(tenantId, "cobrancas/" + cobrancaId),
    {
      status: "aguardando_confirmacao",
      comprovantePath: key,
      comprovanteContentType: contentType,
      comprovanteEnviadoEm: new Date(),
      atualizadoEm: new Date()
    },
    { exigirExistente: true }
  );

  return json({ ok: true }, 200, request, env);
}

// -----------------------------------------------------------------------------
// GET /comprovante/{cobrancaId}  (professor visualiza o arquivo)
// -----------------------------------------------------------------------------
async function handleBaixarComprovante(request, env, cobrancaId) {
  if (!env.COMPROVANTES_BUCKET) {
    return json({ erro: "Armazenamento de comprovantes não configurado." }, 501, request, env);
  }

  if (!cobrancaIdValido(cobrancaId)) {
    return json({ erro: "Cobrança inválida." }, 400, request, env);
  }

  let tenantId;
  try {
    tenantId = await tenantIdDaUrl(request, env);
  } catch (err) {
    return json({ erro: "Academia inválida." }, 400, request, env);
  }
  const origemNegada = await exigirOrigemTenant(request, env, tenantId);
  if (origemNegada) return origemNegada;

  let uid;
  try {
    ({ uid } = await verificarIdToken(env, tokenDaRequisicao(request, true)));
  } catch (err) {
    console.error("Comprovante: falha na verificação do ID token:", err);
    return json({ erro: "Não autenticado." }, 401, request, env);
  }

  // Só professor do tenant da cobrança.
  const adminDoc = await usuarioEhAdminTenant(env, uid, tenantId);
  if (!adminDoc) {
    return json({ erro: "Sem permissão para ver comprovantes." }, 403, request, env);
  }

  const cobranca = await getDocument(env, caminhoTenant(tenantId, "cobrancas/" + cobrancaId));
  if (!cobranca) return json({ erro: "Cobrança não encontrada." }, 404, request, env);

  const caminho = campoString(cobranca, "comprovantePath");
  if (!caminho) return json({ erro: "Esta cobrança não tem comprovante." }, 404, request, env);

  // O content-type servido sai da lista branca, nunca cru do Firestore — junto com o
  // nosniff abaixo, isso impede servir HTML/JS a partir do bucket.
  const tipoGravado = normalizarContentType(campoString(cobranca, "comprovanteContentType"));
  const contentType = extensaoDoTipo(tipoGravado) ? tipoGravado : "application/octet-stream";

  const objeto = await env.COMPROVANTES_BUCKET.get(caminho);
  if (!objeto) return json({ erro: "Comprovante não encontrado." }, 404, request, env);

  return new Response(objeto.body, {
    status: 200,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    }
  });
}

export { handleUploadComprovante, handleBaixarComprovante, TIPOS_ACEITOS, TAMANHO_MAXIMO_BYTES };
