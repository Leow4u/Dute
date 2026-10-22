# Fase 3: Operação

A Fase 3 do `docs/plataforma/plano.md` é a ordem de serviço. O Comercial v1
já está na `main` e para na etapa Para planejar: gerar OS ficou para cá. Três
partes, um PR cada, nesta ordem. Cada uma roda numa sessão própria.

1. **Colaboradores e veículos.** O cadastro que a OS vai escalar. Sem ordem
   de serviço.
2. **Núcleo da OS.** A demanda em Para planejar vira OS 10045-01, com itens
   da LPU sem preço, evento e regras. Sem tela.
3. **Kanban e nova OS.** Telas v3 em cima dessa OS: fila do dia, abrir a OS
   da demanda e agendar com a equipe e o veículo da parte 1.

A parte 3 espera a 2. Criar a OS não precisa de motorista; equipe e veículo
entram no agendamento.

## Parte 1: colaboradores e veículos

### O que grava

Codebase `functions/operacao` (a primeira da Operação; o WMS continua
`default`). Callables `saveCollaborator` e `saveVehicle`, cada uma numa linha
`export const nome = onCall(`, começando por `requireOperacaoCaller`.

| Coleção | Campos |
|---|---|
| `collaborators` | nome, CPF, função, telefone, CNH (categoria e validade), ativo, edição |
| `vehicles` | placa, tipo, modelo, capacidade kg e m³, ativo, edição |
| `operacao_operations` | recibo de idempotência; ninguém lê |

CPF com dígitos verificadores, único. Placa antiga (`ABC1234`) ou Mercosul
(`ABC1D23`), única. Criar, atualizar (com a edição vista), desativar e
reativar. Não apaga.

### Quem

Grava e lê: owner, admin e interno. Campo não vê a lista (o documento tem
CPF; a OS dele vem na parte 3). Suporte, comercial, wms, financeiro, cliente,
rh e painel não leem. O navegador não grava: as regras recusam.

### Evento

Na mesma transação, `source: functions_operacao`, severidade `info`. O
payload é o id e, na atualização, a edição. Sem nome, CPF, telefone, CNH nem
placa: wms e suporte leem `events`. Nenhum tipo usa as palavras do roteador
de avisos do WMS.

### Liberação

`OPERACAO_AMBIENTES_LIBERADOS = ["dute-homolog"]`, a mesma lista no app e nas
callables, travada por `platform-lists.test.ts`. Produção e `dute-btg`
recusam. Ligar na produção é um PR com o OK do Leonardo.

### Telas

`/operacao/colaboradores` e `/operacao/veiculos`, no shell da Operação, fora
do menu do WMS. Com a liberação, o interno vê Armazenagem e Operação na
entrada. O cliente não vê este cadastro: a OS no portal é da Fase 4.

### Zeragem

`collaborators`, `vehicles`, `operacao_operations`, `service_orders` e
`service_order_counters` nunca são apagadas, nem com `--include-setup`.
Eventos `functions_operacao` ficam, como os do Comercial.

## Parte 2: núcleo da OS

Sem tela. A callable `saveServiceOrder` abre a OS da demanda em Para planejar
e cancela a OS aberta.

- O número é o da demanda com sufixo: demanda 10045, primeira OS `10045-01`.
  A seguinte, na mesma demanda, é `10045-02`. O contador fica em
  `service_order_counters/{demanda}`.
- Os itens saem da revisão fechada (`quotes/{n}/revisoes/{escopo_rv}`). Preço,
  motivo e linha de ajuste não entram. Item avulso entra sem preço.
- A demanda ganha `os_numeros` e continua em Para planejar. O nome do cliente
  não vai para a OS nem para o evento.
- Eventos `os.created` e `os.cancelled`. O tipo não usa a palavra `order`: o
  roteador de avisos do WMS transformaria isso em aviso ao cliente. O motivo
  do cancelamento fica na OS, não no evento.
- Quem grava é o mesmo do cadastro (owner, admin, interno). Quem lê a OS:
  esses e o suporte. O interno passa a ler `demands`, `lpu_items` e
  `customer_locations`. `quotes` e `price_tables` continuam sem a operação.
- Agendar, executar, concluir e a tela ficam na parte 3.
