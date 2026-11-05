// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

const dados = vi.hoisted(() => ({ overview: {} as Record<string, unknown> }));
vi.mock("./shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shared")>()),
  ClientDataBoundary: ({
    children,
  }: {
    children: (overview: Record<string, unknown>) => ReactNode;
  }) => children(dados.overview),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ClientePedidos } from "./pedidos";

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
});

async function montar(status: string, operationalStatus?: string) {
  dados.overview = {
    request_history: [
      {
        id: "creq_etapas",
        type: "retirada",
        request_number: "PED-0001",
        title: "Uniformes",
        status,
        created_at: "2026-11-04T12:00:00Z",
        updated_at: "2026-11-05T12:00:00Z",
        items: [
          { client_item_code: "POLO-M", product_name: "Polo M", quantity: 3 },
        ],
      },
    ],
    order_tracking: operationalStatus
      ? [{ customer_request_id: "creq_etapas", status: operationalStatus }]
      : [],
    document_history: [],
  };
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ClientePedidos />
      </QueryClientProvider>,
    ),
  );
}

function etapas() {
  const lista = container.querySelector<HTMLOListElement>("ol[aria-label]");
  expect(lista, "régua das etapas do pedido").not.toBeNull();
  return lista!;
}

async function abrirDetalhe() {
  const abrir = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.includes("PED-0001"));
  expect(abrir, "abrir o pedido da lista").toBeDefined();
  await act(async () => abrir!.click());
  expect(container.querySelector("h1")?.textContent).toContain("PED-0001");
}

function conferirEtapas(nomes: readonly string[], atual: string | null) {
  const lista = etapas();
  expect(
    [...lista.children].map((item) => item.getAttribute("aria-label")),
  ).toEqual(nomes);
  expect(lista.querySelectorAll('[aria-current="step"]')).toHaveLength(
    atual ? 1 : 0,
  );
  expect(
    lista.querySelector('[aria-current="step"]')?.getAttribute("aria-label") ??
      null,
  ).toBe(atual);
  expect(
    textosForaDaLista(lista.outerHTML, [
      "Pedido feito",
      "Em separação",
      "Saiu para entrega",
      "Entregue",
      "04/11, 09:00",
    ]),
  ).toEqual([]);
}

const ATIVOS = [
  {
    etapa: "placed",
    status: "open",
    tracking: undefined,
    atual: "Pedido feito: etapa atual",
    nomes: [
      "Pedido feito: etapa atual",
      "Em separação: pendente",
      "Saiu para entrega: pendente",
      "Entregue: pendente",
    ],
  },
  {
    etapa: "confirmed",
    status: "approved",
    tracking: "pending",
    atual: "Pedido feito: etapa atual",
    nomes: [
      "Pedido feito: etapa atual",
      "Em separação: pendente",
      "Saiu para entrega: pendente",
      "Entregue: pendente",
    ],
  },
  {
    etapa: "picking",
    status: "approved",
    tracking: "separating",
    atual: "Em separação: etapa atual",
    nomes: [
      "Pedido feito: concluída",
      "Em separação: etapa atual",
      "Saiu para entrega: pendente",
      "Entregue: pendente",
    ],
  },
  {
    etapa: "dispatched",
    status: "approved",
    tracking: "dispatched",
    atual: "Saiu para entrega: etapa atual",
    nomes: [
      "Pedido feito: concluída",
      "Em separação: concluída",
      "Saiu para entrega: etapa atual",
      "Entregue: pendente",
    ],
  },
] as const;

describe("as etapas do pedido do portal", () => {
  it.each(ATIVOS)(
    "$etapa identifica a etapa atual e as concluídas na lista e no detalhe",
    async ({ status, tracking, nomes, atual }) => {
      await montar(status, tracking);
      conferirEtapas(nomes, atual);
      expect(etapas().getAttribute("aria-label")).toBe(
        `Etapa: ${atual.replace(": etapa atual", "")}`,
      );
      await abrirDetalhe();
      conferirEtapas(nomes, atual);
      expect(etapas().textContent).toContain("04/11, 09:00");
    },
  );

  it("entregue mostra as quatro etapas concluídas no detalhe, sem etapa atual", async () => {
    await montar("closed", "delivered");
    expect(container.querySelector("ol[aria-label]")).toBeNull();
    await abrirDetalhe();
    conferirEtapas(
      [
        "Pedido feito: concluída",
        "Em separação: concluída",
        "Saiu para entrega: concluída",
        "Entregue: concluída",
      ],
      null,
    );
    expect(etapas().getAttribute("aria-label")).toBe("Etapa: Entregue");
  });

  it.each([
    { status: "cancelled", selo: "Cancelado", evento: "Cancelado por você" },
    { status: "rejected", selo: "Recusado", evento: "Recusado pela Dutelog" },
  ])(
    "$status não mostra a régua nem uma etapa atual, preservando o histórico",
    async ({ status, selo, evento }) => {
      await montar(status, "dispatched");
      expect(container.querySelector("ol[aria-label]")).toBeNull();
      await abrirDetalhe();
      expect(container.querySelector("ol[aria-label]")).toBeNull();
      expect(container.querySelector('[aria-current="step"]')).toBeNull();
      expect(container.textContent).toContain(selo);
      expect(container.textContent).toContain(evento);
      expect(container.textContent).toContain("Atualizações da Dutelog");
    },
  );

  it("a lista em separação e seu detalhe têm etapas acessíveis", async () => {
    await montar("approved", "separating");
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
    await abrirDetalhe();
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("o detalhe entregue mantém nomes acessíveis para as etapas concluídas", async () => {
    await montar("closed", "delivered");
    await abrirDetalhe();
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });
});
