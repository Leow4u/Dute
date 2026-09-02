# Agent Dute ADK

Runtime code-first do Agent Dute exportado do Agent Studio e ajustado para a arquitetura Dute-BTG.

## O que existe aqui

- `agent.py`: agente raiz `Agent_Dute`, ferramentas auxiliares de Google Search/URL Context e subagentes operacionais.
- `requirements.txt`: dependencias Python para rodar o agente com ADK.
- `__init__.py`: exporta `root_agent` para o ADK.

## Subagentes

O `root_agent` agora declara subagentes reais em `sub_agents`:

- `Subagente_Torre_Controle`
- `Subagente_Solicitacoes`
- `Subagente_WMS_Fisico`
- `Subagente_Estoque_Custos`
- `Subagente_Faturamento`
- `Subagente_Conhecimento`
- `Subagente_Documentos`
- `Subagente_Portal_Cliente`
- `Subagente_Acessos`
- `Subagente_Suporte_Cloud`
- `Subagente_Reposicao_Inteligente`

## Como rodar localmente

```powershell
cd C:\DEV\Dute\agents\agent_dute
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
adk web
```

O projeto Google Cloud/Firebase oficial e `dute-btg`. O codigo mantem o modelo `gemini-3.5-flash` usando Vertex AI em `global`, conforme exportado pelo Agent Studio.

## Proximas conexoes

Este runtime ainda nao chama diretamente Firestore/Cloud Functions. As ferramentas operacionais devem ser adicionadas como Function Tools ou OpenAPI Tools apontando para funcoes seguras do backend, por exemplo:

- `getOperationalSnapshot`
- `searchKnowledge`
- `createCustomerRequest`
- `recordOperationalEvent`
- `generateDailyBriefing`
- `decideCustomerRequest`
- `advanceWarehouseTask`
- `recordWarehouseException`

Essas ferramentas devem sempre passar pelo backend autenticado; o frontend nao deve chamar o Agent Dute com segredos expostos.
