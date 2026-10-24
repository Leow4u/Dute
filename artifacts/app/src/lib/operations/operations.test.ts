import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPERATION_TEMPLATE,
  MODULO_DA_TELA_DO_PORTAL,
  OPERATION_PACKS,
  OPERATION_TEMPLATES,
  OPERATION_TEMPLATE_KEYS,
  SKU_PREFIX_PATTERN,
  canonicalSkuPrefix,
  isOperationTemplateKey,
  leiturasDoPortal,
  operationTemplate,
  packForCustomer,
  portalModulesFor,
  resolveOperationProfile,
  skuExample,
  skuPrefixProblem,
  suggestSkuPrefix,
  telaNoContrato,
  templateStatusLabel,
} from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const functionsDomain = resolve(here, "../../../../../functions/wms/src/domain/customer-profile.ts");

function listFrom(source: string, name: string): string[] {
  const match = source.match(new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`));
  if (!match) throw new Error(`${name} não encontrado nas Functions`);
  return match[1]
    .split(",")
    .map((item) => item.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

describe("registro de modelos", () => {
  it("tem chaves únicas e todos os arquivos que anuncia", () => {
    const keys = OPERATION_TEMPLATES.map((template) => template.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const template of [...OPERATION_TEMPLATES]) {
      expect(existsSync(resolve(here, "..", template.file.replace(/^lib\//, "")))).toBe(true);
      expect(template.defines.length).toBeGreaterThan(0);
    }
    for (const pack of OPERATION_PACKS) {
      expect(existsSync(resolve(here, "..", pack.file.replace(/^lib\//, "")))).toBe(true);
      expect(operationTemplate(pack.template)).not.toBeNull();
      expect(pack.customers.length).toBeGreaterThan(0);
    }
  });

  it("bate com as chaves que as Functions validam", () => {
    const source = readFileSync(functionsDomain, "utf8");
    expect(listFrom(source, "OPERATION_TEMPLATE_KEYS").sort()).toEqual([...OPERATION_TEMPLATE_KEYS].sort());
    expect(listFrom(source, "TEMPLATES_WITHOUT_PORTAL")).toEqual(
      OPERATION_TEMPLATES.filter((template) => template.portal === null).map((template) => template.key),
    );
    expect(source).toContain(`DEFAULT_OPERATION_TEMPLATE: OperationTemplateKey = "${DEFAULT_OPERATION_TEMPLATE}"`);
    expect(source).toContain(`SKU_PREFIX_PATTERN = ${SKU_PREFIX_PATTERN.toString()}`);
  });

  it("o modelo da BTG está pronto; os outros, em construção", () => {
    expect(operationTemplate("uniformes")?.status).toBe("ready");
    expect(templateStatusLabel(operationTemplate("uniformes")!)).toBe("Pronto");
    expect(templateStatusLabel(operationTemplate("mobiliario")!)).toBe("Em construção");
    expect(isOperationTemplateKey("insumos")).toBe(true);
    expect(isOperationTemplateKey("varejo")).toBe(false);
    expect(operationTemplate("varejo")).toBeNull();
  });

  it("o pacote é encontrado pelo código operacional", () => {
    expect(packForCustomer("BTG Pactual")?.key).toBe("btg");
    expect(packForCustomer("Itaú")).toBeNull();
    expect(packForCustomer("")).toBeNull();
  });
});

describe("perfil de operação", () => {
  it("sem registro publicado, a BTG continua como hoje: uniformes com o pacote btg", () => {
    const profile = resolveOperationProfile(null);
    expect(profile.customerCode).toBe("BTG Pactual");
    expect(profile.template.key).toBe("uniformes");
    expect(profile.pack?.key).toBe("btg");
    expect(profile.portalStatus).toBe("active");
    expect(profile.source).toBe("fallback");
    expect(portalModulesFor(profile)).toEqual([
      "assistant",
      "home",
      "inventory",
      "events",
      "requests",
      "orders",
      "invoices",
      "documents",
    ]);
  });

  it("registro publicado define modelo, sigla e portal", () => {
    const profile = resolveOperationProfile({
      customer_code: "Itaú",
      name: "Itaú Unibanco",
      operation_template: "mobiliario",
      sku_prefix: "ITAU",
      portal_status: "active",
    });
    expect(profile.customerName).toBe("Itaú Unibanco");
    expect(profile.template.key).toBe("mobiliario");
    expect(profile.pack).toBeNull();
    expect(profile.skuPrefix).toBe("ITAU");
    expect(profile.source).toBe("published");
    expect(portalModulesFor(profile)).not.toContain("events");
  });

  it("pacote só se aplica sobre o próprio modelo", () => {
    const profile = resolveOperationProfile({ customer_code: "BTG Pactual", operation_template: "mobiliario" });
    expect(profile.pack).toBeNull();
  });

  it("modelo desconhecido ou sem portal cai no comportamento seguro", () => {
    expect(resolveOperationProfile({ customer_code: "X", operation_template: "varejo" }).template.key).toBe("uniformes");
    const internal = resolveOperationProfile({ customer_code: "Dutelog", operation_template: "insumos", portal_status: "active" });
    expect(internal.portalStatus).toBe("inactive");
    expect(portalModulesFor(internal)).toEqual(["home"]);
    expect(resolveOperationProfile({ customer_code: "X", archived: true }).portalStatus).toBe("inactive");
    expect(portalModulesFor(null)).toBeNull();
  });
});

describe("telas do portal pelos módulos contratados (parte 2.7)", () => {
  const comModulos = (modules: string[]) => resolveOperationProfile({ customer_code: "ACME", operation_template: "uniformes", modules });

  it("só com a Operação: o portal fica com as OS (parte 4.3b), sem o Início do armazém, nada do armazém nem faturas", () => {
    expect(portalModulesFor(comModulos(["operacao"]))).toEqual(["services"]);
    expect(portalModulesFor(comModulos(["operacao", "financeiro"]))).toEqual(["services", "invoices"]);
  });

  it("o Início é o do armazém: sem a armazenagem, só fica quando o contrato não abre outra tela", () => {
    expect(portalModulesFor(comModulos(["wms"]))).toContain("home");
    // Modelo sem portal: uma conta de cliente por engano continua com o Início, e não com uma tela em branco.
    const semPortal = resolveOperationProfile({ customer_code: "ACME", operation_template: "insumos", modules: ["operacao"] });
    expect(portalModulesFor(semPortal)).toEqual(["home"]);
  });

  it("sem o financeiro, sem Faturas; sem a armazenagem, sem estoque, pedidos, documentos e Agent Dute", () => {
    expect(portalModulesFor(comModulos(["wms", "operacao"]))).toEqual([
      "assistant",
      "home",
      "inventory",
      "events",
      "requests",
      "orders",
      "services",
      "documents",
    ]);
    expect(portalModulesFor(comModulos(["financeiro"]))).toEqual(["invoices"]);
    // Sem a Operação, sem as OS.
    expect(portalModulesFor(comModulos(["wms", "financeiro"]))).not.toContain("services");
  });

  it("cada tela do portal depende de um módulo, o Início de nenhum: a mesma régua das regras", () => {
    expect(MODULO_DA_TELA_DO_PORTAL).toEqual({
      home: null,
      assistant: "wms",
      inventory: "wms",
      events: "wms",
      requests: "wms",
      orders: "wms",
      documents: "wms",
      services: "operacao",
      invoices: "financeiro",
    });
    for (const tela of Object.keys(MODULO_DA_TELA_DO_PORTAL) as Array<keyof typeof MODULO_DA_TELA_DO_PORTAL>) {
      expect(telaNoContrato(tela, ["wms", "operacao", "financeiro"]), tela).toBe(true);
    }
    expect(telaNoContrato("home", [])).toBe(true);
  });

  it("as leituras do portal seguem as regras do Firestore (isOwnProjectionWith)", () => {
    const regras = readFileSync(new URL("../../../../../firestore.rules", import.meta.url), "utf8");
    const exige = (colecao: string) =>
      // O bloco do match até a primeira chave que fecha: a leitura do cliente exige o módulo.
      new RegExp(`match /${colecao}/\\{[^}]+\\} \\{[^}]*?allow read:[^;]*isOwnProjectionWith\\('(\\w+)'\\)`).exec(regras)?.[1];
    expect({
      estoque: exige("client_inventory"),
      pedidos: exige("client_order_tracking"),
      solicitacoes: exige("client_request_status"),
      documentos: exige("client_documents"),
      servicos: exige("service_orders"),
      faturas: exige("client_invoices"),
      nfs: exige("client_faturas"),
    }).toEqual({ estoque: "wms", pedidos: "wms", solicitacoes: "wms", documentos: "wms", servicos: "operacao", faturas: "financeiro", nfs: "financeiro" });
    expect(leiturasDoPortal(["wms"])).toEqual({ estoque: true, pedidos: true, solicitacoes: true, documentos: true, servicos: false, faturas: false });
    expect(leiturasDoPortal(["financeiro"])).toEqual({ estoque: false, pedidos: false, solicitacoes: false, documentos: false, servicos: false, faturas: true });
    expect(leiturasDoPortal(["operacao"])).toEqual({ estoque: false, pedidos: false, solicitacoes: false, documentos: false, servicos: true, faturas: false });
  });
});

describe("sigla do SKU", () => {
  it("normaliza e valida como as Functions", () => {
    expect(canonicalSkuPrefix(" itaú ")).toBe("ITAU");
    expect(skuPrefixProblem("btg")).toBeNull();
    expect(skuPrefixProblem("")).toMatch(/Informe a sigla/);
    expect(skuPrefixProblem("B")).toMatch(/2 a 6/);
    expect(skuPrefixProblem("1AB")).toMatch(/começando por letra/);
    expect(skuPrefixProblem("DUTELOG")).toMatch(/2 a 6/);
  });

  it("sugere a sigla pelo nome e mostra o exemplo de SKU", () => {
    expect(suggestSkuPrefix("Itaú Unibanco")).toBe("ITAU");
    expect(suggestSkuPrefix("BTG Pactual")).toBe("BTG");
    expect(suggestSkuPrefix("Dutelog")).toBe("DUTELO");
    expect(suggestSkuPrefix("3M do Brasil")).toBe("DO");
    expect(suggestSkuPrefix("")).toBe("");
    expect(skuExample("itau")).toBe("ITAU-000001");
    expect(skuExample("")).toBe("SIGLA-000001");
  });
});

describe("módulos contratados no perfil (Fase 2)", () => {
  it("perfil sem o campo, ou sem registro, vale armazenagem e faturas", () => {
    expect(resolveOperationProfile(null).modules).toEqual(["wms", "financeiro"]);
    expect(resolveOperationProfile({ customer_code: "BTG Pactual" }).modules).toEqual(["wms", "financeiro"]);
  });

  it("perfil publicado traz os módulos do cadastro", () => {
    expect(resolveOperationProfile({ customer_code: "Itaú", modules: ["operacao"] }).modules).toEqual(["operacao"]);
    expect(resolveOperationProfile({ customer_code: "Itaú", modules: ["financeiro", "wms"] }).modules).toEqual([
      "wms",
      "financeiro",
    ]);
  });
});
