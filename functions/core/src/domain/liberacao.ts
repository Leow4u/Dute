import { HttpsError } from "firebase-functions/https";

/**
 * Liberação da memória da Dute por ambiente (docs/plataforma/fase-5-memoria.md).
 *
 * Só a homologação atende. A produção entra no fim da Fase 5, com o OK do
 * Leonardo. O dute-btg fica de fora. A lista é a mesma de
 * artifacts/app/src/lib/liberacao.ts; o teste
 * artifacts/app/src/lib/platform-lists.test.ts trava as duas.
 */
export const MEMORIA_AMBIENTES_LIBERADOS = ["dute-homolog"] as const;

export function memoriaLiberada(projectId: string | null | undefined): boolean {
  const id = String(projectId ?? "").trim();
  return (MEMORIA_AMBIENTES_LIBERADOS as readonly string[]).includes(id);
}

/** Primeira coisa de toda callable da memória. */
export function assertLiberado(projectId: string | null | undefined): void {
  if (memoriaLiberada(projectId)) return;
  const id = String(projectId ?? "").trim() || "projeto não identificado";
  throw new HttpsError("failed-precondition", `A memória da Dute ainda não está liberada neste ambiente (${id}).`);
}
