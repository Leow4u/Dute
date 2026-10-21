import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import { lpuItemId } from "../domain/catalogo.js";
import { ErroDaCarga, lerArgumentos, lerTabelaCsv, podeGravarNoProjeto, rodarCarga } from "./tabela.js";

/**
 * Carga de tabela de preço (functions/comercial/src/cargas/tabela.ts): CSV
 * UTF-8 com cabeçalho fixo, preço em decimal exato, dry-run por padrão e
 * --executar só com --projeto explícito. Tudo com dado sintético.
 */

const CABECALHO = "codigo;categoria;item;servico;descricao;unidade;preco";

function csv(...linhas: string[]): Uint8Array {
  return new TextEncoder().encode([CABECALHO, ...linhas].join("\n"));
}

const BASE = [
  "DTL-0001-T;Mobiliário;Mesa de escritório;Transporte;Transporte de mesa;UN;45.50",
  "DTL-0001-M;Mobiliário;Mesa de escritório;Montagem;Montagem de mesa;UN;30",
  "DTL-0200-T;Frete;Frete fora de SP;Transporte;Frete por km rodado;KM;3.89",
];

const pasta = mkdtempSync(join(tmpdir(), "dute-carga-tabela-"));
after(() => rmSync(pasta, { recursive: true, force: true }));

function arquivo(nome: string, conteudo: Uint8Array | string): string {
  const caminho = join(pasta, nome);
  writeFileSync(caminho, conteudo);
  return caminho;
}

const ARGS = ["--nome", "Tabela de teste", "--variante", "Comercial", "--vigente-de", "2026-06-30"];

describe("argumentos da carga", () => {
  it("dry-run é o padrão", () => {
    const args = lerArgumentos(["--arquivo", "x.csv", ...ARGS]);
    assert.equal(args.executar, false);
    assert.equal(args.projeto, null);
    assert.equal(args.cliente, null);
    assert.equal(args.contrato, null);
    assert.equal(args.vigente_ate, null);
    assert.equal(args.validade_dias, null);
    assert.equal(args.variante, "Comercial");
  });

  it("--executar sem --projeto é recusado: não há projeto padrão", () => {
    assert.throws(
      () => lerArgumentos(["--arquivo", "x.csv", ...ARGS, "--executar"]),
      (error: unknown) => error instanceof ErroDaCarga && /--executar exige --projeto/.test(error.message),
    );
    assert.equal(lerArgumentos(["--arquivo", "x.csv", ...ARGS, "--executar", "--projeto", "dute-homolog"]).executar, true);
  });

  it("aceita --opcao=valor e todos os parâmetros da tabela", () => {
    const args = lerArgumentos([
      "--arquivo=x.csv",
      "--nome=LPU v2.0",
      "--cliente",
      "ITAU",
      "--contrato",
      "itau-2026",
      "--variante",
      "Noturna",
      "--vigente-de",
      "2026-06-30",
      "--vigente-ate",
      "2027-06-30",
      "--rodape",
      "Conforme o aditivo 4.",
      "--condicoes",
      "Tributos inclusos.",
      "--validade-dias",
      "30",
      "--por",
      "leonardo@dutelog.com.br",
    ]);
    assert.equal(args.nome, "LPU v2.0");
    assert.equal(args.cliente, "ITAU");
    assert.equal(args.contrato, "itau-2026");
    assert.equal(args.variante, "Noturna");
    assert.equal(args.vigente_ate, "2027-06-30");
    assert.equal(args.rodape, "Conforme o aditivo 4.");
    assert.equal(args.condicoes, "Tributos inclusos.");
    assert.equal(args.validade_dias, 30);
    assert.equal(args.por, "leonardo@dutelog.com.br");
  });

  it("recusa o que falta ou não confere", () => {
    const recusados: Array<[string[], RegExp]> = [
      [["--nome", "x", "--variante", "Comercial", "--vigente-de", "2026-06-30"], /--arquivo/],
      [["--arquivo", "x.csv", "--variante", "Comercial", "--vigente-de", "2026-06-30"], /--nome/],
      [["--arquivo", "x.csv", "--nome", "x", "--vigente-de", "2026-06-30"], /--variante/],
      [["--arquivo", "x.csv", "--nome", "x", "--variante", "Comercial"], /--vigente-de/],
      [["--arquivo", "x.csv", ...ARGS, "--contrato", "itau-2026"], /--contrato exige --cliente/],
      [["--arquivo", "x.csv", ...ARGS, "--vigente-ate", "2026-06-29"], /antes do início/],
      [["--arquivo", "x.csv", "--nome", "x", "--variante", "Comercial", "--vigente-de", "2026-02-30"], /data/i],
      [["--arquivo", "x.csv", ...ARGS, "--validade-dias", "30.5"], /--validade-dias/],
      [["--arquivo", "x.csv", ...ARGS, "--validade-dias", "0"], /--validade-dias/],
      [["--arquivo", "x.csv", ...ARGS, "--projeto", "Dute Prod"], /--projeto/],
      [["--arquivo", "x.csv", ...ARGS, "--contrato", "itau 2026", "--cliente", "ITAU"], /--contrato/],
      [["--arquivo", "x.csv", ...ARGS, "--forcar"], /desconhecid/],
      [["--arquivo", "x.csv", ...ARGS, "--nome"], /--nome/],
      [["--arquivo", "x.csv", "--nome", "x", "--variante", "Noturna 2", "--vigente-de", "2026-06-30"], /variante/i],
    ];
    for (const [argv, mensagem] of recusados) {
      assert.throws(
        () => lerArgumentos(argv),
        (error: unknown) => error instanceof ErroDaCarga && mensagem.test(error.message),
        argv.join(" "),
      );
    }
  });

  it("só grava em projeto com o Comercial liberado, ou no emulador", () => {
    assert.equal(podeGravarNoProjeto("dute-homolog", {}), null);
    assert.match(String(podeGravarNoProjeto("dute-prod", {})), /não está liberado/);
    assert.match(String(podeGravarNoProjeto("dute-btg", {})), /não está liberado/);
    assert.match(String(podeGravarNoProjeto("demo-dute-comercial", {})), /emulador/);
    assert.equal(podeGravarNoProjeto("demo-dute-comercial", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8088" }), null);
  });
});

describe("leitura do CSV", () => {
  it("lê as linhas, gera o id de cada item e guarda o preço como texto exato", () => {
    const leitura = lerTabelaCsv(csv(...BASE));
    assert.deepEqual(leitura.erros, []);
    assert.equal(leitura.linhas, 3);
    assert.equal(leitura.itens.length, 3);
    const [transporte, montagem, frete] = leitura.itens;
    assert.equal(
      transporte.id,
      lpuItemId({ categoria: "Mobiliário", item: "Mesa de escritório", servico: "Transporte", unidade: "UN" }),
    );
    assert.equal(transporte.codigo, "DTL-0001-T");
    assert.equal(transporte.descricao_cliente, "Transporte de mesa");
    assert.equal(transporte.preco, "45.50");
    assert.equal(montagem.preco, "30");
    assert.equal(frete.preco, "3.89");
    assert.equal(frete.unidade, "KM");
    assert.deepEqual(transporte.linhas, [2]);
    assert.notEqual(transporte.id, montagem.id);
  });

  it("aceita BOM, CRLF, cabeçalho com acento, aspas e linha vazia no fim", () => {
    const texto =
      "﻿Código;Categoria;Item;Serviço;Descrição;Unidade;Preço\r\n" +
      'DTL-0001-T;Mobiliário;Mesa;Transporte;"Transporte de mesa; com ""cuidado""";UN;45.50\r\n' +
      ";;;;;;\r\n\r\n";
    const leitura = lerTabelaCsv(new TextEncoder().encode(texto));
    assert.deepEqual(leitura.erros, []);
    assert.equal(leitura.itens.length, 1);
    assert.equal(leitura.itens[0].descricao_cliente, 'Transporte de mesa; com "cuidado"');
  });

  it("preço inválido para a carga, com a linha", () => {
    for (const preco of ["3,89", "R$ 3.89", "1.234,56", "abc", "", "1e3", "+3.89", "3.89.1"]) {
      const leitura = lerTabelaCsv(csv(BASE[0], `DTL-0002-T;Mobiliário;Cadeira;Transporte;Transporte de cadeira;UN;${preco}`));
      assert.equal(leitura.erros.length, 1, `${preco}: ${leitura.erros.join(" | ")}`);
      assert.match(leitura.erros[0], /^linha 3: /, preco);
      assert.match(leitura.erros[0], /preço/, preco);
    }
  });

  it("preço em float (casas de float do Excel) para a carga", () => {
    const leitura = lerTabelaCsv(csv(`DTL-0002-T;Mobiliário;Cadeira;Transporte;Transporte;UN;3.8900000000000001`));
    assert.equal(leitura.erros.length, 1);
    assert.match(leitura.erros[0], /linha 2: .*preço.*4 casas/);
  });

  it("preço com 5 casas para a carga", () => {
    const leitura = lerTabelaCsv(csv(`DTL-0002-T;Mobiliário;Cadeira;Transporte;Transporte;UN;3.12345`));
    assert.equal(leitura.erros.length, 1);
    assert.match(leitura.erros[0], /linha 2: .*4 casas/);
    assert.deepEqual(lerTabelaCsv(csv(`DTL-0002-T;Mobiliário;Cadeira;Transporte;Transporte;UN;3.1234`)).erros, []);
  });

  it("preço negativo para a carga; preço zero só avisa", () => {
    assert.match(lerTabelaCsv(csv(`DTL-0002-T;Mobiliário;Cadeira;Transporte;Transporte;UN;-1.00`)).erros[0], /negativo/);
    const zero = lerTabelaCsv(csv(`DTL-0002-T;Mobiliário;Cadeira;Transporte;Transporte;UN;0.00`));
    assert.deepEqual(zero.erros, []);
    assert.match(zero.avisos.join(" | "), /linha 2: preço zero/);
  });

  it("código repetido vira itens distintos quando item, serviço ou unidade diferem", () => {
    const leitura = lerTabelaCsv(
      csv(
        "DTL-0126;Mobiliário;Armário alto;Transporte;Transporte de armário alto;UN;80",
        "DTL-0126;Mobiliário;Armário baixo;Transporte;Transporte de armário baixo;UN;60",
        "DTL-0126;Mobiliário;Armário baixo;Transporte;Transporte de armário baixo por metro;ML;20",
      ),
    );
    assert.deepEqual(leitura.erros, []);
    assert.equal(leitura.itens.length, 3);
    assert.equal(new Set(leitura.itens.map((item) => item.id)).size, 3);
    assert.deepEqual(
      leitura.codigos_repetidos.map((repetido) => [repetido.codigo, repetido.itens.length]),
      [["DTL-0126", 3]],
    );
    assert.match(leitura.avisos.join(" | "), /DTL-0126.*3 itens/);
  });

  it("a mesma chave composta duas vezes com preço diferente para a carga", () => {
    const leitura = lerTabelaCsv(
      csv(BASE[0], "DTL-0001-T;mobiliario;MESA DE ESCRITORIO;transporte;Transporte de mesa;un;47.00"),
    );
    assert.equal(leitura.erros.length, 1);
    assert.match(leitura.erros[0], /linhas 2 e 3: .*preços diferentes/);
  });

  it("a mesma chave com outro código também para; repetida igual entra uma vez", () => {
    const outroCodigo = lerTabelaCsv(csv(BASE[0], "DTL-9999-T;Mobiliário;Mesa de escritório;Transporte;Transporte;UN;45.50"));
    assert.match(outroCodigo.erros.join(" | "), /linhas 2 e 3: .*códigos diferentes/);

    const igual = lerTabelaCsv(csv(BASE[0], BASE[0].replace("45.50", "45.5")));
    assert.deepEqual(igual.erros, []);
    assert.equal(igual.itens.length, 1);
    assert.deepEqual(igual.itens[0].linhas, [2, 3]);
    assert.match(igual.avisos.join(" | "), /linhas 2 e 3: .*entra uma vez/);
  });

  it("armazenagem entra no catálogo como não orçável", () => {
    const leitura = lerTabelaCsv(csv("DTL-0300;Armazenagem;Pallet;Prestação de serviço;Armazenagem de pallet;M³/MÊS;55"));
    assert.deepEqual(leitura.erros, []);
    assert.equal(leitura.itens[0].orcavel, false);
  });

  it("armazenagem com a palavra só no item (categoria Serviços) também entra como não orçável", () => {
    const leitura = lerTabelaCsv(
      csv("DTL-0900;Serviços;Armazenamento em galpão;Prestação de Serviço;Guarda de mobiliário em galpão;M³/MÊS;60"),
    );
    assert.deepEqual(leitura.erros, []);
    assert.equal(leitura.itens[0].orcavel, false);
  });

  it("cabeçalho diferente, separador vírgula e arquivo que não é UTF-8 param a carga", () => {
    assert.match(lerTabelaCsv(new TextEncoder().encode("codigo;item;preco\nA;B;1")).erros[0], /cabeçalho/);
    assert.match(
      lerTabelaCsv(new TextEncoder().encode("codigo,categoria,item,servico,descricao,unidade,preco\nA,B,C,D,E,UN,1")).erros[0],
      /separador/,
    );
    // "Mobiliário" em Latin-1 (Excel salvando "CSV (separado por vírgulas)").
    const latin1 = Uint8Array.from([...new TextEncoder().encode(`${CABECALHO}\nA;Mobili`), 0xe1, ...new TextEncoder().encode("rio;B;C;D;UN;1")]);
    assert.match(lerTabelaCsv(latin1).erros[0], /UTF-8/);
  });

  it("linha com colunas a mais ou a menos, campo vazio e aspas abertas param a carga", () => {
    assert.match(lerTabelaCsv(csv("A;B;C;D;E;UN")).erros[0], /linha 2: .*7 colunas/);
    assert.match(lerTabelaCsv(csv("A;B;C;D;E;UN;1;extra")).erros[0], /linha 2: .*7 colunas/);
    assert.match(lerTabelaCsv(csv("A;;C;D;E;UN;1")).erros[0], /linha 2: .*categoria/);
    assert.match(lerTabelaCsv(csv('A;B;"C;D;E;UN;1')).erros[0], /aspas/);
  });

  it("arquivo sem linhas para a carga", () => {
    assert.match(lerTabelaCsv(csv()).erros[0], /nenhuma linha/);
  });
});

describe("dry-run sem projeto", () => {
  it("não abre o banco, grava só o relatório e mostra o que entraria", async () => {
    const caminho = arquivo("base.csv", csv(...BASE));
    const relatorios = mkdtempSync(join(pasta, "relatorio-"));
    let abriu = false;
    const resultado = await rodarCarga(["--arquivo", caminho, ...ARGS], {
      abrirBanco: () => {
        abriu = true;
        throw new Error("não deveria abrir o banco");
      },
      pastaDoRelatorio: relatorios,
      log: () => undefined,
    });
    assert.equal(abriu, false);
    assert.equal(resultado.ok, true);
    assert.equal(resultado.modo, "dry-run");
    assert.equal(resultado.gravou, false);
    assert.match(String(resultado.tabela_id), /^pt_[0-9a-f]{32}$/);
    assert.ok(resultado.relatorio && existsSync(resultado.relatorio));
    const relatorio = JSON.parse(readFileSync(resultado.relatorio, "utf8"));
    assert.equal(relatorio.modo, "dry-run");
    assert.equal(relatorio.fonte.arquivo, "base.csv", "só o nome do arquivo, sem a pasta da máquina");
    assert.match(relatorio.fonte.sha256, /^[0-9a-f]{64}$/);
    assert.equal(relatorio.fonte.linhas, 3);
    assert.equal(relatorio.itens.total, 3);
    assert.equal(relatorio.soma_dos_precos, "79.39");
    assert.deepEqual(relatorio.itens.por_categoria, { Frete: 1, Mobiliário: 2 });
    assert.ok(readdirSync(relatorios).some((nome) => nome.endsWith(".csv")), "CSV de conferência");
  });

  it("CSV com erro não chega ao banco e o relatório lista os erros", async () => {
    const caminho = arquivo("erro.csv", csv(BASE[0], "DTL-0002;Mobiliário;Cadeira;Transporte;Transporte;UN;3,89"));
    const relatorios = mkdtempSync(join(pasta, "relatorio-"));
    let abriu = false;
    const resultado = await rodarCarga(["--arquivo", caminho, ...ARGS, "--projeto", "dute-homolog"], {
      abrirBanco: () => {
        abriu = true;
        throw new Error("não deveria abrir o banco");
      },
      pastaDoRelatorio: relatorios,
      log: () => undefined,
    });
    assert.equal(abriu, false);
    assert.equal(resultado.ok, false);
    assert.equal(resultado.gravou, false);
    assert.match(resultado.erros.join(" | "), /linha 3: .*preço/);
    const relatorio = JSON.parse(readFileSync(String(resultado.relatorio), "utf8"));
    assert.deepEqual(relatorio.erros, resultado.erros);
  });

  it("--executar sem --projeto é recusado antes de ler o arquivo e de abrir o banco", async () => {
    let abriu = false;
    await assert.rejects(
      rodarCarga(["--arquivo", join(pasta, "nao-existe.csv"), ...ARGS, "--executar"], {
        abrirBanco: () => {
          abriu = true;
          throw new Error("não deveria abrir o banco");
        },
        pastaDoRelatorio: pasta,
        log: () => undefined,
      }),
      (error: unknown) => error instanceof ErroDaCarga && /--executar exige --projeto/.test(error.message),
    );
    assert.equal(abriu, false);
  });

  it("--executar em projeto sem o Comercial liberado é recusado sem abrir o banco", async () => {
    const caminho = arquivo("prod.csv", csv(...BASE));
    let abriu = false;
    await assert.rejects(
      rodarCarga(["--arquivo", caminho, ...ARGS, "--executar", "--projeto", "dute-prod"], {
        abrirBanco: () => {
          abriu = true;
          throw new Error("não deveria abrir o banco");
        },
        pastaDoRelatorio: pasta,
        log: () => undefined,
      }),
      (error: unknown) => error instanceof ErroDaCarga && /não está liberado/.test(error.message),
    );
    assert.equal(abriu, false);
  });
});

describe("gravação: tudo lido na transação, antes das escritas", () => {
  // Compilado em functions/comercial/lib/cargas/tabela.test.js.
  const fonte = readFileSync(fileURLToPath(new URL("../../src/cargas/tabela.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

  // ref.get(), query.get() e db.getAll() leem o banco fora da transação;
  // snapshot.get("campo") só lê um campo do que já foi lido.
  const LEITURA_FORA_DO_LEITOR = /leitorDireto|\.get\(\s*\)|getAll\(/;

  function corpo(assinatura: string): string {
    const inicio = fonte.indexOf(assinatura);
    assert.ok(inicio >= 0, `não achei ${assinatura} em tabela.ts`);
    const fim = fonte.indexOf("\n}\n", inicio);
    assert.ok(fim > inicio, `não achei o fim de ${assinatura}`);
    return fonte.slice(inicio, fim);
  }

  it("gravar relê o estado pela transação e confere os erros de novo antes de escrever", () => {
    const gravar = corpo("async function gravar(");
    const leitura = gravar.indexOf("lerEstado(db, leitorDaTransacao(transaction), plano)");
    assert.ok(leitura >= 0, "gravar precisa reler o estado com o leitor da transação");
    assert.doesNotMatch(gravar, LEITURA_FORA_DO_LEITOR, "gravar não lê fora da transação");
    assert.match(gravar, /conferido\.erros\.length > 0/, "gravar precisa parar nos erros da conferência feita na transação");
    const primeiraEscrita = gravar.search(/transaction\.(create|update|set|delete)\(|createComercialEvent\(/);
    assert.ok(primeiraEscrita > leitura, "a leitura do estado vem antes da primeira escrita");
  });

  it("lerEstado só lê pelo leitor que recebe", () => {
    assert.doesNotMatch(corpo("async function lerEstado("), LEITURA_FORA_DO_LEITOR);
  });
});
