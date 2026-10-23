import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import {
  aplicarColaborador,
  aplicarVeiculo,
  conflitoDeCpf,
  conflitoDePlaca,
  interpretarColaborador,
  interpretarVeiculo,
  type ColaboradorGravado,
  type VeiculoGravado,
} from "./cadastro.js";

/**
 * Cadastro de colaboradores e veículos (docs/plataforma/fase-3-operacao.md,
 * parte 1). A função pura normaliza e decide o documento; a transação, no
 * teste de integração, grava, confere a unicidade e o evento.
 */

const CPF = "529.982.247-25";
const CPF_DIGITS = "52998224725";
const OUTRO_CPF = "39053344705";

function rejeita(fn: () => unknown): HttpsError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    return error;
  }
  assert.fail("deveria recusar");
}

const colaborador: ColaboradorGravado = {
  id: "col_aaaaaaaaaaaaaaaa",
  nome: "Ana Souza",
  cpf: CPF_DIGITS,
  funcao: "Motorista",
  telefone: "11987654321",
  cnh: { categoria: "C", validade: "2028-04-01" },
  vinculo: "proprio",
  empresa: null,
  papeis: ["motorista"],
  usuario_uid: null,
  usuario_email: null,
  ativo: true,
  edicao: 2,
};

const veiculo: VeiculoGravado = {
  id: "vei_aaaaaaaaaaaaaaaa",
  placa: "ABC1D23",
  tipo: "VUC",
  modelo: "Daily",
  capacidade_kg: 3500,
  capacidade_m3: 12.5,
  dono: "proprio",
  empresa: null,
  revisao_em: null,
  ativo: true,
  edicao: 1,
};

describe("colaborador: entrada", () => {
  it("cria com CPF, telefone e CNH normalizados", () => {
    const acao = interpretarColaborador({
      action: "create",
      idempotency_key: "k1",
      nome: "  Ana   Souza ",
      cpf: CPF,
      funcao: " Motorista ",
      telefone: "(11) 98765-4321",
      cnh_categoria: "c",
      cnh_validade: "2028-04-01",
    });
    assert.equal(acao.action, "create");
    if (acao.action !== "create") return;
    assert.equal(acao.nome, "Ana Souza");
    assert.equal(acao.cpf, CPF_DIGITS);
    assert.equal(acao.funcao, "Motorista");
    assert.equal(acao.telefone, "11987654321");
    assert.deepEqual(acao.cnh, { categoria: "C", validade: "2028-04-01" });
  });

  it("CNH e telefone podem ficar de fora", () => {
    const acao = interpretarColaborador({
      action: "create",
      idempotency_key: "k1",
      nome: "Ana Souza",
      cpf: CPF_DIGITS,
      funcao: "Ajudante",
    });
    assert.equal(acao.action, "create");
    if (acao.action !== "create") return;
    assert.equal(acao.telefone, null);
    assert.equal(acao.cnh, null);
  });

  it("recusa CPF inválido, repetido, curto e categoria de CNH pela metade", () => {
    for (const [cpf, trecho] of [
      ["111.111.111-11", /CPF/],
      ["123", /CPF/],
      ["52998224724", /CPF/],
    ] as const) {
      const error = rejeita(() =>
        interpretarColaborador({
          action: "create",
          idempotency_key: "k1",
          nome: "Ana Souza",
          cpf,
          funcao: "Motorista",
        }),
      );
      assert.equal(error.code, "invalid-argument");
      assert.match(error.message, trecho);
    }
    const metade = rejeita(() =>
      interpretarColaborador({
        action: "create",
        idempotency_key: "k1",
        nome: "Ana Souza",
        cpf: CPF_DIGITS,
        funcao: "Motorista",
        cnh_categoria: "C",
      }),
    );
    assert.match(metade.message, /CNH/);
    const data = rejeita(() =>
      interpretarColaborador({
        action: "create",
        idempotency_key: "k1",
        nome: "Ana Souza",
        cpf: CPF_DIGITS,
        funcao: "Motorista",
        cnh_categoria: "C",
        cnh_validade: "2028-02-31",
      }),
    );
    assert.match(data.message, /validade/);
  });

  it("recusa campo desconhecido e nome curto", () => {
    const extra = rejeita(() =>
      interpretarColaborador({
        action: "create",
        idempotency_key: "k1",
        nome: "Ana Souza",
        cpf: CPF_DIGITS,
        funcao: "Motorista",
        preco: 10,
      }),
    );
    assert.match(extra.message, /não aceito/);
    const nome = rejeita(() =>
      interpretarColaborador({ action: "create", idempotency_key: "k1", nome: " A ", cpf: CPF_DIGITS, funcao: "Motorista" }),
    );
    assert.match(nome.message, /nome/);
  });
});

describe("colaborador: documento", () => {
  it("criar nasce ativo na edição 1", () => {
    const acao = interpretarColaborador({
      action: "create",
      idempotency_key: "k1",
      nome: "Ana Souza",
      cpf: CPF_DIGITS,
      funcao: "Motorista",
      telefone: "11987654321",
      cnh_categoria: "C",
      cnh_validade: "2028-04-01",
    });
    const efeito = aplicarColaborador(null, acao, "col_aaaaaaaaaaaaaaaa");
    assert.equal(efeito.evento, "collaborator.created");
    assert.deepEqual(efeito.documento, {
      id: "col_aaaaaaaaaaaaaaaa",
      nome: "Ana Souza",
      cpf: CPF_DIGITS,
      funcao: "Motorista",
      telefone: "11987654321",
      cnh: { categoria: "C", validade: "2028-04-01" },
      vinculo: "proprio",
      empresa: null,
      papeis: [],
      usuario_uid: null,
      usuario_email: null,
      ativo: true,
      edicao: 1,
    });
  });

  it("vínculo, empresa e papéis (parte 3.4): o terceiro exige a empresa; própria e freelancer não guardam empresa", () => {
    const base = { action: "create", idempotency_key: "k1", nome: "Valter Moreira", cpf: CPF_DIGITS, funcao: "Motorista" };
    const terceiro = interpretarColaborador({ ...base, vinculo: "terceiro", empresa: " Rota   Sul ", papeis: ["motorista"] });
    assert.deepEqual(
      (({ vinculo, empresa, papeis }) => ({ vinculo, empresa, papeis }))(aplicarColaborador(null, terceiro, "col_aaaaaaaaaaaaaaaa").documento),
      { vinculo: "terceiro", empresa: "Rota Sul", papeis: ["motorista"] },
    );
    assert.match(rejeita(() => aplicarColaborador(null, interpretarColaborador({ ...base, vinculo: "terceiro" }), "col_aaaaaaaaaaaaaaaa")).message, /empresa/);
    const freelancer = interpretarColaborador({ ...base, vinculo: "freelancer", empresa: "Qualquer", papeis: ["ajudante", "lider", "ajudante"] });
    const doc = aplicarColaborador(null, freelancer, "col_aaaaaaaaaaaaaaaa").documento;
    assert.equal(doc.empresa, null);
    // Papéis sem repetição, na ordem da lista.
    assert.deepEqual(doc.papeis, ["lider", "ajudante"]);
    assert.equal(rejeita(() => interpretarColaborador({ ...base, papeis: ["gerente"] })).message, "papeis: use lider, motorista, montador, ajudante.");
    assert.equal(rejeita(() => interpretarColaborador({ ...base, vinculo: "pj" })).message, "vinculo: use proprio, freelancer, terceiro.");
  });

  it("o e-mail do app vira o login na gravação; trocar o e-mail desliga o login anterior até a gravação resolver", () => {
    const acao = interpretarColaborador({
      action: "update",
      idempotency_key: "k2",
      id: colaborador.id,
      expected_edicao: 2,
      usuario_email: " Ana@Dutelog.com.br ",
    });
    assert.equal(acao.action === "update" && acao.usuario_email, "ana@dutelog.com.br");
    const efeito = aplicarColaborador({ ...colaborador, usuario_uid: "u-velho", usuario_email: "velho@x.com" }, acao, colaborador.id);
    assert.equal(efeito.documento.usuario_uid, null);
    assert.equal(efeito.documento.usuario_email, "ana@dutelog.com.br");
    assert.match(rejeita(() => interpretarColaborador({ action: "update", idempotency_key: "k3", id: colaborador.id, expected_edicao: 2, usuario_email: "sem-arroba" })).message, /E-mail do app/);
    const semEmail = aplicarColaborador({ ...colaborador, usuario_uid: "u-1", usuario_email: "a@b.com" }, interpretarColaborador({ action: "update", idempotency_key: "k4", id: colaborador.id, expected_edicao: 2, nome: "Ana S." }), colaborador.id);
    assert.equal(semEmail.documento.usuario_uid, "u-1");
  });

  it("atualizar só o que veio, sobe a edição e recusa a edição velha ou o desativado", () => {
    const acao = interpretarColaborador({
      action: "update",
      idempotency_key: "k2",
      id: colaborador.id,
      expected_edicao: 2,
      funcao: "Coordenador",
    });
    const efeito = aplicarColaborador(colaborador, acao, colaborador.id);
    assert.equal(efeito.evento, "collaborator.updated");
    assert.equal(efeito.documento.funcao, "Coordenador");
    assert.equal(efeito.documento.nome, "Ana Souza");
    assert.equal(efeito.documento.edicao, 3);
    assert.equal(efeito.documento.cpf, CPF_DIGITS);

    const velha = rejeita(() =>
      aplicarColaborador(
        colaborador,
        interpretarColaborador({ action: "update", idempotency_key: "k3", id: colaborador.id, expected_edicao: 1, nome: "Ana" }),
        colaborador.id,
      ),
    );
    assert.equal(velha.code, "failed-precondition");
    assert.match(velha.message, /atualizado/);

    const parado = rejeita(() =>
      aplicarColaborador(
        { ...colaborador, ativo: false },
        interpretarColaborador({ action: "update", idempotency_key: "k4", id: colaborador.id, expected_edicao: 2, nome: "Ana Souza" }),
        colaborador.id,
      ),
    );
    assert.match(parado.message, /desativado/);
  });

  it("desativar e reativar são ações próprias e não repetem o estado", () => {
    const desativar = aplicarColaborador(
      colaborador,
      interpretarColaborador({ action: "set_active", idempotency_key: "k5", id: colaborador.id, expected_edicao: 2, ativo: false }),
      colaborador.id,
    );
    assert.equal(desativar.evento, "collaborator.deactivated");
    assert.equal(desativar.documento.ativo, false);
    assert.equal(desativar.documento.edicao, 3);

    const reativar = aplicarColaborador(
      desativar.documento,
      interpretarColaborador({
        action: "set_active",
        idempotency_key: "k6",
        id: colaborador.id,
        expected_edicao: 3,
        ativo: true,
      }),
      colaborador.id,
    );
    assert.equal(reativar.evento, "collaborator.reactivated");
    assert.equal(reativar.documento.ativo, true);

    const ja = rejeita(() =>
      aplicarColaborador(
        colaborador,
        interpretarColaborador({ action: "set_active", idempotency_key: "k7", id: colaborador.id, expected_edicao: 2, ativo: true }),
        colaborador.id,
      ),
    );
    assert.match(ja.message, /já está ativo/);
  });

  it("criar em cima de alguém e alterar quem não existe recusam", () => {
    const criar = rejeita(() =>
      aplicarColaborador(
        colaborador,
        interpretarColaborador({ action: "create", idempotency_key: "k1", nome: "Ana Souza", cpf: OUTRO_CPF, funcao: "Motorista" }),
        colaborador.id,
      ),
    );
    assert.equal(criar.code, "internal");
    const ausente = rejeita(() =>
      aplicarColaborador(
        null,
        interpretarColaborador({ action: "update", idempotency_key: "k2", id: colaborador.id, expected_edicao: 1, nome: "Ana Souza" }),
        colaborador.id,
      ),
    );
    assert.equal(ausente.code, "not-found");
  });

  it("o CPF de outra pessoa é conflito; o do próprio documento não", () => {
    assert.equal(conflitoDeCpf(null, []), null);
    assert.equal(conflitoDeCpf(colaborador.id, [colaborador.id]), null);
    assert.match(conflitoDeCpf(colaborador.id, [colaborador.id, "col_bbbbbbbbbbbbbbbb"]) ?? "", /CPF/);
    assert.match(conflitoDeCpf(null, ["col_bbbbbbbbbbbbbbbb"]) ?? "", /CPF/);
  });
});

describe("veículo: placa, capacidade e edição", () => {
  it("dono, empresa e revisão (parte 3.4): o de terceiro exige a empresa; a revisão é uma data válida", () => {
    const base = { action: "create", idempotency_key: "k1", placa: "FGH2B34", tipo: "Baú truck", capacidade_kg: 8000, capacidade_m3: 45 };
    const terceiro = aplicarVeiculo(null, interpretarVeiculo({ ...base, dono: "terceiro", empresa: "Rota Sul", revisao_em: "2026-12-01" }), veiculo.id).documento;
    assert.deepEqual([terceiro.dono, terceiro.empresa, terceiro.revisao_em], ["terceiro", "Rota Sul", "2026-12-01"]);
    assert.match(rejeita(() => aplicarVeiculo(null, interpretarVeiculo({ ...base, dono: "terceiro" }), veiculo.id)).message, /empresa/);
    const proprio = aplicarVeiculo(null, interpretarVeiculo({ ...base, empresa: "Ignorada" }), veiculo.id).documento;
    assert.deepEqual([proprio.dono, proprio.empresa, proprio.revisao_em], ["proprio", null, null]);
    assert.match(rejeita(() => interpretarVeiculo({ ...base, revisao_em: "2026-02-30" })).message, /revisão/);
    const revisado = aplicarVeiculo(veiculo, interpretarVeiculo({ action: "update", idempotency_key: "k2", id: veiculo.id, expected_edicao: 1, revisao_em: "2027-01-10" }), veiculo.id).documento;
    assert.equal(revisado.revisao_em, "2027-01-10");
    assert.equal(revisado.edicao, 2);
  });

  it("aceita a placa antiga e a Mercosul, e recusa o resto", () => {
    for (const placa of ["abc-1234", "ABC1234", "abc1d23", "ABC-1D23"]) {
      const acao = interpretarVeiculo({
        action: "create",
        idempotency_key: "k1",
        placa,
        tipo: "VUC",
        capacidade_kg: 3500,
        capacidade_m3: 12.5,
      });
      assert.equal(acao.action, "create");
      if (acao.action !== "create") continue;
      assert.match(acao.placa, /^[A-Z]{3}[0-9](?:[0-9]{3}|[A-Z][0-9]{2})$/);
    }
    for (const placa of ["ABC123", "1234ABC", "ABCD123", "ABC12D3"]) {
      const error = rejeita(() =>
        interpretarVeiculo({ action: "create", idempotency_key: "k1", placa, tipo: "VUC", capacidade_kg: 1, capacidade_m3: 1 }),
      );
      assert.match(error.message, /placa/i);
    }
  });

  it("capacidade em quilos inteiros e metros cúbicos com até duas casas", () => {
    const criado = aplicarVeiculo(
      null,
      interpretarVeiculo({
        action: "create",
        idempotency_key: "k1",
        placa: "ABC1D23",
        tipo: " VUC ",
        modelo: " Daily ",
        capacidade_kg: 3500,
        capacidade_m3: 12.5,
      }),
      "vei_aaaaaaaaaaaaaaaa",
    );
    assert.equal(criado.evento, "vehicle.created");
    assert.equal(criado.documento.placa, "ABC1D23");
    assert.equal(criado.documento.tipo, "VUC");
    assert.equal(criado.documento.modelo, "Daily");
    assert.equal(criado.documento.capacidade_kg, 3500);
    assert.equal(criado.documento.capacidade_m3, 12.5);
    assert.equal(criado.documento.ativo, true);
    assert.equal(criado.documento.edicao, 1);

    for (const capacidade of [{ capacidade_kg: 1.5, capacidade_m3: 1 }, { capacidade_kg: 10, capacidade_m3: 1.234 }, { capacidade_kg: 0, capacidade_m3: 1 }]) {
      const error = rejeita(() =>
        interpretarVeiculo({ action: "create", idempotency_key: "k1", placa: "ABC1D23", tipo: "VUC", ...capacidade }),
      );
      assert.equal(error.code, "invalid-argument");
    }
  });

  it("trocar a placa sobe a edição e a placa de outro veículo é conflito", () => {
    const efeito = aplicarVeiculo(
      veiculo,
      interpretarVeiculo({ action: "update", idempotency_key: "k2", id: veiculo.id, expected_edicao: 1, placa: "XYZ9A87" }),
      veiculo.id,
    );
    assert.equal(efeito.evento, "vehicle.updated");
    assert.equal(efeito.documento.placa, "XYZ9A87");
    assert.equal(efeito.documento.modelo, "Daily");
    assert.equal(efeito.documento.edicao, 2);
    assert.equal(conflitoDePlaca(veiculo.id, [veiculo.id]), null);
    assert.match(conflitoDePlaca(null, [veiculo.id]) ?? "", /placa/);
  });
});
