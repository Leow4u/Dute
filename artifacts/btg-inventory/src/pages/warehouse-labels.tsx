/**
 * Estoque › Etiquetas: as etiquetas de caixa e de posição prontas para
 * imprimir (docs/mapa-do-armazem-enderecamento-dirigido.md, seção 6).
 *
 * Chega aqui pela Contagem (uma caixa, ou todas da sessão) e por Posições
 * (as posições filtradas), com os códigos na URL. Dez por folha A4 ou uma
 * por etiqueta (rolo da Zebra pelo driver). A impressão é a do navegador.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer, Tags } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";

import { LabelSheet } from "@/components/labels/label-sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpeningInventorySession } from "@/features/warehouse-ops/opening-inventory-status";
import { normalizeApiRows } from "@/features/warehouse-ops/receiving";
import { sessionBoxes, warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import {
  type LabelData,
  type LabelMode,
  LABELS_PER_SHEET,
  boxLabel,
  labelsUrl,
  paginate,
  parseLabelsQuery,
  positionLabel,
} from "@/lib/warehouse-labels";
import { fetchJson, formatNumber, getErrorMessage } from "@/lib/warehouse-ops/model";
import { type WarehousePosition, sortPositions } from "@/lib/warehouse-positions";

const CUSTOMER = "BTG Pactual";
type PositionsResponse = { items?: WarehousePosition[] };

export default function WarehouseLabelsPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const query = useMemo(() => parseLabelsQuery(search), [search]);
  const wantsBoxes = query.session || query.boxes.length > 0;
  const wantsPositions = query.positions.length > 0;

  const boxesQuery = useQuery({
    queryKey: ["warehouse-boxes", CUSTOMER],
    enabled: wantsBoxes,
    staleTime: 10_000,
    queryFn: async () =>
      normalizeApiRows(
        await fetchJson<unknown>(`/api/warehouse/boxes?customer_code=${encodeURIComponent(CUSTOMER)}&limit=1000`),
      ).map(warehouseBoxFromRecord),
  });
  const sessionQuery = useOpeningInventorySession();
  // Mesma chave e mesmo formato da tela de Posições, para o cache servir às duas.
  const positionsQuery = useQuery<PositionsResponse>({
    queryKey: ["warehouse-positions"],
    enabled: wantsPositions,
    staleTime: 30_000,
    queryFn: () => fetchJson<PositionsResponse>("/api/warehouse/positions?limit=2000"),
  });

  const boxes = useMemo(() => {
    if (!wantsBoxes) return [];
    const all = boxesQuery.data ?? [];
    const chosen = query.session
      ? sessionBoxes(all, sessionQuery.data?.session_id)
      : query.boxes.flatMap((code) => all.filter((box) => box.code === code));
    // Da mais antiga para a mais nova: a ordem em que foram guardadas.
    return [...chosen].sort((left, right) => left.code.localeCompare(right.code));
  }, [boxesQuery.data, query.boxes, query.session, sessionQuery.data?.session_id, wantsBoxes]);

  const positions = useMemo(() => {
    if (!wantsPositions) return [];
    const byCode = new Map((positionsQuery.data?.items ?? []).map((position) => [position.code.toUpperCase(), position]));
    return sortPositions(query.positions.flatMap((code) => byCode.get(code) ?? []));
  }, [positionsQuery.data, query.positions, wantsPositions]);

  const labels = useMemo<LabelData[]>(() => {
    const lines = sessionQuery.data?.lines ?? [];
    return [...boxes.map((box) => boxLabel(box, lines)), ...positions.map(positionLabel)];
  }, [boxes, positions, sessionQuery.data?.lines]);

  const missingBoxes = wantsBoxes && boxesQuery.isSuccess ? query.boxes.filter((code) => !boxes.some((box) => box.code === code)) : [];
  const missingPositions =
    wantsPositions && positionsQuery.isSuccess ? query.positions.filter((code) => !positions.some((position) => position.code.toUpperCase() === code)) : [];

  const sheets = query.mode === "zebra" ? labels.map((label) => [label]) : paginate(labels, LABELS_PER_SHEET, query.skip);
  const loading = (wantsBoxes && (boxesQuery.isLoading || sessionQuery.isLoading)) || (wantsPositions && positionsQuery.isLoading);
  const error = (wantsBoxes && (boxesQuery.error ?? sessionQuery.error)) || (wantsPositions && positionsQuery.error) || null;
  const backHref = wantsPositions && !wantsBoxes ? "/estoque/posicoes" : "/wms/contagem";

  const update = (changes: { mode?: LabelMode; skip?: number }) =>
    navigate(labelsUrl({ ...query, ...changes }), { replace: true });

  return (
    <div className="flex flex-col gap-6">
      <div className="no-print flex flex-col gap-4">
        <Link href={backHref} className="inline-flex w-fit items-center gap-2 text-sm text-primary">
          <ArrowLeft className="size-4" />
          {backHref === "/estoque/posicoes" ? "Posições" : "Contagem"}
        </Link>
        <PageHeader
          title="Etiquetas"
          description="Etiqueta de 101,6 × 50,8 mm, dez por folha A4 ou uma por etiqueta no rolo da Zebra. Imprimir / Salvar PDF usa a impressão do navegador."
          actions={
            <Button onClick={() => window.print()} disabled={loading || labels.length === 0}>
              <Printer className="size-4" />
              Imprimir / Salvar PDF
            </Button>
          }
        >
          <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4">
            <div className="flex min-w-48 flex-col gap-1">
              <Label htmlFor="labels-mode">Saída</Label>
              <Select value={query.mode} onValueChange={(value) => update({ mode: value === "zebra" ? "zebra" : "a4", skip: 0 })}>
                <SelectTrigger id="labels-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a4">Folha A4, dez por folha</SelectItem>
                  <SelectItem value="zebra">Uma por etiqueta (rolo Zebra)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {query.mode === "a4" ? (
              <div className="flex w-40 flex-col gap-1">
                <Label htmlFor="labels-skip">Pular etiquetas usadas</Label>
                <Input
                  id="labels-skip"
                  type="number"
                  min={0}
                  max={LABELS_PER_SHEET - 1}
                  value={query.skip}
                  onChange={(event) => update({ skip: Number(event.target.value) || 0 })}
                />
              </div>
            ) : null}
            <div className="text-sm text-muted-foreground">
              {formatNumber(labels.length)} etiqueta(s)
              {query.mode === "a4" ? ` · ${formatNumber(sheets.length)} folha(s)` : ""}
              {boxes.length ? ` · ${formatNumber(boxes.length)} caixa(s)` : ""}
              {positions.length ? ` · ${formatNumber(positions.length)} posição(ões)` : ""}
            </div>
          </div>
        </PageHeader>

        {missingBoxes.length || missingPositions.length ? (
          <Alert className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
            <AlertTitle>Alguns códigos não foram encontrados</AlertTitle>
            <AlertDescription>
              {[...missingBoxes, ...missingPositions].join(", ")}. Confira se a caixa ou a posição ainda existe.
            </AlertDescription>
          </Alert>
        ) : null}
        {boxes.length && !sessionQuery.data?.lines?.length ? (
          <Alert className="border-border bg-card">
            <AlertTitle>Conteúdo da caixa</AlertTitle>
            <AlertDescription>
              A etiqueta lista os produtos lançados na caixa durante a abertura. Imprima depois de lançar o conteúdo, para a etiqueta sair completa.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive" className="no-print">
          <AlertTitle>Não foi possível montar as etiquetas</AlertTitle>
          <AlertDescription>{getErrorMessage(error)}</AlertDescription>
        </Alert>
      ) : loading ? (
        <Skeleton className="no-print h-96 w-full rounded-lg" />
      ) : !wantsBoxes && !wantsPositions ? (
        <Empty className="no-print min-h-72 rounded-lg border border-dashed border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Tags className="size-5" />
            </EmptyMedia>
            <EmptyTitle>Nenhuma etiqueta pedida</EmptyTitle>
            <EmptyDescription>
              Abra as etiquetas pela Contagem (caixa aberta ou caixas da sessão) ou por Posições (botão Imprimir etiquetas).
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : labels.length === 0 ? (
        <Empty className="no-print min-h-72 rounded-lg border border-dashed border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Tags className="size-5" />
            </EmptyMedia>
            <EmptyTitle>Nada para imprimir</EmptyTitle>
            <EmptyDescription>
              {query.session ? "A sessão de abertura ainda não tem caixa guardada." : "Os códigos pedidos não existem mais."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-muted p-4">
          <LabelSheet sheets={sheets} mode={query.mode} />
        </div>
      )}
    </div>
  );
}
