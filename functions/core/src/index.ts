import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";

import { memoriaLiberada } from "./domain/liberacao.js";
import { runMeasuresFor } from "./domain/medidas-gravacao.js";
import { requireCoreCaller } from "./domain/profile.js";
import { answerSuggestionFor, suggestDurationFor } from "./domain/sugestao-gravacao.js";
import { PROJECT_ID } from "./project.js";

/**
 * Functions do núcleo (codebase `core` no firebase.json; desenho em
 * docs/plataforma/fase-5-memoria.md): a memória da Dute agora, o Agent Dute
 * na parte 5.5.
 *
 * Toda callable fica declarada neste arquivo, numa linha só, no formato que a
 * conferência do invoker (tools/check_functions_invoker.ps1) lê; o teste
 * callables.test.ts trava o formato. Toda function confere a liberação da
 * memória antes de tudo; toda callable começa por
 * `await requireCoreCaller(db, request, PROJECT_ID)`, que confere a liberação
 * e o perfil, e cada uma confere o papel dela.
 */

initializeApp();
setGlobalOptions({
  region: "southamerica-east1",
  maxInstances: 10,
  memory: "256MiB",
});

const db = getFirestore();

/** As medidas da memória, a cada 15 minutos: recalcula do zero quando uma OS é revisada ou reaberta (parte 5.1a). */
export const runMeasures = onSchedule({ schedule: "every 15 minutes", timeZone: "America/Sao_Paulo", timeoutSeconds: 300, maxInstances: 1 }, async () => {
  if (!memoriaLiberada(PROJECT_ID)) return;
  const resultado = await runMeasuresFor(db);
  console.info("runMeasures", resultado);
});

/** A duração sugerida para a OS em planejamento, com a base de cada item. Só lê (parte 5.2a). */
export const suggestDuration = onCall(async (request) => {
  const caller = await requireCoreCaller(db, request, PROJECT_ID);
  return suggestDurationFor(db, caller, request.data);
});

/** O que a pessoa fez com a sugestão, gravado quando a OS é salva: o sugerido, recalculado aqui, a decisão e o escolhido (parte 5.2a). */
export const answerSuggestion = onCall(async (request) => {
  const caller = await requireCoreCaller(db, request, PROJECT_ID);
  return answerSuggestionFor(db, caller, request.data);
});
