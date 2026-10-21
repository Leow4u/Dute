/**
 * Estágio do cadastro em `customers`: prospect ou cliente
 * (docs/plataforma/fase-6-comercial.md, "Prospect").
 *
 * Cópia literal de `text`, `customerStage` e `isProspect` de
 * functions/wms/src/domain/customer-profile.ts (parte 5): as codebases não
 * importam umas das outras. O teste cadastro-estagio.test.ts lê o arquivo do
 * WMS e trava as funções e a lista.
 */

export const CUSTOMER_STAGES = ["prospect", "cliente"] as const;
export type CustomerStage = (typeof CUSTOMER_STAGES)[number];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

/** Leitura tolerante do estágio: sem o campo (a BTG e os cadastros de hoje), cliente. */
export function customerStage(value: unknown): CustomerStage {
  return text(value).toLowerCase() === "prospect" ? "prospect" : "cliente";
}

export function isProspect(record: Record<string, unknown> | null | undefined): boolean {
  return customerStage(record?.stage) === "prospect";
}
