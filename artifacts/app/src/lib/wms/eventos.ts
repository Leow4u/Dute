/**
 * Os Eventos do portal, do portal ao histórico
 * (docs/superpowers/specs/2026-11-26-eventos-design.md): as callables do WMS
 * (functions/wms, domain/eventos/). A lista é travada contra o index.ts em
 * platform-lists.test.ts: cada uma existe numa linha e confere a liberação.
 */

export const CALLABLES_DOS_EVENTOS = ["saveEventEdition", "sendEventEdition", "cancelEventEdition", "archiveClientEvent"] as const;
export type CallableDosEventos = (typeof CALLABLES_DOS_EVENTOS)[number];
