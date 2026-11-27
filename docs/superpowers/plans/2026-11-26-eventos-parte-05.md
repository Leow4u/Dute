# Eventos · parte 5: o Estoque do portal no modo "montando o evento"

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a escolha dos itens da edição acontece no Estoque do portal, com
foto, tamanhos e saldo (decisão 4): `/portal/estoque?evento=<edition_id>`
abre o Estoque de sempre com a faixa do evento, "Adicionar ao evento" e
"Alterar no evento" nos cartões, o filtro "No evento" e o painel "Itens do
evento"; cada mudança grava `itens` pelo `saveEventEdition`. Com a
liberação, o carrinho perde o "Salvar como evento" e o `?evento=` deixa de
pré-preencher o pedido.

**Architecture:** tudo no app. As regras puras entram em
`lib/eventos/itens-do-estoque.ts`; a faixa, o painel e a gravação com atraso
em `pages/client/estoque-evento.tsx`; o `estoque.tsx` ganha o modo por uma
prop opcional nos componentes que já existem (`FamilyCard`, `StockList`,
`ProductDetailPanel`, `MarketplaceToolbar`, `StockBadge`, `filterProducts`),
sem segundo catálogo. A edição é lida ao vivo pela `useEdicaoDoEvento` da
parte 4 (`@/lib/eventos/use-eventos`; a escuta entrega a própria escrita,
sem cache do react-query a atualizar) e gravada pelo wrapper `salvarEdicao`
da parte 2, sempre com a lista inteira e o CAS `expected_edicao`. O legado
(`applyEvent`, "Salvar como evento", `useClientEvents`) fica no código até a
parte 12, só sem a liberação.

**Tech Stack:** React, wouter, react-query, vitest com jsdom e axe-core;
`@workspace/dominio` (`LIMITES`, `nomeComTamanho`).

**Spec:** `docs/superpowers/specs/2026-11-26-eventos-design.md`, seções "As
telas › Portal" (Estoque, modo "montando o evento"; Os itens do evento),
"Liberação por ambiente e o legado", "A edição, campo a campo" (`itens`),
"Os status e quem move cada um" (só `rascunho` muda itens), "As callables"
(`saveEventEdition`), "Limites e mensagens". Índice:
`docs/superpowers/plans/2026-11-26-eventos.md`. Prancha:
`docs/mockups/EventosPortalEstoque.dc.html` (os textos dela são os dos
testes); o diálogo da lista inteira é o da parte 4
(`EventosPortalItens.dc.html`).

## Global Constraints

As do índice. Nesta parte, ainda:

- Nenhuma callable, rota, título ou consulta nova: `/portal/estoque` já
  existe (`App.tsx` 438, `ROUTE_ACCESS`), o modo é o `?evento=`, e a edição
  é lida por id pela leitura da parte 4; nada muda em `CONSULTAS_DAS_TELAS`.
- O modo só abre com `EVENTOS_LIBERADO`, com a edição lida e em `rascunho`;
  fora disso o Estoque é o de sempre (a edição de outro cliente não chega:
  a regra nega, a leitura da parte 4 devolve `null` e a tela trata como não
  encontrada).
- O carrinho do pedido avulso não é lido nem gravado no modo ("os dois
  modos não se misturam na mesma visita"); o storage dele fica como estava.
- A quantidade no evento não é limitada pelo saldo (até `LIMITES.quantidade`):
  a prancha mostra 300 no evento com 284 disponíveis; a falta aparece no
  painel "Itens do evento", pela `textoDasFaltas(faltasDeSaldo(...))` da
  parte 4 (a mesma linha "Falta saldo em N itens: …" do formulário, que
  esta parte não remonta; o item cujo SKU não está nos produtos do Estoque
  conta como falta total, disponível 0), e no envio (partes 4 e 6). O
  limite de 100 itens é mostrado antes: o SKU novo numa edição com 100 fica
  bloqueado.
- Toda gravação manda `patch.itens` inteiro com `expected_edicao`, cada item
  reduzido aos seis campos de entrada pela `itemDeEntrada` da parte 4
  (`ItemDaEdicaoSchema` é `.strict()`, e o item lido de `edicao.itens` traz
  também `foi`, `voltou`, `avariadas`, `nao_voltaram` e `observacao`); o
  conflito ("A edição mudou em outra aba") só avisa e descarta o que
  esperava ser gravado: a leitura é ao vivo, o documento na tela já é o do
  servidor, e nada é relido nem invalidado. Uma gravação por vez: a
  seguinte espera a resposta da anterior e leva o `edicao` que ela devolveu
  (depois do conflito, o do documento vivo).
- Carregamento v2: `BotaoDeAcao` nas ações que gravam (reticências "…", nunca
  "..."), `CarregandoNaRegiao` enquanto a edição é lida e, quando a leitura
  falha, a falha na mesma região com "Tentar de novo" (nunca o toast de
  "Edição não encontrada", que é só da edição que não existe), o painel
  `ocupado` enquanto grava; nenhum `disabled` a 50%. Teste de espera com o
  estado chegando ou relógio falso, nunca tempo fixo real.
- Os testes fixam a liberação pelo `vi.mock("@/lib/liberacao", …)`
  (precedente `pages/client/servicos-envio.test.tsx` 25): nesta máquina o
  `.env.local` pode ligar `EVENTOS_LIBERADO` sozinho.

## Review Focus

1. A edição com 100 itens e um SKU novo: "Adicionar ao evento" fica
   `bloqueado` e nada chega ao servidor; o SKU que já é um dos 100 continua
   com "Alterar no evento" (T1, `limiteDosItensAtingido` é puro-testado, a
   ligação no cartão não).
2. O item da edição cujo SKU saiu do estoque (arquivado, zerado): a linha do
   painel mostra só o código, o contador e "Tirar do evento", e a linha da
   falta o conta como falta total (disponível 0, pela `faltasDeSaldo` da
   parte 4); a faixa e o rodapé contam `itens_total` e `pecas_total` do
   documento, não o estoque (T1).
3. O "Usar no pedido" do Eventos antigo com a liberação ligada
   (`?evento=<id do modelo>`): o id não é uma edição → "Edição não
   encontrada", o Estoque abre sem o modo e nada é pedido a
   `/api/client/events` (T2).
4. Fechar o painel devolve o foco ao "Itens do evento" do cabeçalho; "Voltar
   ao evento" navega sem `replace` (o voltar do navegador reabre o Estoque
   no modo) (T1).
5. A redução pela `itemDeEntrada` mora só em `useGravacaoDosItens`: o
   cartão, o painel e o diálogo gravam por ele, e nada chama `salvarEdicao`
   direto; o caso 3 confere a lista reduzida pelo cartão, e o painel e o
   diálogo passam pelo mesmo caminho, sem caso próprio (T1).

---

### Task 1: o modo "montando o evento" no Estoque (faixa, cartões, filtro, painel)

**Files:**
- Create: `artifacts/app/src/lib/eventos/itens-do-estoque.ts`
- Create: `artifacts/app/src/pages/client/estoque-evento.tsx`
- Modify: `artifacts/app/src/pages/client/estoque.tsx` (o tipo `StockFilter` e `stockFilterOptions`, 115 e 153–162; `ClienteEstoque`: a leitura da edição ao lado de `wantsEvent`, 259–263, o `draftLoader`, 426–440, `filterCounts` e `filterProducts`, 450–464, `addDraftToCart`, 553–582, o cabeçalho, 792–827, a barra, 829–851, a grade e a lista, 853–896, os painéis, 910–966, a barra fixa do celular, 968–982; `activeCatalogFilters`, 1030–1049; `MarketplaceToolbar`, 1051–1212, com `resultSuffix` 1104–1109; `StockStatusSelect`, 1245–1257; `StockList`, 1461–1468 e 1501–1545; `FamilyGrid`, 1676–1730; `FamilyCard`, 1760–1913, a linha do disponível e as ações 1855–1905; `ProductDetailProps` e o detalhe, 2332–2353, 2491–2499 e 2563–2581; `StockBadge`, 2930–2975; `filterProducts`, 3095–3144)
- Test: `artifacts/app/src/lib/eventos/itens-do-estoque.test.ts`
- Test: `artifacts/app/src/pages/client/estoque-evento.test.tsx`

**Interfaces:**
- Consumes: `LIMITES`, `nomeComTamanho` (`@workspace/dominio`, parte 1 e hoje); `EVENTOS_LIBERADO` (`@/lib/liberacao`, parte 1); `salvarEdicao` (`@/lib/wms/eventos`, parte 2) e `erroDaCallable` (`@/lib/wms/erro-da-callable`); os tipos `EdicaoView`, `ItemDaEdicao`, `PatchDaEdicao` (`@/lib/eventos/tipos`, parte 2); da parte 4 (os nomes do índice, "Interfaces"): `useEdicaoDoEvento(id: string | null): { edicao: EdicaoView | null | undefined; erro: boolean; tentando: boolean; tentar: () => void; falta: FaltaDaLeitura; lidaEm: number | null }` (`@/lib/eventos/use-eventos`, ao vivo por `useDocumentoDoPortal`, sem chave do react-query: `edicao === undefined` lendo, `null` sem documento ou de outro cliente; a escuta entrega a própria escrita), `ItensDoEventoDialogo({ edicao: EdicaoView; produtos?: ProdutoDoEstoque[]; onMudar(itens: ItemDaEdicao[]): void; onFechar(): void; onEscolherMais(): void })` (`@/pages/client/evento-itens-dialogo`), `periodoDaEdicao(cronograma: EdicaoView["cronograma"]): string | null` (`@/lib/eventos/cronograma`: "28 e 29/01/2027"), `type ProdutoDoEstoque = { sku: string; clientItemCode?: string | null; total: number; available: number; value: number; photoUrl?: string | null }`, `type FaltaDeSaldo = { item: ItemDaEdicao; disponivel: number; falta: number }`, `faltasDeSaldo(itens, produtos: ProdutoDoEstoque[]): FaltaDeSaldo[]` (o SKU fora de `produtos` conta 0 livre: falta total), `textoDasFaltas(faltas): string | null` (`@/lib/eventos/itens`; a linha "Falta saldo em N itens: …" do formulário, as três primeiras, `null` sem falta: esta parte a consome, não a remonta) e `itemDeEntrada(item: ItemLido): ItemDeEntrada` (`@/lib/eventos/itens`; reduz o item aos seis campos de entrada, `sku_code`, `client_item_code`, `product_name`, `size`, `category` e `quantity`, porque `ItemDaEdicaoSchema` é `.strict()` e o item lido de `edicao.itens` traz também `foi`, `voltou`, `avariadas`, `nao_voltaram` e `observacao`, null pela `edicaoDaLeitura`; esta parte a usa só em `useGravacaoDosItens`); do Estoque de hoje: `SideDrawer`, `FamilyCard`, `StockList`, `ProductDetailPanel`, `MarketplaceToolbar`, `StockFilterGroups`, `QuantityStepper`, `StockBadge`, `AcoesDosProdutos`/`useAcaoNaLinha`, `CarregandoNaRegiao`, `ErroNaLeitura` e `BlocoSemConexao` (`@/components/ui/erro-na-leitura`), `formatNumber`, `displayName`.
- Produces (`lib/eventos/itens-do-estoque.ts`, puro):
  - `type ProdutoDoCatalogo = { sku: string; clientItemCode: string | null; name: string; size: string | null; category: string }` (o produto do cartão que vira linha da edição; o `ProdutoDoEstoque` da parte 4, com o saldo e a foto, é o que o diálogo e `faltasDeSaldo` recebem). O nome repete o `ProdutoDoCatalogo` de `lib/warehouse-ops/recontagem-por-caixa.ts` (`{ sku; codigo; nome; barras }`) e fica: outra pasta, e nenhum arquivo importa os dois.
  - `quantidadesNoEvento(itens: readonly ItemDaEdicao[]): Readonly<Record<string, number>>` por `sku_code`.
  - `itensComProduto(itens: readonly ItemDaEdicao[], produto: ProdutoDoCatalogo, quantidade: number): ItemDaEdicao[]` — troca a linha do SKU na mesma posição, acrescenta ao fim o SKU novo (`sku_code`, `client_item_code: clientItemCode`, `product_name: displayName(name)`, `size`, `category`, `quantity`) e tira a linha com `quantidade` 0.
  - `limiteDosItensAtingido(itens: readonly ItemDaEdicao[], sku: string): boolean` — `itens.length >= LIMITES.itens` e o SKU não está na lista.
  - `itensQueABuscaAcha(itens: readonly ItemDaEdicao[], busca: string): ItemDaEdicao[]` — pelo `nomeComTamanho`, `client_item_code`, `sku_code` e `category`, sem acento nem caixa, na ordem da edição.
  - `ITENS_A_VISTA_NO_PAINEL = 6` (o `PREVIEW_ITEMS` dos Eventos de hoje).
- Produces (`pages/client/estoque-evento.tsx`):
  - `FaixaDoEvento({ edicao: EdicaoView; onVerTodos: () => void; onVoltar: () => void })`: "Montando o evento **{event_name}** · {periodoDaEdicao(edicao.cronograma)} · **{itens_total} itens · {pecas_total} peças** no evento", "Ver os {itens_total} itens" e "Voltar ao evento" (ícone `CalendarDays` `aria-hidden`).
  - `PainelDoEvento({ edicao, produtos: ProdutoDoEstoque[], expanded, onToggleExpanded, onClose, onQuantidade: (item: ItemDaEdicao, quantidade: number) => void, onTirar: (item: ItemDaEdicao) => void, onVerTodos, onVoltar })` (`produtos` no tipo da parte 4, com `available` e `photoUrl`; cada linha acha o seu pelo `sku`): `h2` "Itens do evento", "{event_name} · {itens_total} itens · {pecas_total} peças" e, quando não é `null`, a linha `textoDasFaltas(faltasDeSaldo(edicao.itens, produtos))` da parte 4, a mesma do formulário ("Falta saldo em N itens: <nomeComTamanho> (no evento X, disponível Y)", as três primeiras; o item cujo SKU não está em `produtos` entra com disponível 0), sem frase montada no painel; "Tela cheia"/"Recolher", o fechar com `aria-label="Fechar itens do evento"`, a busca com `placeholder` e `aria-label` "Buscar entre os {itens_total} itens do evento", até `ITENS_A_VISTA_NO_PAINEL` linhas com a foto, `nomeComTamanho({ nome: product_name, codigo: client_item_code, tamanho: size })`, "{client_item_code ?? sku_code} · {available} disponíveis" (só o código quando o SKU não está no estoque), o `QuantityStepper` compacto (`label` = o nome da linha, `max` `LIMITES.quantidade`) e o botão `aria-label="Tirar do evento"`; "Mostrando {à vista} de {itens_total} itens" e "Ver os {itens_total} itens"; o rodapé "{itens_total} itens", "{pecas_total} peças" e "Voltar ao evento"; sem item, "Nenhum item no evento"; busca sem resultado, "Nenhum item do evento com esse nome.".
  - `GRAVAR_APOS_MS = 1000` e `useGravacaoDosItens(edicao: EdicaoView | null, aoFalhar: (erro: ErroDaCallable) => void): { gravarAgora(itens: ItemDaEdicao[]): Promise<void>; gravarDepois(itens: ItemDaEdicao[]): void; pendente: boolean }` — `salvarEdicao({ id, expected_edicao, patch: { itens: itens.map(itemDeEntrada) } })` (a redução vem antes de cada gravação, a de `gravarAgora` e a de `gravarDepois`: a lista que chega do cartão, do painel ou do diálogo carrega os itens lidos de `edicao.itens`), com `expected_edicao` = o `edition.edicao` da última resposta, guardado em estado próprio, ou, sem ele, o `edicao` do documento vivo; o sucesso só guarda esse número (a escuta de `useEdicaoDoEvento` entrega a própria escrita: nenhum cache a atualizar); `gravarDepois` espera `GRAVAR_APOS_MS` desde a última mudança e manda a última lista; a gravação seguinte espera a anterior; a recusa chama `aoFalhar(erroDaCallable(erro))`, e no `failed-precondition` é só isso: a lista que esperava e o número guardado saem (o documento vivo já é o do servidor, e a próxima gravação leva o `edicao` dele), sem invalidar nem reler nada; `gravarAgora` relança (o `BotaoDeAcao` do cartão mostra o erro); quem a chama sem esperar (o `onMudar` do diálogo, o `onTirar` do painel) termina em `.catch(() => undefined)`, porque o toast de `aoFalhar` já avisou.
- Produces (`estoque.tsx`):
  - `StockFilter` ganha `"no_evento" | "fora_do_evento"`; `stockFilterOptions` ganha `{ value: "no_evento", label: "No evento", icon: CalendarDays }` e `{ value: "fora_do_evento", label: "Fora do evento", icon: Package }`; `OPCOES_DE_SALDO_DO_EVENTO: readonly StockFilter[] = ["todos", "disponiveis", "no_evento", "fora_do_evento"]`.
  - `export type ModoEvento = { noEvento: Readonly<Record<string, number>>; limiteAtingido: (sku: string) => boolean }`; a prop opcional `evento?: ModoEvento` em `FamilyGrid`, `FamilyCard`, `StockList` e `ProductDetailPanel`; `modoEvento?: boolean` em `MarketplaceToolbar`, `CatalogRefinementsProps`/`StockFilterGroups` e `StockStatusSelect`; `noEvento?: number` em `StockBadge` ("No evento · {n}", ícone `CalendarDays`, antes do "no pedido"); `noEvento?: Readonly<Record<string, number>>` em `filterProducts` (`no_evento`: `noEvento[sku] > 0`; `fora_do_evento`: o contrário).
  - No modo, em `FamilyCard`, `StockList` e `ProductDetailPanel`: o contador vale `evento.noEvento[sku] ?? draftQuantities[key] ?? 1` com `max` `LIMITES.quantidade`; a linha do disponível ganha " · {n} no evento" quando `n > 0` ("284 disponíveis neste tamanho · 300 no evento", "1 disponível · 1 no evento"); a ação é um `BotaoDeAcao` com `estado` de `AcoesDosProdutos` (`estado(product.key, "evento")`), `rotulo` "Alterar no evento" (já no evento, `variant="outline"`) ou "Adicionar ao evento" (ícone `Plus`), `andamento` "Gravando no evento…", `sucesso` "No evento", `bloqueado` pelo `limiteAtingido(sku)` no SKU novo; o produto zerado que está no evento mostra o contador e a ação, os outros zerados seguem `ZeroStockActions`. Na lista, o cabeçalho "Pedido" vira "Evento" e o selo "{n} no pedido" vira "{n} no evento". No detalhe, o fato "No pedido" vira "No evento", e a confirmação do adicionado diz "{n} peças no evento" com "Ver itens do evento" (abre o painel).
  - `ClienteEstoque`: `const idDaEdicao = EVENTOS_LIBERADO ? wantsEvent : null; const leitura = useEdicaoDoEvento(idDaEdicao); const edicao = leitura.edicao;` `modoEvento = Boolean(idDaEdicao) && edicao?.status === "rascunho"`. Lendo (`edicao === undefined`, sem `erro`): `<CarregandoNaRegiao rotulo="Abrindo o evento…" continuaARota onTentar={leitura.tentar} />`. A leitura que falha (`leitura.erro`, sem a edição lida) fica na mesma região, antes da barra, com a falha e "Tentar de novo" (carregamento v2, como as leituras do portal): `BlocoSemConexao` quando `leitura.falta === "conexao"`, senão `ErroNaLeitura mensagem="Não foi possível carregar a edição."` (a frase do formulário da parte 4), os dois com a nova tentativa da leitura (`tentando`, `onTentar={leitura.tentar}`); sem toast nem `navigate`: o `?evento=` fica, o catálogo continua sem o modo, e a nova tentativa que lê a edição abre o modo. Não encontrada ou de outro cliente (`edicao === null`): toast "Edição não encontrada" / "Ela pode ter sido excluída. Veja a lista em Eventos.", `navigate("/portal/estoque", { replace: true })` e o Estoque sem o modo. Fora de `rascunho`: toast "A edição já foi enviada" / "Os itens não mudam depois do envio." e `navigate("/portal/eventos/edicao?id=…", { replace: true })`. No modo: a `FaixaDoEvento` antes da barra; o `cart` passado aos componentes é `{}`; `onAdd` grava (`acoesDosProdutos.executar(product.key, "evento", () => gravacao.gravarAgora(itensComProduto(edicao.itens, produto, quantidade)))`) e limpa o rascunho do contador; o `headerAction` é "Itens do evento" com o contador (`aria-label` "Abrir os itens do evento, {itens_total} itens", `aria-expanded`), que abre o `SideDrawer` (`title="Itens do evento"`, `wide` pela "Tela cheia", `ocupado={gravacao.pendente}`, `focoAoFechar` o botão do cabeçalho) com o `PainelDoEvento` (`produtos` = os `products` do Estoque, cujo `StockProduct` já tem a forma do `ProdutoDoEstoque` da parte 4; `onQuantidade` → `gravarDepois`, `onTirar` → `gravarAgora` com 0, no mesmo `void … .catch(() => undefined)` do diálogo); "Ver os N itens" abre `ItensDoEventoDialogo({ edicao, produtos, onMudar: (itens) => void gravacao.gravarAgora(itens).catch(() => undefined), onFechar, onEscolherMais })` (os mesmos `produtos`; o diálogo não espera o `onMudar`, e a recusa já sai no toast de `aoFalhar`: sem o `catch`, ela ficaria como promessa rejeitada sem tratamento; `onEscolherMais` só fecha: a pessoa já está no Estoque); "Voltar ao evento" → `navigate("/portal/eventos/edicao?id=…")`; a barra fixa do celular diz "Evento · {itens_total} itens · {pecas_total} peças" e "Ver ›" e abre o painel; a falha da gravação vira toast com `erro.message` ("A edição mudou em outra aba" → descrição "Os itens na tela já são os gravados: confira e tente de novo.", sem reler: a escuta já trouxe o documento).

- [ ] **Step 1: Write the failing tests**

`lib/eventos/itens-do-estoque.test.ts` (vitest, puro), com `POLO_M`
(`sku_code: "BTG-000001"`, `client_item_code: "A.01.0809.002.M"`,
`product_name: "Polo Masculino Piquet Arpoador"`, `size: "M"`, `category:
"Polo"`, `quantity: 300`) e `POLO_G` (idem, G, 200); `produto(item)` e
`TOALHA` são `ProdutoDoCatalogo`:

```ts
it("quantidadesNoEvento: uma entrada por sku_code", () => expect(quantidadesNoEvento([POLO_M, POLO_G])).toEqual({ "BTG-000001": 300, "BTG-000002": 200 }));
it("itensComProduto troca a linha do SKU na mesma posição, acrescenta o SKU novo ao fim e tira com 0", () => {
  expect(itensComProduto([POLO_M, POLO_G], produto(POLO_M), 120).map((i) => i.quantity)).toEqual([120, 200]);
  expect(itensComProduto([POLO_M], TOALHA, 1).at(-1)).toEqual({ sku_code: "BTG-000003", client_item_code: "C.0659.001", product_name: "Toalha de Academia", size: null, category: "Toalha", quantity: 1 });
  expect(itensComProduto([POLO_M, POLO_G], produto(POLO_M), 0)).toEqual([POLO_G]);
});
it("limiteDosItensAtingido: 100 itens e SKU novo; nem 99, nem o SKU que já está", () => {
  const cem = Array.from({ length: 100 }, (_, i) => ({ ...POLO_M, sku_code: `BTG-${String(i).padStart(6, "0")}` }));
  expect(limiteDosItensAtingido(cem, "BTG-999999")).toBe(true);
  expect(limiteDosItensAtingido(cem, "BTG-000007")).toBe(false);
  expect(limiteDosItensAtingido(cem.slice(1), "BTG-999999")).toBe(false);
});
it("itensQueABuscaAcha: pelo nome com o tamanho, pelo código do cliente, pelo SKU e pelo tipo, sem acento", () => {
  expect(itensQueABuscaAcha([POLO_M, POLO_G], "arpoador g")).toEqual([POLO_G]);
  expect(itensQueABuscaAcha([POLO_M, POLO_G], "0809.002.M")).toEqual([POLO_M]);
  expect(itensQueABuscaAcha([POLO_M, POLO_G], "polo")).toEqual([POLO_M, POLO_G]);
});
```

`pages/client/estoque-evento.test.tsx` (`// @vitest-environment jsdom`), com
o arnês de `estoque-carregando.test.tsx` 1–143 (`fetch` falso, `montar`,
`ate`, `botao`, `card`) e os mocks `@/lib/auth`, `@/hooks/use-toast` (guarda
os toasts em `estado.toasts`), `@/lib/liberacao` (`EVENTOS_LIBERADO: true`),
`@/lib/eventos/use-eventos` (`useEdicaoDoEvento` devolve `{ edicao:
estado.edicao, erro: estado.erro, tentando: false, tentar: estado.tentar,
falta: null, lidaEm: null }`, com `estado.edicao` `undefined` lendo e `null`
não encontrada; `estado.emitir()` refaz a leitura, como a escuta ao vivo),
`@/lib/wms/eventos` (`salvarEdicao` grava a chamada em `estado.gravacoes`,
troca `estado.edicao` por `{ ...estado.edicao, itens, itens_total:
itens.length, pecas_total: <a soma dos quantity>, edicao: expected_edicao +
1 }` (refaz os dois contadores como o servidor: a faixa e o rodapé leem o
documento), chama `estado.emitir()` (a escuta entrega a própria escrita) e
devolve `{ id, edicao: expected_edicao + 1, created: false, edition:
estado.edicao }`; com `estado.recusa`, recusa com ela, sem gravar) e
`@/pages/client/evento-itens-dialogo` (um
`role="dialog"` com "Itens do evento · {event_name}", que guarda as props,
`produtos` e `onMudar` com elas, em `estado.dialogo`). O estoque: a polo em
P, M, G e GG (`A.01.0809.002.P`…, disponíveis 68, 284, 209 e 86), a toalha
(`C.0659.001`, 672) e 96 itens de enchimento com saldo que cobre o evento;
a edição `EDICAO`: `status: "rascunho"`, `edicao: 3`,
`event_name: "B2B Conference Necton"`, `label: "2027"`, o cronograma da
Necton, `itens` = a polo (120, 300, 200, 80) e os 96 de enchimento somando
1.300 peças (95 de 13 e um de 65), cada item com `foi`, `voltou`,
`avariadas`, `nao_voltaram` e `observacao` null, como a `edicaoDaLeitura`
os entrega, `itens_total: 100`, `pecas_total: 2000`; e a `EDICAO_99`, a do
caso 3: a `EDICAO` sem o item de enchimento de 65 peças (`itens_total: 99`,
`pecas_total: 1935`).

```ts
describe("o Estoque do portal montando o evento (EventosPortalEstoque.dc.html)", () => {
  it("1. com ?evento= de um rascunho, a faixa diz o evento, as datas e o total, com 'Ver os 100 itens' e 'Voltar ao evento'; o cabeçalho troca 'Ver pedido' por 'Itens do evento'; textos e axe", async () => {
    // textosDaTela(faixa.outerHTML) === ["Montando o evento", "B2B Conference Necton", `· ${periodoDaEdicao(EDICAO.cronograma)} ·`, "100 itens · 2.000 peças", "no evento", "Ver os 100 itens", "Voltar ao evento"]
    // container.querySelector('[aria-label="Abrir os itens do evento, 100 itens"]') existe; '[aria-label^="Abrir pedido"]' não
  });
  it("2. o cartão da polo leva 'No evento · 700', '284 disponíveis neste tamanho · 300 no evento', o contador em 300 e 'Alterar no evento'; a toalha, '672 disponíveis', o contador em 1 e 'Adicionar ao evento'; textos e axe", async () => {
    // textosForaDaLista(card("Polo").outerHTML, [...TEXTOS_DO_CARTAO, "Alterar no evento", "Gravando no evento…", "No evento", "Conferir"]) === []
  });
  it("3. com a EDICAO_99, 'Adicionar ao evento' da toalha grava a lista inteira, já reduzida por itemDeEntrada, com expected_edicao 3, size e category, sem campo undefined; o botão diz 'Gravando no evento…' aos 300 ms só no cartão tocado; a faixa passa a 100 itens", async () => {
    // estado.edicao = EDICAO_99
    // estado.gravacoes[0] === { id: EDICAO_99.id, expected_edicao: 3, patch: { itens: [...EDICAO_99.itens, { sku_code: TOALHA.sku, client_item_code: "C.0659.001", product_name: "Toalha de Academia", size: null, category: "Toalha", quantity: 1 }].map(itemDeEntrada) } }
    // JSON.stringify(estado.gravacoes[0]) não casa com /"(foi|voltou|avariadas|nao_voltaram|observacao)"/: os itens da EDICAO_99 chegam com os cinco null, e a lista sai reduzida
    // JSON.stringify(estado.gravacoes[0]).includes("undefined") === false
    // depois da gravação, a faixa diz "100 itens · 1.936 peças" (o mock refaz os contadores)
  });
  it("4. o contador do evento não é limitado pelo saldo: 300 na polo M com 284 disponíveis fica 300 e grava 300", ...);
  it("5. a EDICAO, com 100 itens: 'Adicionar ao evento' da toalha, um SKU novo, fica bloqueado e nada é gravado; 'Alterar no evento' de um dos 100 grava", ...);
  it("6. o filtro oferece Todos, Com saldo, No evento e Fora do evento, com as contagens; 'No evento' deixa a polo e os 96 de enchimento, e 'Fora do evento', só a toalha", async () => {
    // [...saldo.options].map(o => o.value) === ["todos", "disponiveis", "no_evento", "fora_do_evento"]
    // '[data-testid="stock-results-count"]' === "100 itens no evento" (a contagem é por SKU, como hoje: os quatro tamanhos da polo e os 96 de enchimento)
  });
  it("7. o painel 'Itens do evento': a busca, a falta de saldo por textoDasFaltas(faltasDeSaldo(...)), seis linhas com 'Nome · tamanho', o código e o disponível, o contador e 'Tirar do evento', 'Mostrando 6 de 100 itens', 'Ver os 100 itens', '100 itens', '2.000 peças' e 'Voltar ao evento'; textos e axe", async () => {
    // a linha da falta === textoDasFaltas(faltasDeSaldo(EDICAO.itens, <os produtos do arnês>)): a frase da parte 4, que o painel não remonta, com a polo P (no evento 120, disponível 68) e a M (no evento 300, disponível 284); a G e a GG têm saldo
    // textosForaDaLista(painel.outerHTML, ["Itens do evento", "B2B Conference Necton · 100 itens · 2.000 peças", /^Falta saldo em 2 itens: /, "Tela cheia", "Polo Masculino Piquet Arpoador · P", "A.01.0809.002.P · 68 disponíveis", ..., "Mostrando 6 de 100 itens", "Ver os 100 itens", "100 itens", "2.000 peças", "Voltar ao evento"]) === []
  });
  it("8. mudar o contador no painel grava uma vez, um segundo depois da última mudança (relógio falso); 'Tirar do evento' grava na hora com a linha fora; 'Ver os 100 itens' abre o diálogo com os produtos do Estoque, e o onMudar dele (estado.dialogo) grava a lista na hora", ...);
  it("9. a gravação recusada com 'A edição mudou em outra aba' só avisa: a escuta já trouxe a outra aba (estado.edicao com edicao 4 e a polo M em 250, estado.emitir()), o cartão mostra 250, o toast diz a frase, nada é relido, e o próximo 'Alterar no evento' grava com expected_edicao 4; a mesma recusa (estado.recusa) pelo onMudar do diálogo (estado.dialogo) e pelo 'Tirar do evento' só dá o toast, sem promessa rejeitada sem tratamento", ...);
  it("10. a edição que não existe ou é de outro cliente (estado.edicao null) abre o Estoque sem o modo, com o toast 'Edição não encontrada'; a enviada abre /portal/eventos/edicao?id=", ...);
  it("11. lendo a edição (estado.edicao undefined), aos 300 ms, 'Abrindo o evento…' com a caixa, e o catálogo continua; aos 10 s, 'Tentar de novo' chama o tentar da leitura (relógio falso)", ...);
  it("12. no celular, a barra fixa diz 'Evento · 100 itens · 2.000 peças' e 'Ver ›' e abre o painel", ...);
  it("13. a leitura que falha (estado.erro true, estado.edicao undefined) fica na região antes da barra com 'Não foi possível carregar a edição.' e 'Tentar de novo', que chama o tentar da leitura; nenhum toast, a URL continua com ?evento= e o catálogo segue sem o modo; com estado.erro false, estado.edicao = EDICAO e estado.emitir(), a faixa aparece; textos e axe", ...);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/itens-do-estoque.test.ts src/pages/client/estoque-evento.test.tsx`
Expected: FAIL (os módulos não existem; a tela ignora o `?evento=` da edição).

- [ ] **Step 3: Implement the pure module, the two components and the mode in `estoque.tsx`**

Na ordem: `itens-do-estoque.ts`; `estoque-evento.tsx` (a faixa, o painel e o
`useGravacaoDosItens`); em `estoque.tsx`, o tipo e as opções do filtro, a
prop `evento`/`modoEvento` nos componentes (os rótulos acima), e o modo em
`ClienteEstoque`. O `useClientEvents` do legado fica como está até a Task 2.
A foto da linha do painel é a do produto (`photoUrl`), como nas linhas de
"Seu pedido" (`estoque.tsx` 2088–2096). O `useGravacaoDosItens` passa cada
item por `itemDeEntrada` antes de `salvarEdicao`, e nada mais na tela chama
`salvarEdicao`.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, depois `cd C:\DEV\Dute; corepack pnpm run typecheck`
e `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/carregando/trava.test.ts src/lib/theme-colors.test.ts`.
Expected: PASS (a trava não acha "..." nem anel de foco fora do `ring-foco`).

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos/itens-do-estoque.ts artifacts/app/src/lib/eventos/itens-do-estoque.test.ts artifacts/app/src/pages/client/estoque-evento.tsx artifacts/app/src/pages/client/estoque-evento.test.tsx artifacts/app/src/pages/client/estoque.tsx
git commit -m "feat(app): o Estoque do portal no modo montando o evento"
```

### Task 2: o "Salvar como evento" e o `applyEvent` saem com a liberação

**Files:**
- Modify: `artifacts/app/src/pages/client/estoque.tsx` (`CartPanel`, as props 2008–2040 e o bloco "Salvar como evento" 2215–2282; em `ClienteEstoque`, `eventsQuery`/`saveEvent` 262–263, o `draftLoader` 426–440, o `SideDrawer` do pedido 910–938)
- Test: `artifacts/app/src/pages/client/estoque-evento.test.tsx` (um `describe` novo)

**Interfaces:**
- Consumes: `EVENTOS_LIBERADO`; `useClientEvents`, `useSaveClientEvent`, `clientEventsQueryKey` (`./events-api`, o legado); `cartFromEvent` e companhia (`@/lib/client-events`).
- Produces: em `CartPanel`, `isSavingEvent?: boolean` (padrão `false`) e `onSaveEvent?: (fields, input, onSaved) => void`; o bloco "Salvar como evento" (o botão e o formulário) só existe com `onSaveEvent`. Em `ClienteEstoque`, `const legado = !EVENTOS_LIBERADO;`: `useClientEvents({ enabled: legado && Boolean(wantsEvent) })`, o ramo do `DraftLoader` com `applyEvent` e o `CarregandoNaRegiao` do legado só com `legado`, `onSaveEvent={legado ? saveCartAsEvent : undefined}`, `isSavingEvent={legado && saveEvent.isPending}` e o `ocupado` do painel do pedido idem. `applyEvent`, `saveCartAsEvent` e o `events-api.ts` ficam no código (saem na parte 12).

- [ ] **Step 1: Write the failing tests**

No mesmo arquivo da Task 1 (`EVENTOS_LIBERADO: true`):

```ts
describe("com a liberação, o legado do carrinho sai (spec, 'Liberação por ambiente e o legado')", () => {
  it("o painel 'Seu pedido' não tem 'Salvar como evento', e o resto do painel é o de sempre; textos e axe", async () => {
    // sem ?evento=, adiciona a toalha ao pedido e abre "Ver pedido": botao("Salvar como evento") === undefined; textosDaTela(painel) contém "Enviar pedido para a Dutelog"
  });
  it("com ?evento=, nada é pedido a /api/client/events e o pedido não é pré-preenchido", async () => {
    // estado.edicao = EDICAO; window.history.replaceState(null, "", `/portal/estoque?evento=${EDICAO.id}`)
    // nenhuma chamada do fetch falso com pathname "/api/client/events"; window.localStorage sem a chave do carrinho com a polo
  });
  it("o ?evento= de um id que não é edição (o 'Usar no pedido' antigo) abre o Estoque sem o modo e sem o carrinho montado", ...);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/pages/client/estoque-evento.test.tsx`
Expected: FAIL ("Salvar como evento" ainda aparece; o `fetch` falso recebe `/api/client/events`).

- [ ] **Step 3: Implement**

As props opcionais em `CartPanel`, o `legado` em `ClienteEstoque` e o ramo
do `draftLoader` condicionado. Nada é apagado.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2 e `cd C:\DEV\Dute; corepack pnpm run typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/pages/client/estoque.tsx artifacts/app/src/pages/client/estoque-evento.test.tsx
git commit -m "feat(app): o Salvar como evento e o Usar no pedido ficam só sem a liberação dos Eventos"
```

### Task 3: os oito testes do Estoque

**Files:**
- Modify: `artifacts/app/src/pages/client/estoque-carregando.test.tsx` (o `vi.mock("@/lib/liberacao", …)` com `EVENTOS_LIBERADO: false` ao lado dos de `@/lib/auth` e `use-toast`, 37–40: os casos "o evento no pedido" 173–181 e "Salvar como evento" 183–227 são do legado)
- Modify: `artifacts/app/src/pages/client/estoque.test.tsx` (`renderCart` 27–48 e a barra 598–643)
- Test: os oito, `estoque.test.tsx`, `estoque-carregando.test.tsx`, `estoque-envio.test.tsx`, `estoque-filtros.test.tsx`, `estoque-gaveta.test.tsx`, `estoque-nome.test.tsx`, `estoque-reposicao.test.tsx`, `estoque-tamanhos.test.tsx`, mais `estoque-evento.test.tsx`

**Interfaces:**
- Consumes: `CartPanel` com `onSaveEvent` opcional (Task 2); `MarketplaceToolbar` com `modoEvento` (Task 1).
- Produces: nenhum nome novo. Os quatro arquivos que montam a tela sem `?evento=` (`envio`, `filtros`, `reposicao`, `tamanhos`) não dependem da liberação e não mudam; `gaveta` e `nome` passam props que continuam válidas.

- [ ] **Step 1: Write the failing tests**

Em `estoque.test.tsx`:

```ts
it("sem onSaveEvent, o painel do pedido não oferece Salvar como evento", () => {
  const html = renderToStaticMarkup(<CartPanel cartKey="" seed={0} lines={[]} isSubmitting={false} expanded={false} onToggleExpanded={noop} onClose={noop} onIncrement={noop} onDecrement={noop} onQuantityChange={noop} onRemove={noop} onSubmit={noop} />);
  expect(textosDaTela(html)).not.toContain("Salvar como evento");
  expect(textosDaTela(html)).toContain("Enviar pedido para a Dutelog");
});
it("montando o evento, o saldo oferece Todos, Com saldo, No evento e Fora do evento, e o resultado diz 'no evento'", () => {
  const dom = new JSDOM(renderToolbar({ modoEvento: true, stockFilter: "no_evento", resultCount: 97 }));
  const saldo = dom.window.document.querySelector<HTMLSelectElement>('select[aria-label="Filtrar por saldo"]')!;
  expect([...saldo.options].map((option) => option.value)).toEqual(["todos", "disponiveis", "no_evento", "fora_do_evento"]);
  expect(dom.window.document.querySelector('[data-testid="stock-results-count"]')?.textContent).toBe("100 itens no evento");
  dom.window.close();
});
```

O caso "oferece saldo, resultado, ordenação e exibição" (617–630) continua
com as quatro opções de hoje: sem `modoEvento`, nada muda.

Em `estoque-carregando.test.tsx`, o `vi.mock` da liberação com
`EVENTOS_LIBERADO: false`, no molde de `servicos-envio.test.tsx` 25.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/pages/client/estoque.test.tsx`
Expected: FAIL só no caso novo da barra se `renderToolbar` ainda não aceita
`modoEvento` (ajuste o `renderToolbar` do próprio teste para repassá-lo); o
caso do `CartPanel` passa desde a Task 2.

- [ ] **Step 3: Run the eight files and the new one**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/pages/client/estoque.test.tsx src/pages/client/estoque-carregando.test.tsx src/pages/client/estoque-envio.test.tsx src/pages/client/estoque-filtros.test.tsx src/pages/client/estoque-gaveta.test.tsx src/pages/client/estoque-nome.test.tsx src/pages/client/estoque-reposicao.test.tsx src/pages/client/estoque-tamanhos.test.tsx src/pages/client/estoque-evento.test.tsx`
Expected: PASS nos nove. O que reprovar é defeito da Task 1 ou 2 e se
corrige lá (sem afrouxar o teste); o caso "com ?evento=, aos 300 ms,
'Abrindo o evento…'" do legado continua verde com a liberação fixada em
`false`.

- [ ] **Step 4: Run the rest that the change toca**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/carregando/trava.test.ts src/lib/theme-colors.test.ts src/lib/platform-lists.test.ts src/lib/modules.test.ts src/lib/cloud-api-indices.test.ts src/lib/customer-literals.test.ts` e `cd C:\DEV\Dute; corepack pnpm run typecheck`.
Expected: PASS (nenhuma rota, consulta ou literal de cliente novo).

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/pages/client/estoque.test.tsx artifacts/app/src/pages/client/estoque-carregando.test.tsx
git commit -m "test(app): os testes do Estoque do portal com o modo do evento e sem o Salvar como evento"
```

### Pronto quando

No emulador, com a homologação ou o `.env.local` apontando para ela: a
edição da Necton aberta pelo formulário da parte 4 ("Escolher no Estoque")
chega ao Estoque com a faixa, a polo recebe 120, 300, 200 e 80 pelos
cartões e 96 itens pelos cartões e pelo painel até 100 itens e 2.000 peças,
o 101º SKU fica bloqueado, o painel diz a falta de saldo do que passa do
disponível, "Tirar do evento" e o contador do painel gravam, o que uma
segunda aba muda na mesma edição chega à primeira pela escuta (e a gravação
que a primeira já tinha a caminho recusa com "A edição mudou em outra aba"),
e "Voltar ao evento" mostra o resumo com os 100 itens; o pedido avulso do
mesmo cliente continua guardado no aparelho e sem "Salvar como evento". Os
nove arquivos de teste do Estoque, a trava do carregamento e o typecheck
verdes. O PR registra em `docs/superpowers/plans/2026-11-26-eventos.md` o
que mudou de nome, se mudou (os nomes da parte 4 que esta parte consome são
os do índice, "Interfaces").
