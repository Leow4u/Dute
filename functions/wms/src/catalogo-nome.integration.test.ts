import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { getFirestore } from "firebase-admin/firestore";

/**
 * O Catálogo (mutateManagedEntity, products e skus) com o padrão do nome de
 * 06/11/2026 (domain/nome-para-gravar.ts): o nome editado vai para o padrão e o
 * Tamanho para o do código; o que contradiz o código é recusado com a frase da
 * tela; editar outro campo de um produto cujo nome antigo ainda tem o tamanho
 * não trava nem renomeia (os nomes antigos mudam no passo 3).
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";

type Callable = { run: (request: never) => Promise<unknown> };

let mutate: Callable;
let serial = 0;

function salvar(resource: "products" | "skus", id: string, data: Record<string, unknown>) {
  serial += 1;
  return mutate.run({
    auth: { uid: "coordenacao-1", token: { email: "coordenacao@dutelog.com.br" } },
    data: { resource, action: "update", id, data, idempotency_key: `catalogo-nome-${serial}` },
    rawRequest: { headers: {} },
  } as never);
}

const db = () => getFirestore();

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  const modulo = (await import("./index.js")) as unknown as { mutateManagedEntity: Callable };
  mutate = modulo.mutateManagedEntity;
});

beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db().collection("users").doc("coordenacao-1").set({ role: "admin", nome: "Coordenação" });
  const comum = { customer_code: BTG, cod_cliente: "A.01.0806.005.XG", cod_cliente_key: "A.01.0806.005.XG", status: "active", archived: false };
  await db().collection("products").doc("A.01.0806.005.XG").set({ id: "A.01.0806.005.XG", ...comum, produto: "Polo masculino piquet preto - XG", cor: "Preto" });
  await db().collection("skus").doc("BTG-000126").set({ id: "BTG-000126", sku_code: "BTG-000126", cod_btg: "BTG-000126", ...comum, produto: "Polo masculino piquet preto - XG", cor: "Preto" });
});

describe("o Catálogo grava o nome no padrão (passo 2 da padronização)", () => {
  it("o nome editado vai para o padrão e o Tamanho vem do código", async () => {
    await salvar("products", "A.01.0806.005.XG", { cod_cliente: "A.01.0806.005.XG", produto: "polo masculina piquet preto", tamanho: "" });
    const produto = (await db().collection("products").doc("A.01.0806.005.XG").get()).data();
    assert.equal(produto?.produto, "Polo Masculino Piquet Preto");
    assert.equal(produto?.tamanho, "XG");
  });

  it("recusa o nome com o tamanho de outro código e o Tamanho que contradiz o código", async () => {
    await assert.rejects(
      salvar("skus", "BTG-000126", { cod_btg: "BTG-000126", cod_cliente: "A.01.0806.005.XG", produto: "Polo Masculino Piquet Preto M" }),
      /O nome termina em M, e o código A\.01\.0806\.005\.XG é do tamanho XG\./,
    );
    await assert.rejects(
      salvar("skus", "BTG-000126", { cod_btg: "BTG-000126", cod_cliente: "A.01.0806.005.XG", tamanho: "M" }),
      /O código A\.01\.0806\.005\.XG é do tamanho XG, e o Tamanho informado é M\./,
    );
    const sku = (await db().collection("skus").doc("BTG-000126").get()).data();
    assert.equal(sku?.produto, "Polo masculino piquet preto - XG");
  });

  it("editar a cor de um produto com o nome antigo não trava nem renomeia", async () => {
    await salvar("skus", "BTG-000126", { cod_btg: "BTG-000126", cod_cliente: "A.01.0806.005.XG", produto: "Polo masculino piquet preto - XG", cor: "Grafite" });
    const sku = (await db().collection("skus").doc("BTG-000126").get()).data();
    assert.equal(sku?.produto, "Polo masculino piquet preto - XG");
    assert.equal(sku?.cor, "Grafite");
  });
});
