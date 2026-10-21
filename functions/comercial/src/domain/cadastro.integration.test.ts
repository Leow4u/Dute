import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import {
  saveCommercialCustomerFor,
  saveCustomerContactFor,
  saveCustomerLocationFor,
} from "./cadastro.js";
import { COMERCIAL_OPERATIONS_COLLECTION } from "./operations.js";
import type { ComercialProfile } from "./profile.js";

/**
 * Cadastro comercial no emulador: o prospect grava só em `customers`, sem
 * projeções, com o evento no código real; a unicidade compara o código
 * canônico e a raiz do CNPJ contra todos os cadastros (WMS, arquivados e
 * prospects); a identidade do cadastro do WMS fica em Configurações ›
 * Clientes; locais e contatos exigem cadastro ativo; e a repetição é
 * idempotente.
 */

const PROJECT_ID = "demo-dute-comercial";

const comercial: ComercialProfile = { uid: "com-1", role: "comercial", name: "Guilherme", email: "comercial@dutelog.com.br" };
const owner: ComercialProfile = { uid: "owner-1", role: "owner", name: "Leonardo", email: "leonardo@dutelog.com.br" };
const admin: ComercialProfile = { uid: "admin-1", role: "admin", name: "Admin" };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let chave = 0;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "comercial-cadastro-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const users = db.collection("users");
  await Promise.all([
    users.doc("owner-1").set({ role: "owner", nome: "Leonardo" }),
    users.doc("admin-1").set({ role: "admin", nome: "Admin" }),
    users.doc("com-1").set({ role: "comercial", nome: "Guilherme" }),
    users.doc("com-2").set({ role: "comercial", nome: "Outro comercial" }),
    users.doc("com-off").set({ role: "comercial", nome: "Desligado", access_disabled: true }),
    users.doc("wms-1").set({ role: "wms", nome: "Operador" }),
  ]);
});

after(async () => {
  await deleteApp(app);
});

function key(): string {
  chave += 1;
  return `chave-${chave}`;
}

async function rejeita(promise: Promise<unknown>, code: string, message?: RegExp): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    assert.equal(error.code, code, error.message);
    if (message) assert.match(error.message, message);
    return error;
  }
  assert.fail("deveria recusar");
}

async function count(collection: string): Promise<number> {
  return (await db.collection(collection).get()).size;
}

async function eventos(): Promise<Array<Record<string, unknown>>> {
  return (await db.collection("events").get()).docs.map((row) => row.data());
}

/** Cadastro como o WMS grava (Configurações › Clientes), com sigla e projeções. */
async function cadastroDoWms(id: string, data: Record<string, unknown>, projecao = true): Promise<void> {
  const code = String(data.code);
  await db.collection("customers").doc(id).set({ id, customer_code: code, status: "active", archived: false, ...data });
  if (projecao) {
    await db.collection("client_profiles").doc(id).set({ id, customer_code: code, name: data.name ?? code });
    await db.collection("client_access").doc(code).set({ customer_code: code, modules: ["wms", "financeiro"] });
  }
}

function criar(caller: ComercialProfile, data: Record<string, unknown>) {
  return saveCommercialCustomerFor(db, caller, { action: "create", idempotency_key: key(), ...data });
}

describe("prospect novo", () => {
  it("grava só em customers, sem sigla, módulos nem projeções, com o evento no código real", async () => {
    const result = await criar(comercial, {
      name: "Itaú Unibanco S.A.",
      legal_name: "Itaú Unibanco S.A.",
      document: "98.765.432/0001-98",
      comercial: { cidade: "São Paulo", uf: "sp" },
    });
    assert.equal(result.customer_code, "ITAU-UNIBANCO");
    assert.equal(result.customer_id, "ITAU-UNIBANCO");
    assert.equal(result.stage, "prospect");

    const doc = (await db.collection("customers").doc("ITAU-UNIBANCO").get()).data() ?? {};
    assert.equal(doc.code, "ITAU-UNIBANCO");
    assert.equal(doc.customer_code, "ITAU-UNIBANCO");
    assert.equal(doc.name, "Itaú Unibanco S.A.");
    assert.equal(doc.legal_name, "Itaú Unibanco S.A.");
    assert.equal(doc.document, "98765432000198");
    assert.equal(doc.stage, "prospect");
    assert.ok(doc.stage_changed_at instanceof Timestamp);
    assert.equal(doc.origem, "comercial");
    assert.deepEqual(doc.comercial, { responsavel_uid: "com-1", cidade: "São Paulo", uf: "SP", omie_ids: [] });
    assert.equal(doc.status, "active");
    assert.equal(doc.portal_status, "inactive");
    assert.equal(doc.created_by, "com-1");
    assert.ok(doc.created_at instanceof Timestamp);
    assert.ok(doc.updated_at instanceof Timestamp);
    for (const campo of ["sku_prefix", "operation_template", "modules"]) assert.equal(campo in doc, false, campo);

    assert.equal(await count("client_profiles"), 0);
    assert.equal(await count("client_access"), 0);
    assert.equal(await count(COMERCIAL_OPERATIONS_COLLECTION), 1);

    const [evento] = await eventos();
    assert.equal(evento.type, "commercial_customer.created");
    assert.equal(evento.customer_code, "ITAU-UNIBANCO");
    assert.equal(evento.entity_type, "customer");
    assert.equal(evento.entity_id, "ITAU-UNIBANCO");
    assert.equal(evento.source, "functions_comercial");
    assert.equal(evento.severity, "info");
    assert.deepEqual(evento.payload, { stage: "prospect" });
    assert.deepEqual(result.events, [evento.id]);
    const texto = JSON.stringify({ ...evento, actor: null });
    assert.doesNotMatch(texto, /Itaú|98765432|São Paulo/);
  });

  it("o código informado vale; o responsável é da equipe do Comercial", async () => {
    const result = await criar(owner, { name: "Banco Safra", code: "safra", comercial: { responsavel_uid: "com-2" } });
    assert.equal(result.customer_code, "SAFRA");
    const doc = (await db.collection("customers").doc("SAFRA").get()).data() ?? {};
    assert.equal(doc.comercial.responsavel_uid, "com-2");
    assert.equal(doc.created_by, "owner-1");

    for (const uid of ["wms-1", "com-off", "ninguem"]) {
      await rejeita(
        criar(owner, { name: "Outro banco", code: `OUTRO-${uid.length}`, comercial: { responsavel_uid: uid } }),
        "invalid-argument",
        /responsável/,
      );
    }
    assert.equal(await count("customers"), 1);
  });

  it("código inválido é invalid-argument e não grava nada", async () => {
    for (const code of ["A", "ITAU UNIBANCO", "ITAÚ", "-ITAU", "ITAU_UNIBANCO"]) {
      await rejeita(criar(comercial, { name: "Itaú", code }), "invalid-argument", /Código do cliente inválido/);
    }
    assert.equal(await count("customers"), 0);
    assert.equal(await count("events"), 0);
    assert.equal(await count(COMERCIAL_OPERATIONS_COLLECTION), 0);
  });
});

describe("unicidade contra todos os cadastros", () => {
  it("acento, maiúscula e separador colidem com o código do WMS", async () => {
    await cadastroDoWms("Ita_", { code: "Itaú", name: "Itaú", sku_prefix: "ITAU" });
    await cadastroDoWms("BTG_Pactual", { code: "BTG Pactual", name: "BTG Pactual", sku_prefix: "BTG" });
    await rejeita(criar(comercial, { name: "Itaú", code: "ITAU" }), "already-exists", /O código ITAU já é do cliente Itaú \(cadastrado como Itaú\)/);
    await rejeita(criar(comercial, { name: "BTG", code: "BTG-PACTUAL" }), "already-exists", /cadastrado como BTG Pactual/);
    await rejeita(criar(comercial, { name: "BTG Pactual" }), "already-exists", /BTG-PACTUAL/);
    assert.equal(await count("customers"), 2);
    assert.equal(await count("events"), 0);
  });

  it("o código de cadastro arquivado e o de outro prospect continuam reservados", async () => {
    await cadastroDoWms("Safra", { code: "Safra", name: "Safra", sku_prefix: "SAF", status: "archived", archived: true }, false);
    await rejeita(criar(comercial, { name: "Banco Safra", code: "SAFRA" }), "already-exists", /já é do cliente Safra/);

    await criar(comercial, { name: "Construtora Ômega" });
    await rejeita(criar(comercial, { name: "Ômega", code: "construtora-omega" }), "already-exists", /já está em uso/);
    await rejeita(criar(comercial, { name: "Ômega", code: "CONSTRUTORAOMEGA" }), "already-exists", /do prospect Construtora Ômega/);
  });

  it("a raiz do CNPJ é uma só: a filial colide com a matriz do WMS e com outro prospect", async () => {
    await cadastroDoWms("BTG_Pactual", {
      code: "BTG Pactual",
      name: "BTG Pactual",
      sku_prefix: "BTG",
      document: "12.345.678/0001-95",
    });
    await rejeita(
      criar(comercial, { name: "BTG Filial", code: "BTG-FILIAL", document: "12345678000276" }),
      "already-exists",
      /A raiz do CNPJ 12345678 já é do cliente BTG Pactual/,
    );
    await criar(comercial, { name: "Construtora Ômega", document: "11.222.333/0001-81" });
    await rejeita(
      criar(comercial, { name: "Ômega SP", code: "OMEGA-SP", document: "11222333000181" }),
      "already-exists",
      /do prospect Construtora Ômega/,
    );
  });
});

describe("alteração do cadastro", () => {
  it("prospect: o Comercial edita a identidade e os dados comerciais", async () => {
    await criar(comercial, { name: "Construtora Ômega" });
    const result = await saveCommercialCustomerFor(db, comercial, {
      action: "update",
      idempotency_key: key(),
      customer_code: "CONSTRUTORA-OMEGA",
      name: "Construtora Ômega S.A.",
      document: "11.222.333/0001-81",
      comercial: { cidade: "Campinas", uf: "SP" },
    });
    assert.deepEqual(result.campos, ["nome", "cnpj", "cidade", "uf"]);
    const doc = (await db.collection("customers").doc("CONSTRUTORA-OMEGA").get()).data() ?? {};
    assert.equal(doc.name, "Construtora Ômega S.A.");
    assert.equal(doc.document, "11222333000181");
    assert.equal(doc.code, "CONSTRUTORA-OMEGA");
    assert.deepEqual(doc.comercial, { responsavel_uid: "com-1", cidade: "Campinas", uf: "SP", omie_ids: [] });
    assert.equal(doc.updated_by, "com-1");
    const evento = (await eventos()).find((row) => row.type === "commercial_customer.updated") ?? {};
    assert.deepEqual(evento.payload, { campos: ["nome", "cnpj", "cidade", "uf"] });
    assert.doesNotMatch(JSON.stringify(evento.payload), /Campinas|11222333/);
  });

  it("o código não muda: update não aceita code", async () => {
    await criar(comercial, { name: "Construtora Ômega" });
    await rejeita(
      saveCommercialCustomerFor(db, comercial, {
        action: "update",
        idempotency_key: key(),
        customer_code: "CONSTRUTORA-OMEGA",
        code: "OMEGA",
      }),
      "invalid-argument",
      /Campo não aceito: code/,
    );
  });

  it("CNPJ novo também é único na alteração", async () => {
    await cadastroDoWms("BTG_Pactual", { code: "BTG Pactual", name: "BTG Pactual", sku_prefix: "BTG", document: "12.345.678/0001-95" });
    await criar(comercial, { name: "Construtora Ômega" });
    await rejeita(
      saveCommercialCustomerFor(db, comercial, {
        action: "update",
        idempotency_key: key(),
        customer_code: "CONSTRUTORA-OMEGA",
        document: "12.345.678/0002-76",
      }),
      "already-exists",
      /raiz do CNPJ 12345678/,
    );
  });

  it("com sigla, nome, razão social e CNPJ ficam em Configurações › Clientes; os dados comerciais, não", async () => {
    await cadastroDoWms("Ita_", { code: "Itaú", name: "Itaú", sku_prefix: "ITAU", document: "98.765.432/0001-98" });
    for (const campo of [{ name: "Itaú Unibanco" }, { legal_name: "Itaú Unibanco S.A." }, { document: "11.222.333/0001-81" }]) {
      await rejeita(
        saveCommercialCustomerFor(db, comercial, { action: "update", idempotency_key: key(), customer_code: "Itaú", ...campo }),
        "failed-precondition",
        /Configurações › Clientes/,
      );
    }
    // Mandar o que já está gravado (o CNPJ com ou sem máscara) não é mudar a identidade.
    const mesmo = await saveCommercialCustomerFor(db, comercial, {
      action: "update",
      idempotency_key: key(),
      customer_code: "Itaú",
      name: "Itaú",
      document: "98765432000198",
      comercial: { cidade: "São Paulo", uf: "SP" },
    });
    assert.deepEqual(mesmo.campos, ["cidade", "uf"]);
    const doc = (await db.collection("customers").doc("Ita_").get()).data() ?? {};
    assert.equal(doc.name, "Itaú");
    assert.equal(doc.document, "98.765.432/0001-98");
    assert.equal(doc.sku_prefix, "ITAU");
    // O cadastro do WMS não tinha o mapa: ele entra inteiro, no formato do prospect.
    assert.deepEqual(doc.comercial, { responsavel_uid: null, cidade: "São Paulo", uf: "SP", omie_ids: [] });
    assert.equal("stage" in doc, false, "o Comercial não grava estágio no cadastro do WMS");
    const evento = (await eventos()).find((row) => row.type === "commercial_customer.updated") ?? {};
    assert.equal(evento.customer_code, "Itaú");
    assert.equal(evento.entity_id, "Ita_");

    // Com o mapa já gravado, a alteração seguinte só troca o campo enviado.
    await saveCommercialCustomerFor(db, comercial, {
      action: "update",
      idempotency_key: key(),
      customer_code: "Itaú",
      comercial: { responsavel_uid: "com-2" },
    });
    const depois = (await db.collection("customers").doc("Ita_").get()).data() ?? {};
    assert.deepEqual(depois.comercial, { responsavel_uid: "com-2", cidade: "São Paulo", uf: "SP", omie_ids: [] });
  });

  it("o CNPJ provisório que o WMS gravou volta igual na ficha e não é mudança de identidade", async () => {
    await cadastroDoWms("Ita_", { code: "Itaú", name: "Itaú", sku_prefix: "ITAU", document: "00.000.000/0000-00" });
    for (const document of ["00.000.000/0000-00", "00000000000000"]) {
      const result = await saveCommercialCustomerFor(db, comercial, {
        action: "update",
        idempotency_key: key(),
        customer_code: "Itaú",
        name: "Itaú",
        document,
        comercial: { cidade: document.includes(".") ? "São Paulo" : "Campinas" },
      });
      assert.deepEqual(result.campos, ["cidade"]);
    }
    const doc = (await db.collection("customers").doc("Ita_").get()).data() ?? {};
    assert.equal(doc.document, "00.000.000/0000-00");
    assert.equal(doc.comercial.cidade, "Campinas");

    // Um CNPJ diferente e inválido continua recusado, sem gravar nada.
    const antes = await count("events");
    await rejeita(
      saveCommercialCustomerFor(db, comercial, {
        action: "update",
        idempotency_key: key(),
        customer_code: "Itaú",
        document: "00.000.000/0000-01",
        comercial: { cidade: "Santos" },
      }),
      "invalid-argument",
      /CNPJ inválido/,
    );
    await criar(comercial, { name: "Construtora Ômega" });
    await rejeita(
      saveCommercialCustomerFor(db, comercial, {
        action: "update",
        idempotency_key: key(),
        customer_code: "CONSTRUTORA-OMEGA",
        document: "12.345.678/0001-00",
      }),
      "invalid-argument",
      /CNPJ inválido/,
    );
    assert.equal(await count("events"), antes + 1, "só o evento da criação do prospect");
    assert.equal((await db.collection("customers").doc("Ita_").get()).get("comercial.cidade"), "Campinas");
  });

  it("sem sigla, mas com projeção ou sendo a BTG legada, a identidade também fica no WMS", async () => {
    await cadastroDoWms("ACME", { code: "ACME", name: "Acme" });
    await cadastroDoWms("BTG_Pactual", { code: "BTG Pactual", name: "BTG Pactual" }, false);
    for (const code of ["ACME", "BTG Pactual"]) {
      await rejeita(
        saveCommercialCustomerFor(db, comercial, { action: "update", idempotency_key: key(), customer_code: code, name: "Outro nome" }),
        "failed-precondition",
        /Configurações › Clientes/,
      );
    }
  });

  it("nada mudou: só o recibo, sem evento", async () => {
    await criar(comercial, { name: "Construtora Ômega" });
    const result = await saveCommercialCustomerFor(db, comercial, {
      action: "update",
      idempotency_key: key(),
      customer_code: "CONSTRUTORA-OMEGA",
      name: "Construtora Ômega",
    });
    assert.deepEqual(result.campos, []);
    assert.deepEqual(result.events, []);
    assert.equal(await count("events"), 1);
  });

  it("cadastro desconhecido é not-found", async () => {
    await rejeita(
      saveCommercialCustomerFor(db, comercial, { action: "update", idempotency_key: key(), customer_code: "NADA", name: "Nada" }),
      "not-found",
    );
  });
});

describe("marcar como cliente", () => {
  it("o prospect vira cliente sem ganhar sigla, módulos nem projeção", async () => {
    await criar(comercial, { name: "Construtora Ômega" });
    const result = await saveCommercialCustomerFor(db, comercial, {
      action: "mark_client",
      idempotency_key: key(),
      customer_code: "CONSTRUTORA-OMEGA",
    });
    assert.equal(result.stage, "cliente");
    const doc = (await db.collection("customers").doc("CONSTRUTORA-OMEGA").get()).data() ?? {};
    assert.equal(doc.stage, "cliente");
    assert.ok(doc.stage_changed_at instanceof Timestamp);
    for (const campo of ["sku_prefix", "operation_template", "modules"]) assert.equal(campo in doc, false, campo);
    assert.equal(await count("client_profiles"), 0);
    assert.equal(await count("client_access"), 0);
    const evento = (await eventos()).find((row) => row.type === "commercial_customer.became_client") ?? {};
    assert.equal(evento.customer_code, "CONSTRUTORA-OMEGA");
    assert.deepEqual(evento.payload, {});
  });

  it("quem já é cliente (inclusive o cadastro do WMS, sem estágio) não é marcado de novo", async () => {
    await criar(comercial, { name: "Construtora Ômega" });
    await saveCommercialCustomerFor(db, comercial, { action: "mark_client", idempotency_key: key(), customer_code: "CONSTRUTORA-OMEGA" });
    await rejeita(
      saveCommercialCustomerFor(db, comercial, { action: "mark_client", idempotency_key: key(), customer_code: "CONSTRUTORA-OMEGA" }),
      "failed-precondition",
      /já é cliente/,
    );
    await cadastroDoWms("BTG_Pactual", { code: "BTG Pactual", name: "BTG Pactual", sku_prefix: "BTG" });
    await rejeita(
      saveCommercialCustomerFor(db, comercial, { action: "mark_client", idempotency_key: key(), customer_code: "BTG Pactual" }),
      "failed-precondition",
      /já é cliente/,
    );
  });
});

describe("arquivar", () => {
  it("o comercial não arquiva", async () => {
    await criar(comercial, { name: "Construtora Ômega" });
    await rejeita(
      saveCommercialCustomerFor(db, comercial, { action: "archive", idempotency_key: key(), customer_code: "CONSTRUTORA-OMEGA" }),
      "permission-denied",
    );
    const doc = (await db.collection("customers").doc("CONSTRUTORA-OMEGA").get()).data() ?? {};
    assert.equal(doc.status, "active");
    assert.equal(await count("events"), 1);
  });

  it("cadastro com sigla é recusado, mesmo para o owner", async () => {
    await cadastroDoWms("Ita_", { code: "Itaú", name: "Itaú", sku_prefix: "ITAU" });
    await rejeita(
      saveCommercialCustomerFor(db, owner, { action: "archive", idempotency_key: key(), customer_code: "Itaú" }),
      "failed-precondition",
      /Configurações › Clientes/,
    );
    const doc = (await db.collection("customers").doc("Ita_").get()).data() ?? {};
    assert.equal(doc.status, "active");
    assert.equal(doc.archived, false);
  });

  it("admin arquiva o prospect; o código continua reservado; local e contato são recusados", async () => {
    await criar(comercial, { name: "Construtora Ômega" });
    await saveCommercialCustomerFor(db, admin, { action: "archive", idempotency_key: key(), customer_code: "CONSTRUTORA-OMEGA" });
    const doc = (await db.collection("customers").doc("CONSTRUTORA-OMEGA").get()).data() ?? {};
    assert.equal(doc.status, "archived");
    assert.equal(doc.archived, true);
    assert.equal(doc.portal_status, "inactive");
    assert.equal(doc.archived_by, "admin-1");
    assert.ok(doc.archived_at instanceof Timestamp);
    const evento = (await eventos()).find((row) => row.type === "commercial_customer.archived") ?? {};
    assert.equal(evento.customer_code, "CONSTRUTORA-OMEGA");

    await rejeita(criar(comercial, { name: "Ômega", code: "CONSTRUTORAOMEGA" }), "already-exists");
    await rejeita(
      saveCommercialCustomerFor(db, owner, { action: "archive", idempotency_key: key(), customer_code: "CONSTRUTORA-OMEGA" }),
      "failed-precondition",
      /arquivado/,
    );
    for (const action of ["update", "mark_client"]) {
      await rejeita(
        saveCommercialCustomerFor(db, comercial, {
          action,
          idempotency_key: key(),
          customer_code: "CONSTRUTORA-OMEGA",
          ...(action === "update" ? { comercial: { cidade: "Campinas" } } : {}),
        }),
        "failed-precondition",
        /arquivado/,
      );
    }
    await rejeita(
      saveCustomerLocationFor(db, comercial, { idempotency_key: key(), customer_code: "CONSTRUTORA-OMEGA", nome: "Obra Centro" }),
      "failed-precondition",
      /arquivado/,
    );
    await rejeita(
      saveCustomerContactFor(db, comercial, { idempotency_key: key(), customer_code: "CONSTRUTORA-OMEGA", nome: "Fulano de Tal" }),
      "failed-precondition",
      /arquivado/,
    );
    assert.equal(await count("customer_locations"), 0);
    assert.equal(await count("customer_contacts"), 0);
  });
});

describe("locais do cliente", () => {
  it("cria e altera o local, com o evento sem endereço nem nome", async () => {
    await cadastroDoWms("Ita_", { code: "Itaú", name: "Itaú", sku_prefix: "ITAU" });
    const criado = await saveCustomerLocationFor(db, comercial, {
      idempotency_key: key(),
      customer_code: "Itaú",
      nome: "CEIC – Torre Olavo Setubal",
      sigla: "ceic",
      endereco: { logradouro: "Praça Alfredo Egydio de Souza Aranha", numero: "100", cidade: "São Paulo", uf: "SP", cep: "04344-902" },
    });
    assert.equal(criado.novo, true);
    assert.match(criado.local_id, /^loc_[0-9a-f]{20}$/);
    const local = (await db.collection("customer_locations").doc(criado.local_id).get()).data() ?? {};
    assert.equal(local.customer_code, "Itaú");
    assert.equal(local.customer_id, "Ita_");
    assert.equal(local.nome, "CEIC – Torre Olavo Setubal");
    assert.equal(local.sigla, "CEIC");
    assert.equal(local.ativo, true);
    assert.deepEqual(local.endereco, {
      logradouro: "Praça Alfredo Egydio de Souza Aranha",
      numero: "100",
      complemento: null,
      bairro: null,
      cidade: "São Paulo",
      uf: "SP",
      cep: "04344-902",
    });

    const alterado = await saveCustomerLocationFor(db, comercial, {
      idempotency_key: key(),
      customer_code: "Itaú",
      local_id: criado.local_id,
      nome: "CEIC – Torre Olavo Setubal",
      endereco: { complemento: "Torre 2" },
      ativo: false,
    });
    assert.equal(alterado.novo, false);
    assert.equal(alterado.local_id, criado.local_id);
    const depois = (await db.collection("customer_locations").doc(criado.local_id).get()).data() ?? {};
    assert.equal(depois.sigla, "CEIC", "sigla não informada continua");
    assert.equal(depois.endereco.complemento, "Torre 2");
    assert.equal(depois.endereco.logradouro, "Praça Alfredo Egydio de Souza Aranha");
    assert.equal(depois.ativo, false);
    assert.equal(depois.created_by, "com-1");
    assert.deepEqual(depois.created_at, local.created_at);

    const salvos = (await eventos()).filter((row) => row.type === "customer_location.saved");
    assert.deepEqual(
      salvos.map((row) => row.payload).sort((a, b) => Number((b as { novo: boolean }).novo) - Number((a as { novo: boolean }).novo)),
      [
        { local_id: criado.local_id, novo: true },
        { local_id: criado.local_id, novo: false },
      ],
    );
    for (const evento of salvos) {
      assert.equal(evento.customer_code, "Itaú");
      assert.doesNotMatch(JSON.stringify({ ...evento, actor: null }), /CEIC|Praça|04344/);
    }
  });

  it("nome e sigla não se repetem no mesmo cliente; em outro cliente, sim", async () => {
    await criar(comercial, { name: "Construtora Ômega" });
    await criar(comercial, { name: "Banco Safra" });
    await saveCustomerLocationFor(db, comercial, { idempotency_key: key(), customer_code: "CONSTRUTORA-OMEGA", nome: "Obra Centro", sigla: "OC" });
    await rejeita(
      saveCustomerLocationFor(db, comercial, { idempotency_key: key(), customer_code: "CONSTRUTORA-OMEGA", nome: "obra  centro" }),
      "already-exists",
      /nome/,
    );
    await rejeita(
      saveCustomerLocationFor(db, comercial, { idempotency_key: key(), customer_code: "CONSTRUTORA-OMEGA", nome: "Obra Sul", sigla: "oc" }),
      "already-exists",
      /sigla OC/,
    );
    await saveCustomerLocationFor(db, comercial, { idempotency_key: key(), customer_code: "BANCO-SAFRA", nome: "Obra Centro", sigla: "OC" });
    assert.equal(await count("customer_locations"), 2);
  });

  it("local de outro cliente não é alterado por este, e cliente sem cadastro é not-found", async () => {
    await criar(comercial, { name: "Construtora Ômega" });
    await criar(comercial, { name: "Banco Safra" });
    const { local_id } = await saveCustomerLocationFor(db, comercial, {
      idempotency_key: key(),
      customer_code: "BANCO-SAFRA",
      nome: "Agência Paulista",
    });
    await rejeita(
      saveCustomerLocationFor(db, comercial, {
        idempotency_key: key(),
        customer_code: "CONSTRUTORA-OMEGA",
        local_id,
        nome: "Agência Paulista",
      }),
      "failed-precondition",
      /outro cliente/,
    );
    await rejeita(
      saveCustomerLocationFor(db, comercial, { idempotency_key: key(), customer_code: "NADA", nome: "Obra" }),
      "not-found",
    );
    await rejeita(
      saveCustomerLocationFor(db, comercial, { idempotency_key: key(), customer_code: "BANCO-SAFRA", local_id: "loc_inexistente", nome: "Obra" }),
      "not-found",
    );
  });
});

describe("contatos do cliente", () => {
  it("cria e altera o contato; o evento não leva nome, e-mail nem telefone", async () => {
    await criar(comercial, { name: "Construtora Ômega" });
    const criado = await saveCustomerContactFor(db, comercial, {
      idempotency_key: key(),
      customer_code: "CONSTRUTORA-OMEGA",
      nome: "Fulano de Tal",
      email: "Fulano@Gerenciadora.com.br",
      telefone: "(11) 98765-4321",
      empresa: "Gerenciadora X",
      papel: "gerenciadora",
    });
    assert.equal(criado.novo, true);
    assert.match(criado.contato_id, /^ct_[0-9a-f]{20}$/);
    const contato = (await db.collection("customer_contacts").doc(criado.contato_id).get()).data() ?? {};
    assert.equal(contato.customer_code, "CONSTRUTORA-OMEGA");
    assert.equal(contato.nome, "Fulano de Tal");
    assert.equal(contato.email, "fulano@gerenciadora.com.br");
    assert.equal(contato.telefone, "11987654321");
    assert.equal(contato.empresa, "Gerenciadora X");
    assert.equal(contato.papel, "gerenciadora");
    assert.equal(contato.ativo, true);

    await saveCustomerContactFor(db, comercial, {
      idempotency_key: key(),
      customer_code: "CONSTRUTORA-OMEGA",
      contato_id: criado.contato_id,
      nome: "Fulano de Tal",
      ativo: false,
    });
    const depois = (await db.collection("customer_contacts").doc(criado.contato_id).get()).data() ?? {};
    assert.equal(depois.ativo, false);
    assert.equal(depois.email, "fulano@gerenciadora.com.br", "o que não veio continua");
    assert.equal(depois.papel, "gerenciadora");

    const salvos = (await eventos()).filter((row) => row.type === "customer_contact.saved");
    assert.equal(salvos.length, 2);
    for (const evento of salvos) {
      assert.equal(evento.customer_code, "CONSTRUTORA-OMEGA");
      assert.equal(evento.entity_type, "customer_contact");
      assert.doesNotMatch(JSON.stringify({ ...evento, actor: null }), /Fulano|gerenciadora\.com|98765|Gerenciadora X/i);
    }
  });

  it("a mesma pessoa em dois clientes são dois contatos; no mesmo cliente, um só", async () => {
    await criar(comercial, { name: "Construtora Ômega" });
    await criar(comercial, { name: "Banco Safra" });
    const pessoa = { nome: "Fulano de Tal", email: "fulano@gerenciadora.com.br", empresa: "Gerenciadora X" };
    const a = await saveCustomerContactFor(db, comercial, { idempotency_key: key(), customer_code: "CONSTRUTORA-OMEGA", ...pessoa });
    const b = await saveCustomerContactFor(db, comercial, { idempotency_key: key(), customer_code: "BANCO-SAFRA", ...pessoa });
    assert.notEqual(a.contato_id, b.contato_id);
    await rejeita(
      saveCustomerContactFor(db, comercial, {
        idempotency_key: key(),
        customer_code: "CONSTRUTORA-OMEGA",
        ...pessoa,
        email: "FULANO@gerenciadora.com.br",
      }),
      "already-exists",
      /e-mail/,
    );
    // O contato de outro cliente não é alterado por este.
    await rejeita(
      saveCustomerContactFor(db, comercial, {
        idempotency_key: key(),
        customer_code: "CONSTRUTORA-OMEGA",
        contato_id: b.contato_id,
        nome: "Fulano de Tal",
      }),
      "failed-precondition",
      /outro cliente/,
    );
    const contatos = (await db.collection("customer_contacts").get()).docs.map((row) => row.get("customer_code")).sort();
    assert.deepEqual(contatos, ["BANCO-SAFRA", "CONSTRUTORA-OMEGA"]);
  });

  it("o contato pode ser do cliente do WMS, com sigla", async () => {
    await cadastroDoWms("BTG_Pactual", { code: "BTG Pactual", name: "BTG Pactual", sku_prefix: "BTG" });
    const result = await saveCustomerContactFor(db, comercial, {
      idempotency_key: key(),
      customer_code: "BTG Pactual",
      nome: "Cristiane",
      papel: "gestor_cliente",
    });
    const contato = (await db.collection("customer_contacts").doc(result.contato_id).get()).data() ?? {};
    assert.equal(contato.customer_code, "BTG Pactual");
    assert.equal(contato.customer_id, "BTG_Pactual");
  });
});

describe("repetição idempotente", () => {
  it("a mesma chave e o mesmo conteúdo devolvem o resultado gravado, sem gravar de novo", async () => {
    const pedido = { action: "create", idempotency_key: "criar-omega", name: "Construtora Ômega" };
    const primeiro = await saveCommercialCustomerFor(db, comercial, pedido);
    const segundo = await saveCommercialCustomerFor(db, comercial, { ...pedido });
    assert.deepEqual(segundo, { ...primeiro, replayed: true });
    assert.equal(await count("customers"), 1);
    assert.equal(await count("events"), 1);
    assert.equal(await count(COMERCIAL_OPERATIONS_COLLECTION), 1);

    const contato = { idempotency_key: "contato-1", customer_code: "CONSTRUTORA-OMEGA", nome: "Fulano de Tal" };
    const c1 = await saveCustomerContactFor(db, comercial, contato);
    const c2 = await saveCustomerContactFor(db, comercial, { ...contato });
    assert.deepEqual(c2, { ...c1, replayed: true });
    assert.equal(await count("customer_contacts"), 1);

    const local = { idempotency_key: "local-1", customer_code: "CONSTRUTORA-OMEGA", nome: "Obra Centro" };
    const l1 = await saveCustomerLocationFor(db, comercial, local);
    const l2 = await saveCustomerLocationFor(db, comercial, { ...local });
    assert.deepEqual(l2, { ...l1, replayed: true });
    assert.equal(await count("customer_locations"), 1);

    const marcar = { action: "mark_client", idempotency_key: "marcar-1", customer_code: "CONSTRUTORA-OMEGA" };
    await saveCommercialCustomerFor(db, comercial, marcar);
    const replay = await saveCommercialCustomerFor(db, comercial, marcar);
    assert.equal(replay.replayed, true, "a repetição não vira 'já é cliente'");
    assert.equal(await count("events"), 4);
  });

  it("a mesma chave com outro conteúdo é already-exists e não grava nada", async () => {
    await saveCommercialCustomerFor(db, comercial, { action: "create", idempotency_key: "criar-1", name: "Construtora Ômega" });
    await rejeita(
      saveCommercialCustomerFor(db, comercial, { action: "create", idempotency_key: "criar-1", name: "Banco Safra" }),
      "already-exists",
      /chave de idempotência/,
    );
    assert.equal(await count("customers"), 1);
    assert.equal(await count("events"), 1);
  });
});
