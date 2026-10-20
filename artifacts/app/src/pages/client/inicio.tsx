import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ArrowUp, Box, CalendarClock, ChevronRight, PackagePlus, Sparkles, type LucideIcon } from "lucide-react";

import { fetchChatJson } from "@/components/agent/chat";
import { agentAskHref, type ConversationSummary } from "@/lib/agent-chat";
import { isUnreadRoutine } from "@/lib/agent-routines";
import { useAppUser } from "@/lib/auth";
import { invoiceLines } from "@/lib/client-home";
import { ORDER_STEPS, homeOrderViews, orderStepIndex, type OrderStage, type OrderView } from "@/lib/orders";
import { stockOverview } from "@/lib/portal-stock";
import { splitShipments } from "@/lib/shipments";
import { cn } from "@/lib/utils";
import { groupInventoryProducts } from "./estoque";
import {
  ClientDataBoundary,
  firstNumber,
  formatMoney,
  formatNumber,
  getInventory,
  getInventoryItems,
  getInvoices,
  getOrders,
  getRequests,
  inventoryTotalValue,
} from "./shared";
import { LEGACY_CUSTOMER_CODE } from "@/lib/active-customer";

/**
 * Início do portal: só o que pede atenção agora. Pedidos em andamento com a
 * mesma régua da tela Pedidos (e, por 7 dias, os recusados), envios a
 * caminho, um resumo do estoque e as faturas fechadas. O que já terminou fica
 * nas telas próprias.
 */

const longDate = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

function firstName(name: string | undefined) {
  return (name ?? "").trim().split(/\s+/)[0] || "";
}

function pieces(value: number) {
  return `${formatNumber(value)} ${value === 1 ? "peça" : "peças"}`;
}

export function ClienteInicio() {
  const { user } = useAppUser();
  const name = firstName(user?.fullName);

  return (
    <ClientDataBoundary>
      {(overview) => {
        const now = new Date();
        const inventory = getInventory(overview);
        const items = getInventoryItems(overview);
        const requests = (overview.request_history ?? getRequests(overview)) as Record<string, unknown>[];
        const trackings = (overview.order_tracking ?? getOrders(overview)) as Record<string, unknown>[];
        const invoices = getInvoices(overview) as Record<string, unknown>[];
        const available = firstNumber(inventory.available_pieces, inventory.total_pieces);
        const reserved = firstNumber(inventory.reserved_pieces);
        const itemCount = firstNumber(inventory.total_skus, items.length);
        const value = inventoryTotalValue(inventory, items);
        const low = stockOverview(groupInventoryProducts(items)).low;
        const stockReady = items.length > 0 || available > 0;
        const orders = homeOrderViews(requests, trackings, now);
        const shipments = splitShipments(requests).onTheWay.slice(0, 3);
        const bills = invoiceLines(invoices, now, { includeCurrent: false });
        const customer = overview.customer?.name || LEGACY_CUSTOMER_CODE;
        const today = longDate.format(now);

        return (
          <main className="h-full min-h-0 w-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-6">
              <header>
                <h1 className="text-2xl font-semibold tracking-tight">
                  {name ? `Olá, ${name}` : "Olá"}
                </h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {customer} · {today}
                </p>
              </header>

              <AskAgent />
              <RoutineNews />

              <section className="grid gap-3 md:grid-cols-2">
                <Action
                  href="/portal/estoque"
                  icon={Box}
                  title="Pedir itens do estoque"
                  detail={
                    stockReady
                      ? `${pieces(available)} disponíveis em ${formatNumber(itemCount)} ${itemCount === 1 ? "item" : "itens"}`
                      : "Disponível depois da contagem inicial"
                  }
                  disabled={!stockReady}
                />
                <Action
                  href="/portal/recebimentos"
                  icon={PackagePlus}
                  title="Avisar um envio"
                  detail="O fornecedor vai entregar na Dutelog? Avise e anexe a NF"
                />
              </section>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                <section className="min-w-0">
                  <div className="mb-3 flex items-center justify-between px-1">
                    <h2 className="text-sm font-semibold">Pedidos em andamento</h2>
                    <Link href="/portal/pedidos" className="text-sm font-medium text-primary hover:underline">
                      Ver todos ›
                    </Link>
                  </div>
                  {orders.length ? (
                    <ul className="flex flex-col gap-3">
                      {orders.map((order) => (
                        <OrderCard key={order.id} order={order} />
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">
                      Nenhum pedido em andamento. Use "Pedir itens do estoque" para fazer um.
                    </p>
                  )}
                </section>

                <div className="flex flex-col gap-4">
                  <Panel title="Envios a caminho" href="/portal/recebimentos" linkLabel="Ver">
                    {shipments.length ? (
                      <ul>
                        {shipments.map((shipment) => (
                          <Row
                            key={shipment.id}
                            title={
                              <>
                                {shipment.number ? <span className="font-semibold">{shipment.number} · </span> : null}
                                {shipment.title}
                              </>
                            }
                            detail={shipment.summary || shipment.detail}
                            aside={
                              shipment.arrival ? (
                                <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-semibold text-warning-soft-foreground">
                                  chega {shipment.arrival}
                                </span>
                              ) : null
                            }
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="px-5 py-4 text-sm text-muted-foreground">Nenhum envio a caminho.</p>
                    )}
                  </Panel>

                  <Panel title="Seu estoque" href="/portal/estoque" linkLabel="Abrir">
                    <ul>
                      <Row
                        title="Valor do estoque"
                        detail="custo · base do seguro ad valorem"
                        aside={<span className="text-lg font-semibold">{formatMoney(value)}</span>}
                      />
                      <Row title="Disponível" aside={<span className="font-semibold">{pieces(available)}</span>} />
                      <Row title="Reservado em pedidos" aside={<span className="font-semibold">{pieces(reserved)}</span>} />
                      <Row
                        title="Abaixo do mínimo"
                        aside={
                          low ? (
                            <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-semibold text-warning-soft-foreground">
                              {formatNumber(low)} {low === 1 ? "item" : "itens"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">nenhum</span>
                          )
                        }
                      />
                    </ul>
                  </Panel>

                  <Panel title="Faturas" href="/portal/faturas" linkLabel="Ver">
                    {bills.length ? (
                      <ul>
                        {bills.map((bill) => (
                          <Row
                            key={bill.competencia}
                            title={bill.label}
                            detail={bill.detail}
                            aside={
                              bill.amount !== undefined ? (
                                <span className="font-semibold">{formatMoney(bill.amount)}</span>
                              ) : (
                                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-foreground/70">
                                  Em fechamento
                                </span>
                              )
                            }
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="px-5 py-4 text-sm text-muted-foreground">Nenhuma fatura fechada ainda.</p>
                    )}
                  </Panel>
                </div>
              </div>
            </div>
          </main>
        );
      }}
    </ClientDataBoundary>
  );
}

/** Status do pedido como a pessoa lê, com o tom das filas de Pedidos e Receber. */
const ORDER_STATUS: Record<OrderStage, { label: string; pill: string; bar: string }> = {
  placed: { label: "Aguardando confirmação", pill: "bg-warning-soft text-warning-soft-foreground", bar: "bg-warning" },
  confirmed: { label: "Confirmado pela Dutelog", pill: "bg-info-soft text-info-soft-foreground", bar: "bg-primary" },
  picking: { label: "Em separação", pill: "bg-info-soft text-info-soft-foreground", bar: "bg-primary" },
  dispatched: { label: "Saiu para entrega", pill: "bg-success-soft text-success-soft-foreground", bar: "bg-success" },
  delivered: { label: "Entregue", pill: "bg-muted text-muted-foreground", bar: "bg-success" },
  rejected: { label: "Recusado", pill: "bg-destructive-soft text-destructive-soft-foreground", bar: "bg-muted" },
  cancelled: { label: "Cancelado", pill: "bg-muted text-muted-foreground", bar: "bg-muted" },
};

/**
 * Um card por pedido: número e nome, a pílula de status (o que importa na
 * Início) e o progresso em 4 segmentos. A régua com os nomes das etapas fica
 * na página do pedido.
 */
function OrderCard({ order }: { order: OrderView }) {
  const status = ORDER_STATUS[order.stage];
  const closed = order.stage === "rejected" || order.stage === "cancelled";
  const step = orderStepIndex(order.stage);
  // A pílula já diz "aguardando confirmação"; o apoio fica só com quem pediu e quando.
  const detail = order.detail.replace(/ · aguardando a Dutelog confirmar$/, "");
  const support = [order.summary, detail].filter(Boolean).join(" · ");
  return (
    <li className="rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="text-sm">
            {order.number ? <span className="font-semibold">{order.number} · </span> : null}
            <span className={cn("font-semibold", order.number && "font-medium")}>{order.title}</span>
          </p>
          {support ? <p className="mt-0.5 text-xs text-muted-foreground">{support}</p> : null}
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", status.pill)}>{status.label}</span>
      </div>
      {closed ? null : (
        <div className="mt-3">
          <div className="flex gap-1" aria-hidden="true">
            {ORDER_STEPS.map((label, index) => (
              <span key={label} className={cn("h-1.5 flex-1 rounded-full", index <= step ? status.bar : "bg-muted")} />
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Etapa {step + 1} de {ORDER_STEPS.length} · {ORDER_STEPS[step]}
          </p>
        </div>
      )}
    </li>
  );
}

/** Resposta nova de rotina do Agent Dute (ainda não aberta neste navegador). */
function RoutineNews() {
  const conversations = useQuery<{ conversations: ConversationSummary[] }, Error>({
    queryKey: ["agent-dute-conversations"],
    queryFn: () => fetchChatJson<{ conversations: ConversationSummary[] }>("/api/agent-dute/conversations"),
    staleTime: 60_000,
  });
  const unread = (conversations.data?.conversations ?? []).filter((item) => isUnreadRoutine(item)).slice(0, 2);
  if (!unread.length) return null;
  return (
    <ul className="flex flex-col gap-2">
      {unread.map((item) => (
        <li key={item.id}>
          <Link
            href={`/portal/agente?c=${encodeURIComponent(item.id)}`}
            className="flex items-center gap-3 rounded-md border border-agent-border bg-agent-soft px-4 py-2.5 text-sm hover:border-agent/50"
          >
            <CalendarClock className="h-4 w-4 shrink-0 text-agent" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              <b className="font-semibold">{item.title.replace(/^Rotina:\s*/, "")}</b> chegou
            </span>
            <span className="shrink-0 font-medium text-primary">Abrir ›</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Pergunta rápida: abre o Agent Dute numa conversa nova já com a pergunta. */
function AskAgent() {
  const [, navigate] = useLocation();
  const [question, setQuestion] = useState("");
  const ask = () => {
    if (question.trim()) navigate(agentAskHref(question));
  };
  return (
    <form
      className="flex items-center gap-3 rounded-lg border border-agent-border bg-gradient-to-r from-info-soft to-agent-soft px-4 py-2.5 focus-within:border-primary/50"
      onSubmit={(event) => {
        event.preventDefault();
        ask();
      }}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-gradient-to-br from-agent-start to-agent-accent text-white">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
      </span>
      <input
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        aria-label="Pergunte ao Agent Dute"
        data-agent-input
        placeholder='Pergunte ao Agent Dute: "o que saiu esta semana?", "onde está meu pedido?"…'
        className="min-w-0 flex-1 bg-transparent py-1 text-base outline-none placeholder:text-muted-foreground"
      />
      {question.trim() ? (
        <button
          type="submit"
          aria-label="Perguntar"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-foreground text-background"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      ) : (
        <kbd className="hidden shrink-0 rounded-md border border-border bg-card px-1.5 text-xs text-muted-foreground sm:inline">
          /
        </kbd>
      )}
    </form>
  );
}

function Action({
  href,
  icon: Icon,
  title,
  detail,
  disabled = false,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  disabled?: boolean;
}) {
  const body = (
    <>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{detail}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </>
  );
  const className = "flex items-center gap-4 rounded-lg border border-border bg-card px-5 py-4";
  if (disabled) return <div className={cn(className, "opacity-60")}>{body}</div>;
  return (
    <Link href={href} className={cn(className, "transition-colors hover:border-primary/40")}>
      {body}
    </Link>
  );
}

function Panel({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="h-fit overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Link href={href} className="text-sm font-medium text-primary hover:underline">
          {linkLabel} ›
        </Link>
      </div>
      {children}
    </section>
  );
}

function Row({ title, detail, aside }: { title: ReactNode; detail?: string; aside: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-border/40 px-5 py-3 text-sm last:border-0">
      <span className="min-w-0">
        <span className="block truncate">{title}</span>
        {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      <span className="shrink-0">{aside}</span>
    </li>
  );
}
