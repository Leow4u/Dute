import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { ErroDeUso, lerOpcoes, main } from "./contador.js";

/** A ferramenta do contador sem banco: argumentos e o dry-run sem --projeto (parte 6.21). */

const pasta = mkdtempSync(join(tmpdir(), "contador-unit-"));
after(() => rmSync(pasta, { recursive: true, force: true }));

describe("argumentos", () => {
  it("--ultimo é obrigatório, inteiro e na faixa", () => {
    assert.throws(() => lerOpcoes([]), ErroDeUso);
    assert.throws(() => lerOpcoes(["--ultimo", "10.500"]), /inteiro/);
    assert.throws(() => lerOpcoes(["--ultimo", "9999"]), /10000 ou mais/);
    assert.throws(() => lerOpcoes(["--ultimo", "10500", "--outro"]), /desconhecido/);
    assert.equal(lerOpcoes(["--ultimo=10500"]).ultimo, 10_500);
  });

  it("--executar exige --projeto, e não grava na produção", () => {
    assert.throws(() => lerOpcoes(["--ultimo", "10500", "--executar"]), /--projeto é obrigatório/);
    assert.throws(() => lerOpcoes(["--ultimo", "10500", "--projeto", "dute-prod", "--executar"]), /não grava no projeto dute-prod/);
    assert.throws(() => lerOpcoes(["--ultimo", "10500", "--projeto", "demo-x", "--executar"], undefined, {}), /emulador/);
    assert.equal(lerOpcoes(["--ultimo", "10500", "--projeto", "dute-homolog", "--executar"]).executar, true);
  });

  it("o relatório vai para tmp/comercial da raiz, por padrão", () => {
    assert.equal(lerOpcoes(["--ultimo", "10500"], "/raiz").relatorioDir, "/raiz/tmp/comercial");
  });
});

describe("dry-run sem --projeto", () => {
  it("só confere o número e escreve o relatório", async () => {
    const linhas: string[] = [];
    const resultado = await main(["--ultimo", "10872", "--relatorio-dir", pasta], {
      agora: () => new Date("2026-10-23T12:00:00.000Z"),
      log: (linha) => linhas.push(linha),
    });
    assert.equal(resultado.codigo, 0);
    assert.ok(resultado.relatorio);
    const relatorio = JSON.parse(readFileSync(resultado.relatorio!, "utf8"));
    assert.deepEqual(relatorio, {
      carga: "contador",
      modo: "dry-run",
      projeto: null,
      gerado_em: "2026-10-23T12:00:00.000Z",
      ultimo: 10872,
      proxima: 10873,
      atual: null,
      maior_demanda: null,
      acao: null,
      problema: null,
      evento: null,
      erro: null,
    });
    assert.ok(linhas.some((linha) => linha.includes("a próxima demanda é a 10873")));
  });

  it("erro de uso: código 2 e nenhum relatório", async () => {
    const resultado = await main(["--ultimo", "abc"], { log: () => undefined });
    assert.deepEqual(resultado, { codigo: 2, relatorio: null, conteudo: null });
  });
});
