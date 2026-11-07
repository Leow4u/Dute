/**
 * Estoque › Etiquetas: as etiquetas de caixa e de posição prontas para
 * imprimir (docs/mapa-do-armazem-enderecamento-dirigido.md, seção 6).
 *
 * Chega aqui pela Contagem (uma caixa, ou todas da sessão), por Posições
 * (as posições filtradas), pelo Mapa e pelo Receber (as caixas de uma
 * chegada, parte 6 do recebimento com caixas), com os códigos na URL. Dez por
 * folha A4 ou uma por etiqueta (rolo da Zebra pelo driver). A impressão é a
 * do navegador.
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
  boxLabelAvailability,
  labelsUrl,
  paginate,
  parseLabelsQuery,
  positionLabel,
} from "@/lib/warehouse-labels";
import { fetchJson, formatNumber, getErrorMessage } from "@/lib/warehouse-ops/model";
import { type WarehousePosition, sortPositions } from "@/lib/warehouse-positions";
import { useActiveCustomer } from "@/lib/active-customer-context";

type PositionsResponse = { items?: WarehousePosition[] };

export default function WarehouseLabelsPage() {
  // Caixas e conteúdo do cliente ativo (o mesmo da Contagem que abriu a página).
  const { code: customerCode } = useActiveCustomer();
  const search = useSearch();
  const [, navigate] = useLocation();
  const query = useMemo(() => parseLabelsQuery(search), [search]);
  const wantsBoxes = query.session || query.boxes.length > 0;
  const wantsPositions = query.positions.length > 0;

  const boxesQuery = useQuery({
    queryKey: ["warehouse-boxes", customerCode],
    enabled: wantsBoxes,
    staleTime: 10_000,
    queryFn: async () =>
      normalizeApiRows(
        await fetchJson<unknown>(`/api/warehouse/boxes?customer_code=${encodeURIComponent(customerCode)}&limit=1000`),
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

  const chosen = useMemo(() => {
    if (!wantsBoxes) return [];
    const all = boxesQuery.data ?? [];
    const picked = query.session
      ? sessionBoxes(all, sessionQuery.data?.session_id).filter((box) => box.status === "stored")
      : query.boxes.flatMap((code) => all.filter((box) => box.code === code));
    // Da mais antiga para a mais nova: a ordem em que foram guardadas.
    return [...picked].sort((left, right) => left.code.localeCompare(right.code));
  }, [boxesQuery.data, query.boxes, query.session, sessionQuery.data?.session_id, wantsBoxes]);
  // A etiqueta sai da caixa guardada ou com o destino confirmado (parte 6); as outras ficam nomeadas no aviso.
  const boxes = useMemo(() => chosen.filter((box) => boxLabelAvailability(box).ready), [chosen]);
  const heldBack = useMemo(() => chosen.flatMap((box) => boxLabelAvailability(box).reason ?? []), [chosen]);
  // A caixa da abertura lê o conteúdo da sessão; a do recebimento traz o dela.
  const needsSession = boxes.some((box) => box.lines.length === 0);
  const invoice = chosen.find((box) => box.origin.invoice_number)?.origin.invoice_number ?? null;

  const positions = useMemo(() => {
    if (!wantsPositions) return [];
    const byCode = new Map((positionsQuery.data?.items ?? []).map((position) => [position.code.toUpperCase(), position]));
    return sortPositions(query.positions.flatMap((code) => byCode.get(code) ?? []));
  }, [positionsQuery.data, query.positions, wantsPositions]);

  const labels = useMemo<LabelData[]>(() => {
    const lines = sessionQuery.data?.lines ?? [];
    return [...boxes.map((box) => boxLabel(box, lines)), ...positions.map(positionLabel)];
  }, [boxes, positions, sessionQuery.data?.lines]);

  const missingBoxes = wantsBoxes && boxesQuery.isSuccess ? query.boxes.filter((code) => !chosen.some((box) => box.code === code)) : [];
  const missingPositions =
    wantsPositions && positionsQuery.isSuccess ? query.positions.filter((code) => !positions.some((position) => position.code.toUpperCase() === code)) : [];

  const sheets = query.mode === "zebra" ? labels.map((label) => [label]) : paginate(labels, LABELS_PER_SHEET, query.skip);
  const loading = (wantsBoxes && (boxesQuery.isLoading || (needsSession && sessionQuery.isLoading))) || (wantsPositions && positionsQuery.isLoading);
  const error =
    (wantsBoxes && (boxesQuery.error ?? (needsSession ? sessionQuery.error : null))) || (wantsPositions && positionsQuery.error) || null;
  const back = query.receipt
    ? { href: "/wms/receber", label: "Receber" }
    : wantsPositions && !wantsBoxes
      ? { href: "/estoque/posicoes", label: "Posições" }
      : { href: "/wms/contagem", label: "Contagem" };
  const description = query.receipt
    ? [`Chegada ${query.receipt}`, invoice ? `NF ${invoice}` : null, customerCode].filter(Boolean).join(" · ")
    : "Etiqueta de 101,6 × 50,8 mm, dez por folha A4 ou uma por etiqueta no rolo da Zebra. Imprimir / Salvar PDF usa a impressão do navegador.";

  const update = (changes: { mode?: LabelMode; skip?: number }) =>
    navigate(labelsUrl({ ...query, ...changes }), { replace: true });

  return (
    <div className="flex flex-col gap-6">
      <div className="no-print flex flex-col gap-4">
        <Link href={back.href} className="inline-flex w-fit items-center gap-2 text-sm text-primary">
          <ArrowLeft className="size-4" />
          {back.label}
        </Link>
        <PageHeader
          title="Etiquetas"
          description={description}
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
            <AlertTitle>Algumas etiquetas não estão disponíveis</AlertTitle>
            <AlertDescription>
              {[...missingBoxes, ...missingPositions].join(", ")}. Confira se a posição existe e se a caixa já foi guardada.
            </AlertDescription>
          </Alert>
        ) : null}
        {heldBack.length ? (
          <Alert className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
            <AlertTitle>Caixas ainda sem etiqueta</AlertTitle>
            <AlertDescription>{heldBack.join(" ")}</AlertDescription>
          </Alert>
        ) : null}
        {needsSession && !sessionQuery.data?.lines?.length ? (
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
              {query.session ? "A sessão de abertura ainda não tem caixa guardada." : "Os códigos pedidos não existem ou as caixas ainda aguardam a guarda."}
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
