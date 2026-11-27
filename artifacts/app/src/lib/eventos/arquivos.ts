/**
 * Os arquivos da edição do evento no navegador
 * (docs/superpowers/specs/2026-11-26-eventos-design.md, "Fotos e documentos"):
 * o nome que o storage.rules aceita, os caminhos e a recusa antes de subir.
 * As telas sobem pelo SDK com estes nomes e depois chamam attachEventPhoto ou
 * attachEventDocument, que conferem o arquivo no bucket. Os tipos e os
 * tamanhos são os de functions/wms/src/domain/eventos/arquivos.ts, travados
 * no platform-lists.test.ts.
 */

export const TIPOS_DE_FOTO = ["image/jpeg", "image/png", "image/webp"] as const;
export const TIPOS_DE_DOCUMENTO = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;
/** A foto fica abaixo disto (a regra é `<`). */
export const TAMANHO_DA_FOTO = 8 * 1024 * 1024;
/** O documento vai até isto (a regra é `<=`). */
export const TAMANHO_DO_DOCUMENTO = 10 * 1024 * 1024;

const EXTENSAO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

/** ft_ é a foto da Dutelog; dc_, o documento da Dutelog; an_, o anexo do cliente. */
export type PrefixoDoArquivo = "ft" | "dc" | "an";

/**
 * O nome do arquivo no Storage: o prefixo, 16 hex e a extensão do tipo, como
 * o storage.rules pede; null para o tipo que não sobe (a foto só imagem).
 */
export function nomeDoArquivo(
  prefixo: PrefixoDoArquivo,
  tipo: string,
  aleatorio: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(8)),
): string | null {
  const aceitos: readonly string[] = prefixo === "ft" ? TIPOS_DE_FOTO : TIPOS_DE_DOCUMENTO;
  if (!aceitos.includes(tipo)) return null;
  const hex = Array.from(aleatorio(), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefixo}_${hex}.${EXTENSAO[tipo]}`;
}

/** A foto e o documento da Dutelog, e o anexo do cliente. */
export type UsoDoArquivo = "foto" | "documento" | "anexo";

/** Onde o navegador sobe o arquivo (os caminhos do storage.rules). */
export function caminhoDoArquivoDaEdicao(uso: UsoDoArquivo, customerCode: string, editionId: string, arquivo: string): string {
  if (uso === "anexo") return `portal/${customerCode}/eventos/${editionId}/${arquivo}`;
  return `eventos/${customerCode}/${editionId}/${uso === "foto" ? "fotos" : "docs"}/${arquivo}`;
}

/** A recusa antes de subir, com a frase da tela; o anexo do cliente segue a do documento. */
export function problemaDoArquivoDaEdicao(arquivo: { type: string; size: number }, uso: "foto" | "documento"): string | null {
  if (uso === "foto") {
    if (!(TIPOS_DE_FOTO as readonly string[]).includes(arquivo.type)) return "Use foto JPG, PNG ou WebP.";
    if (arquivo.size >= TAMANHO_DA_FOTO) return "A foto passa de 8 MB.";
    return null;
  }
  if (!(TIPOS_DE_DOCUMENTO as readonly string[]).includes(arquivo.type)) return "Use PDF, imagem ou planilha (.xlsx).";
  if (arquivo.size > TAMANHO_DO_DOCUMENTO) return "O documento passa de 10 MB.";
  return null;
}
