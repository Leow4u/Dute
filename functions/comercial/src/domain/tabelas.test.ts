import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ErroDinheiro } from "./dinheiro.js";
import {
  ErroTabela,
  PRICE_TABLES_COLLECTION,
  chaveDeVigencia,
  conferirData,
  conferirVariante,
  normalizarVariante,
  planejarVigencia,
  precoDaLinha,
  priceTableId,
  tabelaVigente,
  vespera,
  type VigenciaDaTabela,
} from "./tabelas.js";

/**
 * Tabelas de preço (`price_tables`): imutáveis, com vigência sem sobreposição
 * por cliente, contrato e variante. Vale a tabela cuja vigência contém a
 * data-base do orçamento, mesmo que já tenha sido encerrada por outra.
 */

function codigo(conta: () => unknown): string {
  try {
    conta();
  } catch (erro) {
    if (erro instanceof ErroTabela) return erro.codigo;
    throw erro;
  }
  throw new Error("deveria recusar");
}

type Tabela = VigenciaDaTabela & { precos: Record<string, { codigo: string; descricao_cliente: string; preco: string }> };

function tabela(partial: Partial<Tabela> & Pick<Tabela, "id" | "vigente_de">): Tabela {
  return {
    customer_code: "ITAU",
    contract_id: "itau-2026",
    variante: "Comercial",
    vigente_ate: null,
    status: "ativa",
    precos: {},
    ...partial,
  };
}

const nova = (partial: Partial<VigenciaDaTabela> & Pick<VigenciaDaTabela, "vigente_de">) => ({
  customer_code: "ITAU",
  contract_id: "itau-2026",
  variante: "Comercial",
  vigente_ate: null,
  ...partial,
});

describe("datas da vigência", () => {
  it("só AAAA-MM-DD de um dia que existe", () => {
    assert.equal(conferirData("2026-06-30", "vigente_de"), "2026-06-30");
    assert.equal(conferirData("2024-02-29", "vigente_de"), "2024-02-29");
    for (const data of ["2026-02-30", "2026-06-31", "2025-02-29", "2026-13-01", "2026-6-1", "30/06/2026", "", 20260630, null]) {
      assert.equal(codigo(() => conferirData(data, "vigente_de")), "DATA_INVALIDA", String(data));
    }
  });

  it("véspera atravessa mês, ano e fevereiro bissexto", () => {
    assert.equal(vespera("2026-06-30"), "2026-06-29");
    assert.equal(vespera("2026-03-01"), "2026-02-28");
    assert.equal(vespera("2024-03-01"), "2024-02-29");
    assert.equal(vespera("2026-01-01"), "2025-12-31");
  });
});

describe("variante", () => {
  it("é texto livre de letras, comparado sem acento nem maiúscula", () => {
    assert.equal(conferirVariante("  Fim de   semana "), "Fim de semana");
    assert.equal(normalizarVariante("Comercial"), "comercial");
    assert.equal(normalizarVariante(" NOTURNA "), "noturna");
    assert.equal(normalizarVariante("Pós-obra"), "pos_obra");
    assert.equal(normalizarVariante("Fim de semana"), "fim_de_semana");
  });

  it("sem algarismo nem símbolo: a variante vai no evento", () => {
    for (const variante of ["", "  ", "Noturna 2", "R$ 10", "a@b", "x".repeat(41), "Straße"]) {
      assert.equal(codigo(() => conferirVariante(variante)), "VARIANTE_INVALIDA", variante);
    }
  });
});

describe("identidade da tabela", () => {
  it("a chave de vigência junta cliente, contrato e variante normalizada", () => {
    const chave = chaveDeVigencia({ customer_code: "ITAU", contract_id: "itau-2026", variante: "Comercial" });
    assert.match(chave, /^cv_[0-9a-f]{32}$/);
    assert.equal(chaveDeVigencia({ customer_code: "ITAU", contract_id: "itau-2026", variante: " comercial " }), chave);
    assert.notEqual(chaveDeVigencia({ customer_code: "ITAU", contract_id: "itau-2026", variante: "Noturna" }), chave);
    assert.notEqual(chaveDeVigencia({ customer_code: "ITAU", contract_id: null, variante: "Comercial" }), chave);
    assert.notEqual(chaveDeVigencia({ customer_code: "SAFRA", contract_id: "itau-2026", variante: "Comercial" }), chave);
    assert.notEqual(chaveDeVigencia({ customer_code: null, contract_id: null, variante: "Comercial" }), chave);
  });

  it("contrato sem cliente é recusado: a Padrão Dutelog não tem cliente nem contrato", () => {
    assert.equal(
      codigo(() => chaveDeVigencia({ customer_code: null, contract_id: "itau-2026", variante: "Comercial" })),
      "CONTRATO_SEM_CLIENTE",
    );
  });

  it("o id da tabela é determinístico pela identidade e pelo início da vigência", () => {
    const identidade = { customer_code: "ITAU", contract_id: "itau-2026", variante: "Comercial" };
    const id = priceTableId(identidade, "2026-06-30");
    assert.equal(PRICE_TABLES_COLLECTION, "price_tables");
    assert.match(id, /^pt_[0-9a-f]{32}$/);
    assert.equal(priceTableId({ ...identidade, variante: "COMERCIAL" }, "2026-06-30"), id);
    assert.notEqual(priceTableId(identidade, "2027-07-01"), id);
    assert.notEqual(priceTableId({ ...identidade, variante: "Noturna" }, "2026-06-30"), id);
  });
});

describe("carga de tabela nova: vigência", () => {
  const v1 = tabela({ id: "pt_v1", vigente_de: "2026-01-01" });

  it("sem tabela anterior, entra ativa", () => {
    assert.deepEqual(planejarVigencia(nova({ vigente_de: "2026-01-01" }), []), {
      status: "ativa",
      substitui: null,
      encerrar: null,
    });
  });

  it("encerra a anterior em aberto na véspera do início da nova", () => {
    assert.deepEqual(planejarVigencia(nova({ vigente_de: "2026-06-30" }), [v1]), {
      status: "ativa",
      substitui: "pt_v1",
      encerrar: { id: "pt_v1", vigente_ate: "2026-06-29" },
    });
  });

  it("encerra na véspera a anterior que terminaria depois do início da nova", () => {
    const comFim = { ...v1, vigente_ate: "2026-12-31" };
    assert.deepEqual(planejarVigencia(nova({ vigente_de: "2026-06-30", vigente_ate: "2027-06-30" }), [comFim]), {
      status: "ativa",
      substitui: "pt_v1",
      encerrar: { id: "pt_v1", vigente_ate: "2026-06-29" },
    });
  });

  it("a anterior que já terminou antes mantém o fim e passa a encerrada", () => {
    const terminou = { ...v1, vigente_ate: "2026-03-31" };
    assert.deepEqual(planejarVigencia(nova({ vigente_de: "2026-06-30" }), [terminou]), {
      status: "ativa",
      substitui: "pt_v1",
      encerrar: { id: "pt_v1", vigente_ate: "2026-03-31" },
    });
  });

  it("tabela nova que começa no mesmo dia ou antes da ativa é sobreposição", () => {
    assert.equal(codigo(() => planejarVigencia(nova({ vigente_de: "2026-01-01" }), [v1])), "SOBREPOSICAO");
    assert.equal(codigo(() => planejarVigencia(nova({ vigente_de: "2025-12-01" }), [v1])), "SOBREPOSICAO");
    assert.equal(
      codigo(() => planejarVigencia(nova({ vigente_de: "2025-12-01", vigente_ate: "2026-01-01" }), [v1])),
      "SOBREPOSICAO",
    );
  });

  it("tabela antiga carregada depois entra encerrada, sem mexer na ativa", () => {
    // A RFQ de 2021 do Itaú, carregada depois da v2.0.
    const v2 = tabela({ id: "pt_v2", vigente_de: "2026-06-30" });
    assert.deepEqual(planejarVigencia(nova({ vigente_de: "2021-12-01", vigente_ate: "2026-06-29" }), [v2]), {
      status: "encerrada",
      substitui: null,
      encerrar: null,
    });
  });

  it("não sobrepõe nem uma tabela já encerrada", () => {
    const encerrada = tabela({ id: "pt_v0", vigente_de: "2025-01-01", vigente_ate: "2025-12-31", status: "encerrada" });
    assert.equal(
      codigo(() => planejarVigencia(nova({ vigente_de: "2025-06-01", vigente_ate: "2025-12-31" }), [encerrada, v1])),
      "SOBREPOSICAO",
    );
  });

  it("fim antes do início é recusado", () => {
    assert.equal(
      codigo(() => planejarVigencia(nova({ vigente_de: "2026-06-30", vigente_ate: "2026-06-29" }), [])),
      "VIGENCIA_INVERTIDA",
    );
  });

  it("outra variante, outro contrato e outro cliente não contam", () => {
    const outras = [
      tabela({ id: "pt_n", variante: "Noturna", vigente_de: "2026-01-01" }),
      tabela({ id: "pt_c", contract_id: "itau-2021", vigente_de: "2026-01-01" }),
      tabela({ id: "pt_s", customer_code: "SAFRA", vigente_de: "2026-01-01" }),
      tabela({ id: "pt_p", customer_code: null, contract_id: null, vigente_de: "2026-01-01" }),
    ];
    assert.deepEqual(planejarVigencia(nova({ vigente_de: "2026-01-01" }), outras), {
      status: "ativa",
      substitui: null,
      encerrar: null,
    });
  });

  it("a variante é comparada sem acento nem maiúscula", () => {
    assert.equal(codigo(() => planejarVigencia(nova({ vigente_de: "2026-01-01", variante: "COMERCIAL" }), [v1])), "SOBREPOSICAO");
  });

  it("duas tabelas ativas da mesma chave é dado quebrado: a carga para", () => {
    const outra = tabela({ id: "pt_v1b", vigente_de: "2026-03-01" });
    assert.equal(codigo(() => planejarVigencia(nova({ vigente_de: "2026-06-30" }), [v1, outra])), "MAIS_DE_UMA_ATIVA");
  });
});

describe("tabela vigente na data-base", () => {
  // Troca no meio do ano: a v1 foi encerrada pela v2 em 30/06.
  const v1 = tabela({ id: "pt_v1", vigente_de: "2026-01-01", vigente_ate: "2026-06-29", status: "encerrada" });
  const v2 = tabela({ id: "pt_v2", vigente_de: "2026-06-30" });
  const noturna = tabela({ id: "pt_noturna", variante: "Noturna", vigente_de: "2026-01-01" });
  const padrao = tabela({ id: "pt_padrao", customer_code: null, contract_id: null, vigente_de: "2025-01-01" });
  const padraoNoturna = tabela({
    id: "pt_padrao_noturna",
    customer_code: null,
    contract_id: null,
    variante: "Noturna",
    vigente_de: "2025-01-01",
  });
  const safra = tabela({ id: "pt_safra", customer_code: "SAFRA", contract_id: null, vigente_de: "2020-01-01" });
  const todas = [v1, v2, noturna, padrao, padraoNoturna, safra];
  const itau = { customer_code: "ITAU", contract_id: "itau-2026", variante: "Comercial" };

  it("data-base antes da troca usa a tabela encerrada", () => {
    assert.deepEqual(tabelaVigente(todas, { ...itau, data: "2026-03-15" }), { tabela: v1, origem: "cliente" });
    assert.deepEqual(tabelaVigente(todas, { ...itau, data: "2026-06-29" }), { tabela: v1, origem: "cliente" });
  });

  it("data-base no dia da troca e depois usa a nova", () => {
    assert.deepEqual(tabelaVigente(todas, { ...itau, data: "2026-06-30" }), { tabela: v2, origem: "cliente" });
    assert.deepEqual(tabelaVigente(todas, { ...itau, data: "2027-01-10" }), { tabela: v2, origem: "cliente" });
  });

  it("a ordem da lista não muda a escolha", () => {
    assert.deepEqual(tabelaVigente([...todas].reverse(), { ...itau, data: "2026-03-15" }), { tabela: v1, origem: "cliente" });
  });

  it("cada variante tem a sua tabela", () => {
    assert.deepEqual(tabelaVigente(todas, { ...itau, variante: "noturna", data: "2026-03-15" }), {
      tabela: noturna,
      origem: "cliente",
    });
  });

  it("cliente sem tabela cai na Padrão Dutelog da mesma variante", () => {
    const btg = { customer_code: "BTG", contract_id: null };
    assert.deepEqual(tabelaVigente(todas, { ...btg, variante: "Comercial", data: "2026-03-15" }), {
      tabela: padrao,
      origem: "padrao",
    });
    assert.deepEqual(tabelaVigente(todas, { ...btg, variante: "Noturna", data: "2026-03-15" }), {
      tabela: padraoNoturna,
      origem: "padrao",
    });
  });

  it("prospect e orçamento sem cliente também usam a Padrão", () => {
    assert.deepEqual(tabelaVigente(todas, { customer_code: null, contract_id: null, variante: "Comercial", data: "2026-03-15" }), {
      tabela: padrao,
      origem: "padrao",
    });
  });

  it("a Padrão de outra variante não serve", () => {
    assert.equal(
      tabelaVigente(todas, { customer_code: "BTG", contract_id: null, variante: "Fim de semana", data: "2026-03-15" }),
      null,
    );
  });

  it("cliente com tabela não cai na Padrão fora da vigência das tabelas dele", () => {
    assert.equal(tabelaVigente(todas, { ...itau, data: "2025-12-12" }), null);
  });

  it("tabela do contrato não serve para outro contrato do mesmo cliente, e ele não cai na Padrão", () => {
    assert.equal(tabelaVigente(todas, { ...itau, contract_id: "itau-2030", data: "2026-03-15" }), null);
  });

  it("orçamento sem contrato de cliente que só tem tabela de contrato não cai na Padrão", () => {
    assert.equal(tabelaVigente(todas, { ...itau, contract_id: null, data: "2026-03-15" }), null);
  });

  it("tabela do cliente sem contrato não serve para orçamento com contrato, e ele não cai na Padrão", () => {
    assert.equal(tabelaVigente(todas, { customer_code: "SAFRA", contract_id: "safra-2026", variante: "Comercial", data: "2026-03-15" }), null);
    assert.deepEqual(tabelaVigente(todas, { customer_code: "SAFRA", contract_id: null, variante: "Comercial", data: "2026-03-15" }), {
      tabela: safra,
      origem: "cliente",
    });
  });

  it("cliente com tabela só em outra variante usa a Padrão da variante pedida", () => {
    assert.deepEqual(tabelaVigente(todas, { customer_code: "SAFRA", contract_id: null, variante: "Noturna", data: "2026-03-15" }), {
      tabela: padraoNoturna,
      origem: "padrao",
    });
  });

  it("tabela de outro cliente nunca é escolhida", () => {
    const resultado = tabelaVigente([safra, padrao], { ...itau, data: "2026-03-15" });
    assert.deepEqual(resultado, { tabela: padrao, origem: "padrao" });
  });

  it("sem nenhuma tabela, não há tabela vigente", () => {
    assert.equal(tabelaVigente([], { ...itau, data: "2026-03-15" }), null);
    assert.equal(tabelaVigente([padrao], { ...itau, data: "2024-12-31" }), null);
  });

  it("data-base fora do formato é recusada", () => {
    assert.equal(codigo(() => tabelaVigente(todas, { ...itau, data: "15/03/2026" })), "DATA_INVALIDA");
  });

  it("duas tabelas cobrindo a mesma data é dado quebrado", () => {
    const quebrada = tabela({ id: "pt_x", vigente_de: "2026-03-01", vigente_ate: "2026-03-31", status: "encerrada" });
    assert.equal(codigo(() => tabelaVigente([...todas, quebrada], { ...itau, data: "2026-03-15" })), "SOBREPOSICAO");
  });
});

describe("preço da linha", () => {
  const tabelaComPrecos = tabela({
    id: "pt_v2",
    vigente_de: "2026-06-30",
    precos: {
      lpu_mesa: { codigo: "DTL-0007-M", descricao_cliente: "Montagem de mesa", preco: "12.345" },
      lpu_frete: { codigo: "DTL-0200-T", descricao_cliente: "Frete por km", preco: "3.89" },
    },
  });

  it("quantidade × preço da tabela, em centavos, arredondado na linha", () => {
    assert.deepEqual(precoDaLinha(tabelaComPrecos, { lpu_item_id: "lpu_mesa", quantidade: "3" }), {
      tabela_id: "pt_v2",
      lpu_item_id: "lpu_mesa",
      codigo: "DTL-0007-M",
      descricao_cliente: "Montagem de mesa",
      preco: "12.345",
      quantidade: "3",
      total_cents: 3704,
    });
    assert.equal(precoDaLinha(tabelaComPrecos, { lpu_item_id: "lpu_frete", quantidade: "125.5" })?.total_cents, 48820);
  });

  it("item fora da tabela não tem preço", () => {
    assert.equal(precoDaLinha(tabelaComPrecos, { lpu_item_id: "lpu_outro", quantidade: "1" }), null);
    assert.equal(precoDaLinha(tabelaComPrecos, { lpu_item_id: "__proto__", quantidade: "1" }), null);
  });

  it("quantidade em float ou negativa é recusada pela conta de dinheiro", () => {
    assert.throws(
      () => precoDaLinha(tabelaComPrecos, { lpu_item_id: "lpu_mesa", quantidade: 3 as unknown as string }),
      ErroDinheiro,
    );
    assert.throws(() => precoDaLinha(tabelaComPrecos, { lpu_item_id: "lpu_mesa", quantidade: "-1" }), ErroDinheiro);
  });
});
