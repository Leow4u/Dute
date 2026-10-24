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
  OMIE_AMBIENTES_LIBERADOS,
  OPERACAO_AMBIENTES_LIBERADOS,
  RH_AMBIENTES_LIBERADOS,
  RH_PUBLICADO,
  agenteLiberado,
  memoriaLiberada,
  rhLiberado,
} from "./liberacao";
import { MODULOS_DO_AGENTE } from "./agente/cliente";
import { AGENTE_ROLES } from "./agente/navegacao";
import { OPERACAO_CADASTRO_ROLES } from "./operacao/navegacao";
import { FINANCE_ROLES, INTERNAL_ROLES } from "./modules";
import { PLATFORM_MODULES } from "./platform-modules";
import { ROTA_MINHAS_OS } from "./portal/navegacao";
import { CALLABLES_DO_FINANCEIRO } from "./financeiro/api";
import { ETAPAS_DA_EMISSAO, MOTIVOS_DA_PARADA } from "./financeiro/emissoes";
import { ETAPAS_DA_BAIXA, MOTIVOS_DA_PARADA_DA_BAIXA } from "./financeiro/baixas";
import { CALLABLES_DO_RH } from "./rh/api";
import * as FICHA_DO_RH from "./rh/ficha";
import { PRIMEIRO_DIA, TAMANHO_MAXIMO_DO_ARQUIVO as TAMANHO_DO_ARQUIVO_NO_APP, TIPOS_DE_ARQUIVO as TIPOS_DE_ARQUIVO_NO_APP, ULTIMO_DIA } from "./rh/formulario";
import { RH_ROLES as RH_ROLES_DO_APP, RH_WRITE_ROLES as RH_WRITE_ROLES_DO_APP } from "./rh/navegacao";
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
    // O campo entra no app dele (parte 3.8b); o painel, na TV (parte 3.12b); a coordenação, no Início da
    // Operação; o cliente, nas OS dele no portal (parte 4.3b), nunca no cadastro.
    expect(Object.keys(card.home).sort()).toEqual(["admin", "campo", "cliente", "interno", "owner", "painel"]);
    expect(card.home.campo).toBe("/campo");
    expect(card.home.painel).toBe("/tv");
    expect(card.home.cliente).toBe(ROTA_MINHAS_OS);
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

describe("listas do RH iguais em todo lugar (Fase 8)", () => {
  const roles = read("functions/rh/src/domain/platform-roles.ts");
  const liberacao = read("functions/rh/src/domain/liberacao.ts");
  const ficha = read("functions/rh/src/domain/ficha.ts");

  it("papéis: lib/dominio, functions/rh e o app; abrem o RH os papéis que têm o módulo, e só o rh grava (pergunta 23)", () => {
    expect(tsList(roles, "PLATFORM_ROLES")).toEqual([...PAPEIS]);
    const comRh = PAPEIS.filter((papel) => papel !== "cliente" && MODULOS_POR_PAPEL[papel].includes("rh"));
    expect(tsList(roles, "RH_ROLES")).toEqual(comRh);
    expect(tsList(roles, "RH_WRITE_ROLES")).toEqual(["rh"]);
    expect([...RH_ROLES_DO_APP]).toEqual(comRh);
    expect([...RH_WRITE_ROLES_DO_APP]).toEqual(["rh"]);
  });

  it("liberação por ambiente: a lista das callables é a do app, só a homologação até o lançamento da fase", () => {
    expect(tsList(liberacao, "RH_AMBIENTES_LIBERADOS")).toEqual([...RH_AMBIENTES_LIBERADOS]);
    expect([...RH_AMBIENTES_LIBERADOS]).toEqual(["dute-homolog"]);
  });

  it("as telas do RH só ligam quando a codebase rh está na publicação (parte 8.1b)", () => {
    const firebase = JSON.parse(read("firebase.json")) as { functions?: Array<{ codebase?: string }> };
    const publicado = (firebase.functions ?? []).some((codebase) => codebase.codebase === "rh");
    expect(RH_PUBLICADO).toBe(publicado);
    expect(rhLiberado("dute-homolog")).toBe(publicado);
    expect(rhLiberado("dute-homolog", true)).toBe(true);
    expect(rhLiberado("dute-prod", true)).toBe(false);
  });

  it("o catálogo da ficha é cópia literal do de functions/rh", () => {
    const bloco = (source: string) => {
      const match = source.match(/export const TIPOS_POR_CATEGORIA = (\{[\s\S]*?\}) as const/);
      if (!match) throw new Error("TIPOS_POR_CATEGORIA não encontrado");
      return JSON.parse(match[1].replace(/(\w+):/g, '"$1":').replace(/,(\s*[}\]])/g, "$1"));
    };
    expect(bloco(ficha)).toEqual(FICHA_DO_RH.TIPOS_POR_CATEGORIA);
    expect(tsList(ficha, "CATEGORIAS")).toEqual([...FICHA_DO_RH.CATEGORIAS]);
    expect(tsList(ficha, "RESULTADOS_DO_EXAME")).toEqual([...FICHA_DO_RH.RESULTADOS_DO_EXAME]);
    expect(tsList(ficha, "SITUACOES")).toEqual([...FICHA_DO_RH.SITUACOES]);
    expect(ficha).toContain(`export const DIAS_PARA_O_VENCIMENTO = ${FICHA_DO_RH.DIAS_PARA_O_VENCIMENTO};`);
    expect(ficha).toContain(`export const PRIMEIRO_DIA = "${PRIMEIRO_DIA}";`);
    expect(ficha).toContain(`export const ULTIMO_DIA = "${ULTIMO_DIA}";`);
    for (const tipos of Object.values(FICHA_DO_RH.TIPOS_POR_CATEGORIA)) {
      for (const tipo of tipos) expect(FICHA_DO_RH.ROTULO_DO_TIPO[tipo], tipo).toBeTruthy();
    }
  });

  it("o arquivo da ficha: os tipos e o tamanho são os de functions/rh", () => {
    const arquivos = read("functions/rh/src/domain/arquivos.ts");
    const bloco = arquivos.match(/export const TIPOS_DE_ARQUIVO = \{([\s\S]*?)\} as const/);
    if (!bloco) throw new Error("TIPOS_DE_ARQUIVO não encontrado");
    expect([...bloco[1].matchAll(/"([^"]+)":/g)].map((match) => match[1])).toEqual([...TIPOS_DE_ARQUIVO_NO_APP]);
    expect(arquivos).toContain("export const TAMANHO_MAXIMO_DO_ARQUIVO = 10 * 1024 * 1024;");
    expect(TAMANHO_DO_ARQUIVO_NO_APP).toBe(10 * 1024 * 1024);
  });

  it("o app chama as callables que functions/rh declara", () => {
    const declaradas = [...read("functions/rh/src/index.ts").matchAll(/^export const (\w+) = onCall\(/gm)].map((match) => match[1]);
    expect(declaradas).toEqual([...CALLABLES_DO_RH]);
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

  it("onde o Financeiro está ligado, o WMS não marca o pagamento da armazenagem (parte 7.2c)", () => {
    expect(tsList(read("functions/wms/src/domain/billing-scope.ts"), "FINANCEIRO_PROJECTS")).toEqual([...FINANCEIRO_AMBIENTES_LIBERADOS]);
  });

  it("a NFS-e pela Omie: a liberação do app é a da emissão, dentro da do Financeiro, e as callables são as do index (parte 7.4e)", () => {
    expect(tsList(read("functions/financeiro/src/domain/emissao-omie.ts"), "OMIE_AMBIENTES_LIBERADOS")).toEqual([...OMIE_AMBIENTES_LIBERADOS]);
    for (const projeto of OMIE_AMBIENTES_LIBERADOS) expect(FINANCEIRO_AMBIENTES_LIBERADOS).toContain(projeto);
    const declaradas = [...read("functions/financeiro/src/index.ts").matchAll(/^export const (\w+) = onCall\(/gm)].map((match) => match[1]);
    expect(declaradas).toEqual([...CALLABLES_DO_FINANCEIRO]);
  });

  it("as etapas e os motivos da baixa na tela Emissões são os do servidor (parte 7.4h)", () => {
    const baixa = read("functions/financeiro/src/domain/baixa-omie.ts");
    expect(tsList(baixa, "ETAPAS_DA_BAIXA")).toEqual([...ETAPAS_DA_BAIXA]);
    expect(tsList(baixa, "MOTIVOS_DA_PARADA_DA_BAIXA")).toEqual([...MOTIVOS_DA_PARADA_DA_BAIXA]);
    const eventos = read("functions/financeiro/src/domain/events.ts");
    const parada = eventos.match(/const baixaParada = z[\s\S]*?motivo: z\.enum\(\[([^\]]*)\]\)/);
    expect(parada && [...parada[1].matchAll(/"([^"]+)"/g)].map((item) => item[1])).toEqual([...MOTIVOS_DA_PARADA_DA_BAIXA]);
  });

  it("as etapas e os motivos da emissão na tela Emissões são os do servidor (parte 7.4f)", () => {
    const emissao = read("functions/financeiro/src/domain/emissao-omie.ts");
    expect(tsList(emissao, "ETAPAS_DA_EMISSAO")).toEqual([...ETAPAS_DA_EMISSAO]);
    expect(tsList(emissao, "MOTIVOS_DA_PARADA")).toEqual([...MOTIVOS_DA_PARADA]);
    // O evento da parada aceita os mesmos motivos.
    const eventos = read("functions/financeiro/src/domain/events.ts");
    const parada = eventos.match(/const emissaoParada = z[\s\S]*?motivo: z\.enum\(\[([^\]]*)\]\)/);
    expect(parada && [...parada[1].matchAll(/"([^"]+)"/g)].map((item) => item[1])).toEqual([...MOTIVOS_DA_PARADA]);
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
