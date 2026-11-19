import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ZAP_ACCESS_COLLECTION, ZAP_CONVERSATIONS_COLLECTION, ZAP_MESSAGES_COLLECTION } from "./colecoes.js";
import { LINHA_PILOTO, LINHAS_ZAP, linhaPorId } from "./linhas.js";
import { ROTULO_DO_TIPO } from "./modelo.js";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

function ids(arquivo: string): string[] {
  return [...arquivo.matchAll(/phone_number_id:\s*"(\d+)"/g)].map((match) => match[1] ?? "");
}

describe("linhas do Zap", () => {
  it("os ids são únicos e o piloto é o Jamil", () => {
    const encontrados = LINHAS_ZAP.map((linha) => linha.phone_number_id);
    assert.equal(new Set(encontrados).size, encontrados.length);
    assert.equal(linhaPorId(LINHA_PILOTO)?.agente, "jamil");
    assert.equal(linhaPorId("0"), null);
  });

  it("o painel repete a mesma lista", () => {
    const painel = read("../../../../artifacts/dute-zap/src/linhas.ts");
    assert.deepEqual(ids(painel), ids(read("../../src/domain/linhas.ts")));
    assert.match(painel, new RegExp(`LINHA_PILOTO = "${LINHA_PILOTO}"`));
  });

  it("os rótulos de mídia do painel são os da prévia", () => {
    const formatar = read("../../../../artifacts/dute-zap/src/formatar.ts");
    for (const [tipo, rotulo] of Object.entries(ROTULO_DO_TIPO)) {
      assert.match(formatar, new RegExp(`${tipo}: "${rotulo}"`));
    }
  });

  it("as regras nomeiam as três coleções e não abrem escrita", () => {
    const regras = read("../../../../firestore.rules");
    for (const nome of [ZAP_CONVERSATIONS_COLLECTION, ZAP_MESSAGES_COLLECTION, ZAP_ACCESS_COLLECTION]) {
      assert.match(regras, new RegExp(`match /${nome}/\\{[^}]+\\} \\{[\\s\\S]*?allow read: if isPrivileged\\(\\);[\\s\\S]*?allow create, update, delete: if false;`));
    }
  });
});
