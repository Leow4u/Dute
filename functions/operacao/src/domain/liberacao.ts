import { HttpsError } from "firebase-functions/https";

/**
 * Liberação da Operação por ambiente (docs/plataforma/fase-3-operacao.md).
 *
 * A produção recebe a `main` inteira por disparo manual. Com o OK do
 * Leonardo em 22/10/2026, homologação e produção atendem. O dute-btg
 * continua de fora. A lista é a mesma de artifacts/app/src/lib/liberacao.ts;
 * o teste artifacts/app/src/lib/platform-lists.test.ts trava as duas.
 */
export const OPERACAO_AMBIENTES_LIBERADOS = ["dute-homolog", "dute-prod"] as const;

export function operacaoLiberada(projectId: string | null | undefined): boolean {
  const id = String(projectId ?? "").trim();
  return (OPERACAO_AMBIENTES_LIBERADOS as readonly string[]).includes(id);
}

/** Primeira coisa de toda callable de negócio da Operação. */
export function assertLiberado(projectId: string | null | undefined): void {
  if (operacaoLiberada(projectId)) return;
  const id = String(projectId ?? "").trim() || "projeto não identificado";
  throw new HttpsError("failed-precondition", `A Operação ainda não está liberada neste ambiente (${id}).`);
}
