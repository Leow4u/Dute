import { HttpsError } from "firebase-functions/https";

/**
 * Liberação da memória da Dute por ambiente (docs/plataforma/fase-5-memoria.md).
 *
 * Homologação e produção atendem: a produção entrou no lançamento da Fase 5,
 * com o OK do Leonardo em 25/10/2026. O dute-btg fica de fora. A lista é a mesma de
 * artifacts/app/src/lib/liberacao.ts; o teste
 * artifacts/app/src/lib/platform-lists.test.ts trava as duas.
 */
export const MEMORIA_AMBIENTES_LIBERADOS = ["dute-homolog", "dute-prod"] as const;

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

/**
 * Liberação própria do Agent Dute no núcleo (parte 5.5), separada da memória
 * para o Leonardo ligar uma sem a outra. Fora dela, o app segue com o agente
 * do WMS. A lista é a mesma de AGENTE_AMBIENTES_LIBERADOS do app, travada por
 * platform-lists.test.ts.
 */
export const AGENTE_AMBIENTES_LIBERADOS = ["dute-homolog", "dute-prod"] as const;

export function agenteLiberado(projectId: string | null | undefined): boolean {
  const id = String(projectId ?? "").trim();
  return (AGENTE_AMBIENTES_LIBERADOS as readonly string[]).includes(id);
}

/** Primeira coisa de toda callable e rotina do Agent Dute do núcleo. */
export function assertAgenteLiberado(projectId: string | null | undefined): void {
  if (agenteLiberado(projectId)) return;
  const id = String(projectId ?? "").trim() || "projeto não identificado";
  throw new HttpsError("failed-precondition", `O Agent Dute do núcleo ainda não está liberado neste ambiente (${id}).`);
}

/**
 * Liberação própria da retenção do agente (LGPD, decisão 8,
 * docs/plataforma/lgpd.md, seção 6): a rotina apaga o que passou do prazo,
 * então liga por ambiente, separada do agente. Só a homologação até o OK do
 * Leonardo para a produção.
 */
export const RETENCAO_AMBIENTES_LIBERADOS = ["dute-homolog"] as const;

export function retencaoLiberada(projectId: string | null | undefined): boolean {
  const id = String(projectId ?? "").trim();
  return (RETENCAO_AMBIENTES_LIBERADOS as readonly string[]).includes(id);
}
