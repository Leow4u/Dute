import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import {
  ETAPAS_DA_OS,
  MAX_OCORRENCIAS,
  execucaoLida,
  instanteDoRegistro,
  interpretarEtapa,
  interpretarOcorrencia,
  problemaParaRegistrar,
  registrarEtapa,
  registrarOcorrencia,
  type ContextoDoRegistro,
  type EtapaRegistrada,
  type OcorrenciaRegistrada,
} from "./execucao.js";
import type { OsGravada } from "./os.js";

/**
 * A execução da OS pelo escritório (parte 3.7a): etapa na ordem do serviço,
 * com o instante em que aconteceu; a primeira põe a OS Em execução.
 */

const ANA = "col_aaaaaaaaaaaaaaaa";
const BRUNO = "col_bbbbbbbbbbbbbbbb";
const AGORA = new Date("2026-10-22T15:00:00.000Z"); // 12:00 em São Paulo
const ESCRITORIO: ContextoDoRegistro = { agora: AGORA, canal: "escritorio", registrado_por: { uid: "u-paula", role: "interno" } };

const OS: OsGravada = {
  numero: "10045-01",
  demanda: "10045",
  seq: 1,
  customer_code: "ITAU",
  status: "agendada",
  escopo_rv: 0,
  itens: [],
  servicos: ["transporte", "montagem"],
  locais: { origem: null, destino: null },
  janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
  equipe: [
    { colaborador_id: ANA, nome: "Ana Lima", papel: "lider", vinculo: "proprio", empresa: null, no_app: true },
    { colaborador_id: BRUNO, nome: "Bruno Teixeira", papel: "motorista", vinculo: "terceiro", empresa: "Rota Sul", no_app: false },
  ],
  equipe_uids: ["uid-ana"],
  veiculos: [],
  instrucoes: null,
  edicao: 3,
  cancelamento: null,
};

function etapa(nome: (typeof ETAPAS_DA_OS)[number], instante: string, extra: Record<string, unknown> = {}) {
  return interpretarEtapa({ idempotency_key: `k-${nome}`, numero: "10045-01", etapa: nome, instante, ...extra });
}

function recusa(fn: () => unknown, codigo: string, mensagem: string | RegExp) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, codigo);
    if (typeof mensagem === "string") assert.equal(error.message, mensagem);
    else assert.match(error.message, mensagem);
    return true;
  });
}

describe("entrada", () => {
  it("etapa da lista, instante com fuso, quem informou e o meio opcionais", () => {
    assert.deepEqual(etapa("saida_patio", "2026-10-22T07:05-03:00"), {
      idempotency_key: "k-saida_patio",
      numero: "10045-01",
      etapa: "saida_patio",
      instante: "2026-10-22T07:05-03:00",
      informado_por: null,
      meio: null,
    });
    recusa(() => etapa("saida_patio", "2026-10-22 07:05"), "invalid-argument", "Hora inválida: informe data, hora e fuso.");
    recusa(() => interpretarEtapa({ idempotency_key: "k", numero: "10045-01", etapa: "almoco", instante: "2026-10-22T07:05Z" }), "invalid-argument", /^etapa: use saida_patio/);
    recusa(() => etapa("fim", "2026-10-22T07:05Z", { valor: 1 }), "invalid-argument", "Campo não aceito: valor.");
    recusa(() => etapa("fim", "2026-10-22T07:05Z", { meio: "radio" }), "invalid-argument", /^meio: use telefone, whatsapp, presencial/);
  });

  it("a ocorrência pede descrição de 3 a 1000 caracteres", () => {
    const base = { idempotency_key: "k", numero: "10045-01", instante: "2026-10-22T09:00-03:00" };
    assert.equal(interpretarOcorrencia({ ...base, descricao: "  Elevador de carga parado  " }).descricao, "Elevador de carga parado");
    recusa(() => interpretarOcorrencia({ ...base, descricao: "ok" }), "invalid-argument", "Descreva a ocorrência.");
    recusa(() => interpretarOcorrencia({ ...base, descricao: "x".repeat(1001) }), "invalid-argument", "Use até 1000 caracteres na ocorrência.");
  });
});

describe("a OS que recebe andamento", () => {
  it("só a agendada e a em execução", () => {
    assert.equal(problemaParaRegistrar({ status: "agendada" }), null);
    assert.equal(problemaParaRegistrar({ status: "em_execucao" }), null);
    assert.equal(problemaParaRegistrar({ status: "aberta" }), "Agende a OS antes de registrar o andamento.");
    assert.equal(problemaParaRegistrar({ status: "cancelada" }), "A OS está cancelada.");
    assert.equal(problemaParaRegistrar({ status: "em_revisao" }), "A OS já foi concluída.");
  });

  it("o instante vira UTC; no futuro ou antes do dia da OS é recusado", () => {
    assert.equal(instanteDoRegistro("2026-10-22T07:05-03:00", OS, AGORA), "2026-10-22T10:05:00.000Z");
    // Até 5 minutos adiantado passa (o relógio do celular).
    assert.equal(instanteDoRegistro("2026-10-22T12:04-03:00", OS, AGORA), "2026-10-22T15:04:00.000Z");
    recusa(() => instanteDoRegistro("2026-10-22T12:10-03:00", OS, AGORA), "invalid-argument", "A hora informada ainda não chegou.");
    recusa(() => instanteDoRegistro("2026-10-21T23:50-03:00", OS, AGORA), "invalid-argument", "A hora é de antes do dia da OS (22/10/2026).");
    // 02:30 UTC do dia 22 ainda é dia 21 em São Paulo.
    recusa(() => instanteDoRegistro("2026-10-22T02:30:00.000Z", OS, AGORA), "invalid-argument", "A hora é de antes do dia da OS (22/10/2026).");
  });
});

describe("etapas", () => {
  it("a primeira põe a OS em execução e guarda o instante, o canal, quem informou e quem registrou", () => {
    const { etapas, registro, iniciou } = registrarEtapa(OS, [], etapa("saida_patio", "2026-10-22T07:05-03:00", { informado_por: BRUNO, meio: "telefone" }), ESCRITORIO);
    assert.equal(iniciou, true);
    assert.deepEqual(registro, {
      etapa: "saida_patio",
      instante: "2026-10-22T10:05:00.000Z",
      canal: "escritorio",
      meio: "telefone",
      informado_por: BRUNO,
      registrado_por: { uid: "u-paula", role: "interno" },
      registrado_em: "2026-10-22T15:00:00.000Z",
    });
    assert.deepEqual(etapas, [registro]);
  });

  it("pular etapa vale; etapa fora de ordem, repetida ou com hora antes da última é recusada", () => {
    const emExecucao: OsGravada = { ...OS, status: "em_execucao" };
    let atuais: EtapaRegistrada[] = registrarEtapa(OS, [], etapa("saida_patio", "2026-10-22T07:05-03:00"), ESCRITORIO).etapas;
    atuais = registrarEtapa(emExecucao, atuais, etapa("carregamento", "2026-10-22T07:50-03:00"), ESCRITORIO).etapas;
    assert.deepEqual(atuais.map((item) => item.etapa), ["saida_patio", "carregamento"]);
    recusa(
      () => registrarEtapa(emExecucao, atuais, etapa("chegada_origem", "2026-10-22T07:55-03:00"), ESCRITORIO),
      "failed-precondition",
      "Chegada na origem vem antes de Carregamento, que já foi registrada.",
    );
    recusa(() => registrarEtapa(emExecucao, atuais, etapa("carregamento", "2026-10-22T08:00-03:00"), ESCRITORIO), "failed-precondition", "Carregamento já foi registrada.");
    recusa(
      () => registrarEtapa(emExecucao, atuais, etapa("saida_origem", "2026-10-22T07:45-03:00"), ESCRITORIO),
      "failed-precondition",
      "A hora vem antes de Carregamento (07:50).",
    );
    const fim = registrarEtapa(emExecucao, atuais, etapa("fim", "2026-10-22T11:40-03:00"), ESCRITORIO);
    assert.equal(fim.iniciou, false);
    assert.deepEqual(fim.etapas.map((item) => item.etapa), ["saida_patio", "carregamento", "fim"]);
  });

  it("sem equipe não inicia; quem informou é da equipe; o celular não leva o meio", () => {
    recusa(() => registrarEtapa({ ...OS, equipe: [] }, [], etapa("saida_patio", "2026-10-22T07:05-03:00"), ESCRITORIO), "failed-precondition", "Escale a equipe antes de iniciar a OS.");
    recusa(
      () => registrarEtapa(OS, [], etapa("saida_patio", "2026-10-22T07:05-03:00", { informado_por: "col_cccccccccccccccc" }), ESCRITORIO),
      "invalid-argument",
      "Quem informou não está na equipe da OS.",
    );
    const celular: ContextoDoRegistro = { ...ESCRITORIO, canal: "celular", registrado_por: { uid: "uid-ana", role: "campo" } };
    recusa(() => registrarEtapa(OS, [], etapa("saida_patio", "2026-10-22T07:05-03:00", { meio: "whatsapp" }), celular), "invalid-argument", "O registro do celular não leva o meio.");
    assert.equal(registrarEtapa(OS, [], etapa("saida_patio", "2026-10-22T07:05-03:00"), celular).registro.canal, "celular");
  });

  it("OS aberta, cancelada ou concluída não recebe etapa", () => {
    for (const [status, mensagem] of [
      ["aberta", "Agende a OS antes de registrar o andamento."],
      ["cancelada", "A OS está cancelada."],
      ["em_revisao", "A OS já foi concluída."],
    ] as const) {
      recusa(() => registrarEtapa({ ...OS, status }, [], etapa("saida_patio", "2026-10-22T07:05-03:00"), ESCRITORIO), "failed-precondition", mensagem);
    }
  });
});

describe("ocorrências", () => {
  const pedido = (descricao: string) => interpretarOcorrencia({ idempotency_key: "k", numero: "10045-01", descricao, instante: "2026-10-22T09:00-03:00", informado_por: ANA, meio: "whatsapp" });

  it("numera na OS e não muda o status", () => {
    const primeira = registrarOcorrencia(OS, [], pedido("Elevador de carga parado"), ESCRITORIO);
    assert.equal(primeira.registro.id, "oc_01");
    assert.equal(primeira.registro.instante, "2026-10-22T12:00:00.000Z");
    const segunda = registrarOcorrencia({ ...OS, status: "em_execucao" }, primeira.ocorrencias, pedido("Cliente pediu mais 10 cadeiras"), ESCRITORIO);
    assert.deepEqual(segunda.ocorrencias.map((item) => [item.id, item.descricao]), [
      ["oc_01", "Elevador de carga parado"],
      ["oc_02", "Cliente pediu mais 10 cadeiras"],
    ]);
  });

  it("tem limite por OS e segue o status da OS", () => {
    const cheias = Array.from({ length: MAX_OCORRENCIAS }, (_, indice) => ({ id: `oc_${indice + 1}` }) as OcorrenciaRegistrada);
    recusa(() => registrarOcorrencia(OS, cheias, pedido("Mais uma"), ESCRITORIO), "failed-precondition", "A OS já tem 50 ocorrências.");
    recusa(() => registrarOcorrencia({ ...OS, status: "cancelada" }, [], pedido("Depois de cancelar"), ESCRITORIO), "failed-precondition", "A OS está cancelada.");
  });
});

describe("leitura", () => {
  it("lê etapas e ocorrências gravadas e deixa de fora o que não se lê", () => {
    const lida = execucaoLida({
      etapas: [
        { etapa: "saida_patio", instante: "2026-10-22T10:05:00.000Z", canal: "celular", meio: null, informado_por: null, registrado_por: { uid: "uid-ana", role: "campo" }, registrado_em: "x" },
        { etapa: "almoco", instante: "2026-10-22T11:00:00.000Z" },
        { etapa: "fim", instante: "ontem" },
        "lixo",
      ],
      ocorrencias: [{ id: "oc_01", descricao: "Chuva", instante: "2026-10-22T12:00:00.000Z", canal: "escritorio", meio: "telefone" }],
    });
    assert.deepEqual(lida.etapas.map((item) => [item.etapa, item.canal]), [["saida_patio", "celular"]]);
    assert.deepEqual(lida.ocorrencias.map((item) => [item.id, item.meio]), [["oc_01", "telefone"]]);
    assert.deepEqual(execucaoLida({}), { etapas: [], ocorrencias: [] });
  });
});
