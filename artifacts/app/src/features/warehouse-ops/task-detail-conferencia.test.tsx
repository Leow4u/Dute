// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  lineConfirmationKey,
  normalizeQueues,
  type AdvanceOperationPayload,
  type LineConfirmationMap,
  type QueueKey,
  type WarehouseTask,
} from "@/lib/warehouse-ops/model";
import { TaskDetailPanel } from "./task-detail";

/**
 * A conclusão da separação e da embalagem pelo painel (Pedidos › Tratar e a
 * bancada) leva a conferência de cada linha no formato que o
 * advanceWarehouseTask lê: picking_lines com o id da linha de separação e
 * packing_lines com o id do item do pedido, cada um com a quantidade. Antes,
 * ia num campo "lines" que o servidor descarta, e concluir pelo painel
 * sempre parava em "Informe a conferência física das linhas".
 */

const SEPARACAO: WarehouseTask = {
  id: "picking:pick_ord_1",
  reference: "pick_ord_1",
  title: "PED-0001",
  customer: "BTG Pactual",
  status: "in_progress",
  can_advance: true,
  items: [
    { id: "pl_1", sku_code: "BTG-000101", product_name: "Polo feminina PP", quantity: 4, expected_quantity: 4, picked_quantity: 0, status: "planned" },
    { id: "pl_2", sku_code: "BTG-000102", product_name: "Polo feminina P", quantity: 2, expected_quantity: 2, picked_quantity: 0, status: "planned" },
  ],
};

// Como a fila monta a embalagem: os itens do pedido, com o que foi separado.
const EMBALAGEM: WarehouseTask = {
  id: "packing:pack_ord_1",
  reference: "pack_ord_1",
  title: "PED-0001",
  customer: "BTG Pactual",
  status: "in_progress",
  can_advance: true,
  items: [
    { id: "oi_1", sku_code: "BTG-000101", product_name: "Polo feminina PP", quantity: 4, picked_quantity: 4 },
    { id: "oi_2", sku_code: "BTG-000102", product_name: "Polo feminina P", quantity: 2, picked_quantity: 2 },
  ],
};

const AVANCAR = "Avançar a tarefa";

function Painel({ tarefa, fila, onAdvance }: { tarefa: WarehouseTask; fila: QueueKey; onAdvance: (id: string, operation?: AdvanceOperationPayload) => void }) {
  const [confirmacoes, setConfirmacoes] = useState<LineConfirmationMap>({});
  const queue = normalizeQueues({ [fila]: { key: fila, name: fila, next_action: AVANCAR, tasks: [tarefa] } }).find((item) => item.key === fila)!;
  return (
    <TaskDetailPanel
      entry={{ task: queue.tasks[0]!, queue }}
      alerts={[]}
      lineConfirmations={confirmacoes}
      onLineConfirmationChange={(taskId, rowId, resolucao) =>
        setConfirmacoes((atual) => ({ ...atual, [lineConfirmationKey(taskId, rowId)]: resolucao }))
      }
      onAdvance={onAdvance}
      onOpenException={() => undefined}
    />
  );
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function abrir(tarefa: WarehouseTask, fila: QueueKey) {
  const onAdvance = vi.fn();
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient()}>
        <Painel tarefa={tarefa} fila={fila} onAdvance={onAdvance} />
      </QueryClientProvider>,
    ),
  );
  return onAdvance;
}

const botoes = (texto: string) => [...document.querySelectorAll("button")].filter((item) => item.textContent?.trim() === texto);

async function conferirTodasAsLinhas() {
  for (const ok of botoes("OK").filter((item) => item.getAttribute("aria-pressed") === "false")) {
    await act(async () => ok.click());
  }
}

async function avancar() {
  const [botao] = botoes(AVANCAR);
  if (!botao) throw new Error("Sem o botão de avançar");
  expect(botao.disabled).toBe(false);
  await act(async () => botao.click());
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
});

describe("a conferência que o painel manda ao concluir", () => {
  it("a separação leva picking_lines com a linha e a quantidade", async () => {
    const onAdvance = await abrir(SEPARACAO, "picking");
    await conferirTodasAsLinhas();
    await avancar();

    expect(onAdvance).toHaveBeenCalledTimes(1);
    const [id, operacao] = onAdvance.mock.calls[0]!;
    expect(id).toBe("picking:pick_ord_1");
    expect(operacao).toEqual({
      picking_lines: [
        { pick_line_id: "pl_1", qty_picked: 4, status: "confirmed" },
        { pick_line_id: "pl_2", qty_picked: 2, status: "confirmed" },
      ],
    });
  });

  it("a embalagem leva packing_lines com o item do pedido, o separado e o lacre", async () => {
    const onAdvance = await abrir(EMBALAGEM, "packing");
    await conferirTodasAsLinhas();
    const lacre = document.getElementById("packing:pack_ord_1-seal-code") as HTMLInputElement | null;
    if (!lacre) throw new Error("Sem o campo do lacre");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(lacre, "LAC-0042");
      lacre.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await avancar();

    const [, operacao] = onAdvance.mock.calls[0]!;
    expect(operacao).toMatchObject({
      seal_code: "LAC-0042",
      package_count: 1,
      packing_lines: [
        { order_item_id: "oi_1", qty_packed: 4, status: "confirmed" },
        { order_item_id: "oi_2", qty_packed: 2, status: "confirmed" },
      ],
    });
    expect(operacao).not.toHaveProperty("lines");
  });

  it("a linha marcada com falta vai com a marcação, e não como conferida", async () => {
    const onAdvance = await abrir(SEPARACAO, "picking");
    await act(async () => botoes("Falta")[0]!.click());
    await act(async () => botoes("OK")[1]!.click());
    await avancar();

    const [, operacao] = onAdvance.mock.calls[0]!;
    expect((operacao as { picking_lines: Array<{ status: string }> }).picking_lines.map((linha) => linha.status)).toEqual([
      "shortage",
      "confirmed",
    ]);
  });
});
