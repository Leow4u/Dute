import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveOperationProfile } from "./operations";
import { buildShelves } from "./warehouse-map";
import type { WarehouseBox } from "./warehouse-boxes";
import type { WarehousePosition } from "./warehouse-positions";

import {
  buildCustomerRows,
  toggleContractedModule,
  customerFormFrom,
  customerFormProblem,
  customerPayload,
  emptyCustomerForm,
  inviteCustomers,
  customerInitials,
  customerSituation,
  countCustomerFilters,
  customerCodeFromSearch,
  customerFormWith,
  customerHref,
  customerInFilter,
  customerSince,
  customerTone,
  inboundConferenceLabel,
  peopleNamesByCustomer,
  portalScreens,
  searchCustomerRows,
  zoneOccupancy,
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
    // Desde 11/11/2026 o "Convidar" fica no cabeçalho da página do cliente.
    const source = readFileSync(fileURLToPath(new URL("../components/clientes/pagina-do-cliente.tsx", import.meta.url)), "utf8");
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
    // A mesma frase das Functions (customer-profile.ts): diz o que corrigir, sem explicar.
    expect(customerFormProblem(form, "create")).toBe("Informe o código operacional do cliente.");
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

describe("o cartão e a página de Configurações › Clientes", () => {
  it("abre com a sigla do nome: duas palavras ou as duas letras de uma só", () => {
    expect(customerInitials("Itaú Unibanco")).toBe("IU");
    expect(customerInitials("BTG")).toBe("BT");
    expect(customerInitials("  banco  safra s.a. ")).toBe("BS");
    expect(customerInitials("123")).toBe("?");
    expect(customerInitials("")).toBe("?");
  });

  it("o selo diz arquivado, pausado ou se o portal está ligado", () => {
    const ativo = { archived: false, paused: false, profile: { portalStatus: "active" } } as const;
    expect(customerSituation(ativo)).toEqual({ tone: "ok", label: "Portal ativo" });
    expect(customerSituation({ ...ativo, profile: { portalStatus: "inactive" } })).toEqual({ tone: "off", label: "Sem portal" });
    expect(customerSituation({ ...ativo, paused: true })).toEqual({ tone: "warn", label: "Pausado" });
    expect(customerSituation({ ...ativo, archived: true, paused: true })).toEqual({ tone: "off", label: "Arquivado" });
  });
});

describe("a galeria: cor, filtros e busca", () => {
  const rows = buildCustomerRows(
    [
      { ...btg, sku_prefix: "BTG", portal_status: "active", legal_name: "Banco BTG Pactual S.A.", document: "30.306.294/0001-45" },
      { id: "ITAU", code: "ITAU", name: "Itaú Unibanco", sku_prefix: "", status: "paused", portal_status: "inactive" },
      { id: "SAFRA", code: "SAFRA", name: "Banco Safra", sku_prefix: "SAFRA", status: "archived", archived: true },
    ],
    [],
    [],
  );

  it("a cor do cliente sai do código: a mesma sempre, entre as quatro do quadro", () => {
    expect(customerTone("BTG Pactual")).toBe(customerTone("BTG Pactual"));
    const cores = new Set(["BTG Pactual", "ITAU", "SAFRA", "DUTELOG", "Banco Inter", "XP"].map(customerTone));
    expect([...cores].every((cor) => ["info", "teal", "violet", "amber"].includes(cor))).toBe(true);
    expect(cores.size).toBeGreaterThan(1);
  });

  it("Todos são os não arquivados; o portal conta só entre eles; o arquivado só em Arquivados", () => {
    expect(countCustomerFilters(rows)).toEqual({ todos: 2, com_portal: 1, sem_portal: 1, arquivados: 1 });
    expect(rows.filter((row) => customerInFilter(row, "todos")).map((row) => row.code)).toEqual(["BTG Pactual", "ITAU"]);
    expect(rows.filter((row) => customerInFilter(row, "arquivados")).map((row) => row.code)).toEqual(["SAFRA"]);
  });

  it("busca por nome, código e razão social sem acento, e pelo CNPJ com ou sem pontuação", () => {
    const codigos = (term: string) => searchCustomerRows(rows, term).map((row) => row.code);
    expect(codigos("itau")).toEqual(["ITAU"]);
    expect(codigos("pactual s.a")).toEqual(["BTG Pactual"]);
    expect(codigos("30306294")).toEqual(["BTG Pactual"]);
    expect(codigos("30.306.294/0001")).toEqual(["BTG Pactual"]);
    expect(codigos("12")).toEqual([]);
    expect(codigos("  ")).toEqual(["BTG Pactual", "ITAU", "SAFRA"]);
  });

  it("a página do cliente é a galeria com ?cliente=<código>, ida e volta", () => {
    expect(customerHref("BTG Pactual")).toBe("/configuracoes/clientes?cliente=BTG%20Pactual");
    expect(customerCodeFromSearch("?cliente=BTG%20Pactual")).toBe("BTG Pactual");
    expect(customerCodeFromSearch("cliente=ITAU&x=1")).toBe("ITAU");
    expect(customerCodeFromSearch("")).toBeNull();
    expect(customerCodeFromSearch("?cliente=%20")).toBeNull();
  });
});

describe("a página: dados que vêm de outras telas", () => {
  it("cliente desde: a data de criação em pt-BR, no fuso de São Paulo; sem ela, nada", () => {
    expect(customerSince({ created_at: "2026-07-30T13:00:00.000Z" })).toBe("30/07/2026");
    expect(customerSince({ created_at: "2026-07-31T01:00:00.000Z" })).toBe("30/07/2026");
    expect(customerSince({})).toBeNull();
    expect(customerSince({ created_at: "ontem" })).toBeNull();
  });

  it("as pessoas do portal: só o perfil cliente com acesso, por cliente, em ordem; sem código é da BTG", () => {
    const nomes = peopleNamesByCustomer([
      { role: "cliente", customer_code: "ITAU", nome: "Rita" },
      { role: "cliente", customer_code: "ITAU", nome: "", email: "ana@itau.example" },
      { role: "cliente", customer_code: "ITAU", nome: "Zeca", access_disabled: true },
      { role: "admin", customer_code: "ITAU", nome: "Leo" },
      { role: "cliente", nome: "Bia" },
    ]);
    expect(Object.fromEntries(nomes)).toEqual({ ITAU: ["ana@itau.example", "Rita"], "BTG Pactual": ["Bia"] });
  });

  it("as telas do portal: o modelo dentro do contrato, na ordem do menu; sem portal, nenhuma", () => {
    const perfil = resolveOperationProfile({ customer_code: "X", operation_template: "uniformes", modules: ["wms", "financeiro"] });
    expect(portalScreens(perfil)).toEqual(["Agent Dute", "Início", "Estoque", "Eventos", "Envios para a Dutelog", "Pedidos", "Faturas", "Documentos"]);
    expect(portalScreens({ ...perfil, portalStatus: "inactive" })).toEqual([]);
    expect(portalScreens(resolveOperationProfile({ customer_code: "X", operation_template: "insumos" }))).toEqual([]);
  });

  it("a conferência da chegada: por caixa só com a liberação e o modelo que pede", () => {
    const uniformes = resolveOperationProfile({ customer_code: "X", operation_template: "uniformes" });
    expect(inboundConferenceLabel(uniformes, true)).toBe("Por caixa");
    expect(inboundConferenceLabel(uniformes, false)).toBe("Por linha");
    expect(inboundConferenceLabel(resolveOperationProfile({ customer_code: "X", operation_template: "mobiliario" }), true)).toBe("Por linha");
  });

  it("a ocupação da zona, como no Mapa: por rua, prateleiras com caixa sobre as da zona, e as caixas guardadas", () => {
    const posicao = (code: string, aisle: string, customer_code: string | null): WarehousePosition => ({
      id: code, code, aisle, shelf: 1, length_m: 1.2, depth_m: 0.6, height_m: 0.5, customer_code,
    });
    const caixa = (code: string, location_id: string, status = "stored") =>
      ({ code, location_id, status, length_m: 0.5, width_m: 0.5, height_m: 0.35, sku_codes: [], lines: [], taken_lines: [] }) as unknown as WarehouseBox;
    const shelves = buildShelves(
      [posicao("A-01", "A", "BTG"), posicao("A-02", "A", "BTG"), posicao("B-01", "B", "BTG"), posicao("C-01", "C", "ITAU")],
      [caixa("CX-1", "A-01"), caixa("CX-2", "A-01"), caixa("CX-3", "B-01"), caixa("CX-4", "C-01"), caixa("CX-5", "A-02", "emptied")],
    );
    expect(zoneOccupancy(shelves, "BTG")).toEqual({
      aisles: [
        { aisle: "A", occupied: 1, total: 2 },
        { aisle: "B", occupied: 1, total: 1 },
      ],
      boxes: 3,
    });
    expect(zoneOccupancy(shelves, "NINGUEM")).toEqual({ aisles: [], boxes: 0 });
  });

  it("o formulário de uma seção é o cadastro de agora com só o que ela mudou", () => {
    const cadastro = { ...btg, sku_prefix: "BTG", legal_name: "Banco BTG", primary_contact_email: "ana@btg.example" };
    const form = customerFormWith(cadastro, { name: "BTG Pactual Asset" });
    expect(form).toEqual({ ...customerFormFrom(cadastro), name: "BTG Pactual Asset" });
    expect(form.legal_name).toBe("Banco BTG");
  });
});

