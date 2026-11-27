import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  AnexarDocumentoSchema,
  AnexarFotoSchema,
  TAMANHO_DA_FOTO,
  TAMANHO_DO_DOCUMENTO,
  TirarDocumentoSchema,
  attachEventDocumentTransaction,
  attachEventPhotoTransaction,
  removeEventDocumentTransaction,
  type ArquivoNoBucket,
  type BucketDosEventos,
} from "./arquivos.js";
import { entradaDe, entradaDoSalvar } from "./edicao.js";
import { EDICOES_COLLECTION, OPERATIONS_COLLECTION, saveEventEditionTransaction } from "./edicao-gravacao.js";

/**
 * Os arquivos da edição do evento no emulador (eventos, parte 3): o
 * documento do cliente e o da Dutelog entram conferidos no bucket, um sai do
 * registro e o arquivo fica; a foto entra no momento a partir da
 * confirmação; o arquivo errado é apagado por geração e recusado; o cliente
 * de outro código não acha nada. O bucket é falso: a conferência de verdade
 * (Admin SDK) é a de index.ts.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const PLANILHA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const cristiane = { uid: "cli-1", role: "cliente", customer_code: BTG, name: "Cristiane" };
const outraCliente = { uid: "cli-2", role: "cliente", customer_code: "Outro", name: "Paula" };
const manoel = { uid: "manoel", role: "interno", name: "Manoel" };
const rafael = { uid: "rafael", role: "wms", name: "Rafael" };
const bruno = { uid: "bruno", role: "wms", name: "Bruno" };

type Ator = typeof cristiane | typeof outraCliente | typeof manoel | typeof rafael;

let noBucket: Map<string, ArquivoNoBucket>;
let apagados: string[];
let geracao = 1_764_000_000_000_000;

const bucket: BucketDosEventos = {
  conferir: async (caminho) => noBucket.get(caminho) ?? null,
  apagar: async (caminho, generation) => {
    apagados.push(`${caminho}#${generation}`);
    noBucket.delete(caminho);
  },
};

/** O arquivo que o navegador subiu: o tipo e o tamanho que o bucket guarda, com uma geração nova. */
function subiu(caminho: string, contentType: string, size = 1_200) {
  geracao += 1;
  noBucket.set(caminho, { contentType, size, generation: String(geracao) });
  return `${caminho}#${geracao}`;
}

const hex = (n: number) => n.toString(16).padStart(16, "0");
const anexoDoCliente = (edicao: string, arquivo: string) => `portal/${BTG}/eventos/${edicao}/${arquivo}`;
const docDaDutelog = (edicao: string, arquivo: string) => `eventos/${BTG}/${edicao}/docs/${arquivo}`;
const fotoDaDutelog = (edicao: string, arquivo: string) => `eventos/${BTG}/${edicao}/fotos/${arquivo}`;

async function anexar(ator: Ator, raw: Record<string, unknown>) {
  return attachEventDocumentTransaction(db, entradaDe(AnexarDocumentoSchema, raw), ator, bucket);
}

async function tirar(ator: Ator, raw: Record<string, unknown>) {
  return removeEventDocumentTransaction(db, entradaDe(TirarDocumentoSchema, raw), ator);
}

async function fotografar(ator: Ator, raw: Record<string, unknown>) {
  return attachEventPhotoTransaction(db, entradaDe(AnexarFotoSchema, raw), ator, bucket);
}

const momento = (tipo: string, data: string, hora: string | null, extra: Record<string, unknown> = {}) => ({ tipo, data, hora, ...extra });

/** A edição da Necton em rascunho, com o cronograma da coleta, da entrega, do evento e do retorno. */
async function edicaoDaNecton(chave: string) {
  const criada = await saveEventEditionTransaction(
    db,
    {
      ...entradaDoSalvar({
        idempotency_key: chave,
        name: "B2B Conference Necton",
        patch: {
          onde: { local: "Hotel Unique", endereco: "Av. Brigadeiro Luís Antônio, 4700", contato: { nome: "Cristiane", telefone: "11 99999-0000" } },
          cronograma: [
            momento("coleta_no_cliente", "2027-01-27", "05:00"),
            momento("entrega_no_local", "2027-01-27", "08:30"),
            momento("evento", "2027-01-28", "08:00", { ate: "20:00" }),
            momento("retorno_ao_estoque", "2027-01-30", null),
          ],
        },
      }),
      customer_code: BTG,
    },
    cristiane,
  );
  const idDo = (tipo: string) => {
    const achado = criada.edition.cronograma.find((linha) => linha.tipo === tipo);
    assert.ok(achado, tipo);
    return achado.id;
  };
  return { id: criada.id, edicao: criada.edicao, coleta: idDo("coleta_no_cliente"), entrega: idDo("entrega_no_local"), evento: idDo("evento") };
}

async function mudarStatus(id: string, status: string) {
  await db.collection(EDICOES_COLLECTION).doc(id).update({ status });
}

async function gravada(id: string) {
  return (await db.collection(EDICOES_COLLECTION).doc(id).get()).data() ?? {};
}

async function eventsFor(id: string) {
  const snapshot = await db.collection("events").where("entity_id", "==", id).get();
  return snapshot.docs.map((document) => document.data());
}

async function eventosDoTipo(id: string, tipo: string) {
  return (await eventsFor(id)).filter((evento) => evento.type === tipo);
}

async function recibosDe(id: string) {
  const snapshot = await db.collection(OPERATIONS_COLLECTION).where("target_id", "==", id).get();
  return snapshot.docs.map((document) => document.data());
}

async function recusa(promessa: Promise<unknown>, codigo: string, mensagem: string) {
  await assert.rejects(promessa, (erro: unknown) => {
    assert.equal((erro as { code?: string }).code, codigo);
    assert.equal((erro as Error).message, mensagem);
    return true;
  });
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "eventos-arquivos-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  noBucket = new Map();
  apagados = [];
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
});

after(async () => {
  await deleteApp(app);
});

describe("os arquivos da edição do evento no servidor", () => {
  it("1. o cliente anexa o layout no rascunho: id, caminho portal/…, tipo e tamanho do bucket, origem cliente, edicao + 1 e o evento documento_anexado sem o nome do arquivo; a mesma chave devolve o mesmo; o mesmo arquivo com outra chave recusa 'O arquivo já está na edição.'", async () => {
    const edicao = await edicaoDaNecton("necton-arquivos-0001");
    const arquivo = `an_${hex(0xa1)}.pdf`;
    subiu(anexoDoCliente(edicao.id, arquivo), "application/pdf", 1_234_567);
    const entrada = { edition_id: edicao.id, arquivo, nome: "layout-necton-2027.pdf", idempotency_key: "anexar-layout-0001" };

    const r = await anexar(cristiane, entrada);
    assert.equal(r.id, edicao.id);
    assert.equal(r.edicao, edicao.edicao + 1);
    assert.equal(r.documentos, 1);
    assert.match(r.documento.registrado_em, ISO);
    assert.deepEqual(r.documento, {
      id: `an_${hex(0xa1)}`,
      caminho: anexoDoCliente(edicao.id, arquivo),
      nome: "layout-necton-2027.pdf",
      tipo: "application/pdf",
      tamanho: 1_234_567,
      origem: "cliente",
      momento_id: null,
      registrado_por: { uid: "cli-1", name: "Cristiane", role: "cliente" },
      registrado_em: r.documento.registrado_em,
    });

    const depois = await gravada(edicao.id);
    assert.equal(depois.edicao, edicao.edicao + 1);
    assert.deepEqual(depois.documentos, [r.documento]);
    assert.deepEqual(depois.updated_by, { uid: "cli-1", name: "Cristiane", role: "cliente" });
    const anexados = await eventosDoTipo(edicao.id, "evento.documento_anexado");
    assert.equal(anexados.length, 1);
    assert.deepEqual(anexados[0]!.payload, { edition_id: edicao.id, documento_id: `an_${hex(0xa1)}`, origem: "cliente" });
    assert.equal(anexados[0]!.source, "functions_client_events");
    assert.equal(anexados[0]!.description, "B2B Conference Necton · 2027");
    assert.doesNotMatch(JSON.stringify(anexados[0]), /layout-necton/);
    const [recibo] = (await recibosDe(edicao.id)).filter((op) => op.kind === "evento.documento.attach");
    assert.deepEqual(recibo?.result, { id: edicao.id, edicao: edicao.edicao + 1, documento_id: `an_${hex(0xa1)}`, documentos: 1 });
    assert.equal(recibo?.customer_code, BTG);

    // O clique duplo: a mesma chave devolve o mesmo registro, sem segunda entrada nem segundo evento.
    assert.deepEqual(await anexar(cristiane, entrada), r);
    assert.equal((await gravada(edicao.id)).documentos.length, 1);
    assert.equal((await eventosDoTipo(edicao.id, "evento.documento_anexado")).length, 1);

    await recusa(anexar(cristiane, { ...entrada, idempotency_key: "anexar-layout-0002" }), "already-exists", "O arquivo já está na edição.");
    await recusa(anexar(cristiane, { ...entrada, nome: "outro-nome.pdf" }), "already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
    assert.deepEqual(apagados, []);
  });

  it("2. o arquivo que não chegou recusa 'O arquivo não chegou ao armazenamento. Envie de novo.'; o .pdf com text/html e a planilha de 10 MiB + 1 são apagados e recusados, e a edição não muda", async () => {
    const edicao = await edicaoDaNecton("necton-arquivos-0002");
    await recusa(
      anexar(cristiane, { edition_id: edicao.id, arquivo: `an_${hex(0xb1)}.pdf`, nome: "layout.pdf", idempotency_key: "anexar-0002-a" }),
      "failed-precondition",
      "O arquivo não chegou ao armazenamento. Envie de novo.",
    );

    const html = subiu(anexoDoCliente(edicao.id, `an_${hex(0xb2)}.pdf`), "text/html", 300);
    await recusa(
      anexar(cristiane, { edition_id: edicao.id, arquivo: `an_${hex(0xb2)}.pdf`, nome: "layout.pdf", idempotency_key: "anexar-0002-b" }),
      "invalid-argument",
      "O arquivo enviado não é PDF, imagem nem planilha.",
    );
    const grande = subiu(anexoDoCliente(edicao.id, `an_${hex(0xb3)}.xlsx`), PLANILHA, TAMANHO_DO_DOCUMENTO + 1);
    await recusa(
      anexar(cristiane, { edition_id: edicao.id, arquivo: `an_${hex(0xb3)}.xlsx`, nome: "produtos.xlsx", idempotency_key: "anexar-0002-c" }),
      "invalid-argument",
      "O documento passa de 10 MB.",
    );
    assert.deepEqual(apagados, [html, grande]);
    assert.equal(noBucket.size, 0);

    // Sem a geração, o arquivo errado não se apaga (o que veio depois não pode sair), e a recusa fica.
    noBucket.set(anexoDoCliente(edicao.id, `an_${hex(0xb4)}.pdf`), { contentType: "text/html", size: 300 });
    await recusa(
      anexar(cristiane, { edition_id: edicao.id, arquivo: `an_${hex(0xb4)}.pdf`, nome: "layout.pdf", idempotency_key: "anexar-0002-d" }),
      "invalid-argument",
      "O arquivo enviado não é PDF, imagem nem planilha.",
    );
    assert.equal(apagados.length, 2);

    // A falha ao apagar não esconde a recusa.
    const quebrado: BucketDosEventos = { conferir: bucket.conferir, apagar: async () => Promise.reject(new Error("sem permissão no bucket")) };
    subiu(anexoDoCliente(edicao.id, `an_${hex(0xb5)}.pdf`), "text/html", 300);
    await recusa(
      attachEventDocumentTransaction(
        db,
        entradaDe(AnexarDocumentoSchema, { edition_id: edicao.id, arquivo: `an_${hex(0xb5)}.pdf`, nome: "layout.pdf", idempotency_key: "anexar-0002-e" }),
        cristiane,
        quebrado,
      ),
      "invalid-argument",
      "O arquivo enviado não é PDF, imagem nem planilha.",
    );

    const depois = await gravada(edicao.id);
    assert.equal(depois.edicao, edicao.edicao);
    assert.deepEqual(depois.documentos, []);
    assert.deepEqual(await eventosDoTipo(edicao.id, "evento.documento_anexado"), []);
    assert.deepEqual((await recibosDe(edicao.id)).filter((op) => op.kind === "evento.documento.attach"), []);
  });

  it("3. a Dutelog anexa no rascunho o layout recebido por telefone e, em enviado, a planilha com o momento da coleta (origem dutelog, caminho eventos/…/docs/…); o momento fora do cronograma, 'O momento não está no cronograma.'; o an_ pela Dutelog, 'O arquivo não é do caminho de quem anexa.'", async () => {
    const edicao = await edicaoDaNecton("necton-arquivos-0003");
    const layout = `dc_${hex(0xc1)}.pdf`;
    subiu(docDaDutelog(edicao.id, layout), "application/pdf", 900_000);
    const r1 = await anexar(manoel, { edition_id: edicao.id, arquivo: layout, nome: "layout-por-telefone.pdf", idempotency_key: "anexar-0003-a" });
    assert.equal(r1.documento.origem, "dutelog");
    assert.equal(r1.documento.caminho, `eventos/BTG Pactual/${edicao.id}/docs/${layout}`);
    assert.deepEqual(r1.documento.registrado_por, { uid: "manoel", name: "Manoel", role: "interno" });

    await mudarStatus(edicao.id, "enviado");
    const planilha = `dc_${hex(0xc2)}.xlsx`;
    subiu(docDaDutelog(edicao.id, planilha), PLANILHA, 48_000);
    const r2 = await anexar(rafael, { edition_id: edicao.id, arquivo: planilha, nome: "produtos-coleta.xlsx", momento_id: edicao.coleta, idempotency_key: "anexar-0003-b" });
    assert.equal(r2.documento.momento_id, edicao.coleta);
    assert.equal(r2.documento.tipo, PLANILHA);
    assert.equal(r2.documento.tamanho, 48_000);
    assert.equal(r2.documentos, 2);
    assert.equal(r2.edicao, r1.edicao + 1);
    const [recibo] = (await recibosDe(edicao.id)).filter((op) => op.kind === "evento.documento.attach" && op.result?.documento_id === `dc_${hex(0xc2)}`);
    assert.equal(recibo?.customer_code, BTG);

    const outra = `dc_${hex(0xc3)}.pdf`;
    subiu(docDaDutelog(edicao.id, outra), "application/pdf");
    await recusa(
      anexar(rafael, { edition_id: edicao.id, arquivo: outra, nome: "x.pdf", momento_id: "mo_ffffffff", idempotency_key: "anexar-0003-c" }),
      "invalid-argument",
      "O momento não está no cronograma.",
    );
    await recusa(
      anexar(rafael, { edition_id: edicao.id, arquivo: `an_${hex(0xc4)}.pdf`, nome: "x.pdf", idempotency_key: "anexar-0003-d" }),
      "invalid-argument",
      "O arquivo não é do caminho de quem anexa.",
    );
    await recusa(
      anexar(cristiane, { edition_id: edicao.id, arquivo: `dc_${hex(0xc5)}.pdf`, nome: "x.pdf", idempotency_key: "anexar-0003-e" }),
      "invalid-argument",
      "O arquivo não é do caminho de quem anexa.",
    );
    assert.equal((await gravada(edicao.id)).documentos.length, 2);
  });

  it("4. o 21º documento recusa 'A edição já tem 20 documentos.'", async () => {
    const edicao = await edicaoDaNecton("necton-arquivos-0004");
    const autor = { uid: "rafael", name: "Rafael", role: "wms" };
    const dezenove = Array.from({ length: 19 }, (_, n) => ({
      id: `dc_${hex(0xd00 + n)}`,
      caminho: docDaDutelog(edicao.id, `dc_${hex(0xd00 + n)}.pdf`),
      nome: `doc-${n}.pdf`,
      tipo: "application/pdf",
      tamanho: 100,
      origem: "dutelog",
      momento_id: null,
      registrado_por: autor,
      registrado_em: "2027-01-20T10:00:00.000Z",
    }));
    await db.collection(EDICOES_COLLECTION).doc(edicao.id).update({ documentos: dezenove });
    subiu(docDaDutelog(edicao.id, `dc_${hex(0xd20)}.pdf`), "application/pdf");
    const vigesimo = await anexar(rafael, { edition_id: edicao.id, arquivo: `dc_${hex(0xd20)}.pdf`, nome: "doc-20.pdf", idempotency_key: "anexar-0004-a" });
    assert.equal(vigesimo.documentos, 20);
    subiu(docDaDutelog(edicao.id, `dc_${hex(0xd21)}.pdf`), "application/pdf");
    await recusa(
      anexar(rafael, { edition_id: edicao.id, arquivo: `dc_${hex(0xd21)}.pdf`, nome: "doc-21.pdf", idempotency_key: "anexar-0004-b" }),
      "failed-precondition",
      "A edição já tem 20 documentos.",
    );
    assert.equal((await gravada(edicao.id)).documentos.length, 20);
  });

  it("5. tirar: o cliente tira o próprio em enviado (sai de documentos, edicao + 1, evento documento_retirado, nada apagado); em confirmado, 'Depois da confirmação, só a Dutelog retira documentos.'; o da Dutelog, permission-denied; o wms tira só o que anexou; o interno tira qualquer um; o id que não existe, not-found 'Documento não encontrado.'", async () => {
    const edicao = await edicaoDaNecton("necton-arquivos-0005");
    const sobe = async (ator: Ator, arquivo: string, chave: string) => {
      subiu(arquivo.startsWith("an_") ? anexoDoCliente(edicao.id, arquivo) : docDaDutelog(edicao.id, arquivo), "application/pdf");
      return anexar(ator, { edition_id: edicao.id, arquivo, nome: `${chave}.pdf`, idempotency_key: chave });
    };
    await sobe(cristiane, `an_${hex(0xe1)}.pdf`, "anexar-0005-a");
    await sobe(cristiane, `an_${hex(0xe2)}.pdf`, "anexar-0005-b");
    await sobe(rafael, `dc_${hex(0xe3)}.pdf`, "anexar-0005-c");
    const ultimo = await sobe(bruno, `dc_${hex(0xe4)}.pdf`, "anexar-0005-d");
    const noBucketAntes = noBucket.size;

    await mudarStatus(edicao.id, "enviado");
    const retirada = { edition_id: edicao.id, documento_id: `an_${hex(0xe1)}`, idempotency_key: "tirar-0005-a" };
    const r = await tirar(cristiane, retirada);
    assert.deepEqual(r, { id: edicao.id, edicao: ultimo.edicao + 1, documentos: 3 });
    const depois = await gravada(edicao.id);
    assert.deepEqual(
      depois.documentos.map((documento: { id: string }) => documento.id),
      [`an_${hex(0xe2)}`, `dc_${hex(0xe3)}`, `dc_${hex(0xe4)}`],
    );
    assert.equal(depois.edicao, ultimo.edicao + 1);
    const retirados = await eventosDoTipo(edicao.id, "evento.documento_retirado");
    assert.equal(retirados.length, 1);
    assert.deepEqual(retirados[0]!.payload, { edition_id: edicao.id, documento_id: `an_${hex(0xe1)}` });
    // O arquivo fica no bucket: só o registro sai.
    assert.deepEqual(apagados, []);
    assert.equal(noBucket.size, noBucketAntes);
    // A repetição da mesma chave devolve o mesmo, sem segundo evento.
    assert.deepEqual(await tirar(cristiane, retirada), r);
    assert.equal((await eventosDoTipo(edicao.id, "evento.documento_retirado")).length, 1);

    await recusa(
      tirar(cristiane, { edition_id: edicao.id, documento_id: `dc_${hex(0xe3)}`, idempotency_key: "tirar-0005-b" }),
      "permission-denied",
      "Só a Dutelog retira os documentos dela.",
    );
    await mudarStatus(edicao.id, "confirmado");
    await recusa(
      tirar(cristiane, { edition_id: edicao.id, documento_id: `an_${hex(0xe2)}`, idempotency_key: "tirar-0005-c" }),
      "failed-precondition",
      "Depois da confirmação, só a Dutelog retira documentos.",
    );
    await recusa(
      tirar(rafael, { edition_id: edicao.id, documento_id: `dc_${hex(0xe4)}`, idempotency_key: "tirar-0005-d" }),
      "permission-denied",
      "Só quem anexou o documento, ou a coordenação, o retira.",
    );
    assert.equal((await tirar(rafael, { edition_id: edicao.id, documento_id: `dc_${hex(0xe3)}`, idempotency_key: "tirar-0005-e" })).documentos, 2);
    assert.equal((await tirar(manoel, { edition_id: edicao.id, documento_id: `dc_${hex(0xe4)}`, idempotency_key: "tirar-0005-f" })).documentos, 1);
    assert.equal((await tirar(manoel, { edition_id: edicao.id, documento_id: `an_${hex(0xe2)}`, idempotency_key: "tirar-0005-g" })).documentos, 0);
    await recusa(
      tirar(manoel, { edition_id: edicao.id, documento_id: `an_${hex(0xef)}`, idempotency_key: "tirar-0005-h" }),
      "not-found",
      "Documento não encontrado.",
    );
    assert.deepEqual(apagados, []);
  });

  it("6. a foto: o wms anexa em confirmado com momento, legenda e instante (fotos[0], evento foto_anexada { fotos: 1 } sem a legenda); sem instante, instante === registrado_em; em enviado, 'A edição ainda não foi confirmada.'; em fechado, 'A edição já está fechada.'; a mesma foto de novo, already-exists", async () => {
    const edicao = await edicaoDaNecton("necton-arquivos-0006");
    const primeira = `ft_${hex(0xf1)}.jpg`;
    subiu(fotoDaDutelog(edicao.id, primeira), "image/jpeg", 2_400_000);
    await mudarStatus(edicao.id, "enviado");
    const entrada = { edition_id: edicao.id, arquivo: primeira, momento_id: edicao.coleta, legenda: "Carga na doca", instante: "2027-01-27T05:12:00-03:00", idempotency_key: "foto-0006-a" };
    await recusa(fotografar(rafael, entrada), "failed-precondition", "A edição ainda não foi confirmada.");

    await mudarStatus(edicao.id, "confirmado");
    const r = await fotografar(rafael, entrada);
    assert.equal(r.fotos, 1);
    assert.equal(r.edicao, edicao.edicao + 1);
    assert.match(r.foto.registrado_em, ISO);
    assert.deepEqual(r.foto, {
      id: `ft_${hex(0xf1)}`,
      caminho: `eventos/BTG Pactual/${edicao.id}/fotos/${primeira}`,
      momento_id: edicao.coleta,
      legenda: "Carga na doca",
      instante: "2027-01-27T08:12:00.000Z",
      registrado_por: { uid: "rafael", name: "Rafael", role: "wms" },
      registrado_em: r.foto.registrado_em,
    });
    assert.deepEqual((await gravada(edicao.id)).fotos, [r.foto]);
    const anexadas = await eventosDoTipo(edicao.id, "evento.foto_anexada");
    assert.equal(anexadas.length, 1);
    assert.deepEqual(anexadas[0]!.payload, { edition_id: edicao.id, momento_id: edicao.coleta, fotos: 1 });
    assert.doesNotMatch(JSON.stringify(anexadas[0]), /Carga na doca/);

    const segunda = `ft_${hex(0xf2)}.webp`;
    subiu(fotoDaDutelog(edicao.id, segunda), "image/webp", 800_000);
    const semInstante = { edition_id: edicao.id, arquivo: segunda, momento_id: edicao.entrega, idempotency_key: "foto-0006-b" };
    const r2 = await fotografar(manoel, semInstante);
    assert.equal(r2.foto.instante, r2.foto.registrado_em);
    assert.equal(r2.foto.legenda, null);
    assert.equal(r2.fotos, 2);
    assert.deepEqual(await fotografar(manoel, semInstante), r2);
    assert.equal((await eventosDoTipo(edicao.id, "evento.foto_anexada")).length, 2);

    await recusa(fotografar(rafael, { ...entrada, idempotency_key: "foto-0006-c" }), "already-exists", "O arquivo já está na edição.");
    await recusa(
      fotografar(rafael, { ...entrada, momento_id: "mo_ffffffff", idempotency_key: "foto-0006-d" }),
      "invalid-argument",
      "O momento não está no cronograma.",
    );

    await mudarStatus(edicao.id, "fechado");
    const terceira = `ft_${hex(0xf3)}.png`;
    subiu(fotoDaDutelog(edicao.id, terceira), "image/png");
    await recusa(
      fotografar(rafael, { edition_id: edicao.id, arquivo: terceira, momento_id: edicao.evento, idempotency_key: "foto-0006-e" }),
      "failed-precondition",
      "A edição já está fechada.",
    );
    assert.equal((await gravada(edicao.id)).fotos.length, 2);
  });

  it("7. a foto errada: image/gif sob .jpg é apagada e recusada ('O arquivo enviado não é uma foto.'); 8 MiB, 'A foto passa de 8 MB.'; a 201ª, 'A edição já tem 200 fotos.'", async () => {
    const edicao = await edicaoDaNecton("necton-arquivos-0007");
    await mudarStatus(edicao.id, "no_evento");
    const gif = subiu(fotoDaDutelog(edicao.id, `ft_${hex(0x71)}.jpg`), "image/gif", 5_000);
    await recusa(
      fotografar(rafael, { edition_id: edicao.id, arquivo: `ft_${hex(0x71)}.jpg`, momento_id: edicao.evento, idempotency_key: "foto-0007-a" }),
      "invalid-argument",
      "O arquivo enviado não é uma foto.",
    );
    const grande = subiu(fotoDaDutelog(edicao.id, `ft_${hex(0x72)}.jpg`), "image/jpeg", TAMANHO_DA_FOTO);
    await recusa(
      fotografar(rafael, { edition_id: edicao.id, arquivo: `ft_${hex(0x72)}.jpg`, momento_id: edicao.evento, idempotency_key: "foto-0007-b" }),
      "invalid-argument",
      "A foto passa de 8 MB.",
    );
    assert.deepEqual(apagados, [gif, grande]);

    const autor = { uid: "rafael", name: "Rafael", role: "wms" };
    const duzentas = Array.from({ length: 200 }, (_, n) => ({
      id: `ft_${hex(0x7000 + n)}`,
      caminho: fotoDaDutelog(edicao.id, `ft_${hex(0x7000 + n)}.jpg`),
      momento_id: edicao.evento,
      legenda: null,
      instante: "2027-01-28T12:00:00.000Z",
      registrado_por: autor,
      registrado_em: "2027-01-28T12:00:00.000Z",
    }));
    await db.collection(EDICOES_COLLECTION).doc(edicao.id).update({ fotos: duzentas });
    subiu(fotoDaDutelog(edicao.id, `ft_${hex(0x73)}.jpg`), "image/jpeg");
    await recusa(
      fotografar(rafael, { edition_id: edicao.id, arquivo: `ft_${hex(0x73)}.jpg`, momento_id: edicao.evento, idempotency_key: "foto-0007-c" }),
      "failed-precondition",
      "A edição já tem 200 fotos.",
    );
    assert.equal((await gravada(edicao.id)).fotos.length, 200);
  });

  it("8. o cliente de outro código recebe not-found 'Edição não encontrada.' ao anexar e ao tirar; em cancelado, cliente e Dutelog recebem 'A edição já está fechada.'", async () => {
    const edicao = await edicaoDaNecton("necton-arquivos-0008");
    const arquivo = `an_${hex(0x81)}.pdf`;
    subiu(anexoDoCliente(edicao.id, arquivo), "application/pdf");
    await anexar(cristiane, { edition_id: edicao.id, arquivo, nome: "layout.pdf", idempotency_key: "anexar-0008-a" });

    // Ela sobe no caminho do próprio código (as regras deixam); a edição não é dela.
    subiu(`portal/Outro/eventos/${edicao.id}/an_${hex(0x82)}.pdf`, "text/html");
    await recusa(
      anexar(outraCliente, { edition_id: edicao.id, arquivo: `an_${hex(0x82)}.pdf`, nome: "x.pdf", idempotency_key: "anexar-0008-b" }),
      "not-found",
      "Edição não encontrada.",
    );
    await recusa(
      tirar(outraCliente, { edition_id: edicao.id, documento_id: `an_${hex(0x81)}`, idempotency_key: "tirar-0008-a" }),
      "not-found",
      "Edição não encontrada.",
    );
    await recusa(
      anexar(rafael, { edition_id: "ced_ffffffffffffffff", arquivo: `dc_${hex(0x83)}.pdf`, nome: "x.pdf", idempotency_key: "anexar-0008-c" }),
      "not-found",
      "Edição não encontrada.",
    );
    await recusa(
      fotografar(rafael, { edition_id: "ced_0123/../outra", arquivo: `ft_${hex(0x84)}.jpg`, momento_id: edicao.evento, idempotency_key: "foto-0008-a" }),
      "not-found",
      "Edição não encontrada.",
    );
    // Nada do bucket dela saiu: a recusa vem antes de ler o arquivo.
    assert.deepEqual(apagados, []);

    await mudarStatus(edicao.id, "cancelado");
    subiu(anexoDoCliente(edicao.id, `an_${hex(0x85)}.pdf`), "application/pdf");
    await recusa(
      anexar(cristiane, { edition_id: edicao.id, arquivo: `an_${hex(0x85)}.pdf`, nome: "x.pdf", idempotency_key: "anexar-0008-d" }),
      "failed-precondition",
      "A edição já está fechada.",
    );
    subiu(docDaDutelog(edicao.id, `dc_${hex(0x86)}.pdf`), "application/pdf");
    await recusa(
      anexar(rafael, { edition_id: edicao.id, arquivo: `dc_${hex(0x86)}.pdf`, nome: "x.pdf", idempotency_key: "anexar-0008-e" }),
      "failed-precondition",
      "A edição já está fechada.",
    );
    subiu(fotoDaDutelog(edicao.id, `ft_${hex(0x87)}.jpg`), "image/jpeg");
    await recusa(
      fotografar(rafael, { edition_id: edicao.id, arquivo: `ft_${hex(0x87)}.jpg`, momento_id: edicao.evento, idempotency_key: "foto-0008-b" }),
      "failed-precondition",
      "A edição já está fechada.",
    );
    await recusa(
      tirar(cristiane, { edition_id: edicao.id, documento_id: `an_${hex(0x81)}`, idempotency_key: "tirar-0008-b" }),
      "failed-precondition",
      "A edição já está fechada.",
    );
  });

  it("9. nenhum evento desta parte leva dinheiro, nome de arquivo ou legenda, e o recibo não guarda o nome nem a legenda", async () => {
    const edicao = await edicaoDaNecton("necton-arquivos-0009");
    const arquivo = `an_${hex(0x91)}.pdf`;
    subiu(anexoDoCliente(edicao.id, arquivo), "application/pdf");
    await anexar(cristiane, { edition_id: edicao.id, arquivo, nome: "layout-necton.pdf", idempotency_key: "anexar-0009-a" });
    await mudarStatus(edicao.id, "confirmado");
    const foto = `ft_${hex(0x92)}.jpg`;
    subiu(fotoDaDutelog(edicao.id, foto), "image/jpeg");
    await fotografar(rafael, { edition_id: edicao.id, arquivo: foto, momento_id: edicao.coleta, legenda: "Carga na doca", idempotency_key: "foto-0009-a" });
    await tirar(manoel, { edition_id: edicao.id, documento_id: `an_${hex(0x91)}`, idempotency_key: "tirar-0009-a" });

    const eventos = await eventsFor(edicao.id);
    assert.deepEqual(
      eventos.map((evento) => evento.type).filter((tipo) => tipo !== "evento.edicao_salva").sort(),
      ["evento.documento_anexado", "evento.documento_retirado", "evento.foto_anexada"],
    );
    assert.doesNotMatch(JSON.stringify(eventos), /cents|valor|layout-necton|Carga na doca/);
    const recibos = (await recibosDe(edicao.id)).filter((op) => String(op.kind).startsWith("evento."));
    assert.deepEqual(recibos.map((op) => op.kind).sort(), ["evento.documento.attach", "evento.documento.remove", "evento.foto.attach"]);
    assert.doesNotMatch(JSON.stringify(recibos), /layout-necton|Carga na doca/);
  });
});
