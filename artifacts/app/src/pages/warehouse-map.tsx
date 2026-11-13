/**
 * Estoque › Mapa: prateleiras, ocupação e caixas por zona de cliente
 * (docs/mapa-do-armazem-enderecamento-dirigido.md, seção 5.6). A posição de
 * cada caixa vem da guarda confirmada; aqui se vê o resultado e o número de
 * posições ocupadas que a fatura manual usa.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, PackageOpen, Printer, X } from "lucide-react";
import { Link, useLocation } from "wouter";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { BlocoSemConexao, ErroNaLeitura } from "@/components/ui/erro-na-leitura";
import { LinhaDeEstado } from "@/components/ui/linha-de-estado";
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
import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { ehFaltaDeConexao, semConexaoNaLeitura } from "@/lib/conexao";
import { openingInventoryNotice } from "@/lib/opening-inventory";
import { boxVolumeM3, formatVolumeM3 } from "@/lib/warehouse-volume";
import { fetchWarehouseRows } from "@/lib/warehouse-rows";
import { type WarehouseBox, boxBalanceUnits, boxOriginLabel, formatBoxDimensions, warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
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
  dataDaCaixa,
  estadoDaCaixa,
  groupByAisle,
  inZone,
  shelfMatches,
  skuIndexFromRows,
  summarizeZone,
  textoDaSaida,
  zonesOf,
} from "@/lib/warehouse-map";
import { type AnyRecord, fetchJson, formatNumber } from "@/lib/warehouse-ops/model";
import { type WarehousePosition, REFERENCE_BOX, formatKilos, formatMeters } from "@/lib/warehouse-positions";

type PositionsResponse = { items?: WarehousePosition[] };
const ALL = "__all__";
/** A linha de estado sob o título: o foco vai a ela quando o aviso no lugar do mapa sai com ele. */
const ID_DA_LINHA = "mapa-linha-de-estado";
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
  const queryClient = useQueryClient();
  const [zone, setZone] = useState<ZoneFilter>("all");
  const [aisle, setAisle] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const positionsQuery = useQuery<PositionsResponse>({
    queryKey: ["warehouse-positions", "all-pages"],
    staleTime: 30_000,
    refetchInterval: 120_000,
    queryFn: async () => ({ items: await fetchWarehouseRows<WarehousePosition>("/api/warehouse/positions?limit=2000") }),
  });
  const boxesQuery = useQuery({
    queryKey: ["warehouse-boxes", "all", "all-pages"],
    staleTime: 10_000,
    refetchInterval: 120_000,
    queryFn: async () => (await fetchWarehouseRows<AnyRecord>("/api/warehouse/boxes?limit=5000")).map(warehouseBoxFromRecord),
  });
  // O saldo de cada prateleira: a guarda por linha move o saldo sem registrar caixa.
  const balancesQuery = useQuery({
    queryKey: ["stock-balances", "estoque"],
    staleTime: 30_000,
    refetchInterval: 120_000,
    queryFn: () => fetchJson<{ items: AnyRecord[] }>("/api/stock-balances?limit=2000"),
  });
  const skusQuery = useQuery({
    queryKey: ["estoque", "skus"],
    staleTime: 120_000,
    queryFn: () => fetchJson<{ items: AnyRecord[] }>("/api/skus?limit=2000"),
  });
  // A situação do inventário que falhou fica na tela enquanto tenta de novo: o "Tentar de novo" não some com o foco nele.
  const sessionQuery = useLeituraComFalha(useOpeningInventorySession());
  const openingNotice = openingInventoryNotice(sessionQuery.data);
  const showSessionStatus = zone === "all" || zone === activeCustomerCode;
  const showOpeningNotice = Boolean(openingNotice) && showSessionStatus && !sessionQuery.isError;

  const shelves = useMemo(
    () => buildShelves(positionsQuery.data?.items ?? [], boxesQuery.data ?? [], balancesQuery.data?.items ?? []),
    [balancesQuery.data?.items, boxesQuery.data, positionsQuery.data?.items],
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

  // O mapa lê as posições, as caixas, os saldos (a guarda por linha) e o catálogo (a busca): só entra com os quatro
  // lidos, e nunca diz "Nenhuma prateleira" antes de ler (carregamento v2, parte 13b). A leitura que falhou sem nada
  // lido fica na tela enquanto tenta de novo.
  const posicoes = useLeituraComFalha(positionsQuery);
  const caixas = useLeituraComFalha(boxesQuery);
  const saldos = useLeituraComFalha(balancesQuery);
  const catalogo = useLeituraComFalha(skusQuery);
  const leiturasDoMapa = [posicoes, caixas, saldos, catalogo];
  const loading = leiturasDoMapa.some((leitura) => leitura.isLoading);
  // Sem rede, o mapa que já estava fica, e a linha de estado diz de quando ele é; sem nada
  // lido, o aviso, e não "Nenhuma posição cadastrada" (decisão 2 do celular).
  const semRede = semConexaoNaLeitura(positionsQuery, boxesQuery, balancesQuery, skusQuery);
  const semNadaLido = semRede !== null && semRede.lidaEm === null;
  // Só a leitura sem nada lido troca o mapa pelo aviso: a releitura do intervalo que falha fica na linha de estado
  // ("Não consegui atualizar · lista de 10:42"), e o mapa lido continua na tela (momento 7).
  const falhou = !semRede && leiturasDoMapa.some((leitura) => leitura.isError && leitura.data === undefined);
  const empty = !loading && !falhou && !semNadaLido && shelves.length === 0;
  const relendo = leiturasDoMapa.some((leitura) => leitura.isFetching);
  const reler = () => {
    void queryClient.invalidateQueries({ queryKey: ["warehouse-positions", "all-pages"] });
    void queryClient.invalidateQueries({ queryKey: ["warehouse-boxes", "all", "all-pages"] });
    void queryClient.invalidateQueries({ queryKey: ["stock-balances", "estoque"] });
    void queryClient.invalidateQueries({ queryKey: ["estoque", "skus"] });
  };
  const tentarDeNovo = () => {
    for (const leitura of [positionsQuery, boxesQuery, balancesQuery, skusQuery]) if (leitura.data === undefined) void leitura.refetch();
  };
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
        estado={<LinhaDeEstado id={ID_DA_LINHA} leitura={leiturasDoMapa} objeto="o mapa" />}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => navigate(labelsUrl({ positions: visible.map((shelf) => shelf.code) }))}
              disabled={visible.length === 0}
              title="Etiquetas das posições em tela"
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

      {/* Com o mapa lido, a falta de conexão fica na linha de estado, sob o título, e nada empurra o mapa (parte 13b). */}
      {semNadaLido ? <BlocoSemConexao tentando={relendo} onTentar={reler} focoAoSair={ID_DA_LINHA} /> : null}

      {falhou ? (
        <ErroNaLeitura
          mensagem="Não consegui carregar o mapa."
          // "Tentando de novo…" só com a leitura que falhou relendo, não com as outras ainda chegando.
          tentando={leiturasDoMapa.some((leitura) => leitura.isError && leitura.data === undefined && leitura.isFetching)}
          onTentar={tentarDeNovo}
          focoAoSair={ID_DA_LINHA}
        />
      ) : null}

      {showSessionStatus && sessionQuery.isError && !ehFaltaDeConexao(sessionQuery.error) ? (
        <Alert className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
          <AlertTitle>Situação do inventário indisponível</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>Não foi possível confirmar se o inventário de abertura de {activeCustomer.name} está concluído.</p>
            {/* Ocupado sem disabled: o foco fica no botão enquanto relê (parte 13b). */}
            <BotaoDeAcao
              variant="outline"
              estado={sessionQuery.isFetching ? "andamento" : "repouso"}
              rotulo="Tentar de novo"
              andamento="Tentando de novo…"
              onClick={() => void sessionQuery.refetch()}
            />
          </AlertDescription>
        </Alert>
      ) : showSessionStatus && sessionQuery.isLoading && !loading ? (
        // A espera com a caixa aos 300 ms e o anúncio, sem região viva solta (parte 13b). Enquanto o mapa ainda lê, quem
        // diz a espera é a linha de estado: uma caixa só na tela.
        <CarregandoNaRegiao rotulo={`Verificando inventário de ${activeCustomer.name}…`} />
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

      {!loading && !falhou && !semNadaLido && shelves.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label={`Posições ocupadas · ${zoneLabel(zone)}`}
              value={formatNumber(summary.occupied)}
              note="Prateleiras com caixa com saldo. Referência da fatura manual."
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
            <section className="@container rounded-lg border border-border bg-card">
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
                      <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3">
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
      aria-label={`${shelf.code}, ${SHELF_STATE_LABELS[shelf.state]}, ${shelf.boxes.length} caixa(s)${shelf.boxes.length === 0 && shelf.saldo.unidades > 0 ? `, ${saldoSemCaixa(shelf)}` : ""}`}
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
      {shelf.volume.pendingCount > 0 ? <div className="text-xs text-muted-foreground">Guarda em andamento</div> : null}
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
      ) : shelf.saldo.unidades > 0 ? (
        <div className="text-sm text-foreground">{saldoSemCaixa(shelf)}</div>
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

/** "71 un. · 2 itens sem caixa registrada" */
function saldoSemCaixa(shelf: Shelf) {
  const itens = shelf.saldo.itens.length;
  return `${formatNumber(shelf.saldo.unidades)} un. · ${formatNumber(itens)} ${itens === 1 ? "item" : "itens"} sem caixa registrada`;
}

/** O saldo da prateleira que não tem caixa registrada: produto e quantidade. */
export function SaldoSemCaixa({ shelf, skuIndex }: { shelf: Shelf; skuIndex: SkuIndex }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">Saldo sem caixa registrada</span>
        <span className="text-xs text-muted-foreground">{formatNumber(shelf.saldo.unidades)} un.</span>
      </div>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {shelf.saldo.itens.map((item) => {
          const info = skuIndex.get(item.sku.toUpperCase());
          const nome = info?.name || item.sku;
          const codigo = info?.clientCode || item.sku;
          return (
            <li key={item.sku} className="truncate">
              {formatNumber(item.qty)} × {nome}
              {codigo !== nome ? ` · ${codigo}` : ""}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Uma caixa da prateleira: código, conteúdo, origem e data, medidas e a
 * etiqueta (parte 6 do recebimento com caixas). A reservada é a caixa do
 * recebimento com o destino confirmado, ainda por guardar. A guardada diz se
 * está "aberta" (já saiu peça dela) ou "guardada", e a aberta mostra o saldo
 * e de quando ele é, sem o peso de entrada (separação com caixas, parte 3;
 * docs/mockups/WmsSepararMapa.dc.html).
 */
export function BoxCard({
  box,
  lines,
  skuIndex,
  reserved = false,
  onLabels,
}: {
  box: WarehouseBox;
  lines: BoxContentSource[];
  skuIndex: SkuIndex;
  reserved?: boolean;
  onLabels: (url: string) => void;
}) {
  const contents = boxContents(box, lines, skuIndex);
  const units = reserved ? (box.draft_unit_count ?? 0) : boxBalanceUnits(box);
  const aberta = !reserved && estadoDaCaixa(box) === "aberta";
  return (
    <div className={cn("rounded-md border border-border bg-card p-3", reserved && "border-dashed")}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{reserved ? box.code : `${box.code} · ${estadoDaCaixa(box)}`}</span>
          {reserved ? (
            <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
              reservada
            </Badge>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">{formatNumber(units)} un.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => onLabels(labelsUrl({ boxes: [box.code] }))}>
            <Printer className="size-4" />
            Etiqueta
          </Button>
        </span>
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
        {[
          boxOriginLabel(box),
          reserved ? null : dataDaCaixa(box.stored_at),
          aberta && dataDaCaixa(box.balance_at) ? `saldo em ${dataDaCaixa(box.balance_at)}` : null,
          formatBoxDimensions(aberta ? { ...box, gross_weight_kg: null } : box),
          formatVolumeM3(boxVolumeM3(box)),
        ]
          .filter(Boolean)
          .join(" · ")}
        {box.support_box_code ? ` · sobre ${box.support_box_code}` : ""}
      </div>
    </div>
  );
}

/** "Saíram desta prateleira": as caixas que as separações esvaziaram, a mais recente primeiro. */
export function SaidasDaPrateleira({ shelf }: { shelf: Pick<Shelf, "saidas"> }) {
  if (!shelf.saidas.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-foreground">Saíram desta prateleira</h3>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {shelf.saidas.map((box) => (
          <li key={box.code}>
            <b className="font-semibold text-foreground">{box.code}</b> · {textoDaSaida(box)}
          </li>
        ))}
      </ul>
    </div>
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
  // A caixa do recebimento com o destino confirmado, ainda por guardar (parte 6).
  const reserved = shelf.volumeBoxes.filter((box) => box.status === "committing");
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
      <ShelfVolumeSummary title="Volume da prateleira" position={position} boxes={shelf.volumeBoxes} unconfirmed={shelf.boxes.length === 0} />
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
          <dd className="mt-1 font-medium text-foreground">{shelf.boxes.length && shelf.volume.pendingCount === 0 ? formatMeters(shelf.free_front_m) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Referência na base</dt>
          <dd className="mt-1 font-medium text-foreground">{shelf.boxes.length && shelf.volume.pendingCount === 0 ? `${formatNumber(shelf.remaining_reference_boxes)} caixa(s)` : "—"}</dd>
          <dd className="mt-1 text-xs text-muted-foreground">{formatBoxDimensions(REFERENCE_BOX)} · por frente e peso</dd>
        </div>
      </dl>
      {position.notes ? <p className="text-xs text-muted-foreground">{position.notes}</p> : null}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground">Caixas nesta prateleira</h3>
          {shelf.boxes.length > 0 ? <span className="text-xs text-muted-foreground">{formatNumber(visibleBoxes.length)} de {formatNumber(shelf.boxes.length)}</span> : null}
        </div>
        {shelf.boxes.length === 0 && shelf.saldo.unidades > 0 ? (
          <SaldoSemCaixa shelf={shelf} skuIndex={skuIndex} />
        ) : shelf.boxes.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">Sem caixas registradas. Ocupação não confirmada.</div>
        ) : (
          <div className="space-y-2">
            {visibleBoxes.map((box) => (
              <BoxCard key={box.code} box={box} lines={lines} skuIndex={skuIndex} onLabels={onLabels} />
            ))}
            {shelf.boxes.length > 3 ? (
              <Button type="button" variant="outline" className="w-full" onClick={() => setShowAllBoxes((current) => !current)}>
                {showAllBoxes ? "Mostrar menos caixas" : `Ver todas as ${formatNumber(shelf.boxes.length)} caixas`}
              </Button>
            ) : null}
          </div>
        )}
        {reserved.length ? (
          <div className="mt-2 space-y-2">
            {reserved.map((box) => (
              <BoxCard key={box.code} box={box} lines={lines} skuIndex={skuIndex} reserved onLabels={onLabels} />
            ))}
          </div>
        ) : null}
      </div>
      <SaidasDaPrateleira shelf={shelf} />
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
