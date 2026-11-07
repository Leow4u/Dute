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
| Armazenagem · Ficha da chegada por caixa | `WmsRecebimentoCaixa.dc.html` | Conferência por caixa no computador da bancada (decisão 11): "Iniciar caixa", as linhas da NF dentro da caixa, vários tamanhos na mesma caixa (decisão 3), a coluna "Custo NF", "Marcar falta" e "Concluir entrada" só com toda linha tratada e toda caixa fechada. Atualizada para a parte 5 em 03/11/2026: a caixa sem prateleira não trava mais a entrada (decisão 14), e "Concluir entrada" desligado diz o que falta, na frase do servidor (a caixa em conferência, a linha sem falta marcada). |
| Armazenagem · Fechar caixa e onde guardar | `WmsRecebimentoFecharCaixa.dc.html` | Medidas e peso da caixa do fornecedor, como chegou (decisão 2); "pode virar de lado" e "pode empilhar"; a prateleira sugerida pelo motor, com as alternativas; "Confirmar destino", "Não cabe aqui" e "Imprimir etiqueta" antes de levar a caixa (decisão 6). |
| Armazenagem · Receber, a fila | `WmsReceberFila.dc.html` | A chegada fica em "Recebidas, por guardar" até a última guarda ("0 de 2 caixas guardadas", decisão 5); "Para guardar" lista uma guarda por caixa, com o destino. Atualizada para a parte 5 em 03/11/2026: a caixa sem prateleira entra com o selo "sem prateleira" (decisão 14), e a guarda por linha aberta no Estoque (parte 7e) aparece na mesma lista. |
| Armazenagem · Guarda da caixa | `WmsGuardaCaixa.dc.html` | A guarda é da caixa inteira: destino, conteúdo, "Concluir guarda em B-02", "Não cabe aqui" e a timeline (caixa fechada, destino confirmado, etiqueta impressa). |
| Armazenagem · Guarda da caixa no celular | `WmsGuardaCaixaCelular.dc.html` | A mesma guarda no celular, que é onde a equipe guarda (decisão 11). |
| Etiqueta da caixa do recebimento | `WmsEtiquetaCaixaRecebimento.dc.html` | A etiqueta de caixa de hoje com a origem "Recebimento · NF 48.230" e o conteúdo da caixa. |
| Armazenagem · Mapa | `WmsMapaRecebimento.dc.html` | A prateleira mostra a caixa do recebimento guardada e a reservada (destino confirmado, por guardar), com a origem e o conteúdo. |
| Portal · Estoque | `PortalEstoqueRecebimento.dc.html` | "Disponível para pedido" só do que está na prateleira e "Em recebimento" separado, sem pedido (decisão 10); o sino com "Chegou produto novo", itens e quantidades, sem caixa nem posição (decisão 7). |
| E-mail ao cliente · Chegou produto novo | `EmailProdutoNovo.dc.html` | HTML na identidade da Dutelog (decisão 13), enviado quando a última caixa da chegada é guardada; itens, quantidades e total, sem valor; botão "Ver estoque no portal". |
| Armazenagem · Estoque, guardar o saldo parado numa área (decisão 16, parte 7e, aprovado em 02/11/2026) | `WmsEstoqueGuardar.dc.html` | Na ficha do item, o saldo numa área de passagem (em âmbar) ganha "Guardar", só para a coordenação; o diálogo mostra o livre na área, o que está em guardas abertas e o que está sem guarda, pede a quantidade e o motivo, e "Abrir a guarda" cria a guarda em Receber › Para guardar. |
| Armazenagem · Posições, encaixotar o saldo sem caixa | `WmsEncaixotarSaldo.dc.html` | Correção pontual (decisão 9), para owner, admin e coordenação: pelo painel da prateleira com saldo sem caixa, "Registrar caixa com o saldo" com medidas, motivo e etiqueta; a ação some quando esse saldo acaba. |

A parte 5 (a ficha da chegada por caixa, a fila do Receber e a guarda da
caixa no computador e no celular) ganhou em 03/11/2026 a atualização das duas
telas acima e as seis telas abaixo, com as decisões 14, 15, 17, 21 e 24 e o
que a parte 4 grava, aprovadas pelo Leonardo no mesmo dia, com a guarda da
caixa dentro da parte 5. As recusas usam as frases do servidor; a da guarda com o `RECEBIMENTO` curto
(decisão 24) sai como aviso na própria guarda, sem tela própria. As telas de
01/11 que não mudaram (fechar a caixa, a guarda com destino no computador e
no celular) valem como estão.

| Tela | Arquivo | O que mostra |
|---|---|---|
| Armazenagem · Marcar falta na linha da NF | `WmsRecebimentoFalta.dc.html` | O diálogo do "Marcar falta" (decisão 17, parte 4c): o que a NF pede, o que está nas caixas e a falta da linha; o motivo (falta ou avaria) e o detalhe. A marca vale para o que estava nas caixas. |
| Armazenagem · Caixa fechada sem prateleira livre | `WmsRecebimentoSemPrateleira.dc.html` | A zona sem prateleira livre que caiba a caixa: ela fica fechada e sem prateleira, e a entrada se conclui assim mesmo (decisão 14). |
| Armazenagem · Ficha pronta para concluir | `WmsRecebimentoConcluir.dc.html` | "Concluir entrada" ligado com uma caixa sem prateleira e a falta marcada na linha; a divergência pede a justificativa, como na entrada por linha. |
| Armazenagem · Guarda da caixa sem prateleira | `WmsGuardaCaixaSemPrateleira.dc.html` | A caixa sem prateleira ganha o destino na guarda (parte 4g): a sugestão, "Confirmar destino", "Não cabe aqui" e "Concluir guarda" desligado até o destino. |
| Armazenagem · Não cabe aqui na guarda | `WmsGuardaNaoCabe.dc.html` | O único jeito de trocar o destino confirmado (decisão 15, parte 4h): o motivo e "Liberar B-02". A reserva sai, a coordenação é avisada (decisão 21) e a caixa volta à guarda sem prateleira. |
| Armazenagem · Guarda da caixa sem prateleira no celular | `WmsGuardaCaixaCelularSemPrateleira.dc.html` | A mesma escolha do destino no celular, onde a equipe guarda (decisão 11); confirmado o destino, a tela é a `WmsGuardaCaixaCelular`. |

A aba Recebidos do Receber ganhou em 06/11/2026 dois grupos, "Chegadas" e
"Guardas", no lugar da lista única: a chegada de uma caixa e a guarda dela
encerram juntas, com a mesma quantidade, e lado a lado pareciam o mesmo
registro repetido. A fonte é estática e segue o shell v3 da Armazenagem, com
os dados da tela de 05/11/2026 que motivou a mudança.

| Tela | Arquivo | O que muda |
|---|---|---|
| Armazenagem · Receber, a aba Recebidos | `WmsReceberRecebidos.dc.html` | "Chegadas" lista a chegada com a entrada concluída e todas as caixas guardadas; "Guardas" lista a guarda concluída, de caixa ou de linha, com onde ficou. Cada grupo do mais recente ao mais antigo, até 12 por fila. |

A página "FIFO por data" não tem canvas: as duas telas das partes 5 e 6 de
`docs/plataforma/fifo-por-data.md` foram enviadas na conversa e aprovadas
pelo Leonardo em 03/11/2026, com a prateleira de data mais antiga primeiro na
ficha interna. A do portal segue a
identidade do portal; a da Armazenagem, o shell v3 (Estoque › Itens, cliente
ativo BTG, Guilherme, Operação WMS). As fontes são estáticas e os números
fecham entre as duas: 16 peças de 22/10/2026 em B-05, 30 de 30/10/2026 e 60 de
03/11/2026 em B-02, 10 reservadas.

| Tela | Arquivo | O que muda |
|---|---|---|
| Portal · Estoque, detalhe do produto | `PortalEstoqueDatas.dc.html` | A seção "Por data de entrada": uma linha por data, "desde DD/MM/AAAA" e as peças, da mais antiga para a mais nova (seção 3.3). Só o que está nas prateleiras, sem prateleira nem caixa; o "Em recebimento" segue sem data. "desde" é a data de entrada e não se confunde com o "sem movimento há N dias" do aviso "Itens parados". |
| Armazenagem · Estoque › Itens, ficha do item | `WmsItemDatas.dc.html` | "Onde está" ganha a data: uma linha por prateleira e data, com a quantidade, e a prateleira de data mais antiga primeiro (seção 3.4). A linha mais antiga de cada prateleira é a sobra da caixa aberta. `RECEBIMENTO` e `EXPEDICAO` seguem sem data, e o que as entradas não cobrem aparece como "sem data". A lista não muda. |

A página "Agent Dute · Painel" tem canvas próprio (privado,
https://claude.ai/artifact/P5Jyf1DNAp9FnLxCjpTMZK), aprovado pelo Leonardo em
04/11/2026 com as cinco respostas registradas em
`docs/plataforma/fase-5-memoria.md` ("O painel do Agent Dute na v3"). O
painel antigo tinha doze blocos, quase todos sem ação, e o aviso da caixa
antiga não fechava. Na proposta, o painel fica só com o que o agente propõe e
uma pessoa decide: as linhas do agente no "Precisa de você" da Armazenagem (o
alerta de itens parados e as anotações e os playbooks para aprovar), a
anotação decidida ali mesmo e, ao lado, o que vale no agente. A alternativa
com o rascunho de aviso ao cliente ficou de fora (pergunta 2). As telas
seguem o shell v3 da Armazenagem (cliente ativo BTG, Leonardo). No app, a
origem da anotação segue o texto do Conhecimento ("Na conversa da equipe com
Guilherme · 03/11").

| Tela | Arquivo |
|---|---|
| Agent Dute · Painel (interativo: "Aprovar" e "Recusar" tiram a anotação e baixam os contadores) | `AgentePainel.dc.html` |
| Agent Dute · Painel sem nada para decidir | `AgentePainelVazio.dc.html` |
| Armazenagem · Início com as decisões do agente | `AgenteInicioArmazenagem.dc.html` |

A página "Portal · detalhe do produto" tem canvas próprio (privado,
https://claude.ai/artifact/Ny4uPp8m8nwQLxRJXV5utA), aprovado pelo Leonardo em
04/11/2026: as correções 1 a 10 do diagnóstico do painel "Detalhe do produto"
do Estoque do portal, que não rolava e deixava o "Adicionar ao pedido" fora da
tela nos notebooks e no celular. As telas seguem o visual do WMS
(`docs/sistema-visual.md`), como o resto do Estoque do portal. Nenhuma regra de
negócio muda: os números, as frases dos avisos e o que pode ser pedido são os
de antes. `PortalDetalheFundoDesktop` e `PortalDetalheFundoCelular` são a
vitrine atrás do painel, importada pelas outras telas. O que não aparece na
tela (o `@container` no rodapé, a descrição que nunca aparecia e os testes)
está nas notas do canvas e em `estoque.test.tsx` e `estoque-gaveta.test.tsx`.

| Tela | Arquivo | O que muda |
|---|---|---|
| Hoje | `PortalDetalheHoje.dc.html` | O painel como estava: sem rolagem, o botão fora da tela. |
| Com saldo (1 a 4) | `PortalDetalhe.dc.html` | Cabeçalho numa linha (título e fechar, sem o olho), corpo que rola e rodapé fixo com o contador e "Adicionar ao pedido"; a foto inteira num quadro de 200 px; "Disponível para pedido" e "No pedido", sem "Sobra após este pedido" nem "Quantidade selecionada"; com saldo, sem aviso. |
| Tamanhos no detalhe (6) | `PortalDetalheTamanhos.dc.html` | Os botões de tamanho do card, com o disponível de cada um; no tamanho sem foto, a foto da família. |
| Depois de adicionar (9) | `PortalDetalheAdicionado.dc.html` | O painel fica aberto: "10 peças adicionadas ao pedido" e "Ver pedido" no rodapé, e o contador volta a 1. |
| Notebook, rolando (1) | `PortalDetalheNotebook.dc.html` | Em 1366 × 680, o corpo rola e o rodapé com a ação fica à vista. |
| Sem saldo (5) | `PortalDetalheSemSaldo.dc.html` | "Avisar reposição" e "Arquivar" no rodapé; o aviso de sem saldo no tom dele; sem foto, o quadro de 132 px com a sigla e o tipo. |
| Pelo teclado (7) | `PortalDetalheTeclado.dc.html` | O painel é um diálogo com o nome do produto: ao abrir, o foco vai para "Fechar detalhe"; o Tab fica dentro; Esc fecha; ao fechar, o foco volta ao card. |
| Avisos e selo (5 e 9) | `PortalDetalheEstados.dc.html` | O aviso só onde informa (em recebimento, sem saldo, tudo no pedido, estoque baixo), cada um no seu tom e ícone, sem o brilho da IA; o selo "Baixo estoque" com o ícone de queda; o selo de situação uma vez, na linha do tipo. |
| Hoje no celular | `PortalDetalheCelularHoje.dc.html` | O painel em tela cheia, sem rolagem. |
| Celular (8) | `PortalDetalheCelular.dc.html` | O painel sobe de baixo, com até 88% da altura (`dvh`), e o rodapé com a ação. |
| Celular, rolando (8) | `PortalDetalheCelularRolando.dc.html` | O corpo rola; o cabeçalho e o rodapé ficam. |

A página "Carregamento na Armazenagem" não tem canvas: as telas foram
enviadas na conversa em 06/11/2026, junto com o diagnóstico de
`docs/plataforma/diagnostico-carregamento.md`, e aprovadas pelo Leonardo no
mesmo dia, com as seis recomendações (seção 7 do diagnóstico): spinner com
rótulo nas listas, o que deixa de fora a opção B do skeleton em Pedidos.
Seguem o shell v3 da Armazenagem (cliente ativo
BTG; Guilherme na operação, Leonardo no Faturamento). As fontes são
estáticas; no navegador, o spinner gira e o skeleton pulsa, e os dois param
com `prefers-reduced-motion`. "Hoje" mostra o app como está; o resto é
proposta. O spinner é um anel com o arco, desenhado no `Spinner`, no lugar
do `Loader2` e do `RefreshCw` girando de hoje (pergunta 5, aprovado).

| Tela | Arquivo | O que mostra |
|---|---|---|
| As peças | `WmsCarregandoPecas.dc.html` | O spinner (16, 22 e 30 px), o bloco "Carregando…", "Sem conexão", o botão em ação, o skeleton, o erro na leitura, o erro na atualização, o progresso e a demora com o tempo limite. |
| Abertura | `WmsCarregandoAbertura.dc.html` | A marca e o spinner no lugar da tela branca, enquanto o perfil chega. |
| Abertura sem conexão | `WmsCarregandoAberturaSemConexao.dc.html` | Depois de 3 s sem rede, "Sem conexão" abaixo do spinner, que continua esperando. |
| Chegada avulsa, hoje | `WmsCarregandoChegadaHoje.dc.html` | Com o catálogo ainda carregando, a linha diz "Identificação pendente" e oferece "Cadastrar como novo" para um produto que existe. |
| Chegada avulsa | `WmsCarregandoChegada.dc.html` | A linha diz "Verificando" e o editor, "Verificando o catálogo…"; sem "Cadastrar como novo" e sem contar zero no resumo. |
| Chegada avulsa, o catálogo não veio | `WmsCarregandoChegadaErro.dc.html` | "Não consegui carregar o catálogo." com "Tentar de novo"; a linha fica "Sem catálogo" e o produto novo continua bloqueado. |
| Pedidos, hoje | `WmsCarregandoPedidosHoje.dc.html` | A leitura falhou e as três filas dizem "Nenhum pedido para…". |
| Pedidos, erro na leitura | `WmsCarregandoPedidosErro.dc.html` | "Não consegui carregar os pedidos." com "Tentar de novo", no lugar das filas. |
| Pedidos, primeira leitura (opção A) | `WmsCarregandoPedidosSpinner.dc.html` | O spinner com o rótulo no lugar da lista (pergunta 1). |
| Pedidos, primeira leitura (opção B, não escolhida) | `WmsCarregandoPedidosSkeleton.dc.html` | O skeleton das três filas, com os títulos que a tela já conhece (pergunta 1). |
| Pedidos, a linha em andamento | `WmsCarregandoPedidosAprovando.dc.html` | Só a linha aprovada gira e diz "Aprovando…"; as outras continuam livres. |
| Pedidos, Separado | `WmsCarregandoSeparado.dc.html` | O diálogo fica aberto com "Voltar" desligado, e as etapas Separação e Embalagem mostram onde está. |
| Faturamento, emitir a fatura | `WmsCarregandoEmitir.dc.html` | A confirmação espera a emissão com "Emitindo…" e "Cancelar" desligado. O fundo segue a v3, que o Faturamento do app ainda não tem. |
| Estoque › Itens, hoje | `WmsCarregandoEstoqueHoje.dc.html` | Antes dos saldos, toda linha diz "Sem endereço". |
| Estoque › Itens | `WmsCarregandoEstoque.dc.html` | O endereço em skeleton até os saldos chegarem; saldo e disponível já vêm do SKU. |
| Estoque › Itens, fotos do item | `WmsCarregandoFotos.dc.html` | "Enviando 3 de 4" com o progresso, as fotos já enviadas e as que passaram de 4. |
| Receber, a atualização falhou | `WmsCarregandoReceberAtualizar.dc.html` | A lista de 10:42 fica na tela, com "Não consegui atualizar" e "Tentar de novo". |

A página "Catálogo · nome sem tamanho" tem canvas próprio (privado,
https://claude.ai/artifact/KsF8UuJqi2akHLxDaiMCWw), feito em 06/11/2026 para
o Leonardo avaliar a padronização do nome do produto: hoje cada tamanho é um
cadastro, o nome foi digitado à mão em cada um e ficou com o tamanho no fim
("… p", "… m", "… - XG"), o gênero sem padrão ("masculino" e "masculina") e
MAIÚSCULAS misturadas. A proposta: o nome é o mesmo nos tamanhos da família,
o tamanho vai para o campo Tamanho (preenchido pelo fim do código do cliente)
e as telas que mostravam só o nome passam a mostrar o tamanho ao lado
("Polo Masculino Piquet Preto · XG"), com o código do cliente na linha de
apoio. As pranchas "hoje" reproduzem o app como está; nas "proposta" só o
nome e o lugar do tamanho mudam. O portal segue o visual do WMS
(`docs/sistema-visual.md`); a Armazenagem, o shell v3 (o Catálogo e a
Contagem ainda não têm a v3 no app). As fontes são estáticas. Decisões do
Leonardo em 06/11/2026, nas notas do canvas: tamanho fora do nome; gênero
como etiqueta, sempre "Masculino" ou "Feminino", sem concordar com a peça
("Polo Masculino", "Calça Social Masculino"); inicial maiúscula em cada
palavra ("Polo Masculino Piquet Preto"), conectivos em minúscula; só esses
ajustes e os erros de digitação que a planilha apontar.

| Tela | Arquivo | O que mostra |
|---|---|---|
| Portal · Estoque, hoje | `NomePortalEstoqueHoje.dc.html` | O card da família com o XG escolhido: o título vira o nome daquele tamanho, "Polo masculino piquet preto - XG"; ao lado, a azul-marinho em MAIÚSCULAS e a arpoador "feminino". |
| Portal · Estoque, proposta | `NomePortalEstoque.dc.html` | Os mesmos cards com o nome igual em todos os tamanhos; o tamanho só nos botões. |
| Portal · detalhe do produto | `NomePortalDetalhe.dc.html` | O código completo, o nome sem tamanho e o XG escolhido no grupo "Tamanho"; as aria-labels do contador levam o tamanho. |
| Portal · Seu pedido | `NomePortalPedido.dc.html` | Duas linhas da mesma polo em tamanhos diferentes, distinguidas por "· GG" e "· XG" e pelo código. |
| Portal · Meus pedidos | `NomePortalMeusPedidos.dc.html` | A tabela de itens ganha a coluna Tamanho. |
| Armazenagem · Pedidos, itens hoje | `NomeWmsPedidosHoje.dc.html` | A lista de itens de hoje: posição, SKU interno e o nome como está. |
| Armazenagem · Pedidos, itens com o tamanho | `NomeWmsPedidos.dc.html` | Nome com o tamanho em negrito e, na linha de apoio, o código do cliente e o SKU. |
| Armazenagem · Separado | `NomeWmsSeparado.dc.html` | A conferência do separado com o tamanho e a posição em cada linha. |
| Armazenagem · Receber | `NomeWmsReceber.dc.html` | A fila "Para guardar" com o conteúdo da caixa por tamanho. |
| Armazenagem · Catálogo, editar produto | `NomeWmsCatalogo.dc.html` | A família na tabela com o mesmo nome; no diálogo, o nome digitado com "XG" no fim é recusado e o tamanho fica no campo Tamanho. |
| Armazenagem · Contagem, tamanho novo | `NomeWmsContagem.dc.html` | O código de um tamanho novo de uma família existente pré-preenche nome, categoria, gênero, grupo, cor e Tamanho. |
| Planilha de revisão (passo 1) | `NomePlanilhaRevisao.dc.html` | A ilustração da planilha para a avaliação: nome hoje, nome proposto, motivo, tamanho e a decisão por linha. O CSV de verdade tem as colunas do README de `tools/padronizar-nomes` e não acrescenta cor nem aponta digitação. |

A parte 6 do recebimento com caixas (a etiqueta da caixa do recebimento) tem
canvas próprio (privado, https://claude.ai/artifact/WqvC91v2bcZLVUQjHoucG2),
feito em 06/11/2026 a partir do caso do mesmo dia e aprovado pelo Leonardo
em 07/11/2026 com as cinco respostas abaixo (decisões 28 a 32 do runbook): a chegada avulsa por caixa terminou sem lugar para imprimir a etiqueta,
e a etiqueta aberta pelo Mapa saiu "Manual", com "Conteúdo a lançar na
contagem", porque a tela de Etiquetas e o Mapa só leem o conteúdo da sessão
de abertura, e a caixa do recebimento guarda o dela em `lines[]`. As pranchas
seguem o shell v3 da Armazenagem (cliente ativo BTG, Guilherme, Operação WMS)
e partem das telas das partes 4 e 5 que estão na `main`; em cada uma só a
etiqueta muda. As fontes são estáticas; os dados são os de uma chegada de
três caixas (CX-000225, CX-000226 e CX-000227, NF 48.377) e os nomes seguem o
padrão de 06/11/2026 ("Polo Masculino Piquet Preto · G"). As perguntas para o
Leonardo estão na nota do canvas e abaixo da tabela.

| Tela | Arquivo | O que muda |
|---|---|---|
| Armazenagem · Receber, revisar entrada | `WmsEtiquetaRecebimentoRevisao.dc.html` | Depois de "Confirmar destino", a caixa ganha "Etiqueta" na lista das caixas da chegada, com "etiqueta impressa 14:32" na linha, e a ficha ganha "Etiquetas da chegada"; a caixa sem prateleira fica sem a ação. |
| Estoque › Etiquetas, as etiquetas da chegada | `WmsEtiquetaRecebimentoEtiquetas.dc.html` | A tela de hoje aberta pela chegada: volta ao Receber, as caixas com destino confirmado ou guardadas (hoje só a guardada), a origem "Recebimento · NF 48.377" e o conteúdo da própria caixa; a caixa sem prateleira é nomeada no aviso, sem etiqueta. O aviso de hoje sobre o conteúdo da abertura sai. |
| Armazenagem · Guarda da caixa | `WmsEtiquetaRecebimentoGuarda.dc.html` | A ficha da guarda ganha "Imprimir etiqueta" ao lado de "Não cabe aqui" e a timeline aprovada em 01/11 (caixa fechada, destino confirmado, etiqueta impressa), que a parte 5f deixou para cá. |
| Armazenagem · Guarda com a etiqueta desatualizada | `WmsEtiquetaRecebimentoReimpressao.dc.html` | Depois de "Não cabe aqui" e do novo destino, o cartão do destino diz "Etiqueta impressa com B-09" com "Imprimir etiqueta", e a reimpressão entra na timeline; a fila diz "etiqueta com B-09". |
| Armazenagem · Guarda concluída | `WmsEtiquetaRecebimentoGuardada.dc.html` | Em Recebidos › Guardas › Ver, a ficha mostra "Guardada em B-09" e a única ação é "Imprimir etiqueta": é por aqui que as caixas de 06/11 ganham a etiqueta com o conteúdo. |
| Armazenagem · Mapa | `WmsEtiquetaRecebimentoMapa.dc.html` | A ficha da prateleira lê o conteúdo da caixa do recebimento e diz a origem ("Recebimento · NF 48.377 · 06/11/2026", "Abertura · 06/11/2026"), com "Etiqueta" por caixa; o "Conteúdo ainda não lançado" e o "manual" saem das caixas do recebimento. |
| Armazenagem · Guarda da caixa no celular | `WmsEtiquetaRecebimentoCelular.dc.html` | A mesma guarda no celular, com a etiqueta desatualizada em âmbar e "Imprimir etiqueta" (pergunta 1). |
| Etiqueta da caixa do recebimento, hoje | `WmsEtiquetaRecebimentoHoje.dc.html` | A etiqueta como saiu em 06/11/2026: "Manual", "Conteúdo a lançar na contagem." e as unidades certas. |
| Etiqueta da caixa do recebimento, proposta | `WmsEtiquetaRecebimentoEtiqueta.dc.html` | A mesma etiqueta com "Recebimento · NF 48.377 · 06/11/2026" e o conteúdo da caixa, uma linha por tamanho, com o código do cliente e o SKU. Substitui a `WmsEtiquetaCaixaRecebimento` de 01/11, que trazia o nome em maiúsculas com o tamanho no fim. |

Perguntas e respostas do Leonardo (07/11/2026):

1. O celular imprime? A guarda no celular ganha "Imprimir etiqueta" (abre a
   tela de Etiquetas no navegador do celular) ou só a bancada imprime?
   Resposta: sim, os dois.
2. "Etiqueta impressa" vira evento: a tela de Etiquetas registra, ao clicar
   em "Imprimir / Salvar PDF", a caixa e a posição impressas (depois,
   "reimpressa"). É o registro do clique, não da impressora, até o ZPL.
   Proposta: sim, por uma callable pequena do WMS, porque é o que alimenta a
   timeline, a fila e o aviso da etiqueta desatualizada. Resposta: sim.
3. "Etiquetas da chegada" leva só as caixas com destino confirmado ou
   guardadas; a caixa fechada sem prateleira (decisão 14) é nomeada no aviso
   e imprime na guarda, quando ganha o destino. Resposta: sim.
4. A origem na etiqueta e no Mapa: "Recebimento · NF 48.377" e, sem NF,
   "Recebimento · AVL-7C21A9F0"; "Abertura" e "Manual" seguem como hoje.
   Resposta: sim.
5. O nome na etiqueta segue o padrão de 06/11 ("Polo Masculino Piquet Preto ·
   G"), com o código do cliente e o SKU; a caixa de antes do passo 3 sai com
   o nome que o catálogo tiver. Resposta: sim.

As caixas CX-000225 e CX-000226 de 06/11 não precisam de nada: com a parte
6, a etiqueta delas sai pelo Mapa ou por Recebidos › Guardas, com o conteúdo.

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
