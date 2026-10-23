import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { demandaParaOCliente, projecaoDaFatura } from "./projecao.js";

/**
 * A NF do portal (parte 4.3a): só o que é do cliente; o que é interno (quem
 * registrou, a observação, as autorizações, os registros anteriores, o
 * motivo de cancelamento) fica de fora. Dados sintéticos.
 */

const FATURA = {
  id: "fat_0123456789abcdef01234567",
  customer_code: "ITAU",
  customer_name: "Itaú Unibanco",
  status: "enviada",
  demandas: [
    { numero: "10045", rv: 1, medicao_id: null, autorizacao_ids: ["aut_itau"], valor_cents: 1_000_000 },
    { numero: "10046", rv: 0, medicao_id: null, autorizacao_ids: ["aut_itau"], valor_cents: 484_500 },
  ],
  demanda_numeros: ["10045", "10046"],
  autorizacao_ids: ["aut_itau"],
  valor_cents: 1_484_500,
  recebido_cents: 500_000,
  nf: { numero: "1234", serie: "1", emitida_em: "2026-10-20" },
  nf_chave: "1:1234",
  vencimento: "2026-11-20",
  forma: "boleto",
  observacao: "Cliente pediu desconto, negado",
  enviada: { em: "2026-10-21", meio: "email", por_uid: "fin-1" },
  registrada_por: { uid: "fin-1", role: "financeiro" },
  registrada_em: "2026-10-20T15:00:00.000Z",
  operation_id: "op_1",
  pagamento_ids: ["pag_1"],
  anteriores: [{ cancelada: { motivo: "Registro errado" } }],
};

describe("a NF do portal", () => {
  it("leva a NF, as datas, o valor, o recebido, o saldo, a situação e as demandas com o título", () => {
    const demandas = new Map([["10045", demandaParaOCliente({ titulo: " Desmontagem ", ref_cliente: "CE0045", contrato_id: "ctr" })]]);
    const projecao = projecaoDaFatura(FATURA, { demandas, atualizadaEm: "2026-10-23T15:00:00.000Z" });
    assert.deepEqual(projecao, {
      id: FATURA.id,
      customer_code: "ITAU",
      customer_name: "Itaú Unibanco",
      nf: { numero: "1234", serie: "1", emitida_em: "2026-10-20" },
      vencimento: "2026-11-20",
      forma: "boleto",
      status: "enviada",
      valor_cents: 1_484_500,
      recebido_cents: 500_000,
      saldo_cents: 984_500,
      enviada_em: "2026-10-21",
      paga_em: null,
      demandas: [
        { numero: "10045", valor_cents: 1_000_000, titulo: "Desmontagem", ref_cliente: "CE0045" },
        { numero: "10046", valor_cents: 484_500, titulo: null, ref_cliente: null },
      ],
      demanda_numeros: ["10045", "10046"],
      atualizada_em: "2026-10-23T15:00:00.000Z",
    });
    assert.doesNotMatch(JSON.stringify(projecao), /fin-1|desconto|aut_itau|Registro errado|op_1|pag_1|nf_chave|observacao|registrada_por/);
  });

  it("nas mudanças seguintes, o título vem da projeção anterior", () => {
    const anterior = { demandas: [{ numero: "10045", titulo: "Desmontagem", ref_cliente: "CE0045" }] };
    const projecao = projecaoDaFatura({ ...FATURA, status: "paga", recebido_cents: 1_484_500, paga_em: "2026-10-22" }, { anterior, atualizadaEm: "2026-10-23T15:00:00.000Z" });
    assert.deepEqual([projecao.status, projecao.saldo_cents, projecao.paga_em], ["paga", 0, "2026-10-22"]);
    assert.deepEqual((projecao.demandas as Array<Record<string, unknown>>)[0], { numero: "10045", valor_cents: 1_000_000, titulo: "Desmontagem", ref_cliente: "CE0045" });
  });
});
