/**
 * As datas de entrada do estoque de um SKU, como a callable getStockDates as
 * devolve (docs/plataforma/fifo-por-data.md, seções 3.3 e 3.4): o portal
 * mostra as do cliente, por dia (parte 5), e a ficha interna, as de cada
 * prateleira (parte 6). Só texto e validação; a conta é do servidor
 * (functions/wms/src/domain/datas-do-estoque.ts).
 */

/** `desde` é o dia "AAAA-MM-DD" em São Paulo; null é o que as entradas não cobrem. */
export type DataDeEntrada = { desde: string | null; pecas: number };

/** Um local com o saldo e as datas dele; a área de passagem vem sem datas. */
export type LocalComDatas = { local: string; pecas: number; datas: DataDeEntrada[] };

const numero = new Intl.NumberFormat("pt-BR");

/** "2026-10-22" vira "22/10/2026", sem passar por fuso. */
export function diaEmTexto(dia: string): string {
  const [ano, mes, diaDoMes] = dia.split("-");
  return `${diaDoMes}/${mes}/${ano}`;
}

/** "desde 22/10/2026", ou "sem data" para o que as entradas não cobrem. */
export function desdeEmTexto(desde: string | null): string {
  return desde ? `desde ${diaEmTexto(desde)}` : "sem data";
}

export function pecasEmTexto(pecas: number): string {
  return `${numero.format(pecas)} ${pecas === 1 ? "peça" : "peças"}`;
}

/** As datas válidas da resposta; o que não é uma data de entrada fica de fora. */
export function datasValidas(valor: unknown): DataDeEntrada[] {
  return Array.isArray(valor) ? valor.filter(ehDataDeEntrada) : [];
}

/** Os locais válidos da resposta, com as datas válidas de cada um. */
export function locaisValidos(valor: unknown): LocalComDatas[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { local, pecas, datas } = item as { local?: unknown; pecas?: unknown; datas?: unknown };
    if (typeof local !== "string" || !local.trim() || !positivo(pecas)) return [];
    return [{ local, pecas, datas: datasValidas(datas) }];
  });
}

function ehDataDeEntrada(valor: unknown): valor is DataDeEntrada {
  if (!valor || typeof valor !== "object") return false;
  const { desde, pecas } = valor as { desde?: unknown; pecas?: unknown };
  return (desde === null || (typeof desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(desde))) && positivo(pecas);
}

function positivo(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0;
}
