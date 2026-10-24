import {
  MODULOS_PADRAO_CLIENTE,
  MODULOS_POR_PAPEL,
  MODULO_ROTULO,
  type Modulo,
  type Papel,
} from "@workspace/dominio";
import { Boxes, Handshake, Receipt, Truck, Users, type LucideIcon } from "lucide-react";

import { ROTA_CAMPO, abreCampo } from "./campo/navegacao";
import { COMERCIAL_ROLES, ROTA_COMERCIAL, abreComercial } from "./comercial/navegacao";
import { ROTA_FINANCEIRO, abreFinanceiro } from "./financeiro/navegacao";
import { COMERCIAL_LIBERADO, FINANCEIRO_LIBERADO, OPERACAO_LIBERADO, RH_LIBERADO } from "./liberacao";
import { OPERACAO_CADASTRO_ROLES, ROTA_OPERACAO, abreOperacao } from "./operacao/navegacao";
import { ROTA_MINHAS_OS } from "./portal/navegacao";
import { RH_ROLES, ROTA_RH, abreRh } from "./rh/navegacao";
import { ROTA_TV, abreTv } from "./tv/navegacao";
import type { OperationProfile } from "./operations";

/**
 * Módulos da plataforma no app e a tela de entrada (docs/plataforma/fase-2-nucleo.md,
 * parte 2). Um módulo só existe para a pessoa quando tem casa para o papel
 * dela: hoje Armazenagem, Financeiro e, onde está liberado, o Comercial têm
 * tela. A casa de cada papel mantém a aterrissagem de antes
 * (getHomePathForProfile).
 *
 * O card leva à casa. O shell sai do caminho (lib/ambientes.ts): /comercial
 * abre o ambiente do Comercial; o Faturamento continua no WMS, que é a tela
 * que existe hoje.
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
  liberacao?: "comercial" | "operacao" | "rh";
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
  {
    key: "operacao",
    label: MODULO_ROTULO.operacao,
    icon: Truck,
    // A coordenação entra no Início da Operação; o campo, no app dele (parte 3.8b); o painel, na TV da sala (parte 3.12b);
    // o cliente, nas OS dele no portal (parte 4.3b).
    home: {
      ...Object.fromEntries(OPERACAO_CADASTRO_ROLES.map((role) => [role, ROTA_OPERACAO])),
      campo: ROTA_CAMPO,
      painel: ROTA_TV,
      cliente: ROTA_MINHAS_OS,
    },
    clientCard: true,
    liberacao: "operacao",
  },
  {
    key: "comercial",
    label: MODULO_ROTULO.comercial,
    icon: Handshake,
    home: Object.fromEntries(COMERCIAL_ROLES.map((role) => [role, ROTA_COMERCIAL])),
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
  {
    key: "rh",
    label: MODULO_ROTULO.rh,
    icon: Users,
    // O RH (Fase 8): owner, admin e rh entram no Início dele, só com a liberação própria.
    home: Object.fromEntries(RH_ROLES.map((role) => [role, ROTA_RH])),
    clientCard: false,
    liberacao: "rh",
  },
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
  operacao: boolean = OPERACAO_LIBERADO,
  financeiro: boolean = FINANCEIRO_LIBERADO,
  rh: boolean = RH_LIBERADO,
): ModuleEntry[] {
  if (!role) return [];
  const wanted: readonly Modulo[] =
    role === "cliente" ? (profile?.modules ?? MODULOS_PADRAO_CLIENTE) : MODULOS_POR_PAPEL[role];
  return PLATFORM_MODULES.flatMap((module) => {
    if (!wanted.includes(module.key)) return [];
    if (role === "cliente" && !module.clientCard) return [];
    if (module.liberacao === "comercial" && !abreComercial(role, comercial)) return [];
    // A Operação, só com a liberação dela: quem coordena, o campo, o painel e o cliente, nas OS do portal.
    const naOperacao = abreOperacao(role, operacao) || abreCampo(role, operacao) || abreTv(role, operacao) || (role === "cliente" && operacao);
    if (module.liberacao === "operacao" && !naOperacao) return [];
    if (module.liberacao === "rh" && !abreRh(role, rh)) return [];
    // Com o Financeiro liberado, a casa dele é o shell próprio (Fase 4); fora, o Faturamento do WMS.
    const href = module.key === "financeiro" && abreFinanceiro(role, financeiro) ? ROTA_FINANCEIRO : module.home[role];
    return href ? [{ module, href }] : [];
  });
}

export type Entrada =
  | { kind: "redirect"; to: string }
  | { kind: "cards"; modules: ModuleEntry[] }
  | { kind: "nenhum" };

/**
 * Um módulo: direto para a casa dele. Dois ou mais: os cards. Nenhum: a tela
 * diz isso. O cliente nunca vê os cards: o portal é um lugar só, e ele entra
 * pela primeira casa (o Início com a armazenagem; sem ela, Minhas OS).
 */
export function entrada(
  role: Papel | null | undefined,
  profile: Pick<OperationProfile, "modules"> | null | undefined,
  comercial: boolean = COMERCIAL_LIBERADO,
  operacao: boolean = OPERACAO_LIBERADO,
  financeiro: boolean = FINANCEIRO_LIBERADO,
  rh: boolean = RH_LIBERADO,
): Entrada {
  const modules = modulesForPerson(role, profile, comercial, operacao, financeiro, rh);
  if (modules.length === 0) return { kind: "nenhum" };
  if (modules.length === 1 || role === "cliente") return { kind: "redirect", to: modules[0].href };
  return { kind: "cards", modules };
}
