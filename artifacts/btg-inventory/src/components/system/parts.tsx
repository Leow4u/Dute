import { cn } from "@/lib/utils";

/** Peças comuns do painel do sistema (custo do Agent Dute e infraestrutura). */

export const field =
  "w-full min-w-0 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15";

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(payload.message || "O servidor não respondeu.");
  return payload as T;
}

export const dayTime = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

export function Panel({ title, note, children, action }: { title: string; note?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
        <h2 className="text-sm font-semibold">
          {title} {note ? <span className="font-normal text-muted-foreground">· {note}</span> : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Health({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "ok" | "warn" | "bad" }) {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1.5 flex items-center gap-2 text-lg font-semibold">
        <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", tone === "ok" ? "bg-green-600" : tone === "warn" ? "bg-amber-500" : "bg-red-600")} />
        <span className="min-w-0 truncate">{value}</span>
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
