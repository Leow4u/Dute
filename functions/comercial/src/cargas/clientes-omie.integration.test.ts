import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";

import { main } from "./clientes-omie.js";

/**
 * Carga dos clientes da Omie contra o emulador (projeto demo-*), com dado
 * sintético: o dry-run com banco não grava; --executar cria o cliente e o
 * prospect pela mesma montagem do prospect das callables (origem omie,
 * recibo e evento), e o cadastro que já existe (a BTG pelo código, outro pela
 * raiz do CNPJ) só ganha comercial.omie_ids; rodar de novo não muda nada; e o
 * cadastro que mudou entre a leitura e a gravação não é sobrescrito.
 */

const PROJECT_ID = "demo-dute-comercial";

function dv(base: string): number {
  let peso = 2;
  let soma = 0;
  for (let index = base.length - 1; index >= 0; index -= 1) {
    soma += (base.charCodeAt(index) - 48) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function cnpj(raiz: string, ordem = "0001"): string {
  const base = `${raiz}${ordem}`;
  const primeiro = dv(base);
  return `${base}${primeiro}${dv(`${base}${primeiro}`)}`;
}

function cliente(id: number, dados: Record<string, unknown>): Record<string, unknown> {
  return {
    codigo_cliente_omie: id,
    cnpj_cpf: "",
    pessoa_fisica: "N",
    razao_social: "",
    nome_fantasia: "",
    cidade: "SAO PAULO (SP)",
    estado: "SP",
    inativo: "N",
    tags: [{ tag: "Cliente" }],
    email: "contato.sintetico@exemplo.com.br",
    telefone1_ddd: "11",
    telefone1_numero: "90000-1234",
    ...dados,
  };
}

const RAIZ_ALFA = "11111111";
const RAIZ_BETA = "55555555";
const RAIZ_BTG = "66666666";
const RAIZ_KAPPA = "22222222";

const BRUTO = {
  clientes: [
    cliente(101, { cnpj_cpf: cnpj(RAIZ_ALFA, "0002"), razao_social: "ALFA CONSTRUTORA LTDA", nome_fantasia: "ALFA FILIAL" }),
    cliente(102, { cnpj_cpf: cnpj(RAIZ_ALFA, "0001"), razao_social: "ALFA CONSTRUTORA LTDA", nome_fantasia: "ALFA CONSTRUTORA" }),
    cliente(201, { cnpj_cpf: "111.444.777-35", pessoa_fisica: "S", razao_social: "MARIA SINTETICA", nome_fantasia: "MARIA SINTETICA" }),
    cliente(301, { cnpj_cpf: cnpj("33333333"), razao_social: "TESTE", nome_fantasia: "TESTE" }),
    cliente(501, { cnpj_cpf: cnpj(RAIZ_BETA), razao_social: "BETA SERVICOS S.A.", nome_fantasia: "BETA SERVICOS" }),
    cliente(701, { cnpj_cpf: cnpj(RAIZ_BTG), razao_social: "BANCO BTG PACTUAL S.A.", nome_fantasia: "BTG PACTUAL S.A." }),
    cliente(702, { cnpj_cpf: cnpj(RAIZ_BTG, "0002"), razao_social: "BANCO BTG PACTUAL S.A.", nome_fantasia: "BTG PACTUAL RJ" }),
    cliente(801, { cnpj_cpf: cnpj(RAIZ_KAPPA), razao_social: "KAPPA LOGISTICA LTDA", nome_fantasia: "KAPPA" }),
  ],
  crm: [
    {
      identificacao: { nCod: 9001, cNome: "Gama Engenharia", cNomeFantasia: "", cDoc: "", cObs: "Observação sintética." },
      endereco: { cCidade: "Campinas", cUF: "SP" },
      telefone_email: { cEmail: "crm.sintetico@exemplo.com.br" },
    },
  ],
  titulos: [
    { codigo_cliente_fornecedor: 101, data_emissao: "15/03/2024", status_titulo: "RECEBIDO" },
    { codigo_cliente_fornecedor: 501, data_emissao: "31/12/2023", status_titulo: "RECEBIDO" },
    { codigo_cliente_fornecedor: 702, data_emissao: "01/08/2026", status_titulo: "A VENCER" },
  ],
};

let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let pasta: string;
let arquivos: string[];

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "comercial-carga-clientes-omie-test");
  db = getFirestore(app);
  pasta = mkdtempSync(join(tmpdir(), "carga-clientes-omie-int-"));
  const salvar = (nome: string, json: unknown) => {
    const caminho = join(pasta, nome);
    writeFileSync(caminho, JSON.stringify(json), "utf8");
    return caminho;
  };
  arquivos = [
    "--clientes",
    salvar("clientes-completo.json", BRUTO.clientes),
    "--crm",
    salvar("crm-contas.json", BRUTO.crm),
    "--titulos",
    salvar("contas-receber-todas.json", BRUTO.titulos),
  ];
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await Promise.all([
    // A BTG como o WMS grava: sem CNPJ, com sigla e projeção.
    db.collection("customers").doc("BTG_Pactual").set({
      id: "BTG_Pactual",
      code: "BTG Pactual",
      customer_code: "BTG Pactual",
      name: "BTG Pactual",
      sku_prefix: "BTG",
      status: "active",
    }),
    db.collection("client_profiles").doc("BTG_Pactual").set({ customer_code: "BTG Pactual", name: "BTG Pactual" }),
    // Um prospect do Comercial com a mesma raiz da Kappa e outro código.
    db.collection("customers").doc("KAPPA-LOG").set({
      id: "KAPPA-LOG",
      code: "KAPPA-LOG",
      customer_code: "KAPPA-LOG",
      name: "Kappa Logística",
      document: cnpj(RAIZ_KAPPA, "0005"),
      stage: "prospect",
      origem: "comercial",
      comercial: { responsavel_uid: "com-1", cidade: "Santos", uf: "SP", omie_ids: [] },
      status: "active",
    }),
  ]);
});

after(async () => {
  await deleteApp(app);
  rmSync(pasta, { recursive: true, force: true });
});

function rodar(...extra: string[]) {
  return main([...arquivos, "--projeto", PROJECT_ID, "--relatorio-dir", join(pasta, "relatorios"), ...extra], {
    db,
    log: () => undefined,
  });
}

async function count(path: string): Promise<number> {
  return (await db.collection(path).get()).size;
}

async function doc(id: string): Promise<Record<string, unknown>> {
  return (await db.collection("customers").doc(id).get()).data() ?? {};
}

describe("carga dos clientes da Omie no emulador", () => {
  it("dry-run com --projeto compara com o banco e não grava", async () => {
    const antes = await doc("BTG_Pactual");
    const resultado = await rodar();
    assert.equal(resultado.codigo, 0, JSON.stringify(resultado.conteudo?.clientes));
    assert.equal(resultado.conteudo?.comparado_com_o_banco, true);
    const acoes = Object.fromEntries((resultado.conteudo?.clientes ?? []).map((item) => [item.chave, item.acao]));
    assert.deepEqual(acoes, {
      [`cnpj-${RAIZ_ALFA}`]: "criar",
      [`cnpj-${RAIZ_BETA}`]: "criar",
      [`cnpj-${RAIZ_BTG}`]: "vincular",
      [`cnpj-${RAIZ_KAPPA}`]: "vincular",
      "crm-9001": "criar",
    });
    assert.equal(await count("customers"), 2);
    assert.equal(await count("events"), 0);
    assert.equal(await count("comercial_operations"), 0);
    assert.deepEqual(await doc("BTG_Pactual"), antes);
  });

  it("--executar cria cliente e prospect e liga a Omie ao cadastro existente; de novo, nada muda", async () => {
    const primeira = await rodar("--executar");
    assert.equal(primeira.codigo, 0, JSON.stringify(primeira.conteudo?.clientes));
    assert.equal(primeira.conteudo?.resumo.criar, 3);
    assert.equal(primeira.conteudo?.resumo.vincular, 2);

    // Cliente: comprou em 2024, numa filial; filiais num cadastro só.
    const alfa = await doc("ALFA-CONSTRUTORA");
    assert.equal(alfa.code, "ALFA-CONSTRUTORA");
    assert.equal(alfa.customer_code, "ALFA-CONSTRUTORA");
    assert.equal(alfa.name, "ALFA CONSTRUTORA");
    assert.equal(alfa.legal_name, "ALFA CONSTRUTORA LTDA");
    assert.equal(alfa.document, cnpj(RAIZ_ALFA, "0001"));
    assert.equal(alfa.stage, "cliente");
    assert.equal(alfa.origem, "omie");
    assert.equal(alfa.status, "active");
    assert.equal(alfa.portal_status, "inactive");
    assert.equal(alfa.created_by, "carga-clientes-omie");
    assert.ok(alfa.created_at instanceof Timestamp);
    assert.deepEqual(alfa.comercial, { responsavel_uid: null, cidade: "SAO PAULO", uf: "SP", omie_ids: ["cliente:101", "cliente:102"] });
    for (const campo of ["sku_prefix", "operation_template", "modules", "email", "telefone", "contato", "observacao"]) {
      assert.equal(campo in alfa, false, campo);
    }

    // Prospect: a última compra é de 2023. E a conta do CRM sem CNPJ.
    assert.equal((await doc("BETA-SERVICOS")).stage, "prospect");
    const gama = await doc("GAMA-ENGENHARIA");
    assert.equal(gama.stage, "prospect");
    assert.equal(gama.document, null);
    assert.deepEqual(gama.comercial, { responsavel_uid: null, cidade: "Campinas", uf: "SP", omie_ids: ["crm:9001"] });

    // A BTG (achada pelo código) e a Kappa (pela raiz) só ganham omie_ids.
    const btg = await doc("BTG_Pactual");
    assert.equal(btg.code, "BTG Pactual");
    assert.equal(btg.name, "BTG Pactual");
    assert.equal(btg.sku_prefix, "BTG");
    assert.equal("document" in btg, false);
    assert.equal("stage" in btg, false);
    assert.deepEqual(btg.comercial, { responsavel_uid: null, cidade: null, uf: null, omie_ids: ["cliente:701", "cliente:702"] });
    const kappa = await doc("KAPPA-LOG");
    assert.equal(kappa.name, "Kappa Logística");
    assert.equal(kappa.document, cnpj(RAIZ_KAPPA, "0005"));
    assert.equal(kappa.stage, "prospect");
    assert.deepEqual(kappa.comercial, { responsavel_uid: "com-1", cidade: "Santos", uf: "SP", omie_ids: ["cliente:801"] });

    // Nada de pessoa física nem de conta de teste; nenhuma projeção do WMS.
    assert.equal(await count("customers"), 5);
    assert.equal(await count("client_profiles"), 1);
    assert.equal(await count("client_access"), 0);

    // Um recibo e um evento por cadastro gravado, sem nome nem contato.
    assert.equal(await count("comercial_operations"), 5);
    const eventos = (await db.collection("events").get()).docs.map((row) => row.data());
    assert.equal(eventos.length, 5);
    const criados = eventos.filter((evento) => evento.type === "commercial_customer.created");
    assert.deepEqual(criados.map((evento) => evento.payload).sort((a, b) => String(a.stage).localeCompare(String(b.stage))), [
      { stage: "cliente" },
      { stage: "prospect" },
      { stage: "prospect" },
    ]);
    const atualizados = eventos.filter((evento) => evento.type === "commercial_customer.updated");
    assert.deepEqual(atualizados.map((evento) => evento.customer_code).sort(), ["BTG Pactual", "KAPPA-LOG"]);
    assert.deepEqual(atualizados[0].payload, { campos: ["ids_omie"] });
    const texto = JSON.stringify(eventos);
    for (const proibido of ["ALFA CONSTRUTORA", "MARIA", "contato.sintetico", "90000-1234", cnpj(RAIZ_ALFA)]) {
      assert.equal(texto.includes(proibido), false, proibido);
    }

    // Segunda execução: tudo sem mudança, nenhum recibo nem evento novo.
    const segunda = await rodar("--executar");
    assert.equal(segunda.codigo, 0, JSON.stringify(segunda.conteudo?.clientes));
    assert.equal(segunda.conteudo?.resumo.sem_mudanca, 5);
    assert.equal(segunda.conteudo?.resumo.criar, 0);
    assert.equal(segunda.conteudo?.resumo.vincular, 0);
    assert.equal(await count("comercial_operations"), 5);
    assert.equal(await count("events"), 5);
    assert.equal(await count("customers"), 5);
  });

  it("o CSV de revisão volta com --codigos e muda o código do cadastro novo", async () => {
    const dry = await rodar();
    assert.ok(dry.relatorio);
    const csv = readFileSync(dry.relatorio.replace(/\.json$/, ".csv"), "utf8");
    const revisado = csv
      .split("\r\n")
      .map((linha) => (linha.startsWith("crm-9001;") ? linha.replace(";GAMA-ENGENHARIA;;", ";GAMA-ENGENHARIA;GAMA;") : linha))
      .join("\r\n");
    assert.notEqual(revisado, csv, "a linha da Gama tem o código sugerido e a coluna de código vazia");
    const caminho = join(pasta, "revisado.csv");
    writeFileSync(caminho, revisado, "utf8");

    const resultado = await rodar("--executar", "--codigos", caminho);
    assert.equal(resultado.codigo, 0, JSON.stringify(resultado.conteudo?.clientes));
    assert.equal((await doc("GAMA")).customer_code, "GAMA");
    assert.equal((await db.collection("customers").doc("GAMA-ENGENHARIA").get()).exists, false);
    assert.ok(readdirSync(join(pasta, "relatorios")).some((nome) => nome.endsWith(".csv")));
  });

  it("cadastro que mudou entre a leitura e a gravação não é sobrescrito", async () => {
    const resultado = await main([...arquivos, "--projeto", PROJECT_ID, "--relatorio-dir", join(pasta, "relatorios"), "--executar"], {
      db,
      log: () => undefined,
      antesDeGravar: async (banco) => {
        await banco.collection("customers").doc("KAPPA-LOG").update({ "comercial.omie_ids": ["cliente:999"] });
      },
    });
    assert.equal(resultado.codigo, 1);
    const kappa = resultado.conteudo?.clientes.find((item) => item.chave === `cnpj-${RAIZ_KAPPA}`);
    assert.match(String(kappa?.erro), /mudou desde a leitura/);
    assert.deepEqual(((await doc("KAPPA-LOG")).comercial as Record<string, unknown>).omie_ids, ["cliente:999"]);
  });
});
