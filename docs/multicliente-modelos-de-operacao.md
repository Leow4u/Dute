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
| **1. Modelo de operação** | `artifacts/btg-inventory/src/lib/operations/templates/*.ts` | O jeito de operar: como o estoque é contado (quantidade ou peça), quais módulos o portal tem, campos do cadastro, cobrança, etiqueta, mapa. |
| **2. Pacote do cliente** (opcional) | `artifacts/btg-inventory/src/lib/operations/packs/*.ts` | O que um contrato muda sobre o modelo. Encontrado pelo código operacional do cliente, nunca digitado. |
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
  `operations.test.ts` lê `functions/src/domain/customer-profile.ts` e trava
  as chaves dos dois lados.
- **Cadastro** (`customers`): campos `operation_template` e `sku_prefix`,
  validados em `functions/src/domain/customer-profile.ts` dentro do
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

## Próximos PRs

1. **Cliente ativo na área interna** (PR 1b): seletor no topo da área interna
   ("muda menu, campos e regras para o cliente escolhido; Todos só no mapa e
   no painel"), remoção dos ~21 literais `"BTG Pactual"` do app e do
   `DEFAULT_CUSTOMER` das Functions nas trilhas que ainda assumem um cliente só.
2. **SKU por cliente** (PR 2): `<SIGLA>-000001` sequencial por cliente
   (contador nas Functions), código do cliente e código de barras únicos
   **por cliente**, checagem forte de produto parecido com foto antes de criar,
   busca por qualquer código. Produtos com peças serializadas (patrimônio)
   agrupadas sob o produto ("Cadeira Herman Miller" com 0050500, 0050501...).
3. **Mobiliário**: estado de conservação (ótimo, bom, ruim, danificado) com
   foto no recebimento e etiqueta por peça; solicitações de retirada,
   devolução, manutenção e descarte; custo de transporte por viagem; LPU do
   contrato; posições de piso com área e unidade de manuseio "volume"
   (caixa, palete, peça) no mapa.
4. **Insumos internos**: entrada, baixa por uso, mínimo de estoque, sem portal
   e sem fatura, na zona da Dutelog.
5. A contagem de abertura da BTG espera os PRs 1 e 2 (decisão de 19/10/2026).

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
