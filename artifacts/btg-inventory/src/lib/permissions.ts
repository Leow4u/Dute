/**
 * Espelho client-side dos gates de papel das Cloud Functions.
 * A fonte da verdade continua no servidor (requireCatalogWrite,
 * requireOperationsCoordinator em functions/src/index.ts) — aqui só
 * decidimos o que EXIBIR: botão que o papel não pode executar não aparece,
 * em vez de falhar depois do formulário preenchido.
 */
import type { ProfileRole } from "./modules";

/** requireCatalogWrite: criar/editar/arquivar produtos e SKUs. */
const CATALOG_WRITE_ROLES: ReadonlySet<ProfileRole> = new Set([
  "owner",
  "admin",
  "interno",
]);

/** requireOperationsCoordinator: aprovar/rejeitar solicitações do cliente. */
const REQUEST_DECISION_ROLES: ReadonlySet<ProfileRole> = new Set([
  "owner",
  "admin",
  "interno",
]);

/** requireWarehouseWrite: foto em item já cadastrado (addCatalogPhotos). */
const ITEM_PHOTO_ROLES: ReadonlySet<ProfileRole> = new Set([
  "owner",
  "admin",
  "interno",
  "wms",
]);

export function canAddItemPhotos(role: ProfileRole | null | undefined) {
  return Boolean(role && ITEM_PHOTO_ROLES.has(role));
}

export function canWriteCatalog(role: ProfileRole | null | undefined) {
  return Boolean(role && CATALOG_WRITE_ROLES.has(role));
}

export function canDecideRequests(role: ProfileRole | null | undefined) {
  return Boolean(role && REQUEST_DECISION_ROLES.has(role));
}

/**
 * Extrai a mensagem real do servidor de um erro de API. As Cloud Functions
 * respondem com { message } em pt-BR (ex.: "Ação permitida somente para
 * administração ou coordenação operacional.") — descartá-la e mostrar
 * "Erro ao salvar" esconde do usuário o motivo da recusa.
 */
export function humanApiError(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object") {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      // ApiError.message vem como "HTTP 403 Forbidden: <texto do servidor>".
      const detail = message.replace(/^HTTP \d+[^:]*:\s*/, "").trim();
      if (detail && !/^HTTP \d+/.test(detail)) return detail;
    }
  }
  return fallback;
}
