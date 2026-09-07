#!/usr/bin/env node
// Migra dados globais legados para tenants/{tenantId}/... de forma idempotente.
// Uso:
//   node scripts/migrate-global-to-tenant.mjs --service-account ./service-account.json --tenant jairo --slug jairo --domain jairo.dojopass.com.br --admin UID_ADMIN
// Opcional:
//   --checkin-lat -23.58810289825024 --checkin-lng -48.067638301537485 --checkin-raio 150
//
// O script copia documentos; não apaga os globais. Rode primeiro em projeto de teste.

import { readFile } from "node:fs/promises";
import { createSign } from "node:crypto";

const COLECOES = ["alunos", "admins", "checkins", "cobrancas", "eventos", "turmas", "equipe", "horarios"];
const DOCS_UNICOS = [{ origem: "academia/perfil", destino: "academia/perfil" }, { origem: "config/geral", destino: "config/geral" }];

function arg(nome, fallback = null) {
  const idx = process.argv.indexOf("--" + nome);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function obrigatorio(nome) {
  const valor = arg(nome);
  if (!valor) throw new Error("Falta --" + nome);
  return valor;
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + "." + payload;
  const assinatura = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key);
  const jwt = unsigned + "." + base64url(assinatura);
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt })
  });
  if (!resp.ok) throw new Error("OAuth falhou: " + await resp.text());
  return (await resp.json()).access_token;
}

function docUrl(projectId, path) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
}

function collectionUrl(projectId, collectionPath) {
  return docUrl(projectId, collectionPath) + "?pageSize=300";
}

function fields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) out[k] = { nullValue: null };
    else if (typeof v === "string") out[k] = { stringValue: v };
    else if (typeof v === "number") out[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else if (typeof v === "boolean") out[k] = { booleanValue: v };
    else if (v instanceof Date) out[k] = { timestampValue: v.toISOString() };
    else if (Array.isArray(v)) out[k] = { arrayValue: { values: v.map((x) => fields({ x }).x) } };
    else if (typeof v === "object") out[k] = { mapValue: { fields: fields(v) } };
  }
  return out;
}

async function requestJson(token, url, init = {}) {
  const resp = await fetch(url, { ...init, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`${init.method || "GET"} ${url} falhou: ${await resp.text()}`);
  return resp.json();
}

function idDoDoc(doc) {
  return doc.name.split("/").pop();
}

async function listarColecao(token, projectId, collectionPath) {
  const docs = [];
  let url = collectionUrl(projectId, collectionPath);
  while (url) {
    const json = await requestJson(token, url);
    for (const doc of json?.documents || []) docs.push(doc);
    url = json?.nextPageToken ? collectionUrl(projectId, collectionPath) + "&pageToken=" + encodeURIComponent(json.nextPageToken) : null;
  }
  return docs;
}

async function copiarDoc(token, projectId, origem, destino, extras = {}) {
  const doc = await requestJson(token, docUrl(projectId, origem));
  if (!doc) return false;
  await requestJson(token, docUrl(projectId, destino), {
    method: "PATCH",
    body: JSON.stringify({ fields: { ...(doc.fields || {}), ...fields(extras) } })
  });
  return true;
}

async function main() {
  const saPath = obrigatorio("service-account");
  const tenantId = arg("tenant", "jairo");
  const slug = arg("slug", tenantId);
  const domain = arg("domain", `${slug}.dojopass.com.br`);
  const adminUid = arg("admin");
  const checkinLat = Number(arg("checkin-lat", "-23.58810289825024"));
  const checkinLng = Number(arg("checkin-lng", "-48.067638301537485"));
  const checkinRaioMetros = Number(arg("checkin-raio", "150"));
  if (!Number.isFinite(checkinLat) || checkinLat < -90 || checkinLat > 90) throw new Error("checkin-lat inválido.");
  if (!Number.isFinite(checkinLng) || checkinLng < -180 || checkinLng > 180) throw new Error("checkin-lng inválido.");
  if (!Number.isFinite(checkinRaioMetros) || checkinRaioMetros < 30 || checkinRaioMetros > 1000) throw new Error("checkin-raio inválido.");
  const sa = JSON.parse(await readFile(saPath, "utf8"));
  const projectId = arg("project", sa.project_id);
  const token = await accessToken(sa);
  const agora = new Date();

  await requestJson(token, docUrl(projectId, `tenants/${tenantId}`), {
    method: "PATCH",
    body: JSON.stringify({ fields: fields({ tenantSlug: slug, nome: slug, status: "ativo", dominioPrincipal: domain, dominios: [domain], migradoDeGlobal: true, atualizadoEm: agora }) })
  });
  await requestJson(token, docUrl(projectId, `tenantSlugs/${slug}`), {
    method: "PATCH",
    body: JSON.stringify({ fields: fields({ tenantId, tenantSlug: slug, status: "ativo", dominioPrincipal: domain, atualizadoEm: agora }) })
  });
  await requestJson(token, docUrl(projectId, `tenantDomains/${domain}`), {
    method: "PATCH",
    body: JSON.stringify({ fields: fields({ tenantId, tenantSlug: slug, status: "ativo", atualizadoEm: agora }) })
  });

  const contagens = {};
  for (const colecao of COLECOES) {
    const docs = await listarColecao(token, projectId, colecao);
    contagens[colecao] = docs.length;
    for (const doc of docs) {
      const id = idDoDoc(doc);
      await requestJson(token, docUrl(projectId, `tenants/${tenantId}/${colecao}/${id}`), {
        method: "PATCH",
        body: JSON.stringify({ fields: { ...(doc.fields || {}), ...fields({ tenantId, migradoDeGlobal: true }) } })
      });
      if (colecao === "admins") {
        const dadosMembership = { role: "admin", status: "ativo", tenantSlug: slug, tenantNome: slug, atualizadoEm: agora };
        await requestJson(token, docUrl(projectId, `tenants/${tenantId}/memberships/${id}`), { method: "PATCH", body: JSON.stringify({ fields: fields(dadosMembership) }) });
        await requestJson(token, docUrl(projectId, `users/${id}/memberships/${tenantId}`), { method: "PATCH", body: JSON.stringify({ fields: fields(dadosMembership) }) });
      }
      if (colecao === "alunos") {
        const dadosMembership = { role: "aluno", status: "ativo", tenantSlug: slug, tenantNome: slug, alunoId: id, atualizadoEm: agora };
        await requestJson(token, docUrl(projectId, `tenants/${tenantId}/memberships/${id}`), { method: "PATCH", body: JSON.stringify({ fields: fields(dadosMembership) }) });
        await requestJson(token, docUrl(projectId, `users/${id}/memberships/${tenantId}`), { method: "PATCH", body: JSON.stringify({ fields: fields(dadosMembership) }) });
      }
    }
  }

  for (const item of DOCS_UNICOS) {
    const extras = item.destino === "config/geral"
      ? { tenantId, migradoDeGlobal: true, checkinLat, checkinLng, checkinRaioMetros }
      : { tenantId, migradoDeGlobal: true };
    contagens[item.origem] = await copiarDoc(token, projectId, item.origem, `tenants/${tenantId}/${item.destino}`, extras) ? 1 : 0;
    if (item.destino === "config/geral" && contagens[item.origem] === 0) {
      await requestJson(token, docUrl(projectId, `tenants/${tenantId}/config/geral`), {
        method: "PATCH",
        body: JSON.stringify({ fields: fields({ mensalidadeModo: "manual", tenantId, migradoDeGlobal: true, checkinLat, checkinLng, checkinRaioMetros }) })
      });
      contagens[item.origem] = 1;
    }
  }

  if (adminUid) {
    await requestJson(token, docUrl(projectId, `tenants/${tenantId}/memberships/${adminUid}`), {
      method: "PATCH",
      body: JSON.stringify({ fields: fields({ role: "owner", status: "ativo", tenantSlug: slug, tenantNome: slug, atualizadoEm: agora }) })
    });
    await requestJson(token, docUrl(projectId, `users/${adminUid}/memberships/${tenantId}`), {
      method: "PATCH",
      body: JSON.stringify({ fields: fields({ role: "owner", status: "ativo", tenantSlug: slug, tenantNome: slug, atualizadoEm: agora }) })
    });
  }

  console.log(JSON.stringify({ ok: true, projectId, tenantId, slug, domain, contagens }, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
