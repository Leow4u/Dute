import { crc32 as crcDoNode } from "node:zlib";

import { describe, expect, it } from "vitest";

import { colunaDaPlanilha, crc32, escaparXml, planilhaXlsx, serialDaData } from "./planilha-xlsx";

/**
 * A planilha XLSX sem dependência (parte 4.2c do Financeiro): o zip sem
 * compressão é lido aqui pelo diretório central, com o CRC conferido pelo
 * zlib do Node, e a aba tem o cabeçalho, o texto escapado, os reais com duas
 * casas e as datas como número de série com o formato dd/mm/aaaa.
 */

function lerZip(bytes: Uint8Array): Map<string, string> {
  const visao = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fim = bytes.length - 22;
  expect(visao.getUint32(fim, true)).toBe(0x06054b50);
  const total = visao.getUint16(fim + 10, true);
  let posicao = visao.getUint32(fim + 16, true);
  const decodificador = new TextDecoder();
  const arquivos = new Map<string, string>();
  for (let indice = 0; indice < total; indice += 1) {
    expect(visao.getUint32(posicao, true)).toBe(0x02014b50);
    expect(visao.getUint16(posicao + 10, true)).toBe(0);
    const crc = visao.getUint32(posicao + 16, true);
    const tamanho = visao.getUint32(posicao + 20, true);
    const tamanhoDoNome = visao.getUint16(posicao + 28, true);
    const local = visao.getUint32(posicao + 42, true);
    const nome = decodificador.decode(bytes.subarray(posicao + 46, posicao + 46 + tamanhoDoNome));
    expect(visao.getUint32(local, true)).toBe(0x04034b50);
    const inicio = local + 30 + visao.getUint16(local + 26, true) + visao.getUint16(local + 28, true);
    const dados = bytes.subarray(inicio, inicio + tamanho);
    expect(crcDoNode(dados), nome).toBe(crc);
    arquivos.set(nome, decodificador.decode(dados));
    posicao += 46 + tamanhoDoNome;
  }
  return arquivos;
}

describe("planilha XLSX", () => {
  it("o zip tem as partes do pacote, com o CRC certo", () => {
    const arquivos = lerZip(planilhaXlsx("NFs", ["NF"], [["1234"]]));
    expect([...arquivos.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]);
    expect(arquivos.get("xl/workbook.xml")).toContain('<sheet name="NFs" sheetId="1" r:id="rId1"/>');
    expect(arquivos.get("xl/styles.xml")).toContain('<numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>');
  });

  it("o cabeçalho em negrito; texto escapado; reais com duas casas; data como número de série", () => {
    const folha = lerZip(
      planilhaXlsx("NFs a receber", ["NF", "Cliente", "Emissão", "Valor", "Demandas"], [
        ["1234", "Itaú & Cia <SP>", { data: "2026-10-23" }, { reais: 1_484_550 }, 2],
        ["77", 'Banco "Safra"', { data: "outubro" }, { reais: -5 }, null],
      ]),
    ).get("xl/worksheets/sheet1.xml")!;
    expect(folha).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">NF</t></is></c>');
    expect(folha).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">Itaú &amp; Cia &lt;SP&gt;</t></is></c>');
    expect(folha).toContain('<c r="C2" s="3"><v>46318</v></c>');
    expect(folha).toContain('<c r="D2" s="2"><v>14845.50</v></c>');
    expect(folha).toContain('<c r="E2"><v>2</v></c>');
    expect(folha).toContain("Banco &quot;Safra&quot;");
    expect(folha).toContain('<c r="D3" s="2"><v>-0.05</v></c>');
    // Data fora do formato e célula vazia não viram nada.
    expect(folha).not.toContain('r="C3"');
    expect(folha).not.toContain('r="E3"');
    expect(folha).toContain('state="frozen"');
  });

  it("as peças: coluna, série da data, escape e CRC", () => {
    expect([0, 25, 26, 27, 701, 702].map(colunaDaPlanilha)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(serialDaData("1900-03-01")).toBe(61);
    expect(serialDaData("2026-10-23")).toBe(46318);
    expect(serialDaData("23/10/2026")).toBeNull();
    expect(escaparXml("a\u0001b<c>")).toBe("ab&lt;c&gt;");
    const amostra = new TextEncoder().encode("Dutelog Soluções Logísticas");
    expect(crc32(amostra)).toBe(crcDoNode(amostra));
  });

  it("o nome da aba perde os caracteres que o Excel recusa e fica em 31", () => {
    const workbook = lerZip(planilhaXlsx("Vencidos: 10/2026 [Itaú]? com um nome longo demais", ["NF"], [])).get("xl/workbook.xml")!;
    const nome = /<sheet name="([^"]+)"/.exec(workbook)?.[1] ?? "";
    expect(nome).toBe("Vencidos 10 2026 Itaú com um no");
    expect(nome.length).toBeLessThanOrEqual(31);
  });
});
