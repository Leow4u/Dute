import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bancoFalso } from "./agente-banco-falso.test.js";
import { FERRAMENTAS_DO_AGENTE } from "./agente-catalogo.js";
import { DADOS_DA_ARMAZENAGEM, DADOS_DOS_MODULOS } from "./agente-dados.test.js";
import { modulosDoEscopo, type EscopoDoAgente } from "./agente-escopo.js";
import { executarFerramenta, ferramentasDoEscopo, type FerramentaDoAgente } from "./agente-ferramentas.js";
import { leitorDoAgente } from "./agente-leitor.js";
import { AGENTE_ROLES, leValor, type PlatformRole } from "./platform-roles.js";

/**
 * As ferramentas do Agent Dute do núcleo nos quatro módulos (parte 5.5d),
 * num banco em memória que recusa qualquer gravação, com dois clientes:
 * nenhuma grava, nenhuma devolve dado do outro cliente, nenhuma tem
 * parâmetro de cliente, e quem não lê valor nunca recebe ferramenta que leia
 * valor (o leitor recusaria). Dados sintéticos.
 */

const AGORA = new Date("2026-10-23T15:00:00.000Z");
const DADOS = { ...DADOS_DA_ARMAZENAGEM, ...DADOS_DOS_MODULOS };

function escopo(role: PlatformRole, customerCode = "ITAU", contratados: Array<"wms" | "operacao" | "financeiro"> = ["wms", "operacao", "financeiro"]): EscopoDoAgente {
  return {
    uid: `${role}-1`,
    role,
    nome: null,
    audiencia: role === "cliente" ? "cliente" : "equipe",
    customerCode,
    modulo: modulosDoEscopo(role, contratados)[0] ?? "wms",
    modulos: modulosDoEscopo(role, contratados),
    leValor: leValor(role),
    modeloDeOperacao: "uniformes",
  };
}

const ENTRADAS: Record<string, unknown> = {
  buscar_itens: { texto: "polo" },
  ver_pedido: { referencia: "PED-0043" },
  movimentacoes: { de: "2026-10-01", ate: "2026-10-23" },
  enderecos: { texto: "polo" },
  ver_demanda: { numero: "10050" },
  agenda: { de: "2026-10-23", ate: "2026-10-30" },
  ver_os: { numero: "10050-01" },
  tempo_dos_itens: { texto: "" },
  ver_orcamento: { numero: "10050" },
  lpu: { texto: "mesa" },
  orcamentos_parecidos: { demanda: "10050" },
};

function ferramentaChamada(nome: string): FerramentaDoAgente {
  const item = FERRAMENTAS_DO_AGENTE.find((ferramenta) => ferramenta.nome === nome);
  assert.ok(item, nome);
  return item;
}

async function rodar(nome: string, alvo: EscopoDoAgente, entrada: unknown = ENTRADAS[nome] ?? {}) {
  const { db } = bancoFalso(DADOS);
  return executarFerramenta(ferramentaChamada(nome), { leitor: leitorDoAgente(db, alvo), escopo: alvo, agora: AGORA }, entrada) as Promise<Record<string, any>>;
}

const nomes = (lista: readonly FerramentaDoAgente[]) => lista.map((item) => item.nome);

describe("todas as ferramentas do agente", () => {
  it("nomes únicos, sem parâmetro de cliente", () => {
    const lista = nomes(FERRAMENTAS_DO_AGENTE);
    assert.equal(new Set(lista).size, lista.length);
    for (const item of FERRAMENTAS_DO_AGENTE) {
      for (const chave of Object.keys(item.entrada.shape)) assert.doesNotMatch(chave, /client|customer|cliente/i, `${item.nome}.${chave}`);
    }
  });

  it("para cada papel, as que ele recebe não gravam, não trazem o outro cliente e respeitam o valor", async () => {
    for (const role of AGENTE_ROLES) {
      const alvo = escopo(role);
      for (const item of ferramentasDoEscopo(alvo, FERRAMENTAS_DO_AGENTE)) {
        // O banco recusa gravação, e o leitor de quem não lê valor recusa as coleções com valor: as duas quebrariam aqui.
        const resposta = JSON.stringify(await rodar(item.nome, alvo));
        assert.doesNotMatch(resposta, /SAFRA/, `${role}: ${item.nome}`);
      }
    }
  });

  it("o que cada papel recebe nos módulos novos", () => {
    const novos = (role: PlatformRole, contratados?: Array<"wms" | "operacao" | "financeiro">) =>
      nomes(ferramentasDoEscopo(escopo(role, "ITAU", contratados), FERRAMENTAS_DO_AGENTE)).filter((nome) =>
        ["demandas", "ver_demanda", "agenda", "ver_os", "tempo_dos_itens", "orcamentos", "ver_orcamento", "lpu", "orcamentos_parecidos", "faturas", "a_receber"].includes(nome),
      );
    assert.deepEqual(novos("cliente"), ["demandas", "ver_demanda", "agenda", "ver_os", "faturas"]);
    assert.deepEqual(novos("cliente", ["wms"]), []);
    assert.deepEqual(novos("interno"), ["demandas", "ver_demanda", "agenda", "ver_os", "tempo_dos_itens"]);
    assert.deepEqual(novos("suporte"), ["demandas", "ver_demanda", "agenda", "ver_os"]);
    assert.deepEqual(novos("wms"), []);
    assert.deepEqual(novos("comercial"), ["orcamentos", "ver_orcamento", "lpu", "orcamentos_parecidos"]);
    assert.deepEqual(novos("financeiro"), ["faturas", "a_receber"]);
    assert.deepEqual(novos("owner"), ["demandas", "ver_demanda", "agenda", "ver_os", "tempo_dos_itens", "orcamentos", "ver_orcamento", "lpu", "orcamentos_parecidos", "faturas", "a_receber"]);
  });
});

describe("a Operação, sem valor", () => {
  it("as demandas: o cliente não vê a que ainda está em montagem; a encerrada só com 'todas'", async () => {
    assert.deepEqual((await rodar("demandas", escopo("cliente"))).demandas.map((linha: Record<string, unknown>) => [linha.numero, linha.etapa]), [["10050", "Para planejar"]]);
    assert.deepEqual(
      (await rodar("demandas", escopo("interno"))).demandas.map((linha: Record<string, unknown>) => linha.numero),
      ["10051", "10050"],
    );
    assert.deepEqual(
      (await rodar("demandas", escopo("cliente"), { situacao: "todas" })).demandas.map((linha: Record<string, unknown>) => [linha.numero, linha.nf]),
      [
        ["10050", undefined],
        ["10049", "1234"],
      ],
    );
    assert.deepEqual(await rodar("ver_demanda", escopo("cliente"), { numero: "10051" }), { encontrada: false });
    assert.deepEqual(await rodar("ver_demanda", escopo("cliente"), { numero: "10090" }), { encontrada: false });
  });

  it("o detalhe da demanda traz o escopo e as OS", async () => {
    const detalhe = await rodar("ver_demanda", escopo("cliente"));
    assert.deepEqual(detalhe.escopo, [{ item: "Mesa", unidade: "un", quantidade: "12" }]);
    assert.deepEqual(detalhe.ordens.map((os: Record<string, unknown>) => [os.numero, os.situacao]), [
      ["10050-01", "Agendada"],
      ["10050-02", "Cancelada"],
    ]);
  });

  it("a agenda do período sem a cancelada; a equipe e o veículo só para a equipe Dutelog", async () => {
    const daEquipe = await rodar("agenda", escopo("interno"));
    assert.deepEqual(daEquipe.agenda, [
      { numero: "10050-01", tipo: "serviço", situacao: "Agendada", dia: "2026-10-27", horario: "08:00–12:00", servicos: ["transporte", "montagem"], demanda: "10050", equipe: [{ nome: "Carlos", papel: "lider" }], veiculos: [{ placa: "ABC1D23", tipo: "caminhão" }] },
    ]);
    const doCliente = await rodar("agenda", escopo("cliente"));
    assert.equal("equipe" in doCliente.agenda[0], false);
    assert.match((await rodar("agenda", escopo("cliente"), { de: "2026-10-01", ate: "2026-12-01" })).erro, /longo demais/);
    assert.match((await rodar("agenda", escopo("cliente"), { de: "2026-10-30", ate: "2026-10-01" })).erro, /Período inválido/);
    // Sem período: hoje e os próximos 7 dias.
    assert.deepEqual((await rodar("agenda", escopo("cliente"), {})).periodo, { de: "2026-10-23", ate: "2026-10-30" });
  });

  it("a OS do outro cliente não aparece; o detalhe traz os itens planejados", async () => {
    assert.deepEqual(await rodar("ver_os", escopo("cliente"), { numero: "10090-01" }), { encontrada: false });
    const os = await rodar("ver_os", escopo("cliente"));
    assert.deepEqual(os.itens, [{ item: "Mesa", unidade: "un", planejado: "12", executado: undefined }]);
    assert.equal("equipe" in os, false);
  });

  it("o tempo dos itens: a base do cliente com 5, a geral com 15, sem base abaixo; o plano otimista", async () => {
    const tempos = await rodar("tempo_dos_itens", escopo("interno"));
    assert.deepEqual(tempos.itens, [
      { item: "Armário", unidade: "un", homem_minuto_por_unidade: 45, base: "média de todos os clientes", execucoes: 20 },
      { item: "Cadeira", unidade: "un", base: "ainda sem base", execucoes: 3 },
      { item: "Mesa", unidade: "un", homem_minuto_por_unidade: 30, base: "deste cliente", execucoes: 6, os_de_origem: ["10040-01"] },
    ]);
    assert.deepEqual(tempos.plano, { erro_medio_pct: 22, os_revisadas: 8, aviso: "Os planos deste cliente costumam ser otimistas: as OS levam mais que o planejado." });
    // A medida geral não mostra as OS de origem, que são de outros clientes.
    assert.doesNotMatch(JSON.stringify(tempos), /10090-01/);
  });
});

describe("o Comercial, para quem orça", () => {
  it("os orçamentos e o detalhe, com o preço em R$", async () => {
    const lista = await rodar("orcamentos", escopo("comercial"));
    assert.deepEqual(lista.orcamentos.map((linha: Record<string, unknown>) => [linha.numero, linha.situacao, linha.total]), [
      ["10051", "Rascunho", "R$ 500,00"],
      ["10050", "Enviado", "R$ 12.500,00"],
    ]);
    assert.deepEqual((await rodar("orcamentos", escopo("comercial"), { situacao: "abertos" })).orcamentos.map((linha: Record<string, unknown>) => linha.numero), ["10051"]);
    const detalhe = await rodar("ver_orcamento", escopo("comercial"));
    assert.deepEqual(detalhe.linhas.map((linha: Record<string, unknown>) => [linha.item, linha.preco, linha.total, linha.fora_da_tabela]), [
      ["Mesa", "R$ 850,00", "R$ 10.200,00", undefined],
      ["Armário", "R$ 1.150,00", "R$ 2.300,00", true],
    ]);
    assert.deepEqual(await rodar("ver_orcamento", escopo("comercial"), { numero: "10090" }), { encontrado: false });
  });

  it("a LPU com o preço da tabela do cliente; o item que não se orça e o inativo ficam de fora", async () => {
    const itens = await rodar("lpu", escopo("comercial"));
    assert.deepEqual(itens.tabela, { nome: "Tabela Itaú 2026", vigente_de: "2026-01-01", do_cliente: true });
    assert.deepEqual(itens.itens.map((linha: Record<string, unknown>) => [linha.item, linha.preco]), [["Mesa", "R$ 850,00"]]);
    const semTabela = await rodar("lpu", escopo("comercial", "NOVO"), { texto: "montagem" });
    assert.deepEqual([semTabela.tabela.nome, semTabela.itens.map((linha: Record<string, unknown>) => linha.preco)], ["Padrão Dutelog", ["R$ 1.200,00", "R$ 900,00"]]);
  });

  it("os parecidos só do cliente, com o orçado e o realizado", async () => {
    const parecidos = await rodar("orcamentos_parecidos", escopo("comercial"));
    assert.equal(parecidos.demandas_fechadas, 2);
    assert.deepEqual(parecidos.casos.map((caso: Record<string, unknown>) => [caso.demanda, caso.orcado, caso.realizado, caso.itens_em_comum]), [["10049", "R$ 11.000,00", "R$ 12.000,00", 2]]);
    const semItens = await rodar("orcamentos_parecidos", escopo("comercial"), { demanda: "10051" });
    assert.match(semItens.observacao, /não tem itens da LPU/);
  });
});

describe("o Financeiro, com valor", () => {
  it("as faturas do cliente: as da armazenagem e as dos serviços", async () => {
    const lista = await rodar("faturas", escopo("cliente"));
    assert.deepEqual(lista.armazenagem.map((linha: Record<string, unknown>) => [linha.competencia, linha.situacao, linha.total]), [
      ["2026-09", "Emitida", "R$ 3.000,00"],
      ["2026-08", "Paga", "R$ 2.800,00"],
    ]);
    assert.deepEqual(lista.servicos.map((linha: Record<string, unknown>) => [linha.nf, linha.situacao, linha.saldo, linha.vencimento]), [["1234 série 1", "Enviada", "R$ 10.000,00", "2026-10-10"]]);
  });

  it("o a receber da equipe: o saldo, o vencido e os dias em atraso", async () => {
    const aberto = await rodar("a_receber", escopo("financeiro"));
    assert.deepEqual([aberto.servicos.em_aberto, aberto.servicos.vencido], ["R$ 10.800,00", "R$ 10.000,00"]);
    assert.deepEqual(aberto.servicos.faturas.map((linha: Record<string, unknown>) => [linha.nf, linha.dias_em_atraso]), [
      ["1234 série 1", 13],
      ["1300", undefined],
    ]);
    assert.deepEqual(aberto.armazenagem_em_aberto.map((linha: Record<string, unknown>) => linha.competencia), ["2026-09"]);
  });
});
