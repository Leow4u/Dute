import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import { buildShelves, skuIndexFromRows } from "@/lib/warehouse-map";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";
import { BoxCard, SaldoSemCaixa } from "./warehouse-map";

const [b02] = buildShelves(
  [
    {
      id: "B-02",
      code: "B-02",
      aisle: "B",
      shelf: 2,
      length_m: 1.78,
      depth_m: 0.75,
      height_m: 0.65,
      max_weight_kg: null,
      sequence: 17,
      customer_code: "BTG Pactual",
      status: "active",
    },
  ],
  [],
  [
    { location_id: "B-02", sku_code: "BTG-000001", qty_on_hand: 30 },
    { location_id: "B-02", sku_code: "BTG-000002", qty_on_hand: 41 },
  ],
);
const index = skuIndexFromRows([
  { id: "BTG-000001", produto: "POLO MASCULINO PIQUET PRETO GG", cod_cliente: "A.01.0806.005.GG" },
]);

describe("Mapa › saldo sem caixa registrada", () => {
  it("mostra o produto e a quantidade da prateleira sem caixa, só com rótulos e dados", async () => {
    const html = renderToStaticMarkup(<SaldoSemCaixa shelf={b02!} skuIndex={index} />);
    expect(html).toContain("POLO MASCULINO PIQUET PRETO GG · A.01.0806.005.GG");
    // Sem nome no catálogo, fica o SKU.
    expect(html).toContain("41 × BTG-000002");
    expect(
      textosForaDaLista(html, ["Saldo sem caixa registrada", "71 un.", /^\d+ × .+$/]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

/** A caixa do recebimento na prateleira (recebimento com caixas, parte 6; mockup WmsEtiquetaRecebimentoMapa). */
describe("Mapa › a caixa do recebimento", () => {
  const caixa = (extra: Record<string, unknown>) =>
    warehouseBoxFromRecord({
      code: "CX-000225",
      customer_code: "BTG Pactual",
      location_id: "B-09",
      length_m: 0.4,
      width_m: 0.6,
      height_m: 0.35,
      gross_weight_kg: 10,
      origin: { kind: "receipt", receipt_number: "AVL-7C21A9F0", invoice_number: "48.377" },
      lines: [
        { sku_code: "BTG-000112", client_item_code: "A.01.0713.005.G", product_name: "Polo Masculino Piquet Preto", size: "G", counted_qty: 12 },
        { sku_code: "BTG-000113", client_item_code: "A.01.0713.005.GG", product_name: "Polo Masculino Piquet Preto", size: "GG", counted_qty: 7 },
      ],
      ...extra,
    });

  it("guardada: o conteúdo da própria caixa, a origem com a NF e a data, e a etiqueta", async () => {
    const html = renderToStaticMarkup(
      <BoxCard box={caixa({ status: "stored", unit_count: 19, stored_at: "2026-11-06T18:02:00.000Z" })} lines={[]} skuIndex={index} onLabels={() => undefined} />,
    );
    expect(
      textosForaDaLista(html, [
        "CX-000225",
        "19 un.",
        "Etiqueta",
        "12 × Polo Masculino Piquet Preto · G · A.01.0713.005.G",
        "7 × Polo Masculino Piquet Preto · GG · A.01.0713.005.GG",
        "Recebimento · NF 48.377 · 06/11/2026 · 40 × 60 × 35 cm · 10 kg · 0,084 m³",
      ]),
    ).toEqual([]);
    expect(html).not.toContain("Conteúdo ainda não lançado");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("reservada: o selo, as unidades lançadas e a etiqueta, sem a data da guarda", async () => {
    const html = renderToStaticMarkup(
      <BoxCard box={caixa({ status: "committing", unit_count: 0, draft_unit_count: 19 })} lines={[]} skuIndex={index} reserved onLabels={() => undefined} />,
    );
    expect(html).toContain("reservada");
    expect(html).toContain("19 un.");
    expect(html).toContain("Recebimento · NF 48.377 · 40 × 60 × 35 cm · 10 kg · 0,084 m³");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a caixa da abertura segue lendo a sessão e diz Abertura", () => {
    const abertura = warehouseBoxFromRecord({
      code: "CX-000190",
      status: "stored",
      location_id: "B-09",
      length_m: 0.36,
      width_m: 0.65,
      height_m: 0.18,
      unit_count: 4,
      sku_codes: ["BTG-000001"],
      origin: { kind: "opening_inventory", session_id: "sessao-1" },
    });
    const html = renderToStaticMarkup(
      <BoxCard
        box={abertura}
        lines={[{ box_code: "CX-000190", sku_code: "BTG-000001", client_item_code: "A.01.0806.005.GG", product_name: "POLO MASCULINO PIQUET PRETO GG", counted_qty: 4 }]}
        skuIndex={index}
        onLabels={() => undefined}
      />,
    );
    expect(html).toContain("4 × POLO MASCULINO PIQUET PRETO GG · A.01.0806.005.GG");
    expect(html).toContain("Abertura · 36 × 65 × 18 cm");
  });
});

/** Sem rede (docs/plataforma/diagnostico-carregamento.md, decisão 2 do celular, de 06/11/2026). */
describe("Mapa sem conexão", () => {
  const fonte = readFileSync(new URL("./warehouse-map.tsx", import.meta.url), "utf8");

  it("o mapa lido fica com a hora; sem nada lido, o aviso, e não \"Nenhuma posição cadastrada\"", () => {
    expect(fonte).toContain("const semRede = semConexaoNaLeitura(positionsQuery, boxesQuery);");
    expect(fonte).toContain("const error = semRede ? null : positionsQuery.error ?? boxesQuery.error;");
    expect(fonte).toContain("const empty = !loading && !error && !semNadaLido && shelves.length === 0;");
    expect(fonte).toMatch(/semRede\.lidaEm === null \? \(\s*<BlocoSemConexao tentando=\{relendo\} onTentar=\{reler\} \/>\s*\) : \(\s*<FaixaSemConexao lidaEm=\{semRede\.lidaEm\}/);
    // A situação do inventário sem rede não vira um segundo aviso.
    expect(fonte).toContain("showSessionStatus && sessionQuery.isError && !ehSemConexao(sessionQuery.error)");
  });
});
