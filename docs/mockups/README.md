# Mockups v3 da plataforma Dute

Identidade visual do app único, aprovada pelo Leonardo em 19/10/2026. O canvas
com as 14 telas fica em https://claude.ai/artifact/KzkB7KUsJFB1fKAVsMPWse
(privado); os arquivos `*.dc.html` desta pasta são as fontes de cada tela.

| Tela | Arquivo |
|---|---|
| Login | `Main.dc.html` |
| Início | `Inicio.dc.html` |
| TV da sala de operações (`/tv`) | `TVSala.dc.html` |
| Operação (kanban do dia) | `Operacao.dc.html` |
| Nova OS | `OSNova.dc.html` |
| Detalhe da OS | `OSDetalheV2.dc.html` |
| Impressão da OS (A4, via operacional) | `OSImpressao.dc.html` |
| Financeiro | `Financeiro.dc.html` |
| Relatórios | `Relatorios.dc.html` |
| Clientes | `Cadastros.dc.html` |
| Portal do cliente | `Portal.dc.html` |
| Campo: OS do dia | `CampoV2.dc.html` |
| Campo: detalhe da OS | `CampoDetalhe.dc.html` |
| Campo: concluir | `CampoConcluir.dc.html` |

As telas do Comercial, aprovadas em 20/10/2026, ficam na página "Comercial ·
orçamentos e contratos" do mesmo canvas. O desenho está em
`docs/plataforma/fase-6-comercial.md`.

| Tela | Arquivo |
|---|---|
| Comercial · orçamentos | `ComFila.dc.html` |
| Montar orçamento | `ComOrcamento.dc.html` |
| Aprovar no celular | `ComAprovarCelular.dc.html` |
| PDF do orçamento (A4) | `ComDocumento.dc.html` |
| Clientes e prospects | `ComClientes.dc.html` |
| Contrato | `ComContrato.dc.html` |
| Autorizações de faturamento | `ComAutorizacoes.dc.html` |
| Medição mensal | `ComMedicaoMensal.dc.html` |

A página "Operação · demandas e OS" do canvas traz a proposta "Demanda: do
pedido ao faturamento", feita entre 17 e 19/10/2026 e recuperada para o
repositório em 23/10/2026 (até então só existia no canvas). As premissas e as
nove perguntas "para validar com a operação" estão nas notas da página e em
`docs/plataforma/alinhamento-comercial-operacao.md`, seção 2.5.

| Tela | Arquivo |
|---|---|
| Fluxo da demanda | `OpFluxo.dc.html` |
| Nova demanda direta (paraquedas) | `OpDemandaNova.dc.html` |
| Comercial · fila (versão da proposta) | `ComOrcamentos.dc.html` |
| Armazenagem · pedido de saída com entrega Dutelog | `WmsExpedicao.dc.html` |
| Operação · hoje (kanban) | `OpHoje.dc.html` |
| Operação · agenda da semana | `OpAgenda.dc.html` |
| Operação · demandas | `OpDemandas.dc.html` |
| Demanda planejada (várias OS) | `OpDemanda.dc.html` |
| Planejar OS a partir do saldo | `OpOSPlanejar.dc.html` |
| OS em execução (escritório) | `OpOS.dc.html` |
| Campo · minhas OS (líder) | `Campo2Hoje.dc.html` |
| Campo · OS em execução | `Campo2Execucao.dc.html` |
| Campo · incluir item executado | `Campo2IncluirItem.dc.html` |
| Campo · concluir com assinatura | `Campo2Concluir.dc.html` |
| Campo · OS de vistoria | `Campo2Vistoria.dc.html` |
| Revisão interna da OS | `OpRevisao.dc.html` |
| Comercial · aditivo de orçamento | `ComAditivo.dc.html` |
| Comercial · orçamento da execução (paraquedas) | `ComMedicao.dc.html` |

A página "Shell por módulo · 23/10" registra as decisões de UX e UI de
23/10/2026 (um shell por módulo na v3, seletor de módulo no topo da barra,
Início por módulo, cards da entrada com contadores, Clientes por módulo, fila
do dia com "Para planejar", celular por módulo). As telas são interativas: o
seletor abre no clique.

| Tela | Arquivo |
|---|---|
| Entrada · cards com contadores | `ModEntrada.dc.html` |
| Comercial · Início (shell v3, seletor no topo) | `ModComInicio.dc.html` |
| Operação · Início (shell v3, seletor no topo) | `ModOpInicio.dc.html` |
| Operação · Hoje (Para planejar, agendar, agendadas, execução, revisão) | `ModOpHoje.dc.html` |
| Operação · Clientes (locais, só leitura) | `ModOpClientes.dc.html` |
| Armazenagem · barra de hoje, só ganha o seletor | `ModWms.dc.html` |
| Celular · Comercial (Guilherme, um módulo) | `ModCelularCom.dc.html` |
| Celular · Operação (seletor no cabeçalho) | `ModCelularOp.dc.html` |

A página "Portal · gênero no cartão do estoque" tem canvas próprio (privado,
https://claude.ai/artifact/2NH76ezJdQkmF6ZvDrCBtZ): a proposta de 23/10/2026
para o Estoque do portal mostrar o que é feminino e o que é masculino sem
depender de ler o nome. As telas seguem o visual do WMS
(`docs/sistema-visual.md`), não a v3, porque o Estoque do portal ainda é tela
do WMS.

O Leonardo aprovou a opção A em 23/10/2026, e ela está no app: chip com
símbolo e cor no canto direito da foto (FEM rosa, MASC azul-petróleo), na linha
do tipo quando o cartão não tem foto, ao lado do nome na lista e junto do tipo
no detalhe. Sem gênero, sem chip. O gênero sai do nome que o cartão mostra
(`productGender` em `artifacts/app/src/lib/portal-stock.ts`), não do campo
Gênero do cadastro: a Contagem pré-preenche esse campo pelo prefixo do código
(A.01 vira Masculino), e a polo feminina A.01.0805.002 tem esse prefixo. O
filtro por gênero da prancha principal ficou fora; entra se o Leonardo pedir.

| Tela | Arquivo |
|---|---|
| Estoque · cartões com o chip de gênero (A, aprovada) | `PortalEstoqueGenero.dc.html` |
| Alternativas: A suave, B sólido, C só na linha de apoio | `PortalEstoqueGeneroAlternativas.dc.html` |
| Estoque · lista | `PortalEstoqueGeneroLista.dc.html` |

A página "Portal · Estoque no celular" tem canvas próprio (privado,
https://claude.ai/artifact/6A71eDbVNzN48CyVQiEJda), aprovado pelo Leonardo em
23/10/2026. No celular, a barra de busca e filtros ocupava quatro linhas presas
no topo, e com o título também preso sobrava um terço da tela para os
produtos. Na proposta, só a busca e o botão de filtros (com a contagem do que
está ativo) ficam presos; situação, tipo, ordem, cards ou lista e agrupar
tamanhos vão para o painel "Filtros", e o que está ativo aparece em etiquetas
acima da lista. O título rola junto com a lista em todas as telas do cliente
no celular. As telas seguem o visual do WMS e medem 390 × 710, a área útil do
Safari no print que motivou a mudança. No app, os botões de situação e ordem
usam o `Chip` do sistema (selecionado em tinta), não o azul do mockup.

| Tela | Arquivo |
|---|---|
| Hoje (igual ao print) | `PortalEstoqueCelularHoje.dc.html` |
| Proposta, interativa (busca, filtros, cards ou lista) | `PortalEstoqueCelular.dc.html` |
| Proposta rolando a lista | `PortalEstoqueCelularRolando.dc.html` |
| Proposta com o painel Filtros aberto | `PortalEstoqueCelularFiltros.dc.html` |

A parte 8.4 do RH (as datas de admissão e de desligamento) tem canvas próprio
(privado, https://claude.ai/artifact/P3dXT4G48unzy3tCK3whM1), aprovado pelo
Leonardo em 26/10/2026 com as quatro recomendações: as datas no banco
`dute-rh`, gravadas só pelo `rh`; o desligamento independente do cadastro da
Operação; o próprio sem admissão na planilha se está ativo; "Sem admissão" em
Pessoas e na Exportação, fora do "Precisa de você"
(`docs/plataforma/fase-8-rh.md`, "Alinhamento da parte 8.4"). No app, os links
da lista "Sem data de admissão" seguem os das outras telas v3 (sublinhados, na
cor do texto), não o azul do mockup.

| Tela | Arquivo |
|---|---|
| RH · ficha com as datas do vínculo (interativa: o formulário abre e fecha) | `RhFichaVinculo.dc.html` |
| RH · Pessoas com as datas e o "Sem admissão" | `RhPessoasVinculo.dc.html` |
| RH · Exportação com quem está sem admissão | `RhExportacaoVinculo.dc.html` |
| RH · planilha de colaboradores de setembro de 2026 | `RhPlanilhaVinculo.dc.html` |

A página "Recebimento com caixas" não tem canvas: as onze telas foram
enviadas na conversa em duas versões, e a versão 2 foi aprovada pelo Leonardo
em 01/11/2026, junto com as treze decisões de
`docs/plataforma/recebimento-com-caixas.md` (seção 6). As telas da Armazenagem
seguem o shell v3 (menu da Armazenagem, cliente ativo BTG, Guilherme, Operação
WMS); a do portal segue a identidade do portal; o e-mail segue o molde dos
e-mails de convite e de confirmação (`convite-email-template.ts`). As fontes
são estáticas (sem interação). O que cada tela muda em relação ao app de hoje,
pelas decisões:

| Tela | Arquivo | O que muda |
|---|---|---|
| Armazenagem · Registrar chegada avulsa | `WmsChegadaAvulsa.dc.html` | Volumes na NF e volumes recebidos; "Ler itens da nota" pré-preenche as linhas, com revisão (decisão 4); custo unitário da NF por linha, informado pela operação (decisão 12); o selo "Conferência por caixa" para o cliente cujo modelo pede caixa (decisão 1). |
| Armazenagem · Ficha da chegada por caixa | `WmsRecebimentoCaixa.dc.html` | Conferência por caixa no computador da bancada (decisão 11): "Iniciar caixa", as linhas da NF dentro da caixa, vários tamanhos na mesma caixa (decisão 3), a coluna "Custo NF", "Marcar falta" e "Concluir entrada" só com toda linha tratada e toda caixa fechada. Depois da aprovação, a decisão 14 (02/11/2026) liberou concluir com caixa fechada sem prateleira, que ganha o destino na guarda: o mockup ainda desabilita o botão nesse caso e precisa de novo alinhamento antes da tela da parte 5. |
| Armazenagem · Fechar caixa e onde guardar | `WmsRecebimentoFecharCaixa.dc.html` | Medidas e peso da caixa do fornecedor, como chegou (decisão 2); "pode virar de lado" e "pode empilhar"; a prateleira sugerida pelo motor, com as alternativas; "Confirmar destino", "Não cabe aqui" e "Imprimir etiqueta" antes de levar a caixa (decisão 6). |
| Armazenagem · Receber, a fila | `WmsReceberFila.dc.html` | A chegada fica em "Recebidas, por guardar" até a última guarda ("1 de 3 caixas guardadas", decisão 5); "Para guardar" lista uma guarda por caixa, com o destino. |
| Armazenagem · Guarda da caixa | `WmsGuardaCaixa.dc.html` | A guarda é da caixa inteira: destino, conteúdo, "Concluir guarda em B-02", "Não cabe aqui" e a timeline (caixa fechada, destino confirmado, etiqueta impressa). |
| Armazenagem · Guarda da caixa no celular | `WmsGuardaCaixaCelular.dc.html` | A mesma guarda no celular, que é onde a equipe guarda (decisão 11). |
| Etiqueta da caixa do recebimento | `WmsEtiquetaCaixaRecebimento.dc.html` | A etiqueta de caixa de hoje com a origem "Recebimento · NF 48.230" e o conteúdo da caixa. |
| Armazenagem · Mapa | `WmsMapaRecebimento.dc.html` | A prateleira mostra a caixa do recebimento guardada e a reservada (destino confirmado, por guardar), com a origem e o conteúdo. |
| Portal · Estoque | `PortalEstoqueRecebimento.dc.html` | "Disponível para pedido" só do que está na prateleira e "Em recebimento" separado, sem pedido (decisão 10); o sino com "Chegou produto novo", itens e quantidades, sem caixa nem posição (decisão 7). |
| E-mail ao cliente · Chegou produto novo | `EmailProdutoNovo.dc.html` | HTML na identidade da Dutelog (decisão 13), enviado quando a última caixa da chegada é guardada; itens, quantidades e total, sem valor; botão "Ver estoque no portal". |
| Armazenagem · Posições, encaixotar o saldo sem caixa | `WmsEncaixotarSaldo.dc.html` | Correção pontual (decisão 9), para owner, admin e coordenação: pelo painel da prateleira com saldo sem caixa, "Registrar caixa com o saldo" com medidas, motivo e etiqueta; a ação some quando esse saldo acaba. |

A página "FIFO por data" não tem canvas: as duas telas das partes 5 e 6 de
`docs/plataforma/fifo-por-data.md` foram enviadas na conversa em 03/11/2026 e
esperam a aprovação do Leonardo antes do código. A do portal segue a
identidade do portal; a da Armazenagem, o shell v3 (Estoque › Itens, cliente
ativo BTG, Guilherme, Operação WMS). As fontes são estáticas e os números
fecham entre as duas: 16 peças de 22/10/2026 em B-05, 30 de 30/10/2026 e 60 de
03/11/2026 em B-02, 10 reservadas.

| Tela | Arquivo | O que muda |
|---|---|---|
| Portal · Estoque, detalhe do produto | `PortalEstoqueDatas.dc.html` | A seção "Por data de entrada": uma linha por data, "desde DD/MM/AAAA" e as peças, da mais antiga para a mais nova (seção 3.3). Só o que está nas prateleiras, sem prateleira nem caixa; o "Em recebimento" segue sem data. "desde" é a data de entrada e não se confunde com o "sem movimento há N dias" do aviso "Itens parados". |
| Armazenagem · Estoque › Itens, ficha do item | `WmsItemDatas.dc.html` | "Onde está" ganha a data: uma linha por prateleira e data, com a quantidade, e a prateleira de data mais antiga primeiro (seção 3.4). A linha mais antiga de cada prateleira é a sobra da caixa aberta. `RECEBIMENTO` e `EXPEDICAO` seguem sem data, e o que as entradas não cobrem aparece como "sem data". A lista não muda. |

## Regras da v3

- Menu lateral preto `#161616` com logo branco; item ativo com marcador
  vermelho. Desde 23/10/2026 cada módulo tem o próprio shell (Armazenagem,
  Comercial, Operação): o menu lista o Início e as telas daquele módulo, o
  nome do módulo no topo da barra é o seletor para trocar de módulo e o logo
  leva à entrada por cards. As telas anteriores, com os seis módulos num menu
  só, valem pelo conteúdo, não pelo menu.
- Conteúdo `#F5F5F3`, cartões brancos com borda `#E5E5E1` e raio 12.
- Vermelho da marca `#E71C23` (hover `#AD0015`) só na ação principal da tela, uma
  por tela, e em alertas. No app ele é o token `--v3-marca` (igual nos dois temas) e,
  no claro, o `--primary` dentro de `.v3`. Links no azul da marca `#0054CE`.
- Fonte Manrope.
- Status (fundo/texto): agendada `#ECE6FA`/`#5B21B6`, em execução
  `#FDF0D5`/`#8A4B00`, concluída `#DDF5E4`/`#14602F`, faturada `#D5F2EF`/`#0E5F58`,
  paga `#E7E7E3`/`#3F403F`, atrasada `#FBE3E4`/`#8E1016`.
- TV da sala em modo escuro, fundo `#0E0E10`. Agent Dute em violeta
  (`#C9B8FB`/`#5B3FC4`).
- Celular: cabeçalho preto e barra inferior com quatro itens.
- Sem legendas: só rótulos, dados e ações. Explicação vai para manual em `docs/`.
- Operação e campo nunca veem valores.
