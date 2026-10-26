import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CABECALHO_DOS_COLABORADORES,
  CABECALHO_DOS_COLABORADORES_ANTIGO,
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

const SEM_DATAS = { admissao: null, desligamento: null };
const ANA: ColaboradorDaExportacao = { id: "col_aaaaaaaaaaaaaaaa", nome: "Ana Souza", cpf: "52998224725", funcao: "Montadora", ativo: true, ...SEM_DATAS };
const BRUNO: ColaboradorDaExportacao = { id: "col_bbbbbbbbbbbbbbbb", nome: "Bruno Lima", cpf: "11144477735", funcao: "Motorista", ativo: false, ...SEM_DATAS };
const CARLA: ColaboradorDaExportacao = { id: "col_cccccccccccccccc", nome: "Carla Dias", cpf: "", funcao: "Ajudante", ativo: false, ...SEM_DATAS };

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
    // Sem as datas do vínculo, vale a regra de antes da parte 8.4: a Ana está ativa; o Bruno, inativo,
    // entra pelo demissional do mês; a Carla, inativa e sem exame, não.
    assert.deepEqual(conteudo.colaboradores.map((linha) => [linha.nome, linha.situacao_no_mes]), [["Ana Souza", "ativo"], ["Bruno Lima", "inativo"]]);
  });

  it("o exame lançado de novo para corrigir, com a mesma data do ASO, entra uma vez: o vigente do empate", () => {
    const linhas = (registros: RegistroGravado[]) => conteudoDaExportacao("2026-10", [ANA], registros).exames.map((linha) => [linha.data_do_aso, linha.tipo, linha.resultado]);
    // O periódico lançado apto e lançado de novo, inapto, com as mesmas datas: o novo fica vigente (ficha.ts).
    const corrigido = exame(ANA.id, "periodico", "2026-10-05", { vence_em: "2027-10-05", resultado: "inapto", criado_em: "2026-10-06T11:00:00.000Z" });
    const errado = exame(ANA.id, "periodico", "2026-10-05", { vence_em: "2027-10-05", situacao: "substituido", substituido_por: corrigido.id, criado_em: "2026-10-06T10:00:00.000Z" });
    // Antes, as duas linhas iam, e a contabilidade transmitia dois S-2220 do mesmo ASO.
    assert.deepEqual(linhas([errado, corrigido]), [["2026-10-05", "periodico", "inapto"]]);
    assert.deepEqual(linhas([corrigido, errado]), [["2026-10-05", "periodico", "inapto"]]);
    // Com um periódico mais novo, os dois ficam substituídos por ele, e o de outubro continua uma vez.
    const depois = { ...corrigido, situacao: "substituido" as const, substituido_por: "reg_novo" };
    assert.deepEqual(linhas([{ ...errado, substituido_por: "reg_novo" }, depois]), [["2026-10-05", "periodico", "inapto"]]);
    // Outra data no mês é outro exame, e o "outro" é um exame por registro.
    const outraData = exame(ANA.id, "periodico", "2026-10-20");
    const audiometria = exame(ANA.id, "outro", "2026-10-05", { descricao: "Audiometria" });
    const espirometria = exame(ANA.id, "outro", "2026-10-05", { descricao: "Espirometria" });
    assert.equal(conteudoDaExportacao("2026-10", [ANA], [errado, corrigido, outraData, audiometria, espirometria]).exames.length, 4);
  });

  it("o admissional e o periódico do mesmo dia são dois exames, mesmo no grupo ocupacional da ficha (pergunta 62)", () => {
    // Na ficha, o periódico substitui o admissional; na exportação, cada ASO é um S-2220.
    const periodico = exame(ANA.id, "periodico", "2026-10-05", { criado_em: "2026-10-06T11:00:00.000Z" });
    const admissional = exame(ANA.id, "admissional", "2026-10-05", { situacao: "substituido", substituido_por: periodico.id, criado_em: "2026-10-06T10:00:00.000Z" });
    const linhas = conteudoDaExportacao("2026-10", [ANA], [admissional, periodico]).exames.map((linha) => [linha.tipo, linha.tp_exame_ocup]);
    assert.deepEqual(linhas.sort(), [["admissional", 0], ["periodico", 1]]);
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

  it("o nome e a função sozinhos não mudam o hash; o CPF, as datas e os exames mudam (parte 8.4)", () => {
    const a = exame(ANA.id, "periodico", "2026-10-05");
    const hash = (colaboradores: ColaboradorDaExportacao[]) => hashDoConteudo(conteudoDaExportacao("2026-10", colaboradores, [a]));
    const antes = hash([ANA, BRUNO]);
    // A Ana renomeada passa para o fim da planilha, e o hash continua o mesmo.
    assert.equal(hash([{ ...ANA, nome: "Zélia Souza", funcao: "Líder de equipe" }, BRUNO]), antes);
    assert.notEqual(hash([{ ...ANA, cpf: "16899535009" }, BRUNO]), antes);
    assert.notEqual(hash([{ ...ANA, admissao: "2025-02-03" }, BRUNO]), antes);
    assert.notEqual(hashDoConteudo(conteudoDaExportacao("2026-10", [ANA, BRUNO], [{ ...a, vence_em: "2027-10-05" }])), antes);
  });

  it("com as datas do vínculo, entra quem tinha vínculo no mês, com a situação no mês (parte 8.4)", () => {
    const pessoa = (id: string, nome: string, ativo: boolean, admissao: string | null, desligamento: string | null = null): ColaboradorDaExportacao => ({
      id,
      nome,
      cpf: "",
      funcao: "Montador",
      ativo,
      admissao,
      desligamento,
    });
    const colaboradores = [
      pessoa("col_0000000000000001", "Admitida em setembro", true, "2026-09-08"),
      pessoa("col_0000000000000002", "Admitido em outubro", true, "2026-10-01"),
      pessoa("col_0000000000000003", "Desligado em setembro", false, "2024-03-02", "2026-09-19"),
      pessoa("col_0000000000000004", "Desligado em agosto", false, "2024-03-02", "2026-08-31"),
      pessoa("col_0000000000000005", "Desligamento marcado", true, "2024-06-10", "2026-10-31"),
      pessoa("col_0000000000000006", "Entrou e saiu", false, "2026-09-02", "2026-09-25"),
      pessoa("col_0000000000000007", "Sem admissão", true, null),
      // O cadastro inativo não tira do mês quem tinha vínculo nele: valem as datas.
      pessoa("col_0000000000000008", "Inativo com vínculo", false, "2020-01-15"),
      pessoa("col_0000000000000009", "Desligado no primeiro dia", false, "2020-01-15", "2026-09-01"),
    ];
    // O exame do mês não põe na planilha de colaboradores quem não tinha vínculo nele.
    const conteudo = conteudoDaExportacao("2026-09", colaboradores, [exame("col_0000000000000004", "demissional", "2026-09-03")]);
    assert.deepEqual(
      conteudo.colaboradores.map((linha) => [linha.nome, linha.admissao, linha.desligamento, linha.situacao_no_mes]),
      [
        ["Admitida em setembro", "2026-09-08", null, "admissao"],
        ["Desligado em setembro", "2024-03-02", "2026-09-19", "desligamento"],
        ["Desligado no primeiro dia", "2020-01-15", "2026-09-01", "desligamento"],
        ["Desligamento marcado", "2024-06-10", "2026-10-31", "ativo"],
        ["Entrou e saiu", "2026-09-02", "2026-09-25", "admissao_e_desligamento"],
        ["Inativo com vínculo", "2020-01-15", null, "ativo"],
        ["Sem admissão", null, null, "ativo"],
      ],
    );
    assert.deepEqual(conteudo.exames.map((linha) => linha.nome), ["Desligado em agosto"]);
    const arquivo = arquivoDaExportacao(conteudo, 2, "colaboradores");
    assert.deepEqual(arquivo.conteudo.slice(1).split("\r\n").slice(1, 3), [
      "Admitida em setembro;;Montador;08/09/2026;;Admissão no mês",
      "Desligado em setembro;;Montador;02/03/2024;19/09/2026;Desligamento no mês",
    ]);
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

  it("os colaboradores com as datas do vínculo e a situação no mês", () => {
    const arquivo = arquivoDaExportacao(conteudo, 1, "colaboradores");
    assert.equal(arquivo.nome, "dute-rh-colaboradores-2026-10-v1.csv");
    assert.deepEqual(arquivo.conteudo.slice(1).split("\r\n"), [
      "Nome;CPF;Função;Admissão;Desligamento;Situação no mês",
      "Ana Souza;529.982.247-25;Montadora;;;Ativo",
      "Bruno Lima;111.444.777-35;Motorista;;;Inativo",
      "",
    ]);
    assert.equal(CABECALHO_DOS_COLABORADORES.join(";"), "Nome;CPF;Função;Admissão;Desligamento;Situação no mês");
  });

  it("a versão de antes da parte 8.4 sai como foi gerada, com a situação do cadastro", () => {
    const antiga = {
      competencia: "2026-09",
      formato: 1 as const,
      exames: [],
      colaboradores: [
        { colaborador_id: ANA.id, nome: "Ana Souza", cpf: "52998224725", funcao: "Montadora", ativo: true },
        { colaborador_id: BRUNO.id, nome: "Bruno Lima", cpf: "11144477735", funcao: "Motorista", ativo: false },
      ],
    };
    const arquivo = arquivoDaExportacao(antiga, 1, "colaboradores");
    assert.deepEqual(arquivo.conteudo.slice(1).split("\r\n"), [
      CABECALHO_DOS_COLABORADORES_ANTIGO.join(";"),
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
