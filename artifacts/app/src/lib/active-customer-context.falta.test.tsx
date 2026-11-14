// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A lista dos clientes do seletor que não veio (carregamento v2, parte 13e;
 * diagnóstico, 9.4, "Ficam para depois"): sem rede, a leitura do comercial ia
 * ao Firestore fora do `lib/cloud-api.ts` e devolvia o cache como se fosse a
 * lista; e a falha de qualquer leitura virava o cliente legado, sem dizer
 * nada. Agora a leitura só do cache é falta de conexão, e o provedor diz que
 * falhou, com a nova tentativa. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ papel: "comercial", soNoCache: true, leiturasDoFirestore: 0 }));

vi.mock("./auth", () => ({ useAppUser: () => ({ user: { uid: "pessoa_1", publicMetadata: { role: estado.papel } } }) }));
vi.mock("./liberacao", async (original) => ({ ...(await original<typeof import("./liberacao")>()), AGENTE_LIBERADO: true }));
vi.mock("./firebase", () => ({ firestore: {}, firebaseAuth: null, firebaseApp: {} }));
vi.mock("firebase/firestore", async (original) => ({
  ...(await original<typeof import("firebase/firestore")>()),
  collection: vi.fn(() => ({})),
  getDocs: vi.fn(async () => {
    estado.leiturasDoFirestore += 1;
    return {
      docs: [{ id: "ACME", data: () => ({ name: "Acme Uniformes", stage: "cliente", operation_template: "uniformes" }) }],
      metadata: { fromCache: estado.soNoCache },
    };
  }),
}));

import { ActiveCustomerProvider, useActiveCustomer, type ActiveCustomerState } from "./active-customer-context";
import { ehFaltaDeConexao } from "./conexao";

let raiz: Root | null = null;
let container: HTMLDivElement;
let visto: ActiveCustomerState[] = [];

function Quem() {
  visto.push(useActiveCustomer());
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  visto = [];
  estado.papel = "comercial";
  estado.soNoCache = true;
  estado.leiturasDoFirestore = 0;
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const ultimo = () => visto[visto.length - 1]!;

async function montar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <ActiveCustomerProvider>
          <Quem />
        </ActiveCustomerProvider>
      </QueryClientProvider>,
    );
  });
}

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 100; volta += 1) {
    if (condicao()) return;
    await act(async () => new Promise((pronto) => setTimeout(pronto, 10)));
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

describe("a lista dos clientes do seletor que não veio", () => {
  it("o comercial sem rede: a leitura só do cache é falta de conexão, nunca a lista do cache", async () => {
    await montar();
    await esperar(() => !ultimo().isLoading, "a leitura acabar");
    expect(estado.leiturasDoFirestore).toBe(1);
    expect(ultimo().falhou).toBe(true);
    expect(ehFaltaDeConexao(ultimo().erro)).toBe(true);
    expect(ultimo().options.map((opcao) => opcao.code)).not.toContain("ACME");
  });

  it("com o servidor, o comercial lê a lista e não falha", async () => {
    estado.soNoCache = false;
    await montar();
    await esperar(() => !ultimo().isLoading, "a leitura acabar");
    expect(ultimo().falhou).toBe(false);
    expect(ultimo().options.map((opcao) => opcao.code)).toContain("ACME");
  });

  it("a equipe com a leitura que falhou: falhou, e tentar de novo lê outra vez", async () => {
    estado.papel = "admin";
    const leituras = vi.fn(async () => new Response(JSON.stringify({ message: "Falhou." }), { status: 500 }));
    vi.stubGlobal("fetch", leituras);
    await montar();
    await esperar(() => ultimo().falhou, "a falha chegar");
    expect(ultimo().isLoading).toBe(false);
    expect(leituras).toHaveBeenCalledTimes(1);
    await act(async () => ultimo().tentar());
    await esperar(() => leituras.mock.calls.length === 2, "a nova leitura");
  });

  it("a nova tentativa sem dado fica na falha, com tentando, e nunca volta a carregando (nem pisca o bloco)", async () => {
    estado.papel = "admin";
    let responder: () => void = () => undefined;
    const leituras = vi.fn(async () => {
      if (leituras.mock.calls.length > 1) await new Promise<void>((pronto) => (responder = pronto));
      return new Response(JSON.stringify({ message: "Falhou." }), { status: 500 });
    });
    vi.stubGlobal("fetch", leituras);
    await montar();
    await esperar(() => ultimo().falhou, "a falha chegar");
    const { tentar } = ultimo();
    visto = [];
    // A promessa do `tentar` acaba com a leitura, que aqui só responde no fim: a nova tentativa começa e o teste segue.
    await act(async () => {
      void tentar();
    });
    await esperar(() => leituras.mock.calls.length === 2, "a nova leitura");
    await esperar(() => visto.length > 0 && ultimo().tentando, "o tentando");
    expect(visto.some((quem) => quem.isLoading)).toBe(false);
    expect(ultimo().falhou).toBe(true);
    await act(async () => responder());
    await esperar(() => !ultimo().tentando, "a nova falha");
    expect(ultimo().falhou).toBe(true);
    expect(visto.some((quem) => quem.isLoading)).toBe(false);
  });
});
