/**
 * Projeto Google Cloud em que as functions rodam (dute-homolog ou dute-prod).
 * O Firebase publica GCLOUD_PROJECT em toda function. Fora dela (testes,
 * scripts) fica vazio, e o Comercial não está liberado (domain/liberacao.ts).
 */
export const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
