import { createHash } from "node:crypto";

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { CUSTOMERS_COLLECTION, canonicalSkuPrefix, isProspect } from "./customer-profile.js";
import { LEGACY_CUSTOMER_CODE } from "./customer-scope.js";

/**
 * Convite de usuário `cliente` (Pessoas e acessos). O `customer_code` do
 * convite vira a fronteira de isolamento da pessoa (invariante 4), e sem
 * `client_access` ela recebe os módulos padrão (wms e financeiro). Por isso
 * o convite exige um cadastro achado pelo código, não arquivado, que não seja
 * prospect do Comercial, com o portal ligado (não "Sem portal") e que tenha
 * sigla do SKU (tem armazenagem).
 *
 * A BTG passa sempre: o cadastro dela pode nunca ter sido salvo com sigla nem
 * ter projeção (docs/multicliente-modelos-de-operacao.md), e o portal dela
 * funciona assim desde o go-live.
 */

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function isArchived(record: Record<string, unknown>): boolean {
  return record.archived === true || text(record.status) === "archived";
}

/** Por que o convite não serve, ou null. Só o perfil `cliente` é conferido. */
export function inviteCustomerProblem(input: {
  role: unknown;
  customerCode: unknown;
  /** Cadastros cujo `code` ou `customer_code` é o código do convite. */
  customers: ReadonlyArray<Record<string, unknown>>;
}): string | null {
  if (text(input.role) !== "cliente") return null;
  const code = text(input.customerCode);
  if (!code) return "Informe o cliente do convite.";
  if (code === LEGACY_CUSTOMER_CODE) return null;

  const matches = input.customers.filter(
    (record) => text(record.customer_code) === code || text(record.code) === code,
  );
  if (!matches.length) return `O cliente ${code} não está cadastrado em Configurações › Clientes.`;
  const problems = matches.map((record): string | null => {
    if (isArchived(record)) return `O cliente ${code} está arquivado.`;
    if (isProspect(record)) return `${code} é um prospect do Comercial: o convite só vale para cliente.`;
    // "Sem portal" corta o portal (pergunta 69): convite novo não entra.
    if (text(record.portal_status) === "inactive") return `O cliente ${code} está sem portal.`;
    if (!canonicalSkuPrefix(record.sku_prefix)) {
      return `O cliente ${code} não tem sigla do SKU: sem armazenagem, ele não tem portal.`;
    }
    return null;
  });
  return problems.includes(null) ? null : problems[0];
}

/**
 * Confere o convite dentro da transação do cadastro, antes de qualquer
 * escrita. Lê só os cadastros com o código do convite.
 */
export async function assertInviteCustomerAllowed(
  transaction: Transaction,
  db: Firestore,
  invite: Record<string, unknown>,
): Promise<void> {
  const role = text(invite.role);
  const code = text(invite.customer_code);
  // Sem leitura quando não há o que conferir: outro perfil, ou a BTG.
  if (role !== "cliente" || code === LEGACY_CUSTOMER_CODE) return;
  const customers = db.collection(CUSTOMERS_COLLECTION);
  const [byCode, byCustomerCode] = await Promise.all([
    transaction.get(customers.where("code", "==", code)),
    transaction.get(customers.where("customer_code", "==", code)),
  ]);
  const records = new Map<string, Record<string, unknown>>();
  for (const row of [...byCode.docs, ...byCustomerCode.docs]) records.set(row.id, row.data());
  const problem = inviteCustomerProblem({ role, customerCode: code, customers: [...records.values()] });
  if (problem) throw new HttpsError("failed-precondition", problem);
}

/**
 * A troca de papel para cliente, em Usuários: a pessoa vira cliente do
 * código que já tem no perfil, que passa pela mesma conferência do convite.
 * O interno convidado leva "Dutelog", que não é cliente; sem a conferência,
 * ele viraria cliente dela com os módulos padrão.
 */
export async function assertClientRoleCustomer(
  transaction: Transaction,
  db: Firestore,
  user: Record<string, unknown>,
): Promise<void> {
  if (!text(user.customer_code)) {
    throw new HttpsError(
      "failed-precondition",
      "A pessoa não está ligada a um cliente: para dar o portal, convide-a pelo cliente.",
    );
  }
  await assertInviteCustomerAllowed(transaction, db, { role: "cliente", customer_code: user.customer_code });
}

/**
 * O id do convite é o token do link: `lookupInvite` e o cadastro da pessoa o
 * usam como chave, e quem o tem aceita o convite. O evento do convite, que a
 * equipe do armazém lê, leva só esta referência (os 16 primeiros dígitos do
 * SHA-256 do token), que liga os eventos do mesmo convite sem abri-lo. O
 * aceite (`invite-acceptance.ts`) grava a mesma no evento dele.
 */
export function inviteEventReference(token: string): string {
  return `convite_${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
}
