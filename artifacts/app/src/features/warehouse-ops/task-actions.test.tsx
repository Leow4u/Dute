// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O "Avançar" só volta depois da releitura (carregamento v2, parte 10; o
 * diagnóstico, seção 6, item 9, e 4.3: "o botão volta antes do refetch:
 * invalidate() não é aguardado"). Antes, assim que o servidor respondia, a
 * tarefa deixava de estar "Avançando" e o botão voltava ativo, ainda na etapa
 * antiga, até a bancada reler: um segundo toque mandava a mesma etapa de
 * novo. Agora a ação fica em andamento até a bancada voltar.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { useWarehouseTaskActions } from "./task-actions";

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;
let leiturasDaBancada = 0;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  leiturasDaBancada = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_entrada: RequestInfo | URL, init?: RequestInit) => {
      const avancar = (init?.method ?? "GET").toUpperCase() === "POST";
      await new Promise((pronto) => setTimeout(pronto, avancar ? 30 : 0));
      return new Response(JSON.stringify(avancar ? { ok: true } : { items: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  cliente.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** A bancada: a leitura do armazém (a primeira em 10 ms; as releituras em 2 s) e o Avançar da tarefa t1. */
function Bancada() {
  useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => {
      leiturasDaBancada += 1;
      const atraso = leiturasDaBancada === 1 ? 10 : 2_000;
      return new Promise((ok) => setTimeout(() => ok({ queues: {} }), atraso));
    },
  });
  const acoes = useWarehouseTaskActions({
    findEntry: (id) => ({ task: { id, status: "planned" }, queue: { key: "picking" } }) as never,
  });
  return (
    <button type="button" onClick={() => acoes.advanceTask.mutate({ id: "t1" })}>
      {acoes.advancingTaskId === "t1" ? "Avançando" : "Avançar"}
    </button>
  );
}

describe("o Avançar da bancada", () => {
  it("fica em Avançando até a releitura da bancada voltar, e não só até o servidor responder", async () => {
    raiz = createRoot(container);
    await act(async () => {
      raiz!.render(
        <QueryClientProvider client={cliente}>
          <Bancada />
        </QueryClientProvider>,
      );
    });
    await passar(50);
    const botao = container.querySelector("button")!;
    await act(async () => botao.click());
    await passar(10);
    expect(botao.textContent).toBe("Avançando");
    // O servidor respondeu (30 ms), e a bancada ainda relê.
    await passar(500);
    expect(leiturasDaBancada).toBe(2);
    expect(botao.textContent).toBe("Avançando");
    await passar(1_600);
    expect(botao.textContent).toBe("Avançar");
  });
});
