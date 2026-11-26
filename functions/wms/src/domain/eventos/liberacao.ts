import { HttpsError } from "firebase-functions/https";

/**
 * Liberação por ambiente dos Eventos do portal, do portal ao histórico
 * (docs/superpowers/specs/2026-11-26-eventos-design.md, "Liberação por ambiente
 * e o legado"). Toda callable nova dos Eventos chama assertEventosLiberado logo
 * depois do gate de papel. As três callables do legado (client_event_templates)
 * não passam por ela e saem na parte 12.
 */

/**
 * Onde as callables dos Eventos atendem: só a homologação, até a parte 12,
 * quando o dute-prod entra com o OK do Leonardo; o dute-btg fica de fora.
 * Cópia de EVENTOS_AMBIENTES_LIBERADOS do app (lib/liberacao.ts), travada pelo
 * platform-lists.test.ts do app.
 */
export const EVENTOS_PROJECTS = ["dute-homolog"];

export function eventosLiberado(projectId: string | undefined): boolean {
  return !!projectId && EVENTOS_PROJECTS.includes(projectId);
}

/** Fora da liberação, a callable recusa antes de ler ou gravar qualquer coisa. */
export function assertEventosLiberado(projectId: string | undefined): void {
  if (eventosLiberado(projectId)) return;
  throw new HttpsError("failed-precondition", "Eventos ainda não liberados neste ambiente.");
}
