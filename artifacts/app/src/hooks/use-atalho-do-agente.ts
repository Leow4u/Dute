import { useEffect } from "react";
import { useLocation } from "wouter";

import { agentPathFor, isAgentShortcut } from "@/lib/agent-chat";
import type { ProfileRole } from "@/lib/modules";

/**
 * "/": vai para o campo do Agent Dute da tela (barra do Início ou o chat);
 * nas outras telas, abre o Agent Dute do papel. Vale no shell da
 * Armazenagem e no portal.
 */
export function useAtalhoDoAgente(role: ProfileRole | null | undefined): void {
  const [, navigate] = useLocation();
  const agentPath = agentPathFor(role);
  useEffect(() => {
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
