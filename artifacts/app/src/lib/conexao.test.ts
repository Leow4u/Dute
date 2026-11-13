import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CODIGO_SEM_CONEXAO,
  CODIGO_SEM_RESPOSTA,
  SEM_CONEXAO,
  SEM_RESPOSTA,
  SemConexao,
  SemResposta,
  callableSemResposta,
  corpoDaFalta,
  ehFaltaDeConexao,
  ehSemConexao,
  ehSemResposta,
  faltaDeAgora,
  firestoreSemConexao,
  horaDaLeitura,
  mensagemDaFalta,
  semConexaoNaLeitura,
} from "./conexao";

/**
 * Sem conexão na leitura e na ação (docs/plataforma/diagnostico-carregamento.md,
 * seção 9, decisões 1 e 2 do celular, de 06/11/2026).
 */

afterEach(() => vi.unstubAllGlobals());

/** O erro que o SDK do Firebase dá quando o fetch da callable nem chega a uma resposta (status 0). */
function semResposta() {
  return Object.assign(new Error("internal"), { code: "functions/internal" });
}

describe("a callable sem resposta", () => {
  it("é a falha de transporte do SDK, não a falha do servidor", () => {
    expect(callableSemResposta(semResposta())).toBe(true);
    // O servidor que falhou manda a mensagem dele: continua sendo do servidor.
    expect(callableSemResposta(Object.assign(new Error("INTERNAL"), { code: "functions/internal" }))).toBe(false);
    expect(callableSemResposta(Object.assign(new Error("A caixa mudou em outra tela."), { code: "functions/aborted" }))).toBe(false);
    expect(callableSemResposta(Object.assign(new Error("deadline-exceeded"), { code: "functions/deadline-exceeded" }))).toBe(false);
  });

  it("com o aparelho sem rede, qualquer falha é falta de conexão", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(callableSemResposta(Object.assign(new Error("INTERNAL"), { code: "functions/internal" }))).toBe(true);
  });
});

describe("as duas faltas (carregamento v2, parte 7a)", () => {
  it("com o aparelho sem rede, a falta é \"Sem conexão\"", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(faltaDeAgora()).toBeInstanceOf(SemConexao);
    expect(mensagemDaFalta()).toBe(SEM_CONEXAO);
    expect(corpoDaFalta()).toEqual({ message: SEM_CONEXAO, code: CODIGO_SEM_CONEXAO });
  });

  it("com o aparelho conectado, é o servidor sem resposta, nunca \"Sem conexão\"", () => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(faltaDeAgora()).toBeInstanceOf(SemResposta);
    expect(mensagemDaFalta()).toBe(SEM_RESPOSTA);
    expect(corpoDaFalta()).toEqual({ message: SEM_RESPOSTA, code: CODIGO_SEM_RESPOSTA });
    // A falta que já diz qual é fica com o código dela.
    expect(corpoDaFalta(new SemConexao())).toEqual({ message: SEM_CONEXAO, code: CODIGO_SEM_CONEXAO });
  });

  it("o erro que a tela recebe diz qual falta é, e as duas são falta de conexão", () => {
    const semResposta = [
      new SemResposta(),
      { status: 503, data: { message: SEM_RESPOSTA, code: CODIGO_SEM_RESPOSTA } },
      new Error(JSON.stringify({ message: SEM_RESPOSTA, code: CODIGO_SEM_RESPOSTA })),
      new Error(SEM_RESPOSTA),
    ];
    for (const erro of semResposta) {
      expect(ehSemResposta(erro)).toBe(true);
      expect(ehSemConexao(erro)).toBe(false);
      expect(ehFaltaDeConexao(erro)).toBe(true);
    }
    expect(ehFaltaDeConexao(new SemConexao())).toBe(true);
    expect(ehFaltaDeConexao(new Error("Falha interna no servidor. Tente novamente ou avise o time técnico."))).toBe(false);
    expect(ehFaltaDeConexao(null)).toBe(false);
  });
});

describe("a leitura do Firestore sem conexão", () => {
  it("é a que só achou o cache e a que o SDK recusou por estar sem rede", () => {
    expect(firestoreSemConexao(new SemConexao())).toBe(true);
    expect(firestoreSemConexao(new SemResposta())).toBe(true);
    expect(firestoreSemConexao(Object.assign(new Error("Failed to get document because the client is offline."), { code: "unavailable" }))).toBe(true);
    expect(firestoreSemConexao(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }))).toBe(false);
  });
});

describe("o erro que a tela recebe", () => {
  it("reconhece a falta de conexão em cada forma que ela chega", () => {
    expect(ehSemConexao(new SemConexao())).toBe(true);
    // O ApiError do cliente gerado, com o corpo da resposta 503.
    expect(ehSemConexao({ status: 503, data: { message: SEM_CONEXAO, code: CODIGO_SEM_CONEXAO } })).toBe(true);
    // Os fetchJson das telas: o corpo cru na mensagem, ou só a mensagem.
    expect(ehSemConexao(new Error(JSON.stringify({ message: SEM_CONEXAO, code: CODIGO_SEM_CONEXAO })))).toBe(true);
    expect(ehSemConexao(new Error(SEM_CONEXAO))).toBe(true);
  });

  it("não confunde com as outras falhas", () => {
    expect(ehSemConexao(new Error("Falha interna no servidor. Tente novamente ou avise o time técnico."))).toBe(false);
    expect(ehSemConexao(new Error(JSON.stringify({ message: "Sem permissão.", code: "permission-denied" })))).toBe(false);
    expect(ehSemConexao(new Error("{ quebrado"))).toBe(false);
    expect(ehSemConexao(null)).toBe(false);
    expect(ehSemConexao("Sem conexão")).toBe(false);
  });
});

describe("o que a tela mostra sem rede", () => {
  const semRede = new SemConexao();
  const lida = (dataUpdatedAt: number, error: unknown = null) => ({ data: { items: [] }, error, dataUpdatedAt });

  it("sem falta de conexão, nada muda", () => {
    expect(semConexaoNaLeitura(lida(1_000))).toBeNull();
    expect(semConexaoNaLeitura(lida(1_000, new Error("Sem permissão.")))).toBeNull();
  });

  it("com a lista lida, ela fica com a hora da leitura mais antiga sem rede", () => {
    expect(semConexaoNaLeitura(lida(2_000, semRede), lida(1_000, semRede), lida(500))).toEqual({ lidaEm: 1_000 });
  });

  it("o servidor sem resposta também guarda a lista e a hora (o aviso diz qual falta)", () => {
    expect(semConexaoNaLeitura(lida(2_000, new SemResposta()), lida(500))).toEqual({ lidaEm: 2_000 });
    expect(semConexaoNaLeitura({ data: undefined, error: new SemResposta(), dataUpdatedAt: 0 })).toEqual({ lidaEm: null });
  });

  it("sem nada lido, o aviso no lugar da lista", () => {
    expect(semConexaoNaLeitura({ data: undefined, error: semRede, dataUpdatedAt: 0 })).toEqual({ lidaEm: null });
    // Uma das leituras da tela ainda não veio: não há lista inteira para mostrar.
    expect(semConexaoNaLeitura(lida(1_000, semRede), { data: undefined, error: semRede, dataUpdatedAt: 0 })).toEqual({ lidaEm: null });
  });

  it("a hora é a do armazém, em 24 h", () => {
    expect(horaDaLeitura(Date.parse("2026-11-06T13:42:10Z"))).toBe("10:42");
    expect(horaDaLeitura(Date.parse("2026-11-06T23:05:00Z"))).toBe("20:05");
  });
});
