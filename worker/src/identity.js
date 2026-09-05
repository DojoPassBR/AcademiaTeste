// Criação de usuário no Firebase Auth pela REST API do Google Identity Toolkit,
// autenticada com a MESMA service account que já assina as chamadas ao Firestore
// (ver worker/src/firestore.js) — só que com o scope cloud-platform (SCOPE_IDENTITY),
// o único aceito pelo v1 do Identity Toolkit junto com "firebase".
//
// Por que aqui e não no cliente: criar a conta pelo SDK web (createUserWithEmailAndPassword)
// TROCA a sessão do navegador pelo usuário recém-criado — o professor seria deslogado do
// próprio painel a cada aluno cadastrado. Pelo Worker, a conta nasce no servidor e a
// sessão do admin não é tocada.
//
// A senha só existe em memória durante a requisição: NUNCA vai pra console.log/error,
// nem pro Firestore, nem pra resposta HTTP.

import { getAccessToken, SCOPE_IDENTITY } from "./firestore.js";

// Rota ADMIN do Identity Toolkit v1: .../v1/projects/{projectId}/accounts...
// A rota curta (".../v1/accounts...") é a rota de CLIENTE e exige "?key=<apiKey>";
// autenticada com Bearer de service account ela responde 404/401.
function identityBase(env) {
  return `https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}`;
}

// Extrai o código curto do erro do Identity Toolkit. A API devolve
// { error: { message: "EMAIL_EXISTS" } } — às vezes com detalhe colado
// ("WEAK_PASSWORD : Password should be at least 6 characters"). Só a primeira palavra
// interessa pra quem chama decidir o status HTTP.
function extrairCodigoGoogle(payload) {
  const bruto = payload?.error?.message;
  if (typeof bruto !== "string" || !bruto) return "ERRO_DESCONHECIDO";
  return bruto.split(/[\s:]/)[0] || "ERRO_DESCONHECIDO";
}

function erroIdentity(codigo) {
  const err = new Error("Falha ao criar usuário no Firebase Auth: " + codigo);
  err.codigoGoogle = codigo;
  return err;
}

// Cria o usuário e devolve { uid }. Lança Error com .codigoGoogle em qualquer falha
// reportada pelo Google (EMAIL_EXISTS, WEAK_PASSWORD, INVALID_EMAIL, PERMISSION_DENIED...).
async function criarUsuarioAuth(env, { email, senha, nomeExibicao }) {
  const accessToken = await getAccessToken(env, SCOPE_IDENTITY);

  // Sem "?key=": a autenticação é o Bearer da service account (privilégio de admin),
  // não a apiKey pública do app.
  const resp = await fetch(identityBase(env) + "/accounts", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      password: senha,
      displayName: nomeExibicao,
      emailVerified: false
    })
  });

  const dados = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const codigo = extrairCodigoGoogle(dados);
    // Log sem a senha — só e-mail e código. O corpo cru da resposta NÃO é logado porque
    // o Identity Toolkit ecoa parte da requisição em alguns erros.
    console.error("Identity Toolkit recusou a criação de usuário:", email, codigo);
    throw erroIdentity(codigo);
  }

  if (typeof dados.localId !== "string" || !dados.localId) {
    console.error("Identity Toolkit respondeu 200 sem localId para:", email);
    throw erroIdentity("SEM_LOCAL_ID");
  }

  return { uid: dados.localId };
}

// Apaga um usuário do Firebase Auth (usado em limpeza de teste/rollback manual).
async function apagarUsuarioAuth(env, uid) {
  const accessToken = await getAccessToken(env, SCOPE_IDENTITY);
  const resp = await fetch(identityBase(env) + "/accounts:delete", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ localId: uid })
  });

  if (!resp.ok) {
    const dados = await resp.json().catch(() => ({}));
    const codigo = extrairCodigoGoogle(dados);
    console.error("Identity Toolkit recusou a exclusão do usuário:", uid, codigo);
    throw erroIdentity(codigo);
  }
  return true;
}

export { criarUsuarioAuth, apagarUsuarioAuth, extrairCodigoGoogle };
