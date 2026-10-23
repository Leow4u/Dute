import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { bancoFalso } from "./agente-banco-falso.test.js";
import { FERRAMENTAS_DO_AGENTE } from "./agente-catalogo.js";
import { anotacaoSugerida, cartaoDasRespostas, conversasAnteriores, playbooksUsados, rascunhoDoEnvio, rascunhoDoPedido, rotinaSugerida } from "./agente-comuns.js";
import { interpretarConversa, promptDoResumo } from "./agente-conversa.js";
import { DADOS_DA_ARMAZENAGEM, porId } from "./agente-dados.test.js";
import { modulosDoEscopo, type EscopoDoAgente } from "./agente-escopo.js";
import { ferramentasDoEscopo } from "./agente-ferramentas.js";
import { leitorDoAgente } from "./agente-leitor.js";
import { promptDoAgente } from "./agente-prompt.js";
import { leValor, type PlatformRole } from "./platform-roles.js";

/**
 * A conversa do Agent Dute do núcleo nas partes puras (parte 5.5e): o
 * pedido, o prompt por papel e módulo, os cartões (que não gravam), as
 * conversas anteriores da pessoa e o rascunho de pedido e de envio pelo
 * leitor. A conversa inteira, com o banco, fica no teste de integração.
 */

const AGORA = new Date("2026-10-23T15:00:00.000Z");

function escopo(role: PlatformRole, modulo: EscopoDoAgente["modulo"] = "wms"): EscopoDoAgente {
  const modulos = modulosDoEscopo(role, ["wms", "operacao", "financeiro"]);
  return { uid: `${role}-1`, role, nome: "Renata", audiencia: role === "cliente" ? "cliente" : "equipe", customerCode: "ITAU", modulo, modulos, leValor: leValor(role), modeloDeOperacao: "uniformes" };
}

describe("o pedido da conversa", () => {
  it("a mensagem, a conversa sem caminho e até 3 anexos no formato do WMS", () => {
    assert.deepEqual(interpretarConversa({ message: " Oi ", conversation_id: "conv_1", modulo: "wms" }), { message: "Oi", conversation_id: "conv_1" });
    const recusa = (padrao: RegExp) => (erro: unknown) => erro instanceof HttpsError && erro.code === "invalid-argument" && padrao.test(erro.message);
    assert.throws(() => interpretarConversa({ message: "" }), recusa(/Escreva a mensagem/));
    assert.throws(() => interpretarConversa({ message: "x".repeat(4001) }), recusa(/longa demais/));
    assert.throws(() => interpretarConversa({ message: "oi", conversation_id: "a/b" }), recusa(/Conversa inválida/));
    const nota = { file_name: "nf.pdf", file_url: "https://storage.test/nf.pdf", storage_path: "operational-documents/ITAU/nf.pdf", content_type: "application/pdf", size_bytes: 1200 };
    assert.throws(() => interpretarConversa({ message: "oi", attachments: [{ storage_path: "x" }] }), recusa(/./));
    assert.throws(() => interpretarConversa({ message: "oi", attachments: [nota, nota, nota, nota] }), recusa(/até 3 arquivos/));
    assert.throws(() => interpretarConversa({ message: "oi", attachments: [{ ...nota, size_bytes: 31 * 1024 * 1024 }] }), recusa(/./));
    assert.deepEqual(interpretarConversa({ message: "oi", attachments: [nota] }), { message: "oi", attachments: [nota] });
  });
});

describe("o prompt", () => {
  const base = { agora: AGORA, notas: ["Entregas só pela manhã"], playbooks: [{ id: "pb_1", titulo: "Devolução", quando: "Quando o cliente devolve itens" }] };

  it("o cliente: quem atende, o módulo, os cartões e o valor dos próprios documentos", () => {
    const texto = promptDoAgente({ ...base, escopo: escopo("cliente") });
    assert.match(texto, /Você atende Renata, da ITAU, cliente da Dutelog/);
    assert.match(texto, /módulo Armazenagem: comece por o estoque guardado/);
    assert.match(texto, /Você também consulta: Armazenagem, Operação, Financeiro\./);
    assert.match(texto, /monte um RASCUNHO com rascunho_pedido ou rascunho_envio/);
    assert.match(texto, /Valores em R\$ só dos documentos deste cliente/);
    assert.match(texto, /- Entregas só pela manhã/);
    assert.match(texto, /- \[pb_1\] Devolução: Quando o cliente devolve itens/);
    assert.match(texto, /Hoje é sexta-feira, 23 de outubro de 2026 \(2026-10-23\)/);
  });

  it("a equipe que não lê valor ouve que não consulta valores; o módulo do shell vem primeiro", () => {
    const texto = promptDoAgente({ ...base, escopo: escopo("interno", "operacao"), notas: [], playbooks: [] });
    assert.match(texto, /equipe interna da Dutelog, consultando os dados do cliente ITAU/);
    assert.match(texto, /módulo Operação: comece por as demandas de serviço/);
    assert.match(texto, /Você não consulta valores/);
    assert.match(texto, /- \(nenhuma ainda\)/);
    assert.doesNotMatch(texto, /Playbooks aprovados/);
    assert.doesNotMatch(texto, /rascunho_pedido/);
  });

  it("o resumo da conversa longa vai ao prompt", () => {
    assert.match(promptDoAgente({ ...base, escopo: escopo("owner"), resumo: "- Pediu o PED-0043" }), /Resumo do começo desta conversa[\s\S]*- Pediu o PED-0043/);
    assert.match(promptDoResumo("", [{ papel: "user", conteudo: "Cadê o PED-0043?", em: "x" }]), /Pessoa: Cadê o PED-0043\?/);
  });
});

describe("os cartões não gravam", () => {
  it("a anotação volta como cartão, para todos quando vem do cliente e da equipe quando vem da equipe", () => {
    assert.deepEqual(anotacaoSugerida(escopo("cliente"), { texto: "  Entregas   só pela manhã  ", motivo: "disse hoje" }), {
      tipo: "anotacao",
      texto: "Entregas só pela manhã",
      motivo: "disse hoje",
      visibilidade: "todos",
      instrucao: anotacaoSugerida(escopo("cliente"), { texto: "Entregas só pela manhã" }).instrucao,
    });
    assert.equal(anotacaoSugerida(escopo("interno"), { texto: "Contato do almoxarifado: Cristiane" }).visibilidade, "equipe");
    assert.deepEqual(anotacaoSugerida(escopo("cliente"), { texto: "curta" }), { erro: "Anotação curta demais." });
  });

  it("a rotina no formato do WMS, de 15 em 15 minutos", () => {
    const rotina = rotinaSugerida({ nome: "Resumo", pergunta: "Resumo da semana do estoque", frequencia: "semanal", dias: ["sex", "seg"], horario: "8:10" });
    assert.deepEqual([rotina.tipo, rotina.frequency, rotina.days, rotina.day_of_month, rotina.time], ["rotina", "weekly", [1, 5], null, "08:15"]);
    const mensal = rotinaSugerida({ nome: "Fatura", pergunta: "Como está a fatura do mês", frequencia: "mensal", dia_do_mes: 40 });
    assert.deepEqual([mensal.frequency, mensal.days, mensal.day_of_month, mensal.time], ["monthly", [], 28, "08:00"]);
  });

  it("o cartão é a última resposta de cartão, sem a instrução e sem o erro; o playbook aberto vai ao uso", () => {
    const respostas = [
      { nome: "resumo_estoque", saida: { itens: 3 } },
      { nome: "sugerir_anotacao", saida: { erro: "Anotação curta demais." } },
      { nome: "rascunho_pedido", saida: { tipo: "pedido", linhas: [], destino: undefined, instrucao: "x" } },
      { nome: "consultar_playbook", saida: { encontrado: true, playbook_id: "pb_1" } },
      { nome: "consultar_playbook", saida: { encontrado: true, playbook_id: "pb_1" } },
      { nome: "consultar_playbook", saida: { encontrado: false } },
    ];
    assert.deepEqual(cartaoDasRespostas(respostas), { tipo: "pedido", linhas: [] });
    assert.deepEqual(playbooksUsados(respostas), ["pb_1"]);
    assert.equal(cartaoDasRespostas([{ nome: "resumo_estoque", saida: {} }]), undefined);
  });

  it("os rascunhos de pedido e de envio pelo leitor, só com o estoque do cliente", async () => {
    const { db } = bancoFalso(DADOS_DA_ARMAZENAGEM);
    const leitor = leitorDoAgente(db, escopo("cliente"));
    const pedido = await rascunhoDoPedido(leitor, { itens: [{ item: "POLO-M", quantidade: 40 }, { item: "camisa polo SAFRA", quantidade: 1 }, { item: "caneca", quantidade: 1 }], destino: "Faria Lima", prazo: "2026-10-30", hora: "09:00" });
    assert.deepEqual(pedido.linhas, [{ sku_code: "ITAU-000001", codigo: "POLO-M", nome: "Camisa polo", detalhe: undefined, quantidade: 25, disponivel: 25 }]);
    assert.deepEqual(
      pedido.pendencias.map((pendencia) => pendencia.motivo),
      ["só 25 disponíveis; o rascunho leva 25", "não encontrei no estoque", "sem saldo disponível"],
    );
    assert.deepEqual([pedido.destino, pedido.prazo, pedido.hora, pedido.falta_destino], ["Faria Lima", "2026-10-30", "09:00", false]);
    const envio = await rascunhoDoEnvio(leitor, { fornecedor: "Fornecedor A", itens: [{ codigo: "POLO-M", quantidade: 10 }, { codigo: "NOVO-1", nome: "Jaqueta", quantidade: 5 }, { nome: "Sem código", quantidade: 2 }, { codigo: "X", quantidade: 0 }] });
    assert.deepEqual(envio.linhas.map((linha) => [linha.codigo, linha.situacao]), [["POLO-M", "no_estoque"], ["NOVO-1", "novo"], [undefined, "codigo_a_definir"]]);
  });

  it("os rascunhos são só do cliente com armazenagem; a equipe não monta pedido", () => {
    const doCliente = ferramentasDoEscopo(escopo("cliente"), FERRAMENTAS_DO_AGENTE).map((item) => item.nome);
    assert.ok(doCliente.includes("rascunho_pedido") && doCliente.includes("rascunho_envio"));
    for (const role of ["owner", "interno", "wms"] as const) {
      const daEquipe = ferramentasDoEscopo(escopo(role), FERRAMENTAS_DO_AGENTE).map((item) => item.nome);
      assert.equal(daEquipe.some((nome) => nome.startsWith("rascunho_")), false, role);
      assert.ok(daEquipe.includes("sugerir_anotacao") && daEquipe.includes("consultar_playbook"), role);
    }
  });
});

describe("as conversas anteriores", () => {
  it("só da mesma pessoa e do cliente, fora a conversa atual", async () => {
    const { db } = bancoFalso({
      agent_conversations: porId(
        { id: "c1", customer_code: "ITAU", user_id: "cliente-1", title: "Pedido da Faria Lima", last_message_at: "2026-10-20T12:00:00.000Z" },
        { id: "c2", customer_code: "ITAU", user_id: "outra-pessoa", title: "Outra", last_message_at: "2026-10-21T12:00:00.000Z" },
        { id: "c3", customer_code: "ITAU", user_id: "cliente-1", title: "Atual", last_message_at: "2026-10-23T12:00:00.000Z" },
      ),
      agent_messages: porId(
        { id: "m1", conversation_id: "c1", customer_code: "ITAU", user_id: "cliente-1", role: "user", content: "Cadê o pedido PED-0043?", created_at_iso: "2026-10-20T12:00:00.000Z" },
        { id: "m2", conversation_id: "c1", customer_code: "ITAU", user_id: "cliente-1", role: "assistant", content: "O PED-0043 saiu hoje.", created_at_iso: "2026-10-20T12:00:01.000Z" },
        { id: "m3", conversation_id: "c2", customer_code: "ITAU", user_id: "outra-pessoa", role: "user", content: "PED-0043 de outra pessoa", created_at_iso: "2026-10-21T12:00:00.000Z" },
        { id: "m4", conversation_id: "c3", customer_code: "ITAU", user_id: "cliente-1", role: "user", content: "PED-0043 de novo", created_at_iso: "2026-10-23T12:00:00.000Z" },
      ),
    });
    const alvo = escopo("cliente");
    const achado = await conversasAnteriores(leitorDoAgente(db, alvo), alvo, "ped-0043", "c3");
    assert.deepEqual(achado.trechos, [{ conversa: "Pedido da Faria Lima", quando: "2026-10-20T12:00:00.000Z", pergunta: "Cadê o pedido PED-0043?", resposta: "O PED-0043 saiu hoje." }]);
    assert.match((await conversasAnteriores(leitorDoAgente(db, alvo), alvo, "a")).observacao ?? "", /Diga sobre o que procurar/);
  });
});
