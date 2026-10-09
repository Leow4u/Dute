import { MessageCircle } from "lucide-react";
import { Link, useLocation } from "wouter";

import { TEAM_AGENT_PATH, isAgentScreen } from "@/lib/agent-chat";
import { useAppUser } from "@/lib/auth";
import { canAccessModule, getRouteProfileRoles } from "@/lib/modules";

/**
 * Atalho para o Agent Dute em toda tela da equipe: abre a mesma conversa em
 * tela inteira do menu (antes abria um painel lateral com outra conversa).
 * O operador WMS usa o item do menu: o botão cobriria a bancada no tablet.
 */
export function AgentDock() {
  const { user } = useAppUser();
  const [location] = useLocation();
  const role = user?.publicMetadata.role;

  if (role === "wms" || isAgentScreen(location)) return null;
  if (!canAccessModule(role, getRouteProfileRoles(TEAM_AGENT_PATH))) return null;

  return (
    <Link
      href={TEAM_AGENT_PATH}
      className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-background transition-transform duration-200 hover:-translate-y-0.5 md:bottom-8 md:right-8"
    >
      <MessageCircle className="size-5" aria-hidden="true" />
      <span className="hidden sm:inline">Perguntar ao Agent Dute</span>
      <span className="sr-only sm:hidden">Perguntar ao Agent Dute</span>
    </Link>
  );
}
