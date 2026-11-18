import { describe, expect, it } from "vitest";

import { defaultCountMode, openingInventoryNotice, registroDaAberturaConcluida } from "./opening-inventory";

describe("modo padrão da Contagem", () => {
  it("abre na abertura enquanto ela não foi concluída", () => {
    expect(defaultCountMode("not_started")).toBe("opening");
    expect(defaultCountMode("open")).toBe("opening");
    expect(defaultCountMode(undefined)).toBe("opening");
  });

  it("abre na contagem cíclica depois da abertura concluída", () => {
    expect(defaultCountMode("completed")).toBe("cycle");
  });

  it("cliente que não precisa de abertura abre na cíclica; com a abertura aberta, nela", () => {
    expect(defaultCountMode("not_started", false)).toBe("cycle");
    expect(defaultCountMode("not_started", true)).toBe("opening");
    expect(defaultCountMode("open", true)).toBe("opening");
  });
});

describe("aviso do inventário de abertura", () => {
  it("abertura pendente avisa que o estoque não foi inicializado", () => {
    const notice = openingInventoryNotice({ status: "not_started" });
    expect(notice?.tone).toBe("warning");
    expect(notice?.title).toBe("Inventário de abertura pendente");
    expect(notice?.description).toContain("pedidos de saída ficam bloqueados");
  });

  it("abertura em andamento traz a contagem até agora", () => {
    const notice = openingInventoryNotice({
      status: "open",
      line_count: 12,
      unit_count: 148,
    });
    expect(notice?.tone).toBe("info");
    expect(notice?.title).toBe("Inventário de abertura em andamento");
    expect(notice?.description).toContain("12 produtos e 148 unidades confirmados");
    expect(notice?.description).toContain("Entradas pelo Receber continuam normais");
  });

  it("concorda o número com uma unidade só", () => {
    const notice = openingInventoryNotice({ status: "open", line_count: 1, unit_count: 1 });
    expect(notice?.description).toContain("1 produto e 1 unidade confirmados");
  });

  it("cliente novo, que começa pelo recebimento, não recebe aviso de abertura pendente", () => {
    expect(openingInventoryNotice({ status: "not_started", opening_required: false })).toBeNull();
    expect(openingInventoryNotice({ status: "not_started", opening_required: true })?.tone).toBe("warning");
  });

  it("não avisa nada depois da conclusão nem sem sessão", () => {
    expect(openingInventoryNotice({ status: "completed" })).toBeNull();
    expect(openingInventoryNotice(undefined)).toBeNull();
  });
});

describe("o registro da abertura concluída", () => {
  const concluida = {
    status: "completed",
    line_count: 249,
    unit_count: 7314,
    completed_at: "2026-10-20T21:40:00Z",
    completed_by: { name: "Leonardo", email: "leonardo@exemplo.com" },
  };

  it("a sessão concluída: o título, quando e quem no fuso do armazém, e os números", () => {
    expect(registroDaAberturaConcluida(concluida)).toEqual({
      titulo: "Inventário de abertura",
      quando: "20/10/2026 às 18:40 · Leonardo",
      numeros: "249 lançamentos · 7.314 unidades",
    });
  });

  it("sem quem concluiu, só a data; sem nome, o e-mail; sem data válida, só quem; sem os dois, vazio", () => {
    expect(registroDaAberturaConcluida({ ...concluida, completed_by: undefined })?.quando).toBe("20/10/2026 às 18:40");
    expect(registroDaAberturaConcluida({ ...concluida, completed_by: { email: "ana@exemplo.com" } })?.quando).toBe("20/10/2026 às 18:40 · ana@exemplo.com");
    expect(registroDaAberturaConcluida({ ...concluida, completed_at: "quando?" })?.quando).toBe("Leonardo");
    expect(registroDaAberturaConcluida({ ...concluida, completed_at: undefined, completed_by: undefined })?.quando).toBe("");
  });

  it("um lançamento e uma unidade no singular; sem contagem, zero", () => {
    expect(registroDaAberturaConcluida({ ...concluida, line_count: 1, unit_count: 1 })?.numeros).toBe("1 lançamento · 1 unidade");
    expect(registroDaAberturaConcluida({ status: "completed" })?.numeros).toBe("0 lançamentos · 0 unidades");
  });

  it("só a sessão concluída tem registro", () => {
    expect(registroDaAberturaConcluida(undefined)).toBeNull();
    expect(registroDaAberturaConcluida({ status: "open", line_count: 3 })).toBeNull();
    expect(registroDaAberturaConcluida({ status: "not_started" })).toBeNull();
  });
});
