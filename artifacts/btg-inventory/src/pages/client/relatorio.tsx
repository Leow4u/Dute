import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Download, Loader2, Printer } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
import {
  billingReport,
  closedInvoices,
  deliveriesByMonth,
  isCompetencia,
  monthLabel,
} from "@/lib/billing-insights";

import { ClientDataBoundary, formatMoney, getInvoices, getOrders } from "./shared";
import { MonthlyBars } from "./billing-charts";
import { LEGACY_CUSTOMER_CODE } from "@/lib/active-customer";

/**
 * Extrato de serviços logísticos de um período, para apresentar: o
 * navegador imprime só o documento (Salvar PDF) e a planilha vem do
 * backend com as mesmas contas, mais o detalhe de cada item.
 */

function paramsFromUrl() {
  if (typeof window === "undefined") return { de: "", ate: "" };
  const params = new URLSearchParams(window.location.search);
  return { de: params.get("de") ?? "", ate: params.get("ate") ?? "" };
}

const dateBr = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });

function dateText(iso: string) {
  const date = new Date(iso);
  return iso && !Number.isNaN(date.getTime()) ? dateBr.format(date) : "—";
}

export function ClienteRelatorio() {
  const { user } = useAppUser();
  const initial = paramsFromUrl();
  const [from, setFrom] = useState(initial.de);
  const [to, setTo] = useState(initial.ate);
  const { toast } = useToast();
  const download = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/client/billing/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { file_name?: string; content_type?: string; content_base64?: string; message?: string }
        | null;
      if (!response.ok || !payload?.content_base64) throw new Error(payload?.message || "Não consegui gerar a planilha.");
      const bytes = Uint8Array.from(atob(payload.content_base64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: payload.content_type }));
      const link = document.createElement("a");
      link.href = url;
      link.download = payload.file_name || "extrato-dutelog.xlsx";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
    onError: (error) =>
      toast({ title: "Planilha não gerada", description: error instanceof Error ? error.message : "", variant: "destructive" }),
  });

  return (
    <ClientDataBoundary>
      {(overview) => {
        const invoices = closedInvoices((overview.invoice_history ?? getInvoices(overview)) as Record<string, unknown>[]);
        const deliveries = deliveriesByMonth((overview.order_tracking ?? getOrders(overview)) as Record<string, unknown>[]);
        const available = [...invoices.map((invoice) => invoice.competencia)].sort();
        const start = isCompetencia(from) ? from : available[0] ?? "";
        const end = isCompetencia(to) ? to : available[available.length - 1] ?? "";
        const valid = Boolean(start && end && start <= end);
        const report = valid ? billingReport(invoices, deliveries, start, end) : null;
        const period = report ? `${monthLabel(start, true)} a ${monthLabel(end, true)}` : "";
        const generatedBy = user?.fullName?.split(/\s+/)[0] || user?.primaryEmailAddress?.emailAddress || "";
        return (
          <main className="h-full min-h-0 w-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
            <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 pb-8">
              <div className="no-print flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-col gap-2">
                  <Link href="/portal/faturas" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    <ArrowLeft className="h-4 w-4" />
                    Faturas
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <label htmlFor="relatorio-de">De</label>
                    <select id="relatorio-de" className="rounded-lg border border-border bg-card px-2 py-1.5" value={start} onChange={(event) => setFrom(event.target.value)}>
                      {available.map((month) => (
                        <option key={month} value={month}>{monthLabel(month, true)}</option>
                      ))}
                    </select>
                    <label htmlFor="relatorio-ate">até</label>
                    <select id="relatorio-ate" className="rounded-lg border border-border bg-card px-2 py-1.5" value={end} onChange={(event) => setTo(event.target.value)}>
                      {available.map((month) => (
                        <option key={month} value={month}>{monthLabel(month, true)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="rounded-xl" disabled={!report || download.isPending} onClick={() => download.mutate()}>
                    {download.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Baixar planilha
                  </Button>
                  <Button className="rounded-xl" disabled={!report} onClick={() => window.print()}>
                    <Printer className="h-4 w-4" />
                    Salvar PDF
                  </Button>
                </div>
              </div>

              {!report ? (
                <p className="rounded-lg border border-dashed border-border bg-card px-5 py-8 text-sm text-muted-foreground">
                  {available.length ? "Escolha um período válido: o mês inicial antes do final." : "Nenhuma fatura fechada para gerar o relatório."}
                </p>
              ) : (
                <article className="print-area rounded-md bg-white p-8 text-sm text-slate-800 sm:p-10">
                  <header className="flex items-start justify-between border-b-2 border-slate-800 pb-3">
                    <div>
                      <div className="text-xl font-black tracking-[0.12em] text-[#e3262c]">DUTELOG</div>
                      <div className="text-xs text-slate-500">Soluções logísticas</div>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <div className="text-sm font-semibold text-slate-800">{overview.customer?.name || overview.customer?.code || LEGACY_CUSTOMER_CODE}</div>
                      Gerado em {dateBr.format(new Date())}
                      {generatedBy ? ` por ${generatedBy}` : ""}
                    </div>
                  </header>
                  <h1 className="mt-5 text-xl font-semibold">Extrato de serviços logísticos</h1>
                  <p className="text-slate-500">Período: {period}</p>

                  <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <Fact label="Total no período" value={formatMoney(report.total)} />
                    <Fact label="Média por fatura" value={formatMoney(report.average)} />
                    <Fact label="Faturas" value={String(report.invoices.length)} />
                    <Fact label="Pedidos entregues" value={String(report.deliveredTotal)} />
                  </div>

                  <h2 className="mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">Gasto por mês</h2>
                  <div className="mt-2">
                    <MonthlyBars
                      print
                      height={150}
                      months={report.months.map((competencia, index) => ({
                        competencia,
                        label: monthLabel(competencia),
                        total: report.invoices.some((invoice) => invoice.competencia === competencia) ? report.monthTotals[index] ?? 0 : null,
                      }))}
                    />
                  </div>

                  <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-slate-500">Por serviço</h2>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                          <th className="py-1.5 pr-2 font-semibold">Serviço</th>
                          {report.months.map((month) => (
                            <th key={month} className="py-1.5 pr-2 text-right font-semibold">{monthLabel(month)}</th>
                          ))}
                          <th className="py-1.5 text-right font-semibold">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.services.map((service) => (
                          <tr key={service.label} className="border-b border-slate-100">
                            <td className="py-1.5 pr-2">{service.label}</td>
                            {service.byMonth.map((value, index) => (
                              <td key={report.months[index]} className="py-1.5 pr-2 text-right tabular-nums">{value ? formatMoney(value) : "—"}</td>
                            ))}
                            <td className="py-1.5 text-right tabular-nums">{formatMoney(service.total)}</td>
                          </tr>
                        ))}
                        <tr className="border-t-[1.5px] border-slate-800 font-semibold">
                          <td className="py-1.5 pr-2">Total</td>
                          {report.monthTotals.map((value, index) => (
                            <td key={report.months[index]} className="py-1.5 pr-2 text-right tabular-nums">{value ? formatMoney(value) : "—"}</td>
                          ))}
                          <td className="py-1.5 text-right tabular-nums">{formatMoney(report.total)}</td>
                        </tr>
                        <tr className="text-slate-500">
                          <td className="py-1.5 pr-2">Pedidos entregues</td>
                          {report.delivered.map((value, index) => (
                            <td key={report.months[index]} className="py-1.5 pr-2 text-right tabular-nums">{value}</td>
                          ))}
                          <td className="py-1.5 text-right tabular-nums">{report.deliveredTotal}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-slate-500">Faturas do período</h2>
                  <table className="mt-2 w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                        <th className="py-1.5 pr-2 font-semibold">Competência</th>
                        <th className="py-1.5 pr-2 font-semibold">Emissão</th>
                        <th className="py-1.5 pr-2 font-semibold">Situação</th>
                        <th className="py-1.5 text-right font-semibold">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.invoices.map((invoice) => (
                        <tr key={invoice.competencia} className="border-b border-slate-100">
                          <td className="py-1.5 pr-2">{monthLabel(invoice.competencia, true)}</td>
                          <td className="py-1.5 pr-2">{dateText(invoice.issuedAt)}</td>
                          <td className="py-1.5 pr-2">{invoice.status === "paga" ? `Paga${invoice.paidAt ? ` em ${dateText(invoice.paidAt)}` : ""}` : "A pagar"}</td>
                          <td className="py-1.5 text-right tabular-nums">{formatMoney(invoice.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <p className="mt-8 border-t border-slate-100 pt-2 text-xs text-slate-400">
                    Valores das faturas emitidas pela Dutelog. O detalhe de cada item (quantidade × preço) está na planilha, aba Itens.
                  </p>
                </article>
              )}
            </div>
          </main>
        );
      }}
    </ClientDataBoundary>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}
