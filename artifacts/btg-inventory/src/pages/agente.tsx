import { BookOpen, LayoutDashboard } from "lucide-react";
import { Link } from "wouter";

import { AgentScreen } from "@/components/agent/agent-screen";
import { TEAM_AGENT_PATH, teamSuggestions } from "@/lib/agent-chat";
import { useAppUser } from "@/lib/auth";
import { canAccessModule, getRouteProfileRoles } from "@/lib/modules";

/**
 * Agent Dute da equipe Dutelog: a mesma tela do portal, com sugestões do
 * papel. O painel (notificações, riscos, memória) e o Conhecimento ficam a
 * um clique, para quem tem acesso a eles.
 */
export default function AgentePage() {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  const links = [
    { href: "/agente/painel", label: "Painel", icon: LayoutDashboard },
    { href: "/agente/conhecimento", label: "Conhecimento", icon: BookOpen },
  ].filter((link) => canAccessModule(role, getRouteProfileRoles(link.href)));
  return (
    <AgentScreen
      basePath={TEAM_AGENT_PATH}
      suggestions={teamSuggestions(role)}
      intro={
        role === "wms"
          ? "Eu consulto o estoque, os pedidos e as movimentações do cliente, em tempo real."
          : "Eu consulto o estoque, os pedidos, as movimentações, as faturas e os documentos do cliente, em tempo real."
      }
      placeholder={role === "wms" ? "Pergunte sobre pedidos, saldos ou movimentações…" : "Pergunte sobre estoque, pedidos, movimentações ou faturas…"}
      actions={links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground/75 hover:bg-muted"
        >
          <Icon className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{label}</span>
          <span className="sr-only sm:hidden">{label}</span>
        </Link>
      ))}
    />
  );
}
