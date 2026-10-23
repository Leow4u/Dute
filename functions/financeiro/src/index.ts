import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/https";
import { setGlobalOptions } from "firebase-functions/v2";

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
