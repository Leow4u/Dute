import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DollarSign,
  FileCheck2,
} from "lucide-react";

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
  formatDate,
  formatMoney,
  formatNumber,
  formatPeriod,
  getBilling,
  getInvoices,
} from "./shared";

export function ClienteFaturas() {
  return (
    <ClientDataBoundary>
      {(overview) => {
        const billing = getBilling(overview);
        const invoices = getInvoices(overview);
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

        return (
          <ClientModuleShell
            overview={overview}
            eyebrow="Modulo financeiro"
            title="Faturas"
            description="Resumo de cobrancas, competencias recentes e valores em aberto para acompanhamento financeiro."
            icon={DollarSign}
          >
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Total em aberto"
                value={formatMoney(openTotal)}
                description="Valor corrente informado para a conta"
                icon={DollarSign}
                tone={overdueTotal > 0 ? "danger" : "info"}
              />
              <MetricCard
                label="Faturas abertas"
                value={formatNumber(openCount)}
                description="Documentos aguardando baixa"
                icon={FileCheck2}
                tone="neutral"
              />
              <MetricCard
                label="Vencidas"
                value={formatMoney(overdueTotal)}
                description="Valor marcado como vencido"
                icon={AlertTriangle}
                tone={overdueTotal > 0 ? "danger" : "success"}
              />
              <MetricCard
                label="Vencem em breve"
                value={formatNumber(firstNumber(billing.due_soon_count))}
                description="Competencias proximas ao vencimento"
                icon={Clock3}
                tone="warning"
              />
            </section>

            <ModulePanel
              title="Historico de faturas"
              description="Competencias retornadas pelo endpoint do cliente"
              icon={FileCheck2}
            >
              {invoices.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Competencia</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Vencimento</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.slice(0, 12).map((invoice, index) => (
                      <TableRow
                        key={`${invoice.id ?? invoice.competencia ?? invoice.month ?? "invoice"}-${index}`}
                      >
                        <TableCell className="font-medium">
                          {formatPeriod(invoice.competencia ?? invoice.month)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={invoice.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(invoice.total)}
                        </TableCell>
                        <TableCell>
                          {formatDate(invoice.due_date ?? invoice.vencimento)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyModuleState
                  title="Nenhuma fatura retornada"
                  description="O historico financeiro sera exibido quando houver documentos disponiveis."
                  icon={CheckCircle2}
                />
              )}
            </ModulePanel>
          </ClientModuleShell>
        );
      }}
    </ClientDataBoundary>
  );
}
