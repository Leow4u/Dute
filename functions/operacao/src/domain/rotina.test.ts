import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ColaboradorGravado, VeiculoGravado } from "./cadastro.js";
import { DIAS_PARA_A_CNH, DIAS_PARA_A_REVISAO, alertasDoDia, diasAte } from "./rotina.js";

/** A rotina diária (parte 3.13a): quem entra no alerta de CNH e de revisão. Dados sintéticos. */

const HOJE = "2026-10-23";

function pessoa(id: string, validade: string | null, ativo = true): ColaboradorGravado {
  return {
    id,
    nome: "Ana Lima",
    cpf: "52998224725",
    funcao: "Motorista",
    telefone: null,
    cnh: validade ? { categoria: "D", validade } : null,
    vinculo: "proprio",
    empresa: null,
    papeis: ["motorista"],
    usuario_uid: null,
    usuario_email: null,
    ativo,
    edicao: 1,
  };
}

function veiculo(id: string, revisao: string | null, ativo = true): VeiculoGravado {
  return { id, placa: "ABC1D23", tipo: "VUC", modelo: null, capacidade_kg: 3500, capacidade_m3: 12, dono: "proprio", empresa: null, revisao_em: revisao, ativo, edicao: 1 };
}

describe("a rotina diária", () => {
  it("as janelas são as do Início: 30 dias para a CNH e 15 para a revisão", () => {
    assert.equal(DIAS_PARA_A_CNH, 30);
    assert.equal(DIAS_PARA_A_REVISAO, 15);
    assert.equal(diasAte(HOJE, "2026-11-22"), 30);
    assert.equal(diasAte(HOJE, "2026-10-20"), -3);
  });

  it("a CNH até 30 dias ou vencida, só de quem está ativo", () => {
    const alertas = alertasDoDia(
      HOJE,
      [
        pessoa("col_aaaaaaaaaaaaaaaa", "2026-11-22"),
        pessoa("col_bbbbbbbbbbbbbbbb", "2026-11-23"),
        pessoa("col_cccccccccccccccc", "2026-10-20"),
        pessoa("col_dddddddddddddddd", "2026-10-25", false),
        pessoa("col_eeeeeeeeeeeeeeee", null),
      ],
      [],
    );
    assert.deepEqual(alertas, [
      { tipo: "collaborator.cnh_expiring", id: "col_cccccccccccccccc", dias: -3 },
      { tipo: "collaborator.cnh_expiring", id: "col_aaaaaaaaaaaaaaaa", dias: 30 },
    ]);
  });

  it("a revisão até 15 dias ou que já passou, só do veículo ativo; o mais urgente primeiro", () => {
    const alertas = alertasDoDia(
      HOJE,
      [pessoa("col_aaaaaaaaaaaaaaaa", "2026-10-30")],
      [
        veiculo("vei_aaaaaaaaaaaaaaaa", "2026-11-07"),
        veiculo("vei_bbbbbbbbbbbbbbbb", "2026-11-08"),
        veiculo("vei_cccccccccccccccc", HOJE),
        veiculo("vei_dddddddddddddddd", "2026-10-24", false),
        veiculo("vei_eeeeeeeeeeeeeeee", null),
      ],
    );
    assert.deepEqual(alertas, [
      { tipo: "vehicle.maintenance_due", id: "vei_cccccccccccccccc", dias: 0 },
      { tipo: "collaborator.cnh_expiring", id: "col_aaaaaaaaaaaaaaaa", dias: 7 },
      { tipo: "vehicle.maintenance_due", id: "vei_aaaaaaaaaaaaaaaa", dias: 15 },
    ]);
  });
});
