/**
 * Code 128, conjunto B: o código de barras das etiquetas de caixa e de
 * posição. É o que a Zebra imprime nativamente e o que qualquer leitor lê.
 *
 * Sem dependência: a tabela de padrões é a da norma (107 símbolos de 11
 * módulos, parada de 13), o dígito verificador é a soma ponderada módulo
 * 103. Só o conjunto B (ASCII imprimível), que cobre CX-000001 e A-01.
 */

/** Larguras barra/espaço de cada símbolo, do valor 0 ao 105 (Start C). */
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232",
] as const;
const STOP_PATTERN = "2331112";

export const CODE128_START_B = 104;
/** Zona de silêncio de cada lado, em módulos (a norma pede ao menos 10). */
export const CODE128_QUIET_ZONE = 10;

export function code128Patterns() {
  return { symbols: [...PATTERNS], stop: STOP_PATTERN };
}

function valueOf(character: string) {
  const code = character.charCodeAt(0);
  if (code < 32 || code > 126) {
    throw new Error(`Caractere "${character}" não cabe no código de barras: use letras, números e sinais simples.`);
  }
  return code - 32;
}

/** Start B, os valores do texto e o dígito verificador (sem a parada). */
export function code128Values(text: string) {
  if (!text) throw new Error("Código de barras vazio.");
  const values = [CODE128_START_B, ...[...text].map(valueOf)];
  return [...values, code128Checksum(values)];
}

/** Soma ponderada: start × 1 e cada símbolo pelo seu índice, módulo 103. */
export function code128Checksum(values: number[]) {
  return values.reduce((sum, value, index) => sum + value * Math.max(index, 1), 0) % 103;
}

/** Larguras alternadas barra, espaço, barra..., começando e terminando em barra. */
export function code128Modules(text: string) {
  const widths: number[] = [];
  for (const value of code128Values(text)) {
    for (const digit of PATTERNS[value]!) widths.push(Number(digit));
  }
  for (const digit of STOP_PATTERN) widths.push(Number(digit));
  return widths;
}

export type BarcodeBar = { x: number; width: number };

/** As barras com posição em módulos, já com a zona de silêncio dos dois lados. */
export function code128Bars(text: string): { bars: BarcodeBar[]; width: number } {
  const bars: BarcodeBar[] = [];
  let x = CODE128_QUIET_ZONE;
  code128Modules(text).forEach((width, index) => {
    if (index % 2 === 0) bars.push({ x, width });
    x += width;
  });
  return { bars, width: x + CODE128_QUIET_ZONE };
}
