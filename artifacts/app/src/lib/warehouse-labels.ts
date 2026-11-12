/**
 * Etiquetas de caixa e de posição (docs/mapa-do-armazem-enderecamento-
 * dirigido.md, seção 6) e do volume de expedição (separação com caixas,
 * parte 4c). O conteúdo é definido aqui, uma vez; o desenho fica em
 * components/labels e a impressão é do navegador (Imprimir → Salvar PDF),
 * como a fatura.
 *
 * Duas saídas (decisões de 11 e 12/11/2026, docs/mockups/EtiquetaA4*.dc.html):
 * - "Folha A4", em papel comum: a caixa e o volume saem em etiquetas de
 *   148,5 × 105 mm, quatro por folha deitada, cada uma completa, porque é
 *   recortada e presa na caixa; a posição continua com 101,6 × 50,8 mm, dez
 *   por folha em pé. As folhas levam as linhas de corte.
 * - "Rolo Zebra": uma etiqueta de 101,6 × 50,8 mm por página, como sempre.
 */

import { nomeComTamanho, tamanhoDoProduto } from "@workspace/dominio";

import type { WarehouseBox } from "@/lib/warehouse-boxes";
import { boxBalanceUnits, boxIsOpen, boxOriginLabel, formatBoxDimensions } from "@/lib/warehouse-boxes";
import { type WarehousePosition, formatKilos, formatMeters } from "@/lib/warehouse-positions";
import { pesoDoVolume, textoDeVolumes, type VolumeDoPedido } from "@/lib/warehouse-ops/volumes-do-pedido";

/** A etiqueta do rolo da Zebra, que é também a da posição na folha A4. */
export const LABEL_MM = { width: 101.6, height: 50.8 } as const;

/** A folha A4 em pé das posições: dez etiquetas, duas colunas por cinco linhas, sem vão; margens centram o bloco. */
export const SHEET_MM = {
  width: 210,
  height: 297,
  columns: 2,
  rows: 5,
  gapX: 0,
  gapY: 0,
} as const;

export const POSITIONS_PER_SHEET = SHEET_MM.columns * SHEET_MM.rows;

/** A etiqueta da caixa e do volume na folha A4: 148,5 × 105 mm, um quarto da folha. */
export const SHEET_LABEL_MM = { width: 148.5, height: 105 } as const;

/** A folha A4 deitada da caixa e do volume: quatro etiquetas, duas colunas por duas linhas, encostadas. */
export const BOX_SHEET_MM = { width: 297, height: 210, columns: 2, rows: 2 } as const;

export const BOXES_PER_SHEET = BOX_SHEET_MM.columns * BOX_SHEET_MM.rows;

export function sheetMargins() {
  const blockWidth = SHEET_MM.columns * LABEL_MM.width + (SHEET_MM.columns - 1) * SHEET_MM.gapX;
  const blockHeight = SHEET_MM.rows * LABEL_MM.height + (SHEET_MM.rows - 1) * SHEET_MM.gapY;
  return {
    left: Math.round(((SHEET_MM.width - blockWidth) / 2) * 100) / 100,
    top: Math.round(((SHEET_MM.height - blockHeight) / 2) * 100) / 100,
  };
}

export type LabelMode = "a4" | "zebra";

/**
 * Uma linha da etiqueta: o código do cliente, o SKU, o nome com o tamanho
 * (decisão 32) e a quantidade. `size` é o tamanho que o nome leva no fim
 * (" · XGG"), para a folha A4 mostrar o nome e o tamanho separados e nunca
 * cortar o tamanho; sem tamanho, a linha não tem o campo.
 */
export type LabelContentLine = { code: string; sku: string; name: string; qty: number; size?: string };

export type BoxLabelData = {
  kind: "box";
  code: string;
  position: string;
  customer: string;
  dimensions: string;
  /** As unidades da caixa inteira, iguais em todas as etiquetas dela. */
  units: number;
  /** Os produtos desta etiqueta: os primeiros na primeira, os outros nas de continuação. */
  lines: LabelContentLine[];
  /** A etiqueta entre as da mesma caixa ("etiqueta 2 de 3"); com tudo na primeira, 1 de 1. */
  part: number;
  parts: number;
  origin: string;
  /** A data de entrada da caixa (a da guarda), que é a do FIFO; antes da guarda, a da impressão. */
  date: string;
  /** Na caixa aberta, de quando é o saldo ("saldo em 12/11/2026"); null na caixa intacta. */
  balanceAt: string | null;
};

export type PositionLabelData = {
  kind: "position";
  code: string;
  aisle: string;
  shelf: number;
  zone: string | null;
  dimensions: string;
  maxWeight: string;
};

/**
 * A etiqueta do volume de expedição (docs/mockups/WmsSepararEtiquetaVolume
 * .dc.html e WmsEtiquetaTodosVolume.dc.html). Vai ao cliente: leva o pedido,
 * o volume, o cliente, o destino, a data, o peso e os produtos com o código
 * do cliente; nunca a caixa (`CX-`), a posição nem valor.
 */
export type VolumeLabelData = {
  kind: "volume";
  /** "PED-0001-V12": o que o código de barras lê, e a chave da etiqueta. */
  code: string;
  /** "PED-0001" */
  order: string;
  number: number;
  /** O total de volumes do pedido ("de 42"): só depois de concluído (decisão 12). */
  total: number | null;
  /** "BTG Pactual · Agência Faria Lima" */
  recipient: string;
  /** "12/11/2026 · 11,6 kg": quando o volume fechou e, se houver, o peso. */
  closing: string;
  /** As unidades do volume inteiro, iguais em todas as etiquetas dele. */
  units: number;
  lines: LabelContentLine[];
  part: number;
  parts: number;
};

export type LabelData = BoxLabelData | PositionLabelData | VolumeLabelData;

/** O que a etiqueta precisa de uma linha da abertura. */
export type BoxContentSource = {
  box_code?: string;
  sku_code?: string;
  client_item_code?: string;
  product_name?: string;
  size?: string;
  counted_qty?: number;
};

/**
 * Toda etiqueta mostra todos os produtos (separação com caixas, decisão 13 de
 * 10/11/2026). No rolo, a primeira leva até cinco e as de continuação, do
 * mesmo tamanho e sem código de barras, onze cada
 * (docs/mockups/WmsEtiquetaTodosCaixa.dc.html). Na folha A4, cada etiqueta é
 * completa e leva até cinco: uma caixa com 11 a 16 produtos sai em 3 ou 4
 * etiquetas na folha e em 2 no rolo. Os números são o que cabe no desenho de
 * components/labels.
 */
export const FIRST_LABEL_LINES = 5;
export const CONTINUATION_LABEL_LINES = 11;
export const SHEET_LABEL_LINES = 5;

/** Quantos produtos cabem na primeira etiqueta e em cada uma das outras, por saída. */
export function labelLines(mode: LabelMode): { first: number; next: number } {
  return mode === "zebra" ? { first: FIRST_LABEL_LINES, next: CONTINUATION_LABEL_LINES } : { first: SHEET_LABEL_LINES, next: SHEET_LABEL_LINES };
}

/** O conteúdo repartido pelas etiquetas: a primeira e as seguintes, na ordem. */
function labelChunks<T>(content: T[], mode: LabelMode): T[][] {
  const { first, next } = labelLines(mode);
  const pages = [content.slice(0, first)];
  for (let start = first; start < content.length; start += next) {
    pages.push(content.slice(start, start + next));
  }
  return pages;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });

function sortedContent(grouped: Map<string, LabelContentLine>) {
  return [...grouped.values()].sort((left, right) => right.qty - left.qty || left.name.localeCompare(right.name, "pt-BR"));
}

/** O nome na etiqueta segue o padrão do produto: o mesmo nome e o tamanho ao lado ("Polo Masculino Piquet Preto · G"). */
function labelName(product: { product_name?: unknown; client_item_code?: unknown; size?: unknown }, fallback: string) {
  const nome = String(product.product_name ?? "").trim() || fallback;
  return nomeComTamanho({ nome, codigo: product.client_item_code, tamanho: product.size }) || nome;
}

/** O tamanho que o nome leva no fim, como nomeComTamanho o põe; tamanho único (U) e produto sem tamanho, nenhum. */
function sizeInName(name: string, product: { codigo?: unknown; tamanho?: unknown }): string | null {
  const size = tamanhoDoProduto(product);
  if (!size || size.toUpperCase() === "U") return null;
  return name.endsWith(` · ${size}`) && name.length > size.length + 3 ? size : null;
}

function contentLine(line: Omit<LabelContentLine, "size">, size: string | null): LabelContentLine {
  return size ? { ...line, size } : line;
}

/**
 * O nome e o tamanho separados, para a folha A4 encurtar o nome comprido sem
 * cortar o tamanho ("Polo Masculino Piquet Azul-Mar… · XGG").
 */
export function nameAndSize(line: Pick<LabelContentLine, "name" | "size">): { name: string; size: string | null } {
  if (line.size && line.name.endsWith(` · ${line.size}`)) {
    return { name: line.name.slice(0, -(line.size.length + 3)), size: line.size };
  }
  return { name: line.name, size: null };
}

/** Agrupa as linhas da abertura por produto, maior quantidade primeiro. */
export function boxContent(lines: BoxContentSource[], boxCode: string): LabelContentLine[] {
  const code = boxCode.trim().toUpperCase();
  const grouped = new Map<string, LabelContentLine>();
  for (const line of lines) {
    if (String(line.box_code ?? "").trim().toUpperCase() !== code) continue;
    const key = String(line.sku_code || line.client_item_code || "").trim();
    if (!key) continue;
    const qty = Number(line.counted_qty ?? 0) || 0;
    const current = grouped.get(key);
    if (current) {
      current.qty += qty;
    } else {
      const name = labelName(line, key);
      grouped.set(
        key,
        contentLine(
          {
            code: String(line.client_item_code || line.sku_code || key).trim(),
            sku: String(line.sku_code ?? "").trim(),
            name,
            qty,
          },
          sizeInName(name, { codigo: line.client_item_code, tamanho: line.size }),
        ),
      );
    }
  }
  return sortedContent(grouped);
}

/** O conteúdo que a caixa do recebimento guarda nela (parte 6): por produto, maior quantidade primeiro. */
export function ownBoxContent(box: Pick<WarehouseBox, "lines">): LabelContentLine[] {
  const grouped = new Map<string, LabelContentLine>();
  for (const line of box.lines) {
    const key = (line.sku_code || line.client_item_code).toUpperCase();
    const current = grouped.get(key);
    if (current) {
      current.qty += line.counted_qty;
    } else {
      const name = labelName(line, line.sku_code || line.client_item_code);
      grouped.set(
        key,
        contentLine(
          {
            code: line.client_item_code || line.sku_code,
            sku: line.sku_code,
            name,
            qty: line.counted_qty,
          },
          sizeInName(name, { codigo: line.client_item_code, tamanho: line.size }),
        ),
      );
    }
  }
  return sortedContent(grouped);
}

/**
 * O saldo da caixa (separação com caixas, parte 3): o conteúdo de entrada
 * menos o que as separações tiraram de cada SKU, sem as linhas zeradas.
 */
export function balanceContent(content: LabelContentLine[], taken: ReadonlyArray<{ sku_code: string; qty: number }>): LabelContentLine[] {
  if (!taken.length) return content;
  const saiu = new Map<string, number>();
  for (const line of taken) saiu.set(line.sku_code.toUpperCase(), (saiu.get(line.sku_code.toUpperCase()) ?? 0) + line.qty);
  return content
    .map((line) => ({ ...line, qty: line.qty - (saiu.get(line.sku.toUpperCase()) ?? 0) }))
    .filter((line) => line.qty > 0)
    .sort((left, right) => right.qty - left.qty || left.name.localeCompare(right.name, "pt-BR"));
}

function labelDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
}

export type ImpressaoParaRegistrar = { receipt_id: string; box_code: string; location_id: string };

/**
 * As caixas do recebimento da folha, para registrar a impressão (decisão 29):
 * a chegada, a caixa e a posição impressa. A caixa da abertura e a manual
 * não registram.
 */
export function impressoesParaRegistrar(
  boxes: Array<Pick<WarehouseBox, "code" | "status" | "location_id" | "origin">>,
): ImpressaoParaRegistrar[] {
  return boxes.flatMap((box) =>
    box.origin.kind === "receipt" && box.origin.receipt_id && boxLabelAvailability(box).ready
      ? [{ receipt_id: box.origin.receipt_id, box_code: box.code, location_id: box.location_id }]
      : [],
  );
}

/**
 * As caixas abertas da folha, para registrar a impressão da etiqueta com o
 * saldo (separação com caixas, parte 3d): a caixa sai de "Etiquetas para
 * trocar". Vale para a caixa de qualquer origem.
 */
export function saldosParaRegistrar(boxes: Array<Pick<WarehouseBox, "code" | "status" | "location_id" | "origin" | "taken_units">>): string[] {
  return boxes.filter((box) => boxIsOpen(box) && boxLabelAvailability(box).ready).map((box) => box.code);
}

export type LabelAvailability = { ready: true; reason: null } | { ready: false; reason: string };

/**
 * A etiqueta sai da caixa guardada ou com o destino confirmado (decisão 30):
 * a caixa do recebimento ainda em conferência ou sem prateleira espera o
 * destino; a da abertura, a guarda.
 */
export function boxLabelAvailability(box: Pick<WarehouseBox, "code" | "status" | "location_id" | "origin">): LabelAvailability {
  if (box.status === "stored" || (box.status === "committing" && box.location_id)) return { ready: true, reason: null };
  // A caixa de que a separação tirou tudo saiu da prateleira (separação com caixas, parte 3c).
  if (box.status === "emptied") return { ready: false, reason: `${box.code} está vazia: saiu da prateleira.` };
  if (box.origin.kind === "receipt") {
    const state = box.status === "counting" ? "em conferência" : "sem prateleira";
    return { ready: false, reason: `${box.code} ${state}: sem etiqueta até confirmar o destino.` };
  }
  return { ready: false, reason: `${box.code} aguarda a guarda.` };
}

/**
 * As etiquetas de uma caixa: a primeira, com a posição, o código de barras e
 * os primeiros produtos, e as outras com o resto, na mesma ordem (a maior
 * quantidade primeiro). Todas levam as unidades da caixa inteira. Quantos
 * produtos cada uma leva depende da saída (labelLines); sem a saída, vale a
 * da folha A4, a de menos produtos por etiqueta, que serve às duas.
 *
 * A caixa aberta (docs/mockups/WmsSepararEtiquetaCaixa.dc.html) sai com o
 * saldo e "saldo em", sem o peso de entrada. A data é sempre a de entrada da
 * caixa, que é a do FIFO.
 */
export function boxLabels(
  box: WarehouseBox,
  lines: BoxContentSource[],
  options: { printedAt?: Date; mode?: LabelMode } = {},
): BoxLabelData[] {
  // A caixa do recebimento traz o conteúdo nela; a da abertura, nas linhas da sessão.
  const entrada = box.lines.length ? ownBoxContent(box) : boxContent(lines, box.code);
  const aberta = (box.taken_units ?? 0) > 0;
  const content = balanceContent(entrada, box.taken_lines ?? []);
  const pages = labelChunks(content, options.mode ?? "a4");
  const units = content.reduce((sum, line) => sum + line.qty, 0);
  const base = {
    kind: "box" as const,
    code: box.code,
    position: box.location_id,
    customer: box.customer_code,
    dimensions: formatBoxDimensions(aberta ? { ...box, gross_weight_kg: null } : box),
    // Sem o conteúdo lido, vale o que a caixa diz ter.
    units: units || (entrada.length ? 0 : boxBalanceUnits(box)),
    origin: boxOriginLabel(box),
    date: labelDate(box.stored_at) ?? dateFormatter.format(options.printedAt ?? new Date()),
    balanceAt: aberta ? labelDate(box.balance_at) : null,
  };
  return pages.map((page, index) => ({ ...base, lines: page, part: index + 1, parts: pages.length }));
}

/** O pedido como a etiqueta do volume o diz. */
export type VolumeLabelOrder = {
  /** "PED-0001" */
  number: string;
  /** O nome do cliente. */
  customer: string;
  destination: string;
  /** O total de volumes, só com o pedido concluído. */
  total: number | null;
};

/**
 * As etiquetas de um volume: a primeira, com o pedido, o volume, o código de
 * barras e os primeiros produtos, e as outras com o resto (decisão 13), com
 * quantos cabem na saída, como a caixa. A maior quantidade primeiro. Só o
 * código do cliente.
 */
export function volumeLabels(
  volume: VolumeDoPedido,
  order: VolumeLabelOrder,
  options: { printedAt?: Date; mode?: LabelMode } = {},
): VolumeLabelData[] {
  const content = [...volume.itens]
    .map((item) => contentLine({ code: item.codigo, sku: "", name: item.nome, qty: item.quantidade }, sizeInName(item.nome, { codigo: item.codigo })))
    .sort((left, right) => right.qty - left.qty || left.name.localeCompare(right.name, "pt-BR"));
  const pages = labelChunks(content, options.mode ?? "a4");
  const base = {
    kind: "volume" as const,
    code: `${order.number}-V${volume.numero}`,
    order: order.number,
    number: volume.numero,
    total: order.total && order.total > 0 ? order.total : null,
    recipient: [order.customer, order.destination].map((part) => part.trim()).filter(Boolean).join(" · "),
    closing: [labelDate(volume.fechadoEm) ?? dateFormatter.format(options.printedAt ?? new Date()), pesoDoVolume(volume.pesoKg)].filter(Boolean).join(" · "),
    units: volume.unidades,
  };
  return pages.map((page, index) => ({ ...base, lines: page, part: index + 1, parts: pages.length }));
}

export function positionLabel(position: WarehousePosition): PositionLabelData {
  return {
    kind: "position",
    code: position.code,
    aisle: position.aisle,
    shelf: Number(position.shelf),
    zone: position.customer_code?.trim() || null,
    dimensions: `${formatMeters(position.length_m)} × ${formatMeters(position.depth_m)} × ${formatMeters(position.height_m)}`,
    maxWeight: formatKilos(position.max_weight_kg),
  };
}

/**
 * Uma página da impressão: na folha A4, a de quatro etiquetas de caixa e de
 * volume (deitada) ou a de dez de posição (em pé); no rolo, uma etiqueta.
 */
export type LabelPage = { kind: "quatro" | "dez" | "rolo"; labels: LabelData[] };

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

/**
 * As páginas da impressão. Na folha A4, a caixa e o volume vão de quatro em
 * quatro, na ordem em que chegam, e a posição, de dez em dez, depois deles:
 * as duas nunca dividem a folha. No rolo, uma etiqueta por página.
 */
export function labelPages(labels: LabelData[], mode: LabelMode): LabelPage[] {
  if (mode === "zebra") return labels.map((label) => ({ kind: "rolo" as const, labels: [label] }));
  const grandes = labels.filter((label) => label.kind !== "position");
  const posicoes = labels.filter((label) => label.kind === "position");
  return [
    ...chunk(grandes, BOXES_PER_SHEET).map((page) => ({ kind: "quatro" as const, labels: page })),
    ...chunk(posicoes, POSITIONS_PER_SHEET).map((page) => ({ kind: "dez" as const, labels: page })),
  ];
}

const numero = new Intl.NumberFormat("pt-BR");

function plural(quantidade: number, singular: string, varios: string) {
  return `${numero.format(quantidade)} ${quantidade === 1 ? singular : varios}`;
}

/** "2 etiquetas · 1 folha · 2 caixas": o que a impressão leva. No rolo, sem folhas. */
export function textoDaImpressao(conta: { etiquetas: number; folhas: number; caixas: number; posicoes: number; volumes: number; mode: LabelMode }): string {
  return [
    plural(conta.etiquetas, "etiqueta", "etiquetas"),
    conta.mode === "a4" ? plural(conta.folhas, "folha", "folhas") : null,
    conta.caixas ? plural(conta.caixas, "caixa", "caixas") : null,
    conta.posicoes ? plural(conta.posicoes, "posição", "posições") : null,
    conta.volumes ? textoDeVolumes(conta.volumes) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Pixels por milímetro na tela (CSS: 96 px por polegada). */
const PX_POR_MM = 96 / 25.4;

/**
 * Quanto a prévia precisa sobrar para crescer de novo, em pixels: mais que a
 * barra de rolagem do Windows (17 px, uns 34 px com o navegador em 50%).
 */
export const FOLGA_DA_PREVIA_PX = 40;

/**
 * O zoom da prévia das etiquetas, para a página mais larga caber na largura
 * livre sem rolar para o lado: encolhe na hora e nunca passa de 1. Só cresce
 * quando sobra mais que FOLGA_DA_PREVIA_PX: o zoom muda a altura da prévia, a
 * altura liga e desliga a barra de rolagem da tela, e a barra muda a largura
 * livre; sem a folga, o zoom ficava trocando entre dois valores.
 */
export function zoomDaPrevia(atual: number, livrePx: number, larguraMm: number): number {
  // Área ainda sem largura (escondida, ou antes do layout): fica como está.
  if (!(livrePx > 0) || !(larguraMm > 0)) return atual;
  const larguraPx = larguraMm * PX_POR_MM;
  const cabe = Math.min(1, Math.floor((livrePx / larguraPx) * 1000) / 1000);
  if (cabe <= atual) return cabe;
  return livrePx - larguraPx * atual > FOLGA_DA_PREVIA_PX ? cabe : atual;
}

/** A saída escolhida neste computador (decisão de 11/11/2026): a mesa da Zebra abre no rolo, o escritório na folha. */
export const SAIDA_GUARDADA = "dute.etiquetas.saida";

type Armazenamento = Pick<Storage, "getItem" | "setItem">;

/** O localStorage, ou null quando o navegador bloqueia até chegar nele. */
function armazenamentoDoAparelho(): Armazenamento | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saidaGuardada(armazenamento: Armazenamento | null = armazenamentoDoAparelho()): LabelMode | null {
  try {
    const valor = armazenamento?.getItem(SAIDA_GUARDADA);
    return valor === "zebra" || valor === "a4" ? valor : null;
  } catch {
    return null;
  }
}

export function guardarSaida(mode: LabelMode, armazenamento: Armazenamento | null = armazenamentoDoAparelho()): void {
  try {
    armazenamento?.setItem(SAIDA_GUARDADA, mode);
  } catch {
    // Sem storage: a escolha vale só nesta visita, pelo endereço.
  }
}

/** A saída da tela: a do endereço; sem ela, a guardada neste computador; sem nenhuma, a folha A4. */
export function saidaDaTela(query: Pick<LabelsQuery, "mode">, guardada: LabelMode | null): LabelMode {
  return query.mode ?? guardada ?? "a4";
}

export const LABELS_PATH = "/estoque/etiquetas";

export type LabelsQuery = {
  boxes: string[];
  positions: string[];
  /** Todas as caixas da sessão de abertura em curso. */
  session: boolean;
  /** A chegada (número) de onde as caixas vieram: a volta é ao Receber e a tela diz a chegada. */
  receipt: string | null;
  /** O pedido (orders/{id}) das etiquetas de volume. */
  order: string | null;
  /** Os volumes do pedido, pelo número; "all", todos (o lote depois de concluir). */
  volumes: number[] | "all";
  /** A saída pedida no endereço; sem ela, a tela usa a guardada no computador (saidaDaTela). */
  mode: LabelMode | null;
};

/** O valor de `volumes=` que pede todos os volumes do pedido. */
const TODOS_OS_VOLUMES = "todos";

function volumeNumbers(value: string | null): number[] | "all" {
  const text = (value ?? "").trim().toLowerCase();
  if (text === TODOS_OS_VOLUMES) return "all";
  const numbers = text
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((number) => Number.isInteger(number) && number > 0);
  return [...new Set(numbers)].sort((left, right) => left - right);
}

function codes(value: string | null) {
  return [...new Set((value ?? "").split(",").map((code) => code.trim().toUpperCase()).filter(Boolean))];
}

export function parseLabelsQuery(search: string): LabelsQuery {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const modo = params.get("modo");
  return {
    boxes: codes(params.get("caixas")),
    positions: codes(params.get("posicoes")),
    session: params.get("sessao") === "atual",
    receipt: (params.get("chegada") ?? "").trim() || null,
    order: (params.get("pedido") ?? "").trim() || null,
    volumes: volumeNumbers(params.get("volumes")),
    mode: modo === "zebra" || modo === "a4" ? modo : null,
  };
}

export function labelsUrl(query: Partial<LabelsQuery>): string {
  const params = new URLSearchParams();
  if (query.session) params.set("sessao", "atual");
  if (query.boxes?.length) params.set("caixas", query.boxes.join(","));
  if (query.positions?.length) params.set("posicoes", query.positions.join(","));
  if (query.receipt) params.set("chegada", query.receipt);
  if (query.order) {
    params.set("pedido", query.order);
    if (query.volumes === "all") params.set("volumes", TODOS_OS_VOLUMES);
    else if (query.volumes?.length) params.set("volumes", query.volumes.join(","));
  }
  if (query.mode) params.set("modo", query.mode);
  const text = params.toString();
  return text ? `${LABELS_PATH}?${text}` : LABELS_PATH;
}
