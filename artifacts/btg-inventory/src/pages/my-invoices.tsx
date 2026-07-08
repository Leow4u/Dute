import {
  useGetBillingMeCurrent,
  useListMyInvoices,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { FileDown } from "lucide-react";
import { API_BASE, GRUPOS, STATUS_META, fmtBRL, competenciaLabel, currentCompetencia } from "@/lib/billing-format";

export default function MyInvoices() {
  const { data: current, isLoading } = useGetBillingMeCurrent();
  const { data: invoices } = useListMyInvoices();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">Minhas Faturas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Acompanhe o custo do mês corrente e baixe suas faturas emitidas.
        </p>
      </div>

      {/* Custo do mês corrente */}
      <Card className="overflow-hidden">
        <div className="bg-primary text-primary-foreground p-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <div className="text-sm opacity-80">Custo estimado — {competenciaLabel(currentCompetencia())}</div>
            <div className="text-3xl font-bold mt-1">{fmtBRL(current?.total || 0)}</div>
          </div>
          <Badge variant="outline" className="bg-white/10 text-white border-white/20 w-fit">Prévia do mês em andamento</Badge>
        </div>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Grupo de serviço</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {current?.grupos.filter((g) => g.itens.length).map((g) => (
                  <TableRow key={g.grupo}>
                    <TableCell className="font-medium">{GRUPOS[g.grupo]?.emoji} {g.label}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtBRL(g.total)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2">
                  <TableCell className="font-bold">Total do mês</TableCell>
                  <TableCell className="text-right font-bold text-primary">{fmtBRL(current?.total || 0)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Faturas emitidas */}
      <Card>
        <CardHeader><CardTitle className="text-base">Faturas emitidas</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!invoices?.items || invoices.items.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">Nenhuma fatura emitida ainda.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Competência</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Fatura</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.items.map((inv) => {
                  const sm = STATUS_META[inv.status] ?? STATUS_META.emitido;
                  return (
                    <TableRow key={inv.competencia}>
                      <TableCell className="font-medium">{competenciaLabel(inv.competencia)}</TableCell>
                      <TableCell><Badge variant="outline" className={sm.className}>{sm.label}</Badge></TableCell>
                      <TableCell className="text-right font-semibold">{fmtBRL(inv.total)}</TableCell>
                      <TableCell className="text-right">
                        <a href={`${API_BASE}/billing/me/invoices/${inv.competencia}/pdf`} target="_blank" rel="noreferrer">
                          <Button variant="outline" size="sm"><FileDown className="h-4 w-4 mr-2" />PDF</Button>
                        </a>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
