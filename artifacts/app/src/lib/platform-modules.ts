import {
  MODULOS_PADRAO_CLIENTE,
  MODULOS_POR_PAPEL,
  MODULO_ROTULO,
  type Modulo,
  type Papel,
} from "@workspace/dominio";
import { Boxes, Handshake, Receipt, Truck, Users, type LucideIcon } from "lucide-react";

import { ROTA_COMERCIAL } from "./comercial/navegacao";
import { COMERCIAL_LIBERADO } from "./liberacao";
import type { OperationProfile } from "./operations";

/**
 * Módulos da plataforma no app e a tela de entrada (docs/plataforma/fase-2-nucleo.md,
 * parte 2). Um módulo só existe para a pessoa quando tem casa para o papel
 * dela: hoje Armazenagem, Financeiro e, onde está liberado, o Comercial têm
 * tela. A casa de cada papel mantém a aterrissagem de antes
 * (getHomePathForProfile).
 */

export type PlatformModule = {
  key: Modulo;
  label: string;
  icon: LucideIcon;
  /** Tela onde o papel começa no módulo. Sem casa, o módulo não aparece para o papel. */
  home: Partial<Record<Papel, string>>;
  /** Para o cliente o módulo é um card? As faturas fazem parte do portal, não são uma entrada. */
  clientCard: boolean;
  /** Liberação própria do módulo (lib/liberacao.ts): fora dela o módulo não tem casa. */
  liberacao?: "comercial";
};

export const PLATFORM_MODULES: readonly PlatformModule[] = [
  {
    key: "wms",
    label: MODULO_ROTULO.wms,
    icon: Boxes,
    home: {
      owner: "/dashboard",
      admin: "/dashboard",
      interno: "/dashboard",
      suporte: "/dashboard",
      wms: "/pedidos",
      cliente: "/portal",
    },
    clientCard: true,
  },
  { key: "operacao", label: MODULO_ROTULO.operacao, icon: Truck, home: {}, clientCard: true },
  {
    key: "comercial",
    label: MODULO_ROTULO.comercial,
    icon: Handshake,
    home: { owner: ROTA_COMERCIAL, admin: ROTA_COMERCIAL, comercial: ROTA_COMERCIAL },
    clientCard: false,
    liberacao: "comercial",
  },
  {
    key: "financeiro",
    label: MODULO_ROTULO.financeiro,
    icon: Receipt,
    home: { owner: "/faturamento", admin: "/faturamento", financeiro: "/faturamento" },
    clientCard: false,
  },
  { key: "rh", label: MODULO_ROTULO.rh, icon: Users, home: {}, clientCard: false },
];

export type ModuleEntry = { module: PlatformModule; href: string };

/**
 * Módulos que a pessoa abre: os do papel (equipe) ou os contratados
 * (cliente; sem perfil carregado, o padrão), com casa para o papel. O
 * Comercial só tem casa com a liberação dele (padrão: a deste build).
 */
export function modulesForPerson(
  role: Papel | null | undefined,
  profile: Pick<OperationProfile, "modules"> | null | undefined,
  comercial: boolean = COMERCIAL_LIBERADO,
): ModuleEntry[] {
  if (!role) return [];
  const wanted: readonly Modulo[] =
    role === "cliente" ? (profile?.modules ?? MODULOS_PADRAO_CLIENTE) : MODULOS_POR_PAPEL[role];
  return PLATFORM_MODULES.flatMap((module) => {
    if (!wanted.includes(module.key)) return [];
    if (role === "cliente" && !module.clientCard) return [];
    if (module.liberacao === "comercial" && !comercial) return [];
    const href = module.home[role];
    return href ? [{ module, href }] : [];
  });
}

export type Entrada =
  | { kind: "redirect"; to: string }
  | { kind: "cards"; modules: ModuleEntry[] }
  | { kind: "nenhum" };

/** Um módulo: direto para a casa dele. Dois ou mais: os cards. Nenhum: a tela diz isso. */
export function entrada(
  role: Papel | null | undefined,
  profile: Pick<OperationProfile, "modules"> | null | undefined,
  comercial: boolean = COMERCIAL_LIBERADO,
): Entrada {
  const modules = modulesForPerson(role, profile, comercial);
  if (modules.length === 1) return { kind: "redirect", to: modules[0].href };
  if (modules.length === 0) return { kind: "nenhum" };
  return { kind: "cards", modules };
}
