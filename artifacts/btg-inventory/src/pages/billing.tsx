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
import { FileText, Send, CheckCircle2, Save, Zap } from "lucide-react";
import { API_BASE, GRUPOS, STATUS_META, fmtBRL, fmtNum, currentCompetencia, competenciaLabel } from "@/lib/billing-format";

export default function Billing() {
  const [competencia, setCompetencia] = useState(currentCompetencia());
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useGetBillingPeriod(competencia);
  const { data: periodsData } = useListBillingPeriods();

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
        <Card className="bg-primary text-primary-foreground">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium opacity-80">Total do mês</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtBRL(data?.total || 0)}</div>
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
