import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import { buildShelves, skuIndexFromRows } from "@/lib/warehouse-map";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";
import { BoxCard, SaidasDaPrateleira, SaldoSemCaixa } from "./warehouse-map";

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
        "CX-000225 · guardada",
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
    // A falha do mapa sai das cópias das posições e das caixas: com ou sem rede, a FalhaNaLeitura (parte 13b).
    expect(fonte).toContain("const falhaDoMapa = falhaDasLeituras([");
    expect(fonte).toContain("const empty = !loading && !falhou && shelves.length === 0;");
    // Com o mapa lido, a hora e a falta ficam na linha de estado sob o título, sem a faixa que empurrava o mapa (parte 13b).
    expect(fonte).toContain('estado={<LinhaDeEstado id={ID_DA_LINHA} leitura={leiturasDoMapa} objeto="prateleiras" />}');
    expect(fonte).toContain('<FalhaNaLeitura leitura={falhaDoMapa.leitura} erro={falhaDoMapa.erro} mensagem="Não consegui carregar o mapa." focoAoSair={ID_DA_LINHA} />');
    expect(fonte).not.toContain("FaixaSemConexao");
    // A situação do inventário sem rede não vira um segundo aviso.
    expect(fonte).toContain("showSessionStatus && sessionQuery.isError && !ehFaltaDeConexao(sessionQuery.error)");
  });
});

/** A prateleira depois do pedido (separação com caixas, parte 3; mockup WmsSepararMapa). */
describe("Mapa › a prateleira depois do pedido", () => {
  const entrada = [
    { box_code: "CX-000028", sku_code: "BTG-000084", client_item_code: "A.01.0712.001.42", product_name: "Calça Social Masculino Preta 42", counted_qty: 28 },
    { box_code: "CX-000028", sku_code: "BTG-000085", client_item_code: "A.01.0712.001.44", product_name: "Calça Social Masculino Preta 44", counted_qty: 40 },
  ];
  const guardada = {
    code: "CX-000028",
    customer_code: "BTG Pactual",
    status: "stored",
    location_id: "A-05",
    length_m: 0.4,
    width_m: 0.6,
    height_m: 0.35,
    gross_weight_kg: 21.4,
    unit_count: 68,
    sku_codes: ["BTG-000084", "BTG-000085"],
    stored_at: "2026-10-22T14:10:00.000Z",
    origin: { kind: "opening_inventory", session_id: "sessao-1" },
  };

  it("a caixa aberta diz o saldo, de quando ele é e o que resta, sem o peso de entrada", async () => {
    const aberta = warehouseBoxFromRecord({
      ...guardada,
      taken_lines: [
        { sku_code: "BTG-000084", qty: 26 },
        { sku_code: "BTG-000085", qty: 35 },
      ],
      taken_units: 61,
      balance_at: "2026-11-12T17:40:00.000Z",
    });
    const html = renderToStaticMarkup(<BoxCard box={aberta} lines={entrada} skuIndex={index} onLabels={() => undefined} />);
    expect(
      textosForaDaLista(html, [
        "CX-000028 · aberta",
        "7 un.",
        "Etiqueta",
        "5 × Calça Social Masculino Preta 44 · A.01.0712.001.44",
        "2 × Calça Social Masculino Preta 42 · A.01.0712.001.42",
        "Abertura · 22/10/2026 · saldo em 12/11/2026 · 40 × 60 × 35 cm · 0,084 m³",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a caixa intacta diz guardada, com o conteúdo de entrada e o peso, sem 'saldo em'", () => {
    const html = renderToStaticMarkup(<BoxCard box={warehouseBoxFromRecord(guardada)} lines={entrada} skuIndex={index} onLabels={() => undefined} />);
    expect(html).toContain("CX-000028 · guardada");
    expect(html).toContain("68 un.");
    expect(html).toContain("Abertura · 22/10/2026 · 40 × 60 × 35 cm · 21,4 kg · 0,084 m³");
    expect(html).not.toContain("saldo em");
  });

  it("Saíram desta prateleira: a caixa que saiu inteira e a que ficou vazia, com a data e o pedido", async () => {
    const saidas = [
      warehouseBoxFromRecord({ ...guardada, code: "CX-000027", status: "emptied", emptied_at: "2026-11-12T13:00:00.000Z", emptied_order_number: "PED-0001" }),
      // A caixa que virou volume ("Levar a caixa") diz qual volume ela é, como na prancha.
      warehouseBoxFromRecord({ ...guardada, code: "CX-000029", status: "emptied", emptied_at: "2026-11-11T16:00:00.000Z", emptied_order_number: "PED-0001", emptied_whole: true, emptied_volume_number: 11 }),
    ];
    const html = renderToStaticMarkup(<SaidasDaPrateleira shelf={{ saidas }} />);
    expect(
      textosForaDaLista(html, ["Saíram desta prateleira", "CX-000027", "· vazia em 12/11/2026 · PED-0001", "CX-000029", "· inteira em 11/11/2026 · PED-0001, volume 11"]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    // Sem saída, a ficha não ganha a seção.
    expect(renderToStaticMarkup(<SaidasDaPrateleira shelf={{ saidas: [] }} />)).toBe("");
  });
});
