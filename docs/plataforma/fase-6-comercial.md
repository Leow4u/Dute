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
| `contracts` (e `contracts/{id}/aditivos/{numero}`, id sem zero à esquerda) | contrato e histórico; o id do contrato é interno, nunca o número do cliente | `canReadPrices()` |
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
  contatos ficam fora; a conta do CRM sem CNPJ só entra com código na
  revisão. Quem comprou desde 2024 entra como cliente (desde a primeira
  compra); o resto, como prospect; o cadastro que já existe só ganha os ids
  da Omie. Roteiro em `comercial-cargas.md`.
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
7. **A perda sem resposta, por prazo ou por desistência reabre na mesma RV?**
   Hoje a reabertura de uma RV enviada abre a RV seguinte (pedido da parte 10).
   Se o cliente volta aceitando a RV que recebeu, "Descartar RV" desfaz a nova
   e o aceite cai na enviada. Recomendo manter e rever com o uso. (Parte 11)
8. **A dispensa da aprovação aceita linha alterada, avulsa ou de ajuste igual à
   da RV fechada?** Hoje não: a RV de execução com qualquer linha fora da tabela
   passa pelo owner, e tirar dela o ajuste da RV fechada também. Recomendo
   aceitar a linha igual à fechada (mesmo id, origem, item e preço; no ajuste,
   o mesmo valor), porque os orçamentos do Itaú quase sempre têm alterado ou
   ajuste. (Parte 11)

## Registro

### Parte 10: envio, fechamento, perda, revisão e RV de execução (backend)

- `advanceQuote` ganha enviar, aprovar e enviar (só o owner), revisar (RV
  seguinte) e descartar a RV seguinte ainda não enviada. `advanceDemand` é
  nova: fechar, perder, reabrir, registrar a execução, validar e registrar a
  recusa do aditivo.
- As filas (Comercial, Aprovar e o Início) leem `demands.etapa`. O
  `quotes.status` é a situação da RV em curso e não diz se a demanda está
  perdida: perder e reabrir só gravam a demanda.
- Em "Aguardando cliente", a ação depende do tipo da RV: na proposta,
  "Registrar aceite" (close); na execução e no aditivo, "Registrar validação"
  (validate) e, no aditivo, também a recusa (refuse_addendum). A RV de
  execução enviada fica em "Aguardando cliente" até a validação; a ComFila,
  que a mostra direto em "Aguardando autorização", se acerta na parte 11.
- A validação que leva ao faturamento é `demands.validacao` (RV, etapa e
  instante). Cada RV guarda a resposta do cliente em `resposta_cliente`
  ("fechado", "validada" ou "recusada"); a RV fechada validada sem desvio, que
  já tem o "fechado", guarda a validação em `validacao_cliente`. O aditivo
  validado antes da execução amplia o escopo (`escopo_origem: "aditivo"`) e a
  demanda volta a "Para planejar".
- O aditivo em negociação segue as etapas dele (aparece em "Para aprovar",
  como no mockup), mas não segura o serviço: a execução se registra mesmo
  assim. Recusado pelo cliente, o orçamento volta à RV do escopo fechado como
  foi enviada, e a RV seguinte usa o número depois do aditivo
  (`ultima_rv_enviada`).
- "Descartar RV" tira a RV seguinte ainda não enviada (aditivo aberto por
  engano, revisão de que o cliente desistiu, reabertura em que o cliente aceita
  a RV que recebeu) e volta à RV enviada de onde ela saiu.
- Na RV de execução, `quotes.dispensa` diz à tela se pode oferecer "Enviar ao
  cliente" sem a aprovação; o envio calcula de novo. Tirar da RV de execução a
  linha alterada, avulsa ou de ajuste da RV fechada derruba a dispensa.
- Fechado, validado e recusado em nunca vêm antes do envio da RV (folga de 5
  minutos do relógio), nem depois de agora.

### Parte 12a: aprovar no celular, Início, documento A4 e envio (telas)

- **Aprovar** (`/comercial/aprovar`, `ComAprovarCelular`): só o owner (a rota
  tem papel próprio; `aprovaOrcamento` em `lib/comercial/navegacao.ts`). Lê as
  demandas em "Para aprovar" com a RV "para aprovar", de quem espera há mais
  tempo; "1 de N" com anterior e próximo; depois da ação, a confirmação e
  "Próximo" (o que vinha depois na fila que a pessoa via). O bloco Conferir
  mostra a linha alterada (preço da tabela riscado e motivo), a avulsa, o
  ajuste e as marcas da tabela (fora da vigência, sem tabela). "Devolver" pede
  a nota; "Aprovar e enviar" grava e abre o documento. O "Desfazer" do mockup
  ficou de fora: desfazer a aprovação é "Editar" na montagem.
- **Início**: "N orçamentos para aprovar" só para o owner, e a consulta só sai
  para ele (`veAprovacoesNoInicio` é o `enabled`).
- **Documento A4** (`/comercial/orcamento/documento?numero=&rv=`,
  `ComDocumento`): impressão do navegador, como a fatura; o papel é
  `components/comercial/orcamento-documento.tsx` (PAPER_FILES). Até o envio é
  a prévia do orçamento ao vivo, com a marca "Prévia"; enviada, a RV vem da
  cópia congelada em `quotes/{numero}/revisoes/{rv}`. O título da aba é o nome
  do PDF ("Orçamento 10045 – RV01 – CE8977 – título"). Sem CNPJ: o cabeçalho
  leva o nome que o app já usa e o e-mail do Comercial do site.
- **Envio** (pergunta 2: os dois caminhos): "Enviar" (aprovado → enviado) na
  montagem e na ficha da fila, e "Aprovar e enviar" do owner, gravam por
  advanceQuote e só então abrem o documento, que imprime sozinho quando a cópia
  congelada chega. Com erro, o documento não abre. A data do envio vem de
  `quotes.envio` no histórico da ficha e no cabeçalho da montagem.
- **Quem montou**: o comercial não lê `users` de outra pessoa, então o
  servidor grava `autor_nome` no orçamento (criar, duplicar, RV seguinte) e na
  RV congelada; o orçamento antigo cai no perfil, quando quem lê pode.
