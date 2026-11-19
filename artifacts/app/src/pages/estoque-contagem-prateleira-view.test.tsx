import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import type { LinhaDeEntrada } from "@/lib/warehouse-ops/caixas-da-separacao";
import { RODADA_DA_RECONTAGEM_GERAL, bancadaDaPrateleira, linhaRecontada, produtosDoCliente, recontagensDasLinhas, type ContagemDigitada } from "@/lib/warehouse-ops/recontagem-por-caixa";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela as textosComAsCamadas } from "@/test/textos";

import { EstoqueContagemPrateleiraView, type EstadoDaPrateleira } from "./estoque-contagem-prateleira-view";

/**
 * Estoque › Contagem por caixa › a prateleira (diagnóstico da Contagem
 * cíclica, seção 6, item 4; docs/mockups/WmsContagemPrateleira.dc.html e
 * WmsContagemCelular.dc.html): as caixas com o esperado e a reserva antes de
 * digitar, a caixa em contagem com a diferença antes de gravar, a
 * confirmada com a origem da peça a mais. Antes, a recontagem só gravava o
 * total do SKU na prateleira (achado F01). Dados sintéticos.
 */

/** As camadas escondidas do BotaoDeAcao que podem estar no HTML: o gerúndio e o "Conferir". */
const CAMADAS = ["Confirmando…", "Conferir"];

/** Os textos da tela, só com a camada atual de cada BotaoDeAcao; as outras precisam estar na lista. */
function textosDaTela(html: string): string[] {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  for (const camada of dom.window.document.querySelectorAll(".botao-acao-camada:not([data-atual])")) {
    const texto = camada.textContent?.trim() ?? "";
    const atual = camada.closest("button")?.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim();
    if (texto && !CAMADAS.includes(texto) && texto !== atual) throw new Error(`Camada fora da lista: ${texto}`);
    camada.remove();
  }
  const limpo = dom.window.document.body.innerHTML;
  dom.window.close();
  return textosComAsCamadas(limpo);
}

const BTG = "BTG Pactual";
const RODADA = RODADA_DA_RECONTAGEM_GERAL.id;
const AGORA = new Date("2026-11-17T13:00:00.000Z"); // 10:00 de 17/11 em São Paulo
const P = { sku_code: "BTG-000121", client_item_code: "A.01.0806.005.P", product_name: "Polo Masculino Piquet Preto", size: "P" };
const M = { sku_code: "BTG-000123", client_item_code: "A.01.0806.005.M", product_name: "Polo Masculino Piquet Preto", size: "M" };
const G = { sku_code: "BTG-000124", client_item_code: "A.01.0806.005.G", product_name: "Polo Masculino Piquet Preto", size: "G" };
const GG = { sku_code: "BTG-000125", client_item_code: "A.01.0806.005.GG", product_name: "Polo Masculino Piquet Preto", size: "GG" };

const caixa = (code: string, extra: Record<string, unknown> = {}) =>
  warehouseBoxFromRecord({ code, customer_code: BTG, status: "stored", location_id: "A-03", stored_at: "2026-10-20T12:00:00.000Z", unit_count: 60, origin: { kind: "opening_inventory", session_id: "s1" }, ...extra });

const ABERTURA: LinhaDeEntrada[] = [
  { box_code: "CX-000010", ...P, counted_qty: 60 },
  { box_code: "CX-000011", ...M, counted_qty: 60 },
  { box_code: "CX-000012", ...M, counted_qty: 60 },
  { box_code: "CX-000013", ...G, counted_qty: 80 },
];

const gravada = (id: string, extra: Record<string, unknown>) =>
  linhaRecontada(id, { customer_code: BTG, location_id: "A-03", mode: "box", round_id: RODADA, actor: { name: "Guilherme Dantas" }, ...extra })!;

const RECONTAGENS = recontagensDasLinhas(
  [
    gravada("cc_1", { box_recount_id: "brc_010", box_code: "CX-000010", ...P, qty_before: 60, counted_qty: 60, adjustment_delta: 0, occurred_at: "2026-11-17T12:02:00.000Z" }),
    gravada("cc_2", { box_recount_id: "brc_011", box_code: "CX-000011", ...M, qty_before: 60, counted_qty: 55, adjustment_delta: -5, occurred_at: "2026-11-17T12:11:00.000Z" }),
    gravada("cc_3", { box_recount_id: "brc_011", box_code: "CX-000011", ...GG, out_of_list: true, qty_before: 0, counted_qty: 2, adjustment_delta: 2, origins: [{ kind: "box", box_code: "CX-000014", qty: 2 }], occurred_at: "2026-11-17T12:11:00.000Z" }),
  ],
  BTG,
);

const BANCADA = bancadaDaPrateleira({
  cliente: BTG,
  posicao: "A-03",
  posicoes: [{ code: "A-03", aisle: "A", shelf: 3, sequence: 3, customer_code: BTG }],
  caixas: [
    caixa("CX-000010"),
    // Recontada às 09:11: a falta da M e a GG achada, gravadas na caixa como ajustes (count_adjustments).
    caixa("CX-000011", {
      last_recount_id: "brc_011",
      last_recount_round_id: RODADA,
      // A recontagem com diferença muda o saldo da caixa: a etiqueta dela fica para trocar até a impressão.
      balance_at: "2026-11-17T12:11:00.000Z",
      count_adjustments: [
        { recount_id: "brc_011", sku_code: M.sku_code, qty: -5 },
        { recount_id: "brc_011", ...GG, qty: 2 },
      ],
    }),
    caixa("CX-000012"),
    caixa("CX-000013", { unit_count: 80 }),
  ],
  abertura: ABERTURA,
  saldos: [
    { location_id: "A-03", sku_code: P.sku_code, qty_on_hand: 60, qty_reserved: 20, customer_code: BTG },
    { location_id: "A-03", sku_code: M.sku_code, qty_on_hand: 115, customer_code: BTG },
    { location_id: "A-03", sku_code: G.sku_code, qty_on_hand: 80, customer_code: BTG },
    { location_id: "A-03", sku_code: GG.sku_code, qty_on_hand: 2, customer_code: BTG },
  ],
  reservas: [{ sku_code: P.sku_code, location_id: "A-03", status: "reserved", order_number: "PED-0002", customer_code: BTG }],
  guardas: [],
  recontagens: RECONTAGENS,
  rodada: RODADA,
})!;

const PRODUTOS = produtosDoCliente([{ cod_btg: GG.sku_code, cod_cliente: GG.client_item_code, produto: GG.product_name, tamanho: "GG", customer_code: BTG }], BTG);

const DIGITADO: ContagemDigitada = {
  contados: { [M.sku_code]: "48" },
  foraDaLista: [{ sku: GG.sku_code, codigo: GG.client_item_code, nome: "Polo Masculino Piquet Preto · GG", contado: "2" }],
};

const SEM_ACOES = {
  onDigitar: () => undefined,
  onAcrescentar: () => undefined,
  onDigitarForaDaLista: () => undefined,
  onRemoverForaDaLista: () => undefined,
  onCaixaVazia: () => undefined,
  onConfirmar: () => undefined,
};

function render(estado: EstadoDaPrateleira = "pronto", extra: Partial<Parameters<typeof EstoqueContagemPrateleiraView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/estoque/contagem/prateleira">
      <EstoqueContagemPrateleiraView
        estado={estado}
        posicao="A-03"
        agora={AGORA}
        bancada={estado === "pronto" ? BANCADA : null}
        operador
        emContagem="CX-000012"
        digitado={DIGITADO}
        confirmar={{ estado: "repouso" }}
        produtos={PRODUTOS}
        hrefDaFolha="/estoque/contagem/folha?rua=A"
        onTentar={() => undefined}
        onContar={() => undefined}
        acoes={SEM_ACOES}
        {...extra}
      />
    </Router>,
  );
}

describe("Estoque › Contagem por caixa › a prateleira", () => {
  it("a tela nova já entra na v3", () => {
    expect(telaDoWmsNaV3("/estoque/contagem/prateleira")).toBe(true);
  });

  it("só rótulos, dados e ações: as confirmadas numa linha, a em contagem com o esperado, o contado e a diferença, as por contar", () => {
    expect(textosDaTela(render())).toEqual([
      "Contagem por caixa",
      "A-03",
      "Rua A · 4 caixas · 4 itens",
      "Imprimir folha",
      "Voltar à rodada",
      "2 de 4 caixas",
      "confirmadas",
      "diferença",
      "−3 un.",
      "esperadas",
      "120",
      "contadas",
      "117",
      // A CX-000010, confirmada sem diferença, com a reserva e o pedido.
      "CX-000010",
      "Polo Masculino Piquet Preto · P",
      "60 esperadas · 20 reservadas · PED-0002",
      "confirmada 09:02 · 60 · sem diferença",
      "Contar de novo",
      // A CX-000011, confirmada com a falta e a peça fora da lista, com a origem dela.
      "CX-000011",
      "2 itens",
      "60 esperadas",
      "confirmada 09:11 · 57 · −3",
      "Imprimir etiqueta",
      "Polo Masculino Piquet Preto · M",
      "−5",
      "Polo Masculino Piquet Preto · GG",
      "+2 · fora da lista · 2 de CX-000014",
      // A CX-000012, em contagem: a diferença aparece antes de gravar.
      "CX-000012",
      "guardada 20/10",
      "em contagem",
      "Produto",
      "Esperado",
      "Contado",
      "Diferença",
      "A.01.0806.005.M · BTG-000123",
      "60",
      "esperadas ·",
      "entrou 60 · saiu 0",
      "−12",
      "A.01.0806.005.GG · BTG-000125",
      "· fora da lista",
      "Remover",
      "0",
      "+2",
      "Confirmar caixa",
      "Caixa vazia",
      "Item fora da lista",
      // A CX-000013, por contar.
      "CX-000013",
      "Polo Masculino Piquet Preto · G",
      "80 esperadas",
      "Contar",
      "saldo da prateleira 257 · caixas 257 · reservadas 20",
    ]);
  });

  it("no dia seguinte, a caixa confirmada na recontagem geral continua confirmada, com o dia", () => {
    const textos = textosDaTela(render("pronto", { agora: new Date("2026-11-18T13:00:00.000Z") }));
    expect(textos).toContain("confirmada 17/11 09:02 · 60 · sem diferença");
    expect(textos).toContain("confirmada 17/11 09:11 · 57 · −3");
    expect(textos).toContain("2 de 4 caixas");
  });

  it("a caixa confirmada com diferença e a etiqueta para trocar ganha \"Imprimir etiqueta\", que abre a etiqueta dela", async () => {
    const html = render("pronto", { emContagem: null });
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const imprimir = [...dom.window.document.querySelectorAll("a")].filter((link) => link.textContent === "Imprimir etiqueta");
    // Só a CX-000011 (−3, com a etiqueta para trocar); a CX-000010, confirmada sem diferença, não.
    expect(imprimir.map((link) => link.getAttribute("href"))).toEqual(["/estoque/etiquetas?caixas=CX-000011"]);
    expect(dom.window.document.getElementById(imprimir[0].getAttribute("aria-describedby")!)?.textContent).toBe("CX-000011");
    dom.window.close();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("com duas caixas ou mais para trocar, \"Etiquetas para trocar\" no topo imprime as da prateleira juntas", async () => {
    const duas = {
      ...BANCADA,
      caixas: BANCADA.caixas.map((item) =>
        item.code === "CX-000013"
          ? { ...item, estado: "confirmada" as const, recontagem: { ...BANCADA.caixas[1].recontagem!, caixa: "CX-000013", id: "brc_013" }, etiquetaParaTrocar: true }
          : item,
      ),
    };
    const html = render("pronto", { bancada: duas, emContagem: null });
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const topo = [...dom.window.document.querySelectorAll("a")].find((link) => link.textContent === "Etiquetas para trocar · 2");
    expect(topo?.getAttribute("href")).toBe("/estoque/etiquetas?caixas=CX-000011%2CCX-000013");
    dom.window.close();
    // Com uma só, o botão da caixa basta.
    expect(textosDaTela(render("pronto", { emContagem: null }))).not.toContain("Etiquetas para trocar · 1");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("depois da impressão registrada, o botão some; quem só consulta não o tem", () => {
    const impressa = {
      ...BANCADA,
      caixas: BANCADA.caixas.map((item) => (item.code === "CX-000011" ? { ...item, etiquetaParaTrocar: false } : item)),
    };
    expect(textosDaTela(render("pronto", { bancada: impressa, emContagem: null }))).not.toContain("Imprimir etiqueta");
    expect(textosDaTela(render("pronto", { operador: false }))).not.toContain("Imprimir etiqueta");
  });

  it("o campo do contado diz o item e a caixa, e o fora da lista diz que é fora da lista", () => {
    const dom = new JSDOM(`<!doctype html><body>${render()}</body>`);
    const campos = [...dom.window.document.querySelectorAll("input[inputmode=numeric]")].map((campo) => [campo.getAttribute("aria-label"), (campo as HTMLInputElement).value]);
    expect(campos).toEqual([
      ["Contado, Polo Masculino Piquet Preto · M, CX-000012", "48"],
      ["Contado, Polo Masculino Piquet Preto · GG, fora da lista, CX-000012", "2"],
    ]);
    // "Contar" diz qual caixa a quem usa leitor de tela.
    const contar = [...dom.window.document.querySelectorAll("button")].find((botao) => botao.textContent === "Contar");
    expect(dom.window.document.getElementById(contar!.getAttribute("aria-describedby")!)?.textContent).toBe("CX-000013");
    dom.window.close();
  });

  it("sem contar tudo, o confirmar trava; tudo em zero, ele diz que a caixa sai vazia", () => {
    const incompleta = render("pronto", { digitado: { contados: {}, foraDaLista: [] } });
    const dom = new JSDOM(`<!doctype html><body>${incompleta}</body>`);
    const confirmar = dom.window.document.getElementById("confirmar-CX-000012");
    expect(confirmar?.getAttribute("aria-disabled")).toBe("true");
    dom.window.close();
    expect(textosDaTela(render("pronto", { digitado: { contados: { [M.sku_code]: "0" }, foraDaLista: [] } }))).toContain("Confirmar caixa vazia");
    // Depois do resultado incerto, o mesmo pedido repete com a mesma chave.
    expect(textosDaTela(render("pronto", { confirmar: { estado: "repouso", rotulo: "Tentar de novo" } }))).toContain("Tentar de novo");
  });

  it("o teto e o fora da lista sem peça dizem o que corrigir, no campo", async () => {
    const html = render("pronto", { digitado: { contados: { [M.sku_code]: "200000" }, foraDaLista: [{ ...DIGITADO.foraDaLista[0], contado: "0" }] } });
    const textos = textosDaTela(html);
    expect(textos).toContain("Até 100.000 un.");
    expect(textos).toContain("1 un. ou mais");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("quem só consulta vê as caixas sem contar", () => {
    const textos = textosDaTela(render("pronto", { operador: false }));
    expect(textos).not.toContain("Contar");
    expect(textos).not.toContain("Contar de novo");
    expect(textos).not.toContain("em contagem");
    expect(textos).toContain("80 esperadas");
  });

  it("a guarda aberta e o pedido separado esperando a entrega aparecem antes de contar, e travam o Contar", () => {
    const bloqueada = { ...BANCADA, bloqueio: "guarda aberta · AVL-7C21A9F0" };
    const html = render("pronto", { bancada: bloqueada, emContagem: null });
    expect(textosDaTela(html)).toContain("guarda aberta · AVL-7C21A9F0");
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const contar = [...dom.window.document.querySelectorAll("button")].filter((botao) => botao.textContent?.startsWith("Contar"));
    expect(contar.map((botao) => botao.getAttribute("aria-disabled"))).toEqual(["true", "true", "true", "true"]);
    dom.window.close();
    const separada = {
      ...BANCADA,
      caixas: BANCADA.caixas.map((item) => (item.code === "CX-000013" ? { ...item, itens: item.itens.map((linha) => ({ ...linha, separados: ["PED-0003"] })) } : item)),
    };
    expect(textosDaTela(render("pronto", { bancada: separada, emContagem: null }))).toContain("em separação · PED-0003");
  });

  it("o item fora da lista sem catálogo diz que não conseguiu, com Tentar de novo", async () => {
    const html = render("pronto", { catalogoFalhou: true, onTentarCatalogo: () => undefined });
    const textos = textosDaTela(html);
    expect(textos).toContain("Não consegui carregar o catálogo.");
    expect(textos).toContain("Tentar de novo");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("carregando, a falha e a prateleira sem caixa: o título fica, nenhum número antes de ler", async () => {
    const carregando = render("carregando");
    expect(textosDaTela(carregando)).toEqual(["Contagem por caixa", "A-03", "Imprimir folha", "Voltar à rodada"]);
    expect(carregando).toContain("data-carregando-na-regiao");
    expect(await violacoesDeAcessibilidade(carregando)).toEqual([]);
    const falhou = render("erro");
    expect(textosDaTela(falhou)).toEqual(["Contagem por caixa", "A-03", "Imprimir folha", "Voltar à rodada", "Não consegui carregar a prateleira.", "Tentar de novo"]);
    expect(await violacoesDeAcessibilidade(falhou)).toEqual([]);
    expect(textosDaTela(render("nao_encontrada"))).toEqual(["Contagem por caixa", "A-03", "Imprimir folha", "Voltar à rodada", "Nenhuma caixa do cliente nesta prateleira."]);
    expect(textosDaTela(render("pronto", { clienteFalhou: true }))).toEqual(["Contagem por caixa", "A-03", "Imprimir folha", "Voltar à rodada", "Não consegui carregar o cliente ativo.", "Tentar de novo"]);
  });

  it("sem rodada aberta, a bancada não conta: a frase e Iniciar contagem para a entrada (decisão 2 de 18/11/2026)", async () => {
    const html = render("sem_rodada");
    expect(textosDaTela(html)).toEqual(["Contagem por caixa", "A-03", "Imprimir folha", "Voltar à rodada", "Nenhuma contagem em andamento.", "Iniciar contagem"]);
    expect(html).toContain('href="/wms/contagem"');
    expect(html).not.toContain("Contar");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe, com e sem caixa em contagem, e não leva valor", async () => {
    const html = render();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    expect(await violacoesDeAcessibilidade(render("pronto", { emContagem: null }))).toEqual([]);
    expect(html).not.toMatch(/R\$|custo|preço|valor/i);
  });
});
