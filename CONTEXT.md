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
  firebase-init.js                 → config do Firebase + helpers (distância até a escola, formatação de data)
  cadastro.html                    → cadastro do aluno (nome, telefone, nascimento, faixa, e-mail/senha)
  login.html                       → login; redireciona pra admin.html se o UID existir na coleção "admins", senão checkin.html
  checkin.html                     → tela do aluno: status do dia, botão de check-in (geolocalização), histórico
  admin.html                       → painel do professor: tabela de alunos, faixa, contagem de presenças, histórico por aluno
  app.css                          → estilos do app (preto/vermelho/branco, igual ao site)
firestore.rules                    → regras de segurança (ver abaixo)
firestore.indexes.json             → índice composto (alunoId + timestamp) pras queries de check-in
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

## Próxima tarefa: módulo de mensalidades

Decisões já tomadas na conversa anterior:

- **Abordagem escolhida:** controle manual (não é cobrança automática via
  gateway de pagamento tipo Mercado Pago/Stripe — isso ficou como possível
  fase 2, não decidido ainda).
- O **professor marca no painel admin** se a mensalidade de um aluno está
  paga ou pendente (por mês).
- Esse status deve ficar **visível pro próprio aluno** na tela de check-in
  (`checkin.html`), num box parecido com o "status de presença do dia" que já
  existe — algo como "Mensalidade de Julho: Pendente" ou "Em dia". O aluno só
  visualiza, não edita.
- Ainda não implementado — é o próximo passo a partir daqui.

## Dados de teste

Um usuário de teste (`teste.config@example.com`) foi criado durante a
configuração do Firebase pra validar que auth + Firestore estavam
funcionando neste projeto novo. Pode ser ignorado ou apagado — não é dado
real, e este projeto Firebase é só um sandbox mesmo.
