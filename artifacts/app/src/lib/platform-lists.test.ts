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
import { ALERTA_PARADO_ROLES } from "./memoria/alertas";
import {
  AGENTE_AMBIENTES_LIBERADOS,
  COMERCIAL_AMBIENTES_LIBERADOS,
  FINANCEIRO_AMBIENTES_LIBERADOS,
  MEMORIA_AMBIENTES_LIBERADOS,
  OPERACAO_AMBIENTES_LIBERADOS,
  agenteLiberado,
  memoriaLiberada,
} from "./liberacao";
import { MODULOS_DO_AGENTE } from "./agente/cliente";
import { AGENTE_ROLES } from "./agente/navegacao";
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

describe("a liberação da memória igual em todo lugar (Fase 5)", () => {
  const liberacao = read("functions/core/src/domain/liberacao.ts");
  const papeis = read("functions/core/src/domain/platform-roles.ts");
  const operacao = read("functions/operacao/src/domain/platform-roles.ts");
  const comercial = read("functions/comercial/src/domain/platform-roles.ts");

  it("papéis: lib/dominio e functions/core; quem recebe a sugestão é quem planeja a OS na Operação; quem vê os parecidos é quem orça", () => {
    expect(tsList(papeis, "PLATFORM_ROLES")).toEqual([...PAPEIS]);
    expect(tsList(papeis, "PLANEJAMENTO_ROLES")).toEqual(tsList(operacao, "OPERACAO_CADASTRO_ROLES"));
    expect(tsList(papeis, "ORCAMENTO_ROLES")).toEqual(tsList(comercial, "COMERCIAL_ROLES"));
    expect(tsList(papeis, "ORCAMENTO_ROLES")).toEqual([...COMERCIAL_ROLES]);
  });

  it("quem decide o alerta do item parado: functions/core e o app (parte 5.4e)", () => {
    expect(tsList(papeis, "ALERTA_ROLES")).toEqual([...ALERTA_PARADO_ROLES]);
  });

  it("a lista da rotina e das callables do núcleo é a do app, só a homologação até o fim da fase", () => {
    expect(tsList(liberacao, "MEMORIA_AMBIENTES_LIBERADOS")).toEqual([...MEMORIA_AMBIENTES_LIBERADOS]);
    expect([...MEMORIA_AMBIENTES_LIBERADOS]).toEqual(["dute-homolog"]);
    expect([memoriaLiberada("dute-homolog"), memoriaLiberada("dute-prod"), memoriaLiberada("dute-btg"), memoriaLiberada(undefined)]).toEqual([true, false, false, false]);
  });
});

describe("o Agent Dute do núcleo igual em todo lugar (parte 5.5)", () => {
  const liberacao = read("functions/core/src/domain/liberacao.ts");
  const papeis = read("functions/core/src/domain/platform-roles.ts");
  const rules = read("firestore.rules");

  it("a liberação própria do agente é a do app, só a homologação até o lançamento da fase", () => {
    expect(tsList(liberacao, "AGENTE_AMBIENTES_LIBERADOS")).toEqual([...AGENTE_AMBIENTES_LIBERADOS]);
    expect([...AGENTE_AMBIENTES_LIBERADOS]).toEqual(["dute-homolog"]);
    expect([agenteLiberado("dute-homolog"), agenteLiberado("dute-prod"), agenteLiberado("dute-btg"), agenteLiberado(undefined)]).toEqual([true, false, false, false]);
  });

  it("onde o núcleo roda as rotinas, a rotina agendada do WMS não roda (parte 5.5g)", () => {
    expect(tsList(read("functions/wms/src/domain/agent-routines.ts"), "CORE_AGENT_PROJECTS")).toEqual([...AGENTE_AMBIENTES_LIBERADOS]);
  });

  it("quem lê valor no agente é quem lê preço nas regras", () => {
    expect(tsList(papeis, "VALOR_ROLES")).toEqual(rulesList(rules, /function canReadPrices\(\) \{\s*return hasAnyRole\(\[([^\]]*)\]\)/));
  });

  it("os módulos de cada papel e os que o cliente contrata são os de lib/dominio", () => {
    const bloco = papeis.match(/MODULOS_POR_PAPEL = \{([\s\S]*?)\n\}/);
    expect(bloco).not.toBeNull();
    const copia = Object.fromEntries([...bloco![1].matchAll(/(\w+): \[([^\]]*)\]/g)].map((linha) => [linha[1], [...linha[2].matchAll(/"([^"]+)"/g)].map((item) => item[1])]));
    expect(copia).toEqual(Object.fromEntries(Object.entries(MODULOS_POR_PAPEL).map(([papel, modulos]) => [papel, [...modulos]])));
    expect(tsList(papeis, "CONTRACTED_MODULE_KEYS")).toEqual([...MODULOS_CONTRATAVEIS]);
    expect(tsList(papeis, "DEFAULT_CONTRACTED_MODULES")).toEqual([...MODULOS_PADRAO_CLIENTE]);
  });

  it("quem tem o agente: papéis da plataforma, sem o campo, o painel e o RH", () => {
    const agente = tsList(papeis, "AGENTE_ROLES");
    expect(agente.every((papel) => (PAPEIS as readonly string[]).includes(papel))).toBe(true);
    expect(PAPEIS.filter((papel) => !agente.includes(papel))).toEqual(["campo", "rh", "painel"]);
  });

  it("quem tem o agente lê a própria conversa nas regras, e os módulos do app são os do núcleo (parte 5.5i)", () => {
    expect(rulesList(rules, /function canReadAgentChat\(\) \{\s*return hasAnyRole\(\[([^\]]*)\]\)/)).toEqual(tsList(papeis, "AGENTE_ROLES"));
    expect([...MODULOS_DO_AGENTE]).toEqual(tsList(read("functions/core/src/domain/agente-escopo.ts"), "MODULOS_DO_AGENTE"));
    // O app abre a tela do agente do núcleo para os mesmos papéis (parte 5.5j).
    expect([...AGENTE_ROLES]).toEqual(tsList(papeis, "AGENTE_ROLES"));
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
