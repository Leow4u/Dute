import { useState, useMemo } from "react";
import { useListProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, getListProductsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Edit, Trash2, Filter } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";

const productSchema = z.object({
  cod_cliente: z.string().min(1, "Obrigatório"),
  produto: z.string().min(1, "Obrigatório"),
  genero: z.string().optional(),
  categoria: z.string().optional(),
  grupo: z.string().optional(),
  cor: z.string().optional(),
  tamanho: z.string().optional(),
  preco_unit: z.coerce.number().optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

export default function Products() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  // Simple debounce for search
  useMemo(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useListProducts(
    { search: debouncedSearch || undefined, limit, offset: page * limit },
    { query: { queryKey: getListProductsQueryKey({ search: debouncedSearch || undefined, limit, offset: page * limit }) } }
  );

  const formatCurrency = (val?: number | null) => {
    if (val === null || val === undefined) return "-";
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">Catálogo de Produtos</h1>
          <p className="text-sm text-muted-foreground mt-1">Gerencie as definições mestras de produtos e visualize o estoque agregado.</p>
        </div>
        <ProductModal />
      </div>

      <Card className="border-border shadow-sm">
        <CardHeader className="bg-gray-50/50 border-b border-border py-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Buscar produtos por código, nome, categoria..." 
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
                  <th className="px-4 py-3 font-medium">Cod. Cliente</th>
                  <th className="px-4 py-3 font-medium">Nome do Produto</th>
                  <th className="px-4 py-3 font-medium">Categoria / Grupo</th>
                  <th className="px-4 py-3 font-medium">Cor / Tamanho</th>
                  <th className="px-4 py-3 font-medium text-right">Preço Unit.</th>
                  <th className="px-4 py-3 font-medium text-right">Estoque BTG</th>
                  <th className="px-4 py-3 font-medium text-right">Custo Total</th>
                  <th className="px-4 py-3 font-medium text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Carregando produtos...</td>
                  </tr>
                ) : data?.items?.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Nenhum produto encontrado.</td>
                  </tr>
                ) : (
                  data?.items?.map((product) => (
                    <tr key={product.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="px-4 py-2 font-mono text-xs text-primary font-semibold">{product.cod_cliente}</td>
                      <td className="px-4 py-2 font-medium max-w-[200px] truncate" title={product.produto}>{product.produto}</td>
                      <td className="px-4 py-2 text-xs">
                        {product.categoria && <Badge variant="secondary" className="mr-1 mb-1 font-normal bg-blue-50 text-blue-700">{product.categoria}</Badge>}
                        {product.grupo && <Badge variant="outline" className="font-normal text-gray-600">{product.grupo}</Badge>}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {product.cor || "-"} / {product.tamanho || "-"}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{formatCurrency(product.preco_unit)}</td>
                      <td className="px-4 py-2 text-right font-medium">{product.estoque_btg?.toLocaleString('pt-BR') || 0}</td>
                      <td className="px-4 py-2 text-right font-medium text-emerald-600">{formatCurrency(product.custo_total)}</td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <ProductModal product={product} />
                          <DeleteProductButton id={product.id} cod_cliente={product.cod_cliente} />
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
              Exibindo <span className="font-medium">{data?.items?.length || 0}</span> de <span className="font-medium">{data?.total || 0}</span> produtos
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

function ProductModal({ product }: { product?: any }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();

  const isEdit = !!product;

  const { register, handleSubmit, formState: { errors }, reset } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: product || {
      cod_cliente: "",
      produto: "",
      genero: "",
      categoria: "",
      grupo: "",
      cor: "",
      tamanho: "",
      preco_unit: 0,
    }
  });

  const onSubmit = (data: ProductFormValues) => {
    if (isEdit) {
      updateProduct.mutate(
        { id: product.id, data },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            toast({ title: "Produto atualizado com sucesso" });
            setOpen(false);
          },
          onError: () => {
            toast({ title: "Erro ao atualizar produto", variant: "destructive" });
          }
        }
      );
    } else {
      createProduct.mutate(
        { data },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            toast({ title: "Produto criado com sucesso" });
            setOpen(false);
            reset();
          },
          onError: () => {
            toast({ title: "Erro ao criar produto", variant: "destructive" });
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
            <Plus className="mr-2 h-4 w-4" /> Adicionar Produto
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Produto" : "Novo Produto"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cod_cliente">Cod. Cliente *</Label>
              <Input id="cod_cliente" {...register("cod_cliente")} />
              {errors.cod_cliente && <span className="text-xs text-destructive">{errors.cod_cliente.message}</span>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="preco_unit">Preço Unit. (R$)</Label>
              <Input id="preco_unit" type="number" step="0.01" {...register("preco_unit")} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="produto">Nome do Produto *</Label>
              <Input id="produto" {...register("produto")} />
              {errors.produto && <span className="text-xs text-destructive">{errors.produto.message}</span>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="categoria">Categoria</Label>
              <Input id="categoria" {...register("categoria")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grupo">Grupo</Label>
              <Input id="grupo" {...register("grupo")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="genero">Gênero</Label>
              <Input id="genero" {...register("genero")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cor">Cor</Label>
              <Input id="cor" {...register("cor")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tamanho">Tamanho</Label>
              <Input id="tamanho" {...register("tamanho")} />
            </div>
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={createProduct.isPending || updateProduct.isPending}>
              {createProduct.isPending || updateProduct.isPending ? "Salvando..." : "Salvar Produto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProductButton({ id, cod_cliente }: { id: number, cod_cliente: string }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleteProduct = useDeleteProduct();

  const onDelete = () => {
    deleteProduct.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          toast({ title: "Produto excluído" });
          setOpen(false);
        },
        onError: () => {
          toast({ title: "Erro ao excluir produto", variant: "destructive" });
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
          <DialogTitle>Excluir Produto</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            Tem certeza de que deseja excluir o produto <strong className="text-foreground">{cod_cliente}</strong>? 
            Esta ação não pode ser desfeita.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="button" variant="destructive" onClick={onDelete} disabled={deleteProduct.isPending}>
            {deleteProduct.isPending ? "Excluindo..." : "Excluir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
