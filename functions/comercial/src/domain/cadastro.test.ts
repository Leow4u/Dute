import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import {
  SaveCommercialCustomerInput,
  SaveCustomerContactInput,
  SaveCustomerLocationInput,
  parseEntrada,
  prospectPayload,
  saveCommercialCustomerFor,
  saveCustomerContactFor,
  saveCustomerLocationFor,
} from "./cadastro.js";
import type { ComercialProfile } from "./profile.js";

/**
 * Entrada e papéis do cadastro comercial, sem banco: o que é recusado aqui
 * não chega a ler nada (o banco falso derruba o teste se for tocado).
 */

const intocavel = new Proxy(
  {},
  {
    get() {
      throw new Error("o banco não podia ser lido");
    },
  },
) as unknown as Firestore;

const comercial: ComercialProfile = { uid: "com-1", role: "comercial", name: "Guilherme" };
const owner: ComercialProfile = { uid: "owner-1", role: "owner" };

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

function entrada(schema: Parameters<typeof parseEntrada>[0], data: unknown) {
  try {
    return parseEntrada(schema, data);
  } catch (error) {
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, "invalid-argument", error.message);
    throw error;
  }
}

describe("entrada do saveCommercialCustomer", () => {
  it("sem ação, ação desconhecida ou campo a mais: invalid-argument em português", async () => {
    await rejeita(saveCommercialCustomerFor(intocavel, comercial, { idempotency_key: "k" }), "invalid-argument", /action: use create, update, mark_client, archive/);
    await rejeita(
      saveCommercialCustomerFor(intocavel, comercial, { action: "delete", idempotency_key: "k", customer_code: "X" }),
      "invalid-argument",
    );
    await rejeita(saveCommercialCustomerFor(intocavel, comercial, null), "invalid-argument");
  });

  it("o Comercial nunca recebe sigla, modelo, módulos, estágio nem projeção", async () => {
    for (const campo of ["sku_prefix", "operation_template", "modules", "stage", "client_profiles", "status", "portal_status", "origem"]) {
      await rejeita(
        saveCommercialCustomerFor(intocavel, comercial, { action: "create", idempotency_key: "k", name: "Itaú", [campo]: "x" }),
        "invalid-argument",
        new RegExp(`Campo não aceito: ${campo}`),
      );
    }
    await rejeita(
      saveCommercialCustomerFor(intocavel, comercial, {
        action: "update",
        idempotency_key: "k",
        customer_code: "ITAU",
        comercial: { omie_ids: ["1"] },
      }),
      "invalid-argument",
      /Campo não aceito: omie_ids/,
    );
  });

  it("nome curto, código inválido, CNPJ inválido e UF desconhecida", async () => {
    await rejeita(
      saveCommercialCustomerFor(intocavel, comercial, { action: "create", idempotency_key: "k", name: "I" }),
      "invalid-argument",
      /Informe o nome/,
    );
    await rejeita(
      saveCommercialCustomerFor(intocavel, comercial, { action: "create", idempotency_key: "k", name: "Itaú", code: "ITAÚ" }),
      "invalid-argument",
      /Código do cliente inválido/,
    );
    await rejeita(
      saveCommercialCustomerFor(intocavel, comercial, { action: "create", idempotency_key: "k", name: "Itaú", document: "12.345.678/0001-00" }),
      "invalid-argument",
      /CNPJ inválido/,
    );
    await rejeita(
      saveCommercialCustomerFor(intocavel, comercial, { action: "create", idempotency_key: "k", name: "Itaú", comercial: { uf: "XX" } }),
      "invalid-argument",
      /UF inválida/,
    );
    await rejeita(
      saveCommercialCustomerFor(intocavel, comercial, { action: "create", idempotency_key: "  ", name: "Itaú" }),
      "invalid-argument",
      /chave de idempotência/,
    );
  });

  it("texto vazio limpa o campo e a UF vem em maiúsculas", () => {
    const input = entrada(SaveCommercialCustomerInput, {
      action: "update",
      idempotency_key: "k",
      customer_code: "ITAU",
      legal_name: "  ",
      comercial: { cidade: " São Paulo ", uf: "sp" },
    });
    assert.equal(input.action, "update");
    if (input.action !== "update") return;
    assert.equal(input.legal_name, null);
    assert.deepEqual(input.comercial, { cidade: "São Paulo", uf: "SP" });
  });
});

describe("papéis do cadastro comercial", () => {
  it("o comercial não arquiva: permission-denied antes de ler o banco", async () => {
    await rejeita(
      saveCommercialCustomerFor(intocavel, comercial, { action: "archive", idempotency_key: "k", customer_code: "ITAU" }),
      "permission-denied",
      /Só owner e admin arquivam/,
    );
  });

  it("papel sem o Comercial não grava nada, nem local nem contato", async () => {
    for (const role of ["wms", "interno", "suporte", "financeiro", "campo", "cliente"] as const) {
      const caller: ComercialProfile = { uid: `${role}-1`, role };
      await rejeita(
        saveCommercialCustomerFor(intocavel, caller, { action: "create", idempotency_key: "k", name: "Itaú" }),
        "permission-denied",
      );
      await rejeita(
        saveCustomerLocationFor(intocavel, caller, { idempotency_key: "k", customer_code: "ITAU", nome: "CEIC" }),
        "permission-denied",
      );
      await rejeita(
        saveCustomerContactFor(intocavel, caller, { idempotency_key: "k", customer_code: "ITAU", nome: "Fulano" }),
        "permission-denied",
      );
    }
  });

  it("owner passa da barreira (e só então lê o banco)", async () => {
    await assert.rejects(
      saveCommercialCustomerFor(intocavel, owner, { action: "archive", idempotency_key: "k", customer_code: "ITAU" }),
      /o banco não podia ser lido/,
    );
  });
});

describe("entrada de local e contato", () => {
  it("local: sigla em maiúsculas, CEP com hífen e endereço sem campo a mais", async () => {
    const local = entrada(SaveCustomerLocationInput, {
      idempotency_key: "k",
      customer_code: "ITAU",
      nome: "CEIC – Torre Olavo Setubal",
      sigla: "ceic",
      endereco: { logradouro: "Praça Alfredo Egydio de Souza Aranha", numero: "100", cidade: "São Paulo", uf: "sp", cep: "04344902" },
    });
    assert.equal(local.sigla, "CEIC");
    assert.equal(local.endereco?.cep, "04344-902");
    assert.equal(local.endereco?.uf, "SP");
    for (const errado of [
      { sigla: "CE IC" },
      { endereco: { cep: "0434" } },
      { endereco: { pais: "BR" } },
      { local_id: "loc/1" },
    ]) {
      await rejeita(
        saveCustomerLocationFor(intocavel, comercial, { idempotency_key: "k", customer_code: "ITAU", nome: "CEIC", ...errado }),
        "invalid-argument",
      );
    }
  });

  it("contato: e-mail em minúsculas, telefone só com dígitos, papel da lista", async () => {
    const contato = entrada(SaveCustomerContactInput, {
      idempotency_key: "k",
      customer_code: "ITAU",
      nome: "Fulano de Tal",
      email: " Fulano@Gerenciadora.com.br ",
      telefone: "(11) 98765-4321",
      empresa: "Gerenciadora X",
      papel: "gerenciadora",
    });
    assert.equal(contato.email, "fulano@gerenciadora.com.br");
    assert.equal(contato.telefone, "11987654321");
    for (const errado of [{ email: "fulano@" }, { telefone: "123" }, { papel: "diretor" }, { cpf: "123" }]) {
      await rejeita(
        saveCustomerContactFor(intocavel, comercial, { idempotency_key: "k", customer_code: "ITAU", nome: "Fulano", ...errado }),
        "invalid-argument",
      );
    }
  });
});

describe("documento do prospect", () => {
  it("só os campos do Comercial: nada de sigla, modelo, módulos nem projeção", () => {
    const payload = prospectPayload(
      "ITAU",
      {
        code: "ITAU",
        name: "Itaú",
        legal_name: null,
        document: null,
        origem: "comercial",
        comercial: { responsavel_uid: "com-1", cidade: null, uf: null, omie_ids: [] },
      },
      "com-1",
    );
    for (const campo of ["sku_prefix", "operation_template", "modules", "billing_mode", "client_profiles", "client_access"]) {
      assert.equal(campo in payload, false, campo);
    }
    assert.equal(payload.stage, "prospect");
    assert.equal(payload.status, "active");
    assert.equal(payload.portal_status, "inactive");
    assert.equal(payload.customer_code, "ITAU");
    assert.equal(payload.code, "ITAU");
    assert.equal(payload.origem, "comercial");
  });
});
