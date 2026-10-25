# Treinamento por marco

O plano pede treinamento a cada marco de produção: o Comercial, a coordenação
da Operação, os líderes de campo, o financeiro e o cliente
(`docs/plataforma/plano-de-implantacao.md`, Contínuo). Também entra a equipe
do armazém, que recebe as telas novas no lançamento. Este roteiro dá uma
sessão por público: o que ler antes, o que fazer na homologação e quando a
pessoa está pronta. O detalhe de cada tela está no manual do módulo; aqui
fica só a ordem do treino.

Toda sessão roda no `dute-homolog`, nunca na produção, com os logins e os
dados de teste da seção "Antes das sessões". Quem conduz é a pessoa que já
conhece o módulo; a pessoa treinada faz cada passo com as próprias mãos.

## Antes das sessões

Na homologação, com a `main` publicada:

- **Logins**, um por papel: `owner`, `interno`, `wms`, `comercial`,
  `financeiro`, `campo` e um `cliente` (Configuração › Pessoas e acessos).
- **O cliente de teste** com a Operação e as faturas no contrato e um contato
  com os avisos ligados (Comercial › Clientes). Para a Armazenagem, o mesmo
  cliente com a armazenagem no contrato e a sigla do SKU.
- **Um colaborador** com o "E-mail do app" igual ao do login `campo`, e um
  veículo (Operação › Colaboradores e Veículos).
- **Um item no estoque** do cliente de teste, para o pedido e a separação.

O ciclo inteiro, do pedido do cliente à NF paga, já está descrito em
`docs/plataforma/lancamento-producao.md`, seção 3. As sessões abaixo partem
dele e se encadeiam: a OS que o cliente pede é a que a coordenação planeja,
o líder executa, o Comercial orça e o financeiro cobra.

## Coordenação da Operação (`interno`)

**Quando:** marcos 3 e 4. **Ler antes:** `docs/manual-operacao.md`, do
"Início" aos "Relatórios".

1. **Atender a solicitação do portal.** Em Hoje › Para planejar, "Atender"
   abre a Nova demanda preenchida; incluir os itens e gravar.
2. **Planejar.** "Planejar OS" com duas OS: a primeira com a equipe, o líder
   e o veículo, "Agendar"; a segunda sem data, "Salvar rascunho". Ver os
   avisos (sem líder, pessoa em outra OS) e o que impede de gravar (o
   "Restante" vermelho).
3. **Escalar.** Pelo número da OS em Para agendar, o painel de escalar:
   data, hora, equipe e veículo.
4. **Agenda.** Achar a OS na semana e "Reagendar".
5. **Acompanhar e revisar.** Depois da sessão do campo, abrir a OS
   concluída, decidir uma divergência ("Passar para a próxima OS" ou
   "Absorver sem cobrar") e "Concluir revisão".
6. **Vistoria.** Numa demanda do Comercial, "Planejar vistoria".
7. **Relatórios.** Abrir um e baixar o Excel.

**Pronto quando** a pessoa leva sozinha uma demanda de Para planejar até a
OS revisada e explica por que a OS da equipe aparece no celular do líder
(o papel Campo e o "E-mail do app").

## Líderes de campo (`campo`)

**Quando:** marco 3, no celular de cada líder. **Ler antes:**
`docs/manual-operacao.md`, "O app do campo".

1. **Entrar** em `/campo` e achar a OS em "Minhas OS › Agora".
2. **Etapas:** registrar a próxima no botão grande; "Outra etapa" para pular.
3. **Itens:** + e − até o previsto; "Incluir item executado" para o a mais.
4. **Equipe no local:** a "Entrada" e a "Saída" de todos, inclusive de quem
   não tem app.
5. **Concluir OS:** o motivo do item a menos, as "Fotos do final" e a
   assinatura do responsável em "Assinar aqui"; numa segunda OS, "Sem
   responsável no local".
6. **Sem sinal:** com o celular em modo avião, registrar uma etapa e um
   item; o topo mostra os registros guardados. Voltar o sinal e ver a fila
   esvaziar, sem duplicar.
7. **Vistoria:** "Registrar chegada", um ambiente com foto e item, e
   "Enviar vistoria ao comercial".

**Pronto quando** o líder conclui uma OS com a assinatura e outra feita em
modo avião, sem perder registro.

## Comercial (`comercial` e o `owner` que aprova)

**Quando:** marcos 2 e 4. **Ler antes:** `docs/manual-comercial.md`.

1. **Novo orçamento** para um prospect ("Novo prospect"), com o contrato e a
   tabela.
2. **Montar:** uma linha da tabela, uma com preço alterado (pede o motivo),
   um item avulso e um ajuste; "Salvar".
3. **Aprovar:** "Enviar para aprovação"; com o `owner`, o "Conferir" e
   "Aprovar" (e, numa segunda vez, "Devolver" com a nota).
4. **Enviar:** "Enviar ao cliente", o PDF por "Imprimir / Salvar PDF" e o
   envio pelo Outlook, fora do sistema.
5. **Depois do envio:** "Fechado" com o respondido em, o contato e o link do
   e-mail; ver o escopo chegar à Operação.
6. **A direta:** a demanda que a Operação revisou chega em Execução a orçar;
   "Orçar execução", aprovar e "Validado".
7. **Contratos, Autorizações e Medições:** abrir cada fila e achar a demanda
   do exercício.

**Pronto quando** a pessoa leva um orçamento da montagem ao fechado e a
execução da direta até "Validado", sabendo quando o `owner` precisa aprovar.

## Financeiro (`financeiro`)

**Quando:** marco 4, com a parte 4.9b (o Financeiro ligado na produção).
**Ler antes:** `docs/manual-financeiro.md`.

1. **A faturar:** a demanda validada do exercício do Comercial; "Faturar",
   "Emitida fora", o número, a série e a emissão, e "Registrar NF".
2. **A receber:** marcar a NF como enviada, lançar um pagamento parcial e o
   que quita. Ver a NF no portal do cliente de teste, com o saldo.
3. **Estornar** o último pagamento e lançar de novo.
4. **Armazenagem:** a competência emitida no WMS aparece em A faturar.
5. **Relatórios:** a receita e as contas a receber, com o Excel.
6. **A Omie** (só onde está ligada, hoje a homologação): "Emitir pela Omie"
   e a tela Emissões.

**Pronto quando** a pessoa leva uma demanda de A faturar a Paga e explica
quando a NF sai pela Omie e quando é "Emitida fora".

## Armazenagem (`interno` e `wms`)

**Quando:** marco 4, quando Início, Pedidos, Estoque e Receber passam para
as telas novas. **Ler antes:** `docs/manual-armazenagem.md`.

1. **O cliente ativo:** trocar no seletor e ver o que segue o cliente (os
   itens, a Contagem, a chegada avulsa) e o que mostra todos (Início,
   Pedidos, a fila do Receber).
2. **Pedidos:** aprovar uma solicitação (com o `interno`), "Separado" com o
   lacre e "Entregue" com quem levou e a placa. Num pedido, a "Entrega pela
   Dutelog"; em outro, a "Retirada pelo cliente".
3. **Receber:** a "Chegada avulsa" de um item do cliente; a conferência com
   uma linha a menos, a "Justificativa da divergência" e "Concluir entrada";
   a guarda numa posição da zona do cliente.
4. **Itens:** a ficha, uma foto e, com o `interno`, "Ajustar saldo".
5. **Etiquetas:** imprimir a da posição.

**Pronto quando** a pessoa recebe uma chegada com divergência até a guarda e
leva um pedido da aprovação à entrega.

## Cliente (portal)

**Quando:** marco 4, com quem usa o portal em cada cliente. **Ler antes:**
`docs/manual-portal.md`.

1. **Entrar** pelo convite e, se precisar, "Esqueci minha senha".
2. **Estoque:** montar um pedido com o "Para quando".
3. **Envios:** avisar uma chegada com a NF.
4. **Minhas OS:** "Solicitar OS" com um anexo; acompanhar a OS do exercício
   e abrir o comprovante.
5. **Faturas:** achar a NF, o vencimento e o saldo.
6. **Avisos:** o sino e, no contato com o modelo ligado, o e-mail.

**Pronto quando** o cliente pede uma OS e acha sozinho o comprovante e a NF
dela.

## RH (`rh`)

**Quando:** quando o RH for ligado na produção (outro OK, `fase-8-rh.md`).
**Ler antes:** `docs/manual-rh.md`.

1. **Pessoas:** abrir a ficha de um colaborador.
2. **A ficha:** lançar um documento, um exame com o resultado e um
   treinamento com o vencimento; subir o arquivo e abri-lo.
3. **Início:** ver o vencimento em 30 dias aparecer no "Precisa de você".
4. **Exportação:** gerar a do mês e baixar.

**Pronto quando** a pessoa mantém a ficha em dia e gera a exportação para a
contabilidade.

## Registro

Uma linha por sessão dada, para saber quem já foi treinado em cada marco.

| Marco | Público | Data | Quem conduziu | Pessoas | Observações |
|---|---|---|---|---|---|
| | | | | | |
