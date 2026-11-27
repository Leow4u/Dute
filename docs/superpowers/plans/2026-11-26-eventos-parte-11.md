# Eventos · parte 11: portal, a edição registrada, o romaneio e a nova edição a partir desta

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o cliente lê a edição de `enviado` em diante no portal: o status, o
pedido, "O que aconteceu" (previsto × feito), "O que foi e o que voltou", o
preço fechado com o valor declarado e a proposta, as fotos por momento, os
documentos e as edições do evento; imprime o romaneio da cópia
`pedido.volumes`; cancela a enviada; e começa a edição seguinte a partir desta.

**Architecture:** só o app. Nenhuma callable nova: tudo é leitura ao vivo
pelas regras (a edição por `useEdicaoDoEvento(id)` da parte 4, sem
`useDocumentoDoPortal` direto; o preço por `useDocumentoDoPortal`; as
edições do evento por `useLeituraDoPortal`, mapeadas pelo `edicaoDaLeitura`
da parte 4), e as duas escritas são wrappers da parte 2 (`cancelarEdicao`,
`salvarEdicao`). As regras puras ficam em `lib/eventos/` (`registrada.ts`,
`romaneio.ts`, `nova-edicao.ts`), com teste; as páginas seguem o par
contêiner + view do comprovante da OS (`pages/client/comprovante*.tsx`), um
componente por arquivo: a view recebe tudo por props e é o que o teste dos
textos e do `axe` renderiza. O romaneio reaproveita a folha
`RomaneioDocumento`. A rota `/portal/eventos/edicao?id=` e o
`ClienteEventoEdicao` que a atende são da parte 4
(`pages/client/evento-formulario.tsx`): ele lê o status e abre o formulário
em `rascunho`; esta parte muda só o ramo fora de `rascunho`, que deixa de
voltar à lista e renderiza `<ClienteEventoRegistrado id={id} />` (a edição
apagada ou de outro cliente continua indo à lista). A lista também é da
parte 4 e já leva aqui: o "Abrir" do cartão fora de `rascunho` e o `label`
de cada edição anterior apontam para `hrefDaEdicao(id)`.

**Tech Stack:** React, wouter, react-query, firebase/firestore e
firebase/storage (`getDownloadURL`), vitest, jsdom, axe-core.

**Spec:** `docs/superpowers/specs/2026-11-26-eventos-design.md`, seções "As
telas › Portal" (a edição registrada, `/portal/eventos/romaneio`), "A edição,
campo a campo", "Os status e quem move cada um", "As callables"
(`cancelEventEdition`, `saveEventEdition` com `origem_edicao_id`), "O preço
fechado e o valor declarado", "Fotos e documentos", "Fora do escopo" (a fatura
sai; PDF é a impressão do navegador). Pranchas: `EventosPortalEvento.dc.html`,
`EventosPortalLista.dc.html` ("Nova edição a partir de 2026") e
`EventosPortalNovo.dc.html` (o formulário que a nova edição pré-preenche).
Índice: `docs/superpowers/plans/2026-11-26-eventos.md`.

## Global Constraints

As do índice. Nesta parte, ainda: nada muda nas Functions, nas regras nem nos
índices; as páginas novas ficam sob `EVENTOS_LIBERADO` (a edição registrada
pela rota da parte 4, que já está sob ela; o romaneio num spread próprio, T2);
o romaneio e a edição registrada não citam caixa (`CX-`), posição nem quem
separou; dinheiro só no cartão e no bloco "Preço fechado", lido de
`client_event_prices`, nunca da edição; a linha "Fatura FAT-0031" da prancha
não entra; "PDF da edição" é `window.print()` com a edição dentro de
`.print-area` (index.css, linhas 797 a 814) e a barra de ações em `no-print`;
toda data sai no horário de São Paulo, como `lib/warehouse-ops/romaneio.ts`.

## Review Focus

1. A edição `enviado` só com coleta (sem pedido): a edição registrada não
   mostra a linha do pedido nem "Romaneio", e o romaneio dela diz "Esta edição
   não tem pedido." (T1 e T2).
2. "Cancelar" em `enviado`: o diálogo não fecha enquanto grava, a falha fica
   nele com a frase do servidor, e o segundo clique repete a mesma
   `idempotency_key` (T1).
3. O romaneio da edição não leva `CX-`, posição, valor nem o nome de quem
   separou: a folha sai com `por` vazio (T2).
4. Sem documento de preço, "Sem preço fechado" e nenhum `R$`; com preço, o
   `R$` só no cartão e no bloco do preço (T3).
5. "Nova edição a partir desta" grava `origem_edicao_id`, copia onde, itens
   (pela `itemDeEntrada` da parte 4, só os seis campos de entrada), coleta e
   observações, e não manda `cronograma` nem nada do `feito` (T5).

---

### Task 1: a edição registrada no portal

**Files:**
- Create: `artifacts/app/src/lib/eventos/registrada.ts`
- Create: `artifacts/app/src/test/edicao-da-necton.ts` (a edição sintética que todos os testes desta parte usam)
- Create: `artifacts/app/src/pages/client/evento-registrado-view.tsx`, `artifacts/app/src/pages/client/evento-registrado.tsx`
- Modify: `artifacts/app/src/pages/client/evento-formulario.tsx` (parte 4: em `ClienteEventoEdicao`, fora de `rascunho`, renderiza `<ClienteEventoRegistrado id={id} />` no lugar do `Redirect`; `null` continua indo à lista). `App.tsx` e `pages/client/index.ts` não mudam para essa rota: a rota, o `telaSobDemanda` e o export de `ClienteEventoEdicao` são da parte 4, e os dois arquivos só ganham o romaneio na T2. A lista (`pages/client/eventos.tsx`) também é da parte 4 e não muda nesta tarefa.
- Test: `artifacts/app/src/lib/eventos/registrada.test.ts`, `artifacts/app/src/pages/client/evento-registrado-view.test.tsx`, `artifacts/app/src/pages/client/evento-formulario-registrada.test.tsx` (jsdom: o ramo de `ClienteEventoEdicao`)

**Interfaces:**
- Consumes: `STATUS_DA_EDICAO`, `ROTULO_DO_STATUS`, `TIPOS_DE_MOMENTO`, `ROTULO_DO_MOMENTO`, `naoVoltaram`, `nomeComTamanho` de `@workspace/dominio` (parte 1); `EdicaoView`, `MomentoPrevisto`, `StatusDaEdicao` de `lib/eventos/tipos.ts` e `cancelarEdicao` de `lib/wms/eventos.ts` (parte 2); da parte 4 (nomes a conferir no código dela): `periodoDaEdicao(cronograma): string | null` (`lib/eventos/cronograma.ts`; "28 e 29/01/2027", "14 a 16/05/2026", "03/09/2026"; null sem montagem nem evento), `idDaEdicaoNaBusca(busca)`, `hrefDaEdicao(id)` e `ROTA_EVENTOS` (os três de `lib/eventos/navegacao.ts`); `textoDoMostrando(mostrando, total)` e `PAGINA_DO_VER_MAIS` (30) de `lib/eventos/itens.ts` (a frase "Mostrando N de M itens" e o "ver mais", sem refazê-los aqui); `useEdicaoDoEvento(id)` (`lib/eventos/use-eventos.ts`: a leitura da edição nesta parte, sem `useDocumentoDoPortal` direto; devolve `{ edicao, erro, tentando, tentar, falta, lidaEm }`, com `edicao` `undefined` lendo e `null` sem documento ou de outro cliente; é o que o teste do ramo simula); `edicaoDaLeitura(id, data)` (`lib/eventos/leitura.ts`, o `mapear` das edições do evento); `ClienteEventoEdicao()` de `pages/client/evento-formulario.tsx` (por `idDaEdicaoNaBusca` e `useEdicaoDoEvento`: `ClienteEventoFormulario` em `rascunho`; fora dele, e no `null`, `Redirect` a `ROTA_EVENTOS`, até esta parte); `useLeituraDoPortal` (`lib/portal/leitura-do-portal.ts`, linhas 28 a 36); `Confirmacao` (`components/ui/confirmacao.tsx`); `CarregandoNaRegiao`, `FaixaAoVivo`, `BlocoSemConexao`, `ErroNaLeitura` (como `comprovante-view.tsx`, linhas 73 a 127); `Chip`; `textosDaTela`, `textosForaDaLista`, `violacoesDeAcessibilidade`.
- Produces (`lib/eventos/registrada.ts`, puro):
  - `diaEHora(iso: string | null): string | null` → "24/11/2026 15:14"; `diaEHoraCurtos(iso)` → "28/01 05:10"; `previstoEmTexto(momento: MomentoPrevisto)` → "previsto 28/01 05:00", com `ate` "previsto 28/01 10:00 às 19:00"; `feitoEmTexto(feito)` → "28/01 10:05 às 18:40" (sem `fim`, só o início); `resumoDaCapa(edicao)` → "Edição 2027 · 28 e 29/01/2027 · Hotel Unique · PED-0007" (sem pedido, sem o último trecho; com `periodoDaEdicao` null, sem o segundo).
  - `type LinhaDoQueAconteceu = { id: string; titulo: string; por: string | null; previsto: string | null; feito: string | null; dados: string[]; romaneio: boolean }`; `linhasDoQueAconteceu(edicao): LinhaDoQueAconteceu[]`, nesta ordem e só o que já aconteceu: "Pedido enviado" (`por: "pelo cliente"`, `enviada_em`, `dados: [order_number ?? request_number]`), "Confirmado" (`"pela Dutelog"`, `confirmada_em`), "Separado" (`"no armazém"`, `pedido.separado_em`, `dados: ["38 volumes · lacre 88412"]`, `romaneio: true`), um por momento (`titulo: ROTULO_DO_MOMENTO[tipo]` ou o `rotulo` do `outro`; `dados`: "6 fotos"/"1 foto", na coleta "2.190 produtos", no retorno "1.994 peças · 3 não voltaram · 3 avariadas"), "Edição fechada" (`fechada_em`) ou "Edição cancelada" (`cancelada_em`, `dados: [cancelamento_motivo]`).
  - `type LinhaDoQueFoi = { chave: string; nome: string; codigo: string; foi: number | null; voltou: number | null; diferenca: string | null }`; `linhasDoQueFoiEVoltou(edicao)` (`nome` por `nomeComTamanho`; `diferenca` "2 não voltaram", "2 avariadas · alça quebrada", "1 avariada · tampo riscado", "1 não voltou · 2 avariadas", igual ou antes do retorno → null); `linhasComDiferenca(linhas)`; `LINHAS_A_VISTA_DO_QUE_FOI = 8` (nomes que não colidem com `comDiferenca` e `LINHAS_A_VISTA_NO_RETORNO` da parte 9; a frase "Mostrando 8 de N itens" é o `textoDoMostrando` da parte 4, consumido, não refeito).
  - `totaisDoRetorno(edicao): { foi: number | null; voltou: number | null; naoVoltaram: number; avariadas: number; coleta: { quantidade: number; voltou: number | null; distribuidos: number | null } | null }` e `textoDosTotais(totais): { foi: [string, string]; voltou: [string, string] }` → `["2.000 peças", "100 itens e 2.190 produtos do cliente"]`, `["1.994 peças", "3 não voltaram · 3 avariadas · 1.930 produtos"]`; sem o fato, "—".
  - `type LinhaDaEdicao = { id: string; texto: string; esta: boolean }`; `edicoesDoEvento(edicoes: readonly EdicaoView[], atualId: string)`, da mais recente à mais antiga, "2026 · 14 a 16/05/2026 · Expo Center Norte · fechada" (sem o período quando `periodoDaEdicao` é null) e "· esta" na atual; `podeCancelarNoPortal(status)` (só `enviado`); `hrefDoRomaneioDaEdicao(id)` → `/portal/eventos/romaneio?id=<id>`.
- Produces (`test/edicao-da-necton.ts`): `EDICAO_DA_NECTON: EdicaoView` (`id: "ced_necton2027"`, "B2B Conference Necton", `label: "2027"`, `status: "fechado"`, o onde e o contato da prancha, os sete momentos com previsto e feito, dez itens com `foi`/`voltou`/`avariadas`/`nao_voltaram` somando 2.000/1.994/3/3, coleta 2.190 com `voltou: 1930`, `pedido` PED-0007 com `volumes_total: 38`, lacre 88412 e dois volumes com itens, equipe, 15 fotos em cinco momentos, dois documentos do cliente), `EDICAO_ENVIADA_SO_COLETA` (`status: "enviado"`, `itens: []`, `pedido: null`), `edicaoEm(status, sobrescrita?)`, `NOMES_E_CODIGOS_DA_NECTON`.
- Produces (páginas): `EventoRegistradoView({ estado: "carregando" | "nao_encontrada" | "erro" | "pronta", edicao, edicoes: LinhaDaEdicao[], onImprimir, cancelar?: { aberto, ocupado, erro: string | null, onAbrir, onConfirmar, onFechar }, leitura? })`; `ClienteEventoRegistrado({ id })`: a edição por `useEdicaoDoEvento(id)` (parte 4, sem `useDocumentoDoPortal` direto; o `estado` como em `comprovante.tsx`: `null` → `nao_encontrada`, `erro` → `erro`, `undefined` → `carregando`, senão `pronta`; `tentando`, `tentar`, `falta` e `lidaEm` vão na `leitura`), `useLeituraDoPortal` das edições do evento com `where("customer_code","==",code)` e `where("event_id","==",eventId)` (duas igualdades sem `orderBy`: não pede índice) e `edicaoDaLeitura` no `mapear`, o cancelar por `cancelarEdicao({ id, idempotency_key })` com a chave gerada ao abrir o diálogo e mantida até fechar. As páginas desta tarefa exportam só `EventoRegistradoView` (`evento-registrado-view.tsx`) e `ClienteEventoRegistrado({ id })` (`evento-registrado.tsx`, importado por `evento-formulario.tsx`), um componente por arquivo, como o par `comprovante.tsx`/`comprovante-view.tsx` (`evento-registrado.tsx` não reexporta a view); nenhum segundo `ClienteEventoEdicao`, que segue sendo o da parte 4.
- Produces (o ramo de `ClienteEventoEdicao`, parte 4): `rascunho` → `ClienteEventoFormulario`, como antes; qualquer outro status → `<ClienteEventoRegistrado id={id} />`; `null` (apagada, ou de outro cliente) → `Redirect` a `ROTA_EVENTOS`, como antes; a espera e o `erro` ficam como a parte 4 os deixou.

- [ ] **Step 1: Write the failing tests**

`registrada.test.ts` (vitest, puro):

```ts
it("as datas no horário de São Paulo", () => {
  expect(diaEHora("2026-11-24T18:14:00.000Z")).toBe("24/11/2026 15:14");
  expect(previstoEmTexto({ tipo: "montagem", data: "2027-01-28", hora: "10:00", ate: "19:00" })).toBe("previsto 28/01 10:00 às 19:00");
  expect(feitoEmTexto({ inicio: "2027-01-28T13:05:00.000Z", fim: "2027-01-28T21:40:00.000Z", origem: "registro" })).toBe("28/01 10:05 às 18:40");
});
it("a capa e o que aconteceu, na ordem da prancha", () => {
  expect(resumoDaCapa(EDICAO_DA_NECTON)).toBe("Edição 2027 · 28 e 29/01/2027 · Hotel Unique · PED-0007");
  expect(resumoDaCapa(edicaoEm("enviado", { cronograma: [], pedido: null }))).toBe("Edição 2027 · Hotel Unique"); // periodoDaEdicao null: sem o período
  expect(linhasDoQueAconteceu(EDICAO_DA_NECTON).map((l) => l.titulo)).toEqual(["Pedido enviado", "Confirmado", "Separado", "Coleta no cliente", "Entrega no local", "Montagem", "Evento", "Desmontagem e coleta", "Retorno ao estoque Dutelog", "Entrega de volta no cliente", "Edição fechada"]);
  expect(linhasDoQueAconteceu(EDICAO_DA_NECTON)[2]).toMatchObject({ por: "no armazém", dados: ["38 volumes · lacre 88412"], romaneio: true });
  const soColeta = linhasDoQueAconteceu(EDICAO_ENVIADA_SO_COLETA);
  expect(soColeta.map((l) => l.titulo)).toEqual(["Pedido enviado", "Coleta no cliente", "Entrega no local", "Montagem", "Evento", "Desmontagem e coleta", "Retorno ao estoque Dutelog", "Entrega de volta no cliente"]);
  expect(soColeta.slice(1).every((l) => l.feito === null && l.previsto !== null)).toBe(true);
});
it("o que foi e o que voltou: a diferença por item e os totais", () => {
  const linhas = linhasDoQueFoiEVoltou(EDICAO_DA_NECTON);
  expect(linhas[0]).toMatchObject({ nome: "Polo Masculino Piquet Arpoador · G", codigo: "A.01.0809.002.G", foi: 200, voltou: 198, diferenca: "2 não voltaram" });
  expect(linhasComDiferenca(linhas)).toHaveLength(4);
  expect(textoDoMostrando(LINHAS_A_VISTA_DO_QUE_FOI, linhas.length)).toBe("Mostrando 8 de 10 itens"); // textoDoMostrando é o da parte 4
  expect(totaisDoRetorno(EDICAO_DA_NECTON)).toEqual({ foi: 2000, voltou: 1994, naoVoltaram: 3, avariadas: 3, coleta: { quantidade: 2190, voltou: 1930, distribuidos: 260 } });
  expect(textoDosTotais(totaisDoRetorno(EDICAO_ENVIADA_SO_COLETA)).foi).toEqual(["—", "2.190 produtos do cliente"]);
});
it("as edições do evento, o cancelar e o romaneio", () => {
  expect(edicoesDoEvento([EDICAO_DA_NECTON, edicaoEm("fechado", { id: "ced_2026", label: "2026" })], "ced_necton2027")[0]).toMatchObject({ esta: true });
  expect(STATUS_DA_EDICAO.filter(podeCancelarNoPortal)).toEqual(["enviado"]);
  expect(hrefDoRomaneioDaEdicao("ced_necton2027")).toBe("/portal/eventos/romaneio?id=ced_necton2027");
});
```

`evento-registrado-view.test.tsx` (`renderToStaticMarkup` em `<Router ssrPath="/portal/eventos/edicao">`, como `comprovante-view.test.tsx`):

```ts
it("a edição fechada da Necton: só rótulos, dados e ações; sem caixa, fatura, legenda nem nome da equipe da Dutelog fora de Equipe", () => {
  const html = render("pronta", EDICAO_DA_NECTON);
  expect(textosForaDaLista(html, [
    "Eventos", "B2B Conference Necton", "Fechado", "Edição 2027 · 28 e 29/01/2027 · Hotel Unique · PED-0007", "PDF da edição", "Nova edição a partir desta",
    "Foi", "2.000 peças", "100 itens e 2.190 produtos do cliente", "Voltou", "1.994 peças", "3 não voltaram · 3 avariadas · 1.930 produtos", "Fotos", "15",
    "O que aconteceu", "Pedido enviado", "pelo cliente", "Confirmado", "pela Dutelog", "Separado", "no armazém", "38 volumes · lacre 88412", "Romaneio", "Edição fechada",
    ...TIPOS_DE_MOMENTO.filter((t) => t !== "outro").map((t) => ROTULO_DO_MOMENTO[t]), /^previsto \d\d\/\d\d \d\d:\d\d( às \d\d:\d\d)?$/, /^\d\d\/\d\d(\/\d{4})? \d\d:\d\d( às \d\d:\d\d)?$/, /^\d+ fotos?$/, "2.190 produtos", "1.994 peças · 3 não voltaram · 3 avariadas",
    "O que foi e o que voltou", "Todos · 10", "Com diferença · 4", "Buscar item", "Item", "Código", "Diferença", ...NOMES_E_CODIGOS_DA_NECTON, /^\d+$/, /não voltar(am|ou)|avariadas?/, "Do estoque Dutelog", "10 itens", "Produtos coletados no cliente", "260 distribuídos no evento", "Mostrando 8 de 10 itens", "Ver os 10 itens",
    "Edições", "2027 · 28 e 29/01/2027 · Hotel Unique · fechada · esta", "Onde", "Hotel Unique", "Av. Brigadeiro Luís Antônio, 4700 · Jardim Paulista · São Paulo/SP", "Contato no local", "Cristiane", "Coleta e entrega de volta", "BTG Pactual · Faria Lima, 3477",
    "Equipe", "Dutelog", "Rafael S. e Marcos A.", "Cliente", "2 pessoas na montagem e no evento", "Veículo", "utilitário Dutelog",
  ])).toEqual([]);
  expect(html).not.toMatch(/CX-|Fatura|FAT-|R\$|Carregando/);
  expect(html).toMatch(/<article[^>]*class="print-area /);
  expect(html).toMatch(/href="\/portal\/eventos\/romaneio\?id=ced_necton2027"/);
});
it("em enviado, 'Cancelar' aparece e, só com coleta, não há pedido nem Romaneio; de confirmado em diante, sem Cancelar", () => {
  const enviada = render("pronta", EDICAO_ENVIADA_SO_COLETA, { cancelar: CANCELAR_FECHADO });
  expect(textosDaTela(enviada)).toContain("Cancelar");
  expect(enviada).not.toMatch(/Romaneio|Separado|no armazém/);
  expect(textosDaTela(render("pronta", edicaoEm("confirmado")))).not.toContain("Cancelar");
});
it("o diálogo do cancelar aberto: a pergunta, o botão em andamento e a falha ficam nele", () => {
  const html = render("pronta", EDICAO_ENVIADA_SO_COLETA, { cancelar: { ...CANCELAR_FECHADO, aberto: true, ocupado: true, erro: "A edição já foi confirmada." } });
  expect(textosDaTela(html)).toEqual(expect.arrayContaining(["Cancelar a edição 2027?", "Cancelando…", "A edição já foi confirmada."]));
});
it("carregando, não encontrada, erro e o axe", async () => {
  expect(textosDaTela(render("carregando", null))).toEqual(["Eventos"]);
  expect(textosDaTela(render("nao_encontrada", null))).toContain("Edição não encontrada");
  expect(render("erro", null)).toMatch(/role="alert"[^>]*>Não foi possível carregar a edição\./);
  for (const html of [render("pronta", EDICAO_DA_NECTON), render("pronta", EDICAO_ENVIADA_SO_COLETA, { cancelar: CANCELAR_FECHADO })]) expect(await violacoesDeAcessibilidade(html)).toEqual([]);
});
```

`evento-formulario-registrada.test.tsx` (jsdom, no molde de `evento-formulario-rascunho.test.tsx` da parte 4: `vi.mock("@/lib/eventos/use-eventos")` com `useEdicaoDoEvento` devolvendo `{ edicao: estado.edicao, erro: false, tentando: false, tentar: vi.fn(), falta: null, lidaEm: null }`, o resto que `ClienteEventoEdicao` lê simulado como lá, e `vi.mock("@/pages/client/evento-registrado", () => ({ ClienteEventoRegistrado: ({ id }: { id: string }) => <p>Edição registrada {id}</p> }))`; monta em `/portal/eventos/edicao?id=ced_necton2027`; `ate` espera o estado chegar, como em `components/portal/sino-carregando.test.tsx`, sem tempo fixo):

```ts
it("fora de rascunho, a rota da edição abre a edição registrada, não a lista", async () => {
  estado.edicao = edicaoEm("enviado", { id: "ced_necton2027" });
  // monta ClienteEventoEdicao
  await ate(() => document.body.textContent?.includes("Edição registrada ced_necton2027"));
  expect(window.location.pathname).toBe("/portal/eventos/edicao");
});
it("a edição apagada ou de outro cliente continua voltando à lista", async () => {
  estado.edicao = null;
  // monta ClienteEventoEdicao
  await ate(() => window.location.pathname === "/portal/eventos");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/registrada.test.ts src/pages/client/evento-registrado-view.test.tsx src/pages/client/evento-formulario-registrada.test.tsx`
Expected: FAIL (módulos não existem; fora de `rascunho`, a rota ainda volta à lista).

- [ ] **Step 3: Implement `registrada.ts`, the fixture, the view, the container and the branch of `ClienteEventoEdicao`**

A view na moldura de `comprovante-view.tsx` (`max-w-5xl`; a barra `no-print`
com o link "Eventos" para `/portal/eventos`, o selo do status, "PDF da
edição" e "Nova edição a partir desta", que até a T5 liga para
`/portal/eventos/novo`); o `<article class="print-area">` envolve a edição.
"O que foi e o que voltou": os chips "Todos · N" e "Com diferença · N", a
busca (`aria-label="Buscar item"`), `LINHAS_A_VISTA_DO_QUE_FOI` linhas,
`textoDoMostrando(LINHAS_A_VISTA_DO_QUE_FOI, N)` ("Mostrando 8 de N itens") e
"Ver os N itens", que abre um `Dialog` só de leitura com a lista inteira, a
mesma busca e o mesmo filtro, de `PAGINA_DO_VER_MAIS` em `PAGINA_DO_VER_MAIS`
(os dois da parte 4). O cancelar é a `Confirmacao`
(`perigo`; "Cancelar a edição <label>?"; confirmar "Cancelar edição",
confirmando "Cancelando…"); o contêiner fecha no sucesso com o toast e deixa a
falha no diálogo. O contêiner lê a edição por `useEdicaoDoEvento(id)` (nunca
por `useDocumentoDoPortal` direto) e as edições do evento por
`useLeituraDoPortal`, com `edicaoDaLeitura` no `mapear`. Em
`evento-formulario.tsx`, o `ClienteEventoEdicao` da parte 4 troca, fora de
`rascunho`, o `Redirect` por
`<ClienteEventoRegistrado id={id} />` (importado de `./evento-registrado`);
o `null` continua no `Redirect` a `ROTA_EVENTOS`, e `App.tsx` e `index.ts`
não mudam. Se um teste da parte 4 afirma o `Redirect` fora de `rascunho`,
ele passa a afirmar a edição registrada e entra no commit.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2 e `cd C:\DEV\Dute; corepack pnpm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos/registrada.ts artifacts/app/src/lib/eventos/registrada.test.ts artifacts/app/src/test/edicao-da-necton.ts artifacts/app/src/pages/client/evento-registrado-view.tsx artifacts/app/src/pages/client/evento-registrado-view.test.tsx artifacts/app/src/pages/client/evento-registrado.tsx artifacts/app/src/pages/client/evento-formulario.tsx artifacts/app/src/pages/client/evento-formulario-registrada.test.tsx
git commit -m "feat(app): a edição registrada do evento no portal, com o cancelar da enviada"
```

### Task 2: o romaneio do cliente

**Files:**
- Create: `artifacts/app/src/lib/eventos/romaneio.ts`, `artifacts/app/src/pages/client/evento-romaneio-view.tsx`, `artifacts/app/src/pages/client/evento-romaneio.tsx`
- Modify: `artifacts/app/src/pages/client/index.ts`; `artifacts/app/src/App.tsx` (o `telaSobDemanda("pages/client", …)` de `ClienteEventoRomaneio`, como o de `ClienteEventos`, linhas 98 a 100, e a rota num spread próprio sob `EVENTOS_LIBERADO`, logo depois do da parte 4: `...(EVENTOS_LIBERADO ? [protectedRoute("/portal/eventos/romaneio", ClienteEventoRomaneio)] : [])`; o literal das duas rotas da parte 4, que `platform-lists.test.ts` trava, não muda); `artifacts/app/src/lib/modules.ts` (linha 962, depois de `/portal/servicos/comprovante`: `{ path: "/portal/eventos/romaneio", roles: CLIENT_ROLES }`); `artifacts/app/src/lib/document-title.ts` (linhas 39 e 40: `{ path: "/portal/eventos/romaneio", label: "Romaneio" }`)
- Test: `artifacts/app/src/lib/eventos/romaneio.test.ts`; `artifacts/app/src/pages/client/evento-romaneio-view.test.tsx`; `artifacts/app/src/lib/modules.test.ts` (`ROUTE_ACCESS`, linhas 108 a 120: `["/portal/eventos/romaneio", ["cliente"]]`; `portalModuleForPath("/portal/eventos/romaneio?id=ced_1")` → `"events"` no `it` das linhas 429 a 438); `artifacts/app/src/lib/document-title.test.ts` (linha 63: `["/portal/eventos/romaneio", "Dutelog | Romaneio"]`)

**Interfaces:**
- Consumes: `EVENTOS_LIBERADO` (`lib/liberacao.ts`, parte 1), para o spread da rota; `RomaneioDocumento` (`features/warehouse-ops/romaneio-documento.tsx`); `FolhaDoRomaneio`, `periodoDaSeparacao` (`lib/warehouse-ops/romaneio.ts`, linhas 12 a 51); `VolumeDoPedido`, `ItemDoVolume` (`lib/warehouse-ops/volumes-do-pedido.ts`, linhas 29 a 53); `pedidos-romaneio-view.tsx` (linhas 19 a 26 e 54 a 121) como molde; T1 (`EDICAO_DA_NECTON`, `hrefDoRomaneioDaEdicao`); `hrefDaEdicao`, `idDaEdicaoNaBusca` (parte 4); `nomeComTamanho`; `useEdicaoDoEvento(id)` (parte 4, `lib/eventos/use-eventos.ts`: a edição, sem `useDocumentoDoPortal` direto); `useClientOverview` (`pages/client/shared.tsx`, linha 417) para o nome do cliente.
- Produces (`lib/eventos/romaneio.ts`): `volumesDaEdicao(pedido: EdicaoView["pedido"]): VolumeDoPedido[]` (`id: "vol_<numero>"`, `aberto: false`, `unidades` = soma das `quantidade`, `caixa: null`, `pesoKg: peso_kg ?? null`, `fechadoEm: null`, `itens: [{ nome: nomeComTamanho({ nome: product_name, codigo: client_item_code, tamanho: size }), codigo: client_item_code, quantidade, tamanho? }]`); `folhaDoRomaneioDaEdicao(edicao, cliente: string): FolhaDoRomaneio | null` (null sem `pedido` ou sem `volumes`; `numero: order_number`, `destino: "<local> · <endereco>"`, `paraQuando`: o previsto de `entrega_no_local` como "28/01/2027 08:30", `lacre`, `separado: periodoDaSeparacao(separado_em, separado_em)`, `por: ""`); `type EstadoDoRomaneioDoEvento = "carregando" | "nao_encontrada" | "erro" | "sem_pedido" | "em_separacao" | "pronto"`; `estadoDoRomaneioDaEdicao(edicao: EdicaoView | null | undefined, erro: boolean)`.
- Produces (páginas): `EventoRomaneioView({ estado, folha, voltar: { href, rotulo }, onImprimir, onTentar?, leitura? })` com `MENSAGENS = { carregando: "Carregando o romaneio…", nao_encontrada: "Edição não encontrada", erro: "Não foi possível carregar o romaneio.", sem_pedido: "Esta edição não tem pedido.", em_separacao: "Pedido em separação" }`; `ClienteEventoRomaneio()` (o `id` por `idDaEdicaoNaBusca`, a edição por `useEdicaoDoEvento(id)` e o `estado` por `estadoDoRomaneioDaEdicao(edicao, erro)`).

- [ ] **Step 1: Write the failing tests**

```ts
// romaneio.test.ts
it("a folha sai da cópia da edição: sem caixa nem quem separou, com o destino e o para quando", () => {
  const folha = folhaDoRomaneioDaEdicao(EDICAO_DA_NECTON, "BTG Pactual")!;
  expect(folha).toMatchObject({ numero: "PED-0007", cliente: "BTG Pactual", destino: "Hotel Unique · Av. Brigadeiro Luís Antônio, 4700 · Jardim Paulista · São Paulo/SP", paraQuando: "28/01/2027 08:30", lacre: "88412", separado: "26/01/2027", por: "" });
  expect(folha.volumes[0]).toMatchObject({ numero: 1, caixa: null, itens: [{ nome: "Polo Masculino Piquet Arpoador · G", codigo: "A.01.0809.002.G", quantidade: 200 }] });
  expect(folha.unidades).toBe(folha.volumes.reduce((soma, volume) => soma + volume.unidades, 0));
});
it("o estado: sem pedido, em separação, lendo, não encontrada e erro", () => {
  expect(folhaDoRomaneioDaEdicao(EDICAO_ENVIADA_SO_COLETA, "BTG Pactual")).toBeNull();
  expect([EDICAO_ENVIADA_SO_COLETA, edicaoEm("confirmado"), undefined, null].map((e) => estadoDoRomaneioDaEdicao(e, false))).toEqual(["sem_pedido", "em_separacao", "carregando", "nao_encontrada"]);
  expect(estadoDoRomaneioDaEdicao(undefined, true)).toBe("erro");
});
// evento-romaneio-view.test.tsx
it("a barra fora do papel e a folha; nada de caixa, posição ou valor; cada estado só com a frase dele; axe", async () => {
  const html = render("pronto", folhaDoRomaneioDaEdicao(EDICAO_DA_NECTON, "BTG Pactual"));
  expect(textosDaTela(html).slice(0, 3)).toEqual(["B2B Conference Necton · 2027", "Romaneio", "Imprimir"]);
  expect(html).toMatch(/<article aria-label="Romaneio PED-0007" class="print-area /);
  expect(html).not.toMatch(/CX-|R\$/);
  for (const [estado, frase] of Object.entries(MENSAGENS)) expect(textosDaTela(render(estado as EstadoDoRomaneioDoEvento, null))).toEqual(["B2B Conference Necton · 2027", "Romaneio", "Imprimir", frase]);
  expect(await violacoesDeAcessibilidade(html)).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/romaneio.test.ts src/pages/client/evento-romaneio-view.test.tsx src/lib/modules.test.ts src/lib/document-title.test.ts`
Expected: FAIL (módulos não existem; a rota sem papel cai no padrão interno).

- [ ] **Step 3: Implement**

A view é `pedidos-romaneio-view.tsx` no visual do portal (a barra de
`comprovante-view.tsx`, sem `PageHeader`), o `voltar` para `hrefDaEdicao(id)`
com o rótulo "<nome do evento> · <label>", "Imprimir" → `window.print()`,
desligado fora de `pronto`. O contêiner lê a edição por
`useEdicaoDoEvento(id)` da parte 4 (nunca por `useDocumentoDoPortal` direto;
o `edicao` e o `erro` dele vão a `estadoDoRomaneioDaEdicao`) e o nome do
cliente por `useClientOverview`. Registre a rota (no spread
próprio, sem tocar o literal da parte 4), o papel, o título e os exports.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, `npx vitest run src/lib/platform-lists.test.ts` (o literal das rotas da parte 4 continua verde) e `cd C:\DEV\Dute; corepack pnpm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos/romaneio.ts artifacts/app/src/lib/eventos/romaneio.test.ts artifacts/app/src/pages/client/evento-romaneio-view.tsx artifacts/app/src/pages/client/evento-romaneio-view.test.tsx artifacts/app/src/pages/client/evento-romaneio.tsx artifacts/app/src/pages/client/index.ts artifacts/app/src/App.tsx artifacts/app/src/lib/modules.ts artifacts/app/src/lib/modules.test.ts artifacts/app/src/lib/document-title.ts artifacts/app/src/lib/document-title.test.ts
git commit -m "feat(app): o romaneio da edição do evento no portal, da cópia dos volumes"
```

### Task 3: o preço, o valor declarado e a proposta

**Files:**
- Modify: `artifacts/app/src/lib/eventos/registrada.ts`; `artifacts/app/src/test/edicao-da-necton.ts` (`PRECO_DA_NECTON`); `artifacts/app/src/pages/client/evento-registrado-view.tsx`; `artifacts/app/src/pages/client/evento-registrado.tsx`
- Test: `artifacts/app/src/lib/eventos/registrada.test.ts`; `artifacts/app/src/pages/client/evento-registrado-view.test.tsx`

**Interfaces:**
- Consumes: `formatarReais(centavos)` de `@workspace/dominio` ("R$ 9.800,00"); `useDocumentoDoPortal` (só o preço; a edição segue por `useEdicaoDoEvento(id)`, T1); o documento `client_event_prices/{edition_id}` do índice (`valor_declarado_cents`, `fechado_cents`, `fechado_observacao`, `fechado_em`, `documentos[]` com `caminho`, `nome`, `registrado_em`).
- Produces: `type PrecoDoPortal = { fechado: string | null; cobre: string | null; fechadoEm: string | null; valorDeclarado: string | null; valorDeclaradoCents: number | null; proposta: { caminho: string; nome: string; data: string | null } | null }`; `precoDoPortal(data: Record<string, unknown> | null | undefined): PrecoDoPortal` (sem documento ou sem `fechado_cents`, `fechado: null`; a proposta é o primeiro de `documentos`; o tipo e a função não repetem o `PrecoDaEdicao` da leitura da parte 4, em `lib/eventos/leitura.ts`, nem o `PrecoView` e o `usePrecoView` da parte 10: o índice lista os pares); `linhasDoPreco(preco): Array<[rotulo: string, valor: string]>` → `[["Cobre", "Frete, equipe e montagem"], ["Fechado em", "05/12/2026"], ["Valor declarado", "R$ 86.400,00"]]`, só o que existe. Na view, a prop `preco`, o cartão "Preço fechado" ("R$ 9.800,00" e a observação, ou "Sem preço fechado") e o bloco "Preço fechado" com as linhas e "Proposta" com "Abrir" (a URL vem da T4; até lá, só o nome).

- [ ] **Step 1: Write the failing tests**

```ts
it("o preço vem do documento de preço, nunca da edição", () => {
  expect(precoDoPortal({ fechado_cents: 980000, fechado_observacao: "Frete, equipe e montagem", fechado_em: "2026-12-05T14:02:00.000Z", valor_declarado_cents: 8640000, documentos: [{ caminho: "eventos/BTG/ced_necton2027/valores/dc_0123456789abcdef.pdf", nome: "proposta-necton-2027.pdf", registrado_em: "2026-12-05T14:02:00.000Z" }] }))
    .toEqual({ fechado: "R$ 9.800,00", cobre: "Frete, equipe e montagem", fechadoEm: "05/12/2026", valorDeclarado: "R$ 86.400,00", valorDeclaradoCents: 8640000, proposta: { caminho: "eventos/BTG/ced_necton2027/valores/dc_0123456789abcdef.pdf", nome: "proposta-necton-2027.pdf", data: "05/12/2026" } });
  expect(precoDoPortal(null)).toEqual({ fechado: null, cobre: null, fechadoEm: null, valorDeclarado: null, valorDeclaradoCents: null, proposta: null });
  expect(precoDoPortal({ valor_declarado_cents: 8640000 }).fechado).toBeNull();
});
// na view
it("com preço: o cartão e o bloco com Cobre, Fechado em, Valor declarado e Proposta; sem: 'Sem preço fechado' e nenhum R$", () => {
  const html = render("pronta", EDICAO_DA_NECTON, { preco: PRECO_DA_NECTON });
  expect(textosDaTela(html)).toEqual(expect.arrayContaining(["Preço fechado", "R$ 9.800,00", "Frete, equipe e montagem", "Cobre", "Fechado em", "05/12/2026", "Valor declarado", "R$ 86.400,00", "Proposta", "proposta-necton-2027.pdf"]));
  expect(html.match(/R\$/g)).toHaveLength(3);
  const sem = render("pronta", EDICAO_DA_NECTON, { preco: precoDoPortal(null) });
  expect(textosDaTela(sem)).toContain("Sem preço fechado");
  expect(sem).not.toMatch(/R\$|Fatura/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/registrada.test.ts src/pages/client/evento-registrado-view.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement**

O contêiner assina `client_event_prices/<id>` com `useDocumentoDoPortal` (a
regra deixa o próprio cliente ler); o documento ausente é `null` e vira
`precoDoPortal(null)`, não erro. O cartão da capa some em `enviado` sem preço
e dá lugar a "Sem preço fechado" no bloco.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos/registrada.ts artifacts/app/src/lib/eventos/registrada.test.ts artifacts/app/src/test/edicao-da-necton.ts artifacts/app/src/pages/client/evento-registrado-view.tsx artifacts/app/src/pages/client/evento-registrado-view.test.tsx artifacts/app/src/pages/client/evento-registrado.tsx
git commit -m "feat(app): o preço fechado, o valor declarado e a proposta na edição do portal"
```

### Task 4: fotos e documentos

**Files:**
- Modify: `artifacts/app/src/lib/eventos/registrada.ts`; `artifacts/app/src/test/edicao-da-necton.ts` (`URLS_DA_NECTON`); `artifacts/app/src/pages/client/evento-registrado-view.tsx`; `artifacts/app/src/pages/client/evento-registrado.tsx`
- Test: `artifacts/app/src/lib/eventos/registrada.test.ts`; `artifacts/app/src/pages/client/evento-registrado-view.test.tsx`

**Interfaces:**
- Consumes: `useUrlsDasFotosComEstado(caminhos)` (`lib/operacao/use-urls-das-fotos.ts`, linha 24: `urls`, `lendo`, `falharam`, `tentando`, `tentar`); `FalhaNaSecao`; `fotos[]` (`caminho`, `momento_id`, `legenda`, `instante`) e `documentos[]` (`id`, `caminho`, `nome`, `origem`, `momento_id`, `registrado_em`) da edição; `pedido.comprovante`, `pedido.entregue_em`; T1 (`hrefDoRomaneioDaEdicao`); T3 (`PrecoDoPortal.proposta`); o `<a target="_blank" rel="noreferrer">` de `pages/client/documentos.tsx`, linha 152.
- Produces: `type GrupoDeFotos = { momentoId: string; titulo: string; fotos: Array<{ caminho: string; legenda: string | null; alt: string }> }`; `gruposDeFotosDoPortal(edicao): GrupoDeFotos[]` (o nome não repete o `fotosPorMomento(fotos)` de `ficha.ts`, parte 8; na ordem do cronograma; `titulo` "Montagem · 28/01 · 6 fotos"; `alt` "Foto 1 de Montagem"); `FOTOS_A_VISTA = 6`; `type LinhaDeDocumento = { chave: string; titulo: string; detalhe: string; caminho: string | null; href: string | null }`; `documentosDaEdicao(edicao, preco): LinhaDeDocumento[]`: os `documentos` do cliente ("layout-necton-2027.pdf", "pelo cliente · 20/11/2026"), os da Dutelog ("pela Dutelog · Entrega no local · 28/01/2027" quando têm momento), a proposta ("Proposta · proposta-necton-2027.pdf", "05/12/2026"), o romaneio ("Romaneio PED-0007", "38 volumes · lacre 88412", `href`) e, sem documento da Dutelog em `entrega_no_local`, o comprovante como texto ("Comprovante de entrega", `pedido.comprovante` + " · " + `diaEHoraCurtos(entregue_em)`, sem `caminho` nem `href`). Na view: `urls`, `fotos: { lendo, falharam, tentando, onTentar }` e `onVerTodas(momentoId)`; a view decide os caminhos à vista (seis por grupo até "Ver as N fotos", mais os documentos) e o contêiner só pede URL deles.

- [ ] **Step 1: Write the failing tests**

```ts
it("as fotos por momento e os documentos, com o romaneio e o comprovante", () => {
  expect(gruposDeFotosDoPortal(EDICAO_DA_NECTON).map((g) => g.titulo)).toEqual(["Coleta no cliente · 28/01 · 1 foto", "Montagem · 28/01 · 6 fotos", "Evento · 29/01 · 4 fotos", "Desmontagem e coleta · 29/01 · 2 fotos", "Retorno ao estoque Dutelog · 30/01 · 2 fotos"]);
  expect(gruposDeFotosDoPortal(EDICAO_DA_NECTON)[1].fotos[0].alt).toBe("Foto 1 de Montagem");
  const documentos = documentosDaEdicao(EDICAO_DA_NECTON, PRECO_DA_NECTON);
  expect(documentos.map((d) => d.titulo)).toEqual(["layout-necton-2027.pdf", "produtos-b2b-conference.xlsx", "Proposta · proposta-necton-2027.pdf", "Romaneio PED-0007", "Comprovante de entrega"]);
  expect(documentos[3]).toMatchObject({ detalhe: "38 volumes · lacre 88412", href: "/portal/eventos/romaneio?id=ced_necton2027", caminho: null });
  expect(documentosDaEdicao(EDICAO_ENVIADA_SO_COLETA, precoDoPortal(null))).toEqual([]);
});
// na view
it("seis fotos à vista por momento e 'Ver as 6 fotos'; a URL que não veio é dita, nunca some calada; Abrir abre o arquivo", () => {
  const html = render("pronta", EDICAO_DA_NECTON, { preco: PRECO_DA_NECTON, urls: URLS_DA_NECTON, fotos: { lendo: false, falharam: [CAMINHO_DA_FOTO_2], tentando: false, onTentar } });
  expect(html.match(/<img [^>]*alt="Foto \d+ de Montagem"/g)).toHaveLength(5);
  expect(textosDaTela(html)).toEqual(expect.arrayContaining(["Ver as 6 fotos", "Uma imagem não carregou.", "Tentar de novo", "Documentos", "Abrir"]));
  expect(html).toMatch(/<a [^>]*href="https:\/\/exemplo.invalid\/layout.pdf"[^>]*target="_blank"[^>]*rel="noreferrer"/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: o comando da T3. Expected: FAIL.

- [ ] **Step 3: Implement**

A foto abre a imagem inteira em `<a target="_blank">`; a que falhou sai como
caixa com "Não carregou", como `comprovante-documento.tsx`. "Abrir" do
documento é `<a href={url} target="_blank" rel="noreferrer">` ou, no
romaneio, o `Link` da rota; sem URL ainda, fica o nome. A falha das imagens:
"Uma imagem não carregou." / "N imagens não carregaram.", com "Tentar de novo".

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando da T3 e `cd C:\DEV\Dute; corepack pnpm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos/registrada.ts artifacts/app/src/lib/eventos/registrada.test.ts artifacts/app/src/test/edicao-da-necton.ts artifacts/app/src/pages/client/evento-registrado-view.tsx artifacts/app/src/pages/client/evento-registrado-view.test.tsx artifacts/app/src/pages/client/evento-registrado.tsx
git commit -m "feat(app): as fotos por momento e os documentos da edição no portal"
```

### Task 5: "Nova edição a partir desta"

**Files:**
- Create: `artifacts/app/src/lib/eventos/nova-edicao.ts`
- Modify: `artifacts/app/src/pages/client/evento-formulario.tsx` (parte 4: o pré-preenchimento pela busca `?a_partir_de=`); `artifacts/app/src/pages/client/eventos.tsx` (parte 4: o `href` de "Nova edição a partir de <label>"); `artifacts/app/src/pages/client/evento-registrado-view.tsx` (o `href` do botão)
- Test: `artifacts/app/src/lib/eventos/nova-edicao.test.ts`; `artifacts/app/src/pages/client/evento-formulario.a-partir-de.test.tsx`

**Interfaces:**
- Consumes: `salvarEdicao(entrada)` (`lib/wms/eventos.ts`, parte 2; a criação leva `idempotency_key`, `event_id`, `origem_edicao_id`, `patch`); `ConteudoDaEdicao`, `MomentoPrevisto` (parte 2); `itemDeEntrada(item: ItemLido): ItemDeEntrada` (parte 4, `lib/eventos/itens.ts`: reduz o item lido aos seis campos de entrada, `sku_code`, `client_item_code`, `product_name`, `size`, `category` e `quantity`, porque `ItemDaEdicaoSchema` é `.strict()`); T3 (`precoDoPortal` e `PrecoDoPortal.valorDeclaradoCents`); `useEdicaoDoEvento(id)` (parte 4) para a origem, sem `useDocumentoDoPortal` direto na edição, e `useDocumentoDoPortal` só para o preço dela; o Firestore simulado como em `lib/portal/leitura-do-portal.test.tsx`, linhas 15 a 40.
- Produces: `hrefDaNovaEdicao(editionId: string): string` → `/portal/eventos/novo?a_partir_de=<id>`; `aPartirDeDaBusca(busca: string): string | null`; `type MomentoSemData = Omit<MomentoPrevisto, "data" | "id"> & { data: "" }`; `conteudoDaNovaEdicao(origem: EdicaoView, preco: { valorDeclaradoCents: number | null } | null): { eventId: string; patch: ConteudoDaEdicao; cronogramaSemData: MomentoSemData[] }`: `patch` com `onde`, `itens` (`origem.itens.map(itemDeEntrada)`, a redução da parte 4, sem uma própria: só `sku_code`, `client_item_code`, `product_name`, `size`, `category`, `quantity`; nunca `foi`, `voltou`, `avariadas`, `nao_voltaram`, `observacao`), `coleta` (`onde`, `quantidade`, `valor_declarado_cents` quando houver; nunca `voltou`/`distribuidos`; a coleta não tem `observacao`) e `observacoes`; sem `label` e sem `cronograma`; `cronogramaSemData`: cada momento com `tipo`, `rotulo`, `hora`, `ate`, `local`, `observacao` e `data: ""`, sem `feito` e sem `id` (são momentos novos: o `mo_` de cada um nasce no servidor quando a linha é gravada). No formulário: com `?a_partir_de=`, lê a origem por `useEdicaoDoEvento(aPartirDe)` e o preço dela por `useDocumentoDoPortal` com `precoDoPortal`, cria a edição na hora (`salvarEdicao({ idempotency_key, event_id, origem_edicao_id, patch })`, uma vez, a chave no estado), troca a rota para `edicao?id=` sem entrada no histórico e preenche as linhas do cronograma com `cronogramaSemData`, cada uma com `id: null` (`LinhaDoCronograma.id`, parte 4; o autosave da parte 4 as grava quando a data é digitada).

- [ ] **Step 1: Write the failing tests**

```ts
// nova-edicao.test.ts
it("copia o que se repete e deixa de fora as datas e o feito", () => {
  const nova = conteudoDaNovaEdicao(EDICAO_DA_NECTON, { valorDeclaradoCents: 8640000 });
  expect(nova.eventId).toBe(EDICAO_DA_NECTON.event_id);
  expect(Object.keys(nova.patch).sort()).toEqual(["coleta", "itens", "observacoes", "onde"]);
  expect(nova.patch.itens![0]).toEqual({ sku_code: "BTG-000101", client_item_code: "A.01.0809.002.G", product_name: "Polo Masculino Piquet Arpoador", size: "G", category: "Polo", quantity: 200 });
  expect(nova.patch.itens).toEqual(EDICAO_DA_NECTON.itens.map(itemDeEntrada)); // a redução da parte 4, não uma própria
  expect(nova.patch.coleta).toEqual({ onde: "BTG Pactual · Faria Lima, 3477", quantidade: 2190, valor_declarado_cents: 8640000 });
  expect(nova.cronogramaSemData.map((m) => [m.tipo, m.data, m.hora])).toEqual([["coleta_no_cliente", "", "05:00"], ["entrega_no_local", "", "08:30"], ["montagem", "", "10:00"], ["evento", "", "08:00"], ["desmontagem", "", "20:00"], ["retorno_ao_estoque", "", "09:00"], ["entrega_de_volta", "", "10:00"]]);
  expect(nova.cronogramaSemData.some((m) => "id" in m)).toBe(false);
  expect(JSON.stringify(nova)).not.toMatch(/feito|voltou|avariadas|nao_voltaram|"label"/);
  expect(hrefDaNovaEdicao("ced_necton2027")).toBe("/portal/eventos/novo?a_partir_de=ced_necton2027");
  expect(aPartirDeDaBusca("?a_partir_de=ced_necton2027")).toBe("ced_necton2027");
});
// evento-formulario.a-partir-de.test.tsx (jsdom; vi.mock de "@/lib/wms/eventos" devolvendo { id: "ced_nova", edicao: 1, created: true, edition })
it("abre pré-preenchido, grava uma vez com origem_edicao_id e passa a edicao?id= sem entrada no histórico", async () => {
  // monta em /portal/eventos/novo?a_partir_de=ced_necton2027; as assinaturas (a origem por useEdicaoDoEvento, o preço por useDocumentoDoPortal) devolvem EDICAO_DA_NECTON e o preço dela
  await ate(() => salvarEdicao.mock.calls.length === 1);
  expect(salvarEdicao.mock.calls[0][0]).toMatchObject({ event_id: EDICAO_DA_NECTON.event_id, origem_edicao_id: "ced_necton2027", patch: expect.objectContaining({ itens: EDICAO_DA_NECTON.itens.map(itemDeEntrada) }) });
  expect(salvarEdicao.mock.calls[0][0]).not.toHaveProperty("patch.cronograma");
  expect(window.location.search).toBe("?id=ced_nova");
  expect(window.history.length).toBe(comprimentoAntes);
  expect([...document.querySelectorAll('input[aria-label^="Data"]')].map((i) => (i as HTMLInputElement).value)).toEqual(["", "", "", "", "", "", ""]);
  expect(document.body.textContent).toContain("B2B Conference Necton");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/nova-edicao.test.ts src/pages/client/evento-formulario.a-partir-de.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement**

`nova-edicao.ts` puro. No formulário da parte 4, o pré-preenchimento entra
onde ele guarda o estado da aba antes do nascimento: com `a_partir_de`, o
nome do evento já existe (o evento é o mesmo), então a criação sai na
primeira renderização com a origem lida; os `aria-label` das datas são os da
parte 4 (confira e ajuste o seletor do teste). O botão da lista e o da edição
registrada passam a `hrefDaNovaEdicao(id)`. Os itens da origem passam pela
`itemDeEntrada` da parte 4 (`lib/eventos/itens.ts`), sem redução própria.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, os testes da parte 4 (`npx vitest run src/pages/client`) e `cd C:\DEV\Dute; corepack pnpm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos/nova-edicao.ts artifacts/app/src/lib/eventos/nova-edicao.test.ts artifacts/app/src/pages/client/evento-formulario.tsx artifacts/app/src/pages/client/evento-formulario.a-partir-de.test.tsx artifacts/app/src/pages/client/eventos.tsx artifacts/app/src/pages/client/evento-registrado-view.tsx
git commit -m "feat(app): a nova edição do evento a partir da anterior, sem datas e sem o feito"
```

### Pronto quando

No emulador, com a edição da Necton das partes 2 a 10 (enviada, confirmada
com preço e proposta, separada em 38 volumes, entregue, registrada, retornada
e fechada): `/portal/eventos/edicao?id=`, aberta pelo "Abrir" da lista da
parte 4, mostra a edição como a prancha, com o previsto ×
feito, o que foi e o que voltou, o preço, a proposta, as 15 fotos e os
documentos; "Romaneio" imprime a folha da cópia dos volumes; a edição
`enviado` cancela pelo portal; "Nova edição a partir desta" abre o formulário
com os itens, o onde e a coleta e sem datas, e a edição nova nasce com
`origem_edicao_id`. Textos e `axe` verdes em cada view;
`corepack pnpm run typecheck` e `npx vitest run src/pages/client src/lib/eventos src/lib/modules.test.ts src/lib/document-title.test.ts src/lib/platform-lists.test.ts` verdes;
`git status` só com os arquivos desta parte. O PR registra em
`docs/superpowers/plans/2026-11-26-eventos.md` o que mudou de nome, se mudou.
