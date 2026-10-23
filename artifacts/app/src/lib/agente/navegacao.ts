import type { Papel } from "@workspace/dominio";

import { AGENTE_LIBERADO } from "../liberacao";
import type { ModuloDoAgente } from "./cliente";

/**
 * O Agent Dute em cada shell (parte 5.5j, docs/plataforma/fase-5-memoria.md):
 * a Armazenagem segue em /agente; o Comercial, a Operação e o Financeiro
 * ganham a rota deles, no shell deles. Tudo aqui depende da liberação própria
 * do agente (lib/liberacao.ts): fora dela, não há rota nova nem item de menu,
 * e /agente e o portal seguem com o agente do WMS.
 */

/** Quem tem o agente do núcleo: AGENTE_ROLES de functions/core, travada em platform-lists.test.ts. */
export const AGENTE_ROLES = ["owner", "admin", "interno", "wms", "comercial", "financeiro", "suporte", "cliente"] as const satisfies readonly Papel[];

export const ROTA_AGENTE_DA_ARMAZENAGEM = "/agente";
export const ROTA_AGENTE_DO_COMERCIAL = "/comercial/agente";
export const ROTA_AGENTE_DA_OPERACAO = "/operacao/agente";
export const ROTA_AGENTE_DO_FINANCEIRO = "/financeiro/agente";

const ROTA_DO_MODULO: Record<ModuloDoAgente, string> = {
  wms: ROTA_AGENTE_DA_ARMAZENAGEM,
  comercial: ROTA_AGENTE_DO_COMERCIAL,
  operacao: ROTA_AGENTE_DA_OPERACAO,
  financeiro: ROTA_AGENTE_DO_FINANCEIRO,
};

export function rotaDoAgente(modulo: ModuloDoAgente): string {
  return ROTA_DO_MODULO[modulo];
}

/** A rota do agente no shell do módulo, só com a liberação: entra na lista de rotas do módulo. */
export function rotaDoAgenteNoModulo(modulo: Exclude<ModuloDoAgente, "wms">, liberado: boolean = AGENTE_LIBERADO): string[] {
  return liberado ? [ROTA_DO_MODULO[modulo]] : [];
}

/** A tela aberta é a do agente de um shell (o shell dá a altura toda ao chat). */
export function ehTelaDoAgente(caminho: string): boolean {
  const semBusca = caminho.split("?")[0]!.replace(/\/+$/, "") || "/";
  return Object.values(ROTA_DO_MODULO).includes(semBusca);
}

/** A pessoa fala com o agente do núcleo: a liberação ligada e o papel com o agente. */
export function abreAgenteDoNucleo(role: Papel | string | null | undefined, liberado: boolean = AGENTE_LIBERADO): boolean {
  return liberado && Boolean(role) && (AGENTE_ROLES as readonly string[]).includes(role as string);
}
