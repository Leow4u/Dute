import { describe, expect, it, vi } from "vitest";

const chamada = vi.hoisted(() => vi.fn(async (_dados: Record<string, unknown>) => ({ data: { id: "ced_0123456789abcdef", edicao: 4, created: false } })));
const nome = vi.hoisted(() => ({ atual: "" }));
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, callable: string) => {
    nome.atual = callable;
    return chamada;
  },
}));
vi.mock("../firebase", () => ({ firebaseApp: {} }));
vi.mock("../firebase-functions", () => ({ functionsDoApp: () => ({}) }));

import { detalheDaRecusa } from "./erro-da-callable";
import { CALLABLES_DOS_EVENTOS, arquivarEvento, cancelarEdicao, enviarEdicao, salvarEdicao } from "./eventos";

/**
 * As chamadas dos Eventos (eventos, parte 2): uma por callable do WMS.
 * Nenhum campo vazio vai: o SDK do Firebase manda o `undefined` como `null`,
 * e o servidor recusa `null` no campo só opcional (o defeito de 11 e
 * 12/11/2026 na separação). O `null` de propósito vai.
 */

const EDICAO = "ced_0123456789abcdef";

function enviado(): Record<string, unknown> {
  const dados = chamada.mock.lastCall?.[0];
  if (!dados) throw new Error("Nada foi enviado.");
  return dados;
}

describe("salvarEdicao", () => {
  it("chama saveEventEdition com o patch sem campo vazio: o endereço indefinido não vai", async () => {
    const resposta = await salvarEdicao({
      id: EDICAO,
      expected_edicao: 3,
      patch: {
        onde: { local: "Hotel Unique", endereco: undefined, contato: { nome: "Cristiane", telefone: undefined } },
        cronograma: [{ tipo: "evento", data: "2027-01-28", hora: "08:00", ate: null, observacao: undefined }],
      },
    });
    expect(nome.atual).toBe("saveEventEdition");
    expect(enviado()).toEqual({
      id: EDICAO,
      expected_edicao: 3,
      patch: {
        onde: { local: "Hotel Unique", contato: { nome: "Cristiane" } },
        cronograma: [{ tipo: "evento", data: "2027-01-28", hora: "08:00", ate: null }],
      },
    });
    expect(Object.keys((enviado().patch as { onde: object }).onde)).toEqual(["local", "contato"]);
    expect(resposta.edicao).toBe(4);
  });

  it("a criação vai com a chave e o nome, sem o patch que não veio", async () => {
    await salvarEdicao({ idempotency_key: "edicao-0001", name: "B2B Conference Necton", event_id: undefined });
    expect(nome.atual).toBe("saveEventEdition");
    expect(enviado()).toEqual({ idempotency_key: "edicao-0001", name: "B2B Conference Necton" });
  });

  it("a recusa leva a frase do servidor, o código da callable e o motivo", async () => {
    chamada.mockRejectedValueOnce(
      Object.assign(new Error("A edição mudou em outra aba"), { code: "functions/failed-precondition", details: { code: "EDICAO_MUDOU" } }),
    );
    const erro = await salvarEdicao({ id: EDICAO, expected_edicao: 3, patch: { observacoes: "Segunda aba" } }).catch((falha: unknown) => falha);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toBe("A edição mudou em outra aba");
    expect((erro as { code?: string }).code).toBe("failed-precondition");
    expect(detalheDaRecusa(erro)).toBe("EDICAO_MUDOU");
  });
});

describe("as quatro chamadas são as quatro callables da lista", () => {
  it("cada wrapper chama a callable do mesmo nome, e a lista não tem outra", async () => {
    const chamadas: Record<(typeof CALLABLES_DOS_EVENTOS)[number], () => Promise<unknown>> = {
      saveEventEdition: () => salvarEdicao({ id: EDICAO, expected_edicao: 1, patch: {} }),
      sendEventEdition: () => enviarEdicao({ id: EDICAO, expected_edicao: 4, idempotency_key: "enviar-0001" }),
      cancelEventEdition: () => cancelarEdicao({ id: EDICAO, idempotency_key: "cancelar-0001", motivo: undefined }),
      archiveClientEvent: () => arquivarEvento({ event_id: "cve_fedcba9876543210", idempotency_key: "arquivar-0001" }),
    };
    expect(Object.keys(chamadas).sort()).toEqual([...CALLABLES_DOS_EVENTOS].sort());
    for (const [callable, chamar] of Object.entries(chamadas)) {
      await chamar();
      expect(nome.atual).toBe(callable);
    }
    expect(enviado()).toEqual({ event_id: "cve_fedcba9876543210", idempotency_key: "arquivar-0001" });
  });

  it("o cancelamento sem motivo vai sem a chave", async () => {
    await cancelarEdicao({ id: EDICAO, idempotency_key: "cancelar-0002", motivo: undefined, customer_code: undefined });
    expect(nome.atual).toBe("cancelEventEdition");
    expect(enviado()).toEqual({ id: EDICAO, idempotency_key: "cancelar-0002" });
  });
});
