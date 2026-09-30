import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Camera,
  ClipboardCheck,
  ImageOff,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Archive,
  X,
} from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { uploadProductPhoto } from "@/features/warehouse-ops/shared";
import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
import {
  canAddItemPhotos,
  canWriteCatalog,
  humanApiError,
} from "@/lib/permissions";
import {
  buildStockItems,
  matchesFilter,
  matchesSearch,
  type StockFilter,
  type StockItem,
} from "@/lib/stock-items";
import { cn } from "@/lib/utils";
import Movements, { MovementModal } from "./movements";
import { DeleteSkuButton, SkuModal } from "./skus";

type AnyRecord = Record<string, unknown>;

const numberFormatter = new Intl.NumberFormat("pt-BR");
const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const unitMoneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function useIsDesktop() {
  const query = "(min-width: 1024px)";
  const [desktop, setDesktop] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setDesktop(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

const FILTERS: Array<{ value: StockFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "low", label: "Baixo" },
  { value: "reserved", label: "Reservados" },
  { value: "no-photo", label: "Sem foto" },
  { value: "zero", label: "Zerados" },
];

export default function Estoque() {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  const catalogWriter = canWriteCatalog(role);
  const desktop = useIsDesktop();
  const [tab, setTab] = useState<"items" | "history">("items");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StockFilter>(() => {
    if (typeof window === "undefined") return "all";
    const value = new URLSearchParams(window.location.search).get("filtro");
    return FILTERS.some((option) => option.value === value)
      ? (value as StockFilter)
      : "all";
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const skus = useQuery({
    queryKey: ["estoque", "skus"],
    queryFn: () => fetchJson<{ items: AnyRecord[] }>("/api/skus?limit=2000"),
    refetchInterval: 120_000,
  });
  const balances = useQuery({
    queryKey: ["stock-balances", "estoque"],
    queryFn: () =>
      fetchJson<{ items: AnyRecord[] }>("/api/stock-balances?limit=2000"),
    refetchInterval: 120_000,
  });
  const products = useQuery({
    queryKey: ["estoque", "products"],
    queryFn: () => fetchJson<{ items: AnyRecord[] }>("/api/products?limit=2000"),
    refetchInterval: 300_000,
  });

  const items = useMemo(
    () =>
      buildStockItems({
        skus: skus.data?.items,
        balances: balances.data?.items,
        products: products.data?.items,
      }),
    [balances.data?.items, products.data?.items, skus.data?.items],
  );
  const counts = useMemo(() => {
    const result = {} as Record<StockFilter, number>;
    for (const option of FILTERS) {
      result[option.value] = items.filter((item) => matchesFilter(item, option.value)).length;
    }
    return result;
  }, [items]);
  const visible = useMemo(
    () => items.filter((item) => matchesFilter(item, filter) && matchesSearch(item, search)),
    [filter, items, search],
  );
  const selected = items.find((item) => item.key === selectedKey) ?? null;
  // A ficha só abre quando a pessoa escolhe um item; fechada, a lista usa a
  // largura toda. Clicar de novo na mesma linha (ou no X, ou Esc) recolhe.
  const panelItem = selected;
  const toggleItem = (item: StockItem) =>
    setSelectedKey((current) => (current === item.key ? null : item.key));

  useEffect(() => {
    if (!desktop || !selectedKey) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedKey(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, selectedKey]);

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground sm:text-2xl">Estoque</h1>
          <div className="flex rounded-xl bg-muted p-1" role="tablist">
            {(
              [
                ["items", `Itens${items.length ? ` · ${numberFormatter.format(items.length)}` : ""}`],
                ["history", "Histórico"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium sm:px-3",
                  tab === value
                    ? "bg-white text-foreground shadow-sm"
                    : "text-foreground/60 hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/wms/contagem">
              <ClipboardCheck className="size-4" />
              Contagem
            </Link>
          </Button>
          {catalogWriter ? (
            <SkuModal
              trigger={
                <Button>
                  <Plus className="size-4" />
                  Novo item
                </Button>
              }
            />
          ) : null}
        </div>
      </div>

      {tab === "history" ? (
        <Movements />
      ) : (
        <>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por código, nome ou endereço"
                className="pl-9"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 lg:pb-0">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  className={cn(
                    "whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium sm:text-sm",
                    filter === option.value
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-white/70 text-foreground/70 hover:text-foreground",
                  )}
                >
                  {option.label}
                  {option.value !== "all" || counts.all ? (
                    <span className="ml-1.5 font-semibold">{counts[option.value]}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          {skus.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando estoque...</p>
          ) : skus.error ? (
            <p className="text-sm text-destructive">Não consegui carregar o estoque.</p>
          ) : (
            <div
              className={cn(
                "grid grid-cols-1 gap-4",
                desktop && panelItem && "lg:grid-cols-[minmax(0,1fr)_440px]",
              )}
            >
              <ItemList
                items={visible}
                selectedKey={panelItem?.key}
                onSelect={toggleItem}
              />
              {desktop && panelItem ? (
                <section className="relative overflow-hidden rounded-[20px] border border-primary/50 bg-white/90 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-160px)] lg:overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => setSelectedKey(null)}
                    aria-label="Recolher ficha"
                    title="Recolher (Esc)"
                    className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <ItemCard key={panelItem.key} item={panelItem} />
                </section>
              ) : null}
            </div>
          )}

          {!desktop ? (
            <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedKey(null)}>
              <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-[22px] p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>{selected?.name ?? "Item"}</SheetTitle>
                  <SheetDescription>Ficha do item</SheetDescription>
                </SheetHeader>
                {selected ? <ItemCard key={selected.key} item={selected} /> : null}
              </SheetContent>
            </Sheet>
          ) : null}
        </>
      )}
    </div>
  );
}

function Thumb({ item, size = "md" }: { item: StockItem; size?: "md" | "lg" }) {
  const photo = item.photos[0];
  const box = size === "lg" ? "size-24 rounded-2xl" : "size-11 rounded-xl";
  if (!photo) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center border-[1.5px] border-dashed border-red-200 bg-white text-red-600",
          box,
        )}
        title="Sem foto"
      >
        <Camera className={size === "lg" ? "size-6" : "size-4"} aria-hidden="true" />
      </div>
    );
  }
  return (
    <img
      src={photo}
      alt=""
      loading="lazy"
      className={cn("shrink-0 bg-muted object-cover", box)}
    />
  );
}

function StatusChips({ item }: { item: StockItem }) {
  return (
    <div className="flex flex-wrap gap-1">
      {item.reserved > 0 ? (
        <Chip tone="warn">{numberFormatter.format(item.reserved)} reservados</Chip>
      ) : null}
      {item.zero ? <Chip tone="bad">Zerado</Chip> : item.low ? <Chip tone="bad">Baixo</Chip> : null}
      {item.photos.length === 0 ? <Chip tone="muted">Sem foto</Chip> : null}
    </div>
  );
}

function Chip({ tone, children }: { tone: "warn" | "bad" | "muted"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold",
        tone === "warn" && "bg-amber-50 text-amber-800",
        tone === "bad" && "bg-red-50 text-red-700",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

// Endereço real é longo ("RUA B - PRATELEIRA 12 - CAIXA 194"): quebra linha
// dentro da coluna em vez de invadir o saldo ou esconder a caixa.
function LocationTag({ id }: { id: string }) {
  return (
    <span
      title={id}
      className="inline-block max-w-full break-words rounded-md bg-blue-50 px-1.5 py-0.5 align-middle font-mono text-xs text-blue-700"
    >
      {id}
    </span>
  );
}

function ItemList({
  items,
  selectedKey,
  onSelect,
}: {
  items: StockItem[];
  selectedKey?: string;
  onSelect: (item: StockItem) => void;
}) {
  const [limit, setLimit] = useState(100);
  if (!items.length) {
    return (
      <div className="rounded-2xl border border-border bg-white/80 px-5 py-6 text-sm text-muted-foreground">
        Nenhum item encontrado.
      </div>
    );
  }
  const shown = items.slice(0, limit);
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-2xl border border-border bg-white/85">
        <div className="hidden grid-cols-[minmax(0,1fr)_200px_64px_84px] gap-3 border-b border-border/70 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground/50 md:grid">
          <span>Item</span>
          <span>Endereço</span>
          <span className="text-right">Saldo</span>
          <span className="text-right">Disponível</span>
        </div>
        <div className="divide-y divide-border/50">
          {shown.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item)}
              className={cn(
                "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,1fr)_200px_64px_84px]",
                selectedKey === item.key && "bg-blue-50/60",
              )}
            >
              <div className="col-span-2 flex min-w-0 items-center gap-3 md:col-span-1">
                <Thumb item={item} />
                <div className="min-w-0">
                  <p className="font-mono text-[13px] font-semibold text-primary">
                    {item.clientCode ?? item.skuCode}
                  </p>
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.name}
                    {item.detail ? (
                      <span className="font-normal text-foreground/55"> · {item.detail}</span>
                    ) : null}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {item.locations[0] ? (
                      <span className="min-w-0 max-w-full md:hidden">
                        <LocationTag id={item.locations[0].id} />
                      </span>
                    ) : null}
                    <StatusChips item={item} />
                  </div>
                </div>
              </div>
              <div className="hidden min-w-0 items-center gap-1 md:flex">
                {item.locations[0] ? <LocationTag id={item.locations[0].id} /> : (
                  <span className="text-xs text-muted-foreground">Sem endereço</span>
                )}
                {item.locations.length > 1 ? (
                  <span className="shrink-0 text-xs text-muted-foreground">+{item.locations.length - 1}</span>
                ) : null}
              </div>
              <div className="text-right md:contents">
                <span className="block text-lg font-semibold tabular-nums md:text-right md:text-sm md:font-normal">
                  {numberFormatter.format(item.onHand)}
                </span>
                <span className="hidden text-right tabular-nums text-foreground/70 md:block">
                  {numberFormatter.format(item.available)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
      {items.length > limit ? (
        <Button type="button" variant="outline" onClick={() => setLimit((value) => value + 100)}>
          Mostrar mais ({numberFormatter.format(items.length - limit)})
        </Button>
      ) : null}
    </div>
  );
}

type MovementRow = {
  id?: string | number;
  tipo_mov?: string;
  qtde?: number | string;
  sinal?: number;
  data?: unknown;
  doc_nf?: string | null;
  motivo?: string | null;
  responsavel?: string | null;
};

function movementDate(value: unknown) {
  if (!value) return "";
  const seconds =
    typeof value === "object" ? Number((value as { seconds?: unknown }).seconds) : NaN;
  const date = Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : dateFormatter.format(date);
}

function ItemCard({ item }: { item: StockItem }) {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  const catalogWriter = canWriteCatalog(role);
  const photoWriter = canAddItemPhotos(role);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);

  const movements = useQuery({
    queryKey: ["movements", "item", item.skuCode],
    queryFn: () =>
      fetchJson<{ items: MovementRow[] }>(
        `/api/movements?cod_sku=${encodeURIComponent(item.skuCode)}&limit=5`,
      ),
    enabled: Boolean(item.skuCode),
  });

  const addPhotos = useMutation({
    mutationFn: async (files: File[]) => {
      const uploaded = await Promise.all(
        files.slice(0, 4).map((file) =>
          uploadProductPhoto(file, item.clientCode ?? item.skuCode),
        ),
      );
      return fetchJson("/api/catalog/photos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sku_code: item.skuCode,
          client_item_code: item.clientCode,
          photo_urls: uploaded.map((photo) => photo.fileUrl),
          photo_storage_paths: uploaded.map((photo) => photo.storagePath),
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Foto adicionada. Todos já veem no cadastro." });
      void queryClient.invalidateQueries({ queryKey: ["estoque"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-balances"] });
    },
    onError: (error) =>
      toast({
        title: "Não consegui adicionar a foto",
        description: humanApiError(error, "Tente novamente em instantes."),
        variant: "destructive",
      }),
  });

  const photo = item.photos[photoIndex] ?? item.photos[0];
  const rows = movements.data?.items ?? [];

  return (
    <div className="flex flex-col">
      <div className="flex gap-4 border-b border-border/60 p-5">
        <div className="flex flex-col gap-1.5">
          {photo ? (
            <img src={photo} alt={item.name} className="size-24 rounded-2xl bg-muted object-cover" />
          ) : (
            <Thumb item={item} size="lg" />
          )}
          {item.photos.length > 1 ? (
            <div className="flex gap-1">
              {item.photos.slice(0, 4).map((url, index) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setPhotoIndex(index)}
                  className={cn(
                    "size-7 overflow-hidden rounded-md border",
                    index === photoIndex ? "border-primary" : "border-transparent opacity-70",
                  )}
                >
                  <img src={url} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[13px] font-semibold text-primary">
            {item.clientCode ?? item.skuCode}
          </p>
          <h2 className="text-lg font-semibold leading-snug text-foreground">{item.name}</h2>
          <p className="mt-0.5 text-sm text-foreground/60">
            {[item.detail, item.clientCode ? `SKU interno ${item.skuCode}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {photoWriter ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (files.length) addPhotos.mutate(files);
                }}
              />
              <Button
                type="button"
                variant={item.photos.length ? "outline" : "default"}
                size="sm"
                className="mt-3"
                disabled={addPhotos.isPending}
                onClick={() => fileRef.current?.click()}
              >
                <Camera className="size-4" />
                {addPhotos.isPending
                  ? "Enviando..."
                  : item.photos.length
                    ? "Mais fotos"
                    : "Adicionar foto"}
              </Button>
            </>
          ) : item.photos.length === 0 ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ImageOff className="size-3.5" /> Sem foto
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-5 p-5">
        <div className={cn("grid gap-2", catalogWriter ? "grid-cols-3" : "grid-cols-2")}>
          <Stat label="em estoque" value={numberFormatter.format(item.onHand)} />
          <Stat label="disponível" value={numberFormatter.format(item.available)} />
          {catalogWriter ? (
            <Stat
              label={item.unitCost ? `${unitMoneyFormatter.format(item.unitCost)} un.` : "sem custo"}
              value={item.unitCost ? moneyFormatter.format(item.unitCost * item.onHand) : "—"}
            />
          ) : null}
        </div>

        <Section title="Onde está">
          {item.locations.length ? (
            item.locations.map((location) => (
              <div key={location.id} className="flex min-w-0 items-center justify-between gap-3 py-1 text-sm">
                <LocationTag id={location.id} />
                <span className="shrink-0 font-semibold tabular-nums">
                  {numberFormatter.format(location.qty)} un.
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Sem endereço registrado.</p>
          )}
        </Section>

        {item.reserved > 0 ? (
          <Section title="Reservado">
            <div className="flex items-center justify-between text-sm">
              <span>
                {numberFormatter.format(item.reserved)} un. em pedidos abertos
              </span>
              <Link href="/pedidos" className="font-medium text-primary hover:underline">
                Ver pedidos
              </Link>
            </div>
          </Section>
        ) : null}

        <Section title="Últimos movimentos">
          {movements.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : rows.length ? (
            rows.map((row, index) => {
              const quantity = Number(row.qtde ?? 0);
              const positive = /ENTRADA|DEVOLUCAO/i.test(String(row.tipo_mov ?? "")) || Number(row.sinal) > 0;
              const who = row.responsavel;
              return (
                <div key={String(row.id ?? index)} className="flex items-center gap-3 py-1.5 text-sm">
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-lg",
                      positive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
                    )}
                  >
                    {positive ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="capitalize">{String(row.tipo_mov ?? "").toLowerCase().replace(/_/g, " ")}</span>
                    {row.doc_nf ? ` · ${row.doc_nf}` : ""}
                    <span className="block text-xs text-foreground/50">
                      {[who, movementDate(row.data)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={cn("font-semibold tabular-nums", positive ? "text-foreground" : "text-red-700")}>
                    {positive ? "+" : "−"}
                    {numberFormatter.format(Math.abs(quantity))}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum movimento registrado.</p>
          )}
        </Section>
      </div>

      <div className="mt-auto flex flex-wrap gap-2 border-t border-border/60 bg-muted/20 p-4">
        <Button asChild variant={catalogWriter ? "outline" : "default"} className={cn(!catalogWriter && "w-full")}>
          <Link href="/wms/contagem">
            <ClipboardCheck className="size-4" />
            Contar este item
          </Link>
        </Button>
        {catalogWriter ? (
          <>
            <SkuModal
              sku={item.sku}
              trigger={
                <Button type="button" variant="outline">
                  <Pencil className="size-4" />
                  Editar cadastro
                </Button>
              }
            />
            <MovementModal
              defaultSku={item.skuCode}
              trigger={
                <Button type="button" variant="outline">
                  <SlidersHorizontal className="size-4" />
                  Ajustar saldo
                </Button>
              }
            />
            {item.id !== undefined ? (
              <DeleteSkuButton
                id={item.id as number}
                cod_btg={item.skuCode}
                trigger={
                  <Button type="button" variant="ghost" className="ml-auto text-destructive hover:text-destructive">
                    <Archive className="size-4" />
                    Arquivar
                  </Button>
                }
              />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2.5">
      <p className="text-xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="text-xs text-foreground/60">{label}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/50">
        {title}
      </h3>
      {children}
    </section>
  );
}

