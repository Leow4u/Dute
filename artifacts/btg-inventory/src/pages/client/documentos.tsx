import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Link } from "wouter";

import { closedInvoices } from "@/lib/billing-insights";
import {
  PORTAL_DOCUMENT_KINDS,
  countByKind,
  filterPortalDocuments,
  portalDocuments,
  type PortalDocument,
  type PortalDocumentGroup,
  type PortalDocumentKind,
} from "@/lib/portal-documents";
import { cn } from "@/lib/utils";

import { ClientDataBoundary, getInvoices, getRequests } from "./shared";

/**
 * Documentos do portal: o que a Dutelog publicou para a BTG, as notas fiscais
 * que a BTG anexou nos avisos de envio e as faturas fechadas, com busca por
 * nome, PED-, ENV- ou número da NF.
 */

const GROUPS: Array<{ group: PortalDocumentGroup; label: string }> = [
  { group: "dutelog", label: "Publicados pela Dutelog" },
  { group: "nf", label: "Suas notas fiscais (anexadas nos avisos de envio)" },
  { group: "fatura", label: "Faturas" },
];

export function ClienteDocumentos() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<PortalDocumentKind | "all">("all");
  return (
    <ClientDataBoundary>
      {(overview) => {
        const rows = portalDocuments(
          overview.document_history ?? [],
          (overview.request_history ?? getRequests(overview)) as Record<string, unknown>[],
          closedInvoices((overview.invoice_history ?? getInvoices(overview)) as Record<string, unknown>[]),
        );
        const counts = countByKind(rows);
        const visible = filterPortalDocuments(rows, { search, kind });
        const chips = PORTAL_DOCUMENT_KINDS.filter((item) => counts.get(item.kind));
        return (
          <main className="h-full min-h-0 w-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-8">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">Documentos</h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">Contratos, comprovantes, notas fiscais e faturas da sua conta.</p>
                </div>
                {rows.length ? (
                  <label className="flex w-full max-w-sm items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-sm sm:w-auto sm:min-w-[300px]">
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar por nome, PED-0043, NF 2471…"
                      aria-label="Buscar documentos"
                      className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground"
                    />
                  </label>
                ) : null}
              </header>

              {!rows.length ? (
                <p className="rounded-[18px] border border-dashed border-border bg-white/60 px-5 py-8 text-sm text-muted-foreground">
                  Nenhum documento ainda. Contratos e comprovantes que a Dutelog publicar, as notas fiscais dos seus avisos de envio e as faturas fechadas aparecem aqui.
                </p>
              ) : (
                <>
                  {chips.length > 1 ? (
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de documento">
                      <Chip active={kind === "all"} onClick={() => setKind("all")}>Todos · {rows.length}</Chip>
                      {chips.map((item) => (
                        <Chip key={item.kind} active={kind === item.kind} onClick={() => setKind(item.kind)}>
                          {item.label} · {counts.get(item.kind)}
                        </Chip>
                      ))}
                    </div>
                  ) : null}

                  {!visible.length ? (
                    <p className="rounded-[18px] border border-dashed border-border bg-white/60 px-5 py-6 text-sm text-muted-foreground">
                      Nada encontrado{search.trim() ? ` para "${search.trim()}"` : ""}.
                    </p>
                  ) : (
                    GROUPS.map(({ group, label }) => {
                      const items = visible.filter((row) => row.group === group);
                      if (!items.length) return null;
                      return (
                        <section key={group} className="flex flex-col gap-2">
                          <h2 className="px-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h2>
                          <DocumentList rows={items} />
                        </section>
                      );
                    })
                  )}
                </>
              )}
            </div>
          </main>
        );
      }}
    </ClientDataBoundary>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium",
        active ? "border-foreground bg-foreground text-background" : "border-border bg-white text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const FORMAT_TONE: Record<string, string> = {
  PDF: "bg-red-50 text-red-700",
  JPG: "bg-blue-50 text-blue-700",
  PNG: "bg-blue-50 text-blue-700",
  XLSX: "bg-emerald-50 text-emerald-700",
  XLS: "bg-emerald-50 text-emerald-700",
  CSV: "bg-emerald-50 text-emerald-700",
};

export function DocumentList({ rows }: { rows: PortalDocument[] }) {
  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-[18px] border border-border bg-white">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 px-4 py-3 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto]">
          <span className={cn("grid h-9 w-9 place-items-center rounded-lg text-[10px] font-bold", FORMAT_TONE[row.format] ?? "bg-muted text-muted-foreground")}>
            {row.format}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" title={row.title}>{row.title}</p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <span>{row.typeLabel}</span>
              {row.reference ? <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{row.reference}</span> : null}
              {row.detail ? <span>· {row.detail}</span> : null}
            </p>
          </div>
          <div className="col-start-2 flex gap-4 text-sm font-medium sm:col-start-auto">
            {row.href ? (
              <a href={row.href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                Abrir
              </a>
            ) : null}
            {row.link ? (
              <Link href={row.link.href} className="text-primary hover:underline">
                {row.link.label}
              </Link>
            ) : null}
            {!row.href && !row.link ? <span className="text-xs text-muted-foreground">Arquivo indisponível</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
