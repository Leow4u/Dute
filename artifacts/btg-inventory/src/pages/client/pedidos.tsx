import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Loader2, PackageOpen, Truck } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ORDER_STEPS, orderStepIndex, splitOrders, type OrderView } from "@/lib/orders";
import { orderProofs, type PortalDocument } from "@/lib/portal-documents";
import { cn } from "@/lib/utils";

import { DocumentList } from "./documentos";
import { ClientDataBoundary, clientOverviewQueryKey, getOrders, getRequests } from "./shared";

/**
 * Pedidos do portal: o que a BTG pediu do estoque e onde está cada entrega.
 * Em andamento com a régua das etapas; entregues e cancelados embaixo. O
 * detalhe mostra os itens e as atualizações da Dutelog.
 */

const integer = new Intl.NumberFormat("pt-BR");

export function ClientePedidos() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <ClientDataBoundary>
      {(overview) => {
        const { active, history } = splitOrders(
          (overview.request_history ?? getRequests(overview)) as Record<string, unknown>[],
          (overview.order_tracking ?? getOrders(overview)) as Record<string, unknown>[],
        );
        const current = [...active, ...history].find((view) => view.id === selected);
        if (current) {
          const proofs = orderProofs(overview.document_history ?? [], { id: current.id, number: current.number });
          return <OrderDetail view={current} proofs={proofs} onBack={() => setSelected(null)} />;
        }
        return <OrderList active={active} history={history} onOpen={setSelected} />;
      }}
    </ClientDataBoundary>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <main className="h-full min-h-0 w-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-8">{children}</div>
    </main>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h2>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ lista

function OrderList({ active, history, onOpen }: { active: OrderView[]; history: OrderView[]; onOpen: (id: string) => void }) {
  return (
    <Page>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pedidos</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">O que você pediu do estoque e onde está cada entrega.</p>
        </div>
        <Button asChild variant="outline" className="rounded-xl">
          <Link href="/portal/estoque">
            <PackageOpen className="h-4 w-4" />
            Fazer um pedido
          </Link>
        </Button>
      </header>

      <Section label={`Em andamento${active.length ? ` · ${active.length}` : ""}`}>
        {active.length ? (
          active.map((view) => <ActiveCard key={view.id} view={view} onOpen={() => onOpen(view.id)} />)
        ) : (
          <p className="rounded-lg border border-dashed border-border bg-card px-5 py-6 text-sm text-muted-foreground">
            Nenhum pedido em andamento. Os pedidos são montados no Estoque.
          </p>
        )}
      </Section>

      {history.length ? (
        <Section label="Entregues e cancelados">
          <ul className="overflow-hidden rounded-lg border border-border bg-card">
            {history.map((view) => (
              <li key={view.id} className="border-b border-border/50 last:border-0">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left text-sm hover:bg-muted/40"
                  onClick={() => onOpen(view.id)}
                >
                  <span className="min-w-0">
                    <span className="font-semibold">{view.number}</span>
                    <span className="ml-3 text-foreground/80">{[view.title, view.summary].filter(Boolean).join(" · ")}</span>
                    <span className={cn("block truncate text-xs", view.stage === "rejected" ? "text-destructive-soft-foreground" : "text-muted-foreground")}>
                      {view.detail}
                    </span>
                  </span>
                  <HistoryBadge view={view} />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </Page>
  );
}

function HistoryBadge({ view }: { view: OrderView }) {
  if (view.stage === "rejected") return <span className="shrink-0 rounded-full bg-destructive-soft px-2.5 py-0.5 text-xs font-semibold text-destructive-soft-foreground">Recusado</span>;
  if (view.stage === "cancelled") return <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">Cancelado</span>;
  return <span className="shrink-0 rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success-soft-foreground">Entregue</span>;
}

function Steps({ view, withDates = false }: { view: OrderView; withDates?: boolean }) {
  const step = orderStepIndex(view.stage);
  return (
    <ol className={cn("flex items-start", withDates ? "w-full" : "max-w-xl")} aria-label={`Etapa: ${ORDER_STEPS[step]}`}>
      {ORDER_STEPS.map((label, index) => {
        const done = index < step;
        const current = index === step;
        return (
          <li key={label} className="flex flex-1 flex-col last:flex-none">
            <div className="flex w-full items-center">
              <span
                className={cn(
                  "h-3 w-3 shrink-0 rounded-full border-2",
                  done && "border-primary bg-primary",
                  current && "border-primary bg-card ring-4 ring-primary/15",
                  !done && !current && "border-border bg-card",
                )}
              />
              {index < ORDER_STEPS.length - 1 ? <span className={cn("h-0.5 flex-1", done ? "bg-primary" : "bg-border")} /> : null}
            </div>
            <span
              className={cn(
                "mt-1 pr-2 text-xs",
                current ? "font-semibold text-primary" : done ? "text-foreground/70" : "text-muted-foreground",
              )}
            >
              {label}
              {withDates && view.stepDates[index] ? <span className="block font-normal text-muted-foreground">{view.stepDates[index]}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ActiveCard({ view, onOpen }: { view: OrderView; onOpen: () => void }) {
  return (
    <article className="rounded-lg border border-border bg-card px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <button type="button" className="group text-left" onClick={onOpen}>
          <span className="font-semibold group-hover:underline">{view.number}</span>
          <span className="ml-2 text-sm text-muted-foreground">{[view.title, view.summary].filter(Boolean).join(" · ")}</span>
        </button>
        <span className="text-sm text-muted-foreground">
          {view.destination ? (
            <>
              para <b className="font-semibold text-foreground">{view.destination}</b>
            </>
          ) : null}
          {view.due ? (
            <>
              {view.destination ? " · " : ""}até <b className="font-semibold text-foreground">{view.due}</b>
            </>
          ) : null}
        </span>
      </div>
      <div className="mt-3">
        <Steps view={view} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{view.detail}</span>
        {view.delivery ? (
          <span className="inline-flex items-center gap-1">
            <Truck className="h-3.5 w-3.5" />
            {view.delivery}
          </span>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-3">
          {view.canCancel ? <CancelOrder view={view} /> : null}
          <button type="button" className="inline-flex items-center font-medium text-primary hover:underline" onClick={onOpen}>
            Ver itens
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    </article>
  );
}

function CancelOrder({ view }: { view: OrderView }) {
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const cancel = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/client/orders/${encodeURIComponent(view.id)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message || "Não foi possível cancelar o pedido.");
      }
    },
    onSuccess: () => {
      setConfirming(false);
      toast({ title: `${view.number} cancelado`, description: "As peças reservadas voltaram para o seu estoque." });
      void queryClient.invalidateQueries({ queryKey: clientOverviewQueryKey });
    },
    onError: (error) => {
      toast({ title: "Não foi possível cancelar", description: error instanceof Error ? error.message : "", variant: "destructive" });
    },
  });
  if (!confirming) {
    return (
      <button type="button" className="font-medium text-muted-foreground hover:text-destructive-soft-foreground hover:underline" onClick={() => setConfirming(true)}>
        Cancelar pedido
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      Cancelar {view.number}?
      <Button type="button" size="sm" variant="destructive" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
        {cancel.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        Cancelar pedido
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Manter
      </Button>
    </span>
  );
}

// ------------------------------------------------------------------ detalhe

function OrderDetail({ view, proofs, onBack }: { view: OrderView; proofs: PortalDocument[]; onBack: () => void }) {
  const closed = view.stage === "cancelled" || view.stage === "rejected";
  const pieces = view.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <Page>
      <button type="button" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        Pedidos
      </button>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {view.number} <span className="text-lg font-normal text-muted-foreground">· {view.title}</span>
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[view.detail, view.destination ? `para ${view.destination}` : "", view.due ? `até ${view.due}` : ""].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className="inline-flex items-center gap-3">
          {view.canCancel ? <span className="text-xs"><CancelOrder view={view} /></span> : null}
          {closed ? <HistoryBadge view={view} /> : null}
        </span>
      </header>

      {!closed ? (
        <section className="rounded-lg border border-border bg-card px-5 py-4">
          <Steps view={view} withDates />
          {view.delivery ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Truck className="h-3.5 w-3.5" />
              {view.delivery}
            </p>
          ) : null}
        </section>
      ) : null}

      {proofs.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Comprovante de entrega</h2>
          <DocumentList rows={proofs} />
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-lg border border-border bg-card px-5 py-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-semibold">Itens{view.items.length ? ` · ${integer.format(view.items.length)}` : ""}</h2>
            {pieces ? <span className="text-sm text-muted-foreground">{integer.format(pieces)} peças</span> : null}
          </div>
          {view.items.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-1.5 pr-2 font-semibold">Código</th>
                  <th className="py-1.5 pr-2 font-semibold">Produto</th>
                  <th className="py-1.5 text-right font-semibold">Peças</th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((item, index) => (
                  <tr key={`${item.code}-${index}`} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-2 font-mono text-xs">
                      {item.code || <span className="font-sans text-warning-soft-foreground">código a definir</span>}
                    </td>
                    <td className="py-2 pr-2">{item.name}</td>
                    <td className="py-2 text-right tabular-nums">{integer.format(item.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">{view.summary || "Itens não publicados para este pedido."}</p>
          )}
        </section>

        <section className="h-fit rounded-lg border border-border bg-card px-5 py-4">
          <h2 className="font-semibold">Atualizações da Dutelog</h2>
          {view.timeline.length ? (
            <ol className="mt-3 border-l-2 border-border/70 pl-4">
              {view.timeline.map((event, index) => (
                <li key={`${event.label}-${index}`} className="pb-3 last:pb-0">
                  <span className="block text-sm font-medium">{event.label}</span>
                  <span className="text-xs text-muted-foreground">{event.at}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Ainda sem atualizações.</p>
          )}
        </section>
      </div>
    </Page>
  );
}
