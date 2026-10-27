# API Dute v1

Pedido: API oficial para integrações externas, inclusive os agentes existentes no
Grok Bot; Operação primeiro, preparada para homologação e produção. A autorização
do usuário inclui produção. Não depende do fornecedor do agente.

## Decisões

REST/JSON e OpenAPI, prefixo `/api/v1`. Reaproveitar a lógica transacional da
Operação dentro de sua codebase, evitando cópias e imports entre pacotes que não
existiriam no deploy. Gateway HTTP `duteApi`; URL inicial da Cloud Function de
cada ambiente, sem alterar DNS ou o app. Os outros módulos serão acrescentados
em versões seguintes; este incremento entrega a fundação e Operação.

Alternativas: chamadas Firebase diretas exigem identidade humana e expõem o
protocolo interno; MCP limita os clientes compatíveis. REST foi a opção proposta
e aceita na conversa. MCP poderá consumir esta API posteriormente.

Credencial Bearer por integração, aleatória e mostrada uma vez; só hash no banco.
Owner/admin autenticado pelo Firebase cria/revoga integrações, define clientes e
escopos. A permissão atual de quem delegou também é conferida em cada chamada.
Não há acesso administrativo ao banco para o consumidor. Leituras retornam
campos explícitos, sem preços, CPF, contatos ou documentos do RH.

Escritas preservam a regra do repositório: IA não executa impacto real sem
aprovação humana. Owner/admin aprova o método, caminho, conteúdo e chave exatos
com token Firebase revogável. Aprovação expira e não autoriza outra ação; o
agente recebe seu identificador. Recibo e eventos existentes conservam a
idempotência; a chave será isolada por integração. Auditoria registra o agente e
o aprovador. Credenciais, aprovação e auditoria ficam fechadas ao navegador.

## Escopo inicial

Consulta paginada por cliente de demandas e OS (incluindo agenda por período),
detalhe de OS; colaboradores e veículos com escopo específico para recursos
compartilhados. Criação de demanda direta, abertura/planejamento/agendamento de
OS. Validações existentes continuam decidindo saldo, estado e edição.

Limite de corpo, limite de chamadas persistido por integração, erros estáveis,
request ID, sem segredos em logs. Ambientes dute-homolog e dute-prod; dute-btg
recusa. Credenciais distintas por projeto. Gestão não emite credenciais por
deploy: é ação autenticada do responsável.

## Validação e publicação

Testes unitários e integração no emulador: autenticação, revogação, isolamento,
campos expostos, paginação, aprovação, repetição e erro de domínio. CI inclui os
novos testes. Publicação pelo fluxo existente, após homologação verde; verificar
OpenAPI, rejeição de acesso anônimo e versão. Não gravar dados operacionais reais
para testar a produção. Registrar qualquer impossibilidade de publicar.
