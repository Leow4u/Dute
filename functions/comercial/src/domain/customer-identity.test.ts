import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { HttpsError } from "firebase-functions/https";

import {
  CUSTOMER_CODE_PATTERN,
  CUSTOMER_STAGES,
  cadastroDoWms,
  canonicalCustomerCode,
  cnpjDaEntrada,
  cnpjNormalizado,
  cnpjRoot,
  codigoDoNovoCadastro,
  customerIdentityConflict,
  customerStage,
  entityIdDoCadastro,
  isProspect,
  safeDocId,
  sugerirCodigo,
} from "./customer-identity.js";
import { ESTAGIOS_CADASTRO } from "./events.js";

/**
 * O Comercial grava no mesmo `customers` do WMS e precisa decidir igual a ele
 * o que é prospect, o que é o mesmo código, a raiz do CNPJ e o id do
 * documento. As regras são cópias literais (domain/customer-identity.ts); esta
 * trava lê os fontes do WMS e reprova qualquer diferença.
 */

// Compilado em functions/comercial/lib/domain/customer-identity.test.js.
const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

const copia = read("../../src/domain/customer-identity.ts");
const wms = {
  profile: read("../../../wms/src/domain/customer-profile.ts"),
  index: read("../../../wms/src/index.ts"),
  scope: read("../../../wms/src/domain/customer-scope.ts"),
};

/**
 * Texto de uma declaração de primeiro nível (função, const ou type), do
 * começo da linha até a chave que fecha na coluna zero, ou até o fim da linha
 * quando ela termina em ponto e vírgula.
 */
function declaracao(source: string, name: string): string {
  const start = new RegExp(`^(?:export )?(?:async )?(?:function ${name}\\b|const ${name}\\b|type ${name}\\b)`, "m").exec(source);
  assert.ok(start, `${name} não encontrado`);
  const from = start.index;
  const lineEnd = source.indexOf("\n", from);
  if (source.slice(from, lineEnd).trimEnd().endsWith(";")) return source.slice(from, lineEnd);
  const close = source.indexOf("\n}", from);
  assert.ok(close > from, `${name} sem fechamento na coluna zero`);
  return source.slice(from, close + 2);
}

/** Sem comentários, sem `export` e com os espaços juntados: só o código conta. */
function normalizada(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^export /, "");
}

const COPIAS: Array<[string, keyof typeof wms]> = [
  ["text", "profile"],
  ["CUSTOMER_STAGES", "profile"],
  ["CustomerStage", "profile"],
  ["customerStage", "profile"],
  ["isProspect", "profile"],
  ["canonicalSkuPrefix", "profile"],
  ["canonicalCustomerCode", "profile"],
  ["CNPJ_PATTERN", "profile"],
  ["cnpjCheckDigit", "profile"],
  ["isValidCnpj", "profile"],
  ["cnpjRoot", "profile"],
  ["CustomerIdentityCandidate", "profile"],
  ["CustomerIdentityRow", "profile"],
  ["customerIdentityConflict", "profile"],
  ["safeDocId", "index"],
  ["LEGACY_CUSTOMER_CODE", "scope"],
];

async function rejeita(fn: () => unknown, code: string, message?: RegExp): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    assert.equal(error.code, code, error.message);
    if (message) assert.match(error.message, message);
    return;
  }
  assert.fail("deveria recusar");
}

describe("cópias literais do WMS", () => {
  it("cada regra copiada é igual à do WMS, fora comentários e espaços", () => {
    for (const [name, origem] of COPIAS) {
      assert.equal(normalizada(declaracao(copia, name)), normalizada(declaracao(wms[origem], name)), `${name} diverge do WMS (${origem})`);
    }
  });

  it("a trava pega uma mudança no corpo, inclusive de um caractere", () => {
    const original = declaracao(wms.profile, "canonicalCustomerCode");
    assert.notEqual(normalizada(original.replace("A-Z0-9", "A-Z")), normalizada(original));
    assert.equal(normalizada(`/** outro comentário */\n${original}`), normalizada(original));
  });

  it("o estágio do evento é a mesma lista do cadastro", () => {
    assert.deepEqual([...ESTAGIOS_CADASTRO], [...CUSTOMER_STAGES]);
  });

  it("as cópias se comportam como o WMS nos casos de lá", () => {
    assert.equal(customerStage(undefined), "cliente");
    assert.equal(customerStage(" Prospect "), "prospect");
    assert.equal(customerStage("lead"), "cliente");
    assert.equal(isProspect({ stage: "prospect" }), true);
    assert.equal(isProspect({ stage: "PROSPECT" }), true);
    assert.equal(isProspect({}), false);
    assert.equal(isProspect(null), false);
    assert.equal(canonicalCustomerCode("BTG Pactual"), canonicalCustomerCode("BTG-PACTUAL"));
    assert.equal(canonicalCustomerCode("Itaú"), "ITAU");
    assert.equal(cnpjRoot("12.345.678/0001-95"), "12345678");
    assert.equal(cnpjRoot("00.000.000/0000-00"), null);
    assert.equal(safeDocId("BTG Pactual"), "BTG_Pactual");
    assert.equal(safeDocId("ITAU-UNIBANCO"), "ITAU-UNIBANCO");
    assert.match(
      String(customerIdentityConflict({ code: "ITAU", documentId: "ITAU" }, [{ id: "Ita_", data: { code: "Itaú", name: "Itaú" } }])),
      /O código ITAU já é do cliente Itaú \(cadastrado como Itaú\)/,
    );
  });
});

describe("código do cliente", () => {
  it("sugerido pelo nome: sem acento, com hífen e sem o sufixo societário", () => {
    for (const [nome, codigo] of [
      ["Itaú Unibanco S.A.", "ITAU-UNIBANCO"],
      ["Banco Safra S/A", "BANCO-SAFRA"],
      ["BTG Pactual", "BTG-PACTUAL"],
      ["Construtora Ômega Ltda.", "CONSTRUTORA-OMEGA"],
      ["Padaria São João ME", "PADARIA-SAO-JOAO"],
      ["  dutelog  ", "DUTELOG"],
      ["SA", "SA"],
    ] as const) {
      assert.equal(sugerirCodigo(nome), codigo, nome);
    }
  });

  it("corta em palavra inteira até 20 caracteres", () => {
    assert.equal(sugerirCodigo("Companhia Brasileira de Distribuição"), "COMPANHIA-BRASILEIRA");
    assert.equal(sugerirCodigo("Superintendênciageralmentelonga"), "SUPERINTENDENCIAGERA");
    for (const nome of ["Companhia Brasileira de Distribuição", "Superintendênciageralmentelonga", "A B C D E F G H I J K"]) {
      const codigo = sugerirCodigo(nome);
      assert.ok(codigo.length <= 20, codigo);
      assert.match(codigo, CUSTOMER_CODE_PATTERN);
    }
  });

  it("nome que não rende código válido sugere vazio", () => {
    for (const nome of ["", "   ", "A", "!!!", null, undefined]) {
      assert.equal(sugerirCodigo(nome), "", String(nome));
    }
  });

  it("o informado vale, em maiúsculas; sem ele, o sugerido", () => {
    assert.equal(codigoDoNovoCadastro("itau", "Itaú Unibanco S.A."), "ITAU");
    assert.equal(codigoDoNovoCadastro(" ITAU-2 ", "x"), "ITAU-2");
    assert.equal(codigoDoNovoCadastro(undefined, "Itaú Unibanco S.A."), "ITAU-UNIBANCO");
    assert.equal(codigoDoNovoCadastro("", "Banco Safra"), "BANCO-SAFRA");
  });

  it("código fora do formato é invalid-argument, sem troca silenciosa", async () => {
    for (const codigo of ["A", "-ITAU", "ITAU UNIBANCO", "ITAÚ", "ITAU_X", "ITAU.SA", "ABCDEFGHIJKLMNOPQRSTU"]) {
      await rejeita(() => codigoDoNovoCadastro(codigo, "Itaú"), "invalid-argument", /Código do cliente inválido/);
    }
    await rejeita(() => codigoDoNovoCadastro("", "!!"), "invalid-argument", /Informe o código/);
  });
});

describe("CNPJ do cadastro", () => {
  it("normalizado sem máscara, com a mesma raiz que a unicidade compara", () => {
    for (const valor of ["12.345.678/0001-95", "12345678000195", "CNPJ 12.345.678/0001-95", "12.ABC.345/01DE-35"]) {
      const cnpj = cnpjNormalizado(valor);
      assert.ok(cnpj, valor);
      assert.equal(cnpj.length, 14);
      assert.equal(cnpj.slice(0, 8), cnpjRoot(valor), valor);
    }
    assert.equal(cnpjNormalizado("12.abc.345/01de-35"), "12ABC34501DE35");
  });

  it("vazio vira null; sem CNPJ válido é invalid-argument", async () => {
    assert.equal(cnpjDaEntrada(""), null);
    assert.equal(cnpjDaEntrada(null), null);
    assert.equal(cnpjDaEntrada(" 12.345.678/0001-95 "), "12345678000195");
    for (const valor of ["12.345.678/0001-96", "123.456.789-09", "00.000.000/0000-00", "abc"]) {
      await rejeita(() => cnpjDaEntrada(valor), "invalid-argument", /CNPJ inválido/);
    }
  });
});

describe("cadastro que o WMS opera", () => {
  it("sigla, projeção ou a BTG legada: a identidade fica em Configurações › Clientes", () => {
    assert.equal(cadastroDoWms({ code: "ITAU", sku_prefix: "ITAU" }, false), true);
    assert.equal(cadastroDoWms({ code: "ITAU" }, true), true);
    assert.equal(cadastroDoWms({ code: "BTG Pactual" }, false), true);
    assert.equal(cadastroDoWms({ customer_code: "BTG-PACTUAL" }, false), true);
    assert.equal(cadastroDoWms({ code: "ITAU", stage: "prospect", sku_prefix: "  " }, false), false);
    assert.equal(cadastroDoWms({ code: "BTG" }, false), false);
  });

  it("entity_id do evento a partir do id do WMS", () => {
    assert.equal(entityIdDoCadastro("ITAU-UNIBANCO"), "ITAU-UNIBANCO");
    assert.equal(entityIdDoCadastro("BTG_Pactual"), "BTG_Pactual");
    assert.equal(entityIdDoCadastro("Ita__S.A."), "Ita__S_A_");
  });
});

describe("o WMS não lê o cadastro comercial", () => {
  function fontes(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return fontes(path);
      return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
    });
  }

  it("nenhum fonte de functions/wms/src cita customer_contacts (o Agent Dute não alcança contatos)", () => {
    const dir = fileURLToPath(new URL("../../../wms/src", import.meta.url));
    const arquivos = fontes(dir);
    assert.ok(arquivos.length > 10, "fontes do WMS não encontrados");
    for (const arquivo of arquivos) {
      assert.doesNotMatch(readFileSync(arquivo, "utf8"), /customer_contacts/, arquivo);
    }
  });
});
