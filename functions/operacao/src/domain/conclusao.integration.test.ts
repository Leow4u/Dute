import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { completeServiceOrderFor } from "./conclusao-gravacao.js";
import { EVENTS_COLLECTION } from "./events.js";
import { registerItemFor, registerStepFor } from "./execucao-gravacao.js";
import { attachPhotoFor, type ConferirArquivo } from "./fotos-gravacao.js";
import { SERVICE_ORDERS_COLLECTION } from "./os.js";
import type { OperacaoProfile } from "./profile.js";

/**
 * A conclusão no emulador (parte 3.9a): o líder conclui pelo celular com a
 * assinatura conferida no Storage; a OS vai para Em revisão com a etapa Fim,
 * a conclusão e os eventos, sem o nome nem o documento do responsável;
 * repetir não duplica; o item a menos sem motivo não conclui nada.
 */

const PROJECT_ID = "demo-dute-operacao";
const ANA = "col_aaaaaaaaaaaaaaaa"; // líder, com o app
const BRUNO = "col_bbbbbbbbbbbbbbbb"; // montador, com o app
const AGORA = () => new Date("2026-10-22T21:00:00.000Z");

const lider: OperacaoProfile = { uid: "uid-ana", role: "campo", name: "Ana" };
const montador: OperacaoProfile = { uid: "uid-bruno", role: "campo", name: "Bruno" };
const interno: OperacaoProfile = { uid: "interno-1", role: "interno", name: "Paula" };

/** O Storage de mentira: os arquivos que chegaram. */
const NO_STORAGE = new Map<string, { contentType: string; size: number }>([
  ["os/10045-01/fotos/ft_f000000000000001.jpg", { contentType: "image/jpeg", size: 220_000 }],
  ["os/10045-01/assinatura/as_0123456789abcdef.png", { contentType: "image/png", size: 18_000 }],
]);
const conferir: ConferirArquivo = async (caminho) => NO_STORAGE.get(caminho) ?? null;

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-conclusao-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.collection(SERVICE_ORDERS_COLLECTION).doc("10045-01").set({
    id: "10045-01",
    numero: "10045-01",
    demanda: "10045",
    seq: 1,
    customer_code: "ITAU",
    cliente_nome: "Itaú Unibanco",
    status: "agendada",
    escopo_rv: 0,
    itens: [
      { id: "ln_1", item: "Cadeira", descricao: "Transporte de cadeira", servico: "Transporte", unidade: "UN", planejado: "160" },
      { id: "ln_2", item: "Mesa", descricao: "Montagem de mesa", servico: "Montagem", unidade: "UN", planejado: "60" },
    ],
    servicos: ["transporte", "montagem"],
    locais: { origem: null, destino: null },
    janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
    equipe: [
      { colaborador_id: ANA, nome: "Ana Lima", papel: "lider", vinculo: "proprio", empresa: null, no_app: true, usuario_uid: "uid-ana" },
      { colaborador_id: BRUNO, nome: "Bruno Teixeira", papel: "montador", vinculo: "proprio", empresa: null, no_app: true, usuario_uid: "uid-bruno" },
    ],
    equipe_uids: ["uid-ana", "uid-bruno"],
    veiculos: [],
    instrucoes: null,
    edicao: 2,
    cancelamento: null,
  });
  await db.collection("collaborators").doc(ANA).set({ id: ANA, nome: "Ana Lima", cpf: "52998224725", ativo: true, edicao: 1, usuario_uid: "uid-ana" });
  await db.collection("collaborators").doc(BRUNO).set({ id: BRUNO, nome: "Bruno Teixeira", cpf: "11144477735", ativo: true, edicao: 1, usuario_uid: "uid-bruno" });
  // A execução até a montagem, pelo celular da líder.
  await registerStepFor(db, lider, { idempotency_key: "e-1", numero: "10045-01", etapa: "saida_patio", instante: "2026-10-22T07:05-03:00" }, AGORA);
  await registerStepFor(db, lider, { idempotency_key: "e-2", numero: "10045-01", etapa: "montagem", instante: "2026-10-22T13:00-03:00" }, AGORA);
  await registerItemFor(db, lider, { action: "executed", idempotency_key: "i-1", numero: "10045-01", linha: "ln_1", executado: "160", instante: "2026-10-22T16:00-03:00" }, AGORA);
  await registerItemFor(db, lider, { action: "executed", idempotency_key: "i-2", numero: "10045-01", linha: "ln_2", executado: "58", instante: "2026-10-22T17:30-03:00" }, AGORA);
});

after(async () => {
  await deleteApp(app);
});

async function lerOs() {
  return (await db.collection(SERVICE_ORDERS_COLLECTION).doc("10045-01").get()).data() ?? {};
}

async function eventos(tipo: string) {
  return (await db.collection(EVENTS_COLLECTION).where("type", "==", tipo).get()).docs.map((doc) => doc.data());
}

async function recusa(promessa: Promise<unknown>, codigo: string, mensagem: string) {
  await assert.rejects(promessa, (error: unknown) => {
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, codigo);
    assert.equal(error.message, mensagem);
    return true;
  });
}

const fotoDoFinal = () =>
  attachPhotoFor(db, lider, { idempotency_key: "f-1", numero: "10045-01", arquivo: "ft_f000000000000001.jpg", instante: "2026-10-22T17:46-03:00", etapa: "fim" }, conferir, AGORA);

const conclusao = (extra: Record<string, unknown> = {}) => ({
  idempotency_key: "c-1",
  numero: "10045-01",
  instante: "2026-10-22T17:50-03:00",
  aceite: "assinatura",
  responsavel: { nome: "Renata Campos", cargo: "Facilities", documento: "12.345.678-9" },
  assinatura: "as_0123456789abcdef.png",
  diferencas: [{ linha: "ln_2", motivo: "2 mesas com pé quebrado" }],
  ...extra,
});

describe("concluir a OS", () => {
  it("a líder conclui com assinatura: Em revisão, a etapa Fim e os eventos sem nome; repetir não duplica", async () => {
    await fotoDoFinal();
    const resultado = await completeServiceOrderFor(db, lider, conclusao(), conferir, AGORA);
    assert.deepEqual(resultado, { numero: "10045-01", edicao: 8, status: "em_revisao" });

    const os = await lerOs();
    assert.equal(os.status, "em_revisao");
    assert.deepEqual(os.etapas.map((etapa: { etapa: string }) => etapa.etapa), ["saida_patio", "montagem", "fim"]);
    assert.equal(os.etapas.at(-1).instante, "2026-10-22T20:50:00.000Z");
    assert.deepEqual(os.conclusao, {
      instante: "2026-10-22T20:50:00.000Z",
      canal: "celular",
      meio: null,
      informado_por: ANA,
      registrado_por: { uid: "uid-ana", role: "campo" },
      registrado_em: "2026-10-22T21:00:00.000Z",
      aceite: "assinatura",
      responsavel: { nome: "Renata Campos", cargo: "Facilities", documento: "12.345.678-9" },
      assinatura: "os/10045-01/assinatura/as_0123456789abcdef.png",
      diferencas: [{ linha: "ln_2", previsto: "60", executado: "58", motivo: "2 mesas com pé quebrado" }],
    });

    const [concluida] = await eventos("os.completed");
    assert.deepEqual(concluida.payload, {
      id: "10045-01",
      demanda: "10045",
      instante: "2026-10-22T20:50:00.000Z",
      canal: "celular",
      informado_por: ANA,
      aceite: "assinatura",
      itens_a_menos: 1,
      fotos_do_final: 1,
    });
    assert.equal(concluida.occurred_at, "2026-10-22T20:50:00.000Z");
    const [assinada] = await eventos("os.signed");
    assert.deepEqual(assinada.payload, { id: "10045-01", demanda: "10045", instante: "2026-10-22T20:50:00.000Z", canal: "celular" });
    const fins = (await eventos("os.step_recorded")).filter((evento) => evento.payload.etapa === "fim");
    assert.equal(fins.length, 1);
    assert.doesNotMatch(JSON.stringify([concluida, assinada, ...fins]), /Renata|12\.345|Facilities|quebrado/);
    assert.equal((await eventos("os.completed_without_acceptance")).length, 0);

    const repetida = await completeServiceOrderFor(db, lider, conclusao(), conferir, AGORA);
    assert.equal(repetida.replayed, true);
    assert.equal((await eventos("os.completed")).length, 1);
    // Concluída, não recebe mais andamento.
    await recusa(
      registerStepFor(db, lider, { idempotency_key: "e-9", numero: "10045-01", etapa: "fim", instante: "2026-10-22T17:55-03:00" }, AGORA),
      "failed-precondition",
      "A OS já foi concluída.",
    );
  });

  it("sem aceite pelo escritório: o nome de quem recebeu e o evento próprio", async () => {
    await fotoDoFinal();
    await completeServiceOrderFor(
      db,
      interno,
      conclusao({ aceite: "sem_aceite", assinatura: null, responsavel: { nome: "Sr. Almeida (portaria)" }, informado_por: ANA, meio: "telefone" }),
      conferir,
      AGORA,
    );
    const os = await lerOs();
    assert.deepEqual([os.status, os.conclusao.aceite, os.conclusao.assinatura, os.conclusao.canal, os.conclusao.meio], ["em_revisao", "sem_aceite", null, "escritorio", "telefone"]);
    const [sem] = await eventos("os.completed_without_acceptance");
    assert.deepEqual(sem.payload, { id: "10045-01", demanda: "10045", instante: "2026-10-22T20:50:00.000Z", canal: "escritorio" });
    assert.equal((await eventos("os.signed")).length, 0);
  });

  it("nada se grava: item a menos sem motivo, sem foto do final, montador no celular, assinatura que não chegou", async () => {
    await recusa(completeServiceOrderFor(db, lider, conclusao(), conferir, AGORA), "failed-precondition", "Tire ao menos uma foto do final.");
    await fotoDoFinal();
    await recusa(completeServiceOrderFor(db, lider, conclusao({ diferencas: [] }), conferir, AGORA), "invalid-argument", "Mesa: feito 58 de 60. Informe o motivo da diferença.");
    await recusa(completeServiceOrderFor(db, montador, conclusao(), conferir, AGORA), "permission-denied", "Só o líder conclui a OS pelo celular.");
    await recusa(
      completeServiceOrderFor(db, lider, conclusao({ assinatura: "as_ffffffffffffffff.png" }), conferir, AGORA),
      "failed-precondition",
      "A assinatura não chegou ao armazenamento. Envie de novo.",
    );
    const os = await lerOs();
    assert.equal(os.status, "em_execucao");
    assert.equal(os.conclusao, undefined);
    assert.equal((await eventos("os.completed")).length, 0);
  });
});
