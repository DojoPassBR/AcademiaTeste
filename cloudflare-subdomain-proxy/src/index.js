const ORIGIN = "https://dojopass.com.br";
const RAW_ORIGIN = "https://raw.githubusercontent.com/DojoPassBR/AcademiaTeste/main";

function publicAcademyPage(hostname) {
  const slug = hostname.split(".")[0] || "academia";
  const title = slug.charAt(0).toUpperCase() + slug.slice(1);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} | DojoPass</title>
<meta name="description" content="Perfil público da academia no DojoPass.">
<link rel="icon" type="image/svg+xml" href="/assets/logo.svg">
<link rel="stylesheet" href="/style.css?v=315012c2">
</head>
<body>
<header class="site-header">
  <div class="container header-inner">
    <a class="brand" href="/" aria-label="DojoPass"><img src="/assets/landing/dojopass-logo-final-horizontal.png" alt="DojoPass" class="brand-logo brand-logo-final"></a>
    <nav class="nav" aria-label="Navegação principal">
      <a href="#grade">Grade</a>
      <a href="#equipe">Equipe</a>
      <a href="#contato">Contato</a>
    </nav>
    <a class="header-login" href="/app/login.html?academia=${encodeURIComponent(slug)}">Entrar</a>
  </div>
</header>
<main id="inicio">
  <section class="hero-section">
    <div class="hero-photo" aria-hidden="true"><img src="/assets/landing/jiu-jitsu-hero.png" alt=""></div>
    <div class="container hero-grid">
      <div class="hero-copy">
        <span class="eyebrow">Academia no DojoPass</span>
        <h1 id="academia-nome">${title}</h1>
        <p class="hero-lead">Confira horários, equipe, endereço e canais oficiais da academia.</p>
        <div class="hero-actions">
          <a class="btn primary" href="/app/login.html?academia=${encodeURIComponent(slug)}">Área do aluno</a>
          <a class="btn secondary" href="#grade">Ver horários</a>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="grade">
    <div class="container">
      <span class="section-kicker">Treinos</span>
      <h2>Grade de horários</h2>
      <div class="table-wrap">
        <table class="grade-table">
          <thead><tr><th>Dia</th><th>Horário</th><th>Turma</th></tr></thead>
          <tbody id="grade-tabela-corpo">
            <tr><td>Segunda a sexta</td><td>Consulte a academia</td><td>Turmas disponíveis</td></tr>
          </tbody>
        </table>
      </div>
      <div class="grade-mobile" id="grade-mobile"></div>
    </div>
  </section>

  <section class="section alt" id="equipe">
    <div class="container">
      <span class="section-kicker">Equipe</span>
      <h2>Professores e instrutores</h2>
      <div class="staff-grid" id="lista-equipe">
        <div class="staff-card"><span class="staff-label">Equipe</span><span class="staff-name">Carregando informações da academia</span></div>
      </div>
    </div>
  </section>

  <section class="section" id="contato">
    <div class="container">
      <span class="section-kicker">Contato</span>
      <h2>Endereço e canais</h2>
      <div class="feature-grid">
        <article class="feature-card" id="local-info">
          <p id="local-endereco"><strong>Endereço:</strong><br>Consulte a academia.</p>
        </article>
        <div class="contact-grid" id="contato-cards">
          <a class="card" id="contato-telefone" href="#"><span class="card-label">Telefone</span><span class="card-value">Contato da academia</span></a>
          <a class="card" id="contato-instagram" href="#" target="_blank" rel="noopener"><span class="card-label">Instagram</span><span class="card-value">Instagram</span></a>
        </div>
      </div>
    </div>
  </section>
</main>
<footer class="footer"><div class="container footer-inner"><a class="brand footer-brand" href="/" aria-label="DojoPass"><img src="/assets/landing/dojopass-logo-final-horizontal.png" alt="DojoPass" class="brand-logo brand-logo-final"></a><p>&copy; ${new Date().getFullYear()} ${title}. Plataforma DojoPass.</p></div></footer>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>
<script src="/site-firebase.js?v=20260911"></script>
<script src="/app/tenant-context.js?v=20260911"></script>
<script src="/site-publico.js?v=20260911"></script>
</body>
</html>`;
}

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);

    if (requestUrl.hostname === "dojopass.com.br") {
      return fetch(request);
    }

    if ((request.method === "GET" || request.method === "HEAD")
        && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) {
      return new Response(publicAcademyPage(requestUrl.hostname), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=120"
        }
      });
    }

    if (request.method === "GET" && (
      requestUrl.pathname === "/site-firebase.js"
      || requestUrl.pathname === "/site-publico.js"
      || requestUrl.pathname === "/app/tenant-context.js"
      || requestUrl.pathname.startsWith("/app/")
    )) {
      const rawResponse = await fetch(RAW_ORIGIN + requestUrl.pathname, {
        cf: { cacheTtl: 300, cacheEverything: true }
      });
      const contentType = requestUrl.pathname.endsWith(".html")
        ? "text/html; charset=utf-8"
        : requestUrl.pathname.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "application/javascript; charset=utf-8";
      return new Response(rawResponse.body, {
        status: rawResponse.status,
        headers: {
          "content-type": contentType,
          "cache-control": "public, max-age=300"
        }
      });
    }

    const originUrl = new URL(requestUrl.pathname + requestUrl.search, ORIGIN);
    const headers = new Headers(request.headers);
    headers.set("Host", "dojopass.com.br");
    headers.set("X-Forwarded-Host", requestUrl.hostname);

    const proxied = new Request(originUrl.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual"
    });

    return fetch(proxied);
  }
};
