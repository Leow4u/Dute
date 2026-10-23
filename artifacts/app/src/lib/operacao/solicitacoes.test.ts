import { describe, expect, it } from "vitest";

import { pedidoDaDemanda } from "./demanda-direta";
import { SEM_FILTRO, quadroDoHoje, resumoDoHoje } from "./hoje";
import { pendenciasDaOperacao } from "./pendencias";
import {
  formularioDaSolicitacao,
  hrefDeAtender,
  pedidoEmTexto,
  problemaDoMotivo,
  rotaDaSolicitacao,
  solicitacaoDaBusca,
  solicitacaoDaOperacao,
  solicitacaoResolvida,
  solicitacoesRecebidas,
  tipoDaSolicitacao,
} from "./solicitacoes";

/**
 * As solicitações do portal na Operação (parte 4.4c): a recebida cai em Para
 * planejar do Hoje e no Início, o formulário da demanda direta vem
 * preenchido por ela e a demanda sai com o id dela; a atendida e a recusada
 * não se atendem mais. Dados sintéticos.
 */

const AGORA = new Date("2026-10-23T13:00:00.000Z");

function lida(id: string, extra: Record<string, unknown> = {}) {
  return solicitacaoDaOperacao(id, {
    status: "recebida",
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    tipo_servico: "transporte",
    data: "2026-10-24",
    horario: "08:00",
    desejada_em: "2026-10-24T11:00:00.000Z",
    recebida_em: "2026-10-23T12:30:00.000Z",
    origem: "Rua das Indústrias, 450 · Galpão 3",
    destino: "Av. Paulista, 1000",
    descricao: "Levar 12 paletes de mobiliário.",
    anexos: [{ arquivo: "an_0123456789abcdef.pdf", caminho: "portal/ITAU/solicitacoes/an_0123456789abcdef.pdf", nome: "NF 4498.pdf", tipo: "application/pdf", tamanho: 1 }],
    contato: { uid: "cli-1", nome: "Roberto Souza", email: "roberto@itau.example" },
    ...extra,
  })!;
}

describe("a solicitação na Operação", () => {
  it("lê o que o cliente pediu, com o tipo que a demanda terá", () => {
    const solicitacao = lida("sol_0000000000000001");
    expect(solicitacao).toMatchObject({ status: "recebida", cliente: "Itaú Unibanco", tipoServico: "transporte", contato: { nome: "Roberto Souza", email: "roberto@itau.example" } });
    expect(solicitacao.anexos).toEqual([{ caminho: "portal/ITAU/solicitacoes/an_0123456789abcdef.pdf", nome: "NF 4498.pdf", tipo: "application/pdf" }]);
    expect(tipoDaSolicitacao(solicitacao)).toBe("emergencial");
    expect(tipoDaSolicitacao(lida("sol_2", { desejada_em: "2026-10-23T20:00:00.000Z", data: "2026-10-23", horario: "17:00" }))).toBe("paraquedas");
    expect(pedidoEmTexto(solicitacao)).toBe("Transporte / frete · Sáb 24/10 08:00");
    expect(rotaDaSolicitacao(solicitacao)).toBe("Rua das Indústrias, 450 · Galpão 3 → Av. Paulista, 1000");
    expect(solicitacaoDaOperacao("x", { status: "recebida", customer_code: "ITAU", tipo_servico: "frete" })).toBeNull();
    expect(solicitacaoDaOperacao("x", { status: "pendente", customer_code: "ITAU", tipo_servico: "transporte" })).toBeNull();
  });

  it("o formulário da demanda direta vem preenchido: cliente, título, quem pediu, portal, quando chegou, executar até a data pedida e os endereços", () => {
    const form = formularioDaSolicitacao(lida("sol_0000000000000001"), AGORA);
    expect(form).toMatchObject({
      customerCode: "ITAU",
      titulo: "Transporte / frete",
      canal: "portal",
      pedidoPorNome: "Roberto Souza",
      recebidaData: "2026-10-23",
      recebidaHora: "09:30",
      executarData: "2026-10-24",
      executarHora: "08:00",
      origemComplemento: "Rua das Indústrias, 450 · Galpão 3",
      destinoComplemento: "Av. Paulista, 1000",
      linhas: [],
    });
    expect(formularioDaSolicitacao(lida("sol_2", { origem: "x".repeat(200) }), AGORA).origemComplemento).toHaveLength(120);
  });

  it("a demanda sai com o id da solicitação no lugar de recebida em, sempre pelo portal", () => {
    const form = { ...formularioDaSolicitacao(lida("sol_0000000000000001"), AGORA), canal: "telefone" as const, linhas: [{ chave: "c1", lpuItemId: null, item: "Paletes", unidade: "UN", quantidade: "12" }] };
    const pedido = pedidoDaDemanda(form, "k1", "sol_0000000000000001");
    expect(pedido).toMatchObject({ canal: "portal", solicitacao_id: "sol_0000000000000001", executar_ate: "2026-10-24T08:00-03:00" });
    expect(pedido).not.toHaveProperty("recebida_em");
    expect(pedidoDaDemanda(form, "k1")).toMatchObject({ canal: "telefone", recebida_em: "2026-10-23T09:30-03:00" });
    expect(pedidoDaDemanda(form, "k1")).not.toHaveProperty("solicitacao_id");
  });

  it("a atendida e a recusada não se atendem mais; o motivo da recusa tem de 5 a 300 caracteres", () => {
    expect(solicitacaoResolvida(lida("sol_1"))).toBeNull();
    expect(solicitacaoResolvida(lida("sol_1", { status: "aceita", demanda: "10050" }))).toBe("Já virou a demanda 10050");
    expect(solicitacaoResolvida(lida("sol_1", { status: "recusada" }))).toBe("Recusada");
    expect(problemaDoMotivo(" não ")).toBe("Diga ao cliente o motivo.");
    expect(problemaDoMotivo("Fora da área atendida")).toBeNull();
    expect(problemaDoMotivo("x".repeat(301))).toBe("Use até 300 caracteres.");
  });

  it("o link de atender e a busca da URL", () => {
    expect(hrefDeAtender("sol_0123456789abcdef")).toBe("/operacao/nova-demanda?solicitacao=sol_0123456789abcdef");
    expect(solicitacaoDaBusca("?solicitacao=sol_0123456789abcdef")).toBe("sol_0123456789abcdef");
    expect(solicitacaoDaBusca("?solicitacao=../x")).toBeNull();
    expect(solicitacaoDaBusca("")).toBeNull();
  });
});

describe("em Para planejar e no Início", () => {
  const SOLICITACOES = [
    lida("sol_0000000000000002", { desejada_em: "2026-10-30T10:00:00.000Z", data: "2026-10-30", horario: "07:00", customer_code: "SAFRA", customer_name: "Safra", descricao: "Mudança do 5º andar", tipo_servico: "mudanca" }),
    lida("sol_0000000000000001"),
    lida("sol_0000000000000003", { status: "aceita", demanda: "10050" }),
  ];
  const quadro = (extra: Partial<Parameters<typeof quadroDoHoje>[0]> = {}) =>
    quadroDoHoje({ hoje: "2026-10-23", agora: AGORA, demandas: [], ordens: [], solicitacoes: SOLICITACOES, nomesClientes: { ITAU: "Itaú" }, nomesPessoas: {}, placas: {}, filtros: SEM_FILTRO, busca: "", ...extra });

  it("só as recebidas, a de data pedida mais perto primeiro, com o nome do cadastro e o tipo", () => {
    expect(solicitacoesRecebidas(SOLICITACOES).map((item) => item.id)).toEqual(["sol_0000000000000001", "sol_0000000000000002"]);
    expect(quadro().solicitacoes.map((cartao) => [cartao.solicitacao.id, cartao.cliente, cartao.tipo])).toEqual([
      ["sol_0000000000000001", "Itaú", "emergencial"],
      ["sol_0000000000000002", "Safra", "planejada"],
    ]);
    expect(resumoDoHoje(AGORA, quadro())).toBe("Sexta, 23 de outubro · 0 OS · 2 solicitações do portal");
  });

  it("o tipo, o cliente e a busca filtram; a entrada e a pessoa as tiram (ainda não têm entrada nem equipe)", () => {
    expect(quadro({ filtros: { ...SEM_FILTRO, tipo: "planejada" } }).solicitacoes).toHaveLength(1);
    expect(quadro({ filtros: { ...SEM_FILTRO, cliente: "ITAU" } }).solicitacoes.map((cartao) => cartao.cliente)).toEqual(["Itaú"]);
    expect(quadro({ busca: "5º andar" }).solicitacoes.map((cartao) => cartao.cliente)).toEqual(["Safra"]);
    expect(quadro({ filtros: { ...SEM_FILTRO, entrada: "direta" } }).solicitacoes).toEqual([]);
    expect(quadro({ filtros: { ...SEM_FILTRO, pessoa: "col_1" } }).solicitacoes).toEqual([]);
  });

  it("no Início, um item: crítico quando a data pedida chega em até 24 horas; uma só leva direto a atender", () => {
    const entrada = { hoje: "2026-10-23", agora: AGORA, ordens: [], demandas: [], pessoas: [], veiculos: [], nomesClientes: { ITAU: "Itaú" } };
    const [item] = pendenciasDaOperacao({ ...entrada, solicitacoes: SOLICITACOES });
    expect(item).toMatchObject({ id: "solicitacoes-do-portal", tone: "critical", title: "2 solicitações do portal", detail: "Itaú · Transporte / frete · Sáb 24/10 08:00 e mais 1", href: "/operacao/hoje", actionLabel: "Atender" });
    const [uma] = pendenciasDaOperacao({ ...entrada, solicitacoes: [SOLICITACOES[0]] });
    expect(uma).toMatchObject({ tone: "attention", title: "1 solicitação do portal", href: "/operacao/nova-demanda?solicitacao=sol_0000000000000002" });
    expect(pendenciasDaOperacao({ ...entrada, solicitacoes: [SOLICITACOES[2]] })).toEqual([]);
  });
});
