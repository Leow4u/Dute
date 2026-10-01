/**
 * Faturas do portal: quanto a operação na Dutelog custa, mês a mês, e o que
 * compõe cada fatura. Só meses fechados (faturas emitidas ou pagas); a prévia
 * do mês em andamento fica no painel interno.
 */

import { buildInvoiceView } from "./invoice-view";

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_LONG = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function isCompetencia(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** "2026-09" → "set/26" (curto) ou "Setembro/2026" (longo). */
export function monthLabel(competencia: string, long = false) {
  const [year, month] = competencia.split("-").map(Number);
  if (!year || !month) return competencia;
  return long ? `${MONTHS_LONG[month - 1]}/${year}` : `${MONTHS[month - 1]}/${String(year).slice(2)}`;
}

export function shiftCompetencia(competencia: string, delta: number) {
  const [year, month] = competencia.split("-").map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Meses de `from` a `to`, inclusive. */
export function monthRange(from: string, to: string) {
  const out: string[] = [];
  for (let current = from; current <= to && out.length < 60; current = shiftCompetencia(current, 1)) out.push(current);
  return out;
}

export type ClosedInvoice = {
  competencia: string;
  total: number;
  status: "emitida" | "paga";
  issuedAt: string;
  paidAt: string;
  services: Array<{ key: string; label: string; total: number }>;
};

/** Faturas fechadas (emitidas ou pagas), da mais recente para a mais antiga. */
export function closedInvoices(invoices: AnyRecord[]): ClosedInvoice[] {
  const byMonth = new Map<string, ClosedInvoice>();
  for (const invoice of invoices) {
    const competencia = text(invoice.competencia) || text(invoice.id);
    const status = text(invoice.status).toLowerCase();
    if (!isCompetencia(competencia) || !["emitido", "pago"].includes(status)) continue;
    const view = buildInvoiceView(invoice);
    byMonth.set(competencia, {
      competencia,
      total: num(invoice.total) || view.total,
      status: status === "pago" ? "paga" : "emitida",
      issuedAt: text(invoice.emitido_em) || text(invoice.issued_at),
      paidAt: text(invoice.pago_em),
      services: view.groups.map((group) => ({ key: group.key, label: group.label, total: group.total })),
    });
  }
  return [...byMonth.values()].sort((left, right) => right.competencia.localeCompare(left.competencia));
}

/** Pedidos entregues por mês (pela data de entrega do acompanhamento). */
export function deliveriesByMonth(trackings: AnyRecord[]) {
  const counts = new Map<string, number>();
  for (const tracking of trackings) {
    if (text(tracking.status).toLowerCase() !== "delivered") continue;
    const delivered = text(tracking.delivered_at);
    const timeline = Array.isArray(tracking.timeline) ? (tracking.timeline as AnyRecord[]) : [];
    const fromTimeline = timeline.find((entry) => text(entry.status) === "delivered");
    const date = delivered || text(fromTimeline?.occurred_at);
    const competencia = date.slice(0, 7);
    if (!isCompetencia(competencia)) continue;
    counts.set(competencia, (counts.get(competencia) ?? 0) + 1);
  }
  return counts;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export type BillingInsights = {
  latest: ClosedInvoice | null;
  /** Variação da última fatura contra a anterior, em %. */
  change: number | null;
  months: Array<{ competencia: string; label: string; total: number | null }>;
  average: number;
  yearTotal: number;
  yearCount: number;
  yearPaid: number;
  year: string;
  deliveredLatest: number;
};

/** Painel: os últimos `span` meses até a última fatura fechada. */
export function billingInsights(invoices: ClosedInvoice[], deliveries: Map<string, number>, span = 6): BillingInsights {
  const latest = invoices[0] ?? null;
  const previous = latest ? invoices.find((invoice) => invoice.competencia === shiftCompetencia(latest.competencia, -1)) : undefined;
  const end = latest?.competencia ?? "";
  const months = end
    ? monthRange(shiftCompetencia(end, -(span - 1)), end).map((competencia) => ({
        competencia,
        label: monthLabel(competencia),
        total: invoices.find((invoice) => invoice.competencia === competencia)?.total ?? null,
      }))
    : [];
  const billed = months.filter((month) => month.total !== null);
  const year = end.slice(0, 4);
  const yearInvoices = invoices.filter((invoice) => invoice.competencia.startsWith(year));
  return {
    latest,
    change: latest && previous && previous.total > 0 ? round(((latest.total - previous.total) / previous.total) * 100) : null,
    months,
    average: billed.length ? round(billed.reduce((sum, month) => sum + (month.total ?? 0), 0) / billed.length) : 0,
    yearTotal: round(yearInvoices.reduce((sum, invoice) => sum + invoice.total, 0)),
    yearCount: yearInvoices.length,
    yearPaid: yearInvoices.filter((invoice) => invoice.status === "paga").length,
    year,
    deliveredLatest: latest ? deliveries.get(latest.competencia) ?? 0 : 0,
  };
}

export type BillingReport = {
  from: string;
  to: string;
  months: string[];
  invoices: ClosedInvoice[];
  /** Uma linha por serviço, um valor por mês do período. */
  services: Array<{ label: string; byMonth: number[]; total: number }>;
  monthTotals: number[];
  total: number;
  average: number;
  delivered: number[];
  deliveredTotal: number;
};

/** Relatório do período: a mesma conta da planilha gerada no backend. */
export function billingReport(invoices: ClosedInvoice[], deliveries: Map<string, number>, from: string, to: string): BillingReport {
  const months = monthRange(from, to);
  const inRange = invoices
    .filter((invoice) => invoice.competencia >= from && invoice.competencia <= to)
    .sort((left, right) => left.competencia.localeCompare(right.competencia));
  const labels = new Map<string, string>();
  for (const invoice of inRange) for (const service of invoice.services) labels.set(service.key, service.label);
  const services = [...labels.entries()]
    .map(([key, label]) => {
      const byMonth = months.map((competencia) =>
        round(inRange.find((invoice) => invoice.competencia === competencia)?.services.find((service) => service.key === key)?.total ?? 0),
      );
      return { label, byMonth, total: round(byMonth.reduce((sum, value) => sum + value, 0)) };
    })
    .sort((left, right) => right.total - left.total);
  const monthTotals = months.map((competencia) => round(inRange.find((invoice) => invoice.competencia === competencia)?.total ?? 0));
  const total = round(monthTotals.reduce((sum, value) => sum + value, 0));
  const delivered = months.map((competencia) => deliveries.get(competencia) ?? 0);
  return {
    from,
    to,
    months,
    invoices: inRange,
    services,
    monthTotals,
    total,
    average: inRange.length ? round(total / inRange.length) : 0,
    delivered,
    deliveredTotal: delivered.reduce((sum, value) => sum + value, 0),
  };
}
