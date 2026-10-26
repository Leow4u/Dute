# Manual do Financeiro

Para quem fatura e recebe: `owner`, `admin` e `financeiro`. As telas mostram
só rótulos, dados e ações; o que elas não explicam está aqui. O desenho e o
registro das partes ficam em `docs/plataforma/fase-4-financeiro.md` e
`docs/plataforma/fase-7-financeiro-unificado.md`.

## O menu

| Item | O que tem |
|---|---|
| Início | O "Precisa de você": as NFs vencidas, as NFS-e rejeitadas ou paradas, as baixas paradas na Omie, a fila A faturar e as NFs para enviar. Cada item leva à tela que resolve. |
| A faturar | As demandas validadas e autorizadas, as competências de armazenagem emitidas e as medições aprovadas, por cliente. |
| A receber, Vencidos, Pagos, Faturas | A cobrança das NFs registradas: enviar, registrar pagamento, estornar e cancelar o registro. |
| Contratos, Autorizações | Os do Comercial, só leitura. |
| Emissões | As NFS-e pela Omie e as baixas dos pagamentos lá. Só onde a Omie está ligada. |
| Relatórios | A receita por cliente e por serviço, as NFs emitidas e as contas a receber. |
| Armazenagem | O Faturamento do WMS. |

## Faturar

O painel "Faturar" de A faturar pergunta como a NF sai:

- **Pela Omie.** Escolha o vencimento (de hoje em diante), a forma e a
  observação, e "Emitir pela Omie". As demandas e a competência ficam "Na
  emissão da NFS-e" até a nota sair ou a emissão ser desistida; nesse tempo
  não se registram à mão nem se emitem de novo.
- **Emitida fora.** O CT-e, que a Omie não emite, ou qualquer NF emitida
  fora do sistema: informe o número, a série e a emissão, e "Registrar NF".

## A medição aprovada

A medição mensal aprovada pelo cliente é uma linha só em A faturar, "Medição
MM/AAAA", pelo total aprovado, com o contrato e o dia da aprovação. Marcada,
o painel mostra o que vai na NF, linha por linha: cada demanda da medição,
com o título e a soma das linhas dela, e as linhas sem demanda (a equipe
fixa do contrato misto), pelo serviço e pelo mês.

- As demandas da medição não aparecem à parte: faturam com ela e ficam
  faturadas juntas.
- A medição espera em "Esperando" quando:
  - ainda não foi aprovada ("Medição pendente");
  - alguma demanda dela não está A faturar ("Demanda pendente", com o
    número). O Comercial valida a demanda, e a medição fica pronta.
  - o Comercial cancelou a autorização da medição ("Sem autorização
    registrada").
- Pela Omie, a medição vai como um item só da NFS-e, "Medição de MM/AAAA".
- Cancelado o registro da NF, a medição volta a A faturar com as demandas.

## A NFS-e pela Omie (tela Emissões)

A rotina anda a cada 5 minutos, uma emissão por vez: acha o cliente na Omie
pelo CNPJ do cadastro, inclui a OS, confere o ambiente, fatura a OS e
acompanha a prefeitura. Autorizada a nota, a fatura nasce sozinha com o
número da NFS-e, e as demandas ficam faturadas. A tela se atualiza a cada
minuto e mostra as 50 emissões mais novas e, mesmo mais antigas, as
rejeitadas e as paradas.

| Etapa | O que quer dizer |
|---|---|
| Na fila, OS incluída, Na prefeitura, Reenviando, Cancelando na Omie | A rotina está andando. Nada a fazer. |
| Autorizada | A nota saiu; "Abrir a NFS-e" abre o PDF da Omie. |
| Desistida | A emissão acabou sem nota; as reservas voltaram a A faturar. |
| Rejeitada, Parada | Precisa de você (abaixo). |

**A rejeitada** é a NFS-e que a prefeitura recusou. Leia a mensagem e a
correção que ela mandou, corrija na Omie (o cadastro do cliente, o serviço)
e "Tentar de novo": a rotina reenvia, e a prefeitura tem outras 72 horas
para responder. Se a nota não deve sair, "Desistir".

**A parada** mostra o motivo:

| Motivo | O que fazer |
|---|---|
| Cliente não achado na Omie | Cadastre o cliente na Omie com o mesmo CNPJ do cadastro da Dute e "Tentar de novo". |
| Cliente repetido na Omie | Deixe um só cadastro ativo com o CNPJ (inative o outro) e "Tentar de novo". |
| Ambiente da Omie errado | A homologação da Dute só emite na Omie de homologação, e a produção, na de produção. Avise o time técnico; não tente de novo antes. |
| Chave da Omie recusada | A chave da API foi recusada (trocada, pausada ou inativa). Avise o time técnico. |
| Sem as chaves da Omie | O ambiente ainda não tem as chaves. Até elas existirem, desista e registre a NF à mão ("Emitida fora"). |
| Falhas seguidas na Omie | A Omie recusou seis vezes seguidas; a mensagem é o último erro. Corrija o que ela disse e "Tentar de novo". |
| OS cancelada na Omie | Alguém cancelou a OS lá. Só "Desistir" e, se for o caso, emitir de novo. |
| Prefeitura sem resposta | 72 horas sem resposta da prefeitura. Confira na Omie e "Tentar de novo": a Dute espera outras 72 horas. |
| Fatura não nasceu | A NFS-e foi autorizada, mas a fatura não pôde nascer, e a mensagem diz por quê (por exemplo, uma demanda que mudou). A nota existe: resolva o que a mensagem diz e "Tentar de novo". O CT-e ou a NF registrados à mão com o mesmo número não atrapalham: a NFS-e da Omie tem o registro dela. |
| NFS-e autorizada na prefeitura | A nota saiu antes de a OS ser cancelada, e a Dute não cancela nota autorizada. Para ficar com ela, "Tentar de novo" registra a fatura. Para desfazer, cancele a NFS-e na Omie e "Tentar de novo": a emissão para em "OS cancelada na Omie", e "Desistir" solta as reservas. |

"Desistir" pede a confirmação na linha. Com a OS já na Omie, a rotina a
confere antes e só a cancela sem nota autorizada ("Cancelando na Omie");
depois, solta as reservas. Com a NFS-e autorizada, "Desistir" não aparece: a
nota vale na prefeitura e se cancela na Omie.

## A baixa na Omie

Registrar o pagamento de uma NF que saiu pela Omie põe a baixa na fila: a
rotina lança o recebimento no título que a OS gerou na Omie, uma vez só.
Estornar o pagamento cancela o recebimento lá. A baixa nunca desfaz nada na
Dute: o pagamento e o estorno valem na hora.

No painel da NF, cada pagamento mostra a baixa dele: na fila, lançada,
cancelando, cancelada, parada ou dispensada. A parada aparece também no
"Precisa de você" e na seção "Baixas na Omie" de Emissões, com o motivo:

| Motivo | O que fazer |
|---|---|
| Título não achado na Omie | A OS ainda não tem o título a receber na Omie. Confira lá e "Tentar de novo". |
| Título repetido na Omie | A OS tem mais de um título a receber. Lance o recebimento à mão na Omie e "Dispensar". |
| Título já recebido na Omie | Alguém deu a baixa lá sem a Dute. Confira os valores e "Dispensar". |
| Sem a conta corrente | O título não tem conta corrente na Omie, e a configuração da Dute também não. Peça a conta ao contador e "Tentar de novo". |
| Chave da Omie recusada, Sem as chaves da Omie, Falhas seguidas na Omie | Como na emissão. |
| Estornada depois de dispensada | O pagamento foi estornado depois de a baixa ser resolvida à mão. Desfaça na Omie o recebimento lançado à mão, se houver, e "Dispensar". "Tentar de novo" não aparece: lançaria o pagamento estornado. |

"Dispensar" quer dizer que a baixa foi resolvida na Omie à mão: a Dute para
de tentar. Pede a confirmação na linha. O que foi lançado à mão a Dute não
desfaz: estornar depois o pagamento para a baixa de novo, com o motivo
"Estornada depois de dispensada".

## Cancelar o registro

"Cancelar registro" é para o erro de quem registrou a NF à mão, sem
pagamento: as demandas voltam a A faturar e a armazenagem à fila. A NF que
saiu pela Omie não tem a ação, porque a nota vale na prefeitura: ela só se
desfaz com a NFS-e cancelada na Omie. Esse cancelamento ainda não sai pela
Dute; avise o time técnico.

## O que o contador e o time técnico preparam

- **As chaves da API da Omie** (`OMIE_APP_KEY` e `OMIE_APP_SECRET`), no
  Secret Manager de cada ambiente: um aplicativo de teste da Omie para a
  homologação (vale 7 dias; a Omie estende por e-mail) e o da empresa real
  para a produção, quando a Omie for ligada lá.
- **Os serviços** `DUTE-OS` e `DUTE-ARMAZENAGEM`, cadastrados pelo contador
  na Omie com esses códigos de integração e o código fiscal de cada um.
- **A categoria de receita e a conta corrente** das OS.
