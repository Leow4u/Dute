import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { HttpsError } from "firebase-functions/https";

import type { EtapaRegistrada } from "./execucao.js";
import type { ItemEmExecucao } from "./itens-executados.js";
import { saldoDoEscopo, type ItemDaOs, type OsGravada } from "./os.js";
import { diretaExecutada, exigirQuemReabre, interpretarRevisao, resumoDaOperacao, revisarOs, type DemandaParaRevisao } from "./revisao.js";

/**
 * A revisão interna (parte 3.10a): cada divergência leva uma decisão válida
 * para o sinal dela; o consumido é o que o saldo conta; o resumo da demanda
 * soma as OS revisadas; só a Operação escreve esse resumo.
 */

const AGORA = new Date("2026-10-22T21:10:00.000Z");
const QUEM = { uid: "u-paula", role: "interno" };

const OS = {
  numero: "10045-01",
  demanda: "10045",
  customer_code: "ITAU",
  status: "em_revisao",
  janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
  equipe: [{ colaborador_id: "col_aaaaaaaaaaaaaaaa" }, { colaborador_id: "col_bbbbbbbbbbbbbbbb" }],
  edicao: 12,
} as unknown as OsGravada;

function item(id: string, nome: string, planejado: string, executado: string | null, incluido?: string): ItemEmExecucao {
  return {
    id,
    lpu_item_id: `lpu_${id}`,
    codigo: null,
    item: nome,
    descricao: nome,
    servico: null,
    unidade: "UN",
    planejado,
    origem_local: null,
    destino_local: null,
    executado,
    executado_em: null,
    incluidos: incluido
      ? [{ quantidade: incluido, pedido_por: "Renata", motivo: "Sala 412", instante: "2026-10-22T12:32:00.000Z", canal: "celular", meio: null, informado_por: null, registrado_por: QUEM, registrado_em: "" }]
      : [],
    incluido_em_campo: false,
  };
}

const CADEIRA = item("ln_1", "Cadeira", "150", "160", "10");
const MESA = item("ln_2", "Mesa", "60", "58");
const ARMARIO = item("ln_3", "Armário", "12", "12");

const ETAPAS = [
  { etapa: "saida_patio", instante: "2026-10-22T10:05:00.000Z" },
  { etapa: "fim", instante: "2026-10-22T20:20:00.000Z" },
] as EtapaRegistrada[];

/** Escopo de 300 cadeiras, 120 mesas e 24 armários; esta OS leva 150, 60 e 12; outra OS leva 140 cadeiras. */
const COMERCIAL: DemandaParaRevisao = { direta: false, saldoLivre: new Map([["ln_1", 10_000], ["ln_2", 60_000], ["ln_3", 12_000]]) };

function revisar(linhas: unknown[], extra: { itens?: ItemEmExecucao[]; demanda?: DemandaParaRevisao; os?: OsGravada } = {}) {
  return revisarOs(
    extra.os ?? OS,
    { itens: extra.itens ?? [CADEIRA, MESA, ARMARIO], etapas: ETAPAS, conclusao: { instante: "2026-10-22T20:25:00.000Z" }, demanda: extra.demanda ?? COMERCIAL },
    interpretarRevisao({ idempotency_key: "k", numero: "10045-01", linhas }),
    { agora: AGORA, registrado_por: QUEM },
  );
}

function recusa(fn: () => unknown, codigo: string, mensagem: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, codigo);
    assert.equal(error.message, mensagem);
    return true;
  });
}

const DECIDIDAS = [
  { linha: "ln_1", decisao: "aditivo" },
  { linha: "ln_2", decisao: "proxima_os" },
];

describe("revisão: decisões", () => {
  it("o a mais vai para aditivo, o a menos volta ao saldo; o consumido e o a cobrar de cada linha", () => {
    const { revisao, itens } = revisar(DECIDIDAS);
    assert.deepEqual(
      revisao.linhas.map((linha) => [linha.linha, linha.sinal, linha.diferenca, linha.decisao, linha.consumido, linha.a_cobrar]),
      [
        ["ln_1", "a_mais", "10", "aditivo", "150", "150"],
        ["ln_2", "a_menos", "-2", "proxima_os", "58", "58"],
        ["ln_3", "igual", "0", null, "12", "12"],
      ],
    );
    assert.deepEqual(revisao.aditivo, [{ os: "10045-01", linha: "ln_1", lpu_item_id: "lpu_ln_1", item: "Cadeira", unidade: "UN", quantidade: "10" }]);
    assert.deepEqual(itens.map((linha) => linha.consumido), ["150", "58", "12"]);
    assert.deepEqual([revisao.minutos_planejados, revisao.minutos_reais, revisao.pessoas], [630, 620, 2]);
  });

  it("divergência sem decisão não conclui; linha sem divergência não leva decisão", () => {
    recusa(() => revisar([DECIDIDAS[0]]), "invalid-argument", "Mesa: decida a divergência (−2).");
    recusa(() => revisar([...DECIDIDAS, { linha: "ln_3", decisao: "encerrar" }]), "invalid-argument", "Armário não diverge: não leva decisão.");
    recusa(() => revisar([{ linha: "ln_1", decisao: "encerrar" }, DECIDIDAS[1]]), "invalid-argument", "Cadeira: o feito a mais se cobra na execução, vai para aditivo ou se absorve.");
    recusa(() => revisar([DECIDIDAS[0], { linha: "ln_2", decisao: "cobrar" }]), "invalid-argument", "Mesa: o feito a menos passa para a próxima OS ou se encerra.");
    recusa(() => revisar([...DECIDIDAS, { linha: "ln_9", decisao: "encerrar" }]), "invalid-argument", "O item não está na OS.");
  });

  it("cobrar só dentro do saldo livre do escopo; absorver pede o motivo", () => {
    // O saldo livre de cadeira é 10: cobra os 10 a mais e o saldo conta o executado.
    const cobrar = revisar([{ linha: "ln_1", decisao: "cobrar" }, DECIDIDAS[1]]);
    assert.deepEqual([cobrar.revisao.linhas[0].consumido, cobrar.revisao.linhas[0].a_cobrar], ["160", "160"]);
    const semSaldo: DemandaParaRevisao = { ...COMERCIAL, saldoLivre: new Map([...COMERCIAL.saldoLivre, ["ln_1", 4_000]]) };
    recusa(() => revisar([{ linha: "ln_1", decisao: "cobrar" }, DECIDIDAS[1]], { demanda: semSaldo }), "failed-precondition", "Cadeira: o saldo livre da demanda é 4; o que passa dele vai para aditivo.");
    recusa(() => revisar([{ linha: "ln_1", decisao: "absorver" }, DECIDIDAS[1]]), "invalid-argument", "Cadeira: informe por que absorver sem cobrar.");
    const absorvida = revisar([{ linha: "ln_1", decisao: "absorver", motivo: "Cortesia do contrato" }, DECIDIDAS[1]]);
    assert.deepEqual([absorvida.revisao.linhas[0].consumido, absorvida.revisao.linhas[0].a_cobrar, absorvida.revisao.aditivo], ["150", "150", []]);
  });

  it("na demanda direta não há aditivo: o a mais se cobra na execução", () => {
    const direta: DemandaParaRevisao = { direta: true, saldoLivre: COMERCIAL.saldoLivre };
    recusa(() => revisar(DECIDIDAS, { demanda: direta }), "invalid-argument", "Cadeira: a demanda direta orça a execução inteira; cobre na execução.");
    const cobrada = revisar([{ linha: "ln_1", decisao: "cobrar" }, { linha: "ln_2", decisao: "encerrar" }], { demanda: { direta: true, saldoLivre: new Map() } }).revisao.linhas;
    assert.deepEqual(cobrada.slice(0, 2).map((linha) => [linha.consumido, linha.a_cobrar]), [["160", "160"], ["60", "58"]]);
  });

  it("corrigir o executado (com motivo) antes de decidir; o que resta se decide", () => {
    const corrigida = revisar([{ linha: "ln_1", executado: "150", motivo_da_correcao: "Contagem em dobro" }, DECIDIDAS[1]]).revisao.linhas[0];
    assert.deepEqual([corrigida.executado, corrigida.corrigido, corrigida.sinal, corrigida.decisao], ["160", "150", "igual", null]);
    recusa(() => revisar([{ linha: "ln_1", executado: "150" }, DECIDIDAS[1]]), "invalid-argument", "Cadeira: informe o motivo da correção.");
    recusa(() => revisar([{ linha: "ln_1", executado: "160", motivo_da_correcao: "Ok" + "!" }, DECIDIDAS[1]]), "invalid-argument", "Cadeira: a quantidade corrigida é a mesma do campo.");
    recusa(() => revisar([{ linha: "ln_1", executado: "161", motivo_da_correcao: "Contei" }, DECIDIDAS[1]]), "invalid-argument", "Cadeira: a quantidade corrigida passa do previsto (160).");
    recusa(() => revisar([{ linha: "ln_1", executado: "155", motivo_da_correcao: "Contei" }, DECIDIDAS[1]]), "invalid-argument", "Cadeira: decida a divergência (+5).");
  });

  it("só a OS em revisão", () => {
    recusa(() => revisar(DECIDIDAS, { os: { ...OS, status: "em_execucao" } as OsGravada }), "failed-precondition", "Conclua a OS antes de revisar.");
    recusa(() => revisar(DECIDIDAS, { os: { ...OS, status: "revisada" } as OsGravada }), "failed-precondition", "A OS já foi revisada.");
  });
});

describe("saldo, resumo e reabertura", () => {
  it("o saldo conta o consumido da OS revisada (o a menos que volta para a próxima OS)", () => {
    const escopo = [{ id: "ln_2", planejado: "120" }] as ItemDaOs[];
    const saldo = saldoDoEscopo(escopo, [
      { numero: "10045-01", status: "revisada", itens: [{ id: "ln_2", planejado: "60", consumido: "58" }] },
      { numero: "10045-02", status: "agendada", itens: [{ id: "ln_2", planejado: "60" }] },
    ]);
    assert.equal(saldo.get("ln_2"), 2_000);
  });

  it("o resumo soma as OS revisadas, com o período e o aditivo pedido; a direta vai à execução a orçar", () => {
    const { revisao } = revisar(DECIDIDAS);
    const resumo = resumoDaOperacao(
      [
        { numero: "10045-01", status: "revisada", janela: OS.janela, data: { revisao } },
        { numero: "10045-02", status: "agendada", janela: { data: "2026-10-24", inicio: null, fim: null }, data: {} },
        { numero: "10045-03", status: "cancelada", janela: null, data: {} },
      ],
      AGORA,
    );
    assert.deepEqual(resumo.os_revisadas, ["10045-01"]);
    assert.deepEqual(resumo.os_em_aberto, ["10045-02"]);
    assert.deepEqual(resumo.periodo, { de: "2026-10-22", ate: "2026-10-22" });
    assert.deepEqual(resumo.itens[0], { linha: "ln_1", lpu_item_id: "lpu_ln_1", item: "Cadeira", unidade: "UN", executado: "160", a_cobrar: "150", absorvido: "0", aditivo: "10" });
    assert.deepEqual(resumo.aditivo, [{ ...revisao.aditivo[0], pedido_em: "2026-10-22T21:10:00.000Z" }]);

    const direta = { entrada: "direta", aberta_pela: "operacao", etapa: "para_planejar" };
    assert.equal(diretaExecutada(direta, resumo), false, "uma OS ainda em aberto");
    assert.equal(diretaExecutada(direta, { ...resumo, os_em_aberto: [] }), true);
    assert.equal(diretaExecutada({ ...direta, entrada: "comercial" }, { ...resumo, os_em_aberto: [] }), false);
  });

  it("só owner e admin reabrem", () => {
    recusa(() => exigirQuemReabre("interno"), "permission-denied", "Só owner e admin reabrem a OS revisada.");
    assert.doesNotThrow(() => exigirQuemReabre("admin"));
  });

  it("o resumo da Operação na demanda (`operacao`) é escrito só pela Operação", () => {
    const raiz = fileURLToPath(new URL("../../../comercial/src", import.meta.url));
    const arquivos = (pasta: string): string[] =>
      readdirSync(pasta).flatMap((nome) => {
        const caminho = join(pasta, nome);
        return statSync(caminho).isDirectory() ? arquivos(caminho) : /\.ts$/.test(nome) && !/\.test\.ts$/.test(nome) ? [caminho] : [];
      });
    const fontes = [join(raiz, "index.ts"), ...arquivos(join(raiz, "domain"))];
    const escritas = fontes.flatMap((arquivo) =>
      readFileSync(arquivo, "utf8")
        .split("\n")
        .filter((linha) => /\boperacao\s*:|["'`]operacao\./.test(linha))
        .map((linha) => `${arquivo}: ${linha.trim()}`),
    );
    assert.deepEqual(escritas, []);
  });
});
