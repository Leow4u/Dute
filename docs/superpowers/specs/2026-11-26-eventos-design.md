# Eventos: do portal ao histórico

Desenho do Eventos do portal refeito (aprovado pelo Leonardo em 26/11/2026): o evento do cliente como registro
completo de cada edição, aberto pelo cliente no portal, executado e
registrado pela Dutelog na Armazenagem, lido pelo cliente no ano seguinte.
Decisões do Leonardo de 24 a 26/11/2026 (abaixo). Prancha aprovada em
25/11/2026 "como está": `docs/mockups/Eventos*.dc.html` (canvas privado
"Eventos · do portal ao histórico", seção própria em
`docs/mockups/README.md`). Conferido por três construtores em 26/11/2026
(as respostas e as três decisões que a conferência pediu ao Leonardo estão
incorporadas). Registro definitivo, quando entrar, no CLAUDE.md
(bullet do WMS), em `docs/manual-portal.md` e em `docs/manual-armazenagem.md`.

## Intenção e porquê

Em 24/11/2026 a BTG tentou criar o primeiro evento no portal (B2B Conference
Necton, 28 e 29/01/2027, Hotel Unique) e o "Salvar como evento" do carrinho
recusou duas vezes, com a mensagem genérica "Dê um nome ao evento, informe o
local e escolha ao menos um item.": as observações passavam do limite de 300
caracteres do campo `schedule`. O pedido entrou, com o escopo inteiro do
evento na descrição; o evento, não.

O que existe hoje é um **modelo de pedido** (`client_event_templates`,
`docs/manual-portal.md`, "Eventos"): nome, local, data, quatro textos livres
(descrição, endereço, "Montagem e retorno" e "Transporte e equipe") e a lista
de itens, salvo de dentro do carrinho e usado para pré-preencher o carrinho.
Cada texto aceita até 2000 caracteres, no servidor desde o PR 642 e na tela
Eventos desde o PR 643 (26/11/2026; eram 300). Nada liga o modelo ao pedido
que ele gera, e nada registra o que aconteceu no evento.

O Leonardo quer outra coisa: o evento é o registro de uma edição, com
endereço, layout, cronograma, itens, o que foi, o que voltou, fotos de tudo,
equipe e o preço fechado, para que no ano seguinte a Dutelog e o cliente
tenham a base de tudo que foi feito naquele evento. O cliente abre e envia; o
Guilherme, operador do WMS, registra pela Armazenagem; o cliente lê.

## Decisões do Leonardo (24 a 26/11/2026)

1. **O "Novo evento" nasce em Eventos**, nunca no carrinho do Estoque. O
   "Salvar como evento" sai.
2. **O evento é o registro completo de uma edição**: endereço, layout,
   itens, horários de tudo, coleta, entrega, o que foi, o que voltou ao
   estoque, fotos, equipe e o preço fechado. No ano seguinte, a edição nova
   nasce copiando a última ("Nova edição a partir desta").
3. **O Guilherme registra tudo pela Armazenagem.** O cliente abre, envia e
   lê; a Dutelog confirma, executa e registra.
4. **A escolha dos itens é no Estoque** (25/11), no modo "montando o evento",
   com foto, tamanhos e saldo: com 100 itens e 2.000 peças, escolher item a
   item dentro do evento não funciona. O evento guarda só o resumo e abre a
   lista inteira em "Ver os N itens". Toda lista longa (no evento, na edição
   registrada e no retorno da Armazenagem) mostra poucas linhas, com busca,
   filtro e "Ver mais".
5. **A seção dos horários chama-se "Cronograma"** (25/11), a palavra do
   mercado de eventos e da cliente.
6. **O preço fechado na v1 fica só registrado na edição** (26/11). A fatura
   vem depois, numa parte própria, pelo Financeiro.
7. **A conta do Guilherme é `admin`** (26/11): ele confirma a edição, fecha
   o preço e anexa a proposta, registra tudo e fecha, como a prancha
   mostra. Os gates ficam os de sempre (confirmar e fechar: owner, admin,
   interno; preço: owner, admin, financeiro; registrar: owner, admin,
   interno, wms); `admin` passa em todos.
8. **A Necton de 28 e 29/01/2027 fica fora da v1** (26/11): o pedido dela
   segue o caminho de hoje, e a edição entra depois como história, pela
   parte 13 (a adoção do pedido existente). O conserto mínimo do "Salvar
   como evento" de hoje (limite de 2000 e a recusa dizendo o campo) sai
   agora, num PR pequeno à parte.
9. **A Dutelog preencher a edição em nome do cliente fica para depois**
   (26/11): na v1 o cliente preenche e envia, e a Dutelog ajuda por
   telefone. A agenda mostra os rascunhos do cliente só para leitura; o
   "Novo evento" da agenda entra numa parte futura.
10. **O "Outro momento" fica fora da ordem do cronograma** (26/11, na
    revisão da parte 1, PR 645): a ordem das datas vale só entre os sete
    momentos fixos. O formulário põe cada outro momento depois deles, com
    a data que tiver; pela regra de antes, todo outro com data antes da
    entrega de volta seria recusado.
11. **A zeragem recusa com edição em aberto** (26/11, PR 645): com uma
    edição de `enviado` a `no_evento`, a zeragem para antes de qualquer
    escrita, no ensaio e na execução, e aponta as edições que impedem.
12. **A hora do cronograma é obrigatória só na entrega no local** (27/11,
    PR 647): nos outros momentos a linha grava no rascunho com o dia e sem
    a hora, e a tela só pede a hora na entrega. Na ordem das datas, vale o
    dia para todos e a hora só entre os momentos que a têm.
13. **Um `evento.edicao_salva` a cada gravação** (27/11, PR 647), também
    no salvamento automático, como esta spec pede; agrupar na tela fica
    para depois.

## Objetivos

- O cliente abre uma edição no portal com tudo que a Dutelog precisa para
  executar: onde, o cronograma, os itens do estoque Dutelog, o que será
  coletado no cliente, o layout e as observações; sem limite que esconda a
  recusa, e com a recusa dizendo o campo.
- "Enviar para a Dutelog" cria o pedido de saída com os itens do estoque e o
  liga à edição; separação, volumes, lacre, romaneio e entrega seguem o
  caminho de sempre, e a edição lê esses fatos sem ninguém digitar de novo.
- A Dutelog confirma, registra cada momento com hora, fotos e observação,
  registra o retorno item a item (voltou, avariadas, não voltaram) com a
  entrada no estoque na mesma transação, registra o preço fechado para quem
  vê valores e fecha a edição.
- O cliente lê a edição registrada: o previsto e o feito, o que foi e o que
  voltou, o romaneio, as fotos, os documentos e o preço, e começa a próxima
  edição a partir dela.
- Tudo isso com o isolamento por cliente, a auditoria em `events`, a
  idempotência e as regras de quem vê valor que o repositório já exige.

## Fora do escopo (v1)

- **A fatura da edição.** O preço fica registrado; o "A faturar" do
  Financeiro com origem "evento" é uma parte futura, desenhada quando entrar
  (hoje `lerParaFaturar` só lê demandas, competências do WMS e medições). A
  linha "Fatura FAT-0031" da prancha do portal sai.
- **Avisos por e-mail e sino** nos marcos (confirmado, retorno, fechado). O
  roteiro dos avisos é da Operação (`runNotifications`) com cópias em três
  codebases; entra depois, como parte própria, com modelos novos.
- **Mais de um pedido por edição.** A edição leva até 100 itens do estoque,
  o limite de uma separação (`MAX_ITENS_DO_PEDIDO`). O 1:N fica para quando
  um evento passar disso.
- **O formulário da edição na Armazenagem** (o "Novo evento" da agenda, a
  Dutelog preenchendo em nome do cliente): decisão 9. O desenho prevê o
  lugar (o formulário do portal aberto pela equipe com o cliente ativo,
  rotas internas e leituras da equipe), não a parte.
- **A edição da Necton 2027 na v1**: decisão 8. A parte 13 a traz depois
  como história.
- **O que não voltou e aparece depois.** Entra pela devolução manual de
  Devoluções (`createReturnReceipt`), com a referência da edição no texto;
  a edição não é reaberta.
- **Migração dos modelos antigos** (`client_event_templates`). Na publicação
  em produção conta-se quantos existem; com poucos, a Dutelog recria cada um
  como evento com a primeira edição; com muitos, um script em `tools/`, em PR
  próprio.
- **O modelo Mobiliário** continua sem Eventos
  (`docs/multicliente-modelos-de-operacao.md`). As linhas de mobiliário da
  prancha (MAT-021, MAT-034) são ilustração: a edição leva qualquer SKU do
  catálogo do cliente no modelo Uniformes.
- **Fila sem sinal para as fotos.** A ficha da Armazenagem é usada com rede;
  a foto sobe na hora, com progresso, como as fotos de produto.
- **PDF gerado.** "PDF da edição", o romaneio do portal e "Comprovante do
  retorno" são a impressão do navegador, como o comprovante da OS.
- **API REST v1.** Os Eventos entram em `docs/api-cobertura.md` como "não
  coberto".
- **Retenção.** Fotos e documentos da edição ficam sem prazo ("A operação
  primeiro", `docs/plataforma/lgpd.md`).

## O que achei no código e muda o desenho

Levantado em 26/11/2026 (seis leitores, três avaliações e um crítico de
lacunas, contra a `main` `aa0649a1`).

- **O pedido inteiro existe e basta ser lido.** `createCustomerRequest`
  reserva e cria a solicitação; a aprovação (`decideCustomerRequest`, só
  owner, admin e interno) cria `orders`, `pick_tasks`, `pick_lines` e a
  projeção `client_order_tracking`; a bancada separa e fecha os volumes com o
  lacre (`completeOrderSeparation`); o packing concluído grava `packages` e
  `package_items`; a expedição vai a `dispatched` e `delivered` por
  `advanceWarehouseTask`, que só em `delivered` consome a reserva e grava a
  SAÍDA. "Separado" e "Entregue" são fatos do pedido; a edição os lê.
- **Nada liga o modelo de hoje ao pedido.** "Usar no pedido" só pré-preenche
  o carrinho pela URL (`?evento=`); nem `customer_requests` nem `orders` têm
  o id do evento. A ligação é campo novo, carregado pela transação que cria
  a solicitação e pela que aprova.
- **O retorno que existe não serve como está.** `receiveOrderReturn` só abre
  quando `orders.retorno.status` é `a_receber`, e isso só a OS de volta da
  Operação grava (`conclusao-gravacao.ts`), que não está em uso. Ele grava só
  o que voltou (uma `returns` por pedido, sem estoque), não registra o que
  não voltou nem avaria por item, e o estoque só entra depois, item a item,
  por `setReturnDisposition`, numa posição digitada. Nenhuma guarda impede
  o retorno antes de o pedido estar entregue (a reserva `picked` e a ENTRADA
  contariam duas vezes). O retorno da edição é módulo novo; a triagem das
  avariadas reaproveita Devoluções.
- **O cliente não lê o que foi nem o que voltou.** `order_items`,
  `pick_lines`, `packages`, `package_items`, `returns` e `return_items` são
  só da equipe (`canReadOperations`); `client_request_status` leva só a
  quantidade pedida; `client_order_tracking` leva `package_count` e
  `seal_code`, que o portal nem mostra; `/pedidos/romaneio` é página da
  equipe. "O que foi e o que voltou" e o romaneio do cliente precisam de
  cópia escrita pelo WMS na própria edição.
- **O cancelamento já devolve o separado à EXPEDICAO com a guarda de
  volta** (`cancelWarehouseOrderTransaction`, `domain/order-cancel.ts`,
  `LOCAL_DO_CANCELADO`). O retorno do evento usa o mesmo caminho: ENTRADA na
  EXPEDICAO, origem interna (não cobra, não conta no relógio do estoque) e a
  guarda de volta à prateleira. O "Guardar" do Estoque (`domain/area-putaway.ts`)
  cobre o que sobrar na área.
- **Quem vê o quê na Armazenagem.** "A equipe opera todos os clientes no
  mesmo galpão" (`lib/active-customer.ts`): Início, Pedidos, a fila do
  Receber, Mapa e Alertas mostram todos; Estoque, Contagem, Devoluções e
  Faturamento seguem o cliente ativo (`docs/manual-armazenagem.md`, "O
  cliente ativo"). A agenda dos eventos é uma fila: mostra todos.
- **Preço no WMS.** `requireBillingWrite` (owner, admin, financeiro) é a
  única porta de escrita de valor; `comercial` não é papel do WMS e não
  chama callable dele; nas regras, `canReadPrices` é owner, admin, comercial
  e financeiro. O preço fica num documento próprio, fora do que o `wms` lê.
  O runbook do Comercial (`docs/plataforma/comercial-producao.md`, item 9)
  planejava o papel `comercial` para o Guilherme, que não entra no WMS; a
  conta dele é `admin` (decisão 7), e o Comercial, quando entrar em uso,
  precisa saber disso.
- **Arquivos.** Nenhum caminho do Storage aceita planilha `.xlsx`. O padrão
  da Operação serve: o navegador sobe pelo SDK com `compactarFoto`
  (`lib/envio-de-fotos.ts`) e a callable confere o objeto com o Admin SDK
  (`exists()` e `getMetadata()`) antes de gravar o registro. Não existe
  miniatura em lugar nenhum; as grades carregam a imagem inteira.
- **Convenções do WMS.** Não tem `runIdempotent`: o recibo é em
  `operational_operations` (`operationResult` e `createOperationReceipt`, ou
  inline como `domain/count-rounds.ts`). Toda callable começa com
  `getProfile` e um gate (`requireWarehouseWrite` = owner, admin, interno,
  wms; `requireOperationsCoordinator` = owner, admin, interno;
  `requireBillingWrite` = owner, admin, financeiro; `requireCustomerScope`
  para o cliente). Callable nova é uma linha `export const nome = onCall(`
  no `index.ts`, com linha na matriz de
  `callables-papeis.integration.test.ts`; o teste de porta descobre as novas
  sozinho. `createEvent` grava `events` com payload livre: a estrutura
  `.strict()` e a ausência de valor e de contato são responsabilidade do
  desenho.
- **O roteador de avisos do WMS** (`notificationKindForEvent`) casa pelo
  nome do tipo: `order`, `picking`, `shipment`, `dispatch`, `billing`,
  `invoice`, `receb`, `receipt`, `inbound`, `movement`, `inventory`,
  `exception`, `diverg`. `evento.*` é seguro.
- **A zeragem apaga coleção nova do WMS por padrão** (`tools/full_reset_btg.py`
  só varre as outras codebases) e apaga os eventos de auditoria do WMS
  (`source` fora de `functions_comercial`, `functions_operacao` e
  `functions_financeiro`). A história "para sempre" precisa ser listada à mão.
- **Quem opera não lê o cadastro da Operação** (`collaborators`, `vehicles`
  são da coordenação). A equipe e o veículo da edição são texto.
- **O nome do item não basta para a tela.** As pranchas agrupam por família
  com a quantidade por tamanho e filtram por tipo; `client_inventory` tem
  `size` e `category`, e a família e o tamanho saem do código do cliente
  (`groupFamilies`, `lib/stock-variants.ts`; `nomeComTamanho`). A edição
  copia tamanho e tipo ao gravar, para a edição fechada se bastar no ano
  seguinte; a foto fica no Estoque, e a tela a junta quando existe.
- **Portal e Armazenagem usam dois visuais**: o portal segue o visual do WMS
  (`LayoutDoPortal`, tokens da raiz); a Armazenagem, o shell v3
  (`TELAS_DO_WMS_NA_V3`). Cada tela nova leva o teste dos textos e o do `axe`.
- **"Ver mais" não tem componente.** Os precedentes são `CatalogProgress`
  do Estoque ("Exibindo X de Y", "Carregar mais N"), `PREVIEW_ITEMS = 6`
  dos Eventos de hoje e `VOLUMES_A_VISTA` da separação.

## Abordagens

1. **Dentro do WMS** (`functions/wms`, codebase `default`), ao lado do
   evento de hoje. **Escolhida.** O registro, o pedido e o retorno ficam na
   mesma codebase: o envio cria a solicitação e marca a edição numa
   transação, o packing concluído e a entrega escrevem a edição na mesma
   transação do pedido, e o retorno faz a ENTRADA e o registro juntos. O
   Eventos do portal já é tela do módulo `wms` (`MODULO_DA_TELA_DO_PORTAL`),
   e não entra papel nem módulo novo. Ressalvas: o retorno é código novo,
   a zeragem precisa das coleções listadas à mão, e as convenções da seção
   1.3 do plano de implantação (payload `.strict()`, sem valor, liberação
   por ambiente) entram por mão própria, porque o WMS não as tem prontas.
2. **Codebase própria** (`functions/eventos`), no molde do Comercial. Mais
   limpa por módulo, mas as codebases não se chamam e o repositório não tem
   gatilho do Firestore: o navegador passaria a sequenciar duas codebases
   em três passos críticos (enviar, confirmar, retornar), com a edição e o
   pedido desencontrados quando a segunda chamada falha; o retorno precisaria
   de um segundo escritor em `orders.retorno`; e o status da edição
   atrasaria até alguém registrar algo.
3. **Na Operação**, como demanda com uma OS por momento. Descartada:
   contradiz a prancha aprovada (o Guilherme registra na Armazenagem), a
   Operação não está em uso (a Dutelog opera no Pipefy), o papel `wms` não
   chama nem lê quase nada dela, e a produção esconde o módulo
   (`ARMAZENAGEM_EXCLUSIVA_AMBIENTES`).

## O desenho

### O evento e a edição

Três coleções novas, escritas só pelo WMS:

- `client_events`, o evento que se repete: `id` (`cve_` e 16 hex),
  `customer_code`, `name` (até 120), `description` (até 300, a "Descrição"
  da prancha), `status` (`active` ou `archived`), `editions_count`,
  `last_edition_id`, `last_edition_label`, `created_by`, `created_at`,
  `updated_by`, `updated_at`, `archived_by`, `archived_at`.
- `client_event_editions`, a edição: o documento grande, abaixo.
- `client_event_prices`, o dinheiro da edição, um documento com o id da
  edição: `valor_declarado_cents` (a coleta no cliente, digitado pelo
  cliente), `fechado_cents`, `fechado_observacao`, `fechado_por`,
  `fechado_em`, `documentos` (a proposta e o que mais tiver valor),
  `customer_code`, `updated_at`. Nunca lido pelo papel `wms`.

Os ids da edição são `ced_` e 16 hex. O documento do evento é só a capa: a
lista do portal e a agenda da Armazenagem leem as edições.

### A edição, campo a campo

```
client_event_editions/{ced_…}
  id, customer_code, event_id, event_name          (cópia, para listar)
  label                                            "2027" (até 40; padrão: o ano do momento "evento")
  status                                           rascunho | enviado | confirmado | separado | no_evento | retornado | fechado | cancelado
  edicao                                           inteiro, +1 a cada escrita (CAS: expected_edicao)
  origem_edicao_id                                 a edição copiada em "Nova edição a partir desta", ou null
  onde: { local (até 160), endereco (até 300), contato: { nome (até 120), telefone (até 40) } }
  cronograma: [ momento ]                          até 12 (abaixo)
  itens: [ { sku_code, client_item_code, product_name, size, category,
             quantity, foi, voltou, avariadas, nao_voltaram, observacao } ]
                                                   até 100; size (até 80) e category (até 120) copiados de client_inventory ao
                                                   gravar, como RequestItemSchema faz; a foto e o saldo ficam só no Estoque;
                                                   foi/voltou/avariadas/nao_voltaram nulos até o fato acontecer
  itens_total, pecas_total                         contadores do pedido
  coleta: { onde (até 300), quantidade, voltou, distribuidos }
                                                   quantidade 0 = sem coleta; voltou/distribuidos nulos até o retorno
  observacoes                                      até 2000, do cliente
  observacoes_dutelog                              até 2000, da equipe
  documentos: [ { id, caminho, nome (até 120), tipo, tamanho, origem: cliente | dutelog, momento_id?, registrado_por, registrado_em } ]
                                                   até 20
  fotos: [ { id, caminho, momento_id, legenda (até 60), instante, registrado_por, registrado_em } ]
                                                   até 200
  equipe: { estoquistas (até 120), do_cliente (até 120), veiculo (até 60), contato_no_local (até 120) }
  separar_ate                                      AAAA-MM-DD, na raiz: gravado na confirmação (a agenda ordena por ele),
                                                   mudado pela coordenação até separado
  pedido: { request_id, request_number, order_id, order_number,
            separado_em, lacre, volumes_total,
            volumes: [ { numero, unidades, peso_kg, itens: [ { client_item_code, product_name, size, quantidade } ] } ],
            entregue_em, entregue_por, comprovante, cancelado_em }
                                                   null sem itens do estoque; volumes copiados de packages e package_items
                                                   no packing concluído, sem caixa, posição nem valor (é o romaneio do cliente)
  retorno: { chegou_em, registrado_por, registrado_em, observacao (até 500), return_id }   null até o retorno
  enviada_em, confirmada_em, fechada_em, cancelada_em, cancelada_por, cancelamento_motivo (até 500)
  created_by, created_at, updated_by, updated_at
```

`foi` vem de `package_items` (a soma de `qty_packed` do SKU no pedido) no
packing concluído; `voltou` e `avariadas` vêm do retorno; `nao_voltaram`
é `foi − voltou − avariadas`, gravado para a história não depender de
conta. Quem grava `created_by` e companhia é `actorRef`, como em
`client-events.ts` (uid, nome, papel).

O dinheiro nunca entra neste documento nem no payload de evento: o valor
declarado da coleta, o preço fechado e a proposta moram em
`client_event_prices`.

### O cronograma

Cada momento tem um tipo fixo de `lib/dominio` e, no tipo `outro`, um rótulo:

```
momento: {
  id            "mo_" e 8 hex
  tipo          coleta_no_cliente | entrega_no_local | montagem | evento | desmontagem | retorno_ao_estoque | entrega_de_volta | outro
  rotulo        só no tipo outro (até 60)
  previsto: { data (AAAA-MM-DD), hora (HH:MM | null; obrigatória só na entrega no local), ate (HH:MM | null), local (até 160 | null), observacao (até 300 | null) }
  feito:    { inicio (ISO), fim (ISO | null), observacao (até 300 | null), origem: registro | pedido | retorno,
              registrado_por, registrado_em, corrigido_em | null } | null
}
```

Regras:

- O formulário mostra os sete tipos na ordem acima; uma linha sem data não
  é gravada. `evento` é obrigatório (com data). Com itens do estoque,
  `entrega_no_local` (data e hora) e `retorno_ao_estoque` (data) também.
  Com coleta, `coleta_no_cliente` também.
- Um tipo só aparece uma vez, exceto `outro` (até cinco). O total é 12.
- As datas dos sete tipos fixos crescem na ordem da lista; a recusa diz
  qual momento está antes do anterior. O `outro` fica fora da ordem
  (decisão 10): o formulário o põe depois dos sete, com a data que tiver.
- A hora só é obrigatória na entrega no local (decisão 12): nos outros
  momentos a linha grava com o dia e sem a hora. Na ordem, vale o dia para
  todos e a hora só entre os que a têm: o momento sem hora não fica antes
  de um do mesmo dia.
- O `feito` com `origem: pedido` (a entrega, quando veio da expedição) e
  `origem: retorno` (o retorno ao estoque) tem o instante do fato: a hora
  não se corrige, só a observação. Os outros são registrados à mão, um por
  um, com "Registrar fim" como segunda escrita, e podem ser corrigidos até
  a edição fechar (abaixo).

### Os status e quem move cada um

```
rascunho ──enviar (cliente)──▶ enviado ──confirmar (coordenação)──▶ confirmado
   │                              │                                     │
   │                              │                         packing concluído (bancada)
   │                              │                                     ▼
   │                              │                                 separado
   │                              │                                     │
   │                              │                         expedição entregue (quem opera)
   │                              │                                     ▼
   │                              │                                 no_evento ──retorno (quem opera)──▶ retornado ──fechar (coordenação)──▶ fechado
   │                              │                                     ✕ (não cancela mais)
   ✕ excluir (cliente)            └──cancelar (cliente, ou coordenação até separado)──▶ cancelado
```

- `rascunho` → `enviado`: `sendEventEdition`, pelo cliente (ou pela
  coordenação em nome dele). Com itens do estoque, cria a solicitação na
  mesma transação.
- `enviado` → `confirmado`: `confirmEventEdition`, coordenação (owner,
  admin, interno). Com pedido, é a aprovação da solicitação, na mesma
  transação, com o "separar até" e, para quem escreve valores, o preço. A
  aprovação feita em Pedidos › Para aprovar (`decideCustomerRequest`)
  também confirma a edição, com o "separar até" padrão.
- `confirmado` → `separado`: o packing concluído do pedido
  (`advanceWarehouseTaskTransaction`, passo `packing:completed`) grava na
  edição `pedido.separado_em`, `lacre`, `volumes_total`, `volumes[]` e o
  `foi` de cada item.
- `separado` → `no_evento`: a expedição entregue (`shipping:delivered`)
  grava `pedido.entregue_em`, `entregue_por`, `comprovante` e, se o momento
  `entrega_no_local` ainda não tem `feito`, o `inicio` com o instante da
  entrega e `origem: pedido`. Sem pedido, o registro do momento
  `entrega_no_local` ou `evento` faz esta transição.
- `no_evento` → `retornado`: `receiveEventReturn`, quem opera (owner,
  admin, interno, wms).
- `retornado` → `fechado`: `closeEventEdition`, coordenação. Só o retorno
  trava o fechamento; momentos sem registro, preço em branco e retorno sem
  foto são linhas de dado na agenda e na ficha ("Faltam desmontagem e
  entrega de volta", "Sem preço fechado"), nunca bloqueio. Momentos, fotos,
  documentos e equipe continuam registráveis em `retornado`, até fechar; em
  `fechado` e `cancelado` nada mais se grava.
- `rascunho` → excluída: `cancelEventEdition` em `rascunho` apaga a edição
  e o documento de preço (o rascunho não vira história); o evento que fica
  sem edição é apagado junto. Evento `evento.edicao_excluida`.
- `cancelado`: `cancelEventEdition`. O cliente cancela em `enviado` (a
  solicitação ainda aberta é cancelada como em `cancelCustomerOrder`); a
  coordenação cancela em `enviado`, `confirmado` e `separado`, com motivo (a
  solicitação aberta é recusada, o pedido aprovado é cancelado por
  `cancelWarehouseOrderTransaction`, que devolve o separado à EXPEDICAO). A
  recusa da solicitação em Pedidos e o cancelamento do pedido pela
  coordenação também cancelam a edição, com o motivo. De `no_evento` em
  diante não cancela: "Os itens já saíram: registre o retorno e feche a
  edição."

A edição sem itens do estoque pula `separado`: `confirmado` → `no_evento`
no primeiro momento registrado entre `entrega_no_local` e `evento`.

### As callables

Todas em `functions/wms/src/index.ts`, uma linha cada, começando por
`getProfile`, com evento de auditoria na mesma transação e, nas que criam
ou transitam (enviar, cancelar, arquivar, confirmar, registrar momento,
anexar, retorno, preço, fechar), recibo em `operational_operations`
(`op_evento_…`); salvar a edição e a equipe usam o CAS `expected_edicao`
(a repetição incerta recusa e a tela relê o documento vivo), e a criação,
o id determinístico pela `idempotency_key`. O domínio fica em
`functions/wms/src/domain/eventos/` (um arquivo por assunto: `edicao.ts`,
`cronograma.ts`, `envio.ts`, `momentos.ts`, `retorno.ts`, `arquivos.ts`,
`preco.ts`, `eventos-auditoria.ts`), com as regras puras separadas da
gravação, no molde de `count-rounds.ts`.

| Callable | Quem passa | O que faz |
|---|---|---|
| `saveEventEdition` | cliente (próprio código) e coordenação em nome dele | Sem `id`, cria o evento (ou usa um existente) e a edição em `rascunho`: exige o nome do evento, o resto pode vir vazio. Com `id`, aplica um `patch` com `expected_edicao`. O cliente só em `rascunho`; a coordenação também em `enviado` e `confirmado` (onde, cronograma previsto, label e, até `separado`, `separar_ate`), nunca `itens` depois do envio. Copia `size` e `category` de `client_inventory` nos itens. Grava `valor_declarado_cents` em `client_event_prices`. |
| `sendEventEdition` | cliente e coordenação | `rascunho` → `enviado`. Com itens, cria a solicitação (`createCustomerRequestTransaction`) na mesma transação. |
| `cancelEventEdition` | cliente (`rascunho`: exclui; `enviado`: cancela) e coordenação (`rascunho`: exclui em nome do cliente; `enviado`, `confirmado`, `separado`: cancela, com motivo) | Exclusão ou `cancelado`, com a solicitação ou o pedido tratados como acima. |
| `archiveClientEvent` | cliente e coordenação | Arquiva o evento sem edição aberta (`rascunho` a `retornado`); o rascunho precisa ser excluído antes. |
| `attachEventDocument` | cliente (origem `cliente`) e quem opera (origem `dutelog`), os dois de `rascunho` a `retornado` | Confere o arquivo no bucket e o acrescenta a `documentos`, com o momento quando houver. |
| `removeEventDocument` | quem anexou o documento, ou a coordenação | Tira o registro de `documentos` (o arquivo fica no bucket). O cliente só em `rascunho` e `enviado`. |
| `confirmEventEdition` | coordenação; o preço só para quem também passa em `requireBillingWrite` | `enviado` → `confirmado`, com `separar_ate` e, opcionais, `fechado_cents`, `fechado_observacao` e a proposta; aprova a solicitação na mesma transação. Preço vindo de quem não escreve valores: recusa ("Só quem vê valores fecha o preço."). |
| `registerEventMoment` | quem opera | Grava `feito` de um momento (início, ou fim como segunda escrita) ou, com `corrigir: true` e `expected_edicao`, corrige início, fim e observação de um momento registrado à mão. Em `entrega_no_local` com pedido ainda não entregue, roda `dispatched` e `delivered` antes (abaixo). |
| `attachEventPhoto` | quem opera | Confere a foto no bucket e a acrescenta a `fotos`, com o momento. De `confirmado` a `retornado`: é foto da execução. |
| `saveEventEditionTeam` | quem opera | `equipe` e `observacoes_dutelog`, até `fechado`. |
| `receiveEventReturn` | quem opera | `no_evento` → `retornado`: o retorno item a item, a ENTRADA, a guarda de volta e a devolução das avariadas, numa transação. |
| `setEventEditionPrice` | owner, admin, financeiro (`requireBillingWrite`) | `fechado_cents`, a observação e a proposta em `client_event_prices`, de `confirmado` até `retornado`; "Alterar" é a mesma callable. |
| `closeEventEdition` | coordenação | `retornado` → `fechado`. |

As leituras são pelas regras do Firestore (abaixo), não por callable: as
listas e a edição chegam ao vivo, como `client_order_tracking`.

Quem é "cliente" passa por `requireCustomerScope`; a coordenação pode agir
em nome de um cliente com `customer_code` no pedido. A matriz de
`callables-papeis.integration.test.ts` ganha uma linha por callable, com a
frase da recusa de cada gate.

### O envio e o pedido

`sendEventEdition` valida a edição inteira (os obrigatórios do cronograma,
os itens com saldo pela mesma conta de `createCustomerRequestTransaction`)
e, com itens, chama a transação da solicitação com:

- `idempotency_key`: `evento:<edition_id>` (a solicitação nasce com id
  determinístico; repetir o envio devolve a mesma);
- `type`: `retirada`; `title`: `Evento · <nome> · <label>`;
  `description`: `Evento <nome>, edição <label>: entrega em <local>`;
  `destination`: `<local> · <endereço>`; `due_at`: o `previsto` de
  `entrega_no_local`;
- `items`: um por item da edição (`sku_code`, `client_item_code`,
  `product_name`, `quantity`), até 100;
- **`event_edition_id`**, campo novo e opcional de
  `CreateCustomerRequestSchema`, copiado para `customer_requests`,
  `client_request_status` e, na aprovação, para `orders` e
  `client_order_tracking`.

A edição recebe `pedido.request_id` e `request_number` na mesma transação.
Saldo insuficiente recusa o envio com a frase de sempre ("Saldo insuficiente
para o SKU …"); a tela mostra a falta antes, como o `eventShortages` de hoje.

Em Pedidos › Para aprovar, a linha da solicitação diz "Evento · nome · label"
(é o `title`). A tela do pedido e a da bancada não mudam. O retorno de um
pedido com `event_edition_id` é só pela edição: `receiveOrderReturn` recusa
("O retorno deste pedido é registrado na edição do evento.").

### A confirmação, o "separar até" e o preço

`confirmEventEdition` recebe `separar_ate` (data; padrão: a véspera do
`due_at`) e roda `decideCustomerRequestTransaction` com `approve` na mesma
transação, gravando também `pedido.order_id` e `order_number`. O
`separar_ate` fica na edição; a agenda da Armazenagem ordena por ele; a
coordenação o muda pelo `patch` de `saveEventEdition` até `separado`. A
aprovação feita em Pedidos grava o padrão.

O diálogo "Confirmar" tem o campo do preço e o anexo da proposta só para
quem escreve valores (owner e admin, que também confirmam): é o "Confirmar
e fechar preço" da prancha, que o Guilherme, `admin`, faz num ato só
(decisão 7); para o interno, o diálogo é só o "separar até". É um ato, um
recibo e dois eventos (`evento.edicao_confirmada` e, com preço,
`evento.preco_fechado`). O `financeiro` pode dar ou alterar o preço por
`setEventEditionPrice`, mas na v1 não tem tela para isso: ele não lê a
edição (`canReadOperations` não o inclui); owner e admin fecham e alteram
pela ficha, no bloco "Preço fechado".

### O registro dos momentos

`registerEventMoment({ edition_id, momento_id, inicio?, fim?, observacao?,
entrega?, corrigir?, expected_edicao?, idempotency_key })`:

- `inicio` grava o começo (uma vez); `fim` grava o fim, exige `inicio`
  gravado e `ate` previsto ou tipo `outro`; cada chamada é uma escrita.
- `corrigir: true` reescreve `inicio`, `fim` e `observacao` de um momento
  com `origem: registro`, com `expected_edicao`, até `retornado`; grava
  `corrigido_em` e o evento `evento.momento_corrigido` com os instantes
  antes e depois. Nos momentos com `origem: pedido` ou `retorno`, só a
  observação.
- Só de `confirmado` até `retornado`; `retorno_ao_estoque` não se registra
  aqui (é o retorno); `entrega_no_local` com pedido tem regra própria:
  - se o pedido ainda está em `ready_to_dispatch` ou `dispatched`, a
    chamada leva `entrega: { quem_levou, placa, quem_recebeu? }` e roda,
    antes do registro, as transições `dispatched` e `delivered` de
    `advanceWarehouseTaskTransaction` com `carrier: "Dutelog"`,
    `proof_reference: quem_recebeu || "Entrega própria Dutelog"` e
    `delivery_notes: "Recebido pelo cliente."`, como o diálogo "Entregue"
    de Pedidos; cada transição com a chave derivada da tarefa, como
    `completeOrderSeparation` faz; o `feito` fica com `origem: pedido`;
  - se o pedido ainda não está separado, recusa ("O pedido ainda não foi
    separado.");
  - se já está entregue, grava só a observação e as fotos: o instante é o
    da expedição.
- Sem pedido, o primeiro registro entre `entrega_no_local` e `evento` leva
  a edição a `no_evento`.

As fotos vão por `attachEventPhoto` com o `momento_id`; a ficha mostra as
fotos agrupadas por momento. O comprovante de entrega assinado, quando
houver, é um documento anexado pela Dutelog com o momento
`entrega_no_local`; sem ele, o comprovante é o texto da expedição.

### O retorno ao estoque

`receiveEventReturn({ edition_id, chegou_em, itens: [{ sku_code,
client_item_code, voltou, avariadas, observacao? }], coleta: { voltou }?,
observacao?, idempotency_key })`, uma transação:

- exige a edição em `no_evento` e, com pedido, `orders.status` `ENTREGUE`;
- todo item da edição com `foi > 0` precisa de linha (`voltou` e
  `avariadas` inteiros, `voltou + avariadas ≤ foi`); a tela manda todas, e
  "Os outros N voltaram iguais" preenche `voltou = foi` nas que a pessoa não
  tocou;
- por item, ENTRADA de `voltou` na `EXPEDICAO` (`LOCAL_DO_CANCELADO`), com
  `source: functions_event_return`, o razão, os saldos, `client_inventory`
  (sem `qty_available`: área de passagem) e os agregados do catálogo, e a
  guarda de volta à prateleira de origem como o cancelamento faz; a origem é
  interna, fora da cobrança e do relógio do estoque;
- as `avariadas` nascem como devolução para triagem: um `returns`
  (`source: retorno_do_evento`, `reference: "Evento <nome> · <label> ·
  PED-…"`, chave `evento:<edition_id>`) com um `return_items` por item com
  `avariadas > 0` (`quantity = avariadas`, `condition: damaged_return`,
  `notes` = a observação), no formato de `createReturnReceiptTransaction`
  (a função ou o corpo dela), pendentes de disposição em Devoluções, onde a
  disposição de sempre decide (avaria, quarentena, descarte, ou disponível
  com posição, que faz a ENTRADA pela origem de lá); a edição guarda
  `retorno.return_id`;
- `nao_voltaram` só fica registrado na edição e no evento de auditoria;
- `coleta.voltou` e `coleta.distribuidos = quantidade − voltou` na edição;
- a edição grava `retorno`, `itens[].voltou`, `avariadas`, `nao_voltaram`,
  `status: retornado` e o `feito` de `retorno_ao_estoque` (`inicio =
  chegou_em`, `origem: retorno`).

É um retorno por edição; a segunda chamada com a mesma chave devolve o
mesmo recibo, e com outra chave recusa ("O retorno desta edição já foi
registrado."). O que sobrar na EXPEDICAO volta à prateleira pelo "Guardar"
do Estoque. A régua `billing-callables.integration.test.ts` ganha a linha
da ENTRADA `functions_event_return` que não cobra, como `n_devolucao`.

### O preço fechado e o valor declarado

- `client_event_prices/{edition_id}` é escrito só pelo servidor: o valor
  declarado por `saveEventEdition`; o preço, a observação e a proposta por
  `confirmEventEdition` ou `setEventEditionPrice`.
- Regras: leitura por `canReadPrices()` (owner, admin, comercial,
  financeiro) ou pelo próprio cliente com `wms` contratado
  (`isOwnProjectionWith('wms')`); escrita nunca.
- O payload do evento `evento.preco_fechado` leva só o id da edição.
- A proposta e qualquer documento com valor sobem para
  `eventos/{code}/{edition}/valores/` (abaixo) e ficam listados em
  `client_event_prices.documentos`, nunca em `documentos` da edição.
- A ficha da Armazenagem mostra o bloco "Preço fechado" só para quem lê
  valores (`canSeeCatalogPrice`: owner, admin, financeiro); para o `wms` o
  bloco não existe (regra 8 da seção 1.2 do plano: o que a pessoa não pode
  ver não existe na tela dela). O resumo da edição no portal mostra o
  preço, o valor declarado e a proposta.

### Fotos e documentos

Caminhos novos em `storage.rules`, com os helpers `clienteComArmazenagem(code)`
(espelho de `clienteComOperacao` com `'wms'`) e `leValores()` (owner,
admin, comercial, financeiro, pelo papel em `users/{uid}`):

| Caminho | Quem cria | Tipo e tamanho | Quem lê |
|---|---|---|---|
| `eventos/{code}/{edition}/fotos/ft_<16 hex>.(jpg\|png\|webp)` | `canWritePhotos()` (owner, admin, interno, wms) | `image/(jpeg\|png\|webp)`, < 8 MiB | `isInternal()` ou `clienteComArmazenagem(code)` |
| `eventos/{code}/{edition}/docs/dc_<16 hex>.(pdf\|jpg\|png\|webp\|xlsx)` | `canWritePhotos()` | PDF, imagem ou `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, ≤ 10 MiB | os mesmos |
| `eventos/{code}/{edition}/valores/dc_<16 hex>.(pdf\|jpg\|png\|webp)` | `leValores()` | PDF ou imagem, ≤ 10 MiB | `leValores()` ou `clienteComArmazenagem(code)` |
| `portal/{code}/eventos/{edition}/an_<16 hex>.(pdf\|jpg\|png\|webp\|xlsx)` | `clienteComArmazenagem(code)` | PDF, imagem ou planilha, ≤ 10 MiB | `isInternal()` ou `clienteComArmazenagem(code)` |

Sem update nem delete pelo navegador ("regravar é create"). A callable
confere o objeto com o Admin SDK (existe, tipo, tamanho) antes de gravar o
registro, como `attachPhoto` da Operação; arquivo errado é apagado por
geração e recusado. O navegador comprime a imagem com `compactarFoto` e
sobe com `enviarComProgresso`; a planilha e o PDF sobem como estão. As
fotos e os documentos abrem por `getDownloadURL` sob as regras, como as
fotos da OS. Teste das regras no emulador em
`functions/wms/src/eventos-arquivos.rules.test.ts` (precedente
`operacao-solicitacoes.rules.test.ts`), na lista fixa do `test:integration`.

### Regras do Firestore, índices e zeragem

- `client_events` e `client_event_editions`: `allow read: if
  canReadOperations() || isOwnProjectionWith('wms')`; escrita `false`.
  `client_event_prices`: `canReadPrices() || isOwnProjectionWith('wms')`;
  escrita `false`. Teste em `functions/wms/src/eventos.rules.test.ts`.
- O portal assina as três coleções em `realtime-sync.tsx`
  (`CUSTOMER_AUTHORIZED_COLLECTIONS`, leitura `eventos`, que exige `wms`
  no contrato em `leiturasDoPortal`).
- Índices em `firestore.indexes.json`: `client_event_editions`
  (`customer_code` asc, `updated_at` desc) e (`customer_code` asc, `status`
  asc, `updated_at` desc) para o portal; (`status` asc, `separar_ate` asc)
  e (`status` asc, `updated_at` desc) para a agenda da Armazenagem, que
  mostra todos os clientes; `client_events` (`customer_code` asc, `status`
  asc, `name` asc). O que a tela consulta entra em `CONSULTAS_DAS_TELAS`
  (`lib/cloud-api-indices.test.ts`); o que as Functions consultam entra
  pelos testes de integração (o CI registra e reprova sem índice).
- Zeragem: tupla `EVENTOS_COLLECTIONS = ("client_events",
  "client_event_editions", "client_event_prices")` sempre preservada em
  `tools/full_reset_btg.py`, com o teste em `tools/test_full_reset_btg.py`,
  e a origem `functions_client_events`, com o tipo `evento.*`, entre as que
  a zeragem preserva em `events` (o legado grava a mesma origem com
  `client_event_template.*`, e esses vão embora). Os pedidos, volumes,
  devoluções e movimentos ligados continuam apagados: a edição guarda as
  próprias cópias (foi, voltou, lacre, volumes) para a história não depender
  deles. Com uma edição em aberto (de `enviado` a `no_evento`), a zeragem
  para antes de qualquer escrita e aponta as edições (decisão 11). Registro
  em `docs/novo-go-live-zeragem-total.md`. O legado `client_event_templates`
  continua apagado.

### Eventos de auditoria

Tipos novos, `source: functions_client_events`, `severity: info`,
`entity_type: client_event_edition`, payload `.strict()` só com ids,
contagens e instantes, sem valor, nome de pessoa nem contato:

`evento.edicao_salva`, `evento.edicao_enviada`, `evento.edicao_confirmada`,
`evento.edicao_separada`, `evento.edicao_no_evento`,
`evento.momento_registrado`, `evento.momento_corrigido`,
`evento.foto_anexada`, `evento.documento_anexado`,
`evento.documento_retirado`, `evento.retorno_registrado`,
`evento.preco_fechado`, `evento.edicao_fechada`, `evento.edicao_cancelada`,
`evento.edicao_excluida`, `evento.arquivado`.

A trava `functions/wms/src/domain/eventos/eventos-auditoria.test.ts` copia a
ideia do `events.test.ts` da Operação: todo tipo na lista, payload
`.strict()`, nenhuma chave de dinheiro ou contato, e nenhum tipo com as
palavras do roteador de avisos. `docs/contrato-eventos-ai-native.md` ganha
a lista. O `title` e a `description` não citam caixa (`CX-`).

### Liberação por ambiente e o legado

`EVENTOS_AMBIENTES_LIBERADOS` em `artifacts/app/src/lib/liberacao.ts` e a
cópia `EVENTOS_PROJECTS` em `functions/wms/src/domain/eventos/liberacao.ts`,
travadas por `platform-lists.test.ts` (precedente
`RECEBIMENTO_POR_CAIXA`). Nascem com `["dute-homolog"]`; o `dute-prod`
entra na última parte, com o OK do Leonardo. Fora da liberação as callables
novas recusam com `failed-precondition` ("Eventos ainda não liberados neste
ambiente.") e o portal mostra o Eventos de hoje, com o "Salvar como evento".
Na liberação, o portal troca de tela, o carrinho perde o "Salvar como
evento" e o `?evento=` do Estoque passa a ser o modo "montando o evento".
As três callables do legado saem na última parte.

### As telas

Toda tela nova leva o teste com a lista dos textos (`src/test/textos.ts`) e
o do `axe` (`src/test/acessibilidade.ts`), segue o carregamento v2
(`LinhaDeEstado`, `CarregandoNaRegiao`, `BotaoDeAcao`, diálogo que grava
não fecha no meio) e a regra "só rótulos, dados e ações". A prancha
aprovada é a referência; divergência vira pergunta.

#### Portal (visual do WMS, `LayoutDoPortal`)

- **`/portal/eventos`** (`EventosPortalLista.dc.html`): "Novo evento" no
  topo; um cartão por evento com a edição mais recente (status como selo,
  local, as datas do cronograma, itens e peças, "Ver edição" ou, no
  rascunho, "Continuar" e "Excluir rascunho"), as edições anteriores
  ("2026 · fechada") e "Nova edição a partir de <label>". Filtros:
  Próximas, Em andamento, Fechadas, Todas. Lê `client_events` e
  `client_event_editions` ao vivo.
- **`/portal/eventos/novo`** e **`/portal/eventos/edicao?id=`** em
  `rascunho` (`EventosPortalNovo.dc.html`): o formulário da edição. O
  evento (novo, ou um existente), Onde, Cronograma, "O que vai · do
  estoque Dutelog" como resumo (total, cinco famílias com a quantidade por
  tamanho, "Mostrando N de M", "Ver os M itens" e "Escolher no Estoque"),
  "O que vai · coleta no cliente", Observações, o layout e os anexos, e o
  "Resumo da edição" ao lado. A edição nasce no servidor quando o nome do
  evento existe (o primeiro campo): até lá o formulário guarda o estado na
  memória da aba; depois, a rota passa a `edicao?id=` (sem entrada no
  histórico) e cada mudança grava com atraso de um segundo
  (`saveEventEdition` com `patch` e `expected_edicao`); "Salvar rascunho"
  grava na hora; o cabeçalho diz "Salvo 14:32"; conflito de `edicao`
  recusa com "A edição mudou em outra aba" e relê. "Enviar para a Dutelog"
  chama `sendEventEdition` com as faltas de saldo mostradas antes. "Nova
  edição a partir desta" abre este formulário pré-preenchido com a edição
  anterior (sem datas e sem o feito) e grava `origem_edicao_id`.
- **Estoque, modo "montando o evento"** (`EventosPortalEstoque.dc.html`),
  `/portal/estoque?evento=<edition_id>`: a faixa no topo com o evento e o
  total, "Adicionar ao evento" e "Alterar no evento" nos cartões (a marca
  "No evento · 700"), o filtro "No evento", o painel "Itens do evento" com
  busca, poucas linhas, "Ver os N itens" e "Voltar ao evento". Cada
  adição grava `itens` pelo mesmo `saveEventEdition`. O carrinho de pedido
  avulso continua como é; os dois modos não se misturam na mesma visita.
- **Os itens do evento** (`EventosPortalItens.dc.html`): o diálogo com a
  lista inteira, busca, filtro por tipo, uma linha por família com a
  quantidade de cada tamanho, "Mostrando 16 de 100 · Ver mais 30",
  "Escolher mais no Estoque" e "Pronto".
- **A edição registrada** (`EventosPortalEvento.dc.html`),
  `/portal/eventos/edicao?id=` de `enviado` em diante: só leitura. O status,
  o pedido ("PED-0007 · 38 volumes · lacre 88412" com "Romaneio"), "O que
  aconteceu" (previsto × feito por momento), "O que foi e o que voltou"
  (busca, "Com diferença · N", "Ver os M itens", oito linhas à vista), o
  preço, o valor declarado e a proposta, as fotos por momento, os
  documentos (os anexados; o comprovante de entrega é o texto da expedição
  ou, quando a Dutelog anexou, o documento), as edições e "Nova edição a
  partir desta". "PDF da edição" é a impressão do navegador. "Cancelar"
  aparece em `enviado`.
- **`/portal/eventos/romaneio?id=`**: o romaneio do cliente, impresso da
  cópia `pedido.volumes` da edição com a folha de
  `features/warehouse-ops/romaneio-documento.tsx` (sem caixa, posição nem
  valor), como o manual da separação prevê.

#### Armazenagem (shell v3)

- **`/eventos`** (`EventosWmsLista.dc.html`): a agenda, de todos os
  clientes, como Pedidos. Grupos "Para confirmar" (enviadas), "Próximos"
  (confirmadas e separadas, por "separar até", e os rascunhos dos clientes
  como linha só de leitura, "Rascunho do cliente · ainda sem envio"), "Em
  andamento" (no evento) e "Para fechar" (retornadas, com o que falta como
  dado); cada linha com o cliente, o evento, as datas, o pedido e a ação do
  grupo, como na prancha: "Confirmar" ou "Confirmar e fechar preço" (o
  diálogo) com "Abrir" ao lado em "Para confirmar", "Abrir" em "Próximos",
  "Registrar" em "Em andamento" e "Fechar edição" em "Para fechar", cada
  link levando à ficha; quem não pode registrar ou fechar vê "Abrir". O
  "Ver pedido" fica na ficha. Lê `client_event_editions` por status.
  O "Novo evento" da prancha fica para depois (decisão 9). Entra em
  `TELAS_DO_WMS_NA_V3`, no menu (`lib/modules.ts`, papéis `WMS_ROLES`;
  escrita por `WMS_OPERATOR_ROLES`) e em `ROUTE_ACCESS`.
- **`/eventos/edicao?id=`** (`EventosWmsFicha.dc.html`): a ficha. O
  cabeçalho com o cliente, o evento, o pedido e o status; em `rascunho` a
  ficha só mostra os dados e "Anexar", e "Registrar" e "Adicionar fotos"
  valem de `confirmado` a `retornado`; em `enviado` e `confirmado`, "Onde"
  e o previsto de cada momento têm "Editar" (o `patch` da coordenação); "A edição, momento a momento" com Pedido
  confirmado ("Separar até" com "Editar" até separado), Separado (só
  leitura, "Ver pedido", "Romaneio"), os sete
  momentos com previsto, feito, quem, "Registrar", "Registrar fim" ou
  "Editar" (a correção), e "Fechar a edição" com o que falta como linha de
  dado; "Registrar o retorno ao estoque" (abaixo); "Preço fechado" só para
  quem lê valores; Fotos por momento com "Adicionar fotos" (também no
  celular, com `capture`); Documentos ("Anexar", com o momento);
  "Equipe e veículo" ("Editar"); Histórico (os `events` da edição, que
  `canReadObservability` já abre). Os diálogos de "Confirmar" (separar até
  e, para quem escreve valores, o preço e a proposta), "Registrar" (hora,
  observação; em Entrega no local, Quem levou, Placa e Quem recebeu quando
  o pedido ainda não saiu), "Editar" e "Fechar" são do construtor, dentro
  da v3.
- **O retorno na ficha**: a tabela com Item, Código, Foi, Voltou,
  Avariadas e Observação, busca, "Com diferença", "Por conferir" (as
  linhas que a pessoa ainda não tocou), "Os outros N voltaram iguais", "Ver
  mais 30", "Chegou em", a observação, as fotos do retorno e "Confirmar
  retorno". Com coleta, a linha "Produtos coletados no cliente" com
  Voltou e Distribuídos. O rodapé diz o que vai para Devoluções ("3
  avariadas · a devolução nasce com elas").
- **Início da Armazenagem, "Precisa de você"**: "Evento para confirmar"
  (coordenação), "Retorno do evento para registrar" (quem opera; a partir
  da entrega do pedido) e "Edição para fechar" (coordenação), de todos os
  clientes, por `buildHomeInbox`, com o ícone em `ICONE_DO_ITEM` e o
  `href` em `/eventos` para o contador do menu.
- **Pedidos**: a linha do pedido de evento diz "Evento · nome · label"; a
  ficha liga para o pedido ("Ver pedido") e a solicitação e o pedido ligam
  para a ficha ("Evento").

### Limites e mensagens

- Nome 120; descrição do evento 300; local 160; endereço 300; contato 120
  e 40; observação por momento 300; observações da edição e da Dutelog
  2000; coleta: onde 300; itens até 100, quantidade inteira
  de 1 a 1.000.000; momentos até 12 (cinco `outro`); fotos até 200;
  documentos até 20; legenda 60; equipe 120, 120, 60 e 120; retorno:
  observação por item 120, observação 500; motivo do cancelamento 500.
- A recusa diz o campo e o limite ("A observação de Montagem passa de 300
  caracteres", "Informe a data do evento", "Escolha ao menos um item ou
  informe a coleta no cliente"), nunca a frase genérica de hoje. O servidor
  manda a frase; a tela mostra no campo.
- Nenhuma chamada manda campo `undefined` (`semCamposVazios` nos
  wrappers de `lib/wms/eventos.ts`); `null` só em campo que o schema do
  servidor declara nullish: os textos livres opcionais (vazio vira `null`,
  como `optionalText` faz) e, de propósito, `ate`, `local`, `observacao`,
  `fim`, `separar_ate`, `rotulo`, os quatro campos de `equipe`,
  `evento.description` e a `hora` do momento fora da entrega no local
  (decisão 12).

### Testes e travas

- Unitários do domínio (`node --test`, na lista do `test:unit`): a máquina
  de status, a validação do cronograma, a conta do retorno, os payloads
  `.strict()` e a trava do roteador, a cópia literal de `lib/dominio`.
- Integração no emulador (lista do `test:integration`): cada callable com
  o caminho feliz, a recusa de status, a idempotência e o evento; o envio
  criando a solicitação com `event_edition_id`; o packing e a entrega
  escrevendo a edição (volumes e foi); o retorno com ENTRADA, guarda de
  volta, a devolução das avariadas e não voltaram; a correção de momento;
  o cancelamento nos três estágios e a exclusão do rascunho; as regras do
  Firestore e do Storage; a linha da régua de cobrança.
- Os dois testes de porta do WMS (`callables-auth`, `callables-papeis`)
  com as treze linhas; `customer-request.integration.test.ts`,
  `order-return.integration.test.ts` (a recusa do pedido de evento) e
  `operations.integration.test.ts` continuam verdes.
- No app: textos e `axe` de cada tela; `modules.test.ts` (`ROUTE_ACCESS`),
  `wms-v3.test.ts`, `home-inbox.test.ts`, `resumo-do-modulo.test.ts`,
  `home-view.test.tsx`, `cloud-api-indices.test.ts`, `platform-lists.test.ts`
  (a liberação), `document-title.test.ts`, `customer-literals.test.ts`,
  `theme-colors.test.ts` e a trava do carregamento; os testes do Estoque do
  portal (oito arquivos) com o modo novo e sem o "Salvar como evento".
- `lib/dominio/src/eventos.ts` (status, tipos de momento, limites) com a
  cópia literal em `functions/wms/src/domain/eventos/dominio.ts` travada
  por teste, como `areas-de-passagem`.

### Documentação

CLAUDE.md (bullet do WMS: coleções, callables, liberação, o que a zeragem
preserva); `docs/manual-portal.md` (a seção Eventos refeita; "Salvar como
evento" sai do Estoque); `docs/manual-armazenagem.md` (Eventos: agenda,
ficha, retorno; "Mostram todos" ganha a agenda); `docs/contrato-eventos-ai-native.md`
(os tipos); `docs/plataforma/lgpd.md` (linhas da seção 1: fotos do evento,
com pessoas, "Sem exclusão"; documentos do cliente, que podem trazer nomes;
contato no local; equipe; e o item de 4.1); `docs/novo-go-live-zeragem-total.md`;
`docs/api-cobertura.md` ("não coberto"); `docs/mockups/README.md` (o
registro de que entrou).

## Partes (um PR por parte, cada uma em sessão própria)

| Parte | O que entra | Pronto quando |
|---|---|---|
| 0 | Esta spec e as oito pranchas de `docs/mockups/` commitadas | PR mergeado |
| 0b | O conserto mínimo do legado, à parte e sem esperar o resto: `description`, `address`, `schedule` e `logistics` de `ClientEventInputSchema` sobem para 2000 e a recusa de `saveClientEventTemplate` diz o campo e o limite (decisão 8; sessão já proposta) | A cliente salva o evento da Necton como modelo hoje |
| 1 | `lib/dominio/src/eventos.ts` e a cópia no WMS; as três coleções nas regras, os índices, a tupla da zeragem e a origem preservada, os testes das regras e da zeragem; a liberação `EVENTOS_AMBIENTES_LIBERADOS` (`dute-homolog`) nas duas cópias e em `platform-lists.test.ts` | CI verde; nada muda no app |
| 2 | `saveEventEdition` (com a cópia de tamanho, tipo e foto), `sendEventEdition` (sem pedido ainda: só `enviado`), `cancelEventEdition` (cliente: excluir e cancelar), `archiveClientEvent`; o domínio da edição e do cronograma; recibos e eventos; a matriz; `lib/wms/eventos.ts` | Integração verde; o rascunho nasce, muda, envia, cancela e some no emulador |
| 3 | `storage.rules` com os quatro caminhos e os helpers; `attachEventDocument`, `removeEventDocument`, `attachEventPhoto`; a conferência no bucket; o teste das regras do Storage; as linhas da LGPD | Teste das regras verde; anexo e foto gravados no emulador |
| 4 | Portal: `/portal/eventos` e o formulário da edição (`novo` e `edicao?id=` em rascunho), com "Ver os N itens", os anexos, o nascimento do rascunho e a exclusão; rotas, `ROUTE_ACCESS`, títulos, `realtime-sync`, `CONSULTAS_DAS_TELAS`; só com a liberação | Textos e `axe` verdes; a edição da Necton (100 itens) sai do formulário no emulador |
| 5 | Estoque do portal, modo "montando o evento"; o "Salvar como evento" e o `applyEvent` saem com a liberação | Os oito testes do Estoque verdes; 100 itens escolhidos no emulador |
| 6 | O envio com pedido: `event_edition_id` na solicitação e no pedido, `sendEventEdition` criando a solicitação, o cancelamento pelo cliente cancelando a solicitação, a recusa de `receiveOrderReturn`, a linha "Evento · …" em Pedidos | `customer-request`, `order-return` e a régua verdes; o pedido nasce ligado à edição |
| 7 | Armazenagem: `/eventos` (agenda de todos os clientes), `confirmEventEdition` com o "separar até" (o preço fica para a 10), a confirmação e a recusa a partir de Pedidos, o cancelamento pela coordenação, o packing concluído (volumes e foi) e a entrega escrevendo a edição, o item "Evento para confirmar"; `TELAS_DO_WMS_NA_V3`, menu | A edição vai de enviada a no evento só pelo pedido, no emulador |
| 8 | Armazenagem: a ficha `/eventos/edicao`, `registerEventMoment` (com a entrega do pedido e a correção), `saveEventEditionTeam`, as fotos por momento e os documentos | A ficha registra, corrige e fotografa os sete momentos no emulador, no celular também |
| 9 | O retorno: `receiveEventReturn`, a ENTRADA na EXPEDICAO com a guarda de volta, a devolução das avariadas para Devoluções, não voltaram, a coleta; o bloco do retorno na ficha; o item "Retorno do evento para registrar"; a linha da régua | Retorno da Necton no emulador: de 2.000, 1.994 voltaram, 3 avariadas em Devoluções, 3 não voltaram; o Mapa e o Estoque batem |
| 10 | O preço: `client_event_prices` nas regras, `setEventEditionPrice`, o preço e a proposta no "Confirmar" de quem escreve valores, o caminho `valores/`; `closeEventEdition` com o que falta como dado; o bloco do preço na ficha (só para quem lê valores); o item "Edição para fechar" | O `wms` não vê o preço nem a proposta no emulador (regra e tela); a edição fecha |
| 11 | Portal: a edição registrada (`EventosPortalEvento`), o romaneio do cliente, o preço, o valor declarado e a proposta, as fotos, os documentos e "Nova edição a partir desta" | Textos e `axe` verdes; a Necton lida de ponta a ponta no emulador |
| 12 | Desligar o legado: as três callables de `client_event_templates` e o `events-api.ts` antigo saem; os manuais, o CLAUDE.md, o contrato de eventos, a cobertura da API; `dute-prod` na liberação com o OK do Leonardo | Publicação pelo roteiro, conferências verdes, a BTG recria o modelo que tiver |
| 13 | A história da Necton (decisão 8), sem prazo: `adoptOrderIntoEdition` (coordenação) liga um pedido existente a uma edição em `enviado` (grava `event_edition_id` na solicitação, no pedido e nas projeções, copia os volumes e o `foi` se já separado, e deduz o status da edição do status do pedido); `receiveEventReturn` com `sem_estoque: true`, só numa edição adotada cujo pedido já teve o retorno registrado por Devoluções, grava voltou, avariadas e não voltaram sem mexer no estoque | A edição 2027 da Necton registrada com o pedido de 24/11, as fotos e o retorno, lida no portal |

As partes 2 a 5 e 7 a 11 dependem da anterior do mesmo lado; a 4 pode
andar em paralelo com a 3; a 7 precisa da 6; a 0b anda sozinha, antes de
tudo; a 13 vem depois da 12.

## Perguntas respondidas pelo Leonardo (26/11/2026)

A conferência dos construtores deixou três perguntas que só ele responde;
as respostas são as decisões 7, 8 e 9, acima.

1. **O papel da conta do Guilherme**: `admin`. A prancha vale como está.
   As alternativas eram `interno` (confirma e fecha sem ver preço) e `wms`
   (só registra); se um dia ele precisar do Comercial, é uma segunda conta
   ou uma decisão de plataforma sobre o papel `comercial` no WMS.
2. **A Necton de 2027 no Eventos novo**: não. O conserto mínimo do legado
   sai agora (parte 0b) e a história da Necton entra pela parte 13, sem
   prazo. A alternativa era subir as partes 1 a 9 até 20/01.
3. **A Dutelog preencher em nome do cliente na v1**: depois. A alternativa
   era a parte 4b, o formulário do portal aberto pela equipe.

## Pronto quando

No emulador, de ponta a ponta com a edição da Necton: o cliente cria a
edição com 100 itens e 2.000 peças escolhidos no Estoque, o cronograma de
sete momentos e a coleta de 2.190 produtos, anexa o layout e envia; o
Guilherme, admin, confirma com o "separar até", o preço e a proposta; a bancada
separa com 38 volumes e o lacre; a ficha registra a entrega (o pedido vai a
entregue), a montagem, o evento, a desmontagem e a entrega de volta, com
fotos, e corrige uma hora digitada errada; o retorno registra, das 2.000
peças, 1.994 voltaram, 3 avariadas (que aparecem em Devoluções) e 3 não
voltaram, e 1.930 da coleta; o Guilherme fecha a edição; o portal mostra tudo, o
romaneio imprime, e abre a edição de 2028 a partir dela. O `wms` não vê o
preço nem a proposta em nenhum lugar. O Mapa, o Estoque, a lista de
separação e a cobrança continuam certos. Todos os jobs do CI verdes, e a
produção só com o OK do Leonardo.

## O que fica com quem constrói

- A forma dos diálogos da Armazenagem (Confirmar, Registrar, Registrar
  fim, Editar, Fechar, Confirmar retorno) e dos do portal (Ver os N itens,
  Cancelar, Excluir rascunho), dentro da v3 e do visual do portal e do
  carregamento v2.
- O componente de "Ver mais" (contador "Mostrando N de M" e o botão) e a
  página de 30 nas listas longas; reaproveitar `CatalogProgress` ou fazer
  um só para as seis listas.
- Como o modo "montando o evento" marca os cartões já no evento e o
  painel lateral, dentro dos componentes do Estoque de hoje (`FamilyCard`,
  `SideDrawer`, `MarketplaceToolbar`).
- O id do documento da edição e dos momentos, os nomes exatos dos campos
  dentro dos limites acima, e a ordem das escritas na transação do envio e
  na do retorno.
- Como reaproveitar a guarda de volta do cancelamento no retorno (a mesma
  função ou uma extraída dela), o tratamento do SKU que o pedido separou
  de mais de uma prateleira, e se `createReturnReceiptTransaction` entra na
  transação do retorno ou tem o corpo copiado.
- O esqueleto de cada tela enquanto lê e para onde vai o foco quando cada
  diálogo fecha.

## Escolhas minhas, para conferir

- "Separado", "Entregue" e "Retornado" são fatos do pedido e do retorno,
  nunca digitados: o que a ficha registra à mão são os outros momentos, e
  só esses se corrigem (a hora que veio do pedido ou do retorno, não).
- Confirmar a edição é aprovar o pedido, pela coordenação (owner, admin,
  interno); registrar é de quem opera (owner, admin, interno, wms). O
  preço entra no mesmo diálogo só para quem escreve valores (owner,
  admin) e, para os outros, depois, pelo financeiro.
- O preço fechado, o valor declarado e a proposta nunca aparecem para o
  `wms`; leem owner, admin, financeiro, comercial e o próprio cliente.
- Só a Dutelog fotografa; o cliente anexa documentos (layout, planilha) até
  a edição ser retornada.
- A agenda da Armazenagem e o "Precisa de você" mostram todos os clientes,
  como Pedidos e Início; a ficha é de uma edição.
- O retorno é um registro só, por item, com a entrada na EXPEDICAO e a
  guarda de volta, só depois do pedido entregue; as avariadas nascem como
  devolução para a triagem de Devoluções; as que não voltaram só ficam
  registradas; a coleta conta à parte, sem estoque.
- Só o retorno trava o fechamento; o resto é dado na tela.
- O rascunho pode ser excluído pelo cliente, ou pela coordenação em nome
  dele; a edição enviada pode ser cancelada pelo cliente até a confirmação
  e pela Dutelog até o separado; o evento é arquivado sem edição aberta.
- O cliente só edita em rascunho; a coordenação ajusta onde, cronograma
  previsto e label até confirmado e o "separar até" até separado, nunca os
  itens depois do envio (o pedido já reservou).
- Uma edição leva até 100 itens do estoque (um pedido). A edição sem item
  do estoque existe: só coleta, serviço e registro.
- A edição copia tamanho e tipo de cada item e o conteúdo dos volumes ao
  separar, para a história fechada se bastar e o cliente abrir o romaneio
  sem ler as coleções da equipe; a foto do item fica no Estoque.
- O rascunho nasce no servidor com o nome do evento e vive lá desde então
  (gravação com atraso de um segundo e CAS por `edicao`), não no
  `localStorage` do carrinho.
- As leituras são pelas regras, ao vivo, e não por callable; por isso as
  três coleções são projeções próprias do cliente, sem dinheiro.
- A liberação por ambiente é própria (`EVENTOS_AMBIENTES_LIBERADOS`),
  homologação primeiro; o legado continua até a última parte.
- Avisos e fatura ficam para depois, em partes próprias.
