// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskQueueEntry } from "@/lib/warehouse-ops/model";

/**
 * A bancada na mão de quem usa (parte 5b): iniciar a caixa, lançar pelo
 * código lido e pela quantidade, fechar com as medidas. Cada escrita manda a
 * revisão que a anterior devolveu, sem esperar a releitura da fila.
 */

const estado = vi.hoisted(() => ({
  chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }>,
  revisao: 2,
  avisos: [] as Array<{ title?: string; description?: string }>,
}));

vi.mock("@/lib/wms/caixas-do-recebimento", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/wms/caixas-do-recebimento")>();
  const registra = (nome: string, resultado: () => Record<string, unknown>) => async (dados: Record<string, unknown>) => {
    estado.chamadas.push({ nome, dados });
    return resultado();
  };
  return {
    ...original,
    iniciarCaixa: registra("iniciar", () => ({ ok: true, box: { code: "CX-000133" } })),
    lancarNaCaixa: registra("lancar", () => {
      estado.revisao += 1;
      return { ok: true, conference_revision: estado.revisao };
    }),
    fecharCaixa: registra("fechar", () => {
      estado.revisao += 1;
      return { ok: true, status: "reviewed", conference_revision: estado.revisao };
    }),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (aviso: { title?: string; description?: string }) => estado.avisos.push(aviso) }),
}));

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG Pactual" }),
}));

import { FichaDaChegadaPorCaixa } from "./chegada-por-caixa";

const RECEIPT = "inb_avulso_0d0e620b";

const entry = {
  queue: { key: "receiving", label: "Recebimento" },
  task: {
    id: `receiving:${RECEIPT}`,
    reference: RECEIPT,
    status: "checking",
    conference_mode: "per_box",
    receipt_number: "AVL-0D0E620B",
    boxes: [
      {
        code: "CX-000132",
        status: "counting",
        location_id: "",
        lines: [
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
        unit_count: 18,
        length_m: null,
        width_m: null,
        height_m: null,
        gross_weight_kg: null,
        allow_tilt: false,
        allow_stacking: false,
        conference_revision: 2,
        refused_positions: [],
      },
    ],
    items: [
      { id: `${RECEIPT}_01`, line_number: 1, client_item_code: "A.01.0806.004.XG", sku_code: "BTG-000086", expected_quantity: 41, boxed_qty: 0 },
      { id: `${RECEIPT}_02`, line_number: 2, client_item_code: "A.01.0806.004.GG", sku_code: "BTG-000087", expected_quantity: 30, boxed_qty: 18 },
    ],
  },
} as unknown as TaskQueueEntry;

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(async () => {
  estado.chamadas = [];
  estado.revisao = 2;
  estado.avisos = [];
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <FichaDaChegadaPorCaixa entry={entry} onOpenException={() => undefined} />
      </QueryClientProvider>,
    );
  });
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
  const achado = [...document.querySelectorAll("button")].find((elemento) => elemento.textContent?.trim() === texto);
  if (!achado) throw new Error(`Sem o botão ${texto}`);
  return achado as HTMLButtonElement;
}

async function clicar(texto: string) {
  await act(async () => {
    botao(texto).click();
  });
}

async function digitar(id: string, valor: string) {
  const elemento = document.getElementById(id) as HTMLInputElement | null;
  if (!elemento) throw new Error(`Sem o campo ${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(elemento, valor);
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const dados = (nome: string) => estado.chamadas.filter((chamada) => chamada.nome === nome).map((chamada) => chamada.dados);

describe("a bancada da chegada por caixa na mão de quem usa", () => {
  it("iniciar a caixa manda a chegada e o cliente ativo", async () => {
    await clicar("Iniciar caixa");
    await esperar(() => dados("iniciar").length === 1, "a caixa iniciada");
    expect(dados("iniciar")[0]).toMatchObject({ receipt_id: RECEIPT, customer_code: "BTG Pactual" });
    expect(String(dados("iniciar")[0]!.idempotency_key)).not.toBe("");
  });

  it("o código lido soma uma peça, a quantidade digitada acerta a linha e a revisão segue a escrita anterior", async () => {
    await digitar("caixa-busca", "a.01.0806.004.gg");
    await act(async () => {
      (document.getElementById("caixa-busca") as HTMLInputElement).form!.requestSubmit();
    });
    await esperar(() => dados("lancar").length === 1, "o código lançado");
    expect(dados("lancar")[0]).toMatchObject({
      receipt_id: RECEIPT,
      box_code: "CX-000132",
      expected_revision: 2,
      inbound_item_id: `${RECEIPT}_02`,
      counted_qty: 19,
    });

    await digitar(`caixa-qtd-${RECEIPT}_02`, "20");
    await act(async () => {
      document.getElementById(`caixa-qtd-${RECEIPT}_02`)!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await esperar(() => dados("lancar").length === 2, "a quantidade lançada");
    expect(dados("lancar")[1]).toMatchObject({ expected_revision: 3, counted_qty: 20 });
  });

  it("o código fora da NF não chama o servidor e avisa", async () => {
    await digitar("caixa-busca", "BTG-000999");
    await act(async () => {
      (document.getElementById("caixa-busca") as HTMLInputElement).form!.requestSubmit();
    });
    expect(dados("lancar")).toEqual([]);
    expect(estado.avisos.at(-1)).toMatchObject({ title: "Produto fora da NF desta chegada", description: "BTG-000999" });
  });

  it("fechar a caixa manda as medidas em metros, o peso em quilos e se pode virar ou empilhar", async () => {
    await clicar("Fechar caixa");
    expect(botao("Fechar caixa").disabled).toBe(true);
    await digitar("fechar-length_cm", "48");
    await digitar("fechar-width_cm", "38");
    await digitar("fechar-height_cm", "30");
    await digitar("fechar-weight_kg", "6,1");
    await act(async () => {
      (document.getElementById("fechar-tombar") as HTMLButtonElement).click();
    });
    await clicar("Fechar caixa");
    await esperar(() => dados("fechar").length === 1, "a caixa fechada");
    expect(dados("fechar")[0]).toMatchObject({
      receipt_id: RECEIPT,
      box_code: "CX-000132",
      expected_revision: 2,
      length_m: 0.48,
      width_m: 0.38,
      height_m: 0.3,
      gross_weight_kg: 6.1,
      allow_tilt: true,
      allow_stacking: false,
    });
  });
});
