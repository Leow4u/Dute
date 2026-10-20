import { GRUPOS } from "./billing-format";

/**
 * A fatura que vai para a cliente (e para o PDF) só mostra o que foi
 * cobrado: serviços com quantidade no mês, agrupados, com o Ad Valorem por
 * último. Serve tanto a prévia/snapshot do painel quanto o client_invoices
 * do portal — os dois guardam grupos com as mesmas linhas.
 */

type AnyRecord = Record<string, unknown>;

export type InvoiceLine = {
  item: string;
  unidade: string;
  qtde: number;
  valorUnit: number;
  total: number;
  adValorem: boolean;
};

export type InvoiceGroup = {
  key: string;
  label: string;
  total: number;
  lines: InvoiceLine[];
};

export type InvoiceView = {
  groups: InvoiceGroup[];
  total: number;
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function cents(value: number) {
  return Math.round(value * 100);
}

export function isAdValoremLine(line: AnyRecord, grupo = "") {
  return (
    text(line.auto_source) === "ad_valorem" ||
    grupo === "ad_valorem" ||
    /ad\s*valorem/i.test(text(line.item))
  );
}

export function groupLabel(grupo: string, fallback?: unknown) {
  return GRUPOS[grupo]?.label ?? (text(fallback) || grupo || "Outros");
}

function groupsFrom(source: AnyRecord): AnyRecord[] {
  for (const key of ["grupos", "groups"]) {
    if (Array.isArray(source[key]) && (source[key] as unknown[]).length) {
      return source[key] as AnyRecord[];
    }
  }
  // Sem grupos gravados: agrupa as linhas soltas.
  const lines = (["linhas", "lines"]
    .map((key) => source[key])
    .find(Array.isArray) ?? []) as AnyRecord[];
  const byGroup = new Map<string, AnyRecord[]>();
  for (const line of lines) {
    const grupo = text(line.grupo) || "outros";
    byGroup.set(grupo, [...(byGroup.get(grupo) ?? []), line]);
  }
  return [...byGroup.entries()].map(([grupo, itens]) => ({ grupo, itens }));
}

export function buildInvoiceView(source: AnyRecord): InvoiceView {
  const groups = groupsFrom(source)
    .map((group) => {
      const key = text(group.grupo) || "outros";
      const lines = (Array.isArray(group.itens) ? (group.itens as AnyRecord[]) : [])
        .filter((line) => num(line.qtde) > 0)
        .map((line) => ({
          item: text(line.item) || "Serviço",
          unidade: text(line.unidade),
          qtde: num(line.qtde),
          valorUnit: num(line.valor_unit),
          total: num(line.total),
          adValorem: isAdValoremLine(line, key),
        }));
      return {
        key,
        label: groupLabel(key, group.label),
        total: lines.reduce((sum, line) => sum + cents(line.total), 0) / 100,
        lines,
      };
    })
    .filter((group) => group.lines.length > 0)
    // Ad Valorem fecha a fatura, depois dos serviços.
    .sort(
      (left, right) =>
        Number(left.lines.every((line) => line.adValorem)) -
        Number(right.lines.every((line) => line.adValorem)),
    );

  return {
    groups,
    total: groups.reduce((sum, group) => sum + cents(group.total), 0) / 100,
  };
}
