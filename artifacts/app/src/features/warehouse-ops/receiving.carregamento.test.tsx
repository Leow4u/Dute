// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeQueues, type WarehouseTask } from "@/lib/warehouse-ops/model";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

/**
 * A ficha da chegada por linha no carregamento v2 (parte 13c; diagnóstico,
 * 4.5). Antes: "Salvar conferência" e "Divergência" giravam o `RefreshCw`
 * num botão `disabled`, com o rótulo fixo; "Concluir entrada" continuava
 * clicável enquanto a conferência salvava (concluía com a contagem de antes);
 * e vincular o aviso só apagava as opções a 50%, `disabled`. Agora: o
 * BotaoDeAcao com o gerúndio, a entrada que espera a conferência (e o
 * contrário), e a opção tocada com a caixa, as outras ocupadas. Relógio
 * simulado. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ pendentes: [] as Array<{ caminho: string; responder: () => void }> }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { ReceivingTaskDetailCard } from "./receiving";

const CHEGADA: WarehouseTask = {
  id: "receiving:inb_1",
  reference: "inb_1",
  title: "NF 4521",
  status: "checking",
  can_advance: true,
  items: [
    { id: "l1", sku_code: "BTG-000001", expected_quantity: 10, received_qty: 10, conference_status: "ok" },
  ],
};

const entrada = () => {
  const fila = normalizeQueues({ receiving: { key: "receiving", name: "Recebimento", tasks: [CHEGADA] } }).find((item) => item.key === "receiving")!;
  return { task: fila.tasks[0]!, queue: fila };
};

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

async function pausa(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const botao = (rotulo: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => (item.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? item.textContent)?.trim() === rotulo,
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-13T13:42:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (entrada: RequestInfo | URL) =>
        new Promise<Response>((resolver) =>
          estado.pendentes.push({
            caminho: new URL(String(entrada), "http://localhost").pathname,
            responder: () => resolver(new Response(JSON.stringify({ ok: true }), { status: 200 })),
          }),
        ),
    ),
  );
  estado.pendentes.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  cliente.clear();
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function montar(props: Partial<ComponentProps<typeof ReceivingTaskDetailCard>> = {}) {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <div className="v3">
          <ReceivingTaskDetailCard entry={entrada()} alerts={[]} onAdvance={() => undefined} onOpenException={() => undefined} {...props} />
        </div>
      </QueryClientProvider>,
    );
  });
}

describe("a ficha da chegada por linha", () => {
  it("salvando a conferência, o botão mostra a espera com o foco nele, e a entrada espera", async () => {
    const concluir = vi.fn();
    await montar({ onAdvance: concluir });
    const salvar = botao("Salvar conferência")!;
    salvar.focus();
    await act(async () => salvar.click());
    await pausa(350);
    expect(estado.pendentes).toHaveLength(1);
    expect(estado.pendentes[0]!.caminho).toBe("/api/warehouse/receipts/inb_1/conference");
    expect(salvar.getAttribute("aria-busy")).toBe("true");
    expect(salvar.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Salvando…");
    expect(salvar.disabled).toBe(false);
    expect(document.activeElement).toBe(salvar);
    expect(container.querySelector(".animate-spin")).toBeNull();
    // A entrada espera a conferência: ocupada, não desabilitada, e o toque não conclui.
    const entradaBotao = botao("Concluir entrada")!;
    expect(entradaBotao.getAttribute("aria-disabled")).toBe("true");
    expect(entradaBotao.disabled).toBe(false);
    await act(async () => entradaBotao.click());
    expect(concluir).not.toHaveBeenCalled();
    await act(async () => estado.pendentes[0]!.responder());
    await pausa(700);
    expect(botao("Concluir entrada")!.getAttribute("aria-disabled")).toBeNull();
  });

  it("concluindo a entrada, o Concluir mostra a espera, e a conferência espera", async () => {
    await montar({ advancingTaskId: CHEGADA.id });
    const entradaBotao = botao("Concluir entrada")!;
    expect(entradaBotao.getAttribute("data-estado")).toBe("andamento");
    expect(entradaBotao.disabled).toBe(false);
    await pausa(350);
    expect(entradaBotao.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Concluindo…");
    expect(botao("Salvar conferência")!.getAttribute("aria-disabled")).toBe("true");
  });

  it("registrando a divergência, o botão mostra a espera sem o ícone girando", async () => {
    await montar({ registeringExceptionId: CHEGADA.id });
    await pausa(350);
    const divergencia = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) =>
      item.querySelector('.botao-acao-camada[data-camada="repouso"]')?.textContent?.includes("Divergência"),
    )!;
    expect(divergencia.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Registrando…");
    expect(divergencia.disabled).toBe(false);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("vinculando o aviso, a opção tocada mostra a caixa e as opções ficam ocupadas, não desabilitadas", async () => {
    const escolha = {
      editable: true,
      selectedId: "",
      options: [
        { id: "", title: "Sem aviso", detail: "" },
        { id: "creq_1", title: "Aviso de 13/11", detail: "NF 4521 · 10 un." },
      ],
    };
    await montar({ noticeChoice: escolha, linking: true, linkingId: "creq_1", onLinkNotice: () => undefined });
    const opcoes = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((item) => /Sem aviso|Aviso de 13\/11/.test(item.textContent ?? ""));
    expect(opcoes).toHaveLength(2);
    for (const opcao of opcoes) {
      expect(opcao.disabled).toBe(false);
      expect(opcao.getAttribute("aria-disabled")).toBe("true");
    }
    expect(opcoes[1]!.querySelector("[data-spinner]")).not.toBeNull();
    expect(opcoes[0]!.querySelector("[data-spinner]")).toBeNull();
    const html = container.innerHTML;
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    vi.useFakeTimers();
  });
});
