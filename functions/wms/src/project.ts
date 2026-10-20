/**
 * Projeto Google Cloud em que as functions rodam (dute-btg, dute-homolog ou
 * dute-prod). O Firebase publica GCLOUD_PROJECT em toda function; o padrão só
 * vale fora dela (testes de unidade, scripts).
 */
export const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "dute-btg";
