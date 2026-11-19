import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, onRequest } from "firebase-functions/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { registrarAcessoZapFor } from "./domain/acesso.js";
import { gravarEntrada } from "./domain/gravacao.js";
import { HEADER_DO_SEGREDO, tratarIngestao } from "./domain/ingestao.js";
import { retencaoLiberada, segredosDoZap } from "./domain/liberacao.js";
import { requireZapCaller } from "./domain/profile.js";
import { runZapRetentionFor } from "./domain/retencao.js";
import { PROJECT_ID } from "./project.js";

/**
 * Functions do Zap (codebase `zap`; contrato em docs/plataforma/zap.md).
 *
 * A callable de acesso fica neste arquivo, numa linha só, no formato que a
 * conferência do invoker lê. A ingestão é HTTP, com segredo compartilhado,
 * e não entra nessa conferência. A retenção não faz nada fora da lista dela.
 */

initializeApp();
setGlobalOptions({
  region: "southamerica-east1",
  maxInstances: 10,
  memory: "256MiB",
});

const db = getFirestore();
const segredos = segredosDoZap(PROJECT_ID);

/** Registra que um owner ou admin entrou no painel ou abriu uma conversa. */
export const registrarAcessoZap = onCall(async (request) => {
  const caller = await requireZapCaller(db, request, PROJECT_ID);
  return registrarAcessoZapFor(db, caller, request.data, new Date());
});

/**
 * Todo dia às 03:30 de São Paulo: apaga mensagem, conversa e acesso mais
 * velhos que ZAP_RETENCAO_DIAS. Uma instância. Só com a liberação da retenção.
 */
export const runZapRetention = onSchedule({ schedule: "every day 03:30", timeZone: "America/Sao_Paulo", timeoutSeconds: 300, maxInstances: 1 }, async () => {
  if (!retencaoLiberada(PROJECT_ID)) return;
  console.info("runZapRetention", await runZapRetentionFor(db));
});

/**
 * Recebe a mensagem nos dois sentidos. IAM público; o segredo no cabeçalho é
 * o que autoriza. Sem o segredo publicado, responde 503 e não grava.
 */
export const ingestZap = onRequest({ cors: false, invoker: "public", timeoutSeconds: 20, maxInstances: 10, ...(segredos.length > 0 ? { secrets: segredos } : {}) }, async (request, response) => {
  response.set("Cache-Control", "no-store");
  response.set("X-Content-Type-Options", "nosniff");
  const resultado = await tratarIngestao(
    {
      method: request.method,
      contentType: request.get("content-type"),
      headerSecret: request.get(HEADER_DO_SEGREDO),
      body: request.body,
      tamanho: request.rawBody?.byteLength ?? 0,
    },
    {
      segredo: process.env.ZAP_INGEST_SECRET,
      agora: new Date(),
      gravar: (entrada) => gravarEntrada(db, entrada),
    },
  );
  if (resultado.status === 405) response.set("Allow", "POST");
  response.status(resultado.status).json(resultado.body);
});
