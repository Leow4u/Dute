import { describe, expect, it } from "vitest";

import {
  COLUNAS_DO_DIARIO,
  csvDoDiario,
  exportarDiarioDeBordo,
  nomeDoArquivoDoDiario,
  somarQuantidades,
} from "./diario";
import { medicaoDoRegistro, type Medicao } from "./medicoes";
import { L2, itemDoDoc, linhaDoDoc, medicaoDoDoc, VUC, AJUDANTE_UTIL, CLASSE_VEICULO } from "./medicoes-exemplo";
// A função do servidor (functions/comercial): o app e o servidor têm de exportar o mesmo arquivo.
import { exportarDiarioDeBordo as exportarNoServidor } from "../../../../../functions/comercial/src/domain/medicao";

/**
 * Diário de Bordo do Safra (parte 16b de docs/plataforma/fase-6-comercial.md):
 * o arquivo que o cliente pede, gerado no navegador pela mesma função pura
 * do servidor (domain/medicao.ts, exportarDiarioDeBordo). Os dois rodam as
 * mesmas medições abaixo e precisam devolver as mesmas linhas.
 */

function medicao(sobrescrever: Record<string, unknown> = {}): Medicao {
  return medicaoDoRegistro("safra_2026-10", medicaoDoDoc(sobrescrever))!;
}

describe("Diário de Bordo: colunas e valores", () => {
  it("as 15 colunas do arquivo do cliente, na ordem (os dois Custo são o do veículo e o dos ajudantes)", () => {
    expect(COLUNAS_DO_DIARIO).toEqual([
      "OS",
      "Data Solic.",
      "Solicitante",
      "Data Frete",
      "Veículo",
      "Veículo Quant.",
      "Custo (R$)",
      "Horário Ajudante",
      "Ajudante Quant.",
      "Custo (R$)",
      "Custo Total (R$)",
      "Local Origem",
      "Local Destino",
      "Descrição Mercadoria",
      "Chave",
    ]);
  });

  it("uma linha do Diário por OS, em ordem de execução, com o veículo, os ajudantes e o total", () => {
    const linhas = exportarDiarioDeBordo(medicao());
    expect(linhas.map((linha) => linha.colunas)).toEqual([
      [
        "OS 10031-01",
        "29/09/2026",
        "Infraestrutura",
        "01/10/2026",
        "VUC",
        "1",
        "620,00",
        "Ajudante de Segunda a Sexta das 09:00 às 18:00",
        "2",
        "560,00",
        "1.180,00",
        "Sede Paulista",
        "Agência Augusta",
        "18 caixas de arquivo",
        "",
      ],
      [
        "OS 10034-01",
        "02/10/2026",
        "Facilities",
        "03/10/2026",
        "3/4",
        "1",
        "890,00",
        "Ajudante de Segunda a Sexta das 09:00 às 18:00",
        "3",
        "840,00",
        "1.730,00",
        "Agência Augusta",
        "Sede Paulista",
        "14 cadeiras e 2 armários altos",
        "",
      ],
      [
        "OS 10038-01",
        "08/10/2026",
        "Arquivo",
        "12/10/2026",
        "Truck até Jundiaí",
        "1",
        "1.350,00",
        "Ajudante de Domingo/feriado das 08:00 às 17:00",
        "4",
        "1.904,00",
        "3.254,00",
        "Sede Paulista",
        "Arquivo Jundiaí",
        "120 caixas de arquivo",
        "",
      ],
      [
        "OS 10043-01",
        "15/10/2026",
        "Facilities",
        "18/10/2026",
        "VUC",
        "1",
        "620,00",
        "Ajudante de Domingo/feriado das 08:00 às 17:00",
        "2",
        "952,00",
        "1.572,00",
        "Sede Paulista",
        "Agência Vila Olímpia",
        "40 caixas de material",
        "",
      ],
    ]);
  });

  it("a soma do Diário é o total da medição", () => {
    const linhas = exportarDiarioDeBordo(medicao());
    expect(linhas.reduce((soma, linha) => soma + linha.valor_cents, 0)).toBe(773600);
  });

  it("linha com dois tipos de veículo sai em uma linha do Diário por veículo, e os ajudantes ficam na primeira", () => {
    const dois = linhaDoDoc({
      ...(L2 as Record<string, never>),
      id: "dois",
      os: "OS 10050-01",
      executada_em: "2026-10-20",
      dia_tipo: "util",
      itens: [VUC("1", 62000), itemDoDoc({ lpu_item_id: "tq", descricao: "3/4", preco: "890.00", total_cents: 89000, classe: CLASSE_VEICULO }), AJUDANTE_UTIL("2", 56000)],
      total_cents: 207000,
      marcas: [],
    });
    const linhas = exportarDiarioDeBordo(medicao({ linhas: [dois], total_cents: 207000 }));
    expect(linhas.map((linha) => [linha.os, linha.veiculo, linha.ajudante_quantidade, linha.valor_cents])).toEqual([
      ["OS 10050-01", "VUC", "2", 118000],
      ["OS 10050-01", "3/4", "0", 89000],
    ]);
  });

  it("o solicitante é a área e a chave orçamentária sai vazia", () => {
    const [primeira] = exportarDiarioDeBordo(medicao());
    expect(primeira.solicitante).toBe("Infraestrutura");
    expect(primeira.chave).toBe("");
  });

  it("quantidades fracionadas somam sem float", () => {
    expect(somarQuantidades(["1.5", "2"])).toBe("3,5");
    expect(somarQuantidades(["0.1", "0.2"])).toBe("0,3");
    expect(somarQuantidades(["1", "2"])).toBe("3");
  });
});

describe("Diário de Bordo: o app e o servidor exportam o mesmo", () => {
  it("a medição de outubro", () => {
    const lida = medicao();
    const noApp = exportarDiarioDeBordo(lida).map((linha) => linha.colunas);
    const noServidor = exportarNoServidor({ linhas: lida.linhas as never }).map((linha) => linha.colunas);
    expect(noApp).toEqual(noServidor);
  });

  it("a linha com dois veículos e o item sem classificação", () => {
    const dois = linhaDoDoc({
      ...(L2 as Record<string, never>),
      id: "dois",
      os: "OS 10050-01",
      executada_em: "2026-10-20",
      itens: [
        VUC("1", 62000),
        itemDoDoc({ lpu_item_id: "tq", descricao: "3/4", preco: "890.00", total_cents: 89000, classe: CLASSE_VEICULO }),
        AJUDANTE_UTIL("1.5", 42000),
        itemDoDoc({ lpu_item_id: "emb", descricao: "Embalagem", preco: "10.00", quantidade: "3", total_cents: 3000, classe: { diaria: null, veiculo: false, ajudante: false } }),
      ],
      total_cents: 196000,
      marcas: [],
    });
    const lida = medicao({ linhas: [dois], total_cents: 196000 });
    expect(exportarDiarioDeBordo(lida).map((linha) => linha.colunas)).toEqual(
      exportarNoServidor({ linhas: lida.linhas as never }).map((linha) => linha.colunas),
    );
  });
});

describe("arquivo CSV", () => {
  const linhas = exportarDiarioDeBordo(medicao());

  it("abre direto no Excel em português: BOM, ponto e vírgula, linhas com CRLF e o cabeçalho do cliente", () => {
    const csv = csvDoDiario(linhas);
    expect(csv.startsWith("﻿")).toBe(true);
    const registros = csv.slice(1).split("\r\n");
    expect(registros[0]).toBe(COLUNAS_DO_DIARIO.join(";"));
    expect(registros).toHaveLength(1 + 4 + 1);
    expect(registros.at(-1)).toBe("");
    expect(registros[1]).toBe(
      "OS 10031-01;29/09/2026;Infraestrutura;01/10/2026;VUC;1;620,00;Ajudante de Segunda a Sexta das 09:00 às 18:00;2;560,00;1.180,00;Sede Paulista;Agência Augusta;18 caixas de arquivo;",
    );
  });

  it("célula com ponto e vírgula, aspas ou quebra de linha vai entre aspas, com as aspas dobradas", () => {
    const [primeira] = linhas;
    const csv = csvDoDiario([{ ...primeira, colunas: ["a;b", 'diz "oi"', "linha\noutra", "simples", ...primeira.colunas.slice(4)] }]);
    const corpo = csv.slice(1).split("\r\n")[1];
    expect(corpo.startsWith('"a;b";"diz ""oi""";"linha\noutra";simples;')).toBe(true);
  });

  it("célula que o Excel leria como fórmula ganha um apóstrofo na frente", () => {
    const [primeira] = linhas;
    const csv = csvDoDiario([{ ...primeira, colunas: ["=SOMA(A1)", "+1", "-cmd", "@x", ...primeira.colunas.slice(4)] }]);
    expect(csv.slice(1).split("\r\n")[1].startsWith("'=SOMA(A1);'+1;'-cmd;'@x;")).toBe(true);
  });

  it("nome do arquivo: cliente, competência", () => {
    expect(nomeDoArquivoDoDiario("Banco Safra S.A.", "2026-10")).toBe("diario-de-bordo-banco-safra-s-a-2026-10.csv");
    expect(nomeDoArquivoDoDiario("", "2026-10")).toBe("diario-de-bordo-2026-10.csv");
  });
});
