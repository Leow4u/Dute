# Manual do portal do cliente

Para o login de papel `cliente`, da empresa cliente da Dutelog. As telas
mostram só rótulos, dados e ações; o que elas não explicam está aqui. O
desenho e o registro ficam em `docs/plataforma/fase-4-financeiro.md` (as OS,
as NFs e os avisos), `fase-2-nucleo.md` (os módulos contratados) e
`fase-5-memoria.md` (os itens parados e o Agent Dute).

**Só a empresa do login.** O convite liga o login a um cliente
(`customer_code`). O portal lê e grava só por ele, e as regras e as callables
recusam o dado de outro cliente.

**Valores.** A OS não tem preço: nem a OS nem o comprovante mostram valor. O
cliente vê o valor das próprias faturas (a fatura mensal, as NFs dos serviços
com o valor de cada demanda e o "A pagar", em Faturas e em Minhas OS) e o
valor de custo do próprio estoque, base do seguro.

## Entrar

- **O acesso é por convite**, feito em Configuração › Pessoas e acessos
  (`owner` e `admin`), para o cliente cadastrado (não prospect), sem arquivo,
  com o portal ligado (não "Sem portal") e com a sigla do SKU; a BTG passa
  sempre. "Aceitar convite" pede o "Nome" e a "Senha" (6 caracteres ou mais);
  o e-mail vem do convite.
- **O cliente arquivado ou "Sem portal"** (Configurações › Clientes) tem o
  portal desligado. A pessoa continua com o login, mas as telas não trazem
  os dados, e os pedidos, o Agent Dute e o "Solicitar OS" respondem "O
  portal do seu cliente está desligado.". O convite pendente desse cliente
  também não vale mais.
- **"Entrar"** pede o e-mail e a senha. "Esqueci minha senha" manda o e-mail
  de recuperação ao endereço digitado no campo; sem ele, a tela pede o
  e-mail.
- **Onde o portal começa:** com a armazenagem no contrato, no Início; sem ela
  e com a Operação, em Minhas OS. O cliente só com as faturas vê "Nenhum
  módulo liberado".

## O menu

| Item | O que tem | Pede no contrato |
|---|---|---|
| Agent Dute | O assistente: consulta e monta rascunhos de pedido e de envio. | Armazenagem |
| Início | Pedidos em andamento, envios a caminho, o estoque e as faturas. | Armazenagem (sem ela, sai do menu) |
| Estoque | Os itens com o saldo; o pedido nasce aqui. | Armazenagem |
| Eventos | O que vai para cada evento que se repete. | Armazenagem, no modelo Uniformes |
| Envios para a Dutelog | Os avisos da mercadoria que o fornecedor entrega no armazém. | Armazenagem |
| Pedidos | Os pedidos do estoque e a entrega de cada um. | Armazenagem |
| Minhas OS | As OS da empresa, o comprovante e o "Solicitar OS". | Operação |
| Faturas | As NFs dos serviços e as faturas mensais. | Faturas (`financeiro`) |
| Documentos | O que a Dutelog publicou, as notas dos avisos e as faturas fechadas. | Armazenagem |

- **Os módulos contratados** ficam no cadastro do cliente na Dutelog
  (Configurações › Clientes): Armazenagem, Operação e Financeiro (as
  faturas). Cadastro sem o campo vale armazenagem e faturas.
- **O modelo de operação** do cadastro também tira telas: Mobiliário não tem
  Eventos; Insumos internos não tem portal, e a conta de cliente criada nele
  vê só o Início.
- **Sem a armazenagem**, o Início sai do menu e o portal começa em Minhas OS.
  O endereço de uma tela fora do contrato volta ao começo do portal.
- **No celular**, a barra de baixo leva até 4 telas (Início, Pedidos, Estoque
  e Agent Dute, quando existem) e "Mais". O sino ("Avisos"), onde a Operação
  está liberada, fica no pé do menu, ao lado da conta, e no topo do celular.

## Início

Cada seção só aparece com a tela dela no contrato.

- **"Pergunte ao Agent Dute"** abre o agente numa conversa nova com a
  pergunta. Abaixo, até 2 respostas de rotina ainda não abertas neste
  navegador ("… chegou").
- **"Pedir itens do estoque"** mostra as peças disponíveis; antes da contagem
  inicial, "Disponível depois da contagem inicial", sem ação. **"Avisar um
  envio"** abre o aviso.
- **"Pedidos em andamento"**: até 4, com a etapa; o recusado fica 7 dias, com
  o motivo. **"Envios a caminho"**: até 3, com o dia da chegada.
- **"Seu estoque"**: "Valor do estoque" (custo, base do seguro ad valorem),
  "Disponível", "Reservado em pedidos" e "Abaixo do mínimo".
- **"Faturas"**: o mês anterior ("Em fechamento" até a Dutelog emitir) e a
  fatura mais recente antes dele.

## Estoque

A busca é por nome ou código. "Situação": "Todos", "Com saldo", "Abaixo do
mínimo", "Sem saldo" e "Arquivados"; "Ordenar": "Mais relevantes", "Maior
saldo", "Menor saldo" e "Nome: A-Z"; a exibição em "Cards" ou "Lista".
"Abaixo do mínimo" vale só para o item com o mínimo na ficha.

- **"Adicionar"** põe no pedido até o "Disponível para pedido"; o que já está
  no pedido conta.
- **"Seu pedido"**: "Nome do pedido (opcional)", até 120 caracteres;
  "Entregar em", obrigatório; "Para quando", de agora em diante (no passado,
  o carrinho avisa antes de enviar); "Observações". O pedido fica salvo no
  aparelho, por login ("Salvo neste aparelho"), até o envio.
- **"Enviar pedido para a Dutelog"** reserva as peças na hora. Faltando saldo,
  o servidor recusa: "Saldo insuficiente para o SKU … Disponível: …;
  solicitado: …". O pedido ganha o número da sequência do cliente (PED-0001)
  e a tela abre Pedidos. Um pedido leva até 100 itens de separação (um
  produto em duas posições são dois): acima, o carrinho avisa antes de enviar
  ("Divida em mais de um pedido"). Durante o inventário de abertura
  ("Inventário inicial em andamento"), o envio espera.
- **"Salvar como evento"** guarda os itens, o "Entregar em" (o local,
  obrigatório) e as observações, com o "Nome do evento" e a "Data do evento".
- **Item sem saldo:** "Avisar reposição" manda à Dutelog a solicitação
  "Reposição: …", que não aparece em Pedidos nem em Envios. "Arquivar" (só
  sem saldo e sem reserva) leva o item a "Arquivados"; "Devolver à vitrine"
  desfaz. Se o saldo voltar, o item volta sozinho.

## Pedidos

| Etapa | O que quer dizer |
|---|---|
| Pedido feito | Enviado. No Início, "Aguardando confirmação" e, confirmado, "Confirmado pela Dutelog". |
| Em separação | O armazém separa e confere. |
| Saiu para entrega | Expedido, com a transportadora e a placa quando publicadas. |
| Entregue | Entregue; o "Comprovante de entrega" aparece quando a Dutelog publica. |

- **"Cancelar pedido"** vale enquanto a Dutelog não confirmou: pede a
  confirmação ("Cancelar PED-0001?", "Cancelar pedido" ou "Manter") e devolve
  as peças reservadas ao estoque. Confirmado, só falando com a Dutelog.
- **"Recusado"**: as peças voltam, e o motivo aparece quando a Dutelog informa.
- **"Ver itens"** abre o pedido: "Itens" ("Código", "Produto", "Peças"; sem
  código, "código a definir") e "Atualizações da Dutelog", a mais recente antes.

## Eventos

Só no modelo Uniformes. O evento é um modelo de pedido: não reserva nem
movimenta estoque. Nasce em Estoque › "Salvar como evento".

- **O cartão** mostra "Próxima edição" (ou "Última data"), o local, a
  montagem e o transporte, os itens ("Ver os N itens" com mais de 6), "Falta
  no estoque de hoje: …" ou "Tudo disponível no estoque de hoje" e o valor das
  peças, base do seguro de transporte.
- **"Usar no pedido"** abre o Estoque com o pedido montado: os itens até o
  saldo livre (o que falta, a tela avisa), o local em "Entregar em", "Para
  quando" na véspera às 7h e a montagem e o transporte nas observações. Sem
  data futura, "Para quando" fica vazio. Quem envia é a pessoa.
- **"Editar"** muda "Nome", "Próxima edição", "Descrição", "Local",
  "Endereço", "Montagem e retorno", "Transporte e equipe" e as quantidades.
  Tirar item vale; incluir é salvar um novo evento pelo Estoque.
- **Limites:** nome até 120 caracteres, local até 160, os outros textos até
  300; de 1 a 200 itens.
- **Excluir** (a lixeira) arquiva: "O evento sai da lista. Pedidos já
  enviados com ele continuam como estão."

## Envios para a Dutelog

O aviso não mexe no estoque: o saldo entra só com a conferência na chegada.

- **"Avisar um envio"** começa pela nota: "Anexar nota" (PDF ou imagem, até
  15 MB cada, até 8; o scan grande é reduzido no navegador). A primeira nota
  vai ao Agent Dute ("Ler nota"), que preenche "Fornecedor", "NF ou pedido
  (opcional)" e "Observações (opcional)" onde estão vazios e sugere os itens;
  a pessoa confere e escolhe. "Colar itens da planilha" aceita código e
  quantidade por linha.
- **Pede** o "Fornecedor" e ao menos um item; "Chega em" é opcional. O código
  fora do estoque é produto novo e pede o nome; sem código, o item vira
  "código a definir". Código repetido não vale: "Junte as quantidades numa
  linha só." "Enviar aviso" dá o número da sequência do cliente (ENV-0001).
- **As etapas** são "Avisado", "Confirmado pela Dutelog" e "Chegou no
  armazém". "Cancelar aviso" só vale em "Avisado".
- **O que chegou** mostra o recebido contra o avisado ("118 de 120 peças") e
  as linhas diferentes.

## Minhas OS

As OS da empresa, ao vivo: as da demanda do Comercial, as da solicitação do
portal e as da entrega do WMS. Os números: "Em execução", "Agendadas" (com as
para agendar), "Concluídas" e, com as faturas no contrato, "A pagar" (o saldo
das NFs abertas).

| Situação | O que quer dizer |
|---|---|
| Para agendar | A OS existe e ainda não tem data. |
| Agendada | Tem a data ("hoje" ou o dia) e a janela. |
| Em execução | A equipe registrou a primeira etapa. |
| Concluída | Concluída no local; a revisão da Dutelog é interna. A OS reaberta pela Dutelog volta a "Em execução" e perde o comprovante até concluir de novo. |
| Cancelada | Cancelada antes de começar; sem andamento. |

- **A ordem:** em execução, agendadas pela data e para agendar; depois as
  concluídas e as canceladas, a mais recente primeiro. A busca acha número,
  serviço ou endereço. A vistoria aparece como "Vistoria" e não tem
  comprovante.
- **A NF da demanda** vem em cada OS: "NF 1234 · Vence em 7 dias".
- **O painel da OS** mostra o andamento ("Pedido recebido", "Agendada", "Em
  execução" com a última etapa e a hora, "Concluída"), "Data", "Origem",
  "Destino", "Motorista" (nome e placa), "Recebimento" (quem assinou e
  quando), "Faturamento" e, na concluída, "Comprovante".
- **Fica de fora** o que é interno: a revisão, as ocorrências, as presenças, a
  equipe além do motorista, os itens previstos e as fotos fora as do final.

## O comprovante

Abre pelo "Comprovante" da OS concluída ou pelo aviso "OS … concluída". É o
papel A4 "Comprovante de execução", sem valor: o número, o serviço e
"Concluída em"; "Cliente" e "Demanda"; "Data e janela" e "Motorista e
veículo"; "Origem" e "Destino"; os "Itens" com o "Feito"; o "Recebimento",
com a assinatura, o nome, o cargo e o documento, ou "Sem aceite no local"; as
"Fotos do final". "Baixar PDF" usa a impressão do navegador e leva só o
papel. A OS concluída antes de a conclusão listar as fotos do final sai sem
elas; a não concluída diz "A OS … ainda não tem comprovante."

## Solicitar OS

"Solicitar OS" fica em Minhas OS, com a Operação no contrato e liberada no
ambiente. O formulário começa em "Transporte / frete", amanhã às 08:00.

| Campo | Regra |
|---|---|
| "Tipo de serviço" | "Transporte / frete", "Armazenagem / movimentação", "Serviço em campo" ou "Mudança / transporte dedicado". |
| "Data" e "Horário" | De São Paulo; depois de agora e até 365 dias à frente. |
| "Origem" | De 3 a 160 caracteres. |
| "Destino" | Opcional, até 160 caracteres. |
| "O que será feito" | De 3 a 1000 caracteres. |
| "Anexar nota fiscal ou documento" | Até 3 arquivos, PDF, JPG, PNG ou WEBP, até 10 MB cada. |

- **"Enviar solicitação"** sobe os anexos e grava a solicitação; repetir uma
  tentativa que falhou não cria outra. Saiu: "Solicitação enviada".
- **Na Dutelog**, a solicitação cai em Para planejar da Operação e no Início
  dela, e nunca vira demanda nem OS sozinha. Quem coordena usa "Atender", que
  abre a demanda direta com o cliente, o canal Portal, quando chegou e o nome
  do login que pediu, ou "Recusar", com o motivo (5 a 300 caracteres) que o
  cliente lê.

| Em "Solicitações" | O que quer dizer |
|---|---|
| "Aguardando a Dutelog" | Recebida, sem decisão. |
| "Em planejamento" | Virou a demanda ("Demanda 10050"); sai da lista quando a primeira OS dela aparece em Minhas OS. |
| "Não atendida" | Recusada; o motivo fica 30 dias na lista. |

## Faturas

- **"NFs dos serviços"** (com as faturas no contrato, quando há), com o "A
  pagar" no topo: as que esperam pagamento primeiro, pelo vencimento; depois
  as pagas, a mais recente primeiro. Cada NF traz "Emitida … · vence …", cada
  demanda com o título e o valor, a armazenagem do mês que entrou nela
  ("Armazenagem 09/2026 · R$ …"), o saldo (com pagamento parcial, "de R$ …"
  ao lado) e a situação: "Vence hoje", "Vence amanhã", "Vence em N dias",
  "Vencida há N dias" ou "Paga em …". Vencida é a NF com saldo e vencimento
  antes de hoje. A NF cancelada sai do portal.
- **A fatura mensal** (só a emitida ou paga): o mês com a variação "vs mês
  anterior", "Média mensal", "Acumulado" do ano, "Pedidos entregues", "Gasto
  por mês" ("6 meses" ou "12 meses") e "Para onde vai o dinheiro", por
  serviço. A tabela "Faturas" diz "Paga em …" ou "A pagar"; "Ver fatura" abre
  o documento, com "Imprimir / Salvar PDF".
- **"Gerar relatório"** abre o extrato das faturas mensais, dos últimos 3
  meses até a fatura mais recente ("De" e "até" mudam o período): "Baixar
  planilha" (XLSX) e "Salvar PDF". As NFs dos serviços não entram nele.

## Documentos

"Publicados pela Dutelog" (contratos e comprovantes que ela libera para a
conta), "Suas notas fiscais (anexadas nos avisos de envio)" e "Faturas" (as
fechadas). A busca acha nome, PED-, ENV- ou o número da NF, e o "Tipo de
documento" filtra quando há mais de um.

## Avisos: o sino e o e-mail

| Aviso | Quando | Abre | Pede no contrato |
|---|---|---|---|
| "OS 10045-01 agendada" | A OS ganha a data; o texto traz os serviços e a janela. | Minhas OS | Operação |
| "OS 10045-01 em execução" | A primeira etapa ("desde 09:35"). | Minhas OS | Operação |
| "OS 10045-01 concluída" | A conclusão no local. | O comprovante | Operação |
| "NF 1234 emitida" | O Financeiro registra a NF; o valor e o vencimento. | Faturas | Faturas |
| "Solicitação recebida" | A solicitação enviada pelo portal; o tipo e o dia. | Minhas OS | Operação |
| "2 itens parados no estoque" | A coordenação aprovou o alerta: "Sem movimento há 90 dias ou mais" e até três códigos. | Estoque | Armazenagem |

- **O sino** traz os 20 avisos mais novos da empresa, ao vivo. Novo é o que
  chegou depois da última vez que o login abriu o sino ("Avisos: 2 novos");
  abrir marca tudo como visto, só para aquele login.
- **O prazo:** a rotina roda a cada 5 minutos e pega o evento com mais de 1
  minuto: o aviso chega em até 6 minutos. A vistoria, a OS cancelada e os
  pedidos e envios do armazém não dão aviso.
- **O e-mail** vai aos contatos do cliente no cadastro da Dutelog (Comercial ›
  Clientes) ativos, com e-mail e com o modelo marcado em "Avisos por e-mail".
  A "NF emitida", que leva valor, vai só ao "Gestor do cliente" e ao
  "Financeiro", nunca à "Gerenciadora". Sai de "Dutelog
  <avisos@dutelog.com.br>", com o assunto "… · Dutelog" e o link da tela.
- **Sem a chave de envio (`RESEND_API_KEY`) no ambiente**, o e-mail fica só
  registrado na fila e não sai; só o sino recebe.

## Agent Dute

- **Onde:** no menu do cliente com a armazenagem no contrato, na barra do
  Início e pela tecla "/".
- **O que faz:** consulta e responde sobre o estoque, os pedidos, as entregas
  e, com as faturas no contrato, as faturas da empresa. Monta o rascunho do pedido e do aviso de envio, que
  a pessoa confere e manda ("Enviar pedido", "Enviar aviso"), ou abre no
  Estoque e em Envios. Aceita até 3 notas anexadas na conversa.
- **O que não faz:** não envia, não cancela e não muda nada sozinho: "O Agent
  Dute monta pedidos para você conferir; quem envia é você."
- **"Rotinas":** perguntas que o agente responde sozinho no horário marcado
  ("Todo dia", "Dias úteis", "Semanal" ou "Mensal"), até 5. As respostas ficam
  em "Histórico das rotinas" e avisam no Início.

## Minha conta

Em Configuração: "Minha conta" mostra "Nome", "E-mail" e "Perfil" (para mudar,
fale com a administração), a "Aparência" do aparelho (claro, escuro ou
sistema) e "Sair". "Aplicativo no celular" instala o portal como aplicativo.

## Homologação e produção

| Recurso | `dute-homolog` | `dute-prod` |
|---|---|---|
| O menu por módulo contratado, Minhas OS, o comprovante, "Solicitar OS" e o sino | Sim | Sim |
| NFs dos serviços e o aviso "NF emitida" | Sim | Sim |
| Aviso "Itens parados" | Sim | Sim |
| Agent Dute | O do núcleo: lê a Armazenagem, a Operação (sem valor) e as faturas do contrato. | O mesmo |
| E-mail dos avisos | Só registrado | Só registrado |

A produção recebeu os quatro primeiros em 25/10/2026
(`docs/plataforma/lancamento-producao.md`, seção 1). O `dute-btg`, parado
desde o corte da Fase 1, fica de fora de todas as listas.
