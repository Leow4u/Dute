import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OPERACAO_EVENT_PAYLOADS } from "./events.js";
import { DIAS_DOS_AVISOS, SEM_CLIENTE, contagemPorCliente, emailForaDaFila, idDaRetencao, limiteDosAvisos } from "./retencao.js";

/** A regra da retenção dos avisos (LGPD, decisão 8), sem o banco. */

describe("a retenção dos avisos", () => {
  it("o prazo é de 90 dias", () => {
    assert.equal(DIAS_DOS_AVISOS, 90);
    assert.equal(limiteDosAvisos(new Date("2026-10-26T06:20:00.000Z")).toISOString(), "2026-07-28T06:20:00.000Z");
  });

  it("sai o e-mail enviado, o só auditado e o desistido; o pendente fica", () => {
    assert.deepEqual(["sent", "audit", "failed", "pending", undefined, "outro"].map(emailForaDaFila), [true, true, true, false, false, false]);
  });

  it("o convite cancelado também sai na retenção", () => {
    assert.equal(emailForaDaFila("cancelled"), true);
  });

  it("o id da rodada sai do instante e passa no evento", () => {
    const id = idDaRetencao(new Date("2026-10-26T06:20:05.123Z"));
    assert.equal(id, "ret_20261026T062005");
    const payload = { id, antes_de: "2026-07-28", avisos: 1, emails: 0, por_cliente: [{ cliente: "ITAU", avisos: 1, emails: 0 }] };
    assert.equal(OPERACAO_EVENT_PAYLOADS["retention.applied"].safeParse(payload).success, true);
  });

  it("conta por cliente, na ordem do código; sem código, conta à parte", () => {
    assert.deepEqual(contagemPorCliente(["SAFRA", "ITAU", "ITAU", ""], ["ITAU", "BRAD"]), [
      { cliente: "BRAD", avisos: 0, emails: 1 },
      { cliente: "ITAU", avisos: 2, emails: 1 },
      { cliente: "SAFRA", avisos: 1, emails: 0 },
      { cliente: SEM_CLIENTE, avisos: 1, emails: 0 },
    ]);
  });

  it("o evento leva só contagens: e-mail, texto ou nome não passam", () => {
    const base = { id: "ret_20261026T062000", antes_de: "2026-07-28", avisos: 1, emails: 1, por_cliente: [{ cliente: "ITAU", avisos: 1, emails: 1 }] };
    const schema = OPERACAO_EVENT_PAYLOADS["retention.applied"];
    assert.equal(schema.safeParse({ ...base, para: ["gestora@itau.com"] }).success, false);
    assert.equal(schema.safeParse({ ...base, por_cliente: [{ cliente: "ITAU", avisos: 1, emails: 1, assunto: "OS agendada" }] }).success, false);
    assert.equal(schema.safeParse({ ...base, avisos: -1 }).success, false);
  });
});
