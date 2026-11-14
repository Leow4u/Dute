import { describe, expect, it, vi } from "vitest";

import { SemConexao, SemResposta } from "@/lib/conexao";

import { criarTentativaDaEscrita } from "./tentativa-da-escrita";

/**
 * A tentativa de uma escrita de formulário (carregamento v2, parte 13k): a
 * repetição depois do resultado incerto leva a mesma chave e o mesmo corpo; a
 * chave é nova no sucesso, na recusa do servidor e com outro pedido. Só a
 * última tentativa fica. Dados sintéticos.
 */

type Corpo = { contagem: number; occurred_at: string; idempotency_key: string };

function cenario() {
  let numero = 0;
  const tentativa = criarTentativaDaEscrita(() => `chave-${(numero += 1)}`);
  const enviados: Corpo[] = [];
  let respostas: unknown[] = [];
  let agora = "2026-11-14T13:42:00.000Z";
  const mandar = (corpo: Corpo) => {
    enviados.push(corpo);
    const resposta = respostas.shift();
    return resposta === undefined ? Promise.resolve({ ok: true }) : Promise.reject(resposta);
  };
  const enviar = (contagem: number) =>
    tentativa.enviar({ contagem }, () => ({ contagem, occurred_at: agora }), mandar).catch(() => undefined);
  return {
    tentativa,
    enviados,
    enviar,
    responder: (lista: unknown[]) => {
      respostas = lista;
    },
    passarPara: (hora: string) => {
      agora = hora;
    },
  };
}

const recusa = () => Object.assign(new Error("Recusado."), { status: 409, code: "failed-precondition" });

describe("a tentativa da escrita", () => {
  it("depois do resultado incerto, a repetição leva a mesma chave e o corpo da primeira, com a hora dela", async () => {
    for (const incerto of [new SemConexao(), new SemResposta(), Object.assign(new Error("internal"), { status: 500 }), new Error("sem código")]) {
      const { enviados, enviar, responder, passarPara } = cenario();
      responder([incerto]);
      await enviar(10);
      passarPara("2026-11-14T13:47:00.000Z");
      await enviar(10);
      expect(enviados).toHaveLength(2);
      expect(enviados[1]).toBe(enviados[0]);
      expect(enviados[0]).toEqual({ contagem: 10, occurred_at: "2026-11-14T13:42:00.000Z", idempotency_key: "chave-1" });
    }
  });

  it("o prazo que acabou sem resposta também guarda a tentativa", async () => {
    const { enviados, enviar, responder } = cenario();
    responder([Object.assign(new Error("deadline"), { code: "functions/deadline-exceeded" })]);
    await enviar(10);
    await enviar(10);
    expect(enviados[1]!.idempotency_key).toBe("chave-1");
  });

  it("a recusa do servidor encerra a tentativa: o mesmo pedido vai com chave e corpo novos", async () => {
    const { enviados, enviar, responder, passarPara } = cenario();
    responder([recusa()]);
    await enviar(10);
    passarPara("2026-11-14T13:47:00.000Z");
    await enviar(10);
    expect(enviados.map((corpo) => corpo.idempotency_key)).toEqual(["chave-1", "chave-2"]);
    expect(enviados[1]!.occurred_at).toBe("2026-11-14T13:47:00.000Z");
  });

  it("o sucesso encerra a tentativa", async () => {
    const { enviados, enviar } = cenario();
    await enviar(10);
    await enviar(10);
    expect(enviados.map((corpo) => corpo.idempotency_key)).toEqual(["chave-1", "chave-2"]);
  });

  it("outro pedido é outra tentativa, e o que volta ao de antes também: só a última fica", async () => {
    const { enviados, enviar, responder } = cenario();
    responder([new SemConexao(), new SemConexao(), new SemConexao()]);
    await enviar(10);
    await enviar(12);
    await enviar(10);
    expect(enviados.map((corpo) => corpo.idempotency_key)).toEqual(["chave-1", "chave-2", "chave-3"]);
  });

  it("o corpo só é montado na primeira vez de cada tentativa", async () => {
    const tentativa = criarTentativaDaEscrita(() => "chave");
    const montar = vi.fn(() => ({ contagem: 10 }));
    const mandar = vi.fn(() => Promise.reject(new SemConexao()));
    await tentativa.enviar({ contagem: 10 }, montar, mandar).catch(() => undefined);
    await tentativa.enviar({ contagem: 10 }, montar, mandar).catch(() => undefined);
    expect(montar).toHaveBeenCalledTimes(1);
    expect(mandar).toHaveBeenCalledTimes(2);
  });

  it("esquecer faz do próximo envio outro pedido", async () => {
    const { tentativa, enviados, enviar, responder } = cenario();
    responder([new SemConexao()]);
    await enviar(10);
    tentativa.esquecer();
    await enviar(10);
    expect(enviados.map((corpo) => corpo.idempotency_key)).toEqual(["chave-1", "chave-2"]);
  });

  it("o que quebra na hora vira a rejeição, e a tentativa fica para a repetição", async () => {
    const tentativa = criarTentativaDaEscrita(() => "chave");
    const chaves: string[] = [];
    const quebra = (corpo: { idempotency_key: string }) => {
      chaves.push(corpo.idempotency_key);
      throw new Error("quebrou");
    };
    await expect(tentativa.enviar({ a: 1 }, () => ({ a: 1 }), quebra)).rejects.toThrow("quebrou");
    await expect(tentativa.enviar({ a: 1 }, () => ({ a: 1 }), quebra)).rejects.toThrow("quebrou");
    expect(chaves).toEqual(["chave", "chave"]);
  });
});
