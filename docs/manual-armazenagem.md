# Manual da Armazenagem

Para quem opera o armazém: a coordenação (`interno`), a operação (`wms`),
`owner` e `admin`; o `suporte` acompanha e o `financeiro` fecha o Faturamento.
As telas novas mostram só rótulos, dados e ações; o resto está aqui. Toda
gravação passa pelas Functions, que conferem de novo o papel, o cliente e a
situação. O desenho fica em `docs/mapa-do-armazem-enderecamento-dirigido.md`,
`docs/wms-abertura-correcoes.md`, `docs/multicliente-modelos-de-operacao.md` e
nas fases 4, 5 e 7 de `docs/plataforma/`.

## O menu

| Item | O que tem |
|---|---|
| Início | O "Precisa de você" e "Hoje no armazém". |
| Agent Dute | O assistente, com o "Painel" e o "Conhecimento" do agente. |
| Pedidos | "Para aprovar", "Para separar", "Para entregar" e "Entregues". |
| Estoque › Itens | Os itens do cliente ativo, a ficha de cada um e o "Histórico". |
| Estoque › Receber | As chegadas para conferir, as guardas e a "Chegada avulsa". |
| Estoque › Contagem | O "Inventário de abertura" e a "Contagem cíclica" do cliente ativo. |
| Estoque › Mapa | As prateleiras por zona, com as caixas. Só leitura. |
| Estoque › Posições | O cadastro das prateleiras e das zonas. |
| Faturamento | "Fechamento do mês" e "Tabela de preços". |
| Relatórios | Posição de estoque, Abaixo do mínimo, Itens parados, Movimentações e Pedidos. |
| Documentos | NFs, comprovantes e contratos. |

Fora do menu: Estoque › Etiquetas (pela Contagem, por Posições, pelo Mapa e pelo Receber),
Estoque › Alertas (pelo Início), a triagem das solicitações (pelo Início e por
Pedidos) e Devoluções, só pelo endereço `/wms/devolucoes`. Início, Pedidos,
Itens, Receber e Alertas estão no visual novo (v3); as outras, no anterior do
WMS, em geral com uma frase sob o título. O número ao lado do Início conta
as linhas do "Precisa de você"; o de Pedidos, Estoque e Agent Dute, as que
levam a eles; fica vermelho com alguma crítica. Sem rede: "Sem conexão".

## Quem faz o quê

| Papel | Na Armazenagem |
|---|---|
| `owner`, `admin` | Tudo, inclusive o Faturamento e "Cadastrar ou editar clientes". |
| `interno` ("Coordenação") | Aprova e recusa solicitações, separa, entrega, recebe, guarda e conta; cadastra posições e zonas; edita, ajusta e arquiva o item; decide o alerta do item parado. Não abre o Faturamento. |
| `wms` ("Operação WMS") | Abre em Pedidos. Separa, entrega, define a entrega, recebe, guarda, conta e fotografa itens; consulta Mapa e Posições. Não abre Início, Relatórios nem Faturamento, não aprova solicitação nem alerta e não edita o cadastro do item. |
| `suporte` | Consulta as telas do armazém e os Relatórios, sem as ações (o servidor só deixa gravar `owner`, `admin`, `interno` e `wms`), sem a Contagem e sem o Faturamento. |
| `financeiro` | Faturamento, Relatórios, Documentos, Agent Dute e o Início, sem os números do armazém. Onde o Financeiro está ligado, abre no módulo dele. |

## O cliente ativo

- **"Cliente ativo"** fica abaixo do seletor de módulo (no celular, numa faixa
  do cabeçalho): os clientes com perfil publicado em Configurações › Clientes,
  fora os arquivados, e sempre a BTG. A escolha fica no aparelho, por pessoa;
  se o cliente sair da lista, volta a BTG.
- **Seguem o cliente ativo:** a chegada avulsa e os avisos do Receber, a
  Contagem (a troca recomeça a tela), Itens, Etiquetas, Devoluções, Faturamento
  e o Agent Dute do núcleo. **Mostram todos:** Início, Pedidos, a fila do
  Receber, Histórico, Mapa, Posições, Alertas e Relatórios.
- **O servidor isola:** produto, caixa, sessão e aviso de outro cliente são
  recusados; o registro antigo, sem o cliente, é da BTG.
- **O SKU não se digita:** o produto novo nasce com `<SIGLA>-000001`, gerado
  ao gravar, num contador por sigla que não repete número; sem a sigla, não há
  produto novo. O código de barras não se repete dentro do cliente.

## Início

| Linha | Quando aparece | Ação |
|---|---|---|
| "Pedido PED-0118 com exceção" | Pedido com bloqueio ou exceção aberta; até três. Crítico. | "Resolver" |
| "2 solicitações para aprovar" | Solicitações do portal sem decisão. | "Aprovar" |
| "Alerta de 3 itens parados para aprovar" | A proposta do alerta; com mais clientes, "2 alertas de itens parados para aprovar". | "Revisar" |
| "3 pedidos para separar" | Pedidos em "Para separar", sem exceção. | "Separar" |
| "2 pedidos para entregar" | Prontos para envio ou em rota, sem exceção. | "Entregar" |
| "1 recebimento para conferir" | Chegadas não concluídas. | "Conferir" |
| "4 avisos para revisar" | A caixa do Agent Dute. | "Revisar" |

A ordem é a da tabela, e a primeira tem o botão principal; a linha só aparece
para quem abre a tela a que ela leva. Sem nada: "Nada parado na Armazenagem."
"Hoje no armazém" conta os pedidos para separar, prontos para envio e em rota,
os recebimentos em aberto e os SKUs em estoque.

## Pedidos

"Em aberto" e "Entregues", relidos a cada minuto. O pedido aberto mostra os
itens por prateleira, na ordem de caminhada do cadastro de Posições: o
cabeçalho da prateleira com os itens e as unidades ("A-03 5 itens · 450 un.")
e, em cada linha, a foto, o nome com o tamanho, o código do cliente e o SKU,
a caixa onde o item está e a quantidade. A caixa aparece no pedido em "Para
separar": é a guardada naquela prateleira que recebeu o item, a mais antiga
primeiro; é o conteúdo de entrada, e a separação ainda não baixa a caixa. O
pedido já separado ou entregue não mostra caixa. O pedido em "Para separar" e
em "Para entregar" mostra o "Para quando" que o cliente pediu. O pedido com
exceção vem antes, em vermelho, com "Tratar": a tarefa abre num painel, com o
avanço e "Registrar exceção" ("Motivo da exceção").

- **"Para aprovar"** (só `owner`, `admin` e `interno`): a crítica ou urgente
  primeiro, depois a alta e a mais antiga. Com saldo, "Aprovar" (vai para a
  separação) e "Recusar" ("Motivo", 3 caracteres ou mais); sem, "Ver itens".
- **"Para separar":** "Imprimir lista" abre a "Lista de separação" do pedido
  em A4, para levar ao corredor: o pedido, o cliente, o destino, o "Para
  quando" e, por prateleira, o quadrado para marcar, o produto, o código, a
  caixa, a quantidade e "Separado" em branco, para anotar a quantidade
  diferente. "Imprimir" usa a impressão do navegador (ou "Salvar como PDF");
  cada página leva o pedido e "página 2 de 5". No celular, "Imprimir lista"
  fica ao lado de "Esconder itens". A lista só lê: nada muda no pedido.
  "Separar" abre a bancada do pedido; depois da primeira linha, o botão vira
  "Continuar" e o pedido ganha o selo "em separação desde 12/11 · 2 de 5
  itens" (ver "Separar o pedido", abaixo).
- **"Para entregar":** a linha diz os volumes e o lacre ("116 itens · 3.335
  un. · 42 volumes · lacre 88231"). "Ver volumes" abre o pedido separado (ver
  "O pedido separado", abaixo); "Etiquetas dos volumes" abre o lote das
  etiquetas, com o total, e "Romaneio", a folha do pedido (no celular, os
  dois ficam atrás de "Ver volumes"). Com caixa aberta pelo pedido ainda de
  etiqueta velha, a linha avisa "5 etiquetas de caixa para trocar", com
  "Imprimir". "Entregue" pede "Quem levou" e "Placa" (no pronto para
  envio; o aparelho lembra os últimos) e "Quem recebeu (opcional)". "Confirmar
  entrega" registra a saída e a entrega, e o estoque baixa. Na retirada pelo
  cliente, quem levou e a placa vêm da entrega.
- **"Cancelar pedido"** (só `owner`, `admin` e `interno`): fica no "⋯" do
  pedido que ainda não saiu, em "Para separar" e "Para entregar". O diálogo
  pede o "Motivo" (3 caracteres ou mais). No pedido já separado, a tabela
  "Voltam à posição" lista o item, a quantidade e a posição; no pedido em
  separação, lista só as linhas já separadas, na quantidade separada.
  "Cancelar pedido" solta a reserva, cancela o que estava aberto e abre a
  guarda de volta do que já saiu da prateleira (em Receber, como a guarda da
  entrada). O pedido sai das filas. O cliente vê "Cancelado pela Dutelog" e a
  data, sem o motivo.

Com a abertura do cliente ativo pendente ou em andamento, a faixa do inventário
aparece com "Continuar contagem", e os pedidos de saída do cliente ficam
bloqueados (na BTG, pelo controle geral; nos outros, com a sessão aberta).

## Separar o pedido

A bancada do pedido (Pedidos › "Separar" ou "Continuar") guarda o progresso
linha a linha: a pessoa para, volta no dia seguinte e continua de onde parou,
no computador ou no celular, e outra pessoa pode continuar. O que uma pessoa
separa aparece para a outra sem recarregar.

- **O cabeçalho:** o pedido, "em separação desde 10/11", o cliente, os itens
  e as unidades, o "Para quando", "Imprimir lista" e "Concluir separação". O
  progresso diz "10 de 116 itens · 665 de 3.335 un.".
- **As linhas** vêm por prateleira, na ordem de caminhada. "Separar" grava a
  linha na hora; "Desfazer" a volta. A prateleira toda separada fecha
  sozinha, com "separado", e abre no botão ao lado. A primeira linha separada
  começa a separação: o cliente passa a ver "Em separação" no portal.
- **A caixa de cada linha:** a linha por separar diz de qual caixa da
  prateleira o item sai, a mais antiga primeiro: "12 de CX-000027", com
  "esvazia" quando a linha esgota a caixa, e "CX-000029 inteira" quando a
  caixa sai toda. "Separar" baixa essas caixas, e a linha separada mostra de
  onde saiu. Quem tirou de outra caixa usa "Outra caixa", no "⋯" da linha: "De
  qual caixa saiu?" lista as caixas da prateleira que têm o item ("Abertura ·
  22/10/2026 · tem 20 un."), com a quantidade de cada uma; "Confirmar caixas"
  liga quando a soma fecha com a linha. O que as caixas da prateleira não têm
  sai sem caixa.
- **Os volumes:** a linha separada entra no volume aberto e diz em qual está
  ("Volume 12"). O painel "Volumes" mostra o volume aberto com o que já tem;
  "Fechar volume" fecha com o "Peso (kg)", opcional, e o volume seguinte abre
  sozinho na próxima linha. No celular, o volume aberto vem em cima da lista,
  e "Fechar volume" fecha sem peso. Cada volume fechado tem "Etiqueta", que
  abre a etiqueta dele (ainda sem o total); "Ver os 11 volumes" mostra todos.
  O volume fechado não reabre.
- **"Levar a caixa":** na linha de que uma caixa sai inteira, a caixa vira o
  volume, sem reembalar, já fechado, com o peso que ela tinha na entrada. O
  resto da linha, se houver, entra no volume aberto. A etiqueta do volume
  substitui a da caixa.
- **Desfazer e os volumes:** "Desfazer" tira a linha do volume. O volume
  fechado que fica vazio some, e o de maior número ocupa o número dele; o
  fechado de que sai só uma parte perde o peso. Nos dois casos a bancada
  avisa que a etiqueta daquele volume precisa sair de novo.
- **"Etiquetas para trocar"** lista as caixas que o pedido abriu, com a
  prateleira e o saldo ("A-05 · saldo 12 un."). "Imprimir" abre as etiquetas
  delas com o saldo; a caixa sai da lista depois da impressão e volta se sair
  mais peça dela.
- **"Separar menos"** fica no "⋯" da linha: "Separado" (com − e +), o "Motivo
  da diferença" ("Falta" ou "Avaria") e o "Detalhe". A linha fica "separado 1
  de 2 · Avaria" e o pedido mostra "1 linha com diferença". Quem opera
  registra a diferença; só a coordenação (`owner`, `admin` e `interno`)
  conclui o pedido com diferença.
- **"Concluir separação"** liga com todas as linhas tratadas (separadas ou
  com a diferença registrada); antes, o pedido diz "106 itens por separar". O
  diálogo diz os "Volumes" e as caixas de onde o pedido saiu ("Caixas
  inteiras", "Caixas abertas" e "Caixas vazias"), pede o "Número do lacre",
  um por pedido, e "Confirmar separação" fecha a separação e a embalagem de
  uma vez; o volume aberto que tiver alguma coisa fecha junto, sem peso. O
  pedido segue com o separado: a diferença volta a ficar disponível, e o item
  zerado não vai em volume nenhum. O pedido vai para "Para entregar", e a
  tela fica no pedido separado.
- A contagem cíclica de uma prateleira com linha já separada é recusada até a
  entrega: o item já saiu dela e só baixa do saldo na entrega.
- O suporte vê a bancada, sem as ações.

## O pedido separado

Depois de "Confirmar separação", e por "Ver volumes" em "Para entregar", o
pedido abre com o selo "separado", os volumes e o lacre.

- **"Volumes"** lista cada volume com a caixa que virou o volume (quando foi
  "Levar a caixa"), o conteúdo ("30 × Calça Social Masculino Preta · 40"), as
  unidades e o peso. "Etiqueta" abre a etiqueta daquele volume.
- **"Etiquetas dos volumes"** abre o lote, com o total em cada uma ("Volume
  12 de 42"): é o que substitui as etiquetas que saíram ao fechar cada
  volume. Na folha A4 ou no rolo da Zebra, como as outras etiquetas.
- **"Romaneio"** abre a folha A4 do pedido: o cliente, o destino, o prazo, o
  lacre, os volumes e as unidades, de quando a quando o pedido separou e
  quem concluiu; e o conteúdo de cada volume, com o código do cliente, a
  quantidade e o peso. "Imprimir" é o do navegador.
- **"Etiquetas para trocar"** e **"Caixas vazias"** dizem as caixas que o
  pedido abriu e ainda estão com a etiqueta velha, e as que ele esvaziou
  ("CX-000027 · A-05").

A etiqueta do volume e o romaneio vão ao cliente: levam o código do cliente,
e não dizem caixa, prateleira nem valor. O pedido concluído antes dos volumes
aparece com um volume só, com todos os itens.

## A entrega do pedido

Onde a Operação está ligada, o pedido em "Para separar", e em "Para entregar"
antes da saída, mostra a entrega ("Entrega pela Dutelog · Qua 28/10 13:00 ·
Demanda 10050 · OS 10050-01") e "Entrega", "Alterar entrega" ou "Abrir na
Operação".

| Modo | Campos | Botão |
|---|---|---|
| "Entrega pela Dutelog" | "Destino" (3 a 160 caracteres), "Data", "Hora", "Contato" e "Telefone" (opcionais), "Montagem" e "Desmontagem e retorno" ("Retorno em" e "Hora") | "Salvar e abrir na Operação" |
| "Retirada pelo cliente" | "Retirada em", "Hora", "Quem retira" (2 a 80) e "Placa do veículo" (ABC1D23 ou ABC1234) | "Salvar entrega" |

- A data é de hoje em diante (São Paulo); começa hoje às 13:00, e o retorno às
  18:00, sempre depois da entrega. O telefone tem DDD e pede o nome.
- Só muda antes da saída ("O pedido já saiu do armazém: a entrega não muda
  mais.") e antes de a Operação abrir a demanda; depois, muda lá.
- **Pela Dutelog,** salvar abre na Operação a demanda "Entrega do pedido
  PED-0118", sem preço: "Transporte do pedido PED-0118", "Montagem no destino"
  (se pedida) e, com retorno, "Desmontagem e retorno ao armazém do pedido
  PED-0118". As OS nascem agendadas, sem equipe nem veículo: a ida, do "Armazém
  Dutelog" ao destino, e, com retorno, a volta. **A retirada** não gera OS.

## Receber

"Em aberto", "Recebidos" e "Cancelados", com "Chegada avulsa"; a fila é
de todos os clientes. "Para conferir" traz os avisos de envio do cliente
ativo ainda não aprovados ("Aguardando aprovação da coordenação") e as chegadas abertas
("Conferir"); "Para guardar", as guardas ("Guardar"). Uma chegada por caixa
com entrada concluída fica em "Recebidas, por guardar" até a última guarda.
"Recebidos" e "Cancelados" mostram até 12 registros recentes por fila; são
recortes do histórico, não uma busca completa de todas as chegadas.

A conferência e o cancelamento usam o cliente da chegada selecionada, mesmo
que outro esteja no seletor. A criação avulsa e os avisos seguem o cliente
ativo. Trocar o cliente fecha a ficha e recomeça o rascunho de criação.

**A chegada avulsa:** "Fornecedor", "NF / pedido" e as linhas. "Cód. cliente,
SKU ou barras" acha o cadastro do cliente ativo; o "SKU" só se lê. Sem
cadastro, "Cadastrar como novo" pede "Categoria *", o "Custo unitário" (maior
que zero) e uma foto ("Fotografar ou anexar", até 8). O mesmo produto não entra
em duas linhas. Por linha, "Local" vem "RECEBIMENTO"; por caixa, toda linha
entra nessa área. "Criar conferência" cria a chegada sem lançar estoque e
mostra o SKU gerado. Produto excluído em Estoque › Itens
não aparece na busca: "Cadastrar como novo" o traz de volta com o SKU que já
tinha, e o aviso diz "SKU reativado". Depois do sucesso, o formulário fecha,
fica limpo para a próxima chegada e abre a conferência criada. Em falha,
os dados ficam para "Tentar novamente"; aguarde o resultado antes de iniciar
outra chegada.

O alerta "Possível duplicidade nos recebimentos carregados" compara o
cliente, a NF / pedido e os produtos com suas quantidades declaradas. Use
"Abrir recebimento" para conferir a chegada existente ou "Registrar outra
entrega" se esta for outra entrega real. A mesma NF pode ter entregas
parciais com itens ou quantidades diferentes. O alerta só conhece os dados
já carregados: sua ausência não garante que a chegada seja inédita.

**A conferência por caixa:**

1. "Conferir" recolhe a fila e abre a bancada na largura da tela. "Voltar à
   fila" retorna à chegada de origem. Escolha a caixa ativa ou use "Iniciar
   caixa"; cada caixa mantém seu próprio conteúdo.
2. Selecione um produto da NF pelo nome ou código. "Quantidade nesta caixa"
   começa vazia para um produto ainda não incluído; a quantidade da NF é
   referência. Digite o que contou e use "Adicionar à caixa".
3. Para corrigir um produto já incluído, informe o novo total e use "Salvar
   quantidade". Essa ação substitui o total salvo, sem somar novamente.
   Sair do campo ou selecionar um código não grava nem acrescenta peças.
   Salve ou descarte a alteração pendente antes de revisar ou voltar à fila.
4. Em "Fechar caixa", informe medidas e peso. Depois, confirme o destino
   sugerido, escolha outra prateleira ou use "Continuar sem prateleira".
   Fechar a caixa e confirmar o destino ainda não concluem a entrada nem a
   guarda física.
5. Em "Revisar entrada", confira caixas, itens e divergências. "Concluir
   entrada" exige caixas fechadas, linhas tratadas e justificativa quando
   houver falta ou sobra. A entrada vai para o RECEBIMENTO e gera uma guarda
   por caixa. A caixa sem destino pode receber a prateleira na guarda.
6. A etiqueta da caixa sai antes de levá-la à prateleira: com o destino
   confirmado, "Etiqueta" ao lado da caixa e "Etiquetas da chegada" em
   "Caixas e destinos" abrem a tela de Etiquetas (a caixa sem prateleira fica
   nomeada lá, sem etiqueta até o destino). "Imprimir / Salvar PDF" registra a
   impressão, e a caixa passa a dizer "etiqueta impressa 14:32".

**A conferência por linha:**

- "Aviso do cliente", só na chegada avulsa aberta do cliente ativo: "Sem aviso"
  ou um aviso aberto que não esteja em outra chegada.
- "Conferência de recebimento": por linha, "Físico" (0 ou mais), "Local" e
  "Custo", com "OK físico", "falta 3" ou "sobra 2"; a linha avisada sem código
  pede o "Código da etiqueta". A chegada nasce "a conferir", e "Salvar
  conferência" a põe "em conferência" (na "a conferir", "Concluir entrada" só
  faz essa passagem).
- "Concluir entrada" pede todas as linhas conferidas e lança o estoque no local
  de cada uma; a linha em "RECEBIMENTO" gera a guarda. Com falta ou sobra, a
  ficha pede a "Justificativa da divergência" (12 caracteres ou mais), que fica
  na trilha da entrada; o botão "Divergência" registra a exceção, para tratar
  com o fornecedor.

**Cancelar antes da entrada:** na chegada avulsa ainda a conferir ou em
conferência, "Cancelar recebimento" pede o motivo. Em "Duplicado", selecione
o recebimento original do mesmo cliente; em "Outro", explique na observação.
O servidor recusa quando a entrada já ocorreu, existe movimentação ou o
vínculo não permite cancelar. O cancelamento preserva a chegada, os itens e
as caixas no histórico, com motivo, responsável e data; o original permanece
intacto. Em "Cancelados", "Ver" permite consultar, sem ações de conferência
ou guarda. Cancelar aqui não estorna estoque já recebido.

**Guardar:** a caixa recebida tem uma tarefa para guardar seu conteúdo
inteiro. Confirme a prateleira e só use "Concluir guarda" depois de levá-la
fisicamente ao destino. A ficha da guarda, no computador e no celular, tem
"Imprimir etiqueta" com o destino e a timeline da caixa (fechada, destino
confirmado, etiqueta impressa, prateleira liberada, guardada). Depois de "Não
cabe aqui", a etiqueta antiga fica avisada no destino novo ("Etiqueta impressa
com B-09") e a fila diz "etiqueta com B-09": reimprima antes de guardar. A
guarda concluída, em Recebidos › Guardas › Ver, mostra "Guardada em" e
reimprime. Na guarda por linha, "Posição" ("Bipe ou busque a
prateleira") lista só as ativas da zona do cliente; "Concluir guarda" move o
saldo para ela, que não pode ser a origem. O pedido do cliente só reserva o
saldo livre na prateleira: "RECEBIMENTO" e "EXPEDICAO" ficam fora do
disponível do portal.

**Caixa na prateleira (FIFO, 02/11/2026):** sai primeiro o que entrou
primeiro, e o sistema não confere a caixa: o hábito garante.

- Ao guardar peça sem etiqueta de caixa, escreva a data do dia na frente da
  caixa (DD/MM/AA). Caixa da abertura não precisa de data escrita.
- A caixa nova vai atrás ou embaixo; a mais antiga fica na frente ou em cima.
- Na separação, tire da caixa mais antiga da prateleira indicada e deixe a
  sobra nela, na frente. Uma caixa aberta por item em cada prateleira.
- Caixa vazia sai da prateleira na hora. Se a caixa sair inteira para o
  cliente, tire a etiqueta CX.
- Não mude caixa de prateleira; se precisar, trate como guarda nova, com a
  data do dia.

O desenho está em `docs/plataforma/fifo-por-data.md`.

## Estoque › Itens

"Estoque · cliente", com "Itens" e "Histórico". A busca acha por código, nome
ou endereço; "Mostrar" filtra "Todos", "Baixo" (saldo acima de zero e até o
mínimo), "Reservados", "Sem foto", "Zerados" e, onde a memória roda,
"Parados" e "Sem giro". A ficha traz "em estoque", "disponível", "Onde está",
"Reservado", os 5 "Últimos movimentos" e, onde ela roda, "Giro" e "Caixas".

- **"Onde está"**: uma linha por prateleira e data de entrada ("B-05 · desde
  22/10/2026 · 16 un."). A prateleira com a data livre mais antiga vem
  primeiro: é dela que o próximo pedido sai. Numa prateleira com duas datas,
  a mais antiga é a sobra da caixa aberta (os hábitos em "Caixa na
  prateleira"). "sem data" são peças de antes do primeiro registro de
  entrada. O `RECEBIMENTO` e a `EXPEDICAO` vêm no fim, sem data. Enquanto as
  datas carregam, ou se a leitura falha, aparece a quantidade de cada local.

- **Ações:** "Adicionar foto" ou "Mais fotos" (`owner`, `admin`, `interno` e
  `wms`, até 4 por vez); "Contar este item"; "Editar cadastro" (os dois
  códigos só se leem: são a identidade do item; o código do cliente digitado
  errado no Receber se corrige pelo banco, com
  `tools/corrigir-codigo-do-produto`), "Ajustar saldo" e "Arquivar"
  (`owner`, `admin` e `interno`). Arquivar tira o item das listas;
  o histórico fica. Não há "Novo item": produto novo entra pelo Receber ou pela
  Contagem.
- **"Registrar movimentação"** (no Histórico) e "Ajustar saldo" pedem o tipo
  (entrada, saída, ajuste ou devolução), o "Motivo" (3 caracteres ou mais), o
  SKU, a quantidade, o produto, "Origem" e "Destino"; a saída acima do
  disponível é recusada. Gravam para o cliente ativo e só em item do cadastro
  dele: o SKU de outro cliente ou fora do cadastro é recusado.
- **"Guardar"** (`owner`, `admin` e `interno`): no "Onde está", o saldo numa
  área de passagem (`RECEBIMENTO` ou `EXPEDICAO`, em âmbar) ganha o botão. O
  diálogo mostra "Livre no RECEBIMENTO", "Em guardas abertas" e "Sem guarda",
  pede a "Quantidade" (até o sem guarda) e o "Motivo", e "Abrir a guarda" cria
  a guarda em Receber › Para guardar, que segue a guarda de hoje. É o caminho
  do saldo que entrou numa área sem guarda: a entrada manual ou a contagem no
  `RECEBIMENTO`, a devolução com o local de uma área, o resto de uma guarda
  feita a menos e o que já estava parado.

## Estoque › Posições, Mapa e Etiquetas

Todo papel do armazém consulta as posições; só `owner`, `admin` e `interno`
alteram. O código é rua e prateleira, `A-01` (rua de 1 a 4 letras ou números,
prateleira de 1 a 999). Comprimento é a frente, largura a profundidade e altura
o vão livre, em metros (até 50); o "Peso máximo" é opcional, e a "Sequência de
caminhada" vazia entra depois da última. Situação "ativa", "bloqueada" ou "em
verificação". "Nova rua" cadastra de 1 a 200 prateleiras iguais; "Zona da rua"
dá as da rua a um cliente (com sigla, ou a BTG) ou as deixa "Sem cliente
(livre)". Só se remove sem saldo, e mudar a medida não move caixa. "Carregar
mapa inicial", só com o cadastro vazio, põe as 43 prateleiras de 16/10/2026.

**O Mapa** mostra todas as zonas: "Posições ocupadas" (prateleiras com caixa
com saldo, a referência da fatura manual), as prateleiras, "Volume registrado" e
"Caixas guardadas". A prateleira fica "sem caixas registradas", "parcial", "sem
vaga na base" (não cabe mais uma caixa de 50 × 50 × 35 cm na frente livre, ou o
peso chegou ao máximo), "em verificação" ou "bloqueada". A ficha traz medidas,
peso, frente livre e as caixas, cada uma com a origem ("Abertura", "Manual" ou
"Recebimento · NF 48.377"), a data da guarda, o conteúdo (o da própria caixa, no
recebimento; o da abertura do cliente ativo, na contagem) e "Etiqueta"; a caixa
do recebimento com o destino confirmado aparece como "reservada". A caixa
guardada diz "guardada" ou, depois que saiu peça dela, "aberta": a aberta
mostra o que resta e "saldo em", sem o peso de entrada. A caixa de que a
separação tirou tudo sai da prateleira, deixa de contar em "Posições ocupadas"
e fica em "Saíram desta prateleira", com a data e o pedido ("inteira em
11/11/2026 · PED-0001" ou "vazia em 12/11/2026 · PED-0001").

**A etiqueta** sai em "Folha A4" (a padrão) ou "Rolo Zebra", escolhida em
"Saída"; o computador guarda a escolha. "Imprimir / Salvar PDF" usa o
navegador e a página sai em tamanho real (a prévia da tela encolhe para
caber). Na folha A4, em papel comum, a etiqueta da caixa e a do volume têm
148,5 × 105 mm, quatro por folha deitada, com as linhas de corte: recorte e
prenda na caixa com fita nas bordas (ficam 7 mm livres em volta). A da posição
tem 101,6 × 50,8 mm, dez por folha em pé, também com as linhas de corte. No
rolo, toda etiqueta tem 101,6 × 50,8 mm, uma por página. Todas trazem o código
em barras (Code 128) e em texto. A da caixa traz a posição, o cliente, medidas
e peso, a origem e a data ("Abertura · 22/10/2026", "Recebimento · NF 48.377 ·
06/11/2026" ou "Manual"), os produtos com o tamanho ao lado do nome, o código
do cliente e o SKU, e as unidades. Todos os produtos saem. Na folha, cada
etiqueta leva até 5, cada produto em duas linhas, e com mais a caixa sai em
mais etiquetas, todas completas, com "etiqueta 1 de 2" ao lado do logo; o nome
comprido encurta e o tamanho fica. No rolo, a primeira leva até 5 e diz
"etiqueta 1 de 2"; os outros vêm em etiquetas de continuação do mesmo tamanho,
com a caixa, a posição, "etiqueta 2 de 2", até 11 produtos cada e as unidades
da caixa, sem código de barras. A caixa aberta traz o saldo e "saldo em" com a
data. A contagem da tela soma todas. O rodapé de toda etiqueta leva o logo da
Dutelog (na folha A4, nas cores dele; no rolo da Zebra, em preto). Sai da caixa guardada do cliente ativo
(o conteúdo da abertura vem da sessão) e da caixa do recebimento com o destino
confirmado ou guardada (o conteúdo vem da própria caixa); aberta pelo Receber,
a tela volta ao Receber, diz a chegada e nomeia a caixa ainda sem destino. Na
caixa do recebimento, "Imprimir / Salvar PDF" registra a impressão com a
posição impressa (a primeira vez "etiqueta impressa", depois "reimpressa"). A
da posição traz a zona, rua e prateleira, as medidas e o "Peso máx.".

## Estoque › Contagem

Uma sessão de abertura por cliente, em "Iniciar contagem". O produto entra numa
caixa de destino, e a caixa numa prateleira.

| Situação da caixa | O que quer dizer |
|---|---|
| "Em conferência" | Tem o código (`CX-000001`, sequencial) e recebe os produtos como rascunho, sem saldo nem posição. |
| "Conferida · falta guardar" | Fechada; espera as medidas e a prateleira. |
| "Guarda em andamento" | A prateleira está reservada e cada linha vira estoque. |
| "Guardada · fechada" | Tudo publicado; o produto novo ganhou o SKU. Pronta para a etiqueta. |
| "Guardada" | Reaberta em "Reabrir para ajustar": o produto lançado vai direto ao estoque. |

1. **"Iniciar conferência da caixa"** gera o CX.
2. **Cada produto:** "Cód. cliente" (acha também por SKU e código de barras;
   "Usar este cadastro"), "Produto", "Categoria", "Gênero", "Grupo", "Contagem
   física" e "Custo unitário" (os dois maiores que zero) e fotos;
   "Cadastrar como novo" pede também descrição, categoria e uma foto. Marque
   "Confirmo: este produto está na caixa de destino CX-…" e "Salvar na
   conferência". Até 100 produtos por caixa, sem repetir.
3. **"Revisar e fechar caixa"** e "Conferido, fechar caixa" ("Reabrir
   conferência" volta). Depois, "Comprimento (cm)", "Largura (cm)", "Altura
   (cm)", "Peso (kg)" (opcional), "Pode virar esta caixa de lado" e "Pode
   empilhar esta caixa sobre outra que suporte seu peso"; em "Guardar em",
   "Sugestão do sistema" ("Onde guardar?") ou "Escolher prateleira".
4. **"Confirmar guarda em A-03"** e, no fim, "Imprimir etiqueta". Se a guarda
   parar, "Retomar guarda" (o publicado não soma de novo).

**A sugestão** é regra, não IA: a prateleira da zona que já tem o produto e
ainda cabe ("mesmo produto"); senão, a mais próxima dela na caminhada ("perto
do produto"); senão, a primeira com espaço ("primeira livre"); e até duas
alternativas. Cabe com uma fileira na profundidade, dentro da altura e do peso;
empilhar pede a base inteira sobre uma caixa. Sem zona ou com ela cheia não há
sugestão, e outra zona nunca entra. "Não cabe aqui" pede o motivo e "Pedir
outra posição"; a recusa vale só para esta caixa. Na abertura, a prateleira
escolhida entra sem o encaixe confirmado; com saldo recebido ou reservado do
mesmo SKU, não.

**Correções.** "Corrigir caixa", em "Linhas conferidas", leva a linha inteira
para outra caixa guardada da sessão sem o mesmo SKU, com "Motivo da correção"
(3 a 300 caracteres), e preserva SKU, fotos, custo e quantidade; se falta o
destino, "Cadastrar caixa já armazenada". "Remover para corrigir" estorna o
saldo com registro no razão. Caixa só se remove vazia e sem outra apoiada nela.
"Concluir inventário" pede um lançamento publicado e nenhuma caixa por
concluir; "Confirmar encerramento" fecha a sessão e libera os pedidos de saída
do cliente; depois, produto novo só entra pelo Receber.

**A contagem cíclica** é só para item cadastrado com saldo no endereço:
"Endereço contado", "Contagem física" (0 ou mais) e "Motivo do ajuste" (3
caracteres ou mais). "Registrar contagem" vira ajuste com evento; a contagem
menor que a reserva ativa é recusada. O endereço com itens separados esperando
a entrega também recusa, com o número do pedido: o separado já saiu da
prateleira e só sai do saldo na entrega, então a contagem espera a entrega. A
Contagem abre nesta aba com a abertura concluída ou quando o cliente não
precisa dela.

## Os dias parado e os alertas

Onde a memória roda (hoje, a homologação e a produção), uma rotina lê o razão
a cada 15 minutos; a regra é a do modelo do cliente (hoje, a mesma nos três).

- **"Parado 90+ dias":** sem entrada nem saída há 90 dias. **"Sem giro":** sem
  saída há 180 dias, ou desde a primeira entrada se nunca saiu. Sem saldo, nada
  fica parado. Contam o recebimento, a expedição, o lançamento manual, a
  devolução que volta ao estoque e a abertura; a guarda, a troca de caixa, a
  contagem cíclica e o estorno, não. A caixa conta desde a guarda ou desde a
  última saída de um SKU dela pela posição dela, e só tem o "Parado 90+ dias".
- **O alerta:** uma vez por dia, cada cliente ativo, com portal e que não é
  prospect, ganha uma proposta com os itens parados, os mais parados primeiro
  (até 200), refeita todo dia e tirada quando não sobra item.
- **Estoque › Alertas** (só `owner`, `admin` e `interno`): um alerta por vez,
  com todos os itens marcados. "Enviar ao cliente" pede um marcado;
  "Descartar" fecha. A decisão grava o evento; o item decidido, enviado ou
  não, só volta depois de se mexer. Só o aprovado vira o aviso "Itens parados"
  ao cliente com a armazenagem no contrato: no sino do portal e, por e-mail,
  aos contatos que o ligaram; sem saldo nem valor.

## Devoluções

Em `/wms/devolucoes`, do cliente ativo. Os "Retornos da Operação" (onde a
Operação está ligada) são as voltas concluídas da entrega pela Dutelog:
"Receber retorno" pede, por linha, quantos voltaram ("Voltou", até o que saiu,
ao menos um), recebe uma vez e vira devolução. "Registrar devolução" pede
"Origem", "Referência" e os itens (só produto cadastrado) e não altera o saldo.
Na "Disposição física", "Volta para disponível" pede o "Endereço de retorno"
(vem "DEVOLUCAO") e devolve ao estoque; "Quarentena", "Avaria" e "Descarte"
pedem a "Nota da triagem" (6 caracteres ou mais).

## Faturamento

De `owner`, `admin` e `financeiro`, do cliente ativo. "Fechamento do mês" abre
no mês anterior; "Cobrado automaticamente" é calculado, e os "Serviços do mês"
pedem "Qtde" e "Observação" ("Salvar quantidades"). "Emitir e publicar para a
cliente" vale a partir do dia 1º do mês seguinte, com as quantidades salvas:
congela os valores e publica em Faturas, no portal. Fora do Financeiro,
"Marcar como paga". Onde o Financeiro está ligado (hoje, a homologação e a
produção), a competência emitida vira um "A faturar" de lá: a tela leva a
"Faturar no Financeiro" ou "Ver a NF no Financeiro", e o WMS recusa o
pagamento.

## Agent Dute

Consulta e propõe; não baixa estoque, não fatura e não aprova nada. O agente
do WMS lê, para o `wms`, estoque, itens, pedidos, movimentações, documentos,
recebimentos, tarefas e endereços; para a coordenação, também as faturas, as
solicitações e os eventos; para `owner`, `admin` e `suporte`, também a prévia
do faturamento. Propõe a anotação sobre o cliente, pendente até `owner`,
`admin`, `interno` ou `suporte` aprovar, e a rotina, que a pessoa confirma no
cartão. Onde o agente do núcleo está ligado (hoje, a homologação e a
produção), a conversa é com ele, sobre o cliente ativo, sem a prévia e com os
itens parados.

## Quem vê valor

O Faturamento é de `owner`, `admin` e `financeiro`, e as leituras de itens,
saldos e catálogo chegam sem custo para os outros papéis. A ficha do item
mostra o custo a `owner` e `admin`; ao `interno`, o campo diz "sem custo". A
Contagem mostra "Valor controlado" e o valor de cada linha a quem conta. O
custo da mercadoria se digita na Contagem, no Receber e nas Devoluções.

## O que muda por ambiente

| O que | Onde está ligado (o `dute-btg` não tem nenhum) |
|---|---|
| A entrega do pedido e os "Retornos da Operação" | Homologação e produção |
| Os dias parado, os filtros "Parados" e "Sem giro", Estoque › Alertas e a linha do Início | Homologação e produção |
| O Agent Dute do núcleo em `/agente`; fora dele, o do WMS | Homologação e produção |
| A armazenagem faturada e recebida no Financeiro | Homologação e produção |
