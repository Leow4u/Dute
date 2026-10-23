import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { atualizarResumo, conversarComDute, type GerarResposta, type PedidoAoModelo } from "./agente-conversa.js";
import type { CoreProfile } from "./profile.js";

/**
 * A conversa com o Agent Dute do núcleo no emulador (parte 5.5e), com um
 * modelo falso que chama as ferramentas. Só o fluxo grava: a conversa, as
 * duas mensagens (com o cartão) e o uso, com os playbooks abertos. A
 * ferramenta não grava nada, nem a anotação nem o uso do playbook. A conversa
 * de outra pessoa, de outro cliente ou de outro módulo recusa. Dados
 * sintéticos.
 */

const PROJECT_ID = "demo-dute-core";
const AGORA = new Date("2026-10-23T15:00:00.000Z");

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "core-agente-conversa-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  batch.set(db.collection("customers").doc("cus_itau"), { customer_code: "ITAU", operation_template: "uniformes" });
  batch.set(db.collection("customers").doc("cus_safra"), { customer_code: "SAFRA" });
  batch.set(db.collection("client_access").doc("ITAU"), { customer_code: "ITAU", modules: ["wms", "operacao", "financeiro"] });
  batch.set(db.collection("client_inventory").doc("i1"), { customer_code: "ITAU", sku_code: "ITAU-000001", client_item_code: "POLO-M", product_name: "Camisa polo", qty_on_hand: 30 });
  batch.set(db.collection("client_inventory").doc("s1"), { customer_code: "SAFRA", sku_code: "SAFRA-000001", product_name: "Camisa SAFRA", qty_on_hand: 900 });
  batch.set(db.collection("ai_agent_notes").doc("n1"), { customer_code: "ITAU", status: "active", visibility: "todos", text: "Entregas só pela manhã" });
  batch.set(db.collection("ai_agent_notes").doc("n2"), { customer_code: "ITAU", status: "active", visibility: "equipe", text: "Margem apertada neste cliente" });
  batch.set(db.collection("ai_agent_playbooks").doc("pb_dev"), { customer_code: "ITAU", status: "active", audience: "todos", title: "Devolução", when: "Quando o cliente devolve", steps: ["Abrir Devoluções"], use_count: 0 });
  await batch.commit();
});

const cliente: CoreProfile = { uid: "cli-itau", role: "cliente", customerCode: "ITAU", name: "Renata", email: "renata@itau.com" };
const interno: CoreProfile = { uid: "ops-1", role: "interno", name: "Ops" };

let contador = 0;
const novoId = (prefixo: string) => `${prefixo}_${String(++contador).padStart(4, "0")}`;

/** O modelo falso: chama as ferramentas pedidas, na ordem, e responde o texto. */
function modelo(chamadas: Array<[string, unknown]>, texto = "Feito.", registro?: (pedido: PedidoAoModelo) => void): GerarResposta {
  return async (pedido) => {
    registro?.(pedido);
    for (const [nome, entrada] of chamadas) {
      const ferramenta = pedido.ferramentas.find((item) => item.nome === nome);
      if (!ferramenta) throw new Error(`ferramenta não oferecida: ${nome}`);
      pedido.aoPedaco?.({ type: "tool", name: nome });
      await ferramenta.executar(entrada);
    }
    pedido.aoPedaco?.({ type: "text", index: 0, text: texto });
    return { texto, fonte: "genkit_teste", modelo: "teste", tokens_entrada: 100, tokens_saida: 20, latencia_ms: 5 };
  };
}

async function doc(colecao: string, id: string) {
  return (await db.collection(colecao).doc(id).get()).data();
}

async function todos(colecao: string) {
  return (await db.collection(colecao).get()).docs.map((item) => item.data());
}

describe("a conversa no núcleo", () => {
  it("o cliente pergunta, o modelo consulta e monta o rascunho; só o fluxo grava", async () => {
    let pedidoAoModelo: PedidoAoModelo | undefined;
    const pedacos: unknown[] = [];
    const resposta = await conversarComDute(
      db,
      cliente,
      { message: "Quero 3 polos M para a Faria Lima", conversation_id: "conv_1", modulo: "wms" },
      {
        gerar: modelo(
          [
            ["resumo_estoque", {}],
            ["rascunho_pedido", { itens: [{ item: "POLO-M", quantidade: 3 }], destino: "Faria Lima" }],
          ],
          "Montei o rascunho.",
          (pedido) => (pedidoAoModelo = pedido),
        ),
        aoPedaco: (pedaco) => pedacos.push(pedaco),
        agora: () => AGORA,
        novoId,
      },
    );
    // O prompt leva a anotação para todos, não a da equipe, e o índice dos playbooks.
    assert.match(pedidoAoModelo!.sistema, /- Entregas só pela manhã/);
    assert.doesNotMatch(pedidoAoModelo!.sistema, /Margem apertada/);
    assert.match(pedidoAoModelo!.sistema, /\[pb_dev\] Devolução/);
    assert.ok(pedidoAoModelo!.ferramentas.some((item) => item.nome === "rascunho_pedido"));
    assert.equal(pedidoAoModelo!.ferramentas.some((item) => item.nome === "eventos"), false);
    assert.deepEqual(pedacos, [{ type: "tool", name: "resumo_estoque" }, { type: "tool", name: "rascunho_pedido" }, { type: "text", index: 0, text: "Montei o rascunho." }]);

    const [pergunta, dela] = resposta.messages;
    assert.equal(pergunta.content, "Quero 3 polos M para a Faria Lima");
    assert.deepEqual(dela.tools_used, ["resumo_estoque", "rascunho_pedido"]);
    assert.equal((dela.draft as Record<string, unknown>).tipo, "pedido");
    assert.equal("instrucao" in (dela.draft as Record<string, unknown>), false);

    const conversa = await doc("agent_conversations", "conv_1");
    assert.deepEqual([conversa?.customer_code, conversa?.user_id, conversa?.modulo, conversa?.title, conversa?.user_email], ["ITAU", "cli-itau", "wms", "Quero 3 polos M para a Faria Lima", "renata@itau.com"]);
    const mensagens = (await todos("agent_messages")).sort((a, b) => String(a.created_at_iso).localeCompare(String(b.created_at_iso)));
    assert.deepEqual(
      mensagens.map((mensagem) => [mensagem.role, mensagem.customer_code, mensagem.user_id, mensagem.modulo, mensagem.source]),
      [
        ["user", "ITAU", "cli-itau", "wms", "portal_cliente"],
        ["assistant", "ITAU", "cli-itau", "wms", "genkit_teste"],
      ],
    );
    assert.deepEqual((mensagens[1].draft as Record<string, any>).linhas.map((linha: Record<string, unknown>) => [linha.codigo, linha.quantidade]), [["POLO-M", 3]]);
    const [uso] = await todos("agent_usage");
    assert.deepEqual([uso.role, uso.modulo, uso.tool_calls, uso.input_tokens, uso.output_tokens, uso.playbooks], ["cliente", "wms", 2, 100, 20, []]);
    // Nada além do registro da conversa: o estoque, as anotações e os playbooks ficam como estavam.
    assert.deepEqual((await todos("client_inventory")).length, 2);
    assert.deepEqual((await todos("ai_agent_notes")).length, 2);
  });

  it("o playbook aberto vai ao uso, e o playbook não muda; a anotação sugerida é só o cartão", async () => {
    await conversarComDute(
      db,
      cliente,
      { message: "Como faço uma devolução? E anota que entregamos só de manhã na Paulista.", conversation_id: "conv_2", modulo: "wms" },
      { gerar: modelo([["consultar_playbook", { id: "pb_dev" }], ["sugerir_anotacao", { texto: "Entregas na Paulista só pela manhã" }]]), agora: () => AGORA, novoId },
    );
    const [uso] = await todos("agent_usage");
    assert.deepEqual(uso.playbooks, ["pb_dev"]);
    assert.equal((await doc("ai_agent_playbooks", "pb_dev"))?.use_count, 0);
    assert.equal((await todos("ai_agent_notes")).length, 2);
    const resposta = (await todos("agent_messages")).find((mensagem) => mensagem.role === "assistant");
    assert.deepEqual(resposta?.draft, { tipo: "anotacao", texto: "Entregas na Paulista só pela manhã", visibilidade: "todos" });
  });

  it("a segunda mensagem leva o histórico em ordem; a conversa de outro dono, cliente ou módulo recusa", async () => {
    const opcoes = { agora: () => AGORA, novoId };
    await conversarComDute(db, cliente, { message: "Primeira", conversation_id: "conv_3", modulo: "wms" }, { ...opcoes, gerar: modelo([], "Resposta 1") });
    let historico: PedidoAoModelo["historico"] = [];
    await conversarComDute(db, cliente, { message: "Segunda", conversation_id: "conv_3", modulo: "wms" }, { ...opcoes, agora: () => new Date(AGORA.getTime() + 60_000), gerar: modelo([], "Resposta 2", (pedido) => (historico = pedido.historico)) });
    assert.deepEqual(historico, [
      { papel: "user", texto: "Primeira" },
      { papel: "model", texto: "Resposta 1" },
    ]);
    const negado = (codigo: string, padrao: RegExp) => (erro: unknown) => erro instanceof HttpsError && erro.code === codigo && padrao.test(erro.message);
    await assert.rejects(conversarComDute(db, { ...cliente, uid: "outra" }, { message: "oi", conversation_id: "conv_3", modulo: "wms" }, { ...opcoes, gerar: modelo([]) }), negado("permission-denied", /outro usuário/));
    await assert.rejects(conversarComDute(db, interno, { message: "oi", conversation_id: "conv_3", modulo: "wms", customer_code: "ITAU" }, { ...opcoes, gerar: modelo([]) }), negado("permission-denied", /outro usuário/));
    await assert.rejects(conversarComDute(db, cliente, { message: "oi", conversation_id: "conv_3", modulo: "operacao" }, { ...opcoes, gerar: modelo([]) }), negado("failed-precondition", /outro módulo/));
  });

  it("a equipe fala do cliente ativo, no módulo dela, sem os cartões do cliente", async () => {
    let ferramentas: string[] = [];
    const resposta = await conversarComDute(
      db,
      interno,
      { message: "Como está o estoque?", modulo: "wms", customer_code: "ITAU" },
      { gerar: modelo([["resumo_estoque", {}]], "30 peças.", (pedido) => (ferramentas = pedido.ferramentas.map((item) => item.nome))), agora: () => AGORA, novoId },
    );
    assert.match(resposta.conversation.id, /^dute_[0-9a-f]{24}$/);
    assert.equal(resposta.conversation.customer_code, "ITAU");
    assert.ok(ferramentas.includes("eventos") && ferramentas.includes("demandas"));
    assert.equal(ferramentas.some((nome) => nome.startsWith("rascunho_") || nome === "orcamentos" || nome === "faturas"), false);
    const pergunta = (await todos("agent_messages")).find((mensagem) => mensagem.role === "user");
    assert.equal(pergunta?.source, "painel_interno");
    await assert.rejects(
      conversarComDute(db, interno, { message: "oi", modulo: "comercial", customer_code: "ITAU" }, { gerar: modelo([]), agora: () => AGORA, novoId }),
      (erro: unknown) => erro instanceof HttpsError && erro.code === "permission-denied",
    );
  });

  it("sem o modelo, a resposta de reserva também fica registrada", async () => {
    const resposta = await conversarComDute(db, cliente, { message: "Oi", conversation_id: "conv_4", modulo: "wms" }, { gerar: async () => ({ texto: "Não consegui consultar os dados agora.", fonte: "fallback_indisponivel", erro: "x: falhou" }), agora: () => AGORA, novoId });
    assert.equal(resposta.messages[1].source, "fallback_indisponivel");
    const [uso] = await todos("agent_usage");
    assert.deepEqual([uso.source, uso.error, uso.tool_calls], ["fallback_indisponivel", "x: falhou", 0]);
  });
});

describe("o resumo da conversa longa", () => {
  it("só com 10 mensagens antigas fora da janela de 20, e só da própria conversa", async () => {
    await db.collection("agent_conversations").doc("conv_longa").set({ id: "conv_longa", customer_code: "ITAU", user_id: "cli-itau", modulo: "wms" });
    const batch = db.batch();
    for (let indice = 0; indice < 29; indice += 1) {
      const id = `m_${String(indice).padStart(2, "0")}`;
      batch.set(db.collection("agent_messages").doc(id), { id, conversation_id: "conv_longa", customer_code: "ITAU", user_id: "cli-itau", role: indice % 2 ? "assistant" : "user", content: `mensagem ${indice}`, created_at_iso: `2026-10-23T10:${String(indice).padStart(2, "0")}:00.000Z` });
    }
    await batch.commit();
    const escopo = { uid: "cli-itau", customerCode: "ITAU" };
    let recebidas = 0;
    const resumir = async (_anterior: string, mensagens: unknown[]) => {
      recebidas = mensagens.length;
      return "- Resumo";
    };
    // 29 mensagens: 9 fora da janela, menos que o lote de 10.
    assert.equal(await atualizarResumo(db, escopo, "conv_longa", resumir), false);
    await db.collection("agent_messages").doc("m_29").set({ id: "m_29", conversation_id: "conv_longa", customer_code: "ITAU", user_id: "cli-itau", role: "assistant", content: "mensagem 29", created_at_iso: "2026-10-23T10:29:00.000Z" });
    assert.equal(await atualizarResumo(db, escopo, "conv_longa", resumir), true);
    assert.equal(recebidas, 10);
    const conversa = await doc("agent_conversations", "conv_longa");
    assert.deepEqual([conversa?.summary, conversa?.summary_upto_iso], ["- Resumo", "2026-10-23T10:09:00.000Z"]);
    assert.equal(await atualizarResumo(db, { uid: "outra", customerCode: "ITAU" }, "conv_longa", resumir), false);
  });
});
