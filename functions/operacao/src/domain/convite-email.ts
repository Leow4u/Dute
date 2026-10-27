import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { ENDERECO_DO_APP, type EmailDoAviso } from "./avisos.js";
import { isPlatformRole } from "./platform-roles.js";
import { acessoDoCliente } from "./profile.js";

/** A criação do convite no WMS põe só a referência na fila privada de e-mail. */
export const ACCESS_INVITE_EMAIL_KIND = "access_invite";
const TOKEN = /^[0-9a-f]{32,128}$/;
/** O mesmo cliente legado que o aceite do convite no WMS admite sem cadastro. */
const CLIENTE_LEGADO = "BTG Pactual";

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
  if (convite.role === "cliente") {
    const code = texto(convite.customer_code);
    if (!code || code.includes("/") || code === "." || code === ".." || /^__.*__$/.test(code) || Buffer.byteLength(code, "utf8") > 1500) return null;
    if (!(await acessoDoCliente(db, code)).portalAtivo) return null;
    // O cadastro também pode ter mudado desde o convite. O aceite continua
    // sendo a autoridade final; aqui evitamos enviar link que já não serve.
    if (code !== CLIENTE_LEGADO) {
      const [porCodigo, porCustomerCode] = await Promise.all([
        db.collection("customers").where("code", "==", code).get(),
        db.collection("customers").where("customer_code", "==", code).get(),
      ]);
      const disponivel = [...porCodigo.docs, ...porCustomerCode.docs].some((doc) => {
        const cliente = doc.data();
        return cliente.archived !== true && cliente.status !== "archived" && cliente.stage !== "prospect"
          && cliente.portal_status !== "inactive" && Boolean(texto(cliente.sku_prefix));
      });
      if (!disponivel) return null;
    }
  }
  const nome = texto(convite.nome).replace(/[\r\n]/g, " ").slice(0, 120);
  return {
    to: [email],
    subject: "Convite para acessar o Dute App · Dutelog",
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
