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
  emissaoLida,
  novoIdDeEmissao,
  omieLiberada,
  osDaEmissao,
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
const CONTEXTO = { agora: AGORA, ambiente: "H" as const, consultas: 0 };
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
    omie: { cliente: null, os: null, numero_os: null, ambiente: null, nfse: null, codigo_verificacao: null, url_nfse: null, url_pdf: null },
    tentativas: 0,
    proxima_em: "2026-10-24T11:00:00.000Z",
    faturada_em: null,
    edicao: 1,
    ...extra,
  };
}

const COM_CLIENTE = { cliente: 5001, os: null, numero_os: null, ambiente: null, nfse: null, codigo_verificacao: null, url_nfse: null, url_pdf: null };
const COM_OS = { ...COM_CLIENTE, os: 9001, numero_os: "000123", ambiente: "H" as const };

describe("liberação e ambiente", () => {
  it("só a homologação emite pela Omie até o lançamento, e cada projeto tem o ambiente dele", () => {
    assert.deepEqual([...OMIE_AMBIENTES_LIBERADOS], ["dute-homolog"]);
    assert.equal(omieLiberada("dute-homolog"), true);
    assert.equal(omieLiberada("dute-prod"), false);
    assert.equal(omieLiberada("dute-btg"), false);
    assert.deepEqual(AMBIENTE_DA_OMIE, { "dute-homolog": "H", "dute-prod": "P" });
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
    ];
    for (const [passo, servico, call] of casos) {
      const pedido = pedidoDoPasso(passo, comOs, "2026-10-24", SEM_CONFIGURACAO);
      assert.deepEqual([pedido.servico, pedido.call], [servico, call], passo);
    }
    assert.deepEqual(pedidoDoPasso("achar_cliente", comOs, "2026-10-24", SEM_CONFIGURACAO).param.clientesFiltro, { cnpj_cpf: "11.222.333/0001-81" });
    assert.deepEqual(pedidoDoPasso("faturar_os", comOs, "2026-10-24", SEM_CONFIGURACAO).param, { cCodIntOS: comOs.id, nCodOS: 9001 });
    assert.equal(pedidoDoPasso("cancelar_os", comOs, "2026-10-24", SEM_CONFIGURACAO).param.cCancelarNfse, "S");
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
    const naPrefeitura = emissao({ etapa: "na_prefeitura", omie: COM_OS, faturada_em: "2026-10-24T11:50:00.000Z" });
    const autorizada = comResposta(naPrefeitura, "acompanhar", { ListaRpsNfse: [{ cStatusRps: "004", nNfse: "00000815", cCodVerif: "AB12", cUrlNfse: "https://nfse.exemplo/815", cUrlPdfDest: "https://omie.exemplo/815.pdf" }] }, CONTEXTO);
    assert.equal(autorizada.efeito, "registrar_fatura");
    assert.deepEqual([autorizada.emissao.etapa, autorizada.emissao.omie.nfse, autorizada.emissao.omie.codigo_verificacao], ["autorizada", "00000815", "AB12"]);
    const rejeitada = comResposta(naPrefeitura, "acompanhar", { ListaRpsNfse: [{ cStatusRps: "003", mensagens: [{ cCodigo: "E160", cDescricao: "Inscrição municipal do tomador inválida.", cCorrecao: "Corrija o cadastro do cliente." }] }] }, CONTEXTO);
    assert.equal(rejeitada.efeito, "nenhum");
    assert.deepEqual([rejeitada.emissao.etapa, rejeitada.emissao.mensagem], ["rejeitada", "Inscrição municipal do tomador inválida."]);
    assert.equal(rejeitada.emissao.mensagens_da_prefeitura[0].correcao, "Corrija o cadastro do cliente.");
    const esperando = comResposta(naPrefeitura, "acompanhar", { ListaRpsNfse: [{ cStatusRps: "002" }] }, { ...CONTEXTO, consultas: 1 });
    assert.deepEqual([esperando.emissao.etapa, esperando.emissao.proxima_em], ["na_prefeitura", "2026-10-24T12:05:00.000Z"]);
  });

  it("a prefeitura que não responde em 72 horas para a emissão; a OS cancelada na Omie também", () => {
    const antiga = emissao({ etapa: "na_prefeitura", omie: COM_OS, faturada_em: "2026-10-21T11:00:00.000Z" });
    assert.equal(comResposta(antiga, "acompanhar", { ListaRpsNfse: [{ cStatusRps: "002" }] }, CONTEXTO).emissao.motivo_da_parada, "prefeitura_demorou");
    const cancelada = emissao({ etapa: "na_prefeitura", omie: COM_OS, faturada_em: "2026-10-24T11:50:00.000Z" });
    assert.equal(comResposta(cancelada, "acompanhar", { cCancelada: "S", ListaRpsNfse: [] }, CONTEXTO).emissao.motivo_da_parada, "cancelada_na_omie");
  });

  it("faturar e reenviar levam à prefeitura; cancelar desiste e libera as reservas", () => {
    const faturada = comResposta(emissao({ etapa: "os_incluida", omie: COM_OS }), "faturar_os", { cCodStatus: "0" }, CONTEXTO).emissao;
    assert.deepEqual([faturada.etapa, faturada.faturada_em], ["na_prefeitura", AGORA.toISOString()]);
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

