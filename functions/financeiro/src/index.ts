import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { advanceFaturaFor } from "./domain/cobranca-gravacao.js";
import { actOnNfEmissionFor, emitNfOmieFor, listNfEmissionsFor } from "./domain/emissao-gravacao.js";
import { omieLiberada } from "./domain/emissao-omie.js";
import { transportePeloFetch } from "./domain/omie.js";
import { runOmieSyncFor } from "./domain/omie-rotina.js";
import { registerNfFor } from "./domain/fatura-gravacao.js";
import { requireFinanceiroCaller } from "./domain/profile.js";
import { PROJECT_ID } from "./project.js";

/**
 * Functions do Financeiro (codebase `financeiro` no firebase.json; desenho em
 * docs/plataforma/fase-4-financeiro.md).
 *
 * Toda callable fica declarada neste arquivo, numa linha só, no formato que a
 * conferência do invoker (tools/check_functions_invoker.ps1) lê; o teste
 * callables.test.ts trava o formato. Toda callable começa por
 * `await requireFinanceiroCaller(db, request, PROJECT_ID)`.
 */

initializeApp();
setGlobalOptions({
  region: "southamerica-east1",
  maxInstances: 10,
  memory: "256MiB",
});

const db = getFirestore();

/** Registra a NF emitida fora do sistema para as demandas A faturar de um cliente: a fatura, as demandas Faturadas e as autorizações usadas. */
export const registerNf = onCall(async (request) => {
  const caller = await requireFinanceiroCaller(db, request, PROJECT_ID);
  return registerNfFor(db, caller, request.data);
});

/** A cobrança da NF registrada: enviar ao cliente, registrar e estornar pagamento, cancelar o registro sem pagamento. */
export const advanceFatura = onCall(async (request) => {
  const caller = await requireFinanceiroCaller(db, request, PROJECT_ID);
  return advanceFaturaFor(db, caller, request.data);
});

/** Pede à Omie a NFS-e das demandas e da armazenagem de um cliente (parte 7.4c): reserva e põe na fila; a rotina emite. */
export const emitNfOmie = onCall(async (request) => {
  const caller = await requireFinanceiroCaller(db, request, PROJECT_ID);
  return emitNfOmieFor(db, caller, request.data, { projectId: PROJECT_ID });
});

/** Retoma ou desiste da emissão parada ou rejeitada. */
export const actOnNfEmission = onCall(async (request) => {
  const caller = await requireFinanceiroCaller(db, request, PROJECT_ID);
  return actOnNfEmissionFor(db, caller, request.data, { projectId: PROJECT_ID });
});

/** As emissões mais novas, com a etapa e a mensagem da prefeitura. */
export const listNfEmissions = onCall(async (request) => {
  const caller = await requireFinanceiroCaller(db, request, PROJECT_ID);
  return listNfEmissionsFor(db, caller);
});

/**
 * A cada 5 minutos: cada emissão da NFS-e pela Omie que é hora de andar dá um
 * passo (parte 7.4d). As chaves da API vêm do Secret Manager (OMIE_APP_KEY e
 * OMIE_APP_SECRET), declaradas na função só quando os segredos existirem;
 * sem elas, a rotina não chama a Omie, e a emissão que é hora de andar para
 * com o motivo `sem_chaves`. Uma instância por vez: a Omie não aceita
 * escrita simultânea. Fora da liberação da Omie, não faz nada.
 */
export const runOmieSync = onSchedule({ schedule: "every 5 minutes", timeZone: "America/Sao_Paulo", timeoutSeconds: 300, maxInstances: 1 }, async () => {
  if (!omieLiberada(PROJECT_ID)) return;
  const app_key = process.env.OMIE_APP_KEY?.trim() ?? "";
  const app_secret = process.env.OMIE_APP_SECRET?.trim() ?? "";
  const resultado = await runOmieSyncFor(db, { projectId: PROJECT_ID, chaves: app_key && app_secret ? { app_key, app_secret } : null, transporte: transportePeloFetch() });
  console.info("runOmieSync", resultado);
});
