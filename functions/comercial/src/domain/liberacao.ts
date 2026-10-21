import { HttpsError } from "firebase-functions/https";

/**
 * Liberação do Comercial por ambiente (docs/plataforma/fase-6-comercial.md,
 * "Liberação").
 *
 * A produção recebe a `main` inteira por disparo manual, então as callables do
 * Comercial sobem para o dute-prod junto com qualquer correção do WMS. Até o
 * OK do Leonardo (parte 17), elas recusam fora desta lista. Ligar na produção
 * é um PR que acrescenta "dute-prod" aqui e em COMERCIAL_AMBIENTES_LIBERADOS
 * de artifacts/app/src/lib/liberacao.ts; o teste
 * artifacts/app/src/lib/platform-lists.test.ts exige as duas listas iguais.
 */
export const COMERCIAL_AMBIENTES_LIBERADOS = ["dute-homolog"] as const;

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
