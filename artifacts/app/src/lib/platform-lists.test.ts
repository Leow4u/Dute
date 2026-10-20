import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MODULOS_CONTRATAVEIS,
  MODULOS_PADRAO_CLIENTE,
  MODULOS_POR_PAPEL,
  PAPEIS,
  PAPEIS_DO_WMS,
} from "@workspace/dominio";

import { INTERNAL_ROLES } from "./modules";

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

  it("todo papel da equipe tem a sua linha na tabela papel × módulo", () => {
    expect(Object.keys(MODULOS_POR_PAPEL).sort()).toEqual(PAPEIS.filter((role) => role !== "cliente").sort());
  });
});
