import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/https";
import { setGlobalOptions } from "firebase-functions/v2";

import { saveCommercialCustomerFor, saveCustomerContactFor, saveCustomerLocationFor } from "./domain/cadastro.js";
import { registrarAditivo, salvarContrato } from "./domain/contratos.js";
import { assertAuth, comercialStatusFor, loadProfile, requireComercialCaller } from "./domain/profile.js";
import { advanceQuoteFor, saveQuoteFor } from "./domain/quotes.js";
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

// --- Cadastro comercial (parte 6; domain/cadastro.ts) -------------------------

/**
 * Prospect e dados comerciais em `customers`: create, update e mark_client
 * para owner, admin e comercial; archive só para owner e admin, e só em
 * cadastro sem armazenagem no WMS.
 */
export const saveCommercialCustomer = onCall(async (request) => {
  const caller = await requireComercialCaller(db, request, PROJECT_ID);
  return saveCommercialCustomerFor(db, caller, request.data);
});

/** Local do cliente (polo, prédio) em `customer_locations`. */
export const saveCustomerLocation = onCall(async (request) => {
  const caller = await requireComercialCaller(db, request, PROJECT_ID);
  return saveCustomerLocationFor(db, caller, request.data);
});

/** Contato do cliente em `customer_contacts`, com a empresa (a gerenciadora) em texto. */
export const saveCustomerContact = onCall(async (request) => {
  const caller = await requireComercialCaller(db, request, PROJECT_ID);
  return saveCustomerContactFor(db, caller, request.data);
});

// --- Contratos (parte 8; domain/contratos.ts) ---------------------------------

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

// --- Demanda e orçamento (parte 9; domain/quotes.ts) ---------------------------

/**
 * Cria a demanda e o orçamento juntos (número único de demand_counters),
 * edita o rascunho com a edição lida, ou duplica um orçamento com a
 * data-base de hoje. O servidor recalcula preço e totais.
 */
export const saveQuote = onCall(async (request) => {
  const caller = await requireComercialCaller(db, request, PROJECT_ID);
  return saveQuoteFor(db, caller, request.data);
});

/**
 * Enviar para aprovação, devolver, aprovar (só o owner; congela a RV em
 * revisoes) e editar o aprovado, conferindo a situação e a edição vistas.
 */
export const advanceQuote = onCall(async (request) => {
  const caller = await requireComercialCaller(db, request, PROJECT_ID);
  return advanceQuoteFor(db, caller, request.data);
});
