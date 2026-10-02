import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
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
import { cartFromDraft, dueAtFromDraft, takeDraft } from "@/lib/agent-draft";
import { overviewLine, productTitle, productType, stockOverview, typeOptions, typeValue } from "@/lib/portal-stock";
import { cn } from "@/lib/utils";
import { groupFamilies, variantLabel, type Family } from "@/lib/stock-variants";

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
  normalizeSlug,
  type CreateClientRequestItem,
  type CreateClientRequestPayload,
  type InventoryItem,
} from "./shared";

type StockViewMode = "lista" | "cards";
type StockFilter = "todos" | "disponiveis" | "baixo" | "zerado" | "arquivados";
type StockSort = "relevancia" | "maior-saldo" | "menor-saldo" | "nome";
type ProductAction = "restock" | "archive" | "restore";

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
  /** Mínimo da ficha publicado no portal; sem ele, nunca é "baixo". */
  minimum?: number;
  /** Arquivado pela BTG e ainda sem saldo. */
  archived: boolean;
  sources: InventoryItem[];
};

type CartLine = {
  product: StockProduct;
  quantity: number;
};

type ProductActionCommand = {
  action: ProductAction;
  product: StockProduct;
};

const stockFilterOptions: Array<{
  value: StockFilter;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "todos", label: "Todos", icon: Package },
  { value: "disponiveis", label: "Com saldo", icon: PackageCheck },
  { value: "baixo", label: "Abaixo do mínimo", icon: AlertTriangle },
  { value: "zerado", label: "Sem saldo", icon: Archive },
  { value: "arquivados", label: "Arquivados", icon: Archive },
];

const STOCK_PAGE_SIZE = 48;
const GROUP_STORAGE_KEY = "dute.portal.agrupar-tamanhos";

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
  // Agrupar tamanhos é preferência de quem usa: fica salva neste navegador.
  const [groupVariants, setGroupVariantsState] = useState(() => {
    try {
      return window.localStorage.getItem(GROUP_STORAGE_KEY) !== "nao";
    } catch {
      return true;
    }
  });
  const setGroupVariants = (value: boolean) => {
    setGroupVariantsState(value);
    try {
      window.localStorage.setItem(GROUP_STORAGE_KEY, value ? "sim" : "nao");
    } catch {
      // Sem storage (aba privada): vale só nesta visita.
    }
  };
  const [orderName, setOrderName] = useState("");
  const [cartExpanded, setCartExpanded] = useState(false);
  const [destination, setDestination] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const wantsDraft = new URLSearchParams(useSearch()).get("rascunho") === "1";

  /** Rascunho do Agent Dute: preenche o pedido; quem envia é a pessoa. */
  function applyDraft(products: StockProduct[]) {
    navigate("/portal/estoque", { replace: true });
    const draft = takeDraft("pedido");
    if (!draft) return;
    const { cart: draftCart, missing } = cartFromDraft(products, draft);
    setCart(draftCart);
    setDestination(draft.destino ?? "");
    setDueAt(dueAtFromDraft(draft.prazo));
    setOrderName(draft.nome ?? "");
    setNotes(draft.observacoes ?? "");
    setCartOpen(true);
    toast({
      title: "Rascunho do Agent Dute no pedido",
      description: missing.length
        ? `Confira e envie. Sem saldo agora: ${missing.join(", ")}.`
        : "Confira os itens, o destino e a data, e envie quando estiver certo.",
    });
  }

  const requestMutation = useMutation({
    mutationFn: createClientRequest,
    onSuccess: () => {
      toast({
        title: "Pedido enviado para a Dutelog",
        description:
          "Acompanhe a separação e a entrega em Pedidos.",
      });
      setCart({});
      setCartOpen(false);
      setOrderName("");
      setDestination("");
      setDueAt("");
      setNotes("");
      void invalidateClientData(queryClient);
      navigate("/portal/pedidos");
    },
    onError: (error) => {
      toast({
        title: "Não foi possível enviar o pedido",
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
      if (command.action === "restock") {
        await createClientRequest(buildReplenishmentRequest(command.product));
        return command;
      }
      // Arquivar é do servidor (setClientItemArchived): valida saldo zero e
      // o cliente, grava quem arquivou e registra o evento.
      for (const id of archiveIds(command.product)) {
        await setItemArchived(id, command.action === "archive");
      }
      return command;
    },
    onSuccess: ({ action }) => {
      if (action !== "restock") setSelectedProductKey(null);

      toast({
        title:
          action === "restock"
            ? "Reposição avisada para a Dutelog"
            : action === "archive"
              ? "Produto arquivado"
              : "Produto de volta à vitrine",
        description:
          action === "restock"
            ? "A Dutelog recebeu o aviso e vai acompanhar com o fornecedor."
            : action === "archive"
              ? "Some da vitrine e fica em Arquivados. Se o saldo voltar, ele reaparece."
              : "O produto aparece de novo na vitrine.",
      });

      void invalidateClientData(queryClient);
    },
    onError: (error) => {
      toast({
        title: "Não foi possível registrar a ação",
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
        const draftLoader = wantsDraft ? <DraftLoader products={products} onLoad={applyDraft} /> : null;
        const cartQuantity = cartLines.reduce(
          (sum, line) => sum + line.quantity,
          0,
        );
        const selectedProduct = selectedProductKey
          ? (productByKey.get(selectedProductKey) ?? null)
          : null;
        const categories = typeOptions(products);
        const summary = stockOverview(products);
        const filterCounts: Record<StockFilter, number> = {
          todos: summary.items,
          disponiveis: summary.withStock,
          baixo: summary.low,
          zerado: summary.zero,
          arquivados: summary.archived,
        };
        const filteredProducts = filterProducts({
          products,
          cart,
          searchTerm,
          categoryFilter,
          stockFilter,
        });
        const sortedProducts = sortProducts(filteredProducts, cart, sortMode);
        const visibleProducts = sortedProducts.slice(0, visibleProductLimit);
        const families = groupFamilies(
          sortedProducts,
          (product) => product.clientItemCode ?? product.clientCode,
          (product) => product.key,
          groupVariants,
        );
        const visibleFamilies = families.slice(0, visibleProductLimit);
        const hasMoreProducts =
          viewMode === "cards"
            ? visibleFamilies.length < families.length
            : visibleProducts.length < sortedProducts.length;
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
              title: "Informe a quantidade",
              description: "Use +/− ou digite quantas peças deseja pedir.",
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
          // Volta para 1: o próximo "Adicionar" já sai com uma peça.
          setDraftQuantities((current) => {
            const { [product.key]: _added, ...rest } = current;
            return rest;
          });
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
          productActionMutation.mutate({ action: "restock", product });
        }

        function requestArchive(product: StockProduct) {
          productActionMutation.mutate({
            action: product.archived ? "restore" : "archive",
            product,
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
              title: "Informe onde entregar",
              description:
                "A Dutelog precisa saber para qual agência ou prédio o pedido vai.",
              variant: "destructive",
            });
            return;
          }

          const requestItems = buildCartRequestItems(cartLines);
          if (requestItems.length === 0) {
            toast({
              title: "Estoque indisponível",
              description: "Revise os itens selecionados e tente novamente.",
              variant: "destructive",
            });
            return;
          }

          requestMutation.mutate({
            type: "retirada",
            priority: "normal",
            // Sem nome, o Início mostra "Pedido de dd/mm".
            title: orderName.trim() || undefined,
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
            description={products.length ? overviewLine(summary) : undefined}
            icon={Box}
            className="max-w-[1720px]"
          >
            {draftLoader}
            {products.length > 0 ? (
              <MarketplaceToolbar
                searchTerm={searchTerm}
                stockFilter={stockFilter}
                categoryFilter={categoryFilter}
                categories={categories}
                sortMode={sortMode}
                viewMode={viewMode}
                groupVariants={groupVariants}
                onGroupVariantsChange={setGroupVariants}
                cartQuantity={cartQuantity}
                cartOpen={cartOpen}
                filterCounts={filterCounts}
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
                        onDetails={(product) => {
                          setSelectedProductKey(product.key);
                          setCartOpen(false);
                        }}
                        onReplenish={requestReplenishment}
                        onArchive={requestArchive}
                      />
                    ) : (
                      <FamilyGrid
                        families={visibleFamilies}
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
                    displayedCount={
                      viewMode === "cards" ? visibleFamilies.length : visibleProducts.length
                    }
                    totalCount={viewMode === "cards" ? families.length : sortedProducts.length}
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
              <SideDrawer onClose={() => setCartOpen(false)} wide={cartExpanded}>
                <CartPanel
                  expanded={cartExpanded}
                  onToggleExpanded={() => setCartExpanded((current) => !current)}
                  lines={cartLines}
                  orderName={orderName}
                  onOrderNameChange={setOrderName}
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

            {/* Celular: o pedido sempre à vista, sem subir até a barra. */}
            {cartQuantity > 0 && !cartOpen ? (
              <button
                type="button"
                onClick={() => {
                  setCartOpen(true);
                  setSelectedProductKey(null);
                }}
                className="fixed inset-x-4 bottom-4 z-40 flex items-center justify-between rounded-2xl bg-foreground px-4 py-3 text-sm font-semibold text-background shadow-lg md:hidden"
              >
                <span>
                  Pedido · {formatNumber(cartLines.length)} {cartLines.length === 1 ? "item" : "itens"} · {formatNumber(cartQuantity)}{" "}
                  {cartQuantity === 1 ? "peça" : "peças"}
                </span>
                <span>Ver ›</span>
              </button>
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
  groupVariants,
  onGroupVariantsChange,
  cartQuantity,
  cartOpen,
  filterCounts,
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
  groupVariants: boolean;
  onGroupVariantsChange: (value: boolean) => void;
  cartQuantity: number;
  cartOpen: boolean;
  filterCounts: Record<StockFilter, number>;
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
      className="sticky top-0 z-20 shrink-0 rounded-[20px] border border-border bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,.06)] sm:p-4"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar por nome, código ou tipo"
            aria-label="Buscar por nome, código ou tipo"
            className="h-11 rounded-[18px] border-border bg-white/80 pl-11 text-sm"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div
            role="group"
            aria-label="Formato de visualização"
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
          {viewMode === "cards" ? (
            <button
              type="button"
              role="switch"
              aria-checked={groupVariants}
              onClick={() => onGroupVariantsChange(!groupVariants)}
              title="Junta as variações (P, M, G…) do mesmo produto num card só"
              className="flex h-11 cursor-pointer items-center gap-2 rounded-[14px] border border-border bg-white px-3 text-sm"
            >
              <span
                className={cn(
                  "relative h-5 w-9 rounded-full transition-colors",
                  groupVariants ? "bg-primary" : "bg-muted-foreground/30",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]",
                    groupVariants ? "left-[18px]" : "left-0.5",
                  )}
                />
              </span>
              <span className="hidden sm:inline">Agrupar tamanhos</span>
              <span className="sm:hidden">Tamanhos</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCartToggle}
            aria-expanded={cartOpen}
            aria-label={`Abrir pedido de abastecimento com ${formatNumber(cartQuantity)} item(ns)`}
            className={cn(
              "relative hidden h-11 cursor-pointer items-center gap-2 rounded-[18px] border px-3.5 text-sm font-medium transition hover:bg-[#F5F6F7] active:translate-y-px md:flex",
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
              label={option.value === "arquivados" && !filterCounts.arquivados ? option.label : `${option.label} · ${formatNumber(filterCounts[option.value])}`}
              onClick={() => onStockFilterChange(option.value)}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Tipo (POLO, SACOLA…) sempre como seletor: em chips disputava a linha com a situação. */}
          {categories.length > 2 ? (
            <CatalogSelect
              ariaLabel="Filtrar por tipo"
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
          Catálogo completo
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
    <div className="overflow-hidden rounded-[28px] border border-border bg-white/70 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]">
      <Table className="min-w-[860px]">
        <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur-[24px]">
          <TableRow>
            <TableHead className="w-[170px]">Código</TableHead>
            <TableHead className="min-w-[300px]">Produto</TableHead>
            <TableHead className="text-right">Disponível</TableHead>
            <TableHead className="text-right">Reservado</TableHead>
            <TableHead className="w-[270px] text-right">Pedido</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => {
            const liveAvailable = liveAvailableForProduct(product, cart);
            const draftQuantity = draftQuantityForProduct(
              product,
              cart,
              draftQuantities,
            );
            const status = productStatus(product, liveAvailable);

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
                    title={productTitle(product)}
                  >
                    {productTitle(product)}
                  </button>
                  <span className="ml-2 text-xs text-muted-foreground">{productType(product)}</span>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <StockBadge status={status} />
                    {cart[product.key] ? (
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                        {formatNumber(cart[product.key])} no pedido
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <p className="font-semibold text-foreground">
                    {formatNumber(liveAvailable)}
                  </p>

                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {formatNumber(product.reserved)}
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
                          disabled={liveAvailable <= 0 || draftQuantity <= 0}
                          className="cursor-pointer"
                          onClick={() => onAdd(product)}
                        >
                          <ShoppingCart className="h-4 w-4" />
                          Adicionar
                        </Button>
                      </>
                    ) : (
                      <ZeroStockActions
                        compact
                        archived={product.archived}
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
  wide = false,
}: {
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  // Esc fecha, como o clique fora; o pedido continua guardado.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  // Fundo escuro sem desfoque e painel opaco: atrás há uma vitrine de
  // fotos, e o painel translúcido ficava ilegível.
  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-900/35 p-3 sm:p-5">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label="Fechar painel"
      />
      <div
        className={cn(
          "relative z-[1] h-full w-full overflow-hidden rounded-[20px]",
          wide ? "max-w-[1200px]" : "max-w-[440px]",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function FamilyGrid({
  families,
  cart,
  draftQuantities,
  onDraftQuantityChange,
  onAdd,
  onDetails,
  onReplenish,
  onArchive,
}: {
  families: Family<StockProduct>[];
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
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5"
    >
      {families.map((family) => (
        <FamilyCard
          key={family.key}
          family={family}
          cart={cart}
          draftQuantities={draftQuantities}
          onDraftQuantityChange={onDraftQuantityChange}
          onAdd={onAdd}
          onDetails={onDetails}
          onReplenish={onReplenish}
          onArchive={onArchive}
        />
      ))}
    </div>
  );
}

/**
 * Um card por produto. Com tamanhos agrupados, a pessoa escolhe a variação
 * nos botões (cada um com o disponível) e adiciona daquele tamanho.
 */
function FamilyCard({
  family,
  cart,
  draftQuantities,
  onDraftQuantityChange,
  onAdd,
  onDetails,
  onReplenish,
  onArchive,
}: {
  family: Family<StockProduct>;
  cart: Record<string, number>;
  draftQuantities: Record<string, number>;
  onDraftQuantityChange: (product: StockProduct, quantity: number) => void;
  onAdd: (product: StockProduct) => void;
  onDetails: (product: StockProduct) => void;
  onReplenish: (product: StockProduct) => void;
  onArchive: (product: StockProduct) => void;
}) {
  const firstAvailable =
    family.variants.find((entry) => liveAvailableForProduct(entry.item, cart) > 0) ?? family.variants[0];
  const [selectedKey, setSelectedKey] = useState(firstAvailable.item.key);
  const selected =
    family.variants.find((entry) => entry.item.key === selectedKey) ?? firstAvailable;
  const product = selected.item;
  const liveAvailable = liveAvailableForProduct(product, cart);
  const draftQuantity = draftQuantityForProduct(product, cart, draftQuantities);
  const inCart = family.variants.reduce((sum, entry) => sum + (cart[entry.item.key] ?? 0), 0);
  const familyAvailable = family.variants.reduce((sum, entry) => sum + entry.item.available, 0);
  const photo = family.variants.find((entry) => entry.item.photoUrl)?.item ?? product;
  const status = productStatus(
    { ...product, available: familyAvailable },
    family.variants.reduce((sum, entry) => sum + liveAvailableForProduct(entry.item, cart), 0),
  );
  const title = productTitle(product);
  // Tamanho único ("U") não precisa de botão: o disponível já diz tudo.
  const showVariants = family.variants.length > 1;
  const hasPhoto = Boolean(photo.photoUrl);

  return (
    <article
      data-testid="stock-card"
      className="flex min-w-0 flex-col overflow-hidden rounded-[18px] border border-border bg-white shadow-[0_8px_24px_rgba(15,23,42,.04)] transition duration-200 hover:border-primary/30 hover:shadow-[0_18px_60px_rgba(15,23,42,.07)]"
    >
      {/* Sem foto, o card começa no nome: o quadro vazio ocupava meio card. */}
      {hasPhoto ? (
        <button
          type="button"
          onClick={() => onDetails(product)}
          className="cursor-pointer text-left"
          aria-label={`Ver detalhes de ${title}`}
        >
          <ProductVisual product={photo} status={status} inCart={inCart} />
        </button>
      ) : null}

      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        {!hasPhoto && (inCart > 0 || status === "zero" || status === "low") ? (
          <div>
            <StockBadge status={status} compact inCart={inCart} />
          </div>
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
            {product.name} · {family.base || product.clientCode}
          </p>
          <button
            type="button"
            onClick={() => onDetails(product)}
            className="mt-0.5 line-clamp-2 w-full cursor-pointer text-left text-sm font-semibold leading-5 hover:text-primary"
          >
            {title}
          </button>
        </div>

        {showVariants ? (
          <div role="group" aria-label="Tamanho" className="flex flex-wrap gap-1.5">
            {family.variants.map((entry) => {
              const available = liveAvailableForProduct(entry.item, cart);
              const active = entry.item.key === product.key;
              return (
                <button
                  key={entry.item.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedKey(entry.item.key)}
                  className={cn(
                    "flex min-w-[44px] cursor-pointer flex-col items-center rounded-[10px] border px-2 py-1 leading-tight transition",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-foreground hover:border-primary/40",
                    entry.item.available <= 0 && !active && "text-muted-foreground/60",
                  )}
                >
                  <span className={cn("text-xs font-semibold", entry.item.available <= 0 && "line-through")}>
                    {variantLabel(entry.variant ?? entry.item.clientCode)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {entry.item.available <= 0 ? "esgotado" : `${formatNumber(available)} disp.`}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {product.available > 0 ? (
            <>
              <span className="text-base font-semibold text-foreground">{formatNumber(liveAvailable)}</span>{" "}
              {showVariants ? "disponíveis neste tamanho" : "disponíveis"}
            </>
          ) : (
            "Sem saldo no momento"
          )}
        </p>

        <div className="mt-auto pt-1">
          {product.available > 0 ? (
            <div className="flex items-center gap-2">
              <QuantityStepper
                compact
                label={title}
                value={draftQuantity}
                max={liveAvailable}
                onChange={(quantity) => onDraftQuantityChange(product, quantity)}
              />
              <Button
                type="button"
                size="sm"
                className="min-w-0 flex-1 cursor-pointer gap-1.5"
                disabled={liveAvailable <= 0 || draftQuantity <= 0}
                onClick={() => onAdd(product)}
              >
                <ShoppingCart className="h-3.5 w-3.5" />
                Adicionar
              </Button>
            </div>
          ) : (
            <ZeroStockActions
              compact
              archived={product.archived}
              onReplenish={() => onReplenish(product)}
              onArchive={() => onArchive(product)}
            />
          )}
        </div>
      </div>
    </article>
  );
}

const CART_SEARCH_FROM = 8;

/**
 * Pedido em montagem. Linhas compactas e busca para pedidos grandes (já
 * houve pedido com mais de 1.000 itens); "Tela cheia" abre a revisão em
 * duas colunas, itens à esquerda e dados do pedido à direita.
 */
function CartPanel({
  lines,
  orderName,
  destination,
  dueAt,
  notes,
  isSubmitting,
  expanded,
  onToggleExpanded,
  onClose,
  onOrderNameChange,
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
  orderName: string;
  destination: string;
  dueAt: string;
  notes: string;
  isSubmitting: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
  onOrderNameChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onDueAtChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onIncrement: (product: StockProduct) => void;
  onDecrement: (product: StockProduct) => void;
  onQuantityChange: (product: StockProduct, quantity: number) => void;
  onRemove: (product: StockProduct) => void;
  onSubmit: () => void;
}) {
  const [query, setQuery] = useState("");
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const needle = normalizeSlug(query);
  const shownLines = needle
    ? lines.filter((line) =>
        normalizeSlug(
          [line.product.name, line.product.category, line.product.clientCode, line.product.clientItemCode]
            .filter(Boolean)
            .join(" "),
        ).includes(needle),
      )
    : lines;

  const list = lines.length ? (
    <div className="flex min-h-0 flex-1 flex-col">
      {lines.length > CART_SEARCH_FROM || expanded ? (
        <div className="relative border-b border-border/60 px-4 py-2.5">
          <Search className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Buscar entre os ${formatNumber(lines.length)} itens do pedido`}
            className="h-9 pl-9 text-sm"
          />
        </div>
      ) : null}
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {shownLines.map((line) => (
          <li key={line.product.key} className="flex items-center gap-3 border-b border-border/40 px-4 py-2.5">
            <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted">
              {line.product.photoUrl ? (
                <img src={line.product.photoUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <Package className="m-2.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {productTitle(line.product)}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {line.product.clientCode} · {formatNumber(liveAvailableForLine(line.product, line))} disponíveis
              </span>
            </span>
            <QuantityStepper
              compact
              label={line.product.name}
              value={line.quantity}
              max={line.product.available}
              onChange={(quantity) => onQuantityChange(line.product, quantity)}
              onIncrement={() => onIncrement(line.product)}
              onDecrement={() => onDecrement(line.product)}
            />
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
              onClick={() => onRemove(line.product)}
              aria-label={`Remover ${line.product.name}`}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
        {needle && !shownLines.length ? (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum item do pedido com esse nome.</li>
        ) : null}
      </ul>
    </div>
  ) : (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <ShoppingCart className="h-6 w-6 text-muted-foreground" />
      <p className="mt-3 font-medium">Nenhum item no pedido</p>
      <p className="mt-1 text-sm text-muted-foreground">Escolha o tamanho e a quantidade no card e clique em Adicionar.</p>
    </div>
  );

  const form = (
    <div className="flex flex-col gap-3 p-4">
      <div className="space-y-1.5">
        <Label htmlFor="cart-name">Nome do pedido (opcional)</Label>
        <Input
          id="cart-name"
          value={orderName}
          onChange={(event) => onOrderNameChange(event.target.value)}
          placeholder="Ex.: Abastecimento loja Faria Lima"
          maxLength={120}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cart-destination">
          Entregar em <span className="text-destructive" aria-hidden="true">*</span>
        </Label>
        <Input
          id="cart-destination"
          value={destination}
          onChange={(event) => onDestinationChange(event.target.value)}
          placeholder="Agência, prédio ou centro de custo"
          aria-required="true"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cart-due-at">Para quando</Label>
        <Input
          id="cart-due-at"
          type="datetime-local"
          value={dueAt}
          onChange={(event) => onDueAtChange(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cart-notes">Observações</Label>
        <Textarea
          id="cart-notes"
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
          placeholder="Contato, janela de entrega ou restrições"
          rows={3}
        />
      </div>
      <div className="flex items-center justify-between border-t border-border/60 pt-3 text-sm">
        <span className="text-muted-foreground">
          {formatNumber(lines.length)} {lines.length === 1 ? "item" : "itens"}
        </span>
        <strong>{formatNumber(totalQuantity)} peças</strong>
      </div>
      <Button
        type="button"
        className="w-full cursor-pointer"
        disabled={isSubmitting || lines.length === 0}
        onClick={onSubmit}
      >
        {isSubmitting ? <Truck className="h-4 w-4 animate-pulse" /> : <CheckCircle2 className="h-4 w-4" />}
        Enviar pedido para a Dutelog
      </Button>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_24px_70px_rgba(15,23,42,.25)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div>
          <h2 className="font-semibold">Seu pedido</h2>
          <p className="text-xs text-muted-foreground">
            {formatNumber(lines.length)} {lines.length === 1 ? "item" : "itens"} · {formatNumber(totalQuantity)} peças
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className="cursor-pointer" onClick={onToggleExpanded}>
            {expanded ? "Recolher" : "Tela cheia"}
          </Button>
          <button
            type="button"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            onClick={onClose}
            aria-label="Fechar pedido"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-h-0 flex-col md:border-r md:border-border/60">{list}</div>
          <div className="overflow-y-auto">{form}</div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex max-h-[45vh] min-h-[120px] flex-col">{list}</div>
          <div className="border-t border-border/60">{form}</div>
        </div>
      )}
    </div>
  );
}

function ProductDetailPanel({
  product,
  cart,
  draftQuantity,
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
  isPending: boolean;
  onClose: () => void;
  onDraftQuantityChange: (quantity: number) => void;
  onAdd: () => void;
  onReplenish: () => void;
  onArchive: () => void;
}) {
  const liveAvailable = liveAvailableForProduct(product, cart);
  const remaining = Math.max(0, liveAvailable - draftQuantity);
  const status = productStatus(product, liveAvailable);
  const showPhysicalTotal = product.total > liveAvailable;

  return (
    <ModulePanel
      title="Detalhe do produto"
      description="Visão para pedido e reposição"
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
            {productTitle(product)}
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-border bg-white/70 px-3 py-1 text-xs text-muted-foreground">
              {productType(product)}
            </span>
            <StockBadge status={status} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StockFact
            label="Disponível para pedido"
            value={formatNumber(liveAvailable)}
          />
          {draftQuantity > 0 ? (
            <StockFact
              label="Sobra apos este pedido"
              value={formatNumber(remaining)}
            />
          ) : (
            <StockFact
              label="No pedido"
              value={formatNumber(cart[product.key] ?? 0)}
            />
          )}
          {product.reserved > 0 ? (
            <StockFact
              label="Reservado"
              value={formatNumber(product.reserved)}
            />
          ) : null}
          {showPhysicalTotal ? (
            <StockFact
              label="Total físico"
              value={formatNumber(product.total)}
            />
          ) : null}
          {draftQuantity > 0 ? (
            <StockFact
              label="Quantidade selecionada"
              value={formatNumber(draftQuantity)}
            />
          ) : null}
        </div>

        <div className="rounded-[22px] border border-primary/15 bg-primary/10 p-4 text-sm leading-6 text-primary">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{agentDuteSignal(product, liveAvailable)}</p>
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
              disabled={liveAvailable <= 0 || draftQuantity <= 0}
              onClick={onAdd}
            >
              <ShoppingCart className="h-4 w-4" />
              Adicionar ao pedido
            </Button>
          </div>
        ) : (
          <ZeroStockActions
            disabled={isPending}
            archived={product.archived}
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
  inCart = 0,
}: {
  product: StockProduct;
  status: ReturnType<typeof productStatus>;
  large?: boolean;
  compact?: boolean;
  inCart?: number;
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
          <StockBadge status={status} compact={compact} inCart={inCart} />
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
        <StockBadge status={status} compact={compact} inCart={inCart} />
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
        min={0}
        max={normalizedMax}
        value={normalizedValue}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            onChange(0);
            return;
          }
          onChange(Number(raw));
        }}
        aria-label={`Quantidade de ${label}`}
        className={cn(
          "border-0 bg-transparent px-1 text-center shadow-none focus-visible:ring-0",
          compact ? "h-8 w-11 text-xs" : "h-9 w-20",
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
  archived = false,
  onReplenish,
  onArchive,
}: {
  compact?: boolean;
  disabled?: boolean;
  archived?: boolean;
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
        Avisar reposição
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
        {archived ? "Devolver à vitrine" : "Arquivar"}
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
        "flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition",
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
  inCart = 0,
}: {
  status: ReturnType<typeof productStatus>;
  compact?: boolean;
  inCart?: number;
}) {
  // Etiqueta só quando importa; "Disponível" em todo card era ruído.
  const size = compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";
  if (inCart > 0) {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-md bg-primary font-semibold text-white shadow-sm", size)}>
        <ShoppingCart className="h-3.5 w-3.5" />
        {formatNumber(inCart)} no pedido
      </span>
    );
  }
  if (status === "zero") {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-md bg-white font-semibold text-rose-700 shadow-sm", size)}>
        <AlertTriangle className="h-3.5 w-3.5" />
        Sem saldo
      </span>
    );
  }
  if (status === "low") {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-md bg-white font-semibold text-amber-700 shadow-sm", size)}>
        <Sparkles className="h-3.5 w-3.5" />
        Baixo estoque
      </span>
    );
  }
  return null;
}

/** Aplica o rascunho uma vez, quando o estoque já carregou. */
function DraftLoader({ products, onLoad }: { products: StockProduct[]; onLoad: (products: StockProduct[]) => void }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    onLoad(products);
  }, [products, onLoad]);
  return null;
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
      minimum: undefined,
      archived: false,
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

  for (const product of grouped.values()) {
    const minimums = product.sources
      .map((source) => (source as { estoque_minimo?: unknown }).estoque_minimo)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    product.minimum = minimums.length ? Math.max(...minimums) : undefined;
    // Arquivado só enquanto zerado: se o saldo voltar, reaparece na vitrine.
    product.archived =
      product.total <= 0 &&
      product.sources.length > 0 &&
      product.sources.every((source) => (source as { client_archived?: unknown }).client_archived === true);
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
}: {
  products: StockProduct[];
  cart: Record<string, number>;
  searchTerm: string;
  categoryFilter: string;
  stockFilter: StockFilter;
}) {
  const query = normalizeSlug(searchTerm);

  return products.filter((product) => {
    const isArchived = product.archived;
    if (stockFilter === "arquivados") {
      if (!isArchived) return false;
    } else if (isArchived) {
      return false;
    }

    if (categoryFilter !== "todos" && typeValue(product) !== categoryFilter) {
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
        firstText(source.client_item_code, product.clientItemCode) ?? undefined,
      product_name: product.name,
      location_id: source.location_id ?? undefined,
      quantity: allocatedQuantity,
    });
    remaining -= allocatedQuantity;
  }

  return allocations;
}

function buildReplenishmentRequest(
  product: StockProduct,
): CreateClientRequestPayload {
  return {
    // Mensagem para a Dutelog, não aviso de chegada: antes virava um
    // "recebimento" de 1 peça que aparecia como entrega avisada e na fila
    // do armazém sem nada para chegar.
    type: "suporte",
    priority: "normal",
    title: `Reposição: ${productTitle(product)} (${product.clientCode})`,
    description: [
      `A BTG avisa que o item ${product.clientCode} está sem saldo e precisa de reposição.`,
      "Quando o fornecedor tiver data, avise a entrega pelo portal.",
    ].join(" "),
    items: [],
  };
}

/** Documentos de client_inventory do produto (um por SKU/projeção). */
function archiveIds(product: StockProduct) {
  return [...new Set(product.sources.map((source) => String(source.id ?? "")).filter(Boolean))];
}

async function setItemArchived(inventoryId: string, archived: boolean) {
  const response = await fetch(`/api/client/inventory/${encodeURIComponent(inventoryId)}/archive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ archived }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message || "Não foi possível arquivar.");
  }
}

function liveAvailableForProduct(
  product: StockProduct,
  cart: Record<string, number>,
) {
  return Math.max(0, product.available - (cart[product.key] ?? 0));
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
  // Mesmo critério do Estoque interno: só com mínimo cadastrado na ficha.
  if (product.minimum === undefined) return false;
  return product.available > 0 && liveAvailable > 0 && liveAvailable <= product.minimum;
}

function agentDuteSignal(product: StockProduct, liveAvailable: number) {
  if (product.available <= 0) {
    return "Produto sem saldo disponível. Avise a Dutelog sobre a reposição ou arquive o produto; o histórico é preservado.";
  }

  if (liveAvailable <= 0) {
    return "Todo o saldo disponível já está no seu pedido. Ao enviar, a Dutelog separa, confere e entrega.";
  }

  if (isLowStock(product, liveAvailable)) {
    return "Estoque baixo. Vale acompanhar a reposição antes de pedidos grandes.";
  }

  return "Saldo disponível. Escolha a quantidade e clique em Adicionar para incluir no pedido.";
}

function clampQuantity(quantity: number, max: number) {
  if (max <= 0) return 0;
  const parsed = Math.floor(Number.isFinite(quantity) ? quantity : 0);
  return Math.min(max, Math.max(0, parsed));
}

function invalidateClientData(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: clientOverviewQueryKey }),
    queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] }),
    queryClient.invalidateQueries({ queryKey: ["ai-overview"] }),
  ]);
}
