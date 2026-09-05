# Contexto do projeto — AcademiaTeste

## O que é isso

Cópia de trabalho do site + app da **Escola de Jiu-Jitsu Jairo Vieira**, criada
para desenvolver um **módulo de controle de mensalidades** sem mexer no app
original que já está em produção e funcionando.

**Importante: não é o mesmo projeto.** São dois repositórios, duas contas de
GitHub e dois projetos Firebase totalmente separados:

| | Projeto original (produção) | Este projeto (sandbox) |
|---|---|---|
| Repositório GitHub | `arnaldohungria/jairovieira` | `DojoPassBR/AcademiaTeste` |
| Site publicado | https://arnaldohungria.github.io/jairovieira/ | https://dojopassbr.github.io/AcademiaTeste/ |
| Firebase project | `escolajairoveiria` | `academiateste-56922` |
| Conta Google (Firebase) | `arnaldo@live.jp` | `tatamepass@gmail.com` |

**Nome da marca:** o projeto/empresa se chama **DojoPass** (renomeado de "TatamePass" em 2026-07-29,
porque esse nome já era usado por outra empresa). A conta do GitHub teve que ficar `DojoPassBR`
(variação do nome — "DojoPass" sozinho já estava em uso por outra conta, sem relação). O e-mail do
Google/Firebase continua `tatamepass@gmail.com` — não foi trocado, é só o endereço de e-mail, sem
relação com o nome da marca.

Regra de ouro: **qualquer trabalho novo (mensalidades, etc.) acontece aqui**,
nunca na pasta/repositório original.

## Stack

Site estático (sem build/bundler) — HTML, CSS e JS puro, hospedável em
qualquer lugar (o original usa GitHub Pages). Backend é **Firebase**:
Authentication (e-mail/senha) + Firestore (banco de dados) + Firestore
Security Rules (toda a regra de negócio de segurança fica nas rules, não há
Cloud Functions/servidor — mantém tudo no plano gratuito).

## Estrutura de arquivos

```
index.html, style.css, script.js   → site institucional (sobre, horários, endereço, contato)
app/
  firebase-init.js                 → config do Firebase + helpers (distância até a escola, formatação de data, WORKER_URL)
  cadastro.html                    → cadastro do aluno (nome, telefone, nascimento, faixa, e-mail/senha)
  login.html                       → login; redireciona pra admin.html se o UID existir na coleção "admins", senão checkin.html
  checkin.html                     → tela do aluno: status do dia, check-in (geolocalização), histórico, card de pagamento Pix (modo pix)
  admin.html                       → painel do professor: tabela de alunos, faixa, presenças, mensalidade (manual ou Pix conforme o modo)
  app.css                          → estilos do app (preto/vermelho/branco, igual ao site)
worker/                            → Cloudflare Worker do módulo financeiro (gera cobrança Pix + webhook do Asaas) — ver seção própria abaixo
firestore.rules                    → regras de segurança (ver abaixo)
firestore.indexes.json             → índices compostos (checkins, cobrancas)
firebase.json / .firebaserc        → config do Firebase CLI (projeto default: academiateste-56922)
assets/                            → logo, foto da grade de horários, qrcode do site
```

## Como funciona o check-in por localização

Sem Cloud Functions (ficaria no plano pago Blaze). A validação da distância
até a escola acontece **dentro das Firestore Rules**, usando uma aproximação
equiretangular (sem `sqrt`, que as rules não suportam): compara o quadrado da
distância com o quadrado do raio permitido (150m). Coordenadas da escola e
raio estão hardcoded em `firestore.rules` (função `dentroDoRaioDaEscola`) e
replicadas em `app/firebase-init.js` (`distanceToSchoolMeters`) pro
feedback visual do lado do cliente.

**Limitação conhecida (aceita conscientemente):** a geolocalização do
navegador pode, em tese, ser falsificada via DevTools. Para o caso de uso
(contar presença de alunos, não segurança crítica), foi considerado
aceitável. Se um dia precisar de mais rigor, a opção é migrar a validação pra
uma Cloud Function (exige plano Blaze).

## Papel de admin (professor)

Não existe cadastro de admin pelo próprio app (rules bloqueiam escrita na
coleção `admins` do lado do cliente, de propósito). Pra promover alguém a
professor: cadastrar normalmente em `cadastro.html`, pegar o UID em
**Authentication** no Firebase Console, e criar manualmente um documento em
Firestore na coleção `admins` com **ID = UID** do usuário.

## Trocar de conta (GitHub CLI e Firebase CLI)

Como são duas contas em cada ferramenta, sempre confirmar qual está ativa
antes de rodar comandos:

```bash
# GitHub CLI — o gh ainda identifica essa conta localmente pelo nome antigo
# "tatamepass" (não atualiza sozinho quando a conta é renomeada no GitHub;
# o comando abaixo continua funcionando do mesmo jeito, é só o rótulo local
# que ficou desatualizado — as URLs reais dos repos usam DojoPassBR).
gh auth switch --user tatamepass       # antes de dar push aqui
gh auth switch --user arnaldohungria   # antes de mexer no repo original

# Firebase CLI (e-mail não mudou com o rename da marca)
firebase login:use tatamepass@gmail.com   # antes de firebase deploy aqui
```

## Módulo de mensalidades: manual e Pix, no mesmo sistema

Havia dois protótipos separados — este (mensalidade manual) e `DojoPassBR/AcademiaPlus`
(cobrança automática via Pix/Mercado Pago) — **unificados aqui em 2026-08-22** pra não
manter dois códigos quase idênticos divergindo. Os dois modos existem lado a lado; qual
está ativo é decidido por um único campo:

- **`config/geral`** (documento único): `{ mensalidadeModo: "manual" | "pix" }`. Ausência
  do campo (ou do doc inteiro) conta como `"manual"` — mesmo padrão de default já usado em
  `mensalidadeStatus` ausente = `"pendente"`. **Não existe tela pra trocar isso** — é
  configurado direto no Firestore Console, por cliente, do mesmo jeito que `SCHOOL_LAT`/
  `WORKER_URL` já são hoje. Rules: leitura pra qualquer autenticado, escrita só admin.

- **Modo manual** (comportamento original, sem mudança nenhuma): professor marca
  pago/pendente em `admin.html`; aluno só visualiza o status em `checkin.html`.

- **Modo Pix**: professor clica "Gerar cobrança Pix" (só aparece pra aluno com
  mensalidade pendente) → chama `WORKER_URL + "/criar-cobranca"` → o Worker cria o
  documento em `cobrancas/{id}` com o código Pix copia-e-cola. O aluno vê um card
  "Pagar mensalidade via Pix" em `checkin.html` assim que existir uma cobrança pendente
  com código gerado. Quando o provedor de pagamento (Asaas) confirma o pagamento, o Worker (via webhook,
  usando credenciais de admin que passam por cima das Firestore Rules) atualiza
  `cobrancas/{id}.status` e `alunos/{id}.mensalidadeStatus`. Em qualquer modo, o professor
  sempre pode clicar "Marcar pendente" num aluno pago, pra corrigir manualmente.

- **`cobrancas/{id}`**: `alunoId`, `alunoNome`, `valor`, `mesReferencia`, `status`
  (`"pendente"` | `"pago"` | `"cancelado"`), `pixCopiaECola`, `pixQrCodeBase64`,
  `criadoEm`, `pagoEm`. Cliente só lê (a própria ou, se admin, todas) —
  nunca escreve; só o Worker escreve, via service account.
  (Esquema atualizado na migração pro Asaas — ver *Migração Mercado Pago → Asaas*:
  o ID virou `<alunoId>_<mesReferencia>` e `mpPaymentId` deu lugar a `asaasPaymentId`.)

### O Worker (`worker/`)

Cloudflare Worker (serverless, fora do Firebase, plano gratuito) — evita precisar do plano
pago Blaze do Firebase só pra rodar o webhook do provedor de pagamento. Expõe:
- `POST /criar-cobranca` — admin.html chama isso pra gerar uma cobrança Pix.
- `POST /webhook-asaas` — o Asaas chama isso quando o Pix é pago (era
  `/webhook-mercadopago` até 2026-08-30).

Migrado do `AcademiaPlus/worker/` (mesmo código, `wrangler.toml` repontado pro
`FIREBASE_PROJECT_ID = "academiateste-56922"`, nome do serviço trocado pra
`academiateste-financeiro`). **As secrets (a do provedor de pagamento, `FIREBASE_CLIENT_EMAIL`,
`FIREBASE_PRIVATE_KEY`) nunca chegaram a ser configuradas no Worker original** — não tem
segredo de produção pra migrar, só configurar do zero (`npx wrangler secret put ...`,
dentro de `worker/`) quando um cliente real quiser Pix, com uma chave de service account
gerada especificamente pro projeto `academiateste-56922`. Até lá, `WORKER_URL` fica vazia
em `app/firebase-init.js` e o botão "Gerar cobrança Pix" mostra um erro amigável.

**Deploy do Worker** é separado do `firebase deploy` e do `git push` — precisa rodar
`npx wrangler deploy` de dentro de `worker/`, autenticado na conta Cloudflare certa.

**AcademiaPlus foi/será apagado** (repositório `DojoPassBR/AcademiaPlus` e projeto
Firebase `academiaplus-prototipo`) depois de confirmado que este merge está estável —
todo código relevante (incluindo o `worker/`) já foi trazido pra cá antes disso acontecer.

## Hardening de segurança (2026-08-26)

Rodada de fechamento dos buracos de autorização do módulo financeiro e do check-in.
O que mudou no contrato do sistema:

### Worker: autenticação obrigatória

`POST /criar-cobranca` **exige** header `Authorization: Bearer <ID token do Firebase>`.
O Worker valida o token contra o JWKS público do Google (`worker/src/auth.js`, sem
`firebase-admin` — que não roda em Cloudflare Workers), confere `aud`/`iss`/`exp`, e
depois lê `admins/{uid}` no Firestore. Sem token → **401**; token válido de quem não é
professor → **403**. `app/admin.html` já manda o header e mostra mensagem específica
nesses dois casos. O Worker também confere que `alunos/{alunoId}` existe (**404** se não)
e valida formato de `alunoId`/`valor`/`mesReferencia` (`worker/src/validacao.js`).

CORS deixou de ser `*`: a lista branca fica em `ALLOWED_ORIGINS` (bloco `[vars]` do
`wrangler.toml`), separada por vírgula.

### Worker: nova secret `MP_WEBHOOK_SECRET`

> **Substituído em 2026-08-30** pela validação de token do Asaas
> (`asaas-access-token`, `worker/src/webhook-token.js`). O texto abaixo fica como
> histórico — `MP_WEBHOOK_SECRET`, `worker/src/webhook-assinatura.js` e a rota
> `/webhook-mercadopago` não existem mais. Ver *Migração Mercado Pago → Asaas*.

`POST /webhook-mercadopago` agora valida a assinatura `x-signature` de cada notificação
(HMAC-SHA256 sobre `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, comparação em tempo
constante, janela anti-replay de 5 min — `worker/src/webhook-assinatura.js`), **antes** de
qualquer chamada ao Mercado Pago. Assinatura inválida → 401.

Configurar (de dentro de `worker/`):

```bash
npx wrangler secret put MP_WEBHOOK_SECRET
```

O valor é a **chave secreta da notificação**, no painel do Mercado Pago:
*Suas integrações > (o app) > Webhooks > Configurar notificações*. Enquanto ela não
existir, o Worker responde 501 nas duas rotas (mesmo comportamento das outras secrets).

Os PATCHs do webhook agora usam `currentDocument.exists=true` — antes o upsert cego
criava um "aluno fantasma" a partir de qualquer `external_reference`. Documento
inexistente vira log + 200 (pra o MP não reenfileirar), nunca 500. Erros internos
também deixaram de vazar o corpo da resposta do MP/Firestore pro cliente.

### Cooldown de check-in agora é validado no servidor

O `checkinId` (`<uid>_<janela de 90min>`) deixou de ser só uma convenção do cliente: a
função `checkinIdValido` em `firestore.rules` recalcula a janela a partir de
`request.time` e recusa qualquer outro ID. O divisor (`5400000` ms) tem que ser
**idêntico** em `firestore.rules` e em `app/firebase-init.js` (`CHECKIN_JANELA_MS`).

Outras mudanças nas rules: `hasOnly`/`hasAll` em `alunos` e `checkins` (nada de campo
extra ou faltando), regex de formato para `nascimento` e `email`, enum + carimbo de
servidor obrigatórios quando o admin muda `mensalidadeStatus`, e `config/` restrito ao
documento `geral` com apenas `mensalidadeModo`/`valorMensalidadePadrao`.

### Testes das rules e CI

```bash
cd tests && npm install && npm test
```

Roda a suíte contra o **emulador do Firestore** (precisa de Java 17+ instalado). O
emulador carrega o `firestore.rules` real da raiz — nenhuma cópia. O script `test` faz
`cd ..` porque o `firebase.json` (com o novo bloco `emulators`) vive na raiz, enquanto as
dependências ficam isoladas em `tests/node_modules` (nada disso afeta o app ou o worker).

**Importante: os arquivos de teste rodam com `--no-file-parallelism`.** Todos os
arquivos em `tests/rules/*.test.js` compartilham o mesmo `PROJECT_ID` (`setup.js`) e o
mesmo emulador, e cada um chama `clearFirestore()` no `beforeEach`. Sem essa flag, o
Vitest roda os arquivos em paralelo (padrão do Vitest 2) e um arquivo apaga os dados que
outro acabou de semear no meio do teste — resultado são falhas aleatórias e
inconsistentes espalhadas por arquivos sem relação nenhuma entre si (já aconteceu: 10
testes falhando em 4 arquivos diferentes, com erros como "campo undefined" e
"transaction lock timeout", que não eram bug nenhum nas rules — só corrida entre
arquivos). Se um dia precisar rodar os testes fora do script `npm test` (ex: direto com
`vitest`), lembrar de manter essa flag.

`.github/workflows/ci.yml` roda dois jobs em todo push/PR: a suíte de rules e o
`scripts/check-geo-drift.mjs`, que confere se as coordenadas/raio/janela em
`firestore.rules` e `app/firebase-init.js` continuam iguais (os comentários
`// GEO-SYNC:` nos dois arquivos são o contrato que o script parseia).

### Pendente: App Check

**Firebase App Check não foi ativado** — depende de uma site key reCAPTCHA v3 real, que
só existe com o projeto de produção do cliente. `app/firebase-init.js` tem um
`TODO(security)` no lugar exato, com os 4 passos que faltam. Até lá, as Firestore Rules
seguem sendo a única barreira contra chamadas diretas ao Firestore com a apiKey pública.

## Migração Mercado Pago → Asaas (2026-08-30)

O provedor de cobrança Pix do Worker deixou de ser o Mercado Pago e passou a ser o
**Asaas**. O resto da arquitetura não mudou: continua Cloudflare Worker + escrita no
Firestore via service account + `Authorization: Bearer <ID token>` com checagem de
`admins/{uid}` em `/criar-cobranca`.

### O que mudou no Worker

| | Antes (Mercado Pago) | Agora (Asaas) |
|---|---|---|
| Cliente da API | `worker/src/mercadopago.js` (removido) | `worker/src/asaas.js` |
| Autenticação da API | `Authorization: Bearer <MP_ACCESS_TOKEN>` | header `access_token: <ASAAS_API_KEY>` |
| Base URL | hardcoded | `ASAAS_BASE_URL` (var do `wrangler.toml`) |
| Rota do webhook | `POST /webhook-mercadopago` | `POST /webhook-asaas` |
| Autenticação do webhook | HMAC do `x-signature` (`webhook-assinatura.js`, removido) | token estático no header `asaas-access-token` (`webhook-token.js`) |
| Status "pago" | `approved` | `RECEIVED` ou `CONFIRMED` |
| Idempotência | header `X-Idempotency-Key` do MP | ID do documento `cobrancas/<alunoId>_<mesReferencia>` |

Endpoints do Asaas usados: `POST /customers`, `POST /payments` (`billingType: "PIX"`),
`GET /payments/{id}/pixQrCode`, `GET /payments/{id}`.

O Asaas **não assina** o corpo da notificação, então não há HMAC nem janela anti-replay.
As defesas que substituem isso (documentadas em `worker/src/webhook-token.js`): (1) o
status vem sempre da reconsulta autoritativa `GET /payments/{id}`, nunca do payload; (2)
os dois `PATCH` usam `currentDocument.exists=true` e a cobrança só transiciona pra
"pago" — reprocessar a mesma notificação não produz efeito novo.

### Secrets

| Secret | Situação | Onde pegar |
|---|---|---|
| `ASAAS_API_KEY` | **nova** | painel do Asaas > Integrações > Chave de API (sandbox e produção têm chaves diferentes) |
| `ASAAS_WEBHOOK_TOKEN` | **nova** | você define ao cadastrar o webhook no painel do Asaas; gerar aleatório com 32+ chars (`openssl rand -base64 32`) |
| `MP_ACCESS_TOKEN` | **removida** | — |
| `MP_WEBHOOK_SECRET` | **removida** | — |

`FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` não mudaram. Enquanto qualquer uma das
quatro secrets ativas faltar, as duas rotas respondem 501, como antes.

Novas vars (não são secrets, ficam no `wrangler.toml`): `ASAAS_BASE_URL` e
`ASAAS_DUE_DATE_DIAS` (default 5 dias até o vencimento).

### Esquema de dados

- **`cobrancas/{cobrancaId}`** — o ID do documento agora é **`<alunoId>_<mesReferencia>`**
  (era o ID do pagamento do MP). É esse ID que dá idempotência: gerar duas vezes a
  cobrança do mesmo aluno/mês cai no mesmo documento. Campos: `alunoId`, `alunoNome`,
  `valor`, `mesReferencia`, `status` (`"pendente"` | `"pago"` | `"cancelado"`),
  `pixCopiaECola` (o `payload` do Asaas), `pixQrCodeBase64` (o `encodedImage`),
  `asaasPaymentId`, `asaasCustomerId`, `dueDate`, `pixExpiraEm`, `criadoPorUid`,
  `criadoEm`, `atualizadoEm`, `pagoEm`. O campo `mpPaymentId` deixou de existir.
- **`alunos/{alunoId}`** — ganhou `asaasCustomerId` e `customerCriadoEm`, escritos **só
  pelo Worker** via service account.

Comportamento do `POST /criar-cobranca`: `422 { precisaCpf: true }` quando o aluno ainda
não tem `asaasCustomerId` e o CPF não veio no corpo; `409` quando o mês já está pago;
`200 { jaExistia: true }` quando já existe cobrança pendente daquele mês (devolve o mesmo
código Pix); `502` se o pagamento foi criado no Asaas mas o QR Code falhou (a cobrança é
gravada mesmo assim, com os campos Pix nulos — nunca fica um payment sem rastro).

### Política de CPF

O Asaas exige `cpfCnpj` para criar o pagador. No DojoPass o CPF é:

- **coletado sob demanda**, só na primeira cobrança de cada aluno (campo que aparece em
  `app/admin.html` quando o Worker responde 422);
- **nunca persistido** — não vai pro Firestore, nem em `alunos`, nem em `cobrancas`;
- **nunca logado** — `worker/src/cpf.js` (validação de CPF/CNPJ com dígito verificador)
  não tem nenhum `console.*`, de propósito, e quem o chama também não loga o valor;
- o único resíduo é o `asaasCustomerId` devolvido pela API, gravado em `alunos/{id}`.

### Firestore Rules

**Nenhuma mudança de lógica** — só comentários. Os `hasOnly()` já existentes no
`create`/`update` de `alunos` já impedem cliente e admin de escreverem
`asaasCustomerId`/`customerCriadoEm` (esses campos não aparecem em nenhuma das listas),
e `cobrancas` continua `allow write: if false`.

### Checklist de corte

1. `cd worker && npx wrangler secret put ASAAS_API_KEY` e
   `npx wrangler secret put ASAAS_WEBHOOK_TOKEN` (valores nunca vão pro git nem pro chat).
2. Cadastrar o webhook no painel do Asaas apontando pra `{WORKER_URL}/webhook-asaas`,
   usando **o mesmo** token da secret `ASAAS_WEBHOOK_TOKEN`.
3. Testar em sandbox (`ASAAS_BASE_URL = https://sandbox.asaas.com/api/v3`): gerar
   cobrança, pagar no sandbox, conferir `cobrancas/{id}.status` e
   `alunos/{id}.mensalidadeStatus` virando "pago". Só depois trocar `ASAAS_BASE_URL` pra
   `https://api.asaas.com/v3` e a chave pra de produção.
4. Desativar a notificação de webhook no painel do Mercado Pago (a rota
   `/webhook-mercadopago` não existe mais e passa a responder 404).
5. `npx wrangler secret delete MP_ACCESS_TOKEN` e
   `npx wrangler secret delete MP_WEBHOOK_SECRET`.
6. **Não há migração automática de dados.** Cobranças antigas com `status: "pendente"` e
   ID de payment do Mercado Pago ficam órfãs: o webhook novo nunca vai encontrá-las.
   Conciliar manualmente — conferir no painel do MP quem pagou e marcar como pago pelo
   modo manual em `admin.html`.

## Mural de eventos e campeonatos (coleção `eventos`)

Lista de eventos/campeonatos da escola, cadastrada **manualmente pelo professor** em
`app/admin.html` e exibida como "Próximos eventos" pra todo aluno autenticado em
`app/checkin.html`.

**Cadastro 100% manual, sem integração com terceiros.** Decisão tomada: não há import de
calendário de federação, feed externo nem scraping — o professor digita cada evento. Isso
mantém o escopo do sandbox e evita depender de uma API de terceiro que ninguém controla.

Formato de `eventos/{eventoId}` (ID automático, via `.add()`):

| Campo | Tipo | Obrigatório | Regra |
|---|---|---|---|
| `nome` | string | sim | 1..120 caracteres |
| `data` | string | sim | `YYYY-MM-DD` (regex nas rules) |
| `local` | string | sim | 1..160 caracteres |
| `link` | string | não | só `https://`, até 500 caracteres |
| `criadoPor` | string | sim (create) | `== request.auth.uid`, imutável depois |
| `criadoEm` | timestamp | sim (create) | `== request.time`, imutável depois |
| `atualizadoEm` | timestamp | sim (update) | `== request.time` |

Por que `data` é **string** e não timestamp: o valor vem direto do `<input type="date">`,
e `YYYY-MM-DD` é comparável lexicograficamente — dá pra filtrar "eventos futuros" com
`where('data', '>=', hojeISO)` sem conversão de fuso nenhuma. Na hora de exibir, sempre
`new Date(data + 'T00:00:00')`, o mesmo truque de fuso já usado no `nascimento` do aluno
(sem o `T00:00:00` a string é lida como UTC e o dia aparece um a menos no Brasil).

Política do `link`: **https-only**, validado nas rules (`^https://[^ ]+[.][^ ]+$`) e de
novo no cliente com `new URL()` dentro de `try/catch` antes de virar `href`. Isso fecha
`javascript:`/`data:` (o link é texto livre que vira `<a>` na tela do aluno). Todo `<a>`
sai com `target="_blank" rel="noopener noreferrer"`.

Eventos passados **nunca são apagados automaticamente**: `checkin.html` filtra pelos
futuros (`where data >= hoje`, `orderBy data asc`, `limit 10`) e `admin.html` lista todos
em ordem decrescente, marcando os já ocorridos como "Encerrado" (esmaecido).

**Não precisa de índice composto novo**: o range e o `orderBy` caem no mesmo campo
(`data`), caso já atendido pelo índice de campo único que o Firestore cria sozinho —
diferente de `checkins`/`cobrancas`, que combinam campos diferentes e por isso estão em
`firestore.indexes.json`.

Testes das rules: `tests/rules/eventos.test.js`.

## Pix manual, tela de Configurações e cobranças de origem `manual` (2026-09-04)

Academia que já tem uma chave Pix própria não precisa do Asaas pra cobrar: o professor
lança a cobrança na mão e cola o código Pix. Isso virou um terceiro modo de mensalidade e
trouxe uma tela de Configurações no painel — antes `config/geral` só era editável pelo
Firestore Console.

### `config/geral` — campos novos (todos opcionais)

| Campo | Tipo | Regra |
|---|---|---|
| `mensalidadeModo` | string | `"manual"` \| `"pix"` \| **`"pixManual"`** (novo). Obrigatório no write. |
| `valorMensalidadePadrao` | number | 0 < v ≤ 5000 (agora validado nas rules) |
| `academiaNome` | string | ≤ 80 |
| `pixChaveManual` | string | ≤ 200 — chave/copia-e-cola padrão sugerida ao lançar cobrança manual |
| `lembreteWhatsappAtivo` | bool | |
| `lembreteEmailAtivo` | bool | |
| `lembreteVisualAtivo` | bool | |
| `lembreteDiasParaAlerta` | int | 1..60 |
| `lembreteTemplate` | string | ≤ 500, com placeholders de **texto** `{nome}` `{mes}` `{valor}` `{academia}` `{pix}` |

Os campos de lembrete são **só configuração** — nada de envio (WhatsApp/e-mail) foi
implementado ainda. Ausência de qualquer campo é tratada no cliente com default sensato
(`normalizarConfig()` em `app/admin.html`). A validação de tipo/tamanho vive na função
`dadosConfigValidos()` de `firestore.rules`, e o `hasOnly` do write lista exatamente esses
campos — continua impossível gravar campo arbitrário ou documento fora de `config/geral`.

### Modo `pixManual`

- **`admin.html`**: aluno pendente ganha o botão "Lançar cobrança Pix manual" (+ "Marcar
  pago", porque não existe webhook confirmando nada aqui). O modal pede mês de referência
  e valor (pré-preenchidos com o mês atual e `valorMensalidadePadrao`) e o código Pix
  (pré-preenchido com `pixChaveManual`).
- **`checkin.html`**: o card "Pagar mensalidade via Pix" agora aparece nos dois modos Pix
  (`modoUsaPix()`), lendo a mesma cobrança pendente — a query de `cobrancas` não mudou.

### `cobrancas/{id}.origem` — `'asaas'` | `'manual'`

Campo novo que decide **quem pode escrever** o documento. Documentos antigos não têm o
campo e contam como `'asaas'` (`resource.data.get('origem', 'asaas')`).

`cobrancas` deixou de ser `allow write: if false`:

- **`create`**: só admin, só `origem == 'manual'`, só `status == 'pendente'`, `valor`
  entre 0 e 5000, `mesReferencia` casando `^[0-9]{4}-(0[1-9]|1[0-2])$`, ID obrigatoriamente
  `<alunoId>_<mesReferencia>` (mesma idempotência do Asaas — uma cobrança por aluno/mês),
  `alunos/{alunoId}` tem que existir, `criadoPorUid == request.auth.uid` e
  `criadoEm == request.time`. **Admin nunca cria com `origem: 'asaas'`** — essa origem só
  nasce pelo Worker, que usa service account e passa por cima das rules.
- **`update`**: só admin, **só em documento com `origem == 'manual'`**, e só nos campos
  `status`/`valor`/`pixCopiaECola`/`atualizadoEm` (o `hasOnly` do `diff` é o que impede
  trocar `alunoId`, `mesReferencia`, `criadoPorUid` ou "converter" a cobrança em `asaas`).
- **`delete`**: continua `false` pra todo mundo.
- **`read`**: sem mudança (aluno lê a própria, admin lê todas).

Consequência de segurança que **não pode regredir**: cobrança de origem `'asaas'` continua
intocável pelo cliente — nem admin marca "pago" nela pelo painel, porque só o webhook do
provedor pode confirmar um pagamento real. Aluno nenhum escreve em `cobrancas`, em
nenhuma origem. Testes: `tests/rules/admins-cobrancas-config.test.js`.

## Comprovante de pagamento no Pix manual (2026-09-04)

No modo `pixManual` não existe webhook confirmando nada: o professor precisa de alguma
evidência antes de marcar "pago". O aluno passou a anexar o comprovante (imagem ou PDF) na
própria cobrança pendente, e o professor confirma depois de olhar o arquivo.

### Por que R2 (Cloudflare) e não Firebase Storage

O Firebase Storage exige o plano **Blaze** (cartão de crédito) no projeto, e o piloto roda
no plano gratuito. O Cloudflare Worker do módulo financeiro já existia, então o arquivo vai
pro bucket R2 `dojopass-comprovantes`, declarado em `worker/wrangler.toml` como o binding
`COMPROVANTES_BUCKET`.

Consequência que **não pode ser esquecida**: R2 não tem Security Rules. Toda a autorização
vive no código de `worker/src/comprovante.js`. O navegador nunca fala com o R2 direto.

### Endpoints novos do Worker

| Endpoint | Quem | O que faz |
|---|---|---|
| `POST /comprovante` | o **aluno** (ID token no header `Authorization`) | `multipart/form-data` com `cobrancaId` + `arquivo` |
| `GET /comprovante/{cobrancaId}` | o **professor** (admin) | devolve o arquivo `inline` (com `nosniff` e `Cache-Control: private, no-store`) |

Validações do upload, todas no servidor (a checagem do `checkin.html` é só conveniência):
cobrança existe · `origem == 'manual'` (cobrança do Asaas é resolvida pelo webhook, não
aceita comprovante) · `alunoId == uid` do token (ninguém envia comprovante na cobrança de
outro) · `status == 'pendente'` · content-type em
`image/jpeg | image/png | image/webp | application/pdf` · ≤ 5 MB. A **extensão do objeto sai
do content-type**, nunca do nome de arquivo enviado pelo navegador. A key é
`comprovantes/{uid}/{cobrancaId}.{ext}` — o aluno só escreve dentro do próprio prefixo.

Depois de gravar no R2, o próprio Worker (service account, passa por cima das rules) faz o
PATCH em `cobrancas/{id}`.

### Campos novos em `cobrancas`

| Campo | Quem grava | Observação |
|---|---|---|
| `status: 'aguardando_confirmacao'` | Worker | 4º valor do enum: comprovante enviado, professor ainda não confirmou |
| `comprovantePath` | Worker | key do objeto no R2 |
| `comprovanteContentType` | Worker | usado pra servir o arquivo (revalidado contra a lista branca no GET) |
| `comprovanteEnviadoEm` | Worker | |
| `confirmadoPorUid` | **admin, pelo cliente** | tem que ser `request.auth.uid` |
| `confirmadoEm` | **admin, pelo cliente** | tem que ser `request.time` |

O `hasOnly` do `update` de admin em `firestore.rules` ganhou `confirmadoPorUid` e
`confirmadoEm`; o enum de `status` ganhou `'aguardando_confirmacao'` (só pra não quebrar a
comparação — quem escreve esse valor é o Worker). Os campos `comprovante*` ficaram **fora**
do `hasOnly` de propósito: nem o professor reescreve o rastro do upload. **Nenhuma regra
nova de update foi criada pro aluno** — aluno continua sem escrever em `cobrancas` pelo SDK,
em nenhuma origem. Testes: `tests/rules/admins-cobrancas-config.test.js`.

Ao confirmar, o painel faz **duas escritas**: `cobrancas/{id}` (status + confirmadoPorUid +
confirmadoEm + atualizadoEm) e depois `alunos/{alunoId}` (`mensalidadeStatus: 'pago'`), que
é o que libera o check-in. Se a segunda falhar, o professor é avisado explicitamente em vez
de ver "sucesso" com a mensalidade ainda pendente.

### Token na query string — só no `GET /comprovante/{id}`

O painel abre o comprovante numa aba nova (`window.open`), e uma navegação de aba não
permite mandar header `Authorization`. Em vez de inventar URL assinada, o GET aceita o ID
token do Firebase também em `?token=...`. **Escolha pragmática, com um risco conhecido:**
query strings aparecem em logs de acesso/proxy. Mitigações: o ID token vale ~1h (não é
segredo de longo prazo), ele é buscado no momento do clique, vale só pra *leitura* de
comprovante e ainda exige que o uid esteja em `admins/`. O `POST` de upload **não** aceita
token por query string — lá é header e ponto.

### Área do aluno (`checkin.html`)

O card de Pix agora consulta `status in ['pendente', 'aguardando_confirmacao']` (o índice
composto `alunoId + status + criadoEm` de `firestore.indexes.json` já atende). Com cobrança
manual pendente aparece o seletor de arquivo + "Enviar comprovante"; depois do envio o
formulário some e fica "Comprovante enviado — aguardando confirmação do professor".
Cobrança de origem `'asaas'` **não** mostra upload nenhum.

## Lembrete de mensalidade por e-mail (2026-09-04)

O botão "Lembrar no WhatsApp" só abre o app com o texto pronto — quem envia é o professor.
O lembrete por **e-mail** é a primeira coisa do sistema que dispara mensagem sozinha, então
ele nasceu opt-in e com trava de volume.

**Provedor: Resend.** Free tier suficiente pro piloto, API de uma chamada só
(`POST https://api.resend.com/emails`, `Authorization: Bearer`) — dá pra falar com ela por
`fetch` puro no Worker, sem SDK, igual ao cliente do Asaas. Código em `worker/src/email.js`.

**Credenciais**
- `RESEND_API_KEY` — **secret nova**, configurar com `npx wrangler secret put RESEND_API_KEY`
  (painel do Resend > API Keys). Não vai pro git.
- `EMAIL_REMETENTE` — var normal no `[vars]` do `wrangler.toml`, não é segredo. Começa como
  `"DojoPass <onboarding@resend.dev>"`, o remetente de **teste** do Resend: funciona sem
  domínio verificado, mas o Resend só entrega e-mails vindos dele pro endereço dono da
  conta. Enquanto não houver domínio verificado (Resend > Domains), o recurso serve pra
  testar o fluxo, não pra falar com os alunos.

Faltando qualquer um dos dois, **só** `POST /enviar-lembrete` responde 501
("Lembrete por e-mail ainda não configurado."). `/criar-cobranca`, `/webhook-asaas` e
`/comprovante` seguem funcionando — a checagem é local ao handler, não entrou na
`credenciaisFaltando()` genérica.

**`POST /enviar-lembrete`** — corpo `{ alunoId }`, um aluno por chamada. Exige ID token do
Firebase + uid em `admins/` (mesmo padrão de `/criar-cobranca`). O **endereço de destino
nunca vem do corpo da requisição**: é lido de `alunos/{id}.email` no Firestore, senão o
endpoint viraria relay de e-mail arbitrário assinado com o remetente da academia. Recusa
aluno com `mensalidadeStatus === 'pago'` (400). O corpo é **texto puro** (`text`, nunca
`html`) — como o template vem de `config/geral.lembreteTemplate`, escrito à mão pelo admin,
texto puro elimina a necessidade de sanitizar HTML.

**Rate limit diário:** contador em `config/lembretes/dias/{YYYY-MM-DD}` (campo `contagem`),
teto de **200 envios/dia** (constante `LEMBRETES_LIMITE_DIARIO` em `worker/src/index.js`);
estourou, responde 429. É subcoleção de um documento dentro de `config/`, ou seja, fora do
`match /config/{docId}` das rules — invisível pro cliente, escrita só pelo Worker. Sem
transação de propósito: é teto de proteção de custo/reputação, não contabilidade.

**Duplicação consciente:** `preencherTemplate()` existe em `app/firebase-init.js` (cliente) e
de novo em `worker/src/email.js` — o Worker não pode importar um módulo servido pelo GitHub
Pages. Se uma mudar, a outra tem que acompanhar, senão WhatsApp e e-mail passam a gerar
textos diferentes do mesmo template.

**No painel:** o botão "Enviar lembrete por e-mail" aparece ao lado do de WhatsApp, na linha
do aluno pendente, **só quando `config/geral.lembreteEmailAtivo === true`** (default
`false` — o do WhatsApp é default `true`, porque não envia nada sozinho). Aluno sem e-mail
plausível: botão desabilitado com o motivo. 501 e 429 têm mensagem própria.

## Credencial do Asaas cadastrada pelo professor (2026-09-04)

Antes, a chave de API do Asaas era só a secret `ASAAS_API_KEY` do Worker: quem trocava a
chave era quem tinha acesso ao Cloudflare (o dev), não o dono da academia. Agora o
professor cadastra a **própria** chave pelo `admin.html`, seção "Integração de pagamento".

**Onde a chave fica:** documento `config/credenciais` no Firestore, **cifrada**. Nunca em
texto plano, em lugar nenhum — nem no Firestore, nem em log, nem em resposta de endpoint.

**Decisão de criptografia:** AES-GCM 256 pela Web Crypto API nativa do runtime dos
Workers (`crypto.subtle`), sem lib externa — `worker/src/cripto.js`. IV aleatório de 12
bytes por gravação (reusar IV quebraria o GCM), guardado junto do ciphertext em base64. O
GCM é **autenticado**: chave errada ou ciphertext adulterado fazem a decifragem *falhar*,
não devolver lixo. A chave mestra é a secret única **`CREDENCIAL_CRYPTO_KEY`**, que vive
só na Cloudflare — o ciphertext vive só no Firebase, então vazar um dos dois isoladamente
não entrega nada.

**Três endpoints novos no Worker** (todos exigem Bearer token do Firebase + `admins/{uid}`,
mesmo padrão dos demais):

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/config/credencial-asaas` | Recebe `{ apiKey, ambiente }`. Valida tipo/tamanho (10..200 chars) e o enum `sandbox`/`producao`; **testa a chave de verdade** com um `GET {base}/myAccount` antes de gravar (pega chave com erro de digitação e ambiente trocado na hora → 400 "Chave inválida ou ambiente incorreto."). Só então cifra e grava. Responde `{ ok, ultimos4, ambiente }` — nunca a chave. |
| `GET` | `/config/credencial-asaas` | `{ configurada, ultimos4, ambiente, atualizadoEm }`. Só metadados: nem o cipher, nem a chave. |
| `DELETE` | `/config/credencial-asaas` | Apaga a credencial (sobrescreve os campos com `null`, em vez de deletar o documento — `firestore.js` não expõe DELETE e o efeito é o mesmo) e volta ao fallback. |

A base URL é **derivada do ambiente escolhido** (`sandbox` →
`https://sandbox.asaas.com/api/v3`, `producao` → `https://api.asaas.com/v3`), não de
`env.ASAAS_BASE_URL`: senão trocar de sandbox pra produção pelo painel exigiria um deploy
do Worker, e uma chave de produção validada contra a URL de sandbox falharia sem explicação.
Isso vale tanto pra validação quanto pras **cobranças de verdade** — `obterConfigAsaas()`
devolve `{ apiKey, baseUrl }` juntos e o `index.js` passa pro `asaas.js` um `env` com a
`ASAAS_BASE_URL` já ajustada. Chave e URL sempre andam em par; se não andassem, uma chave
de produção cadastrada pelo painel geraria cobranças contra o sandbox.

**Fallback (retrocompatibilidade):** `obterAsaasApiKey()` (`worker/src/credenciais.js`)
devolve a chave decifrada de `config/credenciais`; se o documento não existir ou não tiver
cipher, devolve `env.ASAAS_API_KEY` — o piloto atual continua funcionando sem migração
nenhuma. Cache de módulo com TTL de 5 min, invalidado explicitamente a cada gravação/
remoção. Se a *decifragem* falhar (secret trocada), o erro **sobe** em vez de cair no
fallback: cobrar pela conta Asaas do dev sem ninguém notar seria pior que falhar.
Sem chave nenhuma, `/criar-cobranca` e `/webhook-asaas` respondem **501** com mensagem
clara **antes** de tocar no Asaas. `ASAAS_API_KEY` saiu da lista de secrets obrigatórias
de `credenciaisFaltando()` justamente por isso.

**`worker/src/asaas.js` mudou de assinatura:** `criarCustomer`, `criarPagamentoPix`,
`obterQrCodePix` e `consultarPagamento` agora recebem `(env, apiKey, ...)`. O módulo não lê
mais `env.ASAAS_API_KEY` — quem resolve qual chave usar é `credenciais.js`.

**Firestore Rules:** `config/credenciais` é negado para **todo cliente, inclusive admin**,
em read *e* write, via `!ehDocCredenciais(docId)` dentro do `match /config/{docId}`. Não é
um bloco `match /config/credenciais { allow read, write: if false; }` de propósito: nas
rules os matches são **união permissiva**, e um `if false` num bloco não cancela um `allow`
concedido por outro que também casa com o caminho. Coberto por
`tests/rules/config-credenciais.test.js`.

**Passo manual que falta (você precisa rodar):**

```bash
openssl rand -base64 32          # gera a chave mestra (32 bytes em base64)
cd worker
npx wrangler secret put CREDENCIAL_CRYPTO_KEY   # cole o valor gerado quando pedir
npx wrangler deploy
```

Guarde o valor num gerenciador de senhas: perdê-lo significa recadastrar a chave do Asaas
pelo painel (nada mais quebra), e trocá-lo tem o mesmo efeito.

## Dados de teste

Um usuário de teste (`teste.config@example.com`) foi criado durante a
configuração do Firebase pra validar que auth + Firestore estavam
funcionando neste projeto novo. Pode ser ignorado ou apagado — não é dado
real, e este projeto Firebase é só um sandbox mesmo.

## Acesso do dev parceiro (concluído em 2026-08-25)

Fabrício (amigo/parceiro dev) recebeu acesso de desenvolvimento ao projeto:

| Sistema | Onde | Identificação | Nível | Status |
|---|---|---|---|---|
| GitHub | `DojoPassBR/AcademiaTeste` | `tansoooo` | Admin | Convite enviado (pendente de aceite dele) |
| Firebase | projeto `academiateste-56922` | `fabriciofontesvidal@gmail.com` | Editor | Adicionado |

Obs: ele também passou um e-mail `fabricio.fvidal@icloud.com` antes de confirmar que o
Google/Firebase é o Gmail acima — só o Gmail foi usado nos convites.
