import { describe, expect, it, vi } from "vitest";

import { PRAZO_ESGOTADO, comPrazo, comPrazoSemAvanco, prazoEsgotado } from "./conexao";
import { mensagemDoErro as mensagemDoComercial } from "./comercial/api";
import { mensagemDoErro as mensagemDoFinanceiro } from "./financeiro/api";
import { mensagemDoErro as mensagemDaOperacao } from "./operacao/api";
import { mensagemDoErro as mensagemDoRh } from "./rh/api";

/**
 * O `deadline-exceeded` (a callable que passou do prazo, aos 70 s) aparecia
 * cru em inglês na tela. Ele ganha a mensagem própria em português, em toda
 * callable: a escrita pode ter valido, e a pessoa confere antes de repetir.
 */

const prazo = Object.assign(new Error("deadline-exceeded"), { code: "functions/deadline-exceeded" });

describe("o prazo sem resposta, em português", () => {
  it("a mensagem diz que o servidor não respondeu a tempo e pede para conferir", () => {
    expect(PRAZO_ESGOTADO).toBe("O servidor não respondeu a tempo. Confira antes de tentar de novo.");
    expect(prazoEsgotado(prazo)).toBe(true);
    expect(prazoEsgotado({ code: "deadline-exceeded" })).toBe(true);
    expect(prazoEsgotado(new Error("deadline-exceeded"))).toBe(false);
  });

  it("nas callables da Operação (e do WMS e do núcleo, que usam a mesma), do Comercial, do Financeiro e do RH", () => {
    for (const mensagem of [mensagemDaOperacao, mensagemDoComercial, mensagemDoFinanceiro, mensagemDoRh]) {
      expect(mensagem(prazo)).toBe(PRAZO_ESGOTADO);
      expect(mensagem(Object.assign(new Error("A OS mudou."), { code: "functions/failed-precondition" }))).toBe("A OS mudou.");
    }
  });

  it("a gravação direta no Firestore ganha o mesmo prazo: aos 70 s rejeita com o deadline-exceeded", async () => {
    vi.useFakeTimers();
    try {
      const nunca = new Promise<void>(() => undefined);
      const esperando = comPrazo(nunca, 70_000).catch((erro: unknown) => erro);
      await vi.advanceTimersByTimeAsync(69_999);
      let terminou = false;
      void esperando.then(() => (terminou = true));
      await Promise.resolve();
      expect(terminou).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const erro = await esperando;
      expect(prazoEsgotado(erro)).toBe(true);
      expect((erro as Error).message).toBe(PRAZO_ESGOTADO);
      await expect(comPrazo(Promise.resolve(7), 70_000)).resolves.toBe(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a gravação em lotes que anda não desiste: o prazo conta de cada avanço, não do começo", async () => {
    vi.useFakeTimers();
    try {
      let avancar: () => void = () => undefined;
      let terminar: () => void = () => undefined;
      const esperando = comPrazoSemAvanco<string>(
        (avancou) =>
          new Promise<string>((resolver) => {
            avancar = avancou;
            terminar = () => resolver("gravado");
          }),
        70_000,
      ).catch((erro: unknown) => erro);
      // Um lote a cada 40 s: passa dos 70 s do começo sem desistir.
      await vi.advanceTimersByTimeAsync(40_000);
      avancar();
      await vi.advanceTimersByTimeAsync(40_000);
      avancar();
      await vi.advanceTimersByTimeAsync(40_000);
      terminar();
      await expect(esperando).resolves.toBe("gravado");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a gravação que para de andar desiste 70 s depois do último avanço, com o deadline-exceeded", async () => {
    vi.useFakeTimers();
    try {
      let avancar: () => void = () => undefined;
      const esperando = comPrazoSemAvanco<void>(
        (avancou) => {
          avancar = avancou;
          return new Promise<void>(() => undefined);
        },
        70_000,
      ).catch((erro: unknown) => erro);
      await vi.advanceTimersByTimeAsync(30_000);
      avancar();
      await vi.advanceTimersByTimeAsync(69_999);
      let terminou = false;
      void esperando.then(() => (terminou = true));
      await Promise.resolve();
      expect(terminou).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(prazoEsgotado(await esperando)).toBe(true);
      // O avanço que chega depois da desistência não arma prazo nenhum.
      avancar();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
