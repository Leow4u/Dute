import { describe, expect, it } from "vitest";

import { formatarHorario, formatarTelefone, nomeDoContato, rotuloDoStatus, rotuloDoTipo } from "./formatar";
import { podeVerZap } from "./papel";
import { LINHA_PILOTO } from "./linhas";
import { escreverRota, lerRota } from "./rota";

describe("quem entra no painel", () => {
  it("só owner e admin, com o acesso ativo", () => {
    expect(podeVerZap("owner", false)).toBe(true);
    expect(podeVerZap("admin", undefined)).toBe(true);
    expect(podeVerZap("owner", true)).toBe(false);
    for (const papel of ["interno", "wms", "rh", "comercial", "financeiro", "cliente", "painel", "suporte", "campo"]) {
      expect(podeVerZap(papel, false)).toBe(false);
    }
  });
});

describe("textos da conversa", () => {
  it("formata o telefone brasileiro e o horário de São Paulo", () => {
    expect(formatarTelefone("5511900000000")).toBe("(11) 90000-0000");
    expect(formatarTelefone("551133334444")).toBe("(11) 3333-4444");
    expect(nomeDoContato("  Maria ", "5511900000000")).toBe("Maria");
    expect(nomeDoContato("", "5511900000000")).toBe("(11) 90000-0000");
    expect(formatarHorario(new Date("2026-11-19T15:00:00.000Z"))).toContain("12:00");
    expect(rotuloDoTipo("audio")).toBe("Áudio");
    expect(rotuloDoTipo("image")).toBe("Imagem");
    expect(rotuloDoTipo("document")).toBe("Documento");
    expect(rotuloDoStatus("read")).toBe("Lida");
    expect(rotuloDoStatus(undefined)).toBeNull();
  });
});

describe("rota", () => {
  it("abre o Jamil quando o endereço não escolhe linha", () => {
    expect(lerRota("")).toEqual({ linha: LINHA_PILOTO, conversa: null, linhas: false });
    expect(lerRota("#/linhas").linhas).toBe(true);
    expect(lerRota("#/linha/1027983403741650")).toEqual({ linha: "1027983403741650", conversa: null, linhas: false });
    const conversa = `${LINHA_PILOTO}_5511900000000`;
    expect(lerRota(escreverRota(LINHA_PILOTO, conversa))).toEqual({ linha: LINHA_PILOTO, conversa, linhas: false });
    expect(lerRota(`#/linha/${LINHA_PILOTO}/conversa/outra_5511900000000`).conversa).toBeNull();
  });
});
