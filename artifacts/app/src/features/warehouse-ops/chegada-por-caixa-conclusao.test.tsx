// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { deleteApp } from "firebase/app";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskQueueEntry } from "@/lib/warehouse-ops/model";

const avisos = vi.hoisted(() => vi.fn());

vi.mock("@/lib/firebase", async () => {
  const { initializeApp } = await import("firebase/app");
  return { firebaseApp: initializeApp({ projectId: "demo-conclusao-caixa" }, "conclusao-caixa") };
});
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: "CLIENTE-TESTE" }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: avisos }) }));

import { firebaseApp } from "@/lib/firebase";
import { FichaDaChegadaPorCaixa } from "./chegada-por-caixa";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// A tela, o adaptador da callable e a serialização do Firebase são reais.
// Só o transporte é interceptado: nenhum recebimento ou serviço real é chamado.
const entrada = {
  queue: { key: "receiving", label: "Recebimento" },
  task: {
    id: "receiving:inb_teste",
    reference: "inb_teste",
    receipt_number: "AVL-TESTE",
    status: "checking",
    conference_mode: "per_box",
    boxes: [{
      code: "CX-000001", status: "committing", location_id: "A-01", unit_count: 4,
      length_m: 0.4, width_m: 0.3, height_m: 0.2, gross_weight_kg: 1,
      allow_tilt: false, allow_stacking: true, conference_revision: 2, refused_positions: [],
      lines: [{ inbound_item_id: "linha-1", line_number: 1, sku_code: "TESTE-000001", client_item_code: "POLO-M", product_name: "Polo M", size: "M", counted_qty: 4 }],
    }],
    items: [{ id: "linha-1", line_number: 1, sku_code: "TESTE-000001", client_item_code: "POLO-M", expected_quantity: 4, boxed_qty: 4 }],
  },
} as unknown as TaskQueueEntry;

let raiz: Root;
let container: HTMLDivElement;
let cliente: QueryClient;
let enviados: Array<{ data: Record<string, unknown> }>;

beforeEach(() => {
  avisos.mockClear();
  enviados = [];
  connectFunctionsEmulator(getFunctions(firebaseApp!, "southamerica-east1"), "127.0.0.1", 5001);
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe("http://127.0.0.1:5001/demo-conclusao-caixa/southamerica-east1/completeInboundBoxReceipt");
    enviados.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ data: { ok: true, status: "received" } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }));
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  cliente.clear();
  container.remove();
  vi.unstubAllGlobals();
});
afterAll(async () => deleteApp(firebaseApp!));

async function montar(entry: TaskQueueEntry) {
  await act(async () => raiz.render(
    <QueryClientProvider client={cliente}>
      <FichaDaChegadaPorCaixa entry={entry} onOpenException={() => undefined} />
    </QueryClientProvider>,
  ));
}

function concluir() {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Concluir entrada")!;
}

async function enviar() {
  await act(async () => concluir().click());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(enviados).toHaveLength(1);
    expect(avisos).toHaveBeenCalledWith(expect.objectContaining({ title: "Entrada concluída" }));
  });
}

describe("o pedido real de conclusão por caixa", () => {
  it("sem divergência, omite note no JSON da callable em vez de enviar null", async () => {
    await montar(entrada);
    expect(concluir().disabled).toBe(false);
    await enviar();
    expect(enviados[0]).toEqual({ data: {
      receipt_id: "inb_teste", customer_code: "CLIENTE-TESTE", expected_status: "checking",
      idempotency_key: expect.any(String),
    } });
  });

  it("com divergência, espera a justificativa e envia o texto sem espaços nas pontas", async () => {
    await montar({ ...entrada, task: { ...entrada.task, items: [{
      ...entrada.task.items![0], expected_quantity: 5,
      shortage: { qty: 1, boxed_qty: 4, expected_qty: 5, reason: "falta" },
    }] } });
    expect(concluir().disabled).toBe(true);
    expect(enviados).toEqual([]);
    await act(async () => {
      const campo = document.getElementById("justificativa-da-divergencia") as HTMLTextAreaElement;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(campo, "  Fornecedor enviará a peça faltante.  ");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(concluir().disabled).toBe(false);
    await enviar();
    expect(enviados[0]?.data.note).toBe("Fornecedor enviará a peça faltante.");
  });
});
