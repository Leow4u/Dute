import { useState, type ReactNode } from "react";
import { FileBarChart2, Sparkles } from "lucide-react";
import { Link } from "wouter";

import { NfsDosServicos } from "@/components/portal/nfs-dos-servicos";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { agentAskHref } from "@/lib/agent-chat";
import {
  billingInsights,
  closedInvoices,
  deliveriesByMonth,
  monthLabel,
  shiftCompetencia,
  type ClosedInvoice,
} from "@/lib/billing-insights";
import { useAppUser } from "@/lib/auth";
import { hojeIso } from "@/lib/operacao/fila";
import { useOperationProfile } from "@/lib/operation-profile";
import { leiturasDoPortal } from "@/lib/operations";
import { useNfsDoCliente } from "@/lib/portal/use-servicos";
import { cn } from "@/lib/utils";

import { ClientDataBoundary, formatMoney, getInvoices, getOrders } from "./shared";
import { MonthlyBars, moneyShort } from "./billing-charts";

/**
 * Faturas do portal: quanto a operação na Dutelog custa, mês a mês, para
 * onde vai o dinheiro e as faturas fechadas. "Gerar relatório" abre o
 * extrato do período para salvar em PDF ou baixar em planilha. As NFs dos
 * serviços da Operação (parte 4.3b) vêm primeiro, quando há.
 */

const dateBr = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

function shortDate(iso: string) {
  const date = new Date(iso);
  return iso && !Number.isNaN(date.getTime()) ? dateBr.format(date) : "";
}

export function ClienteFaturas() {
  const [span, setSpan] = useState(6);
  const { user } = useAppUser();
  const { profile } = useOperationProfile();
  const comFaturas = profile ? leiturasDoPortal(profile.modules).faturas : false;
  const { nfs } = useNfsDoCliente(user?.publicMetadata.customer_code, comFaturas);
  const hoje = hojeIso(new Date());
  return (
    <ClientDataBoundary>
      {(overview) => {
        const invoices = closedInvoices((overview.invoice_history ?? getInvoices(overview)) as Record<string, unknown>[]);
        const deliveries = deliveriesByMonth((overview.order_tracking ?? getOrders(overview)) as Record<string, unknown>[]);
        const insights = billingInsights(invoices, deliveries, span);
        const latest = insights.latest;
        const reportFrom = latest ? shiftCompetencia(latest.competencia, -2) : "";
        return (
          <main className="h-full min-h-0 w-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-8">
              <PageHeader
                title="Faturas"
                description="Quanto a operação na Dutelog custa, mês a mês, e o que compõe cada fatura."
                actions={latest ? (
                  <>
                    <Segmented
                      aria-label="Período do gráfico"
                      value={String(span)}
                      onChange={(value) => setSpan(Number(value))}
                      options={[
                        { value: "6", label: "6 meses" },
                        { value: "12", label: "12 meses" },
                      ]}
                    />
                    <Button asChild>
                      <Link href={`/portal/faturas/relatorio?de=${reportFrom}&ate=${latest.competencia}`}>
                        <FileBarChart2 className="h-4 w-4" />
                        Gerar relatório
                      </Link>
                    </Button>
                  </>
                ) : null}
              />

              <NfsDosServicos nfs={nfs ?? []} hoje={hoje} />

              {!latest ? (
                <p className="rounded-lg border border-dashed border-border bg-card px-5 py-8 text-sm text-muted-foreground">
                  Nenhuma fatura fechada ainda. Quando a Dutelog emitir a fatura do mês, ela aparece aqui com o detalhamento.
                </p>
              ) : (
                <>
                  <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Tile label={`${monthLabel(latest.competencia, true)} · ${latest.status === "paga" ? "paga" : "emitida"}`} value={formatMoney(latest.total)}>
                      {insights.change !== null ? (
                        <>
                          <span className={cn("font-semibold", insights.change > 0 ? "text-warning-soft-foreground" : "text-success-soft-foreground")}>
                            {insights.change > 0 ? "▲" : "▼"} {Math.abs(insights.change).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                          </span>{" "}
                          vs mês anterior
                        </>
                      ) : (
                        "primeira fatura do período"
                      )}
                    </Tile>
                    <Tile label="Média mensal" value={formatMoney(insights.average)}>
                      meses faturados nos últimos {span}
                    </Tile>
                    <Tile label={`Acumulado ${insights.year}`} value={formatMoney(insights.yearTotal)}>
                      {insights.yearCount} {insights.yearCount === 1 ? "fatura" : "faturas"} · {insights.yearPaid} {insights.yearPaid === 1 ? "paga" : "pagas"}
                    </Tile>
                    <Tile label={`Pedidos entregues · ${monthLabel(latest.competencia)}`} value={String(insights.deliveredLatest)}>
                      {insights.deliveredLatest ? `${formatMoney(latest.total / insights.deliveredLatest)} de fatura por entrega` : "nenhuma entrega no mês"}
                    </Tile>
                  </section>

                  <section className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                    <Card
                      title="Gasto por mês"
                      subtitle={
                        <>
                          Total de cada fatura fechada
                          {/* No celular o valor em cima da barra sai sem unidade ("10,8"). */}
                          {insights.months.length <= 8 ? <span className="sm:hidden"> · em R$ mil</span> : null}
                        </>
                      }
                    >
                      <MonthlyBars months={insights.months} highlight={latest.competencia} />
                    </Card>
                    <Card title={`Para onde vai o dinheiro · ${monthLabel(latest.competencia)}`} subtitle="Por serviço, do maior para o menor">
                      <ServiceBars invoice={latest} />
                      <div className="mt-4 flex flex-wrap gap-2">
                        {[
                          insights.change !== null
                            ? `Por que a fatura de ${monthLabel(latest.competencia, true)} ${insights.change >= 0 ? "subiu" : "caiu"} em relação ao mês anterior?`
                            : `O que compõe a fatura de ${monthLabel(latest.competencia, true)}?`,
                          "Como posso reduzir o custo de armazenagem?",
                        ].map((question) => (
                          <Link
                            key={question}
                            href={agentAskHref(question)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-agent-border bg-agent-soft px-3 py-1.5 text-xs font-medium text-agent hover:bg-agent-soft-hover"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            {question}
                          </Link>
                        ))}
                      </div>
                    </Card>
                  </section>

                  <Card title="Faturas">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] text-sm">
                        <thead>
                          <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                            <th className="py-2 pr-2 font-semibold">Competência</th>
                            <th className="py-2 pr-2 font-semibold">Emitida</th>
                            <th className="py-2 pr-2 text-right font-semibold">Valor</th>
                            <th className="py-2 pl-4 pr-2 font-semibold">Situação</th>
                            <th className="py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {invoices.map((invoice) => (
                            <tr key={invoice.competencia} className="border-b border-border/40 last:border-0">
                              <td className="py-2.5 pr-2 font-semibold">{monthLabel(invoice.competencia, true)}</td>
                              <td className="py-2.5 pr-2 text-muted-foreground">{shortDate(invoice.issuedAt) || "—"}</td>
                              <td className="py-2.5 pr-2 text-right tabular-nums">{formatMoney(invoice.total)}</td>
                              <td className="py-2.5 pl-4 pr-2">
                                {invoice.status === "paga" ? (
                                  <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success-soft-foreground">
                                    Paga{invoice.paidAt ? ` em ${shortDate(invoice.paidAt)}` : ""}
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-semibold text-warning-soft-foreground">A pagar</span>
                                )}
                              </td>
                              <td className="py-2.5 text-right">
                                <Link href={`/portal/faturas/fatura?competencia=${invoice.competencia}`} className="text-sm font-medium text-primary hover:underline">
                                  Ver fatura
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </>
              )}
            </div>
          </main>
        );
      }}
    </ClientDataBoundary>
  );
}

function Tile({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{children}</div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card px-5 py-4">
      <h2 className="font-semibold">{title}</h2>
      {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ServiceBars({ invoice }: { invoice: ClosedInvoice }) {
  const services = [...invoice.services].sort((left, right) => right.total - left.total);
  const max = services[0]?.total || 1;
  const total = services.reduce((sum, service) => sum + service.total, 0) || 1;
  return (
    <ul className="flex flex-col gap-2.5">
      {services.map((service) => (
        <li key={service.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto_2.5rem] items-center gap-3 text-sm">
          <span className="truncate" title={service.label}>{service.label}</span>
          <span className="h-2 rounded-full bg-muted">
            <span className="block h-2 rounded-full bg-chart-bar" style={{ width: `${Math.max(2, (service.total / max) * 100)}%` }} />
          </span>
          <span className="text-right tabular-nums">{moneyShort(service.total)}</span>
          <span className="text-right text-xs tabular-nums text-muted-foreground">{Math.round((service.total / total) * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}
