import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { interpretarEscopo, modulosDoEscopo } from "./agente-escopo.js";
import { agenteLiberado, AGENTE_AMBIENTES_LIBERADOS, assertAgenteLiberado } from "./liberacao.js";
import { AGENTE_ROLES, agenteProblem, contractedModulesFrom, leValor, PLATFORM_ROLES, VALOR_ROLES } from "./platform-roles.js";

/**
 * O escopo do Agent Dute do núcleo (parte 5.5b), nas contas puras: a
 * liberação própria, quem tem o agente, quem lê valor e os módulos de cada
 * papel em cada cliente.
 */

describe("a liberação do Agent Dute do núcleo", () => {
  it("homologação e produção, separada da memória", () => {
    assert.deepEqual([...AGENTE_AMBIENTES_LIBERADOS], ["dute-homolog", "dute-prod"]);
    assert.equal(agenteLiberado(" dute-homolog "), true);
    assert.equal(agenteLiberado("dute-prod"), true);
    for (const projeto of ["dute-btg", "", null, undefined]) assert.equal(agenteLiberado(projeto), false, String(projeto));
    assert.throws(() => assertAgenteLiberado("dute-btg"), (erro: unknown) => erro instanceof HttpsError && erro.code === "failed-precondition" && /Agent Dute.*dute-btg/.test(erro.message));
  });
});

describe("quem tem o agente e quem lê valor", () => {
  it("a equipe dos módulos e o cliente; o campo, o painel e o RH, não", () => {
    assert.deepEqual([...AGENTE_ROLES], ["owner", "admin", "interno", "wms", "comercial", "financeiro", "suporte", "cliente"]);
    for (const role of AGENTE_ROLES) assert.equal(agenteProblem(role), null, role);
    for (const role of ["campo", "painel", "rh"] as const) assert.equal(agenteProblem(role), "Seu perfil não usa o Agent Dute.", role);
    assert.equal(PLATFORM_ROLES.filter((role) => agenteProblem(role) !== null).length, 3);
  });

  it("o valor só para quem lê preço e para o cliente, nos documentos dele", () => {
    assert.deepEqual([...VALOR_ROLES], ["owner", "admin", "comercial", "financeiro"]);
    assert.deepEqual(PLATFORM_ROLES.filter(leValor), ["owner", "admin", "comercial", "financeiro", "cliente"]);
  });
});

describe("os módulos de cada papel no cliente", () => {
  it("o cliente fala dos módulos que contratou", () => {
    assert.deepEqual(modulosDoEscopo("cliente", ["wms", "financeiro"]), ["wms", "financeiro"]);
    assert.deepEqual(modulosDoEscopo("cliente", ["operacao"]), ["operacao"]);
  });

  it("a equipe fala dos módulos do papel que o cliente contratou; o Comercial vale para todo cliente", () => {
    assert.deepEqual(modulosDoEscopo("owner", ["wms", "financeiro"]), ["wms", "comercial", "financeiro"]);
    assert.deepEqual(modulosDoEscopo("admin", ["wms", "operacao", "financeiro"]), ["wms", "operacao", "comercial", "financeiro"]);
    assert.deepEqual(modulosDoEscopo("interno", ["wms", "financeiro"]), ["wms"]);
    assert.deepEqual(modulosDoEscopo("interno", ["operacao"]), ["operacao"]);
    assert.deepEqual(modulosDoEscopo("wms", ["operacao"]), []);
    assert.deepEqual(modulosDoEscopo("comercial", ["operacao"]), ["comercial"]);
    assert.deepEqual(modulosDoEscopo("financeiro", ["wms"]), []);
    assert.deepEqual(modulosDoEscopo("financeiro", ["wms", "financeiro"]), ["financeiro"]);
    assert.deepEqual(modulosDoEscopo("suporte", ["wms", "operacao"]), ["wms", "operacao"]);
  });

  it("sem a lista no acesso do cliente, vale o padrão", () => {
    assert.deepEqual(contractedModulesFrom(undefined), ["wms", "financeiro"]);
    assert.deepEqual(contractedModulesFrom(["rh"]), ["wms", "financeiro"]);
    assert.deepEqual(contractedModulesFrom(["operacao", "x"]), ["operacao"]);
  });
});

describe("o pedido do escopo", () => {
  it("o módulo é obrigatório e o cliente não leva caminho", () => {
    assert.deepEqual(interpretarEscopo({ customer_code: " ITAU ", modulo: "wms", message: "oi" }), { customer_code: "ITAU", modulo: "wms" });
    assert.deepEqual(interpretarEscopo({ modulo: "operacao" }), { modulo: "operacao" });
    const invalido = (mensagem: RegExp) => (erro: unknown) => erro instanceof HttpsError && erro.code === "invalid-argument" && mensagem.test(erro.message);
    assert.throws(() => interpretarEscopo({ customer_code: "ITAU" }), invalido(/Módulo inválido/));
    assert.throws(() => interpretarEscopo({ modulo: "rh" }), invalido(/Módulo inválido/));
    assert.throws(() => interpretarEscopo({ modulo: "wms", customer_code: "a/b" }), invalido(/Cliente inválido/));
    assert.throws(() => interpretarEscopo(null), invalido(/Módulo inválido/));
  });
});
