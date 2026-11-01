# Recebimento com caixas: avaliação do fluxo e desenho da fase 1 do mapa

**Situação:** desenho aprovado nas decisões pelo Leonardo em 01/11/2026
(seção 6); as telas ainda esperam o mockup e nada está construído. Motivo: em 30/10/2026 a equipe recebeu uma NF da BTG pela chegada
avulsa, guardou as 71 peças em B-02 e o sistema não deu etiqueta nem mostrou
caixa no Mapa, porque o recebimento de hoje não conhece caixa. O fluxo real do
galpão é por caixa; o sistema só tem caixa na contagem de abertura. O desenho
aprovado em 16/10/2026 (`docs/mapa-do-armazem-enderecamento-dirigido.md`,
seção 2) já decidiu que medidas e peso são informados por caixa **no
recebimento** e que toda caixa sai com etiqueta; a entrega dessa parte ficou
como "fase 1, logo após o go-live" (seção 5.3) e não começou.

Documentos relacionados: `docs/mapa-do-armazem-enderecamento-dirigido.md`
(modelo de posição e caixa, motor, etiquetas, pendências P1 a P10),
`docs/wms-abertura-correcoes.md` (estados da caixa e a guarda retomável),
`docs/manual-armazenagem.md` (Receber, Contagem, Mapa, Etiquetas) e
`docs/api.md` (recebimentos pela API REST v1).

## 1. O fluxo real, como a equipe trabalha

1. O fornecedor entrega no galpão, em caixas.
2. A equipe recebe os volumes e pega a nota fiscal.
3. Confere o que chegou com a NF: volumes, itens e quantidades.
4. Entra em Estoque › Receber e lança o que chegou, caixa a caixa.
5. Cada caixa vai para uma prateleira, com etiqueta; o Mapa e a cobrança por
   posição refletem o que está no galpão.

Não existe contagem aí: a Contagem é a abertura do inventário e a contagem
cíclica. Receber mercadoria pela Contagem não faz sentido para a operação e
não é o que o manual ensina.

## 2. O que o sistema faz hoje

### 2.1 Três portas de entrada da chegada

| Porta | Quem usa | O que cria |
|---|---|---|
| Chegada avulsa (Receber) | Equipe do galpão | A chegada com linhas por produto, sem aviso. |
| Aviso de envio do cliente (portal › Envios) | Cliente, aprovação da coordenação em Solicitações | A chegada com as linhas do aviso; a aprovação acha o cadastro pelo código do cliente. |
| Documento (Documentos › NF › "criar recebimento") | Operação e WMS | A chegada a partir das linhas lidas da nota; exige linhas estruturadas suficientes. |

As três convergem na mesma ficha da chegada e na mesma callable de
conferência. A API REST v1 (`/api/v1/armazenagem/recebimentos`, criar,
conferir e avançar) usa as mesmas funções de domínio; a guarda está fora da
API.

### 2.2 Da ficha da chegada até a prateleira

1. **Ficha da chegada:** aviso do cliente, referência, prazo e as linhas, cada
   uma com "Físico", "Local" (vem `RECEBIMENTO`) e "Custo". "Salvar
   conferência" marca "OK físico", falta ou sobra; divergência pede
   justificativa.
2. **"Concluir entrada"** lança o saldo de cada linha no local dela e cria
   **uma tarefa de guarda por linha** que ficou em `RECEBIMENTO`, com destino
   vazio (`advanceWarehouseTaskTransaction`, `functions/wms/src/domain/operations.ts`).
3. **Guarda:** a tarefa lista as prateleiras ativas da zona do cliente ("Bipe
   ou busque a prateleira"); "Concluir guarda" move o saldo de `RECEBIMENTO`
   para a prateleira (`stock_balances`, `movements`, evento).

Telas de 30/10/2026, percorridas no ambiente local: a chegada avulsa, a
ficha, a conferência, a guarda com a lista de prateleiras e o Mapa depois.

### 2.3 O que falta nesse caminho

- **Não há caixa.** A chegada não tem volumes, medidas nem peso; nenhuma
  `warehouse_boxes` é criada; o saldo vai para a prateleira solto.
- **Não há etiqueta de caixa.** A etiqueta de caixa existe só para caixa
  guardada (`/estoque/etiquetas`, aberta pela Contagem). O recebimento só tem
  a etiqueta da posição.
- **O Mapa e "Posições ocupadas" contam caixas.** A prateleira com 71 peças
  recebidas aparece "sem caixas registradas" e não entra na referência da
  fatura manual (pendência P3: "uma caixa guardada conta uma posição").
- **A guarda não é dirigida.** O motor de endereçamento (mesmo produto, perto
  do produto, primeira livre; cabe ou não cabe) só roda na Contagem; na
  guarda do recebimento o operador escolhe qualquer prateleira ativa da zona,
  sem cálculo de encaixe nem sugestão.
- **Uma guarda por linha, não por caixa.** Uma NF com 12 tamanhos vira 12
  tarefas de guarda, mesmo que tudo esteja em duas caixas.

### 2.4 O que a Contagem já tem e serve de molde

A conferência da caixa de abertura (`inventory.tsx`, `warehouse-boxes.ts`) faz
o que o recebimento precisa: "Iniciar conferência da caixa" gera o `CX`; os
produtos entram na caixa como rascunho; "Revisar e fechar caixa"; medidas e
peso; "Guardar em" com "Sugestão do sistema" ou "Escolher prateleira", com o
encaixe conferido; "Confirmar guarda em A-03" reserva a prateleira
(`committing`), publica cada linha e fecha a caixa (`stored`); "Imprimir
etiqueta"; "Retomar guarda" se parar. O que está amarrado à abertura: a sessão
(`opening_inventory_sessions`), as linhas da abertura, `opening_closed`, a
regra de que a prateleira escolhida à mão entra mesmo sem encaixe
confirmado, e a conclusão do inventário. "Cadastrar caixa já armazenada" é
exceção para corrigir vínculos: cria a caixa guardada sem conteúdo.

## 3. O que já está decidido e o que está em aberto

Decidido em 16/10/2026 (mapa, seção 2): prateleira de comprimento livre;
**medidas e peso por caixa no recebimento e na abertura**; três tamanhos
padrão mais caixa de fornecedor medida na hora; **toda caixa sai com etiqueta,
na guarda e na expedição**; regras de posição (mesmo SKU, caixa ao lado, livre
mais próxima, zona por cliente); cobrança por posição ocupada com o mapa como
base. Pendências que tocam este desenho: P2 (tamanhos padrão de caixa, ainda
sem medidas), P3 (caixa guardada conta uma posição, fatura segue manual), P7
(unidades por caixa declaradas na hora), P10 (balança: sim).

Em aberto, porque a fase 1 não foi desenhada em tela: o recebimento ficou no
modelo anterior ao mapa (saldo por posição, guarda por linha). Não há mockup
de recebimento com caixa na pasta `docs/mockups` (há `ModWms.dc.html`,
`ModEntrada.dc.html` e `WmsExpedicao.dc.html`), e a regra da plataforma é
tela desenhada e aprovada antes de PR de tela.

## 4. Desenho proposto

Princípios: a caixa é a unidade de manuseio também na entrada; a NF é o
esperado; a conferência é por caixa, como na abertura; o motor direciona e o
operador confirma; a etiqueta sai com o destino; caixa e saldo mudam na mesma
transação; nada muda no ledger, na cobrança atual nem na API.

### 4.1 Chegada

A chegada continua nascendo pelas três portas. Ganha dois dados opcionais:
**volumes declarados** (na NF) e **volumes recebidos** (contados na portaria,
antes de abrir). O esperado da conferência são as linhas da NF, como hoje.

### 4.2 Conferência por caixa

Na ficha da chegada, no lugar de "Físico" por linha:

1. **"Iniciar caixa"** gera o `CX-` com origem na chegada (`origin: recebimento`,
   número da chegada e da NF) e situação "em conferência".
2. **Lançar o que está na caixa:** cada produto das linhas da NF, com a
   quantidade física contada; a busca acha pelo código do cliente, SKU ou
   código de barras no catálogo inteiro; produto que não está na NF entra como
   sobra; produto novo segue a regra de hoje (foto, categoria, custo, SKU
   gerado). Caixa do fornecedor com vários tamanhos é normal.
3. **"Fechar caixa":** comprimento, largura, altura e peso (balança); "pode
   virar de lado" e "pode empilhar". A caixa é a do fornecedor, como chegou,
   medida na hora (decisão 2); tamanhos padrão (P2) não são pré-requisito.
4. **"Onde guardar?":** a sugestão do motor (mesmo produto, perto do produto,
   primeira livre da zona) ou "Escolher prateleira", com o encaixe conferido.
   Fora da abertura, o encaixe bloqueia, como já previsto.
5. **"Confirmar guarda em B-02":** a caixa fica reservada, o saldo entra na
   prateleira na mesma transação (sem passar por `RECEBIMENTO`) e a caixa vira
   "guardada". **"Imprimir etiqueta"** no fim; "Retomar guarda" se parar.

O "Físico" de cada linha da NF passa a ser a soma do que foi lançado nas
caixas; falta e sobra são calculadas, e a justificativa da divergência continua
como hoje.

### 4.3 Concluir entrada

"Concluir entrada" fecha a chegada só quando todas as caixas estão guardadas e
toda linha da NF foi tratada (conferida em caixa, ou marcada como falta); não
há chegada concluída com caixa por guardar (decisão 5). Não nasce mais tarefa
de guarda por linha para o que foi em caixa. A tarefa de guarda solta continua
existindo só para o que não entra em caixa: devolução e cancelamento de pedido
(que também guardam a partir de `RECEBIMENTO`) ficam por linha (decisão 8),
até a fase da movimentação de caixa.

Ao concluir, o cliente é avisado de que chegou produto novo, com a descrição
dos itens e as quantidades, sem valor (decisão 7): um modelo novo na lista de
avisos da Operação (`functions/operacao/src/domain/avisos.ts`, a mesma rotina
`runNotifications` que manda "Itens parados"), por e-mail aos contatos do
cliente e no sino do portal (`client_notifications`). O portal não mostra as
caixas nem a posição.

### 4.4 Etiqueta

A mesma etiqueta de caixa de hoje (código em barras, posição em destaque,
cliente, medidas, peso, origem, data, produtos e unidades), com origem
"Recebimento · NF 48.212". Sai no fim de cada caixa e em "Etiquetas da
chegada" (todas as caixas da chegada, dez por folha A4 ou uma por etiqueta). O
conteúdo vem das linhas da caixa, então a etiqueta se imprime depois de
fechar a caixa e antes de levá-la à prateleira, com o destino já impresso.

### 4.5 Mapa, posições ocupadas e cobrança

A caixa guardada pelo recebimento entra no Mapa e em "Posições ocupadas" na
hora, como a da abertura. A cobrança não muda: a fatura segue manual com a
referência do Mapa (P3, P4); a fase 2 (snapshot diário) continua pendente. O
que muda é que a referência passa a enxergar o que entrou depois da abertura.

### 4.6 Dados

- `warehouse_boxes`: ganha `origin` (`opening` ou `receipt`, com `receipt_id`,
  `receipt_number`, `invoice_number`) e o conteúdo ligado às linhas da chegada
  (`inbound_item_id`, SKU, quantidade). O ciclo de vida é o mesmo:
  `counting` → `reviewed` → `committing` → `stored`.
- `inbound_items`: `received_qty` passa a ser derivada das caixas; ganha a
  lista de caixas (`box_codes`) para a ficha e a timeline.
- Eventos: `box.created`, `putaway.suggested`, `putaway.confirmed`,
  `putaway.refused`, `inbound.box_stored`, no mesmo fluxo da escrita
  (invariante 2).
- Idempotência e recibos como hoje; `customer_code` em tudo (invariante 4);
  nenhuma coleção nova, então a zeragem não muda.

### 4.7 API REST v1 e portal

Os endpoints de recebimento continuam valendo: criar, conferir por linha e
avançar. A integração que confere por linha, sem caixa, continua funcionando
(a chegada fica como hoje, com guarda por linha). Caixas pela API ficam para
depois, se alguma integração precisar. O portal do cliente segue vendo a
chegada e o saldo e recebe o aviso de produto novo; não vê caixa nem posição
(decisão 7).

## 5. Partes, em ordem

Um problema por PR, com teste que falha antes e passa depois, e tela desenhada
e aprovada antes do PR de tela.

1. **Mockup** da ficha da chegada por caixa (computador e celular), no canvas
   v3, com os textos finais (sem legenda; rótulos, dados e ações).
2. **Domínio: caixa com origem no recebimento.** Generalizar
   `warehouse-boxes.ts`: origem, conteúdo por linha da chegada, guarda que
   move o saldo da chegada direto para a prateleira na mesma transação, sem a
   sessão de abertura e com o encaixe bloqueando. Testes de integração: cabe e
   não cabe, mesmo produto, retomar, repetir a mesma chave, outro cliente,
   zona cheia.
3. **Ficha da chegada por caixa (tela):** iniciar caixa, lançar linhas da NF,
   fechar com medidas, onde guardar, confirmar, imprimir etiqueta; "Físico"
   derivado; divergência automática. Testes de textos e `axe`.
4. **Concluir entrada por caixas:** fecha a chegada pelas caixas; a guarda
   por linha fica só para o que não foi em caixa; API inalterada
   (`api.integration.test.ts`).
5. **Etiquetas da chegada** na tela de Etiquetas e o atalho na ficha.
6. **Aviso ao cliente de produto novo:** modelo na lista de avisos da
   Operação, disparado pelo evento de entrada concluída, com a descrição dos
   itens e as quantidades, sem valor; e-mail e sino do portal. Teste de
   integração como os dos outros modelos (`avisos.integration.test.ts`).
7. **Volumes na portaria** (declarados e recebidos) e o aviso de diferença.
8. **Confirmação por leitura** (bipar posição e caixa) e, depois, ZPL para a
   Zebra, como já previsto na fase 1 e 2 do mapa.

Manual, treinamento e a seção 5.3 do desenho do mapa são atualizados junto
com cada parte.

## 6. Decisões do Leonardo (01/11/2026)

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Caixa obrigatória em toda chegada? | Sim, no modelo de uniformes; mobiliário e insumos decidem no modelo de operação de cada um. |
| 2 | A caixa do fornecedor fica como chegou ou a equipe reembala em caixa padrão? | Fica como chegou do fornecedor; a equipe mede a caixa dele. Tamanhos padrão (P2) não são pré-requisito. |
| 3 | Vários tamanhos na mesma caixa? | Sim; os fornecedores entregam mais de um tamanho na mesma caixa. |
| 4 | Como a NF entra? | Digitada na chegada avulsa e pelo Documentos (leitura com revisão) agora; XML depois. |
| 5 | Concluir entrada só com tudo guardado? | Sim: a chegada não se conclui com caixa por guardar. |
| 6 | Impressora no recebimento? | Sim: a etiqueta sai antes de levar a caixa à prateleira; impressora comum agora, Zebra depois. |
| 7 | Portal do cliente mostra as caixas? | Não. O cliente só é avisado de que chegou produto novo, com a descrição dos itens; pode ser por e-mail. |
| 8 | Devolução e cancelamento de pedido em caixa? | Não; continuam na guarda por linha. |

## 7. O que não muda

O ledger `stock_balances` por cliente, SKU e posição; as invariantes (escrita
crítica por Function, evento em `events`, IA só recomenda, `customer_code`
como fronteira, permissão em Rules e backend); a contagem de abertura e a
cíclica; a cobrança atual; a API REST v1.
