import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, Minus, Plus, X } from "lucide-react";
import { Link, useLocation } from "wouter";

import {
  draftFromOrderForm,
  draftHref,
  orderFormFromDraft,
  orderFormProblem,
  orderPayloadFromForm,
  parseDraftSent,
  saveDraft,
  withLiveAvailability,
  type DraftSent,
  type OrderDraft,
  type OrderForm,
} from "@/lib/agent-draft";
import { cn } from "@/lib/utils";
import {
  clientOverviewQueryKey,
  createClientRequest,
  getInventoryItems,
  inventoryItemAvailable,
  inventoryItemSku,
  useClientOverview,
} from "@/pages/client/shared";

/**
 * Pedido que o Agent Dute montou, para conferir e enviar na própria conversa.
 * Quem envia é a pessoa: o botão chama a mesma criação de pedido do Estoque
 * (saldo, reserva e evento no servidor), ligada à mensagem para nunca virar
 * dois pedidos. Enviado, o cartão mostra o número do pedido.
 */

const integer = new Intl.NumberFormat("pt-BR");
const todayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const sentFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export const field =
  "w-full min-w-0 rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15";

function useAvailableBySku() {
  const overview = useClientOverview();
  return useMemo(() => {
    if (!overview.data) return null;
    const map = new Map<string, number>();
    for (const item of getInventoryItems(overview.data)) {
      const sku = inventoryItemSku(item);
      map.set(sku, (map.get(sku) ?? 0) + inventoryItemAvailable(item));
    }
    return map;
  }, [overview.data]);
}

/** Dia de hoje em São Paulo, AAAA-MM-DD. */
export function todaySaoPaulo() {
  return todayFormat.format(new Date());
}

/** Cartão depois de enviado: número, quando e o link para acompanhar. */
export function SentNotice({
  sent,
  fallback,
  detail,
  href,
  linkLabel,
}: {
  sent: DraftSent;
  fallback: string;
  detail: string;
  href: string;
  linkLabel: string;
}) {
  const at = sent.sent_at ? new Date(sent.sent_at) : null;
  return (
    <section className="mt-3 rounded-2xl border border-border bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          {sent.request_number || fallback} enviado
        </p>
        {at && !Number.isNaN(at.getTime()) ? <span className="text-xs text-muted-foreground">em {sentFormat.format(at)}</span> : null}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      <Link href={href} className="mt-1.5 inline-block text-sm font-medium text-primary hover:underline">
        {linkLabel} ›
      </Link>
    </section>
  );
}

export function OrderDraftCard({ draft, messageId, sent: sentValue }: { draft: OrderDraft; messageId?: string; sent?: unknown }) {
  const [form, setForm] = useState<OrderForm>(() => orderFormFromDraft(draft));
  const [sent, setSent] = useState<DraftSent | null>(() => parseDraftSent(sentValue));
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const view = withLiveAvailability(form, useAvailableBySku());
  const problem = orderFormProblem(view, todaySaoPaulo());
  const pieces = view.linhas.reduce((sum, line) => sum + line.quantidade, 0);

  const send = useMutation({
    mutationFn: () => createClientRequest(orderPayloadFromForm(view, messageId ?? "")),
    onSuccess: async (request) => {
      setSent({ request_id: String(request.id ?? ""), request_number: String(request.request_number ?? ""), sent_at: new Date().toISOString() });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: clientOverviewQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["agent-dute-chat"] }),
      ]);
    },
  });

  if (sent) {
    return (
      <SentNotice
        sent={sent}
        fallback="Pedido"
        detail="Aguardando a Dutelog confirmar. As peças já ficam reservadas."
        href="/portal/pedidos"
        linkLabel="Acompanhar em Pedidos"
      />
    );
  }

  const update = (patch: Partial<OrderForm>) => {
    send.reset();
    setForm((current) => ({ ...current, ...patch }));
  };
  const setQuantity = (index: number, quantity: number) =>
    update({ linhas: form.linhas.map((line, at) => (at === index ? { ...line, quantidade: Math.max(1, quantity) } : line)) });
  const id = (name: string) => `order-${messageId ?? "draft"}-${name}`;

  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-[#d9d0fb] bg-[#faf8ff]">
      <header className="flex items-start gap-2.5 px-4 pt-3">
        <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#5b3fc4]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Pedido pronto para enviar</p>
          <p className="text-xs text-muted-foreground">
            Confira e ajuste antes de enviar · {integer.format(view.linhas.length)} {view.linhas.length === 1 ? "item" : "itens"} ·{" "}
            {integer.format(pieces)} {pieces === 1 ? "peça" : "peças"}
          </p>
        </div>
      </header>

      {view.linhas.length ? (
        <ul className="mx-4 mt-2 divide-y divide-[#ebe5fd] rounded-xl border border-[#ebe5fd] bg-white text-sm">
          {view.linhas.map((line, index) => (
            <li key={`${line.sku_code}-${index}`} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block break-words">
                  {line.codigo ? <span className="mr-1.5 font-mono text-xs text-muted-foreground">{line.codigo}</span> : null}
                  {line.nome}
                  {line.detalhe ? <span className="text-muted-foreground"> · {line.detalhe}</span> : null}
                </span>
                <span className={cn("block text-xs", line.quantidade > line.disponivel ? "text-red-700" : "text-muted-foreground")}>
                  {integer.format(line.disponivel)} disponíveis
                </span>
              </span>
              <span className="flex shrink-0 items-center overflow-hidden rounded-lg border border-border">
                <button
                  type="button"
                  aria-label={`Menos ${line.nome}`}
                  onClick={() => setQuantity(index, line.quantidade - 1)}
                  disabled={line.quantidade <= 1 || send.isPending}
                  className="grid h-8 w-7 place-items-center bg-muted/60 disabled:opacity-40"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <input
                  aria-label={`Quantidade de ${line.nome}`}
                  inputMode="numeric"
                  value={line.quantidade}
                  onChange={(event) => setQuantity(index, Math.floor(Number(event.target.value.replace(/\D/g, "")) || 1))}
                  disabled={send.isPending}
                  className="h-8 w-12 bg-white text-center tabular-nums outline-none"
                />
                <button
                  type="button"
                  aria-label={`Mais ${line.nome}`}
                  onClick={() => setQuantity(index, line.quantidade + 1)}
                  disabled={line.quantidade >= line.disponivel || send.isPending}
                  className="grid h-8 w-7 place-items-center bg-muted/60 disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </span>
              <button
                type="button"
                aria-label={`Tirar ${line.nome}`}
                onClick={() => update({ linhas: form.linhas.filter((_, at) => at !== index) })}
                disabled={send.isPending}
                className="grid h-8 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {draft.pendencias.length ? (
        <ul className="mx-4 mt-2 flex flex-col gap-1 text-xs text-amber-800">
          {draft.pendencias.map((item, index) => (
            <li key={index} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                <b className="font-semibold">{item.item}</b>: {item.motivo}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <fieldset disabled={send.isPending} className="grid grid-cols-2 gap-2 px-4 pt-3">
        <label className="col-span-2 flex flex-col gap-1" htmlFor={id("destino")}>
          <span className="text-xs font-semibold text-muted-foreground">
            Onde entregar <span className="text-amber-700">*</span>
          </span>
          <input
            id={id("destino")}
            value={form.destino}
            onChange={(event) => update({ destino: event.target.value })}
            placeholder="Agência, prédio ou centro de custo"
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1" htmlFor={id("dia")}>
          <span className="text-xs font-semibold text-muted-foreground">Para quando</span>
          <input id={id("dia")} type="date" value={form.dia} onChange={(event) => update({ dia: event.target.value })} className={field} />
        </label>
        <label className="flex flex-col gap-1" htmlFor={id("hora")}>
          <span className="text-xs font-semibold text-muted-foreground">Até que horas</span>
          <input
            id={id("hora")}
            type="time"
            value={form.hora}
            disabled={!form.dia}
            onChange={(event) => update({ hora: event.target.value })}
            className={cn(field, "disabled:opacity-50")}
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1" htmlFor={id("nome")}>
          <span className="text-xs font-semibold text-muted-foreground">Nome do pedido (opcional)</span>
          <input
            id={id("nome")}
            value={form.nome}
            onChange={(event) => update({ nome: event.target.value })}
            placeholder="Ex.: Abastecimento Faria Lima"
            className={field}
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1" htmlFor={id("obs")}>
          <span className="text-xs font-semibold text-muted-foreground">Observações</span>
          <textarea
            id={id("obs")}
            rows={2}
            value={form.observacoes}
            onChange={(event) => update({ observacoes: event.target.value })}
            placeholder="Contato, janela de entrega ou restrições"
            className={cn(field, "resize-y")}
          />
        </label>
      </fieldset>

      {send.isError ? (
        <p className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {send.error instanceof Error ? send.error.message : "Não consegui enviar agora. Tente de novo."}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => {
            const next = draftFromOrderForm(view);
            saveDraft(next);
            navigate(draftHref(next));
          }}
          className="text-sm font-medium text-primary hover:underline"
        >
          Abrir no Estoque para adicionar itens
        </button>
        <div className="flex items-center gap-3">
          {problem ? <span className="text-xs text-amber-800">{problem}</span> : null}
          <button
            type="button"
            disabled={Boolean(problem) || !messageId || send.isPending}
            onClick={() => send.mutate()}
            className="inline-flex items-center gap-2 rounded-xl bg-foreground px-3.5 py-2 text-sm font-semibold text-background hover:bg-foreground/85 disabled:opacity-50"
          >
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {send.isPending ? "Enviando…" : "Enviar pedido"}
          </button>
        </div>
      </div>
    </section>
  );
}
