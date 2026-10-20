import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Lista de fila (Pedidos, Receber): grupos com título e contagem, linhas com
 * ícone, título, apoio e ações. O mesmo desenho nas duas telas.
 */

export const QUEUE_TONE = {
  approve: "bg-warning-soft text-warning-soft-foreground",
  pick: "bg-info-soft text-info-soft-foreground",
  deliver: "bg-success-soft text-success-soft-foreground",
  check: "bg-info-soft text-info-soft-foreground",
  store: "bg-success-soft text-success-soft-foreground",
  done: "bg-muted text-muted-foreground",
} as const;

export type QueueTone = keyof typeof QUEUE_TONE;

export function QueueGroup({
  title,
  hint,
  count,
  empty,
  children,
}: {
  title: string;
  hint?: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="flex items-baseline gap-2 px-1">
        <span className="text-base font-semibold text-foreground">{title}</span>
        <span className="text-sm text-foreground/50">
          {[hint, count ? String(count) : null].filter(Boolean).join(" · ")}
        </span>
      </h2>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {count > 0 ? (
          <div className="divide-y divide-border/60">{children}</div>
        ) : (
          <p className="px-5 py-4 text-sm text-muted-foreground">{empty}</p>
        )}
      </div>
    </section>
  );
}

export function QueueRow({
  icon: Icon,
  tone,
  title,
  meta,
  age,
  note,
  actions,
  onToggle,
  open,
  actionsClassName,
  className,
}: {
  actionsClassName?: string;
  className?: string;
  icon: LucideIcon;
  tone: QueueTone;
  title: string;
  meta: string;
  age?: string;
  note?: ReactNode;
  actions?: ReactNode;
  onToggle?: () => void;
  open?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 md:px-5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", QUEUE_TONE[tone])}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-sm text-foreground/60">
            {meta}
            {age ? <span className="text-foreground/45"> · {age}</span> : null}
          </p>
          {note ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-warning-soft-foreground">{note}</p>
          ) : null}
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary"
            >
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              {open ? "Esconder itens" : "Ver itens"}
            </button>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div
          className={cn(
            "flex shrink-0 gap-2 [&>*]:flex-1 sm:[&>*]:flex-none",
            actionsClassName,
          )}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
