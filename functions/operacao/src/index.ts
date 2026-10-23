import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/https";
import { setGlobalOptions } from "firebase-functions/v2";

import { openDirectDemandFor } from "./domain/demanda-direta-gravacao.js";
import { saveCollaboratorFor, saveVehicleFor } from "./domain/gravacao.js";
import { saveServiceOrderFor } from "./domain/os-gravacao.js";
import { requireOperacaoCaller } from "./domain/profile.js";
import { PROJECT_ID } from "./project.js";

/**
 * Functions da Operação (codebase `operacao` no firebase.json; desenho em
 * docs/plataforma/fase-3-operacao.md).
 *
 * Toda callable fica declarada neste arquivo, numa linha só, no formato que a
 * conferência do invoker (tools/check_functions_invoker.ps1) lê; o teste
 * callables.test.ts trava o formato. Toda callable começa por
 * `await requireOperacaoCaller(db, request, PROJECT_ID)`.
 */

initializeApp();
setGlobalOptions({
  region: "southamerica-east1",
  maxInstances: 10,
  memory: "256MiB",
});

const db = getFirestore();

/** Cria, atualiza, desativa ou reativa um colaborador. */
export const saveCollaborator = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID);
  return saveCollaboratorFor(db, caller, request.data);
});

/** Cria, atualiza, desativa ou reativa um veículo. */
export const saveVehicle = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID);
  return saveVehicleFor(db, caller, request.data);
});

/** Abre (todo o saldo), planeja (várias OS com fatias), agenda, muda os itens ou cancela a OS. */
export const saveServiceOrder = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID);
  return saveServiceOrderFor(db, caller, request.data);
});

/** Abre a demanda direta (paraquedas e emergencial), sem orçamento, em Para planejar. */
export const openDirectDemand = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID);
  return openDirectDemandFor(db, caller, request.data);
});
