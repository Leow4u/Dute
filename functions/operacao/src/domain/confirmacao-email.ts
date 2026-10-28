import { randomUUID } from "node:crypto";
import type { Auth, UserRecord } from "firebase-admin/auth";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { REMETENTE_DOS_AVISOS, emailParaQualquerContato, enderecoDoApp, soDaDutelog } from "./avisos.js";
import type { EnviarEmail } from "./avisos-gravacao.js";
import { clienteDoConviteDisponivel } from "./convite-email.js";
import { confirmacaoEmailHtml } from "./convite-email-template.js";
import { assertLiberado } from "./liberacao.js";
import { isPlatformRole } from "./platform-roles.js";

// Mesmo formato de lookupInvite/acceptInvite, inclusive links antigos compartilhados.
const Entrada = z.object({ token: z.string().trim().regex(/^[\w.-]{12,180}$/) }).strict();
const INTERVALO_MS = 60_000;
const JANELA_MS = 60 * 60_000;
const LIMITE_POR_JANELA = 5;
const FALHA_NO_ENVIO = "Não foi possível enviar a confirmação. Aguarde um minuto e tente reenviar.";
type Login = { uid: string; token: Record<string, unknown> } | undefined;
type Opcoes = {
  projectId: string;
  auth: Pick<Auth, "getUser" | "generateEmailVerificationLink">;
  enviar: EnviarEmail | null;
  agora?: () => Date;
};

function texto(valor: unknown): string { return typeof valor === "string" ? valor.trim() : ""; }

/**
 * A conta ainda não tem perfil. A sessão e o convite autorizam somente o envio
 * ao endereço atual da própria conta. O aceite continua exigindo email_verified.
 * Links OOB são credenciais: ficam apenas em memória, nunca no convite, fila ou log.
 */
export async function sendInviteEmailVerificationFor(
  db: Firestore, login: Login, dados: unknown, opcoes: Opcoes,
): Promise<{ ok: true; status: "sent" | "already_verified" }> {
  assertLiberado(opcoes.projectId);
  if (!login?.uid) throw new HttpsError("unauthenticated", "Faça login para continuar.");
  const entrada = Entrada.safeParse(dados);
  if (!entrada.success) throw new HttpsError("invalid-argument", "Convite inválido ou não encontrado.");
  const origem = enderecoDoApp(opcoes.projectId);
  if (!origem) throw new HttpsError("failed-precondition", "Envio de confirmação indisponível neste ambiente.");

  // Claims antigos não podem escolher o destinatário depois de uma troca de e-mail.
  let usuario: UserRecord;
  try { usuario = await opcoes.auth.getUser(login.uid); }
  catch { throw new HttpsError("unauthenticated", "Sua sessão não está disponível. Entre novamente."); }
  const email = texto(usuario.email).toLowerCase();
  if (usuario.disabled || !email || email !== texto(login.token.email).toLowerCase()) {
    throw new HttpsError("permission-denied", "Esta conta não pode confirmar o e-mail deste convite.");
  }
  const ref = db.collection("invites").doc(entrada.data.token);
  const requestId = randomUUID();
  const agora = (opcoes.agora ?? (() => new Date()))().getTime();

  const nome = await db.runTransaction(async transaction => {
    const [snapshot, perfil] = await Promise.all([
      transaction.get(ref), transaction.get(db.collection("users").doc(login.uid)),
    ]);
    const convite = snapshot.data();
    if (!convite || convite.status !== "pending" || convite.archived === true || !isPlatformRole(convite.role)) {
      throw new HttpsError("failed-precondition", "Este convite não está mais disponível.");
    }
    if (texto(convite.email).toLowerCase() !== email ||
      (convite.reinvite_user_id && convite.reinvite_user_id !== login.uid)) {
      throw new HttpsError("permission-denied", "Este convite é de outro e-mail.");
    }
    if (perfil.exists && !(perfil.get("access_disabled") === true &&
      convite.reinvite_user_id === login.uid && perfil.get("pending_invite_id") === entrada.data.token &&
      texto(perfil.get("email")).toLowerCase() === email)) {
      throw new HttpsError("failed-precondition", "Esta conta já tem acesso. Entre no sistema com sua senha.");
    }
    if (!(await clienteDoConviteDisponivel(db, convite, transaction))) {
      throw new HttpsError("failed-precondition", "O cliente deste convite não está disponível.");
    }
    if (usuario.emailVerified) return null;
    if (!opcoes.enviar) throw new HttpsError("failed-precondition", "O envio de confirmação está indisponível. Tente novamente mais tarde.");
    if (!emailParaQualquerContato(opcoes.projectId) && !soDaDutelog([email])) {
      throw new HttpsError("failed-precondition", "Na homologação, a confirmação só pode ser enviada para e-mails da Dutelog.");
    }
    const ultima = convite.email_verification_attempted_at;
    if (typeof ultima === "number" && agora - ultima < INTERVALO_MS) {
      throw new HttpsError("resource-exhausted", "Aguarde um minuto antes de reenviar a confirmação.");
    }
    const inicio = convite.email_verification_window_started_at;
    const mesmaJanela = typeof inicio === "number" && agora - inicio < JANELA_MS;
    const tentativas = mesmaJanela && typeof convite.email_verification_attempts === "number" ? convite.email_verification_attempts : 0;
    if (tentativas >= LIMITE_POR_JANELA) {
      throw new HttpsError("resource-exhausted", "Muitas tentativas de confirmação. Aguarde uma hora antes de reenviar.");
    }
    transaction.update(ref, {
      email_verification_attempted_at: agora,
      email_verification_window_started_at: mesmaJanela ? inicio : agora,
      email_verification_attempts: tentativas + 1,
      email_verification_request_id: requestId,
      email_verification_uid: login.uid,
      email_verification_status: "sending",
      email_verification_updated_at: FieldValue.serverTimestamp(),
    });
    return texto(usuario.displayName || convite.nome).replace(/[\r\n]/g, " ").slice(0, 120);
  });
  if (nome === null) return { ok: true, status: "already_verified" };

  const registrar = async (status: "sent" | "failed") => db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.get("email_verification_request_id") === requestId) {
      transaction.update(ref, { email_verification_status: status, email_verification_updated_at: FieldValue.serverTimestamp() });
    }
  });
  try {
    const link = new URL(await opcoes.auth.generateEmailVerificationLink(email, {
      url: `${origem}/convite?invite=${encodeURIComponent(entrada.data.token)}`,
      handleCodeInApp: false,
    }));
    link.searchParams.set("lang", "pt-BR");
    const url = link.toString();
    const resultado = await opcoes.enviar!({
      id: `verify_email_${requestId}`, from: REMETENTE_DOS_AVISOS, to: [email],
      subject: "Confirme seu e-mail · Dutelog",
      html: confirmacaoEmailHtml({ nome, email, link: url }),
      text: [nome ? `Olá, ${nome}.` : "Olá.", "", "Confirme seu e-mail para concluir seu acesso ao Dute App:", url,
        "", `E-mail do seu acesso: ${email}`,
        "", "Depois de confirmar, volte à tela do convite para concluir seu acesso.",
        "", "Este link é pessoal. Não compartilhe. Se você não solicitou esta confirmação, pode ignorar esta mensagem.",
        "", "Dutelog Soluções Logísticas"].join("\n"),
    });
    if (resultado.status !== "sent") throw new Error("Envio não realizado");
    await registrar("sent");
    return { ok: true, status: "sent" };
  } catch {
    // A resposta do Auth/provedor pode conter o código OOB, o convite e o e-mail.
    // A reserva permanece mesmo após falha para limitar novas tentativas.
    await registrar("failed").catch(() => undefined);
    throw new HttpsError("unavailable", FALHA_NO_ENVIO);
  }
}
