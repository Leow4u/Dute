# Alinhamento do Comercial e da Operação: o que foi combinado e o que foi feito

Escrito em 23/10/2026. Entre 21 e 23/10/2026 a `main` recebeu, além das partes
do Comercial feitas nas sessões do Leonardo, uma série de PRs de outro agente
(commits "Cursor Agent", branches `cursor/*`) sobre a navegação da plataforma,
a ligação do Comercial na produção e as três primeiras partes da Operação.
Este documento recupera o que estava alinhado antes disso, a partir dos
documentos aprovados e dos mockups, e compara com o que está no código hoje.
Nada aqui muda código: as divergências viram decisões do Leonardo (seção 6)
e, depois, PRs.

## 1. Onde o alinhamento está registrado

| Documento | Data | O que fixa |
|---|---|---|
| `docs/plataforma/plano.md` | 19/10, aprovado | A plataforma: um app, identidade v3, invariantes, memória da IA, módulos, fases 0 a 8, papéis e a especificação do módulo Operação (tipos de OS, dados, status, eventos, telas) |
| `docs/mockups/README.md` e `docs/mockups/*.dc.html` | 19/10 (14 telas v3) e 20/10 (8 telas `Com*`) | Identidade visual e as telas aprovadas de cada módulo |
| `docs/plataforma/fase-2-nucleo.md` | 20/10, aprovado | Papéis da plataforma, módulos contratados, tela de entrada, menu por papel e por perfil; decisões 1 a 6; registro das partes 1 e 2 |
| `docs/plataforma/fase-6-comercial.md` | 20/10, aprovado; registros até 21/10 | O pedido (12 pontos), as decisões, coleções, etapas, as 17 partes, as perguntas abertas 1 a 17 e o registro de cada parte |
| `docs/plataforma/comercial-producao.md` | 21/10 (parte 17); alterado no #157 | Ordem exata para ligar o Comercial no `dute-prod`, como desfazer, as decisões que esperam o Leonardo e as pendências da conferência |
| `docs/plataforma/comercial-cargas.md` | 21/10 | Roteiro das cargas: clientes da Omie, contratos e tabelas |
| `docs/plataforma/fase-3-operacao.md` | 22/10, escrito pelo outro agente; alterado no #176; correção no #177 (aberto) | O que ele implementou nas partes 1 a 3 da Operação. Não é um desenho aprovado antes do código, como são o da Fase 2 e o da Fase 6 |
| `CLAUDE.md` | contínuo | Regras de trabalho: um problema por PR com teste, telas novas na v3, operação sem valores, módulo novo em `functions/<modulo>`, liberação por ambiente com OK para a produção |

## 2. O que foi alinhado

### 2.1 Plataforma (plano, 19/10)

- Um sistema, um login, um app em `app.dutelog.com.br`; menu por papel e por
  perfil do cliente; TV em `/tv`, portal em `/portal`, campo em `/campo`.
- Identidade v3 para a plataforma inteira: menu lateral preto com seis
  módulos (Início, Operação, Clientes, Financeiro, Agent Dute, Administração),
  vermelho da marca só na ação principal da tela, Manrope, cores por status,
  Agent Dute em violeta, sem legendas. O WMS adota a v3 no lançamento da
  Operação; até lá segue `docs/sistema-visual.md`.
- Ordem das fases: 0 projetos, 1 migração, 2 núcleo e app único, 3 Operação,
  4 Financeiro da operação, portal e lançamento (da Operação e da v3 em
  produção), 5 memória da Dute, 6 Comercial, 7 Financeiro unificado, 8 RH.
  Em 20/10 o Comercial v1 foi adiantado para antes da Operação, com a base que
  os dois módulos dividem (cadastro, catálogo e tabelas, contratos, Demanda).
- Papéis: `owner` e `admin` tudo; `interno` operação e cadastros, sem preços;
  `wms` o WMS; `campo` só as OS em que está escalado, pelo celular;
  `comercial` orçamentos, clientes e preços de venda; `financeiro` precificar,
  faturar, receber; `rh`; `suporte` leitura e diagnóstico; `painel` a TV;
  `cliente` só o próprio `customer_code` e o que o perfil libera.
- Valores: só `owner`, `admin`, `financeiro` e `comercial`. Operação e campo
  nunca veem preço.
- IA native: todo módulo grava desde o primeiro dia o que a IA precisa
  (eventos, tempos e medidas). "Sem tempo real por item, não há o que
  aprender." A IA recomenda; uma pessoa decide.
- Pronto da Fase 2: um cliente só com armazenagem não vê nada de OS e um
  usuário interno vê WMS e Operação no mesmo menu.
- Pronto da Fase 3: os quatro tipos de OS percorrem todos os status, o
  motorista conclui pelo celular com assinatura e cada OS concluída grava o
  tempo real de cada item.
- Pronto da Fase 4: o ciclo concluída, faturada e paga funciona, o cliente vê
  estoque e OS no mesmo portal e a operação não lê preços (teste de regras).
  É a Fase 4 que lança a Operação e a v3 em produção.

### 2.2 Núcleo (Fase 2, 20/10)

Decisões do desenho:

1. As chaves dos módulos são as de `lib/dominio`; `wms` aparece como
   "Armazenagem".
2. O cliente contrata `wms`, `operacao` e `financeiro`; sem o campo vale
   `["wms","financeiro"]`.
3. O backend nega por padrão: papel novo e cliente sem `wms` são recusados
   pelas callables do WMS; cada módulo novo libera as suas, com teste.
4. Liberação por ambiente em `lib/liberacao.ts`: ligada no `dute-homolog`,
   desligada no `dute-prod` e no `dute-btg`. Ligar na produção é um PR com o
   OK do Leonardo.
5. A tela de entrada segue a v3, com tokens só dentro dela (`.v3`), sem tocar
   no visual do WMS.
6. **O menu agrupado por módulo fica para o shell v3.** A parte 3 entrega o
   filtro por papel e por perfil e a barreira de rota. "Assim não se faz um
   agrupamento no visual atual que o shell v3 jogaria fora."

Papel × módulo (`MODULOS_POR_PAPEL`): owner e admin todos; interno `wms` e
`operacao`; wms `wms`; campo `operacao`; comercial `comercial`; financeiro
`financeiro`; rh `rh`; suporte `wms` e `operacao`; painel nenhum; cliente os
contratados. Um módulo só aparece se tiver tela.

Entregue e registrado: parte 1 (papéis e módulos contratados, #110) e parte 2
(tela de entrada, #112), ambas em 20/10. A parte 3 (menu por papel e por
perfil: `AppModule.modulo`, filtro por `MODULOS_POR_PAPEL` e pelos módulos
contratados, barreira de rota por módulo contratado, portal assinando só as
coleções dos módulos contratados, logo levando a `/`) não tem registro de
entrega. No código de hoje o menu e o `RoleGate` filtram por papel e por
"ambiente" (o prefixo da rota, `lib/ambientes.ts`), não por módulo contratado
do cliente.

### 2.3 Comercial v1 (Fase 6, 20/10)

O pedido, em resumo: o Guilherme orça (`comercial`) e o Leonardo aprova
(`owner`); a LPU do Itaú é um caso de tabela por contrato, nunca regra feita
para ele; armazenagem não passa por orçamento; prospect entra no cadastro
desde o primeiro orçamento; o Comercial vem antes da Operação com a base que
os dois dividem; tabela por contrato com vigência e renovação anual; vale a
tabela vigente na data do orçamento; contratos vigentes no sistema (Itaú,
Safra, BTG) com aditivos; autorização de faturamento do Itaú com pedido e
aceite; tabela noturna escolhida pelo comercial; numeração nova gerada pelo
sistema, a antiga vira legado; o Comercial substitui a planilha de controle.

As decisões (Demanda como espinha, numeração 10001 com "RV01" e "OS
10045-01", revisões congeladas no envio, data-base da primeira RV, tabelas
imutáveis com vigência, contratos por `customer_code`, prospect por `stage`,
aprovação só do owner em um toque, envio congela a RV e abre a impressão,
autorização de faturamento genérica, medição mensal, dinheiro em centavos,
eventos sem valor nem contato, `canReadPrices()`, codebase
`functions/comercial`, liberação própria, sem sugestão de preço no v1) estão
na tabela "Decisões" de `fase-6-comercial.md` e valem como estão.

Partes: 1 a 16 mergeadas em 21/10 (#130 a #149), 17 conferência final e
roteiro de produção (#151), 18 lista de clientes do WMS com muitos prospects
(#152) e 19 ambiente local com emuladores (#154). As telas foram percorridas
de ponta a ponta nos emuladores em 21/10, sem erro. Tudo isso foi feito nas
sessões do Leonardo e segue o desenho.

Perguntas abertas de `fase-6-comercial.md` (número e situação):

| Nº | Pergunta | Situação |
|---|---|---|
| 1 | O admin também aprova? | Aberta; recomendação: só o owner no v1 |
| 2 | Quem manda o PDF ao cliente? | Aplicada a recomendação (os dois caminhos) na parte 12a; sem registro de que o Leonardo confirmou |
| 3 | RV de execução sem preço novo dispensa a aprovação? | Aplicada a recomendação (dispensa) nas partes 10 e 12b; sem confirmação registrada |
| 4 | Quem registra a autorização de faturamento? | Respondida: comercial e financeiro (parte 15a) |
| 5 | Contratos e Autorizações no Comercial ou no Financeiro? | Aplicada a recomendação (Comercial no v1) |
| 6 | A gerenciadora vira empresa no cadastro? | Aplicada a recomendação (é a empresa do contato) |
| 7 | Reabrir na mesma RV ou na seguinte? | Aberta; hoje abre a seguinte, com "Descartar RV" |
| 8 | A dispensa aceita linha alterada igual à da RV fechada? | Aberta; hoje não aceita |
| 9 | Prazo de perda do portal conta de que data? | Aberta; hoje conta do fim da execução |
| 10 | Como encerrar a demanda que perdeu o prazo de faturamento? | Aberta (Fase 7) |
| 11 | A aprovação da medição fecha a proposta sem fechamento? | Aberta; a tela mostra as pendentes, sem atalho |
| 12 | Frete esquecido de mês já enviado entra onde? | Aberta; hoje não aceita linha de outro mês |
| 13 | O ZIP dos pedidos fica no v1? | Aplicada: fora do v1 |
| 14 | O "Desfazer" da aprovação no celular volta? | Aberta; ficou de fora |
| 15 | Razão social e CNPJ no cabeçalho do PDF | **Aberta e trava o uso**: o papel (`components/comercial/orcamento-documento.tsx`) sai só com "Dutelog Soluções Logísticas", sem CNPJ |
| 16 | Como o Leonardo sabe que há orçamento para aprovar? | Aberta; pelo e-mail do Guilherme e pelo item do Início |
| 17 | Cancelar a autorização da medição aprovada reabre a medição? | Aberta; hoje não reabre |

O que o v1 não entrega (e continua não entregando): e-mail e PDF enviados
pelo sistema, aceite pelo portal, sugestão por IA, gerar OS (Fase 3), NF e
cobrança (Fases 4 e 7), licitações, tela de edição de tabelas, anexos no
Storage.

### 2.4 Operação (plano, 19/10, e a ligação com a demanda da Fase 6)

- Tipos de OS: transporte/frete, armazenagem/movimentação, serviço em campo e
  mudança/transporte dedicado, cada um com seus campos.
- `service_orders`: número, `type`, `status`, `customer_code`, solicitante,
  `origin` (`internal` ou `portal`), prioridade, datas (abertura, agendada,
  início, conclusão), responsável, motorista, veículo, equipe, `details` com
  os campos do tipo, observações internas, cancelamento. `items` da LPU sem
  preço, com quantidade e duração planejadas. `execution` com os tempos
  reais por etapa (saída, coleta, entrega) e, por item, quantidade e duração
  reais: "é a matéria-prima da memória". `attachments` (foto, comprovante,
  assinatura, documento, PDF). `private/pricing` só para quem vê valor.
- Núcleo novo: `collaborators` (nome, CPF, função, telefone, CNH com
  categoria e validade), `vehicles` (placa, tipo, modelo, capacidade kg e
  m³), catálogo da LPU, `ai_measures`, `ai_case_memory`, `ai_suggestions`.
- Status: aberta → agendada → em_execucao → concluida → faturada → paga;
  aberta → em_execucao sem agendamento; concluida → em_execucao para reabrir
  (owner e admin); cancelada de qualquer status exceto paga, com motivo.
- Eventos: `service_order.created`, `.scheduled`, `.team_assigned`,
  `.started`, `.item_executed`, `.completed`, `.priced`, `.invoiced`, `.paid`,
  `.cancelled`, `.reopened`; `attachment.uploaded`; `delivery.signed`;
  `portal.request_created`; `collaborator.cnh_expiring`;
  `vehicle.maintenance_due`; `notification.*`; `ai.suggestion_*`.
- Telas (mockups v3): Início "Precisa de você" com OS atrasadas, pedidos do
  portal, OS sem veículo ou motorista e sugestões do Agent Dute; TV em `/tv`;
  Operação com kanban do dia (Para agendar, Agendadas, Em execução,
  Concluídas), Semana e Todas em lista, filtros em chips e busca; nova OS em
  etapas (tipo, dados gerais, dados do tipo, revisão) sem valores; OS em três
  passos (Agendar, Executar, Concluir) com trajeto, carga, equipe, fotos e
  histórico; duplicar, cancelar, imprimir a via operacional; Campo (PWA) com
  OS do dia, execução, fotos, recebedor e assinatura; Financeiro, Relatórios,
  Clientes, Portal com as OS, notificações e Agent Dute.
- Numeração: em 20/10 a Fase 6 decidiu que a OS herda o número da demanda
  ("OS 10045-01"); o "OS 000123" do plano é anterior a essa decisão.
- Ligação: a Demanda em Para planejar é o que vira OS; "a Operação liga a OS
  à demanda depois". O `interno` passa a ler `lpu_items` e
  `customer_locations` na Fase 3; `quotes` e `price_tables` continuam fechados
  para a operação.

## 3. O que entrou na `main` de 21 a 23/10

| PR | Autor | O que | Relação com o alinhado |
|---|---|---|---|
| #125, #130 a #152, #154 | sessões do Leonardo | Desenho da Fase 6 e as partes 1 a 19 do Comercial | Conforme o desenho (seção 2.3) |
| #126 a #129 | Cursor Agent | Preço sai de `products`, `skus`, `stock_balances` e `client_inventory` para `catalog_prices` (callable `splitCatalogPrices`); fatura por cliente na própria competência; valor da competência fechada congelado; título da aba | Atende a invariante "operação não vê preço". `splitCatalogPrices` precisa rodar depois da publicação, sem roteiro nem cursor (pendência da parte 17) |
| #153 | Cursor Agent | `/comercial` ganha shell próprio (`comercial-shell.tsx`), o Comercial sai do menu do WMS, atalho "Módulos" volta aos cards | Resolve um erro real (o card abria o Comercial dentro do layout do WMS), mas no visual atual e com um shell por módulo (ver 4.1) |
| #157 | Cursor Agent | `dute-prod` entra em `COMERCIAL_AMBIENTES_LIBERADOS` (app e Functions) e em `AMBIENTES_LIBERADOS` | OK do Leonardo em 21/10. Liga também a plataforma inteira na produção (ver 4.6) |
| #159 | Cursor Agent | Operação parte 1: codebase `functions/operacao`, `saveCollaborator` e `saveVehicle`, telas `/operacao/colaboradores` e `/operacao/veiculos`, CI, zeragem | Cadastro conforme o plano; telas no visual do WMS (ver 4.2) |
| #160, #165, #166 | Cursor Agent | Menu da conta sem legenda, com "Módulos" no hover; o shell da Operação deixa de importar `modulos-link` (o typecheck da `main` quebrou entre os merges); menu no celular | Ver 4.1 |
| #161 | Cursor Agent | Operação parte 2: `saveServiceOrder` abre a OS `10045-01` da demanda em Para planejar e cancela; regras; eventos `os.*` | Ver 4.4 |
| #162 | Cursor Agent | Operação parte 3: tela Hoje (`/operacao`) com Para abrir, Para agendar, Agendadas hoje e Outros dias; agendar com equipe e veículo | Ver 4.3 |
| #168 | Cursor Agent | Mockups de cinco ajustes de UX do WMS | Fechado sem merge |
| #150, #167, #169 a #172 | Cursor Agent | Ajustes de UX e correções do WMS (guarda, abertura, aviso de envio, pedido do portal) | Fora deste alinhamento |
| #173 a #175 | sessões do Leonardo | Portal, Gemini, fila da homologação | Fora deste alinhamento |
| #176 | sessão do Leonardo | `dute-prod` entra em `OPERACAO_AMBIENTES_LIBERADOS` | OK do Leonardo em 22/10; adianta o lançamento previsto na Fase 4 (ver 4.6) |
| #177 (aberto) | sessão do Leonardo | Só documentação: desligar a Operação não apaga o que foi gravado | Correto; falta mergear |

## 4. Onde o código se afasta do alinhado

Cada item traz o que estava combinado, o que está no código, o efeito e o
caminho de volta. A ordem é a da importância para o uso.

### 4.1 Navegação: um shell v3 x um shell por módulo

- **Alinhado.** Um shell só para a plataforma, na v3: menu lateral preto com
  os módulos que o papel abre (no `ComFila.dc.html` o Guilherme vê Início,
  Comercial, Clientes e Agent Dute; no `Operacao.dc.html` o Leonardo vê os
  seis). A Fase 2 decidiu (decisão 6) que o agrupamento por módulo fica para
  esse shell v3 e que não se faz um agrupamento no visual atual, e que a
  parte 3 entrega o filtro por papel e por perfil e a barreira de rota.
- **No código.** Três shells no visual do WMS, escolhidos pelo prefixo da
  rota (`lib/ambientes.ts`): o do WMS (`app-layout.tsx`), o do Comercial
  (`comercial-shell.tsx`, #153) e o da Operação (`operacao-shell.tsx`, #159).
  Cada um lista só as telas do próprio módulo; a troca de módulo fica no
  menu da conta, no item "Módulos" (hover no computador, lista no celular:
  #160, #165, #166). O Faturamento continua dentro do shell do WMS. A parte 3
  da Fase 2 não foi feita.
- **Efeito.** Quem tem mais de um módulo sai de um menu para entrar em outro,
  e o Início "Precisa de você" de um módulo não aparece nos outros. É o
  agrupamento no visual atual que a decisão 6 quis evitar; o shell v3 vai
  substituir os três.
- **Caminho.** Decidir entre (a) tratar os shells por módulo como ponte até o
  shell v3, e então fazer a parte 3 da Fase 2 e o shell v3 como desenhados,
  com as três áreas (WMS, Comercial, Operação) como itens de um menu só; ou
  (b) manter um shell por módulo e registrar a decisão em
  `fase-2-nucleo.md`, revendo a decisão 6 e os mockups. A recomendação é (a):
  é o que o plano e as 22 telas aprovadas mostram.

### 4.2 Telas da Operação no visual do WMS

- **Alinhado.** "Telas novas seguem a v3" (`CLAUDE.md` e
  `docs/mockups/README.md`). As telas do Comercial cumprem: todas as views
  (`pages/comercial/*-view.tsx`) e os diálogos abrem com `className="v3"`.
- **No código.** As três telas da Operação (`pages/operacao/cadastro-view.tsx`,
  `fila-view.tsx`, `pagina.tsx`) usam "o visual do app", como o #159 diz, sem
  `.v3`.
- **Efeito.** Dentro do mesmo app o Comercial está na v3 e a Operação, módulo
  novo, no visual antigo do WMS.
- **Caminho.** Envolver as três telas em `.v3` como o Comercial faz, com o
  teste de render que o Comercial já tem como modelo. É pequeno e cabe num PR.

### 4.3 Fila do dia x `Operacao.dc.html`

- **Alinhado.** Kanban do dia com Para agendar, Agendadas hoje, Em execução e
  Concluídas hoje; abas Hoje, Semana, Todas e TV; filtros de tipo, motorista e
  cliente; ação principal "Nova OS"; cartão com hora, número, cliente, tipo e
  descrição, motorista e placa, atrasos em destaque, "Sem equipe" e "Sem
  veículo" como alertas; os pedidos do portal entram em Para agendar.
- **No código.** Tela "Hoje" com um bloco "Para abrir" (demandas do Comercial
  em Para planejar) e três colunas: Para agendar (OS aberta), Agendadas hoje e
  Outros dias. Sem Em execução e Concluídas (as transições não existem), sem
  abas, filtros ou busca, sem "Nova OS". O cartão mostra número, cliente, o
  primeiro item com a quantidade e a escala (data, hora, equipe e placa). A
  OS só nasce de uma demanda do Comercial.
- **Efeito.** Para a parte que existe (abrir e agendar) a tela funciona, mas
  a forma não é a do mockup e dois conceitos não estão nele: "Para abrir" e
  "Outros dias" (o mockup resolve "outros dias" com a aba Semana e Todas).
  Não há como abrir uma OS interna sem orçamento (um serviço avulso, um pedido
  do portal), que o plano prevê com `origin` interno ou portal.
- **Caminho.** Tomar o mockup como alvo das próximas partes: as colunas Em
  execução e Concluídas entram com executar e concluir; "Para abrir" pode
  continuar como a ponte com o Comercial se o Leonardo quiser (não está no
  mockup; registrar), ou virar o item "Demandas para planejar" do Início
  "Precisa de você"; "Outros dias" vira as abas Semana e Todas; "Nova OS" em
  etapas entra com os tipos de OS (4.4).

### 4.4 Modelo da OS x plano

- **Alinhado.** Os campos e o fluxo da seção 2.4.
- **No código** (`functions/operacao/src/domain/os.ts`). A OS tem número,
  demanda, `seq`, `customer_code`, `status` (só `aberta`, `agendada` e
  `cancelada`), `escopo_rv`, `itens` sem preço (id, `lpu_item_id`, código,
  item, descrição, serviço, unidade, quantidade, local de origem e destino),
  `origem_local_id`, `destino_local_id`, `edicao`, `cancelamento.motivo` e
  `agenda` (data, hora, `equipe` como lista de colaboradores, `veiculo_id`).
  Não existem: `type` (os quatro tipos), `origin`, solicitante, prioridade,
  responsável, motorista separado da equipe, `details` por tipo, observações
  internas, duração planejada por item, `execution`, `attachments`,
  `private/pricing`, nem os status `em_execucao`, `concluida`, `faturada`,
  `paga` e a reabertura. Os eventos são `os.created`, `os.scheduled` e
  `os.cancelled` em vez de `service_order.*`.
- **Efeito.** O que existe é coerente com o que o outro agente escreveu em
  `fase-3-operacao.md` ("executar e concluir ficam para a próxima parte"),
  mas ninguém reconciliou isso com o plano: o modelo nasceu só da demanda do
  Comercial, sem tipo, origem e campos por tipo. O nome `os.*` tem motivo
  técnico bom (o roteador de avisos do WMS em `functions/wms/src/index.ts`
  trata "order" como aviso ao cliente) e deve ficar, mas o plano ainda lista
  `service_order.*`.
- **Caminho.** Antes da parte 4, escrever o desenho da Fase 3 no padrão da
  Fase 6 (pedido, decisões, coleções, partes, perguntas abertas, registro),
  reconciliando com o plano: tipos e `details`, `origin` interno e portal,
  "Nova OS" sem demanda, `execution` com tempos, anexos, os status que
  faltam, e a lista de eventos com os nomes `os.*`. A `fase-3-operacao.md`
  de hoje vira o registro das partes 1 a 3 desse desenho.

### 4.5 Captura para a IA

- **Alinhado.** "A captura começa no primeiro dia de cada módulo. Sem tempo
  real por item, não há o que aprender." O critério de pronto da Fase 3 é
  cada OS concluída gravar o tempo real de cada item.
- **No código.** A OS não registra nenhum tempo ainda (não há início nem
  conclusão). Os eventos existem e são auditáveis (invariante 2).
- **Efeito.** Nenhum, enquanto executar e concluir não existirem. Vira
  problema se a produção começar a operar OS antes de a execução gravar os
  tempos: a memória da Dute nasce vazia para esse período.
- **Caminho.** Entra no desenho da Fase 3 (4.4): `execution` por etapa e por
  item na mesma parte em que executar e concluir forem feitos, nunca depois.

### 4.6 Produção adiantada e a plataforma ligada para todos

- **Alinhado.** Plano: a Operação e a v3 chegam à produção na Fase 4, depois
  de a Fase 3 estar pronta (todos os status, campo com assinatura, tempos).
  Fase 2, decisão 4: a liberação fica desligada na produção até um PR com OK.
  `comercial-producao.md`, seção 6: para dar o papel `comercial` ao
  Guilherme, a recomendação era um roteiro controlado, e não ligar a
  plataforma inteira, "para não mudar a entrada de todos no mesmo dia".
- **No código.** O #157 (OK do Leonardo em 21/10) pôs `dute-prod` nas duas
  listas do Comercial e também em `AMBIENTES_LIBERADOS`, a liberação geral da
  plataforma: a tela de entrada por cards, os papéis novos no convite, o campo
  "Módulos contratados" em Configurações › Clientes e o link do logo para `/`
  passaram a valer na produção para todo mundo. O #176 (OK em 22/10) pôs
  `dute-prod` nas listas da Operação: cadastro de colaboradores e veículos
  (CPF e CNH reais) e a fila do dia atendem na produção, sem executar e
  concluir, sem o papel campo e sem a v3.
- **Efeito.** Na produção, owner e admin entram pelos cards (Armazenagem,
  Comercial, Operação, Financeiro) e quem tem papel `interno` deixou de cair
  em `/dashboard` e passou a ver dois cards (Armazenagem e Operação). O que a
  Operação gravar fica no banco mesmo que a liberação seja desligada (é o
  que o #177 registra). Nada disso é errado em si: foi autorizado. Mas
  afasta-se da ordem do plano e da recomendação da parte 17, e nenhum dos
  dois documentos registra o motivo.
- **Caminho.** Confirmar que é isso mesmo que o Leonardo quer; se não for,
  desligar é um PR que tira `dute-prod` das listas da Operação (as callables
  recusam e as telas somem; o gravado fica). Registrar a decisão e o motivo
  no plano (Fase 4) e em `fase-3-operacao.md`.

### 4.7 Roteiro de produção do Comercial: passos sem registro

A seção 4 de `comercial-producao.md` tem 11 passos. O que o repositório
mostra:

| Passo | Situação |
|---|---|
| 1. Corrigir a leitura de clientes do WMS | Feito (#152, 21/10) |
| 2. Backup e PITR; export gerenciado antes da primeira carga | Ligados em 20/10; o teste de restauração continua pendente |
| 3. Publicação manual da `main` no `dute-prod` | É um disparo no Actions; não consta no repositório. A confirmar |
| 4. Conferências depois da publicação e `splitCatalogPrices` até `done` | A confirmar; sem roteiro nem cursor (pendência da parte 17) |
| 5. Conferência da BTG | A confirmar |
| 6. PR que liga a liberação | Feito (#157), com a plataforma inteira (4.6) |
| 7. Cargas (clientes da Omie, contratos, tabelas, aditivos) | **Não podem ter rodado pelo código**: `functions/comercial/src/cargas/projeto.ts` recusa `dute-prod` e `dute-btg`. Se nada foi feito por fora, o Comercial em produção está ligado e vazio |
| 8. Contador `demand_counters/geral` | Sem ferramenta; a confirmar. Sem o documento a primeira demanda é a 10001 |
| 9. Papel `comercial` para o Guilherme | A confirmar; o convite já oferece o papel porque a plataforma está ligada |
| 10. Orçamentos em andamento e histórico como legado | Sem código |
| 11. Uma semana em paralelo com o Excel | Depende dos anteriores |

As decisões da seção 6 do mesmo documento (publicar com #126 a #129, ponto de
partida do contador, CNPJ do PDF, forma de dar o papel ao Guilherme, trava da
carga, formato do legado, teste de restauração) não têm resposta registrada,
exceto a da forma de dar o papel, que o #157 decidiu ligando a plataforma.

### 4.8 Documentação e contrato de trabalho

- `fase-3-operacao.md` foi escrito pelo implementador, no PR da parte 1, e
  mudou a cada parte. Não tem as seções de pedido, decisões com motivo,
  perguntas abertas e registro por parte que a Fase 2 e a Fase 6 têm, e não
  cita o plano. É o único documento de fase nessa situação.
- `CLAUDE.md`: a seção "Pastas" não lista `functions/operacao` (codebase
  `operacao`, `requireOperacaoCaller`, recibo em `operacao_operations`), a
  seção "Comandos" não tem `npm --prefix functions/operacao run test:unit` e
  `test:integration`, e a lista do CI em "Como trabalhamos" não tem
  `operacao-unit` e `operacao-integration`, que o `ci.yml` já exige. A frase
  sobre a Fase 2 ("parte 2, tela de entrada por módulo, em PR") está
  desatualizada: o #112 foi mergeado em 20/10.
- `plano.md`: a lista de eventos da Operação (`service_order.*`) e a
  numeração ("OS 000123") precisam das decisões posteriores (`os.*`,
  "10045-01"); a Fase 4 precisa registrar que a Operação já está na produção
  em parte.
- `comercial-producao.md`, seção 1, diz "Partes 1 a 16 mergeadas"; faltam as
  partes 17 a 19 e o estado dos passos (4.7).

### 4.9 Regras e papéis: pontos menores

- O que bate com o alinhado: `interno` lê `demands`, `lpu_items` e
  `customer_locations` (previsto na Fase 6 para a Fase 3) e não lê `quotes`
  nem `price_tables`; `suporte` lê a OS e não lê o cadastro (o documento tem
  CPF); `campo` ainda não lê nada; o navegador não grava nada da Operação; a
  zeragem preserva as coleções novas; os eventos saem sem nome, CPF, placa ou
  valor.
- Pendente: a regra de `service_orders` com `customerHasModule('operacao')`
  para o cliente, que a Fase 2 adiou "para a Fase 3, com a coleção". A
  coleção existe e a regra não tem o ramo do cliente. Só importa quando a OS
  chegar ao portal (Fase 4), mas o desenho da Fase 3 deve prever.
- A tela Hoje lê a coleção `demands` inteira no navegador e filtra a etapa na
  memória. Funciona com o volume de hoje; com a carga da Omie e um ano de
  demandas, vira consulta com índice.

### 4.10 Processo

- "Um problema por PR, com teste que falha antes e passa depois": os PRs do
  outro agente trazem testes, mas a mudança de navegação ficou espalhada em
  quatro PRs (#153, #160, #165, #166), e o typecheck da `main` quebrou quando
  a Operação (#159 a #162) entrou depois do #160, até a correção no #165. A
  fila da homologação
  publica em ordem de push desde o #175, o que reduz esse risco.
- Os PRs #126 a #128 mexem em trilhas de dinheiro do WMS (preço, fatura por
  cliente, competência congelada). A parte 17 avisou que iriam juntos na
  publicação e que `splitCatalogPrices` precisa rodar depois; não há registro
  de que rodou.

## 5. Caminho recomendado, em ordem

1. O Leonardo responde as decisões da seção 6. Sem a 1 e a 2 não vale abrir
   PR de tela.
2. Fechar o uso do Comercial na produção: CNPJ e razão social do PDF
   (pergunta 15), contador, cargas com dry-run e export antes, papel do
   Guilherme, e registrar em `comercial-producao.md` o que foi feito de cada
   passo. É o que faz o módulo ligado ter dado.
3. Escrever o desenho da Fase 3 no padrão da Fase 6, reconciliado com o
   plano (4.4 e 4.5), antes de qualquer parte nova da Operação. A
   `fase-3-operacao.md` de hoje vira o registro das partes 1 a 3.
4. Telas da Operação em `.v3` (4.2): um PR pequeno, enquanto são três telas.
5. Navegação (4.1): se a decisão for o shell v3 único, fazer a parte 3 da
   Fase 2 como desenhada e o shell v3 em seguida, aposentando os shells por
   módulo; se for manter, registrar.
6. Atualizar `CLAUDE.md` e `plano.md` com o que a seção 4.8 lista.

## 6. Decisões que só o Leonardo toma

1. **Navegação:** shell v3 único com menu por papel (como alinhado) ou um
   shell por módulo com "Módulos" no menu da conta (como está)?
2. **Operação na produção:** manter ligada como está (cadastro e fila, sem
   executar e concluir, no visual antigo) ou desligar até a Fase 3 fechar?
3. **Plataforma ligada para todos na produção** (tela de cards para owner,
   admin e interno): fica, ou volta ao roteiro controlado da parte 17?
4. **"Para abrir" na fila do dia:** fica como ponte com o Comercial (e entra
   no mockup) ou vai para o Início "Precisa de você"?
5. **Roteiro de produção do Comercial:** quais dos passos 3, 4, 5, 8 e 9 da
   seção 4.7 já foram feitos fora do repositório?
6. As **perguntas abertas** 1, 7, 8, 9, 11, 12, 14, 16 e 17 do Comercial e,
   antes de qualquer orçamento sair, a **15** (CNPJ e razão social).
7. **Eventos da OS:** confirmar os nomes `os.*` (motivo técnico) e atualizar
   o plano.
