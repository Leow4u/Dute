import { describe, expect, it } from "vitest";

import {
  acompanharAprovacao,
  avisoDoCartaoParado,
  confirmacaoDaAcao,
  filaDeAprovacao,
  hrefDaAprovacao,
  hrefParaGuardarPosicao,
  linhasCompactas,
  numeroDaBusca,
  orcamentosParaOInicio,
  pontosDeConferir,
  posicaoNaFila,
  proximoDepois,
  quemOrcou,
} from "./aprovar";
import { linhasGravadas } from "./documento";

/** O valor como formatarReais (lib/dominio) escreve: "R$" e o espaço fixo. */
const R = (valor: string) => `R$ ${valor}`;

/**
 * Aprovar no celular (docs/mockups/ComAprovarCelular.dc.html, parte 12a): a
 * fila do owner, a navegação "1 de N" com anterior e próximo, o próximo
 * depois de decidir, e o bloco Conferir com o que fugiu da tabela.
 */

type Registro = Record<string, unknown>;

function demanda(numero: string, extra: Registro = {}): { id: string; data: Registro } {
  return {
    id: numero,
    data: {
      numero,
      customer_code: "ITAU-UNIBANCO",
      customer_name: "Itaú Unibanco",
      titulo: "Mudança de layout · 12º andar",
      ref_cliente: "CE8977",
      solicitante: { contato_id: "ct_renata", empresa: "Souza & Lopes" },
      etapa: "para_aprovar",
      etapa_desde: "2026-10-20T19:40:00.000Z",
      marcos: [],
      ...extra,
    },
  };
}

const LINHAS = [
  { id: "ln_1", origem: "tabela", lpu_item_id: "lpu_est", codigo: "1.01", item: "Estação de trabalho em L 1,40 m", descricao: "x", servico: "Desmontagem", unidade: "UN", quantidade: "24", preco: "85", preco_tabela: "85", motivo: null, total_cents: 204_000 },
  { id: "ln_2", origem: "alterado", lpu_item_id: "lpu_vuc", codigo: "5.02", item: "Transporte dedicado VUC até 2,5 t", descricao: "x", servico: "Frete", unidade: "VG", quantidade: "3", preco: "980", preco_tabela: "860", motivo: "Espera de 2 h na doca do CEIC", total_cents: 294_000 },
  { id: "ln_3", origem: "avulso", lpu_item_id: null, codigo: null, item: "Içamento de cofre pela escada", descricao: "Içamento de cofre pela escada", servico: "Içamento", unidade: "VB", quantidade: "1", preco: "1450", preco_tabela: null, motivo: "Fora da LPU", total_cents: 145_000 },
  { id: "ln_4", origem: "ajuste", lpu_item_id: null, codigo: null, item: "Arredondamento combinado", descricao: "Arredondamento combinado", servico: null, unidade: null, quantidade: "1", preco: "-500", preco_tabela: null, motivo: "Combinado com a Souza & Lopes", total_cents: -50_000 },
];

function orcamento(numero: string, extra: Registro = {}): { id: string; data: Registro } {
  return {
    id: numero,
    data: {
      numero,
      rotulo: numero,
      rv: 0,
      tipo_rv: "proposta",
      status: "para_aprovar",
      edicao: 2,
      data_base: "2026-10-14",
      tabela: { id: "pt_itau", nome: "LPU Itaú v2.0", variante: "Comercial" },
      linhas: LINHAS,
      total_cents: 593_000,
      marcas: ["preco_alterado", "item_avulso", "ajuste"],
      autor_uid: "u-gui",
      autor_nome: "Guilherme",
      passo_em: "2026-10-20T19:40:00.000Z",
      ...extra,
    },
  };
}

describe("a fila de aprovação", () => {
  it("só a demanda em Para aprovar com a RV para aprovar; quem espera há mais tempo primeiro", () => {
    const demandas = [
      demanda("10052", { etapa_desde: "2026-10-21T12:00:00.000Z" }),
      demanda("10045", { etapa_desde: "2026-10-20T12:00:00.000Z" }),
      demanda("10048", { etapa_desde: "2026-10-19T12:00:00.000Z" }),
      // A demanda ainda em Para aprovar com a RV já aprovada (o snapshot de quotes chegou antes): fora.
      demanda("10050", { etapa_desde: "2026-10-18T12:00:00.000Z" }),
      demanda("10051", { etapa: "em_montagem" }),
    ];
    const orcamentos = [orcamento("10052"), orcamento("10045"), orcamento("10048"), orcamento("10050", { status: "aprovado" })];
    const fila = filaDeAprovacao(demandas, orcamentos);
    expect(fila.map((item) => item.item.numero)).toEqual(["10048", "10045", "10052"]);
    expect(fila[0].linhas.map((linha) => linha.id)).toEqual(["ln_1", "ln_2", "ln_3", "ln_4"]);
    expect(filaDeAprovacao(demandas, [])).toEqual([]);
  });

  it("o link da tela, com ou sem o orçamento, e o número da busca", () => {
    expect(hrefDaAprovacao()).toBe("/comercial/aprovar");
    expect(hrefDaAprovacao("10045")).toBe("/comercial/aprovar?numero=10045");
    expect(numeroDaBusca("?numero=10045")).toBe("10045");
    expect(numeroDaBusca("numero=abc")).toBeNull();
    expect(numeroDaBusca("")).toBeNull();
  });
});

describe("navegação: 1 de N, anterior e próximo", () => {
  const FILA = ["10048", "10045", "10052"];

  it("sem escolha, o primeiro; no meio, anterior e próximo; nas pontas, um só", () => {
    expect(posicaoNaFila(FILA, null)).toEqual({ atual: "10048", indice: 1, total: 3, anterior: null, proximo: "10045" });
    expect(posicaoNaFila(FILA, "10045")).toEqual({ atual: "10045", indice: 2, total: 3, anterior: "10048", proximo: "10052" });
    expect(posicaoNaFila(FILA, "10052")).toEqual({ atual: "10052", indice: 3, total: 3, anterior: "10045", proximo: null });
  });

  it("o escolhido que não está na fila não vira outro orçamento: sem posição, e o Próximo é o primeiro; fila vazia, nada", () => {
    expect(posicaoNaFila(FILA, "99999")).toEqual({ atual: null, indice: 0, total: 3, anterior: null, proximo: "10048" });
    expect(posicaoNaFila([], "10045")).toEqual({ atual: null, indice: 0, total: 0, anterior: null, proximo: null });
  });

  it("Próximo depois de aprovar: o que vinha depois na fila que a pessoa via", () => {
    // Aprovou o 10045 (2 de 3): ele sai da fila ao vivo; o próximo é o 10052.
    expect(proximoDepois(["10048", "10052"], FILA, "10045")).toBe("10052");
    // O snapshot ainda não tirou o decidido: ele nunca é o próximo.
    expect(proximoDepois(FILA, FILA, "10045")).toBe("10052");
    // O último decidido volta ao primeiro que ainda espera.
    expect(proximoDepois(["10048", "10045"], FILA, "10052")).toBe("10048");
    // O que vinha depois também saiu (outra pessoa aprovou): o seguinte que ainda espera, ou o primeiro.
    expect(proximoDepois(["10048"], FILA, "10045")).toBe("10048");
    // Chegou um novo enquanto isso: entra no fim, depois dos que a pessoa via.
    expect(proximoDepois(["10048", "10052", "10060"], FILA, "10052")).toBe("10048");
    // Nada mais para aprovar.
    expect(proximoDepois([], FILA, "10045")).toBeNull();
    expect(proximoDepois(["10045"], ["10045"], "10045")).toBeNull();
  });
});

describe("o orçamento na tela não troca sozinho", () => {
  const DEMANDAS = [
    demanda("10048", { etapa_desde: "2026-10-19T12:00:00.000Z" }),
    demanda("10045", { etapa_desde: "2026-10-20T12:00:00.000Z" }),
    demanda("10052", { etapa_desde: "2026-10-21T12:00:00.000Z" }),
  ];
  const FILA = filaDeAprovacao(DEMANDAS, [orcamento("10048"), orcamento("10045"), orcamento("10052")]);
  const sem = (numero: string) => FILA.filter((orcamento) => orcamento.item.numero !== numero);

  it("sem escolha, o primeiro; se ele sai da fila, o cartão fica parado nele, sem virar o seguinte", () => {
    const primeiro = acompanharAprovacao(FILA, null, null);
    expect(primeiro).toMatchObject({ numero: "10048", situacao: "na_fila", posicao: { indice: 1, total: 3 } });
    expect(primeiro.orcamento?.item.numero).toBe("10048");
    // Outro aparelho aprovou o 10048: a tela não troca para o 10045.
    const saiu = acompanharAprovacao(sem("10048"), null, primeiro.visto);
    expect(saiu).toMatchObject({ numero: "10048", situacao: "saiu", posicao: { indice: 1, total: 3, anterior: null, proximo: "10045" } });
    expect(saiu.orcamento?.item.numero).toBe("10048");
  });

  it("o escolhido que sai da fila (puxado de volta, perdido, decidido noutro aparelho) para o cartão; o Próximo segue a fila que a pessoa via", () => {
    const visto = acompanharAprovacao(FILA, "10045", null);
    expect(visto).toMatchObject({ numero: "10045", situacao: "na_fila", posicao: { indice: 2, anterior: "10048", proximo: "10052" } });
    const saiu = acompanharAprovacao(sem("10045"), "10045", visto.visto);
    expect(saiu).toMatchObject({ numero: "10045", situacao: "saiu", posicao: { indice: 2, total: 3, anterior: null, proximo: "10052" } });
    expect(saiu.orcamento?.item.numero).toBe("10045");
    // Continua parado nas leituras seguintes, até a pessoa sair dele.
    expect(acompanharAprovacao(sem("10045"), "10045", saiu.visto)).toMatchObject({ situacao: "saiu" });
  });

  it("o que volta à fila com outra edição (editado e mandado de novo) não troca o cartão: mudou; sem o visto, a edição nova", () => {
    const visto = acompanharAprovacao(FILA, "10045", null);
    const outra = filaDeAprovacao(DEMANDAS, [orcamento("10048"), orcamento("10045", { edicao: 4, total_cents: 700_000 }), orcamento("10052")]);
    const mudou = acompanharAprovacao(outra, "10045", visto.visto);
    expect(mudou).toMatchObject({ numero: "10045", situacao: "mudou" });
    expect(mudou.orcamento?.item.totalCents).toBe(593_000);
    const recarregado = acompanharAprovacao(outra, "10045", null);
    expect(recarregado).toMatchObject({ situacao: "na_fila" });
    expect(recarregado.orcamento?.item.totalCents).toBe(700_000);
  });

  it("o link para um orçamento fora da fila não abre outro no lugar", () => {
    expect(acompanharAprovacao(FILA, "99999", null)).toMatchObject({
      numero: "99999",
      orcamento: null,
      situacao: "saiu",
      posicao: { indice: 0, total: 3, anterior: null, proximo: "10048" },
    });
  });

  it("a fila que muda sem tirar o da tela só atualiza a posição; nada mudou, o mesmo visto", () => {
    const visto = acompanharAprovacao(FILA, "10045", null);
    expect(acompanharAprovacao(sem("10048"), "10045", visto.visto)).toMatchObject({ situacao: "na_fila", posicao: { indice: 1, total: 2 } });
    expect(acompanharAprovacao(FILA, "10045", visto.visto).visto).toBe(visto.visto);
  });

  it("fila vazia, nada na tela", () => {
    expect(acompanharAprovacao([], null, null)).toMatchObject({ numero: null, orcamento: null, situacao: "vazia", visto: null });
  });

  it("o aviso do cartão parado e o que ele oferece: Próximo, ou Recarregar o que mudou", () => {
    const visto = acompanharAprovacao(FILA, "10045", null);
    expect(avisoDoCartaoParado(visto)).toBeNull();
    expect(avisoDoCartaoParado(acompanharAprovacao(sem("10045"), "10045", visto.visto))).toEqual({
      texto: "O orçamento 10045 saiu da fila",
      acao: "proximo",
    });
    const outra = filaDeAprovacao(DEMANDAS, [orcamento("10048"), orcamento("10045", { edicao: 4 }), orcamento("10052")]);
    expect(avisoDoCartaoParado(acompanharAprovacao(outra, "10045", visto.visto))).toEqual({
      texto: "O orçamento 10045 mudou",
      acao: "recarregar",
    });
    expect(avisoDoCartaoParado(acompanharAprovacao(FILA, "99999", null))).toEqual({
      texto: "O orçamento 99999 não está para aprovar",
      acao: "proximo",
    });
  });

  it("a URL guarda o orçamento da tela: voltar do PDF ou do orçamento cai nele", () => {
    expect(hrefParaGuardarPosicao("", "10048")).toBe("/comercial/aprovar?numero=10048");
    expect(hrefParaGuardarPosicao("?numero=10048", "10045")).toBe("/comercial/aprovar?numero=10045");
    expect(hrefParaGuardarPosicao("?numero=10045", "10045")).toBeNull();
    expect(hrefParaGuardarPosicao("?numero=10045", null)).toBeNull();
  });
});

describe("o bloco Conferir", () => {
  const linhas = linhasGravadas(LINHAS);

  it("a alterada com o preço da tabela riscado e o motivo, a avulsa e o ajuste; a linha de tabela fica fora", () => {
    expect(pontosDeConferir(linhas, ["preco_alterado", "item_avulso", "ajuste"])).toEqual([
      {
        chave: "ln_2",
        origem: "alterado",
        rotulo: "Alterado",
        titulo: "Transporte dedicado VUC até 2,5 t · Frete",
        valor: R("980,00"),
        riscado: R("860,00"),
        motivo: "Espera de 2 h na doca do CEIC",
      },
      {
        chave: "ln_3",
        origem: "avulso",
        rotulo: "Avulso",
        titulo: "Içamento de cofre pela escada · Içamento",
        valor: R("1.450,00"),
        riscado: null,
        motivo: "Fora da LPU",
      },
      {
        chave: "ln_4",
        origem: "ajuste",
        rotulo: "Ajuste",
        titulo: "Arredondamento combinado",
        valor: `-${R("500,00")}`,
        riscado: null,
        motivo: "Combinado com a Souza & Lopes",
      },
    ]);
  });

  it("a tabela fora da vigência e o orçamento sem tabela também se conferem; o legado, não", () => {
    expect(pontosDeConferir([], ["tabela_vencida", "legado"]).map((ponto) => [ponto.origem, ponto.titulo])).toEqual([
      [null, "Tabela fora da vigência na data-base"],
    ]);
    expect(pontosDeConferir([], ["sem_tabela"])[0].titulo).toBe("Sem tabela");
  });

  it("orçamento todo de tabela: nada a conferir", () => {
    expect(pontosDeConferir(linhas.filter((linha) => linha.origem === "tabela"), [])).toEqual([]);
  });

  it("a lista compacta: nome, quantidade com unidade, origem e total; o alterado com o total da tabela riscado", () => {
    expect(linhasCompactas(linhas)).toEqual([
      { chave: "ln_1", nome: "Estação de trabalho em L 1,40 m · Desmontagem", quantidade: "24 UN", origem: "tabela", total: R("2.040,00"), riscado: null },
      { chave: "ln_2", nome: "Transporte dedicado VUC até 2,5 t · Frete", quantidade: "3 VG", origem: "alterado", total: R("2.940,00"), riscado: R("2.580,00") },
      { chave: "ln_3", nome: "Içamento de cofre pela escada · Içamento", quantidade: "1 VB", origem: "avulso", total: R("1.450,00"), riscado: null },
      { chave: "ln_4", nome: "Arredondamento combinado", quantidade: "", origem: "ajuste", total: `-${R("500,00")}`, riscado: null },
    ]);
  });
});

describe("quem orçou e a confirmação", () => {
  it("quem montou e quando mandou para aprovação", () => {
    expect(quemOrcou("Guilherme", "2026-10-20T19:40:00.000Z")).toBe("Guilherme · 20/10 16:40");
    expect(quemOrcou(null, "2026-10-20T19:40:00.000Z")).toBe("20/10 16:40");
    expect(quemOrcou(null, null)).toBe("—");
  });

  it("depois da ação, o que aconteceu e a hora (São Paulo)", () => {
    expect(confirmacaoDaAcao("approve", "2026-10-21T20:05:00.000Z", "Guilherme")).toBe("Aprovado 17:05");
    expect(confirmacaoDaAcao("approve_and_send", "2026-10-21T20:05:00.000Z", "Guilherme")).toBe("Aprovado e enviado 17:05");
    expect(confirmacaoDaAcao("return", "2026-10-21T20:05:00.000Z", "Guilherme")).toBe("Devolvido a Guilherme");
    expect(confirmacaoDaAcao("return", "2026-10-21T20:05:00.000Z", null)).toBe("Devolvido");
  });
});

describe("o item do Início", () => {
  it("as demandas em Para aprovar, de quem espera há mais tempo, com o cliente", () => {
    expect(
      orcamentosParaOInicio([
        demanda("10052", { etapa_desde: "2026-10-21T12:00:00.000Z", customer_name: "Grupo SBF" }),
        demanda("10045", { etapa_desde: "2026-10-20T12:00:00.000Z" }),
        demanda("10051", { etapa: "em_montagem" }),
      ]),
    ).toEqual([
      { numero: "10045", cliente: "Itaú Unibanco" },
      { numero: "10052", cliente: "Grupo SBF" },
    ]);
  });
});
