import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Box,
  CircleCheck,
  Clock3,
  DollarSign,
  PackageCheck,
  PackagePlus,
  Truck,
  type LucideIcon,
} from "lucide-react";

import {
  ClientDataBoundary,
  ClientModuleShell,
  MetricCard,
  ModulePanel,
  StatusBadge,
  firstNumber,
  firstText,
  formatDate,
  formatMoney,
  formatNumber,
  getAlerts,
  getBilling,
  getInventory,
  getInventoryItems,
  getOrders,
  getRequests,
  orderDate,
  orderProduct,
  orderReference,
  requestDate,
  requestReference,
  requestTitle,
  sortByDateDesc,
} from "./shared";

type ActivityItem = {
  id: string;
  kind: "Pedido" | "Recebimento";
  reference: string;
  title: string;
  status?: string;
  date?: string | null;
};

export function ClienteInicio() {
  return (
    <ClientDataBoundary>
      {(overview) => {
        const inventory = getInventory(overview);
        const inventoryItems = getInventoryItems(overview);
        const billing = getBilling(overview);
        const orders = getOrders(overview);
        const requests = getRequests(overview);
        const alerts = getAlerts(overview);
        const availablePieces = firstNumber(
          inventory.available_pieces,
          inventory.total_pieces,
          inventory.total_pecas,
        );
        const stockReady = inventoryItems.length > 0 || availablePieces > 0;
        const openOrders = firstNumber(overview.orders?.open, orders.length);
        const openInvoices = firstNumber(billing.open_count);

        const activities: ActivityItem[] = sortByDateDesc(
          [
            ...orders.slice(0, 4).map((order, index) => ({
              id: `order-${orderReference(order)}-${index}`,
              kind: "Pedido" as const,
              reference: orderReference(order),
              title: orderProduct(order),
              status: order.status,
              date: orderDate(order),
            })),
            ...requests.slice(0, 4).map((request, index) => ({
              id: `request-${requestReference(request)}-${index}`,
              kind: "Recebimento" as const,
              reference: requestReference(request),
              title: requestTitle(request),
              status: request.status,
              date: requestDate(request),
            })),
          ],
          (item) => item.date,
        ).slice(0, 6);

        return (
          <ClientModuleShell
            overview={overview}
            eyebrow="Portal do cliente"
            title="Início"
            description="Consulte o estoque, peça itens para a loja ou avise uma entrega de fornecedor."
            icon={Activity}
          >
            <section className="rounded-[24px] border border-border bg-white/68 p-5 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[40px] md:p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-start gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border bg-white text-primary">
                    {stockReady ? (
                      <CircleCheck className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <Clock3 className="h-5 w-5" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-foreground">
                      {stockReady
                        ? "Estoque disponível para consulta"
                        : "Inventário inicial em andamento"}
                    </h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                      {stockReady
                        ? "Os saldos exibidos refletem as entradas conferidas pela Dutelog e as reservas dos pedidos em aberto."
                        : "A Dutelog está contando e cadastrando os produtos. Você já pode avisar entregas de fornecedores; os itens só aparecem no estoque depois da conferência física."}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  {stockReady ? "Atualizado em tempo real" : "Sem saldo liberado"}
                </span>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <PortalAction
                href="/portal/estoque"
                icon={Box}
                title="Pedir itens do estoque"
                description="Consulte a disponibilidade e monte o pedido de abastecimento da loja."
                meta={
                  stockReady
                    ? `${formatNumber(availablePieces)} peça(s) disponíveis`
                    : "Disponível após o inventário inicial"
                }
                disabled={!stockReady}
              />
              <PortalAction
                href="/portal/recebimentos"
                icon={PackagePlus}
                title="Avisar uma entrega"
                description="Informe o que o fornecedor enviará para a Dutelog e anexe a nota ou o pedido."
                meta="O aviso não altera o saldo do estoque"
              />
            </section>

            {stockReady || openOrders > 0 || openInvoices > 0 ? (
              <section className="grid gap-4 md:grid-cols-3">
                <MetricCard
                  label="Peças disponíveis"
                  value={formatNumber(availablePieces)}
                  description={`${formatNumber(firstNumber(inventory.reserved_pieces))} reservada(s) em pedidos`}
                  icon={Box}
                  tone="info"
                />
                <MetricCard
                  label="Pedidos em aberto"
                  value={formatNumber(openOrders)}
                  description="Acompanhe separação e entrega"
                  icon={PackageCheck}
                  tone="neutral"
                />
                <MetricCard
                  label="Faturas em aberto"
                  value={formatMoney(firstNumber(billing.open_total, billing.current_total))}
                  description={`${formatNumber(openInvoices)} documento(s)`}
                  icon={DollarSign}
                  tone={firstNumber(billing.overdue_total) > 0 ? "danger" : "neutral"}
                />
              </section>
            ) : null}

            {activities.length > 0 || alerts.length > 0 ? (
              <section className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,.75fr)]">
                {activities.length > 0 ? (
                  <ModulePanel
                    title="Atividade recente"
                    description="Últimas atualizações visíveis para a sua conta"
                    icon={Truck}
                  >
                    <div className="divide-y divide-border/70">
                      {activities.map((item) => (
                        <div
                          key={item.id}
                          className="grid gap-3 py-4 md:grid-cols-[110px_minmax(0,1fr)_auto]"
                        >
                          <div className="text-xs font-medium text-muted-foreground">
                            {item.kind}
                          </div>
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-foreground">
                                {item.reference}
                              </span>
                              <StatusBadge status={item.status} />
                            </div>
                            <p className="truncate text-sm text-muted-foreground">
                              {item.title}
                            </p>
                          </div>
                          <div className="text-sm text-muted-foreground md:text-right">
                            {formatDate(item.date)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ModulePanel>
                ) : (
                  <div />
                )}

                {alerts.length > 0 ? (
                  <ModulePanel
                    title="Pontos de atenção"
                    description="Alertas relevantes para sua operação"
                    icon={AlertTriangle}
                  >
                    <div className="space-y-3">
                      {alerts.slice(0, 4).map((alert, index) => (
                        <div
                          key={firstText(alert.id, alert.title, `alert-${index}`)}
                          className="rounded-2xl border border-border bg-white/55 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-medium text-foreground">
                              {firstText(alert.title, alert.titulo, "Atenção necessária")}
                            </p>
                            <StatusBadge status={alert.priority ?? alert.severity} />
                          </div>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {firstText(alert.message, alert.description, "Consulte os detalhes com a Dutelog.")}
                          </p>
                        </div>
                      ))}
                    </div>
                  </ModulePanel>
                ) : null}
              </section>
            ) : null}
          </ClientModuleShell>
        );
      }}
    </ClientDataBoundary>
  );
}

function PortalAction({
  href,
  icon: Icon,
  title,
  description,
  meta,
  disabled = false,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  meta: string;
  disabled?: boolean;
}) {
  const content = (
    <>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] border border-border bg-white text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold text-foreground">{title}</span>
        <span className="mt-1 block text-sm leading-6 text-muted-foreground">
          {description}
        </span>
        <span className="mt-3 block text-xs font-medium text-muted-foreground">
          {meta}
        </span>
      </span>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-white text-muted-foreground transition group-hover:text-primary">
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </span>
    </>
  );

  if (disabled) {
    return (
      <div className="flex min-h-[168px] items-start gap-4 rounded-[24px] border border-border bg-white/45 p-6 opacity-75">
        {content}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="group flex min-h-[168px] cursor-pointer items-start gap-4 rounded-[24px] border border-border bg-white/72 p-6 shadow-[0_8px_24px_rgba(15,23,42,.04)] transition duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-white hover:shadow-[0_18px_60px_rgba(15,23,42,.05)]"
    >
      {content}
    </Link>
  );
}
