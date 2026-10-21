import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";

import { lpuItemId } from "../domain/catalogo.js";
import { COMERCIAL_OPERATIONS_COLLECTION } from "../domain/operations.js";
import { tabelaVigente, type VigenciaDaTabela } from "../domain/tabelas.js";
import { ErroDaCarga, rodarCarga, type ResultadoDaCarga } from "./tabela.js";

/**
 * A carga de tabela no Firestore do emulador: dry-run não grava; --executar
 * grava itens, tabela, evento e recibo numa transação; o mesmo arquivo não
 * duplica; a tabela nova encerra a anterior na mesma escrita; sobreposição,
 * cliente que não existe e contrato de outro cliente param sem gravar nada.
 */

const PROJECT_ID = "demo-dute-comercial";
const CABECALHO = "codigo;categoria;item;servico;descricao;unidade;preco";
const COLECOES = ["lpu_items", "price_tables", "events", COMERCIAL_OPERATIONS_COLLECTION] as const;

let db: Firestore;
let app: ReturnType<typeof initializeApp>;
const pasta = mkdtempSync(join(tmpdir(), "dute-carga-tabela-int-"));

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "comercial-carga-tabela-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
});

after(async () => {
  await deleteApp(app);
  rmSync(pasta, { recursive: true, force: true });
});

let sequencia = 0;
function arquivo(...linhas: string[]): string {
  sequencia += 1;
  const caminho = join(pasta, `tabela-${sequencia}.csv`);
  writeFileSync(caminho, [CABECALHO, ...linhas].join("\n"), "utf8");
  return caminho;
}

const V1 = [
  "DTL-0001-T;Mobiliário;Mesa de escritório;Transporte;Transporte de mesa;UN;45.50",
  "DTL-0001-M;Mobiliário;Mesa de escritório;Montagem;Montagem de mesa;UN;30",
  "DTL-0300;Armazenagem;Pallet;Prestação de serviço;Armazenagem de pallet;M³/MÊS;55",
];
// Reajuste: os mesmos itens com preço novo e um item a mais.
const V2 = [
  "DTL-0001-T;Mobiliário;Mesa de escritório;Transporte;Transporte de mesa;UN;48.00",
  "DTL-0001-M;Mobiliário;Mesa de escritório;Montagem;Montagem de mesa;UN;31.5",
  "DTL-0300;Armazenagem;Pallet;Prestação de serviço;Armazenagem de pallet;M³/MÊS;58",
  "DTL-0200-T;Frete;Frete fora de SP;Transporte;Frete por km rodado;KM;3.89",
];

const MESA = lpuItemId({ categoria: "Mobiliário", item: "Mesa de escritório", servico: "Transporte", unidade: "UN" });

function carga(argv: string[], log: string[] = []): Promise<ResultadoDaCarga> {
  return rodarCarga(argv, {
    abrirBanco: () => db,
    pastaDoRelatorio: pasta,
    env: { FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST },
    log: (linha) => log.push(linha),
  });
}

const padrao = (caminho: string, ...extra: string[]) => [
  "--arquivo",
  caminho,
  "--nome",
  "Padrão Dutelog",
  "--variante",
  "Comercial",
  "--projeto",
  PROJECT_ID,
  ...extra,
];

async function contagem(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const name of COLECOES) result[name] = (await db.collection(name).get()).size;
  return result;
}

const VAZIO = { lpu_items: 0, price_tables: 0, events: 0, [COMERCIAL_OPERATIONS_COLLECTION]: 0 };

async function tabelas(): Promise<Array<VigenciaDaTabela & Record<string, unknown>>> {
  const snapshot = await db.collection("price_tables").get();
  return snapshot.docs.map((doc) => doc.data() as VigenciaDaTabela & Record<string, unknown>);
}

describe("carga de tabela: dry-run", () => {
  it("com --projeto, lê o banco e não grava nada", async () => {
    const resultado = await carga(padrao(arquivo(...V1), "--vigente-de", "2026-01-01"));
    assert.equal(resultado.ok, true, resultado.erros.join(" | "));
    assert.equal(resultado.modo, "dry-run");
    assert.equal(resultado.gravou, false);
    assert.equal(resultado.itens_novos, 3);
    assert.deepEqual(await contagem(), VAZIO);
  });
});

describe("carga de tabela: --executar", () => {
  it("grava itens sem preço, a tabela imutável, o evento sem preço e o recibo", async () => {
    const resultado = await carga(
      padrao(arquivo(...V1), "--vigente-de", "2026-01-01", "--validade-dias", "15", "--rodape", "Tabela padrão.", "--executar", "--por", "leonardo@dutelog.com.br"),
    );
    assert.equal(resultado.ok, true, resultado.erros.join(" | "));
    assert.equal(resultado.gravou, true);
    assert.deepEqual(await contagem(), { lpu_items: 3, price_tables: 1, events: 1, [COMERCIAL_OPERATIONS_COLLECTION]: 1 });

    const item = (await db.collection("lpu_items").doc(MESA).get()).data() ?? {};
    assert.equal(item.item, "Mesa de escritório");
    assert.equal(item.servico, "Transporte");
    assert.equal(item.orcavel, true);
    assert.equal(item.ativo, true);
    assert.ok(item.created_at instanceof Timestamp);
    for (const chave of Object.keys(item)) assert.doesNotMatch(chave, /preco|price|valor|codigo/i);
    const pallet = (await db.collection("lpu_items").where("categoria", "==", "Armazenagem").get()).docs[0]?.data();
    assert.equal(pallet?.orcavel, false);

    const tabela = (await db.collection("price_tables").doc(String(resultado.tabela_id)).get()).data() ?? {};
    assert.equal(tabela.nome, "Padrão Dutelog");
    assert.equal(tabela.customer_code, null);
    assert.equal(tabela.contract_id, null);
    assert.equal(tabela.variante, "Comercial");
    assert.equal(tabela.vigente_de, "2026-01-01");
    assert.equal(tabela.vigente_ate, null);
    assert.equal(tabela.status, "ativa");
    assert.equal(tabela.substitui, null);
    assert.equal(tabela.moeda, "BRL");
    assert.equal(tabela.rodape, "Tabela padrão.");
    assert.equal(tabela.condicoes, null);
    assert.equal(tabela.validade_dias, 15);
    assert.equal(tabela.schema_version, 1);
    assert.deepEqual(tabela.precos[MESA], { codigo: "DTL-0001-T", descricao_cliente: "Transporte de mesa", preco: "45.50" });
    assert.equal(Object.keys(tabela.precos).length, 3);
    assert.equal(tabela.fonte.linhas, 3);
    assert.match(tabela.fonte.sha256, /^[0-9a-f]{64}$/);
    assert.match(tabela.fonte.arquivo, /^tabela-\d+\.csv$/);
    assert.equal(tabela.importado_por.email, "leonardo@dutelog.com.br");
    assert.ok(tabela.importado_em instanceof Timestamp);

    const evento = (await db.collection("events").get()).docs[0].data();
    assert.equal(evento.type, "price_table.imported");
    assert.equal(evento.entity_id, resultado.tabela_id);
    assert.equal(evento.customer_code, null);
    assert.equal(evento.source, "functions_comercial");
    assert.deepEqual(evento.payload, {
      tabela_id: resultado.tabela_id,
      variante: "comercial",
      linhas: 3,
      itens_novos: 3,
      vigencia_inicio: "2026-01-01",
      vigencia_fim: null,
      contrato_id: null,
      substitui: null,
    });
    assert.doesNotMatch(JSON.stringify(evento), /45\.5|R\$/);
  });

  it("o mesmo arquivo de novo não duplica nada", async () => {
    const caminho = arquivo(...V1);
    const primeira = await carga(padrao(caminho, "--vigente-de", "2026-01-01", "--executar"));
    const antes = await contagem();
    const segunda = await carga(padrao(caminho, "--vigente-de", "2026-01-01", "--executar"));
    assert.equal(segunda.ok, true, segunda.erros.join(" | "));
    assert.equal(segunda.replayed, true);
    assert.equal(segunda.gravou, false);
    assert.equal(segunda.tabela_id, primeira.tabela_id);
    assert.deepEqual(await contagem(), antes);

    // O dry-run também avisa que o arquivo já entrou.
    const dry = await carga(padrao(caminho, "--vigente-de", "2026-01-01"));
    assert.equal(dry.ok, true);
    assert.match(dry.avisos.join(" | "), /já foi carregado/);
  });

  it("o mesmo arquivo com outros parâmetros é recusado sem gravar", async () => {
    const caminho = arquivo(...V1);
    await carga(padrao(caminho, "--vigente-de", "2026-01-01", "--executar"));
    const antes = await contagem();
    const resultado = await carga(padrao(caminho, "--vigente-de", "2027-01-01", "--executar"));
    assert.equal(resultado.ok, false);
    assert.match(resultado.erros.join(" | "), /já foi carregado com outros parâmetros/);
    assert.deepEqual(await contagem(), antes);
  });

  it("a tabela nova encerra a anterior na mesma escrita, e a anterior vale para a data-base antiga", async () => {
    const v1 = await carga(padrao(arquivo(...V1), "--vigente-de", "2026-01-01", "--executar"));
    const v2 = await carga(padrao(arquivo(...V2), "--vigente-de", "2026-06-30", "--executar"));
    assert.equal(v2.ok, true, v2.erros.join(" | "));
    assert.equal(v2.itens_novos, 1, "os itens que já existem não duplicam");
    assert.equal(v2.encerrou, v1.tabela_id);
    assert.deepEqual(await contagem(), { lpu_items: 4, price_tables: 2, events: 3, [COMERCIAL_OPERATIONS_COLLECTION]: 2 });

    const anterior = (await db.collection("price_tables").doc(String(v1.tabela_id)).get()).data() ?? {};
    assert.equal(anterior.status, "encerrada");
    assert.equal(anterior.vigente_ate, "2026-06-29");
    assert.equal(anterior.encerrada_por, v2.tabela_id);
    assert.equal(anterior.precos[MESA].preco, "45.50", "a anterior não muda de preço");
    const nova = (await db.collection("price_tables").doc(String(v2.tabela_id)).get()).data() ?? {};
    assert.equal(nova.status, "ativa");
    assert.equal(nova.substitui, v1.tabela_id);
    assert.equal(nova.precos[MESA].preco, "48.00");

    const encerramento = (await db.collection("events").where("type", "==", "price_table.closed").get()).docs[0]?.data();
    assert.equal(encerramento?.entity_id, v1.tabela_id);
    assert.deepEqual(encerramento?.payload, {
      tabela_id: v1.tabela_id,
      variante: "comercial",
      vigencia_fim: "2026-06-29",
      substituida_por: v2.tabela_id,
      contrato_id: null,
    });

    const todas = await tabelas();
    const filtro = { customer_code: "BTG", contract_id: null, variante: "Comercial" };
    assert.equal(tabelaVigente(todas, { ...filtro, data: "2026-03-15" })?.tabela.id, v1.tabela_id);
    assert.equal(tabelaVigente(todas, { ...filtro, data: "2026-06-30" })?.tabela.id, v2.tabela_id);
  });

  it("sobreposição é recusada sem gravar nada", async () => {
    await carga(padrao(arquivo(...V1), "--vigente-de", "2026-01-01", "--executar"));
    const antes = await contagem();
    const resultado = await carga(padrao(arquivo(...V2), "--vigente-de", "2025-06-01", "--executar"));
    assert.equal(resultado.ok, false);
    assert.match(resultado.erros.join(" | "), /sobrep/i);
    assert.deepEqual(await contagem(), antes);
    // A tabela ativa continua como estava.
    const [ativa] = await tabelas();
    assert.equal(ativa.status, "ativa");
    assert.equal(ativa.vigente_ate, null);
  });

  it("tabela de cliente exige o cliente no cadastro; contrato de outro cliente é recusado", async () => {
    const caminho = arquivo(...V1);
    const itau = ["--cliente", "ITAU", "--contrato", "itau-2026", "--vigente-de", "2026-06-30", "--executar"];

    const semCliente = await carga([...padrao(caminho, ...itau)]);
    assert.equal(semCliente.ok, false);
    assert.match(semCliente.erros.join(" | "), /ITAU.*não está no cadastro/);
    assert.deepEqual(await contagem(), VAZIO);

    await db.collection("customers").doc("itau").set({ code: "ITAU", customer_code: "ITAU", name: "Itaú", stage: "cliente" });
    await db.collection("customers").doc("safra").set({ code: "SAFRA", customer_code: "SAFRA", name: "Safra" });
    await db.collection("contracts").doc("itau-2026").set({ customer_code: "SAFRA" });
    const contratoAlheio = await carga([...padrao(caminho, ...itau)]);
    assert.equal(contratoAlheio.ok, false);
    assert.match(contratoAlheio.erros.join(" | "), /contrato itau-2026 é de outro cliente/);
    assert.deepEqual(await contagem(), VAZIO);

    await db.collection("contracts").doc("itau-2026").set({ customer_code: "ITAU" });
    const certo = await carga([...padrao(caminho, ...itau)]);
    assert.equal(certo.ok, true, certo.erros.join(" | "));
    const tabela = (await db.collection("price_tables").doc(String(certo.tabela_id)).get()).data() ?? {};
    assert.equal(tabela.customer_code, "ITAU");
    assert.equal(tabela.contract_id, "itau-2026");
    const evento = (await db.collection("events").get()).docs[0].data();
    assert.equal(evento.customer_code, "ITAU");
    assert.equal(evento.payload.contrato_id, "itau-2026");
  });

  it("contrato que ainda não está em contracts: o dry-run avisa e o --executar recusa sem gravar", async () => {
    await db.collection("customers").doc("itau").set({ code: "ITAU", customer_code: "ITAU", name: "Itaú" });
    const caminho = arquivo(...V1);
    const itau = ["--cliente", "ITAU", "--contrato", "itau-2026", "--vigente-de", "2026-06-30"];
    const dry = await carga([...padrao(caminho, ...itau)]);
    assert.equal(dry.ok, true, dry.erros.join(" | "));
    assert.match(dry.avisos.join(" | "), /itau-2026 ainda não está em contracts/);

    const executar = await carga([...padrao(caminho, ...itau, "--executar")]);
    assert.equal(executar.ok, false);
    assert.equal(executar.gravou, false);
    assert.match(executar.erros.join(" | "), /itau-2026 não está em contracts/);
    assert.deepEqual(await contagem(), VAZIO);
  });

  it("--executar sem --projeto nunca abre o banco", async () => {
    await assert.rejects(
      rodarCarga(["--arquivo", arquivo(...V1), "--nome", "x", "--variante", "Comercial", "--vigente-de", "2026-01-01", "--executar"], {
        abrirBanco: () => {
          throw new Error("não deveria abrir o banco");
        },
        pastaDoRelatorio: pasta,
        log: () => undefined,
      }),
      ErroDaCarga,
    );
    assert.deepEqual(await contagem(), VAZIO);
  });
});

describe("carga de tabela: a transação confere o estado de novo", () => {
  // Entre a conferência fora da transação e a gravação, outra carga (ou outra
  // pessoa) muda o banco. A transação relê tudo e para sem gravar nada.
  function cargaComIntervalo(argv: string[], intervalo: () => Promise<unknown>): Promise<ResultadoDaCarga> {
    return rodarCarga(argv, {
      abrirBanco: () => db,
      pastaDoRelatorio: pasta,
      env: { FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST },
      log: () => undefined,
      antesDeGravar: async () => {
        await intervalo();
      },
    });
  }

  it("outra carga da mesma chave e do mesmo início grava antes: sobreposição, nada gravado", async () => {
    let concorrente: ResultadoDaCarga | undefined;
    const resultado = await cargaComIntervalo(padrao(arquivo(...V1), "--vigente-de", "2026-01-01", "--executar"), async () => {
      concorrente = await carga(padrao(arquivo(...V2), "--vigente-de", "2026-01-01", "--executar"));
    });
    assert.equal(concorrente?.ok, true, concorrente?.erros.join(" | "));
    assert.equal(resultado.ok, false);
    assert.equal(resultado.gravou, false);
    assert.match(resultado.erros.join(" | "), /sobrep/i);
    // Só o que a outra carga gravou.
    assert.deepEqual(await contagem(), { lpu_items: 4, price_tables: 1, events: 1, [COMERCIAL_OPERATIONS_COLLECTION]: 1 });
    const [unica] = await tabelas();
    assert.equal((unica.precos as Record<string, { preco: string }>)[MESA].preco, "48.00");
  });

  it("o cliente sai do cadastro antes da gravação: nada gravado", async () => {
    await db.collection("customers").doc("itau").set({ code: "ITAU", customer_code: "ITAU", name: "Itaú" });
    const resultado = await cargaComIntervalo(
      padrao(arquivo(...V1), "--cliente", "ITAU", "--vigente-de", "2026-06-30", "--executar"),
      () => db.collection("customers").doc("itau").delete(),
    );
    assert.equal(resultado.ok, false);
    assert.equal(resultado.gravou, false);
    assert.match(resultado.erros.join(" | "), /ITAU.*não está no cadastro/);
    assert.deepEqual(await contagem(), VAZIO);
  });

  it("o contrato passa a ser de outro cliente antes da gravação: nada gravado", async () => {
    await db.collection("customers").doc("itau").set({ code: "ITAU", customer_code: "ITAU", name: "Itaú" });
    await db.collection("contracts").doc("itau-2026").set({ customer_code: "ITAU" });
    const resultado = await cargaComIntervalo(
      padrao(arquivo(...V1), "--cliente", "ITAU", "--contrato", "itau-2026", "--vigente-de", "2026-06-30", "--executar"),
      () => db.collection("contracts").doc("itau-2026").set({ customer_code: "SAFRA" }),
    );
    assert.equal(resultado.ok, false);
    assert.match(resultado.erros.join(" | "), /contrato itau-2026 é de outro cliente/);
    assert.deepEqual(await contagem(), VAZIO);
  });

  it("o mesmo arquivo entra antes com outros parâmetros: o recibo recusa, nada gravado", async () => {
    const caminho = arquivo(...V1);
    const resultado = await cargaComIntervalo(padrao(caminho, "--vigente-de", "2026-01-01", "--executar"), async () => {
      const outra = await carga(padrao(caminho, "--vigente-de", "2027-01-01", "--executar"));
      assert.equal(outra.ok, true, outra.erros.join(" | "));
    });
    assert.equal(resultado.ok, false);
    assert.equal(resultado.gravou, false);
    assert.match(resultado.erros.join(" | "), /já foi carregado com outros parâmetros/);
    assert.deepEqual(await contagem(), { lpu_items: 3, price_tables: 1, events: 1, [COMERCIAL_OPERATIONS_COLLECTION]: 1 });
    const [unica] = await tabelas();
    assert.equal(unica.vigente_de, "2027-01-01");
  });

  it("a mesma carga entra antes com os mesmos parâmetros: vira repetição, sem duplicar", async () => {
    const caminho = arquivo(...V1);
    const resultado = await cargaComIntervalo(padrao(caminho, "--vigente-de", "2026-01-01", "--executar"), async () => {
      const outra = await carga(padrao(caminho, "--vigente-de", "2026-01-01", "--executar"));
      assert.equal(outra.gravou, true, outra.erros.join(" | "));
    });
    assert.equal(resultado.ok, true, resultado.erros.join(" | "));
    assert.equal(resultado.replayed, true);
    assert.equal(resultado.gravou, false);
    assert.deepEqual(await contagem(), { lpu_items: 3, price_tables: 1, events: 1, [COMERCIAL_OPERATIONS_COLLECTION]: 1 });
  });
});
