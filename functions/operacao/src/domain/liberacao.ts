import { HttpsError } from "firebase-functions/https";

/**
 * Liberação da Operação por ambiente (docs/plataforma/fase-3-operacao.md).
 *
 * A produção recebe a `main` inteira por disparo manual. O cadastro fica
 * ligado só na homologação até o OK do Leonardo. O dute-prod e o dute-btg
 * recusam. A lista é a mesma de artifacts/app/src/lib/liberacao.ts; o teste
 * artifacts/app/src/lib/platform-lists.test.ts trava as duas.
 */
export const OPERACAO_AMBIENTES_LIBERADOS = ["dute-homolog"] as const;

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
