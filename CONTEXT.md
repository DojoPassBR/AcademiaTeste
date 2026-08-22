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
worker/                            → Cloudflare Worker do módulo financeiro (gera cobrança Pix + webhook do Mercado Pago) — ver seção própria abaixo
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
  com código gerado. Quando o Mercado Pago confirma o pagamento, o Worker (via webhook,
  usando credenciais de admin que passam por cima das Firestore Rules) atualiza
  `cobrancas/{id}.status` e `alunos/{id}.mensalidadeStatus`. Em qualquer modo, o professor
  sempre pode clicar "Marcar pendente" num aluno pago, pra corrigir manualmente.

- **`cobrancas/{id}`**: `alunoId`, `alunoNome`, `valor`, `mesReferencia`, `status`
  (`"pendente"` | `"pago"` | `"cancelado"`), `pixCopiaECola`, `pixQrCodeBase64`,
  `mpPaymentId`, `criadoEm`, `pagoEm`. Cliente só lê (a própria ou, se admin, todas) —
  nunca escreve; só o Worker escreve, via service account.

### O Worker (`worker/`)

Cloudflare Worker (serverless, fora do Firebase, plano gratuito) — evita precisar do plano
pago Blaze do Firebase só pra rodar o webhook do Mercado Pago. Expõe:
- `POST /criar-cobranca` — admin.html chama isso pra gerar uma cobrança Pix.
- `POST /webhook-mercadopago` — Mercado Pago chama isso quando o Pix é pago.

Migrado do `AcademiaPlus/worker/` (mesmo código, `wrangler.toml` repontado pro
`FIREBASE_PROJECT_ID = "academiateste-56922"`, nome do serviço trocado pra
`academiateste-financeiro`). **As secrets (`MP_ACCESS_TOKEN`, `FIREBASE_CLIENT_EMAIL`,
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

## Dados de teste

Um usuário de teste (`teste.config@example.com`) foi criado durante a
configuração do Firebase pra validar que auth + Firestore estavam
funcionando neste projeto novo. Pode ser ignorado ou apagado — não é dado
real, e este projeto Firebase é só um sandbox mesmo.
