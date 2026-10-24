import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, RefreshCw, Settings2 } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatMoney } from "@/lib/system-dashboard";
import {
  errorsToShow,
  FUNCTION_STATUS_LABELS,
  codebaseLabel,
  functionsNote,
  functionsToShow,
  infraKey,
  infraTiles,
  serviceNames,
  vertexComparison,
  type ErrorGroup,
  type SystemInfra,
} from "@/lib/system-infra";
import { cn } from "@/lib/utils";

import { dayTime, fetchJson, field, Health, Panel } from "./parts";

/**
 * Infraestrutura do painel do sistema (só owner): erros do servidor em 24 h,
 * functions publicadas e com acesso, custo real do Google Cloud. As consultas
 * ao Google Cloud levam alguns segundos: carregam ao abrir, valem 5 minutos e
 * têm "Verificar agora". Só leitura: o painel mostra o comando de correção.
 */

const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

export function useSystemInfra() {
  return useQuery<SystemInfra, Error>({
    queryKey: infraKey,
    queryFn: () => fetchJson<SystemInfra>("/api/system/infra"),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/** Os dois quadros de saúde que entram na faixa do topo. */
export function InfraTiles() {
  const infra = useSystemInfra();
  const tiles = infraTiles(infra.data, infra.isLoading);
  return (
    <>
      <Health label="Erros do servidor · 24 h" {...tiles.errors} />
      <Health label="Functions" {...tiles.functions} />
    </>
  );
}

function SectionError({ message }: { message: string }) {
  return <p className="px-5 py-4 text-sm text-destructive-soft-foreground">{message}</p>;
}

function CopyCommand({ command }: { command: string }) {
  const { toast } = useToast();
  return (
    <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs leading-5">{command}</code>
      <button
        type="button"
        aria-label="Copiar comando"
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-card hover:text-foreground"
        onClick={() =>
          navigator.clipboard
            .writeText(command)
            .then(() => toast({ title: "Comando copiado" }))
            .catch(() => toast({ title: "Não consegui copiar", description: "Selecione o texto e copie.", variant: "destructive" }))
        }
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function ErrorRow({ group, name }: { group: ErrorGroup; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-border/40 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-5 py-3 text-left text-sm hover:bg-muted/40"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <b className="break-all">{name}</b>
          {group.blocked ? <span className="rounded-full bg-destructive-soft px-2 py-0.5 text-xs font-semibold text-destructive-soft-foreground">bloqueada</span> : null}
          {group.admin ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground" title="Registro de auditoria: deploy ou permissão no Google Cloud">
              Google Cloud
            </span>
          ) : null}
        </span>
        <span className="flex items-baseline gap-3 text-xs text-muted-foreground">
          <span>{dayTime.format(new Date(group.last_at))}</span>
          <b className="text-sm tabular-nums text-foreground">{group.count}×</b>
        </span>
        <code className={cn("col-span-2 break-words font-mono text-xs text-muted-foreground", !open && "line-clamp-2")}>{group.message}</code>
        {open && group.count > 1 ? (
          <span className="col-span-2 text-xs text-muted-foreground">primeira {dayTime.format(new Date(group.first_at))}</span>
        ) : null}
      </button>
    </li>
  );
}

function ErrorsPanel({ infra }: { infra: SystemInfra }) {
  const [showAll, setShowAll] = useState(false);
  const errors = infra.errors;
  const name = serviceNames(infra);
  const hidden = errors.status === "ok" ? errors.groups.length - errorsToShow(errors.groups, false).length : 0;
  return (
    <Panel title="Erros do servidor" note="últimas 24 h · clique para ver a mensagem inteira">
      {errors.status === "error" ? (
        <SectionError message={errors.message} />
      ) : errors.status !== "ok" ? null : errors.groups.length ? (
        <>
          <ul>
            {errorsToShow(errors.groups, showAll).map((group) => (
              <ErrorRow key={`${group.service}-${group.message}`} group={group} name={name(group.service)} />
            ))}
          </ul>
          {hidden > 0 ? (
            <div className="border-t border-border/40 px-5 py-2.5 text-right text-xs">
              <button type="button" onClick={() => setShowAll(!showAll)} className="font-semibold text-primary hover:underline">
                {showAll ? "mostrar só os 5 mais recentes" : `ver todos (${errors.groups.length})`}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="px-5 py-4 text-sm text-muted-foreground">Nenhum erro nem chamada bloqueada nas últimas 24 h.</p>
      )}
    </Panel>
  );
}

function FunctionsPanel({ infra }: { infra: SystemInfra }) {
  const [showAll, setShowAll] = useState(false);
  const functions = infra.functions;
  if (functions.status !== "ok") {
    return (
      <Panel title="Functions publicadas">
        {functions.status === "error" ? <SectionError message={functions.message} /> : null}
      </Panel>
    );
  }
  const rows = functionsToShow(functions.list, showAll);
  return (
    <Panel title="Functions publicadas" note={functionsNote(functions.total, functions.codebases)}>
      <ul>
        {rows.map((row) => (
          <li key={row.name} className="border-b border-border/40 last:border-0">
            <div className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 truncate font-mono text-xs">{row.name}</code>
                <span className="shrink-0 text-xs text-muted-foreground">{codebaseLabel(row.codebase)}</span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                  row.status === "ok" ? "bg-success-soft text-success-soft-foreground" : "bg-destructive-soft text-destructive-soft-foreground",
                )}
              >
                {FUNCTION_STATUS_LABELS[row.status]}
                {row.status === "nao_publicada" && row.state ? ` · ${row.state}` : ""}
              </span>
            </div>
            {row.fix ? <CopyCommand command={row.fix} /> : null}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-border/40 px-5 py-2.5 text-xs text-muted-foreground">
        <span>
          {functions.ok} ok{functions.last_deploy_at ? ` · último deploy ${dayTime.format(new Date(functions.last_deploy_at))}` : ""}
        </span>
        <button type="button" onClick={() => setShowAll(!showAll)} className="font-semibold text-primary hover:underline">
          {showAll ? "só as com problema" : "ver todas"}
        </button>
      </div>
    </Panel>
  );
}

function BillingPanel({ infra, agentMonthCost, onConfigure }: { infra: SystemInfra; agentMonthCost: number | null; onConfigure: () => void }) {
  const billing = infra.billing;
  const configure = (
    <button type="button" onClick={onConfigure} className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
      <Settings2 className="h-4 w-4" aria-hidden="true" /> Tabela
    </button>
  );
  if (billing.status === "not_configured") {
    return (
      <Panel title="Custo real do Google Cloud">
        <div className="flex flex-col gap-2 px-5 py-4 text-sm">
          <p>Mostra o valor cobrado no mês, por serviço, a partir da exportação do faturamento para o BigQuery.</p>
          <button type="button" onClick={onConfigure} className="self-start font-semibold text-primary hover:underline">
            Informar a tabela do faturamento
          </button>
        </div>
      </Panel>
    );
  }
  if (billing.status === "error") {
    return (
      <Panel title="Custo real do Google Cloud" action={configure}>
        <SectionError message={billing.message} />
      </Panel>
    );
  }
  const max = Math.max(...billing.services.map((row) => row.gross), 0.01);
  const comparison = agentMonthCost === null ? null : vertexComparison(billing.vertex_ai, agentMonthCost);
  const covered = billing.credits < 0;
  return (
    <Panel title="Custo real do Google Cloud" note="no mês" action={configure}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <div>
          <div className="text-2xl font-semibold tabular-nums">
            {formatMoney(billing.gross)} <span className="text-sm font-normal text-muted-foreground">de uso</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {covered ? (
              <>
                Créditos <b className="tabular-nums text-success-soft-foreground">{formatMoney(billing.credits)}</b> · cobrado{" "}
                <b className="tabular-nums text-foreground">{formatMoney(billing.net)}</b> ·{" "}
              </>
            ) : null}
            {billing.data_until ? `dados até ${dayTime.format(new Date(billing.data_until))}` : "sem dados do mês ainda"}
          </div>
        </div>
        {billing.currency !== "BRL" ? <p className="text-xs text-warning-soft-foreground">A fatura está em {billing.currency}; os valores acima estão nessa moeda.</p> : null}
        {billing.services.length ? (
          <ul className="flex flex-col gap-2">
            {billing.services.slice(0, 8).map((row) => (
              <li key={row.service} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
                <span className="truncate">{row.service}</span>
                <b className="tabular-nums">{formatMoney(row.gross)}</b>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (row.gross / max) * 100)}%` }} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {billing.has_data
              ? "Nenhum custo de uso neste mês até agora."
              : "A exportação ainda não trouxe dados deste mês. Os primeiros chegam algumas horas depois de ativada."}
          </p>
        )}
        {billing.vertex_ai > 0 && agentMonthCost !== null ? (
          <p className="rounded-lg bg-agent-soft px-3 py-2 text-xs text-agent-strong">
            Vertex AI na fatura: <b>{formatMoney(billing.vertex_ai)}</b> · estimativa do Agent Dute: <b>{formatMoney(agentMonthCost)}</b>.
            {comparison ? ` ${comparison}` : ""}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function BillingTableDialog({ current, onClose }: { current: string | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [table, setTable] = useState(current ?? "");
  const save = useMutation({
    mutationFn: () => fetchJson("/api/system/infra-settings", { method: "POST", body: JSON.stringify({ billing_table: table.trim() || null }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: infraKey });
      toast({ title: table.trim() ? "Tabela do faturamento salva" : "Tabela do faturamento removida" });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Não consegui salvar", description: error.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-lg bg-card">
        <DialogHeader>
          <DialogTitle>Tabela do faturamento</DialogTitle>
          <DialogDescription>
            Depois de ativar a exportação do faturamento para o BigQuery, copie o nome completo da tabela no BigQuery (projeto.dataset.tabela).
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5 text-sm font-semibold" htmlFor="billing-table">
          Tabela
          <input
            id="billing-table"
            value={table}
            onChange={(event) => setTable(event.target.value)}
            className={cn(field, "font-mono text-xs")}
            placeholder="dute-btg.billing_export.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX"
            spellCheck={false}
          />
          <span className="text-xs font-normal text-muted-foreground">Deixe em branco para esconder o custo real.</span>
        </label>
        <DialogFooter className="gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium hover:bg-muted">
            Cancelar
          </button>
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background hover:bg-foreground/85 disabled:opacity-50"
          >
            {save.isPending ? "Salvando…" : "Salvar"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Seção Infraestrutura: erros, functions e custo real. */
export function InfraSection({ agentMonthCost }: { agentMonthCost: number | null }) {
  const infra = useSystemInfra();
  const [editingTable, setEditingTable] = useState(false);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Infraestrutura</p>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {infra.data ? `verificada às ${time.format(new Date(infra.data.checked_at))}` : null}
          <button
            type="button"
            onClick={() => infra.refetch()}
            disabled={infra.isFetching}
            className="flex items-center gap-1 font-semibold text-primary hover:underline disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", infra.isFetching && "animate-spin")} aria-hidden="true" />
            Verificar agora
          </button>
        </span>
      </div>
      {infra.isLoading ? (
        <p className="rounded-lg border border-border bg-card px-5 py-4 text-sm text-muted-foreground">Consultando o Google Cloud…</p>
      ) : infra.isError || !infra.data ? (
        <p className="rounded-lg border border-destructive-soft-border bg-destructive-soft px-5 py-4 text-sm text-destructive-soft-foreground">Não consegui consultar a infraestrutura: {infra.error?.message}</p>
      ) : (
        <div className="space-y-4">
          <ErrorsPanel infra={infra.data} />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <FunctionsPanel infra={infra.data} />
            <BillingPanel infra={infra.data} agentMonthCost={agentMonthCost} onConfigure={() => setEditingTable(true)} />
          </div>
        </div>
      )}
      {editingTable ? <BillingTableDialog current={infra.data?.settings.billing_table ?? null} onClose={() => setEditingTable(false)} /> : null}
    </section>
  );
}
