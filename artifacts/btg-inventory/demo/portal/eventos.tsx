/*
 * DEMO: tela Eventos do portal. Cada evento modelo guarda o que vai para o
 * local (ícones, cenografia, mobiliário, brindes), onde é e como a Dutelog
 * leva, monta e traz de volta; "Usar no pedido" abre o pedido já pronto.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, MapPin, PackageOpen, Send, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  ClientModuleLoading,
  ClientModuleShell,
  formatMoney,
  formatNumber,
  getInventoryItems,
  inventoryItemAvailable,
  inventoryItemPhoto,
  inventoryItemSku,
  useClientOverview,
} from "../../src/pages/client/shared";
import { pick } from "../i18n/lang";
import { eventShortages, useDeleteEvent, useEvents, type EventModel } from "./demo-api";

/** Itens à mostra antes de "ver todos": o evento grande tem 16 linhas. */
const PREVIEW_ITEMS = 6;

function nextDateLabel(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

export function DemoEvents() {
  const overview = useClientOverview();
  const events = useEvents();
  const deleteEvent = useDeleteEvent();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (overview.isLoading || events.isLoading || !overview.data) return <ClientModuleLoading title={pick("Carregando eventos", "Loading events")} />;

  const items = getInventoryItems(overview.data);
  const availableBySku = new Map<string, number>();
  const photoBySku = new Map<string, string | null>();
  const unitCostBySku = new Map<string, number>();
  for (const item of items) {
    const sku = inventoryItemSku(item);
    availableBySku.set(sku, (availableBySku.get(sku) ?? 0) + inventoryItemAvailable(item));
    if (!photoBySku.get(sku)) photoBySku.set(sku, inventoryItemPhoto(item));
    const unitCost = Number((item as { unit_cost?: unknown }).unit_cost ?? 0);
    if (unitCost > 0) unitCostBySku.set(sku, unitCost);
  }
  const list = events.data ?? [];

  function remove(event: EventModel) {
    deleteEvent.mutate(event.id, {
      onSuccess: () => toast({ title: pick("Evento excluído", "Event deleted"), description: event.name }),
    });
  }

  return (
    <ClientModuleShell
      overview={overview.data}
      title={pick("Eventos", "Events")}
      description={pick(
        "Cada evento já tem a lista do que vai para o local. A Dutelog leva, monta, desmonta e traz de volta para o galpão.",
        "Each event already has the list of what goes to the venue. Dutelog delivers, sets up, tears down and brings it back to the warehouse.",
      )}
      icon={CalendarDays}
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {list.map((event) => {
          const pieces = event.items.reduce((sum, item) => sum + item.quantity, 0);
          const value = event.items.reduce((sum, item) => sum + item.quantity * (unitCostBySku.get(item.sku) ?? 0), 0);
          const shortages = eventShortages(event, availableBySku);
          const open = expanded[event.id] ?? false;
          const shown = open ? event.items : event.items.slice(0, PREVIEW_ITEMS);
          const when = nextDateLabel(event.next_date);
          return (
            <article key={event.id} className="flex flex-col rounded-lg border border-border bg-card">
              <header className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3.5">
                <div className="min-w-0">
                  <h2 className="font-semibold">{event.name}</h2>
                  {event.description ? <p className="mt-0.5 text-sm text-muted-foreground">{event.description}</p> : null}
                </div>
                {when ? (
                  <span className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                    {pick("Próxima edição", "Next edition")} · {when}
                  </span>
                ) : null}
              </header>

              <div className="flex flex-col gap-1.5 border-b border-border/60 px-4 py-3 text-sm text-muted-foreground">
                <span className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="font-medium text-foreground">{event.venue}</span> · {event.address}
                  </span>
                </span>
                {event.schedule ? (
                  <span className="flex items-start gap-2">
                    <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {event.schedule}
                  </span>
                ) : null}
                {event.logistics ? (
                  <span className="flex items-start gap-2">
                    <Truck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {event.logistics}
                  </span>
                ) : null}
              </div>

              <ul className="flex flex-1 flex-col divide-y divide-border/50 px-4">
                {shown.map((item) => (
                  <li key={item.sku + item.name} className="flex items-center gap-3 py-2">
                    <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {photoBySku.get(item.sku) ? (
                        <img src={photoBySku.get(item.sku)!} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <PackageOpen className="m-2.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                    <span className="shrink-0 text-sm font-medium">× {formatNumber(item.quantity)}</span>
                  </li>
                ))}
              </ul>
              {event.items.length > PREVIEW_ITEMS ? (
                <button
                  type="button"
                  className="mx-4 mb-2 cursor-pointer self-start rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-muted"
                  onClick={() => setExpanded((current) => ({ ...current, [event.id]: !open }))}
                >
                  {open
                    ? pick("Mostrar menos", "Show less")
                    : pick(`Ver os ${event.items.length} itens`, `See all ${event.items.length} items`)}
                </button>
              ) : null}

              <div className="border-t border-border/60 px-4 py-3 text-sm">
                {shortages.length ? (
                  <p className="flex items-start gap-2 text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      {pick("Falta no estoque de hoje: ", "Short in today's stock: ")}
                      {shortages
                        .map((item) => pick(`${item.name} (precisa ${formatNumber(item.need)}, há ${formatNumber(item.have)})`, `${item.name} (needs ${formatNumber(item.need)}, ${formatNumber(item.have)} available)`))
                        .join("; ")}
                    </span>
                  </p>
                ) : (
                  <p className="flex items-center gap-2 text-success-soft-foreground">
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {pick("Tudo disponível no estoque de hoje", "Everything available in today's stock")}
                  </p>
                )}
                <p className="mt-1 text-muted-foreground">
                  {pick(
                    `${formatNumber(event.items.length)} itens · ${formatNumber(pieces)} peças · ${formatMoney(value)} em peças (base do seguro de transporte)`,
                    `${formatNumber(event.items.length)} items · ${formatNumber(pieces)} pieces · ${formatMoney(value)} in pieces (transit insurance base)`,
                  )}
                </p>
              </div>

              <footer className="flex items-center justify-end gap-2 border-t border-border/60 px-4 py-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="cursor-pointer text-muted-foreground"
                  aria-label={pick(`Excluir ${event.name}`, `Delete ${event.name}`)}
                  onClick={() => remove(event)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button type="button" size="sm" className="cursor-pointer" onClick={() => navigate(`/portal/estoque?evento=${encodeURIComponent(event.id)}`)}>
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {pick("Usar no pedido", "Use in order")}
                </Button>
              </footer>
            </article>
          );
        })}
        <article className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-center">
          <CalendarDays className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">{pick("Criar um evento", "Create an event")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {pick(
              "Monte o pedido no Estoque com tudo o que vai para o local, preencha o destino e clique em Salvar como evento.",
              "Build the order in Stock with everything that goes to the venue, fill in the destination and click Save as event.",
            )}
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-1 cursor-pointer" onClick={() => navigate("/portal/estoque")}>
            {pick("Ir para o Estoque", "Go to Stock")}
          </Button>
        </article>
      </div>
    </ClientModuleShell>
  );
}
