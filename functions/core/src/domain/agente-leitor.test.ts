import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { COLECOES_COM_VALOR, COLECOES_DO_CLIENTE, LIMITE_DA_CONSULTA, leitorDoAgente, valorLimpo } from "./agente-leitor.js";

/**
 * O leitor do Agent Dute (parte 5.5b) num banco falso que anota cada
 * consulta e recusa qualquer gravação: a ferramenta não grava, não escolhe o
 * cliente e não lê o documento de outro. Dados sintéticos.
 */

type Chamada = { colecao: string; onde: unknown[][]; ordem: unknown[][]; limite: number | null };
type Doc = { id: string; dados: Record<string, unknown> };

const GRAVACOES = ["set", "update", "delete", "create", "add", "batch", "runTransaction", "bulkWriter", "recursiveDelete"];

function recusa(nome: string) {
  return () => {
    throw new Error(`gravação no banco: ${nome}`);
  };
}

function bancoFalso(documentos: Record<string, Doc[]>) {
  const chamadas: Chamada[] = [];
  const lidosPorId: string[] = [];
  function consulta(colecao: string, chamada: Chamada): Record<string, unknown> {
    const query: Record<string, unknown> = {
      where(campo: string, operador: string, valor: unknown) {
        chamada.onde.push([campo, operador, valor]);
        return query;
      },
      orderBy(campo: string, direcao: string) {
        chamada.ordem.push([campo, direcao]);
        return query;
      },
      limit(limite: number) {
        chamada.limite = limite;
        return query;
      },
      async get() {
        // O falso devolve tudo da coleção, de propósito: a segunda trava do leitor é que filtra.
        const docs = (documentos[colecao] ?? []).map((doc) => ({ id: doc.id, data: () => doc.dados, get: (campo: string) => doc.dados[campo] }));
        return { docs };
      },
    };
    for (const nome of GRAVACOES) query[nome] = recusa(nome);
    return query;
  }
  const db: Record<string, unknown> = {
    collection(colecao: string) {
      const chamada: Chamada = { colecao, onde: [], ordem: [], limite: null };
      chamadas.push(chamada);
      const ref = consulta(colecao, chamada);
      ref.doc = (id: string) => {
        const doc = (documentos[colecao] ?? []).find((item) => item.id === id);
        const docRef: Record<string, unknown> = {
          async get() {
            lidosPorId.push(`${colecao}/${id}`);
            return { exists: Boolean(doc), id, data: () => doc?.dados, get: (campo: string) => doc?.dados[campo] };
          },
        };
        for (const nome of GRAVACOES) docRef[nome] = recusa(nome);
        return docRef;
      };
      return ref;
    },
  };
  for (const nome of GRAVACOES) db[nome] = recusa(nome);
  return { db: db as unknown as Firestore, chamadas, lidosPorId };
}

const ESTOQUE: Doc[] = [
  { id: "itau_1", dados: { customer_code: "ITAU", sku_code: "ITAU-000001", saldo: 30 } },
  { id: "safra_1", dados: { customer_code: "SAFRA", sku_code: "SAFRA-000001", saldo: 9 } },
];

function falhaDoLeitor(padrao: RegExp) {
  return (erro: unknown) => erro instanceof HttpsError && erro.code === "internal" && padrao.test(erro.message);
}

describe("o leitor só lê", () => {
  it("não tem gravação, lote nem transação, e não se muda", () => {
    const { db } = bancoFalso({});
    const leitor = leitorDoAgente(db, { customerCode: "ITAU", audiencia: "equipe", leValor: false });
    assert.deepEqual(Object.keys(leitor).sort(), ["audiencia", "customerCode", "doCliente", "documento", "geral", "leValor"]);
    assert.equal(Object.isFrozen(leitor), true);
    assert.throws(() => {
      (leitor as unknown as Record<string, unknown>).customerCode = "SAFRA";
    });
  });

  it("toda consulta começa pelo cliente do escopo e leva o resto da ferramenta", async () => {
    const { db, chamadas } = bancoFalso({ client_inventory: ESTOQUE });
    const leitor = leitorDoAgente(db, { customerCode: "ITAU", audiencia: "cliente", leValor: true });
    const lidos = await leitor.doCliente("client_inventory", { onde: [["archived", "==", false]], ordem: [["sku_code", "asc"]], limite: 50 });
    assert.deepEqual(chamadas, [{ colecao: "client_inventory", onde: [["customer_code", "==", "ITAU"], ["archived", "==", false]], ordem: [["sku_code", "asc"]], limite: 50 }]);
    // O documento de outro cliente que a consulta deixasse passar cai na segunda trava.
    assert.deepEqual(lidos, [{ customer_code: "ITAU", sku_code: "ITAU-000001", saldo: 30, id: "itau_1" }]);
  });

  it("a ferramenta não filtra pelo cliente, não passa do limite e não lê fora da lista", async () => {
    const { db, chamadas } = bancoFalso({ client_inventory: ESTOQUE });
    const leitor = leitorDoAgente(db, { customerCode: "ITAU", audiencia: "equipe", leValor: false });
    await assert.rejects(leitor.doCliente("client_inventory", { onde: [["customer_code", "==", "SAFRA"]], limite: 10 }), falhaDoLeitor(/cliente vem do escopo/));
    for (const limite of [0, -1, 1.5, LIMITE_DA_CONSULTA + 1]) await assert.rejects(leitor.doCliente("client_inventory", { limite }), falhaDoLeitor(/limite/), String(limite));
    await assert.rejects(leitor.doCliente("users" as never, { limite: 10 }), falhaDoLeitor(/fora da lista/));
    await assert.rejects(leitor.doCliente("client_inventory", { onde: [["a b", "==", 1]], limite: 10 }), falhaDoLeitor(/campo inválido/));
    await assert.rejects(leitor.doCliente("client_inventory", { onde: [["saldo", "!=" as never, 0]], limite: 10 }), falhaDoLeitor(/operador inválido/));
    await assert.rejects(leitor.doCliente("client_inventory", { ordem: [["saldo", "up" as never]], limite: 10 }), falhaDoLeitor(/ordem inválida/));
    assert.equal(chamadas.filter((chamada) => chamada.limite !== null).length, 0);
  });

  it("o documento de outro cliente, o que não existe e o id com caminho voltam vazios", async () => {
    const { db, lidosPorId } = bancoFalso({ client_inventory: ESTOQUE });
    const leitor = leitorDoAgente(db, { customerCode: "ITAU", audiencia: "cliente", leValor: true });
    assert.deepEqual(await leitor.documento("client_inventory", "itau_1"), { customer_code: "ITAU", sku_code: "ITAU-000001", saldo: 30, id: "itau_1" });
    assert.equal(await leitor.documento("client_inventory", "safra_1"), null);
    assert.equal(await leitor.documento("client_inventory", "nao_existe"), null);
    for (const id of ["", "  ", "a/b", "x".repeat(201)]) assert.equal(await leitor.documento("client_inventory", id), null, id);
    assert.deepEqual(lidosPorId, ["client_inventory/itau_1", "client_inventory/safra_1", "client_inventory/nao_existe"]);
  });

  it("o geral só para a equipe, sempre com o filtro da coleção", async () => {
    const { db, chamadas } = bancoFalso({ ai_measures: [{ id: "m1", dados: { escopo: "geral", tipo: "duracao_item" } }] });
    const daEquipe = leitorDoAgente(db, { customerCode: "ITAU", audiencia: "equipe", leValor: false });
    assert.deepEqual(await daEquipe.geral("ai_measures", { onde: [["tipo", "==", "duracao_item"]], limite: 20 }), [{ escopo: "geral", tipo: "duracao_item", id: "m1" }]);
    assert.deepEqual(chamadas.at(-1)?.onde, [["escopo", "==", "geral"], ["tipo", "==", "duracao_item"]]);
    const doCliente = leitorDoAgente(db, { customerCode: "ITAU", audiencia: "cliente", leValor: true });
    await assert.rejects(doCliente.geral("ai_measures", { limite: 20 }), (erro: unknown) => erro instanceof HttpsError && erro.code === "permission-denied");
    await assert.rejects(daEquipe.geral("users" as never, { limite: 20 }), falhaDoLeitor(/fora da lista/));
  });

  it("o que tem valor só abre para quem lê valor, antes de consultar", async () => {
    const { db, chamadas, lidosPorId } = bancoFalso({ quotes: [{ id: "10050", dados: { customer_code: "ITAU", total_cents: 100 } }] });
    const semValor = leitorDoAgente(db, { customerCode: "ITAU", audiencia: "equipe", leValor: false });
    const negado = (erro: unknown) => erro instanceof HttpsError && erro.code === "permission-denied" && /não lê valor/.test(erro.message);
    for (const colecao of COLECOES_COM_VALOR.filter((nome) => (COLECOES_DO_CLIENTE as readonly string[]).includes(nome))) {
      await assert.rejects(semValor.doCliente(colecao as never, { limite: 1 }), negado, colecao);
      await assert.rejects(semValor.documento(colecao as never, "10050"), negado, colecao);
    }
    await assert.rejects(semValor.geral("price_tables", { limite: 1 }), negado);
    assert.deepEqual([chamadas.length, lidosPorId.length], [0, 0]);
    const comValor = leitorDoAgente(db, { customerCode: "ITAU", audiencia: "equipe", leValor: true });
    assert.deepEqual(await comValor.documento("quotes", "10050"), { customer_code: "ITAU", total_cents: 100, id: "10050" });
    assert.deepEqual([...COLECOES_COM_VALOR], ["quotes", "price_tables", "client_invoices", "client_faturas", "faturas", "ai_case_memory"]);
  });

  it("sem cliente no escopo, não há leitor", () => {
    const { db } = bancoFalso({});
    assert.throws(() => leitorDoAgente(db, { customerCode: "  ", audiencia: "equipe", leValor: false }), falhaDoLeitor(/sem cliente/));
  });

  it("nenhuma coleção da lista guarda acesso, papel ou convite", () => {
    for (const proibida of ["users", "invites", "client_access", "customers", "system_settings", "agent_usage", "collaborators", "vehicles"]) {
      assert.equal((COLECOES_DO_CLIENTE as readonly string[]).includes(proibida), false, proibida);
    }
  });
});

describe("o valor lido vai ao modelo em JSON puro", () => {
  it("o instante vira ISO, o número inválido vira vazio e o que não é dado some", () => {
    const instante = { toDate: () => new Date("2026-10-23T13:00:00.000Z") };
    class Referencia {}
    assert.deepEqual(valorLimpo({ quando: instante, lista: [instante, 1, Number.NaN], ref: new Referencia(), f: () => 1, aninhado: { data: new Date("2026-10-20T00:00:00.000Z"), ok: true } }), {
      quando: "2026-10-23T13:00:00.000Z",
      lista: ["2026-10-23T13:00:00.000Z", 1, null],
      aninhado: { data: "2026-10-20T00:00:00.000Z", ok: true },
    });
  });
});
