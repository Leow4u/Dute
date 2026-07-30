import { Link } from "wouter";
import {
  AlertTriangle,
  Bell,
  Bot,
  CheckCircle2,
  MessageSquareText,
  PackageOpen,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import {
  ClientDataBoundary,
  ClientModuleShell,
  EmptyModuleState,
  MetricCard,
  ModulePanel,
  firstNumber,
  formatNumber,
  getAlerts,
  getBilling,
  getInventory,
  getInventoryItems,
  getOrders,
  getRequests,
  inventoryItemAvailable,
} from "./shared";

export function ClienteAgenteOperacional() {
  return (
    <ClientDataBoundary>
      {(overview) => {
        const alerts = getAlerts(overview);
        const inventory = getInventory(overview);
        const items = getInventoryItems(overview);
        const billing = getBilling(overview);
        const orders = getOrders(overview);
        const requests = getRequests(overview);
        const lowStock =
          firstNumber(inventory.low_stock_count) ||
          items.filter((item) => inventoryItemAvailable(item) <= 10).length;
        const openRequests = firstNumber(
          Array.isArray(overview.requests) ? undefined : overview.requests?.open,
          requests.length,
        );
        const pendingOrders = firstNumber(overview.orders?.pending, orders.length);
        const openInvoices = firstNumber(billing.open_count);
        const activeSignals = alerts.length + lowStock + openRequests + pendingOrders;

        return (
          <ClientModuleShell
            overview={overview}
            eyebrow="Agent Dute"
            title="Operacional"
            description="Sinais consolidados para orientar o atendimento e a rotina operacional do contrato BTG."
            icon={Bot}
          >
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Sinais operacionais"
                value={formatNumber(activeSignals)}
                description="Alertas, estoque, pedidos e solicitações"
                icon={Sparkles}
                tone={activeSignals > 0 ? "warning" : "success"}
              />
              <MetricCard
                label="Solicitações abertas"
                value={formatNumber(openRequests)}
                description="Demandas em acompanhamento"
                icon={Bell}
                tone={openRequests > 0 ? "info" : "success"}
              />
              <MetricCard
                label="Pedidos pendentes"
                value={formatNumber(pendingOrders)}
                description="Pedidos ainda não concluídos"
                icon={PackageOpen}
                tone={pendingOrders > 0 ? "warning" : "success"}
              />
              <MetricCard
                label="Faturas abertas"
                value={formatNumber(openInvoices)}
                description="Competências para acompanhar"
                icon={AlertTriangle}
                tone={openInvoices > 0 ? "info" : "success"}
              />
            </section>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <ModulePanel
                title="Leitura do Agent Dute"
                description="Resumo dos dados que podem orientar a próxima conversa."
                icon={MessageSquareText}
              >
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border bg-white/55 p-5">
                    <p className="text-sm font-medium text-foreground">
                      O que merece atenção agora
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {activeSignals > 0
                        ? "Há sinais operacionais para acompanhamento. Use o chat para pedir uma análise ou plano de ação antes de tomar uma decisão."
                        : "Não há alertas ativos, solicitações abertas ou pedidos pendentes retornados para esta conta no momento."}
                    </p>
                    <Button asChild className="mt-4 rounded-2xl">
                      <Link href="/portal/agente">Conversar no chat</Link>
                    </Button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-white/55 p-4">
                      <p className="text-xs font-medium uppercase text-muted-foreground">
                        Estoque
                      </p>
                      <p className="mt-2 text-sm font-medium">
                        {formatNumber(inventory.total_skus)} item(ns)
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatNumber(lowStock)} item(ns) em baixa cobertura
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border bg-white/55 p-4">
                      <p className="text-xs font-medium uppercase text-muted-foreground">
                        Rotina
                      </p>
                      <p className="mt-2 text-sm font-medium">
                        {formatNumber(requests.length + orders.length)} registro(s)
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Solicitações e pedidos recentes retornados ao portal
                      </p>
                    </div>
                  </div>
                </div>
              </ModulePanel>

              <div className="space-y-5">
                <ModulePanel
                  title="Contexto permitido"
                  description="Escopo de dados usado pelo Agent Dute."
                  icon={CheckCircle2}
                >
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Cliente</span>
                      <Badge variant="outline" className="bg-white/70">
                        {overview.customer?.code ?? "BTG Pactual"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Estoque</span>
                      <span className="font-medium">
                        {formatNumber(inventory.total_skus)} item(ns)
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Solicitações</span>
                      <span className="font-medium">
                        {formatNumber(openRequests)} aberta(s)
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Alertas</span>
                      <span className="font-medium">{formatNumber(alerts.length)}</span>
                    </div>
                  </div>
                </ModulePanel>

                <ModulePanel
                  title="Alertas recentes"
                  description="Sinais que podem orientar a conversa."
                  icon={AlertTriangle}
                >
                  {alerts.length > 0 ? (
                    <div className="space-y-3">
                      {alerts.slice(0, 4).map((alert, index) => (
                        <div
                          key={String(alert.id ?? alert.title ?? index)}
                          className="rounded-2xl border border-border bg-white/55 p-4"
                        >
                          <p className="text-sm font-medium text-foreground">
                            {alert.title ?? alert.titulo ?? "Alerta operacional"}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {alert.message ??
                              alert.description ??
                              "Sem detalhe adicional."}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyModuleState
                      title="Sem alertas ativos"
                      description="O portal não retornou exceções recentes para esta conta."
                      icon={CheckCircle2}
                    />
                  )}
                </ModulePanel>
              </div>
            </section>
          </ClientModuleShell>
        );
      }}
    </ClientDataBoundary>
  );
}
