/**
 * Helpers puros da camada de leitura: codificação de cursor, janela de
 * paginação e limites de competência.
 *
 * Vivem fora do cloud-api.ts de propósito — são a lógica onde um erro passa
 * despercebido por typecheck e build (offset trocado, Timestamp que não
 * sobrevive ao JSON, virada de ano) e só aparece em produção. Aqui ficam
 * cobertos por teste.
 */

import { Timestamp } from "firebase/firestore";

/** base64 seguro para UTF-8 — btoa cru estoura em acento/emoji. */
export function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function fromBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Timestamp não sobrevive a JSON.stringify/parse — precisa de envelope
 * tipado para o startAfter continuar comparando na mesma escala.
 */
export type CursorOrderValue =
  | { t: "ts"; s: number; n: number }
  | { t: "v"; v: unknown };

export function encodeOrderValue(value: unknown): CursorOrderValue {
  if (value instanceof Timestamp) {
    return { t: "ts", s: value.seconds, n: value.nanoseconds };
  }
  return { t: "v", v: value ?? null };
}

export function decodeOrderValue(encoded?: CursorOrderValue): unknown {
  if (!encoded) return undefined;
  if (encoded.t === "ts") return new Timestamp(encoded.s, encoded.n);
  return encoded.v;
}

/** Sentinela de fim de faixa para busca por prefixo no Firestore. */
export const PREFIX_RANGE_END = String.fromCharCode(0xf8ff);

export function prefixRangeEnd(term: string) {
  return `${term}${PREFIX_RANGE_END}`;
}

/**
 * Janela de uma página. Aplicada UMA vez: quem já recortou por offset não
 * deve recortar de novo (foi exatamente esse bug que esvaziava a página 2).
 */
export function pageWindow<T>(items: T[], offset: number, pageSize: number): T[] {
  const start = Math.max(0, offset);
  const size = Math.max(0, pageSize);
  return items.slice(start, start + size);
}
