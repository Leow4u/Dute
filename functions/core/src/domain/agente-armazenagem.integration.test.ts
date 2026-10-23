import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";

import { FERRAMENTAS_DA_ARMAZENAGEM } from "./agente-armazenagem.js";
import { DADOS_DA_ARMAZENAGEM } from "./agente-dados.test.js";
import { modulosDoEscopo, type EscopoDoAgente } from "./agente-escopo.js";
import { executarFerramenta } from "./agente-ferramentas.js";
import { leitorDoAgente } from "./agente-leitor.js";

/**
 * As ferramentas da Armazenagem no emulador (parte 5.5c): as consultas de
 * verdade, com o cliente primeiro, o período do razão com a ordem e os
 * instantes gravados como Timestamp. Nenhuma devolve dado do outro cliente.
 * Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-core";
const AGORA = new Date("2026-10-23T15:00:00.000Z");

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "core-agente-armazenagem-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

/** Os instantes `*_at` vão como Timestamp, como as callables gravam. */
function gravado(dados: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(dados).map(([chave, valor]) => [chave, chave.endsWith("_at") && typeof valor === "string" ? Timestamp.fromDate(new Date(valor)) : valor]));
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  for (const [colecao, documentos] of Object.entries(DADOS_DA_ARMAZENAGEM)) {
    for (const [id, dados] of Object.entries(documentos)) batch.set(db.collection(colecao).doc(id), gravado(dados));
  }
  await batch.commit();
});

function escopo(role: "cliente" | "owner", customerCode: string): EscopoDoAgente {
  return {
    uid: `${role}-1`,
    role,
    nome: null,
    audiencia: role === "cliente" ? "cliente" : "equipe",
    customerCode,
    modulo: "wms",
    modulos: modulosDoEscopo(role, ["wms", "financeiro"]),
    leValor: false,
    modeloDeOperacao: "uniformes",
  };
}

const ENTRADAS: Record<string, unknown> = {
  buscar_itens: { texto: "polo" },
  ver_pedido: { referencia: "PED-0043" },
  movimentacoes: { de: "2026-10-01", ate: "2026-10-23" },
  enderecos: { texto: "polo" },
};

async function rodar(nome: string, alvo: EscopoDoAgente, entrada: unknown = ENTRADAS[nome] ?? {}) {
  const item = FERRAMENTAS_DA_ARMAZENAGEM.find((ferramenta) => ferramenta.nome === nome)!;
  return executarFerramenta(item, { leitor: leitorDoAgente(db, alvo), escopo: alvo, agora: AGORA }, entrada) as Promise<Record<string, any>>;
}

describe("as ferramentas da Armazenagem no banco", () => {
  it("todas respondem com as consultas de verdade, sem o outro cliente", async () => {
    for (const item of FERRAMENTAS_DA_ARMAZENAGEM) assert.doesNotMatch(JSON.stringify(await rodar(item.nome, escopo("owner", "ITAU"))), /SAFRA/, item.nome);
  });

  it("o razão do período vem pelo cliente, na ordem, e os instantes voltam em ISO", async () => {
    const periodo = await rodar("movimentacoes", escopo("cliente", "ITAU"));
    assert.deepEqual([periodo.pecas_que_entraram, periodo.pecas_que_sairam], [10, 3]);
    const daSafra = await rodar("movimentacoes", escopo("cliente", "SAFRA"));
    assert.deepEqual([daSafra.pecas_que_entraram, daSafra.pecas_que_sairam], [0, 500]);
    const lista = await rodar("listar_pedidos", escopo("cliente", "ITAU"), {});
    assert.deepEqual(
      lista.pedidos.map((pedido: Record<string, unknown>) => [pedido.numero, pedido.atualizado_em]),
      [
        ["PED-0043", "2026-10-22T12:00:00.000Z"],
        ["PED-0044", "2026-10-21T12:00:00.000Z"],
      ],
    );
  });

  it("o outro cliente vê só o dele", async () => {
    const resumo = await rodar("resumo_estoque", escopo("cliente", "SAFRA"));
    assert.deepEqual([resumo.itens, resumo.pecas_em_estoque], [1, 900]);
    assert.deepEqual(await rodar("ver_pedido", escopo("cliente", "SAFRA")), { encontrado: false });
    const fila = await rodar("fila_solicitacoes", escopo("owner", "SAFRA"));
    assert.deepEqual([fila.aguardando_aprovacao, fila.solicitacoes[0].dias_esperando], [1, 22]);
  });
});
