/** Inventory workspaces: opening inventory + cycle count. */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  ImagePlus,
  ListChecks,
  PackageOpen,
  PackageSearch,
  PlayCircle,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  type AnyRecord,
  coerceNumber,
  coerceText,
  formatCurrency,
  formatDeltaUnits,
  formatNumber,
  getErrorMessage,
  normalizeStatus,
  fetchJson,
} from "@/lib/warehouse-ops/model";
import {
  type ProductLookupItem,
  type ProductPhoto,
  productLookupFromRecord,
  uploadProductPhoto,
} from "@/features/warehouse-ops/shared";
import {
  type ReceiptDraftLine,
  emptyReceiptLine,
  findExistingProduct,
  mergeProductLookup,
  normalizeApiRows,
  normalizeProductKey,
  similarProductNames,
  sourcePhotos,
  sourceText,
} from "@/features/warehouse-ops/receiving";
import {
  CATALOG_GENEROS,
  CATALOG_GRUPOS,
  inferGeneroFromClientCode,
  inferGrupoFromProduto,
} from "@/lib/catalog-taxonomy";

export type CycleCountResult = {
  ok?: boolean;
  cycle_count_id?: string;
  movement_id?: string;
  qty_before?: number;
  qty_counted?: number;
  qty_reserved?: number;
  qty_available?: number;
  adjustment_delta?: number;
  adjustment_qty?: number;
  adjustment_type?: string;
};

export type OpeningInventoryLine = {
  id: string;
  client_item_code?: string;
  sku_code?: string;
  product_name?: string;
  category?: string;
  genero?: string;
  grupo?: string;
  location_id?: string;
  counted_qty?: number;
  unit_cost?: number;
  total_cost?: number;
};

export type OpeningInventorySession = {
  ok?: boolean;
  id?: string;
  session_id?: string;
  status?: "not_started" | "open" | "completed" | string;
  line_count?: number;
  unit_count?: number;
  total_cost?: number;
  started_at?: string;
  completed_at?: string;
  lines?: OpeningInventoryLine[];
};

export function CycleCountWorkspace() {
  const [mode, setMode] = useState<"opening" | "cycle">("opening");
  return (
    <div className="space-y-5">
      <div className="flex w-fit items-center rounded-[16px] border border-border bg-card/70 p-1 shadow-[0_8px_24px_rgba(15,23,42,.04)]">
        <Button
          type="button"
          variant={mode === "opening" ? "secondary" : "ghost"}
          className={cn(mode === "opening" && "text-primary")}
          onClick={() => setMode("opening")}
        >
          <PackageOpen data-icon="inline-start" />
          Inventário de abertura
        </Button>
        <Button
          type="button"
          variant={mode === "cycle" ? "secondary" : "ghost"}
          className={cn(mode === "cycle" && "text-primary")}
          onClick={() => setMode("cycle")}
        >
          <ListChecks data-icon="inline-start" />
          Inventário cíclico
        </Button>
      </div>
      {mode === "opening" ? (
        <OpeningInventoryWorkspace />
      ) : (
        <ExistingCycleCountWorkspace />
      )}
    </div>
  );
}

export function OpeningInventoryWorkspace() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [clientCode, setClientCode] = useState("");
  const [skuCode, setSkuCode] = useState("");
  const [productName, setProductName] = useState("");
  const [category, setCategory] = useState("");
  const [genero, setGenero] = useState("");
  const [grupo, setGrupo] = useState("");
  const [barcode, setBarcode] = useState("");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [locationId, setLocationId] = useState("");
  const [countedQty, setCountedQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reference, setReference] = useState("");
  const [photos, setPhotos] = useState<ProductPhoto[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [createNew, setCreateNew] = useState(false);
  const [selectedProduct, setSelectedProduct] =
    useState<ProductLookupItem>();
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [lineToRemove, setLineToRemove] = useState<OpeningInventoryLine>();

  useEffect(() => {
    const suggested = inferGeneroFromClientCode(clientCode);
    if (suggested) {
      setGenero((current) => current || suggested);
    }
  }, [clientCode]);

  useEffect(() => {
    const suggested = inferGrupoFromProduto(productName);
    if (suggested) {
      setGrupo((current) => current || suggested);
    }
  }, [productName]);

  const sessionQuery = useQuery<OpeningInventorySession>({
    queryKey: ["opening-inventory-session"],
    queryFn: () =>
      fetchJson<OpeningInventorySession>(
        "/api/warehouse/opening-inventory/session",
      ),
    staleTime: 10_000,
  });
  const lookupQuery = useQuery({
    queryKey: ["opening-inventory-product-lookup"],
    staleTime: 30_000,
    queryFn: async () => {
      const [skusPayload, productsPayload] = await Promise.all([
        fetchJson<unknown>("/api/skus?limit=5000"),
        fetchJson<unknown>("/api/products?limit=5000"),
      ]);
      return mergeProductLookup(
        normalizeApiRows(skusPayload).map(productLookupFromRecord),
        normalizeApiRows(productsPayload).map(productLookupFromRecord),
      );
    },
  });
  const lookupProducts = lookupQuery.data ?? [];
  const draftLine = useMemo<ReceiptDraftLine>(
    () => ({
      sku: skuCode,
      clientCode,
      product: productName,
      category,
      barcode,
      brand,
      size,
      color,
      photos,
      photoUploading,
      quantity: countedQty || "0",
      unitCost,
      location: locationId,
      createNew,
    }),
    [
      barcode,
      brand,
      category,
      clientCode,
      color,
      countedQty,
      createNew,
      locationId,
      photoUploading,
      photos,
      productName,
      size,
      skuCode,
      unitCost,
    ],
  );
  const clientCodeMatch = useMemo(() => {
    const key = normalizeProductKey(clientCode);
    return key
      ? lookupProducts.find(
          (product) => normalizeProductKey(product.clientCode) === key,
        )
      : undefined;
  }, [clientCode, lookupProducts]);
  const skuCodeMatch = useMemo(() => {
    const key = normalizeProductKey(skuCode);
    return key
      ? lookupProducts.find(
          (product) => normalizeProductKey(product.skuCode) === key,
        )
      : undefined;
  }, [lookupProducts, skuCode]);
  const identityConflict = Boolean(
    (clientCodeMatch &&
      skuCode.trim() &&
      normalizeProductKey(clientCodeMatch.skuCode) !==
        normalizeProductKey(skuCode)) ||
      (skuCodeMatch &&
        clientCode.trim() &&
        normalizeProductKey(skuCodeMatch.clientCode) !==
          normalizeProductKey(clientCode)) ||
      (clientCodeMatch &&
        skuCodeMatch &&
        clientCodeMatch.id !== skuCodeMatch.id),
  );
  const existingProduct = identityConflict
    ? undefined
    : skuCodeMatch ?? clientCodeMatch;
  const similarProducts = useMemo(
    () => (existingProduct ? [] : similarProductNames(draftLine, lookupProducts)),
    [draftLine, existingProduct, lookupProducts],
  );
  const session = sessionQuery.data;
  const sessionLines = session?.lines ?? [];
  const sessionOpen = session?.status === "open";
  const parsedCount = Number(countedQty);
  const parsedCost = Number(unitCost);
  const hasIdentity = Boolean(clientCode.trim() || skuCode.trim());
  const newProductComplete =
    Boolean(productName.trim()) &&
    Boolean(category.trim()) &&
    Boolean(genero.trim()) &&
    Boolean(grupo.trim()) &&
    Number.isFinite(parsedCost) &&
    parsedCost > 0 &&
    photos.length > 0;
  const taxonomyComplete = Boolean(genero.trim()) && Boolean(grupo.trim());
  const selectedProductCost =
    Number.isFinite(parsedCost) && parsedCost > 0
      ? parsedCost
      : selectedProduct?.unitCost ?? 0;
  const canSubmit =
    sessionOpen &&
    hasIdentity &&
    lookupQuery.isSuccess &&
    !identityConflict &&
    Boolean(locationId.trim()) &&
    countedQty.trim() !== "" &&
    Number.isFinite(parsedCount) &&
    parsedCount >= 0 &&
    !photoUploading &&
    taxonomyComplete &&
    ((Boolean(selectedProduct?.hasSku) && selectedProductCost > 0) ||
      (createNew && newProductComplete)) &&
    !(selectedProduct && createNew);

  const startSession = useMutation<OpeningInventorySession, Error>({
    mutationFn: () =>
      fetchJson<OpeningInventorySession>(
        "/api/warehouse/opening-inventory/session",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customer_code: "BTG Pactual",
            reference: `Inventário de abertura ${new Date().toLocaleDateString("pt-BR")}`,
            idempotency_key: crypto.randomUUID(),
          }),
        },
      ),
    onSuccess: () => {
      setCompleteDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["opening-inventory-session"] });
      toast({
        title: "Inventário de abertura iniciado",
        description: "Cada produto confirmado já ficará registrado no ledger.",
      });
    },
    onError: (error) =>
      toast({
        title: "Não consegui iniciar o inventário",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  const completeSession = useMutation<OpeningInventorySession, Error>({
    mutationFn: () =>
      fetchJson<OpeningInventorySession>(
        "/api/warehouse/opening-inventory/session/complete",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customer_code: "BTG Pactual",
            session_id: session?.session_id,
            idempotency_key: crypto.randomUUID(),
          }),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opening-inventory-session"] });
      toast({
        title: "Inventário de abertura concluído",
        description: "A sessão foi fechada e permanece disponível para auditoria.",
      });
    },
    onError: (error) =>
      toast({
        title: "Não consegui concluir a sessão",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  const recordOpeningLine = useMutation<CycleCountResult, Error>({
    mutationFn: () =>
      fetchJson<CycleCountResult>("/api/warehouse/cycle-counts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "opening",
          session_id: session?.session_id,
          customer_code: "BTG Pactual",
          sku_code:
            selectedProduct?.skuCode || skuCode.trim() || clientCode.trim(),
          client_item_code:
            selectedProduct?.clientCode || clientCode.trim() || skuCode.trim(),
          product_name: selectedProduct?.productName || productName.trim(),
          product_registration: selectedProduct ? "existing" : "new",
          category:
            category.trim() ||
            sourceText(selectedProduct?.source ?? {}, "category", "categoria") ||
            undefined,
          genero:
            genero.trim() ||
            sourceText(selectedProduct?.source ?? {}, "genero") ||
            undefined,
          grupo:
            grupo.trim() ||
            sourceText(selectedProduct?.source ?? {}, "grupo") ||
            undefined,
          barcode: barcode.trim() || undefined,
          brand: brand.trim() || undefined,
          size: size.trim() || undefined,
          color: color.trim() || undefined,
          photo_urls: photos.map((photo) => photo.fileUrl),
          photo_storage_paths: photos.map((photo) => photo.storagePath),
          location_id: locationId.trim(),
          counted_qty: parsedCount,
          unit_cost: unitCost.trim()
            ? parsedCost
            : selectedProduct?.unitCost || undefined,
          reason: "Inventário físico de abertura do estoque",
          reference: reference.trim() || session?.session_id,
          occurred_at: new Date().toISOString(),
          idempotency_key: crypto.randomUUID(),
        }),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["opening-inventory-session"] });
      queryClient.invalidateQueries({ queryKey: ["opening-inventory-product-lookup"] });
      queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
      toast({
        title: "Produto contado e publicado",
        description: `${formatNumber(result.qty_counted)} unidade(s) registradas no estoque.`,
      });
      setClientCode("");
      setSkuCode("");
      setProductName("");
      setCategory("");
      setGenero("");
      setGrupo("");
      setBarcode("");
      setBrand("");
      setSize("");
      setColor("");
      setCountedQty("");
      setUnitCost("");
      setReference("");
      setPhotos([]);
      setCreateNew(false);
      setSelectedProduct(undefined);
    },
    onError: (error) =>
      toast({
        title: "Não consegui publicar a contagem",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  const removeOpeningLine = useMutation<unknown, Error, OpeningInventoryLine>({
    mutationFn: (line) =>
      fetchJson(
        `/api/warehouse/opening-inventory/lines/${encodeURIComponent(line.id)}/remove`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customer_code: "BTG Pactual",
            session_id: session?.session_id,
            idempotency_key: crypto.randomUUID(),
          }),
        },
      ),
    onSuccess: () => {
      setLineToRemove(undefined);
      queryClient.invalidateQueries({ queryKey: ["opening-inventory-session"] });
      queryClient.invalidateQueries({
        queryKey: ["opening-inventory-product-lookup"],
      });
      queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      toast({
        title: "Linha removida para correção",
        description: "O saldo foi estornado com trilha de auditoria. Faça o lançamento correto.",
      });
    },
    onError: (error) =>
      toast({
        title: "Não consegui remover a linha",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  function applyProduct(product: ProductLookupItem) {
    setClientCode(product.clientCode);
    setSkuCode(product.skuCode);
    setProductName(product.productName);
    setCategory(sourceText(product.source, "category", "categoria"));
    setGenero(
      sourceText(product.source, "genero") ||
        inferGeneroFromClientCode(product.clientCode) ||
        "",
    );
    setGrupo(
      sourceText(product.source, "grupo") ||
        inferGrupoFromProduto(product.productName) ||
        "",
    );
    setBarcode(sourceText(product.source, "barcode"));
    setBrand(sourceText(product.source, "brand", "marca"));
    setSize(sourceText(product.source, "size", "tamanho"));
    setColor(sourceText(product.source, "color", "cor"));
    setUnitCost(product.unitCost > 0 ? String(product.unitCost) : "");
    setPhotos(sourcePhotos(product.source));
    setCreateNew(false);
    setSelectedProduct(product);
  }

  async function addOpeningPhotos(files: FileList | null) {
    const selected = Array.from(files ?? []).slice(0, 4);
    if (!selected.length) return;
    setPhotoUploading(true);
    try {
      const clientItemCode =
        clientCode.trim() || skuCode.trim() || `abertura-${Date.now()}`;
      const uploaded = await Promise.all(
        selected.map((file) => uploadProductPhoto(file, clientItemCode)),
      );
      setPhotos((current) => [...current, ...uploaded].slice(0, 8));
    } catch (error) {
      toast({
        title: "Não consegui anexar a foto",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setPhotoUploading(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="overflow-hidden rounded-[28px] border-border/80 bg-card/72 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]">
        <CardHeader className="border-b border-border/70 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-[18px] border border-primary/20 bg-primary/10 text-primary">
                <PackageOpen className="size-5" />
              </div>
              <div>
                <CardTitle>Inventário de abertura</CardTitle>
              </div>
            </div>
            {session?.status === "not_started" ? (
              <Button
                type="button"
                onClick={() => startSession.mutate()}
                disabled={startSession.isPending}
              >
                {startSession.isPending ? (
                  <RefreshCw data-icon="inline-start" className="animate-spin" />
                ) : (
                  <PlayCircle data-icon="inline-start" />
                )}
                Iniciar contagem
              </Button>
            ) : (
              <Badge
                variant="outline"
                className={cn(
                  "w-fit",
                  sessionOpen
                    ? "border-primary/20 bg-primary/10 text-primary"
                    : "border-border bg-card/70",
                )}
              >
                {sessionOpen ? "sessão em andamento" : "sessão concluída"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {sessionQuery.isLoading ? (
            <Skeleton className="h-72 w-full rounded-[22px]" />
          ) : sessionQuery.isError ? (
            <Alert variant="destructive" className="bg-destructive/10">
              <AlertCircle className="size-4" />
              <AlertTitle>Não foi possível carregar o inventário</AlertTitle>
              <AlertDescription className="mt-2 flex flex-col gap-3">
                <span>{getErrorMessage(sessionQuery.error)}</span>
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit"
                  onClick={() => sessionQuery.refetch()}
                >
                  <RefreshCw data-icon="inline-start" />
                  Tentar novamente
                </Button>
              </AlertDescription>
            </Alert>
          ) : !sessionOpen ? (
            <Empty className="min-h-72 rounded-[22px] border border-dashed border-border bg-card/40">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ClipboardCheck className="size-5" />
                </EmptyMedia>
                <EmptyTitle>
                  {session?.status === "completed"
                    ? "Inventário de abertura encerrado"
                    : "Inicie a sessão para lançar o primeiro produto"}
                </EmptyTitle>
                <EmptyDescription>
                  {session?.status === "completed"
                    ? "Novas entradas agora devem ser feitas pelo fluxo de Recebimento."
                    : "A sessão cria a trilha de auditoria para todas as contagens iniciais."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <form
              className="space-y-6"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSubmit && !recordOpeningLine.isPending) {
                  recordOpeningLine.mutate();
                }
              }}
            >
              <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.5fr]">
                <div className="space-y-2">
                  <Label htmlFor="opening-client-code">Cód. cliente</Label>
                  <Input
                    id="opening-client-code"
                    value={clientCode}
                    onChange={(event) => {
                      setClientCode(event.target.value);
                      setCreateNew(false);
                      setSelectedProduct(undefined);
                    }}
                    placeholder="Código usado pelo BTG"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="opening-sku">SKU interno</Label>
                  <Input
                    id="opening-sku"
                    value={skuCode}
                    onChange={(event) => {
                      setSkuCode(event.target.value);
                      setCreateNew(false);
                      setSelectedProduct(undefined);
                    }}
                    placeholder="Opcional; usa o cód. cliente"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="opening-product">Produto</Label>
                  <Input
                    id="opening-product"
                    value={productName}
                    onChange={(event) => setProductName(event.target.value)}
                    placeholder="Descrição clara do produto"
                  />
                </div>
              </div>

              {lookupQuery.isLoading || lookupQuery.isFetching ? (
                <Alert className="border-border bg-card/60">
                  <RefreshCw className="size-4 animate-spin" />
                  <AlertTitle>Verificando o catálogo</AlertTitle>
                  <AlertDescription>
                    Aguarde a confirmação antes de cadastrar o produto.
                  </AlertDescription>
                </Alert>
              ) : lookupQuery.isError ? (
                <Alert variant="destructive" className="bg-destructive/10">
                  <AlertCircle className="size-4" />
                  <AlertTitle>Catálogo indisponível</AlertTitle>
                  <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      O cadastro de produto novo foi bloqueado para evitar duplicidade.
                    </span>
                    <Button type="button" variant="outline" onClick={() => lookupQuery.refetch()}>
                      <RefreshCw data-icon="inline-start" />
                      Tentar novamente
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : identityConflict ? (
                <Alert variant="destructive" className="bg-destructive/10">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>Códigos pertencem a cadastros diferentes</AlertTitle>
                  <AlertDescription>
                    Revise o Cód. cliente e o SKU. O sistema não permite combinar identidades de produtos diferentes.
                  </AlertDescription>
                </Alert>
              ) : existingProduct && !existingProduct.hasSku ? (
                <Alert variant="destructive" className="bg-destructive/10">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>Cadastro incompleto</AlertTitle>
                  <AlertDescription>
                    Este produto não possui SKU válido. Um administrador precisa corrigir o cadastro antes da contagem.
                  </AlertDescription>
                </Alert>
              ) : existingProduct ? (
                <div className="flex flex-col gap-3 rounded-[20px] border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      Produto já cadastrado: {existingProduct.productName}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Cod. cliente {existingProduct.clientCode} · SKU {existingProduct.skuCode}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={selectedProduct?.id === existingProduct.id}
                    onClick={() => applyProduct(existingProduct)}
                  >
                    {selectedProduct?.id === existingProduct.id
                      ? "Cadastro selecionado"
                      : "Usar este cadastro"}
                  </Button>
                </div>
              ) : hasIdentity && lookupQuery.isSuccess ? (
                <Alert className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>Produto não encontrado</AlertTitle>
                  <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      Confirme que é realmente novo antes de criar uma identidade no estoque.
                      {similarProducts.length
                        ? ` Parecidos: ${similarProducts
                            .map((product) => product.productName)
                            .join(", ")}.`
                        : ""}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant={createNew ? "default" : "outline"}
                      onClick={() => setCreateNew((current) => !current)}
                    >
                      {createNew ? "Novo produto confirmado" : "Cadastrar como novo"}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Obrigatória para novo" />
                </div>
                <div className="space-y-2">
                  <Label>Gênero</Label>
                  <Select value={genero || undefined} onValueChange={setGenero}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o gênero" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATALOG_GENEROS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Grupo</Label>
                  <Select value={grupo || undefined} onValueChange={setGrupo}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o grupo" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATALOG_GRUPOS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Marca</Label>
                  <Input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="Marca" />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label>Tamanho</Label>
                  <Input value={size} onChange={(event) => setSize(event.target.value)} placeholder="Tamanho" />
                </div>
                <div className="space-y-2">
                  <Label>Cor</Label>
                  <Input value={color} onChange={(event) => setColor(event.target.value)} placeholder="Cor" />
                </div>
                <div className="space-y-2">
                  <Label>Código de barras</Label>
                  <Input value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Opcional" />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <Label>Endereço físico</Label>
                  <Input value={locationId} onChange={(event) => setLocationId(event.target.value)} placeholder="Rua / prateleira / caixa" />
                </div>
                <div className="space-y-2">
                  <Label>Contagem física</Label>
                  <Input value={countedQty} onChange={(event) => setCountedQty(event.target.value)} type="number" min="0" step="1" placeholder="0" />
                </div>
                <div className="space-y-2">
                  <Label>Custo unitário</Label>
                  <Input value={unitCost} onChange={(event) => setUnitCost(event.target.value)} type="number" min="0" step="0.01" placeholder="R$ 0,00" />
                </div>
                <div className="space-y-2">
                  <Label>Referência</Label>
                  <Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Etiqueta, lote ou observação" />
                </div>
              </div>

              <div className="rounded-[20px] border border-border bg-card/60 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Fotos do produto</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Use a câmera do celular ou anexe imagens existentes.
                    </p>
                  </div>
                  <label
                    htmlFor="opening-product-photo"
                    className={cn(
                      "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[14px] border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted",
                      photoUploading && "pointer-events-none opacity-60",
                    )}
                  >
                    {photoUploading ? <RefreshCw className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                    {photoUploading ? "Enviando..." : "Adicionar foto"}
                  </label>
                  <input
                    id="opening-product-photo"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    className="sr-only"
                    onChange={(event) => {
                      void addOpeningPhotos(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </div>
                {photos.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {photos.map((photo, index) => (
                      <div key={photo.storagePath} className="relative size-24 overflow-hidden rounded-[16px] border border-border bg-muted">
                        <img src={photo.fileUrl} alt={`Foto ${index + 1} do produto`} className="size-full object-cover" />
                        <button type="button" className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-card/90" aria-label={`Remover foto ${index + 1}`} onClick={() => setPhotos((current) => current.filter((_, currentIndex) => currentIndex !== index))}>
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-[16px] border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
                    Produto novo precisa de ao menos uma foto.
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 rounded-[22px] border border-border bg-card/60 p-4 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm leading-6 text-muted-foreground">
                  Ao confirmar, o sistema cria produto e SKU quando necessário, registra o movimento de entrada e publica o saldo para o cliente.
                </p>
                <Button type="submit" disabled={!canSubmit || recordOpeningLine.isPending}>
                  {recordOpeningLine.isPending ? <RefreshCw data-icon="inline-start" className="animate-spin" /> : <CheckCircle2 data-icon="inline-start" />}
                  Confirmar produto
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="rounded-[24px] border-border/80 bg-card/72 shadow-[0_18px_60px_rgba(15,23,42,.05)]">
          <CardHeader>
            <CardTitle className="text-base">Progresso da abertura</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[16px] border border-border bg-card/60 p-3">
                <div className="text-xs text-muted-foreground">Produtos</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{formatNumber(session?.line_count)}</div>
              </div>
              <div className="rounded-[16px] border border-border bg-card/60 p-3">
                <div className="text-xs text-muted-foreground">Unidades</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{formatNumber(session?.unit_count)}</div>
              </div>
            </div>
            <div className="rounded-[16px] border border-border bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">Valor controlado</div>
              <div className="mt-1 text-lg font-semibold text-foreground">{formatCurrency(coerceNumber(session?.total_cost))}</div>
            </div>
            {sessionOpen ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={
                  !session?.line_count ||
                  completeSession.isPending ||
                  removeOpeningLine.isPending
                }
                onClick={() => setCompleteDialogOpen(true)}
              >
                <CheckCircle2 data-icon="inline-start" />
                Concluir inventário
              </Button>
            ) : null}

            <div className="border-t border-border/70 pt-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Linhas conferidas
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Revise antes de encerrar a abertura.
                  </div>
                </div>
                <Badge variant="outline">{formatNumber(sessionLines.length)}</Badge>
              </div>

              {sessionLines.length ? (
                <ScrollArea className="h-[300px] pr-3">
                  <div className="space-y-2">
                    {sessionLines.map((line) => (
                      <div
                        key={line.id}
                        className="flex items-start gap-3 rounded-[16px] border border-border bg-card/60 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">
                            {line.product_name || line.client_item_code || line.sku_code}
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            {line.client_item_code || "Sem cód. cliente"}
                            {line.sku_code ? ` · ${line.sku_code}` : ""}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>{formatNumber(line.counted_qty)} un.</span>
                            <span>{line.location_id || "Sem endereço"}</span>
                            <span>
                              {formatCurrency(
                                coerceNumber(line.total_cost) ||
                                  coerceNumber(line.counted_qty) *
                                    coerceNumber(line.unit_cost),
                              )}
                            </span>
                          </div>
                        </div>
                        {sessionOpen ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => setLineToRemove(line)}
                            disabled={removeOpeningLine.isPending}
                            aria-label={`Remover ${line.product_name || line.client_item_code || line.sku_code}`}
                            title="Remover para corrigir"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <div className="rounded-[16px] border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
                  Nenhum produto confirmado nesta sessão.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Alert className="border-primary/20 bg-primary/5">
          <Sparkles className="size-4 text-primary" />
          <AlertTitle>Agent Dute acompanha a abertura</AlertTitle>
          <AlertDescription>
            Cada confirmação gera evento operacional com produto, quantidade, custo, endereço e responsável.
          </AlertDescription>
        </Alert>
      </div>

      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Concluir o inventário de abertura?</DialogTitle>
            <DialogDescription>
              Confirme somente depois que todos os produtos físicos tiverem sido
              contados. Esta sessão será encerrada e as próximas entradas deverão
              ser feitas em WMS &gt; Recebimento.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="rounded-[16px] border border-border bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">Produtos</div>
              <div className="mt-1 text-xl font-semibold text-foreground">
                {formatNumber(session?.line_count)}
              </div>
            </div>
            <div className="rounded-[16px] border border-border bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">Unidades</div>
              <div className="mt-1 text-xl font-semibold text-foreground">
                {formatNumber(session?.unit_count)}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCompleteDialogOpen(false)}
              disabled={completeSession.isPending}
            >
              Continuar contando
            </Button>
            <Button
              type="button"
              onClick={() => completeSession.mutate()}
              disabled={
                !session?.line_count ||
                completeSession.isPending ||
                removeOpeningLine.isPending
              }
            >
              {completeSession.isPending ? (
                <RefreshCw data-icon="inline-start" className="animate-spin" />
              ) : (
                <CheckCircle2 data-icon="inline-start" />
              )}
              Confirmar encerramento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(lineToRemove)}
        onOpenChange={(open) => {
          if (!open && !removeOpeningLine.isPending) setLineToRemove(undefined);
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Remover esta linha para corrigir?</DialogTitle>
            <DialogDescription>
              O saldo lançado será estornado com registro permanente no ledger.
              Depois, você poderá contar e lançar o produto novamente com os dados corretos.
            </DialogDescription>
          </DialogHeader>
          {lineToRemove ? (
            <div className="rounded-[18px] border border-border bg-card/60 p-4">
              <div className="font-medium text-foreground">
                {lineToRemove.product_name ||
                  lineToRemove.client_item_code ||
                  lineToRemove.sku_code}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {lineToRemove.client_item_code || "Sem cód. cliente"}
                {lineToRemove.sku_code ? ` · ${lineToRemove.sku_code}` : ""}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">
                  {formatNumber(lineToRemove.counted_qty)} unidade(s)
                </Badge>
                <Badge variant="outline">
                  {lineToRemove.location_id || "Sem endereço"}
                </Badge>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLineToRemove(undefined)}
              disabled={removeOpeningLine.isPending}
            >
              Manter linha
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (lineToRemove) removeOpeningLine.mutate(lineToRemove);
              }}
              disabled={!lineToRemove || removeOpeningLine.isPending}
            >
              {removeOpeningLine.isPending ? (
                <RefreshCw data-icon="inline-start" className="animate-spin" />
              ) : (
                <Trash2 data-icon="inline-start" />
              )}
              Remover para corrigir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ExistingCycleCountWorkspace() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [clientCode, setClientCode] = useState("");
  const [skuCode, setSkuCode] = useState("");
  const [productName, setProductName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [countedQty, setCountedQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");

  const lookupQuery = useQuery({
    queryKey: ["cycle-count-product-lookup"],
    staleTime: 60_000,
    queryFn: async () => {
      const [skusPayload, productsPayload] = await Promise.all([
        fetchJson<unknown>("/api/skus?limit=5000"),
        fetchJson<unknown>("/api/products?limit=5000"),
      ]);
      const skus = normalizeApiRows(skusPayload).map(productLookupFromRecord);
      const products = normalizeApiRows(productsPayload).map(productLookupFromRecord);
      return mergeProductLookup(skus, products);
    },
  });

  const lookupProducts = lookupQuery.data ?? [];
  const draftLine = useMemo<ReceiptDraftLine>(
    () => ({
      sku: skuCode,
      clientCode,
      product: productName,
      category: "",
      barcode: "",
      brand: "",
      size: "",
      color: "",
      photos: [],
      photoUploading: false,
      quantity: countedQty || "0",
      unitCost,
      location: locationId,
      createNew: false,
    }),
    [clientCode, countedQty, locationId, productName, skuCode, unitCost],
  );
  const existingProduct = useMemo(
    () => findExistingProduct(draftLine, lookupProducts),
    [draftLine, lookupProducts],
  );
  const similarProducts = useMemo(
    () => (existingProduct ? [] : similarProductNames(draftLine, lookupProducts)),
    [draftLine, existingProduct, lookupProducts],
  );
  const parsedCount = Number(countedQty);
  const hasCount = countedQty.trim() !== "" && Number.isFinite(parsedCount);
  const canSubmit =
    Boolean(existingProduct) &&
    Boolean(locationId.trim()) &&
    hasCount &&
    parsedCount >= 0 &&
    reason.trim().length >= 3;

  const cycleCount = useMutation<CycleCountResult, Error>({
    mutationFn: () =>
      fetchJson<CycleCountResult>("/api/warehouse/cycle-counts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer_code: "BTG Pactual",
          sku_code: existingProduct?.skuCode || skuCode.trim(),
          client_item_code: existingProduct?.clientCode || clientCode.trim(),
          product_name: existingProduct?.productName || productName.trim(),
          location_id: locationId.trim(),
          counted_qty: parsedCount,
          unit_cost: unitCost.trim()
            ? Number(unitCost)
            : existingProduct?.unitCost || undefined,
          reason: reason.trim(),
          reference: reference.trim() || undefined,
          occurred_at: new Date().toISOString(),
          idempotency_key: crypto.randomUUID(),
        }),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
      toast({
        title:
          result.adjustment_delta === 0
            ? "Contagem registrada"
            : "Estoque ajustado",
        description:
          result.adjustment_delta === 0
            ? "A contagem não encontrou divergência física."
            : `Diferença registrada: ${formatDeltaUnits(result.adjustment_delta)}.`,
      });
      setCountedQty("");
      setReason("");
      setReference("");
    },
    onError: (error) => {
      toast({
        title: "Não consegui registrar a contagem",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  function applyProduct(product: ProductLookupItem) {
    setClientCode(product.clientCode);
    setSkuCode(product.skuCode);
    setProductName(product.productName);
    setUnitCost(product.unitCost > 0 ? String(product.unitCost) : "");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || cycleCount.isPending) return;
    cycleCount.mutate();
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="overflow-hidden rounded-[28px] border-border/80 bg-card/72 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]">
        <CardHeader className="border-b border-border/70 p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-[18px] border border-primary/20 bg-primary/10 text-primary">
                <ListChecks className="size-5" />
              </div>
              <div>
                <CardTitle>Inventário cíclico</CardTitle>
              </div>
            </div>
            <Badge variant="outline" className="w-fit border-primary/20 bg-primary/10 text-primary">
              ajuste auditado
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <form className="space-y-6" onSubmit={submit}>
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.4fr]">
              <div className="space-y-2">
                <Label htmlFor="cycle-client-code">Cód. cliente</Label>
                <Input
                  id="cycle-client-code"
                  value={clientCode}
                  onChange={(event) => setClientCode(event.target.value)}
                  placeholder="Ex.: C.0659.001.U"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cycle-sku-code">SKU interno</Label>
                <Input
                  id="cycle-sku-code"
                  value={skuCode}
                  onChange={(event) => setSkuCode(event.target.value)}
                  placeholder="Ex.: BTG-2089"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cycle-product-name">Produto</Label>
                <Input
                  id="cycle-product-name"
                  value={productName}
                  onChange={(event) => setProductName(event.target.value)}
                  placeholder="Nome do produto"
                />
              </div>
            </div>

            {existingProduct ? (
              <div className="flex flex-col gap-3 rounded-[20px] border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {existingProduct.productName}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Cod. cliente {existingProduct.clientCode || "sem código"} · SKU{" "}
                    {existingProduct.skuCode}
                  </div>
                </div>
                <Button type="button" variant="outline" onClick={() => applyProduct(existingProduct)}>
                  Usar cadastro
                </Button>
              </div>
            ) : clientCode.trim() || skuCode.trim() || productName.trim() ? (
              <Alert className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
                <AlertTriangle className="size-4" />
                <AlertTitle>Produto ainda não localizado</AlertTitle>
                <AlertDescription>
                  Inventário cíclico ajusta apenas produtos já cadastrados e com
                  saldo físico criado. Se for produto novo, use Recebimento.
                  {similarProducts.length ? (
                    <span className="mt-2 block text-xs">
                      Parecidos:{" "}
                      {similarProducts
                        .map((product) => `${product.productName} (${product.clientCode})`)
                        .join(", ")}
                    </span>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="cycle-location">Endereço contado</Label>
                <Input
                  id="cycle-location"
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                  placeholder="Rua / prateleira / caixa"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cycle-count">Contagem física</Label>
                <Input
                  id="cycle-count"
                  value={countedQty}
                  onChange={(event) => setCountedQty(event.target.value)}
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cycle-unit-cost">Custo unitário</Label>
                <Input
                  id="cycle-unit-cost"
                  value={unitCost}
                  onChange={(event) => setUnitCost(event.target.value)}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Opcional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cycle-reference">Referência</Label>
                <Input
                  id="cycle-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Auditoria, foto, inventário..."
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cycle-reason">Motivo do ajuste</Label>
              <Textarea
                id="cycle-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ex.: contagem cíclica da rua A, divergência apurada na conferência física."
              />
            </div>

            <div className="flex flex-col gap-3 rounded-[22px] border border-border bg-card/60 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Confirmação operacional
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  O saldo atual será lido no backend dentro da transação. Se a
                  contagem for menor que uma reserva ativa, o ajuste será bloqueado.
                </p>
              </div>
              <Button type="submit" disabled={!canSubmit || cycleCount.isPending}>
                {cycleCount.isPending ? (
                  <RefreshCw data-icon="inline-start" className="animate-spin" />
                ) : (
                  <CheckCircle2 data-icon="inline-start" />
                )}
                Registrar contagem
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="rounded-[24px] border-border/80 bg-card/72 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]">
          <CardHeader>
            <CardTitle className="text-base">Regra operacional</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="rounded-[18px] border border-border bg-card/55 p-3">
              <strong className="text-foreground">Produto novo</strong>
              <p className="mt-1">Use Recebimento para criar cadastro e conferência.</p>
            </div>
            <div className="rounded-[18px] border border-border bg-card/55 p-3">
              <strong className="text-foreground">Divergência</strong>
              <p className="mt-1">A diferença gera movimento e evento para o Agent Dute.</p>
            </div>
            <div className="rounded-[18px] border border-border bg-card/55 p-3">
              <strong className="text-foreground">Reserva ativa</strong>
              <p className="mt-1">O sistema bloqueia contagem menor que itens reservados.</p>
            </div>
          </CardContent>
        </Card>

        <Alert className="border-primary/20 bg-primary/5">
          <Sparkles className="size-4 text-primary" />
          <AlertTitle>Memória do Agent Dute</AlertTitle>
          <AlertDescription>
            Cada contagem vira evento operacional. Divergências aparecem como
            atenção para investigação e histórico do cliente.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}

