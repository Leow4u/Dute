import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ESTAGIOS_CADASTRO,
  MODELOS_DE_AVISO,
  MODELOS_DE_AVISO_COM_VALOR,
  PAPEIS_DE_CONTATO,
  PAPEIS_DE_CONTATO_QUE_LEEM_VALOR,
  MODULOS_CONTRATAVEIS,
  MODULOS_PADRAO_CLIENTE,
  MODULOS_POR_PAPEL,
  PAPEIS,
  PAPEIS_DO_WMS,
  estagioDoCadastro,
} from "@workspace/dominio";

import { COMERCIAL_ROLES } from "./comercial/navegacao";
import { COMERCIAL_AMBIENTES_LIBERADOS, FINANCEIRO_AMBIENTES_LIBERADOS, OPERACAO_AMBIENTES_LIBERADOS } from "./liberacao";
import { OPERACAO_CADASTRO_ROLES } from "./operacao/navegacao";
import { FINANCE_ROLES, INTERNAL_ROLES } from "./modules";
import { PLATFORM_MODULES } from "./platform-modules";
import { TV_ROLES } from "./tv/navegacao";

/**
 * As Functions e as regras do Firestore não importam lib/dominio: guardam
 * cópias literais. Esta trava lê os arquivos e exige as mesmas listas
 * (docs/plataforma/fase-2-nucleo.md).
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

function tsList(source: string, name: string): string[] {
  const match = source.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!match) throw new Error(`${name} não encontrado`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function rulesList(source: string, pattern: RegExp): string[] {
  const match = source.match(pattern);
  if (!match) throw new Error(`${pattern} não encontrado no firestore.rules`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

describe("listas da plataforma iguais em todo lugar", () => {
  const roles = read("functions/wms/src/domain/platform-roles.ts");
  const customerProfile = read("functions/wms/src/domain/customer-profile.ts");
  const rules = read("firestore.rules");

  it("papéis: lib/dominio, Functions e regras", () => {
    expect(PAPEIS).toHaveLength(11);
    expect(tsList(roles, "PLATFORM_ROLES")).toEqual([...PAPEIS]);
    expect(rulesList(rules, /function validProfileRole\(role\) \{\s*return role in \[([^\]]*)\]/)).toEqual([...PAPEIS]);
  });

  it("papéis que o WMS atende: lib/dominio, Functions e o app", () => {
    expect(tsList(roles, "WMS_ROLES")).toEqual([...PAPEIS_DO_WMS]);
    expect([...INTERNAL_ROLES, "cliente"].sort()).toEqual([...PAPEIS_DO_WMS].sort());
  });

  it("módulos contratados e o padrão sem o campo", () => {
    expect(tsList(customerProfile, "CONTRACTED_MODULE_KEYS")).toEqual([...MODULOS_CONTRATAVEIS]);
    expect(tsList(customerProfile, "DEFAULT_CONTRACTED_MODULES")).toEqual([...MODULOS_PADRAO_CLIENTE]);
    const contracted = rules.match(/function contractedModules\(\) \{([\s\S]*?)\n    \}/);
    expect(contracted).not.toBeNull();
    const defaults = [...contracted![1].matchAll(/\[([^\]]*)\]/g)].map((match) =>
      [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]),
    );
    expect(defaults).toHaveLength(2);
    for (const list of defaults) expect(list).toEqual([...MODULOS_PADRAO_CLIENTE]);
  });

  it("estágios do cadastro: lib/dominio e Functions", () => {
    expect(tsList(customerProfile, "CUSTOMER_STAGES")).toEqual([...ESTAGIOS_CADASTRO]);
    expect(estagioDoCadastro(undefined)).toBe("cliente");
    expect(estagioDoCadastro(" Prospect ")).toBe("prospect");
    expect(estagioDoCadastro("lead")).toBe("cliente");
  });

  it("todo papel da equipe tem a sua linha na tabela papel × módulo", () => {
    expect(Object.keys(MODULOS_POR_PAPEL).sort()).toEqual(PAPEIS.filter((role) => role !== "cliente").sort());
  });
});

describe("listas do Comercial iguais em todo lugar", () => {
  const roles = read("functions/comercial/src/domain/platform-roles.ts");
  const liberacao = read("functions/comercial/src/domain/liberacao.ts");

  it("papéis: lib/dominio e functions/comercial", () => {
    expect(tsList(roles, "PLATFORM_ROLES")).toEqual([...PAPEIS]);
  });

  it("papéis que o Comercial atende: os que têm o módulo comercial em MODULOS_POR_PAPEL", () => {
    const comercial = PAPEIS.filter(
      (role) => role !== "cliente" && MODULOS_POR_PAPEL[role].includes("comercial"),
    );
    expect(comercial).toEqual(["owner", "admin", "comercial"]);
    expect(tsList(roles, "COMERCIAL_ROLES")).toEqual(comercial);
  });

  it("o app abre o Comercial (menu, rotas e card) para os mesmos papéis", () => {
    const comercial = PAPEIS.filter(
      (role) => role !== "cliente" && MODULOS_POR_PAPEL[role].includes("comercial"),
    );
    expect([...COMERCIAL_ROLES]).toEqual(comercial);
    const card = PLATFORM_MODULES.find((module) => module.key === "comercial")!;
    expect(Object.keys(card.home)).toEqual(comercial);
  });

  it("liberação por ambiente: a lista das callables é a do app", () => {
    expect(tsList(liberacao, "COMERCIAL_AMBIENTES_LIBERADOS")).toEqual([...COMERCIAL_AMBIENTES_LIBERADOS]);
  });
});

describe("listas da Operação iguais em todo lugar", () => {
  const roles = read("functions/operacao/src/domain/platform-roles.ts");
  const liberacao = read("functions/operacao/src/domain/liberacao.ts");

  it("papéis: lib/dominio e functions/operacao", () => {
    expect(tsList(roles, "PLATFORM_ROLES")).toEqual([...PAPEIS]);
  });

  it("quem grava o cadastro é owner, admin e interno, e o app abre as mesmas telas", () => {
    expect(tsList(roles, "OPERACAO_CADASTRO_ROLES")).toEqual(["owner", "admin", "interno"]);
    expect([...OPERACAO_CADASTRO_ROLES]).toEqual(["owner", "admin", "interno"]);
    const card = PLATFORM_MODULES.find((module) => module.key === "operacao")!;
    // O campo entra no app dele (parte 3.8b); o painel, na TV (parte 3.12b); a coordenação, no Início da Operação.
    expect(Object.keys(card.home).sort()).toEqual(["admin", "campo", "interno", "owner", "painel"]);
    expect(card.home.campo).toBe("/campo");
    expect(card.home.painel).toBe("/tv");
  });

  it("quem abre a TV: o mesmo nas Functions e no app (parte 3.12)", () => {
    expect(tsList(roles, "TV_ROLES")).toEqual([...TV_ROLES]);
    expect([...TV_ROLES]).toEqual(["owner", "admin", "interno", "painel"]);
  });

  it("liberação por ambiente: a lista das callables é a do app", () => {
    expect(tsList(liberacao, "OPERACAO_AMBIENTES_LIBERADOS")).toEqual([...OPERACAO_AMBIENTES_LIBERADOS]);
  });

  it("módulos contratados que o portal confere (parte 4.4a): as Functions e o storage.rules", () => {
    expect(tsList(roles, "CONTRACTED_MODULE_KEYS")).toEqual([...MODULOS_CONTRATAVEIS]);
    expect(tsList(roles, "DEFAULT_CONTRACTED_MODULES")).toEqual([...MODULOS_PADRAO_CLIENTE]);
    const storage = read("storage.rules");
    const modulos = storage.match(/function modulosDoCliente\(code\) \{([\s\S]*?)\n    \}/);
    expect(modulos).not.toBeNull();
    const padroes = [...modulos![1].matchAll(/\[([^\]]*)\]/g)].map((match) => [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]));
    expect(padroes).toHaveLength(2);
    for (const lista of padroes) expect(lista).toEqual([...MODULOS_PADRAO_CLIENTE]);
  });
});

describe("listas do Financeiro iguais em todo lugar (Fase 4)", () => {
  const roles = read("functions/financeiro/src/domain/platform-roles.ts");
  const liberacao = read("functions/financeiro/src/domain/liberacao.ts");

  it("papéis: lib/dominio e functions/financeiro; quem grava é quem abre o Faturamento", () => {
    expect(tsList(roles, "PLATFORM_ROLES")).toEqual([...PAPEIS]);
    expect(tsList(roles, "FINANCEIRO_ROLES")).toEqual([...FINANCE_ROLES]);
  });

  it("liberação por ambiente: a lista das callables é a do app, só a homologação até o lançamento", () => {
    expect(tsList(liberacao, "FINANCEIRO_AMBIENTES_LIBERADOS")).toEqual([...FINANCEIRO_AMBIENTES_LIBERADOS]);
    expect([...FINANCEIRO_AMBIENTES_LIBERADOS]).toEqual(["dute-homolog"]);
  });
});

describe("os avisos por modelo iguais em todo lugar (parte 4.6)", () => {
  const comercial = read("functions/comercial/src/domain/cadastro.ts");
  const operacao = read("functions/operacao/src/domain/avisos.ts");

  it("os modelos: lib/dominio, o cadastro do Comercial e a rotina da Operação", () => {
    expect(tsList(comercial, "MODELOS_DE_AVISO")).toEqual([...MODELOS_DE_AVISO]);
    expect(tsList(operacao, "MODELOS_DE_AVISO")).toEqual([...MODELOS_DE_AVISO]);
  });

  it("o que leva valor e quem lê valor: o mesmo no cadastro e na rotina", () => {
    expect(tsList(comercial, "MODELOS_DE_AVISO_COM_VALOR")).toEqual([...MODELOS_DE_AVISO_COM_VALOR]);
    expect(tsList(operacao, "MODELOS_DE_AVISO_COM_VALOR")).toEqual([...MODELOS_DE_AVISO_COM_VALOR]);
    expect(tsList(comercial, "PAPEIS_QUE_LEEM_VALOR")).toEqual([...PAPEIS_DE_CONTATO_QUE_LEEM_VALOR]);
    expect(tsList(operacao, "PAPEIS_QUE_LEEM_VALOR")).toEqual([...PAPEIS_DE_CONTATO_QUE_LEEM_VALOR]);
  });

  it("os papéis do contato: lib/dominio e o cadastro do Comercial", () => {
    expect(tsList(comercial, "PAPEIS_CONTATO")).toEqual([...PAPEIS_DE_CONTATO]);
  });
});
