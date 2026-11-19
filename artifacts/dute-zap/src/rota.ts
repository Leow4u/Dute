import { LINHA_PILOTO } from "./linhas";

export type Rota = { linha: string; conversa: string | null; linhas: boolean };

export function lerRota(hash: string): Rota {
  const partes = hash.replace(/^#/, "").split("/").filter(Boolean);
  if (partes[0] === "linhas") {
    const linha = partes[1] && /^\d{8,22}$/.test(partes[1]) ? partes[1] : LINHA_PILOTO;
    return { linha, conversa: null, linhas: true };
  }
  if (partes[0] === "linha" && partes[1] && /^\d{8,22}$/.test(partes[1])) {
    const linha = partes[1];
    const conversaBruta = partes[2] === "conversa" ? decodeURIComponent(partes[3] ?? "") : "";
    const conversa = new RegExp(`^${linha}_\\d{8,15}$`).test(conversaBruta) ? conversaBruta : null;
    return { linha, conversa, linhas: false };
  }
  return { linha: LINHA_PILOTO, conversa: null, linhas: false };
}

export function escreverRota(linha: string, conversa: string | null): string {
  if (!conversa) return `#/linha/${linha}`;
  return `#/linha/${linha}/conversa/${encodeURIComponent(conversa)}`;
}
