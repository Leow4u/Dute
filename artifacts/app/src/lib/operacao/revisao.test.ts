import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { LinhaDoSaldo } from "./demandas";
import { fichaDaLeitura, servicosEmTexto, type FichaDaOs } from "./ficha-da-os";
import {
  aceiteCurto,
  conclusaoEmTexto,
  divergenciasEmTexto,
  horasDaOs,
  linhasParaRevisar,
  paraRevisar,
  pedeAditivo,
  pedidoDaRevisao,
  problemasDaRevisao,
  revisaoInicial,
  saldoDepois,
  type FormularioDaRevisao,
} from "./revisao";

/** A revisão interna na tela (parte 3.10b): as opções de cada divergência e o pedido no formato de reviewServiceOrder. */

const CARLOS = "col_cccccccccccccccc";
const r = (instante: string) => ({ instante, canal: "celular", meio: null, informado_por: CARLOS });

function ficha(extra: Record<string, unknown> = {}): FichaDaOs {
  return fichaDaLeitura("10045-01", {
    status: "em_revisao",
    edicao: 12,
    demanda: "10045",
    customer_code: "ITAU",
    cliente_nome: "Itaú Unibanco",
    servicos: ["transporte", "montagem"],
    janela: { data: "2026-10-20", inicio: "07:30", fim: "18:00" },
    equipe: [{ colaborador_id: CARLOS, nome: "Carlos Silva", papel: "lider", vinculo: "proprio" }],
    itens: [
      { id: "ln_1", codigo: "3.05", item: "Cadeira", unidade: "UN", planejado: "150", executado: "160", incluidos: [{ ...r("2026-10-20T12:32:00.000Z"), quantidade: "10", pedido_por: "Renata Campos", motivo: "Sala 412" }] },
      { id: "ln_2", codigo: "2.02", item: "Mesa", unidade: "UN", planejado: "60", executado: "58" },
      { id: "ln_3", codigo: "3.12", item: "Armário", unidade: "UN", planejado: "12", executado: "12" },
    ],
    etapas: [
      { etapa: "saida_patio", ...r("2026-10-20T10:05:00.000Z") },
      { etapa: "fim", ...r("2026-10-20T20:20:00.000Z") },
    ],
    conclusao: {
      ...r("2026-10-20T20:52:00.000Z"),
      aceite: "assinatura",
      responsavel: { nome: "Renata Campos", cargo: "Facilities" },
      assinatura: "os/10045-01/assinatura/as_0123456789abcdef.png",
      diferencas: [{ linha: "ln_2", previsto: "60", executado: "58", motivo: "2 mesas com pé quebrado" }],
    },
    ...extra,
  }) as FichaDaOs;
}

/** O escopo de 300 cadeiras, 120 mesas e 24 armários; com esta OS e outra de 150 cadeiras, 60 mesas e 12 armários. */
const SALDO: LinhaDoSaldo[] = [
  { id: "ln_1", item: "Cadeira", unidade: "UN", escopo: "300", nasOs: "300", osNumeros: [], saldo: "0" },
  { id: "ln_2", item: "Mesa", unidade: "UN", escopo: "120", nasOs: "120", osNumeros: [], saldo: "0" },
  { id: "ln_3", item: "Armário", unidade: "UN", escopo: "24", nasOs: "24", osNumeros: [], saldo: "0" },
];

const LINHAS = linhasParaRevisar(ficha(), SALDO, false);

function decidido(linhas: Record<string, Partial<FormularioDaRevisao["linhas"][string]>>, nota = ""): FormularioDaRevisao {
  const inicial = revisaoInicial(LINHAS);
  return { linhas: Object.fromEntries(Object.entries(inicial.linhas).map(([id, linha]) => [id, { ...linha, ...(linhas[id] ?? {}) }])), nota };
}

describe("para revisar", () => {
  it("quem espera há mais tempo primeiro, com as divergências e o aceite", () => {
    const outra = ficha({ conclusao: { ...r("2026-10-20T15:40:00.000Z"), aceite: "sem_aceite", responsavel: { nome: "Portaria" }, diferencas: [] }, itens: [] });
    const cartoes = paraRevisar([ficha(), { ...outra, numero: "10047-01", demanda: "10047" }, { ...ficha(), numero: "10050-01", status: "revisada" }], { ITAU: "Itaú Unibanco S.A." }, servicosEmTexto);
    expect(cartoes.map((cartao) => [cartao.numero, cartao.divergencias, cartao.aceite])).toEqual([
      ["10047-01", 0, "Sem aceite no local · 12:40"],
      ["10045-01", 2, "Assinada 17:52 por Renata Campos"],
    ]);
    expect(cartoes[1].cliente).toBe("Itaú Unibanco S.A.");
  });

  it("as horas, a conclusão e as divergências em texto", () => {
    expect(horasDaOs(ficha())).toEqual({ real: "10h15", detalhe: "contra 10h30 planejadas · 1 pessoa" });
    expect(conclusaoEmTexto(ficha())).toBe("Concluída em campo 17:20 · assinada 17:52 por Renata Campos (Facilities)");
    expect(aceiteCurto(ficha())).toBe("Assinada 17:52 por Renata Campos");
    expect(divergenciasEmTexto(LINHAS)).toBe("+10 Cadeira · −2 Mesa");
  });
});

describe("as opções de cada divergência", () => {
  it("acima do orçado: aditivo ou absorver; dentro do saldo: cobrar também; a menos: próxima OS ou encerrar", () => {
    expect(LINHAS.map((linha) => [linha.id, linha.contexto, linha.opcoes])).toEqual([
      ["ln_1", "acima do orçado (310 de 300)", ["aditivo", "absorver", "corrigir"]],
      ["ln_2", null, ["proxima_os", "encerrar", "corrigir"]],
      ["ln_3", null, []],
    ]);
    expect(LINHAS[0].detalhes).toEqual(["+10 incluídas em campo · Carlos Silva · às 09:32 · pedido por Renata Campos · Sala 412"]);
    expect(LINHAS[1].detalhes).toEqual(["Na conclusão: 2 mesas com pé quebrado"]);
    const comSaldo = linhasParaRevisar(ficha(), [{ ...SALDO[0], saldo: "12" }, SALDO[1], SALDO[2]], false);
    expect([comSaldo[0].contexto, comSaldo[0].opcoes]).toEqual(["dentro do saldo (12 livres)", ["cobrar", "aditivo", "absorver", "corrigir"]]);
  });

  it("na demanda direta, o a mais se cobra (sem aditivo)", () => {
    expect(linhasParaRevisar(ficha(), SALDO, true)[0].opcoes).toEqual(["cobrar", "absorver", "corrigir"]);
  });
});

describe("o formulário", () => {
  it("cada divergência pede decisão; absorver pede motivo; corrigir pede quantidade e motivo e decide o que resta", () => {
    expect(problemasDaRevisao(revisaoInicial(LINHAS), LINHAS, false)).toEqual(["Cadeira: decida a divergência (+10).", "Mesa: decida a divergência (−2)."]);
    expect(problemasDaRevisao(decidido({ ln_1: { escolha: "absorver" }, ln_2: { escolha: "encerrar" } }), LINHAS, false)).toEqual(["Cadeira: informe por que absorver sem cobrar."]);
    expect(problemasDaRevisao(decidido({ ln_1: { escolha: "corrigir", quantidade: "155" }, ln_2: { escolha: "encerrar" } }), LINHAS, false)).toEqual([
      "Cadeira: informe o motivo da correção.",
      "Cadeira: decida o que resta (+5).",
    ]);
    expect(problemasDaRevisao(decidido({ ln_1: { escolha: "cobrar" }, ln_2: { escolha: "encerrar" } }), LINHAS, false)).toEqual(["Cadeira: decida a divergência (+10)."]);
  });

  it("o pedido vai no formato de reviewServiceOrder, só com as linhas que divergem", () => {
    const form = decidido({ ln_1: { escolha: "corrigir", quantidade: "155", motivoDaCorrecao: "Contagem em dobro", resto: "aditivo" }, ln_2: { escolha: "proxima_os" } }, " Elevador lento ");
    expect(problemasDaRevisao(form, LINHAS, false)).toEqual([]);
    expect(pedeAditivo(form, LINHAS)).toBe(true);
    expect(pedidoDaRevisao(form, LINHAS, "10045-01", "k1")).toEqual({
      callable: "reviewServiceOrder",
      dados: {
        idempotency_key: "k1",
        numero: "10045-01",
        linhas: [
          { linha: "ln_1", executado: "155", motivo_da_correcao: "Contagem em dobro", decisao: "aditivo" },
          { linha: "ln_2", decisao: "proxima_os" },
        ],
        nota: "Elevador lento",
      },
    });
    // Corrigido para o planejado, não sobra divergência nem decisão.
    const igualada = decidido({ ln_1: { escolha: "corrigir", quantidade: "150", motivoDaCorrecao: "Contei em dobro" }, ln_2: { escolha: "encerrar" } });
    expect(problemasDaRevisao(igualada, LINHAS, false)).toEqual([]);
    expect((pedidoDaRevisao(igualada, LINHAS, "10045-01", "k2").dados.linhas as unknown[])[0]).toEqual({ linha: "ln_1", executado: "150", motivo_da_correcao: "Contei em dobro" });
  });

  it("o saldo na demanda segue a decisão: o a menos que passa para a próxima OS volta", () => {
    expect(saldoDepois(LINHAS[1], decidido({ ln_2: { escolha: "proxima_os" } }).linhas.ln_2)).toBe(2_000);
    expect(saldoDepois(LINHAS[1], decidido({ ln_2: { escolha: "encerrar" } }).linhas.ln_2)).toBe(0);
  });

  it("só manda o que a callable aceita (o schema é strict)", () => {
    const fonte = readFileSync(new URL("../../../../../functions/operacao/src/domain/revisao.ts", import.meta.url), "utf8");
    const bloco = (inicio: string, fim: string) => fonte.slice(fonte.indexOf(inicio), fonte.indexOf(fim, fonte.indexOf(inicio)));
    const chaves = (trecho: string, recuo: number) => [...trecho.matchAll(new RegExp(`^ {${recuo}}(\\w+)(?::|,$)`, "gm"))].map((encontrado) => encontrado[1]);
    const daLinha = chaves(bloco("const LinhaRevisada = z", ".strict();"), 4);
    const doPedido = chaves(bloco("const Revisar = z", ".strict();"), 4);
    const form = decidido({ ln_1: { escolha: "absorver", motivo: "Cortesia" }, ln_2: { escolha: "corrigir", quantidade: "59", motivoDaCorrecao: "Contei", resto: "encerrar" } }, "Ok");
    const { dados } = pedidoDaRevisao(form, LINHAS, "10045-01", "k");
    for (const chave of Object.keys(dados)) expect(doPedido, chave).toContain(chave);
    for (const linha of dados.linhas as Record<string, unknown>[]) for (const chave of Object.keys(linha)) expect(daLinha, chave).toContain(chave);
  });
});
