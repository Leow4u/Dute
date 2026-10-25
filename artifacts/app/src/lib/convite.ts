/**
 * A referência do convite nos eventos (functions/wms/src/domain/customer-invite.ts,
 * `inviteEventReference`). O token do link é a chave do convite e não entra
 * em evento nenhum: os eventos são lidos pela equipe do armazém, e quem tem o
 * token aceita o convite. A referência são os 16 primeiros dígitos do SHA-256
 * do token, a mesma conta do servidor.
 */
export async function referenciaDoConvite(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `convite_${hex.slice(0, 16)}`;
}
