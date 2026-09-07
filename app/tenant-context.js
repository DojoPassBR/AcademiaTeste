// Contexto multi-tenant do DojoPass.
// Todas as academias continuam no mesmo site e no mesmo Firebase, mas os dados vivos
// passam a morar em tenants/{tenantId}/... . Durante a migração, o tenant piloto é
// "jairo" para manter a academia atual funcionando mesmo antes dos índices públicos
// tenantDomains/tenantSlugs estarem preenchidos.
(function () {
  var DEFAULT_TENANT_ID = "jairo";
  var TENANT_BASE_DOMAIN = "dojopass.com.br";
  var estado = {
    pronto: false,
    tenantId: DEFAULT_TENANT_ID,
    tenantSlug: DEFAULT_TENANT_ID,
    origem: "fallback",
    erro: null
  };
  var promessa = null;

  function firestore() {
    return window.db || window.dbPublico || null;
  }

  function hostAtual() {
    return String(window.location.hostname || "").toLowerCase();
  }

  function slugValido(valor) {
    return typeof valor === "string" && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(valor);
  }

  function tenantIdValido(valor) {
    return typeof valor === "string" && /^[A-Za-z0-9_-]{2,64}$/.test(valor);
  }

  function hostValido(valor) {
    return typeof valor === "string" && /^[a-z0-9.-]{3,253}$/.test(valor) && valor.indexOf("..") === -1;
  }

  function slugDoAmbiente() {
    try {
      var url = new URL(window.location.href);
      var direto = url.searchParams.get("tenant") || url.searchParams.get("academia");
      if (slugValido(direto)) return direto;
      var partes = url.pathname.split("/").filter(Boolean);
      if ((partes[0] === "a" || partes[0] === "academia") && slugValido(partes[1])) return partes[1];
    } catch (erro) {}
    return null;
  }

  function subdominioDoHost(host) {
    if (!host || host === TENANT_BASE_DOMAIN || host === "www." + TENANT_BASE_DOMAIN) return null;
    var sufixo = "." + TENANT_BASE_DOMAIN;
    if (host.endsWith(sufixo)) {
      var sub = host.slice(0, -sufixo.length);
      if (slugValido(sub)) return sub;
    }
    return null;
  }

  function hostLocal(host) {
    return host === "localhost" || host === "127.0.0.1" || host === "";
  }

  function hostPermiteFallback(host) {
    return hostLocal(host)
      || host === "dojopassbr.github.io"
      || host === TENANT_BASE_DOMAIN
      || host === "www." + TENANT_BASE_DOMAIN;
  }

  function bloquearTenant(mensagem) {
    estado.pronto = false;
    estado.tenantId = null;
    estado.tenantSlug = null;
    estado.origem = "erro";
    estado.erro = new Error(mensagem);
    throw estado.erro;
  }

  function aplicarResolucao(dados, origem, chave) {
    if (!dados || dados.status === "suspenso") return false;
    var tenantId = dados.tenantId;
    if (!tenantIdValido(tenantId)) return false;
    estado.pronto = true;
    estado.tenantId = tenantId;
    estado.tenantSlug = slugValido(dados.tenantSlug) ? dados.tenantSlug : (slugValido(chave) ? chave : tenantId);
    estado.origem = origem;
    estado.erro = null;
    try {
      window.localStorage.setItem("dojopassTenantId", estado.tenantId);
      window.localStorage.setItem("dojopassTenantSlug", estado.tenantSlug);
    } catch (erro) {}
    return true;
  }

  async function resolverTenant() {
    if (estado.pronto) return estado;
    var dbRef = firestore();
    var host = hostAtual();
    var slug = slugDoAmbiente() || subdominioDoHost(host);

    if (hostLocal(host)) {
      var salvoLocal = null;
      try { salvoLocal = window.localStorage.getItem("dojopassTenantId"); } catch (erro) {}
      estado.pronto = true;
      estado.tenantId = tenantIdValido(salvoLocal) ? salvoLocal : DEFAULT_TENANT_ID;
      estado.tenantSlug = slugValido(slug) ? slug : estado.tenantId;
      estado.origem = "fallback-dev";
      estado.erro = null;
      return estado;
    }

    try {
      if (dbRef && hostValido(host)) {
        var domainDoc = await dbRef.collection("tenantDomains").doc(host).get();
        if (domainDoc.exists && aplicarResolucao(domainDoc.data(), "domain", host)) return estado;
      }
      if (dbRef && slugValido(slug)) {
        var slugDoc = await dbRef.collection("tenantSlugs").doc(slug).get();
        if (slugDoc.exists && aplicarResolucao(slugDoc.data(), "slug", slug)) return estado;
      }
    } catch (erro) {
      estado.erro = erro;
    }

    if (!hostPermiteFallback(host)) {
      return bloquearTenant("Academia não encontrada ou domínio não cadastrado no DojoPass.");
    }

    var salvo = null;
    if (hostLocal(host)) {
      try { salvo = window.localStorage.getItem("dojopassTenantId"); } catch (erro) {}
    }
    estado.pronto = true;
    estado.tenantId = tenantIdValido(salvo) ? salvo : DEFAULT_TENANT_ID;
    estado.tenantSlug = slugValido(slug) ? slug : estado.tenantId;
    estado.origem = "fallback-dev";
    return estado;
  }

  function ensureTenantContext() {
    if (!promessa) promessa = resolverTenant();
    return promessa;
  }

  function exigirTenantResolvido() {
    if (!tenantIdValido(estado.tenantId)) {
      throw new Error("Academia não resolvida. Confira o domínio/subdomínio cadastrado.");
    }
  }

  function tenantDocRef(colecao, docId) {
    exigirTenantResolvido();
    var dbRef = firestore();
    if (!dbRef) throw new Error("Firestore ainda não foi inicializado.");
    return dbRef.collection("tenants").doc(estado.tenantId).collection(colecao).doc(docId);
  }

  function tenantCollection(colecao) {
    exigirTenantResolvido();
    var dbRef = firestore();
    if (!dbRef) throw new Error("Firestore ainda não foi inicializado.");
    return dbRef.collection("tenants").doc(estado.tenantId).collection(colecao);
  }

  function tenantPayload(extra) {
    exigirTenantResolvido();
    return Object.assign({ tenantId: estado.tenantId, tenantSlug: estado.tenantSlug }, extra || {});
  }

  window.DOJOPASS_TENANT_DEFAULT = DEFAULT_TENANT_ID;
  window.DOJOPASS_TENANT = estado;
  window.ensureTenantContext = ensureTenantContext;
  window.tenantCollection = tenantCollection;
  window.tenantDocRef = tenantDocRef;
  window.tenantPayload = tenantPayload;
})();
