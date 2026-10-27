# API externa de todos os módulos — proposta para aprovação

## Pedido e resultado esperado

Leonardo pediu uma API para todos os módulos e confirmou que o desenvolvedor
externo precisa consultar dados, criar e alterar registros. A proposta mantém
REST/JSON, OpenAPI e uma chave por integração, administrada por owner/admin em
Configuração → Integrações. Não basta acrescentar opções na tela: cada opção
deve corresponder a endpoints implementados, documentados e testados.

O escopo e a política de gravação foram autorizados por Leonardo no chat; a
coordenação determinou continuar a implementação na mesma tarefa. Novos PRs
são draft; não há autorização nesta etapa para merge, deploy ou mudanças reais
de IAM/credenciais.

## Abordagens

1. **Recomendada: uma API externa, adaptadores por módulo.** Mantém o endereço
   `duteApi/api/v1` e a mesma credencial. Cada módulo executa suas regras dentro
   da própria codebase, sem copiar regras nem importar arquivos de outra pasta
   de deploy. A complexidade de comunicação entre serviços fica no servidor.
2. **APIs externas independentes.** Simplifica cada serviço, mas obriga o
   consumidor a conhecer vários endereços e dificulta manter contratos,
   autenticação e auditoria consistentes. Não é a recomendação para o pedido.

A arquitetura recomendada é uma proposta técnica, não uma escolha já feita por
Leonardo. O comportamento da API de Operação existente permanece compatível.

## Cobertura funcional

Os recursos usam listagem paginada, consulta individual e ações explícitas.
POST cria; PATCH altera cadastros e rascunhos quando o domínio permite.
Transições operacionais usam ações nomeadas, e não edição livre de status.

| Módulo / prefixo | Consultar | Criar e alterar |
|---|---|---|
| Armazenagem `/armazenagem` | Produtos/SKUs, estoque e saldos, posições, pedidos, recebimentos e movimentações | Cadastros do catálogo, pedidos e recebimentos; conferência, tarefas, entrega, devolução e ajustes pelos fluxos existentes |
| Comercial `/comercial` | Clientes, locais, contatos, contratos, tabelas de preço, orçamentos, revisões, demandas e medições | Cadastros, contratos/aditivos, rascunhos de orçamento e medições; transições permitidas pelo papel delegado |
| Operação `/operacao` | Preservar demandas, OS, agenda, equipe e veículos; completar consultas necessárias aos fluxos | Preservar demanda/planejamento/agendamento; completar cadastros operacionais, execução e revisão pelas regras existentes |
| Financeiro `/financeiro` | A faturar, faturas, pagamentos, cobranças e notas fiscais | Registrar NF e pagamentos e atualizar cobranças pelos fluxos existentes; não editar saldos diretamente |
| RH `/rh` | Colaboradores, vínculos, registros, vencimentos e exportações; documentos com permissão específica | Criar e alterar vínculos e registros; anexar documentos pelos mecanismos de upload existentes |
| Agent Dute `/agente` | Contexto autorizado, conversa da integração, notas, playbooks e rotinas permitidas | Conversar, propor/criar/alterar notas e rotinas; executar somente ações explicitamente autorizadas |

Exclusão de dados, administração de usuários, alteração de papéis, configurações
de infraestrutura e poderes exclusivos do owner não são concedidos por
"criar e alterar registros". Cancelamentos e estornos, quando oferecidos,
continuam ações específicas com permissão própria e validações do domínio.

## Credencial e permissões na interface

- Uma credencial pode atender vários módulos; validade e revogação continuam as
  atuais. Chaves existentes conservam somente os escopos já concedidos.
- Agrupar os acessos por módulo na tela aprovada, sem redesenhar o fluxo.
  Leitura, cadastro/gravação e ações de negócio são permissões distintas.
- Operação não recebe valores por ganhar acesso a outros módulos: valores
  saem apenas nos endpoints e escopos financeiros/comerciais autorizados.
- RH tem acessos próprios para registros, dados pessoais e documentos.
  Equipe operacional não dá acesso implícito ao RH.
- Recursos vinculados a clientes respeitam a lista de clientes autorizados
  inclusive em detalhes, anexos, relatórios e vínculos entre registros.
- Recursos globais da empresa, como RH, equipe e veículos, são identificados
  como globais na seleção de permissões. Não fingir filtrá-los por cliente.
- O acesso do Agent Dute respeita módulos e clientes da chave; sua conversa
  pertence à integração e não permite ler conversas privadas de outras pessoas.

## Gravações e regras atuais

**Decisão explícita de Leonardo:** "A chave autoriza criar e alterar dentro
das permissões selecionadas". Para as novas integrações desse modo, escopo
válido, chave ativa e autorização atual do responsável bastam para executar;
não será exigido aprovar cada chamada.

Essa decisão substitui, no contexto dessas chaves, a exigência atual do
contrato de aprovar todas as escritas. Não alterar silenciosamente credenciais
já emitidas: documento sem política explícita continua exigindo aprovação.
Novas integrações criadas pelo fluxo ampliado usam `write_policy: scoped`,
explicitado no formulário. A API aceita também `approval_required` e preserva
esse padrão quando o campo é omitido por um consumidor legado.

Permissão de escrita não implica exclusão nem poderes administrativos. Cada
endpoint exige seu escopo exato e os clientes/recursos autorizados. As regras
do Agent Dute interno não são ampliadas por este contrato de integração externa.

O gateway registra `api:<id>` como ator, o responsável pela autorização da
chave, a política usada e qual ação foi executada. Quando uma chave legada
exige aprovação, registra também o aprovador e a aprovação exata.
O adaptador de cada módulo confere a permissão mínima e reutiliza as funções
de domínio, transações, recibos, eventos e controle de edição existentes.
Uma chave ou aprovação não transforma a integração em owner/admin nem permite ações
que o domínio reserva a uma pessoa com poder específico.

**RH:** o pedido inclui explicitamente criar e alterar registros do RH pela
chave. Owner/admin poderá conceder esse escopo de integração; o adaptador usa
o papel técnico mínimo `rh` apenas para as ações autorizadas e preserva o ator
`api:<id>`. Isso não muda o acesso direto das pessoas: owner/admin continuam
com as permissões atuais da interface do RH. O plano deve documentar e testar
essa autorização da integração, inclusive seu corte quando o responsável perde
acesso ou a chave é revogada.

Não haverá PATCH genérico em coleções: estoque muda pelo ledger; pagamento
e fatura mudam pelo Financeiro; documentos do RH usam o banco `dute-rh` e
uploads/aberturas autorizados; revisões de orçamento mantêm seu histórico.

Emissão de NFS-e pela Omie continua sujeita à liberação própria de ambiente,
serviços cadastrados e credenciais existentes. A ampliação da API não a liga
automaticamente na produção.

## Arquitetura e contrato para o desenvolvedor

- O gateway público existente autentica e roteia somente endpoints cadastrados.
  Sem URLs de destino, nomes de coleção ou nomes arbitrários de callable na
  entrada do consumidor.
- A liberação é conferida pelo módulo de destino. A inicialização atual não
  pode exigir Operação liberada antes de rotear uma chamada de RH ou Financeiro.
  Escopos exclusivamente globais funcionam sem cliente fictício.
- Adaptadores ficam junto ao domínio de cada codebase. Comunicação interna
  autenticada; não criar uma segunda entrada pública que ignore a chave.
- Reutilizar o contrato de identidade, escopos, aprovações e erros sem imports
  de código-fonte entre pastas de deploy. Empacotamento deve ser verificável
  no build limpo e no artefato enviado ao Firebase.
- Aprovações legadas são compatíveis com as rotas existentes; se oferecidas
  também nos novos módulos, identificar alvos globais por módulo/recurso/id
  e aceitar os métodos de alteração documentados, sem cliente fictício.
- RH e Agent Dute usam papéis mínimos próprios; não reutilizar o papel
  `interno` hoje empregado apenas pela API de Operação para todos os módulos.
  O contexto da integração é validado no servidor antes de chamar o domínio.
- Conversa e execução do Agent Dute precisam de prazo compatível com suas
  funções atuais (até 180 segundos), sem gravar segredos nem retransmitir
  a geração automaticamente se a conexão do consumidor cair.
- Listagens limitadas e paginadas, projeções explícitas e filtros documentados.
  Consultas de domínio devem ter os índices necessários também na nuvem.
- Escritas com idempotência por integração; conteúdo diferente com a mesma
  chave conflita. Repetição não duplica estoque, cobrança, pagamento ou evento.
- OpenAPI inclui recursos, campos de entrada/saída, escopos, exemplos,
  paginação, edição, aprovação, idempotência e erros de cada endpoint.
- Manter clientes atuais da Operação funcionando com as mesmas rotas.

## Validação e entrega

1. Matriz endpoint × escopo × papel × cliente/recurso × política de escrita
   para todos os módulos, incluindo as chaves legadas com aprovação obrigatória.
2. Testes de isolamento entre clientes, escopos e módulos; acesso negado para
   chave revogada/expirada ou responsável sem acesso; ausência de segredos nos
   logs e nas listagens de credenciais.
3. Integração no emulador com as funções de domínio reais: criar → consultar →
   alterar, repetição idempotente e conflito de edição em cada recurso mutável.
4. Rodar obrigatoriamente as trilhas de estoque/dinheiro do WMS e do Financeiro
   e a separação do banco do RH. Verificar o controle de aprovações do agente.
5. Testar o contrato OpenAPI, o artefato de deploy e a tela de permissões.
6. Implementar por partes revisáveis, mantendo a autorização do pedido completo:
   Comercial, Armazenagem, Financeiro, RH e Agent Dute, além de completar a
   Operação. Uma parte não deve ser anunciada como cobertura de todos os módulos.
7. PRs e CI verde; homologação antes de produção. Não criar dados ou chaves reais
   para testes. Publicação de produção segue o fluxo já existente.

## O que fica a cargo do plano de implementação

O plano deve fechar a lista exata de endpoints e seus schemas a partir das
funções de domínio existentes; a matriz de escopos; o empacotamento do contrato
compartilhado; a autenticação interna e as permissões de deploy; a ordem dos
PRs; os comandos e testes de cada parte. Essas decisões técnicas não podem
reduzir a cobertura funcional aprovada nem liberar gravações genéricas no banco.
