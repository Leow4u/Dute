import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/https";
import { setGlobalOptions } from "firebase-functions/v2";

import { registrarAditivo, salvarContrato } from "./domain/contratos.js";
import { assertAuth, comercialStatusFor, loadProfile, requireComercialCaller } from "./domain/profile.js";
import { PROJECT_ID } from "./project.js";

/**
 * Functions do Comercial (codebase `comercial` no firebase.json; desenho em
 * docs/plataforma/fase-6-comercial.md).
 *
 * Toda callable fica declarada neste arquivo, numa linha só, no formato que a
 * conferência do invoker (tools/check_functions_invoker.ps1) lê; o teste
 * callables.test.ts trava o formato e reprova outros gatilhos (HTTP, agenda,
 * documento). Neste arquivo, a palavra da callable só aparece seguida de
 * parêntese na declaração: o script reprova qualquer outra linha assim, até em
 * comentário. Toda callable de negócio começa por
 * `await requireComercialCaller(db, request, PROJECT_ID)` (liberação do
 * ambiente, login, perfil e papel); a entrada passa por safeParse e
 * invalid-argument, e a gravação por runIdempotent (domain/operations.ts) com
 * createComercialEvent (domain/events.ts) na mesma transação.
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

/**
 * Cria ou atualiza um contrato (parte 8). Contrato é de cliente: cadastro
 * inexistente ou prospect é recusado; atualizar confere a edição lida.
 */
export const saveContract = onCall(async (request) => {
  const caller = await requireComercialCaller(db, request, PROJECT_ID);
  return salvarContrato(db, caller, request.data);
});

/**
 * Registra um aditivo no histórico do contrato (parte 8). Prorrogação e preço
 * com vigência nova prorrogam o contrato na mesma transação; aditivo de preço
 * liga tabelas do mesmo contrato.
 */
export const recordAditivo = onCall(async (request) => {
  const caller = await requireComercialCaller(db, request, PROJECT_ID);
  return registrarAditivo(db, caller, request.data);
});
