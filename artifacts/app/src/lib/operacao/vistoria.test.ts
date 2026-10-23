import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { osDaLeitura, type OsDaFila } from "./fila";
import { demandaDoHoje, quadroDoHoje, SEM_FILTRO, type DemandaDoHoje } from "./hoje";
import { hrefDoPlanoDaVistoria, vistoriaNoPlanoDaBusca } from "./navegacao";
import { alertasDoPlano, pedidoDaVistoria, problemasDaVistoriaNoPlano, vistoriaInicial } from "./planejar";
import { ETAPAS_ANTES_DO_ESCOPO, problemaParaAbrirVistoria, vistoriaPedida } from "./vistoria";

/**
 * A vistoria pelo escritório (parte 3.11c): quando a demanda recebe vistoria
 * (as mesmas mensagens do servidor), a visita técnica que espera a Operação
 * no Hoje e o pedido de saveServiceOrder (survey) no formato do servidor.
 */

const here = dirname(fileURLToPath(import.meta.url));
const OS_DO_SERVIDOR = readFileSync(resolve(here, "../../../../../functions/operacao/src/domain/os.ts"), "utf8");
const ETAPAS_DO_COMERCIAL = readFileSync(resolve(here, "../../../../../functions/comercial/src/domain/demanda.ts"), "utf8");

const DEMANDA = demandaDoHoje("10045", {
  customer_code: "ITAU",
  entrada: "comercial",
  etapa: "em_montagem",
  titulo: "Mudança do 12º andar",
  execucao: { datas: [], de: null, ate: null, a_definir: true, visita_tecnica: "2026-10-28" },
  escopo_rv: null,
}) as DemandaDoHoje;

function os(numero: string, extra: Record<string, unknown> = {}): OsDaFila {
  return osDaLeitura(numero, { demanda: "10045", customer_code: "ITAU", status: "aberta", edicao: 1, itens: [], tipo: "vistoria", servicos: ["vistoria"], ...extra }) as OsDaFila;
}

describe("a demanda recebe vistoria", () => {
  it("lê a visita técnica e o escopo fechado; a OS lê o tipo", () => {
    expect([DEMANDA.visitaTecnica, DEMANDA.escopoRv]).toEqual(["2026-10-28", null]);
    expect(demandaDoHoje("10046", { customer_code: "ITAU", execucao: { visita_tecnica: "amanhã" }, escopo_rv: 0 })).toMatchObject({ visitaTecnica: null, escopoRv: 0 });
    expect([os("10045-01").tipo, osDaLeitura("10045-02", { demanda: "10045", customer_code: "ITAU", status: "aberta", edicao: 1 })?.tipo]).toEqual(["vistoria", "servico"]);
  });

  it("antes do escopo fechado, do Comercial, uma por vez; as mensagens são as do servidor", () => {
    expect(problemaParaAbrirVistoria(DEMANDA, [])).toBeNull();
    const casos = [
      problemaParaAbrirVistoria({ ...DEMANDA, entrada: "direta" }, []),
      problemaParaAbrirVistoria({ ...DEMANDA, fora: "cancelada" }, []),
      problemaParaAbrirVistoria({ ...DEMANDA, fora: "perdida" }, []),
      problemaParaAbrirVistoria({ ...DEMANDA, etapa: "para_planejar", escopoRv: 0 }, []),
      problemaParaAbrirVistoria({ ...DEMANDA, etapa: "execucao_a_orcar" }, []),
    ];
    expect(casos).toEqual([
      "A demanda direta não tem vistoria: a Operação executa e o Comercial orça depois.",
      "A demanda foi cancelada no Comercial.",
      "A demanda foi perdida no Comercial.",
      "A vistoria vem antes do escopo fechado: a demanda já foi fechada pelo cliente.",
      "A vistoria vem antes do escopo fechado: a demanda já foi fechada pelo cliente.",
    ]);
    for (const mensagem of new Set(casos)) expect(OS_DO_SERVIDOR).toContain(mensagem as string);
    expect(problemaParaAbrirVistoria(DEMANDA, [os("10045-01", { status: "agendada" })])).toBe("A demanda já tem a vistoria 10045-01 em aberto.");
    expect(OS_DO_SERVIDOR).toContain("A demanda já tem a vistoria ${emAberto.numero} em aberto.");
    expect(problemaParaAbrirVistoria(DEMANDA, [os("10045-01", { status: "revisada" }), os("10045-02", { status: "aberta", tipo: "servico" })])).toBeNull();
    // As etapas antes do fechamento existem no Comercial.
    for (const etapa of ETAPAS_ANTES_DO_ESCOPO) expect(ETAPAS_DO_COMERCIAL).toContain(`"${etapa}"`);
  });

  it("a visita técnica espera a Operação até a primeira vistoria (a cancelada não conta)", () => {
    expect(vistoriaPedida(DEMANDA, [])).toBe(true);
    expect(vistoriaPedida({ ...DEMANDA, visitaTecnica: null }, [])).toBe(false);
    expect(vistoriaPedida(DEMANDA, [os("10045-01", { status: "cancelada" })])).toBe(true);
    expect(vistoriaPedida(DEMANDA, [os("10045-01", { status: "revisada" })])).toBe(false);
    expect(vistoriaPedida(DEMANDA, [os("10099-01", { demanda: "10099" })])).toBe(true);
    expect(vistoriaPedida({ ...DEMANDA, etapa: "para_planejar", escopoRv: 0 }, [])).toBe(false);
  });

  it("no Hoje, a visita técnica pedida entra em Para planejar, com o dia", () => {
    const quadro = quadroDoHoje({
      hoje: "2026-10-27",
      agora: new Date("2026-10-27T12:00:00.000Z"),
      demandas: [DEMANDA],
      ordens: [],
      nomesClientes: { ITAU: "Itaú Unibanco" },
      nomesPessoas: {},
      placas: {},
      filtros: SEM_FILTRO,
      busca: "",
    });
    expect(quadro.paraPlanejar.map((cartao) => [cartao.demanda.numero, cartao.cliente, cartao.vistoria])).toEqual([["10045", "Itaú Unibanco", "2026-10-28"]]);
    const comVistoria = quadroDoHoje({ hoje: "2026-10-27", agora: new Date(), demandas: [DEMANDA], ordens: [os("10045-01")], nomesClientes: {}, nomesPessoas: {}, placas: {}, filtros: SEM_FILTRO, busca: "" });
    expect([comVistoria.paraPlanejar.length, comVistoria.paraAgendar.map((cartao) => cartao.os.numero)]).toEqual([0, ["10045-01"]]);
  });
});

describe("planejar a vistoria", () => {
  it("o link e a busca da tela", () => {
    expect(hrefDoPlanoDaVistoria("10045")).toBe("/operacao/planejar?demanda=10045&vistoria=1");
    expect([vistoriaNoPlanoDaBusca("?demanda=10045&vistoria=1"), vistoriaNoPlanoDaBusca("?demanda=10045")]).toEqual([true, false]);
  });

  it("uma OS, no dia pedido; só a janela impede; os alertas falam da vistoria", () => {
    const form = vistoriaInicial("2026-10-28");
    expect(form.ordens).toEqual([{ data: "2026-10-28", inicio: "09:00", fim: "", itens: {} }]);
    expect(problemasDaVistoriaNoPlano(form, "2026-10-27", true)).toEqual([]);
    expect(problemasDaVistoriaNoPlano({ ...form, ordens: [{ ...form.ordens[0], data: "" }] }, "2026-10-27", true)).toEqual(["A vistoria: informe a data."]);
    expect(problemasDaVistoriaNoPlano({ ...form, ordens: [{ ...form.ordens[0], data: "", inicio: "10:00", fim: "09:00" }] }, "2026-10-27", false)).toEqual(["A vistoria: o fim vem depois do início."]);
    expect(problemasDaVistoriaNoPlano({ ...form, ordens: [{ ...form.ordens[0], data: "2026-10-20" }] }, "2026-10-27", true)).toEqual(["A vistoria: a data já passou."]);
    expect(alertasDoPlano(form, [], [], [], "A vistoria")).toEqual(["A vistoria sem equipe", "A vistoria sem veículo"]);
  });

  it("o pedido é saveServiceOrder survey, com os campos que o servidor aceita", () => {
    const form = {
      ...vistoriaInicial("2026-10-28"),
      equipe: [{ colaboradorId: "col_aaaaaaaaaaaaaaaa", papel: "lider" as const, ordens: [0] }],
      veiculos: [{ veiculoId: "vei_aaaaaaaaaaaaaaaa", ordens: [0] }],
      instrucoes: "  Levantar o 12º andar inteiro. ",
      contatoOrigem: { nome: "Renata", telefone: "11 98888-7777" },
      contatoDestino: { nome: "Outro", telefone: "" },
    };
    const pedido = pedidoDaVistoria(form, "10045", "k-1", true);
    expect(pedido).toEqual({
      action: "survey",
      idempotency_key: "k-1",
      demanda: "10045",
      janela: { data: "2026-10-28", inicio: "09:00", fim: null },
      equipe: [{ colaborador_id: "col_aaaaaaaaaaaaaaaa", papel: "lider" }],
      veiculos: ["vei_aaaaaaaaaaaaaaaa"],
      instrucoes: "Levantar o 12º andar inteiro.",
      contatos: { origem: { nome: "Renata", telefone: "11 98888-7777" } },
    });
    expect(pedidoDaVistoria(form, "10045", "k-2", false)).not.toHaveProperty("janela");
    // O schema do servidor (AbrirVistoria, .strict()).
    const bloco = OS_DO_SERVIDOR.slice(OS_DO_SERVIDOR.indexOf("const AbrirVistoria = z"), OS_DO_SERVIDOR.indexOf(".strict();", OS_DO_SERVIDOR.indexOf("const AbrirVistoria = z")));
    const aceitos = Array.from(bloco.matchAll(/^ {4}(\w+)(?::|,$)/gm), ([, chave]) => chave);
    expect(aceitos).toEqual(["action", "idempotency_key", "demanda", "janela", "equipe", "veiculos", "instrucoes", "contatos"]);
    expect(Object.keys(pedido).every((chave) => aceitos.includes(chave))).toBe(true);
  });
});
