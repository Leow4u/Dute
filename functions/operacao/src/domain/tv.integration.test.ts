import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { SERVICE_ORDERS_COLLECTION } from "./os.js";
import type { OperacaoProfile } from "./profile.js";
import { getRoomBoardFor } from "./tv-leitura.js";

/**
 * A TV da sala no emulador (parte 3.12): o painel e quem coordena leem o
 * quadro do dia; o campo, o comercial, o suporte, o financeiro, o wms, o rh e
 * o cliente não. O quadro traz a agendada de hoje, a em execução com o prazo
 * da demanda direta e a concluída hoje, sem contato, endereço, instruções nem
 * o documento de quem assinou. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-operacao";
const AGORA = () => new Date("2026-10-23T17:32:00.000Z"); // 14:32 em São Paulo

const painel: OperacaoProfile = { uid: "painel-1", role: "painel", name: "TV da sala" };
const interno: OperacaoProfile = { uid: "interno-1", role: "interno", name: "Paula" };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-tv-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const etapa = (nome: string, instante: string) => ({
  etapa: nome,
  instante,
  canal: "celular",
  meio: null,
  informado_por: "col_aaaaaaaaaaaaaaaa",
  registrado_por: { uid: "uid-ana", role: "campo" },
  registrado_em: instante,
});

function os(numero: string, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    numero,
    demanda: numero.slice(0, 5),
    seq: 1,
    customer_code: "ITAU",
    cliente_nome: "Itaú Unibanco",
    tipo: "servico",
    status: "agendada",
    edicao: 2,
    itens: [],
    servicos: ["transporte"],
    locais: {
      origem: { local_id: "loc_ceic", nome: "CEIC", endereco: "Av. Paulista, 1842", complemento: "12º andar", contato: { nome: "Carla Souza", telefone: "11987654321" } },
      destino: { local_id: "loc_cat", nome: "Faria Lima", endereco: "Av. Brigadeiro Faria Lima, 3500", complemento: null, contato: null },
    },
    janela: { data: "2026-10-23", inicio: "15:00", fim: null },
    equipe: [{ colaborador_id: "col_aaaaaaaaaaaaaaaa", nome: "Ana Lima", papel: "lider", vinculo: "clt", empresa: null, no_app: true, usuario_uid: "uid-ana" }],
    equipe_uids: ["uid-ana"],
    veiculos: [{ veiculo_id: "vei_aaaaaaaaaaaaaaaa", placa: "ABC1D23", tipo: "VUC", modelo: null, dono: "proprio", empresa: null }],
    instrucoes: "Ligar para a Carla antes de subir.",
    updated_at: Timestamp.fromDate(new Date("2026-10-22T20:00:00.000Z")),
    ...extra,
  };
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  const set = (path: string, data: Record<string, unknown>) => batch.set(db.doc(path), data);
  set("demands/10053", { numero: "10053", entrada: "direta", executar_ate: "2026-10-23T14:00:00-03:00", customer_name: "Itaú Unibanco", titulo: "Transporte de 6 cadeiras" });
  set(`${SERVICE_ORDERS_COLLECTION}/10045-01`, os("10045-01", {}));
  set(`${SERVICE_ORDERS_COLLECTION}/10046-01`, os("10046-01", { janela: { data: "2026-10-28", inicio: "09:00", fim: null } }));
  set(`${SERVICE_ORDERS_COLLECTION}/10053-01`, os("10053-01", { status: "em_execucao", janela: { data: "2026-10-23", inicio: "09:30", fim: null }, etapas: [etapa("saida_patio", "2026-10-23T12:30:00.000Z")] }));
  set(
    `${SERVICE_ORDERS_COLLECTION}/10047-01`,
    os("10047-01", {
      status: "em_revisao",
      etapas: [etapa("saida_patio", "2026-10-23T11:00:00.000Z"), etapa("fim", "2026-10-23T15:40:00.000Z")],
      conclusao: {
        ...etapa("fim", "2026-10-23T15:40:00.000Z"),
        aceite: "assinatura",
        responsavel: { nome: "Carla Souza", cargo: "Facilities", documento: "52998224725" },
        assinatura: "os/10047-01/assinatura/as_a000000000000001.png",
        diferencas: [],
      },
      updated_at: Timestamp.fromDate(new Date("2026-10-23T15:40:05.000Z")),
    }),
  );
  // Concluída ontem e revisada hoje: não é das concluídas de hoje.
  set(
    `${SERVICE_ORDERS_COLLECTION}/10048-01`,
    os("10048-01", { status: "revisada", etapas: [etapa("fim", "2026-10-22T19:00:00.000Z")], updated_at: Timestamp.fromDate(new Date("2026-10-23T13:00:00.000Z")) }),
  );
  set(`${SERVICE_ORDERS_COLLECTION}/10049-01`, os("10049-01", { status: "cancelada", cancelamento: { motivo: "Cliente desistiu." }, updated_at: Timestamp.fromDate(new Date("2026-10-23T13:00:00.000Z")) }));
  set(`${SERVICE_ORDERS_COLLECTION}/10050-01`, os("10050-01", { status: "aberta", janela: null }));
  await batch.commit();
});

describe("a TV da sala", () => {
  it("o painel lê o quadro de hoje: agendada, em execução com o prazo da direta e concluída hoje", async () => {
    const quadro = await getRoomBoardFor(db, painel, AGORA);
    assert.equal(quadro.hoje, "2026-10-23");
    assert.deepEqual(
      quadro.ordens.map((item) => [item.numero, item.coluna]),
      [
        ["10045-01", "agendada"],
        ["10053-01", "em_execucao"],
        ["10047-01", "concluida"],
      ],
    );
    const emExecucao = quadro.ordens.find((item) => item.numero === "10053-01");
    assert.equal(emExecucao?.ate, "2026-10-23T17:00:00.000Z");
    assert.deepEqual(emExecucao?.etapa, { etapa: "saida_patio", instante: "2026-10-23T12:30:00.000Z" });
    const concluida = quadro.ordens.find((item) => item.numero === "10047-01");
    assert.equal(concluida?.aceite, "assinatura");
    assert.equal(concluida?.concluida_em, "2026-10-23T15:40:00.000Z");
  });

  it("sem valor, contato, telefone, endereço, instruções, motivo nem documento de quem assinou", async () => {
    const texto = JSON.stringify(await getRoomBoardFor(db, painel, AGORA));
    for (const proibido of ["11987654321", "Carla", "Paulista", "12º andar", "Ligar", "52998224725", "assinatura/", "desistiu", "uid-ana", "col_aaaa", "R$"]) {
      assert.ok(!texto.includes(proibido), proibido);
    }
  });

  it("quem coordena também abre; os outros papéis não", async () => {
    assert.equal((await getRoomBoardFor(db, interno, AGORA)).ordens.length, 3);
    for (const role of ["owner", "admin"] as const) {
      assert.equal((await getRoomBoardFor(db, { uid: `${role}-1`, role }, AGORA)).ordens.length, 3);
    }
    for (const role of ["campo", "comercial", "suporte", "financeiro", "wms", "rh", "cliente"] as const) {
      await assert.rejects(getRoomBoardFor(db, { uid: `${role}-1`, role }, AGORA), (error: unknown) => {
        assert.ok(error instanceof HttpsError, String(error));
        assert.equal(error.code, "permission-denied", role);
        assert.equal(error.message, "Seu perfil não abre a TV da sala.");
        return true;
      });
    }
  });

  it("a leitura não grava nada", async () => {
    const antes = (await db.collection(SERVICE_ORDERS_COLLECTION).get()).docs.map((doc) => [doc.id, doc.updateTime.toMillis()]);
    await getRoomBoardFor(db, painel, AGORA);
    const depois = (await db.collection(SERVICE_ORDERS_COLLECTION).get()).docs.map((doc) => [doc.id, doc.updateTime.toMillis()]);
    assert.deepEqual(depois, antes);
    assert.equal((await db.collection("events").get()).size, 0);
    assert.equal((await db.collection("operacao_operations").get()).size, 0);
  });
});
