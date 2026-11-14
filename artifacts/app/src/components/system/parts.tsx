import { Esqueleto } from "@/components/ui/esqueleto";
import { Spinner } from "@/components/ui/spinner";
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

/**
 * O quadro de saúde do painel. Lendo (`lendo`), o valor não é afirmado: o
 * bloco do esqueleto e, passados 300 ms, a caixa de 16 px com o gerúndio no
 * lugar do ponto, nunca o ponto verde (carregamento v2, parte 13e).
 */
export function Health({
  label,
  value,
  detail,
  tone,
  lendo,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "ok" | "warn" | "bad";
  lendo?: { visivel: boolean; calmo: boolean };
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1.5 flex min-h-7 items-center gap-2 text-lg font-semibold">
        {lendo ? (
          lendo.visivel ? (
            <>
              <Spinner tamanho={16} calmo={lendo.calmo} className="text-foreground" />
              <span className="min-w-0 truncate">{value}</span>
            </>
          ) : (
            <Esqueleto forma="texto" className="w-24" />
          )
        ) : (
          <>
            <span
              aria-hidden="true"
              className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", tone === "ok" ? "bg-green-600" : tone === "warn" ? "bg-amber-500" : "bg-red-600")}
            />
            <span className="min-w-0 truncate">{value}</span>
          </>
        )}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
