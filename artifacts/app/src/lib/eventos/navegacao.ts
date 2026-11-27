/**
 * As rotas do portal dos Eventos (docs/superpowers/plans/2026-11-26-eventos.md,
 * "Rotas do app"): a lista, o formulário da edição nova e o da edição pelo
 * id, e o Estoque montando o evento (parte 5).
 */

export const ROTA_EVENTOS = "/portal/eventos";
export const ROTA_NOVO_EVENTO = "/portal/eventos/novo";
export const ROTA_DA_EDICAO = "/portal/eventos/edicao";

export function hrefDaEdicao(id: string): string {
  return `${ROTA_DA_EDICAO}?id=${encodeURIComponent(id)}`;
}

function parametro(busca: string, nome: string): string | null {
  const valor = new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca).get(nome)?.trim();
  return valor || null;
}

/** O `?id=` da edição. */
export function idDaEdicaoNaBusca(busca: string): string | null {
  return parametro(busca, "id");
}

/** O `?evento=` do formulário novo: a nova edição de um evento que já existe. */
export function eventoDaBusca(busca: string): string | null {
  return parametro(busca, "evento");
}

export function hrefDoEstoqueDoEvento(id: string): string {
  return `/portal/estoque?evento=${encodeURIComponent(id)}`;
}

export function hrefDoNovoDoEvento(eventId: string): string {
  return `${ROTA_NOVO_EVENTO}?evento=${encodeURIComponent(eventId)}`;
}
