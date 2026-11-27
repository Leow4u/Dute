import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Timestamp } from "firebase-admin/firestore";
import { z } from "genkit";

import {
  CancelarEdicaoSchema,
  CriarEdicaoSchema,
  PatchDaEdicaoSchema,
  camposDoPatchPermitidos,
  entradaDe,
  entradaDoSalvar,
  problemaDaFormaDoCronograma,
  problemaDoPatch,
  problemaParaEnviar,
  viewDaEdicao,
  type EdicaoView,
} from "./edicao.js";

/**
 * As entradas da edição do evento (eventos, parte 2), sem o banco: os
 * schemas estritos, a recusa que diz o campo e o limite, o que cada status e
 * papel muda, o que falta para enviar e a leitura do documento.
 */

const EDICAO = "ced_0123456789abcdef";

function recusa(fn: () => unknown, mensagem: string) {
  assert.throws(fn, (erro: unknown) => {
    const { code, message } = erro as { code?: string; message?: string };
    assert.equal(code, "invalid-argument");
    assert.equal(message, mensagem);
    return true;
  });
}

function recusaSemFrase(fn: () => unknown) {
  assert.throws(fn, (erro: unknown) => (erro as { code?: string }).code === "invalid-argument");
}

const momento = (tipo: string, data: string, hora = "08:00", extra: Record<string, unknown> = {}) => ({ tipo, data, hora, ...extra });

function patch(conteudo: Record<string, unknown>) {
  return { id: EDICAO, expected_edicao: 3, patch: conteudo };
}

function vista(overrides: Partial<EdicaoView> = {}): EdicaoView {
  return viewDaEdicao(EDICAO, {
    customer_code: "BTG Pactual",
    event_id: "cve_fedcba9876543210",
    event_name: "B2B Conference Necton",
    status: "rascunho",
    edicao: 3,
    onde: { local: "Hotel Unique", endereco: "Av. Brigadeiro Luís Antônio, 4700", contato: { nome: null, telefone: null } },
    cronograma: [
      { id: "mo_00000001", tipo: "entrega_no_local", previsto: { data: "2027-01-27", hora: "08:30" }, feito: null },
      { id: "mo_00000002", tipo: "evento", previsto: { data: "2027-01-28", hora: "08:00" }, feito: null },
      { id: "mo_00000003", tipo: "retorno_ao_estoque", previsto: { data: "2027-01-30", hora: "09:00" }, feito: null },
    ],
    itens: [{ sku_code: "BTG-000001", product_name: "Polo Masculino Piquet Preto", quantity: 700 }],
    coleta: { quantidade: 0 },
    ...overrides,
  });
}

describe("entradaDe: a recusa diz o campo e o limite", () => {
  it("a observação de 301 caracteres no segundo momento diz o momento", () => {
    recusa(
      () =>
        entradaDe(
          PatchDaEdicaoSchema,
          patch({ cronograma: [momento("entrega_no_local", "2027-01-27"), momento("montagem", "2027-01-27", "10:00", { observacao: "x".repeat(301) })] }),
        ),
      "A observação de Montagem passa de 300 caracteres",
    );
  });

  it("o mapa da chamada prevalece sobre o global", () => {
    recusa(
      () => entradaDe(z.object({ observacao: z.string().max(300) }).strict(), { observacao: "x".repeat(301) }, { observacao: "A observação do momento" }),
      "A observação do momento passa de 300 caracteres",
    );
  });

  it("a observação da edição cabe 2000 caracteres: a de 418 da Necton passa, a de 2001 recusa", () => {
    const entrada = entradaDe(PatchDaEdicaoSchema, patch({ observacoes: "o".repeat(418) }));
    assert.equal(entrada.patch.observacoes?.length, 418);
    recusa(() => entradaDe(PatchDaEdicaoSchema, patch({ observacoes: "o".repeat(2001) })), "As observações para a Dutelog passam de 2000 caracteres");
  });

  it("sem o nome do evento e sem um evento, a criação recusa", () => {
    recusa(() => entradaDe(CriarEdicaoSchema, { idempotency_key: "edicao-0001" }), "Informe o nome do evento");
    recusa(() => entradaDe(CriarEdicaoSchema, { idempotency_key: "edicao-0001", name: "   " }), "Informe o nome do evento");
    assert.equal(entradaDe(CriarEdicaoSchema, { idempotency_key: "edicao-0001", name: "B2B Conference Necton" }).name, "B2B Conference Necton");
    assert.equal(entradaDe(CriarEdicaoSchema, { idempotency_key: "edicao-0001", event_id: "cve_fedcba9876543210" }).event_id, "cve_fedcba9876543210");
  });

  it("os itens, o cronograma e os textos dizem o limite de cada um", () => {
    const item = (n: number) => ({ sku_code: `BTG-${String(n).padStart(6, "0")}`, product_name: `Item ${n}`, quantity: 1 });
    recusa(() => entradaDe(PatchDaEdicaoSchema, patch({ itens: Array.from({ length: 101 }, (_, n) => item(n + 1)) })), "A edição leva até 100 itens");
    recusa(
      () => entradaDe(PatchDaEdicaoSchema, patch({ cronograma: Array.from({ length: 13 }, (_, n) => momento("outro", "2027-01-28", "08:00", { rotulo: `Outro ${n}` })) })),
      "O cronograma leva até 12 momentos",
    );
    recusa(() => entradaDe(PatchDaEdicaoSchema, patch({ onde: { local: "l".repeat(161) } })), "O local passa de 160 caracteres");
    recusa(() => entradaDe(PatchDaEdicaoSchema, patch({ onde: { contato: { telefone: "1".repeat(41) } } })), "O telefone do contato passa de 40 caracteres");
    recusa(
      () => entradaDe(PatchDaEdicaoSchema, patch({ itens: [{ sku_code: "BTG-000001", product_name: "Polo Masculino Piquet Preto", quantity: 1_000_001 }] })),
      "A quantidade de Polo Masculino Piquet Preto passa de 1.000.000",
    );
    recusa(() => entradaDe(PatchDaEdicaoSchema, patch({ cronograma: [momento("montagem", "27/01/2027")] })), "A data de Montagem inválida");
    recusa(() => entradaDe(PatchDaEdicaoSchema, patch({ cronograma: [{ tipo: "montagem", data: "2027-01-27" }] })), "Informe a hora de Montagem");
    recusa(() => entradaDe(PatchDaEdicaoSchema, patch({ evento: { name: "n".repeat(121) } })), "O nome do evento passa de 120 caracteres");
  });

  it("campo fora do schema recusa, também a observação da coleta, que saiu", () => {
    recusaSemFrase(() => entradaDe(PatchDaEdicaoSchema, { ...patch({}), extra: 1 }));
    recusaSemFrase(() => entradaDe(PatchDaEdicaoSchema, patch({ coleta: { quantidade: 2190, observacao: "Buscar no BTG" } })));
    recusaSemFrase(() => entradaDe(CancelarEdicaoSchema, { id: EDICAO, idempotency_key: "cancelar-0001", status: "cancelado" }));
  });

  it("o id do momento é mo_ e 8 hex", () => {
    recusaSemFrase(() => entradaDe(PatchDaEdicaoSchema, patch({ cronograma: [momento("evento", "2027-01-28", "08:00", { id: "mo_xyz" })] })));
    const entrada = entradaDe(PatchDaEdicaoSchema, patch({ cronograma: [momento("evento", "2027-01-28", "08:00", { id: "mo_0a1b2c3d" })] }));
    assert.equal(entrada.patch.cronograma?.[0]?.id, "mo_0a1b2c3d");
  });

  it("o patch traz só os campos que vieram: o ausente não vira null", () => {
    const entrada = entradaDe(PatchDaEdicaoSchema, patch({ observacoes: "Montagem com 2 estoquistas" }));
    assert.deepEqual(Object.keys(entrada.patch), ["observacoes"]);
  });

  it("entradaDoSalvar escolhe o patch quando há id, e a criação sem ele", () => {
    assert.equal("expected_edicao" in entradaDoSalvar(patch({ label: "2027" })), true);
    assert.equal("idempotency_key" in entradaDoSalvar({ idempotency_key: "edicao-0001", name: "B2B Conference Necton" }), true);
    recusa(() => entradaDoSalvar({ id: EDICAO, patch: {} }), "Informe a versão da edição");
  });
});

describe("o que cada status e papel muda no patch", () => {
  const TODOS = ["label", "onde", "cronograma", "itens", "coleta", "observacoes", "evento"];

  it("o rascunho, para o cliente e a coordenação, muda tudo menos o separar até", () => {
    assert.deepEqual([...camposDoPatchPermitidos("rascunho", "cliente")], TODOS);
    assert.deepEqual([...camposDoPatchPermitidos("rascunho", "interno")], TODOS);
  });

  it("depois do envio, só a coordenação muda, e cada vez menos", () => {
    assert.deepEqual([...camposDoPatchPermitidos("enviado", "cliente")], []);
    assert.deepEqual([...camposDoPatchPermitidos("enviado", "owner")], ["label", "onde", "cronograma", "evento"]);
    assert.deepEqual([...camposDoPatchPermitidos("confirmado", "interno")], ["label", "onde", "cronograma", "separar_ate", "evento"]);
    assert.deepEqual([...camposDoPatchPermitidos("separado", "admin")], ["separar_ate"]);
    assert.deepEqual([...camposDoPatchPermitidos("no_evento", "admin")], []);
    assert.deepEqual([...camposDoPatchPermitidos("rascunho", "wms")], []);
  });

  it("a recusa diz o que não muda", () => {
    assert.equal(problemaDoPatch("enviado", "interno", { itens: [] }), "Os itens não mudam depois do envio");
    assert.equal(problemaDoPatch("rascunho", "cliente", { separar_ate: "2027-01-26" }), "O separar até nasce na confirmação");
    assert.equal(problemaDoPatch("enviado", "interno", { separar_ate: "2027-01-26" }), "O separar até nasce na confirmação");
    assert.equal(problemaDoPatch("enviado", "cliente", { observacoes: "Mais um estoquista" }), "A edição não aceita mudança neste status");
    assert.equal(problemaDoPatch("fechado", "admin", {}), "A edição não aceita mudança neste status");
    assert.equal(problemaDoPatch("confirmado", "interno", { separar_ate: "2027-01-26", label: "2027" }), null);
    assert.equal(problemaDoPatch("rascunho", "cliente", { itens: [], observacoes: null }), null);
  });
});

describe("o cronograma gravado: cada tipo fixo uma vez, até cinco outros", () => {
  it("recusa o tipo fixo repetido e o sexto outro", () => {
    const outro = (n: number) => ({ tipo: "outro" as const, rotulo: `Outro ${n}`, data: "2027-01-28", hora: "08:00" });
    assert.equal(
      problemaDaFormaDoCronograma([
        { tipo: "montagem", data: "2027-01-27", hora: "10:00" },
        { tipo: "montagem", data: "2027-01-27", hora: "11:00" },
      ]),
      "O momento Montagem se repete",
    );
    assert.equal(problemaDaFormaDoCronograma(Array.from({ length: 6 }, (_, n) => outro(n))), "O cronograma leva até cinco momentos do tipo outro");
    assert.equal(problemaDaFormaDoCronograma([...Array.from({ length: 5 }, (_, n) => outro(n)), { tipo: "evento", data: "2027-01-28", hora: "08:00" }]), null);
  });
});

describe("problemaParaEnviar", () => {
  it("pede o local, depois um item ou a coleta, depois o cronograma", () => {
    assert.equal(problemaParaEnviar(vista({ onde: { local: null, endereco: null, contato: { nome: null, telefone: null } } })), "Informe o local");
    assert.equal(problemaParaEnviar(vista({ itens: [] })), "Escolha ao menos um item ou informe a coleta no cliente");
    assert.equal(problemaParaEnviar(vista({ cronograma: vista().cronograma.filter((m) => m.tipo !== "evento") })), "Informe a data do evento");
    assert.equal(problemaParaEnviar(vista()), null);
  });

  it("só com a coleta, pede a data da coleta no cliente e não pede a entrega", () => {
    const soColeta = vista({ itens: [], coleta: { onde: "BTG Faria Lima", quantidade: 2190, voltou: null, distribuidos: null }, cronograma: [vista().cronograma[1]!] });
    assert.equal(problemaParaEnviar(soColeta), "Informe a data da coleta no cliente");
  });
});

describe("viewDaEdicao", () => {
  it("converte os carimbos em ISO, os ausentes em null, com o separar até na raiz e o id de cada momento", () => {
    const criada = new Date("2026-11-26T14:32:00.000Z");
    const view = viewDaEdicao(EDICAO, {
      customer_code: "BTG Pactual",
      event_id: "cve_fedcba9876543210",
      event_name: "B2B Conference Necton",
      status: "rascunho",
      edicao: 1,
      cronograma: [{ id: "mo_0a1b2c3d", tipo: "evento", previsto: { data: "2027-01-28", hora: "08:00", ate: "20:00" }, feito: null }],
      created_by: { uid: "cli-1", name: "Cristiane", role: "cliente" },
      created_at: Timestamp.fromDate(criada),
      updated_at: criada,
    });
    assert.equal(view.id, EDICAO);
    assert.equal(view.created_at, "2026-11-26T14:32:00.000Z");
    assert.equal(view.updated_at, "2026-11-26T14:32:00.000Z");
    assert.equal(view.enviada_em, null);
    assert.equal(view.separar_ate, null);
    assert.equal(view.pedido, null);
    assert.equal(view.retorno, null);
    assert.equal(view.label, null);
    assert.deepEqual(view.onde, { local: null, endereco: null, contato: { nome: null, telefone: null } });
    assert.deepEqual(view.coleta, { onde: null, quantidade: 0, voltou: null, distribuidos: null });
    assert.deepEqual(view.itens, []);
    assert.deepEqual(view.documentos, []);
    assert.deepEqual(view.fotos, []);
    assert.deepEqual(view.equipe, { estoquistas: null, do_cliente: null, veiculo: null, contato_no_local: null });
    assert.deepEqual(view.created_by, { uid: "cli-1", name: "Cristiane", role: "cliente" });
    assert.deepEqual(view.cronograma, [
      { id: "mo_0a1b2c3d", tipo: "evento", rotulo: null, previsto: { data: "2027-01-28", hora: "08:00", ate: "20:00", local: null, observacao: null }, feito: null },
    ]);
  });

  it("o separar até é da raiz, nunca do pedido", () => {
    const view = viewDaEdicao(EDICAO, { status: "confirmado", separar_ate: "2027-01-26", pedido: { request_id: "creq_1", separar_ate: "2027-01-01" } });
    assert.equal(view.separar_ate, "2027-01-26");
    assert.equal(view.pedido?.request_id, "creq_1");
    assert.equal("separar_ate" in (view.pedido ?? {}), false);
  });
});
