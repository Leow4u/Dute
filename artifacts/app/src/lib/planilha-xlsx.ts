/**
 * Planilha XLSX gerada no navegador, sem dependência: um arquivo zip sem
 * compressão (método "stored") com o mínimo que o Excel, o LibreOffice e o
 * Google Planilhas abrem. Uma aba, a primeira linha em negrito, texto como
 * string em linha, reais com duas casas e datas como data de verdade
 * (dd/mm/aaaa), para a pessoa somar e filtrar.
 *
 * Usado pela exportação das listas do Financeiro (parte 4.2c). O valor entra
 * em centavos e sai em reais, sem float no caminho até a divisão final.
 */

export type Celula = string | number | { reais: number } | { data: string } | null;

const ESTILO = { texto: 0, cabecalho: 1, reais: 2, data: 3 } as const;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Escapa o texto para XML; tira os caracteres de controle que o XML 1.0 não aceita. */
export function escaparXml(texto: string): string {
  return texto
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "A", "B", ..., "Z", "AA". */
export function colunaDaPlanilha(indice: number): string {
  let resto = indice + 1;
  let nome = "";
  while (resto > 0) {
    const letra = (resto - 1) % 26;
    nome = String.fromCharCode(65 + letra) + nome;
    resto = Math.floor((resto - 1) / 26);
  }
  return nome;
}

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** O número de série da data no Excel (dias desde 30/12/1899), ou null fora do formato. */
export function serialDaData(dia: string): number | null {
  const partes = DATA.exec(dia);
  if (!partes) return null;
  const instante = Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
  return Math.round((instante - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function celulaXml(celula: Celula, referencia: string, cabecalho: boolean): string {
  if (celula === null || celula === "") return "";
  if (typeof celula === "string") {
    const estilo = cabecalho ? ` s="${ESTILO.cabecalho}"` : "";
    return `<c r="${referencia}" t="inlineStr"${estilo}><is><t xml:space="preserve">${escaparXml(celula)}</t></is></c>`;
  }
  if (typeof celula === "number") return Number.isFinite(celula) ? `<c r="${referencia}"><v>${celula}</v></c>` : "";
  if ("reais" in celula) {
    if (!Number.isSafeInteger(celula.reais)) return "";
    const sinal = celula.reais < 0 ? "-" : "";
    const absoluto = Math.abs(celula.reais);
    const valor = `${sinal}${Math.floor(absoluto / 100)}.${String(absoluto % 100).padStart(2, "0")}`;
    return `<c r="${referencia}" s="${ESTILO.reais}"><v>${valor}</v></c>`;
  }
  const serial = serialDaData(celula.data);
  return serial === null ? "" : `<c r="${referencia}" s="${ESTILO.data}"><v>${serial}</v></c>`;
}

function folhaXml(cabecalho: readonly string[], linhas: readonly (readonly Celula[])[]): string {
  const todas: readonly (readonly Celula[])[] = [cabecalho, ...linhas];
  const corpo = todas
    .map((linha, indiceDaLinha) => {
      const celulas = linha.map((celula, indice) => celulaXml(celula, `${colunaDaPlanilha(indice)}${indiceDaLinha + 1}`, indiceDaLinha === 0)).join("");
      return `<row r="${indiceDaLinha + 1}">${celulas}</row>`;
    })
    .join("");
  const largura = cabecalho.length ? `<cols><col min="1" max="${cabecalho.length}" width="18" customWidth="1"/></cols>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${largura}<sheetData>${corpo}</sheetData></worksheet>`;
}

function workbookXml(aba: string): string {
  // O nome da aba: até 31 caracteres, sem : \ / ? * [ ].
  const nome = escaparXml(aba.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31).trim() || "Planilha");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${nome}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

// --- Zip sem compressão ----------------------------------------------------------------------

const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

export function crc32(dados: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of dados) crc = TABELA_CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 01/01/2026 00:00, no formato de data e hora do DOS (a data não importa para a planilha). */
const HORA_DOS = 0;
const DATA_DOS = ((2026 - 1980) << 9) | (1 << 5) | 1;

function zipSemCompressao(arquivos: ReadonlyArray<{ nome: string; conteudo: string }>): Uint8Array<ArrayBuffer> {
  const codificador = new TextEncoder();
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let deslocamento = 0;
  for (const arquivo of arquivos) {
    const nome = codificador.encode(arquivo.nome);
    const dados = codificador.encode(arquivo.conteudo);
    const crc = crc32(dados);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, HORA_DOS, true);
    local.setUint16(12, DATA_DOS, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, dados.length, true);
    local.setUint32(22, dados.length, true);
    local.setUint16(26, nome.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nome, dados);

    const entrada = new DataView(new ArrayBuffer(46));
    entrada.setUint32(0, 0x02014b50, true);
    entrada.setUint16(4, 20, true);
    entrada.setUint16(6, 20, true);
    entrada.setUint16(8, 0x0800, true);
    entrada.setUint16(10, 0, true);
    entrada.setUint16(12, HORA_DOS, true);
    entrada.setUint16(14, DATA_DOS, true);
    entrada.setUint32(16, crc, true);
    entrada.setUint32(20, dados.length, true);
    entrada.setUint32(24, dados.length, true);
    entrada.setUint16(28, nome.length, true);
    entrada.setUint32(42, deslocamento, true);
    central.push(new Uint8Array(entrada.buffer), nome);
    deslocamento += 30 + nome.length + dados.length;
  }
  const tamanhoCentral = central.reduce((soma, parte) => soma + parte.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true);
  fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, deslocamento, true);
  const todas = [...partes, ...central, new Uint8Array(fim.buffer)];
  const saida = new Uint8Array(todas.reduce((soma, parte) => soma + parte.length, 0));
  let posicao = 0;
  for (const parte of todas) {
    saida.set(parte, posicao);
    posicao += parte.length;
  }
  return saida;
}

/** A planilha: uma aba, o cabeçalho em negrito e congelado, as linhas. */
export function planilhaXlsx(aba: string, cabecalho: readonly string[], linhas: readonly (readonly Celula[])[]): Uint8Array<ArrayBuffer> {
  return zipSemCompressao([
    { nome: "[Content_Types].xml", conteudo: CONTENT_TYPES },
    { nome: "_rels/.rels", conteudo: RELS },
    { nome: "xl/workbook.xml", conteudo: workbookXml(aba) },
    { nome: "xl/_rels/workbook.xml.rels", conteudo: WORKBOOK_RELS },
    { nome: "xl/styles.xml", conteudo: STYLES },
    { nome: "xl/worksheets/sheet1.xml", conteudo: folhaXml(cabecalho, linhas) },
  ]);
}

export const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Baixa a planilha no navegador. */
export function baixarPlanilha(nomeDoArquivo: string, bytes: Uint8Array<ArrayBuffer>): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: TIPO_XLSX }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeDoArquivo;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
