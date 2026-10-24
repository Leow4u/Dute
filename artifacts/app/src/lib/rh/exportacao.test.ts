import { describe, expect, it } from "vitest";

import {
  arquivoLido,
  competenciaPadrao,
  competenciaValida,
  dataDaGeracao,
  exportacoesLidas,
  resultadoLido,
  textoDaCompetencia,
  textoDoResultado,
} from "./exportacao";

/** A exportação do RH na tela (parte 8.3): a leitura das callables e os textos da competência. */

describe("exportação do RH", () => {
  it("lê a lista e recusa a que vem fora do formato", () => {
    const item = { id: "exp_2026-10_v2", competencia: "2026-10", versao: 2, exames: 3, colaboradores: 12, gerada_em: "2026-10-24T15:00:00.000Z", gerada_por: "Pessoa rh" };
    expect(exportacoesLidas({ exportacoes: [item] })).toEqual([item]);
    expect(exportacoesLidas({ exportacoes: [{ ...item, id: "exp_2026-10" }] })).toBeNull();
    expect(exportacoesLidas({ exportacoes: [{ ...item, exames: -1 }] })).toBeNull();
    expect(exportacoesLidas({})).toBeNull();
  });

  it("lê o resultado da geração e o arquivo", () => {
    expect(resultadoLido({ id: "exp_2026-10_v1", versao: 1, nova: true, replayed: true })).toEqual({ id: "exp_2026-10_v1", versao: 1, nova: true });
    expect(resultadoLido({ id: "exp_2026-10_v1", versao: 1 })).toBeNull();
    expect(arquivoLido({ nome: "dute-rh-exames-2026-10-v1.csv", conteudo: "﻿Nome" })).toEqual({ nome: "dute-rh-exames-2026-10-v1.csv", conteudo: "﻿Nome" });
    expect(arquivoLido({ nome: "../x.csv", conteudo: "" })).toBeNull();
  });

  it("a competência na tela: o mês por extenso, a do mês anterior por padrão e o intervalo", () => {
    expect(textoDaCompetencia("2026-03")).toBe("Março de 2026");
    expect(competenciaPadrao("2026-10-24")).toBe("2026-09");
    expect(competenciaPadrao("2027-01-05")).toBe("2026-12");
    expect(competenciaValida("2026-10", "2026-10-24")).toBe(true);
    expect(competenciaValida("2026-11", "2026-10-24")).toBe(false);
    expect(competenciaValida("1899-12", "2026-10-24")).toBe(false);
    expect(competenciaValida("", "2026-10-24")).toBe(false);
  });

  it("o aviso diz se nasceu versão nova ou se nada mudou", () => {
    expect(textoDoResultado({ id: "exp_2026-10_v2", versao: 2, nova: true }, "2026-10")).toBe("Outubro de 2026: versão 2 gerada");
    expect(textoDoResultado({ id: "exp_2026-10_v2", versao: 2, nova: false }, "2026-10")).toBe("Outubro de 2026: nada mudou desde a versão 2");
  });

  it("a data da geração é a de São Paulo", () => {
    expect(dataDaGeracao("2026-10-02T02:00:00.000Z")).toBe("01/10/2026");
    expect(dataDaGeracao("x")).toBe("");
  });
});
