import { describe, expect, it } from "vitest";

import { moduloAberto, opcoesDoSeletor, type Liberacoes } from "./seletor-de-modulo";

const TUDO: Liberacoes = { comercial: true, plataforma: true, operacao: true };
const rotulos = (opcoes: ReturnType<typeof opcoesDoSeletor>) => opcoes.map((opcao) => [opcao.label, opcao.href, opcao.atual]);

describe("seletor de módulo", () => {
  it("o owner troca entre os quatro módulos com tela, na ordem da entrada, e o aberto fica marcado", () => {
    expect(rotulos(opcoesDoSeletor("owner", null, "/comercial/contratos", TUDO))).toEqual([
      ["Armazenagem", "/dashboard", false],
      ["Operação", "/operacao", false],
      ["Comercial", "/comercial", true],
      ["Financeiro", "/faturamento", false],
    ]);
    expect(opcoesDoSeletor("admin", null, "/faturamento/fatura", TUDO).find((opcao) => opcao.atual)?.key).toBe("financeiro");
    expect(opcoesDoSeletor("admin", null, "/estoque/mapa", TUDO).find((opcao) => opcao.atual)?.key).toBe("wms");
    expect(opcoesDoSeletor("owner", null, "/configuracoes", TUDO).every((opcao) => !opcao.atual)).toBe(true);
  });

  it("o interno troca entre Armazenagem e Operação", () => {
    expect(rotulos(opcoesDoSeletor("interno", null, "/operacao", TUDO))).toEqual([
      ["Armazenagem", "/dashboard", false],
      ["Operação", "/operacao", true],
    ]);
  });

  it("sem a liberação de um módulo, ele sai da lista", () => {
    expect(opcoesDoSeletor("owner", null, "/dashboard", { ...TUDO, comercial: false, operacao: false }).map((opcao) => opcao.label)).toEqual([
      "Armazenagem",
      "Financeiro",
    ]);
    expect(opcoesDoSeletor("interno", null, "/dashboard", { ...TUDO, operacao: false })).toEqual([]);
  });

  it("quem tem um módulo só, o cliente e a plataforma desligada não têm lista", () => {
    for (const role of ["comercial", "financeiro", "wms", "suporte"] as const) {
      expect(opcoesDoSeletor(role, null, "/dashboard", { ...TUDO, operacao: false }), role).toEqual([]);
    }
    expect(opcoesDoSeletor("cliente", { modules: ["wms", "operacao", "financeiro"] }, "/portal", TUDO)).toEqual([]);
    expect(opcoesDoSeletor("owner", null, "/comercial", { ...TUDO, plataforma: false })).toEqual([]);
    expect(opcoesDoSeletor(null, null, "/dashboard", TUDO)).toEqual([]);
  });

  it("o módulo aberto vem da rota, com rótulo e ícone", () => {
    expect(moduloAberto("/comercial/medicoes")?.label).toBe("Comercial");
    expect(moduloAberto("/operacao/veiculos")?.label).toBe("Operação");
    expect(moduloAberto("/faturamento")?.label).toBe("Financeiro");
    expect(moduloAberto("/estoque")?.label).toBe("Armazenagem");
    expect(moduloAberto("/configuracoes/conta")).toBeNull();
  });
});
