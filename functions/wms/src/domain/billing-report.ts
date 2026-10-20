import { HttpsError } from "firebase-functions/https";

/**
 * Portal > Faturas > Gerar relatório: o extrato de serviços logísticos de um
 * período, montado das faturas fechadas (emitidas ou pagas) do próprio
 * cliente e dos pedidos entregues. A tela mostra a mesma conta
 * (lib/billing-insights no frontend); a planilha sai daqui, dos dados
 * gravados, e não do que a tela calculou.
 */

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

const GROUP_LABELS: Record<string, string> = {
  armazenamento: "Armazenamento",
  ad_valorem: "Ad Valorem",
  recebimento: "Recebimento",
  expedicao: "Expedição",
  servicos: "Serviços de Valor Agregado",
  transporte: "Abastecimento / Transporte",
};

const MONTHS_LONG = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

export function monthLabel(competencia: string) {
  const [year, month] = competencia.split("-").map(Number);
  return `${MONTHS_LONG[(month || 1) - 1]}/${year}`;
}

function shift(competencia: string, delta: number) {
  const [year, month] = competencia.split("-").map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export const MAX_REPORT_MONTHS = 24;

/** Período válido: AAAA-MM, de ≤ até, no máximo 24 meses. */
export function reportMonths(from: string, to: string) {
  if (!COMPETENCIA.test(from) || !COMPETENCIA.test(to) || from > to) {
    throw new HttpsError("invalid-argument", "Período inválido. Use de e até no formato AAAA-MM.");
  }
  const months: string[] = [];
  for (let current = from; current <= to; current = shift(current, 1)) {
    months.push(current);
    if (months.length > MAX_REPORT_MONTHS) {
      throw new HttpsError("invalid-argument", `Escolha no máximo ${MAX_REPORT_MONTHS} meses.`);
    }
  }
  return months;
}

export type ReportLine = { competencia: string; servico: string; item: string; unidade: string; qtde: number; valor_unit: number; total: number };

export type ReportInvoice = {
  competencia: string;
  total: number;
  status: "Emitida" | "Paga";
  issuedAt: string;
  paidAt: string;
  services: Map<string, number>;
  lines: ReportLine[];
};

function invoiceGroups(invoice: AnyRecord): AnyRecord[] {
  for (const key of ["groups", "grupos"]) {
    if (Array.isArray(invoice[key]) && (invoice[key] as unknown[]).length) return invoice[key] as AnyRecord[];
  }
  const lines = (Array.isArray(invoice.lines) ? invoice.lines : Array.isArray(invoice.linhas) ? invoice.linhas : []) as AnyRecord[];
  const byGroup = new Map<string, AnyRecord[]>();
  for (const line of lines) {
    const grupo = text(line.grupo) || "outros";
    byGroup.set(grupo, [...(byGroup.get(grupo) ?? []), line]);
  }
  return [...byGroup.entries()].map(([grupo, itens]) => ({ grupo, itens }));
}

/** Só faturas fechadas; serviço = grupo da fatura, linhas com quantidade. */
export function reportInvoice(invoice: AnyRecord): ReportInvoice | null {
  const competencia = text(invoice.competencia) || text(invoice.id);
  const status = text(invoice.status).toLowerCase();
  if (!COMPETENCIA.test(competencia) || !["emitido", "pago"].includes(status)) return null;
  const services = new Map<string, number>();
  const lines: ReportLine[] = [];
  for (const group of invoiceGroups(invoice)) {
    const key = text(group.grupo) || "outros";
    const label = GROUP_LABELS[key] ?? (text(group.label) || key);
    for (const line of (Array.isArray(group.itens) ? group.itens : []) as AnyRecord[]) {
      if (num(line.qtde) <= 0) continue;
      const total = num(line.total);
      services.set(label, round((services.get(label) ?? 0) + total));
      lines.push({
        competencia,
        servico: label,
        item: text(line.item) || "Serviço",
        unidade: text(line.unidade),
        qtde: num(line.qtde),
        valor_unit: num(line.valor_unit),
        total,
      });
    }
  }
  const sum = round([...services.values()].reduce((acc, value) => acc + value, 0));
  return {
    competencia,
    total: num(invoice.total) || sum,
    status: status === "pago" ? "Paga" : "Emitida",
    issuedAt: text(invoice.emitido_em) || text(invoice.issued_at),
    paidAt: text(invoice.pago_em),
    services,
    lines,
  };
}

export type ReportDelivery = { competencia: string; number: string; destination: string; deliveredAt: string; items: number; pieces: number };

export function reportDeliveries(trackings: AnyRecord[], months: string[]): ReportDelivery[] {
  const wanted = new Set(months);
  return trackings
    .filter((tracking) => text(tracking.status).toLowerCase() === "delivered")
    .map((tracking) => {
      const timeline = (Array.isArray(tracking.timeline) ? tracking.timeline : []) as AnyRecord[];
      const deliveredAt = text(tracking.delivered_at) || text(timeline.find((entry) => text(entry.status) === "delivered")?.occurred_at);
      return {
        competencia: deliveredAt.slice(0, 7),
        number: text(tracking.order_number) || text(tracking.id),
        destination: text(tracking.destination),
        deliveredAt,
        items: num(tracking.item_count),
        pieces: num(tracking.quantity_total),
      };
    })
    .filter((delivery) => wanted.has(delivery.competencia))
    .sort((left, right) => left.deliveredAt.localeCompare(right.deliveredAt));
}

export type BillingReportData = {
  customerCode: string;
  months: string[];
  invoices: ReportInvoice[];
  services: Array<{ label: string; byMonth: number[]; total: number }>;
  monthTotals: number[];
  total: number;
  average: number;
  deliveries: ReportDelivery[];
};

export function buildBillingReport(input: {
  customerCode: string;
  from: string;
  to: string;
  invoices: AnyRecord[];
  trackings: AnyRecord[];
}): BillingReportData {
  const months = reportMonths(input.from, input.to);
  const invoices = input.invoices
    .map(reportInvoice)
    .filter((invoice): invoice is ReportInvoice => Boolean(invoice && months.includes(invoice.competencia)))
    .sort((left, right) => left.competencia.localeCompare(right.competencia));
  const labels = new Set<string>();
  for (const invoice of invoices) for (const label of invoice.services.keys()) labels.add(label);
  const services = [...labels]
    .map((label) => {
      const byMonth = months.map((competencia) => invoices.find((invoice) => invoice.competencia === competencia)?.services.get(label) ?? 0);
      return { label, byMonth, total: round(byMonth.reduce((acc, value) => acc + value, 0)) };
    })
    .sort((left, right) => right.total - left.total);
  const monthTotals = months.map((competencia) => round(invoices.find((invoice) => invoice.competencia === competencia)?.total ?? 0));
  const total = round(monthTotals.reduce((acc, value) => acc + value, 0));
  return {
    customerCode: input.customerCode,
    months,
    invoices,
    services,
    monthTotals,
    total,
    average: invoices.length ? round(total / invoices.length) : 0,
    deliveries: reportDeliveries(input.trackings, months),
  };
}

const MONEY = '"R$" #,##0.00';

function dateBr(iso: string) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(date);
}

/** A planilha do relatório: Resumo, Por serviço, Itens, Faturas, Pedidos entregues. */
export async function billingReportWorkbook(data: BillingReportData, generatedBy: string) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Dutelog";
  workbook.created = new Date();
  const period = `${monthLabel(data.months[0]!)} a ${monthLabel(data.months[data.months.length - 1]!)}`;
  const header = (sheet: any, columns: Array<{ header: string; key: string; width: number; money?: boolean }>) => {
    sheet.columns = columns.map((column) => ({ header: column.header, key: column.key, width: column.width }));
    sheet.getRow(1).font = { bold: true };
    for (const [index, column] of columns.entries()) if (column.money) sheet.getColumn(index + 1).numFmt = MONEY;
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  };

  const resumo = workbook.addWorksheet("Resumo");
  resumo.columns = [{ width: 30 }, { width: 22 }];
  resumo.addRows([
    ["Extrato de serviços logísticos"],
    ["Cliente", data.customerCode],
    ["Período", period],
    ["Gerado em", dateBr(new Date().toISOString())],
    ["Gerado por", generatedBy],
    [],
    ["Total no período", data.total],
    ["Média por fatura", data.average],
    ["Faturas no período", data.invoices.length],
    ["Pedidos entregues", data.deliveries.length],
  ]);
  resumo.getCell("A1").font = { bold: true, size: 14 };
  resumo.getCell("B7").numFmt = MONEY;
  resumo.getCell("B8").numFmt = MONEY;

  const porServico = workbook.addWorksheet("Por serviço");
  header(porServico, [
    { header: "Serviço", key: "label", width: 30 },
    ...data.months.map((competencia) => ({ header: monthLabel(competencia), key: competencia, width: 16, money: true })),
    { header: "Total", key: "total", width: 16, money: true },
  ]);
  for (const service of data.services) {
    porServico.addRow({ label: service.label, ...Object.fromEntries(data.months.map((m, i) => [m, service.byMonth[i]])), total: service.total });
  }
  const totalRow = porServico.addRow({ label: "Total", ...Object.fromEntries(data.months.map((m, i) => [m, data.monthTotals[i]])), total: data.total });
  totalRow.font = { bold: true };

  const itens = workbook.addWorksheet("Itens");
  header(itens, [
    { header: "Competência", key: "competencia", width: 16 },
    { header: "Serviço", key: "servico", width: 28 },
    { header: "Item", key: "item", width: 40 },
    { header: "Unidade", key: "unidade", width: 12 },
    { header: "Quantidade", key: "qtde", width: 12 },
    { header: "Valor unitário", key: "valor_unit", width: 16, money: true },
    { header: "Total", key: "total", width: 16, money: true },
  ]);
  for (const invoice of data.invoices) for (const line of invoice.lines) itens.addRow({ ...line, competencia: monthLabel(line.competencia) });

  const faturas = workbook.addWorksheet("Faturas");
  header(faturas, [
    { header: "Competência", key: "competencia", width: 16 },
    { header: "Emissão", key: "emissao", width: 14 },
    { header: "Situação", key: "situacao", width: 22 },
    { header: "Valor", key: "total", width: 16, money: true },
  ]);
  for (const invoice of data.invoices) {
    faturas.addRow({
      competencia: monthLabel(invoice.competencia),
      emissao: dateBr(invoice.issuedAt),
      situacao: invoice.status === "Paga" && invoice.paidAt ? `Paga em ${dateBr(invoice.paidAt)}` : invoice.status,
      total: invoice.total,
    });
  }

  const entregues = workbook.addWorksheet("Pedidos entregues");
  header(entregues, [
    { header: "Pedido", key: "number", width: 14 },
    { header: "Entregue em", key: "entregue", width: 14 },
    { header: "Destino", key: "destination", width: 28 },
    { header: "Itens", key: "items", width: 10 },
    { header: "Peças", key: "pieces", width: 10 },
  ]);
  for (const delivery of data.deliveries) {
    entregues.addRow({ ...delivery, entregue: dateBr(delivery.deliveredAt) });
  }

  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  return Buffer.from(buffer);
}
