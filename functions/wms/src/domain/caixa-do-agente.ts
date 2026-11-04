import { CORE_AGENT_PROJECTS } from "./agent-routines.js";

/**
 * A caixa antiga do Agent Dute (`ai_agent_inbox`): o evento de atenção ou
 * crítico e a ação "tratar documento" abriam ali um aviso, que só o painel
 * antigo do agente listava, com "Resolver".
 *
 * Onde o agente do núcleo roda (CORE_AGENT_PROJECTS, a cópia travada de
 * AGENTE_AMBIENTES_LIBERADOS), o painel é o novo (proposta aprovada pelo
 * Leonardo em 04/11/2026, docs/plataforma/fase-5-memoria.md): ele não lê a
 * caixa, e o que precisa de alguém está no "Precisa de você" de cada módulo.
 * Lá o aviso não abre mais; o evento continua em `events`, como sempre. Fora
 * dele (o dute-btg congelado), nada muda.
 */
export function abreAvisoNaCaixaAntiga(projectId: string | undefined): boolean {
  return !(projectId && CORE_AGENT_PROJECTS.includes(projectId));
}
