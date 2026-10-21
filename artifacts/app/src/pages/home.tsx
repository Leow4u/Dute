import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetDashboard } from "@workspace/api-client-react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileCheck,
  FileText,
  PackageCheck,
  Sparkles,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppUser } from "@/lib/auth";
import { lerAlertasDosContratos, lerOrcamentosParaAprovar } from "@/lib/comercial/inicio";
import {
  buildHomeInbox,
  veAprovacoesNoInicio,
  veContratosNoInicio,
  type HomeInboxItem,
  type HomeInboxTone,
  type HomeRequest,
} from "@/lib/home-inbox";
import {
  canAccessModule,
  COORDINATION_NAV_ROLES,
  WMS_ROLES,
} from "@/lib/modules";
import { formatToday, greeting } from "@/lib/saudacao";
import { cn } from "@/lib/utils";
import type { WarehouseOpsResponse } from "@/lib/warehouse-ops/model";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message ?? "Falha ao carregar dados.");
  }
  return response.json() as Promise<T>;
}

const TONE_STYLE: Record<HomeInboxTone, { icon: LucideIcon; box: string }> = {
  critical: { icon: AlertTriangle, box: "bg-destructive-soft text-destructive-soft-foreground" },
  attention: { icon: ClipboardList, box: "bg-warning-soft text-warning-soft-foreground" },
  info: { icon: Truck, box: "bg-info-soft text-info-soft-foreground" },
  agent: { icon: Sparkles, box: "bg-agent-soft text-agent" },
};

const ITEM_ICON: Record<string, LucideIcon> = {
  receipts: PackageCheck,
  "comercial:aprovar": FileCheck,
};

const numberFormatter = new Intl.NumberFormat("pt-BR");

function InboxRow({ item }: { item: HomeInboxItem }) {
  const tone = TONE_STYLE[item.tone];
  // Alerta de contrato do Comercial: "contrato:<id>:<tipo>".
  const Icon = ITEM_ICON[item.id] ?? (item.id.startsWith("contrato:") ? FileText : tone.icon);
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 md:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-md",
            tone.box,
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{item.title}</p>
          {item.detail ? (
            <p className="mt-0.5 truncate text-sm text-foreground/65">
              {item.detail}
            </p>
          ) : null}
        </div>
      </div>
      <Button
        asChild
        size="sm"
        variant={item.tone === "agent" ? "outline" : "default"}
        className="shrink-0 self-start sm:self-auto"
      >
        <Link href={item.href}>{item.actionLabel}</Link>
      </Button>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-3 text-sm">
      <span className="text-foreground/75">{label}</span>
      <span className="text-lg font-semibold text-foreground">
        {numberFormatter.format(value)}
      </span>
    </div>
  );
}

export default function Home() {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  const seesWarehouse = canAccessModule(role, WMS_ROLES);
  const seesRequests = canAccessModule(role, COORDINATION_NAV_ROLES);
  // Contratos do Comercial: só owner, admin e comercial, com a liberação.
  const seesContracts = veContratosNoInicio(role);
  // Orçamentos para aprovar: só o owner, que aprova, com a liberação.
  const seesApprovals = veAprovacoesNoInicio(role);

  const dashboard = useGetDashboard();
  const ops = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"),
    enabled: seesWarehouse,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const requests = useQuery({
    queryKey: ["customer-requests", "home"],
    queryFn: () =>
      fetchJson<{ items?: HomeRequest[] }>("/api/customer-requests?limit=200"),
    enabled: seesRequests,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const contracts = useQuery({
    queryKey: ["comercial", "contratos", "inicio"],
    queryFn: () => lerAlertasDosContratos(),
    enabled: seesContracts,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const approvals = useQuery({
    queryKey: ["comercial", "orcamentos", "para-aprovar"],
    queryFn: () => lerOrcamentosParaAprovar(),
    enabled: seesApprovals,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const inbox = useMemo(
    () =>
      buildHomeInbox({
        role,
        ops: ops.data,
        requests: requests.data?.items,
        contratos: contracts.data,
        paraAprovar: approvals.data,
      }),
    [ops.data, requests.data, contracts.data, approvals.data, role],
  );

  const loading =
    (seesWarehouse && ops.isLoading) ||
    (seesRequests && requests.isLoading) ||
    (seesContracts && contracts.isLoading) ||
    (seesApprovals && approvals.isLoading);
  const failedSources = [
    seesWarehouse && ops.isError ? "armazém" : null,
    seesRequests && requests.isError ? "solicitações" : null,
    seesContracts && contracts.isError ? "contratos" : null,
    seesApprovals && approvals.isError ? "orçamentos" : null,
  ].filter((source): source is string => Boolean(source));

  const now = new Date();
  const firstName = user?.fullName?.split(" ")[0] ?? "";
  const pending = inbox.items.length;
  const skuTotal = Number(
    (dashboard.data as { total_skus?: number } | undefined)?.total_skus ?? 0,
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-foreground/60">{formatToday(now)}</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground md:text-3xl">
          {greeting(now)}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        {!loading ? (
          <p className="mt-1 text-foreground/70">
            {pending === 0 ? (
              "Nada parado esperando por você."
            ) : (
              <>
                <span className="font-semibold text-destructive-soft-foreground">
                  {pending === 1 ? "1 item" : `${pending} itens`}
                </span>{" "}
                {pending === 1 ? "precisa" : "precisam"} de você.
              </>
            )}
          </p>
        ) : null}
      </header>

      {failedSources.length ? (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertDescription>
            Não foi possível carregar {failedSources.join(" e ")}. A lista abaixo
            pode estar incompleta.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex min-w-0 flex-col gap-3">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-foreground/60">
            Precisa de você
          </h2>
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex flex-col gap-3 p-5">
                  {[0, 1, 2].map((row) => (
                    <Skeleton key={row} className="h-14 rounded-2xl" />
                  ))}
                </div>
              ) : pending === 0 ? (
                <div className="flex items-center gap-3 px-5 py-8 text-success-soft-foreground">
                  <CheckCircle2 className="size-5" aria-hidden="true" />
                  <span className="font-medium">Tudo em dia.</span>
                </div>
              ) : (
                <div className="divide-y divide-border/70">
                  {inbox.items.map((item) => (
                    <InboxRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {seesWarehouse ? (
          <section className="flex min-w-0 flex-col gap-3">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-foreground/60">
              Hoje no armazém
            </h2>
            <Card>
              <CardContent className="divide-y divide-border/70 px-5 py-2">
                <SummaryRow label="Pedidos para separar" value={inbox.summary.toPick} />
                <SummaryRow label="Prontos para envio" value={inbox.summary.toShip} />
                <SummaryRow label="Em rota de entrega" value={inbox.summary.inTransit} />
                <SummaryRow
                  label="Recebimentos em aberto"
                  value={inbox.summary.openReceipts}
                />
                <SummaryRow label="SKUs em estoque" value={skuTotal} />
              </CardContent>
            </Card>
          </section>
        ) : null}
      </div>
    </div>
  );
}
