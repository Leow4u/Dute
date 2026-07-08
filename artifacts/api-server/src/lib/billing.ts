import {
  db,
  billingPriceListTable,
  billingConfigTable,
  billingPeriodsTable,
  billingManualTable,
  billingInvoiceItemsTable,
  productsTable,
  skusTable,
  movementsTable,
} from "@workspace/db";
import { sql, eq, and, gte, lte, asc } from "drizzle-orm";

export const GRUPOS: Record<string, { label: string; emoji: string; ordem: number }> = {
  armazenamento: { label: "Armazenamento", emoji: "📦", ordem: 1 },
  ad_valorem: { label: "Ad Valorem", emoji: "💰", ordem: 2 },
  recebimento: { label: "Recebimento", emoji: "📥", ordem: 3 },
  expedicao: { label: "Expedição", emoji: "📤", ordem: 4 },
  servicos: { label: "Serviços de Valor Agregado", emoji: "⚙️", ordem: 5 },
  transporte: { label: "Abastecimento / Transporte", emoji: "🚚", ordem: 6 },
};

export const AUTO_SOURCES = ["ad_valorem", "mov_entrada_pecas", "mov_saida_pecas", "mov_count"] as const;

export interface LineItem {
  price_list_id: number | null;
  grupo: string;
  item: string;
  unidade: string | null;
  qtde: number;
  valor_unit: number;
  total: number;
  auto: boolean;
  auto_source: string | null;
  observacao: string | null;
}

export interface GroupResult {
  grupo: string;
  label: string;
  emoji: string;
  ordem: number;
  total: number;
  itens: LineItem[];
}

export interface PeriodResult {
  competencia: string;
  status: string;
  custo_estoque: number;
  ad_valorem_rate: number;
  grupos: GroupResult[];
  total: number;
  emitido_em: string | null;
  email_enviado_em: string | null;
  pago_em: string | null;
}

export function monthRange(competencia: string) {
  const [y, m] = competencia.split("-").map(Number);
  const start = `${competencia}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${competencia}-${String(last).padStart(2, "0")}`;
  return { start, end };
}

export function isValidCompetencia(c: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(c);
}

export async function getConfig() {
  let [cfg] = await db.select().from(billingConfigTable).where(eq(billingConfigTable.id, 1));
  if (!cfg) {
    [cfg] = await db.insert(billingConfigTable).values({ id: 1 }).returning();
  }
  return cfg;
}

export async function getInventoryCost(): Promise<number> {
  const rows = await db
    .select({
      custo: sql<number>`coalesce(sum(${productsTable.preco_unit}::float8 * ${skusTable.estoque_atual}), 0)`,
    })
    .from(productsTable)
    .leftJoin(skusTable, eq(skusTable.cod_cliente, productsTable.cod_cliente));
  return Number(rows[0]?.custo || 0);
}

async function getMovementAggregates(competencia: string) {
  const { start, end } = monthRange(competencia);
  const rows = await db
    .select({
      entradas: sql<number>`coalesce(sum(case when ${movementsTable.sinal} > 0 then ${movementsTable.qtde} else 0 end),0)::int`,
      saidas: sql<number>`coalesce(sum(case when ${movementsTable.sinal} < 0 then ${movementsTable.qtde} else 0 end),0)::int`,
      total_movs: sql<number>`count(*)::int`,
    })
    .from(movementsTable)
    .where(and(gte(movementsTable.data, start), lte(movementsTable.data, end)));
  return {
    entradas: Number(rows[0]?.entradas || 0),
    saidas: Number(rows[0]?.saidas || 0),
    total_movs: Number(rows[0]?.total_movs || 0),
  };
}

function groupLines(lines: LineItem[]): { grupos: GroupResult[]; total: number } {
  const map = new Map<string, GroupResult>();
  for (const l of lines) {
    const meta = GRUPOS[l.grupo] ?? { label: l.grupo, emoji: "•", ordem: 99 };
    let g = map.get(l.grupo);
    if (!g) {
      g = { grupo: l.grupo, label: meta.label, emoji: meta.emoji, ordem: meta.ordem, total: 0, itens: [] };
      map.set(l.grupo, g);
    }
    g.itens.push(l);
    g.total += l.total;
  }
  const grupos = Array.from(map.values()).sort((a, b) => a.ordem - b.ordem);
  const total = grupos.reduce((s, g) => s + g.total, 0);
  return { grupos, total };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Monta as linhas de uma competência em aberto (valores ao vivo).
async function computeOpen(competencia: string, periodId: number | null): Promise<PeriodResult> {
  const cfg = await getConfig();
  const rate = Number(cfg.ad_valorem_rate);
  const [priceList, custo, movs] = await Promise.all([
    db.select().from(billingPriceListTable).where(eq(billingPriceListTable.ativo, true)).orderBy(asc(billingPriceListTable.ordem)),
    getInventoryCost(),
    getMovementAggregates(competencia),
  ]);

  const manualMap = new Map<number, { qtde: number; observacao: string | null }>();
  if (periodId != null) {
    const manualRows = await db.select().from(billingManualTable).where(eq(billingManualTable.period_id, periodId));
    for (const r of manualRows) manualMap.set(r.price_list_id, { qtde: Number(r.qtde), observacao: r.observacao });
  }

  const lines: LineItem[] = priceList.map((p) => {
    const valorUnit = Number(p.valor_unit);
    const manual = manualMap.get(p.id);
    let qtde = 0;
    let total = 0;
    let auto = false;

    switch (p.auto_source) {
      case "ad_valorem":
        auto = true;
        qtde = round2(custo);
        total = round2(custo * rate);
        break;
      case "mov_entrada_pecas":
        auto = true;
        qtde = movs.entradas;
        total = round2(qtde * valorUnit);
        break;
      case "mov_saida_pecas":
        auto = true;
        qtde = movs.saidas;
        total = round2(qtde * valorUnit);
        break;
      case "mov_count":
        auto = true;
        qtde = movs.total_movs;
        total = round2(qtde * valorUnit);
        break;
      default:
        qtde = manual ? manual.qtde : 0;
        total = round2(qtde * valorUnit);
    }

    return {
      price_list_id: p.id,
      grupo: p.grupo,
      item: p.item,
      unidade: p.unidade,
      qtde,
      valor_unit: valorUnit,
      total,
      auto,
      auto_source: p.auto_source,
      observacao: manual?.observacao ?? null,
    };
  });

  const { grupos, total } = groupLines(lines);
  return {
    competencia,
    status: "aberto",
    custo_estoque: round2(custo),
    ad_valorem_rate: rate,
    grupos,
    total: round2(total),
    emitido_em: null,
    email_enviado_em: null,
    pago_em: null,
  };
}

// Lê as linhas congeladas de uma competência já emitida.
async function computeFrozen(period: typeof billingPeriodsTable.$inferSelect): Promise<PeriodResult> {
  const items = await db
    .select()
    .from(billingInvoiceItemsTable)
    .where(eq(billingInvoiceItemsTable.period_id, period.id))
    .orderBy(asc(billingInvoiceItemsTable.ordem));

  const lines: LineItem[] = items.map((i) => ({
    price_list_id: null,
    grupo: i.grupo,
    item: i.item,
    unidade: i.unidade,
    qtde: Number(i.qtde),
    valor_unit: Number(i.valor_unit),
    total: Number(i.total),
    auto: false,
    auto_source: null,
    observacao: null,
  }));

  const { grupos, total } = groupLines(lines);
  return {
    competencia: period.competencia,
    status: period.status,
    custo_estoque: Number(period.custo_estoque || 0),
    ad_valorem_rate: Number(period.ad_valorem_rate || 0),
    grupos,
    total: period.total != null ? Number(period.total) : round2(total),
    emitido_em: period.emitido_em ? period.emitido_em.toISOString() : null,
    email_enviado_em: period.email_enviado_em ? period.email_enviado_em.toISOString() : null,
    pago_em: period.pago_em ? period.pago_em.toISOString() : null,
  };
}

export async function getPeriodByCompetencia(competencia: string) {
  const [p] = await db.select().from(billingPeriodsTable).where(eq(billingPeriodsTable.competencia, competencia));
  return p ?? null;
}

// Resultado de uma competência: congelado se emitida/paga, ao vivo se aberta.
export async function computePeriod(competencia: string): Promise<PeriodResult> {
  const period = await getPeriodByCompetencia(competencia);
  if (period && period.status !== "aberto") {
    return computeFrozen(period);
  }
  return computeOpen(competencia, period?.id ?? null);
}

// Congela as linhas de uma competência na tabela de itens da fatura.
// Aceita um executor opcional (transação Drizzle) para que o congelamento e a
// transição de status da competência ocorram atomicamente.
export async function freezeInvoiceItems(
  periodId: number,
  result: PeriodResult,
  executor: any = db,
) {
  const rows: (typeof billingInvoiceItemsTable.$inferInsert)[] = [];
  let ordem = 0;
  for (const g of result.grupos) {
    for (const it of g.itens) {
      rows.push({
        period_id: periodId,
        grupo: it.grupo,
        item: it.item,
        unidade: it.unidade,
        qtde: String(it.qtde),
        valor_unit: String(it.valor_unit),
        total: String(it.total),
        ordem: ordem++,
      });
    }
  }
  await executor.delete(billingInvoiceItemsTable).where(eq(billingInvoiceItemsTable.period_id, periodId));
  if (rows.length) await executor.insert(billingInvoiceItemsTable).values(rows);
}
