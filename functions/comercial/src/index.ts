import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/https";
import { setGlobalOptions } from "firebase-functions/v2";

import { assertAuth, comercialStatusFor, loadProfile } from "./domain/profile.js";
import { PROJECT_ID } from "./project.js";

/**
 * Functions do Comercial (codebase `comercial` no firebase.json; desenho em
 * docs/plataforma/fase-6-comercial.md).
 *
 * Toda callable fica escrita como `export const nome = onCall(` no começo da
 * linha: é o que a conferência do invoker (tools/check_functions_invoker.ps1)
 * lê, e o teste callables.test.ts trava. Toda callable de negócio começa por
 * requireComercialCaller (liberação do ambiente, login, perfil e papel); a
 * entrada passa por safeParse e invalid-argument, e a gravação por
 * runIdempotent (domain/operations.ts) com createComercialEvent
 * (domain/events.ts) na mesma transação.
 */

initializeApp();
setGlobalOptions({
  region: "southamerica-east1",
  maxInstances: 10,
  memory: "256MiB",
});

const db = getFirestore();

/**
 * Se o Comercial aparece para quem chama: ambiente liberado e papel do
 * Comercial. Só lê o perfil da própria pessoa; é a única callable que
 * responde fora da liberação (com `liberado: false`).
 */
export const comercialStatus = onCall(async (request) => {
  const auth = assertAuth(request);
  const profile = await loadProfile(db, auth.uid, auth.token.email, auth.token.name);
  return comercialStatusFor(PROJECT_ID, profile.role);
});
