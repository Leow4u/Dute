import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { registrarAditivo } from "../domain/contratos.js";
import { main } from "./contratos.js";

/**
 * Carga de contratos contra o emulador (projeto demo-*): dry-run com banco
 * não grava, --executar grava contratos e aditivos pelas operações das
 * callables, e rodar de novo o mesmo arquivo não muda nada. Usa o exemplo
 * sintético de docs/plataforma/comercial-cargas.md.
 */

const PROJECT_ID = "demo-dute-comercial";

type Exemplo = {
  contratos: Array<{ id: string; contrato: Record<string, unknown>; aditivos: Array<Record<string, unknown>> }>;
};

function exemplo(): Exemplo {
  const doc = readFileSync(fileURLToPath(new URL("../../../../docs/plataforma/comercial-cargas.md", import.meta.url)), "utf8");
  const match = doc.match(/<!-- exemplo-contratos -->\s*```json\s*([\s\S]*?)```/);
  assert.ok(match);
  return JSON.parse(match[1]) as Exemplo;
}

let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let pasta: string;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "comercial-carga-contratos-test");
  db = getFirestore(app);
  pasta = mkdtempSync(join(tmpdir(), "carga-contratos-int-"));
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await Promise.all([
    db.collection("customers").doc("exemplo").set({ code: "EXEMPLO", customer_code: "EXEMPLO", name: "Exemplo", status: "active" }),
    db.collection("customers").doc("prospect").set({ customer_code: "PROSP", name: "Prospect", stage: "prospect" }),
  ]);
});

after(async () => {
  await deleteApp(app);
  rmSync(pasta, { recursive: true, force: true });
});

function salvar(nome: string, json: unknown): string {
  const caminho = join(pasta, nome);
  writeFileSync(caminho, JSON.stringify(json), "utf8");
  return caminho;
}

async function tabelas() {
  for (const variante of ["comercial", "noturna"]) {
    await db.collection("price_tables").doc(`exemplo-2026-${variante}`).set({
      customer_code: "EXEMPLO",
      contract_id: "exemplo-2026",
      variante,
      vigente_de: "2026-06-30",
      vigente_ate: "2027-06-30",
    });
  }
}

async function rodar(arquivo: string, ...extra: string[]) {
  return main(["--arquivo", arquivo, "--projeto", PROJECT_ID, "--relatorio-dir", join(pasta, "relatorios"), ...extra], {
    db,
    log: () => undefined,
  });
}

async function count(path: string) {
  return (await db.collection(path).get()).size;
}

describe("carga de contratos no emulador", () => {
  it("dry-run com --projeto compara com o banco e não grava", async () => {
    const resultado = await rodar(salvar("dry.json", exemplo()));
    assert.equal(resultado.codigo, 1, "sem as tabelas, o aditivo de preço tem problema");
    const item = resultado.conteudo?.contratos[0];
    assert.equal(item?.acao, "criar");
    assert.deepEqual(item?.aditivos.map((aditivo) => aditivo.acao), ["registrar", "registrar"]);
    assert.match(String(item?.aditivos[1].problemas[0]), /Tabela exemplo-2026-comercial não encontrada/);
    assert.equal(await count("contracts"), 0);
    assert.equal(await count("events"), 0);
    assert.equal(await count("comercial_operations"), 0);
  });

  it("--executar grava contrato e aditivos; de novo, nada muda", async () => {
    await tabelas();
    const arquivo = salvar("executar.json", exemplo());
    const primeira = await rodar(arquivo, "--executar");
    assert.equal(primeira.codigo, 0, JSON.stringify(primeira.conteudo?.contratos));
    assert.equal(primeira.conteudo?.resumo.criar, 1);
    assert.equal(primeira.conteudo?.resumo.aditivos_registrar, 2);

    const contrato = (await db.collection("contracts").doc("exemplo-2026").get()).data() ?? {};
    assert.equal(contrato.customer_code, "EXEMPLO");
    assert.equal(contrato.vigente_de, "2026-07-01");
    assert.equal(contrato.vigente_ate, "2027-06-30");
    assert.equal(contrato.edicao, 1, "os dois aditivos são o histórico da vigência atual: nenhum prorroga");
    const aditivos = await db.collection("contracts/exemplo-2026/aditivos").get();
    assert.deepEqual(aditivos.docs.map((doc) => doc.id), ["1", "2"]);
    assert.equal(aditivos.docs[0].get("documento_localizado"), false);
    assert.deepEqual(aditivos.docs[1].get("tabela_ids"), ["exemplo-2026-comercial", "exemplo-2026-noturna"]);
    const eventos = await count("events");
    assert.equal(eventos, 3);
    const ator = (await db.collection("events").get()).docs[0].get("actor");
    assert.equal(ator.uid, "carga-contratos");

    const segunda = await rodar(arquivo, "--executar");
    assert.equal(segunda.codigo, 0);
    assert.equal(segunda.conteudo?.contratos[0].acao, "sem_mudanca");
    assert.deepEqual(segunda.conteudo?.contratos[0].aditivos.map((aditivo) => aditivo.acao), ["ja_registrado", "ja_registrado"]);
    assert.equal(await count("events"), eventos);
    assert.equal((await db.collection("contracts").doc("exemplo-2026").get()).get("edicao"), 1);

    const relatorio = JSON.parse(readFileSync(segunda.relatorio ?? "", "utf8"));
    assert.equal(relatorio.modo, "executar");
    assert.equal(relatorio.projeto, PROJECT_ID);
  });

  it("o arquivo com a vigência original é prorrogado pelos aditivos e não volta na segunda carga", async () => {
    await tabelas();
    const json = exemplo();
    json.contratos[0].contrato.vigente_de = "2024-07-01";
    json.contratos[0].contrato.vigente_ate = "2025-06-30";
    const arquivo = salvar("original.json", json);
    assert.equal((await rodar(arquivo, "--executar")).codigo, 0);
    const contrato = (await db.collection("contracts").doc("exemplo-2026").get()).data() ?? {};
    assert.equal(contrato.vigente_de, "2026-07-01");
    assert.equal(contrato.vigente_ate, "2027-06-30");
    assert.equal(contrato.edicao, 3);

    const segunda = await rodar(arquivo, "--executar");
    assert.equal(segunda.conteudo?.contratos[0].acao, "sem_mudanca");
    assert.equal((await db.collection("contracts").doc("exemplo-2026").get()).get("vigente_ate"), "2027-06-30");
  });

  it("aditivo registrado fora do arquivo (pela tela) continua valendo: a carga de novo não encurta a vigência", async () => {
    await tabelas();
    const arquivo = salvar("com-externo.json", exemplo());
    assert.equal((await rodar(arquivo, "--executar")).codigo, 0);
    const prorrogado = await registrarAditivo(db, { uid: "com-1", role: "comercial", name: "Comercial" }, {
      idempotency_key: "tela-5",
      contrato_id: "exemplo-2026",
      aditivo: { numero: 5, tipo: "prorrogacao", vigente_de: "2027-07-01", vigente_ate: "2028-06-30" },
    });
    assert.equal(prorrogado.vigencia_alterada, true);
    const eventos = await count("events");

    const dry = await rodar(arquivo);
    assert.equal(dry.codigo, 0);
    assert.equal(dry.conteudo?.contratos[0].acao, "sem_mudanca", JSON.stringify(dry.conteudo?.contratos[0]));
    const segunda = await rodar(arquivo, "--executar");
    assert.equal(segunda.codigo, 0);
    assert.equal(segunda.conteudo?.contratos[0].acao, "sem_mudanca");
    const contrato = (await db.collection("contracts").doc("exemplo-2026").get()).data() ?? {};
    assert.equal(contrato.vigente_de, "2027-07-01");
    assert.equal(contrato.vigente_ate, "2028-06-30");
    assert.equal(contrato.edicao, 2);
    assert.equal(await count("events"), eventos);
  });

  it("contrato encerrado: a vigência vem dos aditivos numa só carga, e os aditivos entram só no histórico", async () => {
    await tabelas();
    const json = exemplo();
    json.contratos[0].contrato.status = "encerrado";
    json.contratos[0].contrato.vigente_de = "2024-07-01";
    json.contratos[0].contrato.vigente_ate = "2025-06-30";
    const arquivo = salvar("encerrado.json", json);
    const primeira = await rodar(arquivo, "--executar");
    assert.equal(primeira.codigo, 0, JSON.stringify(primeira.conteudo?.contratos));
    const contrato = (await db.collection("contracts").doc("exemplo-2026").get()).data() ?? {};
    assert.equal(contrato.status, "encerrado");
    assert.equal(contrato.vigente_de, "2026-07-01");
    assert.equal(contrato.vigente_ate, "2027-06-30");
    assert.equal(contrato.edicao, 1);
    const aditivos = await db.collection("contracts/exemplo-2026/aditivos").get();
    assert.deepEqual(aditivos.docs.map((doc) => doc.get("vigencia_alterada")), [false, false]);

    const segunda = await rodar(arquivo, "--executar");
    assert.equal(segunda.codigo, 0);
    assert.equal(segunda.conteudo?.contratos[0].acao, "sem_mudanca");
    assert.equal((await db.collection("contracts").doc("exemplo-2026").get()).get("edicao"), 1);
  });

  it("encerrar pelo arquivo leva junto a vigência dos aditivos novos", async () => {
    await tabelas();
    const json = exemplo();
    const aditivosOriginais = json.contratos[0].aditivos;
    json.contratos[0].aditivos = [];
    assert.equal((await rodar(salvar("so-contrato.json", json), "--executar")).codigo, 0);

    json.contratos[0].contrato.status = "encerrado";
    json.contratos[0].aditivos = [
      ...aditivosOriginais,
      { numero: 3, assinado_em: null, tipo: "prorrogacao", vigente_de: "2027-07-01", vigente_ate: "2027-12-31", tabela_ids: [], documento: null, observacao: "" },
    ];
    const arquivo = salvar("encerrar.json", json);
    const resultado = await rodar(arquivo, "--executar");
    assert.equal(resultado.codigo, 0, JSON.stringify(resultado.conteudo?.contratos));
    assert.equal(resultado.conteudo?.contratos[0].acao, "atualizar");
    const contrato = (await db.collection("contracts").doc("exemplo-2026").get()).data() ?? {};
    assert.equal(contrato.status, "encerrado");
    assert.equal(contrato.vigente_ate, "2027-12-31");
    assert.equal((await rodar(arquivo, "--executar")).conteudo?.contratos[0].acao, "sem_mudanca");
  });

  it("mudança no arquivo vira atualização só dos campos alterados", async () => {
    await tabelas();
    const json = exemplo();
    await rodar(salvar("v1.json", json), "--executar");
    json.contratos[0].contrato.nome = "Contrato de serviços de mudança e montagem";
    const resultado = await rodar(salvar("v2.json", json), "--executar");
    assert.equal(resultado.codigo, 0);
    assert.equal(resultado.conteudo?.contratos[0].acao, "atualizar");
    assert.deepEqual(resultado.conteudo?.contratos[0].campos, ["nome"]);
    const contrato = (await db.collection("contracts").doc("exemplo-2026").get()).data() ?? {};
    assert.equal(contrato.nome, "Contrato de serviços de mudança e montagem");
    assert.equal(contrato.edicao, 2);
  });

  it("prospect fica de fora; os outros contratos seguem", async () => {
    await tabelas();
    const json = exemplo();
    json.contratos.push({ ...json.contratos[0], id: "prospect-2026", contrato: { ...json.contratos[0].contrato, customer_code: "PROSP" }, aditivos: [] });
    const resultado = await rodar(salvar("prospect.json", json), "--executar");
    assert.equal(resultado.codigo, 1);
    const prospect = resultado.conteudo?.contratos.find((item) => item.id === "prospect-2026");
    assert.match(String(prospect?.problemas[0]), /ainda é prospect/);
    assert.equal((await db.collection("contracts").doc("prospect-2026").get()).exists, false);
    assert.equal((await db.collection("contracts").doc("exemplo-2026").get()).exists, true);
  });

  it("aditivo registrado com outro conteúdo fica de fora e é apontado", async () => {
    await tabelas();
    const json = exemplo();
    await rodar(salvar("a.json", json), "--executar");
    json.contratos[0].aditivos[0].observacao = "Outra observação.";
    const resultado = await rodar(salvar("b.json", json), "--executar");
    assert.equal(resultado.codigo, 1);
    assert.match(String(resultado.conteudo?.contratos[0].aditivos[0].problemas[0]), /já está registrado com outro conteúdo/);
    assert.equal((await db.collection("contracts/exemplo-2026/aditivos").doc("1").get()).get("observacao"), "Documento não localizado.");
  });
});
