import { describe, expect, it } from "vitest";

import { numerosDoAcerto, resumoDoAcerto, sugestaoDoAcerto, tabelaDoAcerto, veAcerto, type SugestaoDoAcerto } from "./acerto";

/**
 * O painel de acerto da memória (parte 5.6): a taxa de aceite e o erro médio
 * da sugestão e do planejado contra o tempo real da OS revisada, das
 * sugestões em `ai_suggestions`. Dados sintéticos.
 */

const doc = (extra: Record<string, unknown> = {}) => ({
  tipo: "duracao_os",
  customer_code: "ITAU",
  criada_em: "2026-10-10T12:00:00.000Z",
  decisao: "aceitou",
  sugestao: { minutos_total: 180, completa: true },
  minutos_escolhidos: 180,
  valor_real: null,
  ...extra,
});

describe("a sugestão lida", () => {
  it("só a duração da OS, com o sugerido, o cliente e a decisão", () => {
    expect(sugestaoDoAcerto("sug_1", doc({ valor_real: 210 }))).toEqual({ id: "sug_1", customerCode: "ITAU", criadaEm: "2026-10-10T12:00:00.000Z", decisao: "aceitou", sugeridos: 180, completa: true, planejados: 180, reais: 210 });
    expect(sugestaoDoAcerto("sug_7", doc({ sugestao: { minutos_total: 120, completa: false } }))?.completa).toBe(false);
    expect(sugestaoDoAcerto("sug_2", doc({ tipo: "outro" }))).toBeNull();
    expect(sugestaoDoAcerto("sug_3", doc({ decisao: "talvez" }))).toBeNull();
    expect(sugestaoDoAcerto("sug_4", doc({ sugestao: { minutos_total: 0 } }))).toBeNull();
    expect(sugestaoDoAcerto("sug_5", doc({ customer_code: "" }))).toBeNull();
    expect(sugestaoDoAcerto("sug_6", doc({ minutos_escolhidos: null }))?.planejados).toBeNull();
  });
});

describe("os números", () => {
  // Itaú: aceitou 180 (real 210: 17%), mudou para 240 (sugerido 120, real 240: 100% e 0%), recusou sem real.
  // Safra: aceitou 60 (real 60: 0% e 0%).
  const sugestoes: SugestaoDoAcerto[] = [
    sugestaoDoAcerto("a", doc({ valor_real: 210 }))!,
    sugestaoDoAcerto("b", doc({ decisao: "mudou", sugestao: { minutos_total: 120, completa: true }, minutos_escolhidos: 240, valor_real: 240 }))!,
    sugestaoDoAcerto("c", doc({ decisao: "recusou" }))!,
    sugestaoDoAcerto("d", doc({ customer_code: "SAFRA", sugestao: { minutos_total: 60, completa: true }, minutos_escolhidos: 60, valor_real: 60 }))!,
  ];

  it("o aceite e o erro médio absoluto da sugestão e do planejado, só onde há o tempo real", () => {
    expect(numerosDoAcerto(sugestoes)).toEqual({ sugestoes: 4, aceitas: 2, mudadas: 1, recusadas: 1, aceite: 50, comReal: 3, erroDaSugestao: 39, erroDoPlanejado: 6 });
    expect(numerosDoAcerto([])).toEqual({ sugestoes: 0, aceitas: 0, mudadas: 0, recusadas: 0, aceite: null, comReal: 0, erroDaSugestao: null, erroDoPlanejado: null });
  });

  it("a sugestão parcial não entra nos erros: o sugerido soma só os itens com base, e o real é o da OS inteira", () => {
    // 120 minutos só das mesas, numa OS de 240 com as cadeiras: seriam 100% de erro da sugestão e 20% do planejado.
    const parcial = sugestaoDoAcerto("e", doc({ sugestao: { minutos_total: 120, completa: false }, minutos_escolhidos: 200, valor_real: 240 }))!;
    expect(numerosDoAcerto([sugestoes[0]!, parcial])).toEqual({ sugestoes: 2, aceitas: 2, mudadas: 0, recusadas: 0, aceite: 100, comReal: 1, erroDaSugestao: 17, erroDoPlanejado: 17 });
    expect(numerosDoAcerto([parcial])).toMatchObject({ sugestoes: 1, comReal: 0, erroDaSugestao: null, erroDoPlanejado: null });
  });

  it("uma linha por cliente, da que tem mais sugestões, e o total", () => {
    const nomes: Record<string, string> = { ITAU: "Itaú Unibanco", SAFRA: "Banco Safra" };
    const tabela = tabelaDoAcerto(sugestoes, (codigo) => nomes[codigo] ?? codigo);
    expect(tabela.colunas).toEqual(["Cliente", "Sugestões", "Aceitas", "Mudadas", "Recusadas", "Aceite (%)", "Com o tempo real", "Erro da sugestão (%)", "Erro do planejado (%)"]);
    expect(tabela.linhas.map((linha) => linha.celulas)).toEqual([
      ["Itaú Unibanco", 3, 1, 1, 1, 33, 2, 58, 8],
      ["Banco Safra", 1, 1, 0, 0, 100, 1, 0, 0],
    ]);
    expect(tabela.total).toEqual(["Total", 4, 2, 1, 1, 50, 3, 39, 6]);
    expect(tabelaDoAcerto([], String).total).toBeNull();
  });

  it("os números do topo; sem o tempo real ainda, o erro fica em traço", () => {
    expect(resumoDoAcerto(sugestoes)).toEqual([
      { rotulo: "Sugestões", valor: "4" },
      { rotulo: "Aceite", valor: "50%" },
      { rotulo: "Erro da sugestão", valor: "39%" },
      { rotulo: "Erro do planejado", valor: "6%" },
    ]);
    expect(resumoDoAcerto([sugestoes[2]!]).map((numero) => numero.valor)).toEqual(["1", "0%", "—", "—"]);
  });
});

describe("quem vê", () => {
  it("só owner e admin, onde a memória roda", () => {
    expect([veAcerto("owner", true), veAcerto("admin", true), veAcerto("interno", true), veAcerto("owner", false), veAcerto(undefined, true)]).toEqual([true, true, false, false, false]);
  });
});
