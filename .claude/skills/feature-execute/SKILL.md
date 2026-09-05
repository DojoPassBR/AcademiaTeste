---
name: feature-execute
description: Fase 2 (Executor) do fluxo de orquestração multi-agente do AcademiaTeste/DojoPass. Use depois de /feature-plan para implementar o plano salvo em .feature-state.json, editando app/index.html/firestore.rules/worker diretamente. Roda com Sonnet 5 por padrão; usa Opus 5 automaticamente quando o plano toca firestore.rules ou worker/ (criticidade "red").
---

# /feature-execute — Executor (Sonnet 5 por padrão, Opus 5 em zonas críticas)

Você vai atuar como engenheiro que implementa o plano já aprovado, editando os arquivos reais do repositório.

## Passos

1. Leia `.feature-state.json` na raiz do repo. Se não existir ou não tiver `plan`, diga ao usuário para rodar `/feature-plan` primeiro e pare.
2. Leia [feature-orchestration-context.md](../../feature-orchestration-context.md).
3. Determine o modelo: `"sonnet"` por padrão; use `"opus"` se o usuário passou `--model opus`, OU se `plan.criticality == "red"`, OU se `plan.firestore.rulesChanges`/`plan.worker.endpointsAffected` não estiverem vazios (mudança em `firestore.rules` ou `worker/` sempre merece o modelo mais cuidadoso).
4. Invoque a ferramenta **Agent** com `model` (do passo 3), `subagent_type: "general-purpose"`, `run_in_background: false`, com um prompt que:
   - Inclui o contexto do projeto (e trechos relevantes do `CONTEXT.md` se a feature envolver Pix/mensalidade/geolocalização).
   - Inclui o `plan` completo (JSON) de `.feature-state.json`.
   - Se `lastIssues` não estiver vazio (correção pós-validação), inclui esses issues explicitamente e pede para corrigi-los junto com o resto.
   - Instrui explicitamente:
     - Editar os arquivos reais com Edit/Write (o subagente tem acesso) — não apenas descrever o código.
     - Se mexer em `firestore.rules`: manter a estrutura de funções helper existentes (`isSignedIn`, `isAdmin`, validações de dados), nunca afrouxar uma regra existente sem justificar no resumo final, e lembrar que rules não suportam `sqrt` (usar comparação de quadrados para distância, como já é feito).
     - Se mexer em `worker/`: seguir o padrão de `json()`/`CORS_HEADERS`/`credenciaisFaltando()` já existente em `worker/src/index.js`; nunca hardcodar secrets no código — sempre via `env`.
     - Se mexer em `app/firebase-init.js`: não duplicar config já existente; se precisar de nova constante compartilhada entre cliente e rules (como `SCHOOL_LAT`), deixar isso explícito no resumo, já que a duplicação é manual e conhecida.
     - Não usar frameworks, bundlers ou dependências externas fora do que já existe (`wrangler` no worker).
     - Não deixar placeholders, TODOs ou código incompleto.
     - Ao final, retornar um resumo em texto (não JSON) do que foi implementado: arquivos alterados e principais mudanças, destacando qualquer alteração em `firestore.rules` ou secrets novos necessários no worker.
5. Escreva de volta em `.feature-state.json`:
   - `implementationSummary`: o resumo retornado pelo subagente
   - mantenha `plan`, `validationLoops`, etc.
6. Mostre ao usuário o resumo do que foi implementado, destacando mudanças em zonas críticas.
7. Sugira rodar `/feature-validate`. Se `firestore.rules` mudou, lembre que o deploy das rules é manual (`firebase deploy --only firestore:rules`, conta `tatamepass@gmail.com`) e não acontece com `git push`.

## Notas

- Esta skill também é chamada automaticamente por `/feature-validate` durante o auto-loop de correção — quando isso acontecer, `lastIssues` em `.feature-state.json` já estará preenchido; use-o.
- Nunca configure ou solicite ao usuário para colar valores de secrets (`MP_ACCESS_TOKEN`, `FIREBASE_PRIVATE_KEY`) na conversa — se uma secret nova for necessária, apenas documente o nome dela; o usuário configura via `npx wrangler secret put`.
