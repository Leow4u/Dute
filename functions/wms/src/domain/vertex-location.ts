import { vertexAI } from "@genkit-ai/google-genai";

/**
 * Onde o Vertex AI processa os pedidos do WMS (LGPD, decisão 12 do Leonardo,
 * 26/10/2026: fixar uma região onde os modelos usados existam).
 *
 * - O gemini-3.5-flash e o gemini-3.8-flash (Agent Dute, leitura de NF e de
 *   documento, revisão de documento e conferência da foto) só existem juntos
 *   no `global`, na `us` e na `eu`; o Brasil não tem nenhum dos dois. A
 *   multirregião `us` processa nos Estados Unidos; o `global` não diz onde.
 * - O gemini-3-pro-image, que gera a foto do catálogo, só existe no `global`:
 *   a geração fica lá, com a foto e o cadastro do produto.
 *
 * O núcleo usa o mesmo local (`LOCAL_DO_VERTEX`, travado em
 * agente-modelo.test.ts). Registro: docs/plataforma/fase-5-memoria.md.
 */
export const VERTEX_LOCATION: "us" | "eu" = "us";
export const PRODUCT_PHOTO_LOCATION = "global";

/** O plugin do Genkit no local fixado. */
export function vertexPlugin(projectId: string) {
  return vertexAI({ projectId, location: VERTEX_LOCATION });
}

/** O generateContent pela API REST: o `global` e as multirregiões têm hosts próprios. */
export function vertexGenerateContentUrl(
  project: string,
  location: typeof VERTEX_LOCATION | typeof PRODUCT_PHOTO_LOCATION,
  model: string,
) {
  const host = location === "global" ? "aiplatform.googleapis.com" : `aiplatform.${location}.rep.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}
