import { LINHA_PILOTO } from "./linhas";

export type Rota = { linha: string; conversa: string | null; linhas: boolean; contato?: true };

export function lerRota(hash: string): Rota {
  const partes = hash.replace(/^#/, "").split("/").filter(Boolean);
  if (partes[0] === "linhas") {
    const linha = partes[1] && /^\d{8,22}$/.test(partes[1]) ? partes[1] : LINHA_PILOTO;
    return { linha, conversa: null, linhas: true };
  }
  if (partes[0] === "linha" && partes[1] && /^\d{8,22}$/.test(partes[1])) {
    const linha = partes[1];
    const rota: Rota = { linha, conversa: null, linhas: false };
    if (partes[2] !== "conversa") return rota;
    let id: string;
    try {
      id = decodeURIComponent(partes[3] ?? "");
    } catch {
      return rota;
    }
    if (new RegExp(`^${linha}_\\d{8,15}$`).test(id)) {
      rota.conversa = id;
      if (partes.length === 5 && partes[4] === "contato") rota.contato = true;
    }
    return rota;
  }
  return { linha: LINHA_PILOTO, conversa: null, linhas: false };
}

export function escreverRota(linha: string, conversa: string | null, contato = false): string {
  if (!conversa) return `#/linha/${linha}`;
  return `#/linha/${linha}/conversa/${encodeURIComponent(conversa)}${contato ? "/contato" : ""}`;
}
