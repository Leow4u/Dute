# Fase 6: Comercial (v1)

Telas aprovadas pelo Leonardo em 20/10/2026 (`docs/mockups/Com*.dc.html`). Este
desenho resume as decisões por trás delas e a ordem das partes. As perguntas que
ainda faltam estão no fim, cada uma com a parte que espera a resposta. O
registro de cada parte entra no fim, como em `fase-2-nucleo.md`.

## O pedido

1. Quem orça é o Guilherme (papel `comercial`); o Leonardo aprova antes de
   enviar. Hoje é em Excel e Word, de 20 a 25 orçamentos por mês.
2. O sistema atende todos os clientes. A LPU do Itaú é um caso de tabela por
   contrato, nunca uma regra feita para ele.
3. Armazenagem não passa por orçamento: a cobrança continua no WMS. O Comercial
   cobre serviço que vira OS (transporte, mudança, montagem, desmontagem).
4. Prospect entra no cadastro de clientes desde o primeiro orçamento.
5. O Comercial vem antes da Operação. Primeiro a base que os dois módulos
   dividem (cadastro, catálogo e tabelas, contratos, Demanda); a Operação liga
   a OS à demanda depois.
6. A tabela do contrato é renovada todo ano e tem vigência.
7. Vale a tabela vigente na data do orçamento, mesmo com a execução depois. As
   revisões, inclusive a feita depois da execução, mantêm a mesma data.
8. Os contratos vigentes ficam no sistema, com vencimento, aditivos e tabelas.
   Hoje são três clientes recorrentes: Itaú, Safra e BTG.
9. No Itaú, depois da execução chega por e-mail a autorização de faturamento,
   com pedido e aceite juntos. A Dutelog emite a NF com esses números, sobe no
   portal do cliente e lança na Omie.
10. A tabela noturna é para serviço noturno; quem escolhe é o comercial.
11. A numeração é nova e gerada pelo sistema; o número antigo vira legado.
12. O Comercial substitui a planilha de controle de serviços, onde hoje o
    orçamento enviado é registrado (e o arquivo, apagado).

## Como é hoje

- O pedido chega por e-mail, quase sempre de uma gerenciadora em nome do
  cliente, com a referência dele no assunto. O Leonardo encaminha ao Guilherme,
  que devolve o PDF; a aprovação do Leonardo é o próprio reenvio e não fica
  registrada.
- A numeração tem várias séries ao mesmo tempo e números repetidos. A revisão
  só existe no nome do arquivo, mas o cliente a cita no pedido e no aceite.
- 94% dos orçamentos do Itaú citam um polo (CEIC, CAT, CEA, Faria Lima e
  outros); muitos ligam dois polos.
- Há preço fora da LPU sem nenhuma marcação, e nenhum PDF diz se usou a tabela
  comercial ou a noturna.
- A planilha de controle tem situação desatualizada, não tem data de emissão,
  deixou de registrar pedido, aceite e perdas em 2024, e uma NF pode cobrir
  vários orçamentos (e o contrário).
- Os três contratos cobram de jeitos diferentes: o Itaú por demanda, com
  autorização depois da execução; o Safra por medição mensal; o BTG pela
  fatura do WMS, com eventos orçados à parte.
- A Omie só tem o contas a receber; a NFS-e é emitida fora dela.
- No código: `customers` não aceita prospect (sigla obrigatória, módulos e
  projeções por padrão, `customer-profile.ts`); o papel `comercial` não lê nada
  e o WMS o nega; `interno`, `wms` e `suporte` leem todo o `events`; nenhum
  e-mail sai de verdade; o PDF é a impressão do navegador
  (`invoice-document.tsx`); a conferência do invoker só lê o `index.ts` do WMS.

## Decisões

| Tema | Decisão |
|---|---|
| Espinha comum | A **Demanda** é o serviço pedido, do e-mail à NF. Agrupa o orçamento e as revisões, as OS (Fase 3) e as autorizações. Não tem preço |
| Numeração | Um número por serviço, a partir de 10001, num contador em transação. Demanda e orçamento "10045"; revisões "10045 – RV01"; OS "OS 10045-01". O número antigo fica em `numero_legado` |
| Revisões | Até o envio, corrigir regrava a mesma RV. Enviada, a RV fica congelada; mudar é RV nova. Tipos: proposta, aditivo e execução (o orçamento refeito depois do serviço, que o Itaú usa como medição) |
| Preço | A data-base é a da primeira RV; todas herdam. A linha guarda tabela, variante e origem do preço: tabela, alterado, avulso ou ajuste. Alterado e ajuste pedem motivo e aparecem marcados na aprovação |
| Tabelas | `lpu_items` sem preço, com id próprio (o código do cliente se repete e é só atributo). `price_tables` imutáveis, por cliente ou contrato e variante (Comercial, Noturna), com vigência sem sobreposição. A Padrão Dutelog não tem cliente. Reajuste ou renovação cria tabela nova |
| Contratos | Por `customer_code`, com vigência, renovação, aviso, reajuste, regime de cobrança (por demanda, medição mensal, WMS), regra de pagamento, documentos e aditivos em histórico |
| Prospect | Campo `stage` em `customers`. Prospect não tem sigla, módulos nem projeções, e o WMS não o mostra nem o altera. Vira cliente no primeiro fechamento |
| Locais e contatos | Locais e contatos ligados ao `customer_code`. O contato guarda a empresa (a gerenciadora) |
| Aprovação | Só o owner, em um toque, na ficha ou no celular; "Aprovar e enviar" no computador. O item "para aprovar" entra no Início |
| Envio | "Enviar" grava no servidor, congela a RV e abre a impressão. O PDF vai pelo Outlook, como hoje |
| Autorização de faturamento | Registro genérico do "pode faturar" do cliente. No Itaú leva pedido, aceite, valor, tomador, centro de custo e código de serviço, e se liga a uma ou várias demandas |
| Medição mensal | As demandas do mês de um contrato com esse regime (o Safra) viram uma medição, que o cliente aprova antes da NF |
| Dinheiro | Decimal em texto e centavos inteiros por linha, com arredondamento por linha como o cálculo do WMS (`billing.ts`). O servidor sempre recalcula |
| Eventos | Sem valor, sem nome nem contato de cliente, título e descrição de modelo fixo. Nenhum tipo usa as palavras do roteador de avisos do WMS (`index.ts`, "order", "invoice", "receb"...) |
| Leitura | `canReadPrices()`: owner, admin e comercial (financeiro conforme a pergunta 4). `canReadBilling` não muda |
| Codebase | `functions/comercial`. Catálogo e contratos moram nela até a Fase 3; a Operação lê `lpu_items` pelas regras |
| Liberação | Chave própria do Comercial em `lib/liberacao.ts`, copiada nas callables, que recusam fora dela |
| IA | Sem sugestão de preço no v1. Cada RV congelada, os tempos de cada passo, o resultado e a execução ficam gravados desde o primeiro dia |

## Coleções

| Coleção | O que guarda | Quem lê |
|---|---|---|
| `customers` | ganha `stage` e os dados comerciais | equipe, como hoje, e `comercial` |
| `customer_locations` | polo, sigla e endereço do cliente | owner, admin, comercial e, na Fase 3, a operação |
| `customer_contacts` | nome, e-mail, telefone, empresa | owner, admin, comercial |
| `contracts` (e `aditivos`) | contrato e histórico | `canReadPrices()` |
| `lpu_items`, `price_tables` | catálogo e tabelas | `canReadPrices()`; `lpu_items` abre à operação na Fase 3 |
| `demands` | a demanda, sem preço | owner, admin, comercial; a operação na Fase 3 |
| `quotes` (e `revisoes`) | orçamento e RVs congeladas | `canReadPrices()` |
| `client_authorizations` | autorizações de faturamento | `canReadPrices()` |
| `medicoes` | medições mensais | `canReadPrices()` |
| `demand_counters`, `comercial_operations` | contador e recibos de idempotência | ninguém |

## Etapas da demanda

Em montagem → Para aprovar → Para enviar → Aguardando cliente → Para planejar
(fechado) → Execução a orçar → Aguardando autorização → A faturar. Perdida, com
motivo, a qualquer momento antes de faturar. As cores são as dos mockups.

## Telas

| Tela | Arquivo |
|---|---|
| Comercial · orçamentos (fila por etapa) | `ComFila.dc.html` |
| Montar orçamento | `ComOrcamento.dc.html` |
| Aprovar no celular | `ComAprovarCelular.dc.html` |
| PDF do orçamento (A4) | `ComDocumento.dc.html` |
| Clientes e prospects | `ComClientes.dc.html` |
| Contrato | `ComContrato.dc.html` |
| Autorizações de faturamento | `ComAutorizacoes.dc.html` |
| Medição mensal | `ComMedicaoMensal.dc.html` |

## Partes

Um PR por parte, nesta ordem, cada um com teste que falha antes e passa depois.
Cada parte roda numa sessão própria.

**Marco 0: base de plataforma, sem tela**
1. **Invoker de várias codebases.** `check_functions_invoker.ps1` lê as
   codebases do `firebase.json`. Testes: segunda codebase sem invoker reprova;
   callable com o mesmo nome em duas codebases reprova.
2. **Dinheiro exato** em `lib/dominio`, com os casos num JSON rodado pelo vitest
   e pelo `node --test` (3 × 0,335 = 1,02; ajuste negativo; float recusado).
3. **Codebase `functions/comercial`**: pacote, `firebase.json` (o WMS segue
   `default`), jobs de teste no CI, acesso (owner, admin, comercial), liberação,
   recibo e evento sem valor. Sem callable de negócio.
4. **Zeragem** preserva as coleções novas (`full_reset_btg.py`).

**Marco 1: o Guilherme orça e o Leonardo aprova no sistema**
5. **O WMS não enxerga prospect**: `stage` em `customer-profile.ts`, convite,
   lista de clientes e Posições. Muda o WMS: conferir a BTG antes de publicar na
   produção.
6. **Cadastro comercial**: prospect, locais e contatos, com regras.
7. **Catálogo e tabelas** com vigência, e as cargas (Padrão Dutelog, LPU do
   Itaú v2.0 Comercial e Noturna, RFQ 2021 encerrada, Safra).
8. **Contratos e aditivos** (dados), ligados às tabelas.
9. **Demanda e orçamento** no backend até a aprovação: contador, RVs, linhas
   com origem, data-base.
10. **Envio, fechamento, perda, revisão e RV de execução** no backend.
11. **Telas: fila e montar orçamento**, com menu, rotas e liberação.
12. **Telas: aprovar** (celular e Início) **e PDF**.
13. **Tela de Clientes** e carga dos clientes da Omie (só pessoa jurídica).
    Antes da carga, as listas de clientes do WMS (Configurações › Clientes,
    convite e Posições) passam a ler o cadastro até o fim: o prospect sai em
    memória, depois de uma página só.

**Marco 2: contratos e alertas**
14. Tela de contrato, aditivos e alertas no Início (vencimento, renovação,
    reajuste, prazo de portal).

**Marco 3: autorização de faturamento**
15. Autorizações (backend e tela) e a fila de executados com a idade.

**Marco 4: medição mensal**
16. Medição mensal, com a exportação no formato que o cliente pede.

**Marco 5: produção, com o OK do Leonardo**
17. Ligar a liberação no `dute-prod`, rodar as cargas, acertar o contador, dar o
    papel `comercial` ao Guilherme e carregar os orçamentos em andamento e o
    histórico da planilha como legado. Uma semana em paralelo com o Excel.

Até a parte 17, o que chega à produção fica inerte (telas desligadas, callables
recusando, nada importado). A exceção é a parte 5, que muda o WMS.

## Importação inicial

- Clientes: pessoas jurídicas da Omie, uma por raiz de CNPJ, a partir dos
  arquivos já baixados em `tmp/omie/`. Pessoa física, contas de teste e
  contatos ficam fora.
- Tabelas: a LPU do Itaú conferida contra o PDF assinado (o PDF prevalece), a
  Padrão Dutelog e a do Safra, cada uma com vigência; a RFQ 2021 entra encerrada.
- Contratos: Itaú, Safra e BTG, com os PDFs como anexos.
- Histórico da planilha e orçamentos em andamento: como legado, só leitura, na
  parte 17.
- Cargas em Node dentro de `functions/comercial`, com dry-run por padrão,
  projeto obrigatório e relatório em `tmp/`. Nunca abrem planilha com dado de RH.

## O que o v1 não entrega

E-mail e PDF enviados pelo sistema; aceite pelo portal do cliente; sugestão por
IA; gerar OS (Fase 3); NF, cobrança e recebimento (Fases 4 e 7); licitações e
propostas por custo e BDI; tela de edição de tabelas; anexos do pedido no
Storage.

## Perguntas abertas

1. **O admin também aprova?** Recomendo que não: só o owner no v1. (Parte 9)
2. **Quem manda o PDF ao cliente?** Recomendo os dois caminhos: o Leonardo em
   "Aprovar e enviar", ou o Guilherme depois da aprovação. (Parte 12)
3. **A RV de execução sem preço novo passa de novo pela aprovação?** Recomendo
   dispensar quando só mudam quantidades de linhas de tabela e o total não passa
   o fechado; fica o marco "aprovação dispensada". (Parte 10)
4. **Quem registra a autorização de faturamento?** Recomendo comercial e
   financeiro, este sem editar itens nem preço. (Parte 15)
5. **Contratos e Autorizações ficam no Comercial ou no Financeiro?** Recomendo
   no Comercial no v1; o Financeiro passa a ler na Fase 7. (Parte 14)
6. **A gerenciadora vira empresa no cadastro?** Recomendo que não: ela é a
   empresa do contato, numa lista normalizada, sem `customer_code`. (Parte 6)
