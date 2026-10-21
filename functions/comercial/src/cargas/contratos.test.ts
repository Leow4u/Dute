import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CARGA_CONTRATOS, ErroDeUso, RAIZ_DO_REPOSITORIO, lerCarga, lerOpcoes, main } from "./contratos.js";

/**
 * Carga de contratos sem banco: argumentos (projeto obrigatório para gravar,
 * arquivo fora do repositório), dry-run só do arquivo, relatório e o exemplo
 * sintético de docs/plataforma/comercial-cargas.md.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** O bloco JSON depois do marcador do exemplo no documento das cargas. */
function exemploDoDocumento(): unknown {
  const doc = read("../../../../docs/plataforma/comercial-cargas.md");
  const match = doc.match(/<!-- exemplo-contratos -->\s*```json\s*([\s\S]*?)```/);
  assert.ok(match, "exemplo de contratos não encontrado em docs/plataforma/comercial-cargas.md");
  return JSON.parse(match[1]);
}

let pasta: string;
let arquivo: string;

before(() => {
  pasta = mkdtempSync(join(tmpdir(), "carga-contratos-"));
  arquivo = join(pasta, "contratos.json");
  writeFileSync(arquivo, JSON.stringify(exemploDoDocumento()), "utf8");
});

after(() => {
  rmSync(pasta, { recursive: true, force: true });
});

function silencioso() {
  const linhas: string[] = [];
  return { linhas, log: (linha: string) => linhas.push(linha) };
}

describe("argumentos da carga de contratos", () => {
  it("dry-run por padrão; sem --projeto, só o arquivo", () => {
    const opcoes = lerOpcoes(["--arquivo", arquivo]);
    assert.equal(opcoes.executar, false);
    assert.equal(opcoes.projeto, null);
    assert.equal(opcoes.arquivo, arquivo);
    assert.equal(opcoes.relatorioDir, join(RAIZ_DO_REPOSITORIO, "tmp", "comercial"));
  });

  it("--executar sem --projeto é recusado", () => {
    assert.throws(() => lerOpcoes(["--arquivo", arquivo, "--executar"]), (error: unknown) => error instanceof ErroDeUso && /--projeto é obrigatório/.test(error.message));
    assert.throws(() => lerOpcoes(["--arquivo", arquivo, "--executar", "--projeto="]), ErroDeUso);
    assert.throws(() => lerOpcoes(["--arquivo", arquivo, "--executar", "--projeto", "--executar"]), ErroDeUso);
  });

  it("--executar só onde o Comercial está liberado, ou no emulador", () => {
    assert.throws(
      () => lerOpcoes(["--arquivo", arquivo, "--executar", "--projeto", "dute-prod"]),
      (error: unknown) => error instanceof ErroDeUso && /não está liberado em dute-prod/.test(error.message),
    );
    assert.equal(lerOpcoes(["--arquivo", arquivo, "--executar", "--projeto", "dute-homolog"]).projeto, "dute-homolog");
    assert.equal(lerOpcoes(["--arquivo", arquivo, "--executar", "--projeto=demo-dute-comercial"]).executar, true);
    // Ler a produção, sem gravar, pode.
    assert.equal(lerOpcoes(["--arquivo", arquivo, "--projeto", "dute-prod"]).projeto, "dute-prod");
  });

  it("o JSON fica fora do repositório, ou em tmp/", () => {
    const raiz = join(pasta, "repo");
    assert.throws(
      () => lerOpcoes(["--arquivo", join(raiz, "docs", "contratos.json")], raiz),
      (error: unknown) => error instanceof ErroDeUso && /fora do repositório/.test(error.message),
    );
    assert.throws(() => lerOpcoes(["--arquivo", join(raiz, "contratos.json")], raiz), ErroDeUso);
    assert.throws(() => lerOpcoes(["--arquivo", join(raiz, "tmpx", "contratos.json")], raiz), ErroDeUso);
    assert.equal(lerOpcoes(["--arquivo", join(raiz, "tmp", "contratos.json")], raiz).arquivo, join(raiz, "tmp", "contratos.json"));
    assert.ok(lerOpcoes(["--arquivo", join(raiz, ".secrets", "contratos.json")], raiz));
    assert.ok(lerOpcoes(["--arquivo", arquivo], raiz));
  });

  it("sem --arquivo ou com argumento desconhecido é erro de uso", () => {
    assert.throws(() => lerOpcoes([]), (error: unknown) => error instanceof ErroDeUso && /--arquivo é obrigatório/.test(error.message));
    assert.throws(() => lerOpcoes(["--arquivo", arquivo, "--apply"]), /Argumento desconhecido: --apply/);
  });
});

describe("arquivo da carga", () => {
  it("o exemplo sintético do documento é válido", () => {
    const parsed = CARGA_CONTRATOS.safeParse(exemploDoDocumento());
    assert.ok(parsed.success, parsed.success ? "" : parsed.error.message);
    assert.equal(parsed.data.contratos[0].aditivos.length, 2);
  });

  it("contrato repetido, aditivo repetido e preço no contrato são recusados, com o caminho", () => {
    const exemplo = exemploDoDocumento() as { contratos: Array<Record<string, unknown> & { aditivos: unknown[]; contrato: Record<string, unknown> }> };
    const contrato = exemplo.contratos[0];
    const casos: Array<[unknown, RegExp]> = [
      [{ contratos: [contrato, contrato] }, /contratos\.1\.id: Contrato exemplo-2026 repetido/],
      [{ contratos: [{ ...contrato, aditivos: [contrato.aditivos[0], contrato.aditivos[0]] }] }, /aditivos\.1\.numero: Aditivo 1 repetido/],
      [{ contratos: [{ ...contrato, contrato: { ...contrato.contrato, valor: "1500.00" } }] }, /contratos\.0\.contrato: Unrecognized key/],
      [{ contratos: [] }, /A carga não tem contrato/],
    ];
    for (const [json, esperado] of casos) {
      const caminho = join(pasta, "invalido.json");
      writeFileSync(caminho, JSON.stringify(json), "utf8");
      const { carga, problemas } = lerCarga(caminho);
      assert.equal(carga, null);
      assert.ok(problemas.some((problema) => esperado.test(problema)), problemas.join(" | "));
    }
  });

  it("JSON quebrado vira problema, não exceção", () => {
    const caminho = join(pasta, "quebrado.json");
    writeFileSync(caminho, "{ contratos: ", "utf8");
    const { carga, problemas } = lerCarga(caminho);
    assert.equal(carga, null);
    assert.match(problemas[0], /Não consegui ler o JSON/);
  });
});

describe("main da carga", () => {
  it("--executar sem --projeto sai com código 2, sem relatório nem leitura", async () => {
    const relatorios = join(pasta, "relatorios-uso");
    const { linhas, log } = silencioso();
    const resultado = await main(["--arquivo", join(pasta, "nao-existe.json"), "--executar", "--relatorio-dir", relatorios], { log });
    assert.equal(resultado.codigo, 2);
    assert.equal(resultado.relatorio, null);
    assert.equal(existsSync(relatorios), false);
    assert.match(linhas.join("\n"), /--projeto é obrigatório/);
  });

  it("dry-run sem projeto confere o arquivo e grava o relatório, sem abrir banco", async () => {
    const relatorios = join(pasta, "relatorios-dry");
    const { linhas, log } = silencioso();
    const resultado = await main(["--arquivo", arquivo, "--relatorio-dir", relatorios], {
      log,
      agora: () => new Date("2026-10-21T12:00:00.000Z"),
    });
    assert.equal(resultado.codigo, 0);
    assert.deepEqual(readdirSync(relatorios), ["contratos-dry-run-sem-projeto-2026-10-21T12-00-00-000Z.json"]);
    const relatorio = JSON.parse(readFileSync(resultado.relatorio ?? "", "utf8"));
    assert.equal(relatorio.modo, "dry-run");
    assert.equal(relatorio.projeto, null);
    assert.equal(relatorio.arquivo, "contratos.json");
    assert.equal(relatorio.resumo.contratos, 1);
    assert.equal(relatorio.resumo.a_conferir, 1);
    assert.equal(relatorio.resumo.aditivos, 2);
    assert.deepEqual(
      relatorio.contratos[0].aditivos.map((aditivo: { aditivo_id: string; acao: string }) => `${aditivo.aditivo_id}:${aditivo.acao}`),
      ["01:a_conferir", "02:a_conferir"],
    );
    assert.match(linhas.join("\n"), /só o arquivo foi conferido/);
  });

  it("arquivo inválido sai com código 1 e o relatório lista os problemas", async () => {
    const caminho = join(pasta, "invalido-main.json");
    writeFileSync(caminho, JSON.stringify({ contratos: [] }), "utf8");
    const relatorios = join(pasta, "relatorios-invalido");
    const resultado = await main(["--arquivo", caminho, "--relatorio-dir", relatorios], silencioso());
    assert.equal(resultado.codigo, 1);
    assert.equal(resultado.conteudo?.resumo.invalido, 1);
    assert.match(String(resultado.conteudo?.invalido[0]), /A carga não tem contrato/);
  });
});
