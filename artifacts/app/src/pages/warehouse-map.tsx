/**
 * Estoque › Mapa: prateleiras, ocupação e caixas por zona de cliente
 * (docs/mapa-do-armazem-enderecamento-dirigido.md, seção 5.6). A posição de
 * cada caixa vem da guarda confirmada; aqui se vê o resultado e o número de
 * posições ocupadas que a fatura manual usa.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid, PackageOpen, Printer, X } from "lucide-react";
import { Link, useLocation } from "wouter";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpeningInventorySession } from "@/features/warehouse-ops/opening-inventory-status";
import { ShelfVolumeSummary } from "@/features/warehouse-ops/shelf-volume-summary";
import { useIsDesktop } from "@/hooks/use-desktop";
import { cn } from "@/lib/utils";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { openingInventoryNotice } from "@/lib/opening-inventory";
import { boxVolumeM3, fetchWarehouseRows, formatVolumeM3 } from "@/lib/warehouse-volume";
import { formatBoxDimensions, warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import { labelsUrl } from "@/lib/warehouse-labels";
import {
  type BoxContentSource,
  type Shelf,
  type ShelfState,
  type SkuIndex,
  type ZoneFilter,
  SHELF_STATES,
  SHELF_STATE_LABELS,
  boxContents,
  buildShelves,
  groupByAisle,
  inZone,
  shelfMatches,
  skuIndexFromRows,
  summarizeZone,
  zonesOf,
} from "@/lib/warehouse-map";
import { type AnyRecord, fetchJson, formatNumber, getErrorMessage } from "@/lib/warehouse-ops/model";
import { type WarehousePosition, REFERENCE_BOX, formatKilos, formatMeters } from "@/lib/warehouse-positions";

type PositionsResponse = { items?: WarehousePosition[] };
const ALL = "__all__";
const NO_CUSTOMER = "__none__";

const STATE_CLASS: Record<ShelfState, string> = {
  free: "border-dashed border-border bg-card",
  partial: "border-info-soft-border bg-info-soft",
  full: "border-success-soft-border bg-success-soft",
  review: "border-warning-soft-border bg-warning-soft",
  blocked: "border-destructive-soft-border bg-destructive-soft",
};

function zoneValue(zone: ZoneFilter) {
  return zone === "all" ? ALL : zone === null ? NO_CUSTOMER : zone;
}

function zoneFromValue(value: string): ZoneFilter {
  return value === ALL ? "all" : value === NO_CUSTOMER ? null : value;
}

function zoneLabel(zone: ZoneFilter) {
  return zone === "all" ? "todas as zonas" : zone === null ? "sem cliente" : zone;
}

export default function WarehouseMapPage() {
  const [, navigate] = useLocation();
  const desktop = useIsDesktop();
  const { code: activeCustomerCode, active: activeCustomer } = useActiveCustomer();
  const [zone, setZone] = useState<ZoneFilter>("all");
  const [aisle, setAisle] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const positionsQuery = useQuery<PositionsResponse>({
    queryKey: ["warehouse-positions"],
    staleTime: 30_000,
    refetchInterval: 120_000,
    queryFn: async () => ({ items: await fetchWarehouseRows<WarehousePosition>("/api/warehouse/positions?limit=2000") }),
  });
  const boxesQuery = useQuery({
    queryKey: ["warehouse-boxes", "all"],
    staleTime: 10_000,
    refetchInterval: 120_000,
    queryFn: async () => (await fetchWarehouseRows<AnyRecord>("/api/warehouse/boxes?limit=5000")).map(warehouseBoxFromRecord),
  });
  const skusQuery = useQuery({
    queryKey: ["estoque", "skus"],
    staleTime: 120_000,
    queryFn: () => fetchJson<{ items: AnyRecord[] }>("/api/skus?limit=2000"),
  });
  const sessionQuery = useOpeningInventorySession();
  const openingNotice = openingInventoryNotice(sessionQuery.data);
  const showOpeningNotice = Boolean(openingNotice) && (zone === "all" || zone === activeCustomerCode);

  const shelves = useMemo(
    () => buildShelves(positionsQuery.data?.items ?? [], boxesQuery.data ?? []),
    [boxesQuery.data, positionsQuery.data?.items],
  );
  const skuIndex = useMemo<SkuIndex>(() => skuIndexFromRows(skusQuery.data?.items ?? []), [skusQuery.data?.items]);
  const zones = useMemo(() => zonesOf(shelves), [shelves]);
  const aisles = useMemo(() => [...new Set(shelves.map((shelf) => shelf.position.aisle))], [shelves]);
  const summary = useMemo(() => summarizeZone(shelves, zone), [shelves, zone]);
  const visible = useMemo(
    () =>
      shelves.filter(
        (shelf) => inZone(shelf, zone) && (aisle === ALL || shelf.position.aisle === aisle) && shelfMatches(shelf, search, skuIndex),
      ),
    [aisle, search, shelves, skuIndex, zone],
  );
  const groups = useMemo(() => groupByAisle(visible), [visible]);
  const selected = shelves.find((shelf) => shelf.code === selectedCode) ?? null;
  const sessionLines: BoxContentSource[] = sessionQuery.data?.lines ?? [];

  useEffect(() => {
    if (!desktop || !selectedCode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedCode(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, selectedCode]);

  const loading = positionsQuery.isLoading || boxesQuery.isLoading;
  const error = positionsQuery.error ?? boxesQuery.error;
  const empty = !loading && !error && shelves.length === 0;
  const searching = search.trim().length > 0;

  const panel = selected ? (
    <ShelfPanel
      key={selected.code}
      shelf={selected}
      lines={sessionLines}
      skuIndex={skuIndex}
      onClose={() => setSelectedCode(null)}
      onLabels={(url) => navigate(url)}
    />
  ) : null;

  return (
    <div className="flex flex-col gap-6 pb-24">
      <PageHeader
        title="Mapa do armazém"
        description="Prateleiras, ocupação registrada e caixas por zona de cliente."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => navigate(labelsUrl({ positions: visible.map((shelf) => shelf.code) }))}
              disabled={visible.length === 0}
              title="Etiquetas das posições em tela, dez por folha A4"
            >
              <Printer className="size-4" />
              Etiquetas de posição
            </Button>
            <Button asChild>
              <Link href="/estoque/posicoes">
                <LayoutGrid className="size-4" />
                Cadastro de posições
              </Link>
            </Button>
          </>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar o mapa</AlertTitle>
          <AlertDescription>{getErrorMessage(error)}</AlertDescription>
        </Alert>
      ) : null}

      {showOpeningNotice ? (
        <Alert className="border-info-soft-border bg-info-soft text-info-soft-foreground [&>svg]:text-info-soft-foreground">
          <PackageOpen className="size-4" />
          <AlertTitle>
            {sessionQuery.data?.status === "open" ? "Inventário em andamento · ocupação parcial" : "Inventário de abertura pendente · ocupação não confirmada"}
          </AlertTitle>
          <AlertDescription>{activeCustomer.name}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? <Skeleton className="h-80 w-full rounded-lg" /> : null}

      {empty ? (
        <Alert className="border-info-soft-border bg-info-soft text-info-soft-foreground [&>svg]:text-info-soft-foreground">
          <LayoutGrid className="size-4" />
          <AlertTitle>Nenhuma posição cadastrada</AlertTitle>
          <AlertDescription>
            O mapa nasce do cadastro de posições. Carregue o mapa inicial ou cadastre as prateleiras em Estoque › Posições.
          </AlertDescription>
        </Alert>
      ) : null}

      {!loading && !error && shelves.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label={`Posições ocupadas · ${zoneLabel(zone)}`}
              value={formatNumber(summary.occupied)}
              note="Prateleiras com caixas guardadas. Referência da fatura manual."
            />
            <Tile
              label={zone === "all" ? "Prateleiras cadastradas" : `Prateleiras na zona ${zoneLabel(zone)}`}
              value={formatNumber(summary.positions)}
              note={`${formatNumber(summary.occupied)} com caixa · ${formatNumber(summary.empty)} sem caixas registradas · ${formatNumber(summary.unavailable)} indisponível(is)`}
            />
            <Tile
              label="Volume registrado"
              value={formatVolumeM3(summary.occupied_volume_m3)}
              note="Volume das caixas guardadas na zona."
            />
            <Tile
              label="Caixas guardadas"
              value={formatNumber(summary.boxes)}
              note={`${formatNumber(summary.units)} unidade(s) · ${formatNumber(summary.products)} produto(s)`}
            />
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 lg:flex-row lg:flex-wrap lg:items-end">
            <div className="flex min-w-44 flex-col gap-1">
              <Label htmlFor="map-zone">Zona</Label>
              <Select value={zoneValue(zone)} onValueChange={(value) => setZone(zoneFromValue(value))}>
                <SelectTrigger id="map-zone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todas</SelectItem>
                  {zones.map((item) => (
                    <SelectItem key={zoneValue(item)} value={zoneValue(item)}>
                      {item ?? "Sem cliente"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-32 flex-col gap-1">
              <Label htmlFor="map-aisle">Rua</Label>
              <Select value={aisle} onValueChange={setAisle}>
                <SelectTrigger id="map-aisle">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todas</SelectItem>
                  {aisles.map((item) => (
                    <SelectItem key={item} value={item}>
                      Rua {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Label htmlFor="map-search">Buscar caixa, produto ou código</Label>
              <Input
                id="map-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="CX-000012, camisa social, A.01.0802…"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {SHELF_STATES.map((state) => (
                <span key={state} className="inline-flex items-center gap-1.5">
                  <span className={cn("inline-block size-3 rounded-sm border", STATE_CLASS[state])} aria-hidden="true" />
                  {SHELF_STATE_LABELS[state]}
                </span>
              ))}
            </div>
          </div>

          <div className={cn("grid grid-cols-1 gap-4", desktop && panel && "lg:grid-cols-[minmax(0,1fr)_400px]")}>
            <section className="rounded-lg border border-border bg-card">
              <div className="flex flex-col gap-2 border-b border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    {zone === "all" ? "Todas as zonas" : `Zona ${zoneLabel(zone)}`}
                    {aisle !== ALL ? ` · rua ${aisle}` : ""}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Sequência de caminhada: a primeira prateleira de cada rua é a mais perto da expedição. Toque numa prateleira para ver as caixas.
                  </p>
                </div>
                <Badge variant="outline" className="w-fit">
                  {formatNumber(summary.boxes)} caixa(s) · {Math.round(summary.fill * 100)}% da frente
                </Badge>
              </div>
              {groups.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {searching ? "Nenhuma prateleira tem o que você buscou." : "Nenhuma prateleira nesta zona ou rua."}
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-border/60">
                  {groups.map((group) => (
                    <div key={group.aisle} className="flex flex-col gap-2 px-4 py-3">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-foreground">Rua {group.aisle}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatNumber(group.shelves.length)} prateleira(s) · {formatNumber(group.shelves.reduce((sum, shelf) => sum + shelf.boxes.length, 0))} caixa(s)
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {group.shelves.map((shelf) => (
                          <ShelfCell
                            key={shelf.code}
                            shelf={shelf}
                            selected={selectedCode === shelf.code}
                            onClick={() => setSelectedCode((current) => (current === shelf.code ? null : shelf.code))}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            {desktop && panel ? <aside className="lg:sticky lg:top-4 lg:self-start">{panel}</aside> : null}
          </div>

          {!desktop ? (
            <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedCode(null)}>
              <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-lg p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>{selected?.code ?? "Prateleira"}</SheetTitle>
                  <SheetDescription>Caixas e ocupação da prateleira</SheetDescription>
                </SheetHeader>
                {panel}
              </SheetContent>
            </Sheet>
          ) : null}

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Como o número de posições é contado</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Cada prateleira com ao menos uma caixa guardada conta uma posição para o cliente dono da zona. O número aparece aqui como referência; a fatura continua sendo enviada manualmente.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

function ShelfCell({ shelf, selected, onClick }: { shelf: Shelf; selected: boolean; onClick: () => void }) {
  const hasRecordedBoxes = shelf.boxes.length > 0;
  const frontPercent = hasRecordedBoxes ? Math.round(shelf.fill * 100) : null;
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${shelf.code}, ${SHELF_STATE_LABELS[shelf.state]}, ${shelf.boxes.length} caixa(s)`}
      className={cn(
        "h-auto min-w-0 flex-col items-stretch justify-start gap-3 whitespace-normal rounded-lg p-3 text-left font-normal",
        STATE_CLASS[shelf.state],
        selected && "border-primary ring-2 ring-ring/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold text-foreground">{shelf.code}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(shelf.boxes.length)} cx</span>
      </div>
      <div className="text-xs text-muted-foreground">{SHELF_STATE_LABELS[shelf.state]}</div>
      {hasRecordedBoxes ? (
        <dl className="grid grid-cols-2 gap-2">
            <div>
              <dt className="text-xs text-muted-foreground">Ocupado</dt>
              <dd className="mt-1 text-sm font-medium tabular-nums text-foreground">{formatVolumeM3(shelf.volume.occupiedM3)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Livre estimado</dt>
              <dd className="mt-1 text-sm font-medium tabular-nums text-foreground">{formatVolumeM3(shelf.volume.freeM3)}</dd>
            </div>
        </dl>
      ) : (
        <div className="text-sm text-muted-foreground">Ocupação não confirmada</div>
      )}
      <div className="border-t border-border/60 pt-2">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Frente ocupada</span>
          <span className="tabular-nums">{frontPercent == null ? "—" : `${frontPercent}%`}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          {frontPercent != null ? <div className="h-full rounded-full bg-primary/50" style={{ width: `${frontPercent}%` }} /> : null}
        </div>
      </div>
    </Button>
  );
}

function ShelfPanel({
  shelf,
  lines,
  skuIndex,
  onClose,
  onLabels,
}: {
  shelf: Shelf;
  lines: BoxContentSource[];
  skuIndex: SkuIndex;
  onClose: () => void;
  onLabels: (url: string) => void;
}) {
  const { position } = shelf;
  const [showAllBoxes, setShowAllBoxes] = useState(false);
  const visibleBoxes = showAllBoxes ? shelf.boxes : shelf.boxes.slice(0, 3);
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-foreground">{shelf.code}</h2>
          <p className="text-xs text-muted-foreground">
            Rua {position.aisle} · prateleira {position.shelf} · zona {shelf.zone ?? "sem cliente"}
            {position.sequence != null ? ` · sequência ${position.sequence}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn(STATE_CLASS[shelf.state], "max-w-40 whitespace-normal border text-center")}>{SHELF_STATE_LABELS[shelf.state]}</Badge>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
            <X className="size-4" />
          </Button>
        </div>
      </div>
      <ShelfVolumeSummary title="Volume da prateleira" position={position} boxes={shelf.boxes} unconfirmed={shelf.boxes.length === 0} />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="col-span-2">
          <dt className="text-xs text-muted-foreground">Medidas úteis · comprimento × profundidade × altura</dt>
          <dd className="mt-1 font-medium text-foreground">{formatMeters(position.length_m)} × {formatMeters(position.depth_m)} × {formatMeters(position.height_m)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Peso registrado</dt>
          <dd className="mt-1 font-medium text-foreground">{formatKilos(shelf.weight_used_kg)}</dd>
          <dd className="mt-1 text-xs text-muted-foreground">Máximo {formatKilos(position.max_weight_kg)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Caixas registradas</dt>
          <dd className="mt-1 font-medium text-foreground">{formatNumber(shelf.boxes.length)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Frente livre registrada</dt>
          <dd className="mt-1 font-medium text-foreground">{shelf.boxes.length ? formatMeters(shelf.free_front_m) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Referência na base</dt>
          <dd className="mt-1 font-medium text-foreground">{shelf.boxes.length ? `${formatNumber(shelf.remaining_reference_boxes)} caixa(s)` : "—"}</dd>
          <dd className="mt-1 text-xs text-muted-foreground">{formatBoxDimensions(REFERENCE_BOX)} · por frente e peso</dd>
        </div>
      </dl>
      {position.notes ? <p className="text-xs text-muted-foreground">{position.notes}</p> : null}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground">Caixas nesta prateleira</h3>
          {shelf.boxes.length > 0 ? <span className="text-xs text-muted-foreground">{formatNumber(visibleBoxes.length)} de {formatNumber(shelf.boxes.length)}</span> : null}
        </div>
        {shelf.boxes.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">Sem caixas registradas. Ocupação não confirmada.</div>
        ) : (
          <div className="space-y-2">
            {visibleBoxes.map((box) => {
              const contents = boxContents(box, lines, skuIndex);
              return (
                <div key={box.code} className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{box.code}</span>
                    <span className="text-xs text-muted-foreground">{formatNumber(box.unit_count)} un.</span>
                  </div>
                  {contents.length ? (
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {contents.slice(0, 4).map((line) => (
                        <li key={`${line.code}-${line.name}`} className="truncate">
                          {line.qty != null ? `${formatNumber(line.qty)} × ` : ""}
                          {line.name}
                          {line.code && line.code !== line.name ? ` · ${line.code}` : ""}
                        </li>
                      ))}
                      {contents.length > 4 ? <li>+ {contents.length - 4} produto(s)</li> : null}
                    </ul>
                  ) : (
                    <div className="mt-1 text-xs text-muted-foreground">Conteúdo ainda não lançado.</div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatBoxDimensions(box)} · {formatVolumeM3(boxVolumeM3(box))} · {box.session_id ? "abertura" : "manual"}
                    {box.support_box_code ? ` · sobre ${box.support_box_code}` : ""}
                  </div>
                </div>
              );
            })}
            {shelf.boxes.length > 3 ? (
              <Button type="button" variant="outline" className="w-full" onClick={() => setShowAllBoxes((current) => !current)}>
                {showAllBoxes ? "Mostrar menos caixas" : `Ver todas as ${formatNumber(shelf.boxes.length)} caixas`}
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onLabels(labelsUrl({ positions: [shelf.code] }))}>
          <Printer className="size-4" />
          Etiqueta da posição
        </Button>
        {shelf.boxes.length ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onLabels(labelsUrl({ boxes: shelf.boxes.map((box) => box.code) }))}>
            <Printer className="size-4" />
            Etiquetas das caixas
          </Button>
        ) : null}
        <Button asChild size="sm" variant="outline">
          <Link href="/estoque/posicoes">
            <LayoutGrid className="size-4" />
            Editar posição
          </Link>
        </Button>
      </div>
    </section>
  );
}
