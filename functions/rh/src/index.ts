import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/https";
import { setGlobalOptions } from "firebase-functions/v2";

import { rhWriteProblem } from "./domain/platform-roles.js";
import { requireRhCaller } from "./domain/profile.js";
import { PROJECT_ID } from "./project.js";

/**
 * Functions do RH (codebase `rh`; desenho em docs/plataforma/fase-8-rh.md).
 *
 * Toda callable fica declarada neste arquivo, numa linha só, no formato que a
 * conferência do invoker (tools/check_functions_invoker.ps1) lê; o teste
 * callables.test.ts trava o formato. Toda callable começa por
 * `await requireRhCaller(db, request, PROJECT_ID)`. O `db` é o banco padrão,
 * onde mora o `users`; o que é do RH fica no banco `rh` (domain/banco.ts).
 */

initializeApp();
setGlobalOptions({
  region: "southamerica-east1",
  maxInstances: 10,
  memory: "256MiB",
});

const db = getFirestore();

/** Quem abre o RH e se grava: o shell do RH pergunta antes de mostrar as ações. */
export const rhStatus = onCall(async (request) => {
  const caller = await requireRhCaller(db, request, PROJECT_ID);
  return { ok: true, papel: caller.role, grava: rhWriteProblem(caller.role) === null };
});
