# Eventos · parte 4: portal: a lista, o formulário da edição e o diálogo dos itens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o cliente abre `/portal/eventos`, vê cada evento com a edição
atual e as anteriores, cria a edição em `/portal/eventos/novo` (nasce no
servidor com o nome, grava sozinha a cada mudança, leva o layout e a
planilha), ajusta os 100 itens em "Ver os N itens", envia à Dutelog e exclui
o rascunho; só na homologação.

**Architecture:** regras puras em `artifacts/app/src/lib/eventos/` com
teste; três telas do portal no visual do WMS (`ClientDataBoundary`,
`ClientModuleShell`), cada uma com a view pura (textos e `axe`) e a página
com os hooks; leituras ao vivo pelas regras (`useLeituraDoPortal`, como
Minhas OS), nunca por `/api`; escritas pelos wrappers das partes 2 e 3; o
legado move para `pages/client/eventos-modelos.tsx`, fora da liberação.

**Tech Stack:** React, wouter, Firestore SDK (`onSnapshot`), Storage SDK,
vitest com jsdom e axe-core.

**Spec:** `docs/superpowers/specs/2026-11-26-eventos-design.md`, seções "As
telas › Portal" (lista, novo/rascunho, os itens do evento), "A edição, campo
a campo", "O cronograma", "Os status e quem move cada um", "As callables",
"Limites e mensagens", "Testes e travas". Índice:
`docs/superpowers/plans/2026-11-26-eventos.md`. Pranchas:
`docs/mockups/EventosPortalLista.dc.html`, `EventosPortalNovo.dc.html`,
`EventosPortalItens.dc.html` (os textos delas são os das listas dos testes).

## Global Constraints

As do índice. Nesta parte, ainda: nenhuma callable nova e nada em
`functions/`; o legado (`ClienteEventosModelos`, `events-api.ts`) continua
inteiro fora da liberação; "Escolher no Estoque" leva a
`/portal/estoque?evento=<edition_id>`, que só aprende o modo "montando o
evento" na parte 5; `edicao?id=` fora de `rascunho` volta à lista até a parte
11 (o "Abrir" do cartão e os `label` das edições anteriores já levam para
lá; a parte 11 troca só esse ramo de `ClienteEventoEdicao`), que também traz
a cópia da edição anterior ("Nova edição a partir de <label>" aqui só abre o
formulário com o evento escolhido); o texto da tela é só o das pranchas,
mais a linha da falta de saldo que a spec pede antes do envio ("O envio e o
pedido"; T1, T3 e T4; ela não tem prancha e pede a foto e o OK do
Leonardo, em "Pronto quando"), e a trava dos textos lista cada um;
`null` só em `ate`, `observacao`, `local` dos momentos e nos campos de texto
vazios do `patch`; a hora da tela é a de São Paulo.

## Review Focus

1. A aba que perde a rede no nascimento: a criação repete com a mesma
   `idempotency_key`, o servidor devolve `created: false` e a rota só muda
   quando o `id` chega (T3, `evento-formulario-rascunho.test.tsx`).
2. O rascunho mudado em outra aba enquanto esta digita: a recusa "A edição
   mudou em outra aba" refaz o formulário com o documento vivo, e o texto
   da aba velha não volta ao servidor (T3).
3. O `outro` momento com rótulo e sem data não é gravado nem conta nos
   cinco; com data e sem rótulo, a recusa do servidor cai no campo (T3,
   `cronogramaDasLinhas` e `campoDaMensagem`).
4. A família que fica com um tamanho a zero no diálogo sai de `itens`, o
   total refaz e "Mostrando N de M itens" acompanha (T4).
5. A última edição `cancelado`: o cartão mostra o selo "Cancelado", sem as
   etapas, e oferece "Nova edição a partir de <label>" (T1, `lista.test.ts`).
6. O item que veio da leitura vai ao servidor só com os seis campos de
   entrada: `patchDoFormulario` passa todo `patch.itens` por `itemDeEntrada`,
   senão o `ItemDaEdicaoSchema`, `.strict()`, recusa a primeira gravação com
   itens pelo `foi` nulo (T1, `itens.test.ts`; T3, `formulario.test.ts`).
7. Duas edições abertas do mesmo evento: o nome do formulário vem da capa e
   o `patch.evento` leva só o campo que mudou em relação a ela, então mudar
   a descrição numa não desfaz a renomeação feita na outra (T3,
   `formulario.test.ts` e `evento-formulario-rascunho.test.tsx`).

---

### Task 1: `lib/eventos/`: rótulos, cronograma, itens, lista e leitura

**Files:**
- Create: `artifacts/app/src/lib/eventos/rotulos.ts`, `cronograma.ts`, `itens.ts`, `lista.ts`, `navegacao.ts`, `leitura.ts`, `use-eventos.ts`
- Test: `artifacts/app/src/lib/eventos/cronograma.test.ts`, `itens.test.ts`, `lista.test.ts` (com a navegação), `leitura.test.ts`

**Interfaces:**
- Consumes: `STATUS_DA_EDICAO`, `ROTULO_DO_STATUS`, `TIPOS_DE_MOMENTO`, `ROTULO_DO_MOMENTO`, `LIMITES`, `edicaoAberta`, `formatarReais`, `nomeComTamanho` de `@workspace/dominio`; `EdicaoView` (com o `id` de cada momento), `ItemDaEdicao`, `MomentoPrevisto` (o espelho do `MomentoPrevistoSchema` da parte 2, com o `id` opcional; o de `@workspace/dominio` não tem `id`), `StatusDaEdicao`, `TipoDeMomento` de `./tipos` (parte 2); `groupFamilies`, `variantLabel` de `../stock-variants`; `useLeituraDoPortal`, `useDocumentoDoPortal` de `../portal/leitura-do-portal`.
- Produces (`rotulos.ts`): `SELO_DO_STATUS: Record<StatusDaEdicao, string>` (o `ROTULO_DO_STATUS`, com `enviado: "Enviado à Dutelog"`); `ETAPAS_DA_EDICAO` (os sete status de `rascunho` a `fechado`) e `etapaDaEdicao(status): number | null` (`cancelado` → null); `ROTULO_CURTO_DO_MOMENTO: Record<TipoDeMomento, string>` = Coleta, Entrega, Montagem, Evento, Desmontagem, Retorno, Entrega de volta, Outro; `CAMPOS_DO_MOMENTO: Record<TipoDeMomento, { data: string; hora: string; ate: string | null; observacao: string }>` com os `aria-label` da prancha ("Data da coleta no cliente", "Hora da coleta no cliente", "Observação da coleta no cliente"; "Fim da montagem", "Fim do evento"; `ate` null em coleta, entrega, desmontagem, retorno e entrega de volta; o `outro`: "Data do outro momento", "Hora do outro momento", "Fim do outro momento", "Observação do outro momento") e `ROTULO_DO_OUTRO = "Rótulo do outro momento"`; `FILTROS_DA_LISTA = ["proximos", "em_andamento", "fechados", "todos"] as const`, `ROTULO_DO_FILTRO` = Próximos, Em andamento, Fechados, Todos.
- Produces (`cronograma.ts`): `type LinhaDoCronograma = { id: string | null; tipo: TipoDeMomento; rotulo: string; data: string; hora: string; ate: string; local: string; observacao: string }` (`id`: o do momento gravado, null na linha que ainda não foi gravada; `local`: sem coluna na tela, só guarda o `previsto.local` que a ficha da Armazenagem edita, parte 8); `linhasDoFormulario(cronograma: EdicaoView["cronograma"]): LinhaDoCronograma[]` (os sete tipos na ordem de `TIPOS_DE_MOMENTO`, preenchidos pelo `previsto` e com o `id` do momento, e os `outro` gravados, cada um com o seu `id`, mais uma linha `outro` vazia, com `id: null`, enquanto são menos de `LIMITES.outros`); `cronogramaDasLinhas(linhas): MomentoPrevisto[]` (linha sem `data` não vai; o `id` vai quando a linha o tem, e a linha nova vai sem a chave, nunca com `null`: o servidor funde o `patch.cronograma` por `id` e o momento gravado mantém o `id` e o `feito`; `ate`, `local`, `observacao` vazios viram null; `rotulo` só no `outro`); `formatarDia(data)` → "28/01"; `formatarInstante(iso)` → "24/11 09:40" (São Paulo); `periodoDaEdicao(cronograma: EdicaoView["cronograma"]): string | null` (do menor ao maior dia entre `entrega_no_local`, `montagem`, `evento`, `desmontagem`: "03/09/2026", "28 e 29/01/2027", "14 a 16/05/2026", "30/01 a 02/02/2027"; o nome que as partes 5 e 11 esperam); `rotuloDoPeriodo(cronograma, hoje): "Próxima edição" | "Última edição" | null` (o último dia ≥ `hoje` é a próxima); `linhaDoCronograma(cronograma): string | null` (montagem, evento e desmontagem, por " · ": previsto "Montagem 28/01 10:00", "Evento 29/01 08:00 às 20:00"; feito com `fim` "Montagem feita 24/11 09:40" e "Evento terminou …", só `inicio` "Evento começou 25/11 08:00").
- Produces (`itens.ts`): `type FamiliaDaEdicao = { chave: string; nome: string; codigo: string; categoria: string | null; tamanhos: Array<{ item: ItemDaEdicao; tamanho: string | null }>; pecas: number }`; `familiasDaEdicao(itens): FamiliaDaEdicao[]` (`groupFamilies` pelo `client_item_code`; o tamanho é `variantLabel` da variação ou `item.size`); `descricaoDaFamilia(f)` → "A.01.0809.002 · 4 tamanhos", só o código com um tamanho; `resumoDosItens(itens)` → "100 itens · 2.000 peças" ("1 item · 1 peça"); `type ProdutoDoEstoque = { sku: string; clientItemCode?: string | null; total: number; available: number; value: number; photoUrl?: string | null }` (`available`: o livre de hoje, o de `groupInventoryProducts`, como no legado); `valorDasPecas(itens, produtos: ProdutoDoEstoque[]): number`; `type FaltaDeSaldo = { item: ItemDaEdicao; disponivel: number; falta: number }`; `faltasDeSaldo(itens, produtos): FaltaDeSaldo[]` (na ordem dos itens, cada um cujo `quantity` passa do `available` do produto do mesmo `sku_code`; o item cujo SKU não está em `produtos` (o arquivado, fora do catálogo) conta como falta total, com `disponivel: 0` e `falta` igual ao `quantity`, como o `eventShortages` de hoje; a parte 5 a reaproveita no painel); `textoDasFaltas(faltas): string | null` → "Falta saldo em 2 itens: Polo Masculino Piquet Preto · GG (no evento 120, disponível 80), Caneca Térmica (no evento 50, disponível 0)" (o `nomeComTamanho` de cada item, só as três primeiras; "Falta saldo em 1 item: …" no singular; null sem falta); `resumoComValor(itens, produtos)` → "100 itens · 2.000 peças · R$ 86.400,00 em peças" (sem a parte do valor quando 0); `fotoDoItem(item, produtos): string | null`; `linhaDosItens(edicao: EdicaoView)` → "100 itens do estoque · 2.000 peças · coleta no cliente: 2.190 produtos", "18 itens do estoque · 64 peças · voltaram 63" (de `retornado` em diante, a soma de `voltou`); `linhaDoFechamento(edicao, preco: PrecoDaEdicao | null): string | null` → "Preço fechado R$ 12.400,00 · 31 fotos"; `categoriasDosItens(itens): Array<{ categoria: string; itens: number }>`; `filtrarFamilias(familias, { busca, categoria })`; `ordenarFamilias(familias, ordem: "estoque" | "nome", produtos)` (`estoque`: a ordem dos `produtos`); `ITENS_A_VISTA_NO_FORMULARIO = 5` (famílias), `ITENS_A_VISTA = 16`, `PAGINA_DO_VER_MAIS = 30`; `janelaDeFamilias(familias, itensAVista): { familias; mostrando: number; proximos: number }` (famílias inteiras até passar de `itensAVista`); `textoDoMostrando(mostrando, total)` → "Mostrando 16 de 100 itens"; `textoDoVerMais(proximos)` → "Ver mais 30 itens"; `comQuantidade(itens, skuCode, quantidade): ItemDaEdicao[]` (0 tira o item); `semFamilia(itens, familia): ItemDaEdicao[]`; `type ItemLido = ItemDaEdicao & Partial<Pick<EdicaoView["itens"][number], "foi" | "voltou" | "avariadas" | "nao_voltaram" | "observacao">>` (o item como a leitura o entrega, com os cinco campos do registro, null pela `edicaoDaLeitura` até o fato acontecer, ou como a tela o monta, só com os seis de entrada: os dois cabem nele) e `type ItemDeEntrada = ItemDaEdicao` (os seis campos do `ItemDaEdicaoSchema`); `itemDeEntrada(item: ItemLido): ItemDeEntrada` (reduz o item aos seis campos de entrada, `sku_code`, `client_item_code`, `product_name`, `size`, `category` e `quantity`, porque o `ItemDaEdicaoSchema` é `.strict()` e recusa a chave desconhecida, mesmo nula; copia os seis como vieram, com o `client_item_code`, o `size` e a `category` ausentes em null, nunca `undefined`; `patchDoFormulario` (T3) passa todo `patch.itens` por ela, e as partes 5, em `useGravacaoDosItens`, e 11, na nova edição a partir de outra, usam a mesma, sem redução própria).
- Produces (`navegacao.ts`): `ROTA_EVENTOS = "/portal/eventos"`, `ROTA_NOVO_EVENTO = "/portal/eventos/novo"`, `hrefDaEdicao(id): string` → `/portal/eventos/edicao?id=<id>`, `idDaEdicaoNaBusca(busca: string): string | null` (o `?id=`), `eventoDaBusca(busca): string | null` (o `?evento=` do novo), `hrefDoEstoqueDoEvento(id)` → `/portal/estoque?evento=<id>`, `hrefDoNovoDoEvento(eventId)` → `/portal/eventos/novo?evento=<eventId>`.
- Produces (`lista.ts`): `type CartaoDoEvento = { evento: EventoView; atual: EdicaoView; anteriores: EdicaoView[]; quando: { texto: string; rotulo: "Próxima edição" | "Última edição" | null } | null; local: string | null; cronograma: string | null; itens: string; fechamento: string | null; selo: string; etapa: number | null; acoes: { abrir: boolean; continuar: boolean; excluirRascunho: boolean; novaEdicaoAPartirDe: string | null } }`; `cartoesDaLista(eventos: EventoView[], edicoes: EdicaoView[], precos: PrecoDaEdicao[], hoje: string): CartaoDoEvento[]` (um por evento `active` com edição; `atual` é a aberta ou a mais recente; `anteriores` por `label`; `abrir` fora do `rascunho`, `continuar` e `excluirRascunho` só nele; `novaEdicaoAPartirDe` = o `label` da atual quando nenhuma edição está aberta; a ordem: as próximas pelo dia, as em andamento, depois as outras do dia mais recente ao mais antigo, e o nome); `filtrarCartoes(cartoes, filtro, busca)` (`proximos`: rascunho a separado; `em_andamento`: no_evento e retornado; `fechados`: fechado e cancelado; a busca pelo nome e pelo local); `contagemDosFiltros(cartoes): Record<FiltroDaLista, number>`.
- Produces (`leitura.ts`): `type EventoView = { id; customer_code; name; description: string | null; status: "active" | "archived"; editions_count: number; last_edition_id: string | null; last_edition_label: string | null }`; `type PrecoDaEdicao = { id; valor_declarado_cents: number | null; fechado_cents: number | null }`; `eventoDaLeitura(id, data): EventoView | null`, `edicaoDaLeitura(id, data): EdicaoView | null` (o contrato de `viewDaEdicao` da parte 2: Timestamp → ISO, ausente → null, listas sempre listas; null sem `status` da lista), `precoDaLeitura(id, data): PrecoDaEdicao | null`; `consultaDasEdicoesDoCliente(db, code)` = `where customer_code == code` + `orderBy updated_at desc`; `consultaDosEventosDoCliente(db, code)` = `where customer_code == code`, `where status == "active"`, `orderBy name asc`; `consultaDosPrecosDoCliente(db, code)` = `where customer_code == code`; `referenciaDaEdicao(db, id)`.
- Produces (`use-eventos.ts`): `useEventosDoCliente(code, ligado)`, `useEdicoesDoCliente(code, ligado)`, `usePrecosDoCliente(code, ligado)` no molde de `useOsDoCliente` (`{ itens, erro, tentando, tentar, falta, lidaEm }`, chave `portal:client_event_editions:<code>`); `useEdicaoDoEvento(id: string | null): { edicao: EdicaoView | null | undefined; erro; tentando; tentar; falta; lidaEm }` por `useDocumentoDoPortal` (`undefined` lendo, `null` sem documento ou de outro cliente; o nome que a parte 5 espera, ao vivo, sem chave do react-query: a escuta entrega a própria escrita).

- [ ] **Step 1: Write the failing tests**

Os quatro arquivos, com a edição da Necton como dado (sete momentos, 100
itens, coleta de 2.190):

```ts
// cronograma.test.ts
it("periodoDaEdicao: 28 e 29/01/2027, 14 a 16/05/2026, 03/09/2026, 30/01 a 02/02/2027, null sem montagem nem evento; rotuloDoPeriodo: Próxima e Última edição", ...)
it("linhaDoCronograma: 'Montagem 28/01 10:00 · Evento 29/01 08:00 às 20:00 · Desmontagem 29/01 20:00' e, com o feito, 'Montagem feita 24/11 09:40 · Evento começou 25/11 08:00 · Desmontagem 25/11 18:00'", ...)
it("linhasDoFormulario dá os sete tipos na ordem, com o id e o local do momento gravado, e uma linha outro vazia com id null; cronogramaDasLinhas pula a linha sem data, manda o id só na linha que o tem (a nova vai sem a chave) e null em ate, local e observacao vazios", ...)
// itens.test.ts
it("familiasDaEdicao agrupa A.01.0809.002.P/M/G/GG numa família de 700 peças com 'A.01.0809.002 · 4 tamanhos', e MAT-021 fica só com o código", ...)
it("resumoComValor: '100 itens · 2.000 peças · R$ 86.400,00 em peças'; sem produto com valor, só '100 itens · 2.000 peças'", ...)
it("janelaDeFamilias(16) mostra famílias inteiras, 'Mostrando 16 de 100 itens' e 'Ver mais 30 itens'; a última página não tem próximos", ...)
it("comQuantidade com 0 tira o item; semFamilia tira os quatro tamanhos", ...)
it("linhaDosItens: coleta antes do retorno, 'voltaram 63' depois; linhaDoFechamento só com fechado_cents", ...)
it("faltasDeSaldo: o GG de 120 com 80 livres falta 40, e o item cujo SKU não está em produtos falta inteiro (disponível 0, falta igual à quantidade no evento); textoDasFaltas dá só as três primeiras, com 'no evento X, disponível Y', '1 item' no singular e null sem falta", ...)
it("itemDeEntrada: o item lido, com foi, voltou, avariadas, nao_voltaram e observacao (nulos ou não), sai só com sku_code, client_item_code, product_name, size, category e quantity; o da tela sem size sai com size null, e nenhuma chave fica undefined", ...)
// lista.test.ts
it("cartoesDaLista: a aberta é a atual, as anteriores por label, 'Nova edição a partir de 2026' só sem edição aberta; abrir fora do rascunho, continuar e excluirRascunho só nele", ...)
it("a última edição cancelada: selo 'Cancelado', etapa null e a nova edição oferecida", ...)
it("filtros: Próximos 2, Em andamento 1, Fechados 3, Todos 6; a busca acha pelo local", ...)
it("navegação: hrefDaEdicao('ced_1') e idDaEdicaoNaBusca('?id=ced_1') se desfazem; eventoDaBusca lê ?evento=", ...)
// leitura.test.ts
it("edicaoDaLeitura converte Timestamp em ISO, listas ausentes em [] e recusa sem status; eventoDaLeitura recusa sem name", ...)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/cronograma.test.ts src/lib/eventos/itens.test.ts src/lib/eventos/lista.test.ts src/lib/eventos/leitura.test.ts`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: Implement the six files**

Sem React fora de `use-eventos.ts`; as datas por texto (`AAAA-MM-DD`) e
`Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" })` nos
instantes; `formatarReais` para o dinheiro; nenhum `Date` sem `hoje` dado.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, e `cd C:\DEV\Dute; corepack pnpm run typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos
git commit -m "feat(app): as regras do portal dos Eventos: rótulos, cronograma, itens, lista e leitura"
```

### Task 2: a lista `/portal/eventos`

**Files:**
- Modify: `artifacts/app/src/pages/client/eventos.tsx` → `git mv` para `pages/client/eventos-modelos.tsx` (`ClienteEventos` vira `ClienteEventosModelos`; `EventEditDialog` fica; o cabeçalho diz que é o legado até a parte 12); os três testes `eventos-carregando`, `eventos-editar`, `eventos-excluir.test.tsx` → `eventos-modelos-*.test.tsx`, com o import `./eventos-modelos`
- Modify: `artifacts/app/src/pages/client/index.ts` (exporta `ClienteEventosModelos` também)
- Create: `artifacts/app/src/pages/client/eventos.tsx` (a lista nova)
- Test: `artifacts/app/src/pages/client/eventos.test.tsx`

**Interfaces:**
- Consumes: T1; `ClientDataBoundary`, `ClientModuleShell`, `getInventoryItems` de `./shared`; `Chip` (`aria-pressed`, o filtro de lista), `CarregandoNaRegiao`, `FalhaAoVivo`, `BotaoDeAcao`; `EVENTOS_LIBERADO` (parte 1); `useAppUser` (`user.publicMetadata.customer_code`), `useOperationProfile` e `leiturasDoPortal` (T6 dá `eventos`).
- Produces: `type ListaDeEventosViewProps = { estado: "carregando" | "erro" | "pronto"; leitura: LeituraAoVivoNaTela; cartoes: CartaoDoEvento[]; contagens: Record<FiltroDaLista, number>; filtro: FiltroDaLista; busca: string; excluindo: string | null; acoes: { filtrar(f); buscar(texto); novo(); continuar(id); excluir(cartao); novaEdicao(cartao) } }`; `ListaDeEventosView(props)`; `ListaDeEventos()` (a página com os hooks); `ClienteEventos()` (nesta tarefa, só a lista; T7 põe a liberação). O cartão: `h2` com o nome, o selo (`SELO_DO_STATUS`), `quando.rotulo` e `quando.texto`, "<local> · <endereço>", a linha do cronograma, a dos itens e a do fechamento, as sete etapas num `<ol aria-label="Etapas da edição">` (fora de `cancelado`), o rodapé "Edições:" com os `label` ("2025 · 2026", "(esta)" na atual; o `label` de cada edição anterior é link para `hrefDaEdicao(id)` dela) e as ações: "Abrir" (→ `hrefDaEdicao(atual.id)`; o "Ver edição" da spec, com o texto da prancha) fora do rascunho; "Continuar" (→ `hrefDaEdicao(id)`) e "Excluir rascunho" no rascunho; "Nova edição a partir de <label>" (→ `hrefDoNovoDoEvento(event_id)`; a parte 11 troca o `href` pela cópia). Até a parte 11, "Abrir" e os `label` levam a `edicao?id=`, que `ClienteEventoEdicao` (T3) devolve à lista fora do rascunho. O topo: "Novo evento" (→ `/portal/eventos/novo`), um `Chip` por filtro com `count` "· N" (os textos "Próximos" e "· 2", como a prancha), a busca (`aria-label="Buscar evento ou local"`). O fim: o cartão tracejado "Criar outro evento" (ou "Nenhum evento ainda", só com a leitura feita) com "Novo evento".

- [ ] **Step 1: Write the failing test**

`eventos.test.tsx` (`renderToStaticMarkup` da view, como `servicos-view.test.tsx`):

```ts
const TEXTOS = ["Eventos", "O que vai para cada evento, como a Dutelog leva, monta e traz de volta, e o registro de cada edição.", "Novo evento",
  "Próximos", "Em andamento", "Fechados", "Todos", /^· \d+$/, "B2B Conference Necton", "Enviado à Dutelog", "Próxima edição", "28 e 29/01/2027",
  "Hotel Unique · Av. Brigadeiro Luís Antônio, 4700", "Montagem 28/01 10:00 · Evento 29/01 08:00 às 20:00 · Desmontagem 29/01 20:00",
  "100 itens do estoque · 2.000 peças · coleta no cliente: 2.190 produtos", ...ETAPAS_DA_EDICAO.map((s) => ROTULO_DO_STATUS[s]), "Edições:", "2027", "(esta)",
  "Feira de Investimentos", "Fechado", "Última edição", "14 a 16/05/2026", "18 itens do estoque · 64 peças · voltaram 63", "Preço fechado R$ 12.400,00 · 31 fotos",
  "2025", "·", "2026", "Abrir", "Nova edição a partir de 2026", "Rascunho", "Continuar", "Excluir rascunho", "Criar outro evento"];
it("a lista pronta: só os textos da prancha, e sem violação do axe", async () => {
  const html = renderToStaticMarkup(<Router><ListaDeEventosView {...props()} /></Router>);
  expect(textosForaDaLista(html, TEXTOS)).toEqual([]);
  expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  expect(html).toContain('aria-label="Buscar evento ou local"');
  expect(html).toContain('aria-label="Etapas da edição"');
});
it("lendo: o título e, na região, 'Carregando eventos…'; nunca 'Nenhum evento ainda' antes de ler", ...)
it("o rascunho tem Continuar e Excluir rascunho e não tem Abrir; a enviada tem Abrir, com o href /portal/eventos/edicao?id=<id>, e não tem Continuar; a fechada tem Abrir e Nova edição a partir de 2026; o label 2025 da Feira leva à edição de 2025", ...)
it("o filtro Em andamento deixa só o Workshop de líderes; a busca 'Unique' deixa só a Necton", ...)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/pages/client/eventos.test.tsx src/pages/client/eventos-modelos-carregando.test.tsx`
Expected: FAIL (a view não existe; o legado ainda não foi movido).

- [ ] **Step 3: Move the legacy and implement the list**

`git mv` primeiro. A página: as três leituras com `ligado =
Boolean(leituras?.eventos)`; `estado` "carregando" enquanto alguma é `null`
sem erro; os produtos do `overview` só para a foto e o valor. "Excluir
rascunho" chama `acoes.excluir` (T3 liga a confirmação).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/pages/client/eventos.test.tsx src/pages/client/eventos-modelos-carregando.test.tsx src/pages/client/eventos-modelos-editar.test.tsx src/pages/client/eventos-modelos-excluir.test.tsx`
Expected: PASS nos quatro.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/pages/client/eventos.tsx artifacts/app/src/pages/client/eventos-modelos.tsx artifacts/app/src/pages/client/eventos-modelos-carregando.test.tsx artifacts/app/src/pages/client/eventos-modelos-editar.test.tsx artifacts/app/src/pages/client/eventos-modelos-excluir.test.tsx artifacts/app/src/pages/client/eventos.test.tsx artifacts/app/src/pages/client/index.ts
git commit -m "feat(app): a lista dos Eventos do portal, com as edições de cada evento"
```

### Task 3: o formulário (novo e rascunho): nascimento, autosave, envio e exclusão

**Files:**
- Create: `artifacts/app/src/lib/eventos/formulario.ts`
- Create: `artifacts/app/src/pages/client/evento-formulario.tsx`
- Modify: `artifacts/app/src/pages/client/eventos.tsx` (a confirmação de "Excluir rascunho")
- Test: `artifacts/app/src/lib/eventos/formulario.test.ts`, `artifacts/app/src/pages/client/evento-formulario.test.tsx` (a view), `evento-formulario-rascunho.test.tsx` (jsdom), `eventos-excluir-rascunho.test.tsx` (jsdom)

**Interfaces:**
- Consumes: T1; `salvarEdicao`, `enviarEdicao`, `cancelarEdicao` de `../wms/eventos` e `CriarEdicao`, `PatchDaEdicao`, `ConteudoDaEdicao` (com `evento?: { name?: string; description?: string | null }`, o nome e a descrição depois do nascimento) de `./tipos` (parte 2); `problemaDoCronograma`, `LIMITES`; `novaChave` de `../operacao/api`; `horaDaLeitura` de `../conexao`; `Confirmacao`, `BotaoDeAcao`, `Dialog`, `Input`, `Textarea`, `Label`, `useToast`; `useLocation`, `useSearch` (wouter).
- Produces (`formulario.ts`): `type FormularioDaEdicao = { nome: string; eventoId: string | null; descricao: string; onde: { local; endereco; contatoNome; contatoTelefone }; cronograma: LinhaDoCronograma[]; itens: ItemDaEdicao[]; coleta: { onde: string; quantidade: string; valorDeclarado: string }; observacoes: string }`; `formularioVazio()`; `formularioDaEdicao(edicao: EdicaoView, evento: EventoView | null)` (o nome e a descrição da capa, `evento.name` e `evento.description`, que moram em `client_events`, e não o `event_name` da edição, que fica para trás quando outra edição aberta do mesmo evento o renomeia; sem a capa, o `event_name` e a descrição vazia); `patchDoFormulario(form, gravado: { nome: string; descricao: string | null }): ConteudoDaEdicao` (trim; vazio → null; `evento` leva só o campo que mudou em relação à capa, com o nome e a descrição do formulário, que continuam editáveis no rascunho: `gravado` é o `name` e a `description` da capa na adoção do documento vivo ou na última gravação, não a capa ao vivo, e vão `{ name }` quando o nome (não vazio) difere de `gravado.nome`, `{ description }` quando a descrição difere de `gravado.descricao`, os dois quando os dois mudaram e nenhum `evento` quando nada mudou, sem `name` quando o nome está vazio; assim duas edições abertas do mesmo evento não desfazem a renomeação uma da outra (o servidor grava `client_events` só quando o valor muda, e o nome também no `event_name` desta edição; as edições anteriores guardam o nome que tinham, como história); `cronograma` por `cronogramaDasLinhas`, com o `id` e o `local` de cada momento gravado; `itens` por `itemDeEntrada` (T1), cada item só com os seis campos de entrada (o item lido traz também `foi`, `voltou`, `avariadas`, `nao_voltaram` e `observacao`, e o `ItemDaEdicaoSchema` é `.strict()`); `coleta` só com `onde`, `quantidade` e `valor_declarado_cents`, sem observação; `coleta.quantidade` inteiro, 0 sem coleta; `valor_declarado_cents` dos reais digitados ou null; sem `label`: o servidor dá o padrão); `criacaoDoFormulario(form, chave, eventId: string | null): CriarEdicao` (`event_id` quando a pessoa escolheu um evento em "Edição de" ou veio por `?evento=`); `type CampoDoFormulario = "nome" | "onde.local" | "cronograma" | "itens" | "coleta" | "observacoes"`; `problemasDoFormulario(form, produtos: ProdutoDoEstoque[]): Partial<Record<CampoDoFormulario, string>>` ("Informe o nome do evento", "Informe o local", "Escolha ao menos um item ou informe a coleta no cliente", o `problemaDoCronograma(cronogramaDasLinhas(form.cronograma), { comItensDoEstoque: itens.length > 0, comColeta: quantidade > 0 })` em `cronograma` e, com itens, `textoDasFaltas(faltasDeSaldo(form.itens, produtos))` em `itens`: a falta de saldo antes do envio); `campoDaMensagem(mensagem: string): CampoDoFormulario | null` (a frase do servidor para o campo, na ordem: /já tem registro e não sai do cronograma|observação de .* passa de|momento|Informe a data/ → `cronograma`, antes de /local/, porque "Entrega no local já tem registro e não sai do cronograma" é do cronograma; /local|endereço|contato|telefone/ → `onde.local`; /nome do evento/ → `nome`; /Saldo insuficiente|itens|quantidade/ → `itens`; /coleta/ → `coleta`; /observações/ → `observacoes`); `ATRASO_DO_AUTOSAVE_MS = 1000`; `resumoDaEdicao(form, produtos, hoje): { nome; dias: string | null; local: string | null; estoque: string; coleta: string | null; entrega: string | null; retorno: string | null; pedido: string | null }` ("2.190 produtos", "28/01 08:30", "Pedido PED com os 100 itens").
- Produces (`evento-formulario.tsx`): `ClienteEventoFormulario({ id }: { id: string | null })` (o formulário: novo com `null`, o rascunho com o id; a parte 11 o reaproveita), `ClienteEventoNovo()` (`/portal/eventos/novo`, com `eventoDaBusca` para o "Edição de"), `ClienteEventoEdicao()` (`/portal/eventos/edicao?id=`, por `idDaEdicaoNaBusca` e `useEdicaoDoEvento`; status fora de `rascunho`, ou `null` (apagada, ou de outro cliente) → `Redirect` a `ROTA_EVENTOS`; `erro` → `ErroNaLeitura mensagem="Não foi possível carregar a edição."` com a nova tentativa; a parte 11 muda só o ramo fora de `rascunho`, que passa a renderizar `<ClienteEventoRegistrado id={id} />` no lugar do `Redirect`, e o `null` continua indo à lista: a rota, o `App.tsx` e o `index.ts` desta parte não mudam para isso), `FormularioDaEdicaoView(props: FormularioDaEdicaoViewProps)` e o hook `useRascunhoDaEdicao({ id, eventoId, customerCode, produtos }): { form; mudar(campo, valor); edicao: EdicaoView | null; salvoAs: string | null; salvando: boolean; erros: Partial<Record<CampoDoFormulario, string>>; salvarAgora(); enviar(); enviando: boolean }`. O nascimento: com `form.nome.trim()` e a pessoa saindo do campo do nome ou mudando outro campo, `salvarEdicao(criacaoDoFormulario(form, chaveDaCriacao, eventoId))` (a chave nasce com a tela e repete na tentativa incerta); a resposta `{ id, edicao }` leva a `navigate("/portal/eventos/edicao?id=<id>", { replace: true })` e as mudanças que esperavam saem num `patch`. O autosave: cada `mudar` reinicia o relógio de `ATRASO_DO_AUTOSAVE_MS`; uma gravação por vez, a seguinte com o formulário mais novo; o sucesso guarda `edicao` e, no `gravado` do `patchDoFormulario` seguinte, o campo do evento que o `patch.evento` levou (no nascimento, o nome e a descrição da criação ou, com `event_id`, os da capa escolhida; na adoção do documento vivo, o `name` e a `description` da capa) e `salvoAs = horaDaLeitura(Date.now())` ("Salvo 14:32" no cabeçalho); `failed-precondition` com "A edição mudou em outra aba" → toast com a frase e o formulário refeito do documento vivo (`useEdicaoDoEvento`); `failed-precondition` com /já tem registro e não sai do cronograma/ (o momento que ficou sem data e tem `feito`, foto ou documento ligado; no rascunho, o documento que a Dutelog anexou com o `momento_id` dele) → como o `invalid-argument`, a frase em `erros.cronograma`, sem o toast, e a linha desse momento volta do documento vivo (a do mesmo `id`, com o `previsto` gravado; as outras ficam como a pessoa as deixou), para a gravação seguinte não repetir a recusa; `invalid-argument` → a frase em `erros[campoDaMensagem(frase)]`; outro erro → toast "Rascunho não salvo" e a próxima mudança tenta de novo. "Salvar rascunho" grava na hora (`BotaoDeAcao`, "Salvando…", "Salvo"). "Enviar para a Dutelog": `problemasDoFormulario(form, produtos)` nos campos e para (com falta de saldo, a frase fica em `erros.itens` e `enviarEdicao` não é chamado); senão grava o que espera e chama `enviarEdicao({ id, expected_edicao, idempotency_key: chaveDoEnvio })` ("Enviando…"); o sucesso leva a `/portal/eventos` com o toast "Edição enviada à Dutelog"; a recusa vai ao campo ou ao toast (o "Saldo insuficiente para o SKU …" do servidor, quando o saldo mudou depois da leitura, cai em `itens` por `campoDaMensagem`). "Cancelar" volta à lista (o rascunho fica). "Edição de": `<select>` com "Evento novo" e os eventos ativos (`useEventosDoCliente`); escolhido um, o nome e a descrição vêm dele e a criação leva `event_id`. Sob "O que vai · do estoque Dutelog", quando falta saldo, a linha `textoDasFaltas(faltasDeSaldo(form.itens, produtos))` (os produtos do `overview`, como na T2, com o `available`; as três primeiras faltas, e as outras no diálogo, que as marca; quando `erros.itens` é a mesma frase, ela aparece uma vez, como o erro do campo). "Ver os N itens" abre o diálogo da T4; "Escolher no Estoque" é link a `hrefDoEstoqueDoEvento(id)` (travado antes do nascimento). "Excluir rascunho" na lista: `Confirmacao` ("Excluir o rascunho de <nome>?", "Excluir", "Excluindo…", `perigo`) → `cancelarEdicao({ id, idempotency_key })`; fecha só no sucesso (toast "Rascunho excluído"); na falha fica, com o toast "Não foi possível excluir".

- [ ] **Step 1: Write the failing tests**

`formulario.test.ts`: `patchDoFormulario` da Necton, com o `gravado` igual ao formulário, dá `coleta.quantidade: 2190`, `valor_declarado_cents: 10_000_000`, a coleta sem observação, o `id` e o `local` dos momentos gravados, nenhum `undefined`, nenhum `evento` e cada item de `patch.itens` só com as seis chaves de entrada (o `foi` e os outros do item lido, nulos, não vão); com a descrição mudada, `evento: { description: <a nova> }`, sem `name`; com o nome mudado, `evento: { name: <o novo> }`, sem `description`; `formularioDaEdicao(edicao, evento)` traz o nome e a descrição da capa (com o `event_name` da edição diferente do `evento.name`, o nome do formulário é o da capa); `problemasDoFormulario`: vazio → `{ nome: "Informe o nome do evento" }`, sem local → "Informe o local", sem itens nem coleta → a frase da escolha, com itens e sem entrega → `cronograma: "Informe a data e a hora da entrega no local"`, com o GG acima do disponível → `itens: "Falta saldo em 1 item: …"`; `campoDaMensagem("A observação de Montagem passa de 300 caracteres") === "cronograma"`, `campoDaMensagem("Entrega no local já tem registro e não sai do cronograma") === "cronograma"` e a frase do servidor ("Saldo insuficiente para o SKU <sku>. Disponível: 80; solicitado: 120.") dá `itens`; `criacaoDoFormulario` com `eventId` leva `event_id` e sem ele leva `name`.

`evento-formulario.test.tsx` (`renderToStaticMarkup`): a lista dos textos de `EventosPortalNovo.dc.html`: "Novo evento", "O plano da edição. Salvar guarda o rascunho; Enviar para a Dutelog cria o pedido com os itens.", /^Salvo \d{2}:\d{2}$/, "O evento", "Nome do evento", "*", "Edição de", "Evento novo", "Descrição", "Onde", "Local", "Endereço", "Contato no local", "Telefone do contato", "Layout do evento", "Anexar layout", "Cronograma", "Momento", "Data", "Hora", "Até", "Observação", os oito `ROTULO_DO_MOMENTO`, "—", "O que vai · do estoque Dutelog", "100 itens · 2.000 peças · R$ 86.400,00 em peças", "Ver os 100 itens", "Escolher no Estoque", as cinco famílias (`descricaoDaFamilia`, tamanhos, totais), "Mostrando 12 de 100 itens", "O que vai · coleta no cliente", "Onde buscar", "Quantidade", "Valor declarado", "Planilha dos produtos", "Anexar planilha", "Observações para a Dutelog", "O que mais a Dutelog precisa saber", "Cancelar", "Salvar rascunho", "Enviar para a Dutelog", "Resumo da edição", "Edição", "Do estoque Dutelog", "Coleta no cliente", "Entrega no local", "Retorno ao estoque", "Ao enviar", "Pedido PED com os 100 itens", "A Dutelog responde com", "Preço fechado"; `aria-label="Voltar a Eventos"` e os `CAMPOS_DO_MOMENTO` nos inputs; `axe` sem violação; e, com o GG da primeira família acima do disponível, a linha `/^Falta saldo em 1 item: /` sob a seção, também na lista dos textos e sem violação do `axe`.

`evento-formulario-rascunho.test.tsx` (jsdom, `vi.useFakeTimers()`, `vi.mock("@/lib/wms/eventos")` guardando as chamadas, `vi.mock("@/lib/eventos/use-eventos")`):

```ts
it("nasce ao sair do nome: salvarEdicao com idempotency_key e name, e a rota vira edicao?id= sem entrada no histórico", ...)
it("a mesma chave repete na tentativa sem resposta; created: false não cria segunda rota", ...)
it("a mudança no local grava aos 1 000 ms com expected_edicao e os itens do documento vivo só com as seis chaves de entrada, e duas mudanças em 600 ms gravam uma vez", ...)
it("'A edição mudou em outra aba' refaz o formulário com o documento vivo e mostra a frase", ...)
it("'A observação de Montagem passa de 300 caracteres' aparece sob o cronograma", ...)
it("apagar a data da Montagem que tem um documento da Dutelog ligado: 'Montagem já tem registro e não sai do cronograma' aparece sob o cronograma, sem o toast 'Rascunho não salvo'; a data da Montagem volta do documento vivo e a gravação seguinte leva a Montagem pelo id", ...)
it("Enviar sem a data do evento mostra 'Informe a data do evento' e não chama enviarEdicao; com tudo, chama e volta à lista", ...)
it("com o GG acima do disponível, 'Falta saldo em 1 item: …' aparece sob 'O que vai · do estoque Dutelog'; Enviar põe a frase em itens e não chama enviarEdicao; o 'Saldo insuficiente para o SKU …' do servidor cai no mesmo campo", ...)
it("mudar a Descrição depois do nascimento grava patch.evento só com a description, sem name; a mudança seguinte, no local, grava sem evento; com a capa renomeada noutra edição aberta do mesmo evento depois da adoção, a Descrição mudada grava ainda sem name, e a renomeação não se desfaz", ...)
```

`eventos-excluir-rascunho.test.tsx`: o molde de `eventos-modelos-excluir.test.tsx`, com `cancelarEdicao` falhando e depois valendo.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/formulario.test.ts src/pages/client/evento-formulario.test.tsx src/pages/client/evento-formulario-rascunho.test.tsx src/pages/client/eventos-excluir-rascunho.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `formulario.ts`, the page and the confirmation**

O formulário adota o documento vivo (a edição e a capa do evento dela, de
`useEventosDoCliente`, de onde vêm o nome e a descrição) só na primeira
leitura dos dois e depois do conflito (a escuta devolve a própria escrita,
que não pode apagar o que a pessoa digita); na recusa "<Rótulo> já tem
registro e não sai do cronograma", só a linha daquele momento volta dele;
os `maxLength` são os de `LIMITES`. O `local` de cada momento não tem coluna
aqui e volta no `patch` como veio (a ficha da Armazenagem o edita, parte 8);
a coleta não tem observação (o campo saiu da spec e do schema da parte 2);
os itens vão por `itemDeEntrada`, só com os seis campos de entrada; o nome e
a descrição do evento continuam editáveis no rascunho, por `patch.evento`,
que leva só o campo que mudou em relação à capa (o `gravado` de
`patchDoFormulario`), e o nome do formulário é o da capa, não o
`event_name` da edição: assim duas edições abertas do mesmo evento não
desfazem a renomeação uma da outra.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, e `cd C:\DEV\Dute; corepack pnpm run typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos/formulario.ts artifacts/app/src/lib/eventos/formulario.test.ts artifacts/app/src/pages/client/evento-formulario.tsx artifacts/app/src/pages/client/evento-formulario.test.tsx artifacts/app/src/pages/client/evento-formulario-rascunho.test.tsx artifacts/app/src/pages/client/eventos.tsx artifacts/app/src/pages/client/eventos-excluir-rascunho.test.tsx
git commit -m "feat(app): o formulário da edição do evento no portal: nasce, grava sozinho, envia e exclui"
```

### Task 4: o diálogo dos itens

**Files:**
- Create: `artifacts/app/src/pages/client/evento-itens-dialogo.tsx`
- Modify: `artifacts/app/src/pages/client/evento-formulario.tsx` (abre o diálogo e liga `onMudar` ao `mudar("itens", …)`)
- Test: `artifacts/app/src/pages/client/evento-itens-dialogo.test.tsx`

**Interfaces:**
- Consumes: T1 (`familiasDaEdicao`, `filtrarFamilias`, `ordenarFamilias`, `janelaDeFamilias`, `categoriasDosItens`, `comQuantidade`, `semFamilia`, `resumoComValor`, `fotoDoItem`, `faltasDeSaldo`, `textoDasFaltas`, `ITENS_A_VISTA`, `PAGINA_DO_VER_MAIS`); `Dialog`, `DialogContent`, `DialogTitle`, `Chip`, `Input`, `Button`.
- Produces: `ItensDoEventoDialogo({ edicao: EdicaoView; produtos?: ProdutoDoEstoque[]; onMudar(itens: ItemDaEdicao[]): void; onFechar(): void; onEscolherMais(): void })` (a assinatura que a parte 5 espera; quem abre renderiza ou não). O título "Itens do evento · <event_name>" e o resumo com valor; a busca (`aria-label="Buscar entre os N itens"`); os `Chip` "Todos · 100" e um por categoria ("Polo · 28"); a ordem num `<select aria-label="Ordem dos itens">` com "Como no Estoque" e "Nome: A-Z"; uma linha por família: a foto quando existe, o nome, `descricaoDaFamilia`, um `<input inputmode="numeric" aria-label="<nome> <tamanho>">` por tamanho (a mudança confirmada no blur ou no Enter chama `onMudar(comQuantidade(...))`; 0 tira o tamanho), o total "700" com "peças" ("peça" no 1), e "Tirar <nome> do evento" (`onMudar(semFamilia(...))`); com `produtos`, o campo de cada tamanho com falta (`faltasDeSaldo(edicao.itens, produtos)`) leva `aria-invalid="true"` e a linha da falta da T3 aparece sob o resumo (sem `produtos`, nada se marca); o rodapé da lista "Mostrando 16 de 100 itens" e "Ver mais 30 itens" (`janelaDeFamilias`, a janela cresce de `PAGINA_DO_VER_MAIS`); o rodapé do diálogo com "100 itens · 2.000 peças", "Escolher mais no Estoque" (`onEscolherMais`; o formulário navega a `hrefDoEstoqueDoEvento`) e "Pronto" (`onFechar`); o X com `aria-label="Fechar a lista de itens"`.

- [ ] **Step 1: Write the failing test**

`evento-itens-dialogo.test.tsx` (jsdom, os 100 itens da Necton em 40 famílias):

```ts
it("aberto: só os textos da prancha, e sem violação do axe", ...) // "Itens do evento · B2B Conference Necton", "100 itens · 2.000 peças · R$ 86.400,00 em peças", "Todos", "Polo", "Camiseta", "Brindes", "Móveis", /^· \d+$/, "Como no Estoque", "Nome: A-Z", as famílias à vista, os tamanhos, "peças", "peça", "Mostrando 16 de 100 itens", "Ver mais 30 itens", "100 itens · 2.000 peças", "Escolher mais no Estoque", "Pronto"
it("Ver mais 30 itens passa a 'Mostrando 46 de 100 itens'; no fim não há o botão", ...)
it("o filtro Polo deixa 28 itens e a busca 'Caneca' deixa uma família", ...)
it("mudar o GG para 0 chama onMudar sem o item e o total da família vai a 620; Tirar … do evento chama sem os quatro tamanhos", ...)
it("com o GG acima do disponível, o campo dele tem aria-invalid e a linha 'Falta saldo em 1 item: …' aparece; sem produtos, nenhum campo marcado", ...)
it("Pronto chama onFechar, Escolher mais no Estoque chama onEscolherMais; o X tem 'Fechar a lista de itens'", ...)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/pages/client/evento-itens-dialogo.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the dialog and open it from the form**

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/pages/client/evento-itens-dialogo.test.tsx src/pages/client/evento-formulario.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/pages/client/evento-itens-dialogo.tsx artifacts/app/src/pages/client/evento-itens-dialogo.test.tsx artifacts/app/src/pages/client/evento-formulario.tsx
git commit -m "feat(app): o diálogo dos itens do evento, por família e tamanho, com busca e Ver mais"
```

### Task 5: os anexos no formulário

**Files:**
- Create: `artifacts/app/src/lib/eventos/anexos.ts`, `artifacts/app/src/lib/eventos/enviar-anexo.ts`
- Modify: `artifacts/app/src/pages/client/evento-formulario.tsx`
- Test: `artifacts/app/src/lib/eventos/anexos.test.ts`, `artifacts/app/src/pages/client/evento-formulario-anexos.test.tsx`

**Interfaces:**
- Consumes (parte 3): `anexarDocumento(entrada: { edition_id; customer_code?; arquivo; nome; momento_id?; idempotency_key })` e `tirarDocumento(entrada: { edition_id; customer_code?; documento_id; idempotency_key })` de `../wms/eventos`; `nomeDoArquivo("an", tipo)`, `caminhoDoArquivoDaEdicao("anexo", code, editionId, arquivo)`, `problemaDoArquivoDaEdicao(arquivo, "documento")` ("Use PDF, imagem ou planilha (.xlsx)." / "O documento passa de 10 MB.") e `TAMANHO_DO_DOCUMENTO` de `./arquivos`; o tipo `DocumentoDaEdicao` de `./tipos` (a parte 3 o espelha ali, com `OrigemDoDocumento` e `FotoDaEdicao`). Do repositório: `compactarFoto`, `enviarComProgresso` (`../envio-de-fotos`), `firebaseStorage`, `fileSize` (`../portal-documents`), `LIMITES.documentos`, `novaChave`.
- Produces (`anexos.ts`): `problemaDoAnexo(arquivo: { name; type; size }, documentos: number): string | null` ("<nome>: <problemaDoArquivoDaEdicao>" e, com `documentos >= LIMITES.documentos`, "A edição já tem 20 documentos.", a frase do servidor); `ehPlanilha(documento: DocumentoDaEdicao)` (`tipo` da planilha); `linhaDoDocumento(documento)` → "layout-necton-2027.pdf · 1,2 MB" (`nome · fileSize(tamanho)`); `documentosDoCliente(edicao): { layout: DocumentoDaEdicao[]; planilhas: DocumentoDaEdicao[] }` (só `origem: "cliente"`).
- Produces (`enviar-anexo.ts`): `enviarAnexoDoEvento(code: string, editionId: string, arquivo: File, aoProgredir?: (fracao: number) => void): Promise<{ documento_id: string }>`: `nomeDoArquivo("an", arquivo.type)`, `compactarFoto(arquivo, { manterTipo: true })`, `enviarComProgresso(ref(firebaseStorage, caminhoDoArquivoDaEdicao("anexo", code, editionId, nome)), …, { contentType })` (o `storage/unauthorized` do mesmo nome já subido é ignorado, como `enviarSolicitacao`), depois `anexarDocumento({ edition_id: editionId, arquivo: nome, nome: arquivo.name.trim().slice(0, 120), idempotency_key: novaChave() })` e devolve `documento.id`.
- No formulário: "Layout do evento" lista `documentosDoCliente(edicao).layout` e "Planilha dos produtos", as planilhas, cada um com `linhaDoDocumento` e "Tirar <nome>" (`tirarDocumento({ edition_id, documento_id, idempotency_key })`); "Anexar layout" e "Anexar planilha" abrem o `<input type="file">` (`accept` dos tipos; a planilha só `.xlsx`), travados antes do nascimento; o problema sai sob o botão; enquanto sobe, o `BotaoDeAcao` diz "Enviando…".

- [ ] **Step 1: Write the failing tests**

`anexos.test.ts`: `problemaDoAnexo` de 10 MiB passa, de 10 MiB + 1 byte dá "produtos.xlsx: O documento passa de 10 MB.", `.docx` dá "…: Use PDF, imagem ou planilha (.xlsx).", 20 documentos recusam o 21.º com "A edição já tem 20 documentos."; `documentosDoCliente` separa o PDF da planilha e ignora `origem: "dutelog"`; `linhaDoDocumento` dá "layout-necton-2027.pdf · 1,2 MB".

`evento-formulario-anexos.test.tsx` (jsdom, `vi.mock` de `@/lib/eventos/enviar-anexo` e `@/lib/wms/eventos`): escolher o PDF chama `enviarAnexoDoEvento(code, id, arquivo)`; "layout-necton-2027.pdf · 1,2 MB" vem do documento vivo; "Tirar layout-necton-2027.pdf" chama `tirarDocumento({ edition_id, documento_id, idempotency_key })`; a planilha de 11 MB mostra a frase e não chama nada; antes do nascimento os dois botões ficam travados.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/anexos.test.ts src/pages/client/evento-formulario-anexos.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the two files and wire the form**

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, e `npx vitest run src/pages/client/evento-formulario.test.tsx` (a lista dos textos ganha as linhas dos documentos).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos/anexos.ts artifacts/app/src/lib/eventos/anexos.test.ts artifacts/app/src/lib/eventos/enviar-anexo.ts artifacts/app/src/pages/client/evento-formulario.tsx artifacts/app/src/pages/client/evento-formulario-anexos.test.tsx
git commit -m "feat(app): o layout e a planilha anexados à edição do evento pelo portal"
```

### Task 6: rotas, `ROUTE_ACCESS`, títulos, `realtime-sync`, `CONSULTAS_DAS_TELAS`

**Files:**
- Modify: `artifacts/app/src/App.tsx` (dois `telaSobDemanda("pages/client", …)` para `ClienteEventoNovo` e `ClienteEventoEdicao`, e as rotas logo depois de `protectedRoute("/portal/eventos", ClienteEventos)`, linha 439)
- Modify: `artifacts/app/src/pages/client/index.ts` (exporta `ClienteEventoNovo`, `ClienteEventoEdicao` e `ClienteEventoFormulario`)
- Modify: `artifacts/app/src/lib/modules.ts` (`MERGED_SCREEN_PATHS`, linha 914: `/portal/eventos/novo` e `/portal/eventos/edicao` com `CLIENT_ROLES`), `lib/modules.test.ts` (`ROUTE_ACCESS`, linhas 109 a 117, e o `it` de `portalModuleForPath`, linha 431)
- Modify: `artifacts/app/src/lib/document-title.ts` (`EXTRA_RULES`: `{ path: "/portal/eventos/novo", label: "Novo evento" }`, `{ path: "/portal/eventos/edicao", label: "Edição do evento" }`), `lib/document-title.test.ts` (duas linhas na tabela, linhas 58 a 65)
- Modify: `artifacts/app/src/lib/operations/index.ts` (`leiturasDoPortal` ganha `eventos: armazenagem`), `lib/operations/operations.test.ts` (linhas 220 a 222)
- Modify: `artifacts/app/src/lib/realtime-sync.tsx` (`CUSTOMER_AUTHORIZED_COLLECTIONS`: `client_events`, `client_event_editions`, `client_event_prices`, as três com `leitura: "eventos"`), `lib/realtime-sync.test.ts` (o caso "assina só o que o contrato abre", linha 123, com as três)
- Modify: `artifacts/app/src/lib/cloud-api-indices.test.ts` (um `it` novo)

**Interfaces:**
- Consumes: `consultaDasEdicoesDoCliente`, `consultaDosEventosDoCliente`, `consultaDosPrecosDoCliente` (T1); os índices da parte 1 (`client_event_editions` `customer_code` asc + `updated_at` desc; `client_events` `customer_code` asc + `status` asc + `name` asc).
- Produces: as rotas `/portal/eventos/novo` e `/portal/eventos/edicao` (só `cliente`, módulo `events`), os títulos "Dutelog | Novo evento" e "Dutelog | Edição do evento", `leiturasDoPortal(...).eventos`.

- [ ] **Step 1: Write the failing tests**

`modules.test.ts`: `["/portal/eventos/novo", ["cliente"]]`, `["/portal/eventos/edicao", ["cliente"]]` em `ROUTE_ACCESS` e `expect(portalModuleForPath("/portal/eventos/edicao?id=ced_1")).toBe("events")`. `document-title.test.ts`: as duas linhas. `operations.test.ts`: `eventos: true` com `["wms"]`, `false` nos outros dois. `realtime-sync.test.ts`: as três coleções na lista do caso 123. `cloud-api-indices.test.ts`:

```ts
it("Portal › Eventos: as edições, os eventos e os preços do cliente, ao vivo, têm índice", () => {
  const db = {} as Firestore;
  for (const consulta of [consultaDasEdicoesDoCliente(db, "Itau"), consultaDosEventosDoCliente(db, "Itau"), consultaDosPrecosDoCliente(db, "Itau")]) {
    expect(indiceQueFalta(consulta as unknown as Consulta)).toBeNull();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/modules.test.ts src/lib/document-title.test.ts src/lib/operations/operations.test.ts src/lib/realtime-sync.test.ts src/lib/cloud-api-indices.test.ts`
Expected: FAIL nos cinco (rotas sem papéis, títulos "Dutelog", `eventos` ausente, coleções não assinadas; o `it` novo passa de cara se os índices da parte 1 bastam: confira que ele roda).

- [ ] **Step 3: Implement**

As rotas no `App.tsx` já sob a liberação, como `/estoque/alertas`:
`...(EVENTOS_LIBERADO ? [protectedRoute("/portal/eventos/novo", ClienteEventoNovo), protectedRoute("/portal/eventos/edicao", ClienteEventoEdicao)] : [])`
(T7 trava a linha). Sem chave em `COLLECTION_QUERY_KEYS`: as telas leem ao vivo.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, e `cd C:\DEV\Dute; corepack pnpm run typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/App.tsx artifacts/app/src/pages/client/index.ts artifacts/app/src/lib/modules.ts artifacts/app/src/lib/modules.test.ts artifacts/app/src/lib/document-title.ts artifacts/app/src/lib/document-title.test.ts artifacts/app/src/lib/operations/index.ts artifacts/app/src/lib/operations/operations.test.ts artifacts/app/src/lib/realtime-sync.tsx artifacts/app/src/lib/realtime-sync.test.ts artifacts/app/src/lib/cloud-api-indices.test.ts
git commit -m "feat(app): as rotas, os títulos e as leituras do portal dos Eventos"
```

### Task 7: só com a liberação

**Files:**
- Modify: `artifacts/app/src/pages/client/eventos.tsx` (`ClienteEventos`)
- Modify: `artifacts/app/src/lib/platform-lists.test.ts` (um `it` no `describe` dos Eventos da parte 1)
- Test: `artifacts/app/src/pages/client/eventos-liberacao.test.tsx`

**Interfaces:**
- Consumes: `EVENTOS_LIBERADO` de `../../lib/liberacao` (parte 1); `ClienteEventosModelos` (T2).
- Produces: `ClienteEventos = () => (EVENTOS_LIBERADO ? <ListaDeEventos /> : <ClienteEventosModelos />)`, numa linha, a que a trava lê.

- [ ] **Step 1: Write the failing tests**

`eventos-liberacao.test.tsx` (jsdom; `vi.mock("@/lib/liberacao", () => ({ get EVENTOS_LIBERADO() { return estado.liberado; } }))`, o `ClientDataBoundary` e as leituras simulados como nos testes de T2): com `liberado = false`, a tela diz "Usar no pedido" e não "Novo evento"; com `true`, o contrário.

Em `platform-lists.test.ts`:

```ts
it("o portal só troca de Eventos com a liberação: a lista e as rotas do formulário", () => {
  expect(read("artifacts/app/src/pages/client/eventos.tsx")).toContain("EVENTOS_LIBERADO ? <ListaDeEventos /> : <ClienteEventosModelos />");
  expect(read("artifacts/app/src/App.tsx")).toContain('...(EVENTOS_LIBERADO ? [protectedRoute("/portal/eventos/novo", ClienteEventoNovo), protectedRoute("/portal/eventos/edicao", ClienteEventoEdicao)] : [])');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/pages/client/eventos-liberacao.test.tsx src/lib/platform-lists.test.ts`
Expected: FAIL (`ClienteEventos` ainda é só a lista).

- [ ] **Step 3: Implement the switch**

- [ ] **Step 4: Run the app suite once**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/pages/client src/lib/eventos src/lib/modules.test.ts src/lib/platform-lists.test.ts src/lib/carregando/trava.test.ts src/lib/theme-colors.test.ts src/lib/customer-literals.test.ts` e `cd C:\DEV\Dute; corepack pnpm run typecheck`.
Expected: PASS (sem `animate-spin`, "..." nem `outline-none` nas telas novas; nenhuma cor fixa).

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/pages/client/eventos.tsx artifacts/app/src/pages/client/eventos-liberacao.test.tsx artifacts/app/src/lib/platform-lists.test.ts
git commit -m "feat(app): o Eventos novo do portal só com a liberação; fora dela, o de hoje"
```

### Pronto quando

Contra o emulador com as partes 1 a 3 (o app com `.env.local` apontando
para ele): a cliente cria a edição da Necton com o nome, vê a rota virar
`edicao?id=`, preenche onde, os sete momentos, a coleta de 2.190 e a
observação longa, anexa o layout e a planilha, ajusta no diálogo os 100
itens que entraram por um `patch` semeado no emulador no rascunho já nascido
(`saveEventEditionTransaction`, como no teste da parte 2, com a página
relida; a escolha deles pela tela, "Escolher no Estoque", é da parte 5), vê
"Salvo 14:32", envia e a lista diz "Enviado à Dutelog", com "Abrir"; noutro
rascunho, exclui. O CI inteiro verde; no `dute-prod` nada muda, nem a rota
nova existe. O PR registra no índice o que mudou de nome. A linha "Falta
saldo em N itens: …" (sob "O que vai · do estoque Dutelog" e no diálogo,
com o `aria-invalid` no tamanho) não está nas pranchas: a sessão anexa ao PR
a foto desse estado e pede o OK do Leonardo antes do merge; aprovada, a foto
entra no PR em `docs/mockups/eventos-portal-novo/`, com uma linha na tabela
dos Eventos de `docs/mockups/README.md` (a tela, o arquivo e o que mostra,
como as fotos de `contagem-entrada/`), num commit próprio
(`git add docs/mockups/eventos-portal-novo docs/mockups/README.md`).
