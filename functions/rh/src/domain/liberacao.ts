import { HttpsError } from "firebase-functions/https";

/**
 * Liberação do RH por ambiente (docs/plataforma/fase-8-rh.md).
 *
 * Só a homologação atende, e só depois de o banco `rh` existir nela (parte
 * 8.1b). A produção entra no lançamento da fase, com o OK do Leonardo. O
 * dute-btg fica de fora.
 */
export const RH_AMBIENTES_LIBERADOS = ["dute-homolog"] as const;

export function rhLiberado(projectId: string | null | undefined): boolean {
  const id = String(projectId ?? "").trim();
  return (RH_AMBIENTES_LIBERADOS as readonly string[]).includes(id);
}

/** Primeira coisa de toda callable do RH. */
export function assertLiberado(projectId: string | null | undefined): void {
  if (rhLiberado(projectId)) return;
  const id = String(projectId ?? "").trim() || "projeto não identificado";
  throw new HttpsError("failed-precondition", `O RH ainda não está liberado neste ambiente (${id}).`);
}
