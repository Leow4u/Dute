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
  ficha "O que o modelo define"; arquivar.
- **Convite por cliente** (Pessoas e acessos): o perfil cliente escolhe a conta
  do portal entre os clientes com portal ativo; "Convidar" na lista de
  clientes já chega com o cliente escolhido.
- **Portal por modelo**: o menu (`getNavigationForProfileRole(role, perfil)`)
  e as rotas (`RoleGate`) do portal mostram só os módulos do modelo do
  cliente, lidos por `GET /api/client/profile` (`client_profiles`). Sem
  registro publicado, o portal é o de hoje. Mobiliário não tem Eventos;
  insumos vê só o Início. A área interna não filtra nada ainda.

Para o Leonardo, depois do deploy: abrir Configurações › Clientes, editar a BTG
e salvar com a sigla `BTG`. Isso publica o `client_profiles` da BTG e prepara o
PR 2 (SKU por cliente). Sem isso nada muda para a BTG: o padrão é o modelo dela.

Deploy deste PR (ver `docs/deploy-functions-manual.md`):

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
  do literal no app.

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

## Próximos PRs

1. **SKU por cliente** (PR 2): `<SIGLA>-000001` sequencial por cliente
   (contador nas Functions), código do cliente e código de barras únicos
   **por cliente**, checagem forte de produto parecido com foto antes de criar,
   busca por qualquer código. Produtos com peças serializadas (patrimônio)
   agrupadas sob o produto ("Cadeira Herman Miller" com 0050500, 0050501...).
2. **Mobiliário**: estado de conservação (ótimo, bom, ruim, danificado) com
   foto no recebimento e etiqueta por peça; solicitações de retirada,
   devolução, manutenção e descarte; custo de transporte por viagem; LPU do
   contrato; posições de piso com área e unidade de manuseio "volume"
   (caixa, palete, peça) no mapa.
3. **Insumos internos**: entrada, baixa por uso, mínimo de estoque, sem portal
   e sem fatura, na zona da Dutelog.
4. A contagem de abertura da BTG espera os PRs 1 e 2 (decisão de 19/10/2026).
5. Ainda assumem a BTG, de propósito, até virarem por cliente: faturamento
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
