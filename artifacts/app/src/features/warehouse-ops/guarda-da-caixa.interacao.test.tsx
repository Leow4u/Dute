// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskQueueEntry } from "@/lib/warehouse-ops/model";

/**
 * A guarda da caixa na mão de quem guarda (parte 5f): concluir a guarda na
 * prateleira reservada, a recusa do servidor na própria guarda, "Não cabe
 * aqui" soltando a reserva e o destino da caixa sem prateleira.
 */

const estado = vi.hoisted(() => ({
  chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }>,
  avisos: [] as Array<{ title?: string; description?: string }>,
  recusaDoServidor: null as string | null,
}));

vi.mock("@/lib/wms/caixas-do-recebimento", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/wms/caixas-do-recebimento")>();
  const registra = (nome: string, resultado: () => Record<string, unknown>) => async (dados: Record<string, unknown>) => {
    estado.chamadas.push({ nome, dados });
    return resultado();
  };
  return {
    ...original,
    guardarCaixa: async (dados: Record<string, unknown>) => {
      estado.chamadas.push({ nome: "guardar", dados });
      if (estado.recusaDoServidor) throw new Error(estado.recusaDoServidor);
      return { ok: true, status: "stored" };
    },
    naoCabeNaPrateleira: registra("liberar", () => ({ ok: true, conference_revision: 10 })),
    sugerirPrateleira: registra("sugerir", () => ({
      ok: true,
      position: {
        code: "B-03",
        reason: "A mais próxima de B-02, que já tem o mesmo produto.",
        tier: 2,
        leftover_m: 0.9,
        sequence: 15,
        placement: { front_m: 0.48, depth_m: 0.38, height_m: 0.3, orientation: "length_width_height" },
      },
      alternatives: [],
      rejected: null,
      checked: 43,
    })),
    confirmarDestino: registra("confirmar", () => ({ ok: true, status: "committing", conference_revision: 10 })),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (aviso: { title?: string; description?: string }) => estado.avisos.push(aviso) }),
}));

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG Pactual" }),
}));

vi.mock("@/lib/warehouse-rows", () => ({
  fetchWarehouseRows: async () => [{ code: "B-02", aisle: "B", shelf: 2, customer_code: "BTG Pactual", status: "active" }],
}));

import { GuardaDaCaixa } from "./guarda-da-caixa";

const RECEIPT = "inb_avulso_0d0e620b";

function entrada(status: string, location_id: string) {
  return {
    queue: { key: "putaway", label: "Guarda" },
    task: {
      id: "put_box_cx131",
      reference: "put_box_cx131",
      title: "Guardar caixa CX-000131",
      status: "planned",
      box_code: "CX-000131",
      receipt_id: RECEIPT,
      receipt_number: "AVL-0D0E620B",
      invoice_number: "48.230",
      source_location_id: "RECEBIMENTO",
      box_lines: [
        {
          inbound_item_id: `${RECEIPT}_02`,
          line_number: 2,
          sku_code: "BTG-000087",
          client_item_code: "A.01.0806.004.GG",
          product_name: "POLO MASCULINO PIQUET PRETO GG",
          size: "GG",
          counted_qty: 18,
        },
      ],
      box: {
        code: "CX-000131",
        status,
        location_id,
        lines: [],
        unit_count: 18,
        length_m: 0.48,
        width_m: 0.38,
        height_m: 0.3,
        gross_weight_kg: 6.1,
        allow_tilt: false,
        allow_stacking: false,
        conference_revision: 9,
        refused_positions: [],
      },
    },
  } as unknown as TaskQueueEntry;
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function montar(entry: TaskQueueEntry) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <GuardaDaCaixa entry={entry} />
      </QueryClientProvider>,
    );
  });
}

beforeEach(() => {
  estado.chamadas = [];
  estado.avisos = [];
  estado.recusaDoServidor = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 50; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

function botao(texto: string) {
  // O texto inteiro, ou a camada atual do BotaoDeAcao (o confirmar dos diálogos, parte 13a).
  const achado = [...document.querySelectorAll("button")].find(
    (elemento) => elemento.textContent?.trim() === texto || elemento.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === texto,
  );
  if (!achado) throw new Error(`Sem o botão ${texto}`);
  return achado as HTMLButtonElement;
}

async function clicar(texto: string) {
  await act(async () => {
    botao(texto).click();
  });
}

const dados = (nome: string) => estado.chamadas.filter((chamada) => chamada.nome === nome).map((chamada) => chamada.dados);

describe("a guarda da caixa na mão de quem guarda", () => {
  it("Concluir guarda manda a caixa, a revisão e a prateleira reservada", async () => {
    await montar(entrada("committing", "B-02"));
    await esperar(() => Boolean(document.body.textContent?.includes("Rua B · prateleira 02")), "o endereço da prateleira");
    await clicar("Concluir guarda em B-02");
    await esperar(() => dados("guardar").length === 1, "a guarda");
    expect(dados("guardar")[0]).toMatchObject({
      receipt_id: RECEIPT,
      customer_code: "BTG Pactual",
      box_code: "CX-000131",
      expected_revision: 9,
      location_id: "B-02",
    });
    expect(String(dados("guardar")[0]!.idempotency_key)).not.toBe("");
    await esperar(() => estado.avisos.some((aviso) => aviso.title === "Caixa CX-000131 guardada em B-02"), "o aviso");
  });

  it("a recusa do servidor fica na própria guarda, não num aviso que some", async () => {
    estado.recusaDoServidor =
      "No RECEBIMENTO há 10 de POLO MASCULINO PIQUET PRETO GG (BTG-000087) livres, e a caixa CX-000131 tem 18: a coordenação acerta o saldo do RECEBIMENTO antes da guarda.";
    await montar(entrada("committing", "B-02"));
    await clicar("Concluir guarda em B-02");
    await esperar(() => Boolean(document.body.textContent?.includes("a coordenação acerta o saldo do RECEBIMENTO")), "a recusa na guarda");
    expect(estado.avisos).toEqual([]);
  });

  it("Não cabe aqui pede o motivo e solta a reserva com a revisão", async () => {
    await montar(entrada("committing", "B-02"));
    await clicar("Não cabe aqui");
    expect(document.body.textContent).toContain("Não cabe em B-02");
    // Sem motivo, travado: aria-disabled, nunca disabled (parte 13a).
    expect(botao("Liberar B-02").getAttribute("aria-disabled")).toBe("true");
    expect(botao("Liberar B-02").disabled).toBe(false);
    await act(async () => {
      const campo = document.getElementById("nao-cabe-motivo") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, "Outra caixa ocupando a frente");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clicar("Liberar B-02");
    await esperar(() => dados("liberar").length === 1, "a reserva solta");
    expect(dados("liberar")[0]).toMatchObject({
      receipt_id: RECEIPT,
      box_code: "CX-000131",
      expected_revision: 9,
      reason: "Outra caixa ocupando a frente",
    });
  });

  it("sem prateleira, a guarda pede a sugestão e confirma o destino, como a bancada", async () => {
    await montar(entrada("reviewed", ""));
    // Sem destino, o "Concluir guarda" espera com aria-disabled, nunca disabled (carregamento v2, parte 13c).
    expect(botao("Concluir guarda").getAttribute("aria-disabled")).toBe("true");
    expect(botao("Concluir guarda").disabled).toBe(false);
    await esperar(() => Boolean(document.body.textContent?.includes("Confirmar destino em B-03")), "a sugestão");
    expect(dados("sugerir")[0]).toEqual({ receipt_id: RECEIPT, customer_code: "BTG Pactual", box_code: "CX-000131" });
    await clicar("Confirmar destino em B-03");
    await esperar(() => dados("confirmar").length === 1, "o destino");
    expect(dados("confirmar")[0]).toMatchObject({
      receipt_id: RECEIPT,
      box_code: "CX-000131",
      expected_revision: 9,
      location_id: "B-03",
      suggestion: { position: "B-03", tier: 2 },
    });
  });
});
