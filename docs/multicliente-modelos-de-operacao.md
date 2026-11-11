# Multicliente: modelos de operação, pacotes e cadastro

Decisão de 19/10/2026, depois da fase 0 do mapa do armazém e antes da
contagem de abertura da BTG. Um sistema, uma instância, um galpão: a Dutelog
opera vários clientes (BTG, Itaú, os próprios insumos) na mesma plataforma, e
cada cliente vê só o que é dele. A personalização por cliente **não é
configuração de tela**: é código no repositório, com teste. O cadastro só
aponta.

## As três camadas

| Camada | Onde vive | O que é |
|---|---|---|
| **1. Modelo de operação** | `artifacts/app/src/lib/operations/templates/*.ts` | O jeito de operar: como o estoque é contado (quantidade ou peça), quais módulos o portal tem, campos do cadastro, cobrança, etiqueta, mapa. |
| **2. Pacote do cliente** (opcional) | `artifacts/app/src/lib/operations/packs/*.ts` | O que um contrato muda sobre o modelo. Encontrado pelo código operacional do cliente, nunca digitado. |
| **3. Cadastro do cliente** | Firestore `customers` (Configurações › Clientes) | Nome, código operacional, **sigla do SKU**, **modelo de operação**, portal ligado ou não, contrato. Nada de regra. |

Reaproveitar é promover um pacote a modelo, nunca copiar o sistema nem abrir
outro projeto no Google Cloud (alternativa descartada em 19/10/2026: dobraria
deploy, regras, auditoria e faturamento para o mesmo galpão e a mesma equipe).

### Modelos registrados

| Chave | Modelo | Situação | Portal |
|---|---|---|---|
| `uniformes` | Uniformes e materiais (a operação BTG de hoje) | Pronto | Agent Dute, Início, Estoque, Eventos, Envios para a Dutelog, Pedidos, Faturas, Documentos |
| `mobiliario` | Mobiliário: peça com patrimônio, foto e estado de conservação; posição de piso | Em construção | Sem Eventos. Peças, Solicitações (retirada, devolução, manutenção, descarte), LPU própria e etiqueta de peça vêm nos próximos PRs; até lá, Pedidos é o canal |
| `insumos` | Insumos internos da Dutelog (plástico bolha, caixas, fita, ferramentas) | Em construção | Não tem portal |

Pacotes: `btg` (sobre `uniformes`, código operacional `BTG Pactual`). Hoje é só
o que já existe; é o lugar da regra nova do BTG quando aparecer.

### Como uma solicitação específica vira código

1. O cliente pede. A regra é escrita no pacote dele, com teste que falha antes
   e passa depois.
2. PR, CI verde, merge. Só quem tem o pacote vê a mudança.
3. Outro cliente precisa do mesmo? A regra sobe para o modelo e os dois ganham.

Um modelo novo nasce quando dois clientes pedem a mesma coisa.

## O que o PR 1 construiu (19/10/2026)

- **Registro em código** (`src/lib/operations`): tipos, os três modelos, o
  pacote `btg`, `resolveOperationProfile` (modelo + pacote + sigla + portal a
  partir do cadastro, com o modelo da BTG como padrão), validação da sigla.
  `operations.test.ts` lê `functions/wms/src/domain/customer-profile.ts` e trava
  as chaves dos dois lados.
- **Cadastro** (`customers`): campos `operation_template` e `sku_prefix`,
  validados em `functions/wms/src/domain/customer-profile.ts` dentro do
  `mutateManagedEntity` (modelo tem de existir; sigla com 2 a 6 letras ou
  números, única entre clientes não arquivados, lida na transação antes das
  escritas; código operacional não muda depois do cadastro; modelo sem portal
  força o portal desligado). Cadastro anterior ao campo (a BTG) continua no
  modelo `uniformes`.
- **Projeção `client_profiles/{id}`**: gravada na mesma transação do cadastro
  com só os campos públicos (código, nome, modelo, sigla, portal, situação).
  É a única parte do cadastro que o portal lê: `customers` tem observações e
  contrato. Regras: cliente lê a própria (`isOwnProjection`), operação e
  financeiro leem todas, ninguém grava pelo navegador. Preservada na zeragem
  total (`tools/full_reset_btg.py`, junto de `customers`).
- **Configurações › Clientes** (`/configuracoes/clientes`, substitui "Cliente
  BTG"; o endereço antigo redireciona): lista com sigla, modelo, pacote
  encontrado, zona no armazém (de Estoque › Posições), portal e pessoas;
  cadastro e edição com o modelo, a sigla (sugerida pelo nome), o portal e a
  ficha "O que o modelo define"; arquivar. Desde 11/11/2026 a tela é uma
  galeria de cartões com a página de cada cliente (ver "A tela de Clientes",
  abaixo).
- **Convite por cliente** (Pessoas e acessos): o perfil cliente escolhe a conta
  do portal entre os clientes com portal ativo; "Convidar" na lista de
  clientes já chega com o cliente escolhido.
- **Portal por modelo**: o menu (`getNavigationForProfileRole(role, perfil)`)
  e as rotas (`RoleGate`) do portal mostram só os módulos do modelo do
  cliente, lidos por `GET /api/client/profile` (`client_profiles`). Sem
  registro publicado, o portal é o de hoje. Mobiliário não tem Eventos;
  insumos vê só o Início. A área interna não filtra nada ainda.

**Módulos contratados (Fase 2 da plataforma, 20/10/2026).** O cadastro também
guarda quais módulos o cliente contrata (`wms`, `operacao`, `financeiro`),
projetados em `client_profiles` e em `client_access/{customer_code}`. Ligar um
módulo é configuração no cadastro; o que cada módulo faz continua em código.
Desenho e regras em `docs/plataforma/fase-2-nucleo.md`.

Para o Leonardo, depois do deploy: abrir Configurações › Clientes, editar a BTG
e salvar com a sigla `BTG`. Isso publica o `client_profiles` da BTG e prepara o
PR 2 (SKU por cliente). Sem isso nada muda para a BTG: o padrão é o modelo dela.

Deploy deste PR (ver `docs/deploy-functions-manual.md`). Os comandos de
publicação desta página são o registro de 19/10/2026, antes do corte da Fase 1:
hoje a publicação é pelo GitHub Actions, e o `dute-btg` está congelado.

```powershell
cd C:\DEV\Dute
git pull origin main
firebase deploy --only functions --project dute-btg
tools\check_functions_invoker.ps1
firebase deploy --only firestore --project dute-btg
```

O frontend sobe pelo GitHub Actions no merge em `main`.

## O que o PR 1b construiu (19/10/2026): cliente ativo na área interna

- **Seletor de cliente ativo** no menu da área interna (no celular, no
  cabeçalho), lendo `client_profiles` (todo papel interno lê, inclusive o
  financeiro). A escolha fica guardada no aparelho, por pessoa. A BTG entra
  sempre, mesmo antes de o cadastro dela ser salvo de novo. Contexto e regras
  puras em `src/lib/active-customer-context.tsx` e `src/lib/active-customer.ts`.
- **O que segue o cliente ativo**: Contagem (sessão de abertura, caixas,
  sugestão de posição, produtos, linhas e contagem cíclica), chegada avulsa do
  Receber, devoluções, fotos de produto, Etiquetas, Documentos novos, anotação
  e sincronização de notificações do agente, envio à base de conhecimento e a
  lista de Estoque › Itens. Trocar de cliente recomeça a Contagem (caixa aberta
  e rascunho eram do cliente anterior).
- **O que mostra todos**: Início, Pedidos, a fila do Receber, Mapa, a
  biblioteca de Documentos e o painel do agente. Decisão: a equipe é uma só e a
  fila de trabalho não pode esconder o pedido de um cliente porque o seletor
  está em outro.
- **"Novo item" avulso** (Estoque) só para a BTG até o PR 2: o cadastro avulso
  grava o item sem cliente. Itens dos outros clientes entram pelo Receber e
  pela Contagem, que gravam o cliente.
- **Registro sem `customer_code` é da BTG** em todo lugar (`recordCustomerCode`,
  `customerRows` no app; `recordOwner` nas Functions). O nome literal "BTG
  Pactual" só existe no pacote `btg`; `customer-literals.test.ts` trava a volta
  do literal no app. Nas Functions do WMS, o literal só existe nas constantes
  do cliente legado (`LEGACY_CUSTOMER_CODE` e a do faturamento), e nenhum
  texto que vai para a tela, para o e-mail ou para a IA cita a BTG
  (`functions/wms/src/customer-literals.test.ts`).

Isolamento entre clientes nas Functions (`functions/wms/src/domain/customer-scope.ts`,
testes em `customer-scope.test.ts` e `customer-isolation.integration.test.ts`):

- **Inventário de abertura por cliente.** `system_controls/inventory` continua
  sendo a abertura da BTG (a da zeragem de 16/10/2026 e a base do faturamento
  atual), com o mesmo comportamento de antes. A abertura de outro cliente não
  escreve nele: trava só os pedidos de saída do próprio cliente, enquanto a
  sessão dele está aberta. Cliente novo, sem sessão, começa pelo recebimento e
  não espera a contagem de ninguém. `getOpeningInventorySession` devolve
  `opening_required`, e a Contagem só avisa "abertura pendente" quando trava.
- **Catálogo com dono.** Contagem, recebimento e devolução de um cliente
  recusam produto ou SKU de outro ("O código X já está cadastrado para o
  cliente Y"), inclusive arquivado (reativar tomaria o histórico do outro). O
  catálogo ainda é um só; o código por cliente é o PR 2.
- **E-mail ao cliente.** A lista de destinatários do ambiente
  (`AGENT_DUTE_EMAIL_CLIENT_TO`) vale só para a BTG; notificação de outro
  cliente só sai com destinatário informado na aprovação.
- **Incidente do sistema** (Configurações › Sistema) passa a ser da operação
  (`customer_code` "Dutelog"), não da BTG: a sincronização de notificações não
  redige e-mail ao cliente sobre problema interno.

Deploy deste PR: functions (lote completo), checagem do invoker e frontend
pelo CI. Regras e índices não mudam.

```powershell
cd C:\DEV\Dute
git checkout main
git pull origin main
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "180"
firebase deploy --only functions --project dute-btg
tools\check_functions_invoker.ps1
```

## O que o PR 2 construiu (19/10/2026): SKU gerado por cliente

O SKU deixou de ser digitado. Produto novo nasce com `<SIGLA>-000001` na
sigla do cliente (`BTG-000001`, `ITAU-000001`), gerado nas Functions dentro da
mesma transação que cria o produto (`functions/wms/src/domain/catalog-codes.ts`,
testes em `catalog-codes.test.ts` e `catalog-codes.integration.test.ts`).

- **Onde o SKU nasce**: produto novo da Contagem (abertura), da chegada avulsa
  do Receber, da conferência de linha "código a definir" e da confirmação do
  envio avisado no portal (linha marcada como nova). O que vier digitado como
  SKU de produto novo é ignorado; no portal, o código que o cliente digita é o
  código do cliente, e na confirmação o envio liga ao SKU do cadastro dele (se
  já existir) ou ganha um gerado.
- **Contador por sigla** em `sku_counters/{SIGLA}` (`last`, `last_code`), só
  escrito pelas Functions (as regras negam o resto). Código que já existe no
  catálogo é pulado. **Número não volta**: remover uma linha da abertura apaga
  o cadastro que ela criou, e a recontagem recebe o próximo número.
- **Reativação**: recontar como novo um produto arquivado do mesmo cliente
  reaproveita o SKU dele, sem gerar outro número para o mesmo produto. A
  chegada avulsa do Receber faz o mesmo (30/10/2026): o "Excluir" do Estoque
  › Itens só arquiva e a busca da tela esconde arquivados, então o código
  todo arquivado, cadastrado como novo, volta com o SKU que já tinha
  (`catalog_reactivated` na linha e na resposta; o aviso diz "SKU
  reativado"), sem mexer no saldo. Código com SKU ativo continua recusado
  ("já existe no cadastro com SKU").
- **Sem sigla, sem produto novo**: as Functions recusam com "Cadastre a sigla
  do SKU de X em Configurações › Clientes"; a Contagem avisa antes e trava o
  "Cadastrar como novo".
- **Código de barras único dentro do cliente**: produto novo com o código de
  barras de outro produto ativo do mesmo cliente é recusado ("já é do SKU
  BTG-000001"), comparado sem espaços (`barcode_key`). Outro cliente pode usar
  o mesmo código. Duas linhas novas com o mesmo código de barras na mesma
  chegada também são recusadas.
- **Sem "Novo item" avulso**: o botão saiu do Estoque e `mutateManagedEntity`
  recusa criar produto ou SKU; editar e arquivar seguem. O SKU continua
  imutável depois de criado.
- **Na tela** (Contagem, chegada avulsa, contagem cíclica, devoluções): o campo
  de código acha o produto pelo código do cliente, pelo SKU ou pelo código de
  barras (`src/lib/product-match.ts`); o SKU aparece só para leitura ("Gerado
  ao salvar (BTG-…)"); antes de cadastrar como novo, até três parecidos com
  foto, com "Usar este"; o aviso depois de salvar mostra o SKU gerado. Na
  chegada avulsa, duas linhas do mesmo produto (por códigos diferentes ou pelo
  mesmo código de barras) aparecem como repetidas.
- **Zeragem total**: `sku_counters` não é acesso nem estrutura, então sai junto
  com o catálogo e a numeração recomeça em 000001.

Fica como estava, de propósito:

- **Código do cliente igual em dois clientes** continua recusado (PR 1b): o
  produto ainda é guardado pelo código do cliente (`products/{código}`).
  Separar exige migrar essa chave; fica para quando o caso aparecer.
- **Patrimônio** (peças serializadas agrupadas sob o produto, "Cadeira Herman
  Miller" com 0050500, 0050501...) foi para o PR de mobiliário: só faz sentido
  com o recebimento de peça, a etiqueta por peça e o estado de conservação,
  que nascem lá.

Antes de contar ou receber produto novo de um cliente, a sigla dele precisa
estar salva em Configurações › Clientes (a BTG com `BTG`). Deploy deste PR:
functions (lote completo), checagem do invoker e frontend pelo CI. Regras e
índices não mudam.

```powershell
cd C:\DEV\Dute
git checkout main
git pull origin main
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "180"
firebase deploy --only functions --project dute-btg
tools\check_functions_invoker.ps1
```

## A tela de Clientes (11/11/2026): galeria de cartões e página do cliente

A tabela de oito colunas de 19/10 não cabia na área da Configuração: as
colunas de pessoas e de ações ficavam fora da tela, atrás de uma rolagem
lateral, e os três cartões abaixo dela explicavam as camadas (legenda, que a
regra de 23/10/2026 proíbe: só rótulos, dados e ações). Uma primeira versão,
lista à esquerda e ficha à direita (09/11, PR 589), foi recusada pelo
Leonardo. A proposta seguinte, galeria de cartões e página do cliente, foi
aprovada em 11/11/2026 (`docs/mockups/ConfigClientes.dc.html` e as outras
`Config*.dc.html`) e é a que está no app:

- **A Configuração na v3.** A barra lateral preta (logo, "Voltar", as seções
  por grupo, a conta no rodapé) e o cabeçalho preto no celular valem em todas
  as seções. O conteúdo entra no `.v3` seção por seção
  (`SECOES_DA_CONFIGURACAO_NA_V3`, em `lib/settings-nav.ts`): hoje Clientes e
  Chaves de API; as outras seguem `docs/sistema-visual.md` até a vez delas.
- **A galeria** (`/configuracoes/clientes`): um cartão por cliente, com a
  sigla do nome numa cor tirada do código (`customerTone`), o nome, o código,
  o selo (Portal ativo, Sem portal, Pausado ou Arquivado), o modelo, o pacote
  e "Em construção", e os números: prateleiras e ruas da zona, pessoas no
  portal e a sigla do SKU; os módulos contratados no rodapé. Filtros Todos
  (os não arquivados), Com portal, Sem portal e Arquivados, com a contagem;
  busca por nome, código, razão social e CNPJ. No celular o cartão fica
  compacto, com os números numa linha.
- **A página do cliente** (`/configuracoes/clientes?cliente=<código>`, o
  mesmo jeito de endereço das outras telas, sem rota nova): o caminho de
  volta, o cabeçalho (sigla, nome, selo, código, modelo, pacote e "cliente
  desde", quando o cadastro tem a data de criação) com "Avisos por e-mail",
  "Convidar" e "Mais ações" › "Arquivar cliente"; a faixa de números
  (prateleiras, pessoas no portal, contatos de aviso e sigla); e as seções em
  cartões. **Operação**: modelo, pacote, sigla com o SKU de exemplo, módulos
  contratados e a conferência da chegada (por caixa só onde a caixa está
  liberada e o modelo pede). **Armazém**: a zona e a ocupação por rua, com as
  caixas guardadas, lidas como no Mapa (as mesmas chaves de leitura). **Portal
  do cliente**: situação, pessoas (com as iniciais) e as telas que o portal
  mostra (o modelo dentro do contrato). **Contrato**: situação, razão social,
  CNPJ, contato e observações internas. **Avisos por e-mail**: os contatos e os
  avisos de estoque, com "Novo contato", "Editar" e "Desativar" ali mesmo.
- **Editar no lugar.** Operação (modelo, sigla e módulos), Portal (ligado ou
  sem portal) e Contrato (nome exibido, razão social, CNPJ, contato, e-mail,
  situação e observações) têm o próprio "Editar". Cada seção grava o cadastro
  inteiro com o que ela mudou (`customerFormWith`), pela mesma rota de
  antes; a sigla é obrigatória em toda gravação (`normalizeSkuPrefix` nas
  Functions), então, sem sigla no cadastro, o formulário da seção a pede,
  já com a sugestão pelo nome. O diálogo de doze campos ficou só para o
  "Novo cliente", e o cliente criado abre na página dele.
- **O arquivado fica só para leitura.** A gravação das Functions marca
  `archived: false`: editar e salvar um cliente arquivado o reativava sem
  aviso. A página não oferece edição, convite, arquivar nem avisos para o
  arquivado; reativar, se um dia for preciso, é uma ação própria.
- **Sem afirmar o que não leu.** Enquanto as posições não chegam, o cartão e
  a página mostram "…" no lugar da zona; se a leitura falha, "—" e, na
  página, "Não foi possível ler a ocupação." com "Tentar de novo". A lista
  que falha mostra o aviso com "Tentar de novo", nunca "Nenhum cliente".

Ficou de fora das pranchas, de propósito: o "último acesso" das pessoas (não
existe o dado; precisaria gravar o acesso), o item "Chaves da API" do menu
de mais ações (a chave de API é pessoal, não do cliente) e o cliente Dutelog
de exemplo. O "primeiro SKU gerado" da faixa de números virou a sigla, como
na prancha do celular. Os testes: `settings-customers.test.tsx` (a galeria e
a página: os textos de cada estado, a trava contra legenda, e o axe),
`settings-customer-notifications.test.tsx` (a seção de avisos) e
`customer-registry.test.ts` (as regras puras).

O diálogo de cadastro ainda tem textos de apoio (o pacote encontrado, "mudar
o modelo é um PR"); limpá-los é uma parte própria.

## Prospect do Comercial (20/10/2026): o WMS não enxerga

`customers` é a lista única de empresas (desenho do Comercial,
`docs/plataforma/fase-6-comercial.md`). O prospect, que recebeu orçamento e
ainda não é cliente, mora ali com `stage: "prospect"`, gravado só pelo
Comercial, sem sigla, modelo, módulos nem projeções. Sem o campo, o cadastro é
cliente: a BTG e os cadastros de hoje não mudam. A lista dos estágios fica em
`lib/dominio` (`ESTAGIOS_CADASTRO`), com cópia travada em `customer-profile.ts`.

- **Lista de clientes** (`GET /api/customers`): esconde o prospect, como esconde
  o arquivado, sem `include_prospects=true`. Vale para Configurações › Clientes,
  o convite e Posições.
- **Cadastro pelo WMS**: não grava `stage`, não altera nem arquiva prospect e não
  arquiva cadastro sem sigla (o arquivamento gravaria `client_profiles` e
  `client_access` com os módulos padrão). Na criação, o código é único sem
  acento, sem maiúsculas e sem separador ("Itau" colide com "ITAÚ", e "BTG
  Pactual" com o "BTG-PACTUAL" do Comercial) e, com um CNPJ válido em
  `document` (numérico ou alfanumérico, conferido pelos dígitos verificadores),
  a raiz (8 primeiros caracteres) também é única, contra todos os cadastros,
  inclusive arquivados e prospects. O Comercial copia a mesma regra.
- **Convite de cliente**: exige cadastro achado pelo código, não arquivado, que
  não seja prospect e que tenha sigla (`domain/customer-invite.ts`). A BTG passa
  sempre, com ou sem sigla e projeções.
- **Posições** oferece como zona só cadastro com sigla, e a BTG.
- O seletor de cliente ativo e a criação de produto não mudam: sem projeção não
  há seletor, e sem sigla não há SKU.

Pendências conhecidas:

- As três telas leem uma página só de `/api/customers` (250 ou 500 cadastros,
  por nome), e o prospect sai em memória depois da leitura. Com muitos
  prospects (carga da Omie, parte 13 do Comercial), clientes de verdade podem
  ficar fora da página. Antes dessa carga, a rota ou as telas precisam ler até
  o fim pelo `next_cursor`.
- A raiz do CNPJ é conferida só na criação. Mudar o `document` em
  Configurações › Clientes ainda pode repetir uma raiz.
- "Trocar perfil" para `cliente` em Pessoas e acessos (`set_role`) não confere
  o cadastro: só o convite confere.

## Próximos PRs

1. **Mobiliário**: estado de conservação (ótimo, bom, ruim, danificado) com
   foto no recebimento e etiqueta por peça; peças serializadas (patrimônio)
   agrupadas sob o produto; solicitações de retirada, devolução, manutenção e
   descarte; custo de transporte por viagem; LPU do contrato; posições de piso
   com área e unidade de manuseio "volume" (caixa, palete, peça) no mapa.
2. **Insumos internos**: entrada, baixa por uso, mínimo de estoque, sem portal
   e sem fatura, na zona da Dutelog.
3. A contagem de abertura da BTG esperava os PRs 1 e 2 (decisão de
   19/10/2026): com os dois publicados e a sigla `BTG` salva, pode começar.
4. Ainda assumem a BTG, de propósito, até virarem por cliente: faturamento
   (`billing_config`, prévia e competências), os alertas derivados do painel do
   agente e o `DEFAULT_CUSTOMER` das Functions como leitura de registro antigo.
   O mapa mostra o conteúdo das caixas só do cliente ativo (as linhas vêm da
   sessão de abertura dele).

## Decisões registradas

- O pacote é encontrado pelo código operacional (`packs/*.ts` lista os
  clientes), não guardado no banco: não existe pacote sem código.
- A sigla do SKU é obrigatória no cadastro (inclusive ao editar um cadastro
  antigo) porque o PR 2 gera o SKU a partir dela; nunca é digitada em
  minúsculas nem com acento (normalizada dos dois lados).
- O menu do portal segue a ordem de `lib/modules.ts`; o modelo só diz quais
  módulos existem.
- "Em construção" é um estado do registro, mostrado na tela: o cadastro aceita
  o modelo antes das telas existirem, e a ficha do modelo diz o que falta.
