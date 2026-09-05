# Contexto do Projeto — AcademiaTeste (DojoPass)

Usado pelas skills `/feature-plan`, `/feature-execute` e `/feature-validate`.
Para o histórico completo do projeto (rename da marca, contas separadas, decisões de arquitetura), ver [CONTEXT.md](../CONTEXT.md) na raiz — leia esse arquivo também antes de planejar/validar qualquer coisa não óbvia.

- **Projeto**: sandbox de desenvolvimento do módulo de mensalidades/check-in da Escola de Jiu-Jitsu Jairo Vieira, sob a marca DojoPass. Repositório `DojoPassBR/AcademiaTeste`. **Nunca é o app original em produção** (`arnaldohungria/jairovieira`) — isso é intencional, não confundir.
- **Tech stack**:
  - Site institucional + app: HTML5 + CSS3 + JS puro, sem build/bundler, sem framework
  - Backend: Firebase — Authentication (e-mail/senha) + Firestore (banco), **sem Cloud Functions** (fica no plano gratuito de propósito)
  - Toda regra de negócio de segurança/autorização vive em `firestore.rules`, não no cliente
  - Módulo financeiro (`worker/`): Cloudflare Worker separado (JS puro, `wrangler`), fora do Firebase
- **Deploy**: GitHub Pages (site+app) + `firebase deploy` (rules/indexes, projeto `academiateste-56922`) + `npx wrangler deploy` dentro de `worker/` (worker). Três mecanismos de deploy independentes — nunca assumir que um `git push` publica tudo.
- **Contas**: GitHub `tatamepass` / Firebase `tatamepass@gmail.com` — sempre confirmar a conta ativa antes de deploy (ver seção "Trocar de conta" em `CONTEXT.md`). Nunca comitar segredos do worker (`MP_ACCESS_TOKEN`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`) — eles vão só via `wrangler secret put`.

## Estrutura de arquivos

```
index.html, style.css, script.js   → site institucional
app/
  firebase-init.js                 → config Firebase + SCHOOL_LAT/LNG + WORKER_URL + helpers
  cadastro.html / login.html / checkin.html / admin.html
  app.css
worker/
  src/index.js, firestore.js, mercadopago.js
  wrangler.toml, package.json
firestore.rules                    → toda a lógica de autorização/validação
firestore.indexes.json
firebase.json / .firebaserc
assets/
CONTEXT.md                         → histórico e decisões do projeto (ler sempre)
```

## Padrões estabelecidos (seguir sempre)

- **Autorização e validação de dados sempre nas Firestore Rules**, nunca confiar em validação só do lado cliente (já houve um XSS corrigido por causa disso — commit `f354d65`).
- **Distância geográfica sem `sqrt`** nas rules (não suportado): comparar quadrado da distância com quadrado do raio. Ver `dentroDoRaioDaEscola` em `firestore.rules` e `distanceToSchoolMeters` em `firebase-init.js` — se uma mudar (coordenadas, raio), a outra tem que mudar junto (duplicação conhecida e aceita, não uma referência ao mesmo valor).
- **Feature flags via Firestore**, não branches de código: ex. `config/geral.mensalidadeModo: "manual"|"pix"`. Campo ausente sempre tem default explícito e documentado (mesmo padrão de `mensalidadeStatus` ausente = `"pendente"`).
- **Cliente nunca escreve em coleções sensíveis diretamente** (`admins`, `cobrancas`) — sempre via rules restritivas ou só pelo Worker com service account.
- **CSS**: paleta preto/vermelho/branco consistente entre `style.css` (site) e `app/app.css` (app).
- **Worker**: CORS_HEADERS centralizado, função helper `json()` para respostas, checagem explícita de credenciais faltando antes de operar (`credenciaisFaltando`).
- **Sem testes automatizados no repo** — verificação é manual/visual + leitura cuidadosa das rules. Se uma mudança envolve `firestore.rules`, considerar sugerir teste com `@firebase/rules-unit-testing` no plano.

## Zonas críticas 🔴

- `firestore.rules` — qualquer erro aqui é uma falha de segurança real (dados de alunos, mensalidades, admins)
- `worker/src/*` — lida com pagamento real (Mercado Pago) e usa credenciais de admin que bypassam as rules
- `app/firebase-init.js` (config pública, ok expor) vs segredos do worker (nunca expor)

## State file

Todas as três fases leem/escrevem `.feature-state.json` na raiz do repo:

```json
{
  "description": "descrição da feature/mudança pedida pelo usuário",
  "plan": { "...": "JSON estruturado do plano (ver /feature-plan)" },
  "implementationSummary": "resumo do que foi implementado nesta rodada",
  "validated": false,
  "validationLoops": 0,
  "lastIssues": [],
  "createdAt": "ISO timestamp"
}
```

Estado transitório — não deve ser commitado (está no `.gitignore`).
