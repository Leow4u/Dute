import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEGACY_CUSTOMER_CODE,
  assertCatalogOwnedBy,
  defaultNotificationRecipients,
  openingInventoryBlocksOutbound,
  openingUsesGlobalControl,
  recordOwner,
} from "./customer-scope.js";

const ITAU = "Itaú";
const pending = { stock_initialized: false, opening_inventory_required: true };
const initialized = { stock_initialized: true, opening_inventory_required: false };

describe("dono do registro", () => {
  it("sem customer_code, o registro é do cliente legado", () => {
    assert.equal(recordOwner({}), LEGACY_CUSTOMER_CODE);
    assert.equal(recordOwner(undefined), LEGACY_CUSTOMER_CODE);
    assert.equal(recordOwner({ customer_code: "  " }), LEGACY_CUSTOMER_CODE);
    assert.equal(recordOwner({ customer_code: ITAU }), ITAU);
  });
});

describe("trava do inventário de abertura por cliente", () => {
  it("cliente legado segue o controle global, como antes", () => {
    assert.equal(openingUsesGlobalControl(LEGACY_CUSTOMER_CODE), true);
    assert.equal(openingInventoryBlocksOutbound({ customerCode: LEGACY_CUSTOMER_CODE, control: pending }), true);
    assert.equal(openingInventoryBlocksOutbound({ customerCode: LEGACY_CUSTOMER_CODE, control: initialized }), false);
    assert.equal(openingInventoryBlocksOutbound({ customerCode: LEGACY_CUSTOMER_CODE }), false);
    // A sessão de outro cliente não muda nada para o legado.
    assert.equal(
      openingInventoryBlocksOutbound({ customerCode: LEGACY_CUSTOMER_CODE, control: initialized, session: { status: "open" } }),
      false,
    );
  });

  it("outro cliente segue só a própria sessão", () => {
    assert.equal(openingUsesGlobalControl(ITAU), false);
    assert.equal(openingInventoryBlocksOutbound({ customerCode: ITAU, control: pending }), false);
    assert.equal(openingInventoryBlocksOutbound({ customerCode: ITAU, control: pending, session: { status: "open" } }), true);
    assert.equal(openingInventoryBlocksOutbound({ customerCode: ITAU, control: initialized, session: { status: "open" } }), true);
    assert.equal(openingInventoryBlocksOutbound({ customerCode: ITAU, control: pending, session: { status: "completed" } }), false);
  });
});

describe("catálogo com dono", () => {
  it("aceita registros do próprio cliente e ignora os ausentes", () => {
    assert.doesNotThrow(() => assertCatalogOwnedBy(ITAU, [{ customer_code: ITAU }, undefined, null], "O código X-1"));
    assert.doesNotThrow(() => assertCatalogOwnedBy(LEGACY_CUSTOMER_CODE, [{ cod_cliente: "A" }], "O código A"));
  });

  it("recusa registro de outro cliente, inclusive o legado sem customer_code e o arquivado", () => {
    assert.throws(
      () => assertCatalogOwnedBy(ITAU, [{ cod_cliente: "A.01" }], "O código A.01"),
      /O código A\.01 já está cadastrado para o cliente BTG Pactual/,
    );
    assert.throws(
      () => assertCatalogOwnedBy(LEGACY_CUSTOMER_CODE, [{ customer_code: ITAU, archived: true }], "O SKU 7781-02"),
      /O SKU 7781-02 já está cadastrado para o cliente Itaú/,
    );
  });
});

describe("destinatários padrão das notificações", () => {
  const env = { clientDefaults: ["contato@btg.com"], internalDefaults: ["ops@dutelog.com.br"] };

  it("a lista do cliente vale só para o cliente legado", () => {
    assert.deepEqual(defaultNotificationRecipients({ audience: "client", customerCode: LEGACY_CUSTOMER_CODE, ...env }), ["contato@btg.com"]);
    assert.deepEqual(defaultNotificationRecipients({ audience: "client", customerCode: "", ...env }), ["contato@btg.com"]);
    assert.deepEqual(defaultNotificationRecipients({ audience: "client", customerCode: ITAU, ...env }), []);
  });

  it("a lista interna vale para qualquer cliente", () => {
    assert.deepEqual(defaultNotificationRecipients({ audience: "internal", customerCode: ITAU, ...env }), ["ops@dutelog.com.br"]);
  });
});
