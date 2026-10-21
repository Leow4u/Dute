import {
  APP_MODULES,
  isRouteActive,
  normalizePath,
  type AppModule,
} from "./modules";
import { SETTINGS_ROOT, SETTINGS_SECTIONS } from "./settings-nav";

/** Marca da aba. O cliente ativo não entra aqui: ele muda no seletor. */
export const APP_DOCUMENT_TITLE = "Dutelog";

type TitleRule = {
  path: string;
  label: string;
  exact?: boolean;
};

/**
 * Telas fora do menu, com o nome do cabeçalho. O caminho mais longo ganha,
 * então Etiquetas fica dentro de /estoque.
 */
const EXTRA_RULES: TitleRule[] = [
  { path: "/sign-in", label: "Entrar" },
  { path: "/convite", label: "Aceitar convite" },
  { path: "/sign-up", label: "Aceitar convite" },
  { path: "/estoque/etiquetas", label: "Etiquetas" },
  { path: "/wms/qualidade", label: "Qualidade" },
  { path: "/wms/devolucoes", label: "Devoluções" },
  { path: "/faturamento/fatura", label: "Fatura" },
  { path: "/portal/faturas/fatura", label: "Fatura" },
  { path: "/portal/faturas/relatorio", label: "Relatório" },
  { path: "/agente/conhecimento", label: "Conhecimento" },
  { path: "/solicitacoes", label: "Solicitações" },
  { path: "/movements", label: "Histórico de movimentos" },
  { path: "/catalogo", label: "Produtos", exact: true },
  { path: "/catalogo/saldos", label: "SKUs e saldos" },
  { path: SETTINGS_ROOT, label: "Minha conta", exact: true },
  ...SETTINGS_SECTIONS.map((section) => ({
    path: section.href,
    label: section.label,
    exact: true,
  })),
];

/**
 * Endereço antigo que ainda abre, apontando para a tela de hoje. O rótulo
 * da rota própria ganha quando existe; isto cobre o que só redireciona.
 */
const PATH_ALIASES: Record<string, string> = {
  "/solicitacoes": "/pedidos",
  "/orders": "/pedidos",
  "/wms/pedidos": "/pedidos",
  "/wms": "/estoque",
  "/catalogo/mapa": "/estoque/mapa",
  "/warehouse": "/estoque/mapa",
  "/products": "/catalogo",
  "/skus": "/catalogo/saldos",
  "/wms/recebimento": "/wms/receber",
  "/wms/inventario": "/wms/contagem",
  "/wms/putaway": "/wms/receber",
  "/wms/picking": "/pedidos",
  "/wms/packing": "/pedidos",
  "/wms/expedicao": "/pedidos",
  "/wms/excecoes": "/pedidos",
  "/portal/solicitacoes": "/portal/recebimentos",
  "/portal/agente/operacional": "/portal/agente",
  "/minhas-faturas": "/portal/faturas",
  "/tabela-precos": "/faturamento",
  "/usuarios": "/configuracoes/pessoas",
  "/clientes": "/configuracoes/clientes",
  "/configuracoes/cliente": "/configuracoes/clientes",
  "/suporte": "/configuracoes/sistema",
};

function rulesFromModules(modules: AppModule[]): TitleRule[] {
  const rules: TitleRule[] = [];
  for (const module of modules) {
    for (const route of module.routes) {
      if (!route.href) continue;
      rules.push({
        path: route.href,
        // A tela principal do grupo usa o nome do grupo: Estoque, Início, Pedidos.
        label: route.href === module.href ? module.label : route.label,
        exact: route.exact,
      });
    }
  }
  return rules;
}

const TITLE_RULES: TitleRule[] = [
  ...rulesFromModules(APP_MODULES),
  ...EXTRA_RULES,
];

function cleanPath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized.length > 1 && normalized.endsWith("/")) {
    return normalized.replace(/\/+$/, "");
  }
  return normalized || "/";
}

function matchLabel(path: string): string | null {
  let best: { label: string; length: number } | undefined;
  for (const rule of TITLE_RULES) {
    if (!isRouteActive(path, rule.path, rule.exact)) continue;
    const length = normalizePath(rule.path).length;
    if (!best || length > best.length) best = { label: rule.label, length };
  }
  return best?.label ?? null;
}

function screenLabel(path: string, depth = 0): string | null {
  if (depth > 4) return null;
  const label = matchLabel(path);
  if (label) return label;
  const alias = PATH_ALIASES[path];
  if (alias && alias !== path) return screenLabel(cleanPath(alias), depth + 1);
  return null;
}

/** Título da aba para o caminho atual. Sem tela conhecida, só a marca. */
export function documentTitleForPath(path: string): string {
  const label = screenLabel(cleanPath(path));
  return label ? `${APP_DOCUMENT_TITLE} | ${label}` : APP_DOCUMENT_TITLE;
}
