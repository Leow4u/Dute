import { HttpsError } from "firebase-functions/https";

/**
 * Liberação do Comercial por ambiente (docs/plataforma/fase-6-comercial.md,
 * "Liberação").
 *
 * A produção recebe a `main` inteira por disparo manual, então as callables do
 * Comercial sobem para o dute-prod junto com qualquer correção do WMS. Com o
 * OK do Leonardo em 21/10/2026, homologação e produção atendem. O dute-btg
 * continua de fora. A lista é a mesma de artifacts/app/src/lib/liberacao.ts;
 * o teste artifacts/app/src/lib/platform-lists.test.ts trava as duas.
 */
export const COMERCIAL_AMBIENTES_LIBERADOS = ["dute-homolog", "dute-prod"] as const;

export function comercialLiberado(projectId: string | null | undefined): boolean {
  const id = String(projectId ?? "").trim();
  return (COMERCIAL_AMBIENTES_LIBERADOS as readonly string[]).includes(id);
}

/** Primeira coisa de toda callable de negócio do Comercial. */
export function assertLiberado(projectId: string | null | undefined): void {
  if (comercialLiberado(projectId)) return;
  const id = String(projectId ?? "").trim() || "projeto não identificado";
  throw new HttpsError(
    "failed-precondition",
    `O Comercial ainda não está liberado neste ambiente (${id}).`,
  );
}
