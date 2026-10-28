import { FieldPath, FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import {
  EVENTOS_DE_AVISO,
  avisoDoEvento,
  clienteRecebeOModelo,
  destinatariosDoModelo,
  documentoDoModelo,
  emailDoAviso,
  eventoLido,
  idDoAviso,
  idDoEmail,
  modeloDoEvento,
  soDaDutelog,
} from "./avisos.js";
import { EVENTS_COLLECTION } from "./events.js";
import { acessoDoCliente, type OperacaoProfile } from "./profile.js";
import { ACCESS_INVITE_EMAIL_KIND, emailDoConvitePendente, registrarEmailDoConvite } from "./convite-email.js";

/**
 * A rotina dos avisos (parte 4.6a): a cada poucos minutos, lê os eventos
 * novos que dão aviso, a partir do cursor, e grava o aviso no sino do
 * cliente (`client_notifications`) e, para os contatos que ligaram o modelo,
 * o e-mail na fila (`email_outbox`), na mesma transação, com o id do
 * evento: rodar de novo não duplica. Depois envia a fila. O cliente com o
 * portal desligado (arquivado ou "Sem portal") não recebe aviso, nem no sino
 * nem por e-mail (pergunta 71).
 *
 * O cursor guarda o instante gravado (`created_at`) e o id do último evento
 * lido. Só entra o evento gravado há mais de um minuto, para o que foi
 * gravado por último num servidor com o relógio um pouco atrás não ficar
 * antes do cursor. Na primeira vez, o cursor começa agora: os eventos de
 * antes não viram aviso.
 */

export const CLIENT_NOTIFICATIONS_COLLECTION = "client_notifications";
export const EMAIL_OUTBOX_COLLECTION = "email_outbox";
export const NOTIFICATION_CURSORS_COLLECTION = "notification_cursors";
export const CUSTOMER_CONTACTS_COLLECTION = "customer_contacts";
export const CURSOR_ID = "avisos";
/** Até quando cada login viu os avisos do sino (parte 4.6c), um documento por login. */
export const CLIENT_NOTIFICATION_READS_COLLECTION = "client_notification_reads";
export const LOTE_DE_EVENTOS = 200;
export const LOTE_DE_EMAILS = 20;
export const TENTATIVAS_DO_EMAIL = 5;
/** Quanto o evento espera antes de virar aviso. */
export const ESPERA_DO_EVENTO_MS = 60_000;

export type EmailParaEnviar = { id: string; from: string; to: string[]; subject: string; text: string; html?: string };
/** Envia o e-mail; "audit" quando o envio está desligado (sem a chave do provedor): fica registrado e não sai. */
export type EnviarEmail = (email: EmailParaEnviar) => Promise<{ status: "sent" | "audit"; provider_id?: string | null }>;

export type ResultadoDosAvisos = {
  iniciou: boolean;
  eventos: number;
  avisos: number;
  emails: number;
  enviados: number;
  auditados: number;
  falhas: number;
  /** Os e-mails que chegaram à última tentativa nesta rodada, com o erro dela. */
  desistidos: Array<{ id: string; erro: string }>;
};

type Cursor = { createdAt: Timestamp; eventoId: string };

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** Lê o cursor; sem ele, grava o de agora e não lê nada nesta rodada. */
async function lerCursor(db: Firestore, agora: Date): Promise<Cursor | null> {
  const ref = db.collection(NOTIFICATION_CURSORS_COLLECTION).doc(CURSOR_ID);
  const cursor = await ref.get();
  const createdAt = cursor.get("created_at");
  if (cursor.exists && createdAt instanceof Timestamp) return { createdAt, eventoId: texto(cursor.get("evento_id")) };
  await ref.set({ created_at: Timestamp.fromDate(agora), evento_id: "", iniciado_em: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() });
  return null;
}

/** O acesso (módulos e portal) e os contatos de cada cliente, lidos uma vez por rodada. */
function leiturasDoCliente(db: Firestore) {
  const acessos = new Map<string, ReturnType<typeof acessoDoCliente>>();
  const contatos = new Map<string, Promise<Array<Record<string, unknown>>>>();
  return {
    acesso(code: string) {
      if (!acessos.has(code)) acessos.set(code, acessoDoCliente(db, code));
      return acessos.get(code)!;
    },
    contatos(code: string) {
      if (!contatos.has(code)) {
        contatos.set(
          code,
          db.collection(CUSTOMER_CONTACTS_COLLECTION).where("customer_code", "==", code).get().then((lidos) => lidos.docs.map((doc) => doc.data())),
        );
      }
      return contatos.get(code)!;
    },
  };
}

export async function gerarAvisos(
  db: Firestore,
  origem: string,
  agora: () => Date = () => new Date(),
): Promise<Pick<ResultadoDosAvisos, "iniciou" | "eventos" | "avisos" | "emails">> {
  const instante = agora();
  const cursor = await lerCursor(db, instante);
  if (!cursor) return { iniciou: true, eventos: 0, avisos: 0, emails: 0 };
  const ordenados = db
    .collection(EVENTS_COLLECTION)
    .where("type", "in", [...EVENTOS_DE_AVISO])
    .where("created_at", "<=", Timestamp.fromMillis(instante.getTime() - ESPERA_DO_EVENTO_MS))
    .orderBy("created_at", "asc")
    .orderBy(FieldPath.documentId(), "asc");
  // Sem o id (o cursor de começo), parte do instante: o que foi gravado nele também fica antes.
  const depois = cursor.eventoId ? ordenados.startAfter(cursor.createdAt, cursor.eventoId) : ordenados.startAfter(cursor.createdAt);
  const lote = await depois.limit(LOTE_DE_EVENTOS).get();
  const cliente = leiturasDoCliente(db);
  let avisos = 0;
  let emails = 0;
  for (const snapshot of lote.docs) {
    const evento = eventoLido(snapshot.id, snapshot.data());
    const modelo = modeloDoEvento(evento);
    const alvo = modelo ? documentoDoModelo(modelo, evento) : null;
    if (!modelo || !alvo || !evento.customer_code) continue;
    const acesso = await cliente.acesso(evento.customer_code);
    // O cliente arquivado ou "Sem portal" não recebe aviso, nem no sino nem por e-mail (pergunta 71).
    if (!acesso.portalAtivo || !clienteRecebeOModelo(modelo, acesso.modulos)) continue;
    const documento = await db.collection(alvo.colecao).doc(alvo.id).get();
    const aviso = avisoDoEvento(evento, documento.exists ? (documento.data() ?? {}) : null);
    if (!aviso) continue;
    const email = emailDoAviso(aviso, destinatariosDoModelo(modelo, await cliente.contatos(aviso.customer_code)), origem);
    const criou = await db.runTransaction(async (transaction) => {
      const avisoRef = db.collection(CLIENT_NOTIFICATIONS_COLLECTION).doc(idDoAviso(evento.id));
      if ((await transaction.get(avisoRef)).exists) return { aviso: false, email: false };
      transaction.create(avisoRef, {
        id: avisoRef.id,
        ...aviso,
        evento_id: evento.id,
        evento_tipo: evento.type,
        ocorrido_em: evento.occurred_at,
        created_at: FieldValue.serverTimestamp(),
      });
      if (email) {
        transaction.create(db.collection(EMAIL_OUTBOX_COLLECTION).doc(idDoEmail(evento.id)), {
          id: idDoEmail(evento.id),
          aviso_id: avisoRef.id,
          customer_code: aviso.customer_code,
          modelo,
          ...email,
          status: "pending",
          tentativas: 0,
          erro: null,
          enviado_em: null,
          provider_id: null,
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      return { aviso: true, email: Boolean(email) };
    });
    if (criou.aviso) avisos += 1;
    if (criou.email) emails += 1;
  }
  const ultimo = lote.docs.at(-1);
  const ultimoCriado = ultimo?.get("created_at");
  if (ultimo && ultimoCriado instanceof Timestamp) {
    await db
      .collection(NOTIFICATION_CURSORS_COLLECTION)
      .doc(CURSOR_ID)
      .set({ created_at: ultimoCriado, evento_id: ultimo.id, updated_at: FieldValue.serverTimestamp() }, { merge: true });
  }
  return { iniciou: false, eventos: lote.size, avisos, emails };
}

/** Envia a fila: o pendente sai (ou fica auditado, com o envio desligado); a falha tenta de novo até 5 vezes. */
export async function enviarFila(
  db: Firestore,
  enviar: EnviarEmail,
  remetente: string,
  origem?: string,
): Promise<Pick<ResultadoDosAvisos, "enviados" | "auditados" | "falhas" | "desistidos">> {
  const pendentes = await db.collection(EMAIL_OUTBOX_COLLECTION).where("status", "==", "pending").limit(LOTE_DE_EMAILS).get();
  let enviados = 0;
  let auditados = 0;
  let falhas = 0;
  const desistidos: ResultadoDosAvisos["desistidos"] = [];
  for (const doc of pendentes.docs) {
    const dados = doc.data();
    const convite = dados.kind === ACCESS_INVITE_EMAIL_KIND;
    try {
      const corpo = convite
        ? await emailDoConvitePendente(db, doc.id, dados.invite_id, origem)
        : { to: Array.isArray(dados.to) ? dados.to.filter((item): item is string => typeof item === "string") : [], subject: texto(dados.subject), text: texto(dados.text) };
      if (!corpo) {
        await registrarEmailDoConvite(db, doc.id, dados.invite_id, { status: "cancelled", erro: null, updated_at: FieldValue.serverTimestamp() });
        continue;
      }
      const resposta = await enviar({ id: doc.id, from: remetente, ...corpo });
      const resultado = {
        status: resposta.status,
        provider_id: resposta.provider_id ?? null,
        enviado_em: resposta.status === "sent" ? new Date().toISOString() : null,
        erro: null,
        updated_at: FieldValue.serverTimestamp(),
      };
      if (convite) await registrarEmailDoConvite(db, doc.id, dados.invite_id, resultado);
      else await doc.ref.update(resultado);
      if (resposta.status === "sent") enviados += 1;
      else auditados += 1;
    } catch (error) {
      const tentativas = (typeof dados.tentativas === "number" ? dados.tentativas : 0) + 1;
      // O provedor pode repetir o corpo recusado no erro. O link do convite
      // é uma credencial: nem ele nem o destinatário vão para erro ou log.
      const erro = convite ? "Não foi possível enviar o e-mail do convite." : (error instanceof Error ? error.message : String(error)).slice(0, 300);
      const resultado = {
        status: tentativas >= TENTATIVAS_DO_EMAIL ? "failed" : "pending",
        tentativas,
        erro,
        updated_at: FieldValue.serverTimestamp(),
      };
      if (convite) await registrarEmailDoConvite(db, doc.id, dados.invite_id, resultado);
      else await doc.ref.update(resultado);
      falhas += 1;
      if (tentativas >= TENTATIVAS_DO_EMAIL) desistidos.push({ id: doc.id, erro });
    }
  }
  return { enviados, auditados, falhas, desistidos };
}

/**
 * O relato do e-mail que desistiu, para o log de erro: o painel do sistema
 * agrupa os erros pela primeira linha, que é sempre a mesma; o id e o erro de
 * cada e-mail vêm depois, com o endereço mascarado (LGPD).
 */
export function relatoDosDesistidos(desistidos: ResultadoDosAvisos["desistidos"]): string | null {
  if (!desistidos.length) return null;
  const mascarar = (erro: string) => erro.replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g, "<e-mail>");
  return [
    `E-mail sem envio depois de ${TENTATIVAS_DO_EMAIL} tentativas (runNotifications)`,
    ...desistidos.map(({ id, erro }) => `${id}: ${mascarar(erro)}`),
  ].join("\n");
}

export async function runNotificationsFor(
  db: Firestore,
  opcoes: { origem: string; remetente: string; enviar: EnviarEmail; agora?: () => Date },
): Promise<ResultadoDosAvisos> {
  const gerados = await gerarAvisos(db, opcoes.origem, opcoes.agora);
  const envio = await enviarFila(db, opcoes.enviar, opcoes.remetente, opcoes.origem);
  return { ...gerados, ...envio };
}

/** O envio desligado: o e-mail fica na fila como auditado, sem sair. */
export const enviarSoAuditoria: EnviarEmail = async () => ({ status: "audit" });

/** Fora da produção: só sai o e-mail cujos destinatários são todos da Dutelog; o outro fica auditado na fila. */
export function soParaADutelog(enviar: EnviarEmail): EnviarEmail {
  return async (email) => (soDaDutelog(email.to) ? enviar(email) : enviarSoAuditoria(email));
}

/**
 * O envio pelo Resend (https://resend.com/docs/api-reference/emails/send-email),
 * com a chave de idempotência do e-mail. A chave da API vem do Secret Manager
 * (RESEND_API_KEY), declarada na função só quando o segredo existir.
 */
export function enviarPeloResend(chave: string, buscar: typeof fetch = fetch): EnviarEmail {
  return async (email) => {
    const resposta = await buscar("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json", "Idempotency-Key": email.id },
      body: JSON.stringify({ from: email.from, to: email.to, subject: email.subject, text: email.text, ...(email.html ? { html: email.html } : {}) }),
    });
    const corpo = (await resposta.json().catch(() => ({}))) as { id?: unknown; message?: unknown };
    if (!resposta.ok) throw new Error(`Resend recusou o envio (${resposta.status}): ${texto(corpo.message) || "sem mensagem"}`);
    return { status: "sent", provider_id: texto(corpo.id) || null };
  };
}

/**
 * O cliente abriu o sino (parte 4.6c): os avisos até agora ficam vistos para
 * este login. Repetir só avança o instante; não grava evento, porque não é
 * transição operacional.
 */
export async function markNotificationsReadFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  agora: () => Date = () => new Date(),
): Promise<{ lidos_ate: string }> {
  if (data != null && (typeof data !== "object" || Array.isArray(data) || Object.keys(data).length)) {
    throw new HttpsError("invalid-argument", "Campo não aceito.");
  }
  const customerCode = caller.customer_code;
  if (caller.role !== "cliente" || !customerCode) throw new HttpsError("permission-denied", "Só o cliente marca os avisos do portal.");
  const instante = agora();
  await db.collection(CLIENT_NOTIFICATION_READS_COLLECTION).doc(caller.uid).set({
    uid: caller.uid,
    customer_code: customerCode,
    lidos_ate: Timestamp.fromDate(instante),
    updated_at: FieldValue.serverTimestamp(),
  });
  return { lidos_ate: instante.toISOString() };
}
