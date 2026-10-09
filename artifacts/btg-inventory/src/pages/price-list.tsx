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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { MoreHorizontal, Plus } from "lucide-react";
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
  const [removing, setRemoving] = useState<PriceListItem | null>(null);

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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
          <h2 className="text-sm font-semibold">Serviços e valores</h2>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4" />
            Novo item
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-foreground/50">
                <th className="px-5 py-2.5 font-semibold">Serviço</th>
                <th className="px-3 py-2.5 font-semibold">Grupo</th>
                <th className="px-3 py-2.5 font-semibold">Unidade</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">Valor unit.</th>
                <th className="px-3 py-2.5 font-semibold">Quantidade</th>
                <th className="w-12 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-sm text-muted-foreground">
                    Nenhum serviço na tabela. Adicione o primeiro em "Novo item".
                  </td>
                </tr>
              ) : null}
              {items.map((it) => (
                <tr
                  key={it.id}
                  className={cn("border-b border-border/40 last:border-0", !it.ativo && "text-muted-foreground")}
                >
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{it.item}</span>
                      {!it.ativo ? <Badge variant="secondary">Inativo</Badge> : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">{GRUPOS[it.grupo]?.label ?? it.grupo}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{it.unidade}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{fmtBRL(it.valor_unit)}</td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {it.auto_source ? (
                      <Badge variant="default">{AUTO_LABELS[it.auto_source] || it.auto_source}</Badge>
                    ) : (
                      <span className="text-muted-foreground">Manual</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Ações de ${it.item}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openEdit(it)}>Editar</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onSelect={() => setRemoving(it)}>
                          Remover
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="h-fit rounded-lg border border-border bg-card">
        <h2 className="border-b border-border/60 px-5 py-3.5 text-sm font-semibold">Cobrança</h2>
        <div className="space-y-4 p-5">
          <div className="space-y-1.5">
            <Label htmlFor="billing-rate">Taxa ad valorem (%)</Label>
            <Input id="billing-rate" type="number" step="0.001" value={rate} onChange={(e) => setRate(e.target.value)} />
            <p className="text-xs text-muted-foreground">Aplicada sobre o valor total do estoque.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="billing-name">Nome do cliente</Label>
            <Input id="billing-name" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="billing-email">E-mail para envio da fatura</Label>
            <Input id="billing-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@empresa.com" />
          </div>
          <Button variant="outline" className="w-full" onClick={handleSaveConfig} disabled={saveConfig.isPending}>
            {saveConfig.isPending ? "Salvando..." : "Salvar cobrança"}
          </Button>
        </div>
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId != null ? "Editar item" : "Novo item"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5 col-span-2">
              <Label>Grupo</Label>
              <Select value={form.grupo} onValueChange={(v) => setForm((s) => ({ ...s, grupo: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(GRUPOS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
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

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover "{removing?.item}"?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing) handleDelete(removing.id);
                setRemoving(null);
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
