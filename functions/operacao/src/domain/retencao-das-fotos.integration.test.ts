import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";

import { OPERACAO_EVENT_SOURCE } from "./events.js";
import { runPhotoRetentionFor, type ApagarArquivo } from "./retencao-das-fotos-gravacao.js";

/**
 * A retenção das fotos da OS no emulador (LGPD, decisão 2): na OS revisada há
 * mais de 12 meses, os arquivos das fotos das etapas, das ocorrências e da
 * vistoria saem do bucket e da OS; ficam as do final e a assinatura; a OS com
 * cobrança fica com todas; o evento de cada OS leva só as contagens; a OS
 * marcada não volta; a falha do bucket deixa a OS para o dia seguinte; a
 * recusa por permissão para a rodada. O bucket é um falso. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-operacao";
const AGORA = new Date("2026-10-26T06:20:00.000Z");
const ATUALIZADA = Timestamp.fromDate(new Date("2025-09-20T15:00:00.000Z"));

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-retencao-fotos-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
});

/** O bucket falso: guarda o que saiu e, por caminho, o erro que devolve. */
function bucket(erros: Record<string, { code: number }> = {}) {
  const apagados: string[] = [];
  const apagar: ApagarArquivo = async (caminho) => {
    const erro = erros[caminho];
    if (erro) throw Object.assign(new Error(`recusado ${erro.code}`), erro);
    apagados.push(caminho);
  };
  return { apagar, apagados };
}

const caminho = (numero: string, id: string) => `os/${numero}/fotos/${id}.jpg`;
const foto = (numero: string, id: string, extra: Record<string, unknown> = {}) => ({
  id,
  caminho: caminho(numero, id),
  etapa: null,
  ocorrencia: null,
  linha: null,
  legenda: null,
  instante: "2025-09-19T13:00:00.000Z",
  ...extra,
});

async function servico(numero: string, revisadaEm: string, extra: Record<string, unknown> = {}) {
  await db.collection("service_orders").doc(numero).set({
    numero,
    demanda: numero.slice(0, 5),
    customer_code: "ITAU",
    tipo: "servico",
    status: "revisada",
    revisao: { instante: revisadaEm, linhas: [{ linha: "l1", decisao: "absorver" }], aditivo: [] },
    conclusao: { arquivos_do_final: ["ft_00000000000000ff.jpg"], assinatura: `os/${numero}/assinatura/as_0000000000000001.png` },
    fotos: [
      foto(numero, "ft_0000000000000001", { etapa: "saida_patio" }),
      foto(numero, "ft_0000000000000002", { ocorrencia: "oc_01", legenda: "Porta riscada na sala 412" }),
      foto(numero, "ft_00000000000000ff", { etapa: "fim" }),
    ],
    updated_at: ATUALIZADA,
    ...extra,
  });
}

async function os(numero: string) {
  return (await db.collection("service_orders").doc(numero).get()).data()!;
}

async function eventos() {
  return (await db.collection("events").where("type", "==", "os.photos_removed").get()).docs.map((doc) => doc.data());
}

describe("a retenção das fotos da OS", () => {
  it("apaga as fotos das etapas e das ocorrências da OS revisada há mais de 12 meses; ficam as do final, e o evento leva as contagens", async () => {
    await servico("10050-01", "2025-09-20T15:00:00.000Z");
    // Revisada há menos de 12 meses, em revisão e com a divergência cobrada.
    await servico("10051-01", "2025-12-01T12:00:00.000Z");
    await servico("10052-01", "2025-09-20T15:00:00.000Z", { status: "em_revisao" });
    await servico("10053-01", "2025-09-20T15:00:00.000Z", { revisao: { instante: "2025-09-20T15:00:00.000Z", linhas: [{ linha: "l1", decisao: "cobrar" }], aditivo: [] } });
    const { apagar, apagados } = bucket();

    const resultado = await runPhotoRetentionFor(db, apagar, { agora: AGORA });

    assert.deepEqual(resultado, { antes_de: "2025-10-26", os: 2, fotos: 2, protegidas: 1, falhas: 0, sem_permissao: false, completo: true });
    assert.deepEqual(apagados.sort(), [caminho("10050-01", "ft_0000000000000001"), caminho("10050-01", "ft_0000000000000002")]);
    const limpa = await os("10050-01");
    assert.deepEqual(limpa.fotos.map((item: { id: string }) => item.id), ["ft_00000000000000ff"]);
    assert.deepEqual(limpa.retencao_das_fotos, { em: AGORA.toISOString(), apagadas: 2, ficaram: 1 });
    // A assinatura e a marca do comprovante ficam; o updated_at não muda (a TV lê o dia por ele).
    assert.deepEqual([limpa.conclusao.assinatura, limpa.conclusao.arquivos_do_final], ["os/10050-01/assinatura/as_0000000000000001.png", ["ft_00000000000000ff.jpg"]]);
    assert.equal(limpa.updated_at.toMillis(), ATUALIZADA.toMillis());

    const cobrada = await os("10053-01");
    assert.deepEqual([cobrada.fotos.length, cobrada.retencao_das_fotos], [3, { em: AGORA.toISOString(), apagadas: 0, ficaram: 3, motivo: "cobranca" }]);
    for (const numero of ["10051-01", "10052-01"]) {
      const intacta = await os(numero);
      assert.deepEqual([intacta.fotos.length, "retencao_das_fotos" in intacta], [3, false], numero);
    }

    const [evento, ...outros] = await eventos();
    assert.equal(outros.length, 0);
    assert.deepEqual([evento!.entity_id, evento!.customer_code, evento!.source, evento!.actor.role], ["10050-01", "ITAU", OPERACAO_EVENT_SOURCE, "sistema"]);
    assert.deepEqual(evento!.payload, { id: "10050-01", demanda: "10050", fotos: 2, ficaram: 1, revisada_em: "2025-09-20" });
    assert.equal(/Porta riscada|os\/10050-01/.test(JSON.stringify(evento)), false);
  });

  it("a vistoria perde todas as fotos, também nos ambientes", async () => {
    await db.collection("service_orders").doc("10060-01").set({
      numero: "10060-01",
      demanda: "10060",
      customer_code: "ITAU",
      tipo: "vistoria",
      status: "revisada",
      vistoria: {
        instante: "2025-09-01T12:00:00.000Z",
        registrado_em: "2025-09-01T12:05:00.000Z",
        ambientes: [{ nome: "Sala 412", fotos: ["ft_0000000000000001", "ft_0000000000000002"] }],
      },
      fotos: [foto("10060-01", "ft_0000000000000001", { legenda: "Sala 412" }), foto("10060-01", "ft_0000000000000002", { etapa: "fim" })],
      updated_at: ATUALIZADA,
    });
    const { apagar, apagados } = bucket();

    const resultado = await runPhotoRetentionFor(db, apagar, { agora: AGORA });

    assert.deepEqual([resultado.os, resultado.fotos], [1, 2]);
    assert.equal(apagados.length, 2);
    const limpa = await os("10060-01");
    assert.deepEqual([limpa.fotos, limpa.vistoria.ambientes], [[], [{ nome: "Sala 412", fotos: [] }]]);
    assert.equal((await eventos())[0]!.payload.revisada_em, "2025-09-01");
  });

  it("rodar de novo não apaga mais nada nem grava outro evento", async () => {
    await servico("10050-01", "2025-09-20T15:00:00.000Z");
    await runPhotoRetentionFor(db, bucket().apagar, { agora: AGORA });
    const { apagar, apagados } = bucket();
    const segunda = await runPhotoRetentionFor(db, apagar, { agora: new Date(AGORA.getTime() + 86_400_000) });
    assert.deepEqual([segunda.os, segunda.fotos, apagados.length], [0, 0, 0]);
    assert.equal((await eventos()).length, 1);
  });

  it("a falha do bucket deixa a OS como estava para o dia seguinte, e as outras seguem", async () => {
    await servico("10050-01", "2025-09-20T15:00:00.000Z");
    await servico("10051-01", "2025-09-21T15:00:00.000Z");
    const primeira = await runPhotoRetentionFor(db, bucket({ [caminho("10050-01", "ft_0000000000000002")]: { code: 503 } }).apagar, { agora: AGORA });
    assert.deepEqual([primeira.os, primeira.falhas], [1, 1]);
    assert.equal((await os("10050-01")).fotos.length, 3);

    const segunda = await runPhotoRetentionFor(db, bucket().apagar, { agora: AGORA });
    assert.deepEqual([segunda.os, segunda.falhas], [1, 0]);
    assert.equal((await os("10050-01")).fotos.length, 1);
  });

  it("a recusa por permissão para a rodada, sem mexer em nenhuma OS", async () => {
    await servico("10050-01", "2025-09-20T15:00:00.000Z");
    await servico("10051-01", "2025-09-21T15:00:00.000Z");
    const recusa = { code: 403 };
    const resultado = await runPhotoRetentionFor(
      db,
      bucket({ [caminho("10050-01", "ft_0000000000000001")]: recusa, [caminho("10051-01", "ft_0000000000000001")]: recusa }).apagar,
      { agora: AGORA },
    );
    assert.deepEqual([resultado.os, resultado.sem_permissao, resultado.completo], [0, true, false]);
    for (const numero of ["10050-01", "10051-01"]) assert.equal((await os(numero)).fotos.length, 3, numero);
  });

  it("a leitura em páginas chega a todas as OS, pelos dois relógios", async () => {
    for (const numero of ["10050-01", "10051-01", "10052-01"]) await servico(numero, "2025-09-20T15:00:00.000Z");
    await db.collection("service_orders").doc("10060-01").set({
      numero: "10060-01",
      demanda: "10060",
      customer_code: "ITAU",
      tipo: "vistoria",
      status: "revisada",
      vistoria: { registrado_em: "2025-09-01T12:05:00.000Z", ambientes: [] },
      fotos: [foto("10060-01", "ft_0000000000000001")],
    });
    const resultado = await runPhotoRetentionFor(db, bucket().apagar, { agora: AGORA, leitura: 1 });
    assert.deepEqual([resultado.os, resultado.fotos, resultado.completo], [4, 7, true]);
  });

  it("o que não coube na rodada fica para a próxima", async () => {
    for (const numero of ["10050-01", "10051-01", "10052-01"]) await servico(numero, "2025-09-20T15:00:00.000Z");
    const primeira = await runPhotoRetentionFor(db, bucket().apagar, { agora: AGORA, porRodada: 2 });
    assert.deepEqual([primeira.os, primeira.completo], [2, false]);
    const segunda = await runPhotoRetentionFor(db, bucket().apagar, { agora: AGORA, porRodada: 2 });
    assert.deepEqual([segunda.os, segunda.completo], [1, true]);
  });
});
