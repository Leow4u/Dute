import { useEffect } from "react";
import { useLocation } from "wouter";

import { agentPathFor, isAgentShortcut } from "@/lib/agent-chat";
import type { ProfileRole } from "@/lib/modules";

/**
 * "/": vai para o campo do Agent Dute da tela (barra do Início ou o chat);
 * nas outras telas, abre o Agent Dute do papel. Vale no shell da
 * Armazenagem, no portal e, com a liberação do agente do núcleo, nos shells
 * dos módulos (parte 5.5j), que passam a rota deles. Sem rota, não há atalho.
 */
export function useAtalhoDoAgente(role: ProfileRole | null | undefined, destino?: string | null): void {
  const [, navigate] = useLocation();
  const agentPath = destino === undefined ? agentPathFor(role) : destino;
  useEffect(() => {
    if (!agentPath) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = isAgentShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        target: event.target as HTMLElement | null,
      });
      if (!shortcut) return;
      event.preventDefault();
      const field = document.querySelector<HTMLElement>("[data-agent-input]");
      if (field) field.focus();
      else navigate(agentPath);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [agentPath, navigate]);
}
