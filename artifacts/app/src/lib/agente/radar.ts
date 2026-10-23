import type { ModuloDoAgente } from "./cliente";

/**
 * O radar do Agent Dute (parte 5.5k, pergunta 35): as linhas do "Precisa de
 * você" de cada módulo que a pessoa abre, sem regra própria. A contagem
 * continua uma só, a do Início de cada módulo (lib/resumo-do-modulo.ts).
 */

export const ROTULO_DO_MODULO: Record<ModuloDoAgente, string> = {
  wms: "Armazenagem",
  comercial: "Comercial",
  operacao: "Operação",
  financeiro: "Financeiro",
};

type ItemDoInicio = { id: string; tone: string; title: string; href: string };

export type FonteDoRadar = { modulo: ModuloDoAgente; itens: readonly ItemDoInicio[]; carregando: boolean; falhas: readonly string[] };

export type LinhaDoRadar = { id: string; titulo: string; href: string; alerta: boolean };

export type SecaoDoRadar = {
  modulo: ModuloDoAgente;
  rotulo: string;
  estado: "carregando" | "falhou" | "pronto";
  linhas: LinhaDoRadar[];
};

/** Uma seção por módulo, na ordem do Início de cada um (a mais urgente primeiro). */
export function secoesDoRadar(fontes: readonly FonteDoRadar[]): SecaoDoRadar[] {
  return fontes.map((fonte) => ({
    modulo: fonte.modulo,
    rotulo: ROTULO_DO_MODULO[fonte.modulo],
    estado: fonte.carregando ? "carregando" : fonte.falhas.length ? "falhou" : "pronto",
    linhas: fonte.itens.map((item) => ({ id: `${fonte.modulo}:${item.id}`, titulo: item.title, href: item.href, alerta: item.tone === "critical" })),
  }));
}
