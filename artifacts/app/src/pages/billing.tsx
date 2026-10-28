import { useEffect, useMemo, useState } from "react";
import {
  useGetBillingPeriod,
  getGetBillingPeriodQueryKey,
  getListBillingPeriodsQueryKey,
  useSaveBillingManual,
  useEmitBillingInvoice,
  usePayBillingInvoice,
  useListBillingPeriods,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Clock3, FileText, Save, Send, TriangleAlert } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { CABECALHO_DO_CLIENTE } from "@/lib/active-customer";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { useAppUser } from "@/lib/auth";
import { acaoDaArmazenagem } from "@/lib/financeiro/armazenagem";
import { humanApiError } from "@/lib/permissions";
import {
  STATUS_META,
  competenciaLabel,
  currentCompetencia,
  fmtBRL,
  fmtNum,
} from "@/lib/billing-format";
import { isAdValoremLine } from "@/lib/invoice-view";
import { cn } from "@/lib/utils";

/**
 * Fechamento do mês: o que vai ser cobrado, o que falta preencher e emitir.
 * O total vem do servidor (getBillingPreview) com o mesmo cálculo que a
 * emissão congela; aqui só se digitam as quantidades manuais.
 */

type Line = {
  price_list_id: number | string | null;
  item: string;
  unidade?: string | null;
  qtde: number;
  valor_unit: number;
  total: number;
  observacao?: string | null;
  auto?: boolean;
  auto_source?: string | null;
};

type Period = {
  competencia: string;
  status: string;
  custo_estoque: number;
  ad_valorem_rate: number;
  total: number;
  grupos: Array<{ grupo: string; total: number; itens: Line[] }>;
  emitido_em?: string | null;
  pago_em?: string | null;
  /** A NF do Financeiro em que a competência está (parte 7.2a). */
  fatura_id?: string | null;
  emission?: { can_emit: boolean; available_from: string };
};

const cents = (value: number) => Math.round(value * 100);

function brDate(value?: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split("-").reverse().join("/");
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function previousCompetencia(competencia: string) {
  const [year, month] = competencia.split("-").map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, "0")}`;
}

function competenciaFromUrl() {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("competencia");
  return value && /^\d{4}-\d{2}$/.test(value) ? value : null;
}

const STATUS_DOT: Record<string, string> = {
  aberto: "bg-amber-500",
  emitido: "bg-blue-500",
  pago: "bg-green-600",
};

export default function Billing() {
  // Abre no mês a fechar (o anterior); o mês corrente fica ao lado.
  const [competencia, setCompetencia] = useState(
    () => competenciaFromUrl() ?? previousCompetencia(currentCompetencia()),
  );
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAppUser();
  // O mês na tela e o que se grava são do cliente ativo desta aba: a chave
  // da leitura leva o cliente, e cada chamada o diz no cabeçalho.
  const { code: cliente, isLoading: carregandoCliente } = useActiveCustomer();
  const doCliente = useMemo(() => ({ headers: { [CABECALHO_DO_CLIENTE]: cliente } }), [cliente]);

  const { data: raw, isLoading, error } = useGetBillingPeriod(competencia, {
    query: { queryKey: [...getGetBillingPeriodQueryKey(competencia), cliente], enabled: !carregandoCliente },
    request: doCliente,
  });
  const data = raw as unknown as Period | undefined;
  const { data: periodsData } = useListBillingPeriods({
    query: { queryKey: [...getListBillingPeriodsQueryKey(), cliente], enabled: !carregandoCliente },
    request: doCliente,
  });

  const [qty, setQty] = useState<Record<string, string>>({});
  const [obs, setObs] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const lines = useMemo(() => data?.grupos.flatMap((group) => group.itens) ?? [], [data]);
  const autoLines = lines.filter((line) => line.auto);
  const manualLines = useMemo(
    () => lines.filter((line) => !line.auto && line.price_list_id != null),
    [lines],
  );
  const aberto = !data || data.status === "aberto";

  useEffect(() => {
    const q: Record<string, string> = {};
    const o: Record<string, string> = {};
    for (const line of manualLines) {
      q[String(line.price_list_id)] = String(line.qtde);
      o[String(line.price_list_id)] = line.observacao || "";
    }
    setQty(q);
    setObs(o);
    setDirty(false);
  }, [manualLines]);

  const quantity = (line: Line) =>
    aberto ? Number(qty[String(line.price_list_id)] || 0) : line.qtde;
  const lineTotal = (line: Line) =>
    aberto && dirty ? cents(quantity(line) * line.valor_unit) / 100 : line.total;
  // Com alterações não salvas, mostra o total que elas vão dar.
  const total = dirty
    ? (cents(data?.total ?? 0) -
        manualLines.reduce((sum, line) => sum + cents(line.total), 0) +
        manualLines.reduce((sum, line) => sum + cents(lineTotal(line)), 0)) /
      100
    : (data?.total ?? 0);

  const months = useMemo(() => {
    const known = new Map<string, { status: string; total: number }>();
    for (const period of periodsData?.items ?? []) {
      known.set(period.competencia, { status: period.status, total: period.total });
    }
    const current = currentCompetencia();
    const list = new Set([...known.keys(), current, previousCompetencia(current), competencia]);
    return [...list]
      .filter((value) => value <= current)
      .sort()
      .slice(-4)
      .map((value) => ({
        competencia: value,
        ...(known.get(value) ?? { status: "aberto", total: 0 }),
      }));
  }, [periodsData, competencia]);

  const save = useSaveBillingManual({ request: doCliente });
  const emit = useEmitBillingInvoice({ request: doCliente });
  const pay = usePayBillingInvoice({ request: doCliente });

  const refetch = () => {
    qc.invalidateQueries({ queryKey: getGetBillingPeriodQueryKey(competencia) });
    qc.invalidateQueries({ queryKey: getListBillingPeriodsQueryKey() });
  };

  const failure = (title: string) => (err: unknown) =>
    toast({
      title,
      description: humanApiError(err, "Tente novamente em instantes."),
      variant: "destructive",
    });

  const handleSave = () => {
    const items = manualLines.map((line) => ({
      price_list_id: line.price_list_id as number,
      qtde: Number(qty[String(line.price_list_id)] || 0),
      observacao: obs[String(line.price_list_id)] || null,
    }));
    save.mutate(
      { competencia, data: { items } },
      {
        onSuccess: () => {
          toast({ title: "Quantidades salvas" });
          refetch();
        },
        onError: failure("Quantidades não salvas"),
      },
    );
  };

  const handleEmit = () =>
    emit.mutate(
      { competencia },
      {
        onSuccess: () => {
          toast({
            title: "Fatura emitida",
            description:
              "Os valores foram congelados e a fatura está disponível para a cliente em Faturas.",
          });
          refetch();
        },
        onError: failure("Fatura não emitida"),
      },
    );

  const handlePay = () =>
    pay.mutate(
      { competencia },
      {
        onSuccess: () => {
          toast({ title: "Fatura marcada como paga" });
          refetch();
        },
        onError: failure("Não foi possível marcar como paga"),
      },
    );

  const status = data?.status ?? "aberto";
  // Onde o Financeiro está ligado, a emitida se fatura e se recebe lá (parte 7.2c).
  const acao = acaoDaArmazenagem(status, data?.fatura_id, user?.publicMetadata.role);
  const statusMeta = STATUS_META[status] ?? STATUS_META.aberto;
  const canEmit = aberto && data?.emission?.can_emit === true && !dirty;
  const monthName = competenciaLabel(competencia).split(" de ")[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {months.map((month) => {
          const meta = STATUS_META[month.status] ?? STATUS_META.aberto;
          return (
            <button
              key={month.competencia}
              type="button"
              onClick={() => setCompetencia(month.competencia)}
              className={cn(
                "min-w-[150px] rounded-2xl border bg-card px-4 py-2 text-left transition-colors",
                month.competencia === competencia
                  ? "border-2 border-primary bg-info-soft/40"
                  : "border-border hover:bg-muted/40",
              )}
            >
              <span className="block text-sm font-semibold">{competenciaLabel(month.competencia)}</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[month.status] ?? "bg-amber-500")} />
                {meta.label}
                {month.status !== "aberto" && month.total ? ` · ${fmtBRL(month.total)}` : ""}
              </span>
            </button>
          );
        })}
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 text-sm text-muted-foreground hover:bg-surface-hover">
          <CalendarDays className="size-4" aria-hidden="true" />
          Outro mês
          <input
            type="month"
            aria-label="Outro mês"
            value={competencia}
            max={currentCompetencia()}
            onChange={(event) => event.target.value && setCompetencia(event.target.value)}
            className="w-32 bg-transparent text-sm text-foreground outline-none"
          />
        </label>
      </div>

      {error ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {humanApiError(error, "Não consegui calcular a competência.")}
        </p>
      ) : isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Calculando {competenciaLabel(competencia)}...</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-baseline justify-between px-5 pb-2 pt-4">
              <h2 className="text-sm font-semibold">Cobrado automaticamente</h2>
              <span className="text-xs text-muted-foreground">calculado pelo sistema</span>
            </div>
            <div className="space-y-2 px-5 pb-4">
              {autoLines.length ? (
                autoLines.map((line) => (
                  <div
                    key={String(line.price_list_id ?? line.item)}
                    className="flex items-center gap-4 rounded-xl border border-info-soft-border bg-info-soft/40 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{line.item}</div>
                      <div className="text-xs text-muted-foreground">
                        {isAdValoremLine(line)
                          ? `${fmtNum(line.valor_unit * 100)}% × ${fmtBRL(line.qtde)} · ${
                              aberto ? "valor atual do estoque" : "valor congelado na emissão"
                            }`
                          : `${fmtNum(line.qtde)} ${line.unidade ?? ""} × ${fmtBRL(line.valor_unit)}`}
                      </div>
                    </div>
                    <div className="text-lg font-semibold tabular-nums">{fmtBRL(line.total)}</div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum serviço automático na tabela de preços.
                </p>
              )}
            </div>

            <div className="flex items-baseline justify-between border-t border-border/60 px-5 pb-2 pt-4">
              <h2 className="text-sm font-semibold">Serviços do mês</h2>
              <span className="text-xs text-muted-foreground">
                {aberto ? "quantidade lançada por você" : "quantidades congeladas"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-foreground/50">
                    <th className="px-5 py-2 font-semibold">Serviço</th>
                    <th className="px-3 py-2 text-right font-semibold">Qtde</th>
                    <th className="px-3 py-2 text-right font-semibold">Valor unit.</th>
                    <th className="px-3 py-2 text-right font-semibold">Total</th>
                    <th className="px-5 py-2 font-semibold">Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {manualLines.map((line) => {
                    const id = String(line.price_list_id);
                    const value = lineTotal(line);
                    return (
                      <tr key={id} className="border-b border-border/40 last:border-0">
                        <td className="px-5 py-2">
                          <div>{line.item}</div>
                          <div className="text-xs text-muted-foreground">{line.unidade}</div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {aberto ? (
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              inputMode="decimal"
                              aria-label={`Quantidade de ${line.item}`}
                              value={qty[id] ?? ""}
                              onChange={(event) => {
                                setDirty(true);
                                setQty((state) => ({ ...state, [id]: event.target.value }));
                              }}
                              className="ml-auto h-9 w-24 text-right tabular-nums"
                            />
                          ) : (
                            <span className="tabular-nums">{fmtNum(line.qtde)}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {fmtBRL(line.valor_unit)}
                        </td>
                        <td
                          className={cn(
                            "whitespace-nowrap px-3 py-2 text-right tabular-nums",
                            value > 0 ? "font-semibold" : "text-muted-foreground",
                          )}
                        >
                          {fmtBRL(value)}
                        </td>
                        <td className="px-5 py-2">
                          {aberto ? (
                            <Input
                              aria-label={`Observação de ${line.item}`}
                              value={obs[id] ?? ""}
                              placeholder="—"
                              onChange={(event) => {
                                setDirty(true);
                                setObs((state) => ({ ...state, [id]: event.target.value }));
                              }}
                              className="h-9"
                            />
                          ) : (
                            <span className="text-muted-foreground">{line.observacao}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="order-first space-y-3 lg:order-none lg:sticky lg:top-0 lg:self-start">
            <div className="rounded-lg border-2 border-primary bg-card p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  {competenciaLabel(competencia)} · {aberto ? "total previsto" : "total"}
                </span>
                <span
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                    statusMeta.className,
                  )}
                >
                  {statusMeta.label}
                </span>
              </div>
              <div className="mt-1 text-3xl font-bold tabular-nums">{fmtBRL(total)}</div>
              <p className="text-xs text-muted-foreground">
                {aberto
                  ? dirty
                    ? "Inclui alterações ainda não salvas."
                    : "Mesmo cálculo que será congelado na emissão."
                  : "Valores congelados na emissão."}
              </p>

              <ul className="mt-4 space-y-2.5 text-sm">
                {aberto ? (
                  <>
                    <Check
                      tone={dirty ? "warn" : "ok"}
                      title={dirty ? "Alterações não salvas" : "Quantidades salvas"}
                      detail={dirty ? "Salve antes de emitir." : undefined}
                    />
                    <Check
                      tone={data.emission?.can_emit ? "ok" : "wait"}
                      title={
                        data.emission?.can_emit
                          ? `${monthName} encerrado`
                          : `${monthName} ainda não terminou`
                      }
                      detail={
                        data.emission?.can_emit
                          ? "Pronto para emitir."
                          : `Emissão liberada a partir de ${brDate(data.emission?.available_from)}.`
                      }
                    />
                  </>
                ) : (
                  <>
                    <Check
                      tone="ok"
                      title={`Emitida${data.emitido_em ? ` em ${brDate(data.emitido_em)}` : ""}`}
                      detail="Disponível para a cliente em Faturas."
                    />
                    <Check
                      tone={status === "pago" ? "ok" : "wait"}
                      title={
                        status === "pago"
                          ? `Paga${data.pago_em ? ` em ${brDate(data.pago_em)}` : ""}`
                          : "Aguardando pagamento"
                      }
                    />
                  </>
                )}
              </ul>

              <div className="mt-4 flex flex-col gap-2">
                {aberto && dirty ? (
                  <Button onClick={handleSave} disabled={save.isPending}>
                    <Save className="mr-2 h-4 w-4" />
                    Salvar quantidades
                  </Button>
                ) : null}
                <Button asChild variant="outline">
                  <Link href={`/faturamento/fatura?competencia=${competencia}`}>
                    <FileText className="mr-2 h-4 w-4" />
                    {aberto ? "Ver prévia da fatura (PDF)" : "Ver fatura (PDF)"}
                  </Link>
                </Button>
                {aberto ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button disabled={!canEmit || emit.isPending}>
                        <Send className="mr-2 h-4 w-4" />
                        Emitir e publicar para a cliente
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Emitir a fatura de {competenciaLabel(competencia)}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Os valores serão congelados e a fatura não poderá mais ser editada. Ela ficará
                          disponível para a cliente em Faturas. Total:{" "}
                          <strong>{fmtBRL(data.total)}</strong>.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleEmit}>Emitir</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
                {acao?.tipo === "pagar_no_wms" ? (
                  <Button variant="outline" onClick={handlePay} disabled={pay.isPending}>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Marcar como paga
                  </Button>
                ) : null}
                {acao?.tipo === "abrir_no_financeiro" ? (
                  <Button asChild variant="outline">
                    <Link href={acao.href}>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      {acao.rotulo}
                    </Link>
                  </Button>
                ) : null}
                {acao?.tipo === "nf_vinculada" ? (
                  <p className="text-sm text-muted-foreground">
                    Esta competência já está vinculada a uma nota fiscal. O pagamento precisa ser conciliado com essa nota antes de registrar a baixa.
                  </p>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Check({
  tone,
  title,
  detail,
}: {
  tone: "ok" | "warn" | "wait";
  title: string;
  detail?: string;
}) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? TriangleAlert : Clock3;
  return (
    <li className="flex gap-2.5">
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          tone === "ok" ? "text-success-soft-foreground" : tone === "warn" ? "text-warning-soft-foreground" : "text-info-soft-foreground",
        )}
      />
      <div>
        <div>{title}</div>
        {detail ? <div className="text-xs text-muted-foreground">{detail}</div> : null}
      </div>
    </li>
  );
}
