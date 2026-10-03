import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  Clock3,
  Download,
  Truck,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
import { canAccessModule, type ProfileRole } from "@/lib/modules";
import {
  GO_LIVE,
  belowMinimumReport,
  competenciaOf,
  dayRange,
  formatCell,
  idleReport,
  monthRange,
  movementsReport,
  positionReport,
  previousCompetencia,
  requestsReport,
  toExcelCsv,
  type ReportResult,
} from "@/lib/reports";
import { buildStockItems } from "@/lib/stock-items";
import { cn } from "@/lib/utils";
import {
  getQuantityTotal,
  getRequestValidationLines,
  normalizeStatus,
  parseRequestDate,
  requestTypeLabel,
  type CustomerRequest,
} from "./customer-requests";

/**
 * Relatórios: escolha à esquerda, prévia e números à direita, planilha que
 * abre direto no Excel. As fontes são as das telas (Estoque, ledger de
 * movimentações, pedidos); nada é recalculado por outro caminho.
 */

type AnyRecord = Record<string, unknown>;
type ReportId = "position" | "below-minimum" | "idle" | "movements" | "requests";
type PeriodPreset = "this-month" | "last-month" | "last-7" | "custom";

// Quem lê estoque/pedidos pelas Firestore Rules (canReadOperations). O
// financeiro lê o ledger (canReadForBilling), então vê só Movimentações.
const OPERATIONS_READERS: ProfileRole[] = ["owner", "admin", "interno", "suporte"];
const LEDGER_READERS: ProfileRole[] = [...OPERATIONS_READERS, "financeiro"];

const REPORTS: Array<{
  id: ReportId;
  group: "Estoque" | "Operação";
  title: string;
  hint: string;
  description: string;
  icon: LucideIcon;
  roles: ProfileRole[];
  preview: string[];
  file: string;
}> = [
  {
    id: "position",
    group: "Estoque",
    title: "Posição de estoque",
    hint: "Saldo e valor de cada item",
    description: "Saldo de cada item, onde está e quanto vale. Os mesmos números da tela Estoque.",
    icon: Boxes,
    roles: OPERATIONS_READERS,
    preview: ["code", "name", "locations", "onHand", "reserved", "value"],
    file: "posicao-estoque",
  },
  {
    id: "below-minimum",
    group: "Estoque",
    title: "Abaixo do mínimo",
    hint: "Itens para repor",
    description: "Itens com saldo igual ou abaixo do mínimo cadastrado na ficha. Item sem mínimo não entra.",
    icon: AlertTriangle,
    roles: OPERATIONS_READERS,
    preview: ["code", "name", "locations", "onHand", "minimum", "missing"],
    file: "abaixo-do-minimo",
  },
  {
    id: "idle",
    group: "Estoque",
    title: "Itens parados",
    hint: "Sem entrada nem saída",
    description:
      "Itens com saldo que não entram nem saem há muito tempo. Ocupam posição e pesam no Ad Valorem: bom assunto para conversar com a BTG.",
    icon: Clock3,
    roles: OPERATIONS_READERS,
    preview: ["code", "name", "onHand", "value", "lastMove", "idleDays"],
    file: "itens-parados",
  },
  {
    id: "movements",
    group: "Operação",
    title: "Movimentações",
    hint: "Entradas, saídas e ajustes",
    description: "Tudo que entrou, saiu ou foi ajustado no estoque, com o saldo antes e depois e quem fez.",
    icon: ArrowLeftRight,
    roles: LEDGER_READERS,
    preview: ["date", "kind", "name", "quantity", "origin", "who"],
    file: "movimentacoes",
  },
  {
    id: "requests",
    group: "Operação",
    title: "Pedidos",
    hint: "Pedidos e avisos",
    description: "O que a BTG pediu no período: quem pediu, o que aconteceu e quem decidiu.",
    icon: Truck,
    roles: OPERATIONS_READERS,
    preview: ["created", "type", "requestedBy", "lines", "units", "status", "decidedBy"],
    file: "pedidos",
  },
];

const IDLE_OPTIONS = [30, 60, 90];
const PREVIEW_ROWS = 8;

const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

function competenciaLabel(competencia: string) {
  const text = monthLabel.format(new Date(`${competencia}-15T12:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1).replace(" de ", "/");
}

function todayIso() {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
}

function shiftDay(day: string, delta: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || "Não foi possível carregar os dados.");
  return payload;
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const requestHelpers = {
  date: parseRequestDate,
  type: requestTypeLabel,
  status: (status?: string | null) => normalizeStatus(status),
  lines: (request: AnyRecord) => getRequestValidationLines(request as CustomerRequest).length,
  units: (request: AnyRecord) => getQuantityTotal(request as CustomerRequest),
};

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-foreground/75 hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

export default function Reports() {
  const { user } = useAppUser();
  const { toast } = useToast();
  const role = user?.publicMetadata.role;
  const available = REPORTS.filter((report) => canAccessModule(role, report.roles));
  const [selectedId, setSelectedId] = useState<ReportId>(available[0]?.id ?? "movements");
  const selected = available.find((report) => report.id === selectedId) ?? available[0];

  const thisMonth = competenciaOf(new Date());
  const [preset, setPreset] = useState<PeriodPreset>("this-month");
  const [customFrom, setCustomFrom] = useState(shiftDay(todayIso(), -29));
  const [customTo, setCustomTo] = useState(todayIso());
  const [idleDays, setIdleDays] = useState(60);

  const period = useMemo(() => {
    if (preset === "last-month") {
      const competencia = previousCompetencia(thisMonth);
      return { ...monthRange(competencia), label: competenciaLabel(competencia), slug: competencia };
    }
    if (preset === "last-7") {
      const to = todayIso();
      const from = shiftDay(to, -6);
      return { ...dayRange(from, to), label: "Últimos 7 dias", slug: `${from}_a_${to}` };
    }
    if (preset === "custom" && customFrom && customTo && customFrom <= customTo) {
      return {
        ...dayRange(customFrom, customTo),
        label: `${customFrom.split("-").reverse().join("/")} a ${customTo.split("-").reverse().join("/")}`,
        slug: `${customFrom}_a_${customTo}`,
      };
    }
    return { ...monthRange(thisMonth), label: competenciaLabel(thisMonth), slug: thisMonth };
  }, [customFrom, customTo, preset, thisMonth]);

  const needsStock = selected?.id === "position" || selected?.id === "below-minimum" || selected?.id === "idle";
  const canReadStock = canAccessModule(role, OPERATIONS_READERS);

  // Mesmas chaves e endereços da tela Estoque: o cache é compartilhado.
  const skus = useQuery({
    queryKey: ["estoque", "skus"],
    queryFn: () => fetchJson<{ items: AnyRecord[] }>("/api/skus?limit=2000"),
    enabled: canReadStock,
  });
  const balances = useQuery({
    queryKey: ["stock-balances", "estoque"],
    queryFn: () => fetchJson<{ items: AnyRecord[] }>("/api/stock-balances?limit=2000"),
    enabled: canReadStock,
  });
  const products = useQuery({
    queryKey: ["estoque", "products"],
    queryFn: () => fetchJson<{ items: AnyRecord[] }>("/api/products?limit=2000"),
    enabled: canReadStock,
  });
  const items = useMemo(
    () =>
      buildStockItems({
        skus: skus.data?.items,
        balances: balances.data?.items,
        products: products.data?.items,
      }),
    [balances.data?.items, products.data?.items, skus.data?.items],
  );
  const stockLoading = skus.isLoading || balances.isLoading || products.isLoading;
  const stockError = skus.error ?? balances.error ?? products.error;

  const sinceGoLive = useQuery({
    queryKey: ["reports", "movements", "since-go-live"],
    queryFn: () =>
      fetchJson<{ items: AnyRecord[]; capped: boolean }>(
        `/api/reports/movements?from=${encodeURIComponent(GO_LIVE)}&to=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`,
      ),
    enabled: selected?.id === "idle",
  });
  const movements = useQuery({
    queryKey: ["reports", "movements", period.from, period.to],
    queryFn: () =>
      fetchJson<{ items: AnyRecord[]; capped: boolean }>(
        `/api/reports/movements?from=${encodeURIComponent(period.from)}&to=${encodeURIComponent(period.to)}`,
      ),
    enabled: selected?.id === "movements",
  });
  const requests = useQuery({
    queryKey: ["reports", "requests", period.from, period.to],
    queryFn: () =>
      fetchJson<{ items: AnyRecord[]; capped: boolean }>(
        `/api/reports/requests?from=${encodeURIComponent(period.from)}&to=${encodeURIComponent(period.to)}`,
      ),
    enabled: selected?.id === "requests",
  });

  const stockCounts = useMemo(
    () =>
      stockLoading || stockError
        ? null
        : {
            position: positionReport(items).rows.length,
            "below-minimum": belowMinimumReport(items).rows.length,
          },
    [items, stockError, stockLoading],
  );

  const state = useMemo((): {
    loading: boolean;
    error: unknown;
    capped: boolean;
    report: ReportResult | null;
  } => {
    if (!selected) return { loading: false, error: null, capped: false, report: null };
    if (selected.id === "position" || selected.id === "below-minimum") {
      if (stockLoading || stockError) return { loading: stockLoading, error: stockError, capped: false, report: null };
      return {
        loading: false,
        error: null,
        capped: false,
        report: selected.id === "position" ? positionReport(items) : belowMinimumReport(items),
      };
    }
    if (selected.id === "idle") {
      const loading = stockLoading || sinceGoLive.isLoading;
      const error = stockError ?? sinceGoLive.error;
      if (loading || error || !sinceGoLive.data) return { loading, error, capped: false, report: null };
      return {
        loading: false,
        error: null,
        capped: sinceGoLive.data.capped,
        report: idleReport(items, sinceGoLive.data.items, idleDays, new Date()),
      };
    }
    const source = selected.id === "movements" ? movements : requests;
    if (source.isLoading || source.error || !source.data) {
      return { loading: source.isLoading, error: source.error, capped: false, report: null };
    }
    return {
      loading: false,
      error: null,
      capped: source.data.capped,
      report:
        selected.id === "movements"
          ? movementsReport(source.data.items)
          : requestsReport(source.data.items, requestHelpers),
    };
  }, [idleDays, items, movements, requests, selected, sinceGoLive, stockError, stockLoading]);

  if (!selected) {
    return <p className="text-sm text-muted-foreground">Nenhum relatório disponível para o seu perfil.</p>;
  }

  const report = state.report;
  const columns = report?.columns.filter((column) => selected.preview.includes(column.key)) ?? [];
  const usesPeriod = selected.id === "movements" || selected.id === "requests";
  const groups = (["Estoque", "Operação"] as const)
    .map((group) => ({ group, reports: available.filter((item) => item.group === group) }))
    .filter((entry) => entry.reports.length);

  const fileName = () => {
    const suffix =
      selected.id === "idle"
        ? `${idleDays}-dias-${todayIso()}`
        : usesPeriod
          ? period.slug
          : todayIso();
    return `dutelog-${selected.file}-${suffix}.csv`;
  };

  const handleDownload = () => {
    if (!report) return;
    if (!report.rows.length) {
      toast({ title: "Nada para baixar", description: "O relatório está vazio neste filtro." });
      return;
    }
    download(fileName(), toExcelCsv(report));
  };

  const countFor = (id: ReportId) => {
    if (id === selected.id && report) return report.rows.length;
    if (id === "position" || id === "below-minimum") return stockCounts?.[id];
    return undefined;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">
          Escolha um relatório, confira a prévia e baixe a planilha. Ela abre direto no Excel.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[270px_minmax(0,1fr)]">
        <nav className="h-fit rounded-[18px] border border-border bg-card p-2.5">
          {groups.map(({ group, reports }) => (
            <div key={group}>
              <div className="px-2.5 pb-1.5 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </div>
              {reports.map((item) => {
                const Icon = item.icon;
                const active = item.id === selected.id;
                const count = countFor(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "mb-0.5 flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
                      active ? "bg-primary/10" : "hover:bg-muted/60",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                        active ? "bg-card text-primary" : "bg-muted text-foreground/60",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{item.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
                    </span>
                    {count !== undefined ? (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          item.id === "below-minimum" && count > 0
                            ? "bg-warning-soft text-warning-soft-foreground"
                            : "bg-muted text-foreground/70",
                        )}
                      >
                        {count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <section className="flex min-w-0 flex-col overflow-hidden rounded-[18px] border border-border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5">
            <div className="min-w-0 max-w-2xl">
              <h2 className="text-lg font-semibold">{selected.title}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{selected.description}</p>
            </div>
            <Button onClick={handleDownload} disabled={!report}>
              <Download className="mr-2 h-4 w-4" />
              Baixar planilha
            </Button>
          </div>

          {usesPeriod ? (
            <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
              <Chip active={preset === "this-month"} onClick={() => setPreset("this-month")}>
                {competenciaLabel(thisMonth)}
              </Chip>
              <Chip active={preset === "last-month"} onClick={() => setPreset("last-month")}>
                {competenciaLabel(previousCompetencia(thisMonth))}
              </Chip>
              <Chip active={preset === "last-7"} onClick={() => setPreset("last-7")}>
                Últimos 7 dias
              </Chip>
              <Chip active={preset === "custom"} onClick={() => setPreset("custom")}>
                Escolher datas
              </Chip>
              {preset === "custom" ? (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Input
                    type="date"
                    aria-label="Data inicial"
                    className="h-8 w-[150px]"
                    value={customFrom}
                    max={customTo}
                    onChange={(event) => setCustomFrom(event.target.value)}
                  />
                  a
                  <Input
                    type="date"
                    aria-label="Data final"
                    className="h-8 w-[150px]"
                    value={customTo}
                    min={customFrom}
                    onChange={(event) => setCustomTo(event.target.value)}
                  />
                </span>
              ) : null}
            </div>
          ) : selected.id === "idle" ? (
            <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
              {IDLE_OPTIONS.map((days) => (
                <Chip key={days} active={idleDays === days} onClick={() => setIdleDays(days)}>
                  {days} dias
                </Chip>
              ))}
            </div>
          ) : null}

          {report ? (
            <div className="grid grid-cols-1 border-y border-border/60 sm:grid-cols-3">
              {report.summary.map((entry) => (
                <div key={entry.label} className="border-b border-border/60 px-5 py-3 last:border-0 sm:border-b-0 sm:border-r">
                  <div className="text-xs text-muted-foreground">{entry.label}</div>
                  <div
                    className={cn(
                      "mt-0.5 text-xl font-semibold",
                      entry.tone === "in" && "text-success-soft-foreground",
                      entry.tone === "out" && "text-destructive-soft-foreground",
                    )}
                  >
                    {entry.value}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {state.loading ? (
            <p className="px-5 py-8 text-sm text-muted-foreground">Carregando...</p>
          ) : state.error ? (
            <p className="px-5 py-8 text-sm text-destructive">
              {state.error instanceof Error ? state.error.message : "Não foi possível carregar o relatório."}
            </p>
          ) : report && report.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    {columns.map((column) => (
                      <th
                        key={column.key}
                        className={cn(
                          "whitespace-nowrap px-4 py-2.5 font-semibold",
                          column.kind && column.kind !== "date" && column.kind !== "day" && "text-right",
                        )}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                    <tr key={index} className="border-b border-border/40 last:border-0">
                      {columns.map((column) => {
                        const value = row[column.key] ?? null;
                        const display =
                          column.kind === "money" && typeof value === "number"
                            ? value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                            : column.kind === "number" && typeof value === "number"
                              ? value.toLocaleString("pt-BR")
                              : formatCell(value, column.kind);
                        return (
                          <td
                            key={column.key}
                            className={cn(
                              "max-w-[280px] truncate whitespace-nowrap px-4 py-2.5",
                              column.kind && column.kind !== "date" && column.kind !== "day" && "text-right tabular-nums",
                              column.key === "kind" && value === "Entrada" && "font-semibold text-success-soft-foreground",
                              column.key === "kind" && value === "Saída" && "font-semibold text-destructive-soft-foreground",
                              column.key === "kind" && value === "Ajuste" && "font-semibold text-warning-soft-foreground",
                            )}
                          >
                            {display || "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : report ? (
            <p className="px-5 py-8 text-sm text-muted-foreground">
              Nada neste filtro{usesPeriod ? ` (${period.label})` : ""}.
            </p>
          ) : null}

          {report && report.rows.length ? (
            <div className="mt-auto flex flex-wrap justify-between gap-2 border-t border-border/60 px-5 py-3 text-xs text-muted-foreground">
              <span>
                Prévia: {Math.min(PREVIEW_ROWS, report.rows.length)} de {report.rows.length}{" "}
                {report.rows.length === 1 ? "linha" : "linhas"} · a planilha traz todas, com {report.columns.length} colunas
              </span>
              {state.capped ? (
                <span className="font-medium text-warning-soft-foreground">
                  Limite de 5.000 registros atingido: reduza o período.
                </span>
              ) : selected.id === "idle" ? (
                <span>Conta a partir do go-live (30/07/2026)</span>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
