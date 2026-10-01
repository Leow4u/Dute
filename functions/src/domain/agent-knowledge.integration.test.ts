import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { knowledgeAudienceForRole, loadKnowledgeContext } from "./agent-knowledge.js";

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

async function knowledge(id: string, sourceDocumentId: string | null, customerCode = BTG) {
  await db.collection("ai_agent_knowledge").doc(id).set({
    id,
    customer_code: customerCode,
    title: `Conhecimento ${id}`,
    status: "active",
    chunk_count: 1,
    ...(sourceDocumentId ? { source_document_id: sourceDocumentId } : {}),
  });
  await db.collection("ai_agent_knowledge_chunks").doc(`${id}_chunk_01`).set({
    knowledge_id: id,
    customer_code: customerCode,
    text: `Trecho de ${id}`,
    status: "active",
  });
}

async function seed() {
  // Publicado para a BTG no portal.
  await knowledge("contrato", "doc-contrato");
  await db.collection("client_documents").doc("doc-contrato").set({
    customer_code: BTG,
    customer_visible: true,
    visibility: "customer",
    status: "published",
  });
  // Documento só da Dutelog: nunca foi projetado para o portal.
  await knowledge("proposta-interna", "doc-interno");
  // Estava publicado e foi ocultado/arquivado depois.
  await knowledge("ocultado", "doc-ocultado");
  await db.collection("client_documents").doc("doc-ocultado").set({
    customer_code: BTG,
    customer_visible: false,
    visibility: "internal",
    status: "archived",
    archived: true,
  });
  // Conhecimento sem documento de origem.
  await knowledge("solto", null);
  // Publicado, mas de outro cliente.
  await knowledge("outro", "doc-outro", "Outro");
  await db.collection("client_documents").doc("doc-outro").set({
    customer_code: "Outro",
    customer_visible: true,
    visibility: "customer",
    status: "published",
  });
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "agent-knowledge-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  await seed();
});

after(async () => {
  await deleteApp(app);
});

const ids = (context: { documents: Array<{ id: string }> }) => context.documents.map((item) => item.id).sort();

describe("conhecimento no contexto do Agent Dute", () => {
  it("cliente só recebe conhecimento de documento publicado para ele no portal", async () => {
    const context = await loadKnowledgeContext(db, BTG, knowledgeAudienceForRole("cliente"));
    assert.deepEqual(ids(context), ["contrato"]);
    assert.deepEqual(
      context.chunks.map((chunk) => chunk.text),
      ["Trecho de contrato"],
    );
  });

  it("equipe interna continua vendo todo o conhecimento ativo do cliente", async () => {
    const context = await loadKnowledgeContext(db, BTG, knowledgeAudienceForRole("admin"));
    assert.deepEqual(ids(context), ["contrato", "ocultado", "proposta-interna", "solto"]);
  });

  it("cliente sem código não recebe nada", async () => {
    const context = await loadKnowledgeContext(db, undefined, "customer");
    assert.deepEqual(context, { documents: [], chunks: [] });
  });
});
