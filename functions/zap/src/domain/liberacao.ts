/**
 * O painel do Zap liga em homologação e produção. O dute-btg fica de fora.
 * A retenção tem lista própria e começa só na homologação (docs/plataforma/lgpd.md,
 * "A operação primeiro"): a produção não apaga até o Leonardo pedir.
 *
 * Cada projeto da lista precisa ter o próprio segredo da ingestão no
 * Secret Manager antes do deploy (docs/deploy-functions-manual.md).
 */

import { HttpsError } from "firebase-functions/https";

import { NOME_DO_SEGREDO } from "./ingestao.js";

export const ZAP_AMBIENTES_LIBERADOS = ["dute-homolog", "dute-prod"] as const;

export const RETENCAO_AMBIENTES_LIBERADOS = ["dute-homolog"] as const;

export const ZAP_PROJETOS_COM_SEGREDO: readonly string[] = ["dute-homolog", "dute-prod"];

export function zapLiberado(projectId: string | null | undefined): boolean {
  return (ZAP_AMBIENTES_LIBERADOS as readonly string[]).includes(String(projectId ?? "").trim());
}

export function assertZapLiberado(projectId: string | null | undefined): void {
  if (zapLiberado(projectId)) return;
  const id = String(projectId ?? "").trim() || "projeto não identificado";
  throw new HttpsError("failed-precondition", `O painel do Zap ainda não está liberado neste ambiente (${id}).`);
}

export function retencaoLiberada(projectId: string | null | undefined): boolean {
  return (RETENCAO_AMBIENTES_LIBERADOS as readonly string[]).includes(String(projectId ?? "").trim());
}

export function segredosDoZap(projectId: string | null | undefined, projetos: readonly string[] = ZAP_PROJETOS_COM_SEGREDO): string[] {
  const id = String(projectId ?? "").trim();
  return projetos.includes(id) ? [NOME_DO_SEGREDO] : [];
}
