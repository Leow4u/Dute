import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import type { ContextoDoRegistro } from "./execucao.js";
import type { OsGravada } from "./os.js";
import { interpretarPresenca, presencasLidas, registrarPresenca, type PresencaNaOs } from "./presencas.js";

/**
 * A presença da equipe na OS (parte 3.8a): o líder marca todos, quem tem o
 * app marca a própria, vale a primeira marca, a saída pede a entrada.
 */

const ANA = "col_aaaaaaaaaaaaaaaa"; // líder, com o app
const BRUNO = "col_bbbbbbbbbbbbbbbb"; // montador, com o app
const DIEGO = "col_dddddddddddddddd"; // freelancer
const AGORA = new Date("2026-10-22T15:00:00.000Z");

const OS = {
  numero: "10045-01",
  demanda: "10045",
  customer_code: "ITAU",
  status: "em_execucao",
  janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
  equipe: [
    { colaborador_id: ANA, nome: "Ana Lima", papel: "lider", vinculo: "proprio", empresa: null, no_app: true },
    { colaborador_id: BRUNO, nome: "Bruno Teixeira", papel: "montador", vinculo: "proprio", empresa: null, no_app: true },
    { colaborador_id: DIEGO, nome: "Diego Alves", papel: "montador", vinculo: "freelancer", empresa: null, no_app: false },
  ],
  equipe_uids: ["uid-ana", "uid-bruno"],
  edicao: 4,
} as unknown as OsGravada;

const LIDER: ContextoDoRegistro = { agora: AGORA, canal: "celular", registrado_por: { uid: "uid-ana", role: "campo" }, informante: ANA };
const MONTADOR: ContextoDoRegistro = { agora: AGORA, canal: "celular", registrado_por: { uid: "uid-bruno", role: "campo" }, informante: BRUNO };
const ESCRITORIO: ContextoDoRegistro = { agora: AGORA, canal: "escritorio", registrado_por: { uid: "u-paula", role: "interno" } };

function marcar(colaborador_id: string, tipo: "entrada" | "saida", hora: string) {
  return interpretarPresenca({ idempotency_key: "k", numero: "10045-01", colaborador_id, tipo, instante: `2026-10-22T${hora}-03:00` });
}

function recusa(fn: () => unknown, codigo: string, mensagem: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, codigo);
    assert.equal(error.message, mensagem);
    return true;
  });
}

describe("presença", () => {
  it("o líder marca a entrada do freelancer, com o instante e quem marcou", () => {
    const { presencas, marca, registrada } = registrarPresenca(OS, [], marcar(DIEGO, "entrada", "07:45"), LIDER);
    assert.equal(registrada, true);
    assert.deepEqual(marca, {
      instante: "2026-10-22T10:45:00.000Z",
      canal: "celular",
      registrado_por: { uid: "uid-ana", role: "campo" },
      por_colaborador: ANA,
      registrado_em: "2026-10-22T15:00:00.000Z",
    });
    assert.deepEqual(presencas, [{ colaborador_id: DIEGO, entrada: marca, saida: null }]);
  });

  it("quem não é o líder marca só a própria; o escritório marca qualquer um", () => {
    assert.equal(registrarPresenca(OS, [], marcar(BRUNO, "entrada", "07:30"), MONTADOR).registrada, true);
    recusa(() => registrarPresenca(OS, [], marcar(DIEGO, "entrada", "07:45"), MONTADOR), "permission-denied", "Só o líder marca a presença de outra pessoa.");
    assert.equal(registrarPresenca(OS, [], marcar(DIEGO, "entrada", "07:45"), ESCRITORIO).marca.por_colaborador, null);
    recusa(() => registrarPresenca(OS, [], marcar("col_eeeeeeeeeeeeeeee", "entrada", "07:45"), ESCRITORIO), "invalid-argument", "A pessoa não está na equipe da OS.");
  });

  it("vale a primeira marca: a segunda entrada não muda nada", () => {
    const primeira = registrarPresenca(OS, [], marcar(BRUNO, "entrada", "07:30"), LIDER);
    const segunda = registrarPresenca(OS, primeira.presencas, marcar(BRUNO, "entrada", "07:40"), MONTADOR);
    assert.equal(segunda.registrada, false);
    assert.equal(segunda.marca.instante, "2026-10-22T10:30:00.000Z");
    assert.deepEqual(segunda.presencas, primeira.presencas);
  });

  it("a saída pede a entrada antes e não vem antes dela", () => {
    recusa(() => registrarPresenca(OS, [], marcar(DIEGO, "saida", "11:00"), LIDER), "failed-precondition", "Registre a entrada de Diego Alves antes da saída.");
    const entrou = registrarPresenca(OS, [], marcar(DIEGO, "entrada", "07:45"), LIDER).presencas;
    recusa(() => registrarPresenca(OS, entrou, marcar(DIEGO, "saida", "07:00"), LIDER), "failed-precondition", "A saída vem antes da entrada (07:45).");
    const saiu = registrarPresenca(OS, entrou, marcar(DIEGO, "saida", "11:50"), LIDER);
    assert.equal(saiu.presencas[0].saida?.instante, "2026-10-22T14:50:00.000Z");
  });

  it("só na OS agendada ou em execução, e a leitura deixa de fora o que não se lê", () => {
    recusa(() => registrarPresenca({ ...OS, status: "cancelada" }, [], marcar(ANA, "entrada", "07:30"), LIDER), "failed-precondition", "A OS está cancelada.");
    const lidas: PresencaNaOs[] = presencasLidas({
      presencas: [{ colaborador_id: ANA, entrada: { instante: "2026-10-22T10:30:00.000Z", canal: "celular" }, saida: { instante: "x" } }, { entrada: {} }],
    });
    assert.deepEqual(lidas.map((presenca) => [presenca.colaborador_id, presenca.entrada?.canal, presenca.saida]), [[ANA, "celular", null]]);
  });
});
