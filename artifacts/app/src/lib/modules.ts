import { CAMPO_ROLES, ROTA_CAMPO, ROTA_CAMPO_CONCLUIR, ROTA_CAMPO_OS } from "./campo/navegacao";
import { ROTA_TV, TV_ROLES } from "./tv/navegacao";
import {
  AlarmClock,
  Banknote,
  BarChart3,
  Boxes,
  BrainCircuit,
  Briefcase,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CircleCheck,
  ClipboardCheck,
  ClipboardList,
  FileCheck,
  FileText,
  Home,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  Map,
  PackagePlus,
  PackageSearch,
  Receipt,
  Sparkles,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

import { PAPEIS, isPapel, type Papel } from "@workspace/dominio";

import {
  COMERCIAL_ROLES,
  ROTA_AUTORIZACOES,
  ROTA_CLIENTES,
  ROTA_COMERCIAL,
  ROTA_CONTRATOS,
  ROTA_APROVAR,
  ROTA_DOCUMENTO,
  ROTA_MEDICOES,
  ROTA_ORCAMENTO,
  ROTA_ORCAMENTOS,
  abreComercial,
  APROVADOR_ROLES,
} from "./comercial/navegacao";
import {
  ROTA_A_FATURAR,
  ROTA_A_RECEBER,
  ROTA_FATURAMENTO_WMS,
  ROTA_FATURAS,
  ROTA_FINANCEIRO,
  ROTA_NF,
  ROTA_RELATORIOS_DO_FINANCEIRO,
  ROTA_PAGOS,
  ROTA_VENCIDOS,
  abreFinanceiro,
} from "./financeiro/navegacao";
import { COMERCIAL_LIBERADO, FINANCEIRO_LIBERADO, OPERACAO_LIBERADO } from "./liberacao";
import {
  OPERACAO_CADASTRO_ROLES,
  ROTA_COLABORADORES,
  ROTA_DEMANDA,
  ROTA_AGENDA,
  ROTA_DEMANDAS,
  ROTA_HOJE,
  ROTA_NOVA_DEMANDA,
  ROTA_OPERACAO,
  ROTA_OS,
  ROTA_OS_IMPRESSAO,
  ROTA_RELATORIOS,
  ROTA_REVISAO,
  ROTA_PLANEJAR,
  ROTA_VEICULOS,
  abreOperacao,
} from "./operacao/navegacao";
import {
  portalModulesFor,
  type OperationProfile,
  type PortalModuleKey,
} from "./operations";

/** Os 11 papéis da plataforma (lib/dominio, PAPEIS). */
export type ProfileRole = Papel;

/** Todos os papéis: telas da conta (Configuração) valem para qualquer perfil. */
export const ALL_ROLES: ProfileRole[] = [...PAPEIS];

export type AppRole = "interno" | "cliente";
export type CurrentAppRole = AppRole;

/**
 * Equipe do WMS: os papéis internos de antes da plataforma. Papel novo
 * (campo, comercial, rh, painel) fica de fora de propósito: não herda Agent
 * Dute, Documentos nem rota sem dono (getRouteProfileRoles). Cada módulo
 * novo libera as telas dele.
 */
export const INTERNAL_ROLES: ProfileRole[] = [
  "owner",
  "admin",
  "interno",
  "wms",
  "financeiro",
  "suporte",
];

export const ACCESS_ADMIN_ROLES: ProfileRole[] = ["owner", "admin"];
export const WMS_ROLES: ProfileRole[] = ["owner", "admin", "interno", "wms", "suporte"];
export const FINANCE_ROLES: ProfileRole[] = ["owner", "admin", "financeiro"];
export const OPERATIONS_ROLES: ProfileRole[] = [
  "owner",
  "admin",
  "interno",
  "wms",
  "suporte",
];
export const SUPPORT_ROLES: ProfileRole[] = ["owner", "admin", "suporte"];
/** Comercial (lib/comercial/navegacao.ts): só com a liberação própria. */
export const COMMERCIAL_ROLES: ProfileRole[] = [...COMERCIAL_ROLES];
/** Cadastro da Operação (lib/operacao/navegacao.ts): owner, admin e interno. */
export const OPERATION_REGISTRY_ROLES: ProfileRole[] = [...OPERACAO_CADASTRO_ROLES];

/**
 * Poda da escala real (31/07/2026): o operador wms vive na bancada WMS.
 * Início (antiga Torre de Controle), Triagem de solicitações e Catálogo são
 * superfícies de coordenação — fora do menu (e das rotas) do operador. A
 * consulta física dele é a aba Estoque da própria bancada.
 */
export const TOWER_NAV_ROLES: ProfileRole[] = [
  "owner",
  "admin",
  "interno",
  "financeiro",
  "suporte",
];
export const COORDINATION_NAV_ROLES: ProfileRole[] = [
  "owner",
  "admin",
  "interno",
  "suporte",
];

export function normalizeProfileRole(role: unknown): ProfileRole | null {
  return isPapel(role) ? role : null;
}

export function appRoleForProfile(role: ProfileRole | null | undefined): AppRole | null {
  if (role === "cliente") return "cliente";
  return role ? "interno" : null;
}

export function canAccessModule(
  role: ProfileRole | null | undefined,
  allowedRoles?: ProfileRole[],
) {
  if (!allowedRoles?.length) return Boolean(role);
  return Boolean(role && allowedRoles.includes(role));
}

export type ModuleAudience = "internal" | "client";

export type ModuleRoute = {
  id: string;
  label: string;
  href?: string;
  icon: LucideIcon;
  roles: ProfileRole[];
  appRoles: CurrentAppRole[];
  exact?: boolean;
  /** Telas fora do menu que acendem este item (a montagem do orçamento acende Orçamentos). */
  tambem?: readonly string[];
};

export type AppModule = {
  id: string;
  label: string;
  audience: ModuleAudience;
  href?: string;
  icon: LucideIcon;
  roles: ProfileRole[];
  appRoles: CurrentAppRole[];
  routes: ModuleRoute[];
  /**
   * Módulo do portal que este item representa. O modelo de operação do
   * cliente (lib/operations) diz quais existem: o portal de Mobiliário não
   * tem Eventos, o de Insumos não existe.
   */
  portal?: PortalModuleKey;
  /**
   * Liberação por ambiente do módulo (lib/liberacao.ts). Sem ela ligada, o
   * item não existe no menu. Comercial, Operação e Financeiro têm a sua.
   */
  liberacao?: "comercial" | "operacao" | "financeiro";
  /**
   * Ambiente de navegação. Ausente é o WMS (menu de hoje). Outro valor não
   * entra nesse menu: o shell sai do caminho da rota (lib/ambientes.ts).
   * Módulo futuro com telas próprias ganha o valor e o prefixo; sem tela,
   * não ganha ambiente.
   */
  ambiente?: "wms" | "comercial" | "operacao" | "financeiro";
  /**
   * Grupo mesmo com uma tela só: o menu mostra o módulo e a tela dentro dele
   * ("Comercial" › "Clientes"), em vez de virar o link da tela.
   */
  group?: boolean;
};

const CLIENT_ROLES: ProfileRole[] = ["cliente"];

function currentAppRolesFor(roles: ProfileRole[]): CurrentAppRole[] {
  return Array.from(
    new Set(
      roles
        .map((role) => appRoleForProfile(role))
        .filter((role): role is CurrentAppRole => Boolean(role)),
    ),
  );
}

function navRoute(config: Omit<ModuleRoute, "appRoles">): ModuleRoute {
  return {
    ...config,
    appRoles: currentAppRolesFor(config.roles),
  };
}

function appModule(
  config: Omit<AppModule, "appRoles" | "href"> & { href?: string },
): AppModule {
  return {
    ...config,
    href: config.href ?? config.routes.find((route) => route.href)?.href,
    appRoles: currentAppRolesFor(config.roles),
  };
}

export const APP_MODULES: AppModule[] = [
  // Menu interno com 5 destinos que falam a língua da operação (29/09/2026).
  // As telas não mudaram de lugar: a régua só agrupa por assunto e esconde o
  // que é de uso raro em "Mais". As permissões por rota continuam as mesmas
  // (ver modules.test.ts) — sair do menu não muda quem acessa a rota.
  appModule({
    id: "home",
    label: "Início",
    audience: "internal",
    icon: Home,
    roles: TOWER_NAV_ROLES,
    routes: [
      navRoute({
        id: "home-overview",
        label: "Início",
        href: "/dashboard",
        icon: Home,
        roles: TOWER_NAV_ROLES,
        exact: true,
      }),
    ],
  }),
  // Agent Dute: a mesma tela de conversa do portal, para toda a equipe,
  // inclusive o WMS (02/10/2026). O painel do agente segue em /agente/painel.
  appModule({
    id: "agent",
    label: "Agent Dute",
    audience: "internal",
    icon: Sparkles,
    roles: INTERNAL_ROLES,
    routes: [
      navRoute({
        id: "agent-chat",
        label: "Agent Dute",
        href: "/agente",
        icon: Sparkles,
        roles: INTERNAL_ROLES,
      }),
    ],
  }),
  // Pedido é um fluxo só: a coordenação aprova, o armazém separa, e a
  // entrega sai no mesmo dia. Uma tela, três grupos (pages/pedidos.tsx).
  appModule({
    id: "orders",
    label: "Pedidos",
    audience: "internal",
    icon: Truck,
    roles: WMS_ROLES,
    routes: [
      navRoute({
        id: "orders-queue",
        label: "Pedidos",
        href: "/pedidos",
        icon: Truck,
        roles: WMS_ROLES,
      }),
    ],
  }),
  // Estoque: uma lista de itens com a ficha de cada um (cadastro, foto,
  // endereços, reservas, histórico), o recebimento e a contagem (abertura
  // do estoque e cíclica). Catálogo, Mapa e Movimentações viraram partes da
  // ficha e da aba Histórico. Contagem voltou ao menu em 16/10/2026: é por
  // ela que o estoque é inicializado depois de uma zeragem.
  appModule({
    id: "inventory",
    label: "Estoque",
    audience: "internal",
    icon: PackageSearch,
    roles: WMS_ROLES,
    routes: [
      navRoute({
        id: "inventory-items",
        label: "Itens",
        href: "/estoque",
        icon: PackageSearch,
        roles: WMS_ROLES,
      }),
      navRoute({
        id: "inventory-receive",
        label: "Receber",
        href: "/wms/receber",
        icon: PackagePlus,
        roles: WMS_ROLES,
      }),
      navRoute({
        id: "inventory-count",
        label: "Contagem",
        href: "/wms/contagem",
        icon: ClipboardCheck,
        roles: WMS_ROLES,
      }),
      // Mapa do armazém: prateleiras, ocupação e caixas por zona (só leitura).
      navRoute({
        id: "inventory-map",
        label: "Mapa",
        href: "/estoque/mapa",
        icon: Map,
        roles: WMS_ROLES,
      }),
      // Cadastro das prateleiras com medidas, sequência e zona. Todo papel de
      // armazém consulta; só administração e coordenação alteram (validado
      // nas Functions).
      navRoute({
        id: "inventory-positions",
        label: "Posições",
        href: "/estoque/posicoes",
        icon: LayoutGrid,
        roles: WMS_ROLES,
      }),
    ],
  }),
  appModule({
    id: "billing",
    label: "Faturamento",
    audience: "internal",
    icon: Receipt,
    roles: FINANCE_ROLES,
    routes: [
      // A Tabela de preços é a configuração que a competência executa;
      // virou aba de /faturamento.
      navRoute({
        id: "billing-hub",
        label: "Faturamento",
        href: "/faturamento",
        icon: Receipt,
        roles: FINANCE_ROLES,
      }),
    ],
  }),
  // Financeiro da demanda (docs/plataforma/fase-4-financeiro.md): o Início e
  // a fila A faturar. O menu é do ambiente Financeiro, não do WMS. O
  // Faturamento da armazenagem continua no WMS até a Fase 7 (menuDoFinanceiro
  // leva até ele).
  appModule({
    id: "financeiro",
    label: "Financeiro",
    audience: "internal",
    icon: Banknote,
    roles: FINANCE_ROLES,
    liberacao: "financeiro",
    ambiente: "financeiro",
    group: true,
    routes: [
      navRoute({
        id: "financeiro-inicio",
        label: "Início",
        href: ROTA_FINANCEIRO,
        icon: Home,
        roles: FINANCE_ROLES,
        exact: true,
      }),
      navRoute({
        id: "financeiro-a-faturar",
        label: "A faturar",
        href: ROTA_A_FATURAR,
        icon: FileCheck,
        roles: FINANCE_ROLES,
      }),
      navRoute({
        id: "financeiro-a-receber",
        label: "A receber",
        href: ROTA_A_RECEBER,
        icon: CalendarClock,
        roles: FINANCE_ROLES,
      }),
      navRoute({
        id: "financeiro-vencidos",
        label: "Vencidos",
        href: ROTA_VENCIDOS,
        icon: AlarmClock,
        roles: FINANCE_ROLES,
      }),
      navRoute({
        id: "financeiro-pagos",
        label: "Pagos",
        href: ROTA_PAGOS,
        icon: CircleCheck,
        roles: FINANCE_ROLES,
      }),
      navRoute({
        id: "financeiro-faturas",
        label: "Faturas",
        href: ROTA_FATURAS,
        icon: FileText,
        roles: FINANCE_ROLES,
        tambem: [ROTA_NF],
      }),
      // Os relatórios do Financeiro (parte 4.8b): a receita, as NFs emitidas e as contas a receber.
      navRoute({
        id: "financeiro-relatorios",
        label: "Relatórios",
        href: ROTA_RELATORIOS_DO_FINANCEIRO,
        icon: BarChart3,
        roles: FINANCE_ROLES,
      }),
    ],
  }),
  // Comercial (docs/plataforma/fase-6-comercial.md). As rotas e os papéis
  // ficam aqui; o menu é do ambiente Comercial, não do WMS. O Início é a
  // casa (/comercial, rota exata para não acender nas outras telas).
  appModule({
    id: "comercial",
    label: "Comercial",
    audience: "internal",
    icon: Briefcase,
    roles: COMMERCIAL_ROLES,
    liberacao: "comercial",
    ambiente: "comercial",
    group: true,
    routes: [
      navRoute({
        id: "comercial-inicio",
        label: "Início",
        href: ROTA_COMERCIAL,
        icon: Home,
        roles: COMMERCIAL_ROLES,
        exact: true,
      }),
      navRoute({
        id: "comercial-orcamentos",
        label: "Orçamentos",
        href: ROTA_ORCAMENTOS,
        icon: Briefcase,
        roles: COMMERCIAL_ROLES,
        // A montagem, a aprovação e o documento do orçamento são da fila.
        tambem: [ROTA_ORCAMENTO, ROTA_APROVAR, ROTA_DOCUMENTO],
      }),
      navRoute({
        id: "comercial-clientes",
        label: "Clientes",
        href: ROTA_CLIENTES,
        icon: Users,
        roles: COMMERCIAL_ROLES,
      }),
      navRoute({
        id: "comercial-contratos",
        label: "Contratos",
        href: ROTA_CONTRATOS,
        icon: FileText,
        roles: COMMERCIAL_ROLES,
      }),
      navRoute({
        id: "comercial-autorizacoes",
        label: "Autorizações",
        href: ROTA_AUTORIZACOES,
        icon: FileCheck,
        roles: COMMERCIAL_ROLES,
      }),
      navRoute({
        id: "comercial-medicoes",
        label: "Medições",
        href: ROTA_MEDICOES,
        icon: CalendarRange,
        roles: COMMERCIAL_ROLES,
      }),
    ],
  }),
  // Operação (docs/plataforma/fase-3-operacao.md): o Início, a fila do dia e o
  // cadastro. O menu é do ambiente Operação, não do WMS. O Início é a casa
  // (/operacao, rota exata para não acender nas outras telas).
  appModule({
    id: "operacao",
    label: "Operação",
    audience: "internal",
    icon: Truck,
    roles: OPERATION_REGISTRY_ROLES,
    liberacao: "operacao",
    ambiente: "operacao",
    group: true,
    routes: [
      navRoute({
        id: "operacao-inicio",
        label: "Início",
        href: ROTA_OPERACAO,
        icon: Home,
        roles: OPERATION_REGISTRY_ROLES,
        exact: true,
      }),
      navRoute({
        id: "operacao-hoje",
        label: "Hoje",
        href: ROTA_HOJE,
        icon: CalendarCheck,
        roles: OPERATION_REGISTRY_ROLES,
        tambem: [ROTA_OS, ROTA_OS_IMPRESSAO],
      }),
      navRoute({
        id: "operacao-agenda",
        label: "Agenda",
        href: ROTA_AGENDA,
        icon: CalendarDays,
        roles: OPERATION_REGISTRY_ROLES,
      }),
      navRoute({
        id: "operacao-demandas",
        label: "Demandas",
        href: ROTA_DEMANDAS,
        icon: ClipboardList,
        roles: OPERATION_REGISTRY_ROLES,
        tambem: [ROTA_DEMANDA, ROTA_NOVA_DEMANDA, ROTA_PLANEJAR],
      }),
      navRoute({
        id: "operacao-revisao",
        label: "Revisão",
        href: ROTA_REVISAO,
        icon: ClipboardCheck,
        roles: OPERATION_REGISTRY_ROLES,
      }),
      // Os relatórios da Operação (parte 4.8a): as OS do período, a equipe, os veículos e o portal, sem valor.
      navRoute({
        id: "operacao-relatorios",
        label: "Relatórios",
        href: ROTA_RELATORIOS,
        icon: BarChart3,
        roles: OPERATION_REGISTRY_ROLES,
      }),
      navRoute({
        id: "operacao-colaboradores",
        label: "Colaboradores",
        href: ROTA_COLABORADORES,
        icon: Users,
        roles: OPERATION_REGISTRY_ROLES,
      }),
      navRoute({
        id: "operacao-veiculos",
        label: "Veículos",
        href: ROTA_VEICULOS,
        icon: Truck,
        roles: OPERATION_REGISTRY_ROLES,
      }),
    ],
  }),
  // Relatórios virou item próprio (01/10/2026): é tela de uso real do
  // fechamento, não "uso raro".
  appModule({
    id: "reports",
    label: "Relatórios",
    audience: "internal",
    icon: BarChart3,
    roles: TOWER_NAV_ROLES,
    routes: [
      navRoute({
        id: "reports-hub",
        label: "Relatórios",
        href: "/reports",
        icon: BarChart3,
        roles: TOWER_NAV_ROLES,
      }),
    ],
  }),
  // O grupo "Mais" acabou: Relatórios virou item próprio e Documentos ficou
  // sozinho.
  appModule({
    id: "documents",
    label: "Documentos",
    audience: "internal",
    icon: FileText,
    roles: INTERNAL_ROLES,
    routes: [
      navRoute({
        id: "documents-library",
        label: "Documentos",
        href: "/documentos",
        icon: FileText,
        roles: INTERNAL_ROLES,
      }),
    ],
  }),
  appModule({
    id: "client-assistant",
    portal: "assistant",
    label: "Agent Dute",
    audience: "client",
    icon: BrainCircuit,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-assistant-chat",
        label: "Agent Dute",
        href: "/portal/agente",
        icon: BrainCircuit,
        roles: CLIENT_ROLES,
        exact: true,
      }),
    ],
  }),
  appModule({
    id: "client-home",
    portal: "home",
    label: "Início",
    audience: "client",
    icon: Home,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-home-overview",
        label: "Visão geral",
        href: "/portal",
        icon: LayoutDashboard,
        roles: CLIENT_ROLES,
        exact: true,
      }),
    ],
  }),
  appModule({
    id: "client-inventory",
    portal: "inventory",
    label: "Estoque",
    audience: "client",
    icon: PackageSearch,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-inventory-balances",
        label: "Estoque",
        href: "/portal/estoque",
        icon: PackageSearch,
        roles: CLIENT_ROLES,
      }),
    ],
  }),
  // Eventos: o que vai para cada evento que se repete; vira pedido no Estoque.
  appModule({
    id: "client-events",
    portal: "events",
    label: "Eventos",
    audience: "client",
    icon: CalendarDays,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-events-list",
        label: "Eventos",
        href: "/portal/eventos",
        icon: CalendarDays,
        roles: CLIENT_ROLES,
      }),
    ],
  }),
  // "Envios para a Dutelog": a Cristiane comprou, o fornecedor entrega no
  // armazém da Dutelog e ela avisa; o Rafael recebe e confere.
  appModule({
    id: "client-requests",
    portal: "requests",
    label: "Envios para a Dutelog",
    audience: "client",
    icon: Inbox,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-request-list",
        label: "Envios para a Dutelog",
        href: "/portal/recebimentos",
        icon: PackagePlus,
        roles: CLIENT_ROLES,
      }),
    ],
  }),
  appModule({
    id: "client-orders",
    portal: "orders",
    label: "Pedidos",
    audience: "client",
    icon: Truck,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-orders-deliveries",
        label: "Pedidos",
        href: "/portal/pedidos",
        icon: Truck,
        roles: CLIENT_ROLES,
      }),
    ],
  }),
  // As OS do cliente (parte 4.3b da Fase 4): só com a Operação no contrato.
  appModule({
    id: "client-services",
    portal: "services",
    label: "Minhas OS",
    audience: "client",
    icon: ClipboardList,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-services-list",
        label: "Minhas OS",
        href: "/portal/servicos",
        icon: ClipboardList,
        roles: CLIENT_ROLES,
      }),
    ],
  }),
  appModule({
    id: "client-invoices",
    portal: "invoices",
    label: "Faturas",
    audience: "client",
    icon: Receipt,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-invoices-list",
        label: "Faturas",
        href: "/portal/faturas",
        icon: Receipt,
        roles: CLIENT_ROLES,
      }),
    ],
  }),
  appModule({
    id: "client-documents",
    portal: "documents",
    label: "Documentos",
    audience: "client",
    icon: FileText,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-documents-library",
        label: "Documentos",
        href: "/portal/documentos",
        icon: FileText,
        roles: CLIENT_ROLES,
      }),
    ],
  }),
];

/**
 * Etapas da bancada WMS que saíram do menu mas continuam roteáveis como
 * deep link (atalhos salvos, links compartilhados entre operadores).
 */
export const WMS_DEEP_LINK_PATHS = [
  "/wms/receber",
  "/wms/pedidos",
  "/wms/contagem",
  "/wms/recebimento",
  "/wms/qualidade",
  "/wms/putaway",
  "/wms/picking",
  "/wms/packing",
  "/wms/expedicao",
  "/wms/devolucoes",
  "/wms/inventario",
  "/wms/excecoes",
  "/warehouse",
] as const;

const WMS_DEEP_LINK_APP_ROLES = Object.fromEntries(
  WMS_DEEP_LINK_PATHS.map((path) => [path, currentAppRolesFor(WMS_ROLES)]),
);

const WMS_DEEP_LINK_PROFILE_ROLES = Object.fromEntries(
  WMS_DEEP_LINK_PATHS.map((path) => [path, WMS_ROLES]),
);

/**
 * Abas das telas fundidas + rotas antigas que agora redirecionam para elas.
 * Precisam de entrada própria porque não constam como rota de menu.
 */
const MERGED_SCREEN_PATHS: Array<{ path: string; roles: ProfileRole[] }> = [
  // Telas antigas de Estoque, fora do menu mas com os mesmos acessos.
  { path: "/catalogo", roles: COORDINATION_NAV_ROLES },
  { path: "/movements", roles: COORDINATION_NAV_ROLES },
  // Triagem detalhada e histórico, abertos a partir da fila de Pedidos.
  { path: "/solicitacoes", roles: COORDINATION_NAV_ROLES },
  { path: "/orders", roles: COORDINATION_NAV_ROLES },
  // Painel do Agent Dute (notificações, riscos, memória), aberto pela tela
  // do agente e pelo Início.
  { path: "/agente/painel", roles: TOWER_NAV_ROLES },
  { path: "/agente/conhecimento", roles: TOWER_NAV_ROLES },
  { path: "/catalogo/saldos", roles: WMS_ROLES },
  { path: "/catalogo/mapa", roles: WMS_ROLES },
  { path: "/products", roles: WMS_ROLES },
  { path: "/skus", roles: WMS_ROLES },
  // Etiquetas de caixa e de posição para imprimir, abertas pela Contagem e por Posições.
  { path: "/estoque/etiquetas", roles: WMS_ROLES },
  { path: "/faturamento/tabela", roles: FINANCE_ROLES },
  // Fatura (prévia ou emitida) para imprimir/salvar PDF.
  { path: "/faturamento/fatura", roles: FINANCE_ROLES },
  { path: "/portal/faturas/fatura", roles: CLIENT_ROLES },
  // Extrato do período, aberto por "Gerar relatório" em Faturas.
  { path: "/portal/faturas/relatorio", roles: CLIENT_ROLES },
  // Endereços antigos do portal que redirecionam.
  { path: "/portal/solicitacoes", roles: CLIENT_ROLES },
  { path: "/portal/agente/operacional", roles: CLIENT_ROLES },
  { path: "/tabela-precos", roles: FINANCE_ROLES },
  // Configuração (tela própria, lib/settings-nav.ts). A Administração saiu do
  // menu e virou seção dela; os endereços antigos redirecionam com os mesmos
  // papéis de antes.
  { path: "/configuracoes", roles: ALL_ROLES },
  { path: "/configuracoes/conta", roles: ALL_ROLES },
  { path: "/configuracoes/aplicativo", roles: ALL_ROLES },
  { path: "/configuracoes/pessoas", roles: ACCESS_ADMIN_ROLES },
  // Clientes (cadastro, modelo de operação, sigla do SKU). O endereço antigo
  // da tela "Cliente BTG" redireciona.
  { path: "/configuracoes/clientes", roles: ACCESS_ADMIN_ROLES },
  { path: "/configuracoes/cliente", roles: ACCESS_ADMIN_ROLES },
  { path: "/configuracoes/sistema", roles: SUPPORT_ROLES },
  { path: "/usuarios", roles: ACCESS_ADMIN_ROLES },
  { path: "/clientes", roles: ACCESS_ADMIN_ROLES },
  { path: "/suporte", roles: SUPPORT_ROLES },
  // Montar orçamento, aberto pela fila do Comercial (?numero=).
  { path: ROTA_ORCAMENTO, roles: COMMERCIAL_ROLES },
  // O documento A4 do orçamento (prévia e PDF) e a aprovação, que é só do owner.
  { path: ROTA_DOCUMENTO, roles: COMMERCIAL_ROLES },
  { path: ROTA_APROVAR, roles: [...APROVADOR_ROLES] },
  // A ficha da demanda na Operação, aberta pela lista (?numero=), e a nova demanda direta.
  { path: ROTA_DEMANDA, roles: OPERATION_REGISTRY_ROLES },
  { path: ROTA_NOVA_DEMANDA, roles: OPERATION_REGISTRY_ROLES },
  { path: ROTA_PLANEJAR, roles: OPERATION_REGISTRY_ROLES },
  // A ficha da OS, aberta pela Agenda, pela demanda e pelo Hoje (?numero=).
  { path: ROTA_OS, roles: OPERATION_REGISTRY_ROLES },
  { path: ROTA_OS_IMPRESSAO, roles: OPERATION_REGISTRY_ROLES },
  // A via comercial da NF (parte 4.2d): tem valor, só quem fatura.
  { path: ROTA_NF, roles: FINANCE_ROLES },
  { path: ROTA_REVISAO, roles: OPERATION_REGISTRY_ROLES },
  // O app do campo (parte 3.8b): Minhas OS e a OS no celular.
  { path: ROTA_CAMPO, roles: [...CAMPO_ROLES] },
  { path: ROTA_CAMPO_OS, roles: [...CAMPO_ROLES] },
  { path: ROTA_CAMPO_CONCLUIR, roles: [...CAMPO_ROLES] },
  // A TV da sala (parte 3.12b): o painel e quem coordena.
  { path: ROTA_TV, roles: [...TV_ROLES] },
];

const MERGED_SCREEN_APP_ROLES = Object.fromEntries(
  MERGED_SCREEN_PATHS.map(({ path, roles }) => [path, currentAppRolesFor(roles)]),
);

const MERGED_SCREEN_PROFILE_ROLES = Object.fromEntries(
  MERGED_SCREEN_PATHS.map(({ path, roles }) => [path, roles]),
);

const ROUTE_APP_ROLES = APP_MODULES.reduce<Record<string, CurrentAppRole[]>>(
  (acc, module) => {
    module.routes.forEach((route) => {
      if (route.href) {
        acc[normalizePath(route.href)] = route.appRoles;
      }
    });
    return acc;
  },
  {
    ...WMS_DEEP_LINK_APP_ROLES,
    ...MERGED_SCREEN_APP_ROLES,
    "/wms": currentAppRolesFor(WMS_ROLES),
    "/minhas-faturas": ["cliente"],
  },
);

const ROUTE_PROFILE_ROLES = APP_MODULES.reduce<Record<string, ProfileRole[]>>(
  (acc, module) => {
    module.routes.forEach((route) => {
      if (route.href) {
        acc[normalizePath(route.href)] = route.roles;
      }
    });
    return acc;
  },
  {
    ...WMS_DEEP_LINK_PROFILE_ROLES,
    ...MERGED_SCREEN_PROFILE_ROLES,
    "/wms": WMS_ROLES,
    "/minhas-faturas": ["cliente"],
  },
);

export function normalizePath(path: string): string {
  const [withoutHash] = path.split("#");
  const [withoutQuery] = withoutHash.split("?");
  return withoutQuery || "/";
}

export function getHomePathForAppRole(role: AppRole | null | undefined) {
  return role === "cliente" ? "/portal" : "/dashboard";
}

/**
 * Aterrissagem por papel do perfil: cada pessoa cai na tela onde trabalha,
 * não num dashboard genérico. O operador WMS abre a fila de Pedidos (separar
 * e entregar); o financeiro, a competência do mês.
 */
export function getHomePathForProfile(
  role: ProfileRole | null | undefined,
  comercial: boolean = COMERCIAL_LIBERADO,
  financeiro: boolean = FINANCEIRO_LIBERADO,
) {
  if (role === "cliente") return "/portal";
  if (role === "wms") return "/pedidos";
  // O financeiro abre no módulo dele onde o Financeiro está liberado.
  if (role === "financeiro") return abreFinanceiro(role, financeiro) ? ROTA_FINANCEIRO : "/faturamento";
  // O comercial abre no módulo dele onde o Comercial está liberado.
  if (role === "comercial" && abreComercial(role, comercial)) return ROTA_COMERCIAL;
  // Papel da plataforma sem tela ainda: a Conta, que todo perfil abre. Sem
  // isso o Início negado devolveria a "/" em laço.
  if (role && !INTERNAL_ROLES.includes(role)) return "/configuracoes/conta";
  return "/dashboard";
}

export function getRouteAppRoles(path: string): AppRole[] {
  return ROUTE_APP_ROLES[normalizePath(path)] ?? ["interno"];
}

export function getRouteProfileRoles(path: string): ProfileRole[] {
  return ROUTE_PROFILE_ROLES[normalizePath(path)] ?? INTERNAL_ROLES;
}

/** Se a rota tem papéis próprios, sem cair no padrão interno acima. */
export function hasRouteRoles(path: string): boolean {
  return Object.hasOwn(ROUTE_PROFILE_ROLES, normalizePath(path));
}

export function getNavigationForAppRole(
  role: CurrentAppRole | null | undefined,
): AppModule[] {
  const appRole = role ?? "interno";
  return APP_MODULES.filter(
    (module) => (module.ambiente ?? "wms") === "wms" && module.appRoles.includes(appRole),
  );
}

/**
 * Menu de um ambiente. O WMS é o menu de hoje (Início, Pedidos, Estoque,
 * Faturamento e o portal). O Comercial só entra no ambiente dele, e só com
 * a liberação. No portal, o perfil de operação esconde o que o modelo não
 * tem; sem perfil (área interna, ou ainda carregando) nada disso é escondido.
 */
function navigationForAmbiente(
  ambiente: "wms" | "comercial" | "operacao" | "financeiro",
  role: ProfileRole | null | undefined,
  operation: OperationProfile | null | undefined,
  comercial: boolean,
  operacao: boolean = OPERACAO_LIBERADO,
  financeiro: boolean = FINANCEIRO_LIBERADO,
): AppModule[] {
  const appRole = appRoleForProfile(role) ?? "interno";
  const portalModules = appRole === "cliente" ? portalModulesFor(operation) : null;

  return APP_MODULES.filter(
    (module) =>
      (module.ambiente ?? "wms") === ambiente &&
      module.appRoles.includes(appRole) &&
      canAccessModule(role, module.roles) &&
      (module.liberacao !== "comercial" || abreComercial(role, comercial)) &&
      (module.liberacao !== "operacao" || abreOperacao(role, operacao)) &&
      (module.liberacao !== "financeiro" || abreFinanceiro(role, financeiro)) &&
      (portalModules === null || !module.portal || portalModules.includes(module.portal)),
  )
    .map((module) => {
      const routes = module.routes.filter((route) =>
        canAccessModule(role, route.roles),
      );
      // Um grupo que o papel reduziu a uma tela só vira o link dessa tela:
      // o operador WMS vê "Documentos", não um "Mais" com um item dentro.
      if (module.routes.length > 1 && routes.length === 1) {
        const [only] = routes;
        return { ...module, label: only.label, icon: only.icon, routes };
      }
      return { ...module, routes };
    })
    .filter((module) => module.routes.length > 0);
}

/**
 * Menu do WMS e do portal. Não inclui o Comercial: ele tem shell próprio.
 * O terceiro argumento permanece para os chamadores de antes; a liberação
 * não põe o Comercial neste menu.
 */
export function getNavigationForProfileRole(
  role: ProfileRole | null | undefined,
  operation?: OperationProfile | null,
  comercial: boolean = COMERCIAL_LIBERADO,
  financeiro: boolean = FINANCEIRO_LIBERADO,
): AppModule[] {
  const menu = navigationForAmbiente("wms", role, operation, comercial);
  // O financeiro tem um módulo só e por isso não tem seletor: no menu do WMS,
  // logo antes do Faturamento da armazenagem, um item leva de volta ao
  // Financeiro.
  if (role !== "financeiro" || !abreFinanceiro(role, financeiro)) return menu;
  const posicao = menu.findIndex((module) => module.id === "billing");
  return posicao === -1 ? [...menu, VOLTA_AO_FINANCEIRO] : [...menu.slice(0, posicao), VOLTA_AO_FINANCEIRO, ...menu.slice(posicao)];
}

/** O link do menu do WMS para o shell do Financeiro. Fora de APP_MODULES: a rota já tem os papéis dela. */
const VOLTA_AO_FINANCEIRO: AppModule = appModule({
  id: "financeiro-volta",
  label: "Financeiro",
  audience: "internal",
  icon: Banknote,
  roles: ["financeiro"],
  routes: [navRoute({ id: "financeiro-volta-inicio", label: "Financeiro", href: ROTA_FINANCEIRO, icon: Banknote, roles: ["financeiro"] })],
});

/**
 * Funcionalidades do Comercial, uma por tela, para o menu do ambiente.
 * Fora da liberação, ou para quem não abre o módulo, a lista é vazia.
 * A aprovação e o documento do orçamento acendem Orçamentos; não são itens.
 */
export function menuDoComercial(
  role: ProfileRole | null | undefined,
  comercial: boolean = COMERCIAL_LIBERADO,
): AppModule[] {
  const [grupo] = navigationForAmbiente("comercial", role, null, comercial);
  if (!grupo) return [];
  return grupo.routes.flatMap((route) => {
    if (!route.href) return [];
    return [
      {
        id: route.id,
        label: route.label,
        audience: grupo.audience,
        href: route.href,
        icon: route.icon,
        roles: route.roles,
        appRoles: route.appRoles,
        ambiente: "comercial" as const,
        routes: [route],
      },
    ];
  });
}

/** Hoje, colaboradores e veículos, uma tela por item. Fora da liberação, a lista é vazia. */
export function menuDoOperacao(
  role: ProfileRole | null | undefined,
  operacao: boolean = OPERACAO_LIBERADO,
): AppModule[] {
  const [grupo] = navigationForAmbiente("operacao", role, null, false, operacao);
  if (!grupo) return [];
  return grupo.routes.flatMap((route) => {
    if (!route.href) return [];
    return [
      {
        id: route.id,
        label: route.label,
        audience: grupo.audience,
        href: route.href,
        icon: route.icon,
        roles: route.roles,
        appRoles: route.appRoles,
        ambiente: "operacao" as const,
        routes: [route],
      },
    ];
  });
}

/**
 * Início, A faturar e a cobrança (A receber, Vencidos, Pagos e Faturas), uma
 * tela por item, e o Faturamento da armazenagem, que continua no shell do WMS
 * até a Fase 7. Fora da liberação, a lista é vazia.
 */
export function menuDoFinanceiro(
  role: ProfileRole | null | undefined,
  financeiro: boolean = FINANCEIRO_LIBERADO,
): AppModule[] {
  const [grupo] = navigationForAmbiente("financeiro", role, null, false, false, financeiro);
  if (!grupo) return [];
  const telas = grupo.routes.flatMap((route) => {
    if (!route.href) return [];
    return [
      {
        id: route.id,
        label: route.label,
        audience: grupo.audience,
        href: route.href,
        icon: route.icon,
        roles: route.roles,
        appRoles: route.appRoles,
        ambiente: "financeiro" as const,
        routes: [route],
      },
    ];
  });
  const armazenagem = navRoute({ id: "financeiro-armazenagem", label: "Armazenagem", href: ROTA_FATURAMENTO_WMS, icon: Boxes, roles: FINANCE_ROLES });
  return [
    ...telas,
    {
      id: armazenagem.id,
      label: armazenagem.label,
      audience: grupo.audience,
      href: armazenagem.href,
      icon: armazenagem.icon,
      roles: armazenagem.roles,
      appRoles: armazenagem.appRoles,
      ambiente: "financeiro" as const,
      routes: [armazenagem],
    },
  ];
}

/**
 * Barra inferior do celular: até quatro destinos fixos (Início, Pedidos,
 * Estoque, Agent Dute, nesta ordem) e "Mais" com o resto. Papéis que não
 * têm todos os quatro completam a barra com os próximos itens do menu.
 * As telas secundárias de um destino da barra (Receber, dentro de Estoque)
 * ficam em "Mais".
 */
export type MobileNavigation = {
  bar: AppModule[];
  more: Array<{ module: AppModule; routes: ModuleRoute[] }>;
};

const MOBILE_BAR_PRIORITY = [
  "home",
  "client-home",
  "orders",
  "client-orders",
  "inventory",
  "client-inventory",
  "agent",
  "client-assistant",
];

export const MOBILE_BAR_SLOTS = 4;

/**
 * A barra do celular nos shells v3 de módulo (docs/mockups/ModCelularCom.dc.html
 * e ModCelularOp.dc.html): três telas e "Mais", para o rótulo caber inteiro.
 */
export const MOBILE_BAR_SLOTS_DO_MODULO = 3;

export function getMobileNavigation(modules: AppModule[], slots: number = MOBILE_BAR_SLOTS): MobileNavigation {
  const enabled = modules.filter(isModuleEnabled);
  const bar: AppModule[] = [];
  for (const id of MOBILE_BAR_PRIORITY) {
    const match = enabled.find((module) => module.id === id);
    if (match && bar.length < slots) bar.push(match);
  }
  for (const module of enabled) {
    if (bar.length >= slots) break;
    if (!bar.includes(module)) bar.push(module);
  }
  const more: MobileNavigation["more"] = [];
  for (const module of modules) {
    if (bar.includes(module)) {
      const routes = module.routes.filter(
        (route) => route.href && route.href !== module.href,
      );
      if (routes.length) more.push({ module, routes });
    } else {
      more.push({ module, routes: module.routes });
    }
  }
  return { bar, more };
}

export function isModuleEnabled(module: AppModule): boolean {
  return Boolean(module.href);
}

/** O menu mostra o módulo como grupo (com as telas dentro) ou como o link de uma tela. */
export function isModuleGroup(module: AppModule): boolean {
  return Boolean(module.group) || module.routes.filter((route) => route.href).length > 1;
}

export function isRouteActive(
  currentPath: string,
  href: string,
  exact = false,
): boolean {
  const current = normalizePath(currentPath);
  const target = normalizePath(href);

  if (exact) return current === target;
  return current === target || current.startsWith(`${target}/`);
}

/**
 * O item do menu está aceso: a rota dele (exata ou com as filhas) ou uma das
 * telas fora do menu que são dele (`tambem`, sempre exatas).
 */
export function isNavRouteActive(
  currentPath: string,
  route: Pick<ModuleRoute, "href" | "exact" | "tambem">,
): boolean {
  if (!route.href) return false;
  return (
    isRouteActive(currentPath, route.href, route.exact) ||
    (route.tambem ?? []).some((href) => isRouteActive(currentPath, href, true))
  );
}

/** Telas fora do menu que pertencem a um item dele. */
const ACTIVE_ALIASES: Record<string, string> = {
  "/solicitacoes": "/pedidos",
  "/orders": "/pedidos",
  "/wms/pedidos": "/pedidos",
  "/wms": "/estoque",
  "/wms/contagem": "/estoque",
  "/catalogo": "/estoque",
  "/catalogo/saldos": "/estoque",
  "/catalogo/mapa": "/estoque",
  "/movements": "/estoque",
};

/** Módulo do portal a que uma rota pertence (/portal/eventos → events). */
export function portalModuleForPath(path: string): PortalModuleKey | null {
  const normalized = normalizePath(path);
  for (const module of APP_MODULES) {
    if (module.audience !== "client" || !module.portal) continue;
    if (
      module.routes.some(
        (route) => route.href && isRouteActive(normalized, route.href, route.exact),
      )
    ) {
      return module.portal;
    }
  }
  return null;
}

/** Telas da Configuração: não pertencem a nenhum item do menu. */
export function isAccountPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "/configuracoes" || normalized.startsWith("/configuracoes/");
}

export function getActiveModule(
  modules: AppModule[],
  path: string,
): AppModule {
  const normalized = normalizePath(path);
  // Etapas da bancada fora do menu (/wms/qualidade, /wms/putaway...) são
  // parte do Estoque.
  const currentPath =
    ACTIVE_ALIASES[normalized] ??
    (normalized.startsWith("/wms/") ? "/estoque" : path);
  // A mesma regra do menu: a rota do item e as telas dele (`tambem`).
  const exactMatch = modules.find((module) =>
    module.routes.some((route) => isNavRouteActive(currentPath, route)),
  );
  if (exactMatch) return exactMatch;

  // Telas fora do menu (ex.: /wms/contagem, /wms/qualidade) destacam o grupo
  // da rota-mãe mais específica.
  let prefixMatch: AppModule | undefined;
  let prefixLength = 0;
  for (const module of modules) {
    for (const route of module.routes) {
      if (
        route.href &&
        route.href.length > prefixLength &&
        isRouteActive(currentPath, route.href)
      ) {
        prefixMatch = module;
        prefixLength = route.href.length;
      }
    }
  }

  return prefixMatch ?? modules.find(isModuleEnabled) ?? modules[0];
}
