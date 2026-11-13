/**
 * Estoque › Etiquetas: as etiquetas de caixa, de posição e de volume prontas
 * para imprimir (docs/mapa-do-armazem-enderecamento-dirigido.md, seção 6).
 *
 * Chega aqui pela Contagem (uma caixa, ou todas da sessão), por Posições
 * (as posições filtradas), pelo Mapa e pelo Receber (as caixas de uma
 * chegada, parte 6 do recebimento com caixas), com os códigos na URL. A
 * impressão é a do navegador.
 *
 * Duas saídas (decisões de 11 e 12/11/2026, docs/mockups/EtiquetaA4Tela.dc.html):
 * "Folha A4", a padrão, em papel comum (a caixa e o volume quatro por folha
 * deitada, a posição dez por folha em pé, com as linhas de corte), e "Rolo
 * Zebra", uma por etiqueta. A escolha fica guardada no computador: a mesa da
 * Zebra abre no rolo. A prévia encolhe para caber na largura; a impressão
 * sai em tamanho real.
 *
 * As etiquetas dos volumes de um pedido (separação com caixas, parte 4c)
 * também saem daqui: `?pedido=` com `volumes=12` (o volume que acabou de
 * fechar, sem o total) ou `volumes=todos` (o lote, com "de 42" depois de
 * concluir). As caixas que o pedido abriu chegam com o pedido junto
 * (`?caixas=…&pedido=`), para a volta ser ao pedido.
 */

import { useLayoutEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Printer, Tags } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";

import { LabelSheet } from "@/components/labels/label-sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpeningInventorySession } from "@/features/warehouse-ops/opening-inventory-status";
import { useToast } from "@/hooks/use-toast";
import { normalizeApiRows } from "@/features/warehouse-ops/receiving";
import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { falhaDasLeituras } from "@/lib/carregando/falha-das-leituras";
import { sessionBoxes, warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import {
  type LabelData,
  type LabelMode,
  type LabelPage,
  BOX_SHEET_MM,
  LABEL_MM,
  SHEET_MM,
  boxLabels,
  boxLabelAvailability,
  guardarSaida,
  impressoesParaRegistrar,
  labelPages,
  saldosParaRegistrar,
  labelsUrl,
  type ImpressaoParaRegistrar,
  parseLabelsQuery,
  positionLabel,
  saidaDaTela,
  saidaGuardada,
  textoDaImpressao,
  volumeLabels,
  zoomDaPrevia,
} from "@/lib/warehouse-labels";
import { fetchJson, getErrorMessage } from "@/lib/warehouse-ops/model";
import { hrefDaBancada } from "@/lib/warehouse-ops/separacao";
import { useVolumesDoPedido } from "@/lib/warehouse-ops/use-volumes-do-pedido";
import { nomeDoVolume } from "@/lib/warehouse-ops/volumes-do-pedido";
import { type WarehousePosition, sortPositions } from "@/lib/warehouse-positions";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { registrarEtiquetaImpressa } from "@/lib/wms/caixas-do-recebimento";
import { registrarEtiquetaDeSaldo } from "@/lib/wms/separacao";

type PositionsResponse = { items?: WarehousePosition[] };

/** A largura da página mais larga da impressão, em milímetros: a folha deitada, a em pé ou a etiqueta do rolo. */
function larguraDaPagina(mode: LabelMode, pages: LabelPage[]) {
  if (mode === "zebra") return LABEL_MM.width;
  return pages.some((page) => page.kind === "quatro") ? BOX_SHEET_MM.width : SHEET_MM.width;
}

/**
 * Quanto a prévia encolhe para a folha caber na largura da área, sem rolar
 * para o lado (zoomDaPrevia); nunca aumenta. A impressão ignora (labelSheetCss).
 */
function useAjusteDaPrevia(larguraMm: number) {
  // A área só aparece depois de carregar: o ref de função mede quando ela entra.
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  // Antes de pintar: a prévia já aparece no tamanho certo, também ao trocar a saída.
  useLayoutEffect(() => {
    if (!area || typeof ResizeObserver === "undefined") return;
    const medir = () => {
      const estilo = window.getComputedStyle(area);
      const livre = area.clientWidth - (parseFloat(estilo.paddingLeft) || 0) - (parseFloat(estilo.paddingRight) || 0);
      setZoom((atual) => zoomDaPrevia(atual, livre, larguraMm));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(area);
    return () => observador.disconnect();
  }, [area, larguraMm]);
  return { ref: setArea, zoom };
}

/** O resumo da impressão ("12 etiquetas · 3 folhas"): o foco vai a ele quando o aviso da falha sai com ele. */
const ID_DO_RESUMO = "etiquetas-resumo";

export default function WarehouseLabelsPage() {
  // Caixas e conteúdo do cliente ativo (o mesmo da Contagem que abriu a página).
  const { code: customerCode, options: customers } = useActiveCustomer();
  const search = useSearch();
  const [, navigate] = useLocation();
  const query = useMemo(() => parseLabelsQuery(search), [search]);
  // A saída guardada neste computador vale quando o endereço não diz qual.
  const [guardada, setGuardada] = useState<LabelMode | null>(() => saidaGuardada());
  const mode = saidaDaTela(query, guardada);
  const wantsBoxes = query.session || query.boxes.length > 0;
  const wantsPositions = query.positions.length > 0;
  // O pedido de onde a pessoa veio: os volumes dele, e a volta a ele. Lido pelo pedido, não pelo cliente ativo.
  const fromOrder = Boolean(query.order);
  const wantsVolumes = fromOrder && (query.volumes === "all" || query.volumes.length > 0);
  const orderVolumes = useVolumesDoPedido(fromOrder ? query.order : null);

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

  // Os volumes pedidos, entre os fechados do pedido; o total só entra com o pedido concluído (decisão 12).
  const volumes = useMemo(
    () => (query.volumes === "all" ? orderVolumes.volumes : orderVolumes.volumes.filter((volume) => (query.volumes as number[]).includes(volume.numero))),
    [orderVolumes.volumes, query.volumes],
  );
  const order = orderVolumes.pedido;
  const orderCustomer = order ? customers.find((customer) => customer.code === order.clienteCodigo)?.name || order.clienteCodigo : "";

  const labels = useMemo<LabelData[]>(() => {
    const lines = sessionQuery.data?.lines ?? [];
    // Quantos produtos cada etiqueta leva depende da saída: na folha, cinco em cada; no rolo, cinco e onze.
    return [
      ...boxes.flatMap((box) => boxLabels(box, lines, { mode })),
      ...positions.map(positionLabel),
      ...(order
        ? volumes.flatMap((volume) =>
            volumeLabels(
              volume,
              { number: order.numero, customer: orderCustomer, destination: order.destino, total: order.concluido ? orderVolumes.volumes.length : null },
              { mode },
            ),
          )
        : []),
    ];
  }, [boxes, positions, sessionQuery.data?.lines, volumes, order, orderCustomer, orderVolumes.volumes.length, mode]);

  const missingBoxes = wantsBoxes && boxesQuery.isSuccess ? query.boxes.filter((code) => !chosen.some((box) => box.code === code)) : [];
  const missingPositions =
    wantsPositions && positionsQuery.isSuccess ? query.positions.filter((code) => !positions.some((position) => position.code.toUpperCase() === code)) : [];

  // O volume pedido que o pedido não tem fechado: ainda aberto, ou de outro número.
  const missingVolumes =
    wantsVolumes && orderVolumes.estado === "pronto" && query.volumes !== "all"
      ? query.volumes.filter((number) => !volumes.some((volume) => volume.numero === number)).map((number) => nomeDoVolume(number))
      : [];

  const pages = useMemo(() => labelPages(labels, mode), [labels, mode]);
  const previa = useAjusteDaPrevia(larguraDaPagina(mode, pages));
  // A leitura que falhou sem nada lido fica na tela enquanto tenta de novo (as cópias): o aviso e o "Tentar de novo" não
  // somem com o foco nele, e a falta de conexão fica "Sem conexão." ou "Reconectando…", nunca o erro genérico. A
  // releitura que falha (depois de registrar a impressão) não tira a prévia (carregamento v2, parte 13b).
  const caixasLidas = useLeituraComFalha(boxesQuery);
  const sessaoLida = useLeituraComFalha(sessionQuery);
  const posicoesLidas = useLeituraComFalha(positionsQuery);
  const loading =
    (wantsBoxes && (caixasLidas.isLoading || (needsSession && sessaoLida.isLoading))) ||
    (wantsPositions && posicoesLidas.isLoading) ||
    (fromOrder && orderVolumes.estado === "carregando");
  const falhaDaLeitura = falhaDasLeituras([
    ...(wantsBoxes ? [[boxesQuery, caixasLidas] as const] : []),
    ...(wantsBoxes && needsSession ? [[sessionQuery, sessaoLida] as const] : []),
    ...(wantsPositions ? [[positionsQuery, posicoesLidas] as const] : []),
  ]);
  const falhouNaLeitura = falhaDaLeitura !== null;
  const error =
    (wantsVolumes && orderVolumes.estado === "erro" ? new Error("Não foi possível carregar os volumes do pedido.") : null) ||
    (wantsVolumes && orderVolumes.estado === "nao_encontrado" ? new Error("Pedido não encontrado.") : null) ||
    null;
  const back = fromOrder
    ? // De volta ao pedido: a bancada, ou o pedido já separado.
      { href: query.order ? hrefDaBancada(query.order) : "/pedidos", label: order?.numero || "Pedidos" }
    : query.receipt
      ? { href: "/wms/receber", label: "Receber" }
      : wantsPositions && !wantsBoxes
        ? { href: "/estoque/posicoes", label: "Posições" }
        : { href: "/wms/contagem", label: "Contagem" };
  // Só o que identifica a impressão (o pedido ou a chegada); sem frase de explicação (v3: rótulos, dados e ações).
  const description =
    fromOrder && order
      ? [order.numero, orderCustomer, order.destino].filter(Boolean).join(" · ")
      : query.receipt
        ? [`Chegada ${query.receipt}`, invoice ? `NF ${invoice}` : null, customerCode].filter(Boolean).join(" · ")
        : undefined;

  const escolherSaida = (proxima: LabelMode) => {
    guardarSaida(proxima);
    setGuardada(proxima);
    navigate(labelsUrl({ ...query, mode: proxima }), { replace: true });
  };

  // A impressão é a do navegador; o registro é o do clique (decisão 29), só da caixa do recebimento.
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const registrar = useMutation({
    mutationFn: (impressoes: ImpressaoParaRegistrar[]) =>
      Promise.all(
        impressoes.map((impressao) =>
          registrarEtiquetaImpressa({ ...impressao, customer_code: customerCode || undefined, idempotency_key: crypto.randomUUID() }),
        ),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["warehouse-boxes"] });
      void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
    },
    onError: (error) =>
      toast({ title: "Não foi possível registrar a impressão", description: getErrorMessage(error), variant: "destructive" }),
  });
  // A caixa aberta sai com o saldo: a impressão registrada tira a caixa de "Etiquetas para trocar" (separação com caixas, parte 3d).
  const registrarSaldo = useMutation({
    mutationFn: (box_codes: string[]) => registrarEtiquetaDeSaldo({ box_codes, idempotency_key: crypto.randomUUID() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["warehouse-boxes"] });
    },
    onError: (error) =>
      toast({ title: "Não foi possível registrar a impressão", description: getErrorMessage(error), variant: "destructive" }),
  });
  const imprimir = () => {
    window.print();
    const impressoes = impressoesParaRegistrar(boxes);
    if (impressoes.length) registrar.mutate(impressoes);
    const saldos = saldosParaRegistrar(boxes);
    if (saldos.length) registrarSaldo.mutate(saldos);
  };

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
            <Button onClick={imprimir} disabled={loading || labels.length === 0}>
              <Printer className="size-4" />
              Imprimir / Salvar PDF
            </Button>
          }
        >
          <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4">
            <div className="flex min-w-60 flex-col gap-1">
              <Label htmlFor="labels-mode">Saída</Label>
              <Select value={mode} onValueChange={(value) => escolherSaida(value === "zebra" ? "zebra" : "a4")}>
                <SelectTrigger id="labels-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a4">Folha A4</SelectItem>
                  <SelectItem value="zebra">Rolo Zebra</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* A contagem só depois de ler: nunca "0 etiquetas · 0 folhas" antes (parte 13b). */}
            {/* O resumo recebe o foco quando o aviso da falha sai com ele, depois da nova tentativa que deu certo. */}
            <div id={ID_DO_RESUMO} tabIndex={-1} className="text-sm text-muted-foreground">
              {loading || falhouNaLeitura
                ? null
                : textoDaImpressao({ etiquetas: labels.length, folhas: pages.length, caixas: boxes.length, posicoes: positions.length, volumes: volumes.length, mode })}
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
        {missingVolumes.length ? (
          <Alert className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
            <AlertTitle>Volumes ainda sem etiqueta</AlertTitle>
            <AlertDescription>{missingVolumes.join(", ")}. A etiqueta sai do volume fechado.</AlertDescription>
          </Alert>
        ) : null}
        {/* Só com a sessão lida: antes dela (ou com ela falhando), a nota diria que a caixa está vazia sem ter lido (parte 13b). */}
        {needsSession && sessaoLida.data !== undefined && !sessaoLida.data.lines?.length ? (
          <Alert className="border-border bg-card">
            <AlertTitle>Conteúdo da caixa</AlertTitle>
            <AlertDescription>
              A etiqueta lista os produtos lançados na caixa durante a abertura. Imprima depois de lançar o conteúdo, para a etiqueta sair completa.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      {falhaDaLeitura ? (
        // "Tentando de novo…" só na nova tentativa que a pessoa pede; sem rede, "Sem conexão." ou "Reconectando…".
        <FalhaNaLeitura
          className="no-print"
          leitura={falhaDaLeitura.leitura}
          erro={falhaDaLeitura.erro}
          mensagem="Não consegui carregar as etiquetas."
          focoAoSair={ID_DO_RESUMO}
        />
      ) : error ? (
        <Alert variant="destructive" className="no-print">
          <AlertTitle>Não foi possível montar as etiquetas</AlertTitle>
          <AlertDescription>{getErrorMessage(error)}</AlertDescription>
        </Alert>
      ) : loading ? (
        // O esqueleto da prévia e, aos 300 ms, a caixa com o rótulo e o anúncio (carregamento v2, parte 13b).
        <div className="no-print flex flex-col gap-3">
          <CarregandoNaRegiao rotulo="Carregando etiquetas…" />
          <Skeleton className="h-96 w-full rounded-lg" />
        </div>
      ) : !wantsBoxes && !wantsPositions && !wantsVolumes ? (
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
              {wantsVolumes
                ? "O pedido ainda não tem volume fechado."
                : query.session
                  ? "A sessão de abertura ainda não tem caixa guardada."
                  : "Os códigos pedidos não existem ou as caixas ainda aguardam a guarda."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div ref={previa.ref} className="overflow-x-auto rounded-lg border border-border bg-muted p-4">
          <div className="lbl-ajuste" style={{ zoom: previa.zoom }}>
            <LabelSheet pages={pages} mode={mode} />
          </div>
        </div>
      )}
    </div>
  );
}
