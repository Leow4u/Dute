import type { NotaDoAgente } from "./cliente";

/**
 * De onde veio a anotação para aprovar, como o Conhecimento e o painel do
 * Agent Dute mostram: de quem era a conversa (o primeiro nome) e o dia.
 */

const DIA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

function dia(iso: string | null): string {
  const data = iso ? new Date(iso) : null;
  return data && !Number.isNaN(data.getTime()) ? DIA.format(data) : "";
}

export function origemDaNota(nota: Pick<NotaDoAgente, "suggested_by_name" | "suggested_by_role" | "created_at">): string {
  const conversa = nota.suggested_by_role === "cliente" ? "Na conversa de" : "Na conversa da equipe com";
  const nome = nota.suggested_by_name?.trim().split(/\s+/)[0] ?? "";
  return [nome ? `${conversa} ${nome}` : "", dia(nota.created_at)].filter(Boolean).join(" · ");
}
