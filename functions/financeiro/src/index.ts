import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/https";
import { setGlobalOptions } from "firebase-functions/v2";

import { advanceFaturaFor } from "./domain/cobranca-gravacao.js";
import { actOnNfEmissionFor, emitNfOmieFor, listNfEmissionsFor } from "./domain/emissao-gravacao.js";
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
