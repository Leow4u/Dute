import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import {
  COMERCIAL_EVENT_PAYLOADS,
  COMERCIAL_EVENT_SOURCE,
  COMERCIAL_EVENT_TYPES,
  buildComercialEvent,
  comercialEventId,
  comercialEventText,
  type ComercialEventType,
} from "./events.js";

/**
 * Contrato dos eventos do Comercial (docs/plataforma/fase-6-comercial.md,
 * "Eventos"): sem valor, sem nome nem contato de cliente, título e descrição
 * de modelo fixo e nenhum tipo que o roteador de avisos do WMS transforme em
 * aviso ao cliente.
 */

/** Um payload válido por tipo. O Record obriga a ter exemplo de todo tipo novo. */
const EXEMPLOS: Record<ComercialEventType, Record<string, unknown>> = {
  "demand.created": { numero: "10045" },
  "demand.stage_changed": {
    numero: "10045",
    etapa_antes: "em_montagem",
    etapa_depois: "para_aprovar",
    segundos_desde_anterior: 3600,
  },
  "demand.won": { numero: "10045", rv: 1 },
  "demand.lost": { numero: "10045", etapa_antes: "aguardando_cliente" },
  "quote.created": { numero: "10045", rv: 0, tipo_rv: "proposta", edicao: 1 },
  "quote.updated": { numero: "10045", rv: 0, edicao_antes: 1, edicao_depois: 2 },
  "quote.submitted": { numero: "10045", rv: 0, edicao: 2 },
  "quote.returned": { numero: "10045", rv: 0, edicao: 2 },
  "quote.approved": { numero: "10045", rv: 0, edicao: 3 },
  "quote.approval_waived": { numero: "10045", rv: 2, edicao: 1 },
  "quote.sent": { numero: "10045", rv: 0, edicao: 3 },
  "quote.revised": { numero: "10045", rv: 1, rv_anterior: 0, tipo_rv: "aditivo" },
  "commercial_customer.created": { stage: "prospect" },
  "commercial_customer.updated": { campos: ["razao_social", "cnpj"] },
  "commercial_customer.became_client": { numero: "10045" },
  "commercial_customer.archived": {},
  "customer_contact.saved": { contato_id: "ct_0001", novo: true },
  "customer_location.saved": { local_id: "loc_ceic", novo: false },
  "contract.created": { contrato_id: "itau-2026", regime: "por_demanda" },
  "contract.updated": { contrato_id: "itau-2026", campos: ["vencimento"] },
  "contract.amendment_added": { contrato_id: "itau-2026", aditivo_id: "aditivo-01" },
  "price_table.imported": {
    tabela_id: "itau-v2-comercial",
    variante: "comercial",
    linhas: 312,
    vigencia_inicio: "2026-01-01",
    vigencia_fim: "2026-12-31",
    contrato_id: "itau-2026",
  },
  "client_authorization.recorded": { autorizacao_id: "aut_0001", demandas: ["10045", "10046"] },
  "medicao.created": { medicao_id: "safra-2026-10", contrato_id: "safra-2026", competencia: "2026-10", demandas: 7 },
  "medicao.sent": { medicao_id: "safra-2026-10", competencia: "2026-10" },
  "medicao.approved": { medicao_id: "safra-2026-10", competencia: "2026-10" },
};

/** Prefixos dos tipos do Comercial. Nada de billing., support. e afins, que as regras abrem a outros papéis. */
const PREFIXOS = [
  "demand.",
  "quote.",
  "commercial_customer.",
  "customer_contact.",
  "customer_location.",
  "contract.",
  "price_table.",
  "client_authorization.",
  "medicao.",
];

const CHAVE_DE_DINHEIRO =
  /valor|preco|preço|price|total|cents|centavo|amount|desconto|discount|subtotal|custo|cost|reais|brl|money|dinheiro/i;
const CHAVE_DE_CONTATO = /nome|name|e_?mail|telefone|fone|phone|celular|whatsapp|cpf/i;
const CHAVES_PROIBIDAS = [
  "valor",
  "valor_cents",
  "preco",
  "total_cents",
  "subtotal_cents",
  "desconto",
  "price",
  "amount",
  "customer_name",
  "nome",
  "name",
  "email",
  "telefone",
  "phone",
  "contato_nome",
];

const equipe = { uid: "com-1", role: "comercial", name: "Guilherme", email: "comercial@dutelog.com.br" };

/** Texto que nenhum campo de texto do payload pode aceitar: valor, e-mail, telefone, nome. */
const TEXTOS_PROIBIDOS = ["R$ 1.500,00", "1.500,00", "1500,00", "fulano@x.com", "(11) 98765-4321", "Fulano de Tal"];

/** Visita cada nó do schema, entrando em objeto, lista, opcional, nulo e união. */
function walk(schema: z.ZodTypeAny, path: string, visit: (node: z.ZodTypeAny, path: string) => void): void {
  visit(schema, path);
  if (schema instanceof z.ZodObject) {
    for (const [key, value] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) walk(value, `${path}.${key}`, visit);
  } else if (schema instanceof z.ZodArray) {
    walk(schema.element as z.ZodTypeAny, `${path}[]`, visit);
  } else if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    walk(schema.unwrap() as z.ZodTypeAny, path, visit);
  } else if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
    (schema.options as z.ZodTypeAny[]).forEach((option, i) => walk(option, `${path}|${i}`, visit));
  }
}

/**
 * Problemas de contrato de um payload. Só passa o que não carrega texto livre
 * nem número com casas: objeto .strict() (sem catchall), lista, opcional, nulo,
 * união (cada opção conferida), enum, literal, booleano, número inteiro e texto
 * com regex. Qualquer outro tipo zod (record, any, unknown, interseção,
 * effects, default, texto sem regex...) reprova, e chave de dinheiro ou de
 * contato também.
 */
function contractProblems(schema: z.ZodTypeAny): string[] {
  const problems: string[] = [];
  walk(schema, "payload", (node, path) => {
    if (node instanceof z.ZodObject) {
      if (node._def.unknownKeys !== "strict") problems.push(`${path}: objeto sem .strict()`);
      if (!(node._def.catchall instanceof z.ZodNever)) problems.push(`${path}: objeto com catchall`);
      for (const key of Object.keys(node.shape as Record<string, unknown>)) {
        if (CHAVE_DE_DINHEIRO.test(key)) problems.push(`${path}.${key}: chave de dinheiro`);
        if (CHAVE_DE_CONTATO.test(key)) problems.push(`${path}.${key}: chave de contato`);
      }
    } else if (
      node instanceof z.ZodArray ||
      node instanceof z.ZodOptional ||
      node instanceof z.ZodNullable ||
      node instanceof z.ZodUnion ||
      node instanceof z.ZodDiscriminatedUnion ||
      node instanceof z.ZodEnum ||
      node instanceof z.ZodLiteral ||
      node instanceof z.ZodBoolean
    ) {
      // Contêiner (os filhos são visitados) ou valor de lista fechada.
    } else if (node instanceof z.ZodNumber) {
      if (!node.isInt) problems.push(`${path}: número sem .int()`);
    } else if (node instanceof z.ZodString) {
      if (!node._def.checks.some((check) => check.kind === "regex")) problems.push(`${path}: texto sem regex`);
    } else {
      problems.push(`${path}: tipo zod fora da lista (${node.constructor.name})`);
    }
  });
  return problems;
}

function stringLeaves(schema: z.ZodTypeAny): Array<[string, z.ZodString]> {
  const leaves: Array<[string, z.ZodString]> = [];
  walk(schema, "payload", (node, path) => {
    if (node instanceof z.ZodString) leaves.push([path, node]);
  });
  return leaves;
}

function wmsNoticeWords(): string[] {
  const source = readFileSync(fileURLToPath(new URL("../../../wms/src/index.ts", import.meta.url)), "utf8");
  const body = source.match(/function notificationKindForEvent\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(body, "notificationKindForEvent não encontrado em functions/wms/src/index.ts");
  return [...body[1].matchAll(/\.includes\("([^"]+)"\)/g)].map((match) => match[1].toLowerCase());
}

describe("contrato dos eventos do Comercial", () => {
  it("os tipos do desenho estão todos definidos", () => {
    assert.deepEqual([...COMERCIAL_EVENT_TYPES].sort(), Object.keys(EXEMPLOS).sort());
    assert.ok(COMERCIAL_EVENT_TYPES.length >= 20);
  });

  it("todo tipo tem payload zod .strict(), inclusive nos objetos de dentro, só com tipos da lista", () => {
    for (const type of COMERCIAL_EVENT_TYPES) {
      const schema = COMERCIAL_EVENT_PAYLOADS[type] as z.ZodTypeAny;
      assert.ok(schema instanceof z.ZodObject, `${type}: payload precisa ser z.object`);
      assert.deepEqual(contractProblems(schema), [], type);
    }
  });

  it("a trava do contrato reprova record, união sem strict, texto livre, número com casas e afins", () => {
    const regexed = z.string().regex(/^[a-z]+$/);
    const reprovados: Array<[string, z.ZodTypeAny, RegExp]> = [
      ["record", z.object({ extras: z.record(z.string(), z.number().int()) }).strict(), /fora da lista \(ZodRecord\)/],
      ["texto livre", z.object({ observacao: z.string() }).strict(), /texto sem regex/],
      ["texto livre em lista", z.object({ notas: z.array(z.string().max(80)) }).strict(), /texto sem regex/],
      [
        "união com objeto sem strict",
        z.object({ alvo: z.union([z.object({ a: z.boolean() }).strict(), z.object({ b: z.boolean() })]) }).strict(),
        /objeto sem \.strict\(\)/,
      ],
      ["número com casas", z.object({ peso: z.number() }).strict(), /número sem \.int\(\)/],
      ["any", z.object({ dados: z.any() }).strict(), /fora da lista \(ZodAny\)/],
      ["unknown", z.object({ dados: z.unknown() }).strict(), /fora da lista \(ZodUnknown\)/],
      ["interseção", z.object({ dados: z.intersection(z.object({}).strict(), z.object({}).strict()) }).strict(), /fora da lista/],
      ["effects", z.object({ codigo: regexed.transform((value) => value.toUpperCase()) }).strict(), /fora da lista \(ZodEffects\)/],
      ["catchall", z.object({ a: z.boolean() }).catchall(z.number().int()), /catchall/],
      ["passthrough", z.object({ a: z.boolean() }).passthrough(), /objeto sem \.strict\(\)/],
      ["chave de dinheiro", z.object({ total_cents: z.number().int() }).strict(), /chave de dinheiro/],
      ["chave de contato", z.object({ contato_nome: regexed }).strict(), /chave de contato/],
    ];
    for (const [caso, schema, expected] of reprovados) {
      const problems = contractProblems(schema);
      assert.ok(problems.some((problem) => expected.test(problem)), `${caso}: ${problems.join("; ") || "passou"}`);
    }
  });

  it("nenhum texto do payload aceita valor, e-mail, telefone ou nome", () => {
    for (const type of COMERCIAL_EVENT_TYPES) {
      for (const [path, leaf] of stringLeaves(COMERCIAL_EVENT_PAYLOADS[type] as z.ZodTypeAny)) {
        for (const text of TEXTOS_PROIBIDOS) {
          assert.equal(leaf.safeParse(text).success, false, `${type} ${path} aceitou "${text}"`);
        }
      }
    }
    assert.equal(
      COMERCIAL_EVENT_PAYLOADS["commercial_customer.updated"].safeParse({ campos: ["acima_de_1500_reais"] }).success,
      false,
      "código com algarismo carrega valor",
    );
  });

  it("o exemplo de cada tipo é válido", () => {
    for (const type of COMERCIAL_EVENT_TYPES) {
      const parsed = COMERCIAL_EVENT_PAYLOADS[type].safeParse(EXEMPLOS[type]);
      assert.ok(parsed.success, `${type}: ${parsed.success ? "" : parsed.error.message}`);
    }
  });

  it("nenhum payload tem chave de dinheiro ou de contato", () => {
    for (const type of COMERCIAL_EVENT_TYPES) {
      const chaves = contractProblems(COMERCIAL_EVENT_PAYLOADS[type] as z.ZodTypeAny).filter((problem) => /chave de/.test(problem));
      assert.deepEqual(chaves, [], type);
    }
  });

  it("nenhum payload aceita chave de dinheiro ou de contato a mais", () => {
    for (const type of COMERCIAL_EVENT_TYPES) {
      for (const key of CHAVES_PROIBIDAS) {
        const parsed = COMERCIAL_EVENT_PAYLOADS[type].safeParse({ ...EXEMPLOS[type], [key]: key.includes("nome") ? "Fulano" : 1234.56 });
        assert.equal(parsed.success, false, `${type} aceitou ${key}`);
      }
    }
  });

  it("título e descrição não têm R$ nem número decimal", () => {
    for (const type of COMERCIAL_EVENT_TYPES) {
      const { title, description } = comercialEventText(type, EXEMPLOS[type] as never);
      assert.ok(title.trim().length > 0, `${type}: título vazio`);
      assert.ok(description.trim().length > 0, `${type}: descrição vazia`);
      for (const text of [title, description]) {
        assert.doesNotMatch(text, /R\$/, `${type}: "${text}"`);
        assert.doesNotMatch(text, /\d[.,]\d/, `${type}: "${text}"`);
      }
    }
  });

  it("título e descrição saem do modelo, sem o nome do cliente nem o ator", () => {
    for (const type of COMERCIAL_EVENT_TYPES) {
      const event = buildComercialEvent({
        operation_id: "op_teste",
        type,
        entity_id: "e1",
        customer_code: "BTG Pactual",
        payload: EXEMPLOS[type] as never,
        actor: equipe,
      });
      for (const text of [event.title, event.description]) {
        assert.ok(!text.includes("BTG"), `${type}: "${text}"`);
        assert.ok(!text.includes("Guilherme"), `${type}: "${text}"`);
        assert.ok(!text.includes("@"), `${type}: "${text}"`);
      }
    }
  });

  it("nenhum tipo contém as palavras do roteador de avisos do WMS", () => {
    const words = wmsNoticeWords();
    // Se a leitura quebrar, o teste não pode passar em branco.
    for (const expected of ["order", "invoice", "receb", "inventory", "billing"]) {
      assert.ok(words.includes(expected), `palavra "${expected}" não encontrada no roteador: ${words.join(", ")}`);
    }
    for (const type of COMERCIAL_EVENT_TYPES) {
      for (const word of words) {
        assert.ok(!type.toLowerCase().includes(word), `${type} contém "${word}"`);
      }
    }
  });

  it("todo tipo usa um prefixo do Comercial", () => {
    for (const type of COMERCIAL_EVENT_TYPES) {
      assert.ok(
        PREFIXOS.some((prefix) => type.startsWith(prefix)),
        `${type} fora dos prefixos do Comercial`,
      );
    }
  });
});

describe("evento gravado", () => {
  const base = {
    operation_id: "op_quote_send_abc",
    type: "quote.sent" as const,
    entity_id: "10045",
    customer_code: "BTG Pactual",
    payload: { numero: "10045", rv: 1, edicao: 3 },
    actor: equipe,
    occurred_at: "2026-10-20T13:00:00.000Z",
  };

  it("severity info, source do Comercial, customer_code real, occurred_at ISO e entity_type do tipo", () => {
    const event = buildComercialEvent(base);
    assert.equal(event.severity, "info");
    assert.equal(event.source, COMERCIAL_EVENT_SOURCE);
    assert.equal(COMERCIAL_EVENT_SOURCE, "functions_comercial");
    assert.equal(event.customer_code, "BTG Pactual");
    assert.equal(event.occurred_at, "2026-10-20T13:00:00.000Z");
    assert.equal(event.entity_type, "quote");
    assert.equal(event.entity_id, "10045");
    assert.equal(event.operation_id, "op_quote_send_abc");
    assert.equal(event.title, "Orçamento 10045 – RV01 enviado ao cliente");
    assert.deepEqual(event.payload, { numero: "10045", rv: 1, edicao: 3 });
    assert.deepEqual(event.actor, { uid: "com-1", role: "comercial", name: "Guilherme", email: "comercial@dutelog.com.br" });
    assert.equal("created_at" in event, false, "created_at é serverTimestamp, posto só na gravação");
  });

  it("sem occurred_at, usa a hora atual em ISO", () => {
    const { occurred_at: _ignored, ...input } = base;
    const event = buildComercialEvent(input);
    assert.match(String(event.occurred_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("id determinístico pela operação e pelo sufixo", () => {
    const id = comercialEventId("op_a", "sent");
    assert.match(id, /^evt_[0-9a-f]{32}$/);
    assert.equal(comercialEventId("op_a", "sent"), id);
    assert.notEqual(comercialEventId("op_a", "approved"), id);
    assert.notEqual(comercialEventId("op_b", "sent"), id);
    assert.equal(buildComercialEvent(base).id, comercialEventId(base.operation_id, base.type));
    assert.equal(buildComercialEvent({ ...base, suffix: "extra" }).id, comercialEventId(base.operation_id, "extra"));
  });

  it("payload fora do contrato é recusado", () => {
    assert.throws(
      () => buildComercialEvent({ ...base, payload: { ...base.payload, total_cents: 150000 } as never }),
      (error: unknown) => error instanceof HttpsError && error.code === "internal" && /quote\.sent/.test(error.message),
    );
    assert.throws(() => buildComercialEvent({ ...base, payload: { numero: "10045" } as never }), HttpsError);
  });

  it("tipo desconhecido é recusado", () => {
    assert.throws(() => buildComercialEvent({ ...base, type: "quote.order_recorded" } as never), HttpsError);
  });

  it("evento de cliente exige customer_code; só a tabela sem contrato pode não ter cliente", () => {
    assert.throws(() => buildComercialEvent({ ...base, customer_code: null }), HttpsError);
    assert.throws(() => buildComercialEvent({ ...base, customer_code: "  " }), HttpsError);
    const padrao = {
      operation_id: "op_table",
      type: "price_table.imported" as const,
      entity_id: "padrao-dutelog-2026",
      customer_code: null,
      payload: {
        tabela_id: "padrao-dutelog-2026",
        variante: "comercial" as const,
        linhas: 80,
        vigencia_inicio: "2026-01-01",
        vigencia_fim: null,
      },
      actor: equipe,
    };
    assert.equal(buildComercialEvent(padrao).customer_code, null);
    assert.equal(buildComercialEvent({ ...padrao, payload: { ...padrao.payload, contrato_id: null } }).customer_code, null);
    // Tabela com contrato é de um cliente.
    const doContrato = {
      ...padrao,
      entity_id: "itau-v2-comercial",
      payload: { ...padrao.payload, tabela_id: "itau-v2-comercial", contrato_id: "itau-2026" },
    };
    assert.throws(
      () => buildComercialEvent(doContrato),
      (error: unknown) => error instanceof HttpsError && /sem customer_code/.test(error.message),
    );
    assert.equal(buildComercialEvent({ ...doContrato, customer_code: "ITAU" }).customer_code, "ITAU");
  });

  it("occurred_at fora do ISO em UTC com milissegundos é recusado", () => {
    for (const occurred_at of [
      "21/10/2026 R$ 1.500,00",
      "2026-10-21",
      "2026-10-21T10:00:00-03:00",
      "2026-10-21T13:00:00Z",
      "2026-13-01T00:00:00.000Z",
      "",
    ]) {
      assert.throws(
        () => buildComercialEvent({ ...base, occurred_at }),
        (error: unknown) => error instanceof HttpsError && /occurred_at/.test(error.message),
        occurred_at,
      );
    }
    assert.equal(
      buildComercialEvent({ ...base, occurred_at: "2026-10-21T13:00:00.123Z" }).occurred_at,
      "2026-10-21T13:00:00.123Z",
    );
  });

  it("perda sem motivo livre: o motivo entra com a lista, na parte 10", () => {
    assert.throws(
      () =>
        buildComercialEvent({
          ...base,
          type: "demand.lost",
          payload: { numero: "10045", etapa_antes: "aguardando_cliente", motivo: "fulano_achou_caro_acima_de_1500_reais" } as never,
        }),
      HttpsError,
    );
  });

  it("o ator é sempre alguém da equipe", () => {
    assert.throws(
      () => buildComercialEvent({ ...base, actor: { uid: "cli-1", role: "cliente", name: "Cristiane" } }),
      (error: unknown) => error instanceof HttpsError && error.code === "permission-denied",
    );
  });

  it("entity_id fora do formato de id é recusado", () => {
    assert.throws(() => buildComercialEvent({ ...base, entity_id: "R$ 1.500,00" }), HttpsError);
  });
});
