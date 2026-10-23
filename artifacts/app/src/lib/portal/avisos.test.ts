import { describe, expect, it } from "vitest";

import { avisoDoPortal, avisoNovo, avisosNovos, instanteDe, quandoDoAviso, rotuloDoSino, vistosAteDoDocumento } from "./avisos";

/** O sino do portal (parte 4.6c): o aviso lido, o que é novo, o rótulo e o quando. */

const AGORA = new Date("2026-10-28T17:30:00.000Z"); // 14:30 em São Paulo
const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });

describe("o aviso do portal", () => {
  it("lê o aviso gravado pela rotina; sem título ou com modelo desconhecido, fica de fora", () => {
    expect(
      avisoDoPortal("ntf_1", { modelo: "os_agendada", titulo: "OS 10050-01 agendada", texto: "Transporte · 29/10/2026 08:00–12:00", link: "/portal/servicos?os=10050-01", created_at: timestamp("2026-10-28T17:00:00.000Z") }),
    ).toEqual({
      id: "ntf_1",
      modelo: "os_agendada",
      titulo: "OS 10050-01 agendada",
      texto: "Transporte · 29/10/2026 08:00–12:00",
      link: "/portal/servicos?os=10050-01",
      criadoEm: new Date("2026-10-28T17:00:00.000Z"),
    });
    expect(avisoDoPortal("ntf_2", { modelo: "os_agendada", titulo: "" })).toBeNull();
    expect(avisoDoPortal("ntf_3", { modelo: "x", titulo: "OS" })).toBeNull();
  });

  it("o link nunca sai do portal", () => {
    for (const link of ["https://exemplo.com", "//exemplo.com", "/financeiro", "javascript:alert(1)", ""]) {
      expect(avisoDoPortal("ntf", { modelo: "nf_emitida", titulo: "NF 1234 emitida", link })?.link).toBe("/portal");
    }
    expect(avisoDoPortal("ntf", { modelo: "nf_emitida", titulo: "NF 1234 emitida", link: "/portal/faturas" })?.link).toBe("/portal/faturas");
  });

  it("o instante do Timestamp ou do texto ISO", () => {
    expect(instanteDe(timestamp("2026-10-28T17:00:00.000Z"))).toEqual(new Date("2026-10-28T17:00:00.000Z"));
    expect(instanteDe("2026-10-28T17:00:00.000Z")).toEqual(new Date("2026-10-28T17:00:00.000Z"));
    expect(instanteDe(null)).toBeNull();
    expect(avisoDoPortal("ntf", { modelo: "nf_emitida", titulo: "NF", ocorrido_em: "2026-10-27T12:00:00.000Z" })?.criadoEm).toEqual(new Date("2026-10-27T12:00:00.000Z"));
  });
});

describe("o que é novo", () => {
  const avisos = [
    avisoDoPortal("ntf_a", { modelo: "os_concluida", titulo: "OS concluída", created_at: timestamp("2026-10-28T17:10:00.000Z") })!,
    avisoDoPortal("ntf_b", { modelo: "nf_emitida", titulo: "NF emitida", created_at: timestamp("2026-10-27T12:00:00.000Z") })!,
  ];

  it("o que chegou depois da última vez que o login abriu o sino; sem marca, tudo", () => {
    const vistos = vistosAteDoDocumento({ lidos_ate: timestamp("2026-10-28T12:00:00.000Z") });
    expect(avisosNovos(avisos, vistos)).toBe(1);
    expect(avisoNovo(avisos[0], vistos)).toBe(true);
    expect(avisoNovo(avisos[1], vistos)).toBe(false);
    expect(avisosNovos(avisos, null)).toBe(2);
    expect(vistosAteDoDocumento(null)).toBeNull();
  });

  it("o rótulo do sino diz quantos são novos", () => {
    expect(rotuloDoSino(0)).toBe("Avisos");
    expect(rotuloDoSino(1)).toBe("Avisos: 1 novo");
    expect(rotuloDoSino(3)).toBe("Avisos: 3 novos");
  });
});

describe("quando", () => {
  it("agora, minutos, hoje, ontem, o dia e, de outro ano, a data", () => {
    expect(quandoDoAviso(new Date("2026-10-28T17:29:40.000Z"), AGORA)).toBe("agora");
    expect(quandoDoAviso(new Date("2026-10-28T17:18:00.000Z"), AGORA)).toBe("há 12 min");
    expect(quandoDoAviso(new Date("2026-10-28T12:05:00.000Z"), AGORA)).toBe("hoje 09:05");
    expect(quandoDoAviso(new Date("2026-10-27T12:10:00.000Z"), AGORA)).toBe("ontem 09:10");
    expect(quandoDoAviso(new Date("2026-10-22T12:10:00.000Z"), AGORA)).toBe("22/10 09:10");
    expect(quandoDoAviso(new Date("2025-12-30T12:10:00.000Z"), AGORA)).toBe("30/12/2025");
    expect(quandoDoAviso(null, AGORA)).toBe("");
  });
});
