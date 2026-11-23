import { describe, expect, it } from "vitest";

import { RODADA_DA_RECONTAGEM_GERAL } from "./recontagem-por-caixa";
import {
  anterioresDaContagem,
  avisoDasPorContar,
  entradaDoInicio,
  hrefDaRodada,
  numerosDaRodadaConcluida,
  periodoDaRodada,
  rodadaAberta,
  rodadaDaBusca,
  rodadaRegistrada,
} from "./rodadas-da-contagem";

/**
 * O registro da rodada (docs/superpowers/specs/2026-11-18-registro-da-rodada-design.md):
 * o documento de `count_rounds` como a tela o lê, a rodada aberta do
 * cliente (ou a recontagem geral de 17/11 sem documento), as anteriores e
 * os textos de "Anteriores" e do "Concluir contagem". Dados sintéticos.
 */

const BTG = "BTG Pactual";
const ABERTA = {
  customer_code: BTG,
  title: "Contagem geral · 19/11/2026",
  scope: "general",
  status: "open",
  started_at: "2026-11-19T11:10:00.000Z",
  started_by: { uid: "u1", name: "Guilherme Dantas", email: "guilherme@dutelog.com.br" },
};
const CONCLUIDA = {
  customer_code: BTG,
  title: "Recontagem geral · 17/11/2026",
  scope: "general",
  status: "closed",
  started_at: "2026-11-17T11:10:00.000Z",
  started_by: { name: "Guilherme Dantas" },
  closed_at: "2026-11-21T14:00:00.000Z",
  closed_by: { name: "Guilherme Dantas" },
  shelves_total: 5,
  shelves_counted: 5,
  boxes_total: 6,
  boxes_counted: 6,
  boxes_with_difference: 1,
  difference_units: -3,
  recount_count: 6,
};

describe("o documento da rodada", () => {
  it("vira a rodada registrada: aberta e concluída, com o começo, o fim e os números", () => {
    expect(rodadaRegistrada("cr_1", ABERTA)).toEqual({
      id: "cr_1",
      cliente: BTG,
      titulo: "Contagem geral · 19/11/2026",
      alcance: { tipo: "geral" },
      status: "aberta",
      inicio: { quando: "2026-11-19T11:10:00.000Z", quem: "Guilherme Dantas" },
      fim: null,
      numeros: null,
      caixasDoFechamento: null,
    });
    expect(rodadaRegistrada(RODADA_DA_RECONTAGEM_GERAL.id, CONCLUIDA)).toEqual({
      id: RODADA_DA_RECONTAGEM_GERAL.id,
      cliente: BTG,
      titulo: "Recontagem geral · 17/11/2026",
      alcance: { tipo: "geral" },
      status: "concluida",
      inicio: { quando: "2026-11-17T11:10:00.000Z", quem: "Guilherme Dantas" },
      fim: { quando: "2026-11-21T14:00:00.000Z", quem: "Guilherme Dantas" },
      numeros: { prateleiras: 5, prateleirasContadas: 5, caixas: 6, caixasConfirmadas: 6, caixasComDiferenca: 1, diferenca: -3 },
      caixasDoFechamento: null,
    });
  });

  // O "Ver" da concluída monta as prateleiras por onde o fechamento gravou cada caixa (`boxes_at_close`); a caixa só
  // guarda o estado de hoje e o último mover (PR 639).
  it("a concluída lê onde o fechamento gravou cada caixa; sem a lista (as concluídas antes dela) e na aberta, null", () => {
    const gravada = rodadaRegistrada("cr_10", {
      ...CONCLUIDA,
      boxes_at_close: [
        { code: "cx-000040", location_id: "a-01", status: "stored", sku_codes: ["btg-000121", ""] },
        { code: "CX-000042", location_id: "A-01", status: "emptied", sku_codes: [] },
        { code: "CX-000050", location_id: "B-09", status: "stored" },
        // Sem o código, sem a prateleira, com outra situação ou fora do formato, a linha não serve.
        { code: "", location_id: "A-01", status: "stored", sku_codes: [] },
        { code: "CX-000043", location_id: "", status: "stored", sku_codes: [] },
        { code: "CX-000044", location_id: "A-01", status: "committing", sku_codes: [] },
        "CX-000045",
        null,
      ],
    });
    expect(gravada?.caixasDoFechamento).toEqual([
      { code: "CX-000040", location_id: "A-01", status: "stored", sku_codes: ["BTG-000121"] },
      { code: "CX-000042", location_id: "A-01", status: "emptied", sku_codes: [] },
      { code: "CX-000050", location_id: "B-09", status: "stored", sku_codes: [] },
    ]);
    // A lista vazia é um registro: nenhuma caixa no alcance no fechamento.
    expect(rodadaRegistrada("cr_11", { ...CONCLUIDA, boxes_at_close: [] })?.caixasDoFechamento).toEqual([]);
    expect(rodadaRegistrada("cr_12", { ...CONCLUIDA, boxes_at_close: "CX-000040" })?.caixasDoFechamento).toBeNull();
    expect(rodadaRegistrada("cr_13", { ...ABERTA, boxes_at_close: [] })?.caixasDoFechamento).toBeNull();
  });

  // Uma lista com caixas e nenhuma que sirva é um formato que a tela não conhece (um campo renomeado no servidor, por
  // exemplo): lida como vazia, o "Ver" ficaria sem prateleira enquanto o cartão diz "5 prateleiras".
  it("a lista com caixas e nenhuma que sirva não vale como registro: o Ver fica com a regra de antes dela", () => {
    expect(rodadaRegistrada("cr_14", { ...CONCLUIDA, boxes_at_close: [{ code: "CX-000040", location: "A-01", status: "stored" }, "CX-000041"] })?.caixasDoFechamento).toBeNull();
  });

  it("o alcance por rua e por item; sem o nome do item, o SKU; sem nome de quem, o e-mail", () => {
    expect(rodadaRegistrada("cr_2", { ...ABERTA, scope: "aisle", aisle: "a" })?.alcance).toEqual({ tipo: "rua", rua: "A" });
    expect(rodadaRegistrada("cr_3", { ...ABERTA, scope: "item", sku_code: "BTG-000125", item: { product_name: "Polo Masculino Piquet Preto", client_item_code: "A.01.0806.005.GG", size: "GG" } })?.alcance).toEqual({
      tipo: "item",
      sku: "BTG-000125",
      nome: "Polo Masculino Piquet Preto · GG",
    });
    expect(rodadaRegistrada("cr_4", { ...ABERTA, scope: "item", sku_code: "btg-000125" })?.alcance).toEqual({ tipo: "item", sku: "BTG-000125", nome: "BTG-000125" });
    expect(rodadaRegistrada("cr_5", { ...ABERTA, started_by: { email: "ana@dutelog.com.br" } })?.inicio).toEqual({ quando: "2026-11-19T11:10:00.000Z", quem: "ana@dutelog.com.br" });
  });

  it("sem o cliente ou com status desconhecido, não é rodada; sem começo válido, o começo fica vazio", () => {
    expect(rodadaRegistrada("cr_6", { ...ABERTA, customer_code: "" })).toBeNull();
    expect(rodadaRegistrada("cr_7", { ...ABERTA, status: "cancelled" })).toBeNull();
    expect(rodadaRegistrada("cr_8", { ...ABERTA, started_at: "quando?" })?.inicio).toBeNull();
  });
});

describe("a rodada aberta e as anteriores", () => {
  const aberta = rodadaRegistrada("cr_1", ABERTA)!;
  const maisNova = rodadaRegistrada("cr_2", { ...ABERTA, started_at: "2026-11-20T11:10:00.000Z" })!;
  const concluida = rodadaRegistrada(RODADA_DA_RECONTAGEM_GERAL.id, CONCLUIDA)!;
  const outraConcluida = rodadaRegistrada("cr_0", { ...CONCLUIDA, title: "Contagem da rua A · 22/11/2026", closed_at: "2026-11-22T14:00:00.000Z" })!;
  const deOutro = rodadaRegistrada("cr_9", { ...ABERTA, customer_code: "Outro Cliente" })!;

  it("a aberta do cliente, a de começo mais recente; sem ela, a recontagem geral sem documento com recontagem gravada; senão, nada", () => {
    expect(rodadaAberta([concluida, aberta, maisNova, deOutro], BTG, true)).toBe(maisNova);
    expect(rodadaAberta([], BTG, true)).toEqual(RODADA_DA_RECONTAGEM_GERAL);
    expect(rodadaAberta([outraConcluida], BTG, true)).toEqual(RODADA_DA_RECONTAGEM_GERAL);
    // A recontagem geral já registrada (concluída) não volta a ser a aberta.
    expect(rodadaAberta([concluida], BTG, true)).toBeNull();
    expect(rodadaAberta([], BTG, false)).toBeNull();
    expect(rodadaAberta([deOutro], BTG, false)).toBeNull();
    expect(rodadaAberta([aberta], null, true)).toBeNull();
  });

  it("a recontagem geral sem documento é só do cliente legado: outro cliente com recontagem no id fixo não fica preso nela", () => {
    expect(rodadaAberta([], "Outro Cliente", true)).toBeNull();
    expect(rodadaAberta([], BTG, true)).toEqual(RODADA_DA_RECONTAGEM_GERAL);
  });

  it("as anteriores: as concluídas do cliente, a mais recente primeiro", () => {
    expect(anterioresDaContagem([aberta, concluida, outraConcluida, deOutro], BTG).map((rodada) => rodada.id)).toEqual(["cr_0", RODADA_DA_RECONTAGEM_GERAL.id]);
    expect(anterioresDaContagem([concluida], null)).toEqual([]);
  });
});

describe("os textos da rodada", () => {
  it("o período: o começo e o fim no fuso do armazém, com quem concluiu; o mesmo dia, uma vez", () => {
    const fim = { quando: "2026-11-21T14:00:00.000Z", quem: "Guilherme Dantas" };
    expect(periodoDaRodada({ inicio: { quando: "2026-11-17T11:10:00.000Z", quem: "Rafael" }, fim })).toBe("17/11 a 21/11 · Guilherme Dantas");
    expect(periodoDaRodada({ inicio: { quando: "2026-11-21T11:10:00.000Z", quem: "Rafael" }, fim })).toBe("21/11 · Guilherme Dantas");
    expect(periodoDaRodada({ inicio: null, fim })).toBe("21/11 · Guilherme Dantas");
    expect(periodoDaRodada({ inicio: { quando: "2026-11-17T11:10:00.000Z", quem: "Rafael" }, fim: { ...fim, quem: "" } })).toBe("17/11 a 21/11");
    expect(periodoDaRodada({ inicio: { quando: "2026-11-17T11:10:00.000Z", quem: "Rafael" }, fim: null })).toBe("");
  });

  it("os números da concluída: tudo contado, parcial, sem diferença e o singular", () => {
    expect(numerosDaRodadaConcluida({ prateleiras: 5, prateleirasContadas: 5, caixas: 6, caixasConfirmadas: 6, caixasComDiferenca: 1, diferenca: -3 })).toBe("5 prateleiras · 6 caixas · 1 com diferença · −3 un.");
    expect(numerosDaRodadaConcluida({ prateleiras: 5, prateleirasContadas: 4, caixas: 6, caixasConfirmadas: 5, caixasComDiferenca: 0, diferenca: 0 })).toBe("4 de 5 prateleiras · 5 de 6 caixas · sem diferença");
    expect(numerosDaRodadaConcluida({ prateleiras: 1, prateleirasContadas: 1, caixas: 1, caixasConfirmadas: 1, caixasComDiferenca: 1, diferenca: 2 })).toBe("1 prateleira · 1 caixa · 1 com diferença · +2 un.");
    expect(numerosDaRodadaConcluida({ prateleiras: 1200, prateleirasContadas: 0, caixas: 1500, caixasConfirmadas: 0, caixasComDiferenca: 0, diferenca: 0 })).toBe("0 de 1.200 prateleiras · 0 de 1.500 caixas · sem diferença");
  });

  it("o aviso das prateleiras por contar, no singular e no plural; nenhum com tudo contado", () => {
    expect(avisoDasPorContar({ prateleiras: 5, prateleirasContadas: 2 })).toBe("3 prateleiras por contar ficam fora.");
    expect(avisoDasPorContar({ prateleiras: 5, prateleirasContadas: 4 })).toBe("1 prateleira por contar fica fora.");
    expect(avisoDasPorContar({ prateleiras: 5, prateleirasContadas: 5 })).toBeNull();
  });

  it("a entrada de iniciar, sem campo vazio", () => {
    expect(entradaDoInicio(BTG, { tipo: "geral" })).toEqual({ customer_code: BTG, scope: "general" });
    expect(entradaDoInicio(BTG, { tipo: "rua", rua: "a" })).toEqual({ customer_code: BTG, scope: "aisle", aisle: "A" });
    expect(entradaDoInicio(BTG, { tipo: "item", sku: "btg-000125" })).toEqual({ customer_code: BTG, scope: "item", sku_code: "BTG-000125" });
    expect(Object.keys(entradaDoInicio(BTG, { tipo: "geral" }))).toEqual(["customer_code", "scope"]);
  });

  it("o endereço da rodada e a rodada da busca", () => {
    expect(hrefDaRodada("cr_1")).toBe("/estoque/contagem/rodada?rodada=cr_1");
    expect(hrefDaRodada(RODADA_DA_RECONTAGEM_GERAL.id)).toBe("/estoque/contagem/rodada?rodada=recontagem-geral-2026-11-17");
    expect(rodadaDaBusca("rodada=cr_1")).toBe("cr_1");
    expect(rodadaDaBusca("?rodada=%20cr_1%20&x=1")).toBe("cr_1");
    expect(rodadaDaBusca("")).toBeNull();
  });
});
