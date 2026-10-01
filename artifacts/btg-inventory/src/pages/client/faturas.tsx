import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DollarSign,
  FileCheck2,
} from "lucide-react";

import { Link } from "wouter";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  ClientDataBoundary,
  ClientModuleShell,
  EmptyModuleState,
  MetricCard,
  ModulePanel,
  StatusBadge,
  firstNumber,
  firstText,
  formatDate,
  formatMoney,
  formatNumber,
  formatPeriod,
  getBilling,
  getInvoices,
} from "./shared";

function invoiceGroups(invoice: Record<string, unknown>) {
  const groups = Array.isArray(invoice.groups)
    ? invoice.groups
    : Array.isArray(invoice.grupos)
      ? invoice.grupos
      : [];
  if (groups.length > 0) return groups as Record<string, unknown>[];

  const lines = Array.isArray(invoice.lines)
    ? invoice.lines
    : Array.isArray(invoice.linhas)
      ? invoice.linhas
      : [];
  const grouped = new Map<string, { grupo: string; total: number; count: number }>();
  for (const line of lines as Record<string, unknown>[]) {
    const grupo = firstText(line.grupo, "Serviços") ?? "Serviços";
    const current = grouped.get(grupo) ?? { grupo, total: 0, count: 0 };
    current.total += firstNumber(line.total);
    current.count += 1;
    grouped.set(grupo, current);
  }
  return [...grouped.values()] as Record<string, unknown>[];
}

export function ClienteFaturas() {
  return (
    <ClientDataBoundary>
      {(overview) => {
        const billing = getBilling(overview);
        const invoices = getInvoices(overview);
        const currentInvoice = invoices[0] as Record<string, unknown> | undefined;
        const groups = currentInvoice ? invoiceGroups(currentInvoice) : [];
        const totalInvoices = invoices.reduce(
          (sum, invoice) => sum + firstNumber(invoice.total),
          0,
        );
        const openTotal = firstNumber(
          billing.open_total,
          billing.current_total,
          totalInvoices,
        );
        const overdueTotal = firstNumber(billing.overdue_total);
        const openCount =
          firstNumber(billing.open_count) ||
          invoices.filter((invoice) =>
            String(invoice.status ?? "").toLowerCase().includes("abert"),
          ).length;
        const hasBilling = invoices.length > 0 || openTotal > 0 || overdueTotal > 0;

        return (
          <ClientModuleShell
            overview={overview}
            title="Faturas"
            icon={DollarSign}
          >
            {!hasBilling ? (
              <EmptyModuleState
                title="Nenhuma fatura disponível"
                description="A competência atual ainda não foi publicada. Quando houver uma cobrança, o detalhamento e o vencimento aparecerão aqui."
                icon={CheckCircle2}
              />
            ) : (
              <>
                <section className="grid gap-4 md:grid-cols-3">
                  <MetricCard
                    label="Total em aberto"
                    value={formatMoney(openTotal)}
                    description={`${formatNumber(openCount)} fatura(s)`}
                    icon={DollarSign}
                    tone={overdueTotal > 0 ? "danger" : "info"}
                  />
                  <MetricCard
                    label="Valor vencido"
                    value={formatMoney(overdueTotal)}
                    description={overdueTotal > 0 ? "Requer atenção" : "Nenhum valor vencido"}
                    icon={AlertTriangle}
                    tone={overdueTotal > 0 ? "danger" : "success"}
                  />
                  <MetricCard
                    label="Vencem em breve"
                    value={formatNumber(firstNumber(billing.due_soon_count))}
                    description="Próximas do vencimento"
                    icon={Clock3}
                    tone="neutral"
                  />
                </section>

                {groups.length > 0 ? (
                  <ModulePanel
                    title="Composição da cobrança"
                    description="Serviços logísticos incluídos na fatura mais recente"
                    icon={DollarSign}
                  >
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {groups.slice(0, 6).map((group, index) => {
                        const itemCount = Array.isArray(group.itens)
                          ? group.itens.length
                          : firstNumber(group.count);
                        return (
                          <div
                            key={`${group.grupo ?? group.label ?? "grupo"}-${index}`}
                            className="rounded-[18px] border border-border bg-white/70 p-4"
                          >
                            <div className="text-sm text-muted-foreground">
                              {firstText(group.label, group.grupo, "Serviço")}
                            </div>
                            <div className="mt-2 text-xl font-semibold text-foreground">
                              {formatMoney(group.total)}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {formatNumber(itemCount)} linha(s) de serviço
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ModulePanel>
                ) : null}

                <ModulePanel
                  title="Histórico de faturas"
                  description="Competências publicadas para a sua conta"
                  icon={FileCheck2}
                >
                  <div className="overflow-auto rounded-2xl border border-border bg-white/35">
                    <Table className="min-w-[680px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Competência</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead>Vencimento</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoices.slice(0, 12).map((invoice, index) => (
                          <TableRow key={`${invoice.id ?? invoice.competencia ?? invoice.month ?? "invoice"}-${index}`}>
                            <TableCell className="font-medium">
                              {formatPeriod(invoice.competencia ?? invoice.month)}
                            </TableCell>
                            <TableCell><StatusBadge status={invoice.status} /></TableCell>
                            <TableCell className="text-right">{formatMoney(invoice.total)}</TableCell>
                            <TableCell>{formatDate(invoice.due_date ?? invoice.vencimento)}</TableCell>
                            <TableCell className="text-right">
                              {firstText(invoice.competencia) ? (
                                <Link
                                  href={`/portal/faturas/fatura?competencia=${firstText(invoice.competencia)}`}
                                  className="text-sm font-medium text-primary"
                                >
                                  Ver fatura
                                </Link>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </ModulePanel>
              </>
            )}
          </ClientModuleShell>
        );
      }}
    </ClientDataBoundary>
  );
}
