import type { Modulo, Papel } from "@workspace/dominio";
import type { LucideIcon } from "lucide-react";

import { moduloDaRota, podeTrocarDeModulo } from "./ambientes";
import { COMERCIAL_LIBERADO, FINANCEIRO_LIBERADO, OPERACAO_LIBERADO, PLATAFORMA_LIBERADA } from "./liberacao";
import type { OperationProfile } from "./operations";
import { PLATFORM_MODULES, modulesForPerson } from "./platform-modules";

/**
 * Seletor de módulo do topo de cada shell (decisão de 23/10/2026,
 * docs/plataforma/plano-de-implantacao.md, seção 1.1): o nome do módulo
 * aberto é o botão; a lista traz os módulos que a pessoa abre, na ordem da
 * entrada, com o aberto marcado. Quem tem um módulo só não tem lista: o
 * shell mostra só o nome. O logo leva aos cards (/).
 */

export type OpcaoDeModulo = {
  key: Modulo;
  label: string;
  href: string;
  icon: LucideIcon;
  atual: boolean;
};

export type Liberacoes = { comercial: boolean; plataforma: boolean; operacao: boolean; financeiro?: boolean };

/** Liberações deste build. Testes passam as suas, explícitas. */
export const LIBERACOES_DESTE_BUILD: Liberacoes = {
  comercial: COMERCIAL_LIBERADO,
  plataforma: PLATAFORMA_LIBERADA,
  operacao: OPERACAO_LIBERADO,
  financeiro: FINANCEIRO_LIBERADO,
};

/** Módulos da lista do seletor; vazia quando a pessoa tem um módulo só ou a plataforma está desligada. */
export function opcoesDoSeletor(
  role: Papel | null | undefined,
  profile: Pick<OperationProfile, "modules"> | null | undefined,
  path: string,
  liberacoes: Liberacoes = LIBERACOES_DESTE_BUILD,
): OpcaoDeModulo[] {
  const financeiro = liberacoes.financeiro ?? false;
  if (!podeTrocarDeModulo(role, profile, liberacoes.comercial, liberacoes.plataforma, liberacoes.operacao, financeiro)) return [];
  const aberto = moduloDaRota(path);
  return modulesForPerson(role, profile, liberacoes.comercial, liberacoes.operacao, financeiro).map((entry) => ({
    key: entry.module.key,
    label: entry.module.label,
    href: entry.href,
    icon: entry.module.icon,
    atual: entry.module.key === aberto,
  }));
}

/** O módulo cuja casa a rota pertence, com rótulo e ícone; Configuração não é módulo. */
export function moduloAberto(path: string): { key: Modulo; label: string; icon: LucideIcon } | null {
  const key = moduloDaRota(path);
  if (!key) return null;
  const modulo = PLATFORM_MODULES.find((item) => item.key === key);
  return modulo ? { key, label: modulo.label, icon: modulo.icon } : null;
}
