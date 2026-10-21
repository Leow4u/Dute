# Comercial v1: roteiro para ligar no `dute-prod`

Escrito na parte 17 (21/10/2026), a partir da conferência final do Comercial v1
na `main`. Em 21/10/2026 o Leonardo autorizou ligar as telas e as callables no
`dute-prod` (as duas listas do Comercial e `AMBIENTES_LIBERADOS`, para o login
ver os cards). A carga em massa continua sem gravar no `dute-prod` e no
`dute-btg`. Cada passo que grava dado no `dute-prod` ainda precisa do OK do
Leonardo na conversa. Sem dado real neste arquivo.

## 1. Estado de hoje

- Partes 1 a 16 mergeadas. As duas listas `COMERCIAL_AMBIENTES_LIBERADOS`
  (`lib/liberacao.ts` no app, `functions/comercial/src/domain/liberacao.ts` nas
  Functions) incluem `dute-homolog` e `dute-prod`, travadas iguais por
  `platform-lists.test.ts`. `AMBIENTES_LIBERADOS` também inclui os dois, para
  o login ver os cards. O `dute-btg` continua de fora: as callables recusam
  com `failed-precondition`.
- No código, as telas e as callables do `dute-prod` atendem. A produção só
  passa a atender depois da publicação manual. A carga em massa não grava
  (`podeGravarNoProjeto`).
- Conferido na parte 17: regras (toda coleção do Comercial tem `match`, escrita
  sempre `false`; preço só para owner, admin, comercial e financeiro; contatos
  e locais só owner, admin e comercial); eventos (todo tipo com payload
  `.strict()`, severidade `info`, nenhum nome de tipo bate com as palavras de
  notificação do WMS); prospect fora do convite, do arquivamento e do seletor
  de cliente ativo; a zeragem (`tools/full_reset_btg.py`) preserva as coleções
  do Comercial; cargas em dry-run por padrão.
- Testes: `functions/comercial` `test:unit` (516 na parte 17), `vitest` do app
  inteiro, `test:unit` do WMS. Os testes de integração e de regras exigem Java
  11+ (a máquina de desenvolvimento tem o 1.8); rodam no CI.

## 2. O que muda no `dute-prod` só por publicar a `main`

Base de comparação: a última publicação de produção foi o commit `31e51b5`
(#124, 21/10 01:37 UTC). Confirmar a base nova antes de disparar.

**Comercial (inerte):** 12 callables novas na codebase `comercial` (12 serviços
Cloud Run novos; a conta `github-actions-functions` precisa poder criá-los, o
que só a primeira publicação prova), 7 índices compostos (`demands`, `quotes`,
`client_authorizations`) e regras de leitura novas, sem escrita.

**WMS, parte 5 (muda comportamento):**
- o `stage` enviado pelo WMS é descartado; alterar ou arquivar cadastro
  prospect é recusado;
- arquivar cadastro sem sigla do SKU é recusado;
- criar cliente confere a unicidade do código canônico e da raiz do CNPJ contra
  todos os cadastros (lê a coleção na transação);
- convite de perfil `cliente` exige cadastro não arquivado, não prospect e com
  sigla; Configurações › Clientes, Pessoas e Posições ocultam prospect e só
  oferecem cliente com sigla. A BTG (`BTG Pactual`) tem exceção em tudo isso.

**Fora do Comercial, mas na mesma `main`:** #126 (preço sai de `products`,
`skus`, `stock_balances` e `client_inventory` para `catalog_prices`; callable
nova `splitCatalogPrices`, owner/admin), #127 (faturar cada cliente na própria
competência), #128 (congelar o valor da competência fechada) e #129 (título da
aba). São trilhas de dinheiro e estoque: o Leonardo aprova a publicação sabendo
que vão juntas. O `splitCatalogPrices` precisa ser chamado depois da
publicação, repetindo até `done`, uma vez por ambiente; ainda não tem roteiro
próprio nem cursor (ver pendências).

Papéis: nenhum usuário atual tem `comercial`. `financeiro`, `owner` e `admin`
passam a ler preço, contratos e orçamentos (vazios até as cargas).

## 3. Antes de publicar (conferir)

1. HEAD da `main` com CI verde e a homologação publicada nele (a produção só
   publica o HEAD).
2. Janela combinada: a contagem de abertura da BTG roda no `dute-prod`; o deploy
   de functions leva de 11 a 15 minutos.
3. Backup: PITR de 7 dias e backup diário ligados
   (`docs/plataforma/backup-e-recuperacao.md`); anotar o instante de antes do
   deploy. O teste de restauração segue pendente (ver decisões).
4. Só leitura no `dute-prod`: listar `customers` sem `sku_prefix` além da BTG
   (somem do convite e de Posições e não podem ser arquivados) e conferir que o
   cadastro da BTG tem código `BTG Pactual` e nenhum `stage`.
5. Anotar a revisão atual do Cloud Run e a hora de atualização das functions
   (`docs/deploy-manual.md`, passo 3).

## 4. Ordem exata

1. **Corrigir a leitura de clientes do WMS** (bloqueia a carga da Omie; ver
   pendências). Sem isso, centenas de prospects empurram clientes reais para
   fora das listas.
2. **Backup e PITR conferidos**; export gerenciado antes da primeira carga.
3. **Publicação manual** (Actions > CI > Run workflow com `publicar_producao`),
   do HEAD da `main`. O job só vale verde com as conferências do fim:
   `check_rules_deployed.sh`, invoker de **todas** as callables das duas
   codebases (`tools/check_functions_invoker.ps1 -ProjectId dute-prod`, 89
   callables: 77 do WMS e 12 do Comercial), `check_frontend_deployed.sh` e o
   smoke.
4. **Depois**: chamar uma callable do Comercial com um owner e ver o
   `failed-precondition` (prova que a recusa funciona na produção); entrar com
   cada papel e conferir home e menu; `/comercial` cai em "não encontrado";
   convite de cliente BTG, Posições e faturas da BTG intactos; rodar o
   `splitCatalogPrices` até `done` e conferir que a prévia de fatura da BTG não
   mudou.
5. **Conferência da BTG**: cadastro da BTG sem duplicar, portal e faturas dela
   intactos, contagem de abertura ainda salvando caixas.
6. **PR que liga a liberação** (autorizado em 21/10/2026): acrescenta
   `dute-prod` nas duas listas `COMERCIAL_AMBIENTES_LIBERADOS` e em
   `AMBIENTES_LIBERADOS`, e publica pelo mesmo caminho manual. A carga em
   massa continua recusando `dute-prod` e `dute-btg`
   (`functions/comercial/src/cargas/projeto.ts`), mesmo com a tela ligada. As
   telas aparecem vazias para owner, admin e comercial até as cargas, que
   seguem em passo próprio.
7. **Cargas, sempre dry-run primeiro** (`docs/plataforma/comercial-cargas.md`),
   da máquina do Leonardo, com `gcloud auth application-default login` numa
   conta que grave no `dute-prod`, e relatórios conferidos em `tmp/comercial`
   antes de cada `--executar`:
   1. clientes da Omie (revisar o CSV de revisão: a linha da BTG fica a
      conferir e só entra com código; a conta do CRM sem CNPJ só entra com
      código);
   2. contratos (Itaú, Safra, BTG), sem o aditivo de preço;
   3. tabelas (Padrão Dutelog, depois LPU do Itaú Comercial e Noturna
      conferida contra o PDF, RFQ 2021 encerrada; Safra quando o arquivo
      chegar), copiando `tabela.id` de cada relatório;
   4. contratos de novo, com os `tabela_ids`, para os aditivos.
8. **Contador das demandas**: `demand_counters/geral`, campo `ultimo`. Sem o
   documento a primeira demanda é a 10001. Se o Leonardo quiser outro ponto de
   partida, gravar `ultimo` com o último número já usado na planilha (a
   próxima é `ultimo + 1`, nunca menor que 10001), à mão, no console ou com o
   Admin SDK, e conferir que não é menor que o maior `demands/{numero}`. Não
   existe ferramenta para isso.
9. **Papel `comercial` para o Guilherme**, depois do primeiro login dele. O
   convite só oferece `comercial` com a liberação da plataforma ligada
   (`AMBIENTES_LIBERADOS` de `lib/liberacao.ts`), que também liga a tela de
   entrada por módulo e o campo de módulos em Clientes para todos. Escolher
   entre ligar a plataforma ou dar o papel por roteiro controlado.
10. **Orçamentos em andamento e histórico da planilha como legado**: ainda não
    existe código. Definir o formato antes (ver decisões).
11. **Uma semana em paralelo com o Excel**: o Guilherme orça nos dois; no fim,
    comparar números, totais e tempo, e só então desligar a planilha.

## 5. Como desfazer

- **Desligar a liberação**: PR que tira `dute-prod` das duas listas e publicação
  manual. As callables voltam a recusar e as telas somem. Rápido e seguro.
- **Frontend**: voltar o tráfego do Cloud Run para a revisão anotada
  (`docs/deploy-manual.md`, Rollback).
- **Functions e regras**: não há roteiro de volta pelo CI (só publica o HEAD da
  `main`). O caminho é um PR de reversão que passe pela homologação, ou deploy
  manual de um commit anterior em checkout limpo (`firebase deploy --only
  firestore,storage` e `--only functions`, depois o invoker), com OK do
  Leonardo. Ponto de retorno: `31e51b5`.
- **O que NÃO se desfaz**: as cargas gravadas (clientes, contratos, tabelas,
  aditivos e os eventos delas), o contador e qualquer demanda criada. Só se
  recupera restaurando o banco para um banco novo (PITR ou backup), com OK do
  Leonardo. Por isso o dry-run, o backup antes e a conferência dos relatórios
  vêm antes de cada `--executar`.

## 6. Decisões do Leonardo

Respostas às perguntas abertas de `fase-6-comercial.md` (número entre
parênteses). Recomendação em cada uma.

**Antes de ligar (travam o uso ou a carga):**
- Publicar a `main` com #126 a #129 junto e a janela. Recomendo aprovar
  sabendo o que vai, e rodar o `splitCatalogPrices` logo depois.
- Contador: partida em 10001 ou outro número. Recomendo 10001, a menos que a
  planilha já tenha passado desse ponto.
- (15) Razão social e CNPJ do cabeçalho do PDF, que hoje sai só com o nome
  comercial. Recomendo informar antes de qualquer orçamento sair.
- Papel do Guilherme: ligar a plataforma ou roteiro controlado. Recomendo
  roteiro controlado, para não mudar a entrada de todos no mesmo dia.
- Trava própria da carga, para não abrir as telas antes dos dados. Recomendo
  aceitar telas vazias por algumas horas: é mais simples e reversível.
- Formato da carga do legado (orçamentos em andamento e histórico). Recomendo
  CSV simples, só leitura, com dry-run, em PR próprio depois do go-live.
- Teste de restauração do backup, hoje pendente. Recomendo fazer antes da
  primeira carga.

**Do uso (podem esperar uma semana de paralelo):**
- (1) Admin também aprova? Recomendo só o owner.
- (2) Quem manda o PDF? Recomendo os dois caminhos.
- (3) RV de execução sem preço novo dispensa a aprovação? Recomendo sim, com o
  total dentro do fechado.
- (7) Reabrir na mesma RV ou na seguinte? Recomendo manter e rever.
- (8) Dispensa aceita linha alterada, avulsa ou de ajuste igual à fechada?
  Recomendo aceitar a igual à fechada.
- (9) Prazo de perda do portal conta de que data? Recomendo manter a execução
  até confirmar o contrato.
- (10) Como encerrar a demanda que perdeu o prazo de faturamento? Recomendo
  motivo "prazo de faturamento", com o alerta vencido.
- (11) Aprovação da medição fecha a proposta sem fechamento? Recomendo atalho
  na tela da medição.
- (12) Frete esquecido de mês já enviado? Recomendo linha marcada "execução de
  outro mês" na medição aberta.
- (13) ZIP dos pedidos: fora do v1 (já aplicado).
- (14) Desfazer da aprovação no celular? Recomendo ação própria só se o toque
  errado acontecer.
- (16) Aviso de orçamento para aprovar: ver no uso se o e-mail basta.
- (17) Cancelar a autorização de medição aprovada: hoje sem volta (a medição
  fica aprovada e a autorização cancelada não é recriada). Recomendo decidir
  antes do go-live se aprovada volta a enviada, ou permitir recriar a
  autorização quando a anterior estiver cancelada.

## 7. Pendências da conferência (não corrigidas na parte 17)

Bloqueia a carga (não a publicação):
- **Listas de clientes do WMS leem uma página só** (`lib/cloud-api.ts`, rota
  `/api/customers`; `settings-customers.tsx` e `users.tsx` com `limit=250`,
  `warehouse-positions.tsx` com `limit=500`): o prospect sai em memória depois
  de 250 ou 500 cadastros por nome. Com a carga da Omie, clientes reais somem
  das telas. Corrigir seguindo o cursor ou filtrando na consulta, com teste de
  600 prospects antes dos clientes. Item 13 do desenho.

Importantes:
- Ações aceitas pelo servidor sem botão: Perdido em rascunho, aprovado,
  RV de execução ou aditivo enviado e aguardando autorização
  (`lib/comercial/depois-do-envio.ts`). Decidir se é intencional.
- Demanda em "A faturar" sem autorização (contrato com autorização
  "nenhuma", sem contrato, ou medição pendente) não aparece em nenhuma lista.
  Dar um segmento "A faturar" ou aceitar até a Fase 7.
- `splitCatalogPrices` sem roteiro e sem cursor (varre do começo e para em
  2000 documentos). Documentar e fazer andar por cursor.
- Cadastros de cliente sem sigla do SKU somem do convite e de Posições e não
  arquivam. Listar e decidir na conferência prévia (seção 3).
- Cadastros criados pela carga como `cliente` (comprou desde 2024) sem
  armazenagem aparecem em Configurações › Clientes; e a unicidade de identidade
  lê a coleção inteira a cada criação.
- Sem roteiro de volta para functions e regras (seção 5).
- Números de contrato, pedido, aceite e centro de custo e contatos nominais nos
  mockups (`ComContrato`, `ComAutorizacoes`, `ComClientes`), no comentário de
  `lib/comercial/contratos.ts` e em `autorizacoes.test.ts` parecem reais.
  Confirmar com o Comercial se algum é real e trocar por fictício.

Menores:
- `comercialStatus` fica pública e o app não usa; remover ou fazer chamar a
  liberação antes de ler o perfil.
- `contrato_id` é texto livre e vai para `events`: gerar sempre no servidor.
- Editar a data de uma linha da medição mantém o "dia da tarifa" gravado
  (`lib/comercial/medicoes.ts`): voltar para "Pela data" ao mudar a data.
- Owner não aprova do rascunho o que ele mesmo montou (a tela exige dois
  passos); o ramo do servidor fica sem uso.
- Contrato misto: `demands.cobranca` vem só do regime padrão; o serviço em
  `medicao_mensal` entra na medição sem número de demanda.
- `tools/omie/` solto fora de qualquer PR (não rastreado, sem credencial).

Corrigidos na parte 17: CNPJs reais nos testes do app (agora fictícios);
trava de projeto igual nas três cargas (`demo-` só com o emulador); a carga de
tabela recusa CSV dentro do repositório fora de `tmp/` e `.secrets/`; roteiro
de `tabela.id` no `comercial-cargas.md`; comentário do `firestore.rules`
(`catalog_prices`); semente do contador no teste da zeragem; frase sobre
regras à mão no `fase-2-nucleo.md`.
