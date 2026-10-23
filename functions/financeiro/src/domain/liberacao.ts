import { HttpsError } from "firebase-functions/https";

/**
 * Liberação do Financeiro por ambiente (docs/plataforma/fase-4-financeiro.md).
 *
 * Só a homologação atende. A produção entra no lançamento da Fase 4 (parte
 * 4.9), com o OK do Leonardo. O dute-btg fica de fora. A lista é a mesma de
 * artifacts/app/src/lib/liberacao.ts; o teste
 * artifacts/app/src/lib/platform-lists.test.ts trava as duas.
 */
export const FINANCEIRO_AMBIENTES_LIBERADOS = ["dute-homolog"] as const;

export function financeiroLiberado(projectId: string | null | undefined): boolean {
  const id = String(projectId ?? "").trim();
  return (FINANCEIRO_AMBIENTES_LIBERADOS as readonly string[]).includes(id);
}

/** Primeira coisa de toda callable do Financeiro. */
export function assertLiberado(projectId: string | null | undefined): void {
  if (financeiroLiberado(projectId)) return;
  const id = String(projectId ?? "").trim() || "projeto não identificado";
  throw new HttpsError("failed-precondition", `O Financeiro ainda não está liberado neste ambiente (${id}).`);
}
