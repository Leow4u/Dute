import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShelfVolumeSummary } from "./shelf-volume-summary";
import type { VolumeBox } from "@/lib/warehouse-volume";

const position = { code: "A-03", length_m: 1.2, depth_m: 0.7, height_m: 1 };
const incoming = { length_m: 0.6, width_m: 0.35, height_m: 0.2 };
const boxes: VolumeBox[] = Array.from({ length: 12 }, () => ({ ...incoming, status: "stored", location_id: "A-03" }));

describe("resumo de volume na guarda e no mapa", () => {
  it("identifica a ocupação volumétrica e distingue a projeção da caixa atual", () => {
    const html = renderToStaticMarkup(<ShelfVolumeSummary position={position} boxes={boxes} incomingBox={incoming} />);
    for (const text of ["0,840 m³", "0,504 m³", "0,336 m³", "60% do volume ocupado", "Após guardar esta caixa", "0,294 m³", "65%"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="60"');
    expect(html).toContain("Volume livre não garante encaixe.");
  });

  it("o mapa não projeta uma caixa inexistente", () => {
    const html = renderToStaticMarkup(<ShelfVolumeSummary title="Volume da prateleira" position={position} boxes={boxes} />);
    expect(html).toContain("Volume da prateleira");
    expect(html).not.toContain("Após guardar");
    expect(html).not.toContain("Dados ilustrativos");
  });

  it("sem caixas registradas, oculta espaço livre e a projeção quando a ocupação não foi confirmada", () => {
    const html = renderToStaticMarkup(<ShelfVolumeSummary position={position} boxes={[]} incomingBox={incoming} unconfirmed />);
    expect(html).toContain("Ocupação não confirmada");
    expect(html).toContain("0,840 m³");
    expect(html).not.toContain("0% do volume ocupado");
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("Após guardar");
    expect(html).not.toContain("0,000 m³");
  });

  it("medida faltante não mostra ocupação como zero", () => {
    const html = renderToStaticMarkup(<ShelfVolumeSummary position={position} boxes={[{ ...boxes[0]!, height_m: 0 }]} />);
    expect(html).toContain("Medidas incompletas");
    expect(html).not.toContain("0,000 m³");
    expect(html).not.toContain('role="progressbar"');
  });

  it("explica a guarda pendente e não projeta espaço ainda reservado", () => {
    const html = renderToStaticMarkup(<ShelfVolumeSummary position={position} boxes={[...boxes, { ...incoming, status: "committing", location_id: "A-03" }]} incomingBox={incoming} />);
    expect(html).toContain("Guarda em andamento");
    expect(html).not.toContain("0,336 m³");
    expect(html).not.toContain("Após guardar");
  });

  it("a indicação de inventário parcial não esconde caixas já registradas", () => {
    const html = renderToStaticMarkup(<ShelfVolumeSummary position={position} boxes={boxes} unconfirmed />);
    expect(html).toContain("0,336 m³");
    expect(html).toContain("60% do volume ocupado");
  });
});
