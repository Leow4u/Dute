// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CARREGANDO } from "@/lib/carregando/tempo";
import {
  lineConfirmationKey,
  normalizeQueues,
  type LineConfirmationMap,
  type WarehouseTask,
} from "@/lib/warehouse-ops/model";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { TaskDetailPanel } from "./task-detail";

/**
 * O "Avançar" da bancada no relógio da espera (carregamento v2, parte 13i;
 * seção 3): é o `BotaoDeAcao`. O toque afunda o botão e o trava na hora, mas
 * nada aparece antes de 300 ms; aos 300 ms, a caixa e "Avançando…", que
 * ficam pelo menos 500 ms, até a bancada reler (parte 10); aos 10 s,
 * "Demorando mais que o normal". Antes, a caixa e "Avançando…" entravam em
 * 0 ms e saíam com a resposta. Dados sintéticos.
 */

const AVANCAR = "Avançar a tarefa";

const SEPARACAO: WarehouseTask = {
  id: "picking:pick_ord_1",
  reference: "pick_ord_1",
  title: "PED-0001",
  customer: "BTG Pactual",
  status: "in_progress",
  can_advance: true,
  items: [{ id: "pl_1", sku_code: "BTG-000101", product_name: "Polo feminina PP", quantity: 4, expected_quantity: 4, picked_quantity: 0, status: "planned" }],
};

const fila = normalizeQueues({ picking: { key: "picking", name: "picking", next_action: AVANCAR, tasks: [SEPARACAO] } }).find((item) => item.key === "picking")!;

let avancar: (ligado: boolean) => void = () => undefined;
const onAdvance = vi.fn();

function Painel() {
  const [avancando, setAvancando] = useState(false);
  avancar = setAvancando;
  const confirmacoes: LineConfirmationMap = { [lineConfirmationKey(SEPARACAO.id, "pl_1")]: "confirmed" };
  return (
    <TaskDetailPanel
      entry={{ task: fila.tasks[0]!, queue: fila }}
      alerts={[]}
      lineConfirmations={confirmacoes}
      onLineConfirmationChange={() => undefined}
      onAdvance={onAdvance}
      onOpenException={() => undefined}
      advancingTaskId={avancando ? SEPARACAO.id : undefined}
    />
  );
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** O botão de avançar: pelo rótulo em repouso (o botão de ação) ou pelo texto que ele tem agora. */
function botao(): HTMLButtonElement {
  const achado = Array.from(container!.querySelectorAll("button")).find((item) =>
    [AVANCAR, "Avançando…"].includes((item.querySelector('[data-camada="repouso"]')?.textContent ?? item.textContent ?? "").trim()),
  );
  if (!achado) throw new Error("sem o botão de avançar");
  return achado;
}

/** O rótulo que está na tela: a camada atual do botão de ação, ou o texto do botão comum. */
function rotuloAtual(alvo: HTMLButtonElement): string {
  return (alvo.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? alvo.textContent ?? "").trim();
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onAdvance.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient()}>
        <Painel />
      </QueryClientProvider>,
    ),
  );
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("o Avançar da bancada no relógio da espera", () => {
  it("nada antes de 300 ms; a caixa e Avançando… aos 300 ms, por pelo menos 500 ms", async () => {
    await act(async () => botao().click());
    expect(onAdvance).toHaveBeenCalledTimes(1);
    await act(async () => avancar(true));

    // 0 ms: travado (aria-disabled, sem disabled) e afundado, mas ainda "Avançar a tarefa", sem a caixa.
    const alvo = botao();
    expect(alvo.getAttribute("aria-disabled")).toBe("true");
    expect(alvo.hasAttribute("disabled")).toBe(false);
    expect(rotuloAtual(alvo)).toBe(AVANCAR);
    expect(alvo.querySelector("[data-spinner]")).toBeNull();
    // O segundo toque não avança de novo.
    await act(async () => alvo.click());
    expect(onAdvance).toHaveBeenCalledTimes(1);

    await passar(CARREGANDO.atrasoMs - 10);
    expect(rotuloAtual(botao())).toBe(AVANCAR);
    expect(botao().querySelector("[data-spinner]")).toBeNull();

    await passar(10);
    expect(rotuloAtual(botao())).toBe("Avançando…");
    expect(botao().getAttribute("aria-busy")).toBe("true");
    expect(botao().querySelector("[data-spinner]")).not.toBeNull();

    // A bancada releu 50 ms depois: o "Avançando…" fica até completar 500 ms na tela.
    await passar(50);
    await act(async () => avancar(false));
    expect(rotuloAtual(botao())).toBe("Avançando…");
    await passar(CARREGANDO.minimoMs - 50 - 10);
    expect(rotuloAtual(botao())).toBe("Avançando…");
    await vi.waitFor(
      async () => {
        await passar(10);
        expect(rotuloAtual(botao())).toBe(AVANCAR);
      },
      { timeout: 3_000 },
    );
    expect(botao().getAttribute("aria-disabled")).toBeNull();
  });

  it("a resposta antes de 300 ms não pisca nada", async () => {
    await act(async () => botao().click());
    await act(async () => avancar(true));
    const vistos = new Set<string>([rotuloAtual(botao())]);
    for (let feito = 0; feito < CARREGANDO.atrasoMs - 100; feito += 50) {
      await passar(50);
      vistos.add(rotuloAtual(botao()));
    }
    await act(async () => avancar(false));
    for (let feito = 0; feito < CARREGANDO.minimoMs + CARREGANDO.atrasoMs; feito += 50) {
      await passar(50);
      vistos.add(rotuloAtual(botao()));
    }
    expect([...vistos]).toEqual([AVANCAR]);
    expect(botao().querySelector("[data-spinner]")).toBeNull();
  });

  it("aos 10 s, Demorando mais que o normal, com o relógio; o axe não acusa nada", async () => {
    await act(async () => botao().click());
    await act(async () => avancar(true));
    await passar(CARREGANDO.demoraMs - 10);
    expect(container!.textContent).not.toContain("Demorando mais que o normal");
    await passar(2_010);
    expect(container!.textContent).toContain("Demorando mais que o normal");
    expect(container!.textContent).toContain("0:12");
    expect(rotuloAtual(botao())).toBe("Avançando…");
    // Na escrita, sem "Tentar de novo": repetir duplicaria.
    expect(container!.textContent).not.toContain("Tentar de novo");
    const html = container!.innerHTML;
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
