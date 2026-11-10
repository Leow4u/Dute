/**
 * Mapa do armazém (docs/mapa-do-armazem-enderecamento-dirigido.md, seção
 * 5.6): cada prateleira com as caixas guardadas nela, a frente usada e o que
 * ainda cabe, por zona de cliente. Só leitura e conta: posições e caixas vêm
 * das coleções; as Functions validam a guarda confirmada.
 *
 * A frente é ocupada pelas caixas apoiadas na prateleira. Caixas empilhadas
 * continuam contando no peso e nos totais. A referência na base estima caixas
 * de referência (50 × 50 × 35 cm) na base; o motor verifica empilhamento.
 */

import { nomeComTamanho } from "@workspace/dominio";

import type { AnyRecord } from "@/lib/warehouse-ops/model";
import { boxBalanceUnits, boxIsOpen, type WarehouseBox } from "@/lib/warehouse-boxes";
import { calculateShelfVolume } from "@/lib/warehouse-volume";
import { type WarehousePosition, REFERENCE_BOX, sortPositions } from "@/lib/warehouse-positions";

const TOLERANCE_M = 0.001;

export type ShelfState = "free" | "partial" | "full" | "review" | "blocked";

export const SHELF_STATE_LABELS: Record<ShelfState, string> = {
  free: "sem caixas registradas",
  partial: "parcial",
  full: "sem vaga na base",
  review: "em verificação",
  blocked: "bloqueada",
};

export const SHELF_STATES: ShelfState[] = ["free", "partial", "full", "review", "blocked"];

export type Shelf = {
  code: string;
  position: WarehousePosition;
  zone: string | null;
  boxes: WarehouseBox[];
  /** Inclui guardas em andamento que ainda reservam espaço na prateleira. */
  volumeBoxes: WarehouseBox[];
  /** Estimativa geométrica independente da frente e da capacidade de encaixe. */
  volume: ReturnType<typeof calculateShelfVolume>;
  front_used_m: number;
  free_front_m: number;
  weight_used_kg: number;
  unit_count: number;
  sku_codes: string[];
  /** Caixas de referência que ainda cabem, numa camada, pela frente livre e pelo peso. */
  remaining_reference_boxes: number;
  /** O saldo do estoque na prateleira, com ou sem caixa registrada. */
  saldo: SaldoDaPrateleira;
  /** As caixas que saíram desta prateleira nas separações (vazias), a mais recente primeiro. */
  saidas: WarehouseBox[];
  /** Frente usada sobre a frente total, de 0 a 1. */
  fill: number;
  state: ShelfState;
};

/** Quantas saídas a ficha da prateleira mostra: as mais recentes. */
export const SAIDAS_DA_PRATELEIRA = 10;

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

/** A frente que a caixa ocupa: o backend grava front_m; sem ele, o menor lado. */
export function boxFront(box: Pick<WarehouseBox, "front_m" | "length_m" | "width_m" | "support_box_code" | "base_height_m">) {
  if (box.support_box_code && Number(box.base_height_m) > 0) return 0;
  if (box.front_m != null && box.front_m > 0) return box.front_m;
  return Math.min(box.length_m, box.width_m);
}

/** Quantas caixas de referência cabem numa frente livre, na orientação de menor frente que entra na profundidade. */
export function referenceBoxesThatFit(
  position: Pick<WarehousePosition, "depth_m" | "height_m">,
  freeFront: number,
) {
  if (REFERENCE_BOX.height_m > position.height_m + TOLERANCE_M) return 0;
  const fronts = [
    [REFERENCE_BOX.length_m, REFERENCE_BOX.width_m],
    [REFERENCE_BOX.width_m, REFERENCE_BOX.length_m],
  ]
    .filter(([, depth]) => depth! <= position.depth_m + TOLERANCE_M)
    .map(([front]) => front!);
  if (!fronts.length) return 0;
  return Math.max(0, Math.floor((freeFront + TOLERANCE_M) / Math.min(...fronts)));
}

/**
 * O saldo do estoque na prateleira (stock_balances), com ou sem caixa
 * registrada. A guarda por linha move o saldo e não registra caixa: sem isto,
 * a prateleira com mercadoria parecia vazia no mapa.
 */
export type SaldoDaPrateleira = {
  unidades: number;
  itens: Array<{ sku: string; qty: number }>;
};

export type SaldoDaPosicao = {
  location_id?: unknown;
  sku_code?: unknown;
  qty_on_hand?: unknown;
};

export function saldoPorPrateleira(balances: SaldoDaPosicao[]): Map<string, SaldoDaPrateleira> {
  const porSku = new Map<string, Map<string, number>>();
  for (const balance of balances) {
    const code = String(balance.location_id ?? "").trim().toUpperCase();
    const sku = String(balance.sku_code ?? "").trim();
    const qty = Number(balance.qty_on_hand ?? 0);
    if (!code || !sku || !Number.isFinite(qty) || qty <= 0) continue;
    const skus = porSku.get(code) ?? new Map<string, number>();
    skus.set(sku, (skus.get(sku) ?? 0) + qty);
    porSku.set(code, skus);
  }
  const result = new Map<string, SaldoDaPrateleira>();
  for (const [code, skus] of porSku) {
    const itens = [...skus].map(([sku, qty]) => ({ sku, qty })).sort((a, b) => a.sku.localeCompare(b.sku));
    result.set(code, { unidades: round(itens.reduce((soma, item) => soma + item.qty, 0)), itens });
  }
  return result;
}

const SEM_SALDO: SaldoDaPrateleira = { unidades: 0, itens: [] };

export function buildShelves(positions: WarehousePosition[], boxes: WarehouseBox[], balances: SaldoDaPosicao[] = []): Shelf[] {
  const saldos = saldoPorPrateleira(balances);
  const byLocation = new Map<string, WarehouseBox[]>();
  // A caixa de que a separação tirou tudo (parte 3c): não ocupa mais a prateleira, fica no registro dela.
  const emptied = new Map<string, WarehouseBox[]>();
  for (const box of boxes) {
    const code = box.location_id.toUpperCase();
    if (box.status === "emptied") {
      emptied.set(code, [...(emptied.get(code) ?? []), box]);
      continue;
    }
    if (box.status !== "stored" && box.status !== "committing") continue;
    byLocation.set(code, [...(byLocation.get(code) ?? []), box]);
  }
  return sortPositions(positions).map((position) => {
    const code = position.code.toUpperCase();
    const volumeBoxes = byLocation.get(code) ?? [];
    const stored = volumeBoxes.filter((box) => box.status === "stored").sort((left, right) => left.code.localeCompare(right.code));
    const front_used_m = round(stored.reduce((sum, box) => sum + boxFront(box), 0));
    const free_front_m = round(Math.max(0, position.length_m - front_used_m));
    const weight_used_kg = round(stored.reduce((sum, box) => sum + (box.gross_weight_kg ?? 0), 0));
    const weightFull = position.max_weight_kg != null && position.max_weight_kg > 0 && weight_used_kg >= position.max_weight_kg - TOLERANCE_M;
    const remaining_reference_boxes = weightFull ? 0 : referenceBoxesThatFit(position, free_front_m);
    const status = position.status || "active";
    const state: ShelfState =
      status === "blocked"
        ? "blocked"
        : status === "review"
          ? "review"
          : stored.length === 0
            ? "free"
            : remaining_reference_boxes > 0
              ? "partial"
              : "full";
    return {
      code,
      position,
      zone: position.customer_code?.trim() || null,
      boxes: stored,
      volumeBoxes,
      volume: calculateShelfVolume(position, volumeBoxes),
      front_used_m,
      free_front_m,
      weight_used_kg,
      // O que as caixas têm agora: a entrada menos o que as separações tiraram.
      unit_count: stored.reduce((sum, box) => sum + boxBalanceUnits(box), 0),
      sku_codes: [...new Set(stored.flatMap((box) => box.sku_codes))],
      remaining_reference_boxes,
      saldo: saldos.get(code) ?? SEM_SALDO,
      saidas: (emptied.get(code) ?? [])
        .sort((left, right) => (right.emptied_at ?? "").localeCompare(left.emptied_at ?? "") || right.code.localeCompare(left.code))
        .slice(0, SAIDAS_DA_PRATELEIRA),
      fill: position.length_m > 0 ? Math.min(1, front_used_m / position.length_m) : 0,
      state,
    };
  });
}

/** "all" é todas as zonas; null é a zona sem cliente. */
export type ZoneFilter = "all" | string | null;

export function inZone(shelf: Shelf, zone: ZoneFilter) {
  return zone === "all" || shelf.zone === zone;
}

/** Clientes com prateleira, em ordem; a zona sem cliente por último, se existir. */
export function zonesOf(shelves: Shelf[]): Array<string | null> {
  const customers = [...new Set(shelves.map((shelf) => shelf.zone).filter((zone): zone is string => Boolean(zone)))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  return shelves.some((shelf) => shelf.zone === null) ? [...customers, null] : customers;
}

export type ZoneSummary = {
  zone: ZoneFilter;
  positions: number;
  /** Prateleiras com ao menos uma caixa: a base da fatura manual. */
  occupied: number;
  empty: number;
  /** Bloqueadas ou em verificação. */
  unavailable: number;
  boxes: number;
  /** Volume geométrico registrado; null quando alguma caixa não tem medidas válidas. */
  occupied_volume_m3: number | null;
  units: number;
  products: number;
  remaining_reference_boxes: number;
  /** Frente usada sobre a frente total das prateleiras disponíveis, de 0 a 1. */
  fill: number;
};

export function summarizeZone(shelves: Shelf[], zone: ZoneFilter): ZoneSummary {
  const selected = shelves.filter((shelf) => inZone(shelf, zone));
  const available = selected.filter((shelf) => shelf.state !== "blocked" && shelf.state !== "review");
  const totalFront = available.reduce((sum, shelf) => sum + shelf.position.length_m, 0);
  const usedFront = available.reduce((sum, shelf) => sum + shelf.front_used_m, 0);
  return {
    zone,
    positions: selected.length,
    occupied: selected.filter((shelf) => shelf.boxes.length > 0).length,
    empty: selected.filter((shelf) => shelf.boxes.length === 0 && shelf.state === "free").length,
    unavailable: selected.length - available.length,
    boxes: selected.reduce((sum, shelf) => sum + shelf.boxes.length, 0),
    occupied_volume_m3: selected.some((shelf) => shelf.volume.occupiedM3 === null)
      ? null
      : selected.reduce((sum, shelf) => sum + (shelf.volume.occupiedM3 ?? 0), 0),
    units: selected.reduce((sum, shelf) => sum + shelf.unit_count, 0),
    products: new Set(selected.flatMap((shelf) => shelf.sku_codes)).size,
    remaining_reference_boxes: available.reduce((sum, shelf) => sum + shelf.remaining_reference_boxes, 0),
    fill: totalFront > 0 ? Math.min(1, usedFront / totalFront) : 0,
  };
}

export function groupByAisle(shelves: Shelf[]): Array<{ aisle: string; shelves: Shelf[] }> {
  const groups = new Map<string, Shelf[]>();
  for (const shelf of shelves) {
    const aisle = shelf.position.aisle;
    groups.set(aisle, [...(groups.get(aisle) ?? []), shelf]);
  }
  return [...groups.entries()].map(([aisle, items]) => ({ aisle, shelves: items }));
}

export type SkuIndex = Map<string, { name: string; clientCode: string }>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

/** Nome e código do cliente por SKU, a partir das linhas de /api/skus. */
export function skuIndexFromRows(rows: AnyRecord[]): SkuIndex {
  const index: SkuIndex = new Map();
  for (const row of rows) {
    const sku = text(row.cod_btg) || text(row.sku_code) || text(row.id);
    if (!sku) continue;
    index.set(sku.toUpperCase(), {
      name: text(row.produto) || text(row.product_name) || text(row.nome),
      clientCode: text(row.cod_cliente) || text(row.client_item_code),
    });
  }
  return index;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

/** Busca por caixa, produto ou código: a prateleira aparece se algo nela bate. */
export function shelfMatches(shelf: Shelf, term: string, skuIndex: SkuIndex) {
  const needle = normalize(term);
  if (!needle) return true;
  if (shelf.code.includes(needle)) return true;
  for (const box of shelf.boxes) {
    if (box.code.includes(needle)) return true;
  }
  for (const sku of new Set([...shelf.sku_codes, ...shelf.saldo.itens.map((item) => item.sku)])) {
    if (normalize(sku).includes(needle)) return true;
    const info = skuIndex.get(sku.toUpperCase());
    if (info && (normalize(info.name).includes(needle) || normalize(info.clientCode).includes(needle))) return true;
  }
  return false;
}

export type BoxContentSource = {
  box_code?: string;
  sku_code?: string;
  client_item_code?: string;
  product_name?: string;
  counted_qty?: number;
};

export type BoxContentLine = { code: string; name: string; qty: number | null };

const byQuantity = (left: BoxContentLine, right: BoxContentLine) =>
  (right.qty ?? -1) - (left.qty ?? -1) || left.name.localeCompare(right.name, "pt-BR");

/**
 * O que tem na caixa: a caixa do recebimento traz o conteúdo nela (parte 6);
 * a da abertura, nas linhas da sessão, produto e quantidade; sem nada disso,
 * só os SKUs que a caixa conhece, com o nome do catálogo.
 */
export function boxContents(box: WarehouseBox, lines: BoxContentSource[], skuIndex: SkuIndex): BoxContentLine[] {
  return saldoDoConteudo(conteudoDeEntrada(box, lines, skuIndex), box);
}

/** O saldo (separação com caixas, parte 3): a entrada menos o que as separações tiraram de cada SKU, sem as linhas zeradas. */
function saldoDoConteudo(entrada: Map<string, BoxContentLine>, box: Pick<WarehouseBox, "taken_lines">): BoxContentLine[] {
  for (const line of box.taken_lines ?? []) {
    const atual = entrada.get(line.sku_code.toUpperCase());
    if (!atual || atual.qty == null) continue;
    atual.qty -= line.qty;
    if (atual.qty <= 0) entrada.delete(line.sku_code.toUpperCase());
  }
  return [...entrada.values()].sort(byQuantity);
}

function conteudoDeEntrada(box: WarehouseBox, lines: BoxContentSource[], skuIndex: SkuIndex): Map<string, BoxContentLine> {
  if (box.lines.length) {
    const own = new Map<string, BoxContentLine>();
    for (const line of box.lines) {
      const key = (line.sku_code || line.client_item_code).toUpperCase();
      const current = own.get(key);
      if (current) {
        current.qty = (current.qty ?? 0) + line.counted_qty;
      } else {
        const nome = line.product_name || skuIndex.get(key)?.name || line.sku_code || line.client_item_code;
        own.set(key, {
          code: line.client_item_code || line.sku_code,
          name: nomeComTamanho({ nome, codigo: line.client_item_code, tamanho: line.size }) || nome,
          qty: line.counted_qty,
        });
      }
    }
    return own;
  }
  const grouped = new Map<string, BoxContentLine>();
  for (const line of lines) {
    if (text(line.box_code).toUpperCase() !== box.code) continue;
    const sku = text(line.sku_code) || text(line.client_item_code);
    if (!sku) continue;
    const current = grouped.get(sku.toUpperCase());
    const qty = Number(line.counted_qty ?? 0) || 0;
    if (current) {
      current.qty = (current.qty ?? 0) + qty;
    } else {
      grouped.set(sku.toUpperCase(), {
        code: text(line.client_item_code) || sku,
        name: text(line.product_name) || skuIndex.get(sku.toUpperCase())?.name || sku,
        qty,
      });
    }
  }
  for (const sku of box.sku_codes) {
    if (grouped.has(sku.toUpperCase())) continue;
    const info = skuIndex.get(sku.toUpperCase());
    grouped.set(sku.toUpperCase(), { code: info?.clientCode || sku, name: info?.name || sku, qty: null });
  }
  return grouped;
}

const dataDaSaida = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });

/** "aberta": a caixa guardada de onde já saiu alguma coisa; "guardada", a intacta. */
export function estadoDaCaixa(box: Pick<WarehouseBox, "status" | "taken_units">): "aberta" | "guardada" {
  return boxIsOpen(box) ? "aberta" : "guardada";
}

/** A data de um registro da caixa, no fuso de São Paulo; null sem data. */
export function dataDaCaixa(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dataDaSaida.format(date);
}

/**
 * "inteira em 11/11/2026 · PED-0001, volume 11" ou "vazia em 12/11/2026 ·
 * PED-0001": como a caixa saiu da prateleira. O volume só na caixa que virou
 * volume ("Levar a caixa", separação com caixas, parte 4).
 */
export function textoDaSaida(box: Pick<WarehouseBox, "emptied_at" | "emptied_whole" | "emptied_order_number" | "emptied_volume_number">): string {
  const data = dataDaCaixa(box.emptied_at);
  const volume = box.emptied_volume_number ? `volume ${box.emptied_volume_number}` : null;
  const pedido = [box.emptied_order_number, volume].filter(Boolean).join(", ");
  return [`${box.emptied_whole ? "inteira" : "vazia"}${data ? ` em ${data}` : ""}`, pedido].filter(Boolean).join(" · ");
}
