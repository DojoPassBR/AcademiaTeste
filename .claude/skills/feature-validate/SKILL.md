---
name: feature-validate
description: Fase 3 (Validator) do fluxo de orquestração multi-agente do AcademiaTeste/DojoPass. Use depois de /feature-execute para revisar a implementação contra o plano, com Opus 5, e disparar auto-correção via /feature-execute em loop até 3 tentativas se houver problemas. Foco extra em segurança quando firestore.rules ou worker/ são tocados.
---

# /feature-validate — Validator (Opus 5) com auto-loop de correção

Você vai revisar a implementação feita contra o plano original, e orquestrar até 3 rodadas de correção automática se necessário.

## Passos

1. Leia `.feature-state.json`. Se não existir `plan` ou `implementationSummary`, diga ao usuário para rodar `/feature-plan` e `/feature-execute` primeiro e pare.
2. Leia [feature-orchestration-context.md](../../feature-orchestration-context.md).
3. Rode o loop abaixo, começando em `loop = (validationLoops atual em .feature-state.json) + 1`, até no máximo `loop = 3`:

   a. Invoque a ferramenta **Agent** com `model: "opus"`, `subagent_type: "general-purpose"`, `run_in_background: false`, com um prompt que:
      - Inclui o contexto do projeto e o `plan` completo.
      - Pede para o subagente **ler os arquivos reais** (`firestore.rules`, `app/*.html`, `app/firebase-init.js`, `worker/src/*.js` conforme relevante ao plano) e comparar com o plano — não confiar só no resumo textual do executor.
      - Pede verificação específica de:
        1. A implementação corresponde ao plano (arquivos/coleções/endpoints conforme planejado)?
        2. **Segurança em `firestore.rules`** (se tocado): nenhuma regra ficou mais permissiva do que deveria; campos sensíveis (`mensalidadeStatus`, `admins`) continuam protegidos contra escrita direta do cliente; validação de tipo/tamanho de dados de entrada continua presente; nenhuma lógica de negócio nova ficou só no cliente sem espelho nas rules.
        3. **Worker** (se tocado): nenhuma secret hardcoded no código; `credenciaisFaltando`/checagens de erro amigável mantidas; CORS e formato de resposta consistentes com o padrão existente.
        4. Consistência de dados duplicados (ex: coordenadas da escola) entre `firebase-init.js` e `firestore.rules`, se algum dos dois mudou.
        5. HTML/CSS: semântico, `alt` em imagens, responsivo, segue a paleta preto/vermelho/branco existente.
        6. Nenhum placeholder, TODO, `console.log` de debug ou código morto deixado para trás.
        7. Se o plano previa índice novo em `firestore.indexes.json`, ele foi adicionado?
      - Pede resposta **apenas** em JSON:

```json
{
  "approved": true,
  "issues": ["issue — arquivo:contexto — o que está errado, por que é um problema (especialmente se for de segurança), e como corrigir"],
  "summary": "avaliação breve (1-2 frases)"
}
```

   b. Faça o parse do JSON. Atualize `.feature-state.json`: `validationLoops = loop`, `lastIssues = validation.issues`.

   c. Se `approved == true`:
      - Marque `validated = true` em `.feature-state.json`.
      - Informe ao usuário "✅ Validação aprovada" com o resumo, e pare o loop.
      - Se o plano tocou `firestore.rules` ou `worker/`, lembre explicitamente que o deploy é manual e separado (`firebase deploy --only firestore:rules` / `npx wrangler deploy` dentro de `worker/`) — aprovar o código não publica nada.

   d. Se `approved == false` e `loop < 3`:
      - Mostre ao usuário os issues encontrados nesta rodada (destaque separadamente qualquer issue de segurança).
      - Invoque a skill `/feature-execute` (repita o passo de execução como descrito em [SKILL.md](../feature-execute/SKILL.md), escolhendo o modelo pelas mesmas regras dela) para corrigir, passando os `issues` como `lastIssues`.
      - Continue para a próxima iteração do loop.

   e. Se `approved == false` e `loop >= 3`:
      - Informe "❌ Máximo de 3 tentativas atingido — revisão manual necessária", liste os issues restantes (destacando issues de segurança em `firestore.rules`/`worker/` com prioridade), e pare.

4. Ao final (aprovado ou não), mostre um resumo claro do estado final.

## Notas

- Nunca marque `validated = true` sem rodar a validação de fato.
- Se qualquer issue envolver `firestore.rules` permitindo algo que não deveria, trate como bloqueante mesmo que o restante do plano esteja correto — não aprove parcialmente.
- Cada rodada de correção conta como 1 loop, mesmo que pequena.
