import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { abreAvisoNaCaixaAntiga } from "./caixa-do-agente.js";

/**
 * A caixa antiga do Agent Dute (`ai_agent_inbox`) não recebe aviso onde o
 * agente do núcleo roda: o painel novo (04/11/2026) não a lê, e o aviso
 * ficava aberto para sempre, contando no Início.
 */

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const fonte = (arquivo: string) => readFileSync(`${SRC}${arquivo}`, "utf8");

describe("a caixa antiga do Agent Dute", () => {
  it("fecha onde o agente do núcleo roda e segue aberta fora dele", () => {
    assert.equal(abreAvisoNaCaixaAntiga("dute-prod"), false);
    assert.equal(abreAvisoNaCaixaAntiga("dute-homolog"), false);
    assert.equal(abreAvisoNaCaixaAntiga("dute-btg"), true);
    assert.equal(abreAvisoNaCaixaAntiga("demo-dute-operations"), true);
    assert.equal(abreAvisoNaCaixaAntiga(undefined), true);
  });

  it("o evento de atenção e a ação \"tratar documento\" passam pela guarda", () => {
    assert.match(fonte("domain/operations.ts"), /input\.inbox !== false &&\s*abreAvisoNaCaixaAntiga\(PROJECT_ID\) &&\s*\(severity === "attention" \|\| severity === "critical"\)/);
    assert.match(fonte("index.ts"), /if \(abreAvisoNaCaixaAntiga\(PROJECT_ID\)\) \{\s*transaction\.create\(inboxRef, \{/);
  });

  it("nenhum outro ponto escreve um aviso novo na caixa", () => {
    // Os outros usos só leem ou resolvem o que já está lá (a decisão da solicitação, o "Resolver" do painel antigo).
    const novos = ["domain/operations.ts", "index.ts"].flatMap((arquivo) => fonte(arquivo).match(/\.collection\(collection(?:s|Names)\.agentInbox\)\.doc\(/g) ?? []);
    assert.equal(novos.length, 2);
  });
});
