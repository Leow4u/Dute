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

Fora do menu: Estoque › Etiquetas (pela Contagem, por Posições e pelo Mapa),
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

"Em aberto" e "Entregues", relidos a cada minuto. O pedido aberto mostra cada
item com a foto, o endereço, o SKU e a quantidade. O pedido com exceção vem
antes, em vermelho, com "Tratar": a tarefa abre num painel, com o avanço e
"Registrar exceção" ("Motivo da exceção").

- **"Para aprovar"** (só `owner`, `admin` e `interno`): a crítica ou urgente
  primeiro, depois a alta e a mais antiga. Com saldo, "Aprovar" (vai para a
  separação) e "Recusar" ("Motivo", 3 caracteres ou mais); sem, "Ver itens".
- **"Para separar":** "Separado" pede o "Número do lacre" e confirma cada linha
  na quantidade pedida, num volume só.
- **"Para entregar":** "Entregue" pede "Quem levou" e "Placa" (no pronto para
  envio; o aparelho lembra os últimos) e "Quem recebeu (opcional)". "Confirmar
  entrega" registra a saída e a entrega, e o estoque baixa. Na retirada pelo
  cliente, quem levou e a placa vêm da entrega.

Com a abertura do cliente ativo pendente ou em andamento, a faixa do inventário
aparece com "Continuar contagem", e os pedidos de saída do cliente ficam
bloqueados (na BTG, pelo controle geral; nos outros, com a sessão aberta).

## A entrega do pedido

Onde a Operação está ligada, o pedido em "Para separar", e em "Para entregar"
antes da saída, mostra a entrega ("Entrega pela Dutelog · Qua 28/10 13:00 ·
Demanda 10050 · OS 10050-01") e "Entrega", "Alterar entrega" ou "Abrir na
Operação".

| Modo | Campos | Botão |
|---|---|---|
| "Entrega pela Dutelog" | "Destino" (3 a 160 caracteres), "Data", "Hora", "Contato" e "Telefone" (opcionais), "Montagem" e "Desmontagem e retorno" ("Retorno em" e "Hora") | "Salvar e abrir na Operação" |
| "Retirada pelo cliente" | "Retirada em", "Hora", "Quem retira" (2 a 80), "Documento" (até 30) e "Placa do veículo" (ABC1D23 ou ABC1234) | "Salvar entrega" |

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

"Em aberto" e "Recebidos", com "Chegada avulsa"; a fila é de todos os
clientes. "Para conferir" traz os avisos de envio do cliente ativo ainda não
aprovados ("Aguardando aprovação da coordenação") e as chegadas abertas
("Conferir"); "Para guardar", as guardas ("Guardar").

**A chegada avulsa:** "Fornecedor", "NF / pedido" e as linhas. "Cód. cliente,
SKU ou barras" acha o cadastro do cliente ativo; o "SKU" só se lê. Sem
cadastro, "Cadastrar como novo" pede "Categoria *", o "Custo unitário" (maior
que zero) e uma foto ("Fotografar ou anexar", até 8). O mesmo produto não entra
em duas linhas; "Local" vem "RECEBIMENTO". "Criar conferência" cria a chegada
sem lançar estoque e mostra o SKU gerado.

**A ficha da chegada:**

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

**Guardar:** "Posição" ("Bipe ou busque a prateleira") lista só as ativas da
zona do cliente; "Concluir guarda" move o saldo para ela, que não pode ser a
origem. O recebimento não põe nada em caixa: a caixa é da abertura.

## Estoque › Itens

"Estoque · cliente", com "Itens" e "Histórico". A busca acha por código, nome
ou endereço; "Mostrar" filtra "Todos", "Baixo" (saldo acima de zero e até o
mínimo), "Reservados", "Sem foto", "Zerados" e, onde a memória roda,
"Parados" e "Sem giro". A ficha traz "em estoque", "disponível", "Onde está",
"Reservado", os 5 "Últimos movimentos" e, onde ela roda, "Giro" e "Caixas".

- **Ações:** "Adicionar foto" ou "Mais fotos" (`owner`, `admin`, `interno` e
  `wms`, até 4 por vez); "Contar este item"; "Editar cadastro" (os dois
  códigos só se leem: são a identidade do item), "Ajustar saldo" e "Arquivar"
  (`owner`, `admin` e `interno`). Arquivar tira o item das listas;
  o histórico fica. Não há "Novo item": produto novo entra pelo Receber ou pela
  Contagem.
- **"Registrar movimentação"** (no Histórico) e "Ajustar saldo" pedem o tipo
  (entrada, saída, ajuste ou devolução), o "Motivo" (3 caracteres ou mais), o
  SKU, a quantidade, o produto, "Origem" e "Destino"; a saída acima do
  disponível é recusada. Gravam para o cliente ativo e só em item do cadastro
  dele: o SKU de outro cliente ou fora do cadastro é recusado.

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
guardada, a referência da fatura manual), as prateleiras, "Volume registrado" e
"Caixas guardadas". A prateleira fica "sem caixas registradas", "parcial", "sem
vaga na base" (não cabe mais uma caixa de 50 × 50 × 35 cm na frente livre, ou o
peso chegou ao máximo), "em verificação" ou "bloqueada". A ficha traz medidas,
peso, frente livre e as caixas (o conteúdo vem da abertura do cliente ativo).

**A etiqueta** tem 101,6 × 50,8 mm: "Folha A4, dez por folha" ou "Uma por
etiqueta (rolo Zebra)"; "Pular etiquetas usadas" (0 a 9) aproveita folha
começada; "Imprimir / Salvar PDF" usa o navegador. As duas trazem o código em
barras (Code 128) e em texto. A da caixa traz a posição, o cliente, medidas e
peso, "Abertura" ou "Manual", a data, até 4 produtos ("+ 2 produto(s) no
sistema") e as unidades; sai só de caixa guardada do cliente ativo, com o
conteúdo da abertura. A da posição traz a zona, rua e prateleira, as medidas e
o "Peso máx.".

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

Onde a memória roda (hoje, só a homologação), uma rotina lê o razão a cada 15
minutos; a regra é a do modelo do cliente (hoje, a mesma nos três).

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
"Marcar como paga". Onde o Financeiro está ligado (hoje, só a homologação), a
competência emitida vira um "A faturar" de lá: a tela leva a "Faturar no
Financeiro" ou "Ver a NF no Financeiro", e o WMS recusa o pagamento.

## Agent Dute

Consulta e propõe; não baixa estoque, não fatura e não aprova nada. O agente
do WMS lê, para o `wms`, estoque, itens, pedidos, movimentações, documentos,
recebimentos, tarefas e endereços; para a coordenação, também as faturas, as
solicitações e os eventos; para `owner`, `admin` e `suporte`, também a prévia
do faturamento. Propõe a anotação sobre o cliente, pendente até `owner`,
`admin`, `interno` ou `suporte` aprovar, e a rotina, que a pessoa confirma no
cartão. Onde o agente do núcleo está ligado (hoje, só a homologação), a
conversa é com ele, sobre o cliente ativo, sem a prévia e com os itens parados.

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
| Os dias parado, os filtros "Parados" e "Sem giro", Estoque › Alertas e a linha do Início | Só a homologação |
| O Agent Dute do núcleo em `/agente`; fora dele, o do WMS | Só a homologação |
| A armazenagem faturada e recebida no Financeiro | Só a homologação |
