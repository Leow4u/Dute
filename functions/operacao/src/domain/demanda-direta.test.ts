import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { HttpsError } from "firebase-functions/https";

import {
  CANAIS_DA_DIRETA,
  DEMAND_COUNTERS_COLLECTION,
  DEMAND_COUNTER_ID,
  DEMAND_SCHEMA_VERSION,
  PRIMEIRO_NUMERO,
  TIPOS_DEMANDA,
  ULTIMO_NUMERO,
  documentoDaDemandaDireta,
  idDaLinha,
  interpretarDemandaDireta,
  itensDoPedido,
  problemaDosInstantes,
  proximoNumeroDaDemanda,
  tipoPelaHora,
  type ItemDoCatalogo,
} from "./demanda-direta.js";
import { itensSemPreco, problemaParaAbrirOs } from "./os.js";

/**
 * A demanda direta (docs/plataforma/fase-3-operacao.md, parte 3.4d): nasce no
 * `demands` do Comercial, com o número do mesmo contador, sem orçamento, em
 * Para planejar. As constantes e os campos são os do Comercial.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const DEMANDA_DO_COMERCIAL = read("../../../comercial/src/domain/demanda.ts");
const EVENTOS_DO_COMERCIAL = read("../../../comercial/src/domain/events.ts");
const ORCAMENTOS_DO_COMERCIAL = read("../../../comercial/src/domain/quotes.ts");

function constante(fonte: string, nome: string): string {
  const match = fonte.match(new RegExp(`export const ${nome} = ([^;]+);`));
  assert.ok(match, nome);
  return match[1].trim();
}

function lista(fonte: string, nome: string): string[] {
  return [...constante(fonte, nome).matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function rejeita(fn: () => unknown): HttpsError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    return error;
  }
  assert.fail("deveria recusar");
}

const PEDIDO = {
  idempotency_key: "k1",
  customer_code: "ITAU",
  titulo: "  Troca de cadeiras do 5º andar ",
  canal: "telefone",
  pedido_por: { nome: "Renata  Campos", telefone: "(11) 98765-4321" },
  recebida_em: "2026-10-20T13:05-03:00",
  executar_ate: "2026-10-20T19:00-03:00",
  origem: { local_id: "loc_faria", complemento: "5º andar" },
  itens: [
    { lpu_item_id: "lpu_cadeira", quantidade: "40" },
    { item: "Retirada de entulho", unidade: "VB", quantidade: "1" },
  ],
};

const CATALOGO = new Map<string, ItemDoCatalogo>([
  ["lpu_cadeira", { id: "lpu_cadeira", item: "Cadeira Flexform", descricao: "Transporte de cadeira Flexform", servico: "Transporte", unidade: "UN", ativo: true, orcavel: true }],
  ["lpu_velho", { id: "lpu_velho", item: "Arquivo deslizante", descricao: "", servico: "Montagem", unidade: "UN", ativo: false, orcavel: true }],
  ["lpu_guarda", { id: "lpu_guarda", item: "Guarda de mobiliário", descricao: "", servico: "Armazenagem", unidade: "M3", ativo: true, orcavel: false }],
]);

describe("iguais ao Comercial", () => {
  it("o contador, a faixa, a versão do esquema, os tipos e os canais são os de functions/comercial", () => {
    assert.equal(constante(DEMANDA_DO_COMERCIAL, "DEMAND_COUNTERS_COLLECTION"), `"${DEMAND_COUNTERS_COLLECTION}"`);
    assert.equal(constante(DEMANDA_DO_COMERCIAL, "DEMAND_COUNTER_ID"), `"${DEMAND_COUNTER_ID}"`);
    assert.equal(Number(constante(DEMANDA_DO_COMERCIAL, "DEMAND_SCHEMA_VERSION")), DEMAND_SCHEMA_VERSION);
    assert.equal(Number(constante(DEMANDA_DO_COMERCIAL, "PRIMEIRO_NUMERO")), PRIMEIRO_NUMERO);
    assert.equal(Number(constante(DEMANDA_DO_COMERCIAL, "ULTIMO_NUMERO").replace(/_/g, "")), ULTIMO_NUMERO);
    assert.deepEqual(lista(EVENTOS_DO_COMERCIAL, "TIPOS_DEMANDA"), [...TIPOS_DEMANDA]);
    assert.ok(lista(EVENTOS_DO_COMERCIAL, "ENTRADAS_DEMANDA").includes("direta"));
    const canais = lista(EVENTOS_DO_COMERCIAL, "CANAIS_DEMANDA");
    for (const canal of CANAIS_DA_DIRETA) assert.ok(canais.includes(canal), canal);
  });

  it("a demanda direta tem todos os campos que o Comercial grava numa demanda nova", () => {
    const corpo = ORCAMENTOS_DO_COMERCIAL.slice(ORCAMENTOS_DO_COMERCIAL.indexOf("function demandaNova("));
    const retorno = corpo.slice(corpo.indexOf("return {"), corpo.indexOf("\n  };\n"));
    const campos = [...retorno.matchAll(/^ {4}(\w+):/gm)].map((match) => match[1]);
    assert.ok(campos.length > 30, `poucos campos lidos: ${campos.join(", ")}`);
    const documento = documentoDaDemandaDireta({
      numero: "10053",
      customer_code: "ITAU",
      customer_name: "Itaú Unibanco",
      pedido: interpretarDemandaDireta(PEDIDO),
      tipo: "paraquedas",
      tipo_calculado: "paraquedas",
      itens: [],
      iso: "2026-10-20T16:06:00.000Z",
      uid: "u1",
    });
    const gravadosNaTransacao = ["created_at", "created_by", "updated_at", "updated_by"];
    const faltam = campos.filter((campo) => !(campo in documento) && !gravadosNaTransacao.includes(campo));
    assert.deepEqual(faltam, []);
  });

  it("o próximo número segue a regra do Comercial", () => {
    assert.equal(proximoNumeroDaDemanda(undefined), "10001");
    assert.equal(proximoNumeroDaDemanda(48), "10001");
    assert.equal(proximoNumeroDaDemanda(10044), "10045");
    assert.match(rejeita(() => proximoNumeroDaDemanda("10044")).message, /valor inválido/);
    assert.match(rejeita(() => proximoNumeroDaDemanda(ULTIMO_NUMERO)).message, /fim da faixa/);
  });
});

describe("tipo pela hora", () => {
  it("paraquedas no mesmo dia em São Paulo, emergencial até 48 horas corridas, planejada depois", () => {
    assert.equal(tipoPelaHora("2026-10-20T16:05:00.000Z", "2026-10-20T22:00:00.000Z"), "paraquedas");
    // 23:30 de 20/10 em São Paulo para 01:00 de 21/10: outro dia, dentro de 48 horas.
    assert.equal(tipoPelaHora("2026-10-21T02:30:00.000Z", "2026-10-21T04:00:00.000Z"), "emergencial");
    assert.equal(tipoPelaHora("2026-10-20T16:00:00.000Z", "2026-10-22T16:00:00.000Z"), "emergencial");
    assert.equal(tipoPelaHora("2026-10-20T16:00:00.000Z", "2026-10-22T16:01:00.000Z"), "planejada");
  });
});

describe("pedido da demanda direta", () => {
  it("lê o pedido, limpa os textos e grava os instantes em UTC", () => {
    const pedido = interpretarDemandaDireta(PEDIDO);
    assert.equal(pedido.titulo, "Troca de cadeiras do 5º andar");
    assert.deepEqual(pedido.pedido_por, { nome: "Renata Campos", telefone: "11987654321" });
    assert.equal(pedido.recebida_em, "2026-10-20T16:05:00.000Z");
    assert.deepEqual(pedido.origem, { local_id: "loc_faria", complemento: "5º andar" });
  });

  it("recusa avulso sem unidade, quantidade zero, instante sem fuso, canal fora da lista e campo de preço", () => {
    const com = (extra: Record<string, unknown>) => () => interpretarDemandaDireta({ ...PEDIDO, ...extra });
    assert.match(rejeita(com({ itens: [{ item: "Entulho", quantidade: "1" }] })).message, /nome e a unidade/);
    assert.match(rejeita(com({ itens: [{ lpu_item_id: "lpu_cadeira", quantidade: "0" }] })).message, /maior que zero/);
    assert.match(rejeita(com({ recebida_em: "2026-10-20T13:05" })).message, /com o fuso/);
    assert.match(rejeita(com({ canal: "wms" })).message, /use telefone, whatsapp, email, portal/);
    assert.match(rejeita(com({ preco: "10.00" })).message, /Campo não aceito: preco/);
    assert.match(rejeita(com({ itens: [{ lpu_item_id: "lpu_cadeira", quantidade: "1", preco: "1" }] })).message, /Campo não aceito/);
    assert.match(rejeita(com({ itens: [] })).message, /ao menos um item/);
  });

  it("recebida no futuro e executar antes de receber são recusados", () => {
    const agora = new Date("2026-10-20T16:06:00.000Z");
    assert.equal(problemaDosInstantes("2026-10-20T16:05:00.000Z", "2026-10-20T22:00:00.000Z", agora), null);
    assert.equal(problemaDosInstantes("2026-10-20T16:10:00.000Z", "2026-10-20T22:00:00.000Z", agora), null, "dentro da folga do relógio");
    assert.match(problemaDosInstantes("2026-10-20T17:00:00.000Z", "2026-10-20T22:00:00.000Z", agora) ?? "", /depois de agora/);
    assert.match(problemaDosInstantes("2026-10-20T16:05:00.000Z", "2026-10-20T16:05:00.000Z", agora) ?? "", /depois de quando/);
  });
});

describe("itens pedidos", () => {
  it("o item do catálogo leva nome, serviço e unidade dele; o avulso, o que foi digitado; nunca preço", () => {
    const itens = itensDoPedido(interpretarDemandaDireta(PEDIDO).itens, CATALOGO, "op_1", { origem: "loc_faria", destino: null });
    assert.deepEqual(itens, [
      {
        id: idDaLinha("op_1", 0),
        lpu_item_id: "lpu_cadeira",
        codigo: null,
        item: "Cadeira Flexform",
        descricao: "Transporte de cadeira Flexform",
        servico: "Transporte",
        unidade: "UN",
        quantidade: "40",
        origem_local: "loc_faria",
        destino_local: null,
      },
      {
        id: idDaLinha("op_1", 1),
        lpu_item_id: null,
        codigo: null,
        item: "Retirada de entulho",
        descricao: "Retirada de entulho",
        servico: null,
        unidade: "VB",
        quantidade: "1",
        origem_local: "loc_faria",
        destino_local: null,
      },
    ]);
    assert.match(idDaLinha("op_1", 0), /^ln_[a-f0-9]{16}$/);
    assert.notEqual(idDaLinha("op_1", 0), idDaLinha("op_1", 1));
    // São o escopo das OS: itensSemPreco lê do mesmo jeito que a revisão fechada.
    assert.deepEqual(itensSemPreco(itens).map((item) => [item.id, item.planejado]), itens.map((item) => [item.id, item.quantidade]));
  });

  it("item fora do catálogo, inativo ou de armazenagem é recusado", () => {
    const item = (id: string) => () => itensDoPedido([{ lpu_item_id: id, item: null, unidade: null, quantidade: "1" }], CATALOGO, "op", { origem: null, destino: null });
    assert.match(rejeita(item("lpu_sumiu")).message, /não está no catálogo/);
    assert.match(rejeita(item("lpu_velho")).message, /inativo/);
    assert.match(rejeita(item("lpu_guarda")).message, /armazenagem/);
  });
});

describe("documento da demanda direta", () => {
  const base = {
    numero: "10053",
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    pedido: interpretarDemandaDireta(PEDIDO),
    itens: [],
    iso: "2026-10-20T16:06:00.000Z",
    uid: "u1",
  };

  it("nasce direta, em Para planejar, sem orçamento e sem escopo fechado", () => {
    const documento = documentoDaDemandaDireta({ ...base, tipo: "paraquedas", tipo_calculado: "paraquedas" });
    assert.equal(documento.entrada, "direta");
    assert.equal(documento.etapa, "para_planejar");
    assert.equal(documento.escopo_rv, null);
    assert.equal(documento.tipo_corrigido_por, null);
    assert.equal(documento.solicitante, null, "o contato do cadastro é do Comercial");
    assert.deepEqual(documento.marcos, [{ etapa: "para_planejar", em: "2026-10-20T16:06:00.000Z", por_uid: "u1" }]);
    assert.equal(JSON.stringify(documento).includes("preco"), false);
    // A OS da direta nasce dela, sem orçamento.
    assert.equal(problemaParaAbrirOs(documento, null), null);
  });

  it("o tipo corrigido pelo coordenador fica registrado com quem corrigiu", () => {
    const documento = documentoDaDemandaDireta({ ...base, tipo: "emergencial", tipo_calculado: "paraquedas" });
    assert.equal(documento.tipo, "emergencial");
    assert.equal(documento.tipo_calculado, "paraquedas");
    assert.equal(documento.tipo_corrigido_por, "u1");
  });

  it("executada, perdida, cancelada ou já com orçamento, a direta não recebe OS nova", () => {
    const documento = documentoDaDemandaDireta({ ...base, tipo: "paraquedas", tipo_calculado: "paraquedas" });
    assert.match(problemaParaAbrirOs({ ...documento, executado_de: "2026-10-20" }, null) ?? "", /Para planejar/);
    assert.match(problemaParaAbrirOs({ ...documento, perda: { motivo: "cancelado_cliente" } }, null) ?? "", /Para planejar/);
    assert.match(problemaParaAbrirOs({ ...documento, cancelamento: { motivo: "cliente" } }, null) ?? "", /Para planejar/);
    assert.match(problemaParaAbrirOs(documento, { status: "rascunho", rv: 0, customer_code: "ITAU" }) ?? "", /Para planejar/);
  });
});
