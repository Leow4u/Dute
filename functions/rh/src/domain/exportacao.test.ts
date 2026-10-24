import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CABECALHO_DOS_EXAMES,
  EXAME_NO_ESOCIAL,
  RESULTADO_NO_ESOCIAL,
  arquivoDaExportacao,
  celula,
  conteudoDaExportacao,
  cpfBr,
  entradaDaExportacao,
  entradaDoDownload,
  hashDoConteudo,
  idDaExportacao,
  type ColaboradorDaExportacao,
} from "./exportacao.js";
import { TIPOS_POR_CATEGORIA, type RegistroGravado } from "./ficha.js";

/**
 * A exportação para a contabilidade (parte 8.3): os exames da competência
 * com os códigos do S-2220, os colaboradores próprios, o hash que torna a
 * exportação idempotente e o CSV que a planilha em português abre. Dados
 * sintéticos.
 */

const ANA: ColaboradorDaExportacao = { id: "col_aaaaaaaaaaaaaaaa", nome: "Ana Souza", cpf: "52998224725", funcao: "Montadora", ativo: true };
const BRUNO: ColaboradorDaExportacao = { id: "col_bbbbbbbbbbbbbbbb", nome: "Bruno Lima", cpf: "11144477735", funcao: "Motorista", ativo: false };
const CARLA: ColaboradorDaExportacao = { id: "col_cccccccccccccccc", nome: "Carla Dias", cpf: "", funcao: "Ajudante", ativo: false };

let sequencia = 0;
function exame(colaborador: string, tipo: string, emitido_em: string, extra: Partial<RegistroGravado> = {}): RegistroGravado {
  sequencia += 1;
  return {
    id: `reg_${String(sequencia).padStart(16, "0")}`,
    colaborador_id: colaborador,
    categoria: "exame",
    tipo,
    descricao: null,
    emitido_em,
    vence_em: null,
    resultado: "apto",
    situacao: "vigente",
    substituido_por: null,
    arquivo: null,
    criado_em: "2026-10-01T12:00:00.000Z",
    edicao: 1,
    ...extra,
  };
}

describe("conteúdo da exportação", () => {
  it("os exames do mês, sem o arquivado, com o substituído e só de quem é próprio", () => {
    const registros = [
      exame(ANA.id, "periodico", "2026-10-05", { vence_em: "2027-10-05" }),
      exame(ANA.id, "admissional", "2026-09-30"),
      exame(ANA.id, "retorno_ao_trabalho", "2026-10-02", { situacao: "arquivado" }),
      exame(BRUNO.id, "demissional", "2026-10-02", { resultado: "inapto" }),
      exame(ANA.id, "outro", "2026-10-02", { situacao: "substituido", descricao: "Audiometria" }),
      exame("col_dddddddddddddddd", "periodico", "2026-10-03"),
      { ...exame(ANA.id, "nr35", "2026-10-04"), categoria: "treinamento" as const, resultado: null },
    ];
    const conteudo = conteudoDaExportacao("2026-10", [ANA, BRUNO, CARLA], registros);
    assert.deepEqual(
      conteudo.exames.map((linha) => [linha.data_do_aso, linha.nome, linha.tipo, linha.tp_exame_ocup, linha.res_aso, linha.descricao]),
      [
        ["2026-10-02", "Ana Souza", "outro", 4, 1, "Audiometria"],
        ["2026-10-02", "Bruno Lima", "demissional", 9, 2, null],
        ["2026-10-05", "Ana Souza", "periodico", 1, 1, null],
      ],
    );
    // A Ana está ativa; o Bruno, inativo, entra pelo demissional do mês; a Carla, inativa e sem exame, não.
    assert.deepEqual(conteudo.colaboradores.map((linha) => [linha.nome, linha.ativo]), [["Ana Souza", true], ["Bruno Lima", false]]);
  });

  it("todo tipo de exame e todo resultado tem o código do S-2220", () => {
    assert.deepEqual(Object.keys(EXAME_NO_ESOCIAL).sort(), [...TIPOS_POR_CATEGORIA.exame].sort());
    assert.deepEqual(EXAME_NO_ESOCIAL, { admissional: 0, periodico: 1, retorno_ao_trabalho: 2, mudanca_de_funcao: 3, outro: 4, demissional: 9 });
    assert.deepEqual(RESULTADO_NO_ESOCIAL, { apto: 1, apto_com_restricao: 1, inapto: 2 });
  });

  it("o hash não muda com a ordem da leitura e muda com o conteúdo", () => {
    const a = exame(ANA.id, "periodico", "2026-10-05");
    const b = exame(BRUNO.id, "demissional", "2026-10-06");
    const um = conteudoDaExportacao("2026-10", [ANA, BRUNO], [a, b]);
    const outro = conteudoDaExportacao("2026-10", [BRUNO, ANA], [b, a]);
    assert.equal(hashDoConteudo(um), hashDoConteudo(outro));
    const mudou = conteudoDaExportacao("2026-10", [ANA, BRUNO], [a, { ...b, resultado: "apto_com_restricao" }]);
    assert.notEqual(hashDoConteudo(um), hashDoConteudo(mudou));
  });
});

describe("entrada da exportação", () => {
  it("a competência é AAAA-MM, de 1900 ao mês de hoje", () => {
    assert.deepEqual(entradaDaExportacao({ idempotency_key: "k", competencia: "2026-10" }, "2026-10-24"), { idempotency_key: "k", competencia: "2026-10" });
    assert.throws(() => entradaDaExportacao({ idempotency_key: "k", competencia: "2026-11" }, "2026-10-24"), /ainda não começou/);
    assert.throws(() => entradaDaExportacao({ idempotency_key: "k", competencia: "1899-12" }, "2026-10-24"), /a partir de 1900/);
    assert.throws(() => entradaDaExportacao({ idempotency_key: "k", competencia: "2026-13" }, "2026-10-24"), /AAAA-MM/);
    assert.throws(() => entradaDaExportacao({ idempotency_key: "k", competencia: "2026-10", cpf: "1" }, "2026-10-24"), /HttpsError|cpf|não/i);
    assert.throws(() => entradaDaExportacao({ competencia: "2026-10" }, "2026-10-24"));
  });

  it("o download pede a versão e uma das duas planilhas", () => {
    assert.deepEqual(entradaDoDownload({ id: idDaExportacao("2026-10", 2), arquivo: "exames" }), { id: "exp_2026-10_v2", arquivo: "exames" });
    assert.throws(() => entradaDoDownload({ id: "exp_2026-10", arquivo: "exames" }));
    assert.throws(() => entradaDoDownload({ id: "exp_2026-10_v2", arquivo: "salarios" }));
  });
});

describe("planilhas", () => {
  const conteudo = conteudoDaExportacao(
    "2026-10",
    [ANA, BRUNO],
    [exame(ANA.id, "periodico", "2026-10-05", { vence_em: "2027-10-05" }), exame(BRUNO.id, "demissional", "2026-10-02", { resultado: "inapto" })],
  );

  it("os exames abrem na planilha em português: BOM, ponto e vírgula, CRLF e datas dd/mm/aaaa", () => {
    const arquivo = arquivoDaExportacao(conteudo, 3, "exames");
    assert.equal(arquivo.nome, "dute-rh-exames-2026-10-v3.csv");
    assert.ok(arquivo.conteudo.startsWith("﻿"));
    assert.deepEqual(arquivo.conteudo.slice(1).split("\r\n"), [
      CABECALHO_DOS_EXAMES.join(";"),
      "Bruno Lima;111.444.777-35;Motorista;Demissional;9;02/10/2026;Inapto;2;",
      "Ana Souza;529.982.247-25;Montadora;Periódico;1;05/10/2026;Apto;1;05/10/2027",
      "",
    ]);
  });

  it("os colaboradores com a situação", () => {
    const arquivo = arquivoDaExportacao(conteudo, 1, "colaboradores");
    assert.equal(arquivo.nome, "dute-rh-colaboradores-2026-10-v1.csv");
    assert.deepEqual(arquivo.conteudo.slice(1).split("\r\n"), [
      "Nome;CPF;Função;Situação",
      "Ana Souza;529.982.247-25;Montadora;Ativo",
      "Bruno Lima;111.444.777-35;Motorista;Inativo",
      "",
    ]);
  });

  it("a célula com separador, aspas ou quebra vai entre aspas, e a que parece fórmula ganha apóstrofo", () => {
    assert.equal(celula("Ana; Souza"), '"Ana; Souza"');
    assert.equal(celula('Ana "Aninha"'), '"Ana ""Aninha"""');
    assert.equal(celula("linha\nquebrada"), '"linha\nquebrada"');
    assert.equal(celula("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(celula("+55"), "'+55");
    assert.equal(celula("-1"), "'-1");
    assert.equal(celula("@SUM"), "'@SUM");
    assert.equal(celula("Ana Souza"), "Ana Souza");
  });

  it("o CPF com 11 dígitos sai com a máscara; o vazio continua vazio", () => {
    assert.equal(cpfBr("52998224725"), "529.982.247-25");
    assert.equal(cpfBr(""), "");
  });
});
