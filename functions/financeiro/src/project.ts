/**
 * Projeto Google Cloud em que as functions rodam. O Firebase publica
 * GCLOUD_PROJECT em toda function. Fora dela (testes, scripts) fica vazio,
 * e o Financeiro não está liberado (domain/liberacao.ts).
 */
export const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
