import type {
  DocumentData,
  DocumentReference,
  Transaction,
} from "firebase-admin/firestore";

export const BILLING_STATUSES = ["aberto", "emitido", "pago"] as const;
export const INVOICE_SNAPSHOT_FIELD = "invoice_snapshot" as const;
export const INVOICE_SNAPSHOT_VERSION = 1 as const;
export const DEFAULT_BILLING_TIME_ZONE = "America/Sao_Paulo";

export const BILLING_AUTO_SOURCES = {
  adValorem: "ad_valorem",
  incomingPieces: "mov_entrada_pecas",
  outgoingPieces: "mov_saida_pecas",
  movementCount: "mov_count",
  pallets: "pallet",
  transport: "transporte",
  labels: "etiquetagem",
} as const;

export type BillingStatus = (typeof BILLING_STATUSES)[number];
export type DecimalValue = number | string;
export type LpuItemId = number | string;

export type BillingErrorCode =
  | "INVALID_COMPETENCIA"
  | "FUTURE_COMPETENCIA"
  | "COMPETENCIA_NOT_CLOSED"
  | "INVALID_STATUS"
  | "INVALID_STATUS_TRANSITION"
  | "INVALID_NUMBER"
  | "DUPLICATE_LPU_ITEM"
  | "DUPLICATE_MANUAL_QUANTITY"
  | "MANUAL_ITEM_NOT_BILLED"
  | "PERIOD_NOT_FOUND"
  | "PERIOD_NOT_OPEN"
  | "PERIOD_INVOICED"
  | "PAID_IN_FINANCEIRO"
  | "PRICE_NOT_IN_TABLE"
  | "PRICE_TABLE_AMBIGUOUS"
  | "PERIOD_COMPETENCIA_MISMATCH"
  | "SNAPSHOT_ALREADY_EXISTS"
  | "INVALID_SNAPSHOT";

export class BillingDomainError extends Error {
  readonly code: BillingErrorCode;

  constructor(code: BillingErrorCode, message: string) {
    super(message);
    this.name = "BillingDomainError";
    this.code = code;
  }
}

export interface LpuItem {
  id: LpuItemId;
  grupo: string;
  item: string;
  unidade?: string | null;
  valor_unit: DecimalValue;
  auto_source?: string | null;
  ordem?: number;
  ativo?: boolean;
  /** A tabela do Comercial de onde saiu o `valor_unit` (parte 7.3a). */
  tabela_id?: string | null;
}

export interface BillingManualQuantity {
  price_list_id: LpuItemId;
  qtde: DecimalValue;
  observacao?: string | null;
}

/**
 * Operational totals for a competence. `metrics` accepts any future LPU source
 * in addition to the first-class sources used by the current application.
 */
export interface BillingUsage {
  custo_estoque?: DecimalValue;
  entradas_pecas?: DecimalValue;
  saidas_pecas?: DecimalValue;
  movimentacoes?: DecimalValue;
  pallets?: DecimalValue;
  transportes?: DecimalValue;
  etiquetas?: DecimalValue;
  metrics?: Readonly<Record<string, DecimalValue>>;
}

export interface BillingMetricEvent {
  competencia: string;
  source: string;
  quantity: DecimalValue;
}

export interface BillingCalculationInput {
  competencia: string;
  priceList: readonly LpuItem[];
  manualQuantities?: readonly BillingManualQuantity[];
  usage?: BillingUsage;
  adValoremRate?: DecimalValue;
}

export interface BillingLine {
  price_list_id: LpuItemId;
  grupo: string;
  item: string;
  unidade: string | null;
  qtde: number;
  valor_unit: number;
  total_cents: number;
  total: number;
  auto: boolean;
  auto_source: string | null;
  observacao: string | null;
  ordem: number;
  /** A tabela do Comercial de onde saiu o preço; ausente no preço do próprio WMS. */
  tabela_id?: string;
}

export interface BillingGroup {
  grupo: string;
  total_cents: number;
  total: number;
  itens: readonly BillingLine[];
}

export interface BillingCalculation {
  competencia: string;
  custo_estoque: number;
  ad_valorem_rate: number;
  linhas: readonly BillingLine[];
  grupos: readonly BillingGroup[];
  total_cents: number;
  total: number;
}

export interface InvoiceSnapshot {
  schema_version: typeof INVOICE_SNAPSHOT_VERSION;
  competencia: string;
  status: "emitido";
  currency: "BRL";
  issued_at: string;
  emitted_by: string | null;
  customer_code?: string;
  custo_estoque: number;
  ad_valorem_rate: number;
  linhas: readonly Readonly<BillingLine>[];
  grupos: readonly Readonly<BillingGroup>[];
  total_cents: number;
  total: number;
}

export interface InvoiceEmissionOptions {
  issuedAt: Date;
  emittedBy?: string | null;
  customerCode?: string;
  /** Value used for Firestore audit fields, e.g. FieldValue.serverTimestamp(). */
  firestoreTimestamp?: unknown;
  /**
   * O período aberto da competência que ainda não tem documento (ninguém
   * salvou as quantidades manuais): a prévia já a mostra aberta, e ela nasce
   * na emissão. Sem ele, a competência sem documento recusa com
   * PERIOD_NOT_FOUND.
   */
  openPeriod?: () => Readonly<Record<string, unknown>>;
}

export interface PreparedInvoiceEmission {
  snapshot: Readonly<InvoiceSnapshot>;
  periodUpdate: Readonly<Record<string, unknown>> | null;
  idempotent: boolean;
}

interface ParsedDecimal {
  coefficient: bigint;
  scale: number;
}

const COMPETENCIA_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const MAX_DECIMAL_SCALE = 100;
const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

const allowedTransitions: Readonly<
  Record<BillingStatus, readonly BillingStatus[]>
> = {
  aberto: ["emitido"],
  emitido: ["pago"],
  pago: [],
};

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function parseDecimal(value: DecimalValue, field: string): ParsedDecimal {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new BillingDomainError("INVALID_NUMBER", `${field} deve ser finito.`);
  }

  const text = String(value).trim();
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) {
    throw new BillingDomainError(
      "INVALID_NUMBER",
      `${field} deve ser decimal.`,
    );
  }

  const [, sign, integer, fraction = "", exponentText = "0"] = match;
  const exponent = Number(exponentText);
  let scale = fraction.length - exponent;
  if (!Number.isSafeInteger(exponent) || Math.abs(scale) > MAX_DECIMAL_SCALE) {
    throw new BillingDomainError(
      "INVALID_NUMBER",
      `${field} excede a precisao suportada.`,
    );
  }

  let coefficient = BigInt(`${integer}${fraction}`);
  if (sign === "-") coefficient = -coefficient;
  if (scale < 0) {
    coefficient *= pow10(-scale);
    scale = 0;
  }

  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }

  return { coefficient, scale };
}

function assertNonNegative(value: ParsedDecimal, field: string): void {
  if (value.coefficient < 0n) {
    throw new BillingDomainError(
      "INVALID_NUMBER",
      `${field} nao pode ser negativo.`,
    );
  }
}

function addDecimals(left: ParsedDecimal, right: ParsedDecimal): ParsedDecimal {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient:
      left.coefficient * pow10(scale - left.scale) +
      right.coefficient * pow10(scale - right.scale),
    scale,
  };
}

function decimalToNumber(value: ParsedDecimal, field: string): number {
  const result = Number(value.coefficient) / 10 ** value.scale;
  if (!Number.isFinite(result)) {
    throw new BillingDomainError(
      "INVALID_NUMBER",
      `${field} excede o limite numerico.`,
    );
  }
  return result;
}

function scaleToCents(value: ParsedDecimal): bigint {
  if (value.scale <= 2) {
    return value.coefficient * pow10(2 - value.scale);
  }

  const divisor = pow10(value.scale - 2);
  let quotient = value.coefficient / divisor;
  const remainder = value.coefficient % divisor;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  if (absoluteRemainder * 2n >= divisor) {
    quotient += value.coefficient < 0n ? -1n : 1n;
  }
  return quotient;
}

function multiplyToCents(
  quantity: ParsedDecimal,
  unitPrice: ParsedDecimal,
): bigint {
  return scaleToCents({
    coefficient: quantity.coefficient * unitPrice.coefficient,
    scale: quantity.scale + unitPrice.scale,
  });
}

function centsToNumber(cents: bigint, field = "total"): number {
  if (cents > MAX_SAFE_CENTS || cents < -MAX_SAFE_CENTS) {
    throw new BillingDomainError(
      "INVALID_NUMBER",
      `${field} excede o limite seguro.`,
    );
  }
  return Number(cents) / 100;
}

function centsToSafeInteger(cents: bigint, field = "total_cents"): number {
  if (cents > MAX_SAFE_CENTS || cents < -MAX_SAFE_CENTS) {
    throw new BillingDomainError(
      "INVALID_NUMBER",
      `${field} excede o limite seguro.`,
    );
  }
  return Number(cents);
}

function itemKey(id: LpuItemId): string {
  const key = String(id).trim();
  if (!key) {
    throw new BillingDomainError(
      "INVALID_NUMBER",
      "O id da LPU nao pode ser vazio.",
    );
  }
  return key;
}

function normalizedOrder(value: number | undefined): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value)) {
    throw new BillingDomainError(
      "INVALID_NUMBER",
      "ordem da LPU deve ser um inteiro seguro.",
    );
  }
  return value;
}

function compareLpuItems(left: LpuItem, right: LpuItem): number {
  const orderDifference =
    normalizedOrder(left.ordem) - normalizedOrder(right.ordem);
  if (orderDifference !== 0) return orderDifference;
  const leftKey = itemKey(left.id);
  const rightKey = itemKey(right.id);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function freezeDeep<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      freezeDeep(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function clonePlainValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => clonePlainValue(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        clonePlainValue(nested),
      ]),
    ) as T;
  }
  return value;
}

function toIsoDate(value: Date, field: string): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new BillingDomainError(
      "INVALID_NUMBER",
      `${field} deve ser uma data valida.`,
    );
  }
  return value.toISOString();
}

function metricMapFromUsage(
  usage: BillingUsage = {},
): Map<string, ParsedDecimal> {
  const result = new Map<string, ParsedDecimal>();
  const setMetric = (
    source: string,
    value: DecimalValue | undefined,
    field: string,
  ) => {
    if (value === undefined) return;
    const parsed = parseDecimal(value, field);
    assertNonNegative(parsed, field);
    result.set(source, parsed);
  };

  for (const [source, value] of Object.entries(usage.metrics ?? {})) {
    const normalizedSource = source.trim();
    if (!normalizedSource) {
      throw new BillingDomainError(
        "INVALID_NUMBER",
        "A fonte da metrica nao pode ser vazia.",
      );
    }
    setMetric(normalizedSource, value, `metrics.${normalizedSource}`);
  }

  setMetric(
    BILLING_AUTO_SOURCES.adValorem,
    usage.custo_estoque,
    "custo_estoque",
  );
  setMetric(
    BILLING_AUTO_SOURCES.incomingPieces,
    usage.entradas_pecas,
    "entradas_pecas",
  );
  setMetric(
    BILLING_AUTO_SOURCES.outgoingPieces,
    usage.saidas_pecas,
    "saidas_pecas",
  );
  setMetric(
    BILLING_AUTO_SOURCES.movementCount,
    usage.movimentacoes,
    "movimentacoes",
  );
  setMetric(BILLING_AUTO_SOURCES.pallets, usage.pallets, "pallets");
  setMetric(BILLING_AUTO_SOURCES.transport, usage.transportes, "transportes");
  setMetric(BILLING_AUTO_SOURCES.labels, usage.etiquetas, "etiquetas");

  return result;
}

function groupLines(lines: readonly BillingLine[]): readonly BillingGroup[] {
  const groups = new Map<string, { lines: BillingLine[]; cents: bigint }>();
  for (const line of lines) {
    const current = groups.get(line.grupo) ?? { lines: [], cents: 0n };
    current.lines.push(line);
    current.cents += BigInt(line.total_cents);
    groups.set(line.grupo, current);
  }

  return [...groups.entries()].map(([grupo, value]) => ({
    grupo,
    total_cents: centsToSafeInteger(value.cents, `grupo ${grupo}`),
    total: centsToNumber(value.cents, `grupo ${grupo}`),
    itens: value.lines,
  }));
}

function invoiceSnapshotFromUnknown(value: unknown): Readonly<InvoiceSnapshot> {
  if (!value || typeof value !== "object") {
    throw new BillingDomainError(
      "INVALID_SNAPSHOT",
      "A fatura emitida nao possui snapshot valido.",
    );
  }
  const snapshot = value as Partial<InvoiceSnapshot>;
  if (
    snapshot.schema_version !== INVOICE_SNAPSHOT_VERSION ||
    snapshot.status !== "emitido" ||
    typeof snapshot.competencia !== "string" ||
    !Array.isArray(snapshot.linhas) ||
    !Number.isSafeInteger(snapshot.total_cents) ||
    typeof snapshot.total !== "number"
  ) {
    throw new BillingDomainError(
      "INVALID_SNAPSHOT",
      "O snapshot da fatura esta incompleto.",
    );
  }
  return freezeDeep(clonePlainValue(snapshot as InvoiceSnapshot));
}

export function parseCompetencia(competencia: string): {
  year: number;
  month: number;
} {
  const match = COMPETENCIA_PATTERN.exec(competencia);
  if (!match || Number(match[1]) === 0) {
    throw new BillingDomainError(
      "INVALID_COMPETENCIA",
      `Competencia invalida: ${competencia}. Use YYYY-MM.`,
    );
  }
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function competenciaFromDate(
  date: Date,
  timeZone = DEFAULT_BILLING_TIME_ZONE,
): string {
  toIsoDate(date, "date");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) {
    throw new BillingDomainError(
      "INVALID_COMPETENCIA",
      "Nao foi possivel obter a competencia.",
    );
  }
  return `${year}-${month}`;
}

export function assertCompetenciaCanBeOpen(
  competencia: string,
  now: Date,
  timeZone = DEFAULT_BILLING_TIME_ZONE,
): void {
  parseCompetencia(competencia);
  const current = competenciaFromDate(now, timeZone);
  if (competencia > current) {
    throw new BillingDomainError(
      "FUTURE_COMPETENCIA",
      `A competencia ${competencia} ainda nao pode ser aberta; a atual e ${current}.`,
    );
  }
}

/** Primeiro dia (YYYY-MM-DD) em que a competência pode ser emitida. */
export function emissionAvailableFrom(competencia: string): string {
  const { year, month } = parseCompetencia(competencia);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
}

export function isCompetenciaClosed(
  competencia: string,
  now: Date,
  timeZone = DEFAULT_BILLING_TIME_ZONE,
): boolean {
  parseCompetencia(competencia);
  return competencia < competenciaFromDate(now, timeZone);
}

/**
 * Emitir congela a fatura. Se o mês ainda está em curso, o que acontecer
 * depois da emissão não seria cobrado em competência nenhuma.
 */
export function assertCompetenciaClosed(
  competencia: string,
  now: Date,
  timeZone = DEFAULT_BILLING_TIME_ZONE,
): void {
  if (!isCompetenciaClosed(competencia, now, timeZone)) {
    const [year, month, day] = emissionAvailableFrom(competencia).split("-");
    throw new BillingDomainError(
      "COMPETENCIA_NOT_CLOSED",
      `A competência ${competencia} ainda não terminou. A emissão fica liberada a partir de ${day}/${month}/${year}.`,
    );
  }
}

const OFFSET_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?(?:[T ][\d:.]+)?$/;

/**
 * Competência de um instante no horário de Brasília. Um movimento das 22h do
 * dia 30/09 (01/10 01:00 UTC) é de setembro. Datas sem fuso (legado) valem
 * como foram escritas.
 */
export function competenciaOfInstant(
  value: string,
  timeZone = DEFAULT_BILLING_TIME_ZONE,
): string | null {
  const text = value.trim();
  if (!text) return null;
  if (!OFFSET_PATTERN.test(text)) {
    const local = LOCAL_DATE_PATTERN.exec(text);
    return local ? `${local[1]}-${local[2]}` : null;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return competenciaFromDate(date, timeZone);
}

/** Item da tabela sem cliente gravado pertence ao cliente padrão. */
export function billingCustomerOf(value: unknown, defaultCustomer: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || defaultCustomer;
}

export function isBillingStatus(value: unknown): value is BillingStatus {
  return (
    typeof value === "string" &&
    BILLING_STATUSES.includes(value as BillingStatus)
  );
}

export function assertBillingStatus(
  value: unknown,
): asserts value is BillingStatus {
  if (!isBillingStatus(value)) {
    throw new BillingDomainError(
      "INVALID_STATUS",
      `Status de faturamento invalido: ${String(value)}.`,
    );
  }
}

export function canTransitionBillingStatus(
  from: BillingStatus,
  to: BillingStatus,
): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertBillingStatusTransition(
  from: BillingStatus | null,
  to: BillingStatus,
  context: { competencia: string; now: Date; timeZone?: string },
): void {
  assertBillingStatus(to);
  if (from === null) {
    if (to !== "aberto") {
      throw new BillingDomainError(
        "INVALID_STATUS_TRANSITION",
        `Uma competencia nova deve iniciar como aberto, nao ${to}.`,
      );
    }
    assertCompetenciaCanBeOpen(
      context.competencia,
      context.now,
      context.timeZone,
    );
    return;
  }

  assertBillingStatus(from);
  if (!canTransitionBillingStatus(from, to)) {
    throw new BillingDomainError(
      "INVALID_STATUS_TRANSITION",
      `Transicao de ${from} para ${to} nao permitida.`,
    );
  }
}

export function createOpenBillingPeriod(
  competencia: string,
  options: { now: Date; customerCode?: string; timeZone?: string },
): Readonly<Record<string, unknown>> {
  assertBillingStatusTransition(null, "aberto", {
    competencia,
    now: options.now,
    timeZone: options.timeZone,
  });
  const period: Record<string, unknown> = {
    competencia,
    status: "aberto",
    total_cents: 0,
    total: 0,
    opened_at: toIsoDate(options.now, "now"),
  };
  if (options.customerCode !== undefined)
    period.customer_code = options.customerCode;
  return freezeDeep(period);
}

export function aggregateBillingMetrics(
  competencia: string,
  events: readonly BillingMetricEvent[],
): Readonly<Record<string, number>> {
  parseCompetencia(competencia);
  const totals = new Map<string, ParsedDecimal>();

  for (const [index, event] of events.entries()) {
    parseCompetencia(event.competencia);
    if (event.competencia !== competencia) continue;
    const source = event.source.trim();
    if (!source) {
      throw new BillingDomainError(
        "INVALID_NUMBER",
        `events[${index}].source nao pode ser vazio.`,
      );
    }
    const quantity = parseDecimal(event.quantity, `events[${index}].quantity`);
    assertNonNegative(quantity, `events[${index}].quantity`);
    totals.set(
      source,
      addDecimals(
        totals.get(source) ?? { coefficient: 0n, scale: 0 },
        quantity,
      ),
    );
  }

  const result: Record<string, number> = {};
  for (const [source, quantity] of [...totals.entries()].sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  )) {
    result[source] = decimalToNumber(quantity, source);
  }
  return freezeDeep(result);
}

export function calculateLpuLines(
  input: BillingCalculationInput,
): readonly BillingLine[] {
  parseCompetencia(input.competencia);
  const metrics = metricMapFromUsage(input.usage);
  const manualByItem = new Map<string, BillingManualQuantity>();

  for (const manual of input.manualQuantities ?? []) {
    const key = itemKey(manual.price_list_id);
    if (manualByItem.has(key)) {
      throw new BillingDomainError(
        "DUPLICATE_MANUAL_QUANTITY",
        `Quantidade manual duplicada para o item ${key}.`,
      );
    }
    manualByItem.set(key, manual);
  }

  const seenItems = new Set<string>();
  const activeItems = input.priceList.filter((item) => item.ativo !== false);
  for (const item of activeItems) {
    const key = itemKey(item.id);
    if (seenItems.has(key)) {
      throw new BillingDomainError(
        "DUPLICATE_LPU_ITEM",
        `Item duplicado na LPU: ${key}.`,
      );
    }
    seenItems.add(key);
  }

  return [...activeItems].sort(compareLpuItems).map((item) => {
    const key = itemKey(item.id);
    const autoSource = item.auto_source?.trim() || null;
    const manual = manualByItem.get(key);
    const quantity = autoSource
      ? (metrics.get(autoSource) ?? { coefficient: 0n, scale: 0 })
      : parseDecimal(manual?.qtde ?? 0, `quantidade do item ${key}`);
    assertNonNegative(quantity, `quantidade do item ${key}`);

    const unitPrice =
      autoSource === BILLING_AUTO_SOURCES.adValorem &&
      input.adValoremRate !== undefined
        ? parseDecimal(input.adValoremRate, "adValoremRate")
        : parseDecimal(item.valor_unit, `valor_unit do item ${key}`);
    assertNonNegative(unitPrice, `valor_unit do item ${key}`);
    const totalCents = multiplyToCents(quantity, unitPrice);

    return {
      price_list_id: item.id,
      grupo: item.grupo || "outros",
      item: item.item,
      unidade: item.unidade ?? null,
      qtde: decimalToNumber(quantity, `quantidade do item ${key}`),
      valor_unit: decimalToNumber(unitPrice, `valor_unit do item ${key}`),
      total_cents: centsToSafeInteger(totalCents, `total do item ${key}`),
      total: centsToNumber(totalCents, `total do item ${key}`),
      auto: autoSource !== null,
      auto_source: autoSource,
      observacao: autoSource ? null : (manual?.observacao ?? null),
      ordem: normalizedOrder(item.ordem),
      ...(item.tabela_id ? { tabela_id: item.tabela_id } : {}),
    };
  });
}

export function calculateBillingTotal(
  lines: readonly Pick<BillingLine, "total_cents">[],
): number {
  const totalCents = lines.reduce((total, line, index) => {
    if (!Number.isSafeInteger(line.total_cents)) {
      throw new BillingDomainError(
        "INVALID_NUMBER",
        `linhas[${index}].total_cents deve ser um inteiro seguro.`,
      );
    }
    return total + BigInt(line.total_cents);
  }, 0n);
  return centsToNumber(totalCents);
}

export function calculateBillingPeriod(
  input: BillingCalculationInput,
): BillingCalculation {
  const lines = calculateLpuLines(input);
  const totalCents = lines.reduce(
    (total, line) => total + BigInt(line.total_cents),
    0n,
  );
  const inventoryValue = parseDecimal(
    input.usage?.custo_estoque ?? 0,
    "custo_estoque",
  );
  assertNonNegative(inventoryValue, "custo_estoque");
  const adValoremRate = parseDecimal(input.adValoremRate ?? 0, "adValoremRate");
  assertNonNegative(adValoremRate, "adValoremRate");

  return {
    competencia: input.competencia,
    custo_estoque: decimalToNumber(inventoryValue, "custo_estoque"),
    ad_valorem_rate: decimalToNumber(adValoremRate, "adValoremRate"),
    linhas: lines,
    grupos: groupLines(lines),
    total_cents: centsToSafeInteger(totalCents),
    total: centsToNumber(totalCents),
  };
}

export function buildInvoiceSnapshot(
  input: BillingCalculationInput,
  options: InvoiceEmissionOptions,
): Readonly<InvoiceSnapshot> {
  assertCompetenciaCanBeOpen(input.competencia, options.issuedAt);
  const calculation = calculateBillingPeriod(input);
  const snapshot: InvoiceSnapshot = {
    schema_version: INVOICE_SNAPSHOT_VERSION,
    competencia: input.competencia,
    status: "emitido",
    currency: "BRL",
    issued_at: toIsoDate(options.issuedAt, "issuedAt"),
    emitted_by: options.emittedBy ?? null,
    custo_estoque: calculation.custo_estoque,
    ad_valorem_rate: calculation.ad_valorem_rate,
    linhas: calculation.linhas.map((line) => ({ ...line })),
    grupos: calculation.grupos.map((group) => ({
      ...group,
      itens: group.itens.map((line) => ({ ...line })),
    })),
    total_cents: calculation.total_cents,
    total: calculation.total,
  };
  if (options.customerCode !== undefined)
    snapshot.customer_code = options.customerCode;
  return freezeDeep(snapshot);
}

/**
 * A quantidade salva nos serviços do mês tem de virar linha. A de um item que
 * saiu da Tabela de preços (arquivado ou apagado) sumiria da fatura sem aviso:
 * a emissão recusa e diz o item. Salvar as quantidades de novo tira a
 * quantidade velha (a tela salva só os itens da tabela), ou o item volta.
 */
function assertManualQuantitiesBilled(input: BillingCalculationInput) {
  const activeItems = new Set(
    input.priceList.filter((item) => item.ativo !== false).map((item) => itemKey(item.id)),
  );
  for (const manual of input.manualQuantities ?? []) {
    const key = itemKey(manual.price_list_id);
    if (activeItems.has(key)) continue;
    if (parseDecimal(manual.qtde ?? 0, `quantidade do item ${key}`).coefficient === 0n) continue;
    const name = input.priceList.find((item) => itemKey(item.id) === key)?.item ?? key;
    throw new BillingDomainError(
      "MANUAL_ITEM_NOT_BILLED",
      `A quantidade salva de ${name} não entra na fatura: o item saiu da Tabela de preços. Salve as quantidades de novo ou reative o item.`,
    );
  }
}

/**
 * Pure emission decision. An already emitted period returns its persisted
 * snapshot unchanged; no current LPU or usage data is consulted again.
 */
export function prepareInvoiceEmission(
  currentPeriod: Readonly<Record<string, unknown>> | null,
  input: BillingCalculationInput,
  options: InvoiceEmissionOptions,
): PreparedInvoiceEmission {
  if (!currentPeriod) {
    throw new BillingDomainError(
      "PERIOD_NOT_FOUND",
      `Competencia ${input.competencia} nao encontrada.`,
    );
  }

  const persistedCompetencia = currentPeriod.competencia;
  if (
    persistedCompetencia !== undefined &&
    persistedCompetencia !== input.competencia
  ) {
    throw new BillingDomainError(
      "PERIOD_COMPETENCIA_MISMATCH",
      `Documento ${String(persistedCompetencia)} nao corresponde a ${input.competencia}.`,
    );
  }

  const status = currentPeriod.status ?? "aberto";
  assertBillingStatus(status);
  const existingSnapshot = currentPeriod[INVOICE_SNAPSHOT_FIELD];

  if (status === "emitido") {
    const snapshot = invoiceSnapshotFromUnknown(existingSnapshot);
    if (snapshot.competencia !== input.competencia) {
      throw new BillingDomainError(
        "INVALID_SNAPSHOT",
        `O snapshot pertence a competencia ${snapshot.competencia}.`,
      );
    }
    return { snapshot, periodUpdate: null, idempotent: true };
  }

  if (status !== "aberto") {
    throw new BillingDomainError(
      "PERIOD_NOT_OPEN",
      `A competencia ${input.competencia} esta ${status} e nao pode ser emitida.`,
    );
  }
  if (existingSnapshot !== undefined && existingSnapshot !== null) {
    throw new BillingDomainError(
      "SNAPSHOT_ALREADY_EXISTS",
      `A competencia ${input.competencia} ja possui snapshot e nao pode sobrescreve-lo.`,
    );
  }

  assertBillingStatusTransition("aberto", "emitido", {
    competencia: input.competencia,
    now: options.issuedAt,
  });
  assertCompetenciaClosed(input.competencia, options.issuedAt);
  assertManualQuantitiesBilled(input);
  const snapshot = buildInvoiceSnapshot(input, options);
  const timestamp = options.firestoreTimestamp ?? options.issuedAt;
  const periodUpdate = Object.freeze({
    competencia: input.competencia,
    status: "emitido",
    total_cents: snapshot.total_cents,
    total: snapshot.total,
    emitido_em: snapshot.issued_at,
    updated_at: timestamp,
    [INVOICE_SNAPSHOT_FIELD]: snapshot,
  });

  return { snapshot, periodUpdate, idempotent: false };
}

/**
 * Intended for `firestore.runTransaction((tx) => emitInvoiceInTransaction(...))`.
 * Inputs from price list, usage and manual quantities should be read before this
 * call or by the same transaction, then supplied as a stable calculation input.
 */
export async function emitInvoiceInTransaction(
  transaction: Transaction,
  periodRef: DocumentReference<DocumentData>,
  input: BillingCalculationInput,
  options: InvoiceEmissionOptions,
): Promise<Readonly<InvoiceSnapshot>> {
  const periodSnapshot = await transaction.get(periodRef);
  const opened = !periodSnapshot.exists && options.openPeriod ? options.openPeriod() : null;
  const prepared = prepareInvoiceEmission(
    periodSnapshot.exists ? (periodSnapshot.data() ?? null) : opened,
    input,
    options,
  );
  if (prepared.periodUpdate) {
    transaction.set(
      periodRef,
      opened ? { ...opened, ...prepared.periodUpdate } : prepared.periodUpdate,
      { merge: true },
    );
  }
  return prepared.snapshot;
}

// Explicit long name for integrations that prefer the domain in the symbol.
export const emitBillingInvoiceInTransaction = emitInvoiceInTransaction;
