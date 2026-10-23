import type { LucideIcon } from "lucide-react";

/**
 * Item do "Precisa de você" do Início de um módulo (docs/plataforma/plano-de-implantacao.md,
 * seção 1.1): o que está parado e a ação que leva à tela que resolve.
 * Nenhuma ação acontece no Início.
 */
export type TomDoItem = "critical" | "attention" | "info" | "agent";

export type ItemDoInicio = {
  id: string;
  tone: TomDoItem;
  icon: LucideIcon;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
};

/**
 * "4 coisas precisam de você no Comercial." ou "Nada parado na Operação."
 * `noModulo` já leva a preposição ("no Comercial", "na Operação").
 */
export function fraseDoInicio(quantas: number, noModulo: string): { destaque: string | null; resto: string } {
  if (quantas <= 0) return { destaque: null, resto: `Nada parado ${noModulo}.` };
  return {
    destaque: quantas === 1 ? "1 coisa" : `${quantas} coisas`,
    resto: `${quantas === 1 ? "precisa" : "precisam"} de você ${noModulo}.`,
  };
}
