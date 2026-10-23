import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { rodarArmazenagem, type ResultadoDaArmazenagem } from "./armazenagem.js";
import { rodarCarga } from "./tabela.js";

/**
 * Levar a LPU de cobrança do WMS ao Comercial no emulador (parte 7.3b):
 * exportar escreve o CSV sem gravar nada; a carga de tabela cria a tabela
 * Armazenagem; ligar em dry-run não grava; com --executar liga cada item ao
 * da tabela, com o evento e o recibo; repetir não duplica; o preço mudado
 * depois e a tabela que não cobre a competência a emitir param sem gravar.
 */

const PROJECT_ID = "demo-dute-comercial";
const BTG = "BTG Pactual";
const AGORA = () => new Date("2026-10-23T15:00:00.000Z");

let db: Firestore;
let app: ReturnType<typeof initializeApp>;
const pasta = mkdtempSync(join(tmpdir(), "dute-armazenagem-int-"));

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "comercial-armazenagem-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
  rmSync(pasta, { recursive: true, force: true });
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const lote = db.batch();
  lote.set(db.doc("customers/BTG_Pactual"), { code: BTG, customer_code: BTG, name: BTG });
  const lpu: Array<[string, Record<string, unknown>]> = [
    ["btg_1", { id: 1, customer_code: BTG, grupo: "Armazenagem", item: "Ad valorem", valor_unit: 0, auto_source: "ad_valorem", ordem: 1 }],
    ["btg_2", { id: 2, customer_code: BTG, grupo: "Movimentação", item: "Entrada por peça", valor_unit: 1.25, auto_source: "mov_entrada_pecas", ordem: 2 }],
    ["btg_4", { id: 4, grupo: "Movimentação", item: "Movimento", valor_unit: 0.5, auto_source: "mov_count", ordem: 4 }],
    ["btg_7", { id: 7, customer_code: BTG, grupo: "Serviços", item: "Hora extra", unidade: "h", valor_unit: 3.333, ordem: 7 }],
    ["safra_1", { id: 1, customer_code: "Banco Safra", grupo: "Movimentação", item: "Entrada por peça", valor_unit: 1, ordem: 1 }],
  ];
  for (const [id, item] of lpu) lote.set(db.collection("billing_price_list").doc(id), item);
  // Setembro está emitido: a tabela desde 01/10 só precisa cobrir outubro.
  lote.set(db.doc("billing_periods/BTG_Pactual__2026-09"), { customer_code: BTG, competencia: "2026-09", status: "emitido" });
  await lote.commit();
});

const deps = (log: string[] = []) => ({
  abrirBanco: () => db,
  pastaDoArquivo: pasta,
  pastaDoRelatorio: pasta,
  env: { FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST },
  agora: AGORA,
  log: (linha: string) => log.push(linha),
});

const armazenagem = (...argv: string[]) => rodarArmazenagem(["--cliente", BTG, "--projeto", PROJECT_ID, ...argv], deps());

async function tabelaCarregada(vigenteDe: string): Promise<string> {
  const exportado = await armazenagem("--exportar");
  assert.equal(exportado.ok, true, exportado.erros.join(" "));
  const carga = await rodarCarga(
    ["--arquivo", exportado.arquivo as string, "--nome", "Armazenagem BTG", "--variante", "Armazenagem", "--cliente", BTG, "--vigente-de", vigenteDe, "--projeto", PROJECT_ID, "--executar"],
    { ...deps(), raizDoRepositorio: join(pasta, "fora") },
  );
  assert.equal(carga.ok, true, carga.erros.join(" "));
  return carga.tabela_id as string;
}

const ligados = async () =>
  Object.fromEntries((await db.collection("billing_price_list").get()).docs.map((doc) => [doc.id, doc.get("lpu_item_id") ?? null]));

describe("levar a cobrança do WMS ao Comercial (parte 7.3b)", () => {
  it("exportar escreve o CSV da carga com os itens do cliente e não grava nada", async () => {
    const resultado = await armazenagem("--exportar");
    assert.deepEqual([resultado.ok, resultado.itens, resultado.gravou], [true, 3, false]);
    const linhas = readFileSync(resultado.arquivo as string, "utf8").trim().split("\n");
    assert.deepEqual(linhas, [
      "codigo;categoria;item;servico;descricao;unidade;preco",
      "WMS-2;Armazenagem;Entrada por peça;Movimentação;Entrada por peça;UN;1.25",
      "WMS-4;Armazenagem;Movimento;Movimentação;Movimento;UN;0.5",
      "WMS-7;Armazenagem;Hora extra;Serviços;Hora extra;h;3.333",
    ]);
    assert.equal((await db.collection("price_tables").get()).size, 0);
    assert.deepEqual(Object.values(await ligados()).filter(Boolean), []);
  });

  it("ligar em dry-run não grava; com --executar liga cada item, com o evento; repetir não duplica", async () => {
    const tabela = await tabelaCarregada("2026-10-01");
    const ensaio: ResultadoDaArmazenagem = await armazenagem("--ligar", "--tabela", tabela);
    assert.deepEqual([ensaio.ok, ensaio.ligados, ensaio.gravou], [true, 3, false]);
    assert.deepEqual(Object.values(await ligados()).filter(Boolean), []);

    const feito = await armazenagem("--ligar", "--tabela", tabela, "--executar");
    assert.deepEqual([feito.ok, feito.ligados, feito.gravou], [true, 3, true]);
    const precos = (await db.collection("price_tables").doc(tabela).get()).get("precos") as Record<string, { codigo: string; preco: string }>;
    const porCodigo = Object.fromEntries(Object.entries(precos).map(([lpuItemId, preco]) => [preco.codigo, lpuItemId]));
    assert.deepEqual(await ligados(), { btg_1: null, btg_2: porCodigo["WMS-2"], btg_4: porCodigo["WMS-4"], btg_7: porCodigo["WMS-7"], safra_1: null });
    // O preço da tabela é o do WMS: a fatura calcula igual (a régua da 7.1 no WMS).
    assert.deepEqual(Object.values(precos).map((preco) => [preco.codigo, preco.preco]).sort(), [["WMS-2", "1.25"], ["WMS-4", "0.5"], ["WMS-7", "3.333"]]);
    const eventos = (await db.collection("events").where("type", "==", "price_table.wms_linked").get()).docs.map((doc) => doc.data());
    assert.deepEqual(eventos.map((evento) => [evento.customer_code, evento.entity_id, evento.payload.itens]), [[BTG, tabela, 3]]);

    const deNovo = await armazenagem("--ligar", "--tabela", tabela, "--executar");
    assert.deepEqual([deNovo.ok, deNovo.ligados, deNovo.ja_ligados, deNovo.gravou], [true, 0, 3, false]);
    assert.equal((await db.collection("events").where("type", "==", "price_table.wms_linked").get()).size, 1);
  });

  it("o preço mudado no WMS depois da exportação e a tabela que não cobre a competência a emitir param sem gravar", async () => {
    const tabela = await tabelaCarregada("2026-10-01");
    await db.collection("billing_price_list").doc("btg_7").update({ valor_unit: 3.5 });
    const mudou = await armazenagem("--ligar", "--tabela", tabela, "--executar");
    assert.equal(mudou.ok, false);
    assert.match(mudou.erros.join(" "), /Hora extra no WMS \(3\.5\) não é o da tabela \(3\.333\)/);

    await db.collection("billing_price_list").doc("btg_7").update({ valor_unit: 3.333 });
    await db.doc("billing_periods/BTG_Pactual__2026-09").update({ status: "aberto" });
    const naoCobre = await armazenagem("--ligar", "--tabela", tabela, "--executar");
    assert.equal(naoCobre.ok, false);
    assert.match(naoCobre.erros.join(" "), /não cobre a competência 09\/2026/);
    assert.deepEqual(Object.values(await ligados()).filter(Boolean), []);
    assert.equal((await db.collection("events").where("type", "==", "price_table.wms_linked").get()).size, 0);
  });

  it("não grava onde a carga não grava", async () => {
    await assert.rejects(
      rodarArmazenagem(["--cliente", BTG, "--projeto", "dute-prod", "--ligar", "--tabela", "pt_0123456789abcdef", "--executar"], deps()),
      /não grava no projeto dute-prod/,
    );
  });
});
