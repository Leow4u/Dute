import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";

import { memoriaLiberada } from "./domain/liberacao.js";
import { runMeasuresFor } from "./domain/medidas-gravacao.js";
import { PROJECT_ID } from "./project.js";

/**
 * Functions do núcleo (codebase `core` no firebase.json; desenho em
 * docs/plataforma/fase-5-memoria.md): a memória da Dute agora, o Agent Dute
 * na parte 5.5.
 *
 * Toda callable fica declarada neste arquivo, numa linha só, no formato que a
 * conferência do invoker (tools/check_functions_invoker.ps1) lê; o teste
 * callables.test.ts trava o formato. Toda function confere a liberação da
 * memória antes de tudo.
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
