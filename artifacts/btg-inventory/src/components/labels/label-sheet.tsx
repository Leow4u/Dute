/**
 * Desenho das etiquetas de caixa e de posição e da folha A4 com dez delas.
 *
 * Papel de impressão: medidas físicas em milímetros e preto sobre branco,
 * fora dos tokens do tema, porque o resultado é a etiqueta adesiva e não a
 * interface. A impressão é a do navegador (Imprimir → Salvar PDF), como a
 * fatura: só a área .print-area sai (index.css). No modo "uma por etiqueta"
 * cada etiqueta é uma página de 101,6 × 50,8 mm, o rolo da Zebra pelo
 * driver do Windows.
 */

import { useMemo } from "react";

import { code128Bars } from "@/lib/code128";
import {
  type BoxLabelData,
  type LabelData,
  type LabelMode,
  type PositionLabelData,
  LABEL_MM,
  SHEET_MM,
  sheetMargins,
} from "@/lib/warehouse-labels";

const INK = "#000";
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

export function BoxLabelCard({ label }: { label: BoxLabelData }) {
  const units = new Intl.NumberFormat("pt-BR").format(label.units);
  return (
    <LabelFrame ariaLabel={`Etiqueta da caixa ${label.code}`}>
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
          {label.origin} {label.printedAt}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", borderTop: `0.2mm solid ${INK}`, paddingTop: "0.8mm" }}>
        {label.lines.length ? (
          label.lines.map((line) => (
            <div key={`${line.code}-${line.name}`} style={{ ...ellipsis, fontSize: "6.5pt", lineHeight: 1.3 }}>
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>{new Intl.NumberFormat("pt-BR").format(line.qty)} ×</strong> {line.name}
              {line.code ? <span style={{ opacity: 0.75 }}> · {line.code}</span> : null}
            </div>
          ))
        ) : (
          <div style={{ fontSize: "7pt", fontStyle: "italic" }}>Conteúdo a lançar na contagem.</div>
        )}
        {label.hiddenLines > 0 ? (
          <div style={{ fontSize: "6pt", fontStyle: "italic", lineHeight: 1.3 }}>+ {label.hiddenLines} produto(s) no sistema</div>
        ) : null}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "7pt", fontWeight: 700 }}>
        <span>Dutelog</span>
        <span>{units} un.</span>
      </div>
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
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "7pt", fontWeight: 700 }}>
        <span>Dutelog</span>
        <span>Comprimento × largura × altura livre</span>
      </div>
    </LabelFrame>
  );
}

export function LabelCard({ label }: { label: LabelData }) {
  return label.kind === "box" ? <BoxLabelCard label={label} /> : <PositionLabelCard label={label} />;
}

function EmptySlot() {
  return <div className="lbl lbl-empty" aria-hidden="true" style={{ width: `${LABEL_MM.width}mm`, height: `${LABEL_MM.height}mm` }} />;
}

/** CSS da folha e da página: o @page muda com o modo, por isso vai inline. */
export function labelSheetCss(mode: LabelMode) {
  const margins = sheetMargins();
  const page = mode === "zebra" ? `${LABEL_MM.width}mm ${LABEL_MM.height}mm` : `${SHEET_MM.width}mm ${SHEET_MM.height}mm`;
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
  background: ${PAPER};
  break-after: page;
  page-break-after: always;
}
.lbl-roll .lbl { break-after: page; page-break-after: always; }
.lbl-sheet:last-child, .lbl-roll .lbl:last-child { break-after: auto; page-break-after: auto; }
.lbl-empty { visibility: hidden; }
@media screen {
  .lbl-sheet, .lbl-roll { box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12); margin: 0 auto 12px; }
  .lbl-roll { width: ${LABEL_MM.width}mm; }
  .lbl-sheet .lbl, .lbl-roll .lbl { outline: 0.2mm dashed rgba(0, 0, 0, 0.25); outline-offset: -0.2mm; }
}
@media print {
  @page { size: ${page}; margin: 0; }
  .lbl-print { position: absolute; inset: 0 auto auto 0; margin: 0; padding: 0; }
  .lbl-sheet, .lbl-roll { box-shadow: none; margin: 0; }
  .lbl-sheet .lbl, .lbl-roll .lbl { outline: none; }
}
`;
}

/**
 * As folhas (ou o rolo) prontas para imprimir. `sheets` já vem paginado:
 * null é vaga pulada da folha adesiva.
 */
export function LabelSheet({ sheets, mode }: { sheets: Array<Array<LabelData | null>>; mode: LabelMode }) {
  const css = useMemo(() => labelSheetCss(mode), [mode]);
  return (
    <div className="print-area lbl-print">
      <style>{css}</style>
      {mode === "zebra" ? (
        <div className="lbl-roll">
          {sheets.flat().map((label, index) =>
            label ? <LabelCard key={`${label.kind}-${label.code}-${index}`} label={label} /> : null,
          )}
        </div>
      ) : (
        sheets.map((sheet, sheetIndex) => (
          <div className="lbl-sheet" key={sheetIndex} aria-label={`Folha ${sheetIndex + 1}`}>
            {sheet.map((label, index) =>
              label ? <LabelCard key={`${label.kind}-${label.code}-${index}`} label={label} /> : <EmptySlot key={`vazia-${index}`} />,
            )}
          </div>
        ))
      )}
    </div>
  );
}
