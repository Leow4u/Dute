import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { chamar } = vi.hoisted(() => ({ chamar: vi.fn() }));

vi.mock("../firebase", () => ({ firebaseApp: {} }));
vi.mock("../firebase-functions", () => ({ functionsDoApp: () => ({}) }));
vi.mock("firebase/functions", () => ({ httpsCallable: () => chamar }));

import { SEM_CONEXAO, SEM_RESPOSTA, ehFaltaDeConexao } from "../conexao";
import { chamarFinanceiro } from "../financeiro/api";
import { chamarRh } from "./api";

/**
 * As leituras do RH e do Financeiro pelas callables sem rede (carregamento
 * v2, momento 8; revisão da parte 13g): o erro diz a falta ("Sem
 * conexão."), e não "Falha interna no servidor", para a leitura que falhou
 * por ela ser relida sozinha quando a rede volta (lib/carregando/estado-da-
 * conexao.ts), como as do WMS. Antes, Pessoas, Exportação e Emissões ficavam
 * em "Não foi possível carregar" depois de a rede voltar, até o toque.
 */

beforeEach(() => {
  chamar.mockReset();
  vi.stubGlobal("navigator", { onLine: true });
});

afterEach(() => vi.unstubAllGlobals());

const chamadas = [
  ["RH", () => chamarRh("getRhPanel", {})],
  ["Financeiro", () => chamarFinanceiro("listNfEmissions", {})],
] as const;

describe.each(chamadas)("%s: a leitura sem rede", (_modulo, ler) => {
  it("com o aparelho sem rede, o erro é a falta de conexão", async () => {
    chamar.mockImplementation(async () => {
      vi.stubGlobal("navigator", { onLine: false });
      throw Object.assign(new Error("internal"), { code: "functions/internal" });
    });
    const erro = await ler().catch((falha: unknown) => falha);
    expect((erro as Error).message).toBe(SEM_CONEXAO);
    expect(ehFaltaDeConexao(erro)).toBe(true);
  });

  it("conectado, a chamada sem resposta é o servidor sem resposta", async () => {
    chamar.mockRejectedValue(Object.assign(new Error("internal"), { code: "functions/internal" }));
    const erro = await ler().catch((falha: unknown) => falha);
    expect((erro as Error).message).toBe(SEM_RESPOSTA);
    expect(ehFaltaDeConexao(erro)).toBe(true);
  });

  it("a falha do servidor continua sendo do servidor", async () => {
    chamar.mockRejectedValue(Object.assign(new Error("Sem permissão para o RH."), { code: "functions/permission-denied" }));
    const erro = await ler().catch((falha: unknown) => falha);
    expect((erro as Error).message).toBe("Sem permissão para o RH.");
    expect(ehFaltaDeConexao(erro)).toBe(false);
  });
});
