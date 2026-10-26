# Manual do Comercial

Para quem orça e acompanha o serviço até o faturamento: `owner` (o único que
aprova), `admin` e `comercial` (quem monta os orçamentos); o `financeiro` lê
preços, contratos e autorizações. As telas mostram só rótulos, dados e ações;
o que elas não explicam está aqui. O desenho e o registro das partes ficam em
`docs/plataforma/fase-6-comercial.md`, `fase-2-nucleo.md`,
`fase-3-operacao.md`, `fase-7-financeiro-unificado.md` e `fase-5-memoria.md`.

## O menu

| Item | O que tem |
|---|---|
| Início | O "Precisa de você", os orçamentos por etapa e os números do mês. |
| Orçamentos | A fila por etapa; dela saem o novo orçamento, a montagem, a aprovação e o documento A4. |
| Clientes | Clientes e prospects, com locais, contatos e contratos. |
| Contratos | Vigência, condições, tabelas de preço, aditivos e documentos. |
| Autorizações | Os executados à espera do "pode faturar" do cliente e as autorizações a faturar. |
| Medições | A medição mensal dos contratos que cobram assim. |
| Agent Dute | Só onde o agente do núcleo está ligado (hoje, a homologação e a produção). |

## Início

O "Precisa de você", com o mais urgente primeiro:

| Linha | Quando aparece | Ação |
|---|---|---|
| "2 orçamentos para aprovar" | Só para o owner, com orçamento em Para aprovar. | "Aprovar" |
| "Orçamento 10046 – RV01 devolvido" | Para quem montou, com a nota, até mandar de novo. | "Abrir orçamento" |
| "Aditivo a fazer · 10045" | A revisão da Operação pediu aditivo, e nem a RV de aditivo nem a recusa vieram. | "Abrir orçamento" |
| "Vistoria concluída · 10045" | A Operação enviou a vistoria, e o orçamento em montagem não a carregou. | "Abrir orçamento" |
| Alerta de contrato | Fim da vigência, aviso de denúncia (ou oposição) e reajuste, desde 120 dias antes. | "Abrir contrato" |
| "Faturar até …" ou "Prazo de faturamento vencido em …" | Demanda de contrato com prazo de perda, a partir do primeiro aviso. | "Abrir autorizações" |
| "3 executados esperando autorização há mais de 30 dias" | Dias contados do fim da execução. | "Abrir autorizações" |
| "Medição de setembro/2026 não enviada · cliente" | Do dia 1º do mês seguinte em diante, em rascunho ou não aberta. | "Abrir medição" |
| "10052 aguardando o cliente há 6 dias" | Demanda em Aguardando cliente há mais de 5 dias corridos. | "Abrir orçamento" |

Fica vermelho o contrato vencido ou a 30 dias ou menos, o prazo de faturamento
no último aviso ou vencido e a medição atrasada. No menu, o Início conta todas
as linhas, e cada tela, as que levam a ela. Ao lado, os "Orçamentos por etapa"
e o mês: "Enviados" (primeiro envio ao cliente), "Fechados" (primeira entrada
em Para planejar) e "Perdidos".

## A demanda, o número e as RVs

Cada serviço pedido é uma demanda, numerada a partir de 10001. "10045" é a
primeira versão do orçamento; as revisões vão de "10045 – RV01" a "RV99". Até
o envio, corrigir regrava a mesma RV; enviada, ela fica congelada como o
cliente a recebeu, e mudar é abrir a seguinte. A RV é proposta, aditivo ou
execução (o orçamento refeito com o que foi feito).

| Etapa | O que quer dizer |
|---|---|
| Em montagem | A RV em rascunho. |
| Para aprovar | Espera o owner. |
| Para enviar | Aprovada; falta mandar ao cliente. |
| Aguardando cliente | Enviada; espera o fechamento (proposta) ou a validação (execução e aditivo). |
| Para planejar | O cliente fechou; a Operação planeja as OS. |
| Execução a orçar | O serviço foi feito; falta orçar a execução (a RV de execução fica aqui em montagem) ou validar a RV fechada. |
| Aguardando autorização | Validada; o contrato pede pedido e aceite ou o portal do fornecedor. |
| A faturar | Pode faturar. Sai da fila quando o Financeiro registra a NF. |
| Perdidas | Perdida com motivo antes de A faturar; por prazo de faturamento, também em A faturar, antes da NF. |

## A fila e o novo orçamento

- **Os segmentos** são as etapas e "Todas". O `comercial` abre em Para enviar
  (ou Em montagem, sem nada para enviar); o owner, em Para aprovar. Quem
  espera há mais tempo vem primeiro; nas Perdidas, a mais recente. "Aguardando
  autorização" fica vermelho com 30 dias ou mais na etapa. Um clique abre a
  ficha, com o histórico e as ações; dois abrem o orçamento.
- **"Novo orçamento"** pede o "Cliente" (nome ou CNPJ), o "Contrato" (vem o
  vigente; o encerrado não aparece; "Sem contrato" vale) e a "Tabela"
  ("Comercial" ou "Noturna"). Quem não está no cadastro entra por "Novo
  prospect", com o código tirado do nome. "Criar orçamento" dá o número.

## Montar o orçamento

- **"Para"** é um contato ativo do cliente (ou "Novo contato…"). **"Recebido
  em"** vem com a hora da criação: corrija para a hora em que o pedido chegou.
- **"Adicionar item…"** acha o item pelo código ou por palavras; os outros
  serviços do mesmo item aparecem embaixo e entram na mesma quantidade.
- **"Salvar"** (ou Ctrl+S) grava; se outra pessoa mudou o orçamento, ele
  recarrega. "Condições" saem no documento; "Observações internas", nunca.

| Origem da linha | Quando | Pede |
|---|---|---|
| Tabela | Item da tabela, no preço dela. | A quantidade. |
| Alterado | Item da tabela com outro preço; o da tabela aparece riscado. | "Motivo". |
| Avulso | Item fora da tabela ("Item avulso"). | Descrição, preço e "Motivo". |
| Ajuste | Desconto ("Ajuste"), sempre negativo, quantidade 1. | Valor e "Motivo". |

- **A tabela** é a do cliente e do contrato, na variante escolhida, vigente na
  data-base (a da criação do orçamento, que todas as RVs herdam). Só o cliente
  sem tabela nessa variante usa a Padrão Dutelog; o que tem, mas nenhuma que
  sirva, fica "Sem tabela" e só aceita avulso e ajuste. Armazenagem não se orça.
- **Trocar a tabela** ("Comercial" ou "Noturna") grava na hora; a linha que
  falta na nova vira avulsa, com o preço que tinha. O contrato não muda aqui.
- **Os totais** são prévia até salvar; vale o do servidor, que avisa quando
  recalcula. "Duplicar" (salve antes) cria outro, com a data-base de hoje.
- **"Enviar para aprovação"** pede "Para", título e uma linha; com alteração,
  salva antes e para se o total mudou.
- **"Orçamentos parecidos"** (onde a memória está ligada; hoje, a homologação
  e a produção) mostra até três demandas
  fechadas do cliente; "Usar as quantidades" só preenche as linhas.

## Aprovar

- **Só o owner aprova**, na montagem ou em "Para aprovar", a tela do celular
  que o "Aprovar" do Início abre. O que ele monta também passa por "Enviar
  para aprovação". Fora do app, não há aviso.
- **O "Conferir"** lista a linha alterada (com o preço da tabela riscado e o
  motivo), a avulsa, o ajuste, "Tabela fora da vigência na data-base" e "Sem
  tabela". Se o orçamento sai da fila ou muda no meio, o cartão para.
- **"Devolver"** pede a "Nota" e volta o orçamento a Em montagem; quem montou
  puxa de volta com "Editar", sem nota. Não há desfazer: depois de "Aprovar",
  "Editar" volta ao rascunho, sem a aprovação.

## O documento A4 e o envio

- **"Enviar ao cliente"** (no aprovado) e **"Aprovar e enviar"** gravam o
  envio, congelam a RV e só então abrem o documento, já na impressão.
- **O PDF sai por "Imprimir / Salvar PDF"** e vai pelo Outlook: o sistema não
  manda e-mail. O arquivo é "Orçamento 10045 – RV01 – referência – título".
- **Até o envio**, "Prévia do PDF" mostra o orçamento como está, com a marca
  "Prévia"; depois, "PDF" abre a cópia congelada. O cabeçalho mostra "Dutelog
  Soluções Logísticas" até a razão social e o CNPJ serem informados.

## Depois do envio

| Etapa e tipo da RV | Ações |
|---|---|
| Aguardando cliente, proposta | "Fechado", "Revisar", "Perdido" |
| Aguardando cliente, execução | "Validado", "Revisar" |
| Aguardando cliente, aditivo | "Validado", "Recusar aditivo", "Revisar" |
| Para planejar | "Registrar execução", "Aditivo", "Perdido" |
| Execução a orçar | "Orçar execução", "Validado" |
| Perdidas | "Reabrir" |
| RV seguinte ainda não enviada | "Descartar RV" (em Para aprovar, só o owner ou quem montou) |
| Rascunho ou aprovado, antes de faturar | "Perdido" |

- **"Fechado", "Validado" e "Recusar aditivo"** pedem "Respondido em" (nem
  depois de agora, nem antes do envio), o "Contato" e o "Link do e-mail".
  "Fechado" faz das linhas o escopo, sem preço, e o prospect vira cliente.
- **"Perdido"** pede o "Motivo": "Preço", "Prazo", "Desistência", "Sem
  resposta", "Cancelado pelo cliente" ou "Outro" (com a "Nota"). Depois do
  fechamento, da execução ou da validação, só "Cancelado pelo cliente".
  "Reabrir" volta à etapa de antes (a proposta não aceita, numa RV nova).
- **"Revisar"** ("Pedido do cliente" ou "Correção") abre a RV seguinte, com as
  mesmas linhas, data-base e tabela. "Descartar RV" tira a que não foi ao
  cliente e volta à enviada; a primeira RV não se descarta (perca a demanda).
- **"Registrar execução"** pede "De" e "Até" (até hoje), mesmo com um aditivo
  em negociação. **"Aditivo"** abre a RV de aditivo, com aprovação e envio;
  validado antes da execução, amplia o escopo; recusado, vale a RV fechada.
- **"Orçar execução"** abre a RV de execução, com o que foi feito; "Validado",
  ali, valida a RV fechada como está. A validação leva a Aguardando
  autorização, se o contrato pede pedido e aceite ou portal; senão, a A
  faturar (no contrato por medição mensal, à espera da medição).
- **"Aprovação dispensada."** A RV de execução vai direto por "Enviar ao
  cliente" quando, diante da RV fechada, só mudaram quantidades de linhas de
  tabela (nada novo, alterado, avulso ou de ajuste; o mesmo item, preço e
  tabela) e o total não passa o fechado. O servidor confere de novo no envio.

## O que chega da Operação

- **A demanda direta** (paraquedas e emergencial) nasce na Operação, sem
  orçamento, e chega depois da execução, em Execução a orçar, como "Sem
  orçamento". "Orçar execução" pede o contrato e a tabela e põe o que a
  revisão manda cobrar, pela tabela; o resto vem em "Fora da tabela, para
  lançar". No alto da fila, "Orçar execução" abre a direta que chega já feita
  ao Comercial, com "De" e "Até". As duas passam pelo owner.
- **"Execução na Operação"**: por item, "Executado", "A cobrar", "Absorvido"
  e "Aditivo". **"Vistoria da Operação"**: os itens, os ambientes com fotos,
  as medidas e o acesso; "Carregar itens no orçamento" põe os itens pela tabela.

## Clientes

- **Prospect** é quem ainda não fechou: sem sigla nem módulos, fora do WMS.
  Vira cliente no primeiro "Fechado" (na direta, no primeiro "Validado") ou em
  "Marcar como cliente", que não liga nada no WMS.
- **O "Código"** sai do nome (letras sem acento, números e hífen, de 2 a 20) e
  não muda. Código e raiz de CNPJ repetidos são recusados: filial fica no
  mesmo cadastro. No cadastro com o selo "Armazenagem", "Editar" só muda
  cidade e UF; o resto, em Configurações › Clientes.
- **Locais e contatos:** nome, sigla e e-mail não se repetem no cliente, e
  "Desativar" tira das escolhas novas. O "Papel" do contato é "Gestor do
  cliente", "Gerenciadora", "Financeiro" ou "Outro"; a gerenciadora é a
  "Empresa" do contato, não um cadastro, e a ficha agrupa por empresa. Nos
  "Avisos por e-mail", "NF emitida" é só do gestor e do financeiro do cliente.
  O cliente arquivado ou "Sem portal" não recebe aviso.

## Contratos

Contrato é de cliente; prospect não tem. O selo diz "Vigente", "A iniciar",
"Renovação em N dias" (vermelho a 30 dias ou menos, ou com o prazo de aviso
perdido), "Renovação a registrar", "Vencido" ou "Encerrado". As "Tabelas de
preço" da ficha são só leitura: entram por carga.

- **O que move a demanda:** o "Regime de cobrança" ("Por demanda", "Medição
  mensal", "Fatura do WMS", também por serviço), a "Autorização de
  faturamento" ("Pedido e aceite", "Medição aprovada", "Portal do fornecedor",
  "Sem autorização") e o "Prazo de perda (dias)". "Situação" encerra.
- **"Registrar aditivo":** o número seguinte já vem. Aditivo registrado não
  muda. Prorrogação, e preço com vigência nova, prorrogam o contrato quando o
  fim novo passa do atual; o encerrado não prorroga.
- **Os alertas** (ficha e Início): fim da vigência, aviso de denúncia (ou
  oposição, na automática) e reajuste por índice, desde 120 dias antes. O
  vencido segue até o aditivo ou o encerramento; o reajuste, 30 dias depois.

## Autorizações

- **"Executados aguardando autorização"**: a RV validada, o valor enviado e os
  dias desde o fim da execução (vermelho acima de 30), o mais antigo primeiro.
- **Registrar.** Marque as demandas (um cliente, um contrato e um tipo por
  autorização) e preencha "Pedido" e "Aceite" (ou "Pedido do portal"),
  "Recebida em" (até hoje) e o valor. A prova é o pedido ou o "Documento".
  "Registrar autorização" leva as demandas a A faturar.
- **A conferência** diz "Valor confere com a soma das RVs" ou "Diverge em R$
  …". A divergência não impede: vira a marca "Valor diverge", como "Tomador de
  outra raiz" e "RV não validada". Pedido e aceite repetidos são recusados.
- **O "Tomador · CNPJ"** vai inteiro (filial vale) ou mascarado como no e-mail
  ("11.222.XXX/0001-81"); o servidor completa com a raiz do cadastro.
- **"Autorizadas · a faturar":** as ainda não usadas no faturamento; a da
  medição aparece como "Medição MM/AAAA". "Cancelar" pede o "Motivo", e a
  demanda sem outra autorização volta a esperar. A usada não se cancela.
- **"Prazo de faturamento vencido":** "Perder por prazo" (a "Nota" é
  opcional); "Reabrir" desfaz. O prazo conta do fim da execução: num prazo de
  90 dias, os avisos vêm aos 30, 60 e 80 dias.

## Medições

Uma por contrato e mês, no contrato por medição mensal; se faltam, este mês e
o anterior aparecem "Não aberta". "Envio até" é o dia 1º do mês seguinte.

| Situação | Ação |
|---|---|
| Não aberta | "Abrir medição" |
| Rascunho | "Nova linha" e "Enviar ao cliente" (com uma linha ao menos) |
| Aguardando aprovação | "Registrar aprovação" ou "Registrar contestação" |
| Contestada | "Reabrir", que volta ao rascunho |

- **A linha** só se edita no rascunho; "Executada em" é do mês, até hoje; o
  feriado em dia útil é "domingo/feriado"; a demanda não entra em outra medição.
- **O preço** vem da tabela do contrato vigente na data da solicitação, nunca
  da Padrão Dutelog (a linha noturna usa a Noturna, se houver). Se uma tabela
  entrou depois e mudou um preço, o envio recusa: grave de novo.
- **As marcas:** o dia que não bate com a tarifa (com "Aplicar sábado", ou o
  dia certo), "Rota fora da tabela" e "Sem pedido anexo".
- **"Registrar aprovação"** cria a autorização de faturamento e leva a A
  faturar as demandas já fechadas; as outras ficam em "Demandas pendentes".
- **"Exportar Diário de Bordo"** baixa o CSV no formato do cliente.

## Quem pode o quê

| Papel | Pode | Não pode |
|---|---|---|
| `owner` | Tudo do Comercial, inclusive aprovar, devolver e "Aprovar e enviar". | — |
| `admin`, `comercial` | Orçar, mandar para aprovação, enviar o aprovado, registrar a resposta do cliente e cadastrar clientes, contratos, autorizações e medições. | Aprovar. |
| `financeiro` | Ler preços, orçamentos, contratos, autorizações e medições. | Abrir o Comercial; ler contatos e locais. |
| Operação e campo | A Operação lê a demanda, sem preço. | Ver qualquer valor. |

O servidor aceita que o `financeiro` registre e cancele autorizações, mas
nenhuma tela dele tem a ação. O cliente vê só os valores das suas OS e faturas.
