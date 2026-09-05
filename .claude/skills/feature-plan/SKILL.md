---
name: feature-plan
description: Fase 1 (Planner) do fluxo de orquestração multi-agente do AcademiaTeste/DojoPass. Use quando o usuário pedir para planejar uma nova feature ou mudança (app, Firestore rules, worker financeiro) antes de implementar (ex. "/feature-plan adicionar relatório mensal de faltas"). Gera um plano estruturado em JSON com Opus 5 e salva em .feature-state.json.
---

# /feature-plan — Planner (Opus 5)

Você vai atuar como arquiteto para gerar um plano estruturado, ANTES de qualquer implementação.

## Passos

1. Leia [feature-orchestration-context.md](../../feature-orchestration-context.md) e, se a feature envolver algo não óbvio do domínio (mensalidades, Pix, geolocalização, contas/deploy), também [CONTEXT.md](../../../CONTEXT.md) na raiz do repo.
2. Se a descrição da feature (args após `/feature-plan`) estiver vazia, pergunte ao usuário o que ele quer implementar antes de continuar.
3. Invoque a ferramenta **Agent** com `model: "opus"`, `subagent_type: "Plan"`, `run_in_background: false` (o próximo passo depende do resultado), com um prompt que:
   - Inclui o conteúdo do contexto do projeto (e do CONTEXT.md se relevante).
   - Inclui a descrição da feature/mudança pedida pelo usuário.
   - Pede EXPLICITAMENTE que a resposta final seja **apenas** um JSON válido (sem markdown, sem texto extra) no seguinte formato:

```json
{
  "title": "Nome curto da feature",
  "summary": "Resumo em 1-2 linhas",
  "surface": ["app-client | firestore-rules | worker | site-institucional — quais camadas são afetadas"],
  "firestore": {
    "collections": ["coleções novas ou afetadas, com forma dos documentos"],
    "rulesChanges": ["mudanças em firestore.rules, se houver"],
    "indexes": ["índices compostos novos necessários, se houver"]
  },
  "files": {
    "create": [{ "path": "...", "purpose": "..." }],
    "modify": [{ "path": "...", "reason": "..." }]
  },
  "worker": {
    "endpointsAffected": ["endpoints novos/modificados em worker/src, se houver"],
    "secretsNeeded": ["novas secrets necessárias, se houver"]
  },
  "security": {
    "risks": ["riscos específicos — ex: cliente conseguindo escrever campo sensível, bypass de auth"],
    "guards": ["validações/rules que mitigam cada risco"]
  },
  "accessibility": ["itens a garantir se houver UI nova"],
  "effort": "estimativa (ex: 1-2h)",
  "criticality": "green|yellow|red"
}
```
     - `criticality: "red"` sempre que tocar `firestore.rules` ou `worker/` (dados/pagamento reais).

4. Faça o parse do JSON retornado. Se não vier JSON válido, refaça a chamada até obter um JSON parseável.
5. Escreva/atualize `.feature-state.json` na raiz do repo com:

```json
{
  "description": "<descrição original do usuário>",
  "plan": <JSON do plano>,
  "implementationSummary": null,
  "validated": false,
  "validationLoops": 0,
  "lastIssues": [],
  "createdAt": "<timestamp ISO atual>"
}
```

6. Mostre ao usuário um resumo legível do plano (título, camadas afetadas, arquivos, riscos de segurança, criticidade, esforço) — não despeje o JSON bruto na conversa.
7. Sugira o próximo passo: rodar `/feature-execute` para implementar.

## Notas

- Não implemente nada nesta fase — só planeje.
- Se o plano tocar `firestore.rules` ou `worker/`, deixe isso bem destacado no resumo para o usuário — são as duas zonas críticas do projeto.
