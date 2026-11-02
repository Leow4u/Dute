import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  AREAS_DE_PASSAGEM,
  areaDePassagem,
  livreParaOCliente,
  problemaDoLocalDoPedido,
  type SaldoDoLocal,
} from "@workspace/dominio";

/**
 * As áreas de passagem do armazém (lib/dominio/src/areas-de-passagem.ts,
 * recebimento com caixas, parte 7): o pedido do cliente só reserva da
 * prateleira, e o portal conta como disponível só o livre dela. Os casos ficam
 * num JSON que functions/wms também roda, contra a cópia de lá.
 */

type Casos = {
  areas: { caso: string; local: unknown; area: string | null }[];
  problemas: { caso: string; local: unknown; problema: string | null }[];
  livres: { caso: string; saldos: SaldoDoLocal[]; livre: { qty_available: number; qty_receiving: number } }[];
};

const here = dirname(fileURLToPath(import.meta.url));
const casos = JSON.parse(readFileSync(resolve(here, "../../../../lib/dominio/src/areas-de-passagem.casos.json"), "utf8")) as Casos;

describe("áreas de passagem: casos de referência", () => {
  it("as áreas são o RECEBIMENTO e a EXPEDICAO, e o JSON de casos foi lido", () => {
    expect([...AREAS_DE_PASSAGEM]).toEqual(["RECEBIMENTO", "EXPEDICAO"]);
    expect(casos.areas.length).toBeGreaterThanOrEqual(10);
    expect(casos.livres.length).toBeGreaterThanOrEqual(3);
  });

  for (const caso of casos.areas) {
    it(`área: ${caso.caso}`, () => expect(areaDePassagem(caso.local)).toBe(caso.area));
  }
  for (const caso of casos.problemas) {
    it(`local do pedido: ${caso.caso}`, () => expect(problemaDoLocalDoPedido(caso.local)).toBe(caso.problema));
  }
  for (const caso of casos.livres) {
    it(`livre do cliente: ${caso.caso}`, () => expect(livreParaOCliente(caso.saldos)).toEqual(caso.livre));
  }
});
