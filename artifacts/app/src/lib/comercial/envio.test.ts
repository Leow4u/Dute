import { describe, expect, it } from "vitest";

import { ROTULO_DO_ENVIO, enviarEAbrirDocumento, envioDaFicha } from "./envio";

/**
 * O envio ao cliente (parte 12a): grava no servidor (advanceQuote send ou
 * approve_and_send) e SÓ ENTÃO abre o documento para imprimir ou salvar o
 * PDF. Se a gravação falha, o documento não abre.
 */

describe("enviar e abrir o documento", () => {
  it("grava antes de abrir a impressão, com a situação e a edição que a tela viu", async () => {
    const passos: string[] = [];
    let payloadEnviado: Record<string, unknown> | null = null;
    let liberar: (valor: { rv: number; status: string; edicao: number }) => void = () => undefined;
    const gravacao = new Promise<{ rv: number; status: string; edicao: number }>((resolve) => {
      liberar = resolve;
    });
    const envio = enviarEAbrirDocumento({
      acao: "send",
      orcamento: { numero: "10045", status: "aprovado", edicao: 5 },
      chave: "chave-1",
      chamar: (payload) => {
        passos.push("gravar");
        payloadEnviado = payload;
        return gravacao;
      },
      abrir: (href) => passos.push(`abrir ${href}`),
    });
    // Enquanto o servidor não responde, nada abre.
    await Promise.resolve();
    expect(passos).toEqual(["gravar"]);
    liberar({ rv: 1, status: "enviado", edicao: 5 });
    await envio;
    // A RV é a que o servidor enviou (e congelou); a impressão abre sozinha nela.
    expect(passos).toEqual(["gravar", "abrir /comercial/orcamento/documento?numero=10045&rv=1&imprimir=1"]);
    expect(payloadEnviado).toEqual({
      action: "send",
      request_id: "chave-1",
      numero: "10045",
      expected_status: "aprovado",
      expected_edicao: 5,
    });
  });

  it("recusa do servidor (o orçamento mudou): o erro sobe e o documento não abre", async () => {
    const abertos: string[] = [];
    const recusa = Object.assign(new Error("O orçamento 10045 mudou: está em rascunho, não aprovado. Abra de novo."), {
      codigo: "failed-precondition",
    });
    await expect(
      enviarEAbrirDocumento({
        acao: "send",
        orcamento: { numero: "10045", status: "aprovado", edicao: 5 },
        chave: "chave-2",
        chamar: () => Promise.reject(recusa),
        abrir: (href) => abertos.push(href),
      }),
    ).rejects.toBe(recusa);
    expect(abertos).toEqual([]);
  });

  it("aprovar e enviar vai como approve_and_send, do para aprovar", async () => {
    let acao: unknown = null;
    await enviarEAbrirDocumento({
      acao: "approve_and_send",
      orcamento: { numero: "10045", status: "para_aprovar", edicao: 3 },
      chave: "chave-3",
      chamar: async (payload) => {
        acao = [payload.action, payload.expected_status, payload.expected_edicao];
        return { rv: 0, status: "enviado", edicao: 3 };
      },
      abrir: () => undefined,
    });
    expect(acao).toEqual(["approve_and_send", "para_aprovar", 3]);
    expect(ROTULO_DO_ENVIO).toEqual({ send: "Enviar", approve_and_send: "Aprovar e enviar" });
  });
});

describe("o envio na ficha da fila", () => {
  it("Enviar no aprovado, para qualquer papel do Comercial; Aprovar e enviar só para o owner, no para aprovar", () => {
    for (const role of ["owner", "admin", "comercial"]) {
      expect(envioDaFicha({ status: "aprovado", etapa: "para_enviar" }, role), role).toBe("send");
    }
    expect(envioDaFicha({ status: "para_aprovar", etapa: "para_aprovar" }, "owner")).toBe("approve_and_send");
    expect(envioDaFicha({ status: "para_aprovar", etapa: "para_aprovar" }, "admin")).toBeNull();
    expect(envioDaFicha({ status: "para_aprovar", etapa: "para_aprovar" }, "comercial")).toBeNull();
  });

  it("rascunho, enviado e a demanda perdida não têm envio", () => {
    expect(envioDaFicha({ status: "rascunho", etapa: "em_montagem" }, "owner")).toBeNull();
    expect(envioDaFicha({ status: "enviado", etapa: "aguardando_cliente" }, "owner")).toBeNull();
    expect(envioDaFicha({ status: "aprovado", etapa: "perdida" }, "owner")).toBeNull();
  });
});
