# Portal do cliente - uso rapido

Use este guia para orientar cliente BTG/Dutelog no portal.

## Acesso

- Rota: `/portal`.
- Perfil esperado: `cliente`.
- O cliente entra direto no portal; usuario interno entra pelo painel interno.

## O que conferir no inicio

1. Veja os cards de estoque: SKUs, pecas, valor e itens por categoria.
2. Confira pedidos e solicitacoes recentes para evitar demanda duplicada.
3. Olhe faturas abertas e competencias recentes.
4. Leia alertas do agente antes de abrir nova demanda.

## Criar solicitacao

1. Em `Nova solicitacao`, escolha o tipo:
   `retirada`, `recebimento`, `inventario`, `ajuste`, `financeiro` ou `suporte`.
2. Defina prioridade: `baixa`, `normal`, `alta` ou `critica`.
3. Selecione o item/SKU retornado pelo estoque do cliente.
4. Informe quantidade maior que zero.
5. Preencha a observacao com prazo, doca, NF, contato, destino ou instrucao de
   expedicao/faturamento.
6. Revise a previa e clique em `Enviar solicitacao`.

Para retirada ou ajuste, o portal exige SKU e quantidade. Se a quantidade ficar
acima do saldo disponivel exibido, a solicitacao nao deve ser enviada sem
alinhamento operacional.

## Eventos (modelos de pedido)

Para o que se repete (feira, festival, estande), o cliente guarda em `Eventos`
a lista do que vai para o local, onde e, a data da proxima edicao e como a
Dutelog leva, monta e traz de volta.

1. Monte o pedido no `Estoque` com tudo o que vai para o local, preencha
   `Entregar em` (o local do evento) e as observacoes, e clique em
   `Salvar como evento`. Nome e data do evento ficam no proprio formulario.
2. Em `Eventos`, cada cartao mostra os itens, o que falta no saldo livre de
   hoje e o valor das pecas (base do seguro de transporte). `Editar` troca
   data, local, montagem e quantidades; `Excluir` arquiva.
3. `Usar no pedido` abre o `Estoque` com o pedido preenchido: itens ate o
   saldo livre, `Entregar em` com o local, `Para quando` na vespera as 7h e
   as instrucoes de montagem nas observacoes. Quem confere e envia e a pessoa.

O evento e so um modelo: nao reserva nem movimenta estoque. O pedido criado a
partir dele segue o caminho normal (`createCustomerRequest`, aprovacao,
reserva). Os dados ficam em `client_event_templates`, so pelas Cloud
Functions (`listClientEventTemplates`, `saveClientEventTemplate`,
`archiveClientEventTemplate`), isoladas por `customer_code`; cada gravacao
registra `client_event_template.*` em `events`.

## Depois do envio

- A solicitacao nasce em `customer_requests` com status `open`.
- O evento `portal.request_created` entra no ledger `events`.
- A equipe interna decide em `/solicitacoes`; o cliente apenas acompanha o
  historico, status, vinculos operacionais e alertas.

## Boas praticas

- Uma solicitacao deve ter uma instrucao clara de execucao, nao apenas "favor
  separar".
- Para recebimento, informe previsao de chegada, NF ou documento pendente.
- Para retirada, informe destino, janela de coleta e qualquer restricao de doca.
- Para assunto financeiro ou suporte, use descricao objetiva e referencia de
  pedido/fatura quando houver.
