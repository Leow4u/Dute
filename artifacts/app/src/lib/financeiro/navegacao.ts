import type { Papel } from "@workspace/dominio";

import { rotaDoAgenteNoModulo } from "../agente/navegacao";
import { AGENTE_LIBERADO, FINANCEIRO_LIBERADO, OMIE_LIBERADA } from "../liberacao";

/**
 * Navegação do Financeiro no app (docs/plataforma/fase-4-financeiro.md): o
 * shell v3 do módulo, com Início e as filas do faturamento da demanda. O
 * Faturamento do WMS (/faturamento) continua no shell da Armazenagem até a
 * Fase 7.
 *
 * Tudo aqui depende da liberação própria do Financeiro (lib/liberacao.ts):
 * fora dela, o card do Financeiro leva ao Faturamento do WMS, como antes.
 */

/** Quem fatura e recebe: a mesma lista das callables (functions/financeiro, platform-roles.ts). */
export const FINANCEIRO_ROLES = ["owner", "admin", "financeiro"] as const satisfies readonly Papel[];

/** Casa do módulo: o Início do Financeiro. */
export const ROTA_FINANCEIRO = "/financeiro";

/** A fila A faturar e o registro da NF (parte 4.1b). */
export const ROTA_A_FATURAR = "/financeiro/a-faturar";

/** A cobrança das NFs registradas (parte 4.2b): a vencer, vencidas, pagas e todas. */
export const ROTA_A_RECEBER = "/financeiro/a-receber";
export const ROTA_VENCIDOS = "/financeiro/vencidos";
export const ROTA_PAGOS = "/financeiro/pagos";
export const ROTA_FATURAS = "/financeiro/faturas";

/** A via comercial da NF para imprimir (parte 4.2d): `?nf=`. Fora do menu; acende Faturas. */
export const ROTA_NF = "/financeiro/nf";

/** Os relatórios do Financeiro (parte 4.8b): `?relatorio=`. */
export const ROTA_RELATORIOS_DO_FINANCEIRO = "/financeiro/relatorios";

/** Os contratos e as autorizações do Comercial, só leitura (Fase 7, parte 7.5c). */
export const ROTA_CONTRATOS_DO_FINANCEIRO = "/financeiro/contratos";
export const ROTA_AUTORIZACOES_DO_FINANCEIRO = "/financeiro/autorizacoes";

/** As emissões da NFS-e pela Omie (Fase 7, parte 7.4f). Só onde a Omie está liberada. */
export const ROTA_EMISSOES = "/financeiro/emissoes";

/** O Faturamento da armazenagem, que continua no shell do WMS até a Fase 7. */
export const ROTA_FATURAMENTO_WMS = "/faturamento";

/** Telas do Financeiro que já existem no app. Cada parte nova acrescenta a dela. */
export const TELAS_DO_FINANCEIRO: readonly string[] = [
  ROTA_FINANCEIRO,
  ROTA_A_FATURAR,
  ROTA_A_RECEBER,
  ROTA_VENCIDOS,
  ROTA_PAGOS,
  ROTA_FATURAS,
  ROTA_NF,
  ROTA_CONTRATOS_DO_FINANCEIRO,
  ROTA_AUTORIZACOES_DO_FINANCEIRO,
  ROTA_RELATORIOS_DO_FINANCEIRO,
];

const ID_DA_NF = /^fat_[a-f0-9]{24}$/;

/** A lista com a NF aberta no painel: `/financeiro/vencidos?nf=fat_...`. */
export function hrefDaNf(rota: string, id: string): string {
  return `${rota}?nf=${encodeURIComponent(id)}`;
}

/** A via comercial da NF. */
export function hrefDaViaComercial(id: string): string {
  return hrefDaNf(ROTA_NF, id);
}

/** A NF aberta pela busca da URL, ou null. */
export function nfDaBusca(busca: string): string | null {
  const id = new URLSearchParams(busca).get("nf") ?? "";
  return ID_DA_NF.test(id) ? id : null;
}

/** O Agent Dute do Financeiro entra só com a liberação dele (parte 5.5j); as emissões, só com a da Omie (parte 7.4f). */
export function rotasDoFinanceiro(liberado: boolean = FINANCEIRO_LIBERADO, agente: boolean = AGENTE_LIBERADO, omie: boolean = OMIE_LIBERADA): string[] {
  return liberado ? [...TELAS_DO_FINANCEIRO, ...(omie ? [ROTA_EMISSOES] : []), ...rotaDoAgenteNoModulo("financeiro", agente)] : [];
}

export function soComFinanceiroLiberado<T extends { path: string }>(
  rotas: readonly T[],
  liberado: boolean = FINANCEIRO_LIBERADO,
  agente: boolean = AGENTE_LIBERADO,
  omie: boolean = OMIE_LIBERADA,
): T[] {
  const permitidas = rotasDoFinanceiro(liberado, agente, omie);
  return rotas.filter((rota) => permitidas.includes(rota.path));
}

export function abreFinanceiro(role: Papel | string | null | undefined, liberado: boolean = FINANCEIRO_LIBERADO): boolean {
  return liberado && Boolean(role) && (FINANCEIRO_ROLES as readonly string[]).includes(role as string);
}
