import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AMBIENTE_DA_OMIE,
  ETAPAS_DA_EMISSAO,
  ETAPAS_DA_ROTINA,
  FALHAS_ATE_PARAR,
  OMIE_AMBIENTES_LIBERADOS,
  SERVICO_DA_ARMAZENAGEM,
  SERVICO_DAS_OS,
  comAcao,
  comFalha,
  comResposta,
  diaDaFatura,
  diaDaOmie,
  emissaoLida,
  novoIdDeEmissao,
  omieLiberada,
  osDaEmissao,
  segredosDaOmie,
  paradaSemChaves,
  passoDaEmissao,
  pedidoDoPasso,
  type Emissao,
  type Passo,
} from "./emissao-omie.js";

/**
 * A emissão da NFS-e pela Omie, pura (parte 7.4a): o passo de cada etapa, a
 * OS montada da fatura, a resposta e a falha de cada passo e as ações de uma
 * pessoa. As respostas seguem as estruturas das páginas da API da Omie
 * (servicos/os, servicos/osp e geral/clientes). Dados sintéticos.
 */

const AGORA = new Date("2026-10-24T12:00:00.000Z");
const CONTEXTO = { agora: AGORA, ambiente: "H" as const };
const SEM_CONFIGURACAO = { categoria: null, conta_corrente: null };

function emissao(extra: Partial<Emissao> = {}): Emissao {
  return {
    id: "nfe_0123456789abcdef0123",
    customer_code: "ACME",
    customer_name: "Acme Ltda",
    cnpj: "11222333000181",
    itens: [
      { origem: "demanda", referencia: "12345", descricao: "Demanda 12345 · Mudança do 3º andar", valor_cents: 150_050 },
      { origem: "armazenagem", referencia: "ACME_2026-09", descricao: "Armazenagem de setembro de 2026", valor_cents: 99_950 },
    ],
    vencimento: "2026-11-10",
    forma: "boleto",
    observacao: "Pedido 42",
    etapa: "na_fila",
    etapa_anterior: null,
    motivo_da_parada: null,
    mensagem: null,
    mensagens_da_prefeitura: [],
    omie: { cliente: null, os: null, numero_os: null, ambiente: null, nfse: null, codigo_verificacao: null, url_nfse: null, url_pdf: null, dia_do_faturamento: null },
    tentativas: 0,
    consultas: 0,
    proxima_em: "2026-10-24T11:00:00.000Z",
    na_prefeitura_desde: null,
    conferir: false,
    retomada_desde_a_rps: false,
    edicao: 1,
    ...extra,
  };
}

const COM_CLIENTE = { cliente: 5001, os: null, numero_os: null, ambiente: null, nfse: null, codigo_verificacao: null, url_nfse: null, url_pdf: null, dia_do_faturamento: null };
const COM_OS = { ...COM_CLIENTE, os: 9001, numero_os: "000123", ambiente: "H" as const };

describe("liberação e ambiente", () => {
  it("só a homologação emite pela Omie até o lançamento, e cada projeto tem o ambiente dele", () => {
    assert.deepEqual([...OMIE_AMBIENTES_LIBERADOS], ["dute-homolog"]);
    assert.equal(omieLiberada("dute-homolog"), true);
    assert.equal(omieLiberada("dute-prod"), false);
    assert.equal(omieLiberada("dute-btg"), false);
    assert.deepEqual(AMBIENTE_DA_OMIE, { "dute-homolog": "H", "dute-prod": "P" });
  });

  it("as chaves da API são declaradas só onde a Omie está liberada", () => {
    assert.deepEqual(segredosDaOmie("dute-homolog"), ["OMIE_APP_KEY", "OMIE_APP_SECRET"]);
    for (const projeto of ["dute-prod", "dute-btg", "demo-dute-financeiro", "", null, undefined]) assert.deepEqual(segredosDaOmie(projeto), [], String(projeto));
  });
});

describe("o passo de cada etapa", () => {
  it("na fila acha o cliente e depois inclui; incluída confere e depois fatura; na prefeitura acompanha", () => {
    const casos: Array<[Partial<Emissao>, Passo | null]> = [
      [{}, "achar_cliente"],
      [{ omie: COM_CLIENTE }, "incluir_os"],
      [{ etapa: "os_incluida", omie: COM_CLIENTE }, "conferir_ambiente"],
      [{ etapa: "os_incluida", omie: COM_OS }, "faturar_os"],
      [{ etapa: "na_prefeitura", omie: COM_OS }, "acompanhar"],
      [{ etapa: "reenviando", omie: COM_OS }, "reenviar_os"],
      [{ etapa: "cancelando", omie: COM_OS }, "cancelar_os"],
      // Depois da falha de uma chamada que grava, a próxima confere antes na Omie.
      [{ etapa: "os_incluida", omie: COM_OS, conferir: true }, "conferir_os"],
      [{ etapa: "reenviando", omie: COM_OS, conferir: true }, "conferir_os"],
      [{ etapa: "cancelando", omie: COM_OS, conferir: true }, "conferir_os"],
      [{ etapa: "rejeitada", omie: COM_OS }, null],
      [{ etapa: "parada" }, null],
      [{ etapa: "autorizada" }, null],
      [{ etapa: "desistida" }, null],
      [{ proxima_em: "2026-10-24T12:05:00.000Z" }, null],
    ];
    for (const [extra, passo] of casos) assert.equal(passoDaEmissao(emissao(extra), AGORA), passo, JSON.stringify(extra));
    for (const etapa of ETAPAS_DA_EMISSAO) {
      const temPasso = passoDaEmissao(emissao({ etapa, omie: COM_OS }), AGORA) !== null;
      assert.equal(temPasso, ETAPAS_DA_ROTINA.includes(etapa), etapa);
    }
  });
});

describe("a OS da fatura", () => {
  it("leva o código de integração, o cliente, a etapa de faturar, o serviço do contador de cada item e uma parcela", () => {
    const os = osDaEmissao(emissao({ omie: COM_CLIENTE }), "2026-10-24", SEM_CONFIGURACAO) as Record<string, any>;
    assert.deepEqual(os.Cabecalho, { cCodIntOS: "nfe_0123456789abcdef0123", nCodCli: 5001, dDtPrevisao: "24/10/2026", cEtapa: "50", nQtdeParc: 1 });
    assert.deepEqual(
      os.ServicosPrestados.map((item: Record<string, unknown>) => [item.nSeqItem, item.cCodIntServico, item.nValUnit, item.nQtde]),
      [
        [1, SERVICO_DAS_OS, 1500.5, 1],
        [2, SERVICO_DA_ARMAZENAGEM, 999.5, 1],
      ],
    );
    assert.deepEqual(os.Parcelas, [{ nParcela: 1, dDtVenc: "10/11/2026", nValor: 2500, nPercentual: 100 }]);
    assert.deepEqual(os.InformacoesAdicionais, { cDadosAdicNF: "Emissão Dute nfe_0123456789abcdef0123 · Pedido 42" });
  });

  it("a medição aprovada é um item só, com o serviço das OS, e a emissão gravada com ela se lê (pergunta 64)", () => {
    const itens = [{ origem: "medicao" as const, referencia: "ctr_safra_2026-10", descricao: "Medição de 10/2026", valor_cents: 266_500 }];
    const os = osDaEmissao(emissao({ omie: COM_CLIENTE, itens }), "2026-10-24", SEM_CONFIGURACAO) as Record<string, any>;
    assert.deepEqual(
      os.ServicosPrestados.map((item: Record<string, unknown>) => [item.cCodIntServico, item.cDescServ, item.nValUnit]),
      [[SERVICO_DAS_OS, "Medição de 10/2026", 2665]],
    );
    assert.deepEqual(os.Parcelas[0].nValor, 2665);
    const gravada = emissao({ itens });
    assert.deepEqual(emissaoLida(gravada.id, gravada as unknown as Record<string, unknown>).itens, itens);
  });

  it("a categoria e a conta corrente entram só quando o contador passou", () => {
    const os = osDaEmissao(emissao({ omie: COM_CLIENTE }), "2026-10-24", { categoria: "1.01.02", conta_corrente: 777 }) as Record<string, any>;
    assert.equal(os.InformacoesAdicionais.cCodCateg, "1.01.02");
    assert.equal(os.InformacoesAdicionais.nCodCC, 777);
  });

  it("cada passo chama o serviço e o método da Omie", () => {
    const comOs = emissao({ omie: COM_OS });
    const casos: Array<[Passo, string, string]> = [
      ["achar_cliente", "geral/clientes", "ListarClientes"],
      ["conferir_ambiente", "servicos/os", "StatusOS"],
      ["faturar_os", "servicos/osp", "FaturarOS"],
      ["acompanhar", "servicos/os", "StatusOS"],
      ["reenviar_os", "servicos/osp", "ReenviarOS"],
      ["cancelar_os", "servicos/osp", "CancelarOS"],
      ["conferir_os", "servicos/os", "StatusOS"],
    ];
    for (const [passo, servico, call] of casos) {
      const pedido = pedidoDoPasso(passo, comOs, "2026-10-24", SEM_CONFIGURACAO);
      assert.deepEqual([pedido.servico, pedido.call], [servico, call], passo);
    }
    assert.deepEqual(pedidoDoPasso("achar_cliente", comOs, "2026-10-24", SEM_CONFIGURACAO).param.clientesFiltro, { cnpj_cpf: "11.222.333/0001-81" });
    assert.deepEqual(pedidoDoPasso("faturar_os", comOs, "2026-10-24", SEM_CONFIGURACAO).param, { cCodIntOS: comOs.id, nCodOS: 9001 });
    assert.equal(pedidoDoPasso("cancelar_os", comOs, "2026-10-24", SEM_CONFIGURACAO).param.cCancelarNfse, "S");
    assert.deepEqual(pedidoDoPasso("conferir_os", comOs, "2026-10-24", SEM_CONFIGURACAO).param, { cCodIntOS: comOs.id, nCodOS: 9001, lMsg: true });
  });
});

describe("a resposta de cada passo", () => {
  it("o cliente: um ativo com o CNPJ segue; nenhum ou dois param", () => {
    const um = comResposta(emissao(), "achar_cliente", { clientes_cadastro: [{ codigo_cliente_omie: 5001, cnpj_cpf: "11.222.333/0001-81", inativo: "N" }, { codigo_cliente_omie: 5002, cnpj_cpf: "11.222.333/0001-81", inativo: "S" }] }, CONTEXTO);
    assert.equal(um.emissao.omie.cliente, 5001);
    assert.equal(passoDaEmissao(um.emissao, AGORA), "incluir_os");
    const nenhum = comResposta(emissao(), "achar_cliente", { clientes_cadastro: [] }, CONTEXTO).emissao;
    assert.deepEqual([nenhum.etapa, nenhum.motivo_da_parada, nenhum.etapa_anterior], ["parada", "cliente_nao_achado", "na_fila"]);
    const dois = comResposta(emissao(), "achar_cliente", { clientes_cadastro: [{ codigo_cliente_omie: 1, cnpj_cpf: "11222333000181" }, { codigo_cliente_omie: 2, cnpj_cpf: "11222333000181" }] }, CONTEXTO).emissao;
    assert.equal(dois.motivo_da_parada, "cliente_repetido");
  });

  it("incluir guarda a OS; conferir para no ambiente errado e segue no certo", () => {
    const incluida = comResposta(emissao({ omie: COM_CLIENTE }), "incluir_os", { cCodIntOS: "nfe_0123456789abcdef0123", nCodOS: 9001, cNumOS: "000123", cCodStatus: "0" }, CONTEXTO).emissao;
    assert.deepEqual([incluida.etapa, incluida.omie.os, incluida.omie.numero_os], ["os_incluida", 9001, "000123"]);
    const errado = comResposta(incluida, "conferir_ambiente", { nCodOS: 9001, cAmbiente: "P", cFaturada: "N" }, CONTEXTO).emissao;
    assert.deepEqual([errado.etapa, errado.motivo_da_parada], ["parada", "ambiente_errado"]);
    assert.match(errado.mensagem ?? "", /produção.*só emite em homologação/);
    const certo = comResposta(incluida, "conferir_ambiente", { nCodOS: 9001, cAmbiente: "H", cFaturada: "N" }, CONTEXTO).emissao;
    assert.equal(passoDaEmissao(certo, AGORA), "faturar_os");
  });

  it("a OS que já estava faturada (a rotina caiu no meio) segue para a prefeitura", () => {
    const conferida = comResposta(emissao({ etapa: "os_incluida", omie: COM_CLIENTE }), "conferir_ambiente", { nCodOS: 9001, cAmbiente: "H", cFaturada: "S" }, CONTEXTO).emissao;
    assert.equal(conferida.etapa, "na_prefeitura");
  });

  it("sem o código da OS no StatusOS, conta como falha e não fica conferindo para sempre", () => {
    const conferida = comResposta(emissao({ etapa: "os_incluida", omie: COM_CLIENTE }), "conferir_ambiente", { cAmbiente: "H" }, CONTEXTO).emissao;
    assert.equal(conferida.tentativas, 1);
    assert.equal(passoDaEmissao(conferida, AGORA), null);
  });

  it("na prefeitura: 004 autoriza e registra a fatura; 003 rejeita com as mensagens; 001 e 002 esperam", () => {
    const naPrefeitura = emissao({ etapa: "na_prefeitura", omie: COM_OS, na_prefeitura_desde: "2026-10-24T11:50:00.000Z" });
    const autorizada = comResposta(naPrefeitura, "acompanhar", { ListaRpsNfse: [{ cStatusRps: "004", nNfse: "00000815", cCodVerif: "AB12", cUrlNfse: "https://nfse.exemplo/815", cUrlPdfDest: "https://omie.exemplo/815.pdf" }] }, CONTEXTO);
    assert.equal(autorizada.efeito, "registrar_fatura");
    assert.deepEqual([autorizada.emissao.etapa, autorizada.emissao.omie.nfse, autorizada.emissao.omie.codigo_verificacao], ["autorizada", "00000815", "AB12"]);
    const rejeitada = comResposta(naPrefeitura, "acompanhar", { ListaRpsNfse: [{ cStatusRps: "003", mensagens: [{ cCodigo: "E160", cDescricao: "Inscrição municipal do tomador inválida.", cCorrecao: "Corrija o cadastro do cliente." }] }] }, CONTEXTO);
    assert.equal(rejeitada.efeito, "nenhum");
    assert.deepEqual([rejeitada.emissao.etapa, rejeitada.emissao.mensagem], ["rejeitada", "Inscrição municipal do tomador inválida."]);
    assert.equal(rejeitada.emissao.mensagens_da_prefeitura[0].correcao, "Corrija o cadastro do cliente.");
    const esperando = comResposta({ ...naPrefeitura, consultas: 1 }, "acompanhar", { ListaRpsNfse: [{ cStatusRps: "002" }] }, CONTEXTO);
    assert.deepEqual([esperando.emissao.etapa, esperando.emissao.proxima_em, esperando.emissao.consultas], ["na_prefeitura", "2026-10-24T12:05:00.000Z", 2]);
    // Mudou de etapa, a conta das consultas volta a zero.
    assert.equal(autorizada.emissao.consultas, 0);
  });

  it("a prefeitura que não responde em 72 horas para a emissão; a OS cancelada na Omie também", () => {
    const antiga = emissao({ etapa: "na_prefeitura", omie: COM_OS, na_prefeitura_desde: "2026-10-21T11:00:00.000Z" });
    assert.equal(comResposta(antiga, "acompanhar", { ListaRpsNfse: [{ cStatusRps: "002" }] }, CONTEXTO).emissao.motivo_da_parada, "prefeitura_demorou");
    const cancelada = emissao({ etapa: "na_prefeitura", omie: COM_OS, na_prefeitura_desde: "2026-10-24T11:50:00.000Z" });
    assert.equal(comResposta(cancelada, "acompanhar", { cCancelada: "S", ListaRpsNfse: [] }, CONTEXTO).emissao.motivo_da_parada, "cancelada_na_omie");
  });

  it("faturar e reenviar levam à prefeitura; cancelar desiste e libera as reservas", () => {
    const faturada = comResposta(emissao({ etapa: "os_incluida", omie: COM_OS }), "faturar_os", { cCodStatus: "0" }, CONTEXTO).emissao;
    assert.deepEqual([faturada.etapa, faturada.na_prefeitura_desde], ["na_prefeitura", AGORA.toISOString()]);
    const cancelada = comResposta(emissao({ etapa: "cancelando", omie: COM_OS }), "cancelar_os", { cCodStatus: "0" }, CONTEXTO);
    assert.deepEqual([cancelada.emissao.etapa, cancelada.efeito], ["desistida", "liberar_reservas"]);
  });
});

describe("a falha de cada passo", () => {
  it("o duplicado na inclusão é a OS que já existe: segue para conferir", () => {
    const seguiu = comFalha(emissao({ omie: COM_CLIENTE }), "incluir_os", { tipo: "duplicado", mensagem: "já cadastrada", esperar_ms: 0 }, AGORA);
    assert.deepEqual([seguiu.etapa, passoDaEmissao(seguiu, AGORA)], ["os_incluida", "conferir_ambiente"]);
  });

  it("a chave para; o limite só espera, sem contar falha", () => {
    assert.equal(comFalha(emissao(), "achar_cliente", { tipo: "chave", mensagem: "chave", esperar_ms: 0 }, AGORA).motivo_da_parada, "chave");
    const esperou = comFalha(emissao(), "achar_cliente", { tipo: "limite", mensagem: "Too Many Requests", esperar_ms: 60_000 }, AGORA);
    assert.deepEqual([esperou.tentativas, esperou.proxima_em, esperou.etapa], [0, "2026-10-24T12:01:00.000Z", "na_fila"]);
  });

  it("a recusa e a instabilidade dobram o intervalo e param na sexta seguida", () => {
    let atual = emissao({ omie: COM_CLIENTE });
    const intervalos: number[] = [];
    for (let vez = 1; vez < FALHAS_ATE_PARAR; vez += 1) {
      atual = comFalha(atual, "incluir_os", { tipo: "recusa", mensagem: "Tag inválida", esperar_ms: 2 * 60_000 }, AGORA);
      intervalos.push((Date.parse(atual.proxima_em) - AGORA.getTime()) / 60_000);
      assert.equal(atual.etapa, "na_fila");
    }
    assert.deepEqual(intervalos, [2, 4, 8, 16, 32]);
    const parada = comFalha(atual, "incluir_os", { tipo: "instavel", mensagem: "PROTO_BYEBYE", esperar_ms: 2 * 60_000 }, AGORA);
    assert.deepEqual([parada.etapa, parada.motivo_da_parada, parada.mensagem, parada.etapa_anterior], ["parada", "falhas_seguidas", "PROTO_BYEBYE", "na_fila"]);
  });
});

describe("a conferência depois da falha de uma chamada que grava", () => {
  const recusa = { tipo: "recusa" as const, mensagem: "ERROR: A OS já está faturada.", esperar_ms: 2 * 60_000 };
  const perdida = { tipo: "instavel" as const, mensagem: "Sem resposta da Omie: This operation was aborted", esperar_ms: 2 * 60_000 };

  it("a falha do FaturarOS, do ReenviarOS e do CancelarOS pede a conferência; a das leituras e a do limite não", () => {
    for (const [etapa, passo] of [["os_incluida", "faturar_os"], ["reenviando", "reenviar_os"], ["cancelando", "cancelar_os"]] as const) {
      const falhou = comFalha(emissao({ etapa, omie: COM_OS }), passo, perdida, AGORA);
      assert.deepEqual([falhou.etapa, falhou.conferir, falhou.tentativas], [etapa, true, 1], passo);
      assert.equal(passoDaEmissao(falhou, new Date(falhou.proxima_em)), "conferir_os", passo);
    }
    assert.equal(comFalha(emissao({ etapa: "na_prefeitura", omie: COM_OS }), "acompanhar", perdida, AGORA).conferir, false);
    assert.equal(comFalha(emissao({ etapa: "os_incluida", omie: COM_OS }), "faturar_os", { tipo: "limite", mensagem: "Too Many Requests", esperar_ms: 60_000 }, AGORA).conferir, false);
    // A parada pelas falhas guarda a conferência: retomar confere antes de faturar de novo.
    const parada = comFalha(emissao({ etapa: "os_incluida", omie: COM_OS, tentativas: FALHAS_ATE_PARAR - 1 }), "faturar_os", perdida, AGORA);
    assert.deepEqual([parada.etapa, parada.conferir], ["parada", true]);
    const retomada = comAcao(parada, "retomar", AGORA);
    assert.ok("emissao" in retomada);
    assert.equal(passoDaEmissao(retomada.emissao, AGORA), "conferir_os");
  });

  it("o FaturarOS que deu certo com a resposta perdida: a OS faturada segue para a prefeitura, sem faturar de novo", () => {
    const falhou = comFalha(emissao({ etapa: "os_incluida", omie: COM_OS }), "faturar_os", perdida, AGORA);
    const conferida = comResposta(falhou, "conferir_os", { nCodOS: 9001, cAmbiente: "H", cFaturada: "S", cCancelada: "N", ListaRpsNfse: [{ cStatusRps: "002" }] }, CONTEXTO);
    assert.deepEqual([conferida.efeito, conferida.emissao.etapa, conferida.emissao.conferir, conferida.emissao.na_prefeitura_desde], ["nenhum", "na_prefeitura", false, AGORA.toISOString()]);
    assert.equal(passoDaEmissao(conferida.emissao, AGORA), "acompanhar");
  });

  it("a OS ainda sem faturar fatura de novo, e as falhas seguem contando até parar na sexta", () => {
    let atual = emissao({ etapa: "os_incluida", omie: COM_OS });
    const passos: string[] = [];
    for (let volta = 0; volta < 20 && atual.etapa !== "parada"; volta += 1) {
      const passo = passoDaEmissao(atual, new Date(atual.proxima_em));
      assert.ok(passo);
      passos.push(passo);
      atual = passo === "conferir_os" ? comResposta(atual, passo, { nCodOS: 9001, cAmbiente: "H", cFaturada: "N", cCancelada: "N" }, { ...CONTEXTO, agora: new Date(atual.proxima_em) }).emissao : comFalha(atual, passo, recusa, new Date(atual.proxima_em));
    }
    assert.deepEqual([atual.etapa, atual.motivo_da_parada, atual.etapa_anterior, atual.tentativas], ["parada", "falhas_seguidas", "os_incluida", FALHAS_ATE_PARAR]);
    assert.deepEqual(passos, ["faturar_os", ...Array.from({ length: FALHAS_ATE_PARAR - 1 }, () => ["conferir_os", "faturar_os"]).flat()]);
  });

  it("o CancelarOS da OS já cancelada na Omie: a conferência desiste e solta as reservas", () => {
    const falhou = comFalha(emissao({ etapa: "cancelando", omie: COM_OS }), "cancelar_os", { ...recusa, mensagem: "ERROR: A OS já está cancelada." }, AGORA);
    const cancelada = comResposta(falhou, "conferir_os", { nCodOS: 9001, cFaturada: "S", cCancelada: "S", ListaRpsNfse: [{ cStatusRps: "003" }] }, CONTEXTO);
    assert.deepEqual([cancelada.efeito, cancelada.emissao.etapa, cancelada.emissao.conferir], ["liberar_reservas", "desistida", false]);
    const aindaNao = comResposta(falhou, "conferir_os", { nCodOS: 9001, cFaturada: "S", cCancelada: "N", ListaRpsNfse: [{ cStatusRps: "003" }] }, CONTEXTO).emissao;
    assert.deepEqual([aindaNao.etapa, aindaNao.conferir, aindaNao.tentativas, passoDaEmissao(aindaNao, AGORA)], ["cancelando", false, 1, "cancelar_os"]);
  });

  it("o ReenviarOS que deu certo com a resposta perdida: a RPS que saiu da recusa segue para a prefeitura", () => {
    const falhou = comFalha(emissao({ etapa: "reenviando", omie: COM_OS, mensagens_da_prefeitura: [{ codigo: "E160", descricao: "x", correcao: "y" }] }), "reenviar_os", perdida, AGORA);
    const reenviada = comResposta(falhou, "conferir_os", { nCodOS: 9001, cFaturada: "S", cCancelada: "N", ListaRpsNfse: [{ cStatusRps: "003" }, { cStatusRps: "002" }] }, CONTEXTO).emissao;
    assert.deepEqual([reenviada.etapa, reenviada.conferir, reenviada.mensagens_da_prefeitura], ["na_prefeitura", false, []]);
    const aindaRecusada = comResposta(falhou, "conferir_os", { nCodOS: 9001, cFaturada: "S", cCancelada: "N", ListaRpsNfse: [{ cStatusRps: "003" }] }, CONTEXTO).emissao;
    assert.deepEqual([aindaRecusada.etapa, passoDaEmissao(aindaRecusada, AGORA)], ["reenviando", "reenviar_os"]);
  });

  it("a OS cancelada na Omie, achada na conferência de faturar ou de reenviar, para a emissão", () => {
    for (const [etapa, passo] of [["os_incluida", "faturar_os"], ["reenviando", "reenviar_os"]] as const) {
      const falhou = comFalha(emissao({ etapa, omie: COM_OS }), passo, perdida, AGORA);
      const parada = comResposta(falhou, "conferir_os", { nCodOS: 9001, cFaturada: "S", cCancelada: "S", ListaRpsNfse: [] }, CONTEXTO).emissao;
      assert.deepEqual([parada.etapa, parada.motivo_da_parada, parada.conferir], ["parada", "cancelada_na_omie", false], etapa);
    }
  });
});

describe("desistir não cancela a NFS-e autorizada", () => {
  const NFSE = { ...COM_OS, nfse: "00000815", codigo_verificacao: "AB12", url_nfse: "https://nfse.exemplo/815", url_pdf: null };

  it("com a NFS-e autorizada, desistir pede antes o cancelamento na Omie; com a OS cancelada lá, solta as reservas", () => {
    const recusada = emissao({ etapa: "parada", etapa_anterior: "na_prefeitura", motivo_da_parada: "fatura_recusada", omie: NFSE, na_prefeitura_desde: "2026-10-24T11:00:00.000Z" });
    const tentativa = comAcao(recusada, "desistir", AGORA);
    assert.ok("problema" in tentativa);
    assert.match(tentativa.problema, /A NFS-e 815 foi autorizada/);
    const cancelada = comAcao({ ...recusada, motivo_da_parada: "cancelada_na_omie" }, "desistir", AGORA);
    assert.ok("emissao" in cancelada);
    assert.deepEqual([cancelada.emissao.etapa, cancelada.efeito], ["desistida", "liberar_reservas"]);
  });

  it("desistir com a OS na Omie confere a OS antes de cancelar", () => {
    const parada = emissao({ etapa: "parada", etapa_anterior: "na_prefeitura", motivo_da_parada: "prefeitura_demorou", omie: COM_OS, na_prefeitura_desde: "2026-10-21T11:00:00.000Z" });
    const desistida = comAcao(parada, "desistir", AGORA);
    assert.ok("emissao" in desistida);
    assert.deepEqual([desistida.emissao.etapa, desistida.emissao.conferir, passoDaEmissao(desistida.emissao, AGORA)], ["cancelando", true, "conferir_os"]);
  });

  it("a conferência do cancelamento: a autorizada para sem cancelar; a que a prefeitura processa espera; a recusada e a OS sem faturar cancelam", () => {
    const cancelando = emissao({ etapa: "cancelando", omie: COM_OS, conferir: true, na_prefeitura_desde: "2026-10-24T11:00:00.000Z" });
    const autorizada = comResposta(cancelando, "conferir_os", { nCodOS: 9001, cFaturada: "S", cCancelada: "N", ListaRpsNfse: [{ cStatusRps: "004", nNfse: "00000815", cCodVerif: "AB12", cUrlNfse: "https://nfse.exemplo/815" }] }, CONTEXTO);
    assert.deepEqual(
      [autorizada.efeito, autorizada.emissao.etapa, autorizada.emissao.motivo_da_parada, autorizada.emissao.etapa_anterior, autorizada.emissao.omie.nfse, autorizada.emissao.conferir],
      ["nenhum", "parada", "nfse_autorizada", "na_prefeitura", "00000815", false],
    );
    assert.match(autorizada.emissao.mensagem ?? "", /A NFS-e 815 foi autorizada/);
    // Tentar de novo leva à prefeitura: a autorizada vira fatura; desistir espera o cancelamento na Omie.
    const retomada = comAcao(autorizada.emissao, "retomar", AGORA);
    assert.ok("emissao" in retomada);
    assert.deepEqual([retomada.emissao.etapa, passoDaEmissao(retomada.emissao, AGORA)], ["na_prefeitura", "acompanhar"]);
    assert.ok("problema" in comAcao(autorizada.emissao, "desistir", AGORA));

    const processando = comResposta(cancelando, "conferir_os", { nCodOS: 9001, cFaturada: "S", cCancelada: "N", ListaRpsNfse: [{ cStatusRps: "002" }] }, CONTEXTO).emissao;
    assert.deepEqual([processando.etapa, processando.conferir, processando.consultas, processando.proxima_em], ["cancelando", true, 1, "2026-10-24T12:02:00.000Z"]);
    assert.equal(passoDaEmissao(processando, new Date(processando.proxima_em)), "conferir_os");

    for (const corpo of [
      { nCodOS: 9001, cFaturada: "N", cCancelada: "N", ListaRpsNfse: [] },
      { nCodOS: 9001, cFaturada: "S", cCancelada: "N", ListaRpsNfse: [{ cStatusRps: "003" }] },
    ]) {
      const segue = comResposta(cancelando, "conferir_os", corpo, CONTEXTO).emissao;
      assert.deepEqual([segue.etapa, segue.conferir, passoDaEmissao(segue, AGORA)], ["cancelando", false, "cancelar_os"], JSON.stringify(corpo));
    }
  });

  it("a prefeitura que não responde em 72 horas também para o cancelamento", () => {
    const antiga = emissao({ etapa: "cancelando", omie: COM_OS, conferir: true, na_prefeitura_desde: "2026-10-21T11:00:00.000Z" });
    const parada = comResposta(antiga, "conferir_os", { nCodOS: 9001, cFaturada: "S", cCancelada: "N", ListaRpsNfse: [{ cStatusRps: "002" }] }, CONTEXTO).emissao;
    assert.deepEqual([parada.etapa, parada.motivo_da_parada, parada.etapa_anterior], ["parada", "prefeitura_demorou", "cancelando"]);
  });
});

describe("o relógio da prefeitura", () => {
  const QUATRO_DIAS_ANTES = "2026-10-20T12:00:00.000Z";
  const processando = { ListaRpsNfse: [{ cStatusRps: "002" }] };
  const depoisDe = (horas: number) => ({ ...CONTEXTO, agora: new Date(AGORA.getTime() + horas * 3_600_000) });

  it("o reenvio recomeça o relógio: a RPS corrigida dias depois ganha outras 72 horas", () => {
    const reenviando = emissao({ etapa: "reenviando", omie: COM_OS, na_prefeitura_desde: QUATRO_DIAS_ANTES });
    const reenviada = comResposta(reenviando, "reenviar_os", { cCodStatus: "0" }, CONTEXTO).emissao;
    assert.deepEqual([reenviada.etapa, reenviada.na_prefeitura_desde], ["na_prefeitura", AGORA.toISOString()]);
    const esperando = comResposta(reenviada, "acompanhar", processando, depoisDe(1)).emissao;
    assert.deepEqual([esperando.etapa, esperando.consultas], ["na_prefeitura", 1]);
    assert.equal(comResposta(esperando, "acompanhar", processando, depoisDe(73)).emissao.motivo_da_parada, "prefeitura_demorou");
    // O ReenviarOS que deu certo com a resposta perdida, achado na conferência, também recomeça.
    const falhou = comFalha(reenviando, "reenviar_os", { tipo: "instavel", mensagem: "Sem resposta da Omie", esperar_ms: 2 * 60_000 }, AGORA);
    const conferida = comResposta(falhou, "conferir_os", { nCodOS: 9001, cFaturada: "S", cCancelada: "N", ListaRpsNfse: [{ cStatusRps: "002" }] }, CONTEXTO).emissao;
    assert.deepEqual([conferida.etapa, conferida.na_prefeitura_desde], ["na_prefeitura", AGORA.toISOString()]);
  });

  it("tentar de novo depois da demora da prefeitura dá outras 72 horas; depois das falhas seguidas, o relógio continua", () => {
    const demorou = comResposta(emissao({ etapa: "na_prefeitura", omie: COM_OS, na_prefeitura_desde: QUATRO_DIAS_ANTES }), "acompanhar", processando, CONTEXTO).emissao;
    assert.equal(demorou.motivo_da_parada, "prefeitura_demorou");
    const retomada = comAcao(demorou, "retomar", AGORA);
    assert.ok("emissao" in retomada);
    assert.deepEqual([retomada.emissao.etapa, retomada.emissao.na_prefeitura_desde], ["na_prefeitura", AGORA.toISOString()]);
    assert.equal(comResposta(retomada.emissao, "acompanhar", processando, CONTEXTO).emissao.etapa, "na_prefeitura");
    // As falhas da consulta são da Omie, não demora da prefeitura.
    const falhas = emissao({ etapa: "parada", etapa_anterior: "na_prefeitura", motivo_da_parada: "falhas_seguidas", omie: COM_OS, na_prefeitura_desde: QUATRO_DIAS_ANTES });
    const outra = comAcao(falhas, "retomar", AGORA);
    assert.ok("emissao" in outra);
    assert.equal(outra.emissao.na_prefeitura_desde, QUATRO_DIAS_ANTES);
  });

  it("a espera sem relógio começa a contar: a OS faturada à mão durante o cancelamento também tem prazo", () => {
    const cancelando = emissao({ etapa: "cancelando", omie: COM_OS, conferir: true });
    const corpo = { nCodOS: 9001, cFaturada: "S", cCancelada: "N", ListaRpsNfse: [{ cStatusRps: "002" }] };
    const esperando = comResposta(cancelando, "conferir_os", corpo, CONTEXTO).emissao;
    assert.deepEqual([esperando.etapa, esperando.na_prefeitura_desde], ["cancelando", AGORA.toISOString()]);
    assert.equal(comResposta(esperando, "conferir_os", corpo, depoisDe(1)).emissao.na_prefeitura_desde, AGORA.toISOString());
    const parada = comResposta(esperando, "conferir_os", corpo, depoisDe(73)).emissao;
    assert.deepEqual([parada.etapa, parada.motivo_da_parada, parada.etapa_anterior], ["parada", "prefeitura_demorou", "cancelando"]);
  });
});

describe("o dia da fatura da NFS-e (pergunta 60)", () => {
  const autorizada = { nCodOS: 9001, cFaturada: "S", cCancelada: "N", dDtFat: "20/10/2026", ListaRpsNfse: [{ cStatusRps: "004", nNfse: "00000815", cCodVerif: "AB12" }] };

  it("lê o dia das datas da Omie e recusa o que não é um dia do calendário", () => {
    assert.equal(diaDaOmie("20/10/2026"), "2026-10-20");
    assert.equal(diaDaOmie(" 29/02/2028 "), "2028-02-29");
    for (const valor of ["31/02/2026", "29/02/2027", "2026-10-20", "20/10/26", "", null, undefined, 20102026]) assert.equal(diaDaOmie(valor), null, String(valor));
  });

  it("a autorização guarda o dia do faturamento da OS; sem ele na resposta, fica o que já tinha", () => {
    const naPrefeitura = emissao({ etapa: "na_prefeitura", omie: COM_OS });
    assert.equal(comResposta(naPrefeitura, "acompanhar", autorizada, CONTEXTO).emissao.omie.dia_do_faturamento, "2026-10-20");
    const { dDtFat: _semDia, ...semDia } = autorizada;
    assert.equal(comResposta(naPrefeitura, "acompanhar", semDia, CONTEXTO).emissao.omie.dia_do_faturamento, null);
    const jaLido = emissao({ etapa: "na_prefeitura", omie: { ...COM_OS, dia_do_faturamento: "2026-10-19" } });
    assert.equal(comResposta(jaLido, "acompanhar", semDia, CONTEXTO).emissao.omie.dia_do_faturamento, "2026-10-19");
    // A conferência do cancelamento que acha a nota autorizada também guarda.
    const cancelando = emissao({ etapa: "cancelando", omie: COM_OS, conferir: true });
    assert.equal(comResposta(cancelando, "conferir_os", autorizada, CONTEXTO).emissao.omie.dia_do_faturamento, "2026-10-20");
  });

  it("retomar a parada marca a retomada; a RPS que a rotina manda de novo zera; retomar a rejeitada não marca", () => {
    for (const motivo of ["prefeitura_demorou", "falhas_seguidas", "sem_chaves", "chave", "fatura_recusada", "nfse_autorizada"] as const) {
      const retomada = comAcao(emissao({ etapa: "parada", etapa_anterior: "na_prefeitura", motivo_da_parada: motivo, omie: COM_OS }), "retomar", AGORA);
      assert.ok("emissao" in retomada);
      assert.deepEqual([retomada.emissao.etapa, retomada.emissao.retomada_desde_a_rps], ["na_prefeitura", true], motivo);
    }
    const reenvio = comAcao(emissao({ etapa: "rejeitada", omie: COM_OS }), "retomar", AGORA);
    assert.ok("emissao" in reenvio);
    assert.equal(reenvio.emissao.retomada_desde_a_rps, false);
    for (const [etapa, passo] of [["os_incluida", "faturar_os"], ["reenviando", "reenviar_os"]] as const) {
      const enviada = comResposta(emissao({ etapa, omie: COM_OS, retomada_desde_a_rps: true }), passo, { cCodStatus: "0" }, CONTEXTO).emissao;
      assert.deepEqual([enviada.etapa, enviada.retomada_desde_a_rps], ["na_prefeitura", false], passo);
    }
    // A conferência que acha a RPS já enviada antes da parada mantém a marca: a nota pode ter saído na parada.
    const paraConferir = emissao({ etapa: "os_incluida", omie: COM_OS, conferir: true, retomada_desde_a_rps: true });
    const conferida = comResposta(paraConferir, "conferir_os", { nCodOS: 9001, cFaturada: "S", cCancelada: "N", ListaRpsNfse: [{ cStatusRps: "002" }] }, CONTEXTO).emissao;
    assert.deepEqual([conferida.etapa, conferida.retomada_desde_a_rps], ["na_prefeitura", true]);
  });

  it("na rotina em dia, o dia em que ela viu a autorização; depois da retomada, o do faturamento na Omie, nunca depois de hoje", () => {
    const comFaturamento = { ...COM_OS, nfse: "00000815", dia_do_faturamento: "2026-10-20" };
    assert.equal(diaDaFatura(emissao({ omie: comFaturamento }), "2026-10-24"), "2026-10-24");
    assert.equal(diaDaFatura(emissao({ omie: comFaturamento, retomada_desde_a_rps: true }), "2026-10-24"), "2026-10-20");
    assert.equal(diaDaFatura(emissao({ omie: { ...comFaturamento, dia_do_faturamento: null }, retomada_desde_a_rps: true }), "2026-10-24"), "2026-10-24");
    assert.equal(diaDaFatura(emissao({ omie: { ...comFaturamento, dia_do_faturamento: "2026-10-25" }, retomada_desde_a_rps: true }), "2026-10-24"), "2026-10-24");
  });
});

describe("as ações de uma pessoa", () => {
  it("retomar a parada volta à etapa de onde parou; a rejeitada reenvia", () => {
    const parada = comFalha(emissao({ etapa: "os_incluida", omie: COM_OS, tentativas: 5 }), "faturar_os", { tipo: "recusa", mensagem: "x", esperar_ms: 0 }, AGORA);
    const retomada = comAcao(parada, "retomar", AGORA);
    assert.ok("emissao" in retomada);
    assert.deepEqual([retomada.emissao.etapa, retomada.emissao.tentativas, retomada.emissao.motivo_da_parada], ["os_incluida", 0, null]);
    const reenvio = comAcao(emissao({ etapa: "rejeitada", omie: COM_OS }), "retomar", AGORA);
    assert.ok("emissao" in reenvio);
    assert.equal(reenvio.emissao.etapa, "reenviando");
  });

  it("desistir com a OS na Omie cancela lá antes de liberar; sem a OS, libera na hora", () => {
    const comOs = comAcao(emissao({ etapa: "rejeitada", omie: COM_OS }), "desistir", AGORA);
    assert.ok("emissao" in comOs);
    assert.deepEqual([comOs.emissao.etapa, comOs.efeito], ["cancelando", "nenhum"]);
    const semOs = comAcao(emissao({ etapa: "parada", motivo_da_parada: "cliente_nao_achado" }), "desistir", AGORA);
    assert.ok("emissao" in semOs);
    assert.deepEqual([semOs.emissao.etapa, semOs.efeito], ["desistida", "liberar_reservas"]);
  });

  it("sem as chaves, a emissão para e espera uma pessoa: desistir solta as reservas, retomar volta de onde parou", () => {
    const parada = paradaSemChaves(emissao({ etapa: "os_incluida", omie: COM_OS }), AGORA);
    assert.deepEqual(
      [parada.efeito, parada.emissao.etapa, parada.emissao.etapa_anterior, parada.emissao.motivo_da_parada, parada.emissao.mensagem, parada.emissao.edicao],
      ["nenhum", "parada", "os_incluida", "sem_chaves", "As chaves da API da Omie não estão neste ambiente.", 2],
    );
    assert.equal(passoDaEmissao(parada.emissao, AGORA), null);
    const retomada = comAcao(parada.emissao, "retomar", AGORA);
    assert.ok("emissao" in retomada);
    assert.deepEqual([retomada.emissao.etapa, retomada.emissao.motivo_da_parada], ["os_incluida", null]);
    // Sem a OS na Omie (a emissão nunca saiu), desistir libera na hora.
    const desistida = comAcao(paradaSemChaves(emissao(), AGORA).emissao, "desistir", AGORA);
    assert.ok("emissao" in desistida);
    assert.deepEqual([desistida.emissao.etapa, desistida.efeito], ["desistida", "liberar_reservas"]);
  });

  it("não se retoma nem desiste da emissão que anda sozinha ou já acabou", () => {
    for (const etapa of ["na_fila", "na_prefeitura", "autorizada", "desistida"] as const) {
      assert.ok("problema" in comAcao(emissao({ etapa }), "retomar", AGORA), etapa);
      assert.ok("problema" in comAcao(emissao({ etapa }), "desistir", AGORA), etapa);
    }
    assert.ok("problema" in comAcao(emissao({ etapa: "parada", motivo_da_parada: "cancelada_na_omie", omie: COM_OS }), "retomar", AGORA));
  });
});

describe("a emissão gravada (parte 7.4c)", () => {
  it("lê a emissão inteira e recusa a que vem fora do formato", () => {
    const gravada = { ...emissao({ omie: COM_OS, etapa: "na_prefeitura" }), total_cents: 250_000, criada_em: "2026-10-24T11:00:00.000Z" };
    const lida = emissaoLida(gravada.id, gravada as unknown as Record<string, unknown>);
    assert.deepEqual([lida.etapa, lida.omie.os, lida.itens.length, lida.cnpj], ["na_prefeitura", 9001, 2, "11222333000181"]);
    // A emissão gravada antes da conferência não confere; a marcada confere.
    const { conferir: _semConferir, ...antiga } = gravada;
    assert.equal(emissaoLida(gravada.id, antiga as unknown as Record<string, unknown>).conferir, false);
    assert.equal(emissaoLida(gravada.id, { ...gravada, conferir: true } as unknown as Record<string, unknown>).conferir, true);
    // A gravada antes da pergunta 60 lê sem a marca da retomada e sem o dia do faturamento.
    const { retomada_desde_a_rps: _semMarca, ...semMarca } = gravada;
    const { dia_do_faturamento: _semDia, ...omieSemDia } = gravada.omie;
    const anterior = emissaoLida(gravada.id, { ...semMarca, omie: omieSemDia } as unknown as Record<string, unknown>);
    assert.deepEqual([anterior.retomada_desde_a_rps, anterior.omie.dia_do_faturamento], [false, null]);
    const marcada = emissaoLida(gravada.id, { ...gravada, retomada_desde_a_rps: true, omie: { ...gravada.omie, dia_do_faturamento: "2026-10-20" } } as unknown as Record<string, unknown>);
    assert.deepEqual([marcada.retomada_desde_a_rps, marcada.omie.dia_do_faturamento], [true, "2026-10-20"]);
    assert.equal(emissaoLida(gravada.id, { ...gravada, omie: { ...gravada.omie, dia_do_faturamento: "20/10/2026" } } as unknown as Record<string, unknown>).omie.dia_do_faturamento, null);
    for (const quebra of [{ etapa: "inventada" }, { cnpj: "123" }, { itens: [] }, { forma: "cheque" }, { edicao: 0 }, { itens: [{ origem: "demanda", referencia: "1", descricao: "x", valor_cents: -1 }] }]) {
      assert.throws(() => emissaoLida(gravada.id, { ...gravada, ...quebra } as unknown as Record<string, unknown>), /ilegível/, JSON.stringify(quebra));
    }
    assert.throws(() => emissaoLida("nfe_curto", gravada as unknown as Record<string, unknown>), /ilegível/);
  });

  it("o id novo tem 20 dígitos hexadecimais e cabe no cCodIntOS da Omie (60)", () => {
    const id = novoIdDeEmissao();
    assert.match(id, /^nfe_[a-f0-9]{20}$/);
    assert.ok(id.length <= 60);
    assert.throws(() => novoIdDeEmissao(() => "x"));
  });
});

