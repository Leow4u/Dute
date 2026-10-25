import { describe, expect, it } from "vitest";

import { esquecerPerfis, guardarPerfil, perfilGuardado } from "./perfil-guardado";

/** Um localStorage em memória, com o mesmo contrato. */
function armazenamento(inicial: Record<string, string> = {}) {
  const itens = new Map(Object.entries(inicial));
  return {
    itens,
    getItem: (chave: string) => itens.get(chave) ?? null,
    setItem: (chave: string, valor: string) => void itens.set(chave, valor),
    removeItem: (chave: string) => void itens.delete(chave),
    key: (indice: number) => [...itens.keys()][indice] ?? null,
    get length() {
      return itens.size;
    },
  };
}

describe("o perfil guardado no aparelho", () => {
  it("guarda e lê o papel, o cliente e o nome, por pessoa", () => {
    const local = armazenamento();
    guardarPerfil("u1", { role: "campo", nome: "Carlos" }, local);
    guardarPerfil("u2", { role: "cliente", customer_code: "ITAU", nome: "Ana" }, local);
    expect(perfilGuardado("u1", local)).toEqual({ role: "campo", customer_code: undefined, nome: "Carlos" });
    expect(perfilGuardado("u2", local)).toEqual({ role: "cliente", customer_code: "ITAU", nome: "Ana" });
    expect(perfilGuardado("u3", local)).toBeNull();
  });

  it("sem perfil ativo, apaga o da pessoa", () => {
    const local = armazenamento();
    guardarPerfil("u1", { role: "campo" }, local);
    guardarPerfil("u1", null, local);
    expect(perfilGuardado("u1", local)).toBeNull();
    expect(local.itens.size).toBe(0);
  });

  it("o que não é um perfil ativo não vale: papel desconhecido, acesso removido, texto qualquer", () => {
    const local = armazenamento({
      "dute.perfil.a": JSON.stringify({ role: "chefe" }),
      "dute.perfil.b": JSON.stringify({ role: "campo", access_disabled: true }),
      "dute.perfil.c": "{quebrado",
      "dute.perfil.d": JSON.stringify("campo"),
    });
    expect(["a", "b", "c", "d"].map((uid) => perfilGuardado(uid, local))).toEqual([null, null, null, null]);
  });

  it("o logout esquece todos os perfis e deixa o resto do aparelho", () => {
    const local = armazenamento({ "dute.tema": "escuro" });
    guardarPerfil("u1", { role: "campo" }, local);
    guardarPerfil("u2", { role: "admin" }, local);
    esquecerPerfis(local);
    expect([...local.itens.keys()]).toEqual(["dute.tema"]);
  });

  it("sem storage, ou com ele recusando, nada quebra", () => {
    const recusa = {
      ...armazenamento(),
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("cheio");
      },
    };
    expect(() => guardarPerfil("u1", { role: "campo" }, recusa)).not.toThrow();
    expect(perfilGuardado("u1", recusa)).toBeNull();
    expect(perfilGuardado("u1", null)).toBeNull();
    expect(() => esquecerPerfis(null)).not.toThrow();
  });
});
