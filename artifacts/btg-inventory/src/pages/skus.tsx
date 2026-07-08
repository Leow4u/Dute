import { useState, useMemo } from "react";
import { useListSkus, useCreateSku, useUpdateSku, useDeleteSku, getListSkusQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Edit, Trash2, Filter, MapPin } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";

const skuSchema = z.object({
  cod_btg: z.string().min(1, "Obrigatório"),
  cod_cliente: z.string().min(1, "Obrigatório"),
  produto: z.string().min(1, "Obrigatório"),
  estoque_tipo: z.string().optional(),
  genero: z.string().optional(),
  categoria: z.string().optional(),
  cor: z.string().optional(),
  tamanho: z.string().optional(),
  estoque_atual: z.coerce.number().optional(),
  estado: z.string().optional(),
  rua: z.string().optional(),
  prateleira: z.string().optional(),
  caixa: z.string().optional(),
});

type SkuFormValues = z.infer<typeof skuSchema>;

export default function Skus() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  useMemo(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useListSkus(
    { search: debouncedSearch || undefined, limit, offset: page * limit },
    { query: { queryKey: getListSkusQueryKey({ search: debouncedSearch || undefined, limit, offset: page * limit }) } }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">Estoque de SKUs</h1>
          <p className="text-sm text-muted-foreground mt-1">Visão detalhada dos itens físicos de estoque e suas localizações.</p>
        </div>
        <SkuModal />
      </div>

      <Card className="border-border shadow-sm">
        <CardHeader className="bg-gray-50/50 border-b border-border py-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Buscar SKUs por código BTG, código do cliente, localização..." 
                className="pl-9 h-9 text-sm bg-white"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="outline" size="sm" className="h-9">
                <Filter className="mr-2 h-4 w-4" /> Filtrar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-gray-50/80 border-b border-border">
                <tr>
                  <th className="px-4 py-3 font-medium">Cod. BTG</th>
                  <th className="px-4 py-3 font-medium">Cod. Cliente</th>
                  <th className="px-4 py-3 font-medium">Detalhes do Produto</th>
                  <th className="px-4 py-3 font-medium text-center">Tipo</th>
                  <th className="px-4 py-3 font-medium text-center">Status</th>
                  <th className="px-4 py-3 font-medium">Localização</th>
                  <th className="px-4 py-3 font-medium text-right">Estoque Atual</th>
                  <th className="px-4 py-3 font-medium text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Carregando SKUs...</td>
                  </tr>
                ) : data?.items?.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Nenhum SKU encontrado.</td>
                  </tr>
                ) : (
                  data?.items?.map((sku) => (
                    <tr key={sku.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="px-4 py-2 font-mono text-xs text-primary font-bold">{sku.cod_btg}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{sku.cod_cliente}</td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-900 truncate max-w-[200px]" title={sku.produto}>{sku.produto}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {sku.categoria && `${sku.categoria} • `}
                          {sku.cor || "-"} / {sku.tamanho || "-"}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <Badge variant="outline" className="font-normal text-xs bg-gray-50">
                          {sku.estoque_tipo || "N/A"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <Badge variant="secondary" className={
                          sku.estado === 'NOVO' ? 'bg-emerald-50 text-emerald-700' :
                          sku.estado === 'AVARIADO' ? 'bg-rose-50 text-rose-700' :
                          'bg-amber-50 text-amber-700'
                        }>
                          {sku.estado || "N/A"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        {sku.rua || sku.prateleira || sku.caixa ? (
                          <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 px-2 py-1 rounded w-fit border border-indigo-100">
                            <MapPin className="h-3 w-3" />
                            {sku.rua ? `R${sku.rua}` : ''} 
                            {sku.prateleira ? ` P${sku.prateleira}` : ''} 
                            {sku.caixa ? ` C${sku.caixa}` : ''}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Não atribuída</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className={`font-bold ${sku.estoque_atual === 0 ? 'text-rose-500' : 'text-gray-900'}`}>
                          {sku.estoque_atual?.toLocaleString('pt-BR') || 0}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <SkuModal sku={sku} />
                          <DeleteSkuButton id={sku.id} cod_btg={sku.cod_btg} />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-gray-50/50">
            <div className="text-xs text-muted-foreground">
              Exibindo <span className="font-medium">{data?.items?.length || 0}</span> de <span className="font-medium">{data?.total || 0}</span> SKUs
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0 || isLoading}
              >
                Anterior
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setPage(p => p + 1)}
                disabled={!data || data.items.length < limit || isLoading}
              >
                Próximo
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SkuModal({ sku }: { sku?: any }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createSku = useCreateSku();
  const updateSku = useUpdateSku();

  const isEdit = !!sku;

  const { register, handleSubmit, formState: { errors }, reset } = useForm<SkuFormValues>({
    resolver: zodResolver(skuSchema),
    defaultValues: sku || {
      cod_btg: "",
      cod_cliente: "",
      produto: "",
      estoque_tipo: "BTG",
      genero: "",
      categoria: "",
      cor: "",
      tamanho: "",
      estoque_atual: 0,
      estado: "NOVO",
      rua: "",
      prateleira: "",
      caixa: "",
    }
  });

  const onSubmit = (data: SkuFormValues) => {
    if (isEdit) {
      updateSku.mutate(
        { id: sku.id, data },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListSkusQueryKey() });
            toast({ title: "SKU atualizado com sucesso" });
            setOpen(false);
          },
          onError: () => {
            toast({ title: "Erro ao atualizar SKU", variant: "destructive" });
          }
        }
      );
    } else {
      createSku.mutate(
        { data },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListSkusQueryKey() });
            toast({ title: "SKU criado com sucesso" });
            setOpen(false);
            reset();
          },
          onError: () => {
            toast({ title: "Erro ao criar SKU", variant: "destructive" });
          }
        }
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50">
            <Edit className="h-4 w-4" />
          </Button>
        ) : (
          <Button className="bg-primary hover:bg-primary/90 text-white shadow-sm h-9">
            <Plus className="mr-2 h-4 w-4" /> Adicionar SKU
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar SKU" : "Novo SKU"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 py-4">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">Identificadores</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cod_btg">Cod. BTG *</Label>
                <Input id="cod_btg" {...register("cod_btg")} />
                {errors.cod_btg && <span className="text-xs text-destructive">{errors.cod_btg.message}</span>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cod_cliente">Cod. Cliente *</Label>
                <Input id="cod_cliente" {...register("cod_cliente")} />
                {errors.cod_cliente && <span className="text-xs text-destructive">{errors.cod_cliente.message}</span>}
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="produto">Nome do Produto *</Label>
                <Input id="produto" {...register("produto")} />
                {errors.produto && <span className="text-xs text-destructive">{errors.produto.message}</span>}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">Atributos</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="categoria">Categoria</Label>
                <Input id="categoria" {...register("categoria")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cor">Cor</Label>
                <Input id="cor" {...register("cor")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tamanho">Tamanho</Label>
                <Input id="tamanho" {...register("tamanho")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estoque_tipo">Tipo de Estoque</Label>
                <Input id="estoque_tipo" placeholder="BTG" {...register("estoque_tipo")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estado">Condição</Label>
                <Input id="estado" placeholder="NOVO" {...register("estado")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estoque_atual">Qtde Inicial</Label>
                <Input id="estoque_atual" type="number" {...register("estoque_atual")} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">Localização</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rua">Rua</Label>
                <Input id="rua" {...register("rua")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prateleira">Prateleira</Label>
                <Input id="prateleira" {...register("prateleira")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="caixa">Caixa</Label>
                <Input id="caixa" {...register("caixa")} />
              </div>
            </div>
          </div>

          <DialogFooter className="pt-4 border-t border-border">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={createSku.isPending || updateSku.isPending}>
              {createSku.isPending || updateSku.isPending ? "Salvando..." : "Salvar SKU"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSkuButton({ id, cod_btg }: { id: number, cod_btg: string }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleteSku = useDeleteSku();

  const onDelete = () => {
    deleteSku.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSkusQueryKey() });
          toast({ title: "SKU excluído" });
          setOpen(false);
        },
        onError: () => {
          toast({ title: "Erro ao excluir SKU", variant: "destructive" });
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50">
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Excluir SKU</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            Tem certeza de que deseja excluir o SKU <strong className="text-foreground">{cod_btg}</strong>? 
            Esta ação não pode ser desfeita.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="button" variant="destructive" onClick={onDelete} disabled={deleteSku.isPending}>
            {deleteSku.isPending ? "Excluindo..." : "Excluir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
