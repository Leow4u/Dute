import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CONTROLE_DO_RECALCULO, ESPERA_MINIMA_MS, VERSAO_DO_RECALCULO } from "./disponivel-do-portal.js";

/** O recálculo do disponível do portal (recebimento com caixas, parte 7c), sem o banco. */

describe("o recálculo do disponível do portal", () => {
  it("o controle, a versão da conta e a espera de uma hora", () => {
    assert.equal(CONTROLE_DO_RECALCULO, "client_inventory_split");
    assert.equal(VERSAO_DO_RECALCULO, 1);
    assert.equal(ESPERA_MINIMA_MS, 60 * 60 * 1000);
  });

  it("a rotina roda de 15 em 15 minutos, uma instância de cada vez, só com o recálculo", () => {
    const index = readFileSync(fileURLToPath(new URL("../../src/index.ts", import.meta.url)), "utf8");
    assert.match(
      index,
      /export const runPortalAvailability = onSchedule\(\s*\{[^}]*schedule: "every 15 minutes"[^}]*timeZone: "America\/Sao_Paulo"[^}]*timeoutSeconds: 540[^}]*maxInstances: 1[^}]*\},\s*async \(\) => \{\s*console\.info\("runPortalAvailability", await recalcularDisponivelDoPortal\(db\)\);\s*\},\s*\);/,
    );
  });
});
