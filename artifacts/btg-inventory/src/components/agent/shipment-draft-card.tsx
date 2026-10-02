import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, PackagePlus, X } from "lucide-react";
import { useLocation } from "wouter";

import {
  draftHref,
  parseDraftSent,
  saveDraft,
  shipmentFormFromDraft,
  shipmentFormProblem,
  shipmentPayloadFromForm,
  type DraftSent,
  type ShipmentDraft,
  type ShipmentForm,
  type ShipmentFormLine,
} from "@/lib/agent-draft";
import { cn } from "@/lib/utils";
import { clientOverviewQueryKey, createClientRequest } from "@/pages/client/shared";

import { SentNotice, field, todaySaoPaulo } from "./order-draft-card";

/**
 * Aviso de envio que o Agent Dute montou (muitas vezes a partir da NF anexada
 * no chat), para conferir e enviar na conversa. Quem envia é a pessoa: o botão
 * chama a mesma criação da tela Envios, ligada à mensagem para nunca virar
 * dois avisos. A nota anexada vai junto.
 */

const integer = new Intl.NumberFormat("pt-BR");

const SITUATION: Record<ShipmentFormLine["situacao"], { label: string; tone: string }> = {
  no_estoque: { label: "no estoque", tone: "bg-emerald-50 text-emerald-800" },
  novo: { label: "produto novo", tone: "bg-amber-50 text-amber-800" },
  codigo_a_definir: { label: "código a definir", tone: "bg-amber-50 text-amber-800" },
};

export function ShipmentDraftCard({ draft, messageId, sent: sentValue }: { draft: ShipmentDraft; messageId?: string; sent?: unknown }) {
  const [form, setForm] = useState<ShipmentForm>(() => shipmentFormFromDraft(draft));
  const [sent, setSent] = useState<DraftSent | null>(() => parseDraftSent(sentValue));
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const problem = shipmentFormProblem(form, todaySaoPaulo());
  const pieces = form.linhas.reduce((sum, line) => sum + line.quantidade, 0);

  const send = useMutation({
    mutationFn: () => createClientRequest(shipmentPayloadFromForm(form, messageId ?? "")),
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
        fallback="Aviso"
        detail="A Dutelog vai confirmar e se programar para a chegada."
        href="/portal/recebimentos"
        linkLabel="Acompanhar em Envios"
      />
    );
  }

  const update = (patch: Partial<ShipmentForm>) => {
    send.reset();
    setForm((current) => ({ ...current, ...patch }));
  };
  const updateLine = (index: number, patch: Partial<ShipmentFormLine>) =>
    update({ linhas: form.linhas.map((line, at) => (at === index ? { ...line, ...patch } : line)) });
  const id = (name: string) => `shipment-${messageId ?? "draft"}-${name}`;

  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-[#d9d0fb] bg-[#faf8ff]">
      <header className="flex items-start gap-2.5 px-4 pt-3">
        <PackagePlus className="mt-0.5 h-4 w-4 shrink-0 text-[#5b3fc4]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Aviso de envio pronto para enviar</p>
          <p className="text-xs text-muted-foreground">
            Confira e ajuste antes de enviar · {integer.format(form.linhas.length)} {form.linhas.length === 1 ? "item" : "itens"} ·{" "}
            {integer.format(pieces)} {pieces === 1 ? "peça" : "peças"}
          </p>
        </div>
      </header>

      <fieldset disabled={send.isPending} className="grid grid-cols-2 gap-2 px-4 pt-3">
        <label className="col-span-2 flex flex-col gap-1" htmlFor={id("fornecedor")}>
          <span className="text-xs font-semibold text-muted-foreground">
            Quem vai entregar (fornecedor) <span className="text-amber-700">*</span>
          </span>
          <input id={id("fornecedor")} value={form.fornecedor} onChange={(event) => update({ fornecedor: event.target.value })} className={field} />
        </label>
        <label className="flex flex-col gap-1" htmlFor={id("nf")}>
          <span className="text-xs font-semibold text-muted-foreground">Nota fiscal</span>
          <input id={id("nf")} value={form.nota_fiscal} onChange={(event) => update({ nota_fiscal: event.target.value })} className={field} />
        </label>
        <label className="flex flex-col gap-1" htmlFor={id("chegada")}>
          <span className="text-xs font-semibold text-muted-foreground">Chega em</span>
          <input id={id("chegada")} type="date" value={form.chegada} onChange={(event) => update({ chegada: event.target.value })} className={field} />
        </label>
      </fieldset>

      {form.linhas.length ? (
        <ul className="mx-4 mt-3 divide-y divide-[#ebe5fd] rounded-xl border border-[#ebe5fd] bg-white text-sm">
          {form.linhas.map((line, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <input
                    aria-label={`Código do item ${index + 1}`}
                    value={line.codigo}
                    placeholder="código a definir"
                    disabled={send.isPending}
                    // Mudou o código: deixa de ser o item do estoque que o agente achou.
                    onChange={(event) =>
                      updateLine(index, {
                        codigo: event.target.value,
                        sku_code: undefined,
                        situacao: event.target.value.trim() ? "novo" : "codigo_a_definir",
                      })
                    }
                    className="w-40 min-w-0 rounded-md border border-transparent bg-transparent px-1 font-mono text-xs text-muted-foreground hover:border-border focus:border-primary/60 focus:outline-none"
                  />
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[11px]", SITUATION[line.situacao].tone)}>{SITUATION[line.situacao].label}</span>
                </span>
                <input
                  aria-label={`Nome do item ${index + 1}`}
                  value={line.nome}
                  placeholder="nome do produto"
                  disabled={send.isPending}
                  onChange={(event) => updateLine(index, { nome: event.target.value })}
                  className="min-w-0 rounded-md border border-transparent bg-transparent px-1 hover:border-border focus:border-primary/60 focus:outline-none"
                />
              </span>
              <input
                aria-label={`Quantidade do item ${index + 1}`}
                inputMode="numeric"
                value={line.quantidade}
                disabled={send.isPending}
                onChange={(event) => updateLine(index, { quantidade: Math.floor(Number(event.target.value.replace(/\D/g, "")) || 0) })}
                className="h-8 w-16 rounded-lg border border-border bg-white text-center tabular-nums outline-none focus:border-primary/60"
              />
              <button
                type="button"
                aria-label={`Tirar item ${index + 1}`}
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

      <div className="grid gap-2 px-4 pt-3">
        <label className="flex flex-col gap-1" htmlFor={id("obs")}>
          <span className="text-xs font-semibold text-muted-foreground">Observações</span>
          <textarea
            id={id("obs")}
            rows={2}
            value={form.observacoes}
            disabled={send.isPending}
            onChange={(event) => update({ observacoes: event.target.value })}
            placeholder="Volumes, transportadora ou contato"
            className={cn(field, "resize-y")}
          />
        </label>
        {form.anexos.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {form.anexos.map((file) => (
              <li key={file.storage_path} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-white px-2 py-1 text-xs">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{file.file_name}</span>
                <button
                  type="button"
                  aria-label={`Não anexar ${file.file_name}`}
                  disabled={send.isPending}
                  onClick={() => update({ anexos: form.anexos.filter((item) => item.storage_path !== file.storage_path) })}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {send.isError ? (
        <p className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {send.error instanceof Error ? send.error.message : "Não consegui enviar agora. Tente de novo."}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => {
            saveDraft(draft);
            navigate(draftHref(draft));
          }}
          className="text-sm font-medium text-primary hover:underline"
        >
          Abrir na tela Envios
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
            {send.isPending ? "Enviando…" : "Enviar aviso"}
          </button>
        </div>
      </div>
    </section>
  );
}
