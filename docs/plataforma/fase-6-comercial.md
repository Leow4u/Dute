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
| Leitura | `canReadPrices()`: owner, admin, comercial e financeiro (o financeiro desde a parte 15, pergunta 4). `canReadBilling` não muda |
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
| `demands` | a demanda, sem preço | owner, admin, comercial e financeiro (parte 15); a operação na Fase 3 |
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
4. **Quem registra a autorização de faturamento?** Recomendação aceita:
   comercial e financeiro, este sem editar itens nem preço. Feito na parte
   15a: só a recordAuthorization atende o financeiro. (Parte 15)
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
9. **De que data corre o prazo de perda do portal (90 dias no BTG)?** O
   contrato fala em atraso na solicitação no portal do fornecedor; a
   ComAutorizacoes mostra o prazo contado do pedido do portal ("prazo do
   pedido", 90 dias depois da autorização). Hoje o alerta conta do fim da
   execução, que vem antes: avisa cedo e nunca deixa passar o prazo, mas
   pode dar "vencido" antes da hora. Recomendo manter a execução até o
   Leonardo confirmar; se valer o pedido, o alerta passa a receber a
   autorização ativa e a 15b mostra a data do pedido. (Parte 15b)
10. **Como se encerra a demanda que perdeu o prazo de faturamento?** O alerta
    segue em "A faturar" depois do fim, vencido; a demanda a faturar não se
    perde, e depois do fechamento o único motivo de perda é o cancelamento
    pelo cliente. Recomendo um motivo de perda "prazo de faturamento", aceito
    só com o alerta vencido, inclusive a partir de "A faturar" com a
    autorização ainda não usada na NF. (Parte 15b ou Fase 7)
11. **A aprovação da medição fecha e valida a proposta enviada sem
   fechamento?** Hoje não: a aprovação não registra o que o cliente não
   respondeu. A demanda fica pendente, presa à medição, e ganha a autorização
   dela quando for fechada, executada e validada. Recomendo um atalho na tela
   da medição para a pendente "proposta sem fechamento", que faz os três passos
   com o aceite sendo a própria medição aprovada. (Parte 16b)
12. **O frete esquecido de um mês já enviado ou aprovado entra onde?** Hoje
    a linha só entra na medição do mês da execução, que só se edita em
    rascunho, e da enviada só se sai pela contestação do cliente. Recomendo
    aceitar a linha na medição aberta com uma marca "execução de outro mês",
    porque a aprovada já virou NF; a Dutelog retirar o envio (enviada para
    rascunho) seria uma ação à parte da contestação. (Parte 16b)
13. **O "Baixar ZIP dos pedidos" do mockup fica no v1?** O anexo da linha é
    texto (nome e referência: o e-mail ou o OneDrive) e o Storage está fora do
    v1. Recomendo tirar o ZIP da tela no v1 e manter o "Anexar" gravando a
    referência. (Parte 16b)
14. **O "Desfazer" do ComAprovarCelular volta?** Saiu da parte 12a. Depois de
    "Aprovar" não há volta de aprovado para "Para aprovar": `edit` leva ao
    rascunho, e alguém precisa mandar de novo para aprovação. Fazer o desfazer
    com `edit` e `submit` deixaria na timeline o Leonardo mandando para
    aprovação o que o Guilherme montou. Recomendo, se o toque errado acontecer
    no uso, uma ação própria no `advanceQuote` (aprovado, ainda não enviado,
    volta a "Para aprovar", só o owner, com evento), numa parte de backend.
    Depois de "Devolver", o desfazer seria o autor mandar de novo. (Parte 12a)
15. **Razão social e CNPJ no cabeçalho do PDF.** O ComDocumento traz a razão
    social, o CNPJ e a cidade da Dutelog; o repositório não tem o CNPJ, e o
    cabeçalho saiu com "Dutelog Soluções Logísticas", o nome que o app usa, e o
    e-mail do Comercial. Falta o Leonardo dizer a razão social e o CNPJ que vão
    na proposta; entram como constantes no papel
    (`components/comercial/orcamento-documento.tsx`). (Parte 12a)
16. **Como o Leonardo fica sabendo que há orçamento para aprovar?** Hoje, pelo
    e-mail do Guilherme; no app, pelo item do Início quando ele abre. Avisar
    (notificação ou um "Copiar link" da aprovação na montagem, com
    `hrefDaAprovacao(numero)`) não está nos mockups. Recomendo ver no uso se o
    e-mail com o número basta. (Parte 12a)

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
  ficou de fora (pergunta 14).
- **O orçamento da tela não troca sozinho** (`acompanharAprovacao`): se ele
  sai da fila enquanto o Leonardo confere (o autor puxou de volta, a demanda
  foi perdida, outro aparelho decidiu) ou volta com outra edição, o cartão
  fica no que ele viu, o rodapé diz "saiu da fila" (Próximo) ou "mudou"
  (Recarregar) e nada se grava. O orçamento da tela fica na URL
  (`?numero=`): voltar da prévia do PDF ou do orçamento cai nele; o link para
  um orçamento fora da fila avisa, em vez de abrir outro.
- **Início**: "N orçamentos para aprovar" só para o owner, e a consulta só sai
  para ele (`veAprovacoesNoInicio` é o `enabled`).
- **Documento A4** (`/comercial/orcamento/documento?numero=&rv=`,
  `ComDocumento`): impressão do navegador, como a fatura; o papel é
  `components/comercial/orcamento-documento.tsx` (PAPER_FILES). Até o envio é
  a prévia do orçamento ao vivo, com a marca "Prévia", "Prévia em" no lugar
  da emissão e o nome do arquivo começando por "Prévia"; enviada, a RV vem da
  cópia congelada em `quotes/{numero}/revisoes/{rv}`. O título da aba é o nome
  do PDF ("Orçamento 10045 – RV01 – CE8977 – título"). Na tela, o papel tem a
  largura do A4 e, no celular, rola para o lado. Aberto da aprovação
  (`&de=aprovar`), o "voltar" leva a ela. Sem CNPJ (pergunta 15).
- **Limite da cópia congelada**: os valores, as linhas, as condições, a
  demanda e quem montou saem da RV congelada, mas os nomes do contato, dos
  locais e o número do contrato ainda se leem pelos ids, nos cadastros de
  hoje. Se um deles mudar depois do envio, imprimir de novo a RV enviada mostra
  o nome novo. Congelar esses nomes no envio (`revisaoCongelada`) é uma parte
  de backend.
- **Envio** (pergunta 2: os dois caminhos): "Enviar ao cliente" (aprovado →
  enviado) na montagem e na ficha da fila, e "Aprovar e enviar" do owner na
  montagem e na aprovação, gravam por advanceQuote e só então abrem o
  documento, que imprime sozinho quando a cópia congelada chega (e a URL perde
  o `imprimir`). Com erro, o documento não abre. Na ficha, "Para aprovar" não
  tem ação, como na ComFila, e clicar de novo no mesmo envio leva a mesma
  chave. A data do envio vem de `quotes.envio` no histórico da ficha e no
  cabeçalho da montagem.
- **Prévia do PDF na montagem** abre noutra aba; com alteração não salva, a
  tela salva antes (a aba abre no clique e recebe o documento depois de
  gravar).
- **Quem montou**: o comercial não lê `users` de outra pessoa, então o
  servidor grava `autor_nome` no orçamento (criar, duplicar, RV seguinte) e na
  RV congelada; o orçamento antigo cai no perfil, quando quem lê pode.

### Parte 12b: ações depois do envio (telas)

- **Ações por etapa** (`lib/comercial/depois-do-envio.ts`, `acoesDepoisDoEnvio`,
  por etapa, tipo de RV e papel; a ficha da fila e a montagem usam a mesma
  função). Aguardando cliente: proposta, "Fechado" (principal), "Revisar" e
  "Perdido"; RV de execução, "Validado" e "Revisar"; aditivo, "Validado",
  "Recusar aditivo" e "Revisar". Para planejar: "Registrar execução",
  "Aditivo" e "Perdido" (só "cancelado pelo cliente"). Execução a orçar com a
  RV enviada: "Orçar execução" abre a RV de execução e leva à montagem;
  "Validado" fica ao lado para a execução sem desvio (o servidor valida a RV
  fechada como está; não estava no pedido). Perdida: "Reabrir". Rascunho de RV
  seguinte (`quotes.revisao_de`): "Descartar RV", no "para aprovar" só do
  owner ou de quem montou, como a devolução. A cancelada e as etapas do
  faturamento não têm ação aqui. Owner, admin e comercial têm as mesmas ações.
- **Um diálogo curto por ação**, com só os campos dela: Fechado, Validado e
  Recusar aditivo pedem "Respondido em" (data e hora, de agora), o contato do
  cliente (o do pedido já escolhido; exigido quando o cliente tem contatos) e
  o link do e-mail; Perdido, o motivo (seis; depois do fechamento só
  "Cancelado pelo cliente", já escolhido) e a nota ("Outro" a exige); Revisar,
  "Pedido do cliente" ou "Correção"; Registrar execução, De e Até (até hoje).
  Aditivo, Orçar execução, Reabrir e Descartar RV só confirmam. Os problemas
  aparecem por campo depois da primeira tentativa; o servidor confere de novo.
- **Escrita só pelas callables**: `advanceDemand` (fechar, perder, reabrir,
  registrar a execução, validar, recusar o aditivo) com `expected_etapa` e
  `expected_rv`; `advanceQuote` revise e discard com `expected_status` e
  `expected_edicao`; os valores são os que a tela viu quando o diálogo abriu.
  A chave de idempotência é a da intenção (a mesma ao repetir o mesmo pedido).
  Recusa de concorrência (a demanda ou o orçamento mudou) fecha o diálogo e
  mostra a mensagem do servidor com "O orçamento foi recarregado": as duas
  telas são ao vivo. Outras recusas ficam no diálogo.
- **"Orçar execução" na fila** (secundária, em contorno, ao lado de "Novo
  orçamento"): o mesmo diálogo do novo orçamento com o período executado;
  grava `saveQuote` create_execution e abre a montagem da RV de execução.
- **Aprovação dispensada**: a montagem lê `quotes.dispensa` (calculada pelo
  servidor). Com a RV de execução em rascunho e `dispensada`, mostra
  "Aprovação dispensada" e o botão principal passa a "Enviar ao cliente"
  (send do rascunho, que salva antes se houver alteração; o servidor calcula a
  dispensa de novo no envio e recusa se deixou de valer). O "Enviar para
  aprovação" não fica ao lado: para passar pelo owner, a RV precisa deixar de
  ser dispensável. O dado vem do servidor; nada se calcula na tela.
- **Na montagem**, a RV enviada mostra a ação principal da etapa como a ação
  da tela; na ficha da fila elas ficam em contorno, porque a principal da
  tela é "Novo orçamento". O link da ficha para a montagem vira "Continuar
  montagem" na RV de execução em rascunho (antes dizia "Orçar execução", que
  agora é a ação).
- **Aditivo em negociação**: o serviço não espera o aditivo, então "Registrar
  execução" aparece entre as secundárias do aditivo (em montagem, para
  aprovar, para enviar ou aguardando cliente) enquanto a demanda tem escopo
  fechado, não foi executada nem validada (`escopoRv`, `executada` e
  `validada`, lidos da demanda como o servidor lê em
  `problemaDoRegistroDaExecucao`).
- **Dispensa com alteração não salva**: a marca "Aprovação dispensada" só
  vale para o que está gravado; com alteração na tela volta o "Enviar para
  aprovação" até salvar. O aviso de recusa de concorrência sai quando a
  pessoa volta a mexer na montagem ou troca de ficha.

- **Fora do pedido**: Perdido não aparece na RV de execução nem no aditivo
  em "Aguardando cliente" (depois do fechamento só vale o cancelamento do
  cliente) e Aditivo não aparece em "Execução a orçar", embora o servidor
  aceite os dois; o link do e-mail, o contato e a data da resposta não
  aparecem ainda na ficha (só na timeline do servidor).

### Parte 15a: autorização de faturamento (backend)

- `client_authorizations/{id}` guarda o "pode faturar" do cliente: tipo
  (pedido e aceite, medição aprovada, portal ou outro), pedido, aceite,
  recebida em, valor, as demandas com a RV citada e o total dela, tomador
  (CNPJ inteiro, pode ser filial), código de serviço (o do contrato, se não
  vier), centro de custo, referência, escopo, link do e-mail, documento,
  marcas, soma e saldo e situação (registrada ou cancelada). `nf_ids`,
  `enviada_portal_em` e `omie_lancada_em` ficam reservados para a Fase 7. O
  id é interno (`aut_...`), nunca o número do pedido.
- A callable `recordAuthorization` registra (record) e cancela (cancel). O
  registro aceita demandas do mesmo cliente e do mesmo contrato em
  "Aguardando autorização" ou, no complemento, já "A faturar" por outra
  autorização; leva cada uma a "A faturar" e grava o id em
  `autorizacao_ids`. Uma autorização cobre várias demandas e uma demanda pode
  ter várias. O cancelamento devolve a "Aguardando autorização" a demanda
  que fica sem nenhuma; a autorização já usada no faturamento (NF, portal ou
  Omie) não se cancela. Cancelar de novo só devolve o estado.
- O tipo segue o que o contrato pedia na validação
  (`validacao.autorizacao`): no contrato com pedido e aceite, só pedido e
  aceite, com os dois números (a NF do cliente leva os dois); no portal, só
  o pedido do portal. A medição aprovada vem da medição mensal (parte 16) e
  não entra nesta callable; "outro registro" só serve à validação sem o
  tipo do contrato (o legado).
- A etapa continua saindo de `etapaDaDemanda`: validada para "Aguardando
  autorização" e com autorização ativa é "A faturar". Assim perder, reabrir
  e cancelar a autorização chegam à mesma etapa.
- O valor de cada demanda é o total da RV citada como foi enviada
  (`revisoes/{rv}.total_cents`), lido pelo servidor; sem RV na entrada, vale
  a validada. A divergência não impede o registro, vira marca:
  `valor_diverge` (o valor informado difere da soma das RVs e do saldo, o
  que falta autorizar nelas: a soma menos as outras autorizações ativas
  delas; o complemento que fecha o saldo não marca; sem saldo quando outra
  autorização também cobre demanda fora desta), `tomador_outra_raiz` (a
  raiz do CNPJ do tomador difere da do cadastro, ou o cadastro não tem CNPJ
  válido para conferir) e `rv_nao_validada`.
- O tomador vem inteiro (pode ser filial) ou com a raiz mascarada, como no
  e-mail de autorização do Itaú ("11.222.XXX/0001-81"): o servidor completa
  com a raiz do cadastro e confere os dígitos verificadores. Se a parte à
  mostra é de outra raiz, se os dígitos não fecham ou se o cadastro não tem
  CNPJ, pede o CNPJ inteiro.
- Pedido e aceite iguais (sem máscara nem caixa) a uma autorização ativa do
  mesmo cliente são recusados (already-exists); cancelada a anterior, podem
  ser registrados de novo.
- Papéis: owner, admin, comercial e financeiro. O financeiro entra só nesta
  callable, pela opção `{ financeiro: true }` de `requireComercialCaller`;
  `callables.test.ts` reprova a opção em qualquer outra. `canReadPrices()`
  e `canReadDemands()` passam a incluir o financeiro (preço é de owner,
  admin, financeiro e comercial; a fila de autorizações lê as demandas); os
  contatos (`canReadCommercialRegistry`) continuam fora dele.
- A idade na fila conta do fim da execução (a data que a ComAutorizacoes
  mostra) ou da validação, o que veio antes; a validação só conta sozinha no
  legado sem período executado. Faixas: até 30 dias, de 31 a 60, mais de 60.
- Prazo de perda (`autorizacao.prazo_perda_dias` do contrato): avisos a 60,
  30 e 10 dias do fim (no prazo de 90, aos 30, 60 e 80 dias de espera),
  em "Aguardando autorização" e "A faturar"; depois do fim, vencido.
- Eventos `client_authorization.recorded` e `.cancelled` com o id, o tipo,
  o contrato, as demandas, as que mudaram de etapa e as marcas; nunca o
  pedido, o aceite, o tomador, o centro de custo nem valor. A mudança de
  etapa de cada demanda gera `demand.stage_changed`. O tipo "portal" se
  chama "Portal do fornecedor" (o portal de compras do cliente, como na
  ComAutorizacoes), também na tela de Contrato; "Portal do cliente" é o do
  Dute.
- Índices: `demands` por etapa e cliente (a fila); `client_authorizations`
  por situação e por cliente e situação, pela data do registro.
- Fica para a parte 15b: a tela (ComAutorizacoes) e o acesso do financeiro
  ao app do Comercial (hoje o `comercialStatus` e o menu só abrem a owner,
  admin e comercial). Ficam em aberto a data-base do prazo de perda do
  portal e o encerramento da demanda que o perdeu (perguntas 9 e 10).

### Parte 16a: medição mensal (backend)

- `medicoes/{contrato_id}_{AAAA-MM}`: uma por contrato e competência, só de
  contrato com regime `medicao_mensal` (no regime padrão ou no de um
  serviço). Competência repetida, futura ou fora da vigência do contrato é
  recusada; vale a vigência atual e as anteriores, pelos aditivos
  (`vigencia_anterior` e a vigência de cada um): o aditivo de prorrogação
  reescreve a vigência do contrato, e a medição do mês da renovação ainda abre
  depois dele. A variante da tabela é escolhida ao abrir (padrão: Comercial).
- `saveMedicao` (create, upsert_line, remove_line) só no rascunho e na
  edição vista; `advanceMedicao` faz send (rascunho → enviada), approve
  (enviada → aprovada), contest (enviada → contestada, com nota) e reopen
  (contestada → rascunho). Papéis: owner, admin e comercial.
- A data da solicitação é a data-base da linha: vale a tabela do contrato
  vigente nela, nunca a Padrão Dutelog. A linha noturna usa a tabela Noturna
  do contrato quando ela existe na data; sem ela, e na linha diurna, vale a
  variante da medição. Cada gravação precifica de novo todas as linhas, então
  a tabela renovada que é carregada depois (a v1 encerrada na véspera) passa a
  valer para as linhas pedidas na vigência dela; o evento conta as linhas que
  mudaram. O envio só confere: se algum preço mudou desde a última gravação,
  recusa e nada muda (grava-se a medição de novo, a pessoa confere e envia),
  para ir ao cliente o que a pessoa viu e exportou. A conta de cada item é a
  do orçamento: tabela, alterado (com o preço da tabela ao lado e motivo) e
  avulso (com preço e motivo).
- O dia da tarifa sai da data da execução (sábado, domingo ou dia útil); o
  feriado em dia útil é informado como `domingo_feriado`. Dia útil num sábado
  é recusado.
- Marcas da linha: `dia_nao_bate_tarifa` quando a diária usada não cobre o
  dia ou a janela da execução, ou quando a tabela tem uma diária que cobre
  melhor; `rota_fora_da_tabela` para item avulso; `sem_pedido_anexo`. O dia e
  a janela saem dos atributos do item (categoria, item, serviço, descrição, a
  descrição do cliente na tabela e a unidade). É diária o item que diz
  "diária", ou o de pessoa (ajudante, motorista) ou na unidade dia que diz o
  dia da tarifa, como a tabela do Safra ("Ajudante de Sábado das 08:00 às
  17:00", "Sáb. | 08h às 17h"). A janela sai da palavra (diurna, noturna) ou
  do horário (das 6h às 18h é diurna; o resto, noturna). Quando a tabela tem
  uma única diária da mesma família (o item sem dia, janela nem horário) para
  o dia e a janela, o item guarda `trocar_por`; sem essa segurança, só a
  marca. O servidor nunca troca o item: a tela oferece "Aplicar" e grava a
  linha de novo. Cada item guarda a classe que o servidor calculou (`classe`:
  diária com dias e janelas, veículo, ajudante) e a cobertura da tarifa de
  `trocar_por` (`trocar_por_diaria`), para a tela montar "Sábado na tarifa de
  dia útil", "Aplicar sábado" e o resumo por item sem repetir a conta.
- A linha que cita uma demanda prende a demanda (`demands.medicao_id`): a
  mesma demanda não entra em duas medições, e a demanda precisa ser do mesmo
  cliente e contrato, cobrada por medição mensal (no contrato misto, a
  demanda cobrada por demanda espera o pedido e aceite dele), sem perda nem
  cancelamento. Retirar a última linha dela solta a demanda. A demanda presa
  não troca de contrato (`saveQuote` recusa: seria cobrada duas vezes).
- A aprovação cria `client_authorizations/aut_{medicao_id}` (tipo
  `medicao_aprovada`, com as demandas autorizadas, o total aprovado, quando,
  quem e o link) e confere de novo cada demanda (cliente, contrato, a medição
  e a cobrança): a que não bate fica pendente sem ser tocada, e a medição
  nunca faz as vezes da autorização de outro contrato. Vão a "a faturar" as
  demandas que o cliente já tinha fechado: a já validada perde a pendência de
  medição; a fechada (com ou sem a execução registrada, que então sai das
  datas das linhas) ou com a RV de execução enviada é validada pela medição
  (`validacao.origem: "medicao"`). Ficam pendentes, presas à medição, em
  `demandas_pendentes` com o motivo: a perdida ou cancelada, a proposta sem
  fechamento, a RV em montagem, o aditivo em negociação (a medição aprova as
  linhas pela tabela, nunca o preço e o escopo do aditivo) e a que espera
  autorização. A pendente não fica sem saída: validada depois (`validate`),
  vai a "a faturar" com a autorização da medição, sem a pendência, e sai das
  pendentes da medição e da autorização. A medição sem demanda também cria a
  autorização: o que se fatura é a medição.
- Funções puras em `domain/medicao.ts`: `competenciaAtual`,
  `alertaMedicaoNaoEnviada` (a partir do primeiro dia do mês seguinte, com os
  dias de atraso: o rascunho de competência anterior e, com os contratos, o
  contrato por medição mensal sem a medição do mês que passou, só da
  competência anterior) e `exportarDiarioDeBordo` (as 15 colunas do arquivo
  do cliente, com o custo do veículo, o dos ajudantes e o total; o veículo e o
  horário do ajudante são a descrição do item na tabela do cliente, a chave
  do Diário; a linha com dois tipos de veículo sai em uma linha do Diário por
  veículo; o solicitante é a área, nunca a pessoa; a chave orçamentária sai
  vazia). A convenção da tabela do Safra está em `comercial-cargas.md`.
- Eventos `medicao.created`, `line_saved`, `line_removed`, `sent`,
  `approved`, `contested` e `reopened`, e `client_authorization.recorded`
  com o tipo e a medição; `quote.validated` ganha a autorização da medição
  aprovada. Sem valor, sem a OS do cliente, a área, os locais, a mercadoria
  nem a nota da contestação. `TIPOS_AUTORIZACAO` passou para `events.ts`
  (contratos.ts reexporta).
- Regras: `medicoes` lê por `canReadPrices()` e ninguém grava pelo
  navegador, como `client_authorizations` (parte 15a). A autorização da
  medição aprovada usa o mesmo registro e o mesmo evento da 15a
  (`client_authorization.recorded`, com `contrato_id`, `a_faturar`, `marcas`
  e o `medicao_id`; a lista de demandas pode ser vazia).
- Perguntas para a parte 16b: 11, 12 e 13 acima.

### Parte 16b: tela de Medições

- Rota `/comercial/medicoes` (aba Medições e item de menu, só com a liberação
  do Comercial; owner, admin e comercial). `?contrato=` e `&competencia=`
  abrem um contrato e um mês (o Início leva por aí). Tela em
  `pages/comercial/medicoes*.tsx`, regras puras em `lib/comercial/medicoes.ts`
  e `lib/comercial/diario.ts`.
- Lê ao vivo `medicoes` (do contrato), `contracts`, `price_tables`,
  `lpu_items` (só ao abrir o diálogo da linha) e `customers`; grava só por
  `saveMedicao` e `advanceMedicao`, com `request_id` (a mesma chave enquanto
  a intenção é a mesma) e a edição e a situação que a tela viu. Medição que
  mudou ou sumiu no meio do caminho descarta o que estava aberto, mostra a
  mensagem do servidor e fica com a versão do snapshot. Não usa o reducer de
  sincronia da montagem do orçamento: aqui não há formulário longo, cada
  diálogo guarda a medição de quando abriu.
- Competências do contrato: as medições que existem (situação, data e total)
  e, se faltam, o mês de hoje e o anterior como "Não aberta" (ação "Abrir
  medição"). Cabeçalho: competência, contrato, número de demandas (as OS da
  medição, com o período), total (nome da tabela) e prazo de envio (a virada
  do mês, com "em N dias" ou "há N dias").
- Ação principal por situação: rascunho, Enviar ao cliente; enviada, Registrar
  aprovação (e Registrar contestação como secundária); contestada, Reabrir;
  aprovada, nenhuma. Exportar Diário de Bordo em todas, com linhas.
- Linha: diálogo para incluir, editar e retirar a OS (itens da tabela do
  contrato vigente na data da solicitação, preço alterado e item avulso, ambos
  com motivo) e o pedido anexado (nome e referência). Marcas: dia que não bate
  com a tarifa (com "Aplicar sábado" quando o servidor deu o `trocar_por`),
  rota fora da tabela e sem pedido anexo.
- Diário de Bordo: CSV (BOM, `;`, CRLF) gerado no navegador por
  `exportarDiarioDeBordo`, a mesma conta da função do servidor
  (`domain/medicao.ts`). `diario.test.ts` roda as duas contra as mesmas
  medições, e `medicoes.test.ts` faz o mesmo com o alerta da virada do mês.
- Início: "Medição de setembro/2026 não enviada" (rascunho de mês anterior ou
  contrato por medição mensal sem a medição do mês que passou), só para
  owner, admin e comercial, sob a liberação; a consulta só sai para esses
  papéis (`veMedicoesNoInicio`).
- Perguntas: a 13 foi aplicada (sem "Baixar ZIP dos pedidos" no v1: os PDFs
  não estão no Storage; o "Anexar" grava nome e referência). A 11 (atalho da
  proposta sem fechamento) e a 12 (linha de outro mês) seguem abertas: a tela
  mostra as demandas pendentes da aprovação, mas não tem o atalho nem aceita
  linha de outro mês.
