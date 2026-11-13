// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { conexaoEm } from "@/test/conexao";

import { normalizeQueues, type WarehouseTask } from "@/lib/warehouse-ops/model";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { PutawayDetailSection, TaskDetailPanel } from "./task-detail";

/**
 * O painel da tarefa na migração do carregamento v2 (parte 13b; diagnóstico,
 * 4.5 e necessidades 5 e 10). Registrando a exceção, o botão da tarefa é o
 * BotaoDeAcao ("Registrando…"): ocupado sem `disabled` e sem o ícone antigo
 * girando. As posições da guarda esperam com a caixa e o rótulo
 * ("Carregando posições…") aos 300 ms, no lugar do texto seco "Carregando
 * posições.". Dados sintéticos.
 */

const guarda: WarehouseTask = {
  id: "putaway:put_1",
  reference: "put_1",
  title: "Guardar Display de mesa A5",
  sku_code: "TT-0019",
  customer: "TikTok",
  status: "planned",
  quantity: 50,
  source_location_id: "RECEBIMENTO",
  can_advance: true,
  items: [{ id: "pi_1", sku_code: "TT-0019", quantity: 50 }],
};

function painel(registrando: boolean) {
  const fila = normalizeQueues({ putaway: { key: "putaway", name: "Guarda", tasks: [guarda] } }).find((entrada) => entrada.key === "putaway")!;
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TaskDetailPanel
        entry={{ task: fila.tasks[0]!, queue: fila }}
        alerts={[]}
        lineConfirmations={{}}
        registeringExceptionId={registrando ? fila.tasks[0]!.id : undefined}
        onLineConfirmationChange={() => undefined}
        onAdvance={() => undefined}
        onOpenException={() => undefined}
      />
    </QueryClientProvider>,
  );
}

function botaoDe(html: string, rotulo: string): HTMLButtonElement {
  const documento = new DOMParser().parseFromString(html, "text/html");
  const achado = Array.from(documento.querySelectorAll("button")).find(
    (botao) => (botao.querySelector('[data-camada="repouso"]') ?? botao).textContent?.trim() === rotulo,
  );
  if (!achado) throw new Error(`Sem o botão ${rotulo}`);
  return achado as HTMLButtonElement;
}

describe("o painel da tarefa, registrando a exceção", () => {
  it("\"Registrar exceção\" é o BotaoDeAcao: em andamento, aria-disabled sem disabled, sem o ícone antigo girando", async () => {
    const html = painel(true);
    expect(html).not.toContain("animate-spin");
    const registrar = botaoDe(html, "Registrar exceção");
    expect(registrar.getAttribute("data-estado")).toBe("andamento");
    expect(registrar.getAttribute("aria-disabled")).toBe("true");
    expect(registrar.hasAttribute("disabled")).toBe(false);
    expect(textosForaDaLista(registrar.outerHTML, ["Registrar exceção", "Registrando…", "Conferir"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);

    const emRepouso = botaoDe(painel(false), "Registrar exceção");
    expect(emRepouso.getAttribute("data-estado")).toBe("repouso");
    expect(emRepouso.getAttribute("aria-disabled")).toBeNull();
  });
});

describe("a guarda, as posições", () => {
  it("lendo: a região espera a caixa e o rótulo aos 300 ms, nunca o texto seco \"Carregando posições.\"", () => {
    const html = renderToStaticMarkup(
      <PutawayDetailSection
        task={guarda}
        operation={{ source_location_id: "RECEBIMENTO", destination_location_id: "", location_id: "" }}
        query=""
        positions={[]}
        positionsStatus="loading"
        customerCode="TikTok"
        onOperationChange={() => undefined}
        onQueryChange={() => undefined}
      />,
    );
    expect(html).not.toContain("Carregando posições.");
    expect(html).toContain("data-carregando-na-regiao");
  });
});

describe("a guarda no painel, com as posições lendo", () => {
  it("um só \"Carregando posições…\", o da região aos 300 ms: o motivo do bloqueio não repete o texto seco desde 0 ms", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    const container = document.createElement("div");
    document.body.append(container);
    const fila = normalizeQueues({ putaway: { key: "putaway", name: "Guarda", tasks: [guarda] } }).find((entrada) => entrada.key === "putaway")!;
    const raiz = createRoot(container);
    const textos = () => {
      const copia = container.cloneNode(true) as HTMLElement;
      copia.querySelector("[data-anunciador]")?.remove();
      return (copia.textContent ?? "").replace(/\s+/g, " ");
    };
    try {
      await act(async () => {
        raiz.render(
          <ProvedorDaConexao value={conexaoEm("conectado")}>
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
              <Anunciador />
              <TaskDetailPanel
                entry={{ task: fila.tasks[0]!, queue: fila }}
                alerts={[]}
                lineConfirmations={{}}
                onLineConfirmationChange={() => undefined}
                onAdvance={() => undefined}
                onOpenException={() => undefined}
              />
            </QueryClientProvider>
          </ProvedorDaConexao>,
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect((textos().match(/Carregando posições…/g) ?? []).length).toBe(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect((textos().match(/Carregando posições…/g) ?? []).length).toBe(1);
      expect(Array.from(container.querySelectorAll("p.text-warning-soft-foreground")).map((no) => no.textContent)).toEqual([]);
    } finally {
      act(() => raiz.unmount());
      container.remove();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
