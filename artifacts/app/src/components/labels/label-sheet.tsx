/**
 * Desenho das etiquetas de caixa, de posição e de volume e das folhas.
 *
 * - Rolo da Zebra: cada etiqueta é uma página de 101,6 × 50,8 mm, pelo driver
 *   do Windows. A caixa e o volume com mais de cinco produtos saem em mais de
 *   uma etiqueta do mesmo tamanho: a primeira e as de continuação (separação
 *   com caixas, partes 4c e 6).
 * - Folha A4, em papel comum (decisões de 11 e 12/11/2026,
 *   docs/mockups/EtiquetaA4*.dc.html): a caixa e o volume em etiquetas de
 *   148,5 × 105 mm, quatro por folha deitada, cada uma completa, porque é
 *   recortada e presa na caixa com fita nas bordas; a posição, dez por folha
 *   em pé. As linhas de corte saem impressas.
 *
 * Papel de impressão: medidas físicas em milímetros e preto sobre branco,
 * fora dos tokens do tema, porque o resultado é a etiqueta e não a
 * interface. A impressão é a do navegador (Imprimir → Salvar PDF), como a
 * fatura: só a área .print-area sai (index.css).
 */

import { useMemo } from "react";

import { code128Bars } from "@/lib/code128";
import {
  type BoxLabelData,
  type LabelContentLine,
  type LabelData,
  type LabelMode,
  type LabelPage,
  type PositionLabelData,
  type VolumeLabelData,
  BOX_SHEET_MM,
  LABEL_MM,
  SHEET_LABEL_MM,
  SHEET_MM,
  nameAndSize,
  sheetMargins,
} from "@/lib/warehouse-labels";

const INK = "#000";
const INK_SOFT = "#333";
const PAPER = "#fff";
const FONT = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'Consolas', 'Roboto Mono', 'Courier New', monospace";

export function Barcode({ value, heightMm }: { value: string; heightMm: number }) {
  const { bars, width } = useMemo(() => code128Bars(value), [value]);
  return (
    <svg
      role="img"
      aria-label={`Código de barras ${value}`}
      viewBox={`0 0 ${width} 100`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      style={{ display: "block", width: "100%", height: `${heightMm}mm` }}
    >
      <rect x={0} y={0} width={width} height={100} fill={PAPER} />
      {bars.map((bar) => (
        <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={100} fill={INK} />
      ))}
    </svg>
  );
}

const caption: React.CSSProperties = {
  fontSize: "6pt",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: INK,
  lineHeight: 1.1,
};

const ellipsis: React.CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function LabelFrame({ children, ariaLabel }: { children: React.ReactNode; ariaLabel: string }) {
  return (
    <div
      className="lbl"
      role="group"
      aria-label={ariaLabel}
      style={{
        width: `${LABEL_MM.width}mm`,
        height: `${LABEL_MM.height}mm`,
        boxSizing: "border-box",
        padding: "2.8mm 3.5mm 2.4mm",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: "1mm",
        color: INK,
        background: PAPER,
        fontFamily: FONT,
        fontSize: "7pt",
        lineHeight: 1.2,
      }}
    >
      {children}
    </div>
  );
}

/**
 * O logo original da Dutelog no rodapé de toda etiqueta (pedido do Leonardo,
 * 10/11/2026). Na folha A4 sai nas cores dele; no rolo da Zebra, que só
 * imprime preto, sai em preto (labelSheetCss).
 */
export const LOGO_MM = { height: 3.6 } as const;

function Logo() {
  return <img className="lbl-logo" src="/dutelog-logo.png" alt="Dutelog" style={{ display: "block", height: `${LOGO_MM.height}mm`, width: "auto", flexShrink: 0 }} />;
}

/** O rodapé da etiqueta: o logo, a parte ("etiqueta 1 de 2") quando a caixa pede mais de uma, e o total. */
function LabelFooter({ part, children }: { part?: string | null; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "3mm", fontSize: "7pt", fontWeight: 700 }}>
      <span style={{ display: "flex", alignItems: "center", gap: "1.8mm", minWidth: 0 }}>
        <Logo />
        {part ? <span style={ellipsis}>{part}</span> : null}
      </span>
      <span style={{ flexShrink: 0, textAlign: "right" }}>{children}</span>
    </div>
  );
}

/** "etiqueta 2 de 3"; com tudo numa etiqueta só, nada. */
function partLabel(label: { part: number; parts: number }) {
  return label.parts > 1 ? `etiqueta ${label.part} de ${label.parts}` : null;
}

const quantity = new Intl.NumberFormat("pt-BR");

/** "39 un."; na caixa aberta, o saldo e de quando ele é: "7 un. · saldo em 12/11/2026". */
function unitsLabel(label: Pick<BoxLabelData, "units" | "balanceAt">) {
  const units = `${quantity.format(label.units)} un.`;
  return label.balanceAt ? `${units} · saldo em ${label.balanceAt}` : units;
}

/** O código do cliente e o SKU da linha, sem repetir. */
function lineCodes(line: LabelContentLine) {
  return [...new Set([line.code, line.sku].filter(Boolean))];
}

/** As linhas do conteúdo no rolo: a quantidade, o nome com o tamanho, o código do cliente e o SKU. */
function ContentLines({ lines }: { lines: BoxLabelData["lines"] }) {
  return (
    <>
      {lines.map((line) => {
        const codes = lineCodes(line);
        return (
          <div key={`${line.code}-${line.name}`} className="lbl-line" style={{ ...ellipsis, fontSize: "6.5pt", lineHeight: 1.2 }}>
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>{quantity.format(line.qty)} ×</strong> {line.name}
            {codes.length ? <span style={{ opacity: 0.75 }}>{codes.map((code) => ` · ${code}`).join("")}</span> : null}
          </div>
        );
      })}
    </>
  );
}

const content: React.CSSProperties = { flex: 1, minHeight: 0, overflow: "hidden", borderTop: `0.2mm solid ${INK}`, paddingTop: "0.8mm" };

export function BoxLabelCard({ label }: { label: BoxLabelData }) {
  const part = partLabel(label);
  if (label.part > 1) return <BoxContinuationCard label={label} />;
  return (
    <LabelFrame ariaLabel={part ? `Etiqueta da caixa ${label.code}, ${label.part} de ${label.parts}` : `Etiqueta da caixa ${label.code}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "3mm" }}>
        <div style={{ minWidth: 0 }}>
          <div style={caption}>Caixa</div>
          <div style={{ fontFamily: MONO, fontSize: "15pt", fontWeight: 700, lineHeight: 1.05, letterSpacing: "0.02em" }}>{label.code}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={caption}>Posição</div>
          <div style={{ fontSize: "24pt", fontWeight: 800, lineHeight: 1 }}>{label.position}</div>
        </div>
      </div>
      <Barcode value={label.code} heightMm={9} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: "3mm", fontSize: "6.5pt" }}>
        <span style={ellipsis}>
          {label.customer} · {label.dimensions}
        </span>
        <span style={{ flexShrink: 0 }}>
          {label.origin} · {label.date}
        </span>
      </div>
      <div className="lbl-content" style={content}>
        {label.lines.length ? <ContentLines lines={label.lines} /> : <div style={{ fontSize: "7pt", fontStyle: "italic" }}>Conteúdo a lançar na contagem.</div>}
      </div>
      <LabelFooter part={part}>{unitsLabel(label)}</LabelFooter>
    </LabelFrame>
  );
}

/**
 * A etiqueta de continuação do rolo (docs/mockups/WmsEtiquetaTodosCaixa.dc.html):
 * os produtos que não couberam na primeira, com a caixa, a posição, a parte e
 * as unidades da caixa inteira. Sem código de barras: o da primeira
 * identifica a caixa.
 */
function BoxContinuationCard({ label }: { label: BoxLabelData }) {
  return (
    <LabelFrame ariaLabel={`Etiqueta da caixa ${label.code}, ${label.part} de ${label.parts}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "3mm" }}>
        <span style={{ ...ellipsis, fontFamily: MONO, fontSize: "11pt", fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1.2 }}>
          {label.code}
          <strong style={{ fontFamily: FONT, fontWeight: 800 }}> · {label.position}</strong>
        </span>
        <span style={{ flexShrink: 0, fontSize: "8pt", fontWeight: 800 }}>{partLabel(label)}</span>
      </div>
      <div className="lbl-content" style={content}>
        <ContentLines lines={label.lines} />
      </div>
      <LabelFooter>{unitsLabel(label)}</LabelFooter>
    </LabelFrame>
  );
}

export function PositionLabelCard({ label }: { label: PositionLabelData }) {
  return (
    <LabelFrame ariaLabel={`Etiqueta da posição ${label.code}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "3mm" }}>
        <div>
          <div style={caption}>Posição</div>
          <div style={{ fontSize: "30pt", fontWeight: 800, lineHeight: 1 }}>{label.code}</div>
        </div>
        <div style={{ textAlign: "right", minWidth: 0 }}>
          <div style={caption}>Zona</div>
          <div style={{ ...ellipsis, fontSize: "10pt", fontWeight: 700, lineHeight: 1.15 }}>{label.zone ?? "sem cliente"}</div>
          <div style={{ fontSize: "7pt" }}>
            Rua {label.aisle} · prateleira {label.shelf}
          </div>
        </div>
      </div>
      <Barcode value={label.code} heightMm={13} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: "3mm", fontSize: "7pt", borderTop: `0.2mm solid ${INK}`, paddingTop: "1mm" }}>
        <span style={ellipsis}>{label.dimensions}</span>
        <span style={{ flexShrink: 0 }}>Peso máx. {label.maxWeight}</span>
      </div>
      <LabelFooter>Comprimento × largura × altura livre</LabelFooter>
    </LabelFrame>
  );
}

/**
 * A etiqueta do volume de expedição no rolo (docs/mockups/WmsSepararEtiquetaVolume
 * .dc.html): o pedido, o volume (com o total, depois de concluir), o código
 * de barras, o cliente e o destino, a data e o peso, e os produtos com o
 * código do cliente. Vai ao cliente: sem caixa, posição nem valor.
 */
export function VolumeLabelCard({ label }: { label: VolumeLabelData }) {
  const part = partLabel(label);
  if (label.part > 1) return <VolumeContinuationCard label={label} />;
  return (
    <LabelFrame ariaLabel={part ? `Etiqueta do volume ${label.number} do pedido ${label.order}, ${label.part} de ${label.parts}` : `Etiqueta do volume ${label.number} do pedido ${label.order}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "3mm" }}>
        <div style={{ minWidth: 0 }}>
          <div style={caption}>Pedido</div>
          <div style={{ ...ellipsis, fontFamily: MONO, fontSize: "15pt", fontWeight: 700, lineHeight: 1.05, letterSpacing: "0.02em" }}>{label.order}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={caption}>Volume</div>
          <div style={{ fontSize: "24pt", fontWeight: 800, lineHeight: 1 }}>
            {quantity.format(label.number)}
            {label.total ? <span style={{ fontSize: "12pt", fontWeight: 700 }}> de {quantity.format(label.total)}</span> : null}
          </div>
        </div>
      </div>
      <Barcode value={label.code} heightMm={9} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: "3mm", fontSize: "6.5pt" }}>
        <span style={ellipsis}>{label.recipient}</span>
        <span style={{ flexShrink: 0 }}>{label.closing}</span>
      </div>
      <div className="lbl-content" style={content}>
        <ContentLines lines={label.lines} />
      </div>
      <LabelFooter part={part}>{quantity.format(label.units)} un.</LabelFooter>
    </LabelFrame>
  );
}

/**
 * A continuação da etiqueta do volume no rolo (docs/mockups/WmsEtiquetaTodosVolume
 * .dc.html): os produtos que não couberam na primeira, com o pedido, o
 * volume, a parte e as unidades do volume inteiro.
 */
function VolumeContinuationCard({ label }: { label: VolumeLabelData }) {
  return (
    <LabelFrame ariaLabel={`Etiqueta do volume ${label.number} do pedido ${label.order}, ${label.part} de ${label.parts}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "3mm" }}>
        <span style={{ ...ellipsis, fontFamily: MONO, fontSize: "11pt", fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1.2 }}>
          {label.order}
          <strong style={{ fontFamily: FONT, fontWeight: 800 }}> · Volume {quantity.format(label.number)}</strong>
        </span>
        <span style={{ flexShrink: 0, fontSize: "8pt", fontWeight: 800 }}>{partLabel(label)}</span>
      </div>
      <div className="lbl-content" style={content}>
        <ContentLines lines={label.lines} />
      </div>
      <LabelFooter>{quantity.format(label.units)} un.</LabelFooter>
    </LabelFrame>
  );
}

/* ---------- A etiqueta da folha A4: 148,5 × 105 mm (docs/mockups/EtiquetaA4Caixas.dc.html) ---------- */

/** O logo da etiqueta da folha: o mesmo, sem a borda transparente do arquivo, para os 9 mm serem do logo. */
export const SHEET_LOGO_MM = { height: 9 } as const;

const sheetCaption: React.CSSProperties = { fontSize: "7pt", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", lineHeight: 1.2 };

function SheetFrame({ children, ariaLabel }: { children: React.ReactNode; ariaLabel: string }) {
  return (
    <div
      className="lbl lbl-grande"
      role="group"
      aria-label={ariaLabel}
      style={{
        width: `${SHEET_LABEL_MM.width}mm`,
        height: `${SHEET_LABEL_MM.height}mm`,
        boxSizing: "border-box",
        // 7 mm livres em volta, para a fita nas bordas.
        padding: "7mm",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: "2mm",
        color: INK,
        background: PAPER,
        fontFamily: FONT,
        fontSize: "9pt",
        lineHeight: 1.2,
      }}
    >
      {children}
    </div>
  );
}

/** O alto da etiqueta: o código (da caixa ou do pedido) à esquerda e a posição (ou o volume) grande à direita. */
function SheetHeader({ captionLeft, code, captionRight, children }: { captionLeft: string; code: string; captionRight: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "5mm" }}>
      <div style={{ minWidth: 0 }}>
        <div style={sheetCaption}>{captionLeft}</div>
        <div style={{ ...ellipsis, fontFamily: MONO, fontSize: "20pt", fontWeight: 700, lineHeight: 1.05, letterSpacing: "0.02em" }}>{code}</div>
      </div>
      <div style={{ flexShrink: 0, textAlign: "right" }}>
        <div style={sheetCaption}>{captionRight}</div>
        <div style={{ fontSize: "34pt", fontWeight: 800, lineHeight: 0.9, letterSpacing: "-0.01em" }}>{children}</div>
      </div>
    </div>
  );
}

/** O código de barras de 64 × 11 mm, com as duas linhas de informação ao lado. */
function SheetBarcodeRow({ code, info }: { code: string; info: [string, string] }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "5mm" }}>
      <div style={{ flexShrink: 0, width: "64mm" }}>
        <Barcode value={code} heightMm={11} />
      </div>
      <div style={{ minWidth: 0, textAlign: "right", fontSize: "9pt", lineHeight: 1.3 }}>
        <div style={ellipsis}>{info[0]}</div>
        <div style={ellipsis}>{info[1]}</div>
      </div>
    </div>
  );
}

/**
 * Os produtos em duas linhas: a quantidade e o nome com o tamanho, em letra
 * grande, e embaixo o código do cliente e o SKU. O nome comprido encurta e o
 * tamanho fica (" · XGG" nunca é cortado).
 */
function SheetContentLines({ lines }: { lines: LabelContentLine[] }) {
  return (
    <>
      {lines.map((line) => {
        const { name, size } = nameAndSize(line);
        const codes = lineCodes(line);
        return (
          <div key={`${line.code}-${line.name}`} className="lbl-line" style={{ display: "flex", alignItems: "baseline", gap: "2.5mm" }}>
            <strong style={{ flexShrink: 0, minWidth: "10mm", textAlign: "right", whiteSpace: "nowrap", fontSize: "13pt", fontWeight: 800, lineHeight: 1.15, fontVariantNumeric: "tabular-nums" }}>
              {quantity.format(line.qty)} ×
            </strong>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", minWidth: 0, fontSize: "13pt", fontWeight: 600, lineHeight: 1.15 }}>
                <span style={{ ...ellipsis, minWidth: 0 }}>{name}</span>
                {size ? <span style={{ flexShrink: 0, whiteSpace: "pre" }}> · {size}</span> : null}
              </div>
              {codes.length ? <div style={{ ...ellipsis, fontSize: "8.5pt", lineHeight: 1.15, color: INK_SOFT }}>{codes.join(" · ")}</div> : null}
            </div>
          </div>
        );
      })}
    </>
  );
}

const sheetContent: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  borderTop: `0.3mm solid ${INK}`,
  paddingTop: "1.5mm",
  display: "flex",
  flexDirection: "column",
  gap: "1mm",
};

/** O rodapé: o logo e a parte ("etiqueta 1 de 2") à esquerda, como no rolo, e o total à direita; na caixa aberta, "saldo em" embaixo dele. */
function SheetFooter({ part, units, balanceAt }: { part: string | null; units: number; balanceAt?: string | null }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "4mm" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "4mm", minWidth: 0 }}>
        <img
          className="lbl-logo"
          src="/dutelog-logo-etiqueta.png"
          alt="Dutelog"
          style={{ display: "block", flexShrink: 0, height: `${SHEET_LOGO_MM.height}mm`, width: "auto" }}
        />
        {part ? <span style={{ ...ellipsis, fontSize: "11pt", fontWeight: 800 }}>{part}</span> : null}
      </span>
      <span style={{ flexShrink: 0, textAlign: "right", lineHeight: 1.1 }}>
        <span style={{ display: "block", whiteSpace: "nowrap", fontSize: "15pt", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
          {quantity.format(units)} un.
        </span>
        {balanceAt ? <span style={{ display: "block", whiteSpace: "nowrap", fontSize: "9pt", fontWeight: 700 }}>saldo em {balanceAt}</span> : null}
      </span>
    </div>
  );
}

/** A etiqueta da caixa na folha A4: cada uma completa, também a "etiqueta 2 de 2", porque vai recortada para a caixa. */
export function SheetBoxLabelCard({ label }: { label: BoxLabelData }) {
  const part = partLabel(label);
  return (
    <SheetFrame ariaLabel={part ? `Etiqueta da caixa ${label.code}, ${label.part} de ${label.parts}` : `Etiqueta da caixa ${label.code}`}>
      <SheetHeader captionLeft="Caixa" code={label.code} captionRight="Posição">
        {label.position}
      </SheetHeader>
      <SheetBarcodeRow code={label.code} info={[`${label.customer} · ${label.dimensions}`, `${label.origin} · ${label.date}`]} />
      <div className="lbl-content" style={sheetContent}>
        {label.lines.length ? (
          <SheetContentLines lines={label.lines} />
        ) : (
          <div style={{ fontSize: "11pt", fontStyle: "italic" }}>Conteúdo a lançar na contagem.</div>
        )}
      </div>
      <SheetFooter part={part} units={label.units} balanceAt={label.balanceAt} />
    </SheetFrame>
  );
}

/** A etiqueta do volume na folha A4 (docs/mockups/EtiquetaA4Volumes.dc.html). Vai ao cliente: sem caixa, posição nem valor. */
export function SheetVolumeLabelCard({ label }: { label: VolumeLabelData }) {
  const part = partLabel(label);
  return (
    <SheetFrame
      ariaLabel={part ? `Etiqueta do volume ${label.number} do pedido ${label.order}, ${label.part} de ${label.parts}` : `Etiqueta do volume ${label.number} do pedido ${label.order}`}
    >
      <SheetHeader captionLeft="Pedido" code={label.order} captionRight="Volume">
        {quantity.format(label.number)}
        {label.total ? <span style={{ fontSize: "16pt", fontWeight: 700, letterSpacing: 0 }}> de {quantity.format(label.total)}</span> : null}
      </SheetHeader>
      <SheetBarcodeRow code={label.code} info={[label.recipient, label.closing]} />
      <div className="lbl-content" style={sheetContent}>
        <SheetContentLines lines={label.lines} />
      </div>
      <SheetFooter part={part} units={label.units} />
    </SheetFrame>
  );
}

/** A etiqueta como a saída pede: na folha A4, a caixa e o volume em 148,5 × 105 mm; a posição e o rolo, como sempre. */
export function LabelCard({ label, mode = "zebra" }: { label: LabelData; mode?: LabelMode }) {
  if (label.kind === "box") return mode === "a4" ? <SheetBoxLabelCard label={label} /> : <BoxLabelCard label={label} />;
  if (label.kind === "volume") return mode === "a4" ? <SheetVolumeLabelCard label={label} /> : <VolumeLabelCard label={label} />;
  return <PositionLabelCard label={label} />;
}

/** As folhas e o rolo têm @page próprio: o tamanho de cada página e margem zero. */
function pageRules(mode: LabelMode, kinds: ReadonlySet<LabelPage["kind"]>) {
  if (mode === "zebra") return `@page { size: ${LABEL_MM.width}mm ${LABEL_MM.height}mm; margin: 0; }`;
  const deitada = `${BOX_SHEET_MM.width}mm ${BOX_SHEET_MM.height}mm`;
  const emPe = `${SHEET_MM.width}mm ${SHEET_MM.height}mm`;
  // Uma folha só de um tipo: o @page diz o tamanho dela. As duas juntas (raro): uma página com nome para cada.
  if (kinds.has("quatro") && kinds.has("dez")) {
    return `@page { margin: 0; }
  @page etiqueta-deitada { size: ${deitada}; margin: 0; }
  @page etiqueta-em-pe { size: ${emPe}; margin: 0; }
  .lbl-folha { page: etiqueta-deitada; }
  .lbl-sheet { page: etiqueta-em-pe; }`;
  }
  return `@page { size: ${kinds.has("quatro") ? deitada : emPe}; margin: 0; }`;
}

/** CSS das folhas e do rolo: o @page muda com a saída e com o tipo de folha, por isso vai inline. */
export function labelSheetCss(mode: LabelMode, kinds: ReadonlySet<LabelPage["kind"]> = new Set()) {
  const margins = sheetMargins();
  return `
.lbl-print { background: ${PAPER}; color: ${INK}; }
.lbl-sheet {
  width: ${SHEET_MM.width}mm;
  height: ${SHEET_MM.height}mm;
  box-sizing: border-box;
  padding: ${margins.top}mm 0 0 ${margins.left}mm;
  display: grid;
  grid-template-columns: repeat(${SHEET_MM.columns}, ${LABEL_MM.width}mm);
  grid-auto-rows: ${LABEL_MM.height}mm;
  column-gap: ${SHEET_MM.gapX}mm;
  row-gap: ${SHEET_MM.gapY}mm;
  align-content: start;
  background: ${PAPER};
  break-after: page;
  page-break-after: always;
}
.lbl-sheet .lbl { outline: 0.25mm dashed ${INK}; outline-offset: -0.125mm; }
.lbl-folha {
  position: relative;
  width: ${BOX_SHEET_MM.width}mm;
  height: ${BOX_SHEET_MM.height}mm;
  display: grid;
  grid-template-columns: repeat(${BOX_SHEET_MM.columns}, ${SHEET_LABEL_MM.width}mm);
  grid-template-rows: repeat(${BOX_SHEET_MM.rows}, ${SHEET_LABEL_MM.height}mm);
  overflow: hidden;
  background: ${PAPER};
  break-after: page;
  page-break-after: always;
}
.lbl-corte-h { position: absolute; left: 0; right: 0; top: ${SHEET_LABEL_MM.height - 0.15}mm; height: 0.3mm; background: repeating-linear-gradient(90deg, ${INK} 0 3mm, transparent 3mm 5mm); }
.lbl-corte-v { position: absolute; top: 0; bottom: 0; left: ${SHEET_LABEL_MM.width - 0.15}mm; width: 0.3mm; background: repeating-linear-gradient(180deg, ${INK} 0 3mm, transparent 3mm 5mm); }
.lbl-roll .lbl { break-after: page; page-break-after: always; }
.lbl-sheet:last-child, .lbl-folha:last-child, .lbl-roll .lbl:last-child { break-after: auto; page-break-after: auto; }${mode === "zebra" ? "\n.lbl-logo { filter: brightness(0); }" : ""}
@media screen {
  .lbl-sheet, .lbl-folha, .lbl-roll { box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12); margin: 0 auto 12px; }
  .lbl-roll { width: ${LABEL_MM.width}mm; }
  .lbl-roll .lbl { outline: 0.2mm dashed rgba(0, 0, 0, 0.25); outline-offset: -0.2mm; }
}
@media print {
  ${pageRules(mode, kinds)}
  .lbl-print { position: absolute; inset: 0 auto auto 0; margin: 0; padding: 0; }
  .lbl-sheet, .lbl-folha, .lbl-roll { box-shadow: none; margin: 0; }
  .lbl-roll .lbl { outline: none; }
  .lbl-ajuste { zoom: 1 !important; }
}
`;
}

/** As páginas prontas para imprimir (labelPages): as folhas A4 de quatro e de dez, ou o rolo. */
export function LabelSheet({ pages, mode }: { pages: LabelPage[]; mode: LabelMode }) {
  const kinds = useMemo(() => new Set(pages.map((page) => page.kind)), [pages]);
  const css = useMemo(() => labelSheetCss(mode, kinds), [mode, kinds]);
  return (
    <div className="print-area lbl-print">
      <style>{css}</style>
      {mode === "zebra" ? (
        <div className="lbl-roll">
          {pages.flatMap((page) => page.labels).map((label, index) => (
            <LabelCard key={`${label.kind}-${label.code}-${index}`} label={label} mode="zebra" />
          ))}
        </div>
      ) : (
        pages.map((page, pageIndex) =>
          page.kind === "quatro" ? (
            <div className="lbl-folha" role="group" key={pageIndex} aria-label={`Folha ${pageIndex + 1}`}>
              {page.labels.map((label, index) => (
                <LabelCard key={`${label.kind}-${label.code}-${index}`} label={label} mode="a4" />
              ))}
              <div className="lbl-corte-h" aria-hidden="true" />
              <div className="lbl-corte-v" aria-hidden="true" />
            </div>
          ) : (
            <div className="lbl-sheet" role="group" key={pageIndex} aria-label={`Folha ${pageIndex + 1}`}>
              {page.labels.map((label, index) => (
                <LabelCard key={`${label.kind}-${label.code}-${index}`} label={label} mode="a4" />
              ))}
            </div>
          ),
        )
      )}
    </div>
  );
}
