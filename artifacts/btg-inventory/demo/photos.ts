/*
 * Fotos dos itens da demo: arquivos em ./photos com o número do item
 * (01.jpg = item 1 de data.ts). Fotos do Unsplash e recortes de fotos de
 * eventos da TikTok; origem e limites de uso em photos/CREDITS.md. O build
 * embute cada uma no HTML como data URI.
 */
const files = import.meta.glob("./photos/*.jpg", { eager: true, import: "default" }) as Record<string, string>;

/** Foto do item, ou null quando o item não tem (o app mostra o próprio marcador). */
export function productPhoto(n: number): string | null {
  return files[`./photos/${String(n).padStart(2, "0")}.jpg`] ?? null;
}
