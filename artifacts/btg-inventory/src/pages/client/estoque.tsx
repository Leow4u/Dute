import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  Archive,
  Box,
  CheckCircle2,
  ChevronRight,
  Eye,
  Grid2X2,
  List,
  Minus,
  Package,
  PackageCheck,
  PackagePlus,
  Plus,
  RotateCcw,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import {
  ClientDataBoundary,
  ClientModuleShell,
  EmptyModuleState,
  ModulePanel,
  clientOverviewQueryKey,
  createClientRequest,
  firstText,
  formatNumber,
  getInventoryItems,
  inventoryItemAvailable,
  inventoryItemClientCode,
  inventoryItemName,
  inventoryItemReserved,
  inventoryItemPhoto,
  inventoryItemSku,
  inventoryItemTotal,
  inventoryItemValue,
  formatMoney,
  normalizeSlug,
  type CreateClientRequestItem,
  type CreateClientRequestPayload,
  type InventoryItem,
} from "./shared";

type StockViewMode = "lista" | "cards";
type StockFilter = "todos" | "disponiveis" | "baixo" | "zerado" | "arquivados";
type StockSort = "relevancia" | "maior-saldo" | "menor-saldo" | "nome";
type ProductAction = "restock" | "archive";

type StockProduct = {
  key: string;
  sku: string;
  clientCode: string;
  clientItemCode?: string | null;
  name: string;
  category: string;
  available: number;
  reserved: number;
  total: number;
  value: number;
  photoUrl: string | null;
  sources: InventoryItem[];
};

type CartLine = {
  product: StockProduct;
  quantity: number;
};

type ProductActionCommand = {
  action: ProductAction;
  productKey: string;
  payload: CreateClientRequestPayload;
};

const stockFilterOptions: Array<{
  value: StockFilter;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "todos", label: "Todos", icon: Package },
  { value: "disponiveis", label: "Disponiveis", icon: PackageCheck },
  { value: "baixo", label: "Baixo estoque", icon: AlertTriangle },
  { value: "zerado", label: "Sem estoque", icon: Archive },
  { value: "arquivados", label: "Arquivados", icon: Archive },
];

const STOCK_PAGE_SIZE = 48;

const stockSortOptions: Array<{
  value: StockSort;
  label: string;
}> = [
  { value: "relevancia", label: "Mais relevantes" },
  { value: "maior-saldo", label: "Maior saldo" },
  { value: "menor-saldo", label: "Menor saldo" },
  { value: "nome", label: "Nome: A-Z" },
];

export function ClienteEstoque() {
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<StockViewMode>("cards");
  const [stockFilter, setStockFilter] = useState<StockFilter>("todos");
  const [categoryFilter, setCategoryFilter] = useState("todos");
  const [sortMode, setSortMode] = useState<StockSort>("relevancia");
  const [visibleProductLimit, setVisibleProductLimit] =
    useState(STOCK_PAGE_SIZE);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [draftQuantities, setDraftQuantities] = useState<
    Record<string, number>
  >({});
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedProductKey, setSelectedProductKey] = useState<string | null>(
    null,
  );
  const [archivedProductKeys, setArchivedProductKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [destination, setDestination] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const requestMutation = useMutation({
    mutationFn: createClientRequest,
    onSuccess: () => {
      toast({
        title: "Pedido enviado para a Dutelog",
        description:
          "O tracking do pedido ja esta disponivel em Pedidos/Entregas.",
      });
      setCart({});
      setCartOpen(false);
      setDestination("");
      setDueAt("");
      setNotes("");
      void invalidateClientData(queryClient);
      navigate("/portal/pedidos");
    },
    onError: (error) => {
      toast({
        title: "Nao foi possivel enviar o pedido",
        description:
          error instanceof Error
            ? error.message
            : "Revise os itens selecionados e tente novamente.",
        variant: "destructive",
      });
    },
  });

  const productActionMutation = useMutation({
    mutationFn: async (command: ProductActionCommand) => {
      const request = await createClientRequest(command.payload);
      return { ...command, request };
    },
    onSuccess: ({ action, productKey }) => {
      if (action === "archive") {
        setArchivedProductKeys((current) => {
          const next = new Set(current);
          next.add(productKey);
          return next;
        });
        setSelectedProductKey(null);
      }

      toast({
        title:
          action === "restock"
            ? "Reposicao avisada para a Dutelog"
            : "Arquivamento solicitado",
        description:
          action === "restock"
            ? "A equipe vai acompanhar a chegada do fornecedor."
            : "O produto foi ocultado da vitrine e segue preservado no historico.",
      });

      void invalidateClientData(queryClient);
    },
    onError: (error) => {
      toast({
        title: "Nao foi possivel registrar a acao",
        description:
          error instanceof Error
            ? error.message
            : "Tente novamente em alguns instantes.",
        variant: "destructive",
      });
    },
  });

  return (
    <ClientDataBoundary>
      {(overview) => {
        const rawItems = getInventoryItems(overview);
        const products = groupInventoryProducts(rawItems);
        const productByKey = new Map(
          products.map((product) => [product.key, product]),
        );
        const cartLines = getCartLines(cart, productByKey);
        const cartQuantity = cartLines.reduce(
          (sum, line) => sum + line.quantity,
          0,
        );
        const selectedProduct = selectedProductKey
          ? (productByKey.get(selectedProductKey) ?? null)
          : null;
        const categories = getCategoryOptions(products);
        const filteredProducts = filterProducts({
          products,
          cart,
          searchTerm,
          categoryFilter,
          stockFilter,
          archivedProductKeys,
        });
        const sortedProducts = sortProducts(filteredProducts, cart, sortMode);
        const visibleProducts = sortedProducts.slice(0, visibleProductLimit);
        const hasMoreProducts = visibleProducts.length < sortedProducts.length;
        const hasActiveFilters =
          Boolean(searchTerm.trim()) ||
          stockFilter !== "todos" ||
          categoryFilter !== "todos" ||
          sortMode !== "relevancia";

        function resetVisibleProducts() {
          setVisibleProductLimit(STOCK_PAGE_SIZE);
        }

        function updateSearch(value: string) {
          setSearchTerm(value);
          resetVisibleProducts();
        }

        function updateStockFilter(value: StockFilter) {
          setStockFilter(value);
          resetVisibleProducts();
        }

        function updateCategoryFilter(value: string) {
          setCategoryFilter(value);
          resetVisibleProducts();
        }

        function updateSortMode(value: StockSort) {
          setSortMode(value);
          resetVisibleProducts();
        }

        function clearCatalogFilters() {
          setSearchTerm("");
          setStockFilter("todos");
          setCategoryFilter("todos");
          setSortMode("relevancia");
          resetVisibleProducts();
        }
        function getDraftQuantity(product: StockProduct) {
          const max = liveAvailableForProduct(product, cart);
          if (max <= 0) return 0;
          return clampQuantity(draftQuantities[product.key] ?? 1, max);
        }

        function updateDraftQuantity(product: StockProduct, quantity: number) {
          const max = liveAvailableForProduct(product, cart);
          setDraftQuantities((current) => ({
            ...current,
            [product.key]: max <= 0 ? 0 : clampQuantity(quantity, max),
          }));
        }

        function addDraftToCart(product: StockProduct) {
          const liveAvailable = liveAvailableForProduct(product, cart);
          const quantity = Math.min(getDraftQuantity(product), liveAvailable);

          if (quantity <= 0) {
            toast({
              title: "Sem saldo disponivel",
              description:
                "Todo o saldo deste produto ja foi selecionado ou esta indisponivel.",
              variant: "destructive",
            });
            return;
          }

          setCart((current) => {
            const currentQuantity = current[product.key] ?? 0;
            return {
              ...current,
              [product.key]: Math.min(
                product.available,
                currentQuantity + quantity,
              ),
            };
          });
          setDraftQuantities((current) => ({
            ...current,
            [product.key]: 1,
          }));
          setSelectedProductKey(null);
        }

        function addSingleToCart(product: StockProduct) {
          updateDraftQuantity(product, 1);
          const liveAvailable = liveAvailableForProduct(product, cart);
          if (liveAvailable <= 0) return;
          setCart((current) => ({
            ...current,
            [product.key]: Math.min(
              product.available,
              (current[product.key] ?? 0) + 1,
            ),
          }));
          setSelectedProductKey(null);
        }

        function setCartQuantity(product: StockProduct, quantity: number) {
          setCart((current) => {
            const nextQuantity = Math.min(
              product.available,
              Math.max(0, Math.floor(quantity || 0)),
            );
            if (nextQuantity <= 0) {
              const { [product.key]: _removed, ...rest } = current;
              return rest;
            }
            return { ...current, [product.key]: nextQuantity };
          });
        }

        function removeFromCart(product: StockProduct) {
          setCart((current) => {
            const { [product.key]: _removed, ...rest } = current;
            return rest;
          });
        }

        function requestReplenishment(product: StockProduct) {
          productActionMutation.mutate({
            action: "restock",
            productKey: product.key,
            payload: buildReplenishmentRequest(product),
          });
        }

        function requestArchive(product: StockProduct) {
          productActionMutation.mutate({
            action: "archive",
            productKey: product.key,
            payload: buildArchiveRequest(product),
          });
        }

        function submitCart() {
          if (cartLines.length === 0) {
            toast({
              title: "Nenhum item selecionado",
              description: "Selecione ao menos um item para montar o pedido de abastecimento.",
              variant: "destructive",
            });
            return;
          }

          if (!destination.trim()) {
            toast({
              title: "Informe a unidade de entrega",
              description:
                "A Dutelog precisa saber para qual unidade o pedido sera enviado.",
              variant: "destructive",
            });
            return;
          }

          const requestItems = buildCartRequestItems(cartLines);
          if (requestItems.length === 0) {
            toast({
              title: "Estoque indisponivel",
              description: "Revise os itens selecionados e tente novamente.",
              variant: "destructive",
            });
            return;
          }

          requestMutation.mutate({
            type: "retirada",
            priority: "normal",
            title: `Pedido do estoque com ${formatNumber(cartLines.length)} item(ns)`,
            description: [
              `Pedido montado no estoque para ${destination.trim()}`,
              notes.trim(),
            ]
              .filter(Boolean)
              .join(" | "),
            destination: destination.trim(),
            due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
            items: requestItems,
          });
        }

        return (
          <ClientModuleShell
            overview={overview}
            title="Estoque"
            icon={Box}
            className="max-w-[1720px]"
          >
            {products.length > 0 ? (
              <MarketplaceToolbar
                searchTerm={searchTerm}
                stockFilter={stockFilter}
                categoryFilter={categoryFilter}
                categories={categories}
                sortMode={sortMode}
                viewMode={viewMode}
                cartQuantity={cartQuantity}
                cartOpen={cartOpen}
                visibleCount={sortedProducts.length}
                hasActiveFilters={hasActiveFilters}
                onSearchChange={updateSearch}
                onStockFilterChange={updateStockFilter}
                onCategoryFilterChange={updateCategoryFilter}
                onSortModeChange={updateSortMode}
                onViewModeChange={setViewMode}
                onClearFilters={clearCatalogFilters}
                onCartToggle={() => {
                  setCartOpen((current) => !current);
                  setSelectedProductKey(null);
                }}
              />
            ) : null}

            <section className="min-h-0 flex-1 overflow-x-hidden">
              <div className="min-w-0 space-y-4 overflow-x-hidden">
                {products.length > 0 ? (
                  filteredProducts.length > 0 ? (
                    viewMode === "lista" ? (
                      <StockList
                        products={visibleProducts}
                        cart={cart}
                        draftQuantities={draftQuantities}
                        onDraftQuantityChange={updateDraftQuantity}
                        onAdd={addDraftToCart}
                        onAddOne={addSingleToCart}
                        onDetails={(product) => {
                          setSelectedProductKey(product.key);
                          setCartOpen(false);
                        }}
                        onReplenish={requestReplenishment}
                        onArchive={requestArchive}
                      />
                    ) : (
                      <StockCardGrid
                        products={visibleProducts}
                        cart={cart}
                        draftQuantities={draftQuantities}
                        onDraftQuantityChange={updateDraftQuantity}
                        onAdd={addDraftToCart}
                        onDetails={(product) => {
                          setSelectedProductKey(product.key);
                          setCartOpen(false);
                        }}
                        onReplenish={requestReplenishment}
                        onArchive={requestArchive}
                      />
                    )
                  ) : (
                    <EmptyModuleState
                      title="Nenhum produto encontrado"
                      description="Ajuste a busca, filtros de estoque ou categoria."
                      icon={Search}
                    />
                  )
                ) : (
                  <OpeningInventoryState
                    onNotifyDelivery={() => navigate("/portal/recebimentos")}
                  />
                )}
                {sortedProducts.length > 0 ? (
                  <CatalogProgress
                    displayedCount={visibleProducts.length}
                    totalCount={sortedProducts.length}
                    canLoadMore={hasMoreProducts}
                    onLoadMore={() =>
                      setVisibleProductLimit(
                        (current) => current + STOCK_PAGE_SIZE,
                      )
                    }
                  />
                ) : null}
              </div>
            </section>

            {cartOpen ? (
              <SideDrawer onClose={() => setCartOpen(false)}>
                <CartPanel
                  lines={cartLines}
                  destination={destination}
                  dueAt={dueAt}
                  notes={notes}
                  isSubmitting={requestMutation.isPending}
                  onClose={() => setCartOpen(false)}
                  onDestinationChange={setDestination}
                  onDueAtChange={setDueAt}
                  onNotesChange={setNotes}
                  onIncrement={(product) => addSingleToCart(product)}
                  onDecrement={(product) =>
                    setCartQuantity(product, (cart[product.key] ?? 0) - 1)
                  }
                  onQuantityChange={setCartQuantity}
                  onRemove={removeFromCart}
                  onSubmit={submitCart}
                />
              </SideDrawer>
            ) : selectedProduct ? (
              <SideDrawer onClose={() => setSelectedProductKey(null)}>
                <ProductDetailPanel
                  product={selectedProduct}
                  cart={cart}
                  draftQuantity={getDraftQuantity(selectedProduct)}
                  previewQuantity={draftPreviewQuantityForProduct(
                    selectedProduct,
                    cart,
                    draftQuantities,
                  )}
                  isPending={productActionMutation.isPending}
                  onClose={() => setSelectedProductKey(null)}
                  onDraftQuantityChange={(quantity) =>
                    updateDraftQuantity(selectedProduct, quantity)
                  }
                  onAdd={() => addDraftToCart(selectedProduct)}
                  onReplenish={() => requestReplenishment(selectedProduct)}
                  onArchive={() => requestArchive(selectedProduct)}
                />
              </SideDrawer>
            ) : null}
          </ClientModuleShell>
        );
      }}
    </ClientDataBoundary>
  );
}

function OpeningInventoryState({
  onNotifyDelivery,
}: {
  onNotifyDelivery: () => void;
}) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-[24px] border border-dashed border-border bg-white/45 px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-[20px] border border-border bg-white text-primary">
        <Package className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-lg font-semibold text-foreground">
        Inventário inicial em andamento
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        A Dutelog está contando e cadastrando os produtos. Os saldos aparecerão aqui somente depois da conferência física.
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-6 rounded-2xl"
        onClick={onNotifyDelivery}
      >
        <PackagePlus className="h-4 w-4" />
        Avisar uma entrega
      </Button>
    </div>
  );
}

function MarketplaceToolbar({
  searchTerm,
  stockFilter,
  categoryFilter,
  categories,
  sortMode,
  viewMode,
  cartQuantity,
  cartOpen,
  visibleCount,
  hasActiveFilters,
  onSearchChange,
  onStockFilterChange,
  onCategoryFilterChange,
  onSortModeChange,
  onViewModeChange,
  onClearFilters,
  onCartToggle,
}: {
  searchTerm: string;
  stockFilter: StockFilter;
  categoryFilter: string;
  categories: Array<{ value: string; label: string; count: number }>;
  sortMode: StockSort;
  viewMode: StockViewMode;
  cartQuantity: number;
  cartOpen: boolean;
  visibleCount: number;
  hasActiveFilters: boolean;
  onSearchChange: (value: string) => void;
  onStockFilterChange: (value: StockFilter) => void;
  onCategoryFilterChange: (value: string) => void;
  onSortModeChange: (value: StockSort) => void;
  onViewModeChange: (value: StockViewMode) => void;
  onClearFilters: () => void;
  onCartToggle: () => void;
}) {
  return (
    <section
      data-testid="stock-toolbar"
      className="sticky top-0 z-20 shrink-0 rounded-[24px] border border-border bg-white/88 p-3 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px] sm:p-4"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar produto, cod. cliente ou categoria"
            aria-label="Buscar produto, cod. cliente ou categoria"
            className="h-11 rounded-[18px] border-border bg-white/80 pl-11 text-sm"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div
            role="group"
            aria-label="Formato de visualizacao"
            className="flex items-center gap-1 rounded-[16px] border border-border bg-white/70 p-1"
          >
            <ViewModeButton
              active={viewMode === "cards"}
              icon={Grid2X2}
              label="Cards"
              onClick={() => onViewModeChange("cards")}
            />
            <ViewModeButton
              active={viewMode === "lista"}
              icon={List}
              label="Lista"
              onClick={() => onViewModeChange("lista")}
            />
          </div>
          <button
            type="button"
            onClick={onCartToggle}
            aria-expanded={cartOpen}
            aria-label={`Abrir pedido de abastecimento com ${formatNumber(cartQuantity)} item(ns)`}
            className={cn(
              "relative flex h-11 cursor-pointer items-center gap-2 rounded-[18px] border px-3.5 text-sm font-medium transition hover:bg-[#F5F6F7] active:translate-y-px",
              cartOpen
                ? "border-primary/25 bg-primary/10 text-primary"
                : "border-border bg-white/75 text-foreground",
            )}
          >
            <ShoppingCart className="h-4 w-4" aria-hidden="true" />
            Pedido
            <span
              className={cn(
                "flex min-w-7 items-center justify-center rounded-full px-2 py-1 text-xs font-semibold",
                cartQuantity > 0
                  ? "bg-primary text-white shadow-[0_8px_24px_rgba(110,158,248,.25)]"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {formatNumber(cartQuantity)}
            </span>
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        <div
          role="group"
          aria-label="Filtrar disponibilidade"
          className="-mx-1 flex min-w-0 items-center gap-2 overflow-x-auto px-1 pb-1 xl:pb-0"
        >
          {stockFilterOptions.map((option) => (
            <FilterChip
              key={option.value}
              active={stockFilter === option.value}
              icon={option.icon}
              label={option.label}
              onClick={() => onStockFilterChange(option.value)}
            />
          ))}
        </div>

        {/* Poucas categorias (vestuário, mobiliário...) merecem chips à
            vista, não um dropdown; acima de 6 volta o seletor compacto. */}
        {categories.length <= 6 ? (
          <div
            role="group"
            aria-label="Filtrar por categoria"
            className="-mx-1 flex min-w-0 items-center gap-2 overflow-x-auto px-1 pb-1 xl:pb-0"
          >
            {categories.map((category) => (
              <FilterChip
                key={category.value}
                active={categoryFilter === category.value}
                label={`${category.label} (${formatNumber(category.count)})`}
                onClick={() => onCategoryFilterChange(category.value)}
              />
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {categories.length > 6 ? (
            <CatalogSelect
              ariaLabel="Filtrar por categoria"
              icon={SlidersHorizontal}
              value={categoryFilter}
              onChange={onCategoryFilterChange}
              options={categories.map((category) => ({
                value: category.value,
                label: `${category.label} (${formatNumber(category.count)})`,
              }))}
            />
          ) : null}
          <CatalogSelect
            ariaLabel="Ordenar produtos"
            icon={ArrowDownWideNarrow}
            value={sortMode}
            onChange={(value) => onSortModeChange(value as StockSort)}
            options={stockSortOptions}
          />
          {hasActiveFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="cursor-pointer text-muted-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Limpar
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
        <p>
          <span className="font-semibold text-foreground">
            {formatNumber(visibleCount)}
          </span>{" "}
          produto(s) no catalogo
        </p>
        <p className="hidden sm:block">
          O saldo exibido considera os itens selecionados neste pedido.
        </p>
      </div>
    </section>
  );
}

function CatalogSelect({
  ariaLabel,
  icon: Icon,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  icon: LucideIcon;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-9 min-w-[178px] cursor-pointer items-center gap-2 rounded-[14px] border border-border bg-white/70 px-3 text-xs text-muted-foreground transition hover:bg-white focus-within:ring-2 focus-within:ring-ring/25">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent text-xs font-medium text-foreground outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CatalogProgress({
  displayedCount,
  totalCount,
  canLoadMore,
  onLoadMore,
}: {
  displayedCount: number;
  totalCount: number;
  canLoadMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-between gap-3 rounded-[18px] border border-border/80 bg-white/56 px-4 py-3 text-center sm:flex-row sm:text-left">
      <p className="text-xs text-muted-foreground">
        Exibindo{" "}
        <span className="font-semibold text-foreground">
          {formatNumber(displayedCount)}
        </span>{" "}
        de{" "}
        <span className="font-semibold text-foreground">
          {formatNumber(totalCount)}
        </span>{" "}
        produto(s)
      </p>
      {canLoadMore ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onLoadMore}
          className="cursor-pointer"
        >
          Carregar mais{" "}
          {formatNumber(Math.min(STOCK_PAGE_SIZE, totalCount - displayedCount))}
        </Button>
      ) : (
        <span className="text-xs font-medium text-muted-foreground">
          Catalogo completo
        </span>
      )}
    </div>
  );
}

function StockList({
  products,
  cart,
  draftQuantities,
  onDraftQuantityChange,
  onAdd,
  onAddOne,
  onDetails,
  onReplenish,
  onArchive,
}: {
  products: StockProduct[];
  cart: Record<string, number>;
  draftQuantities: Record<string, number>;
  onDraftQuantityChange: (product: StockProduct, quantity: number) => void;
  onAdd: (product: StockProduct) => void;
  onAddOne: (product: StockProduct) => void;
  onDetails: (product: StockProduct) => void;
  onReplenish: (product: StockProduct) => void;
  onArchive: (product: StockProduct) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-border bg-white/70 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]">
      <Table className="min-w-[1120px]">
        <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur-[24px]">
          <TableRow>
            <TableHead className="w-[140px]">Cod. cliente</TableHead>
            <TableHead className="min-w-[360px]">Produto</TableHead>
            <TableHead className="w-[150px]">Categoria</TableHead>
            <TableHead className="text-right">Disponivel</TableHead>
            <TableHead className="text-right">Reservado</TableHead>
            <TableHead className="text-right">Valor em estoque</TableHead>
            <TableHead className="w-[270px] text-right">Pedido</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => {
            const liveAvailable = liveAvailableForProduct(product, cart);
            const previewQuantity = draftPreviewQuantityForProduct(
              product,
              cart,
              draftQuantities,
            );
            const displayedAvailable = displayedAvailableForProduct(
              product,
              cart,
              draftQuantities,
            );
            const draftQuantity = draftQuantityForProduct(
              product,
              cart,
              draftQuantities,
            );
            const status = productStatus(product, displayedAvailable);

            return (
              <TableRow key={product.key}>
                <TableCell className="font-medium text-foreground">
                  {product.clientCode}
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => onDetails(product)}
                    className="max-w-[520px] cursor-pointer truncate text-left font-medium text-foreground transition hover:text-primary"
                    title={product.name}
                  >
                    {product.name}
                  </button>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <StockBadge status={status} />
                    {cart[product.key] ? (
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                        {formatNumber(cart[product.key])} selecionado(s)
                      </span>
                    ) : null}
                    {previewQuantity > 0 ? (
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                        {formatNumber(previewQuantity)} em edicao
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {product.category}
                </TableCell>
                <TableCell className="text-right">
                  <p className="font-semibold text-foreground">
                    {formatNumber(displayedAvailable)}
                  </p>
                  {previewQuantity > 0 ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      restara de {formatNumber(liveAvailable)}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {formatNumber(product.reserved)}
                </TableCell>
                <TableCell
                  className="text-right text-muted-foreground"
                  title="Custo do material que você já adquiriu — não é preço de venda."
                >
                  {formatMoney(product.value)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    {product.available > 0 ? (
                      <>
                        <QuantityStepper
                          label={product.name}
                          value={draftQuantity}
                          max={liveAvailable}
                          onChange={(quantity) =>
                            onDraftQuantityChange(product, quantity)
                          }
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={liveAvailable <= 0}
                          className="cursor-pointer"
                          onClick={() =>
                            draftQuantity > 1
                              ? onAdd(product)
                              : onAddOne(product)
                          }
                        >
                          <ShoppingCart className="h-4 w-4" />
                          Adicionar
                        </Button>
                      </>
                    ) : (
                      <ZeroStockActions
                        compact
                        onReplenish={() => onReplenish(product)}
                        onArchive={() => onArchive(product)}
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="cursor-pointer"
                      onClick={() => onDetails(product)}
                      aria-label="Ver detalhes"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SideDrawer({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-900/10 p-3 backdrop-blur-[2px] sm:p-5">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label="Fechar painel"
      />
      <div className="relative z-[1] h-full w-full max-w-[430px] overflow-y-auto overscroll-contain rounded-[28px]">
        {children}
      </div>
    </div>
  );
}

function StockCardGrid({
  products,
  cart,
  draftQuantities,
  onDraftQuantityChange,
  onAdd,
  onDetails,
  onReplenish,
  onArchive,
}: {
  products: StockProduct[];
  cart: Record<string, number>;
  draftQuantities: Record<string, number>;
  onDraftQuantityChange: (product: StockProduct, quantity: number) => void;
  onAdd: (product: StockProduct) => void;
  onDetails: (product: StockProduct) => void;
  onReplenish: (product: StockProduct) => void;
  onArchive: (product: StockProduct) => void;
}) {
  return (
    <div
      data-testid="stock-card-grid"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
    >
      {products.map((product) => {
        const liveAvailable = liveAvailableForProduct(product, cart);
        const previewQuantity = draftPreviewQuantityForProduct(
          product,
          cart,
          draftQuantities,
        );
        const displayedAvailable = displayedAvailableForProduct(
          product,
          cart,
          draftQuantities,
        );
        const draftQuantity = draftQuantityForProduct(
          product,
          cart,
          draftQuantities,
        );
        const status = productStatus(product, displayedAvailable);

        return (
          <article
            key={product.key}
            data-testid="stock-card"
            className="group flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-border bg-white/76 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[40px] transition duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_18px_60px_rgba(15,23,42,.07)]"
          >
            <ProductVisual product={product} status={status} compact />

            <div className="flex min-h-[202px] flex-1 flex-col gap-3 p-3.5">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
                  {product.clientCode}
                </p>
                <button
                  type="button"
                  onClick={() => onDetails(product)}
                  className="mt-1 line-clamp-2 w-full cursor-pointer text-left text-[13px] font-semibold leading-5 text-foreground transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  aria-label={`Ver detalhes de ${product.name}`}
                >
                  {product.name}
                </button>
                <div className="mt-2 flex min-w-0 items-center gap-2">
                  <span
                    title={product.category}
                    className="min-w-0 truncate rounded-full border border-border bg-white/70 px-2.5 py-1 text-[11px] text-muted-foreground"
                  >
                    {product.category}
                  </span>
                  {cart[product.key] ? (
                    <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
                      {formatNumber(cart[product.key])} selecionado(s)
                    </span>
                  ) : null}
                  {previewQuantity > 0 ? (
                    <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
                      {formatNumber(previewQuantity)} em edicao
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex items-end justify-between gap-3 border-y border-border/70 py-2.5">
                <div>
                  <p className="text-[11px] text-muted-foreground">
                    {previewQuantity > 0 ? "Restara" : "Disponivel"}
                  </p>
                  <p className="mt-1 text-xl font-semibold leading-none text-foreground">
                    {formatNumber(displayedAvailable)}
                  </p>
                  {previewQuantity > 0 ? (
                    <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                      de {formatNumber(liveAvailable)} disp.
                    </p>
                  ) : null}
                </div>
                <p className="text-right text-[11px] leading-4 text-muted-foreground">
                  Saldo para
                  <br />
                  pedido
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <p className="text-muted-foreground">Total fisico</p>
                  <p className="mt-0.5 font-medium text-foreground">
                    {formatNumber(product.total)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground">Reservado</p>
                  <p className="mt-0.5 font-medium text-foreground">
                    {formatNumber(product.reserved)}
                  </p>
                </div>
                <div className="col-span-2">
                  <p
                    className="text-muted-foreground"
                    title="Custo do material que você já adquiriu — não é preço de venda."
                  >
                    Valor em estoque
                  </p>
                  <p className="mt-0.5 font-medium text-foreground">
                    {formatMoney(product.value)}
                  </p>
                </div>
              </div>

              <div className="mt-auto">
                {product.available > 0 ? (
                  <div className="flex items-center gap-2">
                    <QuantityStepper
                      compact
                      label={product.name}
                      value={draftQuantity}
                      max={liveAvailable}
                      onChange={(quantity) =>
                        onDraftQuantityChange(product, quantity)
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="min-w-0 flex-1 cursor-pointer gap-1 px-2 text-[11px]"
                      disabled={liveAvailable <= 0}
                      onClick={() => onAdd(product)}
                    >
                      <ShoppingCart className="h-3.5 w-3.5" />
                      Adicionar
                    </Button>
                  </div>
                ) : (
                  <ZeroStockActions
                    compact
                    onReplenish={() => onReplenish(product)}
                    onArchive={() => onArchive(product)}
                  />
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function CartPanel({
  lines,
  destination,
  dueAt,
  notes,
  isSubmitting,
  onClose,
  onDestinationChange,
  onDueAtChange,
  onNotesChange,
  onIncrement,
  onDecrement,
  onQuantityChange,
  onRemove,
  onSubmit,
}: {
  lines: CartLine[];
  destination: string;
  dueAt: string;
  notes: string;
  isSubmitting: boolean;
  onClose: () => void;
  onDestinationChange: (value: string) => void;
  onDueAtChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onIncrement: (product: StockProduct) => void;
  onDecrement: (product: StockProduct) => void;
  onQuantityChange: (product: StockProduct, quantity: number) => void;
  onRemove: (product: StockProduct) => void;
  onSubmit: () => void;
}) {
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const selectedSkuCount = lines.length;

  return (
    <ModulePanel
      title="Pedido de abastecimento"
      description="Itens selecionados para envio a unidade BTG"
      icon={ShoppingCart}
      className="h-fit xl:sticky xl:top-4"
    >
      <div className="space-y-5">
        <div className="-mt-2 flex justify-end">
          <button
            type="button"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-2xl border border-border bg-white/70 text-muted-foreground transition hover:bg-[#F5F6F7]"
            onClick={onClose}
            aria-label="Fechar pedido de abastecimento"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {lines.length > 0 ? (
          <div className="max-h-[320px] space-y-3 overflow-auto pr-1">
            {lines.map((line) => (
              <div
                key={line.product.key}
                className="rounded-[20px] border border-border bg-white/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {line.product.clientCode}
                    </p>
                    <p className="mt-1 line-clamp-2 font-medium leading-5">
                      {line.product.name}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-border bg-white/70 text-muted-foreground transition hover:bg-[#F5F6F7] hover:text-destructive"
                    onClick={() => onRemove(line.product)}
                    aria-label="Remover item"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <QuantityStepper
                    label={line.product.name}
                    value={line.quantity}
                    max={line.product.available}
                    onChange={(quantity) =>
                      onQuantityChange(line.product, quantity)
                    }
                    onIncrement={() => onIncrement(line.product)}
                    onDecrement={() => onDecrement(line.product)}
                  />
                  <span className="text-xs text-muted-foreground">
                    Disp.{" "}
                    {formatNumber(liveAvailableForLine(line.product, line))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[24px] border border-dashed border-border bg-white/35 p-6 text-center">
            <ShoppingCart className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-3 font-medium">Nenhum item selecionado</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Selecione produtos em cards ou lista para montar o pedido.
            </p>
          </div>
        )}

        <div className="grid gap-3 rounded-[20px] bg-white/45 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Itens no pedido</span>
            <strong>{formatNumber(selectedSkuCount)}</strong>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Pecas selecionadas</span>
            <strong>{formatNumber(totalQuantity)}</strong>
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="cart-destination">Unidade de entrega</Label>
            <Input
              id="cart-destination"
              value={destination}
              onChange={(event) => onDestinationChange(event.target.value)}
              placeholder="Ex.: agencia, predio ou centro de custo"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cart-due-at">Prazo desejado</Label>
            <Input
              id="cart-due-at"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => onDueAtChange(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cart-notes">Observacoes</Label>
            <Textarea
              id="cart-notes"
              value={notes}
              onChange={(event) => onNotesChange(event.target.value)}
              placeholder="Detalhe contato, janela de entrega ou restricoes."
              rows={3}
            />
          </div>
        </div>

        <Button
          type="button"
          className="w-full cursor-pointer"
          disabled={isSubmitting || lines.length === 0}
          onClick={onSubmit}
        >
          {isSubmitting ? (
            <Truck className="h-4 w-4 animate-pulse" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Enviar pedido
        </Button>
      </div>
    </ModulePanel>
  );
}

function ProductDetailPanel({
  product,
  cart,
  draftQuantity,
  previewQuantity,
  isPending,
  onClose,
  onDraftQuantityChange,
  onAdd,
  onReplenish,
  onArchive,
}: {
  product: StockProduct;
  cart: Record<string, number>;
  draftQuantity: number;
  previewQuantity: number;
  isPending: boolean;
  onClose: () => void;
  onDraftQuantityChange: (quantity: number) => void;
  onAdd: () => void;
  onReplenish: () => void;
  onArchive: () => void;
}) {
  const liveAvailable = liveAvailableForProduct(product, cart);
  const displayedAvailable = Math.max(0, liveAvailable - previewQuantity);
  const status = productStatus(product, displayedAvailable);

  return (
    <ModulePanel
      title="Detalhe do produto"
      description="Visao para pedido e reposicao"
      icon={Eye}
      className="h-fit xl:sticky xl:top-4"
    >
      <div className="space-y-5">
        <div className="-mt-2 flex justify-end">
          <button
            type="button"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-2xl border border-border bg-white/70 text-muted-foreground transition hover:bg-[#F5F6F7]"
            onClick={onClose}
            aria-label="Fechar detalhe"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ProductVisual product={product} status={status} large />

        <div>
          <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
            {product.clientCode}
          </p>
          <h2 className="mt-1 text-xl font-semibold leading-7 text-foreground">
            {product.name}
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-border bg-white/70 px-3 py-1 text-xs text-muted-foreground">
              {product.category}
            </span>
            <StockBadge status={status} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StockFact
            label={previewQuantity > 0 ? "Restara" : "Disponivel"}
            value={
              previewQuantity > 0
                ? `${formatNumber(displayedAvailable)} de ${formatNumber(
                    liveAvailable,
                  )}`
                : formatNumber(displayedAvailable)
            }
          />
          <StockFact label="Reservado" value={formatNumber(product.reserved)} />
          <StockFact label="Total fisico" value={formatNumber(product.total)} />
          <StockFact
            label="Valor em estoque (custo)"
            value={formatMoney(product.value)}
          />
          <StockFact
            label="No pedido"
            value={formatNumber(cart[product.key] ?? 0)}
          />
          {previewQuantity > 0 ? (
            <StockFact
              label="Selecionando agora"
              value={formatNumber(previewQuantity)}
            />
          ) : null}
        </div>

        <div className="rounded-[22px] border border-primary/15 bg-primary/10 p-4 text-sm leading-6 text-primary">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{agentDuteSignal(product, displayedAvailable)}</p>
          </div>
        </div>

        {product.available > 0 ? (
          <div className="space-y-3">
            <QuantityStepper
              label={product.name}
              value={draftQuantity}
              max={liveAvailable}
              onChange={onDraftQuantityChange}
            />
            <Button
              type="button"
              className="w-full cursor-pointer"
              disabled={liveAvailable <= 0}
              onClick={onAdd}
            >
              <ShoppingCart className="h-4 w-4" />
              Adicionar ao pedido
            </Button>
          </div>
        ) : (
          <ZeroStockActions
            disabled={isPending}
            onReplenish={onReplenish}
            onArchive={onArchive}
          />
        )}
      </div>
    </ModulePanel>
  );
}

function ProductVisual({
  product,
  status,
  large = false,
  compact = false,
}: {
  product: StockProduct;
  status: ReturnType<typeof productStatus>;
  large?: boolean;
  compact?: boolean;
}) {
  const initials = product.category.slice(0, 2).toUpperCase();

  // Foto real tirada pelo operador na entrada; sem foto, mantém o
  // placeholder atual.
  if (product.photoUrl) {
    return (
      <div
        className={cn(
          "relative overflow-hidden border-b border-border bg-[#F7F7F5]",
          large ? "rounded-[24px] border border-border" : "",
        )}
      >
        <img
          src={product.photoUrl}
          alt={product.name}
          loading="lazy"
          className={cn(
            "w-full object-cover",
            large
              ? "min-h-[260px] max-h-[320px]"
              : compact
                ? "h-[104px]"
                : "h-[170px]",
          )}
        />
        <div
          className={cn("absolute", compact ? "left-3 top-3" : "left-4 top-4")}
        >
          <StockBadge status={status} compact={compact} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden border-b border-border bg-[#F7F7F5]",
        large ? "rounded-[24px] border border-border" : "",
      )}
    >
      <div
        className={cn(
          "absolute inset-0 opacity-80",
          "bg-[radial-gradient(circle_at_top_left,#EDF5F2_0%,transparent_36%),radial-gradient(circle_at_bottom_left,#F5F2E9_0%,transparent_42%),radial-gradient(circle_at_top_right,#EEF4F8_0%,transparent_34%)]",
        )}
      />
      <div
        className={cn(
          "relative flex flex-col items-center justify-center gap-3 p-6 text-center",
          large
            ? "min-h-[260px]"
            : compact
              ? "min-h-[104px] p-4"
              : "min-h-[170px]",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-center border border-white/70 bg-white/76 text-primary shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]",
            compact ? "h-12 w-12 rounded-[18px]" : "h-20 w-20 rounded-[28px]",
          )}
        >
          <Package
            className={compact ? "h-5 w-5" : "h-8 w-8"}
            aria-hidden="true"
          />
        </div>
        {!compact ? (
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
              {initials || "BT"}
            </p>
            <p className="max-w-[220px] text-sm font-medium leading-5 text-foreground">
              {product.category}
            </p>
          </div>
        ) : null}
      </div>
      <div
        className={cn("absolute", compact ? "left-3 top-3" : "left-4 top-4")}
      >
        <StockBadge status={status} compact={compact} />
      </div>
    </div>
  );
}

function QuantityStepper({
  value,
  max,
  onChange,
  onIncrement,
  onDecrement,
  compact = false,
  label = "produto",
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
  onIncrement?: () => void;
  onDecrement?: () => void;
  compact?: boolean;
  label?: string;
}) {
  const normalizedMax = Math.max(0, Math.floor(max || 0));
  const normalizedValue =
    normalizedMax <= 0 ? 0 : clampQuantity(value, normalizedMax);

  return (
    <div
      className={cn(
        "flex items-center border border-border bg-white/70 shadow-[0_8px_24px_rgba(15,23,42,.04)]",
        compact ? "rounded-[14px] p-0.5" : "rounded-[18px] p-1",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex cursor-pointer items-center justify-center text-muted-foreground transition hover:bg-[#F5F6F7] disabled:cursor-not-allowed disabled:opacity-40",
          compact ? "h-8 w-8 rounded-[10px]" : "h-9 w-9 rounded-[14px]",
        )}
        disabled={normalizedValue <= 0}
        onClick={() =>
          onDecrement ? onDecrement() : onChange(normalizedValue - 1)
        }
        aria-label={`Diminuir quantidade de ${label}`}
      >
        <Minus
          className={compact ? "h-3.5 w-3.5" : "h-4 w-4"}
          aria-hidden="true"
        />
      </button>
      <Input
        type="number"
        min={normalizedMax <= 0 ? 0 : 1}
        max={normalizedMax}
        value={normalizedValue}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={`Quantidade de ${label}`}
        className={cn(
          "border-0 bg-transparent px-1 text-center shadow-none focus-visible:ring-0",
          compact ? "h-8 w-9 text-xs" : "h-9 w-16",
        )}
      />
      <button
        type="button"
        className={cn(
          "flex cursor-pointer items-center justify-center text-muted-foreground transition hover:bg-[#F5F6F7] disabled:cursor-not-allowed disabled:opacity-40",
          compact ? "h-8 w-8 rounded-[10px]" : "h-9 w-9 rounded-[14px]",
        )}
        disabled={normalizedValue >= normalizedMax}
        onClick={() =>
          onIncrement ? onIncrement() : onChange(normalizedValue + 1)
        }
        aria-label={`Aumentar quantidade de ${label}`}
      >
        <Plus
          className={compact ? "h-3.5 w-3.5" : "h-4 w-4"}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

function ZeroStockActions({
  compact = false,
  disabled = false,
  onReplenish,
  onArchive,
}: {
  compact?: boolean;
  disabled?: boolean;
  onReplenish: () => void;
  onArchive: () => void;
}) {
  return (
    <div
      className={cn(
        "grid gap-2",
        compact ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2",
      )}
    >
      <Button
        type="button"
        variant="outline"
        size={compact ? "sm" : "default"}
        className="cursor-pointer"
        disabled={disabled}
        onClick={onReplenish}
      >
        <Truck className="h-4 w-4" />
        Repor
      </Button>
      <Button
        type="button"
        variant="ghost"
        size={compact ? "sm" : "default"}
        className="cursor-pointer text-muted-foreground"
        disabled={disabled}
        onClick={onArchive}
      >
        <Archive className="h-4 w-4" />
        Arquivar
      </Button>
    </div>
  );
}

function ViewModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-10 cursor-pointer items-center gap-2 rounded-[14px] px-3 text-sm transition",
        active
          ? "bg-white text-primary shadow-[0_8px_24px_rgba(15,23,42,.04)]"
          : "text-muted-foreground hover:bg-white/70",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

function FilterChip({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active
          ? "border-primary/25 bg-primary/10 text-primary"
          : "border-border bg-white/60 text-muted-foreground hover:bg-white",
      )}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
      {label}
    </button>
  );
}

function StockFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[18px] border border-border bg-white/55 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold leading-5 text-foreground">
        {value}
      </p>
    </div>
  );
}

function StockBadge({
  status,
  compact = false,
}: {
  status: ReturnType<typeof productStatus>;
  compact?: boolean;
}) {
  if (status === "zero") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 font-medium text-rose-700",
          compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1 text-xs",
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Sem estoque
      </span>
    );
  }

  if (status === "low") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 font-medium text-amber-700",
          compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1 text-xs",
        )}
      >
        <Sparkles className="h-3.5 w-3.5" />
        Baixo estoque
      </span>
    );
  }

  if (status === "cart") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 font-medium text-primary",
          compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1 text-xs",
        )}
      >
        <ShoppingCart className="h-3.5 w-3.5" />
        Selecionado
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 font-medium text-emerald-700",
        compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1 text-xs",
      )}
    >
      <CheckCircle2 className="h-3.5 w-3.5" />
      Disponivel
    </span>
  );
}

function groupInventoryProducts(items: InventoryItem[]) {
  const grouped = new Map<string, StockProduct>();

  for (const item of items) {
    if (inventoryItemSku(item) === "SKU") continue;
    const sku = inventoryItemSku(item);
    const name = inventoryItemName(item);
    const category = firstText(item.category, item.categoria, "Sem categoria")!;
    const clientCode = inventoryItemClientCode(item);
    const clientItemCode = firstText(item.client_item_code, item.cod_cliente) ?? null;
    const key = [sku, clientItemCode ?? "", name, category].join("::");
    const current = grouped.get(key) ?? {
      key,
      sku,
      clientCode,
      clientItemCode,
      name,
      category,
      available: 0,
      reserved: 0,
      total: 0,
      value: 0,
      photoUrl: null,
      sources: [],
    };

    current.available += inventoryItemAvailable(item);
    current.reserved += inventoryItemReserved(item);
    current.total += inventoryItemTotal(item);
    current.value += inventoryItemValue(item);
    current.photoUrl = current.photoUrl ?? inventoryItemPhoto(item);
    current.sources.push(item);
    grouped.set(key, current);
  }

  return [...grouped.values()].sort((left, right) => {
    if (right.available !== left.available)
      return right.available - left.available;
    if (right.value !== left.value) return right.value - left.value;
    return left.name.localeCompare(right.name, "pt-BR");
  });
}

function filterProducts({
  products,
  cart,
  searchTerm,
  categoryFilter,
  stockFilter,
  archivedProductKeys,
}: {
  products: StockProduct[];
  cart: Record<string, number>;
  searchTerm: string;
  categoryFilter: string;
  stockFilter: StockFilter;
  archivedProductKeys: Set<string>;
}) {
  const query = normalizeSlug(searchTerm);

  return products.filter((product) => {
    const isArchived = archivedProductKeys.has(product.key);
    if (stockFilter === "arquivados") {
      if (!isArchived) return false;
    } else if (isArchived) {
      return false;
    }

    if (
      categoryFilter !== "todos" &&
      normalizeSlug(product.category) !== categoryFilter
    ) {
      return false;
    }

    const liveAvailable = liveAvailableForProduct(product, cart);
    if (stockFilter === "disponiveis" && liveAvailable <= 0) return false;
    if (stockFilter === "baixo" && !isLowStock(product, liveAvailable)) {
      return false;
    }
    if (stockFilter === "zerado" && product.available > 0) return false;

    if (!query) return true;
    return normalizeSlug(
      [
        product.clientCode,
        product.clientItemCode,
        product.name,
        product.category,
      ]
        .filter(Boolean)
        .join(" "),
    ).includes(query);
  });
}

function sortProducts(
  products: StockProduct[],
  cart: Record<string, number>,
  sortMode: StockSort,
) {
  return [...products].sort((left, right) => {
    if (sortMode === "maior-saldo") {
      return (
        liveAvailableForProduct(right, cart) -
          liveAvailableForProduct(left, cart) ||
        left.name.localeCompare(right.name, "pt-BR")
      );
    }

    if (sortMode === "menor-saldo") {
      return (
        liveAvailableForProduct(left, cart) -
          liveAvailableForProduct(right, cart) ||
        left.name.localeCompare(right.name, "pt-BR")
      );
    }

    if (sortMode === "nome") {
      return left.name.localeCompare(right.name, "pt-BR");
    }

    return (
      liveAvailableForProduct(right, cart) -
        liveAvailableForProduct(left, cart) ||
      left.name.localeCompare(right.name, "pt-BR")
    );
  });
}

function getCategoryOptions(products: StockProduct[]) {
  const counts = new Map<
    string,
    { value: string; label: string; count: number }
  >();

  for (const product of products) {
    const value = normalizeSlug(product.category) || "sem-categoria";
    const current = counts.get(value) ?? {
      value,
      label: product.category || "Sem categoria",
      count: 0,
    };
    current.count += 1;
    counts.set(value, current);
  }

  return [
    { value: "todos", label: "Todas categorias", count: products.length },
    ...[...counts.values()].sort((left, right) => right.count - left.count),
  ];
}

function getCartLines(
  cart: Record<string, number>,
  productByKey: Map<string, StockProduct>,
) {
  return Object.entries(cart).flatMap<CartLine>(([key, quantity]) => {
    const product = productByKey.get(key);
    if (!product || quantity <= 0) return [];
    return [{ product, quantity: Math.min(quantity, product.available) }];
  });
}

function buildCartRequestItems(lines: CartLine[]) {
  return lines.flatMap<CreateClientRequestItem>((line) =>
    allocateCartLine(line.product, line.quantity),
  );
}

function allocateCartLine(product: StockProduct, quantity: number) {
  const allocations: CreateClientRequestItem[] = [];
  let remaining = quantity;

  const sources = [...product.sources].sort(
    (left, right) =>
      inventoryItemAvailable(right) - inventoryItemAvailable(left),
  );

  for (const source of sources) {
    if (remaining <= 0) break;
    const sourceAvailable = inventoryItemAvailable(source);
    if (sourceAvailable <= 0) continue;
    const allocatedQuantity = Math.min(remaining, sourceAvailable);
    allocations.push({
      sku_code: product.sku,
      client_item_code:
        firstText(source.client_item_code, product.clientItemCode) ?? null,
      product_name: product.name,
      location_id: source.location_id ?? null,
      quantity: allocatedQuantity,
      notes: null,
    });
    remaining -= allocatedQuantity;
  }

  return allocations;
}

function buildReplenishmentRequest(
  product: StockProduct,
): CreateClientRequestPayload {
  return {
    type: "recebimento",
    priority: "normal",
    title: `Reposicao solicitada: ${product.name}`,
    description: [
      `Cliente solicitou reposicao com fornecedor para o cod. cliente ${product.clientCode}.`,
      "Produto aparece sem saldo disponivel na vitrine do portal.",
      "A Dutelog deve acompanhar a previsao de chegada e conferencia.",
    ].join(" "),
    destination: "Recebimento Dutelog",
    items: [
      {
        sku_code: product.sku,
        client_item_code: product.clientItemCode ?? null,
        product_name: product.name,
        location_id: null,
        quantity: 1,
        notes: "Reposicao solicitada pelo portal do cliente.",
      },
    ],
  };
}

function buildArchiveRequest(
  product: StockProduct,
): CreateClientRequestPayload {
  return {
    type: "suporte",
    priority: "normal",
    title: `Arquivar produto sem estoque: ${product.name}`,
    description: [
      `Cliente solicitou arquivamento do cod. cliente ${product.clientCode}.`,
      "A acao deve apenas ocultar/descontinuar o produto para novos pedidos.",
      "Nao deletar cadastro, historico, contrato, movimentacoes ou documentos.",
    ].join(" "),
    items: [],
  };
}

function liveAvailableForProduct(
  product: StockProduct,
  cart: Record<string, number>,
) {
  return Math.max(0, product.available - (cart[product.key] ?? 0));
}

function draftPreviewQuantityForProduct(
  product: StockProduct,
  cart: Record<string, number>,
  draftQuantities: Record<string, number>,
) {
  if (!(product.key in draftQuantities)) return 0;
  return draftQuantityForProduct(product, cart, draftQuantities);
}

function displayedAvailableForProduct(
  product: StockProduct,
  cart: Record<string, number>,
  draftQuantities: Record<string, number>,
) {
  return Math.max(
    0,
    liveAvailableForProduct(product, cart) -
      draftPreviewQuantityForProduct(product, cart, draftQuantities),
  );
}

function liveAvailableForLine(product: StockProduct, line: CartLine) {
  return Math.max(0, product.available - line.quantity);
}

function draftQuantityForProduct(
  product: StockProduct,
  cart: Record<string, number>,
  draftQuantities: Record<string, number>,
) {
  const max = liveAvailableForProduct(product, cart);
  if (max <= 0) return 0;
  return clampQuantity(draftQuantities[product.key] ?? 1, max);
}

function productStatus(product: StockProduct, liveAvailable: number) {
  if (product.available <= 0) return "zero" as const;
  if (liveAvailable <= 0) return "cart" as const;
  if (isLowStock(product, liveAvailable)) return "low" as const;
  return "ok" as const;
}

function isLowStock(product: StockProduct, liveAvailable: number) {
  if (product.available <= 0 || liveAvailable <= 0) return false;
  const dynamicLimit = Math.ceil(
    Math.max(product.total, product.available) * 0.08,
  );
  const limit = Math.max(5, Math.min(20, dynamicLimit || 10));
  return liveAvailable <= limit;
}

function agentDuteSignal(product: StockProduct, liveAvailable: number) {
  if (product.available <= 0) {
    return "Produto sem saldo disponivel. O Agent Dute recomenda registrar reposicao com fornecedor ou solicitar arquivamento operacional, sem deletar historico.";
  }

  if (liveAvailable <= 0) {
    return "Todo o saldo disponivel ja foi selecionado. Ao enviar, a Dutelog recebe o pedido para separacao, conferencia e entrega.";
  }

  if (isLowStock(product, liveAvailable)) {
    return "Baixo estoque identificado pelo Agent Dute. Vale acompanhar reposicao antes de montar novos pedidos grandes.";
  }

  return "Saldo disponivel para abastecimento. Ao selecionar o item, o portal desconta a quantidade exibida ate o envio da solicitacao.";
}

function clampQuantity(quantity: number, max: number) {
  if (max <= 0) return 0;
  const parsed = Math.floor(Number.isFinite(quantity) ? quantity : 1);
  return Math.min(max, Math.max(1, parsed));
}

function invalidateClientData(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: clientOverviewQueryKey }),
    queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] }),
    queryClient.invalidateQueries({ queryKey: ["ai-overview"] }),
  ]);
}
