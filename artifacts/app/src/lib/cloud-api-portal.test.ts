import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("./firebase", () => ({ firebaseAuth: null, firestore: {} }));
vi.mock("./functions-api", () => ({ callFunctionsApi: vi.fn(async () => null) }));

import { quantidadesDoPortal } from "./cloud-api";

/**
 * As quantidades que chegam ao Estoque do portal (partes 7 e 7d): o cliente
 * lê a projeção, com o em recebimento à parte; a prévia interna lê os saldos
 * por local e separa a área de passagem pela mesma regra.
 */

const SOURCE = readFileSync(fileURLToPath(new URL("./cloud-api.ts", import.meta.url)), "utf8");

describe("as quantidades do Estoque do portal", () => {
  it("a projeção do cliente passa o em recebimento; a projeção ainda sem o campo conta zero", () => {
    expect(quantidadesDoPortal({ qty_on_hand: 24, qty_available: 0, qty_receiving: 24 }, { saldoPorLocal: false })).toEqual({
      pieces: 24,
      qty_on_hand: 24,
      qty_available: 0,
      qty_reserved: 0,
      qty_receiving: 24,
    });
    expect(quantidadesDoPortal({ qty_on_hand: 10, qty_available: 9, qty_reserved: 1 }, { saldoPorLocal: false }).qty_receiving).toBe(0);
  });

  it("a prévia interna, pelos saldos por local: o RECEBIMENTO vai ao em recebimento, a EXPEDICAO só ao total", () => {
    expect(quantidadesDoPortal({ location_id: "RECEBIMENTO", qty_on_hand: 30, qty_reserved: 0, qty_available: 30 }, { saldoPorLocal: true })).toMatchObject({
      qty_on_hand: 30,
      qty_available: 0,
      qty_receiving: 30,
    });
    expect(quantidadesDoPortal({ location_id: "Expedição", qty_on_hand: 5, qty_reserved: 3, qty_available: 2 }, { saldoPorLocal: true })).toMatchObject({
      qty_on_hand: 5,
      qty_available: 0,
      qty_receiving: 0,
      qty_reserved: 3,
    });
    expect(quantidadesDoPortal({ location_id: "A-01", qty_on_hand: 12, qty_reserved: 2, qty_available: 10 }, { saldoPorLocal: true })).toMatchObject({
      qty_available: 10,
      qty_receiving: 0,
    });
  });

  it("o Estoque do portal usa essas quantidades, com a prévia interna pelos saldos por local", () => {
    expect(SOURCE.match(/\.\.\.quantidadesDoPortal\(item, \{ saldoPorLocal: !isClient \}\),/g)).toHaveLength(1);
  });
});
