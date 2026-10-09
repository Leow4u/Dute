import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { OwnerDashboard } from "@/components/system/owner-dashboard";
import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
import { BUILD_COMMIT, BUILD_TIME } from "@/lib/build-info";
import { humanApiError } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * Sistema: o servidor responde? Qual versão está no ar? O ledger está
 * recebendo eventos? E o registro de incidentes. O owner vê também o painel
 * do sistema (custo e uso do Agent Dute, rotinas, o que deu errado). A verificação é feita no
 * servidor (getSystemHealth), não um "ok" fixo do navegador.
 */

type Severity = "info" | "attention" | "critical";

type SystemHealth = {
  ok: boolean;
  checked_at: string;
  firestore_ms: number;
  last_event: { type: string; title: string; occurred_at: string } | null;
  incidents: Array<{
    id: string;
    title: string;
    description: string;
    severity: string;
    occurred_at: string;
    reported_by: string;
  }>;
};

type Check = SystemHealth & { round_trip_ms: number };

const SEVERITY: Record<string, { label: string; tone: string }> = {
  info: { label: "Info", tone: "bg-muted text-foreground" },
  attention: { label: "Atenção", tone: "bg-warning-soft text-warning-soft-foreground" },
  critical: { label: "Crítico", tone: "bg-destructive-soft text-destructive-soft-foreground" },
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(payload.message || "O servidor não respondeu.");
  return payload as T;
}

function dateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Tile({
  label,
  value,
  detail,
  dot,
  mono,
}: {
  label: string;
  value: string;
  detail?: string | null;
  dot?: "ok" | "bad" | "wait";
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1.5 flex items-center gap-2 text-lg font-semibold",
          mono && "font-mono text-base",
        )}
      >
        {dot ? (
          <span
            className={cn(
              "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
              dot === "ok" ? "bg-green-600" : dot === "bad" ? "bg-red-600" : "bg-slate-300",
            )}
          />
        ) : null}
        <span className="min-w-0 truncate">{value}</span>
      </div>
      {detail ? <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

const emptyIncident = { severity: "attention" as Severity, title: "", description: "" };

type NumberingResult = {
  dry_run: boolean;
  assigned_count: number;
  assigned: Array<{ id: string; request_number: string }>;
};

export default function SettingsSystem() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [incident, setIncident] = useState(emptyIncident);
  const { user } = useAppUser();
  const isOwner = user?.publicMetadata.role === "owner";
  const [numbering, setNumbering] = useState<NumberingResult | null>(null);

  const health = useQuery({
    queryKey: ["system-health"],
    queryFn: async (): Promise<Check> => {
      const started = performance.now();
      const result = await fetchJson<SystemHealth>("/api/system/health");
      return { ...result, round_trip_ms: Math.round(performance.now() - started) };
    },
    retry: false,
    refetchInterval: 120_000,
  });

  const register = useMutation({
    mutationFn: async () => {
      const title = incident.title.trim();
      if (!title) throw new Error("Informe o que aconteceu.");
      return fetchJson("/api/ai/events", {
        method: "POST",
        body: JSON.stringify({
          type: "support.incident",
          title,
          description: incident.description.trim(),
          severity: incident.severity,
          entity_type: "suporte",
          entity_id: `support_${Date.now()}`,
          customer_code: "BTG Pactual",
          source: "support_console",
          payload: { support_status: "open", channel: "dute_system" },
        }),
      });
    },
    onSuccess: async () => {
      setOpen(false);
      setIncident(emptyIncident);
      await queryClient.invalidateQueries({ queryKey: ["system-health"] });
      toast({ title: "Incidente registrado" });
    },
    onError: (error) =>
      toast({
        title: "Incidente não registrado",
        description: humanApiError(error, "Tente novamente em instantes."),
        variant: "destructive",
      }),
  });

  // Manutenção única: solicitações antigas ganham número PED-/ENV-. Primeiro
  // mostra o que faria; só grava depois de confirmar.
  const assignNumbers = useMutation({
    mutationFn: (apply: boolean) =>
      fetchJson<NumberingResult>("/api/system/request-numbers", {
        method: "POST",
        body: JSON.stringify({ apply }),
      }),
    onSuccess: (result) => {
      setNumbering(result);
      if (!result.dry_run) toast({ title: `${result.assigned_count} solicitação(ões) numerada(s)` });
    },
    onError: (error) =>
      toast({
        title: "Numeração não concluída",
        description: humanApiError(error, "Tente novamente em instantes."),
        variant: "destructive",
      }),
  });

  const check = health.data;
  const serverValue = health.isFetching && !check
    ? "Verificando"
    : health.isError
      ? "Sem resposta"
      : "Respondendo";
  const serverDot = health.isFetching && !check ? "wait" : health.isError ? "bad" : "ok";
  const serverDetail = health.isError
    ? humanApiError(health.error, "O servidor não respondeu.")
    : check
      ? `verificado ${dateTime(check.checked_at) ?? "agora"} · ${check.round_trip_ms} ms`
      : null;
  const builtAt = dateTime(BUILD_TIME);
  const lastEventAt = dateTime(check?.last_event?.occurred_at);
  const incidents = check?.incidents ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sistema"
        description="O sistema está no ar e com a versão certa?"
        actions={
          <Button variant="outline" onClick={() => health.refetch()} disabled={health.isFetching}>
            <RefreshCw className={cn("mr-2 h-4 w-4", health.isFetching && "animate-spin")} />
            Verificar agora
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Servidor" value={serverValue} detail={serverDetail} dot={serverDot} />
        <Tile
          label="Versão publicada"
          value={BUILD_COMMIT}
          detail={builtAt ? `build de ${builtAt}` : null}
          mono
        />
        <Tile
          label="Último registro de operação"
          value={lastEventAt ?? (check ? "Nenhum" : "—")}
          detail={check?.last_event?.title || (check ? "ledger de eventos vazio" : null)}
        />
      </div>

      {isOwner ? <OwnerDashboard /> : null}

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
          <h2 className="text-sm font-semibold">Incidentes</h2>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Registrar incidente
          </Button>
        </div>
        {health.isLoading ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">Carregando...</p>
        ) : incidents.length ? (
          <ul>
            {incidents.map((item) => {
              const severity = SEVERITY[item.severity] ?? SEVERITY.info;
              return (
                <li
                  key={item.id}
                  className="flex items-start gap-4 border-b border-border/40 px-5 py-3 text-sm last:border-0"
                >
                  <span className="w-24 shrink-0 text-muted-foreground">
                    {dateTime(item.occurred_at) ?? "—"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{item.title}</div>
                    {item.description ? (
                      <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        {item.description}
                      </div>
                    ) : null}
                    {item.reported_by ? (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Registrado por {item.reported_by}
                      </div>
                    ) : null}
                  </div>
                  <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold", severity.tone)}>
                    {severity.label}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            {health.isError ? "Sem resposta do servidor." : "Nenhum incidente registrado."}
          </p>
        )}
      </section>

      {isOwner ? (
        <section className="rounded-lg border border-border bg-card px-5 py-4">
          <h2 className="text-sm font-semibold">Numerar pedidos e envios antigos</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Dá número PED-/ENV- às solicitações criadas antes da numeração, na ordem de criação, e publica os itens delas no portal.
            Quem já tem número não muda.
          </p>
          {numbering ? (
            <p className="mt-2 text-sm">
              {numbering.dry_run ? "Vai numerar" : "Numerou"} {numbering.assigned_count} solicitação(ões)
              {numbering.assigned.length
                ? `: ${numbering.assigned.slice(0, 6).map((entry) => entry.request_number).join(", ")}${numbering.assigned.length > 6 ? "…" : ""}`
                : "."}
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" disabled={assignNumbers.isPending} onClick={() => assignNumbers.mutate(false)}>
              Ver o que muda
            </Button>
            <Button
              size="sm"
              disabled={assignNumbers.isPending || !numbering?.dry_run || !numbering.assigned_count}
              onClick={() => assignNumbers.mutate(true)}
            >
              Numerar agora
            </Button>
          </div>
        </section>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Registrar incidente</DialogTitle>
          </DialogHeader>
          <form
            id="incident-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              register.mutate();
            }}
          >
            <div className="space-y-2">
              <Label>Gravidade</Label>
              <Select
                value={incident.severity}
                onValueChange={(severity: Severity) => setIncident((state) => ({ ...state, severity }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="attention">Atenção</SelectItem>
                  <SelectItem value="critical">Crítico</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="incident-title">O que aconteceu</Label>
              <Input
                id="incident-title"
                required
                value={incident.title}
                onChange={(event) => setIncident((state) => ({ ...state, title: event.target.value }))}
                placeholder="Ex.: portal do cliente sem atualizar o estoque"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="incident-description">Impacto e o que foi feito</Label>
              <Textarea
                id="incident-description"
                value={incident.description}
                onChange={(event) =>
                  setIncident((state) => ({ ...state, description: event.target.value }))
                }
                placeholder="Quem foi afetado, desde quando, o que resolveu"
              />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="incident-form" disabled={register.isPending}>
              {register.isPending ? "Registrando..." : "Registrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
