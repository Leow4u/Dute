import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ArrowUp, Box, ChevronRight, PackagePlus, Sparkles, type LucideIcon } from "lucide-react";

import { agentAskHref } from "@/lib/agent-chat";
import { useAppUser } from "@/lib/auth";
import { invoiceLines } from "@/lib/client-home";
import { ORDER_STEPS, homeOrderViews, orderStepIndex, type OrderView } from "@/lib/orders";
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
        const customer = overview.customer?.name || "BTG Pactual";
        const today = longDate.format(now);

        return (
          <main className="h-full min-h-0 w-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-6">
              <header>
                <h1 className="text-2xl font-semibold tracking-tight md:text-[1.75rem]">
                  {name ? `Olá, ${name}` : "Olá"}
                </h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {customer} · {today}
                </p>
              </header>

              <AskAgent />

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
                <Panel title="Pedidos em andamento" href="/portal/pedidos" linkLabel="Ver todos">
                  {orders.length ? (
                    <ul>
                      {orders.map((order) => (
                        <OrderRow key={order.id} order={order} />
                      ))}
                    </ul>
                  ) : (
                    <p className="px-5 py-6 text-sm text-muted-foreground">
                      Nenhum pedido em andamento. Use "Pedir itens do estoque" para fazer um.
                    </p>
                  )}
                </Panel>

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
                                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
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
                        title="Valor do estoque (custo)"
                        detail="base do seguro ad valorem"
                        aside={<span className="text-lg font-semibold">{formatMoney(value)}</span>}
                      />
                      <Row title="Disponível" aside={<span className="font-semibold">{pieces(available)}</span>} />
                      <Row title="Reservado em pedidos" aside={<span className="font-semibold">{pieces(reserved)}</span>} />
                      <Row
                        title="Abaixo do mínimo"
                        aside={
                          low ? (
                            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
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

/** Uma linha de pedido: número, nome, a régua de 4 etapas; recusado ganha só um chip. */
function OrderRow({ order }: { order: OrderView }) {
  const rejected = order.stage === "rejected";
  return (
    <li className="border-b border-border/50 px-5 py-4 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0">
          {order.number ? <span className="font-semibold">{order.number} · </span> : null}
          <span className={cn(!order.number && "font-semibold")}>{order.title}</span>
          {rejected ? (
            <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">Recusado</span>
          ) : null}
        </span>
        {order.summary ? <span className="text-xs text-muted-foreground">{order.summary}</span> : null}
      </div>
      {rejected ? null : <Steps step={orderStepIndex(order.stage)} />}
      {order.detail ? <p className="mt-1.5 text-xs text-muted-foreground">{order.detail}</p> : null}
    </li>
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
      className="flex items-center gap-3 rounded-[18px] border border-[#d9dcf7] bg-gradient-to-r from-[#f6f7ff] to-[#faf6ff] px-4 py-2.5 focus-within:border-primary/50"
      onSubmit={(event) => {
        event.preventDefault();
        ask();
      }}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-[#5b7cfa] to-[#8b5cf6] text-white">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
      </span>
      <input
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        aria-label="Pergunte ao Agent Dute"
        data-agent-input
        placeholder='Pergunte ao Agent Dute: "o que saiu esta semana?", "onde está meu pedido?"…'
        className="min-w-0 flex-1 bg-transparent py-1 text-[15px] outline-none placeholder:text-muted-foreground"
      />
      {question.trim() ? (
        <button
          type="submit"
          aria-label="Perguntar"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-foreground text-white"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      ) : (
        <kbd className="hidden shrink-0 rounded-md border border-border bg-white px-1.5 text-xs text-muted-foreground sm:inline">
          /
        </kbd>
      )}
    </form>
  );
}

function Steps({ step }: { step: number }) {
  return (
    <ol className="mt-3 flex items-start" aria-label={`Etapa: ${ORDER_STEPS[step]}`}>
      {ORDER_STEPS.map((label, index) => {
        const done = index < step || (index === step && step === ORDER_STEPS.length - 1);
        const current = index === step && !done;
        return (
          <li key={label} className="flex flex-1 flex-col items-center last:flex-none">
            <div className="flex w-full items-center">
              <span
                className={cn(
                  "h-3 w-3 shrink-0 rounded-full border-2",
                  done && "border-primary bg-primary",
                  current && "border-primary bg-white ring-4 ring-primary/15",
                  !done && !current && "border-border bg-white",
                )}
              />
              {index < ORDER_STEPS.length - 1 ? (
                <span className={cn("h-0.5 flex-1", index < step ? "bg-primary" : "bg-border")} />
              ) : null}
            </div>
            <span
              className={cn(
                "mt-1 w-full text-left text-[11px]",
                current ? "font-semibold text-primary" : done ? "text-foreground/70" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
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
  const className = "flex items-center gap-4 rounded-[18px] border border-border bg-white px-5 py-4";
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
    <section className="h-fit overflow-hidden rounded-[18px] border border-border bg-white">
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
