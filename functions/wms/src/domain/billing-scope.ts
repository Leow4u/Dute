import type {
  DocumentReference,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";

/** Cliente cuja competência antiga está em `billing_periods/YYYY-MM`. */
export const LEGACY_BILLING_CUSTOMER = "BTG Pactual";

export function billingDocumentId(customerCode: string, competencia: string): string {
  const customer = customerCode.trim().replace(/[^\w.-]/g, "_").slice(0, 200);
  return `${customer}__${competencia}`;
}

/** Id antigo, só da BTG. Os outros clientes nunca usam o mês sozinho. */
export function legacyBillingDocumentId(
  customerCode: string,
  competencia: string,
): string | null {
  return customerCode.trim() === LEGACY_BILLING_CUSTOMER ? competencia : null;
}

type ResolverDb = {
  collection(name: string): {
    doc(id: string): DocumentReference;
  };
};

/**
 * Documento novo `{cliente}__{competência}`. Se ele não existe e o cliente é
 * a BTG, devolve o documento antigo `YYYY-MM`.
 */
export async function resolveBillingDocument(
  db: ResolverDb,
  collectionName: string,
  customerCode: string,
  competencia: string,
  transaction?: Transaction,
): Promise<{ ref: DocumentReference; legacy: boolean }> {
  const primary = db.collection(collectionName).doc(
    billingDocumentId(customerCode, competencia),
  );
  const primarySnap = transaction
    ? await transaction.get(primary)
    : await primary.get();
  if (primarySnap.exists) return { ref: primary, legacy: false };
  const legacyId = legacyBillingDocumentId(customerCode, competencia);
  if (!legacyId) return { ref: primary, legacy: false };
  const legacy = db.collection(collectionName).doc(legacyId);
  const legacySnap = transaction ? await transaction.get(legacy) : await legacy.get();
  if (legacySnap.exists) return { ref: legacy, legacy: true };
  return { ref: primary, legacy: false };
}

/**
 * Onde o Financeiro está ligado (parte 7.2c,
 * docs/plataforma/fase-7-financeiro-unificado.md), a competência emitida se
 * fatura e se recebe lá, e o WMS não marca pagamento. Cópia literal de
 * FINANCEIRO_AMBIENTES_LIBERADOS (functions/financeiro/src/domain/liberacao.ts);
 * a trava é artifacts/app/src/lib/platform-lists.test.ts.
 */
export const FINANCEIRO_PROJECTS = ["dute-homolog", "dute-prod"];

export function billingPaidInFinanceiro(projectId: string | undefined): boolean {
  return !!projectId && FINANCEIRO_PROJECTS.includes(projectId);
}

/**
 * O período de faturamento do cliente na competência, como a prévia lê: o
 * documento novo e, só na BTG, o antigo. Sem documento, vazio (em aberto).
 */
export async function readBillingPeriod(
  db: ResolverDb,
  collectionName: string,
  customerCode: string,
  competencia: string,
): Promise<Record<string, unknown>> {
  const { ref } = await resolveBillingDocument(db, collectionName, customerCode, competencia);
  return (await ref.get()).data() ?? {};
}

/**
 * Para que lado o movimento conta na cobrança, uma vez só: o recebimento
 * (`wms_receiving`) é entrada e a expedição (`wms_shipping`) é saída. O que o
 * armazém faz por dentro (abertura do estoque, guarda, contagem, correção,
 * devolução, ajuste) tem outra origem e não se cobra. O movimento sem origem é
 * legado: com a foto da virada, ele já está nela; sem a foto, conta pelo
 * sinal e, sem sinal, pelo tipo.
 */
export function billingMovementDirection(
  movement: Record<string, unknown>,
  { snapshot }: { snapshot: boolean },
): "incoming" | "outgoing" | null {
  const source = String(movement.source ?? "").trim().toLowerCase();
  if (source === "wms_receiving") return "incoming";
  if (source === "wms_shipping") return "outgoing";
  if (source || snapshot) return null;
  const sign = Number(movement.sinal ?? movement.sign ?? 0);
  if (sign > 0) return "incoming";
  if (sign < 0) return "outgoing";
  const type = String(movement.tipo_mov ?? "").trim().toUpperCase();
  if (type === "ENTRADA") return "incoming";
  if (type === "SAIDA") return "outgoing";
  return null;
}

/** Mês fechado sem foto ainda: gravar uma vez. Foto, replace e baseline ficam. */
export function shouldFreezeCompetencia(mode: string, closed: boolean): boolean {
  return closed && !["frozen", "replace", "baseline"].includes(mode);
}

/**
 * Grava a foto do uso do mês fechado só se ela ainda não existe, numa
 * transação. A prévia que chega depois, com outra conta do mesmo mês (o
 * estoque lido antes ou depois de um recebimento), não troca a foto que
 * outra prévia ou a emissão já gravou. Devolve se gravou.
 */
export async function freezeBillingUsage(
  db: Pick<Firestore, "runTransaction">,
  ref: DocumentReference,
  data: Record<string, unknown>,
): Promise<boolean> {
  return db.runTransaction(async (transaction) => {
    const atual = await transaction.get(ref);
    if (!shouldFreezeCompetencia(String(atual.data()?.mode ?? ""), true)) return false;
    transaction.set(ref, data);
    return true;
  });
}

export function billingCustomerCode(profile: {
  role: string;
  customer_code?: string;
}, requested?: string): string {
  if (profile.role === "cliente") {
    const own = profile.customer_code?.trim();
    if (!own) throw new Error("Cliente sem código.");
    return own;
  }
  const code = requested?.trim();
  return code || LEGACY_BILLING_CUSTOMER;
}
