import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { RH_DATABASE } from "./domain/banco.js";
import { archiveRhRecordFor, getRhFichaFor, getRhPanelFor, saveRhRecordFor } from "./domain/ficha-gravacao.js";
import { rhLiberado } from "./domain/liberacao.js";
import { rhWriteProblem } from "./domain/platform-roles.js";
import { requireRhCaller } from "./domain/profile.js";
import { runRhAlertsFor } from "./domain/rotina-gravacao.js";
import { PROJECT_ID } from "./project.js";

/**
 * Functions do RH (codebase `rh`; desenho em docs/plataforma/fase-8-rh.md).
 *
 * Toda callable fica declarada neste arquivo, numa linha só, no formato que a
 * conferência do invoker (tools/check_functions_invoker.ps1) lê; o teste
 * callables.test.ts trava o formato. Toda callable começa por
 * `await requireRhCaller(db, request, PROJECT_ID)`. O `db` é o banco padrão,
 * onde moram o `users` e o `collaborators`; o que é do RH fica no banco `rh`
 * (domain/banco.ts).
 */

initializeApp();
setGlobalOptions({
  region: "southamerica-east1",
  maxInstances: 10,
  memory: "256MiB",
});

const db = getFirestore();
const rh = getFirestore(RH_DATABASE);

/** Quem abre o RH e se grava: o shell do RH pergunta antes de mostrar as ações. */
export const rhStatus = onCall(async (request) => {
  const caller = await requireRhCaller(db, request, PROJECT_ID);
  return { ok: true, papel: caller.role, grava: rhWriteProblem(caller.role) === null };
});

/** O Início e a lista do RH: quem está ativo, com a ficha resumida, e os vencimentos (parte 8.2a). */
export const getRhPanel = onCall(async (request) => {
  await requireRhCaller(db, request, PROJECT_ID);
  return getRhPanelFor(db, rh);
});

/** A ficha de uma pessoa: os documentos, os exames e os treinamentos, com o histórico. */
export const getRhFicha = onCall(async (request) => {
  await requireRhCaller(db, request, PROJECT_ID);
  return getRhFichaFor(db, rh, request.data);
});

/** Inclui ou altera um registro da ficha. Só o rh grava. */
export const saveRhRecord = onCall(async (request) => {
  const caller = await requireRhCaller(db, request, PROJECT_ID);
  return saveRhRecordFor(db, rh, caller, request.data);
});

/** Arquiva um registro da ficha; o anterior do mesmo tipo volta a valer. Só o rh grava. */
export const archiveRhRecord = onCall(async (request) => {
  const caller = await requireRhCaller(db, request, PROJECT_ID);
  return archiveRhRecordFor(rh, caller, request.data);
});

/**
 * Todo dia às 06:10 de São Paulo: o registro vencendo e o vencido viram um
 * evento cada, uma vez por registro e por marco (parte 8.2a). Fora da
 * liberação do RH, não faz nada.
 */
export const runRhAlerts = onSchedule({ schedule: "every day 06:10", timeZone: "America/Sao_Paulo", timeoutSeconds: 300 }, async () => {
  if (!rhLiberado(PROJECT_ID)) return;
  const resultado = await runRhAlertsFor(db, rh);
  console.info("runRhAlerts", resultado);
});
