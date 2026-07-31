# Auditoria de UX e arquitetura de informação — app Dutelog

**Data:** 30/07/2026 · **Método:** navegação read-only em produção (sessão admin master) + leitura do código por 4 agentes em paralelo
**Restrição do cliente:** não alterar o visual — paleta, tipografia, componentes e estilo permanecem como estão. Tudo aqui é **arquitetura de informação e navegação**.

---

## O veredito em uma frase

O app não tem telas demais — tem **a mesma tela repetida** sob nomes diferentes, e **a mesma informação reapresentada** em vários lugares. São **37 rotas** e **9 grupos de menu**, mas o número de *conceitos distintos* é bem menor.

---

## Os 5 achados que explicam a sensação de "muitas telas"

### 1. O WMS são 7 itens de menu para 1 tela só

`Recebimento`, `Qualidade`, `Putaway`, `Picking`, `Packing`, `Expedição` e `Exceções` renderizam **o mesmo componente**:

```
App.tsx:864-870
const WmsReceiving = () => <WmsModuleScreen module="receiving" />;
const WmsQuality   = () => <WmsModuleScreen module="quality" />;
...  // 7 wrappers → <WarehouseOps initialModule=... />
```

A própria "Bancada WMS" já tem um seletor de etapas embutido (`WAREHOUSE_OPS_MODULES`). Ou seja: **o menu duplica um controle que já existe dentro da página.**

Pior: `Qualidade` e `Exceções` não são etapas — são **filtros** sobre as mesmas 5 filas (`queueKeys = FOCUS_QUEUE_KEYS` com `mode: 'quality'|'exceptions'`). Uma tarefa de recebimento bloqueada aparece em Recebimento, em Qualidade e em Exceções.

E `Devoluções` e `Inventário` existem **duas vezes**: como página avulsa (`wms-returns.tsx`, `wms-inventory.tsx`) e como aba dentro da bancada — os mesmos componentes.

### 2. "Como está a operação agora?" é respondida em 3 telas

`Torre de Controle`, `Agent Dute → Operacional` e `Suporte → Observabilidade` fazem fetch dos **mesmos 3 endpoints** (`/api/ai/overview`, `/api/warehouse/ops`, `/api/customer-requests`) e desenham cada uma a sua própria régua de KPIs.

Verificado na tela em produção — o contador de eventos ("30") aparece em **4 lugares**: Dashboard, Agent Dute, Suporte e Faturamento. Idem "Valor monitorado", "WMS pendente" e "Alertas IA".

As listas de alertas críticos e de solicitações abertas também são recalculadas e re-renderizadas nas três.

### 3. Toda tela abre com uma parede de contadores

Padrão sistêmico observado em produção: o usuário precisa rolar para chegar ao que veio fazer.

| Tela | Cards antes do conteúdo |
|---|---|
| Solicitações | **8** |
| WMS (bancada) | 5 |
| SKUs | 4 |
| Produtos | 4 |
| Faturamento | 3 + 4 de evidências |

### 4. Telemetria de desenvolvimento misturada com operação

- **Agent Dute** mostra "Controle Genkit" (9 flows ativos, 8 prontos, 18 planejados, com nomes de código como `billingReviewFlow`) e uma tabela "Modelo Firestore operacional" com coleções e IDs de evento.
- **Suporte** mostra `smoke /api/healthz` ao lado de alertas operacionais.

Isso é status de implementação — não é informação de turno para quem opera o armazém.

### 5. Pares que são um conceito só, partidos em duas rotas

| Hoje | Realidade |
|---|---|
| `Produtos` + `SKUs` | Duas visões do mesmo catálogo (mesmo `cod_cliente`, mesmas colunas, ambos com CRUD do mestre) |
| `Faturamento` + `Tabela de preços` | A tabela guarda a *configuração* que o faturamento *executa* |
| `/minhas-faturas` + `/portal/faturas` | Duas telas de fatura para o mesmo cliente |
| `Mapa do armazém` | É um pivot da coluna "Localização" que já existe em SKUs |

---

## Código morto encontrado

| Arquivo | Situação |
|---|---|
| `pages/client-portal.tsx` | **4.189 linhas**, nenhum import — monólito antigo do portal |
| `pages/client/agente-operacional.tsx` | Rota redireciona antes de renderizar; nunca é exibida |
| `lib/modules.ts` → `INTERNAL_MODULES`, `CLIENT_MODULES`, `visibleSections` | ~200 linhas de um **segundo registro de navegação** que ninguém consome |
| `/minhas-faturas` | Fora do menu, duplica `/portal/faturas` |

---

## Proposta de consolidação (sem tocar no visual)

### Menu interno: de 9 grupos / 30 telas → 6 grupos / ~14 telas

| Antes | Depois |
|---|---|
| **WMS** (10 itens) | **WMS** (1 item — "Bancada", com as etapas no seletor que já existe; Qualidade e Exceções viram filtros) |
| **Torre de Controle** (2) + **Agent Dute** (2) + **Suporte** (1) | **Torre de Controle** (abas: Visão geral · Agent Dute · Observabilidade) + Conhecimento |
| **Estoque** (4: Produtos, SKUs, Movimentações, Pedidos) | **Estoque** (3: Catálogo [abas Cadastro/Saldos], Movimentações, Pedidos) |
| **Faturamento** (2) | **Faturamento** (1 item, abas: Competência · Tabela de preços) |
| Mapa do armazém (item próprio) | Visão dentro de Catálogo |
| Documentos, Solicitações, Administração | Mantidos |

### Regra transversal: contadores só onde há decisão

Cada tela mantém **no máximo 3 indicadores** — os que mudam o que a pessoa vai fazer. O resto vira link para a tela dona do dado, em vez de recalcular o número localmente.

### Regra: um dono por informação

- Fila de solicitações → **`/solicitacoes`** é a dona. As outras telas mostram contagem + link.
- Alertas/riscos → **Agent Dute** é o dono (só ele tem a ação de resolver).
- Saldo físico → **Catálogo/SKUs** é o dono.
- Telemetria técnica (healthz, Genkit) → sai das telas de operação.

---

## Ordem sugerida de execução

1. **Limpeza de código morto** — risco zero, remove ~4.400 linhas e um registro de navegação fantasma.
2. **Colapsar o WMS** para 1 item de menu — maior ganho percebido pelo operador, e o componente já suporta.
3. **Unificar as 3 telas de "situação"** em abas da Torre de Controle.
4. **Fundir** Produtos+SKUs e Faturamento+Tabela de preços.
5. **Enxugar as paredes de contadores** tela a tela.

---

## Pendente de validação

Este mapa foi feito na visão **admin master** (que vê tudo). Falta percorrer:
- **`cliente`** — vê apenas os 7 itens do portal
- **`wms`/operador** — vê apenas WMS + Solicitações
- **`financeiro`** — vê apenas Faturamento

O operador WMS é quem mais sofre com o achado nº 1 e mais ganha com a consolidação — vale confirmar a experiência dele antes de executar.

---

## Anexo A — Visão do operador WMS (papel `wms`), verificada em produção

Percorrida em 30/07 com a conta de teste no papel `wms` — a mesma visão do Rafael.

### O operador vê 18 itens de menu, 10 deles do WMS

```
Torre de Controle · Solicitações
WMS → Recebimento · Qualidade · Putaway · Picking · Packing ·
      Expedição · Devoluções · Inventário · Exceções · Mapa do armazém
Estoque · Documentos · Agent Dute
```

### Prova de que as etapas são uma tela só

Navegando entre `/wms/recebimento`, `/wms/packing` e `/wms/excecoes`, o cabeçalho é **literalmente idêntico**:

> **Bancada WMS Dutelog**
> *Operação BTG em Recebimento, Qualidade, Putaway, Picking, Packing, Expedição e Exceções.*

O próprio subtítulo enumera as 7 etapas — a página assume ser uma bancada única. Só o bloco de trabalho central muda.

### Qualidade e Exceções não são etapas

`/wms/excecoes` se descreve como *"Faltas, avarias, divergências e bloqueios que precisam de tratativa antes de seguir o fluxo físico"* — é uma **visão transversal sobre todas as filas**, não um passo do processo. Está no menu no mesmo nível de Recebimento e Picking, o que induz o operador a procurá-la como se fosse uma etapa.

### Mapa do armazém é um pivô, não uma tela

`/warehouse` se descreve como *"Distribuição física dos SKUs"* — o mesmo dado da coluna "Localização" já presente em SKUs, reapresentado como hierarquia. Um item de menu inteiro para uma visualização alternativa.

### O operador cai no lugar errado

`getHomePathForAppRole` (modules.ts:788) manda todo papel interno para `/dashboard`. O operador de armazém — que trabalha com o celular na mão, na bancada — aterrissa na Torre de Controle, um painel de gestão, e precisa navegar até `/wms`.

**Correção sugerida:** papel `wms` cai direto em `/wms`.

---

## Anexo B — Achado de governança (fora do escopo de UX)

Durante a preparação dos testes, o papel de `financeiro@dutelog.com.br` (Flávia Rigonati) foi alterado de `financeiro` para `wms` pelo seletor "Alterar papel" da tela de Usuários — em conta **real de produção**.

**Efeito imediato:** a usuária perde o acesso a Faturamento (`FINANCE_ROLES` não inclui `wms`) e ganha acesso ao WMS. Sem nenhum aviso.

**Dois problemas de UX derivados:**

1. **Ação destrutiva sem confirmação.** Trocar o papel de um usuário ativo desliga acessos instantaneamente. Deveria confirmar explicitando o efeito: *"Flávia perderá acesso a Faturamento e ganhará acesso a WMS. Confirmar?"*
2. **Convite e alteração de papel convivem na mesma tela** com mecanismos distintos, tornando fácil alterar um usuário existente quando a intenção era criar outro.

> Neste caso a troca foi deliberada, para permitir a auditoria das visões. Reverter para `financeiro` ao final.

---

## Anexo C — Visão do coordenador (papel `interno`), verificada em produção

Percorrida em 30/07 com a conta de teste no papel `interno` — a visão do Manoel, coordenador do Rafael.

### Achado principal: coordenador e operador veem exatamente o mesmo menu

| Módulo | `owner` | **`interno`** | **`wms`** | `financeiro` | `suporte` |
|---|:---:|:---:|:---:|:---:|:---:|
| Torre de Controle | ✅ | ✅ | ✅ | ✅ | ✅ |
| Solicitações | ✅ | ✅ | ✅ | — | ✅ |
| WMS | ✅ | ✅ | ✅ | — | ✅ |
| Estoque | ✅ | ✅ | ✅ | — | ✅ |
| Faturamento | ✅ | — | — | ✅ | — |
| Documentos | ✅ | ✅ | ✅ | ✅ | ✅ |
| Agent Dute | ✅ | ✅ | ✅ | ✅ | ✅ |
| Suporte | ✅ | — | — | — | ✅ |
| Administração | ✅ | — | — | — | — |

As colunas `interno` e `wms` são **idênticas**. O coordenador não tem nenhuma superfície própria — nada que diga "estas são as decisões que dependem de você".

### Mas no backend eles são diferentes

O `interno` tem dois poderes exclusivos que o `wms` não tem:

| Capacidade | Onde é imposta | `interno` | `wms` |
|---|---|:---:|:---:|
| Aprovar/rejeitar solicitações (`decideCustomerRequest`) | `requireOperationsCoordinator` (index.ts:1264) | ✅ | ❌ |
| Criar/editar produtos e SKUs (`mutateManagedEntity`) | `requireCatalogWrite` (index.ts:1255) | ✅ | ❌ |
| Escrever em coleções operacionais | `canCoordinateOperations()` (firestore.rules:69) | ✅ | ❌ |

### O problema: a interface não reflete nada disso

Nenhuma página do app consulta o papel do usuário para habilitar ou esconder ações — `grep` por `useRole`/`role ===` em `src/pages/*.tsx` não retorna **nenhum** resultado.

Consequência prática: o Rafael (operador) vê o botão **"Adicionar Produto"**, clica, preenche o formulário inteiro — e recebe `"Erro ao criar produto"` (products.tsx:275), uma mensagem genérica que não explica que **ele não tem permissão**. O trabalho é perdido e a causa fica obscura.

**Correção sugerida:** esconder ou desabilitar ações que o papel não pode executar, e quando o servidor negar, exibir a mensagem real (`permission-denied` já vem com texto explicativo das Cloud Functions — hoje é descartada pelo `onError`).

### Inconsistência: regras e menu discordam sobre Faturamento

- `firestore.rules` → `canReadBilling()` **inclui** `interno`
- `modules.ts` → `FINANCE_ROLES` **exclui** `interno`

Verificado em produção: a rota `/faturamento` redireciona o coordenador para `/dashboard`, mas `GET /api/billing/periods/2026-07` responde **200 com os dados completos**.

Não é falha de segurança (a leitura é intencionalmente permitida), mas é indefinição de produto: **o coordenador deve ou não acompanhar o faturamento?** As duas camadas precisam concordar.
