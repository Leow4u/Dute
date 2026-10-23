import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMERCIAL_PRICE_TABLES,
  dataBaseDaCompetencia,
  precoNaTabela,
  tabelaDoComercialLida,
} from "./billing-price-tables.js";

/** O preço da armazenagem pela tabela do Comercial (parte 7.3a). Dados sintéticos. */

const tabela = (id: string, de: string, ate: string | null, precos: Record<string, string>) =>
  tabelaDoComercialLida(id, {
    vigente_de: de,
    vigente_ate: ate,
    precos: Object.fromEntries(Object.entries(precos).map(([item, preco]) => [item, { codigo: "", descricao_cliente: "", preco }])),
  })!;

describe("o preço da armazenagem no Comercial", () => {
  it("a coleção é a do Comercial", () => {
    const fonte = readFileSync(fileURLToPath(new URL("../../../comercial/src/domain/tabelas.ts", import.meta.url)), "utf8");
    assert.match(fonte, new RegExp(`export const PRICE_TABLES_COLLECTION = "${COMERCIAL_PRICE_TABLES}";`));
  });

  it("a data-base é o último dia da competência", () => {
    assert.deepEqual(["2026-09", "2026-02", "2028-02", "2026-12"].map(dataBaseDaCompetencia), ["2026-09-30", "2026-02-28", "2028-02-29", "2026-12-31"]);
  });

  it("vale a tabela vigente na data-base que tem o item", () => {
    const antiga = tabela("pt_a", "2026-01-01", "2026-09-15", { lpu_1: "1.0000" });
    const nova = tabela("pt_b", "2026-09-16", null, { lpu_1: "1.5000", lpu_2: "0.335" });
    assert.deepEqual(precoNaTabela([antiga, nova], "lpu_1", "2026-09-30"), { tipo: "preco", preco: "1.5000", tabela_id: "pt_b" });
    assert.deepEqual(precoNaTabela([antiga, nova], "lpu_1", "2026-08-31"), { tipo: "preco", preco: "1.0000", tabela_id: "pt_a" });
    assert.deepEqual(precoNaTabela([antiga, nova], "lpu_2", "2026-08-31"), { tipo: "sem_preco" });
    assert.deepEqual(precoNaTabela([antiga, nova], "lpu_9", "2026-09-30"), { tipo: "sem_preco" });
  });

  it("duas tabelas com o item no mesmo dia não se escolhem", () => {
    const comercial = tabela("pt_c", "2026-01-01", null, { lpu_1: "1.0000" });
    const noturna = tabela("pt_n", "2026-01-01", null, { lpu_1: "2.0000" });
    assert.deepEqual(precoNaTabela([noturna, comercial], "lpu_1", "2026-09-30"), { tipo: "ambiguo", tabela_ids: ["pt_c", "pt_n"] });
  });

  it("o preço fora do texto decimal com ponto e a tabela sem vigência ficam de fora", () => {
    const lida = tabela("pt_x", "2026-01-01", null, { lpu_1: "1,50", lpu_2: "-1", lpu_3: "2.5" });
    assert.deepEqual([...lida.precos.keys()], ["lpu_3"]);
    assert.equal(tabelaDoComercialLida("pt_y", { vigente_de: "01/01/2026", precos: {} }), null);
  });
});
