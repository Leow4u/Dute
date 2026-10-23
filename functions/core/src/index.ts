import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";

import { conversarComDute } from "./domain/agente-conversa.js";
import { extrairNotaComGenkit, genkitDoAgente, gerarComGenkit, resumirComGenkit } from "./domain/agente-modelo.js";
import { baixarDoStorage } from "./domain/agente-nota.js";
import {
  decideDuteNoteFor,
  decideDutePlaybookFor,
  listDuteNotesFor,
  listDutePlaybooksFor,
  saveDutePlaybookFor,
  seedDutePlaybooksFor,
  suggestDuteNoteFor,
} from "./domain/agente-revisao.js";
import { deleteDuteRoutineFor, listDuteRoutinesFor, rodarRotinasVencidas, runDuteRoutineNowFor, saveDuteRoutineFor } from "./domain/agente-rotinas.js";
import { answerStockAlertFor, runStockFor } from "./domain/alertas-parados-gravacao.js";
import { runCasesFor } from "./domain/lembrancas-gravacao.js";
import { agenteLiberado, memoriaLiberada } from "./domain/liberacao.js";
import { runMeasuresFor } from "./domain/medidas-gravacao.js";
import { findSimilarQuotesFor } from "./domain/parecidos-gravacao.js";
import { requireCoreCaller, requireDuteCaller } from "./domain/profile.js";
import { answerSuggestionFor, suggestDurationFor } from "./domain/sugestao-gravacao.js";
import { PROJECT_ID } from "./project.js";

/**
 * Functions do núcleo (codebase `core` no firebase.json; desenho em
 * docs/plataforma/fase-5-memoria.md): a memória da Dute e o Agent Dute.
 *
 * Toda callable fica declarada neste arquivo, numa linha só, no formato que a
 * conferência do invoker (tools/check_functions_invoker.ps1) lê; o teste
 * callables.test.ts trava o formato. Toda function confere a liberação antes
 * de tudo. A callable da memória começa por
 * `await requireCoreCaller(db, request, PROJECT_ID)`, e a do Agent Dute por
 * `await requireDuteCaller(db, request, PROJECT_ID)`, com a liberação própria
 * do agente: as duas conferem a liberação e o perfil, e cada callable confere
 * o papel dela.
 */

initializeApp();
setGlobalOptions({
  region: "southamerica-east1",
  maxInstances: 10,
  memory: "256MiB",
});

const db = getFirestore();
const ai = genkitDoAgente(PROJECT_ID);

/**
 * A memória, a cada 15 minutos: as medidas, recalculadas do zero quando uma OS
 * é revisada ou reaberta (parte 5.1a), as lembranças das demandas fechadas
 * (parte 5.3a), o relógio dos itens do estoque, para os dias parado (parte
 * 5.4a), e depois dele a proposta do dia do alerta do item parado (parte
 * 5.4d). Cada uma tem o cursor dela; a falha de uma não para as outras.
 */
export const runMeasures = onSchedule({ schedule: "every 15 minutes", timeZone: "America/Sao_Paulo", timeoutSeconds: 300, maxInstances: 1 }, async () => {
  if (!memoriaLiberada(PROJECT_ID)) return;
  const [medidas, lembrancas, estoque] = await Promise.allSettled([runMeasuresFor(db), runCasesFor(db), runStockFor(db)]);
  console.info("runMeasures", {
    medidas: medidas.status === "fulfilled" ? medidas.value : "falhou",
    lembrancas: lembrancas.status === "fulfilled" ? lembrancas.value : "falhou",
    estoque: estoque.status === "fulfilled" ? estoque.value : "falhou",
  });
  const falha = [medidas, lembrancas, estoque].find((resultado): resultado is PromiseRejectedResult => resultado.status === "rejected");
  if (falha) throw falha.reason;
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

/** Os orçamentos parecidos do mesmo cliente, com o orçado e o realizado de cada um. Só lê (parte 5.3b). */
export const findSimilarQuotes = onCall(async (request) => {
  const caller = await requireCoreCaller(db, request, PROJECT_ID);
  return findSimilarQuotesFor(db, caller, request.data);
});

/** A decisão da coordenação sobre o alerta do item parado: aprovar com os itens ou descartar. Grava o evento (parte 5.4d). */
export const answerStockAlert = onCall(async (request) => {
  const caller = await requireCoreCaller(db, request, PROJECT_ID);
  return answerStockAlertFor(db, caller, request.data);
});

/**
 * A conversa com o Agent Dute do núcleo (parte 5.5e), com a resposta em
 * partes quando a tela pede. As ferramentas só leem, do cliente e do módulo da
 * conversa; só o fluxo grava a conversa, as mensagens e o uso. A nota anexada
 * pelo cliente é lida do Storage dele (parte 5.5h).
 */
export const chatWithDute = onCall({ timeoutSeconds: 180, memory: "512MiB" }, async (request, response) => {
  const caller = await requireDuteCaller(db, request, PROJECT_ID);
  return conversarComDute(db, caller, request.data, {
    gerar: gerarComGenkit(ai),
    resumir: resumirComGenkit(ai),
    lerNota: { baixar: baixarDoStorage(PROJECT_ID), extrair: extrairNotaComGenkit(ai) },
    aoPedaco: request.acceptsStreaming ? (pedaco) => void response?.sendChunk(pedaco) : undefined,
  });
});

/** O envio da anotação pelo cartão da conversa, pela pessoa que conversou: fica pendente até a coordenação aprovar (parte 5.5f). */
export const suggestDuteNote = onCall(async (request) => {
  const caller = await requireDuteCaller(db, request, PROJECT_ID);
  return suggestDuteNoteFor(db, caller, request.data);
});

/** As anotações pendentes e as que valem, do cliente ativo, para a coordenação (parte 5.5f). */
export const listDuteNotes = onCall(async (request) => {
  const caller = await requireDuteCaller(db, request, PROJECT_ID);
  return listDuteNotesFor(db, caller, request.data);
});

/** A coordenação aprova, recusa ou arquiva a anotação, com o evento (parte 5.5f). */
export const decideDuteNote = onCall(async (request) => {
  const caller = await requireDuteCaller(db, request, PROJECT_ID);
  return decideDuteNoteFor(db, caller, request.data);
});

/** Os playbooks pendentes e os que valem, do cliente ativo, para a coordenação (parte 5.5f). */
export const listDutePlaybooks = onCall(async (request) => {
  const caller = await requireDuteCaller(db, request, PROJECT_ID);
  return listDutePlaybooksFor(db, caller, request.data);
});

/** A coordenação escreve ou edita o playbook, com o evento (parte 5.5f). */
export const saveDutePlaybook = onCall(async (request) => {
  const caller = await requireDuteCaller(db, request, PROJECT_ID);
  return saveDutePlaybookFor(db, caller, request.data);
});

/** A coordenação aprova, recusa ou arquiva o playbook, com o evento (parte 5.5f). */
export const decideDutePlaybook = onCall(async (request) => {
  const caller = await requireDuteCaller(db, request, PROJECT_ID);
  return decideDutePlaybookFor(db, caller, request.data);
});

/** Os playbooks iniciais no cliente ativo, pendentes (parte 5.5f). */
export const seedDutePlaybooks = onCall(async (request) => {
  const caller = await requireDuteCaller(db, request, PROJECT_ID);
  return seedDutePlaybooksFor(db, caller, request.data);
});

/** As rotinas da pessoa no cliente da conversa (parte 5.5g). */
export const listDuteRoutines = onCall(async (request) => {
  const caller = await requireDuteCaller(db, request, PROJECT_ID);
  return listDuteRoutinesFor(db, caller, request.data);
});

/** A pessoa cria ou altera a própria rotina, pela tela ou pelo cartão da conversa; a mesma mensagem não cria duas (parte 5.5g). */
export const saveDuteRoutine = onCall(async (request) => {
  const caller = await requireDuteCaller(db, request, PROJECT_ID);
  return saveDuteRoutineFor(db, caller, request.data);
});

/** A pessoa exclui a própria rotina (parte 5.5g). */
export const deleteDuteRoutine = onCall(async (request) => {
  const caller = await requireDuteCaller(db, request, PROJECT_ID);
  return deleteDuteRoutineFor(db, caller, request.data);
});

/** "Rodar agora": a rotina roda já, sem mexer na agenda, no máximo uma vez a cada 5 minutos (parte 5.5g). */
export const runDuteRoutineNow = onCall({ timeoutSeconds: 180, memory: "512MiB" }, async (request) => {
  const caller = await requireDuteCaller(db, request, PROJECT_ID);
  return runDuteRoutineNowFor(db, caller, request.data, { gerar: gerarComGenkit(ai) });
});

/**
 * As rotinas vencidas, a cada 15 minutos, uma de cada vez, com o perfil atual
 * de quem criou (parte 5.5g). Onde o agente do núcleo está liberado, a rotina
 * agendada do WMS (runAgentRoutines) não roda.
 */
export const runDuteRoutines = onSchedule({ schedule: "every 15 minutes", timeZone: "America/Sao_Paulo", timeoutSeconds: 540, memory: "512MiB", maxInstances: 1 }, async () => {
  if (!agenteLiberado(PROJECT_ID)) return;
  console.info("runDuteRoutines", await rodarRotinasVencidas(db, { gerar: gerarComGenkit(ai) }));
});
