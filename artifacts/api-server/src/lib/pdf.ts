import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";
import type { PeriodResult } from "./billing";
import type { BillingConfig } from "@workspace/db";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const NAVY = rgb(0.024, 0.157, 0.29);
const GRAY = rgb(0.45, 0.45, 0.45);
const LIGHT = rgb(0.93, 0.95, 0.97);

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n).replace(/\u00A0/g, " ");
const fmtNum = (n: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n);

// Helvetica (WinAnsi) não codifica emojis; removemos fora do Latin-1.
const clean = (s: string) => (s ?? "").replace(/[^\x00-\xFF]/g, "").trim();

function competenciaLabel(competencia: string): string {
  const [y, m] = competencia.split("-").map(Number);
  const meses = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  return `${meses[m - 1]} / ${y}`;
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 30) {
    ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
    ctx.y = PAGE_H - MARGIN;
  }
}

function right(ctx: Ctx, text: string, xRight: number, size: number, font: PDFFont, color = rgb(0, 0, 0)) {
  const w = font.widthOfTextAtSize(text, size);
  ctx.page.drawText(text, { x: xRight - w, y: ctx.y, size, font, color });
}

// Colunas (x de referência)
const COL_ITEM = MARGIN;
const COL_UNID = 300;
const COL_QTDE = 400; // right
const COL_VUNIT = 480; // right
const COL_TOTAL = PAGE_W - MARGIN; // right

export async function generateInvoicePdf(opts: {
  result: PeriodResult;
  config: BillingConfig;
  competencia: string;
}): Promise<Uint8Array> {
  const { result, config, competencia } = opts;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = { doc, page, font, bold, y: PAGE_H - MARGIN };

  // Cabeçalho
  ctx.page.drawRectangle({ x: 0, y: PAGE_H - 90, width: PAGE_W, height: 90, color: NAVY });
  ctx.page.drawText("FATURA DE ARMAZENAGEM E LOGÍSTICA", {
    x: MARGIN, y: PAGE_H - 45, size: 16, font: bold, color: rgb(1, 1, 1),
  });
  ctx.page.drawText("Dutelog — Gestão de Armazenagem", {
    x: MARGIN, y: PAGE_H - 65, size: 10, font, color: rgb(0.8, 0.85, 0.9),
  });
  right(
    { ...ctx, y: PAGE_H - 45 } as Ctx,
    `Competência: ${competenciaLabel(competencia)}`,
    PAGE_W - MARGIN, 11, bold, rgb(1, 1, 1),
  );
  const statusLabel = result.status === "pago" ? "PAGO" : result.status === "emitido" ? "EMITIDO" : "PRÉVIA";
  right(
    { ...ctx, y: PAGE_H - 65 } as Ctx,
    `Status: ${statusLabel}`,
    PAGE_W - MARGIN, 10, font, rgb(0.8, 0.85, 0.9),
  );

  ctx.y = PAGE_H - 120;

  // Dados do cliente
  ctx.page.drawText("Cliente:", { x: MARGIN, y: ctx.y, size: 10, font: bold, color: GRAY });
  ctx.page.drawText(clean(config.cliente_nome || "BTG Pactual"), {
    x: MARGIN + 50, y: ctx.y, size: 10, font, color: rgb(0, 0, 0),
  });
  ctx.y -= 16;
  if (result.emitido_em) {
    const d = new Date(result.emitido_em);
    ctx.page.drawText("Emissão:", { x: MARGIN, y: ctx.y, size: 10, font: bold, color: GRAY });
    ctx.page.drawText(d.toLocaleDateString("pt-BR"), {
      x: MARGIN + 50, y: ctx.y, size: 10, font, color: rgb(0, 0, 0),
    });
    ctx.y -= 16;
  }
  ctx.y -= 10;

  // Grupos
  for (const g of result.grupos) {
    if (!g.itens.length) continue;
    ensureSpace(ctx, 60);
    // Título do grupo
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 4, width: PAGE_W - MARGIN * 2, height: 20, color: NAVY });
    ctx.page.drawText(clean(g.label), { x: MARGIN + 6, y: ctx.y, size: 11, font: bold, color: rgb(1, 1, 1) });
    right(ctx, fmtBRL(g.total), PAGE_W - MARGIN - 6, 11, bold, rgb(1, 1, 1));
    ctx.y -= 26;

    // Cabeçalho de colunas
    ctx.page.drawText("Serviço / Item", { x: COL_ITEM, y: ctx.y, size: 8, font: bold, color: GRAY });
    ctx.page.drawText("Unidade", { x: COL_UNID, y: ctx.y, size: 8, font: bold, color: GRAY });
    right(ctx, "Qtde", COL_QTDE, 8, bold, GRAY);
    right(ctx, "Valor Unit.", COL_VUNIT, 8, bold, GRAY);
    right(ctx, "Total", COL_TOTAL, 8, bold, GRAY);
    ctx.y -= 14;

    let alt = false;
    for (const it of g.itens) {
      ensureSpace(ctx, 18);
      if (alt) {
        ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 4, width: PAGE_W - MARGIN * 2, height: 16, color: LIGHT });
      }
      alt = !alt;
      let itemName = clean(it.item);
      // Truncar nome para não colidir com a coluna de unidade
      while (font.widthOfTextAtSize(itemName, 9) > COL_UNID - COL_ITEM - 8 && itemName.length > 4) {
        itemName = itemName.slice(0, -2);
      }
      ctx.page.drawText(itemName, { x: COL_ITEM, y: ctx.y, size: 9, font, color: rgb(0, 0, 0) });
      ctx.page.drawText(clean(it.unidade || ""), { x: COL_UNID, y: ctx.y, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
      right(ctx, fmtNum(it.qtde), COL_QTDE, 9, font);
      right(ctx, fmtBRL(it.valor_unit), COL_VUNIT, 9, font);
      right(ctx, fmtBRL(it.total), COL_TOTAL, 9, bold);
      ctx.y -= 16;
    }
    ctx.y -= 12;
  }

  // Total geral
  ensureSpace(ctx, 50);
  ctx.y -= 6;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 8, width: PAGE_W - MARGIN * 2, height: 30, color: NAVY });
  ctx.page.drawText("TOTAL GERAL DO MÊS", { x: MARGIN + 10, y: ctx.y, size: 13, font: bold, color: rgb(1, 1, 1) });
  right(ctx, fmtBRL(result.total), PAGE_W - MARGIN - 10, 15, bold, rgb(1, 1, 1));
  ctx.y -= 44;

  // Nota de rodapé
  ensureSpace(ctx, 40);
  ctx.page.drawText(
    `Ad Valorem calculado a ${fmtNum(result.ad_valorem_rate * 100)}% sobre o valor do estoque (${fmtBRL(result.custo_estoque)}).`,
    { x: MARGIN, y: ctx.y, size: 8, font, color: GRAY },
  );

  return await doc.save();
}
