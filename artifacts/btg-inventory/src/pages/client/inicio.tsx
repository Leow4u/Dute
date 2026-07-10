import {
  Activity,
  AlertTriangle,
  Bell,
  Box,
  ClipboardList,
  DollarSign,
  FileCheck2,
  PackageCheck,
  Truck,
} from "lucide-react";

import {
  ClientDataBoundary,
  ClientModuleShell,
  EmptyModuleState,
  MetricCard,
  ModulePanel,
  StatusBadge,
  categoryLabel,
  categoryPieces,
  firstNumber,
  firstText,
  formatDate,
  formatMoney,
  formatNumber,
  getAlerts,
  getBilling,
  getDocuments,
  getInventory,
  getInventoryCategories,
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
  kind: "Pedido" | "Solicitacao";
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
        const billing = getBilling(overview);
        const orders = getOrders(overview);
        const requests = getRequests(overview);
        const alerts = getAlerts(overview);
        const documents = getDocuments(overview);
        const categories = getInventoryCategories(overview)
          .slice()
          .sort((left, right) => categoryPieces(right) - categoryPieces(left))
          .slice(0, 4);

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
              kind: "Solicitacao" as const,
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
            title="Inicio"
            description="Visao executiva dos principais sinais da conta, com estoque, pedidos, solicitacoes, faturas e documentos recentes."
            icon={Activity}
          >
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Pecas disponiveis"
                value={formatNumber(
                  firstNumber(
                    inventory.available_pieces,
                    inventory.total_pieces,
                    inventory.total_pecas,
                  ),
                )}
                description={`${formatNumber(firstNumber(inventory.reserved_pieces))} reservadas`}
                icon={Box}
                tone="success"
              />
              <MetricCard
                label="Pedidos abertos"
                value={formatNumber(firstNumber(overview.orders?.open, orders.length))}
                description={`${formatNumber(firstNumber(overview.orders?.in_progress))} em operacao`}
                icon={PackageCheck}
                tone="info"
              />
              <MetricCard
                label="Solicitacoes"
                value={formatNumber(
                  firstNumber(
                    Array.isArray(overview.requests) ? undefined : overview.requests?.open,
                    requests.length,
                  ),
                )}
                description="Chamados e demandas operacionais"
                icon={ClipboardList}
                tone="warning"
              />
              <MetricCard
                label="Faturas em aberto"
                value={formatMoney(
                  firstNumber(billing.open_total, billing.current_total),
                )}
                description={`${formatNumber(firstNumber(billing.open_count))} documento(s) financeiro(s)`}
                icon={DollarSign}
                tone={firstNumber(billing.overdue_total) > 0 ? "danger" : "neutral"}
              />
            </section>

            <section className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,.75fr)]">
              <ModulePanel
                title="Atividade recente"
                description="Ultimos movimentos visiveis para o cliente"
                icon={Truck}
              >
                {activities.length > 0 ? (
                  <div className="divide-y divide-border/70">
                    {activities.map((item) => (
                      <div
                        key={item.id}
                        className="grid gap-3 py-4 md:grid-cols-[120px_minmax(0,1fr)_auto]"
                      >
                        <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
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
                ) : (
                  <EmptyModuleState
                    title="Sem atividade recente"
                    description="Pedidos e solicitacoes aparecerao aqui quando forem registrados."
                  />
                )}
              </ModulePanel>

              <ModulePanel
                title="Alertas do assistente"
                description="Pontos que merecem acompanhamento"
                icon={Bell}
              >
                {alerts.length > 0 ? (
                  <div className="space-y-3">
                    {alerts.slice(0, 4).map((alert, index) => (
                      <div
                        key={firstText(alert.id, alert.title, `alert-${index}`)}
                        className="rounded-2xl border border-border bg-white/55 p-4"
                      >
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="font-medium text-foreground">
                            {firstText(alert.title, alert.titulo, "Alerta operacional")}
                          </p>
                          <StatusBadge status={alert.priority ?? alert.severity} />
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">
                          {firstText(alert.message, alert.description, "Sem detalhe adicional.")}
                        </p>
                        <p className="mt-3 text-xs text-muted-foreground">
                          {formatDate(alert.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyModuleState
                    title="Nenhum alerta ativo"
                    description="O assistente nao apontou excecoes para esta conta."
                    icon={AlertTriangle}
                  />
                )}
              </ModulePanel>
            </section>

            <section className="grid gap-5 lg:grid-cols-2">
              <ModulePanel
                title="Estoque por categoria"
                description="Maiores grupos de pecas em saldo"
                icon={Box}
              >
                {categories.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {categories.map((category, index) => (
                      <div
                        key={`${categoryLabel(category)}-${index}`}
                        className="rounded-2xl border border-border bg-white/55 p-4"
                      >
                        <p className="text-sm font-medium text-foreground">
                          {categoryLabel(category)}
                        </p>
                        <p className="mt-2 text-2xl font-semibold tracking-normal">
                          {formatNumber(categoryPieces(category))}
                        </p>
                        <p className="text-xs text-muted-foreground">pecas em saldo</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyModuleState
                    title="Categorias indisponiveis"
                    description="O resumo de estoque ainda nao trouxe quebras por categoria."
                  />
                )}
              </ModulePanel>

              <ModulePanel
                title="Documentos recentes"
                description="Comprovantes e arquivos vinculados a operacao"
                icon={FileCheck2}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border bg-white/55 p-4">
                    <p className="text-sm font-medium text-muted-foreground">
                      Documentos disponiveis
                    </p>
                    <p className="mt-2 text-2xl font-semibold tracking-normal">
                      {formatNumber(documents.length)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-white/55 p-4">
                    <p className="text-sm font-medium text-muted-foreground">
                      Valor em estoque
                    </p>
                    <p className="mt-2 text-2xl font-semibold tracking-normal">
                      {formatMoney(
                        firstNumber(
                          inventory.total_value,
                          inventory.inventory_value,
                          inventory.custo_total,
                        ),
                      )}
                    </p>
                  </div>
                </div>
              </ModulePanel>
            </section>
          </ClientModuleShell>
        );
      }}
    </ClientDataBoundary>
  );
}
