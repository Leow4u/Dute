import { BookOpen, LayoutDashboard } from "lucide-react";
import { Link } from "wouter";

import { AgentScreen } from "@/components/agent/agent-screen";
import { TEAM_AGENT_PATH, teamSuggestions } from "@/lib/agent-chat";
import { ProvedorDoAgente } from "@/lib/agente/contexto";
import { abreAgenteDoNucleo } from "@/lib/agente/navegacao";
import { useAppUser } from "@/lib/auth";
import { canAccessModule, getRouteProfileRoles } from "@/lib/modules";

import { useAgenteDoClienteAtivo } from "./agente-do-modulo";

/**
 * Agent Dute da equipe Dutelog: a mesma tela do portal, com sugestões do
 * papel. O painel (notificações, riscos, memória) e o Conhecimento ficam a
 * um clique, para quem tem acesso a eles. Onde o agente do núcleo está
 * liberado (parte 5.5j), a conversa é com ele, na Armazenagem e no cliente
 * ativo.
 */
const INTRO = {
  wms: "Eu consulto as tarefas do armazém, os recebimentos, os endereços e o estoque, em tempo real.",
  financeiro: "Eu consulto a prévia do mês, as faturas, os pedidos e o estoque, em tempo real.",
  coordenacao: "Eu consulto a fila de solicitações, os recebimentos, o armazém, o estoque, as faturas e o histórico, em tempo real.",
};

const PLACEHOLDER = {
  wms: "Pergunte sobre tarefas, recebimentos ou onde está um item…",
  financeiro: "Pergunte sobre a prévia do mês, faturas ou pedidos…",
  coordenacao: "Pergunte sobre solicitações, recebimentos, armazém ou estoque…",
};

export default function AgentePage() {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  const doNucleo = abreAgenteDoNucleo(role);
  const nucleo = useAgenteDoClienteAtivo("wms", doNucleo);
  const links = [
    { href: "/agente/painel", label: "Painel", icon: LayoutDashboard },
    { href: "/agente/conhecimento", label: "Conhecimento", icon: BookOpen },
  ].filter((link) => canAccessModule(role, getRouteProfileRoles(link.href)));
  const tela = (
    <AgentScreen
      basePath={TEAM_AGENT_PATH}
      suggestions={teamSuggestions(role)}
      intro={INTRO[role === "wms" || role === "financeiro" ? role : "coordenacao"]}
      placeholder={PLACEHOLDER[role === "wms" || role === "financeiro" ? role : "coordenacao"]}
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
  return doNucleo ? <ProvedorDoAgente cliente={nucleo}>{tela}</ProvedorDoAgente> : tela;
}
