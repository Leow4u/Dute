// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WarehouseTask } from "@/lib/warehouse-ops/model";

/**
 * A chave de idempotência por tentativa na exceção da tarefa (carregamento
 * v2, parte 13i; o diagnóstico, seção 9.1, item 11, e a necessidade 5 do
 * celular). Antes, o registro ia sem chave, e a rota completava com uma
 * nova a cada chamada: repetir depois de um resultado incerto registrava a
 * exceção duas vezes, e nada no servidor barrava (a guarda tem a revisão;
 * a exceção, não). Agora a repetição leva a mesma chave e o mesmo pedido,
 * mesmo com a tarefa relida (a primeira pode ter valido e mudado a
 * contagem); a chave é nova só quando o servidor recusa ou a nota muda.
 * Dados sintéticos.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { useWarehouseTaskActions } from "./task-actions";

type Corpo = Record<string, unknown>;

const enviados: Corpo[] = [];
/** O que as próximas chamadas respondem, na ordem; sem resposta na fila, dá certo. */
let respostas: Array<"incerto" | "recusa" | "ok"> = [];
/** A tarefa como a bancada a lê agora: a contagem de exceções muda depois da primeira tentativa. */
let tarefa: WarehouseTask;

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;
let registrar: (nota: string) => Promise<unknown> = async () => undefined;
let acoesDaBancada: ReturnType<typeof useWarehouseTaskActions>;

function Bancada() {
  const acoes = useWarehouseTaskActions({ findEntry: () => ({ task: tarefa, queue: { key: "picking" } }) as never });
  acoesDaBancada = acoes;
  registrar = (nota) => acoes.registerException.mutateAsync({ task: tarefa, queue: "picking", note: nota }).catch(() => undefined);
  return null;
}

beforeEach(async () => {
  enviados.length = 0;
  respostas = [];
  tarefa = { id: "picking:pick_1", reference: "pick_1", status: "in_progress", exception_count: 0 } as WarehouseTask;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      enviados.push(JSON.parse(String(init?.body ?? "{}")) as Corpo);
      const resposta = respostas.shift() ?? "ok";
      // A rota de /api/* devolve 503 quando a callable não teve resposta (o resultado é incerto) e 4xx quando o servidor recusou.
      if (resposta === "incerto") return new Response(JSON.stringify({ message: "Sem resposta do servidor.", code: "sem_resposta" }), { status: 503 });
      if (resposta === "recusa") return new Response(JSON.stringify({ message: "Tarefa operacional não encontrada.", code: "not-found" }), { status: 404 });
      return new Response(JSON.stringify({ ok: true, exception_id: "wex_1" }), { status: 201, headers: { "content-type": "application/json" } });
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <Bancada />
      </QueryClientProvider>,
    );
  });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  cliente.clear();
  vi.unstubAllGlobals();
});

async function tentar(nota: string) {
  await act(async () => {
    await registrar(nota);
  });
}

describe("a chave por tentativa na exceção da tarefa", () => {
  it("a repetição depois do resultado incerto leva a mesma chave e o mesmo pedido, mesmo com a tarefa relida", async () => {
    respostas = ["incerto"];
    await tentar("Caixa avariada na prateleira");
    // A bancada releu: a primeira pode ter valido, e a tarefa já conta a exceção.
    tarefa = { ...tarefa, exception_count: 1, blocked_reason: "Caixa avariada na prateleira" };
    await tentar("Caixa avariada na prateleira");
    expect(enviados).toHaveLength(2);
    expect(typeof enviados[0]!.idempotency_key).toBe("string");
    expect(String(enviados[0]!.idempotency_key)).not.toBe("");
    expect(enviados[1]).toEqual(enviados[0]);
  });

  it("depois do sucesso, a próxima exceção da mesma tarefa é outra tentativa", async () => {
    await tentar("Caixa avariada na prateleira");
    await tentar("Caixa avariada na prateleira");
    expect(enviados[1]!.idempotency_key).not.toBe(enviados[0]!.idempotency_key);
  });

  it("depois da recusa do servidor, ou com outra nota, a chave é nova", async () => {
    respostas = ["recusa", "incerto"];
    await tentar("Caixa avariada na prateleira");
    await tentar("Caixa avariada na prateleira");
    await tentar("Faltam 2 unidades");
    const chaves = enviados.map((corpo) => corpo.idempotency_key);
    expect(new Set(chaves).size).toBe(3);
    expect(enviados[2]!.note).toBe("Faltam 2 unidades");
  });
});

/**
 * A tentativa é do diálogo aberto (revisão da parte 13i), como a conclusão da
 * separação: fechado o diálogo, a próxima exceção é outro pedido. Antes, a
 * tentativa incerta ficava guardada pela tarefa, pela fila e pela nota até o
 * sucesso ou a recusa: a exceção nova da mesma tarefa, com a mesma nota (o
 * diálogo abre com o bloqueio atual), dias depois, saía com a chave e o corpo
 * da primeira, e o servidor devolvia o recibo dela sem gravar nada.
 */
describe("a tentativa da exceção é a do diálogo aberto", () => {
  async function registrarPeloDialogo(nota: string, { fechar = true } = {}) {
    act(() => acoesDaBancada.exception.openFor(tarefa));
    act(() => acoesDaBancada.exception.setNote(nota));
    await act(async () => {
      acoesDaBancada.exception.submit({ preventDefault: () => undefined } as never, { task: tarefa, queue: { key: "picking" } } as never);
      await new Promise((pronto) => setTimeout(pronto, 20));
    });
    if (fechar) act(() => acoesDaBancada.exception.onOpenChange(false));
  }

  it("com o diálogo aberto, a repetição depois do resultado incerto leva a mesma chave e o mesmo corpo", async () => {
    respostas = ["incerto"];
    await registrarPeloDialogo("Caixa avariada na prateleira", { fechar: false });
    tarefa = { ...tarefa, exception_count: 1, blocked_reason: "Caixa avariada na prateleira" };
    await act(async () => {
      acoesDaBancada.exception.submit({ preventDefault: () => undefined } as never, { task: tarefa, queue: { key: "picking" } } as never);
      await new Promise((pronto) => setTimeout(pronto, 20));
    });
    expect(enviados).toHaveLength(2);
    expect(enviados[1]).toEqual(enviados[0]);
  });

  it("fechado o diálogo depois do resultado incerto, a exceção seguinte da mesma tarefa, com a mesma nota, é outro pedido", async () => {
    respostas = ["incerto"];
    await registrarPeloDialogo("Caixa avariada na prateleira");
    // A bancada releu (a primeira valeu) e a coordenação resolveu a exceção; depois, outro problema na mesma tarefa.
    tarefa = { ...tarefa, exception_count: 0, blocked_reason: undefined };
    await registrarPeloDialogo("Caixa avariada na prateleira");
    expect(enviados).toHaveLength(2);
    expect(enviados[1]!.idempotency_key).not.toBe(enviados[0]!.idempotency_key);
  });
});
