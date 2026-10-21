import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildCustomerRows,
  toggleContractedModule,
  customerFormFrom,
  customerFormProblem,
  customerPayload,
  emptyCustomerForm,
  inviteCustomers,
  peopleLabel,
  portalStatusFor,
  zoneCustomers,
  zoneLabel,
} from "./customer-registry";

const btg = { id: "BTG_Pactual", code: "BTG Pactual", name: "BTG Pactual", status: "active", notes: "interno" };

describe("cadastro com armazenagem (sigla do SKU)", () => {
  const itau = { id: "Ita_", code: "Itaú", name: "Itaú", sku_prefix: "ITAU", status: "active", portal_status: "active" };
  const semSigla = { id: "Mudancas", code: "Mudancas", name: "Mudanças SP", status: "active", portal_status: "active" };

  it("Posições lista só cadastro com sigla; a BTG sem sigla continua", () => {
    expect(zoneCustomers([btg, itau, semSigla]).map((customer) => customer.code)).toEqual(["BTG Pactual", "Itaú"]);
    expect(zoneCustomers([{ ...semSigla, sku_prefix: " " }])).toEqual([]);
    expect(zoneCustomers([{ ...itau, status: "inactive" }, { ...itau, code: "" }])).toEqual([]);
  });

  it("o convite oferece só cliente com portal e sigla; a BTG sem sigla continua", () => {
    expect(inviteCustomers([btg, itau, semSigla]).map((customer) => customer.code)).toEqual(["BTG Pactual", "Itaú"]);
    expect(inviteCustomers([{ ...itau, portal_status: "inactive" }, { ...itau, archived: true }])).toEqual([]);
  });

  it("Configurações › Clientes mostra \"Convidar\" só para quem pode receber convite; a BTG sem sigla continua", () => {
    const antigo = { ...itau, id: "Antigo", code: "Antigo", name: "Antigo", archived: true, status: "archived" };
    const rows = buildCustomerRows([btg, itau, semSigla, antigo], [], []);
    expect(Object.fromEntries(rows.map((row) => [row.code, row.invitable]))).toEqual({
      "BTG Pactual": true,
      Itaú: true,
      Mudancas: false,
      Antigo: false,
    });
  });
});

describe("as telas usam as regras do cadastro com armazenagem", () => {
  const PAGES = fileURLToPath(new URL("../pages/", import.meta.url));
  const page = (file: string) => readFileSync(`${PAGES}${file}`, "utf8");

  it("Estoque › Posições filtra a lista de clientes por zoneCustomers", () => {
    const source = page("warehouse-positions.tsx");
    expect(source).toContain('"/api/customers?limit=500"');
    expect(source).toMatch(/zoneCustomers\(\s*customersQuery\.data\?\.items/);
  });

  it("o convite de Pessoas filtra a lista de clientes por inviteCustomers", () => {
    const source = page("users.tsx");
    expect(source).toMatch(/\/api\/customers\?status=active/);
    expect(source).toMatch(/inviteCustomers\(\s*payload\.items/);
  });

  it("o \"Convidar\" de Configurações › Clientes depende de row.invitable", () => {
    const source = page("settings-customers.tsx");
    const link = source.indexOf("convidar=cliente");
    expect(link).toBeGreaterThan(0);
    const condition = source.lastIndexOf("{row.invitable ? (", link);
    expect(condition).toBeGreaterThan(0);
    expect(link - condition).toBeLessThan(200);
  });
});

describe("formulário do cliente", () => {
  it("cadastro antigo da BTG abre em Uniformes com a sigla sugerida pelo nome", () => {
    const form = customerFormFrom(btg);
    expect(form.code).toBe("BTG Pactual");
    expect(form.operation_template).toBe("uniformes");
    expect(form.sku_prefix).toBe("BTG");
    expect(form.portal_status).toBe("active");
    expect(form.status).toBe("active");
  });

  it("cadastro novo abre com o que foi salvo", () => {
    const form = customerFormFrom({
      code: "Itaú",
      name: "Itaú Unibanco",
      operation_template: "mobiliario",
      sku_prefix: "ITAU",
      portal_status: "inactive",
      status: "paused",
    });
    expect(form.operation_template).toBe("mobiliario");
    expect(form.sku_prefix).toBe("ITAU");
    expect(form.portal_status).toBe("inactive");
    expect(form.status).toBe("paused");
  });

  it("modelo sem portal força sem portal", () => {
    expect(portalStatusFor("insumos", "active")).toBe("inactive");
    expect(portalStatusFor("uniformes", "active")).toBe("active");
    expect(portalStatusFor("mobiliario", "inactive")).toBe("inactive");
  });

  it("aponta o primeiro problema antes de salvar", () => {
    const form = { ...emptyCustomerForm(), name: "Itaú Unibanco" };
    expect(customerFormProblem(form, "create")).toMatch(/código operacional/);
    expect(customerFormProblem({ ...form, code: "Itaú" }, "create")).toMatch(/Informe a sigla/);
    expect(customerFormProblem({ ...form, code: "Itaú", sku_prefix: "I" }, "create")).toMatch(/2 a 6/);
    expect(customerFormProblem({ ...form, code: "Itaú", sku_prefix: "ITAU", primary_contact_email: "x" }, "create")).toMatch(/E-mail/);
    expect(customerFormProblem({ ...form, code: "Itaú", sku_prefix: "ITAU" }, "create")).toBeNull();
    // Na edição o código já existe e não é digitado.
    expect(customerFormProblem({ ...form, sku_prefix: "ITAU" }, "edit")).toBeNull();
  });

  it("payload: create leva código e cobrança padrão; update não leva código", () => {
    const form = {
      ...emptyCustomerForm(),
      code: " Itaú ",
      name: " Itaú Unibanco ",
      sku_prefix: "itaú",
      operation_template: "mobiliario" as const,
      primary_contact_email: "Facilities@Itau.com ",
    };
    const create = customerPayload(form, "create");
    expect(create.code).toBe("Itaú");
    expect(create.name).toBe("Itaú Unibanco");
    expect(create.sku_prefix).toBe("ITAU");
    expect(create.billing_mode).toBe("lpu");
    expect(create.primary_contact_email).toBe("facilities@itau.com");
    const update = customerPayload(form, "edit");
    expect("code" in update).toBe(false);
    expect("billing_mode" in update).toBe(false);
  });

  it("payload de modelo sem portal vai com o portal desligado", () => {
    const form = { ...emptyCustomerForm(), code: "Dutelog", name: "Dutelog", sku_prefix: "DUT", operation_template: "insumos" as const };
    expect(customerPayload(form, "create").portal_status).toBe("inactive");
  });
});

describe("linhas da lista", () => {
  const customers = [
    { id: "Antigo", code: "Antigo", name: "Cliente antigo", status: "archived", archived: true },
    { id: "Itau", code: "Itaú", name: "Itaú Unibanco", operation_template: "mobiliario", sku_prefix: "ITAU", status: "paused" },
    btg,
    { id: "Dutelog", code: "Dutelog", name: "Dutelog", operation_template: "insumos", sku_prefix: "DUT" },
  ];
  const positions = [
    { aisle: "A", customer_code: "BTG Pactual" },
    { aisle: "A", customer_code: "BTG Pactual" },
    { aisle: "B", customer_code: "BTG Pactual" },
    { aisle: "C", customer_code: null },
  ];
  const people = [
    { role: "cliente", customer_code: "BTG Pactual" },
    { role: "cliente" }, // convite antigo, sem código: é da BTG
    { role: "cliente", customer_code: "BTG Pactual", access_disabled: true },
    { role: "cliente", customer_code: "Itaú" },
    { role: "admin", customer_code: "Dutelog" },
  ];

  it("ativos primeiro, pausados depois, arquivados por último", () => {
    expect(buildCustomerRows(customers, positions, people).map((row) => row.name)).toEqual([
      "BTG Pactual",
      "Dutelog",
      "Itaú Unibanco",
      "Cliente antigo",
    ]);
  });

  it("junta modelo, pacote, zona e pessoas de cada cliente", () => {
    const rows = buildCustomerRows(customers, positions, people);
    const byCode = Object.fromEntries(rows.map((row) => [row.code, row]));
    expect(byCode["BTG Pactual"].profile.template.key).toBe("uniformes");
    expect(byCode["BTG Pactual"].profile.pack?.key).toBe("btg");
    expect(byCode["BTG Pactual"].zone).toEqual({ positions: 3, aisles: ["A", "B"] });
    expect(byCode["BTG Pactual"].people).toBe(2);
    expect(byCode["Itaú"].profile.template.key).toBe("mobiliario");
    expect(byCode["Itaú"].profile.pack).toBeNull();
    expect(byCode["Itaú"].zone).toBeNull();
    expect(byCode["Itaú"].people).toBe(1);
    expect(byCode["Itaú"].paused).toBe(true);
    expect(byCode["Dutelog"].profile.portalStatus).toBe("inactive");
    expect(byCode["Dutelog"].people).toBe(0);
    expect(byCode["Antigo"].archived).toBe(true);
  });

  it("rótulos de zona e de pessoas", () => {
    expect(zoneLabel(null)).toBe("A definir em Posições");
    expect(zoneLabel({ positions: 1, aisles: ["D"] })).toBe("Rua D · 1 prateleira");
    expect(zoneLabel({ positions: 12, aisles: ["A", "B", "C"] })).toBe("Ruas A, B e C · 12 prateleiras");
    expect(peopleLabel(0)).toBe("Ninguém no portal");
    expect(peopleLabel(1)).toBe("1 pessoa");
    expect(peopleLabel(3)).toBe("3 pessoas");
  });
});

describe("módulos contratados no cadastro (Fase 2)", () => {
  it("cadastro sem o campo abre com armazenagem e faturas, o que a BTG tem hoje", () => {
    expect(customerFormFrom(btg).modules).toEqual(["wms", "financeiro"]);
    expect(emptyCustomerForm().modules).toEqual(["wms", "financeiro"]);
  });

  it("abre com os módulos salvos, na ordem do registro", () => {
    expect(customerFormFrom({ ...btg, modules: ["operacao", "wms"] }).modules).toEqual(["wms", "operacao"]);
  });

  it("liga e desliga um módulo mantendo a ordem", () => {
    expect(toggleContractedModule(["wms"], "financeiro", true)).toEqual(["wms", "financeiro"]);
    expect(toggleContractedModule(["wms", "operacao", "financeiro"], "operacao", false)).toEqual(["wms", "financeiro"]);
  });

  it("exige ao menos um módulo", () => {
    const form = { ...customerFormFrom(btg), modules: [] };
    expect(customerFormProblem(form, "edit")).toBe("Marque ao menos um módulo contratado.");
  });

  it("os módulos só vão para a Function onde a plataforma está liberada", () => {
    const form = { ...customerFormFrom(btg), modules: toggleContractedModule(["wms"], "operacao", true) };
    expect(customerPayload(form, "edit")).not.toHaveProperty("modules");
    expect(customerPayload(form, "edit", { modules: false })).not.toHaveProperty("modules");
    expect(customerPayload(form, "edit", { modules: true }).modules).toEqual(["wms", "operacao"]);
    expect(customerPayload(form, "create", { modules: true }).modules).toEqual(["wms", "operacao"]);
  });
});
