# Manual da Operação

Para quem planeja e acompanha as ordens de serviço (OS): a coordenação no
escritório (`owner`, `admin` e `interno`), a equipe no celular (`campo`) e a
TV da sala (`painel`). As telas mostram só rótulos, dados e ações; o que elas
não explicam está aqui. O desenho e o registro das partes ficam em
`docs/plataforma/fase-3-operacao.md` (o portal, em `fase-4-financeiro.md`).

**Operação e campo nunca veem valor:** a OS não guarda preço, e nenhuma tela
da Operação mostra valor. Preço é de `owner`, `admin`, `financeiro` e
`comercial`, no Comercial e no Financeiro; o cliente vê os das próprias OS e
faturas.

## O menu

| Item | O que tem |
|---|---|
| Início | O "Precisa de você", "Hoje na operação" e "Equipe hoje". |
| Hoje | O quadro do dia: Para planejar, Para agendar, Agendadas hoje, Em execução e Em revisão. |
| Agenda | A semana, por pessoa e por veículo. |
| Demandas | As demandas e a ficha de cada uma, com a "Nova demanda" e o "Planejar OS". |
| Revisão | As OS concluídas no local que esperam a revisão. |
| Relatórios | As OS por período, cliente, tipo, pessoa e veículo, e as solicitações do portal. |
| Colaboradores, Veículos | O cadastro da equipe e da frota. |
| Agent Dute | O assistente, só onde ele está ligado (hoje, só a homologação). |

O número ao lado do Início conta as linhas do "Precisa de você"; o de outra
tela, as que levam a ela. Fica vermelho quando alguma é crítica.

## Quem faz o quê

| Papel | Na Operação |
|---|---|
| `owner`, `admin` | O que o `interno` faz e, só eles, "Reabrir" a OS revisada. Abrem o app do campo e a TV para conferir. |
| `interno` ("Coordenação" em Pessoas e acessos) | Cadastro, demanda direta, planejar, escalar, cancelar, registrar andamento, concluir pelo escritório, revisar e imprimir. Abre a TV. |
| `campo` | Só o app do campo, nas OS em que está escalado. Não vê o cadastro, não planeja e não revisa. |
| `painel` | Só a TV da sala, que só lê. |
| `comercial` | Não abre a Operação. Lê na demanda o resumo da execução e a vistoria, com as fotos. |

## Início

| Linha | Quando aparece | Ação |
|---|---|---|
| "OS 10045-01 de demanda perdida" (ou "cancelada") | A OS para agendar ou agendada cuja demanda o Comercial perdeu ou cancelou: ela só se cancela. Crítico. | "Cancelar OS" |
| "OS 10045-01 com pessoa desativada" (ou "veículo desativado") | A OS agendada de hoje em diante com alguém ou o veículo desativado no cadastro. Crítico no dia. | "Reagendar" |
| "OS 10053-01 sem agenda" | A OS para agendar da demanda direta com o prazo em até 24 horas, ou vencido. Crítico. | "Escalar" |
| "OS 10045-01 sem equipe" (ou "sem veículo") | A OS agendada para hoje ou amanhã sem ninguém, ou com transporte e sem veículo. Crítico no dia. | "Escalar" |
| "2 solicitações do portal" | Os pedidos do portal que esperam a Operação. Crítico com a data pedida em até 24 horas. | "Atender" |
| "3 OS para agendar" | As OS sem data, fora as da linha "sem agenda". | "Agendar" |
| "1 demanda para planejar" | As demandas em Para planejar ainda sem OS. | "Abrir OS" |
| "CNH de Marcos Andrade vence em 12 dias" | A CNH de quem está ativo, a 30 dias ou menos de vencer, com as OS da pessoa até lá. Vencida, crítico. | "Ver cadastro" |
| "Revisão do DEF-4G56 em 5 dias" | A revisão preventiva do veículo ativo em até 15 dias, hoje ou já passada. Crítico no dia ou com OS dele no dia. | "Reagendar" ou "Ver cadastro" |

Os críticos vêm primeiro; no mesmo tom, a ordem da tabela. A ação leva ao Hoje
(no painel de escalar, quando é uma OS), ao cadastro ou à Nova demanda. Sem
nada, a frase é "Nada parado na Operação."

## Hoje

- **Para planejar:** as solicitações do portal (selo "Portal", "Atender"), as
  demandas com saldo ("Planejar OS") e a visita técnica pedida pelo Comercial
  ("Planejar vistoria").
- **Para agendar:** as OS sem data, a mais urgente primeiro (paraquedas,
  emergencial, planejada; no mesmo tipo, o prazo).

**O painel de escalar** abre pelo número da OS para agendar ou agendada (nas
outras, abre a ficha): "Data" (de hoje em diante), "Hora", "Equipe" e
"Veículo". "Sem equipe" e "Sem veículo" não impedem de agendar; o veículo no
dia da revisão preventiva não se escolhe. "Cancelar OS" pede o "Motivo do
cancelamento" (3 a 200 caracteres): só a OS para agendar ou agendada se
cancela, e a fatia dela volta ao saldo.

O painel mostra um veículo e não escolhe o papel nem o fim da janela: o que o
Planejar OS gravou continua ao salvar (o papel de cada um, os outros veículos e
o fim, com a mesma duração a partir da nova hora). Quem entra pelo painel vai
com o primeiro papel do cadastro, e trocar ou tirar o veículo mexe só no do
painel. Na OS salva como rascunho, ele abre com a equipe e os veículos do plano.

## Demandas

| Tipo | Quando |
|---|---|
| Paraquedas | O prazo é no mesmo dia em que o pedido chegou (dia de São Paulo). |
| Emergencial | O prazo é em até 48 horas corridas. |
| Planejada | Depois disso. |

- **Comercial** é a demanda do orçamento: chega a Para planejar quando o
  cliente fecha o escopo. O aditivo em negociação não trava as OS.
- **Direta** é a aberta na Operação, que se orça depois da execução; a
  solicitação do portal atendida e a entrega do WMS também chegam assim. A
  entrega do WMS aparece como "Armazenagem" na entrada e no filtro.
- **A etapa** é a do Comercial; em Para planejar, diz onde está a OS que mais
  avançou (Em execução, Em revisão, Agendada ou Para agendar).
- **O saldo** ("Escopo e saldo", na ficha da demanda) é o escopo menos a fatia
  das OS não canceladas; a OS revisada conta o que consumiu.

## Nova demanda direta

"Nova demanda" abre o pedido que chega direto na Operação, em geral o
paraquedas e o emergencial. O "Tipo" sai de "Recebida em" e "Executar até"
(hora de São Paulo); "Corrigir" escolhe outro, e fica registrado. "Recebida
em" não passa de agora, e "Executar até" vem depois. Os itens vêm do catálogo
(só o ativo que se orça, sem preço) ou são "Item avulso", até 100. A demanda
nasce em Para planejar, com o número do contador do Comercial e sem orçamento.

**A solicitação do portal.** O cliente com a Operação no contrato pede OS pelo
portal; o pedido cai em Para planejar e no Início e nunca vira demanda nem OS
sozinho. "Atender" abre a Nova demanda preenchida (o cliente, o canal Portal e
a recebida em não mudam; os itens, a coordenação inclui). "Recusar" pede o
"Motivo" (5 a 300 caracteres), que o cliente lê.

**A entrega do WMS.** A "Entrega pela Dutelog" de um pedido de saída abre a
demanda "Entrega do pedido PED-0118" ("Abrir na Operação", se o pedido ficou
salvo sem ela); a "Retirada pelo cliente" não gera OS. As OS nascem agendadas,
sem equipe nem veículo: a ida, do Armazém Dutelog ao destino, na data da
entrega, e, com retorno, a volta, que concluída deixa o retorno a receber no
WMS. Aberta a demanda, a entrega só muda na Operação.

## Planejar OS

O plano nasce com uma OS hoje e todo o saldo. "Mais uma OS" abre a seguinte no
dia seguinte, sem itens, com a equipe e os veículos do plano; até 10. A pessoa
entra com um papel entre os marcados no cadastro (sem nenhum, qualquer um) e,
com mais de uma OS, nas que marcar ("OS 1", "OS 2"); até 20 pessoas e 6
veículos por OS. O "Contato no local" e as "Instruções" valem para todas.

- **Impede de gravar:** OS que somam mais que o saldo de uma linha (o
  "Restante" fica vermelho; "Igualar ao saldo" põe na OS o que sobra), OS sem
  item, data passada, fim antes do início e, ao agendar, OS sem data ou com o
  veículo no dia da revisão preventiva.
- **Só avisa:** OS sem equipe, sem líder ou sem veículo, e pessoa ou veículo
  em outra OS no mesmo dia.
- **"Agendar"** cria as OS agendadas; **"Salvar rascunho"**, as para agendar.

Ligue o "E-mail do app" no cadastro antes de escalar: a OS guarda o acesso de
quem estava ligado quando foi planejada ou agendada. Ligado depois, salve de
novo o escalar da OS, antes de ela começar.

**A duração sugerida** (onde a memória da Dute está ligada; hoje, só a
homologação) aparece na OS com equipe e item do catálogo, com "Usar",
"Ignorar" e a base de cada item: a do cliente, com 5 execuções, ou a média
interna, com 15. É o tempo de trabalho, sem o trajeto: "Usar" só preenche o
fim a partir do início (sem início, das 08:00), e quem planeja soma o resto.

## Agenda

A semana vai de segunda a sábado (o domingo só aparece com OS), com uma linha
por pessoa e por veículo; no dia da revisão, o veículo mostra "Revisão
preventiva". Cada dia conta as OS, as sem equipe e as pessoas em duas OS.
Escolher uma OS acende ela em todas as linhas, com "Abrir OS" e, na agendada,
"Reagendar".

## As situações da OS

| Situação | O que quer dizer |
|---|---|
| Para agendar | A OS existe sem data (salva como rascunho). |
| Agendada | Tem a data; a equipe e os veículos podem faltar. Recebe andamento. |
| Em execução | A primeira etapa foi registrada. Não se reagenda nem se cancela: conclui com o que foi feito. |
| Em revisão | Concluída no local. Não recebe mais andamento; espera "Revisar". |
| Revisada | Revisão feita; só `owner` e `admin` reabrem. Na vistoria, "Enviada ao Comercial". |
| Cancelada | Cancelada com motivo, antes de começar. A fatia volta ao saldo. |

No portal, em "Minhas OS", o cliente vê a OS em revisão ou revisada como
"Concluída"; a revisão, as ocorrências, as presenças, os itens previstos e as
fotos fora as do final ficam internos. Agendar, a primeira etapa e a conclusão
viram aviso no portal; a vistoria não avisa.

## A ficha da OS

**As etapas**, na ordem: Saída do pátio, Chegada na origem, Carregamento,
Saída da origem, Chegada no destino, Montagem e Fim. Pular vale; voltar não: a
etapa repetida, a que vem antes de uma registrada e a hora antes da última são
recusadas. A hora não pode estar no futuro (5 minutos de folga) nem antes do
dia da OS. A primeira etapa pede a equipe escalada e põe a OS em execução.

**"Registrar andamento"** é o que a equipe informa por telefone, WhatsApp ou
pessoalmente ("Informado por", "Meio"); repetir depois de uma falha não grava
duas vezes:

- **"Etapa":** só as que vêm depois da última.
- **"Itens":** o feito de cada linha, em número absoluto, só na OS em
  execução, até o previsto (o planejado mais o incluído em campo, "150 + 10").
  Passou: "Incluir além do planejado", com "Quem pediu no local" e "Motivo". A
  inclusão soma ao feito, não mexe no saldo e vira divergência.
- **"Ocorrência":** "Descrição" (3 a 1000 caracteres) e fotos; até 50 por OS.
- **"Conclusão":** abaixo.

"Anexar", no cartão das fotos, aceita JPG, PNG ou WebP de até 8 MB, até 200
por OS, com a hora do arquivo quando ela é do dia da OS.

**Concluir** (no escritório ou no celular) pede a OS em execução, a hora do
fim depois da última etapa, o motivo de cada item feito a menos (sem feito,
conta zero), ao menos uma foto do final e o aceite: a assinatura do
responsável do cliente ou "Sem aceite no local", com quem recebeu; aí o aceite
vem pela validação do cliente no Comercial. No escritório, "Via assinada no
papel" pede a foto da via, que vira a assinatura. A conclusão registra o Fim,
se faltava, e põe a OS em revisão.

**"Imprimir"** dá a via em A4, sem valor, com o feito em branco e as linhas de
assinatura; concluída a OS, o feito e o aceite entram no lugar.

## Revisão

A lista põe primeiro quem espera há mais tempo. Cada item mostra o planejado,
o executado, o orçado (na direta, o pedido) e o saldo, que acompanha a
decisão. Sem decidir cada divergência, nada se revisa:

| Decisão | Aparece para | O que acontece |
|---|---|---|
| "Cobrar na execução" | O feito a mais na direta, ou quando o saldo livre da linha cobre o que passou | Cobra-se o executado, que sai do saldo. |
| "Pedir aditivo ao Comercial" | O feito a mais na demanda do Comercial | O a mais não se cobra com a execução: o Comercial recebe "Aditivo a fazer". |
| "Absorver sem cobrar" | O feito a mais | O a mais não se cobra. Pede o motivo. |
| "Passar para a próxima OS" | O feito a menos em linha do escopo | Cobra-se o executado; o que faltou volta ao saldo. |
| "Encerrar sem executar" | O feito a menos | Cobra-se o executado; o que faltou não volta ao saldo. |
| "Corrigir quantidade" | Toda divergência | A contagem do campo estava errada: "Quantidade executada" (até o previsto) e "Motivo da correção"; o resto se decide em "O que resta". |

A "Nota da revisão" vai até 1000 caracteres; o botão diz "Concluir revisão" ou
"Concluir revisão e pedir aditivo". A demanda recebe o resumo da execução, que
o Comercial lê; a direta aberta pela Operação vai a Execução a orçar quando a
última OS dela é revisada.

**"Reabrir"** pede o "Motivo": a OS volta a Em execução, com a revisão e a
conclusão no histórico, e a direta em Execução a orçar volta a Para planejar.
Não reabre a vistoria, nem com a execução validada pelo cliente ou o orçamento
da execução já aberto no Comercial.

## Vistoria

A vistoria é uma OS sem itens que vai ao local antes do escopo fechado e
termina no Comercial, sem assinatura nem revisão. A visita técnica pedida pelo
Comercial aparece no Hoje, e a ficha da demanda oferece "Planejar vistoria" (o
Planejar numa OS só). A demanda direta, a fechada pelo cliente, a perdida e a
cancelada não recebem vistoria, e é uma por vez. As etapas são Saída do pátio,
Chegada na origem e Fim; o escritório registra só a saída, a chegada e a
ocorrência, e não envia: quem envia é o líder, pelo celular (sem líder,
qualquer um da equipe). Enviada, fica "Enviada ao Comercial" e não se reabre
(abre-se outra); o Comercial carrega os itens no orçamento.

## O app do campo

Em `/campo`. A pessoa vê só as OS em que está escalada: precisa do papel
"Campo" (Configuração › Pessoas e acessos, de `owner` e `admin`) e do mesmo
e-mail em "E-mail do app", no cadastro. "Minhas OS" tem "Agora" (em execução e
agendadas até hoje), "Depois" e "Feito" (as concluídas com data nos últimos 7
dias).

- **Etapas:** a próxima num botão grande; "Outra etapa" para pular.
- **Itens:** + e − até o previsto, depois da primeira etapa; no previsto,
  "Além do planejado · Incluir". "Incluir item executado" aceita também item
  do catálogo, sem preço.
- **"Equipe no local":** "Entrada" e "Saída". O líder marca as de todos,
  inclusive de quem não tem app; os outros, só a própria. Vale a primeira
  marca, e a saída pede a entrada.
- **"Concluir OS"** é do líder (sem líder, de qualquer um), com a OS começada:
  o "Motivo da diferença" do item a menos, as "Fotos do final" e o
  "Responsável do cliente", que assina no dedo em "Assinar aqui".
  "Sem responsável no local" pede só "Quem recebeu".

**A vistoria no celular:** "Registrar chegada"; os "Ambientes" ("Novo
ambiente", nome único, até 30), com fotos, itens do catálogo e "Concluir
ambiente"; as "Medidas", o "Acesso" e as "Observações". Tudo fica no aparelho
até "Enviar vistoria ao comercial", que pede a chegada, um ambiente, uma foto
e um item.

**Sem sinal.** Cada toque vira um registro com a hora do toque, numa fila
guardada no aparelho e enviada na ordem; sem sinal, ela tenta de novo (2, 4, 8
segundos, até 1 minuto) e o topo mostra "Sem sinal · 4 registros guardados".
Fechar o app não perde nada (a fila é de cada pessoa), e reenviar não duplica.
O registro que o servidor recusa sai da fila e aparece no topo com o motivo.
Em aba privada ou navegador antigo, a fila fica só na memória: não feche o app
sem sinal.

## A TV da sala

Em `/tv`. O login "Painel" entra direto nela; `owner`, `admin` e `interno`
abrem para conferir. Não tem menu, botão nem campo, não grava nada e mantém a
tela acesa onde o navegador deixa; para sair, abra `/configuracoes/conta`.

- **Colunas:** "Agendadas hoje" (com as de dias passados que não começaram),
  "Em execução" e "Concluídas hoje" (o Fim registrado hoje).
- **"Atrasada 32 min"** (ou "Atrasada desde 22/10") é a agendada que passou da
  hora sem começar e a em execução que passou do prazo; sobe para o topo.
- **Atualiza sozinha** a cada 30 segundos (o relógio, a cada 15). Sem conexão,
  segue com o último quadro: "Sem conexão · atualizado às 14:31".
- **Nunca mostra** valor, contato, endereço, instruções, ocorrência, foto,
  motivo de cancelamento nem documento de quem assinou.

## Colaboradores e Veículos

Só `owner`, `admin` e `interno`. Nada se apaga: "Desativar" e "Reativar"; o
desativado não se altera (reative antes) e não entra em OS nova. O "CPF" é
válido e único, o "Telefone" tem DDD, a CNH pede a categoria e a validade
juntas, o terceiro pede a "Empresa", e os "Papéis" marcados são os que a
pessoa pode ter na OS. A "Placa" (antiga ou Mercosul) é única, a
"Capacidade (kg)" é inteira e a "Capacidade (m³)" tem até duas casas.

**"E-mail do app"** liga o celular: pede um usuário ativo com esse e-mail, de
papel `campo` ou `interno`, que não esteja em outro colaborador. Apagar o
e-mail desliga; a lista mostra "no app" em quem tem.

**No dia da "Próxima revisão"** o veículo está na oficina: o planejar e o
escalar recusam ele nesse dia. Os alertas da CNH e da revisão saem do Início
quando a data muda no cadastro. Todo dia às 06:00 (São Paulo), a rotina diária
grava um evento por item nessas janelas, uma vez por dia, e não avisa ninguém.

## Relatórios

A OS entra pelo dia agendado. Concluída é a em revisão ou revisada (a reaberta
sai até concluir de novo); no prazo, a concluída até o dia agendado e, com o
fim da janela, até ele. "OS por tipo" conta a OS em cada serviço dela. O
período vai até um ano e começa nas últimas quatro semanas. "Acerto da
memória" é só de `owner` e `admin`, onde a memória está ligada. "Excel" baixa
a tabela e "PDF" imprime o relatório, sem valor.
