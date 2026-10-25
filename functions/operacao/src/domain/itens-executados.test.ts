import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import type { ItemDoCatalogo } from "./demanda-direta.js";
import type { ContextoDoRegistro } from "./execucao.js";
import {
  MAX_INCLUSOES_POR_LINHA,
  interpretarItem,
  itensEmExecucao,
  previsto,
  registrarFeito,
  registrarInclusao,
  type ItemEmExecucao,
  type PedidoDeFeito,
  type PedidoDeInclusao,
} from "./itens-executados.js";
import type { OsGravada } from "./os.js";

/**
 * Os itens executados da OS (parte 3.7b): o feito vai até o previsto; passar
 * dele exige incluir, com quem pediu e o motivo, e a inclusão soma ao feito.
 */

const ANA = "col_aaaaaaaaaaaaaaaa";
const AGORA = new Date("2026-10-22T18:00:00.000Z");
const ESCRITORIO: ContextoDoRegistro = { agora: AGORA, canal: "escritorio", registrado_por: { uid: "u-paula", role: "interno" } };

const CADEIRA = {
  id: "ln_1",
  lpu_item_id: "lpu_cadeira",
  codigo: "3.05",
  item: "Cadeira Flexform",
  descricao: "Transporte de cadeira Flexform",
  servico: "Transporte",
  unidade: "UN",
  planejado: "150",
  origem_local: null,
  destino_local: null,
};
const MESA = { ...CADEIRA, id: "ln_2", lpu_item_id: "lpu_mesa", codigo: "2.02", item: "Mesa de trabalho", servico: "Montagem", planejado: "60" };

const ITENS: ItemEmExecucao[] = itensEmExecucao({ itens: [{ ...CADEIRA, executado: "96" }, MESA] });

const OS: OsGravada = {
  numero: "10045-01",
  demanda: "10045",
  seq: 1,
  customer_code: "ITAU",
  cliente_nome: "Itaú Unibanco",
  tipo: "servico",
  status: "em_execucao",
  escopo_rv: 0,
  itens: [],
  servicos: ["transporte", "montagem"],
  locais: { origem: null, destino: null },
  janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
  equipe: [{ colaborador_id: ANA, nome: "Ana Lima", papel: "lider", vinculo: "proprio", empresa: null, no_app: true, usuario_uid: "uid-ana" }],
  equipe_uids: [],
  veiculos: [],
  instrucoes: null,
  edicao: 5,
  cancelamento: null,
};

const CATALOGO: ItemDoCatalogo = { id: "lpu_giratoria", item: "Cadeira giratória", descricao: "Transporte de cadeira giratória", servico: "Transporte", unidade: "UN", ativo: true, orcavel: true };

function feito(linha: string, executado: string): PedidoDeFeito {
  return interpretarItem({ action: "executed", idempotency_key: "k", numero: "10045-01", linha, executado, instante: "2026-10-22T14:20-03:00", informado_por: ANA }) as PedidoDeFeito;
}

function inclusao(extra: Record<string, unknown>): PedidoDeInclusao {
  return interpretarItem({
    action: "added",
    idempotency_key: "k",
    numero: "10045-01",
    quantidade: "10",
    pedido_por: "Renata Campos · Facilities",
    motivo: "Cadeiras a mais no 4º andar, sala 412",
    instante: "2026-10-22T09:32-03:00",
    ...extra,
  }) as PedidoDeInclusao;
}

function recusa(fn: () => unknown, codigo: string, mensagem: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, codigo);
    assert.equal(error.message, mensagem);
    return true;
  });
}

describe("entrada", () => {
  it("o feito pede a linha e a quantidade com ponto; a inclusão, um entre linha, catálogo e avulso", () => {
    assert.equal(feito("ln_1", "12.5").executado, "12.5");
    recusa(() => feito("ln_1", "12,5"), "invalid-argument", "Quantidade inválida: use número com ponto e até 3 casas.");
    recusa(() => inclusao({ linha: "ln_1", lpu_item_id: "lpu_cadeira" }), "invalid-argument", "Informe a linha da OS, o item do catálogo ou o item avulso (um deles).");
    recusa(() => inclusao({}), "invalid-argument", "Informe a linha da OS, o item do catálogo ou o item avulso (um deles).");
    recusa(() => inclusao({ item: "Retirada de entulho" }), "invalid-argument", "Item avulso: informe a unidade.");
    recusa(() => inclusao({ linha: "ln_1", pedido_por: "" }), "invalid-argument", "Informe quem pediu no local.");
    recusa(() => inclusao({ linha: "ln_1", motivo: "x" }), "invalid-argument", "Informe o motivo.");
    recusa(() => interpretarItem({ action: "removed" }), "invalid-argument", "action: use executed, added.");
  });
});

describe("o feito", () => {
  it("vai até o previsto, para mais ou para menos, com o instante", () => {
    const resultado = registrarFeito(OS, ITENS, feito("ln_1", "128"), ESCRITORIO);
    assert.equal(resultado.item.executado, "128");
    assert.equal(resultado.item.executado_em, "2026-10-22T17:20:00.000Z");
    assert.equal(resultado.anterior, "96");
    assert.deepEqual(resultado.registro, { instante: "2026-10-22T17:20:00.000Z", canal: "escritorio", informado_por: ANA });
    assert.equal(registrarFeito(OS, resultado.itens, feito("ln_1", "120"), ESCRITORIO).item.executado, "120");
    assert.equal(registrarFeito(OS, ITENS, feito("ln_1", "150"), ESCRITORIO).item.executado, "150");
  });

  it("acima do previsto sem inclusão é recusado", () => {
    recusa(
      () => registrarFeito(OS, ITENS, feito("ln_1", "151"), ESCRITORIO),
      "failed-precondition",
      "Cadeira Flexform: o feito (151) passa do previsto (150). Inclua o que foi além do planejado.",
    );
    recusa(() => registrarFeito(OS, ITENS, feito("ln_9", "1"), ESCRITORIO), "invalid-argument", "O item não está na OS.");
  });

  it("o que chega com a hora de antes do último registrado é recusado; a mesma hora corrige", () => {
    // O celular sem sinal guardou o feito das 14:20; o escritório registrou outro às 14:30.
    const comFeitoMaisNovo = itensEmExecucao({ itens: [{ ...CADEIRA, executado: "120", executado_em: "2026-10-22T17:30:00.000Z" }, MESA] });
    recusa(
      () => registrarFeito(OS, comFeitoMaisNovo, feito("ln_1", "96"), ESCRITORIO),
      "failed-precondition",
      "Cadeira Flexform: o feito das 14:20 é de antes do último registrado (120, às 14:30).",
    );
    const mesmaHora = itensEmExecucao({ itens: [{ ...CADEIRA, executado: "120", executado_em: "2026-10-22T17:20:00.000Z" }, MESA] });
    assert.equal(registrarFeito(OS, mesmaHora, feito("ln_1", "96"), ESCRITORIO).item.executado, "96");
  });

  it("só com a OS em execução", () => {
    recusa(() => registrarFeito({ ...OS, status: "agendada" }, ITENS, feito("ln_1", "1"), ESCRITORIO), "failed-precondition", "Registre a primeira etapa antes dos itens.");
    recusa(() => registrarFeito({ ...OS, status: "em_revisao" }, ITENS, feito("ln_1", "1"), ESCRITORIO), "failed-precondition", "A OS já foi concluída.");
  });
});

describe("a inclusão em campo", () => {
  it("na linha da OS soma ao previsto e ao feito, com quem pediu e o motivo", () => {
    const resultado = registrarInclusao(OS, ITENS, inclusao({ linha: "ln_1", informado_por: ANA }), ESCRITORIO, { catalogo: null, idDaLinhaNova: "cp_x" });
    assert.equal(resultado.nova, false);
    assert.equal(resultado.item.executado, "106");
    assert.equal(previsto(resultado.item), 160_000);
    assert.deepEqual(resultado.inclusao, {
      quantidade: "10",
      pedido_por: "Renata Campos · Facilities",
      motivo: "Cadeiras a mais no 4º andar, sala 412",
      instante: "2026-10-22T12:32:00.000Z",
      canal: "escritorio",
      meio: null,
      informado_por: ANA,
      registrado_por: { uid: "u-paula", role: "interno" },
      registrado_em: "2026-10-22T18:00:00.000Z",
    });
    // Agora o feito vai até 160.
    assert.equal(registrarFeito(OS, resultado.itens, feito("ln_1", "160"), ESCRITORIO).item.executado, "160");
  });

  it("do catálogo, entra na linha do mesmo item ou numa linha nova com o planejado zero", () => {
    const mesmo = registrarInclusao(OS, ITENS, inclusao({ lpu_item_id: "lpu_cadeira" }), ESCRITORIO, {
      catalogo: { ...CATALOGO, id: "lpu_cadeira", item: "Cadeira Flexform" },
      idDaLinhaNova: "cp_x",
    });
    assert.equal(mesmo.item.id, "ln_1");
    const nova = registrarInclusao(OS, ITENS, inclusao({ lpu_item_id: "lpu_giratoria", quantidade: "4" }), ESCRITORIO, { catalogo: CATALOGO, idDaLinhaNova: "cp_1234" });
    assert.equal(nova.nova, true);
    assert.deepEqual(
      { id: nova.item.id, item: nova.item.item, unidade: nova.item.unidade, servico: nova.item.servico, planejado: nova.item.planejado, executado: nova.item.executado, campo: nova.item.incluido_em_campo },
      { id: "cp_1234", item: "Cadeira giratória", unidade: "UN", servico: "Transporte", planejado: "0", executado: "4", campo: true },
    );
    assert.equal(nova.itens.length, 3);
    recusa(
      () => registrarInclusao(OS, ITENS, inclusao({ lpu_item_id: "lpu_giratoria" }), ESCRITORIO, { catalogo: { ...CATALOGO, ativo: false }, idDaLinhaNova: "cp_x" }),
      "failed-precondition",
      "O item Cadeira giratória está inativo no catálogo.",
    );
    recusa(
      () => registrarInclusao(OS, ITENS, inclusao({ lpu_item_id: "lpu_sumiu" }), ESCRITORIO, { catalogo: null, idDaLinhaNova: "cp_x" }),
      "failed-precondition",
      "O item lpu_sumiu não está no catálogo.",
    );
  });

  it("a que chega atrasada soma ao feito sem voltar a hora do último registrado", () => {
    const comFeitoMaisNovo = itensEmExecucao({ itens: [{ ...CADEIRA, executado: "120", executado_em: "2026-10-22T17:30:00.000Z" }, MESA] });
    const resultado = registrarInclusao(OS, comFeitoMaisNovo, inclusao({ linha: "ln_1" }), ESCRITORIO, { catalogo: null, idDaLinhaNova: "cp_x" });
    assert.deepEqual([resultado.item.executado, resultado.item.executado_em], ["130", "2026-10-22T17:30:00.000Z"]);
    // O feito das 14:20 continua de antes do último registrado.
    recusa(
      () => registrarFeito(OS, resultado.itens, feito("ln_1", "96"), ESCRITORIO),
      "failed-precondition",
      "Cadeira Flexform: o feito das 14:20 é de antes do último registrado (130, às 14:30).",
    );
  });

  it("avulsa vira linha nova com o nome e a unidade; quantidade zero e excesso de inclusões são recusados", () => {
    const avulsa = registrarInclusao(OS, ITENS, inclusao({ item: "Retirada de entulho", unidade: "VB", quantidade: "1" }), ESCRITORIO, { catalogo: null, idDaLinhaNova: "cp_y" });
    assert.deepEqual([avulsa.item.item, avulsa.item.unidade, avulsa.item.lpu_item_id], ["Retirada de entulho", "VB", null]);
    recusa(() => registrarInclusao(OS, ITENS, inclusao({ linha: "ln_1", quantidade: "0" }), ESCRITORIO, { catalogo: null, idDaLinhaNova: "cp_x" }), "invalid-argument", "A quantidade incluída é maior que zero.");
    const cheia = [{ ...ITENS[0], incluidos: Array.from({ length: MAX_INCLUSOES_POR_LINHA }, () => ITENS[0].incluidos[0]) }, ITENS[1]] as ItemEmExecucao[];
    recusa(() => registrarInclusao(OS, cheia, inclusao({ linha: "ln_1" }), ESCRITORIO, { catalogo: null, idDaLinhaNova: "cp_x" }), "failed-precondition", "Cadeira Flexform: a linha já tem 20 inclusões.");
  });
});

describe("leitura", () => {
  it("lê o feito, as inclusões e a linha de campo; o de antes da execução vem vazio", () => {
    const lidos = itensEmExecucao({
      itens: [
        {
          ...CADEIRA,
          executado: "106",
          executado_em: "2026-10-22T12:32:00.000Z",
          incluidos: [{ quantidade: "10", pedido_por: "Renata", motivo: "a mais", instante: "2026-10-22T12:32:00.000Z", canal: "celular" }, { quantidade: "x" }],
        },
        { ...MESA, executado: "abc" },
        { ...MESA, id: "cp_1", planejado: "0", incluido_em_campo: true },
      ],
    });
    assert.deepEqual(lidos.map((item) => [item.id, item.executado, item.incluidos.length, item.incluido_em_campo]), [
      ["ln_1", "106", 1, false],
      ["ln_2", null, 0, false],
      ["cp_1", null, 0, true],
    ]);
  });
});
