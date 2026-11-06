import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildShelves, skuIndexFromRows } from "@/lib/warehouse-map";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";
import { SaldoSemCaixa } from "./warehouse-map";

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
