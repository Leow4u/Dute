import { TIPOS_DE_MOMENTO } from "@workspace/dominio";
import { describe, expect, it } from "vitest";

import { cronogramaDaNecton, feito, momento } from "@/test/eventos-necton";

import {
  adicionarOutro,
  comIdsGravados,
  cronogramaDasLinhas,
  formatarDia,
  formatarInstante,
  linhaDoCronograma,
  linhasDoFormulario,
  periodoDaEdicao,
  rotuloDoPeriodo,
  type LinhaDoCronograma,
} from "./cronograma";

/**
 * O cronograma na tela do portal (docs/superpowers/specs/2026-11-26-eventos-design.md,
 * "O cronograma", e a decisão 12): o período do cartão, a linha da prancha
 * EventosPortalLista.dc.html e as linhas do formulário que viram o patch.
 */

const NECTON = cronogramaDaNecton();

function semHoraEm(tipos: readonly string[], cronograma = NECTON) {
  return cronograma.map((item) => (tipos.includes(item.tipo) ? { ...item, previsto: { ...item.previsto, hora: null } } : item));
}

describe("o período da edição", () => {
  it("periodoDaEdicao: 28 e 29/01/2027, 14 a 16/05/2026, 03/09/2026, 30/01 a 02/02/2027, null sem montagem nem evento; rotuloDoPeriodo: Próxima e Última edição", () => {
    expect(periodoDaEdicao(NECTON)).toBe("28 e 29/01/2027");
    expect(
      periodoDaEdicao([momento("entrega_no_local", { data: "2026-05-14" }), momento("evento", { data: "2026-05-15" }), momento("desmontagem", { data: "2026-05-16" })]),
    ).toBe("14 a 16/05/2026");
    expect(periodoDaEdicao([momento("evento", { data: "2026-09-03" })])).toBe("03/09/2026");
    expect(periodoDaEdicao([momento("montagem", { data: "2027-01-30" }), momento("desmontagem", { data: "2027-02-02" })])).toBe("30/01 a 02/02/2027");
    expect(periodoDaEdicao([momento("montagem", { data: "2026-12-30" }), momento("evento", { data: "2027-01-02" })])).toBe("30/12/2026 a 02/01/2027");
    expect(periodoDaEdicao([momento("coleta_no_cliente", { data: "2027-01-28" }), momento("retorno_ao_estoque", { data: "2027-01-30" })])).toBeNull();
    expect(rotuloDoPeriodo(NECTON, "2026-11-27")).toBe("Próxima edição");
    expect(rotuloDoPeriodo(NECTON, "2027-01-29")).toBe("Próxima edição");
    expect(rotuloDoPeriodo(NECTON, "2027-01-30")).toBe("Última edição");
    expect(rotuloDoPeriodo([], "2026-11-27")).toBeNull();
  });

  it("formatarDia e formatarInstante: o dia da data e a hora de São Paulo", () => {
    expect(formatarDia("2027-01-28")).toBe("28/01");
    expect(formatarInstante("2026-11-24T12:40:00.000Z")).toBe("24/11 09:40");
    expect(formatarInstante("2026-11-25T02:30:00.000Z")).toBe("24/11 23:30");
  });
});

describe("a linha do cronograma no cartão", () => {
  it("linhaDoCronograma: 'Montagem 28/01 10:00 · Evento 29/01 08:00 às 20:00 · Desmontagem 29/01 20:00' e, com o feito, 'Montagem feita 24/11 09:40 · Evento começou 25/11 08:00 · Desmontagem 25/11 18:00'", () => {
    expect(linhaDoCronograma(NECTON)).toBe("Montagem 28/01 10:00 · Evento 29/01 08:00 às 20:00 · Desmontagem 29/01 20:00");
    const workshop = [
      momento("montagem", { data: "2026-11-24", hora: "08:00", ate: "12:00" }, { feito: feito("2026-11-24T11:00:00.000Z", "2026-11-24T12:40:00.000Z") }),
      momento("evento", { data: "2026-11-25", hora: "08:00", ate: "18:00" }, { feito: feito("2026-11-25T11:00:00.000Z") }),
      momento("desmontagem", { data: "2026-11-25", hora: "18:00" }),
    ];
    expect(linhaDoCronograma(workshop)).toBe("Montagem feita 24/11 09:40 · Evento começou 25/11 08:00 · Desmontagem 25/11 18:00");
    const terminou = workshop.map((item) => (item.tipo === "evento" ? { ...item, feito: feito("2026-11-25T11:00:00.000Z", "2026-11-25T21:30:00.000Z") } : item));
    expect(linhaDoCronograma(terminou)).toBe("Montagem feita 24/11 09:40 · Evento terminou 25/11 18:30 · Desmontagem 25/11 18:00");
    expect(linhaDoCronograma([momento("entrega_no_local", { data: "2027-01-28", hora: "08:30" })])).toBeNull();
  });

  it("linhaDoCronograma: o ate só entra no Evento; com a hora do previsto null, a montagem dá 'Montagem 28/01', com ou sem o ate, a desmontagem, 'Desmontagem 29/01', e o evento, 'Evento 29/01 até 20:00' com o ate e 'Evento 29/01' sem ele", () => {
    const semHora = semHoraEm(["montagem", "evento", "desmontagem"]);
    expect(linhaDoCronograma(semHora)).toBe("Montagem 28/01 · Evento 29/01 até 20:00 · Desmontagem 29/01");
    const semAte = semHora.map((item) => (item.tipo === "montagem" || item.tipo === "evento" ? { ...item, previsto: { ...item.previsto, ate: null } } : item));
    expect(linhaDoCronograma(semAte)).toBe("Montagem 28/01 · Evento 29/01 · Desmontagem 29/01");
    const eventoSemAte = NECTON.map((item) => (item.tipo === "evento" ? { ...item, previsto: { ...item.previsto, ate: null } } : item));
    expect(linhaDoCronograma(eventoSemAte)).toBe("Montagem 28/01 10:00 · Evento 29/01 08:00 · Desmontagem 29/01 20:00");
  });
});

describe("os ids que o servidor dá", () => {
  it("comIdsGravados põe na linha sem id o id do momento gravado: o fixo pelo tipo, o outro pela ordem entre os outros enviados; a linha mudada no meio só pelo tipo", () => {
    const enviadas = linhasDoFormulario([]).map((linha) => (linha.tipo === "montagem" || linha.tipo === "evento" ? { ...linha, data: "2027-01-28" } : linha));
    const ensaio: LinhaDoCronograma = { id: null, tipo: "outro", rotulo: "Ensaio", data: "2027-01-27", hora: "", ate: "", local: "", observacao: "" };
    const visita: LinhaDoCronograma = { ...ensaio, rotulo: "Visita", data: "2027-01-20" };
    const semData: LinhaDoCronograma = { ...ensaio, rotulo: "Sem data", data: "" };
    const linhas = [...enviadas, ensaio, semData, visita];
    const gravado = [
      momento("montagem", { data: "2027-01-28" }, { id: "mo_0000000a" }),
      momento("evento", { data: "2027-01-28" }, { id: "mo_0000000b" }),
      momento("outro", { data: "2027-01-27" }, { id: "mo_0000000c", rotulo: "Ensaio" }),
      momento("outro", { data: "2027-01-20" }, { id: "mo_0000000d", rotulo: "Visita" }),
    ];
    // Durante a gravação, a pessoa mudou a observação da montagem (outra linha, outro objeto).
    const atuais = linhas.map((linha) => (linha.tipo === "montagem" ? { ...linha, observacao: "2 estoquistas" } : linha));
    const comIds = comIdsGravados(atuais, linhas, gravado);
    expect(comIds.find((linha) => linha.tipo === "montagem")).toMatchObject({ id: "mo_0000000a", observacao: "2 estoquistas" });
    expect(comIds.find((linha) => linha.tipo === "evento")?.id).toBe("mo_0000000b");
    expect(comIds.filter((linha) => linha.tipo === "outro").map((linha) => [linha.rotulo, linha.id])).toEqual([
      ["Ensaio", "mo_0000000c"],
      ["Sem data", null],
      ["Visita", "mo_0000000d"],
    ]);
    expect(comIds.find((linha) => linha.tipo === "coleta_no_cliente")?.id).toBeNull();
    // A linha que já tem id fica com ele.
    const jaTem = atuais.map((linha) => (linha.tipo === "evento" ? { ...linha, id: "mo_000000ff" } : linha));
    expect(comIdsGravados(jaTem, linhas, gravado).find((linha) => linha.tipo === "evento")?.id).toBe("mo_000000ff");
  });
});

describe("as linhas do formulário", () => {
  it("linhasDoFormulario dá os sete tipos na ordem, com o id e o local do momento gravado, e os outros gravados; adicionarOutro acrescenta a linha vazia até cinco", () => {
    const gravado = [
      ...NECTON.map((item) => (item.tipo === "montagem" ? { ...item, previsto: { ...item.previsto, local: "Salão Azul" } } : item)),
      momento("outro", { data: "2027-01-27", hora: "15:00" }, { id: "mo_000000aa", rotulo: "Ensaio" }),
    ];
    const linhas = linhasDoFormulario(gravado);
    expect(linhas.map((linha) => linha.tipo)).toEqual([...TIPOS_DE_MOMENTO.filter((tipo) => tipo !== "outro"), "outro"]);
    expect(linhas[2]).toEqual({
      id: "mo_00000003",
      tipo: "montagem",
      rotulo: "",
      data: "2027-01-28",
      hora: "10:00",
      ate: "19:00",
      local: "Salão Azul",
      observacao: "2 estoquistas Dutelog e 2 pessoas do cliente",
    });
    expect(linhas[7]).toMatchObject({ id: "mo_000000aa", tipo: "outro", rotulo: "Ensaio", data: "2027-01-27", hora: "15:00" });

    const vazio = linhasDoFormulario([]);
    expect(vazio).toHaveLength(7);
    expect(vazio.every((linha) => linha.id === null && linha.data === "" && linha.hora === "")).toBe(true);
    let comOutros = vazio;
    for (let vez = 0; vez < 7; vez += 1) comOutros = adicionarOutro(comOutros);
    expect(comOutros.filter((linha) => linha.tipo === "outro")).toHaveLength(5);
    expect(comOutros.at(-1)).toEqual({ id: null, tipo: "outro", rotulo: "", data: "", hora: "", ate: "", local: "", observacao: "" });
  });

  it("cronogramaDasLinhas pula a linha sem data, manda o id só na linha que o tem (a nova vai sem a chave) e null em ate, local e observacao vazios", () => {
    const linhas = linhasDoFormulario(NECTON).map((linha) => (linha.tipo === "desmontagem" ? { ...linha, data: "" } : linha));
    const nova: LinhaDoCronograma = { id: null, tipo: "outro", rotulo: " Ensaio ", data: "2027-01-27", hora: "", ate: "", local: "", observacao: "" };
    const soComRotulo: LinhaDoCronograma = { ...nova, rotulo: "Só o rótulo", data: "" };
    const cronograma = cronogramaDasLinhas([...linhas, nova, soComRotulo]);
    expect(cronograma.map((item) => item.tipo)).toEqual([
      "coleta_no_cliente",
      "entrega_no_local",
      "montagem",
      "evento",
      "retorno_ao_estoque",
      "entrega_de_volta",
      "outro",
    ]);
    expect(cronograma[1]).toEqual({ id: "mo_00000002", tipo: "entrega_no_local", data: "2027-01-28", hora: "08:30", ate: null, local: null, observacao: "Doca do hotel" });
    expect(cronograma[2]).toEqual({
      id: "mo_00000003",
      tipo: "montagem",
      data: "2027-01-28",
      hora: "10:00",
      ate: "19:00",
      local: null,
      observacao: "2 estoquistas Dutelog e 2 pessoas do cliente",
    });
    expect(cronograma[6]).toEqual({ tipo: "outro", rotulo: "Ensaio", data: "2027-01-27", hora: null, ate: null, local: null, observacao: null });
    expect("id" in cronograma[6]).toBe(false);
    for (const item of cronograma) expect(Object.values(item)).not.toContain(undefined);
  });

  it("a hora vazia vai null em qualquer tipo: linhasDoFormulario põe hora '' na linha do momento com previsto.hora null; cronogramaDasLinhas manda a montagem com dia e sem hora com hora: null e manda também a entrega no local com dia e sem hora, com hora: null (toda linha com data vai)", () => {
    const linhas = linhasDoFormulario(semHoraEm(["montagem"]));
    expect(linhas[2]).toMatchObject({ tipo: "montagem", data: "2027-01-28", hora: "" });
    const semHoraNaEntrega = linhas.map((linha) => (linha.tipo === "entrega_no_local" ? { ...linha, hora: "" } : linha));
    const cronograma = cronogramaDasLinhas(semHoraNaEntrega);
    expect(cronograma).toHaveLength(7);
    expect(cronograma.find((item) => item.tipo === "montagem")).toMatchObject({ id: "mo_00000003", data: "2027-01-28", hora: null });
    expect(cronograma.find((item) => item.tipo === "entrega_no_local")).toMatchObject({ id: "mo_00000002", data: "2027-01-28", hora: null });
  });
});
