import { HttpsError } from "firebase-functions/https";

/**
 * Liberação do RH por ambiente (docs/plataforma/fase-8-rh.md).
 *
 * Homologação e produção atendem, com o banco `dute-rh` nas duas (parte
 * 8.1b). A produção entrou no lançamento da fase, com o OK do Leonardo em
 * 25/10/2026. O dute-btg fica de fora.
 */
export const RH_AMBIENTES_LIBERADOS = ["dute-homolog", "dute-prod"] as const;

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

/**
 * Liberação própria da retenção do RH (LGPD, decisão 7,
 * docs/plataforma/lgpd.md, seção 6): a rotina apaga as linhas da versão
 * substituída da exportação, então liga por ambiente, separada do RH. Só a
 * homologação até o OK do Leonardo para a produção.
 */
export const RETENCAO_AMBIENTES_LIBERADOS = ["dute-homolog"] as const;

export function retencaoLiberada(projectId: string | null | undefined): boolean {
  const id = String(projectId ?? "").trim();
  return (RETENCAO_AMBIENTES_LIBERADOS as readonly string[]).includes(id);
}
