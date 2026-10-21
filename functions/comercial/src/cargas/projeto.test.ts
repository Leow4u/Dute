import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { RAIZ_DO_REPOSITORIO_CARGAS, podeGravarNoProjeto, problemaDoArquivoNoRepositorio } from "./projeto.js";
import { lerOpcoes as opcoesContratos } from "./contratos.js";
import { lerOpcoes as opcoesClientes } from "./clientes-omie.js";

test("projeto demo só grava com o emulador ligado, nas três cargas", () => {
  assert.match(String(podeGravarNoProjeto("demo-x", {})), /emulador/);
  assert.equal(podeGravarNoProjeto("demo-x", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8088" }), null);
  assert.throws(() => opcoesContratos(["--arquivo", "/fora/c.json", "--projeto", "demo-x", "--executar"], RAIZ_DO_REPOSITORIO_CARGAS, {}), /emulador/);
  assert.throws(
    () =>
      opcoesClientes(
        ["--clientes", "a", "--crm", "b", "--titulos", "c", "--codigos", "d", "--projeto", "demo-x", "--executar"],
        RAIZ_DO_REPOSITORIO_CARGAS,
        {},
      ),
    /emulador/,
  );
});

test("arquivo de carga dentro do repositório só em tmp/ ou .secrets/", () => {
  const raiz = RAIZ_DO_REPOSITORIO_CARGAS;
  assert.match(String(problemaDoArquivoNoRepositorio(join(raiz, "precos.csv"), raiz)), /dentro do repositório/);
  assert.match(String(problemaDoArquivoNoRepositorio(join(raiz, "docs", "tabela.csv"), raiz)), /dentro do repositório/);
  assert.equal(problemaDoArquivoNoRepositorio(join(raiz, "tmp", "comercial", "tabela.csv"), raiz), null);
  assert.equal(problemaDoArquivoNoRepositorio(join(raiz, ".secrets", "tabela.csv"), raiz), null);
  assert.equal(problemaDoArquivoNoRepositorio(join(raiz, "..", "fora", "tabela.csv"), raiz), null);
});
