import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";

import { ENDERECO_DO_APP, type EmailDoAviso } from "./avisos.js";
import { isPlatformRole } from "./platform-roles.js";
import { conviteHtml } from "./convite-email-template.js";

/** A criação do convite no WMS põe só a referência na fila privada de e-mail. */
export const ACCESS_INVITE_EMAIL_KIND = "access_invite";
const TOKEN = /^[0-9a-f]{32,128}$/;
/** O mesmo cliente legado que o aceite do convite no WMS admite sem cadastro. */
const CLIENTE_LEGADO = "BTG Pactual";

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A mesma elegibilidade de cliente vale para convite e confirmação do endereço. */
export async function clienteDoConviteDisponivel(db: Firestore, convite: Record<string, unknown>, transaction?: Transaction): Promise<boolean> {
  if (convite.role !== "cliente") return true;
  const code = texto(convite.customer_code);
  if (!code || code.includes("/") || code === "." || code === ".." || /^__.*__$/.test(code) || Buffer.byteLength(code, "utf8") > 1500) return false;
  const acessoRef = db.collection("client_access").doc(code);
  const acesso = transaction ? await transaction.get(acessoRef) : await acessoRef.get();
  if (acesso.get("portal_ativo") === false) return false;
  if (code === CLIENTE_LEGADO) return true;
  const queries = [db.collection("customers").where("code", "==", code), db.collection("customers").where("customer_code", "==", code)];
  const resultados = await Promise.all(queries.map(query => transaction ? transaction.get(query) : query.get()));
  return resultados.flatMap(resultado => resultado.docs).some(doc => {
    const cliente = doc.data();
    return cliente.archived !== true && cliente.status !== "archived" && cliente.stage !== "prospect"
      && cliente.portal_status !== "inactive" && Boolean(texto(cliente.sku_prefix));
  });
}

/**
 * O convite é relido antes do envio: só a solicitação atual, ainda pendente,
 * pode sair. O destinatário e o conteúdo vêm dele, não de campos livres da fila.
 * O endereço do app vem da configuração do servidor, nunca do navegador.
 */
export async function emailDoConvitePendente(
  db: Firestore,
  emailId: string,
  token: unknown,
  origem: string | undefined,
): Promise<EmailDoAviso | null> {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  const endereco = origem?.replace(/\/+$/, "");
  if (!endereco || !Object.values(ENDERECO_DO_APP).includes(endereco)) return null;
  const convite = (await db.collection("invites").doc(token).get()).data();
  if (!convite || convite.status !== "pending" || convite.archived === true || convite.email_delivery_id !== emailId) return null;
  const email = texto(convite.email).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !isPlatformRole(convite.role)) return null;
  if (!(await clienteDoConviteDisponivel(db, convite))) return null;
  const nome = texto(convite.nome).replace(/[\r\n]/g, " ").slice(0, 120);
  return {
    to: [email],
    subject: "Seu convite para o Dute App · Dutelog",
    html: conviteHtml({ nome, email, link: `${endereco}/convite?invite=${encodeURIComponent(token)}` }),
    text: [
      nome ? `Olá, ${nome}.` : "Olá.",
      "", "Você recebeu um convite para acessar o Dute App.",
      "", "Para aceitar o convite e definir sua senha, abra:",
      `${endereco}/convite?invite=${encodeURIComponent(token)}`,
      "", `Use o e-mail ${email} e confirme seu endereço para concluir o cadastro.`,
      "", "Se você não esperava este convite, pode ignorar esta mensagem.",
      "", "Dutelog Soluções Logísticas",
    ].join("\n"),
  };
}

/** Um envio antigo nunca substitui a situação de um reenvio mais recente. */
export async function registrarEmailDoConvite(
  db: Firestore,
  emailId: string,
  token: unknown,
  resultado: Record<string, unknown> & { status: string },
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const conviteRef = typeof token === "string" && TOKEN.test(token) ? db.collection("invites").doc(token) : null;
    const convite = conviteRef ? await transaction.get(conviteRef) : null;
    transaction.update(db.collection("email_outbox").doc(emailId), resultado);
    if (conviteRef && convite?.exists && convite.get("email_delivery_id") === emailId) {
      transaction.update(conviteRef, { email_status: resultado.status, email_updated_at: FieldValue.serverTimestamp() });
    }
  });
}
