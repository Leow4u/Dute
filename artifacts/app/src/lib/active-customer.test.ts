import { describe, expect, it } from "vitest";

import {
  LEGACY_CUSTOMER_CODE,
  activeCustomerOptions,
  activeCustomerStorageKey,
  belongsToCustomer,
  customerRows,
  canCreateCatalogItemFor,
  recordCustomerCode,
  resolveActiveCustomerCode,
} from "./active-customer";

const itau = { customer_code: "Itaú", name: "Itaú Unibanco", operation_template: "mobiliario", sku_prefix: "ITAU" };
const btg = { customer_code: "BTG Pactual", name: "BTG Pactual", operation_template: "uniformes", sku_prefix: "BTG" };

describe("opções do seletor", () => {
  it("sem perfil publicado, só a BTG, no modelo padrão", () => {
    const options = activeCustomerOptions([]);
    expect(options.map((option) => option.code)).toEqual([LEGACY_CUSTOMER_CODE]);
    expect(options[0].profile.template.key).toBe("uniformes");
    expect(options[0].profile.pack?.key).toBe("btg");
  });

  it("a BTG entra mesmo antes de publicar o perfil; arquivados ficam de fora; ordem por nome", () => {
    const options = activeCustomerOptions([
      itau,
      { customer_code: "Antigo", name: "Cliente antigo", archived: true },
      { customer_code: "Dutelog", name: "Dutelog", operation_template: "insumos", status: "paused" },
    ]);
    expect(options.map((option) => option.name)).toEqual(["BTG Pactual", "Dutelog", "Itaú Unibanco"]);
    expect(options.find((option) => option.code === "Itaú")?.profile.template.key).toBe("mobiliario");
    expect(options.find((option) => option.code === "Dutelog")?.paused).toBe(true);
  });

  it("perfil publicado da BTG vale no lugar do padrão, sem duplicar", () => {
    const options = activeCustomerOptions([btg, itau, { ...btg }]);
    expect(options.filter((option) => option.code === LEGACY_CUSTOMER_CODE)).toHaveLength(1);
    expect(options[0].profile.skuPrefix).toBe("BTG");
    expect(options[0].profile.source).toBe("published");
  });
});

describe("cliente ativo", () => {
  const options = activeCustomerOptions([itau]);

  it("vale o guardado no aparelho enquanto ele existir", () => {
    expect(resolveActiveCustomerCode(options, "Itaú")).toBe("Itaú");
    expect(resolveActiveCustomerCode(options, " Itaú ")).toBe("Itaú");
  });

  it("guardado que não existe mais, ou nada guardado, cai na BTG", () => {
    expect(resolveActiveCustomerCode(options, "Arquivado")).toBe(LEGACY_CUSTOMER_CODE);
    expect(resolveActiveCustomerCode(options, null)).toBe(LEGACY_CUSTOMER_CODE);
  });

  it("a chave do aparelho é por pessoa", () => {
    expect(activeCustomerStorageKey("uid-1")).toBe("dute.active-customer.uid-1");
    expect(activeCustomerStorageKey(undefined)).toBe("dute.active-customer.anon");
  });
});

describe("dono do registro", () => {
  it("sem customer_code, o registro é da BTG", () => {
    expect(recordCustomerCode({})).toBe(LEGACY_CUSTOMER_CODE);
    expect(recordCustomerCode({ customer_code: "Itaú" })).toBe("Itaú");
    expect(belongsToCustomer({ cod_cliente: "A.01" } as never, LEGACY_CUSTOMER_CODE)).toBe(true);
    expect(belongsToCustomer({ cod_cliente: "A.01" } as never, "Itaú")).toBe(false);
    expect(belongsToCustomer({ customer_code: "Itaú" }, "Itaú")).toBe(true);
  });

  it("filtra as linhas do cliente, com as legadas na BTG", () => {
    const rows = [{ customer_code: "Itaú", id: "1" }, { id: "2" }, { customer_code: "BTG Pactual", id: "3" }];
    expect(customerRows(rows, "Itaú").map((row) => row.id)).toEqual(["1"]);
    expect(customerRows(rows, LEGACY_CUSTOMER_CODE).map((row) => row.id)).toEqual(["2", "3"]);
    expect(customerRows(undefined, "Itaú")).toEqual([]);
  });

  it("o Novo item do catálogo segue só para a BTG até o SKU por cliente", () => {
    expect(canCreateCatalogItemFor(LEGACY_CUSTOMER_CODE)).toBe(true);
    expect(canCreateCatalogItemFor("Itaú")).toBe(false);
  });
});
