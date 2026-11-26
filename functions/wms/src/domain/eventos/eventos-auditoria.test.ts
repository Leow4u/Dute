import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { z } from "genkit";

import {
  EVENTO_EVENT_TYPES,
  PAYLOAD_DO_EVENTO,
  TITULO_DO_EVENTO,
  createEventoEvent,
  type EventoEventType,
} from "./eventos-auditoria.js";

/**
 * Os eventos de auditoria dos Eventos (eventos, parte 2): cada tipo com o
 * payload estrito e o título, nenhum com valor, nome de pessoa ou contato, e
 * nenhum que o roteador de avisos do WMS mande ao cliente. A ideia é a do
 * events.test.ts da Operação.
 */

// Compilado em functions/wms/lib/domain/eventos/eventos-auditoria.test.js.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const EDICAO = "ced_0123456789abcdef";
const EVENTO = "cve_fedcba9876543210";

const EXEMPLOS: Record<EventoEventType, Record<string, unknown>> = {
  "evento.edicao_salva": { edition_id: EDICAO, event_id: EVENTO, criada: true, itens: 100, momentos: 7 },
  "evento.edicao_enviada": { edition_id: EDICAO, request_id: null, itens: 100, pecas: 2000 },
  "evento.edicao_confirmada": { edition_id: EDICAO, order_id: "ord_1", separar_ate: "2027-01-26" },
  "evento.edicao_separada": { edition_id: EDICAO, order_id: "ord_1", volumes: 38, pecas: 2000 },
  "evento.edicao_no_evento": { edition_id: EDICAO, order_id: null, entregue_em: "2027-01-27T10:00:00.000Z" },
  "evento.momento_registrado": {
    edition_id: EDICAO,
    momento_id: "mo_0a1b2c3d",
    tipo: "montagem",
    inicio: "2027-01-27T13:00:00.000Z",
    fim: null,
    origem: "registro",
  },
  "evento.momento_corrigido": {
    edition_id: EDICAO,
    momento_id: "mo_0a1b2c3d",
    de: { inicio: "2027-01-27T13:00:00.000Z", fim: null },
    para: { inicio: "2027-01-27T12:00:00.000Z", fim: "2027-01-27T18:00:00.000Z" },
  },
  "evento.foto_anexada": { edition_id: EDICAO, momento_id: "mo_0a1b2c3d", fotos: 3 },
  "evento.documento_anexado": { edition_id: EDICAO, documento_id: "dc_0123456789abcdef", origem: "cliente" },
  "evento.documento_retirado": { edition_id: EDICAO, documento_id: "dc_0123456789abcdef" },
  "evento.retorno_registrado": { edition_id: EDICAO, return_id: "ret_1", itens: 100, voltaram: 1994, avariadas: 3, nao_voltaram: 3 },
  "evento.preco_fechado": { edition_id: EDICAO },
  "evento.edicao_fechada": { edition_id: EDICAO },
  "evento.edicao_cancelada": { edition_id: EDICAO, status_anterior: "enviado" },
  "evento.edicao_excluida": { edition_id: EDICAO, event_id: EVENTO, evento_excluido: true },
  "evento.arquivado": { event_id: EVENTO, edicoes: 2 },
  "evento.pedido_adotado": { edition_id: EDICAO, request_id: "creq_1", order_id: null, status: "enviado" },
};

function exemplo(type: EventoEventType): Record<string, unknown> {
  return EXEMPLOS[type];
}

/** As chaves do payload, com as dos objetos aninhados (`de` e `para` da correção). */
function chaves(schema: z.ZodTypeAny): string[] {
  let atual: z.ZodTypeAny = schema;
  while (atual instanceof z.ZodNullable || atual instanceof z.ZodOptional) atual = atual.unwrap();
  if (!(atual instanceof z.ZodObject)) return [];
  return Object.entries(atual.shape as Record<string, z.ZodTypeAny>).flatMap(([chave, campo]) => [chave, ...chaves(campo)]);
}

function falsoBanco() {
  const criados: Array<{ caminho: string; dados: Record<string, unknown> }> = [];
  const db = { collection: (nome: string) => ({ doc: (id: string) => ({ id, path: `${nome}/${id}` }) }) };
  const transaction = {
    create: (ref: { path: string }, dados: Record<string, unknown>) => {
      criados.push({ caminho: ref.path, dados });
    },
  };
  return { db: db as unknown as Firestore, transaction: transaction as unknown as Transaction, criados };
}

const cristiane = { uid: "cli-1", role: "cliente", customer_code: "BTG Pactual", name: "Cristiane" };

describe("os eventos de auditoria dos Eventos", () => {
  it("são os dezessete tipos, na ordem da spec, e o da adoção por último", () => {
    assert.deepEqual(
      [...EVENTO_EVENT_TYPES],
      [
        "evento.edicao_salva",
        "evento.edicao_enviada",
        "evento.edicao_confirmada",
        "evento.edicao_separada",
        "evento.edicao_no_evento",
        "evento.momento_registrado",
        "evento.momento_corrigido",
        "evento.foto_anexada",
        "evento.documento_anexado",
        "evento.documento_retirado",
        "evento.retorno_registrado",
        "evento.preco_fechado",
        "evento.edicao_fechada",
        "evento.edicao_cancelada",
        "evento.edicao_excluida",
        "evento.arquivado",
        "evento.pedido_adotado",
      ],
    );
  });

  it("todo tipo tem payload e título, e o payload é estrito", () => {
    for (const type of EVENTO_EVENT_TYPES) {
      assert.ok(PAYLOAD_DO_EVENTO[type], type);
      assert.ok(TITULO_DO_EVENTO[type], type);
      assert.doesNotThrow(() => PAYLOAD_DO_EVENTO[type].parse(exemplo(type)), type);
      assert.throws(() => PAYLOAD_DO_EVENTO[type].parse({ ...exemplo(type), extra: 1 }), type);
    }
    assert.throws(() =>
      PAYLOAD_DO_EVENTO["evento.momento_corrigido"].parse({
        ...exemplo("evento.momento_corrigido"),
        de: { inicio: "2027-01-27T13:00:00.000Z", fim: null, extra: 1 },
      }),
    );
  });

  it("os títulos são os da timeline", () => {
    assert.equal(TITULO_DO_EVENTO["evento.edicao_salva"], "Edição do evento salva");
    assert.equal(TITULO_DO_EVENTO["evento.edicao_enviada"], "Edição enviada à Dutelog");
    assert.equal(TITULO_DO_EVENTO["evento.retorno_registrado"], "Retorno recebido");
    assert.equal(TITULO_DO_EVENTO["evento.edicao_excluida"], "Rascunho excluído");
    assert.equal(TITULO_DO_EVENTO["evento.arquivado"], "Evento arquivado");
    assert.equal(TITULO_DO_EVENTO["evento.pedido_adotado"], "Pedido adotado pela edição");
  });

  it("nenhum payload leva dinheiro, nome de pessoa ou contato", () => {
    const proibidas = /(valor|preco|price|cents|total|email|telefone|phone|contato|nome|name)/i;
    for (const type of EVENTO_EVENT_TYPES) {
      const todas = chaves(PAYLOAD_DO_EVENTO[type]);
      assert.ok(todas.length > 0, type);
      for (const chave of todas) assert.doesNotMatch(chave, proibidas, `${type}: ${chave}`);
    }
  });

  it("nenhum tipo contém as palavras do roteador de avisos do WMS", () => {
    const fonte = read("../../../src/index.ts");
    const bloco = fonte.slice(fonte.indexOf("function notificationKindForEvent"), fonte.indexOf("function notificationDraftFromEvent"));
    const palavras = [...bloco.matchAll(/includes\("([a-z_]+)"\)/g)].map((m) => m[1]);
    assert.ok(palavras.length >= 10);
    for (const type of EVENTO_EVENT_TYPES) for (const palavra of palavras) assert.ok(!type.includes(palavra), `${type} contém ${palavra}`);
  });

  it("todo tipo começa com evento.", () => {
    // A zeragem (tools/full_reset_btg.py, parte 1) guarda só os eventos de functions_client_events com esse prefixo.
    for (const type of EVENTO_EVENT_TYPES) assert.ok(type.startsWith("evento."), type);
  });
});

describe("createEventoEvent", () => {
  it("grava em events o tipo, o título, a descrição e o payload da edição, sem caixa do agente", () => {
    const { db, transaction, criados } = falsoBanco();
    const resumo = createEventoEvent(
      transaction,
      db,
      {
        type: "evento.edicao_salva",
        customer_code: "BTG Pactual",
        edition_id: EDICAO,
        descricao: "B2B Conference Necton · 2027",
        payload: exemplo("evento.edicao_salva"),
      },
      cristiane,
    );
    assert.equal(criados.length, 1);
    const [{ caminho, dados }] = criados;
    assert.match(caminho, new RegExp(`^events/evt_evento_edicao_salva_${EDICAO}_[0-9a-f]{8}$`));
    assert.equal(dados.id, caminho.slice("events/".length));
    assert.equal(dados.type, "evento.edicao_salva");
    assert.equal(dados.title, "Edição do evento salva");
    assert.equal(dados.description, "B2B Conference Necton · 2027");
    assert.equal(dados.severity, "info");
    assert.equal(dados.entity_type, "client_event_edition");
    assert.equal(dados.entity_id, EDICAO);
    assert.equal(dados.customer_code, "BTG Pactual");
    assert.equal(dados.source, "functions_client_events");
    assert.deepEqual(dados.payload, exemplo("evento.edicao_salva"));
    assert.deepEqual(resumo, {
      id: dados.id,
      type: "evento.edicao_salva",
      severity: "info",
      entity_type: "client_event_edition",
      entity_id: EDICAO,
      customer_code: "BTG Pactual",
    });
  });

  it("sem edição, o evento é do evento (a capa): o arquivamento", () => {
    const { db, transaction, criados } = falsoBanco();
    createEventoEvent(
      transaction,
      db,
      { type: "evento.arquivado", customer_code: "BTG Pactual", edition_id: null, descricao: "B2B Conference Necton", payload: exemplo("evento.arquivado") },
      cristiane,
    );
    const [{ caminho, dados }] = criados;
    assert.match(caminho, new RegExp(`^events/evt_evento_arquivado_${EVENTO}_[0-9a-f]{8}$`));
    assert.equal(dados.entity_type, "client_event");
    assert.equal(dados.entity_id, EVENTO);
  });

  it("o payload fora do tipo é erro de programação: internal, e nada é gravado", () => {
    const { db, transaction, criados } = falsoBanco();
    assert.throws(
      () =>
        createEventoEvent(
          transaction,
          db,
          {
            type: "evento.edicao_enviada",
            customer_code: "BTG Pactual",
            edition_id: EDICAO,
            descricao: "B2B Conference Necton · 2027",
            payload: { ...exemplo("evento.edicao_enviada"), valor_declarado_cents: 100 },
          },
          cristiane,
        ),
      (erro: unknown) => (erro as { code?: string }).code === "internal",
    );
    assert.equal(criados.length, 0);
  });
});
