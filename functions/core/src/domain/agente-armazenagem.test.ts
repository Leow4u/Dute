import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FERRAMENTAS_DA_ARMAZENAGEM } from "./agente-armazenagem.js";
import { bancoFalso } from "./agente-banco-falso.test.js";
import { DADOS_DA_ARMAZENAGEM as DADOS } from "./agente-dados.test.js";
import { modulosDoEscopo, type EscopoDoAgente } from "./agente-escopo.js";
import { executarFerramenta, ferramentasDoEscopo, type FerramentaDoAgente } from "./agente-ferramentas.js";
import { leitorDoAgente } from "./agente-leitor.js";
import type { PlatformRole } from "./platform-roles.js";

/**
 * As ferramentas da Armazenagem do Agent Dute do núcleo (parte 5.5c), num
 * banco em memória que recusa qualquer gravação, com dois clientes. Nenhuma
 * grava, nenhuma devolve dado do outro cliente, nenhuma tem parâmetro de
 * cliente, e cada papel recebe as do critério das telas. Dados sintéticos;
 * o "SAFRA" marca tudo que é do outro cliente.
 */

const AGORA = new Date("2026-10-23T15:00:00.000Z");

function escopo(role: PlatformRole, customerCode = "ITAU", contratados: Array<"wms" | "operacao" | "financeiro"> = ["wms", "operacao", "financeiro"]): EscopoDoAgente {
  return {
    uid: `${role}-1`,
    role,
    nome: null,
    audiencia: role === "cliente" ? "cliente" : "equipe",
    customerCode,
    modulo: "wms",
    modulos: modulosDoEscopo(role, contratados),
    leValor: false,
    modeloDeOperacao: "uniformes",
  };
}

const ENTRADAS: Record<string, unknown> = {
  buscar_itens: { texto: "polo" },
  ver_pedido: { referencia: "PED-0043" },
  movimentacoes: { de: "2026-10-01", ate: "2026-10-23" },
  documentos: {},
  enderecos: { texto: "polo" },
};

async function rodar(nome: string, alvo: EscopoDoAgente, entrada: unknown = ENTRADAS[nome] ?? {}) {
  const { db } = bancoFalso(DADOS);
  const item = FERRAMENTAS_DA_ARMAZENAGEM.find((ferramenta) => ferramenta.nome === nome);
  assert.ok(item, nome);
  return executarFerramenta(item, { leitor: leitorDoAgente(db, alvo), escopo: alvo, agora: AGORA }, entrada) as Promise<Record<string, any>>;
}

const nomes = (lista: readonly FerramentaDoAgente[]) => lista.map((item) => item.nome);

describe("as ferramentas da Armazenagem só leem e só do cliente da conversa", () => {
  it("nenhuma grava e nenhuma devolve dado do outro cliente", async () => {
    for (const item of FERRAMENTAS_DA_ARMAZENAGEM) {
      // O banco recusa qualquer gravação: se uma ferramenta gravar, a chamada quebra.
      const resposta = JSON.stringify(await rodar(item.nome, escopo("owner")));
      assert.doesNotMatch(resposta, /SAFRA/, item.nome);
    }
  });

  it("nenhuma tem parâmetro de cliente", () => {
    for (const item of FERRAMENTAS_DA_ARMAZENAGEM) {
      for (const chave of Object.keys(item.entrada.shape)) assert.doesNotMatch(chave, /client|customer|cliente/i, `${item.nome}.${chave}`);
    }
  });

  it("os nomes são únicos e todas são da Armazenagem", () => {
    const lista = nomes(FERRAMENTAS_DA_ARMAZENAGEM);
    assert.equal(new Set(lista).size, lista.length);
    assert.ok(FERRAMENTAS_DA_ARMAZENAGEM.every((item) => item.modulo === "wms"));
  });
});

describe("quem recebe cada uma", () => {
  it("o cliente, as do portal; o WMS, mais o chão; a coordenação, a operação inteira", () => {
    assert.deepEqual(nomes(ferramentasDoEscopo(escopo("cliente"), FERRAMENTAS_DA_ARMAZENAGEM)), ["resumo_estoque", "buscar_itens", "listar_pedidos", "ver_pedido", "movimentacoes", "documentos"]);
    assert.deepEqual(nomes(ferramentasDoEscopo(escopo("wms"), FERRAMENTAS_DA_ARMAZENAGEM)), [
      "resumo_estoque",
      "buscar_itens",
      "listar_pedidos",
      "ver_pedido",
      "movimentacoes",
      "documentos",
      "itens_parados",
      "recebimentos",
      "tarefas_armazem",
      "enderecos",
    ]);
    for (const role of ["owner", "admin", "interno", "suporte"] as const) {
      assert.deepEqual(nomes(ferramentasDoEscopo(escopo(role), FERRAMENTAS_DA_ARMAZENAGEM)), nomes(FERRAMENTAS_DA_ARMAZENAGEM), role);
    }
  });

  it("sem a Armazenagem no papel ou no contrato, nenhuma", () => {
    for (const role of ["comercial", "financeiro"] as const) assert.deepEqual(ferramentasDoEscopo(escopo(role), FERRAMENTAS_DA_ARMAZENAGEM), [], role);
    assert.deepEqual(ferramentasDoEscopo(escopo("cliente", "ITAU", ["operacao"]), FERRAMENTAS_DA_ARMAZENAGEM), []);
    assert.deepEqual(ferramentasDoEscopo(escopo("interno", "ITAU", ["operacao"]), FERRAMENTAS_DA_ARMAZENAGEM), []);
  });
});

describe("o que cada uma responde", () => {
  it("o estoque: os totais sem o arquivado e o item abaixo do mínimo; a busca soma por produto", async () => {
    const resumo = await rodar("resumo_estoque", escopo("cliente"));
    assert.deepEqual([resumo.itens, resumo.pecas_em_estoque, resumo.pecas_disponiveis, resumo.abaixo_do_minimo], [2, 30, 25, 1]);
    const busca = await rodar("buscar_itens", escopo("cliente"));
    assert.deepEqual([busca.encontrados, busca.total.pecas_disponiveis, busca.itens[0].codigo], [1, 25, "POLO-M"]);
  });

  it("os pedidos: a etapa, o recusado com o motivo, o detalhe com os itens; o do outro cliente não aparece", async () => {
    const lista = await rodar("listar_pedidos", escopo("cliente"), { situacao: "recusados" });
    assert.deepEqual(lista.pedidos.map((pedido: Record<string, unknown>) => [pedido.numero, pedido.etapa, pedido.motivo_recusa]), [["PED-0044", "Recusado", "Sem saldo"]]);
    const detalhe = await rodar("ver_pedido", escopo("cliente"));
    assert.deepEqual([detalhe.encontrado, detalhe.pedido.etapa, detalhe.itens], [true, "Saiu", [{ codigo: "POLO-M", nome: "Camisa polo", quantidade: 3 }]]);
    assert.deepEqual(await rodar("ver_pedido", escopo("cliente"), { referencia: "r9" }), { encontrado: false });
    assert.deepEqual(await rodar("ver_pedido", escopo("cliente"), { referencia: "PED-9999" }), { encontrado: false });
  });

  it("as movimentações do período, só do cliente; o período inválido volta como erro", async () => {
    const periodo = await rodar("movimentacoes", escopo("cliente"));
    assert.deepEqual([periodo.pecas_que_entraram, periodo.pecas_que_sairam, periodo.itens_movimentados], [10, 3, 1]);
    assert.match((await rodar("movimentacoes", escopo("cliente"), { de: "2026-10-23", ate: "2026-10-01" })).erro, /Período inválido/);
    assert.match((await rodar("movimentacoes", escopo("cliente"), { de: "2026-01-01", ate: "2026-10-01" })).erro, /longo demais/);
  });

  it("os documentos: o cliente só vê o publicado, e o conhecimento só do publicado; a equipe vê tudo do cliente", async () => {
    const doCliente = await rodar("documentos", escopo("cliente"));
    assert.deepEqual(doCliente.documentos.map((documento: Record<string, unknown>) => documento.titulo), ["Contrato de armazenagem"]);
    assert.deepEqual(doCliente.trechos.map((trecho: Record<string, unknown>) => trecho.trecho), ["A armazenagem é cobrada por posição."]);
    const daEquipe = await rodar("documentos", escopo("interno"));
    assert.equal(daEquipe.documentos.length, 2);
    assert.equal(daEquipe.trechos.length, 2);
  });

  it("os itens parados pela regra do modelo, só os com etiqueta", async () => {
    const parados = await rodar("itens_parados", escopo("interno"));
    assert.deepEqual(parados.regra, { parado_dias: 90, sem_giro_dias: 180 });
    assert.deepEqual(parados.itens, [{ codigo: "POLO-M", nome: undefined, saldo: 30, dias_parado: 144, dias_sem_saida: 144, etiquetas: ["Parado 90+ dias"] }]);
  });

  it("o chão e a coordenação: o recebimento em conferência, a tarefa aberta, o endereço, a fila e os eventos", async () => {
    assert.deepEqual((await rodar("recebimentos", escopo("wms"))).recebimentos.map((linha: Record<string, unknown>) => [linha.numero, linha.situacao]), [["REC-0001", "em conferência"]]);
    const tarefas = await rodar("tarefas_armazem", escopo("wms"));
    assert.deepEqual([tarefas.separacao_abertas, tarefas.guarda_abertas, tarefas.tarefas[0].aberta_ha_dias], [1, 0, 2]);
    assert.deepEqual((await rodar("enderecos", escopo("wms"))).enderecos.map((linha: Record<string, unknown>) => linha.endereco), ["A-01-01"]);
    const fila = await rodar("fila_solicitacoes", escopo("interno"));
    assert.deepEqual([fila.aguardando_aprovacao, fila.solicitacoes[0].numero, fila.solicitacoes[0].dias_esperando], [1, "PED-0045", 5]);
    assert.deepEqual((await rodar("eventos", escopo("interno"), { referencia: "PED-0043" })).eventos.map((linha: Record<string, unknown>) => [linha.o_que, linha.quem]), [["Pedido PED-0043 aprovado", "Ops"]]);
  });

  it("a entrada fora do esquema volta como erro para o modelo, sem ler nada", async () => {
    assert.deepEqual(Object.keys(await rodar("buscar_itens", escopo("cliente"), { texto: 3 })), ["erro"]);
    assert.deepEqual(Object.keys(await rodar("listar_pedidos", escopo("cliente"), { limite: 99 })), ["erro"]);
  });
});
