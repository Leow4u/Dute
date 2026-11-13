import { useEffect, useId, useMemo, useRef, useState } from "react";
import { type Product, useListProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, getListProductsQueryKey } from "@workspace/api-client-react";
import { tamanhoDoCodigo } from "@workspace/dominio";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
import { LinhaDeEstado } from "@/components/ui/linha-de-estado";
import { ConteudoEmTroca, useListaComFiltro, useListaEmTroca } from "@/lib/carregando/use-lista-em-troca";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Boxes, CircleDollarSign, Edit, PackageSearch, Plus, Tags, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { useAppUser } from "@/lib/auth";
import { canSeeCatalogPrice, canWriteCatalog, humanApiError } from "@/lib/permissions";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import {
  formatCatalogGenero,
  catalogGeneroBadgeClass,
} from "@/lib/catalog-taxonomy";
import {
  formatStockMoney,
  formatStockNumber,
  StockFilterChip,
  StockMetricCard,
  StockMetricsGrid,
  StockPageShell,
  StockTableCard,
  StockTablePagination,
  StockToolbar,
} from "@/components/stock/stock-workbench";
import { atributosDoProblema, problemaDoNomeNoCadastro, seguirSugestao } from "@/features/warehouse-ops/product-identity";

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

/**
 * O nome no padrão de 06/11/2026: o tamanho fica no campo Tamanho e o nome é
 * o mesmo em todos os tamanhos. O formulário recusa antes de enviar, na
 * criação e quando o nome ou o tamanho mudam na edição (problemaDoNomeNoCadastro).
 */
function productSchemaFor(product?: { produto?: unknown; tamanho?: unknown }) {
  return productSchema.superRefine((dados, ctx) => {
    const achado = problemaDoNomeNoCadastro(dados, product);
    if (achado) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [achado.campo], message: achado.problema.mensagem });
  });
}

export default function Products() {
  // Espelho do requireCatalogWrite do servidor: quem não pode criar/editar
  // não vê o botão — antes o wms preenchia o formulário inteiro para
  // receber um "Erro ao criar produto" sem explicação.
  const { user } = useAppUser();
  const catalogWriter = canWriteCatalog(user?.publicMetadata.role);
  const showPrice = canSeeCatalogPrice(user?.publicMetadata.role);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("todos");
  const [page, setPage] = useState(0);
  const limit = 50;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  // A busca e a página leem no servidor: a lista anterior fica, a 50% e inert, até a nova chegar (carregamento
  // v2, momento 7, caso 4); a releitura que falha não a apaga, e a troca que falha mostra o aviso no lugar dela.
  const leitura = useListProducts(
    { search: debouncedSearch || undefined, limit, offset: page * limit },
    { query: { queryKey: getListProductsQueryKey({ search: debouncedSearch || undefined, limit, offset: page * limit }), placeholderData: keepPreviousData } }
  );
  const { data, isLoading } = leitura;
  const lista = useListaComFiltro(leitura);
  const troca = useListaEmTroca(lista.trocando);
  const idDaLinha = useId();

  const products = data?.items ?? [];
  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    products.forEach((product) => {
      const category = product.categoria?.trim() || "Sem categoria";
      counts.set(category, (counts.get(category) ?? 0) + 1);
    });
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 8);
  }, [products]);

  const filteredProducts =
    categoryFilter === "todos"
      ? products
      : products.filter(
          (product) => (product.categoria?.trim() || "Sem categoria") === categoryFilter,
        );

  const pageCost = products.reduce(
    (total, product) => total + Number(product.custo_total ?? 0),
    0,
  );
  const pagePieces = products.reduce(
    (total, product) => total + Number(product.estoque_btg ?? 0),
    0,
  );
  const missingCost = products.filter(
    (product) => Number(product.estoque_btg ?? 0) > 0 && Number(product.preco_unit ?? 0) <= 0,
  ).length;

  return (
    <StockPageShell
      eyebrow="Estoque"
      title="Produtos"
      icon={<PackageSearch className="h-6 w-6" />}
      actions={catalogWriter ? <ProductModal showPrice={showPrice} /> : undefined}
      // A casa do estado da lista, sob o título: "Atualizado às", a troca que passa de 5 s, a releitura que falha e a
      // falta de conexão, sem empurrar a lista (a primeira leitura ainda diz "Carregando..." na tabela; parte 13).
      estado={<LinhaDeEstado id={idDaLinha} leitura={leitura} objeto="produtos" primeiraNaLista />}
    >
      {/* "Peças na página" era soma do recorte visível — número que muda ao
          paginar e não sustenta decisão nenhuma. */}
      <StockMetricsGrid>
        <StockMetricCard
          label="Produtos cadastrados"
          value={formatStockNumber(data?.total ?? 0)}
          icon={<Tags className="h-5 w-5" />}
          tone="blue"
        />
        {showPrice ? (
          <StockMetricCard
            label="Valor carregado"
            value={formatStockMoney(pageCost)}
            icon={<CircleDollarSign className="h-5 w-5" />}
          />
        ) : null}
        {showPrice ? (
          <StockMetricCard
            label="Sem custo válido"
            value={formatStockNumber(missingCost)}
            icon={<AlertTriangle className="h-5 w-5" />}
            tone={missingCost ? "amber" : "default"}
          />
        ) : null}
      </StockMetricsGrid>

      <StockToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Buscar por cod. cliente, produto, categoria, cor ou tamanho"
        // A página que não chegou não tem contagem: o aviso está no lugar da lista, e "0" seria um falso zero.
        resultText={lista.falhou ? undefined : `${formatStockNumber(filteredProducts.length)} produto(s) nesta página`}
      >
        <StockFilterChip
          active={categoryFilter === "todos"}
          onClick={() => setCategoryFilter("todos")}
          count={lista.falhou ? undefined : products.length}
        >
          Todas categorias
        </StockFilterChip>
        {categoryOptions.map(([category, count]) => (
          <StockFilterChip
            key={category}
            active={categoryFilter === category}
            onClick={() => setCategoryFilter(category)}
            count={count}
          >
            {category}
          </StockFilterChip>
        ))}
      </StockToolbar>

      <StockTableCard trocando={lista.trocando} pagina={page}>
          {lista.falhou ? (
            <FalhaNaLeitura leitura={leitura} erro={lista.erro} mensagem="Não consegui carregar os produtos." className="rounded-none border-0" focoAoSair={idDaLinha} />
          ) : (
          <div className="overflow-x-auto" {...troca.props}>
            <ConteudoEmTroca trocando={lista.trocando}>
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase border-b border-border/80 bg-card">
                <tr>
                  <th className="px-5 py-4 font-medium">Cod. cliente</th>
                  <th className="px-5 py-4 font-medium">Produto</th>
                  <th className="px-4 py-3 font-medium">Gênero</th>
                  <th className="px-4 py-3 font-medium">Categoria / Grupo</th>
                  <th className="px-4 py-3 font-medium">Cor / Tamanho</th>
                  {showPrice ? <th className="px-4 py-3 font-medium text-right">Preço Unit.</th> : null}
                  <th className="px-4 py-3 font-medium text-right">Saldo físico</th>
                  {showPrice ? <th className="px-4 py-3 font-medium text-right">Custo Total</th> : null}
                  <th className="px-4 py-3 font-medium text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr>
                    <td colSpan={showPrice ? 9 : 7} className="px-4 py-8 text-center text-muted-foreground">Carregando produtos...</td>
                  </tr>
                ) : data?.items?.length === 0 ? (
                  <tr>
                    <td colSpan={showPrice ? 9 : 7} className="px-4 py-8 text-center text-muted-foreground">Nenhum produto encontrado.</td>
                  </tr>
                ) : (
                  filteredProducts.map((product: Product) => (
                    <tr key={product.id} className="hover:bg-card transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-primary font-semibold">{product.cod_cliente}</td>
                      <td className="px-5 py-3 font-medium max-w-[280px] truncate" title={product.produto}>{product.produto}</td>
                      <td className="px-4 py-2">
                        <Badge
                          variant="outline"
                          className={`font-normal ${catalogGeneroBadgeClass(product.genero)}`}
                        >
                          {formatCatalogGenero(product.genero)}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {product.categoria && <Badge variant="secondary" className="mr-1 mb-1 font-normal bg-primary/10 text-primary">{product.categoria}</Badge>}
                        {product.grupo && <Badge variant="outline" className="font-normal text-muted-foreground">{product.grupo}</Badge>}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {product.cor || "-"} / {product.tamanho || "-"}
                      </td>
                      {showPrice ? (
                        <td className="px-4 py-2 text-right text-muted-foreground">{formatStockMoney(product.preco_unit)}</td>
                      ) : null}
                      <td className="px-4 py-2 text-right font-medium">{formatStockNumber(product.estoque_btg)}</td>
                      {showPrice ? (
                        <td className="px-4 py-2 text-right font-medium text-foreground">{formatStockMoney(product.custo_total)}</td>
                      ) : null}
                      <td className="px-4 py-2 text-center">
                        {catalogWriter ? (
                          <div className="flex items-center justify-center gap-2">
                            <ProductModal product={product} showPrice={showPrice} />
                            <DeleteProductButton id={product.id} cod_cliente={product.cod_cliente} />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </ConteudoEmTroca>
          </div>
          )}
          
          <StockTablePagination
            page={page}
            isLoading={isLoading}
            ocupada={lista.trocando}
            semContagem={lista.falhou}
            count={data?.items?.length || 0}
            total={data?.total || 0}
            limit={limit}
            label="produtos"
            onPrevious={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => p + 1)}
          />
      </StockTableCard>
    </StockPageShell>
  );
}

export function ProductModal({ product, showPrice = false }: { product?: any; showPrice?: boolean }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();

  const isEdit = !!product;
  const schema = useMemo(() => productSchemaFor(product), [product]);
  // O Tamanho que o código pôs sozinho no produto novo (seguirSugestao).
  const tamanhoPosto = useRef("");

  const { register, handleSubmit, formState: { errors, isSubmitted }, reset, getValues, setValue, trigger } = useForm<ProductFormValues>({
    resolver: zodResolver(schema),
    // Campo nulo no cadastro vira vazio: o schema só aceita texto.
    defaultValues: product ? {
      ...product,
      genero: product.genero ?? "",
      categoria: product.categoria ?? "",
      grupo: product.grupo ?? "",
      cor: product.cor ?? "",
      tamanho: product.tamanho ?? "",
    } : {
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

  // No produto novo, o fim do código preenche o Tamanho (A.01.0806.005.XG → XG).
  const codCliente = register("cod_cliente", {
    onChange: (event) => {
      if (!isEdit) {
        const atual = getValues("tamanho") ?? "";
        const sugestao = seguirSugestao(atual, tamanhoPosto.current, tamanhoDoCodigo(event.target.value) ?? "");
        tamanhoPosto.current = sugestao.posto;
        if (sugestao.valor !== atual) setValue("tamanho", sugestao.valor);
      }
      // A recusa do nome depende do código: depois de tentar salvar, ela acompanha.
      if (isSubmitted) void trigger(["produto", "tamanho"]);
    },
  });

  const onSubmit = (data: ProductFormValues) => {
    const payload = showPrice ? data : { ...data, preco_unit: undefined };
    if (isEdit) {
      updateProduct.mutate(
        { id: product.id, data: payload },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            toast({ title: "Produto atualizado com sucesso" });
            setOpen(false);
          },
          onError: (error) => {
            toast({
              title: "Erro ao atualizar produto",
              description: humanApiError(error, "Tente novamente em instantes."),
              variant: "destructive",
            });
          }
        }
      );
    } else {
      createProduct.mutate(
        { data: payload },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            toast({ title: "Produto criado com sucesso" });
            setOpen(false);
            reset();
            tamanhoPosto.current = "";
          },
          onError: (error) => {
            toast({
              title: "Erro ao criar produto",
              description: humanApiError(error, "Tente novamente em instantes."),
              variant: "destructive",
            });
          }
        }
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-info-soft-foreground hover:text-info-soft-foreground hover:bg-info-soft">
            <Edit className="h-4 w-4" />
          </Button>
        ) : (
          <Button>
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
              <Input id="cod_cliente" {...codCliente} {...atributosDoProblema(errors.cod_cliente, "cod_cliente")} />
              {errors.cod_cliente && <span id="cod_cliente-problema" className="text-xs text-destructive">{errors.cod_cliente.message}</span>}
            </div>
            {showPrice ? (
              <div className="space-y-2">
                <Label htmlFor="preco_unit">Preço Unit. (R$)</Label>
                <Input id="preco_unit" type="number" step="0.01" {...register("preco_unit")} />
              </div>
            ) : (
              <div />
            )}
            <div className="space-y-2 col-span-2">
              <Label htmlFor="produto">Nome do Produto *</Label>
              <Input id="produto" className="aria-[invalid=true]:border-destructive" {...register("produto")} {...atributosDoProblema(errors.produto, "produto")} />
              {errors.produto && <span id="produto-problema" className="text-xs text-destructive">{errors.produto.message}</span>}
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
              <Input id="tamanho" className="aria-[invalid=true]:border-destructive" {...register("tamanho")} {...atributosDoProblema(errors.tamanho, "tamanho")} />
              {errors.tamanho && <span id="tamanho-problema" className="text-xs text-destructive">{errors.tamanho.message}</span>}
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
        onError: (error) => {
          toast({
            title: "Erro ao excluir produto",
            description: humanApiError(error, "Tente novamente em instantes."),
            variant: "destructive",
          });
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive-soft-foreground hover:text-destructive-soft-foreground hover:bg-destructive-soft">
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
