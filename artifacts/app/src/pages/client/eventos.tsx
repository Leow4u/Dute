/*
 * Portal › Eventos: cada evento guarda o que vai para o local (cenografia,
 * mobiliário, brindes), onde é e como a Dutelog leva, monta e traz de volta.
 * "Usar no pedido" abre o Estoque com o pedido preenchido; quem confere e
 * envia é a pessoa. Nada aqui movimenta estoque.
 */
import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  MapPin,
  Package,
  Pencil,
  Send,
  Trash2,
  Truck,
  X,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  eventDateLabel,
  eventPiecesValue,
  eventShortages,
  isUpcoming,
  productForEventItem,
  sortEvents,
  type ClientEvent,
  type ClientEventItem,
  type EventStockProduct,
} from "@/lib/client-events";

import { groupInventoryProducts } from "./estoque";
import { useArchiveClientEvent, useClientEvents, useSaveClientEvent } from "./events-api";
import {
  ClientDataBoundary,
  ClientModuleLoading,
  ClientModuleShell,
  EmptyModuleState,
  formatMoney,
  formatNumber,
  getInventoryItems,
} from "./shared";

/** Itens à mostra antes de "ver todos": evento grande passa de 15 linhas. */
const PREVIEW_ITEMS = 6;

export function ClienteEventos() {
  const events = useClientEvents();
  const archive = useArchiveClientEvent();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<ClientEvent | null>(null);
  const [removing, setRemoving] = useState<ClientEvent | null>(null);

  function remove(event: ClientEvent) {
    archive.mutate(event.id, {
      onSuccess: () => toast({ title: "Evento excluído", description: event.name }),
      onError: (error) =>
        toast({ title: "Não foi possível excluir", description: error instanceof Error ? error.message : "", variant: "destructive" }),
      onSettled: () => setRemoving(null),
    });
  }

  return (
    <ClientDataBoundary>
      {(overview) => {
        if (events.isLoading) return <ClientModuleLoading title="Carregando eventos" />;
        const products = groupInventoryProducts(getInventoryItems(overview));
        const list = sortEvents(events.data ?? []);
        return (
          <ClientModuleShell
            overview={overview}
            title="Eventos"
            description="Cada evento já tem a lista do que vai para o local. Na próxima edição, é só usar no pedido: a Dutelog leva, monta e traz de volta."
            icon={CalendarDays}
          >
            {events.isError ? (
              <EmptyModuleState
                icon={AlertTriangle}
                title="Não foi possível carregar os eventos"
                description={events.error?.message || "Tente de novo em alguns instantes."}
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {list.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    products={products}
                    open={expanded[event.id] ?? false}
                    onToggle={() => setExpanded((current) => ({ ...current, [event.id]: !current[event.id] }))}
                    onEdit={() => setEditing(event)}
                    onRemove={() => setRemoving(event)}
                    onUse={() => navigate(`/portal/estoque?evento=${encodeURIComponent(event.id)}`)}
                  />
                ))}
                <article className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-center">
                  <CalendarDays className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                  <p className="font-medium">{list.length ? "Criar outro evento" : "Nenhum evento ainda"}</p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Monte o pedido no Estoque com tudo o que vai para o local, preencha onde entregar e clique em Salvar como evento.
                  </p>
                  <Button type="button" variant="outline" size="sm" className="mt-1 cursor-pointer" onClick={() => navigate("/portal/estoque")}>
                    Ir para o Estoque
                  </Button>
                </article>
              </div>
            )}

            {editing ? <EventEditDialog event={editing} onClose={() => setEditing(null)} /> : null}

            <AlertDialog open={Boolean(removing)} onOpenChange={(open) => (!open ? setRemoving(null) : null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir {removing?.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O evento sai da lista. Pedidos já enviados com ele continuam como estão.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={archive.isPending}
                    onClick={(click) => {
                      click.preventDefault();
                      if (removing) remove(removing);
                    }}
                  >
                    Excluir
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </ClientModuleShell>
        );
      }}
    </ClientDataBoundary>
  );
}

function EventCard({
  event,
  products,
  open,
  onToggle,
  onEdit,
  onRemove,
  onUse,
}: {
  event: ClientEvent;
  products: EventStockProduct[];
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onUse: () => void;
}) {
  const pieces = event.items.reduce((sum, item) => sum + item.quantity, 0);
  const value = eventPiecesValue(event, products);
  const shortages = eventShortages(event, products);
  const shown = open ? event.items : event.items.slice(0, PREVIEW_ITEMS);
  const when = eventDateLabel(event.next_date);
  const upcoming = isUpcoming(event);

  return (
    <article className="flex flex-col rounded-lg border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="font-semibold">{event.name}</h2>
          {event.description ? <p className="mt-0.5 text-sm text-muted-foreground">{event.description}</p> : null}
        </div>
        {when ? (
          <span
            className={
              upcoming
                ? "shrink-0 rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary"
                : "shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground"
            }
          >
            {upcoming ? "Próxima edição" : "Última data"} · {when}
          </span>
        ) : null}
      </header>

      <div className="flex flex-col gap-1.5 border-b border-border/60 px-4 py-3 text-sm text-muted-foreground">
        <span className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium text-foreground">{event.venue}</span>
            {event.address ? ` · ${event.address}` : null}
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
        {shown.map((item, index) => {
          const photo = productForEventItem(item, products)?.photoUrl;
          return (
            <li key={`${item.sku_code}-${item.client_item_code ?? ""}-${index}`} className="flex items-center gap-3 py-2">
              <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                {photo ? (
                  <img src={photo} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <Package className="m-2.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{item.product_name}</span>
                {item.client_item_code ? (
                  <span className="block truncate text-xs text-muted-foreground">{item.client_item_code}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-sm font-medium">× {formatNumber(item.quantity)}</span>
            </li>
          );
        })}
      </ul>
      {event.items.length > PREVIEW_ITEMS ? (
        <Button type="button" variant="ghost" size="sm" className="mx-2 mb-2 cursor-pointer self-start text-primary" onClick={onToggle}>
          {open ? "Mostrar menos" : `Ver os ${formatNumber(event.items.length)} itens`}
        </Button>
      ) : null}

      <div className="border-t border-border/60 px-4 py-3 text-sm">
        {shortages.length ? (
          <p className="flex items-start gap-2 text-warning-soft-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Falta no estoque de hoje:{" "}
              {shortages
                .map((item) => `${item.name} (precisa ${formatNumber(item.need)}, há ${formatNumber(item.have)})`)
                .join("; ")}
            </span>
          </p>
        ) : (
          <p className="flex items-center gap-2 text-success-soft-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            Tudo disponível no estoque de hoje
          </p>
        )}
        <p className="mt-1 text-muted-foreground">
          {formatNumber(event.items.length)} {event.items.length === 1 ? "item" : "itens"} · {formatNumber(pieces)} peças
          {value > 0 ? ` · ${formatMoney(value)} em peças (base do seguro de transporte)` : ""}
        </p>
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-border/60 px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="cursor-pointer text-muted-foreground"
          aria-label={`Excluir ${event.name}`}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button type="button" variant="outline" size="sm" className="cursor-pointer" onClick={onEdit}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Editar
        </Button>
        <Button type="button" size="sm" className="cursor-pointer" onClick={onUse}>
          <Send className="h-4 w-4" aria-hidden="true" />
          Usar no pedido
        </Button>
      </footer>
    </article>
  );
}

/** Editar dados e quantidades. Item novo entra pelo Estoque (Salvar como evento). */
function EventEditDialog({ event, onClose }: { event: ClientEvent; onClose: () => void }) {
  const save = useSaveClientEvent();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: event.name,
    description: event.description ?? "",
    venue: event.venue,
    address: event.address ?? "",
    next_date: event.next_date ?? "",
    schedule: event.schedule ?? "",
    logistics: event.logistics ?? "",
  });
  const [items, setItems] = useState<ClientEventItem[]>(() => event.items.map((item) => ({ ...item })));
  const set = (field: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [field]: value }));
  const valid = form.name.trim() && form.venue.trim() && items.length > 0 && items.every((item) => item.quantity >= 1);

  function submit() {
    if (!valid) return;
    save.mutate(
      {
        id: event.id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        venue: form.venue.trim(),
        address: form.address.trim() || null,
        next_date: form.next_date || null,
        schedule: form.schedule.trim() || null,
        logistics: form.logistics.trim() || null,
        items,
      },
      {
        onSuccess: () => {
          toast({ title: "Evento salvo", description: form.name.trim() });
          onClose();
        },
        onError: (error) =>
          toast({ title: "Evento não salvo", description: error instanceof Error ? error.message : "", variant: "destructive" }),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Editar evento</DialogTitle>
          <DialogDescription>Mude a data da próxima edição, o local, a montagem e as quantidades.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
            <Field id="event-name" label="Nome" required>
              <Input id="event-name" value={form.name} onChange={(change) => set("name")(change.target.value)} maxLength={120} />
            </Field>
            <Field id="event-date" label="Próxima edição">
              <Input id="event-date" type="date" value={form.next_date} onChange={(change) => set("next_date")(change.target.value)} />
            </Field>
          </div>
          <Field id="event-description" label="Descrição">
            <Input
              id="event-description"
              value={form.description}
              onChange={(change) => set("description")(change.target.value)}
              placeholder="Ex.: palco, lounge e área de fotos"
              maxLength={300}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="event-venue" label="Local" required>
              <Input id="event-venue" value={form.venue} onChange={(change) => set("venue")(change.target.value)} maxLength={160} />
            </Field>
            <Field id="event-address" label="Endereço">
              <Input id="event-address" value={form.address} onChange={(change) => set("address")(change.target.value)} maxLength={300} />
            </Field>
          </div>
          <Field id="event-schedule" label="Montagem e retorno">
            <Textarea
              id="event-schedule"
              rows={2}
              value={form.schedule}
              onChange={(change) => set("schedule")(change.target.value)}
              placeholder="Ex.: montagem na véspera a partir das 7h, retorno ao galpão no dia seguinte"
              maxLength={300}
            />
          </Field>
          <Field id="event-logistics" label="Transporte e equipe">
            <Textarea
              id="event-logistics"
              rows={2}
              value={form.logistics}
              onChange={(change) => set("logistics")(change.target.value)}
              placeholder="Ex.: 1 caminhão baú e 4 montadores"
              maxLength={300}
            />
          </Field>

          <div className="space-y-1.5">
            <Label>Itens</Label>
            <ul className="divide-y divide-border/50 rounded-lg border border-border">
              {items.map((item, index) => (
                <li key={`${item.sku_code}-${item.client_item_code ?? ""}-${index}`} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{item.product_name}</span>
                  <Input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    aria-label={`Quantidade de ${item.product_name}`}
                    className="h-9 w-24"
                    value={item.quantity}
                    onChange={(change) => {
                      const quantity = Math.max(0, Math.floor(Number(change.target.value) || 0));
                      setItems((current) => current.map((entry, at) => (at === index ? { ...entry, quantity } : entry)));
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer text-muted-foreground"
                    aria-label={`Tirar ${item.product_name} do evento`}
                    disabled={items.length === 1}
                    onClick={() => setItems((current) => current.filter((_, at) => at !== index))}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Para incluir itens, use no pedido, ajuste no Estoque e salve como um novo evento.</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, required, children }: { id: string; label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </Label>
      {children}
    </div>
  );
}
