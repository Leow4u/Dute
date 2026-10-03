import { useState, useEffect } from "react";
import {
  useListPriceList,
  getListPriceListQueryKey,
  useCreatePriceListItem,
  useUpdatePriceListItem,
  useDeletePriceListItem,
  useGetBillingConfig,
  getGetBillingConfigQueryKey,
  useUpdateBillingConfig,
  type PriceListItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { GRUPOS, AUTO_LABELS, fmtBRL } from "@/lib/billing-format";

type FormState = {
  grupo: string;
  item: string;
  unidade: string;
  valor_unit: string;
  auto_source: string; // "" = manual
  ordem: string;
  ativo: boolean;
};

const EMPTY: FormState = { grupo: "armazenamento", item: "", unidade: "", valor_unit: "0", auto_source: "", ordem: "0", ativo: true };

export default function PriceList() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useListPriceList();
  const { data: config } = useGetBillingConfig();

  const create = useCreatePriceListItem();
  const update = useUpdatePriceListItem();
  const del = useDeletePriceListItem();
  const saveConfig = useUpdateBillingConfig();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  // Config form
  const [rate, setRate] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => {
    if (config) {
      setRate(String((config.ad_valorem_rate || 0) * 100));
      setNome(config.cliente_nome || "");
      setEmail(config.cliente_email || "");
    }
  }, [config]);

  const refetch = () => qc.invalidateQueries({ queryKey: getListPriceListQueryKey() });

  const openNew = () => { setEditId(null); setForm(EMPTY); setDialogOpen(true); };
  const openEdit = (it: PriceListItem) => {
    setEditId(it.id);
    setForm({
      grupo: it.grupo,
      item: it.item,
      unidade: it.unidade || "",
      valor_unit: String(it.valor_unit),
      auto_source: it.auto_source || "",
      ordem: String(it.ordem),
      ativo: it.ativo,
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const payload = {
      grupo: form.grupo,
      item: form.item,
      unidade: form.unidade || undefined,
      valor_unit: Number(form.valor_unit || 0),
      auto_source: form.auto_source || undefined,
      ordem: Number(form.ordem || 0),
      ativo: form.ativo,
    };
    if (!form.item.trim()) { toast({ title: "Informe o nome do serviço", variant: "destructive" }); return; }
    const onSuccess = () => { toast({ title: "Item salvo" }); setDialogOpen(false); refetch(); };
    const onError = () => toast({ title: "Erro ao salvar item", variant: "destructive" });
    if (editId != null) update.mutate({ id: editId, data: payload }, { onSuccess, onError });
    else create.mutate({ data: payload }, { onSuccess, onError });
  };

  const handleDelete = (id: number) => {
    del.mutate({ id }, { onSuccess: () => { toast({ title: "Item removido" }); refetch(); } });
  };

  const handleSaveConfig = () => {
    saveConfig.mutate(
      { data: { ad_valorem_rate: Number(rate || 0) / 100, cliente_nome: nome, cliente_email: email } },
      {
        onSuccess: () => { toast({ title: "Configurações salvas" }); qc.invalidateQueries({ queryKey: getGetBillingConfigQueryKey() }); },
        onError: () => toast({ title: "Erro ao salvar configurações", variant: "destructive" }),
      },
    );
  };

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">Tabela de Preços (LPU) & Configurações</h1>
      </div>

      {/* Configurações */}
      <Card>
        <CardHeader><CardTitle className="text-base">Configurações de cobrança</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Taxa Ad Valorem (%)</Label>
            <Input type="number" step="0.001" value={rate} onChange={(e) => setRate(e.target.value)} />
            <p className="text-xs text-muted-foreground">Aplicada sobre o valor total do estoque.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Nome do cliente</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail para envio da fatura</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@empresa.com" />
          </div>
          <div className="md:col-span-3">
            <Button onClick={handleSaveConfig} disabled={saveConfig.isPending}>Salvar configurações</Button>
          </div>
        </CardContent>
      </Card>

      {/* LPU */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Serviços e valores</CardTitle>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew} size="sm"><Plus className="h-4 w-4 mr-2" />Novo item</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editId != null ? "Editar item" : "Novo item"}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-2">
                <div className="space-y-1.5 col-span-2">
                  <Label>Grupo</Label>
                  <Select value={form.grupo} onValueChange={(v) => setForm((s) => ({ ...s, grupo: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(GRUPOS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v.emoji} {v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Serviço / Item</Label>
                  <Input value={form.item} onChange={(e) => setForm((s) => ({ ...s, item: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Unidade</Label>
                  <Input value={form.unidade} onChange={(e) => setForm((s) => ({ ...s, unidade: e.target.value }))} placeholder="palete, caixa..." />
                </div>
                <div className="space-y-1.5">
                  <Label>Valor unitário (R$)</Label>
                  <Input type="number" step="0.0001" value={form.valor_unit} onChange={(e) => setForm((s) => ({ ...s, valor_unit: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Origem da quantidade</Label>
                  <Select value={form.auto_source || "manual"} onValueChange={(v) => setForm((s) => ({ ...s, auto_source: v === "manual" ? "" : v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual (digitada)</SelectItem>
                      <SelectItem value="ad_valorem">Ad Valorem (% estoque)</SelectItem>
                      <SelectItem value="mov_entrada_pecas">Entradas (peças)</SelectItem>
                      <SelectItem value="mov_saida_pecas">Saídas (peças)</SelectItem>
                      <SelectItem value="mov_count">Nº de movimentações</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Ordem</Label>
                  <Input type="number" value={form.ordem} onChange={(e) => setForm((s) => ({ ...s, ordem: e.target.value }))} />
                </div>
                <div className="flex items-center gap-2 col-span-2">
                  <Switch checked={form.ativo} onCheckedChange={(v) => setForm((s) => ({ ...s, ativo: v }))} />
                  <Label>Ativo</Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handleSubmit} disabled={create.isPending || update.isPending}>Salvar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Grupo</TableHead>
                <TableHead>Serviço</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead className="text-right">Valor unit.</TableHead>
                <TableHead>Quantidade</TableHead>
                <TableHead></TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id} className={it.ativo ? "" : "opacity-50"}>
                  <TableCell className="text-sm">{GRUPOS[it.grupo]?.emoji} {GRUPOS[it.grupo]?.label ?? it.grupo}</TableCell>
                  <TableCell className="font-medium">{it.item}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{it.unidade}</TableCell>
                  <TableCell className="text-right">{fmtBRL(it.valor_unit)}</TableCell>
                  <TableCell className="text-sm">
                    {it.auto_source ? (
                      <Badge variant="outline" className="border-info-soft-border text-info-soft-foreground">{AUTO_LABELS[it.auto_source] || it.auto_source}</Badge>
                    ) : (
                      <span className="text-muted-foreground">Manual</span>
                    )}
                  </TableCell>
                  <TableCell>{!it.ativo && <Badge variant="outline">Inativo</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(it)}><Pencil className="h-4 w-4" /></Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remover "{it.item}"?</AlertDialogTitle>
                          <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(it.id)}>Remover</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
