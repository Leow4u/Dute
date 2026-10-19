import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CLIENT_PROFILE_PUBLIC_FIELDS,
  DEFAULT_OPERATION_TEMPLATE,
  OPERATION_TEMPLATE_KEYS,
  buildCustomerPayload,
  canonicalSkuPrefix,
  clientProfileProjection,
  normalizeSkuPrefix,
  resolveOperationTemplate,
} from "./customer-profile.js";

const actor = "admin-1";

function create(data: Record<string, unknown>) {
  return buildCustomerPayload({ action: "create", data, before: {}, documentId: "Itau", actorUid: actor });
}

describe("modelo de operação", () => {
  it("cadastro anterior ao campo continua no modelo da BTG", () => {
    assert.equal(resolveOperationTemplate(undefined), DEFAULT_OPERATION_TEMPLATE);
    assert.equal(resolveOperationTemplate(""), "uniformes");
  });

  it("aceita só as chaves do registro", () => {
    for (const key of OPERATION_TEMPLATE_KEYS) assert.equal(resolveOperationTemplate(key), key);
    assert.throws(() => resolveOperationTemplate("varejo"), /Modelo de operação desconhecido: varejo/);
  });

  it("modelo sem portal nasce com o portal desligado, mesmo que o cadastro peça ativo", () => {
    const payload = create({ code: "Dutelog", name: "Dutelog", sku_prefix: "DUT", operation_template: "insumos", portal_status: "active" });
    assert.equal(payload.portal_status, "inactive");
    assert.equal(payload.operation_template, "insumos");
  });
});

describe("sigla do SKU", () => {
  it("normaliza maiúsculas, acento e espaço", () => {
    assert.equal(normalizeSkuPrefix(" itaú "), "ITAU");
    assert.equal(normalizeSkuPrefix("btg"), "BTG");
    assert.equal(canonicalSkuPrefix("B-T G"), "BTG");
  });

  it("recusa sigla vazia, curta, longa ou começando por número", () => {
    assert.throws(() => normalizeSkuPrefix(""), /Informe a sigla/);
    assert.throws(() => normalizeSkuPrefix("B"), /Sigla do SKU inválida: B\./);
    assert.throws(() => normalizeSkuPrefix("DUTELOG"), /inválida/);
    assert.throws(() => normalizeSkuPrefix("1AB"), /inválida/);
  });
});

describe("payload do cadastro", () => {
  it("create: código, nome, modelo e sigla; defaults de cobrança e autoria", () => {
    const payload = create({ code: "Itaú", name: "Itaú Unibanco", sku_prefix: "itau", operation_template: "mobiliario", notes: "contrato X" });
    assert.equal(payload.code, "Itaú");
    assert.equal(payload.customer_code, "Itaú");
    assert.equal(payload.name, "Itaú Unibanco");
    assert.equal(payload.sku_prefix, "ITAU");
    assert.equal(payload.operation_template, "mobiliario");
    assert.equal(payload.portal_status, "active");
    assert.equal(payload.status, "active");
    assert.equal(payload.billing_mode, "lpu");
    assert.equal(payload.default_currency, "BRL");
    assert.equal(payload.archived, false);
    assert.equal(payload.created_by, actor);
    assert.equal(payload.notes, "contrato X");
  });

  it("create exige a sigla e o nome", () => {
    assert.throws(() => create({ code: "Itaú", name: "Itaú", operation_template: "mobiliario" }), /Informe a sigla/);
    assert.throws(() => create({ code: "Itaú", sku_prefix: "ITAU" }), /Código e nome/);
  });

  it("update mantém o que não veio e não deixa trocar o código", () => {
    const before = { code: "BTG Pactual", name: "BTG Pactual", sku_prefix: "BTG", operation_template: "uniformes", status: "active", portal_status: "active" };
    const payload = buildCustomerPayload({ action: "update", data: { name: "BTG Pactual S.A.", notes: "nova" }, before, documentId: "BTG_Pactual", actorUid: actor });
    assert.equal(payload.code, "BTG Pactual");
    assert.equal(payload.sku_prefix, "BTG");
    assert.equal(payload.operation_template, "uniformes");
    assert.equal(payload.updated_by, actor);
    assert.equal(payload.created_by, undefined);
    assert.throws(
      () => buildCustomerPayload({ action: "update", data: { code: "BTG" }, before, documentId: "BTG_Pactual", actorUid: actor }),
      /código operacional não muda/,
    );
  });

  it("update de cadastro antigo (sem sigla) exige a sigla", () => {
    const before = { code: "BTG Pactual", name: "BTG Pactual", status: "active" };
    assert.throws(
      () => buildCustomerPayload({ action: "update", data: { name: "BTG" }, before, documentId: "BTG_Pactual", actorUid: actor }),
      /Informe a sigla/,
    );
    const payload = buildCustomerPayload({ action: "update", data: { sku_prefix: "BTG" }, before, documentId: "BTG_Pactual", actorUid: actor });
    assert.equal(payload.operation_template, "uniformes");
    assert.equal(payload.sku_prefix, "BTG");
  });

  it("situação arquivada só pela ação de arquivar", () => {
    assert.throws(() => create({ code: "X", name: "X", sku_prefix: "XX", status: "archived" }), /ação de arquivar/);
    const archived = buildCustomerPayload({ action: "archive", data: {}, before: { code: "X" }, documentId: "X", actorUid: actor });
    assert.equal(archived.status, "archived");
    assert.equal(archived.archived, true);
    assert.equal(archived.portal_status, "inactive");
    assert.equal(archived.archived_by, actor);
  });

  it("recusa situação de portal ou de cliente fora da lista", () => {
    assert.throws(() => create({ code: "X", name: "X", sku_prefix: "XX", portal_status: "maybe" }), /Situação do portal inválida/);
    assert.throws(() => create({ code: "X", name: "X", sku_prefix: "XX", status: "sleeping" }), /Situação do cliente inválida/);
  });
});

describe("projeção client_profiles", () => {
  it("publica só os campos públicos, nunca observação, CNPJ ou contato", () => {
    const payload = create({
      code: "Itaú",
      name: "Itaú Unibanco",
      sku_prefix: "ITAU",
      operation_template: "mobiliario",
      notes: "só interno",
      document: "00.000.000/0001-00",
      primary_contact_email: "x@itau.com",
    });
    const projection = clientProfileProjection("Itau", payload, {});
    assert.deepEqual(Object.keys(projection).sort(), [...CLIENT_PROFILE_PUBLIC_FIELDS, "id", "updated_at"].sort());
    assert.equal(projection.customer_code, "Itaú");
    assert.equal(projection.operation_template, "mobiliario");
    assert.equal(projection.sku_prefix, "ITAU");
    assert.equal(projection.portal_status, "active");
    assert.equal(projection.archived, false);
    assert.equal("notes" in projection, false);
    assert.equal("document" in projection, false);
  });

  it("no arquivamento, completa com o documento anterior e desliga o portal", () => {
    const before = { code: "Itaú", name: "Itaú Unibanco", sku_prefix: "ITAU", operation_template: "mobiliario", portal_status: "active" };
    const archived = buildCustomerPayload({ action: "archive", data: {}, before, documentId: "Itau", actorUid: actor });
    const projection = clientProfileProjection("Itau", archived, before);
    assert.equal(projection.name, "Itaú Unibanco");
    assert.equal(projection.operation_template, "mobiliario");
    assert.equal(projection.portal_status, "inactive");
    assert.equal(projection.archived, true);
  });

  it("cadastro antigo sem modelo projeta o modelo da BTG", () => {
    const projection = clientProfileProjection("BTG_Pactual", { name: "BTG Pactual", code: "BTG Pactual" }, {});
    assert.equal(projection.operation_template, "uniformes");
    assert.equal(projection.sku_prefix, null);
  });
});
