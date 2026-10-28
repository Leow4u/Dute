import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";
import { HttpsError, onCall, onRequest } from "firebase-functions/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { REMETENTE_DOS_AVISOS, emailParaQualquerContato, enderecoDoApp, segredosDoResend } from "./domain/avisos.js";
import { enviarPeloResend, enviarSoAuditoria, markNotificationsReadFor, relatoDosDesistidos, runNotificationsFor, soParaADutelog } from "./domain/avisos-gravacao.js";
import { completeServiceOrderFor } from "./domain/conclusao-gravacao.js";
import { sendInviteEmailVerificationFor } from "./domain/confirmacao-email.js";
import { resolveFieldCompletionFor } from "./domain/conclusao-recusada-gravacao.js";
import { openStorageDemandFor } from "./domain/demanda-do-armazem-gravacao.js";
import { openDirectDemandFor } from "./domain/demanda-direta-gravacao.js";
import { registerItemFor, registerOccurrenceFor, registerPresenceFor, registerStepFor } from "./domain/execucao-gravacao.js";
import { attachPhotoFor, type ConferirArquivo } from "./domain/fotos-gravacao.js";
import { saveCollaboratorFor, saveVehicleFor } from "./domain/gravacao.js";
import { assertLiberado, operacaoLiberada, retencaoLiberada } from "./domain/liberacao.js";
import { saveServiceOrderFor } from "./domain/os-gravacao.js";
import { reopenServiceOrderFor, reviewServiceOrderFor } from "./domain/revisao-gravacao.js";
import { requireOperacaoCaller } from "./domain/profile.js";
import { runRetentionFor } from "./domain/retencao-gravacao.js";
import { runPhotoRetentionFor, type ApagarArquivo } from "./domain/retencao-das-fotos-gravacao.js";
import { runDailyAlertsFor } from "./domain/rotina-gravacao.js";
import { declineServiceRequestFor, requestServiceFor } from "./domain/solicitacao-gravacao.js";
import { getRoomBoardFor } from "./domain/tv-leitura.js";
import { sendSurveyToCommercialFor } from "./domain/vistoria-gravacao.js";
import { PROJECT_ID } from "./project.js";
import { createApiHandler } from "./api/handler.js";
import { apiBrowserOrigins } from "./api/browser.js";

/**
 * Functions da Operação (codebase `operacao` no firebase.json; desenho em
 * docs/plataforma/fase-3-operacao.md).
 *
 * Toda callable fica declarada neste arquivo, numa linha só, no formato que a
 * conferência do invoker (tools/check_functions_invoker.ps1) lê; o teste
 * callables.test.ts trava o formato. Toda callable começa por
 * `await requireOperacaoCaller(db, request, PROJECT_ID)`; a do portal, com
 * `{ portal: true }`, só atende o cliente. A confirmação de e-mail é a única
 * exceção: a pessoa ainda não tem perfil, e a sessão + convite autorizam o envio.
 */

initializeApp();
setGlobalOptions({
  region: "southamerica-east1",
  maxInstances: 10,
  memory: "256MiB",
});

const db = getFirestore();
const api = createApiHandler(db, PROJECT_ID, (token) => getAuth().verifyIdToken(token, true));

/** API REST externa. IAM permite chegar ao gateway; a aplicação autentica cada ação. */
export const duteApi = onRequest({ cors: apiBrowserOrigins(PROJECT_ID), invoker: "public", timeoutSeconds: 60 }, async (request, response) => {
  response.set("Cache-Control", "no-store");
  response.set("X-Content-Type-Options", "nosniff");
  if (request.rawBody?.byteLength > 65536) {
    response.status(413).json({ error: { code: "invalid-argument", message: "O corpo passa de 64 KiB." } });
    return;
  }
  if (["POST", "PATCH"].includes(request.method) && !request.is("application/json")) {
    response.status(415).json({ error: { code: "invalid-argument", message: "Use Content-Type: application/json." } });
    return;
  }
  try {
    const result = await api({ method: request.method, path: request.path, query: request.query, body: request.body, headers: {
      authorization: request.get("authorization"), "idempotency-key": request.get("idempotency-key"), "x-approval-id": request.get("x-approval-id"),
    } });
    if (typeof result.body.request_id === "string") response.set("X-Request-Id", result.body.request_id);
    if (result.status === 429) response.set("Retry-After", "60");
    response.status(result.status).json(result.body);
  } catch {
    // A storage/audit outage must not leak credentials or claim success.
    response.status(503).json({ error: { code: "unavailable", message: "API indisponível. Repita com a mesma Idempotency-Key." } });
  }
});

/** O tipo e o tamanho do arquivo no bucket padrão do projeto, ou null quando ele não existe. */
const conferirArquivo: ConferirArquivo = async (caminho) => {
  const arquivo = getStorage().bucket().file(caminho);
  const [existe] = await arquivo.exists();
  if (!existe) return null;
  const [metadados] = await arquivo.getMetadata();
  return { contentType: String(metadados.contentType ?? ""), size: Number(metadados.size ?? 0) };
};

/** Apaga o arquivo do bucket padrão (a retenção das fotos da OS); o que já não existe conta como apagado. */
const apagarDoBucket: ApagarArquivo = async (caminho) => {
  await getStorage().bucket().file(caminho).delete({ ignoreNotFound: true });
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

/** Abre a demanda e as OS da entrega pela Dutelog de um pedido de saída do WMS; a retirada pelo cliente não gera OS. */
export const openStorageDemand = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID, { wms: true });
  return openStorageDemandFor(db, caller, request.data);
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

/** Anexa à conclusão a assinatura da conclusão recusada do celular, ou a dispensa (pergunta 66). */
export const resolveFieldCompletion = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID);
  return resolveFieldCompletionFor(db, caller, request.data);
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

/** O cliente pede uma OS pelo portal: a solicitação cai em Para planejar; nunca abre demanda nem OS sozinha. */
export const requestService = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID, { portal: true });
  return requestServiceFor(db, caller, request.data, conferirArquivo);
});

/** Recusa a solicitação do portal com o motivo, que o cliente lê. */
export const declineServiceRequest = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID);
  return declineServiceRequestFor(db, caller, request.data);
});

/** O cliente abriu o sino do portal: os avisos até agora ficam vistos para este login. */
export const markNotificationsRead = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID, { sino: true });
  return markNotificationsReadFor(db, caller, request.data);
});

/** O quadro do dia para a TV da sala: agendadas, em execução e concluídas, sem valor nem contato. Só lê; o painel não grava nada. */
export const getRoomBoard = onCall(async (request) => {
  const caller = await requireOperacaoCaller(db, request, PROJECT_ID, { painel: true });
  return getRoomBoardFor(db, caller);
});

/**
 * Todo dia às 06:00 de São Paulo: a CNH vencendo e a revisão preventiva do
 * veículo viram um evento cada, uma vez por dia por item (parte 3.13a). Fora
 * da liberação da Operação, não faz nada.
 */
export const runDailyAlerts = onSchedule({ schedule: "every day 06:00", timeZone: "America/Sao_Paulo", timeoutSeconds: 300 }, async () => {
  if (!operacaoLiberada(PROJECT_ID)) return;
  const resultado = await runDailyAlertsFor(db);
  console.info("runDailyAlerts", resultado);
});

/**
 * Todo dia às 03:20 de São Paulo, a retenção da Operação (LGPD): o aviso do
 * sino e o e-mail que já saiu da fila com mais de 90 dias saem (decisão 8),
 * com o evento das contagens por cliente; e as fotos das etapas, das
 * ocorrências e da vistoria da OS revisada há mais de 12 meses (decisão 2),
 * com o evento de cada OS. Uma parte não segura a outra. Uma instância de
 * cada vez. Só com a liberação da retenção.
 */
export const runOperacaoRetention = onSchedule({ schedule: "every day 03:20", timeZone: "America/Sao_Paulo", timeoutSeconds: 540, maxInstances: 1 }, async () => {
  if (!retencaoLiberada(PROJECT_ID)) return;
  const [avisos, fotos] = await Promise.allSettled([runRetentionFor(db), runPhotoRetentionFor(db, apagarDoBucket)]);
  console.info("runOperacaoRetention", {
    avisos: avisos.status === "fulfilled" ? avisos.value : "falhou",
    fotos: fotos.status === "fulfilled" ? fotos.value : "falhou",
  });
  const falha = [avisos, fotos].find((resultado): resultado is PromiseRejectedResult => resultado.status === "rejected");
  if (falha) throw falha.reason;
});

/**
 * A cada 5 minutos: os eventos novos que dão aviso viram o aviso no sino do
 * portal e, para os contatos que ligaram o modelo, o e-mail (parte 4.6a).
 * Também envia os convites de acesso agendados em Pessoas e acessos. A
 * chave do Resend vem do Secret Manager (RESEND_API_KEY), declarada só onde o
 * segredo existe (segredosDoResend); sem ela, o e-mail fica só auditado na
 * fila. Fora da produção, só sai o e-mail para endereços da Dutelog. Uma
 * instância de cada vez. Fora da liberação da Operação, não faz nada.
 */
export const runNotifications = onSchedule({ schedule: "every 5 minutes", timeZone: "America/Sao_Paulo", timeoutSeconds: 240, maxInstances: 1, secrets: segredosDoResend(PROJECT_ID) }, async () => {
  if (!operacaoLiberada(PROJECT_ID)) return;
  const origem = enderecoDoApp(PROJECT_ID);
  if (!origem) return;
  const chave = process.env.RESEND_API_KEY?.trim();
  const pelaApi = chave ? enviarPeloResend(chave) : enviarSoAuditoria;
  const enviar = emailParaQualquerContato(PROJECT_ID) ? pelaApi : soParaADutelog(pelaApi);
  const resultado = await runNotificationsFor(db, { origem, remetente: REMETENTE_DOS_AVISOS, enviar });
  console.info("runNotifications", { ...resultado, desistidos: resultado.desistidos.length });
  // A falha definitiva vai para o log de erro, que o painel do sistema mostra.
  const relato = relatoDosDesistidos(resultado.desistidos);
  if (relato) console.error(relato);
});

/** Confirmação imediata da própria conta durante o aceite do convite, antes do perfil. */
export const sendInviteEmailVerification = onCall({ timeoutSeconds: 60, secrets: segredosDoResend(PROJECT_ID) }, async (request) => {
  assertLiberado(PROJECT_ID);
  try {
    const chave = process.env.RESEND_API_KEY?.trim();
    return await sendInviteEmailVerificationFor(db, request.auth, request.data, {
      projectId: PROJECT_ID, auth: getAuth(), enviar: chave ? enviarPeloResend(chave) : null,
    });
  } catch (erro) {
    if (erro instanceof HttpsError) throw erro;
    // Erros de infraestrutura também não podem registrar o caminho privado do convite.
    throw new HttpsError("unavailable", "Não foi possível enviar a confirmação. Aguarde um minuto e tente reenviar.");
  }
});
