import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ACOES_ORCAMENTO,
  ErroOrcamento,
  MARCAS_ORCAMENTO,
  acaoJaFeita,
  marcasDoOrcamento,
  mesmoPreco,
  pendenciasParaAprovar,
  precificarLinhas,
  problemaDaAcao,
  type ContextoDePreco,
  type ItemDoCatalogo,
  type LinhaEntrada,
} from "./orcamento.js";
import { STATUS_ORCAMENTO } from "./events.js";
import { PLATFORM_ROLES } from "./platform-roles.js";

/**
 * Orçamento no domínio (parte 9): o servidor sempre recalcula o preço e os
 * totais; a linha de tabela com outro preço vira "alterado" e pede motivo; o
 * item avulso e o ajuste pedem preço e motivo; o ajuste é negativo e o total
 * nunca fica negativo. As transições valem por ação, papel e situação.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
// Compilado em functions/comercial/lib/domain/orcamento.test.js.
const CASOS = JSON.parse(read("../../../../lib/dominio/src/dinheiro.casos.json")) as {
  totais: Array<{ caso: string; linhas: Array<{ quantidade: unknown; preco: unknown; ajuste?: unknown }>; centavos?: number; erro?: string }>;
};

const MESA: ItemDoCatalogo = {
  id: "lpu_mesa",
  item: "Mesa de escritório",
  descricao: "Mesa de escritório",
  servico: "Transporte",
  unidade: "UN",
  orcavel: true,
  ativo: true,
};
const CADEIRA: ItemDoCatalogo = { ...MESA, id: "lpu_cadeira", item: "Cadeira giratória", descricao: "Cadeira" };
const COFRE: ItemDoCatalogo = { ...MESA, id: "lpu_cofre", item: "Cofre", descricao: "Cofre", servico: "Içamento", unidade: "VB" };
const ARMAZENAGEM: ItemDoCatalogo = { ...MESA, id: "lpu_armaz", item: "Armazenagem", servico: "Armazenagem", unidade: "M³/MÊS", orcavel: false };

const TABELA = {
  id: "pt_itau_v2",
  precos: {
    lpu_mesa: { codigo: "DTL-0001-T", descricao_cliente: "Transporte de mesa", preco: "45.50" },
    lpu_cadeira: { codigo: "DTL-0002-T", descricao_cliente: "Transporte de cadeira", preco: "18.50" },
    lpu_armaz: { codigo: "DTL-0900", descricao_cliente: "Armazenagem", preco: "3.89" },
  },
};

function contexto(overrides: Partial<ContextoDePreco> = {}): ContextoDePreco {
  return {
    tabela: TABELA,
    itens: new Map([MESA, CADEIRA, COFRE, ARMAZENAGEM].map((item) => [item.id, item])),
    novoId: (indice) => `ln_novo_${indice}`,
    ...overrides,
  };
}

function erro(fn: () => unknown, pattern: RegExp): ErroOrcamento {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ErroOrcamento, `esperava ErroOrcamento, veio ${String(error)}`);
    assert.match(error.message, pattern);
    return error;
  }
  assert.fail("deveria recusar");
}

describe("preço das linhas", () => {
  it("linha de tabela: preço, código e descrição vêm da tabela; o total é do servidor", () => {
    const resultado = precificarLinhas([{ origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "24" }], contexto());
    assert.deepEqual(resultado.linhas, [
      {
        id: "ln_novo_0",
        lpu_item_id: "lpu_mesa",
        codigo: "DTL-0001-T",
        item: "Mesa de escritório",
        descricao: "Transporte de mesa",
        servico: "Transporte",
        unidade: "UN",
        quantidade: "24",
        preco: "45.50",
        preco_tabela: "45.50",
        origem: "tabela",
        motivo: null,
        origem_local: null,
        destino_local: null,
        total_cents: 109200,
        preco_anterior: null,
      },
    ]);
    assert.equal(resultado.subtotal_cents, 109200);
    assert.equal(resultado.ajustes_cents, 0);
    assert.equal(resultado.total_cents, 109200);
    assert.deepEqual(resultado.por_origem, { tabela: 1, alterado: 0, avulso: 0, ajuste: 0 });
  });

  it("linha de tabela com outro preço vira alterado, com o preço da tabela ao lado, e exige motivo", () => {
    const resultado = precificarLinhas(
      [{ origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "2", preco: "50.00", motivo: "Espera na doca" }],
      contexto(),
    );
    const [linha] = resultado.linhas;
    assert.equal(linha.origem, "alterado");
    assert.equal(linha.preco, "50.00");
    assert.equal(linha.preco_tabela, "45.50");
    assert.equal(linha.motivo, "Espera na doca");
    assert.equal(linha.total_cents, 10000);
    erro(
      () => precificarLinhas([{ origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "2", preco: "50.00" }], contexto()),
      /linha 1.*motivo/i,
    );
    erro(
      () => precificarLinhas([{ origem: "alterado", lpu_item_id: "lpu_mesa", quantidade: "2", preco: "50.00", motivo: "  " }], contexto()),
      /motivo/i,
    );
  });

  it("o mesmo preço escrito de outro jeito continua de tabela; alterado sem preço é recusado", () => {
    const resultado = precificarLinhas(
      [{ origem: "alterado", lpu_item_id: "lpu_mesa", quantidade: "1", preco: "45.5000", motivo: "nada" }],
      contexto(),
    );
    assert.equal(resultado.linhas[0].origem, "tabela");
    assert.equal(resultado.linhas[0].preco, "45.50");
    assert.equal(resultado.linhas[0].motivo, null);
    erro(() => precificarLinhas([{ origem: "alterado", lpu_item_id: "lpu_mesa", quantidade: "1", motivo: "x" }], contexto()), /preço/i);
    assert.equal(mesmoPreco("45.5", "45.50"), true);
    assert.equal(mesmoPreco("045.50", "45.5000"), true);
    assert.equal(mesmoPreco("45.51", "45.50"), false);
  });

  it("item fora da tabela não é linha de tabela; sem tabela, também não", () => {
    erro(() => precificarLinhas([{ origem: "tabela", lpu_item_id: "lpu_cofre", quantidade: "1" }], contexto()), /fora da tabela.*avulso/i);
    erro(() => precificarLinhas([{ origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "1" }], contexto({ tabela: null })), /sem tabela.*avulso/i);
    erro(() => precificarLinhas([{ origem: "tabela", lpu_item_id: "lpu_nada", quantidade: "1" }], contexto()), /catálogo/i);
    erro(() => precificarLinhas([{ origem: "tabela", quantidade: "1" }], contexto()), /item/i);
  });

  it("armazenagem não se orça, nem pela tabela nem como avulso", () => {
    erro(() => precificarLinhas([{ origem: "tabela", lpu_item_id: "lpu_armaz", quantidade: "10" }], contexto()), /armazenagem/i);
    erro(
      () =>
        precificarLinhas(
          [{ origem: "avulso", lpu_item_id: "lpu_armaz", quantidade: "10", preco: "1.00", motivo: "x", descricao: "Armazenagem" }],
          contexto({ tabela: null }),
        ),
      /armazenagem/i,
    );
  });

  it("item avulso: preço, motivo e descrição obrigatórios; item da tabela não entra como avulso", () => {
    const resultado = precificarLinhas(
      [
        {
          origem: "avulso",
          quantidade: "1",
          preco: "1450.00",
          motivo: "Fora da LPU",
          descricao: "Içamento de cofre pela escada",
          servico: "Içamento",
          unidade: "VB",
        },
        { origem: "avulso", lpu_item_id: "lpu_cofre", quantidade: "2", preco: "100.00", motivo: "Fora da LPU", descricao: "Cofre pequeno" },
      ],
      contexto(),
    );
    assert.deepEqual(
      resultado.linhas.map((linha) => [linha.origem, linha.lpu_item_id, linha.codigo, linha.item, linha.servico, linha.unidade, linha.preco_tabela, linha.total_cents]),
      [
        ["avulso", null, null, "Içamento de cofre pela escada", "Içamento", "VB", null, 145000],
        ["avulso", "lpu_cofre", null, "Cofre", "Içamento", "VB", null, 20000],
      ],
    );
    assert.deepEqual(resultado.por_origem, { tabela: 0, alterado: 0, avulso: 2, ajuste: 0 });
    const base: LinhaEntrada = { origem: "avulso", quantidade: "1", preco: "10.00", motivo: "x", descricao: "Serviço" };
    erro(() => precificarLinhas([{ ...base, preco: undefined }], contexto()), /preço/i);
    erro(() => precificarLinhas([{ ...base, motivo: null }], contexto()), /motivo/i);
    erro(() => precificarLinhas([{ ...base, descricao: " " }], contexto()), /descrição/i);
    erro(() => precificarLinhas([{ ...base, lpu_item_id: "lpu_mesa" }], contexto()), /está na tabela/i);
    erro(() => precificarLinhas([{ ...base, preco: "-10.00" }], contexto()), /negativo/i);
  });

  it("ajuste: negativo, com motivo; ajuste positivo ou zero é recusado", () => {
    const resultado = precificarLinhas(
      [
        { origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "10" },
        { origem: "ajuste", quantidade: "1", preco: "-5.00", motivo: "Arredondamento combinado" },
      ],
      contexto(),
    );
    const ajuste = resultado.linhas[1];
    assert.equal(ajuste.origem, "ajuste");
    assert.equal(ajuste.descricao, "Ajuste comercial");
    assert.equal(ajuste.total_cents, -500);
    assert.equal(resultado.subtotal_cents, 45500);
    assert.equal(resultado.ajustes_cents, -500);
    assert.equal(resultado.total_cents, 45000);
    erro(() => precificarLinhas([{ origem: "ajuste", quantidade: "1", preco: "-5.00" }], contexto()), /motivo/i);
    erro(() => precificarLinhas([{ origem: "ajuste", quantidade: "1", preco: "5.00", motivo: "x" }], contexto()), /negativo/i);
    erro(() => precificarLinhas([{ origem: "ajuste", quantidade: "1", preco: "0", motivo: "x" }], contexto()), /negativo/i);
    erro(() => precificarLinhas([{ origem: "ajuste", lpu_item_id: "lpu_mesa", quantidade: "1", preco: "-1.00", motivo: "x" }], contexto()), /item/i);
  });

  it("total negativo é recusado", () => {
    erro(
      () =>
        precificarLinhas(
          [
            { origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "1" },
            { origem: "ajuste", quantidade: "1", preco: "-18.51", motivo: "Desconto" },
          ],
          contexto(),
        ),
      /total.*negativo/i,
    );
  });

  it("quantidade: texto com até 3 casas e maior que zero; preço com até 4 casas", () => {
    const linha = (quantidade: string, preco = "1.00"): LinhaEntrada => ({
      origem: "avulso",
      quantidade,
      preco,
      motivo: "x",
      descricao: "Serviço",
    });
    erro(() => precificarLinhas([linha("0")], contexto()), /linha 1.*quantidade/i);
    erro(() => precificarLinhas([linha("-1")], contexto()), /quantidade/i);
    erro(() => precificarLinhas([linha("1.0001")], contexto()), /quantidade/i);
    erro(() => precificarLinhas([linha("1,5")], contexto()), /quantidade/i);
    erro(() => precificarLinhas([linha("1", "0.12345")], contexto()), /preço/i);
    erro(() => precificarLinhas([linha("1"), linha("2", "1,00")], contexto()), /linha 2/i);
  });

  it("ids: o informado vale, o novo é do servidor, e repetido é recusado", () => {
    const resultado = precificarLinhas(
      [
        { id: "ln_antigo", origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "1" },
        { origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "1", origem_local: "loc_ceic", destino_local: "loc_cat" },
      ],
      contexto(),
    );
    assert.deepEqual(resultado.linhas.map((linha) => linha.id), ["ln_antigo", "ln_novo_1"]);
    assert.equal(resultado.linhas[1].origem_local, "loc_ceic");
    assert.equal(resultado.linhas[1].destino_local, "loc_cat");
    erro(
      () =>
        precificarLinhas(
          [
            { id: "ln_a", origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "1" },
            { id: "ln_a", origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "1" },
          ],
          contexto(),
        ),
      /repetid/i,
    );
  });

  it("os totais são os dos casos de dinheiro (dinheiro.casos.json), com o servidor recalculando cada linha", () => {
    let conferidos = 0;
    for (const caso of CASOS.totais) {
      if (caso.erro || caso.linhas.length === 0) continue;
      const entradas: LinhaEntrada[] = caso.linhas.map((linha) =>
        linha.ajuste === true
          ? { origem: "ajuste", quantidade: String(linha.quantidade), preco: String(linha.preco), motivo: "caso" }
          : { origem: "avulso", quantidade: String(linha.quantidade), preco: String(linha.preco), motivo: "caso", descricao: "caso" },
      );
      if (entradas.some((linha) => linha.quantidade.startsWith("-"))) {
        // O orçamento escreve o ajuste com preço negativo e quantidade positiva.
        for (const linha of entradas) {
          if (linha.quantidade.startsWith("-")) {
            linha.quantidade = linha.quantidade.slice(1);
            linha.preco = `-${linha.preco}`;
          }
        }
      }
      const resultado = precificarLinhas(entradas, contexto({ tabela: null }));
      assert.equal(resultado.total_cents, caso.centavos, caso.caso);
      assert.equal(resultado.subtotal_cents + resultado.ajustes_cents, caso.centavos, caso.caso);
      conferidos += 1;
    }
    assert.ok(conferidos >= 4, `só ${conferidos} casos conferidos`);
    const negativo = CASOS.totais.find((caso) => caso.erro === "TOTAL_NEGATIVO" && caso.linhas.length === 2);
    assert.ok(negativo);
    erro(
      () =>
        precificarLinhas(
          negativo.linhas.map((linha) =>
            linha.ajuste === true
              ? { origem: "ajuste", quantidade: String(linha.quantidade), preco: String(linha.preco), motivo: "caso" }
              : { origem: "avulso", quantidade: String(linha.quantidade), preco: String(linha.preco), motivo: "caso", descricao: "caso" },
          ),
          contexto({ tabela: null }),
        ),
      /total.*negativo/i,
    );
  });
});

describe("marcas", () => {
  const linha = (origem: string) => ({ origem }) as never;

  it("cada origem fora da tabela e a tabela vencida ou ausente viram marca; número legado também", () => {
    assert.deepEqual([...MARCAS_ORCAMENTO], ["preco_alterado", "item_avulso", "ajuste", "tabela_vencida", "sem_tabela", "legado"]);
    assert.deepEqual(
      marcasDoOrcamento({
        linhas: [linha("tabela"), linha("alterado"), linha("avulso"), linha("ajuste")],
        tabela: { status: "ativa", vigente_ate: null },
        hoje: "2026-10-21",
        numero_legado: null,
      }),
      ["preco_alterado", "item_avulso", "ajuste"],
    );
    assert.deepEqual(
      marcasDoOrcamento({ linhas: [linha("avulso")], tabela: null, hoje: "2026-10-21", numero_legado: "1043" }),
      ["item_avulso", "sem_tabela", "legado"],
    );
  });

  it("tabela vencida: encerrada por outra ou com o fim antes de hoje", () => {
    const base = { linhas: [linha("tabela")], hoje: "2026-10-21", numero_legado: null };
    assert.deepEqual(marcasDoOrcamento({ ...base, tabela: { status: "encerrada", vigente_ate: "2026-06-29" } }), ["tabela_vencida"]);
    assert.deepEqual(marcasDoOrcamento({ ...base, tabela: { status: "ativa", vigente_ate: "2026-10-20" } }), ["tabela_vencida"]);
    assert.deepEqual(marcasDoOrcamento({ ...base, tabela: { status: "ativa", vigente_ate: "2026-10-21" } }), []);
  });
});

describe("transições do orçamento (ação × papel × situação)", () => {
  type Esperado = "ok" | "permission-denied" | "failed-precondition";
  const AUTOR = "autor-1";

  /** O que cada ação faz, por papel do Comercial, para quem não montou o orçamento. */
  const TABELA: Record<string, Record<string, Record<string, Esperado>>> = {
    submit: {
      owner: { rascunho: "ok", para_aprovar: "failed-precondition", aprovado: "failed-precondition", enviado: "failed-precondition" },
      admin: { rascunho: "ok", para_aprovar: "failed-precondition", aprovado: "failed-precondition", enviado: "failed-precondition" },
      comercial: { rascunho: "ok", para_aprovar: "failed-precondition", aprovado: "failed-precondition", enviado: "failed-precondition" },
    },
    return: {
      owner: { rascunho: "failed-precondition", para_aprovar: "ok", aprovado: "failed-precondition", enviado: "failed-precondition" },
      admin: { rascunho: "permission-denied", para_aprovar: "permission-denied", aprovado: "permission-denied", enviado: "permission-denied" },
      comercial: { rascunho: "permission-denied", para_aprovar: "permission-denied", aprovado: "permission-denied", enviado: "permission-denied" },
    },
    approve: {
      // Do rascunho, só o orçamento que o próprio owner montou.
      owner: { rascunho: "failed-precondition", para_aprovar: "ok", aprovado: "failed-precondition", enviado: "failed-precondition" },
      admin: { rascunho: "permission-denied", para_aprovar: "permission-denied", aprovado: "permission-denied", enviado: "permission-denied" },
      comercial: { rascunho: "permission-denied", para_aprovar: "permission-denied", aprovado: "permission-denied", enviado: "permission-denied" },
    },
    edit: {
      owner: { rascunho: "failed-precondition", para_aprovar: "failed-precondition", aprovado: "ok", enviado: "failed-precondition" },
      admin: { rascunho: "failed-precondition", para_aprovar: "failed-precondition", aprovado: "ok", enviado: "failed-precondition" },
      comercial: { rascunho: "failed-precondition", para_aprovar: "failed-precondition", aprovado: "ok", enviado: "failed-precondition" },
    },
  };

  function resultado(problema: ReturnType<typeof problemaDaAcao>): Esperado {
    return problema === null ? "ok" : problema.codigo;
  }

  it("a tabela cobre toda ação, papel do Comercial e situação", () => {
    assert.deepEqual(Object.keys(TABELA).sort(), [...ACOES_ORCAMENTO].sort());
    for (const acao of ACOES_ORCAMENTO) {
      for (const papel of ["owner", "admin", "comercial"]) {
        assert.deepEqual(Object.keys(TABELA[acao][papel]).sort(), [...STATUS_ORCAMENTO].sort(), `${acao} ${papel}`);
      }
    }
  });

  it("quem não montou: o resultado de cada combinação", () => {
    for (const acao of ACOES_ORCAMENTO) {
      for (const [papel, porStatus] of Object.entries(TABELA[acao])) {
        for (const [status, esperado] of Object.entries(porStatus)) {
          const problema = problemaDaAcao(acao, { uid: "outra-pessoa", role: papel as never }, { status: status as never, autor_uid: AUTOR });
          assert.equal(resultado(problema), esperado, `${acao} por ${papel} em ${status}: ${problema?.mensagem ?? "ok"}`);
        }
      }
    }
  });

  it("quem montou devolve (puxa de volta) o próprio orçamento; o owner aprova do rascunho o que ele montou", () => {
    for (const papel of ["owner", "admin", "comercial"] as const) {
      assert.equal(problemaDaAcao("return", { uid: AUTOR, role: papel }, { status: "para_aprovar", autor_uid: AUTOR }), null, papel);
    }
    assert.equal(problemaDaAcao("approve", { uid: AUTOR, role: "owner" }, { status: "rascunho", autor_uid: AUTOR }), null);
    assert.equal(
      resultado(problemaDaAcao("approve", { uid: AUTOR, role: "admin" }, { status: "rascunho", autor_uid: AUTOR })),
      "permission-denied",
    );
    assert.equal(
      resultado(problemaDaAcao("approve", { uid: AUTOR, role: "comercial" }, { status: "para_aprovar", autor_uid: AUTOR })),
      "permission-denied",
    );
  });

  it("papel fora do Comercial não faz nada", () => {
    for (const papel of PLATFORM_ROLES.filter((role) => !["owner", "admin", "comercial"].includes(role))) {
      for (const acao of ACOES_ORCAMENTO) {
        for (const status of STATUS_ORCAMENTO) {
          assert.equal(
            resultado(problemaDaAcao(acao, { uid: AUTOR, role: papel }, { status, autor_uid: AUTOR })),
            "permission-denied",
            `${acao} por ${papel} em ${status}`,
          );
        }
      }
    }
  });

  it("repetir a ação já feita: reconhece pelo estado, com a mesma edição", () => {
    assert.equal(acaoJaFeita("submit", { status: "para_aprovar", edicao: 3, aprovacao: null }, { status: "rascunho", edicao: 3 }), true);
    assert.equal(acaoJaFeita("submit", { status: "para_aprovar", edicao: 4, aprovacao: null }, { status: "rascunho", edicao: 3 }), false);
    assert.equal(acaoJaFeita("submit", { status: "rascunho", edicao: 3, aprovacao: null }, { status: "rascunho", edicao: 3 }), false);
    assert.equal(acaoJaFeita("approve", { status: "aprovado", edicao: 3, aprovacao: { edicao: 3 } }, { status: "para_aprovar", edicao: 3 }), true);
    assert.equal(acaoJaFeita("approve", { status: "aprovado", edicao: 3, aprovacao: { edicao: 3 } }, { status: "rascunho", edicao: 3 }), true);
    assert.equal(acaoJaFeita("approve", { status: "para_aprovar", edicao: 3, aprovacao: null }, { status: "para_aprovar", edicao: 3 }), false);
    assert.equal(acaoJaFeita("return", { status: "rascunho", edicao: 3, aprovacao: null }, { status: "para_aprovar", edicao: 3 }), true);
    assert.equal(acaoJaFeita("edit", { status: "rascunho", edicao: 3, aprovacao: null }, { status: "aprovado", edicao: 3 }), true);
    assert.equal(acaoJaFeita("edit", { status: "rascunho", edicao: 4, aprovacao: null }, { status: "aprovado", edicao: 3 }), false);
  });

  it("para aprovar: cliente, Para, título e uma linha", () => {
    const completo = {
      demanda: { customer_code: "ITAU", solicitante: { contato_id: "ct_1", empresa: null }, titulo: "Mudança de layout" },
      orcamento: { linhas: [{}] },
    };
    assert.deepEqual(pendenciasParaAprovar(completo.demanda, completo.orcamento), []);
    assert.deepEqual(
      pendenciasParaAprovar({ customer_code: "", solicitante: null, titulo: "  " }, { linhas: [] }),
      ["cliente", "Para", "título", "uma linha"],
    );
  });
});
