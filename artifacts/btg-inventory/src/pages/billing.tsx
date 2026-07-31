import { useState, useEffect } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  PackageOpen,
  Save,
  Send,
  Truck,
  Zap,
} from "lucide-react";
import { API_BASE, GRUPOS, STATUS_META, fmtBRL, fmtNum, currentCompetencia, competenciaLabel } from "@/lib/billing-format";

type BillingEvidence = {
  generated_at: string;
  status: string;
  metrics: {
    movements: number;
    incoming_pieces: number;
    outgoing_pieces: number;
    inbound_receipts: number;
    orders: number;
    shipments: number;
    documents: number;
    manual_items: number;
    events: number;
  };
  readiness: {
    ok: boolean;
    missing: string[];
  };
  documents: Array<{
    id: string;
    file_name: string;
    type: string;
    entity_id: string | null;
    created_at: string;
  }>;
  events: Array<{
    id: string;
    type: string;
    title: string;
    description?: string;
    severity?: string;
    occurred_at: string;
    entity_type?: string;
    entity_id?: string;
  }>;
  sources: string[];
};

export default function Billing() {
  const [competencia, setCompetencia] = useState(currentCompetencia());
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useGetBillingPeriod(competencia);
  const { data: periodsData } = useListBillingPeriods();
  const [evidence, setEvidence] = useState<BillingEvidence | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  const [qty, setQty] = useState<Record<number, string>>({});
  const [obs, setObs] = useState<Record<number, string>>({});

  const aberto = !data || data.status === "aberto";

  useEffect(() => {
    if (!data) return;
    const q: Record<number, string> = {};
    const o: Record<number, string> = {};
    data.grupos.forEach((g) =>
      g.itens.forEach((it) => {
        if (it.price_list_id != null && !it.auto) {
          q[it.price_list_id] = String(it.qtde);
          o[it.price_list_id] = it.observacao || "";
        }
      }),
    );
    setQty(q);
    setObs(o);
  }, [data]);

  useEffect(() => {
    const controller = new AbortController();
    setEvidenceLoading(true);
    fetch(`${API_BASE}/billing/periods/${competencia}/evidence`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Falha ao carregar evidências.");
        return response.json() as Promise<BillingEvidence>;
      })
      .then((payload) => setEvidence(payload))
      .catch((error) => {
        if ((error as { name?: string }).name !== "AbortError") {
          setEvidence(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setEvidenceLoading(false);
      });
    return () => controller.abort();
  }, [competencia]);

  const save = useSaveBillingManual();
  const emit = useEmitBillingInvoice();
  const pay = usePayBillingInvoice();

  const refetch = () => {
    qc.invalidateQueries({ queryKey: getGetBillingPeriodQueryKey(competencia) });
    qc.invalidateQueries({ queryKey: getListBillingPeriodsQueryKey() });
  };

  const handleSave = () => {
    if (!data) return;
    const items: { price_list_id: number; qtde: number; observacao: string | null }[] = [];
    data.grupos.forEach((g) =>
      g.itens.forEach((it) => {
        if (it.price_list_id != null && !it.auto) {
          items.push({
            price_list_id: it.price_list_id,
            qtde: Number(qty[it.price_list_id] || 0),
            observacao: obs[it.price_list_id] || null,
          });
        }
      }),
    );
    save.mutate(
      { competencia, data: { items } },
      {
        onSuccess: () => { toast({ title: "Quantidades salvas" }); refetch(); },
        onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
      },
    );
  };

  const handleEmit = () => {
    emit.mutate(
      { competencia },
      {
        onSuccess: (res) => {
          toast({
            title: "Fatura emitida",
            description: res.email.sent
              ? "PDF gerado e e-mail enviado ao cliente."
              : `PDF gerado. E-mail não enviado: ${res.email.error || "verifique as configurações."}`,
            variant: res.email.sent ? undefined : "destructive",
          });
          refetch();
        },
        onError: () => toast({ title: "Erro ao emitir fatura", variant: "destructive" }),
      },
    );
  };

  const handlePay = () => {
    pay.mutate(
      { competencia },
      { onSuccess: () => { toast({ title: "Fatura marcada como paga" }); refetch(); } },
    );
  };

  const statusMeta = data ? STATUS_META[data.status] ?? STATUS_META.aberto : STATUS_META.aberto;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">Faturamento Mensal</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Calcule, revise e emita a fatura de armazenagem e logística do cliente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value || currentCompetencia())}
            className="w-44"
          />
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Competência</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">{competenciaLabel(competencia)}</div>
            <Badge variant="outline" className={`mt-1 ${statusMeta.className}`}>{statusMeta.label}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Valor do estoque (base Ad Valorem)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">{fmtBRL(data?.custo_estoque || 0)}</div>
            <div className="text-xs text-muted-foreground mt-1">Taxa: {fmtNum((data?.ad_valorem_rate || 0) * 100)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total do mês</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-foreground">{fmtBRL(data?.total || 0)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Ações */}
      <div className="flex flex-wrap items-center gap-2">
        <a href={`${API_BASE}/billing/periods/${competencia}/pdf`} target="_blank" rel="noreferrer">
          <Button variant="outline"><FileText className="h-4 w-4 mr-2" />Prévia PDF</Button>
        </a>
        {aberto && (
          <>
            <Button onClick={handleSave} disabled={save.isPending} variant="outline">
              <Save className="h-4 w-4 mr-2" />Salvar quantidades
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={emit.isPending}><Send className="h-4 w-4 mr-2" />Emitir fatura</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Emitir fatura de {competenciaLabel(competencia)}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Os valores serão congelados e a fatura não poderá mais ser editada. O PDF será gerado e
                    enviado por e-mail ao cliente (se configurado). Total: <strong>{fmtBRL(data?.total || 0)}</strong>.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleEmit}>Emitir</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
        {data?.status === "emitido" && (
          <Button onClick={handlePay} disabled={pay.isPending} variant="outline">
            <CheckCircle2 className="h-4 w-4 mr-2" />Marcar como paga
          </Button>
        )}
      </div>

      <Card className="overflow-hidden border-blue-100 bg-white/80">
        <CardHeader className="border-b bg-blue-50/40">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-blue-500" />
                Evidências da competência
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Rastro operacional usado para revisar a cobrança antes da emissão.
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                evidence?.readiness.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }
            >
              {evidenceLoading
                ? "Conferindo..."
                : evidence?.readiness.ok
                  ? "Pronto para revisão"
                  : "Revisar evidências"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-5">
          <div className="grid gap-3 md:grid-cols-3">
            {[
              {
                label: "Entradas",
                value: fmtNum(evidence?.metrics.incoming_pieces ?? 0),
                detail: `${fmtNum(evidence?.metrics.inbound_receipts ?? 0)} recebimento(s)`,
                icon: PackageOpen,
              },
              {
                label: "Saídas",
                value: fmtNum(evidence?.metrics.outgoing_pieces ?? 0),
                detail: `${fmtNum(evidence?.metrics.orders ?? 0)} pedido(s) no mês`,
                icon: Truck,
              },
              {
                label: "Documentos",
                value: fmtNum(evidence?.metrics.documents ?? 0),
                detail: "Notas, comprovantes ou vínculos financeiros",
                icon: FileText,
              },
              // O contador de eventos tem dono (Agent Dute) — aparecia em 4
              // telas; aqui não sustenta a decisão de emitir.
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-[20px] border border-slate-100 bg-white/75 p-4 shadow-[0_8px_24px_rgba(15,23,42,.04)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">{item.label}</span>
                  <span className="rounded-full border border-blue-100 bg-blue-50 p-2 text-blue-500">
                    <item.icon className="h-4 w-4" />
                  </span>
                </div>
                <div className="mt-3 text-2xl font-semibold text-foreground">
                  {item.value}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
              </div>
            ))}
          </div>

          {evidence?.readiness.missing.length ? (
            <div className="rounded-[18px] border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-800">
              <div className="mb-2 flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                Pontos para validar antes de emitir
              </div>
              <ul className="space-y-1">
                {evidence.readiness.missing.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
            <div className="rounded-[20px] border border-slate-100 bg-white/70 p-4">
              <div className="mb-3 text-sm font-medium text-foreground">
                Documentos vinculados
              </div>
              {evidence?.documents.length ? (
                <div className="space-y-2">
                  {evidence.documents.map((document) => (
                    <div
                      key={document.id}
                      className="flex items-center justify-between gap-3 rounded-[14px] border border-slate-100 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{document.file_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {document.type}
                        </div>
                      </div>
                      <Badge variant="outline">{document.entity_id ?? "doc"}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[14px] border border-dashed p-4 text-sm text-muted-foreground">
                  Nenhum documento financeiro vinculado a esta competência.
                </div>
              )}
            </div>

            <div className="rounded-[20px] border border-slate-100 bg-white/70 p-4">
              <div className="mb-3 text-sm font-medium text-foreground">
                Eventos recentes da cobrança
              </div>
              {evidence?.events.length ? (
                <div className="space-y-2">
                  {evidence.events.slice(0, 6).map((event) => (
                    <div
                      key={event.id}
                      className="rounded-[14px] border border-slate-100 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{event.title}</span>
                        <Badge variant="outline">{event.type}</Badge>
                      </div>
                      {event.description ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {event.description}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[14px] border border-dashed p-4 text-sm text-muted-foreground">
                  Nenhum evento encontrado para a competência.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grade de linhas */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[32%]">Serviço / Item</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">Qtde.</TableHead>
                  <TableHead className="text-right">Valor unit.</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-[18%]">Observação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.grupos.map((g) => (
                  <>
                    <TableRow key={g.grupo} className="bg-primary/5 hover:bg-primary/5">
                      <TableCell colSpan={4} className="font-bold text-primary">
                        {GRUPOS[g.grupo]?.emoji} {g.label}
                      </TableCell>
                      <TableCell className="text-right font-bold text-primary">{fmtBRL(g.total)}</TableCell>
                      <TableCell />
                    </TableRow>
                    {g.itens.map((it, idx) => {
                      const id = it.price_list_id;
                      const editable = aberto && !it.auto && id != null;
                      return (
                        <TableRow key={`${g.grupo}-${id ?? idx}`}>
                          <TableCell className="pl-6">{it.item}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {it.unidade}
                            {it.auto && (
                              <Badge variant="outline" className="ml-2 text-[10px] py-0 border-blue-200 text-blue-700">
                                <Zap className="h-3 w-3 mr-0.5" />auto
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {editable ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={qty[id!] ?? ""}
                                onChange={(e) => setQty((s) => ({ ...s, [id!]: e.target.value }))}
                                className="h-8 w-24 ml-auto text-right"
                              />
                            ) : (
                              fmtNum(it.qtde)
                            )}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">{fmtBRL(it.valor_unit)}</TableCell>
                          <TableCell className="text-right font-semibold">{fmtBRL(it.total)}</TableCell>
                          <TableCell>
                            {editable ? (
                              <Input
                                value={obs[id!] ?? ""}
                                onChange={(e) => setObs((s) => ({ ...s, [id!]: e.target.value }))}
                                className="h-8"
                                placeholder="—"
                              />
                            ) : (
                              <span className="text-sm text-muted-foreground">{it.observacao}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </>
                ))}
                <TableRow className="border-t-2">
                  <TableCell colSpan={4} className="font-bold text-lg">TOTAL GERAL</TableCell>
                  <TableCell className="text-right font-bold text-lg text-primary">{fmtBRL(data?.total || 0)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Histórico de competências */}
      {periodsData?.items && periodsData.items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico de competências</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Competência</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periodsData.items.map((p) => {
                  const sm = STATUS_META[p.status] ?? STATUS_META.aberto;
                  return (
                    <TableRow key={p.competencia} className="cursor-pointer" onClick={() => setCompetencia(p.competencia)}>
                      <TableCell className="font-medium">{competenciaLabel(p.competencia)}</TableCell>
                      <TableCell><Badge variant="outline" className={sm.className}>{sm.label}</Badge></TableCell>
                      <TableCell className="text-right font-semibold">{fmtBRL(p.total)}</TableCell>
                      <TableCell className="text-right">
                        <a href={`${API_BASE}/billing/periods/${p.competencia}/pdf`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="sm"><FileText className="h-4 w-4" /></Button>
                        </a>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
