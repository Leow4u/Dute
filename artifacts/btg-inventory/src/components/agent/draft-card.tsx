import { ClipboardCheck } from "lucide-react";
import { useLocation } from "wouter";

import { draftHref, parseDraft, saveDraft } from "@/lib/agent-draft";

import { OrderDraftCard } from "./order-draft-card";

const integer = new Intl.NumberFormat("pt-BR");

function dayLabel(day: string | undefined) {
  if (!day) return "";
  const date = new Date(`${day}T12:00:00-03:00`);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
}

const SHIPMENT_STATUS = { no_estoque: "", novo: "produto novo", codigo_a_definir: "código a definir" } as const;

/**
 * Cartão do rascunho que o Agent Dute montou. O pedido se confere e envia no
 * próprio cartão (OrderDraftCard); o aviso de envio guarda o rascunho na aba e
 * abre a tela Envios já preenchida.
 */
export function DraftCard({ value, messageId, sent }: { value: unknown; messageId?: string; sent?: unknown }) {
  const [, navigate] = useLocation();
  const draft = parseDraft(value);
  if (!draft) return null;
  if (draft.tipo === "pedido") return <OrderDraftCard draft={draft} messageId={messageId} sent={sent} />;
  const pieces = draft.linhas.reduce((sum, line) => sum + line.quantidade, 0);
  const meta = [draft.fornecedor, draft.nota_fiscal ? `NF ${draft.nota_fiscal}` : "", draft.chegada ? `chega ${dayLabel(draft.chegada)}` : ""];
  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-[#d9d0fb] bg-[#faf8ff]">
      <header className="flex items-start gap-2.5 px-4 pt-3">
        <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#5b3fc4]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Rascunho de aviso de envio</p>
          <p className="text-xs text-muted-foreground">
            {[...meta.filter(Boolean), `${integer.format(draft.linhas.length)} ${draft.linhas.length === 1 ? "item" : "itens"}`, `${integer.format(pieces)} peças`].join(" · ")}
          </p>
        </div>
      </header>
      {draft.linhas.length ? (
        <ul className="mx-4 mt-2 divide-y divide-[#ebe5fd] rounded-xl border border-[#ebe5fd] bg-white text-sm">
          {draft.linhas.slice(0, 8).map((line, index) => (
            <li key={index} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
              <span className="min-w-0 truncate">
                {line.codigo ? <span className="mr-1.5 font-mono text-xs text-muted-foreground">{line.codigo}</span> : null}
                {line.nome}
                {SHIPMENT_STATUS[line.situacao] ? (
                  <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">{SHIPMENT_STATUS[line.situacao]}</span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums">{integer.format(line.quantidade)}</span>
            </li>
          ))}
          {draft.linhas.length > 8 ? <li className="px-3 py-1.5 text-xs text-muted-foreground">e mais {draft.linhas.length - 8}</li> : null}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <span className="text-xs text-muted-foreground">Nada foi enviado. Confira na tela Envios e envie você.</span>
        <button
          type="button"
          disabled={!draft.linhas.length}
          onClick={() => {
            saveDraft(draft);
            navigate(draftHref(draft));
          }}
          className="rounded-xl bg-foreground px-3.5 py-2 text-sm font-semibold text-background hover:bg-foreground/85 disabled:opacity-50"
        >
          Abrir para conferir e enviar
        </button>
      </div>
    </section>
  );
}
