import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onCall } from "firebase-functions/https";
import { setGlobalOptions } from "firebase-functions/v2";

import { completeServiceOrderFor } from "./domain/conclusao-gravacao.js";
import { openDirectDemandFor } from "./domain/demanda-direta-gravacao.js";
import { registerItemFor, registerOccurrenceFor, registerPresenceFor, registerStepFor } from "./domain/execucao-gravacao.js";
import { attachPhotoFor, type ConferirArquivo } from "./domain/fotos-gravacao.js";
import { saveCollaboratorFor, saveVehicleFor } from "./domain/gravacao.js";
import { saveServiceOrderFor } from "./domain/os-gravacao.js";
import { reopenServiceOrderFor, reviewServiceOrderFor } from "./domain/revisao-gravacao.js";
import { requireOperacaoCaller } from "./domain/profile.js";
import { getRoomBoardFor } from "./domain/tv-leitura.js";
import { sendSurveyToCommercialFor } from "./domain/vistoria-gravacao.js";
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

/** O tipo e o tamanho do arquivo no bucket padrão do projeto, ou null quando ele não existe. */
const conferirArquivo: ConferirArquivo = async (caminho) => {
  const arquivo = getStorage().bucket().file(caminho);
  const [existe] = await arquivo.exists();
  if (!existe) return null;
  const [metadados] = await arquivo.getMetadata();
  return { contentType: String(metadados.contentType ?? ""), size: Number(metadados.size ?? 0) };
};

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

/** Abre (todo o saldo), planeja (várias OS com fatias), abre a vistoria, agenda, muda os itens ou cancela a OS. */
export const saveServiceOrder = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID);
  return saveServiceOrderFor(db, caller, request.data);
});

/** Abre a demanda direta (paraquedas e emergencial), sem orçamento, em Para planejar. */
export const openDirectDemand = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID);
  return openDirectDemandFor(db, caller, request.data);
});

/** Registra a etapa da OS com o instante em que aconteceu; a primeira põe a OS Em execução. */
export const registerStep = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID, { campo: true });
  return registerStepFor(db, caller, request.data);
});

/** Registra uma ocorrência na OS agendada ou em execução. */
export const registerOccurrence = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID, { campo: true });
  return registerOccurrenceFor(db, caller, request.data);
});

/** Registra o feito de um item da OS ou o que foi executado além do planejado (incluído em campo). */
export const registerItem = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID, { campo: true });
  return registerItemFor(db, caller, request.data);
});

/** Anexa à OS a foto que já subiu ao Storage, depois de conferir o arquivo. */
export const attachPhoto = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID, { campo: true });
  return attachPhotoFor(db, caller, request.data, conferirArquivo);
});

/** Marca a entrada ou a saída de alguém da equipe na OS; o líder marca todos, quem tem o app marca a própria. */
export const registerPresence = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID, { campo: true });
  return registerPresenceFor(db, caller, request.data);
});

/** Conclui a OS em execução com a assinatura do responsável ou "sem aceite no local"; a OS vai para Em revisão. */
export const completeServiceOrder = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID, { campo: true });
  return completeServiceOrderFor(db, caller, request.data, conferirArquivo);
});

/** Revisa a OS concluída: decide cada divergência; a OS vai para Revisada e a demanda recebe o resumo da Operação. */
export const reviewServiceOrder = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID);
  return reviewServiceOrderFor(db, caller, request.data);
});

/** Reabre a OS revisada (owner e admin): volta a Em execução, com a revisão e a conclusão guardadas no histórico. */
export const reopenServiceOrder = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID);
  return reopenServiceOrderFor(db, caller, request.data);
});

/** Envia a vistoria em execução ao Comercial (ambientes, fotos, itens levantados e medidas): a OS vai para Revisada, sem revisão. */
export const sendSurveyToCommercial = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID, { campo: true });
  return sendSurveyToCommercialFor(db, caller, request.data);
});

/** O quadro do dia para a TV da sala: agendadas, em execução e concluídas, sem valor nem contato. Só lê; o painel não grava nada. */
export const getRoomBoard = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID, { painel: true });
  return getRoomBoardFor(db, caller);
});
