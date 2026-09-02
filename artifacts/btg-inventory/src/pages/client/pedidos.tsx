import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ClipboardList,
  PackageCheck,
  PackageOpen,
  Truck,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import {
  ClientDataBoundary,
  ClientModuleShell,
  EmptyModuleState,
  MetricCard,
  ModulePanel,
  StatusBadge,
  firstText,
  formatDate,
  formatNumber,
  getDocuments,
  getOrders,
  getPackages,
  getRequests,
  getShipments,
  normalizeSlug,
  optionalNumber,
  orderDate,
  orderProduct,
  orderReference,
  requestDate,
  requestItems,
  requestQuantityTotal,
  requestReference,
  requestTitle,
  sortByDateDesc,
  type ClientOverview,
  type ClientRequest,
  type DeliveryProof,
  type Order,
  type PackageRecord,
  type ShipmentRecord,
} from "./shared";

type UnknownRecord = Record<string, unknown>;

type OrderWithTracking = Order & {
  order_id?: string | null;
  destination?: string | null;
  sku?: string | null;
  sku_code?: string | null;
  client_item_code?: string | null;
  cod_cliente?: string | null;
};

type PublishedWmsRecord = {
  source: string;
  record: UnknownRecord;
};

type TrackingState = {
  id: string;
  source: string;
  status: string;
  date?: string;
  count: number;
};

type TrackingEvent = {
  id: string;
  title: string;
  status?: string;
  description?: string;
  source: string;
  date?: string;
};

type TrackingItem = {
  id: string;
  product: string;
  clientCode?: string;
  quantity?: number;
  picked?: number;
};

type TrackingRecord = {
  id: string;
  kind: "order" | "request";
  reference: string;
  title: string;
  status?: string;
  currentStatuses: string[];
  currentStateIds: string[];
  quantity: number;
  lineCount: number;
  date?: string;
  destination?: string;
  states: TrackingState[];
  events: TrackingEvent[];
  items: TrackingItem[];
};

type TrackingGroup = {
  key: string;
  aliases: Set<string>;
  orders: OrderWithTracking[];
  requests: ClientRequest[];
  shipments: ShipmentRecord[];
  packages: PackageRecord[];
  documents: DeliveryProof[];
  wmsRecords: PublishedWmsRecord[];
  publishedEvents: UnknownRecord[];
};

const PENDING_STATUSES = new Set([
  "pendente",
  "pending",
  "planned",
  "open",
  "aberto",
  "submitted",
]);

const IN_PROGRESS_STATUSES = new Set([
  "separacao",
  "picking",
  "in-progress",
  "in_progress",
  "em-execucao",
  "approved",
  "separating",
  "separated",
  "checking",
  "packing",
  "ready",
  "ready-to-pack",
  "ready_to_pack",
  "ready-to-dispatch",
  "ready_to_dispatch",
]);

const SHIPPED_STATUSES = new Set([
  "faturado",
  "entregue",
  "shipped",
  "dispatched",
  "delivered",
  "closed",
]);

const CLOSED_STATUSES = new Set([
  "closed",
  "encerrado",
  "concluido",
  "completed",
  "entregue",
  "delivered",
  "rejected",
  "rejeitado",
  "cancelled",
  "canceled",
  "cancelado",
]);

export function ClientePedidos() {
  const [selectedTrackingId, setSelectedTrackingId] = useState<string | null>(
    null,
  );

  return (
    <ClientDataBoundary>
      {(overview) => {
        const orders = sortByDateDesc(getOrders(overview), orderDate);
        const outboundRequests = sortByDateDesc(
          getRequests(overview).filter(isOutboundRequest),
          requestDate,
        );
        const trackingItems = buildTrackingItems(
          overview,
          orders,
          outboundRequests,
        );
        const selectedTracking =
          trackingItems.find((item) => item.id === selectedTrackingId) ?? null;
        const open = trackingItems.filter(isOpenTracking).length;
        const pending = trackingItems.filter((item) =>
          hasCurrentStatus(item, PENDING_STATUSES),
        ).length;
        const inProgress = trackingItems.filter((item) =>
          hasCurrentStatus(item, IN_PROGRESS_STATUSES),
        ).length;
        const shipped = trackingItems.filter((item) =>
          hasCurrentStatus(item, SHIPPED_STATUSES),
        ).length;

        return (
          <ClientModuleShell
            overview={overview}
            title="Pedidos"
            icon={PackageCheck}
          >
            {trackingItems.length === 0 ? (
              <NoOrdersState />
            ) : selectedTracking ? (
              <TrackingDetail
                item={selectedTracking}
                onBack={() => setSelectedTrackingId(null)}
              />
            ) : (
              <>
                <section className="grid gap-4 md:grid-cols-3">
                  <MetricCard
                    label="Em aberto"
                    value={formatNumber(open)}
                    description={`${formatNumber(pending)} recebido(s) pela Dutelog`}
                    icon={Clock3}
                    tone="neutral"
                  />
                  <MetricCard
                    label="Em preparação"
                    value={formatNumber(inProgress)}
                    description="Separação ou conferência"
                    icon={PackageCheck}
                    tone="info"
                  />
                  <MetricCard
                    label="Enviados"
                    value={formatNumber(shipped)}
                    description="Em rota ou entregues"
                    icon={Truck}
                    tone="success"
                  />
                </section>
                <TrackingList
                  items={trackingItems}
                  onSelect={setSelectedTrackingId}
                />
              </>
            )}
          </ClientModuleShell>
        );
      }}
    </ClientDataBoundary>
  );
}

function NoOrdersState() {
  return (
    <div className="flex min-h-[340px] flex-col items-center justify-center rounded-[24px] border border-dashed border-border bg-white/45 px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-[20px] border border-border bg-white text-muted-foreground">
        <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-lg font-semibold text-foreground">
        Nenhum pedido em acompanhamento
      </h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
        Os pedidos são montados no Estoque. Depois do envio, o acompanhamento completo aparece nesta página.
      </p>
      <Button asChild variant="secondary" className="mt-6 rounded-2xl">
        <Link href="/portal/estoque">
          <PackageOpen className="h-4 w-4" />
          Ir para o estoque
        </Link>
      </Button>
    </div>
  );
}

function TrackingList({
  items,
  onSelect,
}: {
  items: TrackingRecord[];
  onSelect: (id: string) => void;
}) {
  return (
    <ModulePanel
      title="Acompanhamento dos pedidos"
      description="Selecione um pedido para ver itens e atualizações"
      icon={ClipboardList}
    >
      {items.length > 0 ? (
        <div className="overflow-auto rounded-2xl border border-border bg-white/35">
          <Table className="min-w-[900px]">
            <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur-[24px]">
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Resumo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Linhas</TableHead>
                <TableHead className="text-right">Unidades</TableHead>
                <TableHead>Atualização</TableHead>
                <TableHead className="w-[72px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => onSelect(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(item.id);
                    }
                  }}
                >
                  <TableCell className="font-medium text-foreground">
                    {item.reference}
                  </TableCell>
                  <TableCell className="max-w-[360px] truncate">
                    {item.title}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={statusText(item.status)} />
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(item.lineCount)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(item.quantity)}
                  </TableCell>
                  <TableCell>{formatDate(item.date)}</TableCell>
                  <TableCell className="text-right">
                    <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <NoOrdersState />
      )}
    </ModulePanel>
  );
}

function TrackingDetail({
  item,
  onBack,
}: {
  item: TrackingRecord;
  onBack: () => void;
}) {
  return (
    <ModulePanel
      title={`Pedido ${item.reference}`}
      description="Itens, destino e atualizações publicadas pela Dutelog"
      icon={Truck}
    >
      <div className="space-y-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="cursor-pointer rounded-full px-3 text-muted-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para pedidos
        </Button>

        <div className="grid gap-4 md:grid-cols-4">
          <DetailFact
            label="Pedido"
            value={item.reference}
            icon={ClipboardList}
          />
          <DetailFact
            label="Status"
            value={statusText(item.status)}
            icon={Clock3}
          />
          <DetailFact
            label="Itens"
            value={`${formatNumber(item.lineCount)} linha(s) / ${formatNumber(item.quantity)} un.`}
            icon={PackageOpen}
          />
          <DetailFact
            label="Destino"
            value={item.destination ?? "Destino aguardando confirmação"}
            icon={Truck}
          />
        </div>

        <div className="rounded-[24px] border border-border bg-white/55 p-5">
          <div>
            <h3 className="font-semibold">Etapas do pedido</h3>
            <p className="text-sm text-muted-foreground">
              Situação mais recente em cada etapa do atendimento.
            </p>
          </div>
          {item.states.length > 0 ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {item.states.map((state) => (
                <div
                  key={state.id}
                  className={cn(
                    "rounded-[20px] border p-4",
                    item.currentStateIds.includes(state.id)
                      ? "border-primary/20 bg-primary/10"
                      : "border-border bg-white/55",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">
                      {clientStageLabel(state.source)}
                    </p>
                    <StatusBadge status={statusText(state.status)} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>{formatDate(state.date)}</span>
                    {state.count > 1 ? (
                      <span>{formatNumber(state.count)} registros</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Nenhum estado operacional foi publicado para este pedido.
            </p>
          )}
        </div>

        <div className="rounded-[24px] border border-border bg-white/55 p-5">
          <h3 className="font-semibold">Atualizações da Dutelog</h3>
          {item.events.length > 0 ? (
            <div className="mt-4 space-y-3">
              {item.events.map((event) => (
                <div
                  key={event.id}
                  className="flex gap-3 rounded-2xl border border-border bg-white/60 p-4"
                >
                  <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Clock3 className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium text-foreground">
                          {event.title}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {clientStageLabel(event.source)} · {formatDate(event.date)}
                        </p>
                      </div>
                      {event.status ? (
                        <StatusBadge status={statusText(event.status)} />
                      ) : null}
                    </div>
                    {event.description ? (
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {event.description}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Nenhum evento WMS foi publicado para este pedido.
            </p>
          )}
        </div>

        <div className="rounded-[24px] border border-border bg-white/55 p-5">
          <h3 className="font-semibold">Itens do pedido</h3>
          <div className="mt-4 space-y-3">
            {item.items.length > 0 ? (
              item.items.map((orderItem) => (
                <OrderItemRow key={orderItem.id} item={orderItem} />
              ))
            ) : (
              <div className="rounded-2xl border border-border bg-white/60 p-4">
                <p className="font-medium">{item.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatNumber(item.quantity)} unidade(s) solicitada(s)
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </ModulePanel>
  );
}

function DetailFact({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value?: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-[22px] border border-border bg-white/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-border bg-white/70 text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 line-clamp-2 font-semibold text-foreground">
        {value || "-"}
      </p>
    </div>
  );
}

function OrderItemRow({ item }: { item: TrackingItem }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-white/60 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {item.clientCode ? (
          <p className="text-xs text-muted-foreground">
            Cod. cliente {item.clientCode}
          </p>
        ) : null}
        <p className="mt-1 truncate font-medium text-foreground">
          {item.product}
        </p>
      </div>
      <div className="text-right text-sm text-muted-foreground">
        {item.quantity !== undefined ? (
          <p>{formatNumber(item.quantity)} unidade(s)</p>
        ) : null}
        {item.picked !== undefined ? (
          <p className="mt-1">{formatNumber(item.picked)} separada(s)</p>
        ) : null}
      </div>
    </div>
  );
}

function buildTrackingItems(
  overview: ClientOverview,
  orders: Order[],
  requests: ClientRequest[],
) {
  const groups = new Map<string, TrackingGroup>();
  const groupByAlias = new Map<string, TrackingGroup>();
  let fallbackIndex = 0;

  function createGroup(prefix: "order" | "request", aliases: string[]) {
    const baseKey = aliases[0] ?? `${prefix}-${fallbackIndex++}`;
    let key = `${prefix}:${baseKey}`;
    while (groups.has(key)) key = `${prefix}:${baseKey}:${fallbackIndex++}`;

    const group: TrackingGroup = {
      key,
      aliases: new Set(),
      orders: [],
      requests: [],
      shipments: [],
      packages: [],
      documents: [],
      wmsRecords: [],
      publishedEvents: [],
    };
    groups.set(key, group);
    return group;
  }

  function findGroup(aliases: string[]) {
    for (const alias of aliases) {
      const group = groupByAlias.get(alias);
      if (group) return group;
    }
    return undefined;
  }

  function bindAliases(group: TrackingGroup, aliases: string[]) {
    for (const alias of aliases) {
      group.aliases.add(alias);
      groupByAlias.set(alias, group);
    }
  }

  for (const rawOrder of orders) {
    const order = rawOrder as OrderWithTracking;
    const aliases = orderAliases(order);
    const group = findGroup(aliases) ?? createGroup("order", aliases);
    group.orders.push(order);
    bindAliases(group, aliases);
  }

  for (const request of requests) {
    const aliases = requestAliases(request);
    const group = findGroup(aliases) ?? createGroup("request", aliases);
    group.requests.push(request);
    bindAliases(group, aliases);
  }

  for (const shipment of getShipments(overview)) {
    const group = findGroup(relationAliases(shipment));
    if (!group) continue;
    group.shipments.push(shipment);
    bindAliases(group, shipmentAliases(shipment));
  }

  for (const packageRecord of getPackages(overview)) {
    const group = findGroup(relationAliases(packageRecord));
    if (!group) continue;
    group.packages.push(packageRecord);
    bindAliases(group, packageAliases(packageRecord));
  }

  for (const document of getDocuments(overview)) {
    const group = findGroup(relationAliases(document));
    if (!group) continue;
    group.documents.push(document);
  }

  for (const wmsRecord of publishedWmsRecords(overview)) {
    const group = findGroup(relationAliases(wmsRecord.record));
    if (!group) continue;
    group.wmsRecords.push(wmsRecord);
    bindAliases(group, identityAliases(wmsRecord.record));
  }

  for (const event of publishedEvents(overview)) {
    const group = findGroup(relationAliases(event));
    if (group) group.publishedEvents.push(event);
  }

  return [...groups.values()]
    .map(groupToTrackingRecord)
    .sort((left, right) => dateValue(right.date) - dateValue(left.date));
}

function groupToTrackingRecord(group: TrackingGroup): TrackingRecord {
  const states = buildStates(group);
  const events = buildEvents(group);
  const items = buildItems(group);
  const activeStates = currentStates(states);
  const currentStatuses = uniqueText(
    activeStates.map((state) => state.status),
  );
  const quantityFromOrders = group.orders.reduce(
    (sum, order) =>
      sum +
      (optionalNumber(order.requested_qty, order.qtd_solic, order.quantity) ??
        0),
    0,
  );
  const quantity = group.orders.length
    ? quantityFromOrders
    : group.requests.reduce(
        (sum, request) => sum + requestQuantityTotal(request),
        0,
      );
  const products = uniqueText(
    group.orders.map(orderProduct).filter((product) => product !== "Pedido"),
  );
  const title = products.length
    ? summarizeProducts(products)
    : firstText(...group.requests.map(requestTitle), "Pedido sem itens")!;
  const reference = firstText(
    ...group.orders.map(orderReference),
    ...group.requests.map((request) =>
      firstText(
        request.order_number,
        request.num_pedido,
        requestReference(request),
      ),
    ),
    "Sem pedido",
  )!;
  const allDates = [
    ...states.map((state) => state.date),
    ...events.map((event) => event.date),
    ...group.orders.map(orderDate),
    ...group.requests.map(requestDate),
    ...group.shipments.map((shipment) => recordDate(asRecord(shipment))),
    ...group.packages.map((packageRecord) =>
      recordDate(asRecord(packageRecord)),
    ),
  ];

  return {
    id: group.key,
    kind: group.orders.length ? "order" : "request",
    reference,
    title,
    status: currentStatuses.join(" / ") || undefined,
    currentStatuses,
    currentStateIds: activeStates.map((state) => state.id),
    quantity,
    lineCount: items.length || group.orders.length || group.requests.length,
    date: latestDate(allDates),
    destination: firstText(
      ...group.shipments.map((shipment) => shipment.destination),
      ...group.requests.map((request) =>
        fieldText(asRecord(request), "destination", "destino"),
      ),
      ...group.orders.map((order) => order.destination),
    ),
    states,
    events,
    items,
  };
}

function buildStates(group: TrackingGroup) {
  const states = new Map<string, TrackingState>();

  function addState(source: string, value: unknown) {
    const record = asRecord(value);
    if (!record) return;
    const status = fieldText(record, "status", "state", "current_status");
    if (!status) return;

    const key = `${normalizeSlug(source)}:${normalizeSlug(status)}`;
    const date = recordDate(record);
    const existing = states.get(key);
    if (existing) {
      existing.count += 1;
      existing.date = latestDate([existing.date, date]);
      return;
    }

    states.set(key, {
      id: key,
      source,
      status,
      date,
      count: 1,
    });
  }

  group.requests.forEach((request) => addState("Solicitacao", request));
  group.orders.forEach((order) => addState("Pedido", order));
  group.wmsRecords.forEach(({ source, record }) => addState(source, record));
  group.packages.forEach((packageRecord) =>
    addState("Volume", packageRecord),
  );
  group.shipments.forEach((shipment) => addState("Expedicao", shipment));

  return [...states.values()];
}

function currentStates(states: TrackingState[]) {
  const datedStates = states.filter(
    (state) => state.date && dateValue(state.date) > 0,
  );
  if (datedStates.length > 0) {
    const latestTime = Math.max(
      ...datedStates.map((state) => dateValue(state.date)),
    );
    return datedStates.filter((state) => dateValue(state.date) === latestTime);
  }

  const latestSource = states[states.length - 1]?.source;
  return latestSource
    ? states.filter((state) => state.source === latestSource)
    : [];
}

function buildEvents(group: TrackingGroup) {
  const events: TrackingEvent[] = [];
  const sourceRecords: PublishedWmsRecord[] = [
    ...group.orders.map((record) => ({ source: "Pedido", record: asRecord(record) })),
    ...group.requests.map((record) => ({
      source: "Solicitacao",
      record: asRecord(record),
    })),
    ...group.wmsRecords,
    ...group.packages.map((record) => ({
      source: "Volume",
      record: asRecord(record),
    })),
    ...group.shipments.map((record) => ({
      source: "Expedicao",
      record: asRecord(record),
    })),
  ];

  for (const { source, record } of sourceRecords) {
    for (const eventRecord of nestedEventRecords(record)) {
      const event = toTrackingEvent(eventRecord, source, events.length);
      if (event) events.push(event);
    }
  }

  group.publishedEvents.forEach((eventRecord, index) => {
    const event = toTrackingEvent(eventRecord, "WMS", events.length + index);
    if (event) events.push(event);
  });

  group.shipments.forEach((shipment, index) => {
    if (shipment.dispatched_at) {
      events.push({
        id: `shipment-dispatched:${shipment.id ?? index}:${shipment.dispatched_at}`,
        title: "Despacho",
        status: shipment.status ?? undefined,
        source: "Expedicao",
        date: shipment.dispatched_at,
      });
    }
    if (shipment.delivered_at) {
      events.push({
        id: `shipment-delivered:${shipment.id ?? index}:${shipment.delivered_at}`,
        title: "Entrega",
        status: shipment.status ?? undefined,
        source: "Expedicao",
        date: shipment.delivered_at,
      });
    }
  });

  group.documents.forEach((document, index) => {
    if (!document.signed_at) return;
    events.push({
      id: `document-signed:${document.id ?? document.document_id ?? index}:${document.signed_at}`,
      title: firstText(
        document.title,
        document.file_name,
        document.filename,
        document.name,
        "Comprovante assinado",
      )!,
      status: document.status ?? undefined,
      source: "Documento",
      date: document.signed_at,
    });
  });

  const unique = new Map<string, TrackingEvent>();
  for (const event of events) {
    const key = [
      normalizeSlug(event.title),
      normalizeSlug(event.status),
      normalizeSlug(event.source),
      event.date ?? "",
      event.description ?? "",
    ].join("|");
    if (!unique.has(key)) unique.set(key, event);
  }

  return [...unique.values()].sort(
    (left, right) => dateValue(right.date) - dateValue(left.date),
  );
}

function toTrackingEvent(
  record: UnknownRecord,
  fallbackSource: string,
  index: number,
): TrackingEvent | null {
  const status = fieldText(record, "status", "state", "after_status");
  const title = firstText(
    fieldText(record, "title", "label", "name"),
    fieldText(record, "event_type", "type"),
    status ? fallbackSource : undefined,
  );
  if (!title) return null;

  const payload = asRecord(record.payload);
  return {
    id:
      firstText(
        record.id,
        record.event_id,
        `${fallbackSource}:${title}:${recordDate(record) ?? index}`,
      ) ?? `${fallbackSource}:event:${index}`,
    title,
    status,
    description: firstText(
      fieldText(record, "description", "message", "notes", "note"),
      payload
        ? fieldText(payload, "description", "message", "notes", "note")
        : undefined,
    ),
    source:
      firstText(
        fieldText(record, "source", "module", "stage"),
        fallbackSource,
      ) ?? fallbackSource,
    date: recordDate(record),
  };
}

function nestedEventRecords(record: UnknownRecord) {
  const eventRecords: UnknownRecord[] = [];
  const containers = [record, asRecord(record.payload)].filter(
    (value): value is UnknownRecord => Boolean(value),
  );

  for (const container of containers) {
    for (const field of ["events", "timeline", "status_history", "history"]) {
      const values = container[field];
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        const eventRecord = asRecord(value);
        if (eventRecord) eventRecords.push(eventRecord);
      }
    }
  }
  return eventRecords;
}

function buildItems(group: TrackingGroup) {
  if (group.orders.length > 0) {
    return group.orders.map<TrackingItem>((order, index) => ({
      id:
        firstText(
          order.id,
          order.sku_code,
          order.sku,
          order.cod_sku,
          `order-item-${index}`,
        ) ?? `order-item-${index}`,
      product: orderProduct(order),
      clientCode: firstText(order.client_item_code, order.cod_cliente),
      quantity: optionalNumber(
        order.requested_qty,
        order.qtd_solic,
        order.quantity,
      ),
      picked: optionalNumber(order.picked_qty, order.qtd_sep),
    }));
  }

  return group.requests.flatMap((request, requestIndex) =>
    requestItems(request).map<TrackingItem>((item, itemIndex) => {
      if (typeof item === "string") {
        return {
          id: `request-${requestIndex}-item-${itemIndex}`,
          product: item,
        };
      }

      return {
        id:
          firstText(
            item.sku_code,
            item.sku,
            item.cod_sku,
            `request-${requestIndex}-item-${itemIndex}`,
          ) ?? `request-${requestIndex}-item-${itemIndex}`,
        product:
          firstText(
            item.product_name,
            item.product,
            item.name,
            item.produto,
            "Item do pedido",
          ) ?? "Item do pedido",
        clientCode: firstText(item.client_item_code, item.cod_cliente),
        quantity: optionalNumber(
          item.quantity,
          item.qty,
          item.qtd,
          item.qtde,
          item.requested_quantity,
          item.requested_qty,
          item.expected_quantity,
          item.expected_qty,
        ),
        picked: optionalNumber(item.picked_quantity, item.picked_qty),
      };
    }),
  );
}

function orderAliases(order: OrderWithTracking) {
  return normalizedAliases(
    order.order_id,
    order.order_number,
    order.num_pedido,
    order.number,
    order.id,
  );
}

function requestAliases(request: ClientRequest) {
  return normalizedAliases(
    request.order_id,
    request.pedido_id,
    request.order_number,
    request.num_pedido,
    request.id,
    request.protocol,
    request.protocolo,
  );
}

function shipmentAliases(shipment: ShipmentRecord) {
  return normalizedAliases(
    shipment.id,
    shipment.shipment_id,
    shipment.shipping_id,
    shipment.expedition_id,
    shipment.tracking_code,
  );
}

function packageAliases(packageRecord: PackageRecord) {
  return normalizedAliases(
    packageRecord.id,
    packageRecord.package_id,
    packageRecord.package_code,
    packageRecord.package_label,
    packageRecord.volume_id,
    packageRecord.volume,
  );
}

function identityAliases(value: unknown) {
  const record = asRecord(value);
  if (!record) return [];
  return normalizedAliases(
    record.id,
    record.task_id,
    record.task_uid,
    record.shipment_id,
    record.package_id,
    record.customer_request_id,
  );
}

function relationAliases(value: unknown) {
  const record = asRecord(value);
  if (!record) return [];
  const payload = asRecord(record.payload);
  return normalizedAliases(
    record.order_id,
    record.pedido_id,
    record.order_number,
    record.num_pedido,
    record.customer_request_id,
    record.request_id,
    record.shipment_id,
    record.pack_task_id,
    record.entity_id,
    payload?.order_id,
    payload?.pedido_id,
    payload?.order_number,
    payload?.num_pedido,
    payload?.customer_request_id,
    payload?.request_id,
    payload?.shipment_id,
    payload?.task_id,
    payload?.task_uid,
  );
}

function normalizedAliases(...values: unknown[]) {
  return uniqueText(
    values.flatMap((value) => {
      const text = firstText(value);
      return text ? [normalizeSlug(text)] : [];
    }),
  );
}

function publishedWmsRecords(overview: ClientOverview) {
  const records: PublishedWmsRecord[] = [];
  const roots = [asRecord(overview), asRecord(overview.wms)].filter(
    (value): value is UnknownRecord => Boolean(value),
  );
  const collections: Array<[string, string]> = [
    ["pick_tasks", "Picking"],
    ["picking_tasks", "Picking"],
    ["picking", "Picking"],
    ["pack_tasks", "Packing"],
    ["packing_tasks", "Packing"],
    ["packing", "Packing"],
  ];

  for (const root of roots) {
    for (const [field, source] of collections) {
      const values = root[field];
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        const record = asRecord(value);
        if (record) records.push({ source, record });
      }
    }
  }
  return records;
}

function publishedEvents(overview: ClientOverview) {
  const records: UnknownRecord[] = [];
  const roots = [asRecord(overview), asRecord(overview.wms)].filter(
    (value): value is UnknownRecord => Boolean(value),
  );

  for (const root of roots) {
    for (const field of ["events", "published_events", "timeline"]) {
      const values = root[field];
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        const record = asRecord(value);
        if (record) records.push(record);
      }
    }
  }
  return records;
}

function recordDate(record: UnknownRecord) {
  return firstDate(
    record.occurred_at,
    record.event_at,
    record.delivered_at,
    record.dispatched_at,
    record.updated_at,
    record.created_at,
    record.requested_at,
    record.data_solic,
    record.date,
    record.timestamp,
  );
}

function firstDate(...values: unknown[]) {
  for (const value of values) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) {
      const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
      const date = new Date(milliseconds);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    const record = asRecord(value);
    if (!record) continue;
    const seconds = optionalNumber(record.seconds, record._seconds);
    if (seconds !== undefined) return new Date(seconds * 1000).toISOString();
  }
  return undefined;
}

function latestDate(values: Array<string | null | undefined>) {
  let latest: string | undefined;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const time = dateValue(value);
    if (!latest || time >= latestTime) {
      latest = value;
      latestTime = time;
    }
  }
  return latest;
}

function fieldText(record: UnknownRecord, ...fields: string[]) {
  return firstText(...fields.map((field) => record[field]));
}

function asRecord(value: unknown): UnknownRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as UnknownRecord;
  }
  return {};
}

function uniqueText(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function summarizeProducts(products: string[]) {
  if (products.length <= 1) return products[0] ?? "Pedido sem itens";
  return `${products[0]} + ${formatNumber(products.length - 1)} item(ns)`;
}

function isOutboundRequest(request: ClientRequest) {
  const text = normalizeSlug(
    [
      request.type,
      request.tipo,
      request.title,
      request.titulo,
      request.description,
      request.descricao,
    ]
      .filter(Boolean)
      .join(" "),
  );

  return (
    text.includes("retirada") ||
    text.includes("pedido do estoque") ||
    text.includes("pedido de entrega")
  );
}

function isOpenTracking(item: TrackingRecord) {
  return (
    item.currentStatuses.length === 0 ||
    item.currentStatuses.some(
      (status) => !CLOSED_STATUSES.has(normalizeSlug(status)),
    )
  );
}

function hasCurrentStatus(item: TrackingRecord, statuses: Set<string>) {
  return item.currentStatuses.some((status) =>
    statuses.has(normalizeSlug(status)),
  );
}

function statusText(status?: string | null) {
  const normalized = normalizeSlug(status);
  if (!normalized) return "Recebido";
  if (["cancelled", "canceled", "cancelado", "rejected", "rejeitado"].includes(normalized)) {
    return "Cancelado";
  }
  if (["delivered", "entregue", "completed", "complete", "concluido", "concluida"].includes(normalized)) {
    return "Entregue";
  }
  if (["shipped", "dispatched", "expedido", "expedida", "em-rota", "out-for-delivery"].includes(normalized)) {
    return "Saiu para entrega";
  }
  if (["checking", "conferencia", "conferindo", "packing", "packed", "embalagem"].includes(normalized)) {
    return "Conferindo";
  }
  if (["picking", "separacao", "separando", "in-progress", "em-execucao", "approved", "aprovado"].includes(normalized)) {
    return "Separando";
  }
  return "Recebido";
}

function clientStageLabel(source: string) {
  const normalized = normalizeSlug(source);
  if (normalized.includes("pick")) return "Separação";
  if (normalized.includes("pack") || normalized.includes("confer")) return "Conferência";
  if (normalized.includes("exped") || normalized.includes("shipment")) return "Entrega";
  if (normalized.includes("document")) return "Comprovante";
  if (normalized.includes("volume")) return "Volumes";
  return "Pedido";
}

function dateValue(value?: string | null) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
