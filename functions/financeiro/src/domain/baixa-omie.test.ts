import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ETAPAS_DA_BAIXA,
  ETAPAS_DA_ROTINA_DA_BAIXA,
  MOTIVOS_DA_PARADA_DA_BAIXA,
  baixaLida,
  baixaNoEstorno,
  baixaSemChaves,
  codigoDaBaixa,
  comAcaoNaBaixa,
  comFalhaDaBaixa,
  comRespostaDaBaixa,
  idDaBaixa,
  novaBaixa,
  osDaFatura,
  passoDaBaixa,
  pedidoDaBaixa,
  type Baixa,
} from "./baixa-omie.js";
import { FALHAS_ATE_PARAR } from "./emissao-omie.js";
import { FINANCEIRO_EVENT_PAYLOADS } from "./events.js";

/**
 * A baixa na Omie, pura (parte 7.4g): o código que sai do pagamento, o passo
 * de cada etapa, a conferência do título antes de lançar e de cancelar, as
 * falhas e o estorno. As respostas seguem as estruturas das páginas da API da
 * Omie (financas/pesquisartitulos e financas/contareceber). Dados sintéticos.
 */

const AGORA = new Date("2026-10-24T12:00:00.000Z");
const PAGAMENTO = "pag_0123456789abcdef01234567";
const SEM_CONFIGURACAO = { categoria: null, conta_corrente: null };

function baixa(extra: Partial<Baixa> = {}): Baixa {
  return {
    ...novaBaixa({ pagamento_id: PAGAMENTO, fatura_id: "fat_0123456789abcdef01234567", emissao_id: "nfe_0123456789abcdef0123", customer_code: "ACME", valor_cents: 150_050, recebido_em: "2026-10-22", os: 9001 }, AGORA),
    ...extra,
  };
}

/** A resposta da PesquisarLancamentos com um título por item. */
function titulos(...itens: Array<{ titulo?: number; os?: number; status?: string; cc?: number | null; liquidado?: boolean; recebimentos?: Array<{ codigo: number; integracao: string }> }>) {
  return {
    nPagina: 1,
    nTotPaginas: 1,
    titulosEncontrados: itens.map((item) => ({
      cabecTitulo: { nCodTitulo: item.titulo ?? 7001, nCodOS: item.os ?? 9001, cStatus: item.status ?? "AVENCER", nCodCC: item.cc === undefined ? 4001 : item.cc, nValorTitulo: 1500.5 },
      lancamentos: (item.recebimentos ?? []).map((recebimento) => ({ nCodLanc: recebimento.codigo, cCodIntLanc: recebimento.integracao, nValLanc: 1500.5 })),
      resumo: { cLiquidado: item.liquidado ? "S" : "N" },
    })),
  };
}

const RECUSA = { tipo: "recusa" as const, mensagem: "Conta corrente inválida.", esperar_ms: 2 * 60_000 };

describe("a baixa nasce do pagamento", () => {
  it("o id e o código de integração saem do pagamento: uma baixa por pagamento, o código com até 20 caracteres", () => {
    assert.equal(idDaBaixa(PAGAMENTO), "bxa_0123456789abcdef01234567");
    assert.equal(codigoDaBaixa(PAGAMENTO), "DUTE0123456789abcdef");
    assert.ok(codigoDaBaixa(PAGAMENTO).length <= 20);
    assert.throws(() => idDaBaixa("pag_x"));
    const nova = baixa();
    assert.deepEqual([nova.etapa, nova.conferida, nova.omie, nova.edicao], ["na_fila", false, { os: 9001, titulo: null, conta_corrente: null, baixa: null, liquidado: null }, 1]);
  });

  it("só a fatura que saiu pela Omie, com a emissão e a OS, tem baixa", () => {
    assert.deepEqual(osDaFatura({ origem_nf: "omie", emissao_id: "nfe_0123456789abcdef0123", omie: { os: 9001 } }), { emissao_id: "nfe_0123456789abcdef0123", os: 9001 });
    assert.equal(osDaFatura({ origem_nf: "omie", emissao_id: "nfe_0123456789abcdef0123", omie: {} }), null);
    assert.equal(osDaFatura({ origem_nf: "omie", omie: { os: 9001 } }), null);
    assert.equal(osDaFatura({ nf: { numero: "1234" } }), null);
  });

  it("lê a baixa gravada campo a campo e recusa a que vem fora do formato", () => {
    const gravada = { ...baixa({ omie: { os: 9001, titulo: 7001, conta_corrente: 4001, baixa: null, liquidado: null }, conferida: true }), criada_em: AGORA.toISOString() };
    const lida = baixaLida(gravada.id, gravada as unknown as Record<string, unknown>);
    assert.deepEqual([lida.conferida, lida.omie.titulo, lida.codigo], [true, 7001, "DUTE0123456789abcdef"]);
    for (const errado of [{ etapa: "lancando" }, { valor_cents: 0 }, { pagamento_id: "pag_ffffffffffffffffffffffff" }, { omie: { os: null } }, { recebido_em: "22/10/2026" }]) {
      assert.throws(() => baixaLida(gravada.id, { ...gravada, ...errado } as unknown as Record<string, unknown>), JSON.stringify(errado));
    }
  });

  it("os motivos da parada são os do evento", () => {
    assert.deepEqual([...FINANCEIRO_EVENT_PAYLOADS["nf.settlement_stopped"].shape.motivo.options], [...MOTIVOS_DA_PARADA_DA_BAIXA]);
    assert.deepEqual([...ETAPAS_DA_ROTINA_DA_BAIXA], ["na_fila", "cancelando"]);
    assert.ok(ETAPAS_DA_ROTINA_DA_BAIXA.every((etapa) => ETAPAS_DA_BAIXA.includes(etapa)));
  });
});

describe("o passo e o pedido", () => {
  it("confere o título antes de lançar e antes de cancelar; acabada, parada ou cedo, não anda", () => {
    assert.equal(passoDaBaixa(baixa(), AGORA), "conferir");
    assert.equal(passoDaBaixa(baixa({ conferida: true, omie: { os: 9001, titulo: 7001, conta_corrente: 4001, baixa: null, liquidado: null } }), AGORA), "lancar");
    assert.equal(passoDaBaixa(baixa({ etapa: "cancelando" }), AGORA), "conferir");
    assert.equal(passoDaBaixa(baixa({ etapa: "cancelando", conferida: true }), AGORA), "cancelar");
    for (const etapa of ["lancada", "cancelada", "parada", "dispensada"] as const) assert.equal(passoDaBaixa(baixa({ etapa }), AGORA), null, etapa);
    assert.equal(passoDaBaixa(baixa({ proxima_em: "2026-10-24T12:05:00.000Z" }), AGORA), null);
  });

  it("conferir pesquisa os títulos a receber da OS; lançar leva o título, o código, a conta, o valor e o dia; cancelar, o lançamento ou o código", () => {
    assert.deepEqual(pedidoDaBaixa("conferir", baixa()), { servico: "financas/pesquisartitulos", call: "PesquisarLancamentos", param: { nPagina: 1, nRegPorPagina: 50, nCodOS: 9001, cNatureza: "R" } });
    const pronta = baixa({ conferida: true, omie: { os: 9001, titulo: 7001, conta_corrente: 4001, baixa: null, liquidado: null } });
    assert.deepEqual(pedidoDaBaixa("lancar", pronta), {
      servico: "financas/contareceber",
      call: "LancarRecebimento",
      param: {
        codigo_lancamento: 7001,
        codigo_baixa_integracao: "DUTE0123456789abcdef",
        codigo_conta_corrente: 4001,
        valor: 1500.5,
        data: "22/10/2026",
        observacao: `Recebimento registrado na Dute (${PAGAMENTO}).`,
      },
    });
    assert.throws(() => pedidoDaBaixa("lancar", baixa()));
    assert.deepEqual(pedidoDaBaixa("cancelar", baixa({ etapa: "cancelando", conferida: true })).param, { codigo_baixa_integracao: "DUTE0123456789abcdef" });
    assert.deepEqual(pedidoDaBaixa("cancelar", baixa({ etapa: "cancelando", conferida: true, omie: { os: 9001, titulo: 7001, conta_corrente: 4001, baixa: 8001, liquidado: true } })).param, { codigo_baixa: 8001 });
  });
});

describe("a conferência do título", () => {
  it("o título da OS conferido guarda o título e a conta corrente dele; a da configuração vale primeiro", () => {
    const conferida = comRespostaDaBaixa(baixa(), "conferir", titulos({}), AGORA, SEM_CONFIGURACAO);
    assert.deepEqual([conferida.etapa, conferida.conferida, conferida.omie.titulo, conferida.omie.conta_corrente, passoDaBaixa(conferida, AGORA)], ["na_fila", true, 7001, 4001, "lancar"]);
    assert.equal(comRespostaDaBaixa(baixa(), "conferir", titulos({}), AGORA, { categoria: null, conta_corrente: 5005 }).omie.conta_corrente, 5005);
  });

  it("o recebimento com o código já no título é a resposta perdida: a baixa fica lançada sem lançar de novo", () => {
    const lancada = comRespostaDaBaixa(baixa({ omie: { os: 9001, titulo: 7001, conta_corrente: 4001, baixa: null, liquidado: null } }), "conferir", titulos({ liquidado: true, recebimentos: [{ codigo: 8001, integracao: "dute0123456789ABCDEF" }] }), AGORA, SEM_CONFIGURACAO);
    assert.deepEqual([lancada.etapa, lancada.omie.baixa, lancada.omie.liquidado], ["lancada", 8001, true]);
  });

  it("sem o título, espera e conta; na sexta vez para; dois títulos, o liquidado sem a Dute ou sem conta corrente param na hora", () => {
    let atual = baixa();
    for (let vez = 1; vez < FALHAS_ATE_PARAR; vez += 1) {
      atual = comRespostaDaBaixa(atual, "conferir", titulos(), AGORA, SEM_CONFIGURACAO);
      assert.deepEqual([atual.etapa, atual.tentativas], ["na_fila", vez]);
    }
    const parada = comRespostaDaBaixa(atual, "conferir", titulos(), AGORA, SEM_CONFIGURACAO);
    assert.deepEqual([parada.etapa, parada.motivo_da_parada, parada.etapa_anterior], ["parada", "titulo_nao_achado", "na_fila"]);
    // Os títulos de outra OS e os cancelados não contam.
    assert.equal(comRespostaDaBaixa(baixa(), "conferir", titulos({ os: 9002 }, { status: "CANCELADO" }), AGORA, SEM_CONFIGURACAO).tentativas, 1);
    assert.equal(comRespostaDaBaixa(baixa(), "conferir", titulos({ titulo: 7001 }, { titulo: 7002 }), AGORA, SEM_CONFIGURACAO).motivo_da_parada, "titulo_repetido");
    assert.equal(comRespostaDaBaixa(baixa(), "conferir", titulos({ liquidado: true }), AGORA, SEM_CONFIGURACAO).motivo_da_parada, "titulo_liquidado");
    assert.equal(comRespostaDaBaixa(baixa(), "conferir", titulos({ cc: null }), AGORA, SEM_CONFIGURACAO).motivo_da_parada, "sem_conta_corrente");
  });

  it("cancelando: com o recebimento no título, cancela; sem ele, não há o que desfazer e a baixa fica cancelada", () => {
    const cancelando = baixa({ etapa: "cancelando", omie: { os: 9001, titulo: 7001, conta_corrente: 4001, baixa: null, liquidado: null } });
    const conferida = comRespostaDaBaixa(cancelando, "conferir", titulos({ recebimentos: [{ codigo: 8001, integracao: "DUTE0123456789abcdef" }] }), AGORA, SEM_CONFIGURACAO);
    assert.deepEqual([conferida.etapa, conferida.conferida, conferida.omie.baixa, passoDaBaixa(conferida, AGORA)], ["cancelando", true, 8001, "cancelar"]);
    assert.equal(comRespostaDaBaixa(cancelando, "conferir", titulos({ recebimentos: [{ codigo: 8002, integracao: "OUTRA" }] }), AGORA, SEM_CONFIGURACAO).etapa, "cancelada");
    assert.equal(comRespostaDaBaixa(cancelando, "conferir", titulos(), AGORA, SEM_CONFIGURACAO).etapa, "cancelada");
  });
});

describe("o lançamento, o cancelamento e as falhas", () => {
  const pronta = baixa({ conferida: true, omie: { os: 9001, titulo: 7001, conta_corrente: 4001, baixa: null, liquidado: null } });

  it("lançado, guarda o recebimento e se liquidou; cancelado, acaba", () => {
    const lancada = comRespostaDaBaixa(pronta, "lancar", { codigo_lancamento: 7001, codigo_baixa: 8001, codigo_baixa_integracao: "DUTE0123456789abcdef", liquidado: "S", valor_baixado: 1500.5, codigo_status: "0" }, AGORA, SEM_CONFIGURACAO);
    assert.deepEqual([lancada.etapa, lancada.omie.baixa, lancada.omie.liquidado, lancada.tentativas], ["lancada", 8001, true, 0]);
    const cancelada = comRespostaDaBaixa(baixa({ etapa: "cancelando", conferida: true }), "cancelar", { codigo_status: "0" }, AGORA, SEM_CONFIGURACAO);
    assert.equal(cancelada.etapa, "cancelada");
  });

  it("a falha conta, espera o dobro e confere antes da próxima tentativa; a conferência que dá certo não zera a conta", () => {
    let atual = pronta;
    for (let vez = 1; vez < FALHAS_ATE_PARAR; vez += 1) {
      atual = comFalhaDaBaixa(atual, RECUSA, AGORA);
      assert.deepEqual([atual.etapa, atual.conferida, atual.tentativas, passoDaBaixa(atual, new Date(atual.proxima_em))], ["na_fila", false, vez, "conferir"]);
      atual = comRespostaDaBaixa({ ...atual, proxima_em: AGORA.toISOString() }, "conferir", titulos({}), AGORA, SEM_CONFIGURACAO);
      assert.deepEqual([atual.conferida, atual.tentativas], [true, vez]);
    }
    const parada = comFalhaDaBaixa(atual, RECUSA, AGORA);
    assert.deepEqual([parada.etapa, parada.motivo_da_parada, parada.mensagem, parada.etapa_anterior], ["parada", "falhas_seguidas", "Conta corrente inválida.", "na_fila"]);
  });

  it("a chave para; o limite só espera; o duplicado conta e confere", () => {
    assert.equal(comFalhaDaBaixa(pronta, { tipo: "chave", mensagem: "chave", esperar_ms: 0 }, AGORA).motivo_da_parada, "chave");
    const esperou = comFalhaDaBaixa(pronta, { tipo: "limite", mensagem: "Too Many Requests", esperar_ms: 60_000 }, AGORA);
    assert.deepEqual([esperou.tentativas, esperou.conferida, esperou.proxima_em], [0, true, "2026-10-24T12:01:00.000Z"]);
    const duplicado = comFalhaDaBaixa(pronta, { tipo: "duplicado", mensagem: "Já cadastrado", esperar_ms: 0 }, AGORA);
    assert.deepEqual([duplicado.conferida, duplicado.tentativas], [false, 1]);
  });

  it("sem as chaves, para e espera uma pessoa", () => {
    const parada = baixaSemChaves(pronta, AGORA);
    assert.deepEqual([parada.etapa, parada.motivo_da_parada, parada.etapa_anterior, parada.conferida], ["parada", "sem_chaves", "na_fila", false]);
  });
});

describe("o estorno do pagamento", () => {
  it("a que nunca conferiu o título fica cancelada aqui; a conferida, a lançada e a que tentou vão a cancelar na Omie", () => {
    assert.equal(baixaNoEstorno(baixa(), AGORA)?.etapa, "cancelada");
    assert.equal(baixaNoEstorno(baixa({ tentativas: 3 }), AGORA)?.etapa, "cancelada");
    const comTitulo = { os: 9001, titulo: 7001, conta_corrente: 4001, baixa: null, liquidado: null };
    assert.equal(baixaNoEstorno(baixa({ conferida: true, omie: comTitulo }), AGORA)?.etapa, "cancelando");
    // O lançamento que falhou pode ter gravado: confere e cancela.
    assert.equal(baixaNoEstorno(baixa({ conferida: false, omie: comTitulo, tentativas: 2 }), AGORA)?.etapa, "cancelando");
    assert.equal(baixaNoEstorno(baixa({ etapa: "lancada", omie: { ...comTitulo, baixa: 8001 } }), AGORA)?.etapa, "cancelando");
    assert.equal(baixaNoEstorno(baixa({ etapa: "parada", motivo_da_parada: "titulo_repetido" }), AGORA)?.etapa, "cancelada");
    assert.equal(baixaNoEstorno(baixa({ etapa: "parada", motivo_da_parada: "falhas_seguidas", omie: comTitulo }), AGORA)?.etapa, "cancelando");
    const cancelando = baixaNoEstorno(baixa({ etapa: "lancada", omie: comTitulo }), AGORA);
    assert.deepEqual([cancelando?.conferida, cancelando?.motivo_da_parada, passoDaBaixa(cancelando!, AGORA)], [false, null, "conferir"]);
  });

  it("a que já está cancelando ou cancelada não muda", () => {
    for (const etapa of ["cancelando", "cancelada"] as const) assert.equal(baixaNoEstorno(baixa({ etapa }), AGORA), null, etapa);
  });

  it("a dispensada para e espera uma pessoa: o recebimento lançado à mão na Omie não sai sozinho", () => {
    const parada = baixaNoEstorno(baixa({ etapa: "dispensada", edicao: 4 }), AGORA);
    assert.deepEqual(
      [parada?.etapa, parada?.etapa_anterior, parada?.motivo_da_parada, parada?.conferida, parada?.edicao],
      ["parada", "dispensada", "dispensada_e_estornada", false, 5],
    );
    assert.match(parada?.mensagem ?? "", /Desfaça lá o recebimento, se ele foi lançado, e dispense\./);
    assert.equal(passoDaBaixa(parada!, AGORA), null);
    // Só dispensar: retomar lançaria de novo o pagamento estornado.
    assert.deepEqual(comAcaoNaBaixa(parada!, "retomar", AGORA), { problema: "O pagamento foi estornado: desfaça o recebimento na Omie e dispense." });
    const dispensada = comAcaoNaBaixa(parada!, "dispensar", AGORA);
    assert.ok(!("problema" in dispensada));
    assert.deepEqual([dispensada.etapa, dispensada.motivo_da_parada, passoDaBaixa(dispensada, AGORA)], ["dispensada", null, null]);
  });
});

describe("as ações de uma pessoa (parte 7.4h)", () => {
  it("retomar a parada volta à etapa de onde parou, do zero e conferindo; dispensar acaba a baixa", () => {
    const parada = comFalhaDaBaixa(baixa({ etapa: "cancelando", conferida: true, tentativas: 5 }), RECUSA, AGORA);
    assert.deepEqual([parada.etapa, parada.etapa_anterior], ["parada", "cancelando"]);
    const retomada = comAcaoNaBaixa(parada, "retomar", AGORA);
    assert.ok(!("problema" in retomada));
    assert.deepEqual([retomada.etapa, retomada.tentativas, retomada.conferida, retomada.motivo_da_parada, passoDaBaixa(retomada, AGORA)], ["cancelando", 0, false, null, "conferir"]);
    const semChaves = comAcaoNaBaixa(baixaSemChaves(baixa(), AGORA), "retomar", AGORA);
    assert.ok(!("problema" in semChaves));
    assert.equal(semChaves.etapa, "na_fila");
    const dispensada = comAcaoNaBaixa(parada, "dispensar", AGORA);
    assert.ok(!("problema" in dispensada));
    assert.deepEqual([dispensada.etapa, passoDaBaixa(dispensada, AGORA)], ["dispensada", null]);
  });

  it("só a parada tem ação", () => {
    for (const etapa of ["na_fila", "lancada", "cancelando", "cancelada", "dispensada"] as const) {
      assert.deepEqual(comAcaoNaBaixa(baixa({ etapa }), "retomar", AGORA), { problema: "Só a baixa parada se retoma." }, etapa);
      assert.deepEqual(comAcaoNaBaixa(baixa({ etapa }), "dispensar", AGORA), { problema: "Só a baixa parada se dispensa." }, etapa);
    }
  });
});
