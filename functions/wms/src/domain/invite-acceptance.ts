import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import { CUSTOMERS_COLLECTION } from "./customer-profile.js";
import { assertInviteCustomerAllowed, inviteEventReference } from "./customer-invite.js";
import { LEGACY_CUSTOMER_CODE } from "./customer-scope.js";
import { createEvent } from "./operations.js";
import { isPlatformRole, type PlatformRole } from "./platform-roles.js";

/**
 * O convite pelo link (Pessoas e acessos), do lado do servidor.
 *
 * - `lookupInvite` responde sem login: o token do link é a credencial. Dá o
 *   e-mail, o nome, o perfil e, no convite de cliente, o nome do cliente,
 *   para a tela mostrar "Cliente · Itaú Unibanco". Nada além do convite.
 * - `acceptInvite` (pergunta 68, docs/plataforma/fase-2-nucleo.md) pede o
 *   login com o e-mail do convite já confirmado, mas não o perfil: quem
 *   aceita ainda não tem. Numa transação, confere o convite e o cliente, cria
 *   o perfil, marca o convite usado e grava o evento `access.invite_accepted`.
 *   Repetir o aceite feito devolve o mesmo resultado.
 */

export const INVITES_COLLECTION = "invites";
export const USERS_COLLECTION = "users";

/** O cliente da equipe Dutelog (artifacts/app/src/lib/active-customer.ts, INTERNAL_CUSTOMER_CODE). */
export const INTERNAL_CUSTOMER_CODE = "Dutelog";

/** O token do link: o id do convite, sem caractere que mude o caminho do documento. */
const TOKEN = z
  .string()
  .trim()
  .regex(/^[\w.-]{12,180}$/, "Convite inválido ou não encontrado.");

const ProcurarConvite = z.object({ token: TOKEN });

const AceitarConvite = z
  .object({
    token: TOKEN,
    nome: z.string().trim().min(1, "Informe seu nome.").max(120, "Use até 120 caracteres no nome."),
  })
  .strict();

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function invalido(error: z.ZodError): never {
  throw new HttpsError("invalid-argument", error.issues[0]?.message ?? "Pedido inválido.");
}

/** Como o perfil aparece na frase do evento ("ativou acesso como ..."), como a tela de aceite dizia. */
const ROTULO_DO_PERFIL: Record<PlatformRole, string> = {
  owner: "owner Dutelog",
  admin: "admin Dutelog",
  interno: "interno Dutelog",
  wms: "operação WMS",
  campo: "campo",
  comercial: "comercial",
  financeiro: "financeiro",
  rh: "RH",
  suporte: "suporte",
  painel: "painel",
  cliente: "cliente",
};

/** O cliente do perfil: o do convite; sem ele, a BTG para o cliente antigo e a Dutelog para a equipe. */
export function clienteDoConvite(convite: Record<string, unknown>, role: PlatformRole): string {
  return texto(convite.customer_code) || (role === "cliente" ? LEGACY_CUSTOMER_CODE : INTERNAL_CUSTOMER_CODE);
}

export type ConviteProcurado = {
  email: string;
  nome?: string;
  role: string;
  customer_code?: string;
  /** O nome do cliente, no convite de cliente. */
  customer_name?: string;
  status: "pending";
};

/** O nome do cadastro do cliente pelo código; a BTG antiga pode não ter cadastro. */
async function nomeDoCliente(db: Firestore, codigo: string): Promise<string | undefined> {
  const clientes = db.collection(CUSTOMERS_COLLECTION);
  const [porCodigo, porCustomerCode] = await Promise.all([
    clientes.where("code", "==", codigo).limit(1).get(),
    clientes.where("customer_code", "==", codigo).limit(1).get(),
  ]);
  const cadastro = (porCustomerCode.docs[0] ?? porCodigo.docs[0])?.data();
  return texto(cadastro?.name) || texto(cadastro?.nome) || texto(cadastro?.legal_name) || (codigo === LEGACY_CUSTOMER_CODE ? codigo : undefined);
}

export async function lookupInviteFor(db: Firestore, dados: unknown): Promise<ConviteProcurado> {
  const lido = ProcurarConvite.safeParse(dados ?? {});
  if (!lido.success) throw new HttpsError("not-found", "Convite inválido ou não encontrado.");
  const snapshot = await db.collection(INVITES_COLLECTION).doc(lido.data.token).get();
  if (!snapshot.exists || snapshot.data()?.status !== "pending") {
    throw new HttpsError("not-found", "Convite inválido ou não encontrado.");
  }
  const convite = snapshot.data() ?? {};
  const role = texto(convite.role);
  const codigo = texto(convite.customer_code);
  const nomeDoClienteDoConvite = role === "cliente" ? await nomeDoCliente(db, codigo || LEGACY_CUSTOMER_CODE) : undefined;
  return {
    email: texto(convite.email).toLowerCase(),
    ...(texto(convite.nome) ? { nome: texto(convite.nome) } : {}),
    role,
    ...(codigo ? { customer_code: codigo } : {}),
    ...(nomeDoClienteDoConvite ? { customer_name: nomeDoClienteDoConvite } : {}),
    status: "pending",
  };
}

export type ResultadoDoAceite = { ok: true; role: PlatformRole; customer_code: string; replayed?: true };

type Login = { uid: string; token: Record<string, unknown> } | undefined;

export async function acceptInviteFor(db: Firestore, auth: Login, dados: unknown, agora: () => Date = () => new Date()): Promise<ResultadoDoAceite> {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Faça login para continuar.");
  const lido = AceitarConvite.safeParse(dados ?? {});
  if (!lido.success) invalido(lido.error);
  const email = texto(auth.token.email).toLowerCase();
  if (!email) throw new HttpsError("failed-precondition", "A conta não tem e-mail.");
  // A pergunta 68: quem tem o link não entra só por saber o e-mail; o e-mail tem de ser dele.
  if (auth.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Confirme seu e-mail antes de aceitar o convite.");
  }
  const { token, nome } = lido.data;
  const conviteRef = db.collection(INVITES_COLLECTION).doc(token);
  const perfilRef = db.collection(USERS_COLLECTION).doc(auth.uid);

  return db.runTransaction(async (transaction) => {
    const [conviteSnap, perfilSnap] = await Promise.all([transaction.get(conviteRef), transaction.get(perfilRef)]);
    if (!conviteSnap.exists) throw new HttpsError("not-found", "Convite inválido ou não encontrado.");
    const convite = conviteSnap.data() ?? {};
    if (texto(convite.email).toLowerCase() !== email) {
      throw new HttpsError("permission-denied", "Este convite é de outro e-mail.");
    }
    const role = convite.role;
    if (!isPlatformRole(role)) throw new HttpsError("failed-precondition", "O convite não tem um perfil válido.");
    const customerCode = clienteDoConvite(convite, role);

    // O aceite já feito por esta conta: repetir não grava de novo.
    if (texto(convite.status) === "used" && convite.used_by === auth.uid && perfilSnap.exists) {
      return { ok: true, role, customer_code: texto(perfilSnap.data()?.customer_code) || customerCode, replayed: true };
    }
    if (texto(convite.status) === "used") throw new HttpsError("failed-precondition", "Este convite já foi usado.");
    if (texto(convite.status) !== "pending") throw new HttpsError("failed-precondition", "Este convite não vale mais.");
    if (perfilSnap.exists) {
      throw new HttpsError("failed-precondition", "Esta conta já tem acesso. Para mudar o perfil, fale com quem administra os acessos.");
    }
    // O cliente do convite ainda vale: cadastrado, não arquivado e com o portal ligado (pergunta 69).
    await assertInviteCustomerAllowed(transaction, db, { role, customer_code: customerCode });

    transaction.create(perfilRef, {
      nome,
      email,
      role,
      customer_code: customerCode,
      invite_id: token,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    transaction.update(conviteRef, { status: "used", used_by: auth.uid, used_at: FieldValue.serverTimestamp() });
    // O token abre o convite: o evento leva só a referência dele, também no id.
    const referencia = inviteEventReference(token);
    createEvent(
      transaction,
      db,
      `evt_${referencia}_aceito`,
      {
        type: "access.invite_accepted",
        title: "Convite aceito",
        description: `${nome} ativou acesso como ${ROTULO_DO_PERFIL[role]}.`,
        entity_type: "usuario",
        entity_id: auth.uid,
        customer_code: customerCode,
        payload: { role, customer_code: customerCode, invite_ref: referencia },
        occurred_at: agora().toISOString(),
        source: "functions_access",
      },
      { uid: auth.uid, email, name: nome, role, customer_code: customerCode },
    );
    return { ok: true, role, customer_code: customerCode };
  });
}
