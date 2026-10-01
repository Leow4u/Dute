import type { Firestore } from "firebase-admin/firestore";

/**
 * Base de Conhecimento que entra no contexto do Agent Dute.
 *
 * A equipe interna vê todo conhecimento ativo do cliente. Quem é da BTG só
 * pode receber trechos de documentos que já estão publicados para ela no
 * portal (client_documents visível). Antes o chat do cliente recebia também
 * documentos marcados como internos: as Rules não deixam o cliente ler
 * ai_agent_knowledge, mas o agente lia pelo Admin SDK e repassava o conteúdo.
 */

export type KnowledgeAudience = "internal" | "customer";

export type KnowledgeContext = {
  documents: Array<{
    id: string;
    title: string;
    document_type?: string;
    summary?: string;
    chunk_count?: number;
    customer_code?: string;
  }>;
  chunks: Array<{
    id: string;
    knowledge_id?: string;
    text?: string;
    title?: string;
  }>;
};

export function knowledgeAudienceForRole(role: string): KnowledgeAudience {
  return role === "cliente" ? "customer" : "internal";
}

/** Mesma condição que o portal usa para mostrar o documento ao cliente. */
export function isPublishedToCustomer(
  projection: Record<string, unknown> | undefined,
  customerCode: string,
) {
  return (
    projection !== undefined &&
    projection.customer_code === customerCode &&
    projection.customer_visible === true &&
    projection.visibility !== "internal" &&
    projection.archived !== true &&
    projection.status !== "archived"
  );
}

export async function loadKnowledgeContext(
  db: Firestore,
  customerCode?: string,
  audience: KnowledgeAudience = "internal",
): Promise<KnowledgeContext> {
  if (audience === "customer" && !customerCode) return { documents: [], chunks: [] };

  const docsSnapshot = await db
    .collection("ai_agent_knowledge")
    .where("status", "==", "active")
    .limit(20)
    .get();
  let candidates = docsSnapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        title: String(data.title ?? data.source_file_name ?? doc.id),
        document_type: typeof data.document_type === "string" ? data.document_type : undefined,
        summary: typeof data.summary === "string" ? data.summary : undefined,
        chunk_count: Number(data.chunk_count ?? 0),
        customer_code: typeof data.customer_code === "string" ? data.customer_code : undefined,
        source_document_id:
          typeof data.source_document_id === "string" ? data.source_document_id : "",
      };
    })
    .filter((item) => !customerCode || item.customer_code === customerCode);

  if (audience === "customer") {
    // Sem documento de origem não há como provar que foi publicado: fica de fora.
    const published = await Promise.all(
      candidates.map(async (item) => {
        if (!item.source_document_id || item.source_document_id.includes("/")) return false;
        const projection = await db.collection("client_documents").doc(item.source_document_id).get();
        return isPublishedToCustomer(projection.data(), customerCode as string);
      }),
    );
    candidates = candidates.filter((_, index) => published[index]);
  }

  const documents = candidates.slice(0, 12).map(({ source_document_id: _source, ...item }) => item);
  const knowledgeIds = new Set(documents.map((item) => item.id));
  const chunks: KnowledgeContext["chunks"] = [];
  for (const item of documents.slice(0, 6)) {
    const chunksSnapshot = await db
      .collection("ai_agent_knowledge_chunks")
      .where("knowledge_id", "==", item.id)
      .limit(4)
      .get();
    chunks.push(
      ...chunksSnapshot.docs
        .map((chunkDoc) => {
          const data = chunkDoc.data();
          return {
            id: chunkDoc.id,
            knowledge_id: typeof data.knowledge_id === "string" ? data.knowledge_id : item.id,
            text: typeof data.text === "string" ? data.text.slice(0, 1200) : undefined,
            title: typeof data.title === "string" ? data.title : item.title,
          };
        })
        .filter((chunk) => chunk.knowledge_id && knowledgeIds.has(chunk.knowledge_id)),
    );
  }

  return { documents, chunks };
}
