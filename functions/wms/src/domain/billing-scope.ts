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
export const FINANCEIRO_PROJECTS = ["dute-homolog"];

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

/** Mês fechado sem foto ainda: gravar uma vez. Foto, replace e baseline ficam. */
export function shouldFreezeCompetencia(mode: string, closed: boolean): boolean {
  return closed && !["frozen", "replace", "baseline"].includes(mode);
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
