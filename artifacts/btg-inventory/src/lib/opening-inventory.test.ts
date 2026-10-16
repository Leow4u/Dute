import { describe, expect, it } from "vitest";

import { defaultCountMode, openingInventoryNotice } from "./opening-inventory";

describe("modo padrão da Contagem", () => {
  it("abre na abertura enquanto ela não foi concluída", () => {
    expect(defaultCountMode("not_started")).toBe("opening");
    expect(defaultCountMode("open")).toBe("opening");
    expect(defaultCountMode(undefined)).toBe("opening");
  });

  it("abre na contagem cíclica depois da abertura concluída", () => {
    expect(defaultCountMode("completed")).toBe("cycle");
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

  it("não avisa nada depois da conclusão nem sem sessão", () => {
    expect(openingInventoryNotice({ status: "completed" })).toBeNull();
    expect(openingInventoryNotice(undefined)).toBeNull();
  });
});
