# Agent Dute com ADK

O botao `Get code` do Agent Studio exportou o Agent Dute como um agente ADK Python. Esse e o caminho correto para transformar o desenho do Studio em codigo versionado.

## Diagnostico do export inicial

O export original tinha:

- `root_agent` com instrucao correta.
- Dois agentes auxiliares como ferramentas: Google Search e URL Context.
- `sub_agents=[]`, ou seja, nenhum subagente operacional estava conectado no runtime.

## Ajuste feito no repositorio

Foi criada a pasta:

```text
agents/agent_dute
```

Ela contem:

- `agent.py`: runtime ADK do Agent Dute.
- `requirements.txt`: dependencias Python.
- `README.md`: como rodar localmente.

O `root_agent` agora possui subagentes para WMS, Estoque, Portal do Cliente, Solicitacoes, Faturamento, Conhecimento, Documentos, Torre de Controle, Acessos, Suporte Cloud e Reposicao Inteligente.

## Como isso conversa com Genkit/Firebase

O ADK deve ser a camada de raciocinio e orquestracao. O Genkit/Firebase continua sendo a camada operacional transacional:

```text
Usuario
  -> App Dute
  -> Cloud Function segura
  -> Agent Dute ADK
  -> ferramentas operacionais
  -> Firestore / Storage / Functions / Knowledge
```

As ferramentas do agente nao devem alterar dados diretamente sem passar por Cloud Functions auditaveis.

## Ferramentas que faltam conectar

- Consulta operacional: estoque, pedidos, tarefas WMS, faturamento e eventos.
- Busca de conhecimento: contrato, proposta e documentos anexados.
- Registro de evento: memoria operacional e auditoria.
- Criacao de solicitacao do cliente.
- Decisao assistida de solicitacao.
- Avanco de tarefa WMS.
- Registro de excecao operacional.

## Regra de seguranca

O Agent Dute pode recomendar e preparar acoes. Alteracoes criticas em estoque, WMS, faturamento, permissao e documentos exigem backend transacional, perfil autorizado e evento auditavel.
