// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { botaoPeloRotulo, travado } from "@/test/botoes";

/**
 * Estoque › Contagem por caixa › a prateleira, pelo caminho de verdade: a
 * página com as caixas, os saldos e as reservas lidos ao vivo no formato que
 * o servidor grava (functions/wms, box-recount.ts e operations.ts), a pessoa
 * conta a caixa, acrescenta o item fora da lista e confirma. O que vai para
 * a callable `recountWarehouseBox` é a lista inteira da caixa, o fora da
 * lista e a rodada do dia, sem nenhum campo vazio (o SDK do Firebase troca o
 * `undefined` por `null`, e o servidor recusa). Dados sintéticos.
 */

const BTG = "BTG Pactual";
const P = { sku_code: "BTG-000121", client_item_code: "A.01.0806.005.P", product_name: "Polo Masculino Piquet Preto", size: "P" };
const M = { sku_code: "BTG-000123", client_item_code: "A.01.0806.005.M", product_name: "Polo Masculino Piquet Preto", size: "M" };
const GG = { sku_code: "BTG-000125", client_item_code: "A.01.0806.005.GG", product_name: "Polo Masculino Piquet Preto", size: "GG" };

const estado = vi.hoisted(() => ({
  /** As consultas ao vivo, pela chave da leitura. */
  consultas: {} as Record<string, Array<Record<string, unknown>>>,
  toast: [] as Array<{ title?: string; description?: string; variant?: string }>,
}));

const recontar = vi.hoisted(() => vi.fn());

vi.mock("wouter", async (original) => ({
  ...(await original<typeof import("wouter")>()),
  useSearch: () => "posicao=a-03",
}));
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u_1", fullName: "Guilherme Dantas", publicMetadata: { role: "wms" } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: "BTG Pactual", isLoading: false, falhou: false, options: [] }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (aviso: { title?: string; description?: string; variant?: string }) => estado.toast.push(aviso) }) }));
vi.mock("@/lib/operacao/leitura", async (original) => ({
  ...(await original<object>()),
  useLeitura: (chave: string | null, _consulta: unknown, mapear: (id: string, data: Record<string, unknown>) => unknown) => {
    const docs = chave ? estado.consultas[chave] : undefined;
    return { itens: docs ? docs.map((data) => mapear(String(data.id), data)).filter((item) => item !== null) : null, erro: false, tentando: false, tentar: async () => undefined, falta: null, lidaEm: null };
  },
}));
// O cadastro de Posições, as linhas da abertura e o catálogo: as leituras do Mapa e da folha.
vi.mock("@/lib/warehouse-rows", () => ({ fetchWarehouseRows: async () => [{ code: "A-03", aisle: "A", shelf: 3, sequence: 3, customer_code: BTG }] }));
vi.mock("@/lib/firebase", () => ({ firestore: {}, firebaseApp: {}, firebaseAuth: null }));
vi.mock("firebase/firestore", async (original) => ({
  ...(await original<typeof import("firebase/firestore")>()),
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  getDocs: async () => ({
    docs: [
      { id: "l1", data: () => ({ customer_code: BTG, box_code: "CX-000010", location_id: "A-03", ...P, counted_qty: 60 }) },
      { id: "l2", data: () => ({ customer_code: BTG, box_code: "CX-000012", location_id: "A-03", ...M, counted_qty: 60 }) },
      { id: "l3", data: () => ({ customer_code: BTG, box_code: "CX-000013", location_id: "A-03", ...M, counted_qty: 20 }) },
    ],
  }),
}));
vi.mock("@/lib/warehouse-ops/model", async (original) => ({
  ...(await original<object>()),
  fetchJson: async (url: string) =>
    url.startsWith("/api/skus")
      ? {
          items: [
            { id: P.sku_code, cod_btg: P.sku_code, cod_cliente: P.client_item_code, produto: P.product_name, tamanho: "P", customer_code: BTG },
            { id: M.sku_code, cod_btg: M.sku_code, cod_cliente: M.client_item_code, produto: M.product_name, tamanho: "M", customer_code: BTG },
            { id: GG.sku_code, cod_btg: GG.sku_code, cod_cliente: GG.client_item_code, produto: GG.product_name, tamanho: "GG", customer_code: BTG },
          ],
        }
      : {},
}));
vi.mock("@/lib/wms/recontagem", () => ({ recontarCaixa: recontar }));

import { rodadaDoDia } from "@/lib/warehouse-ops/recontagem-por-caixa";

import PaginaPrateleiraDaContagem from "./estoque-contagem-prateleira";

const AGORA = new Date("2026-11-17T12:30:00.000Z");
const RODADA = rodadaDoDia(AGORA);

const caixa = (code: string, extra: Record<string, unknown> = {}) => ({
  id: code,
  code,
  customer_code: BTG,
  status: "stored",
  location_id: "A-03",
  stored_at: "2026-10-20T12:00:00.000Z",
  unit_count: 60,
  origin: { kind: "opening_inventory", session_id: "opening_btg" },
  ...extra,
});

function semear() {
  estado.toast = [];
  estado.consultas = {
    [`warehouse_boxes:${BTG}:A-03`]: [caixa("CX-000010"), caixa("CX-000012", { taken_lines: [{ sku_code: M.sku_code, qty: 10 }], taken_units: 10 }), caixa("CX-000013", { unit_count: 20 })],
    [`stock_balances:${BTG}:A-03`]: [
      { id: "b1", customer_code: BTG, location_id: "A-03", ...P, qty_on_hand: 60, qty_reserved: 20 },
      { id: "b2", customer_code: BTG, location_id: "A-03", ...M, qty_on_hand: 70, qty_reserved: 0 },
    ],
    [`stock_reservations:${BTG}:A-03:reserved`]: [{ id: "r1", customer_code: BTG, location_id: "A-03", sku_code: P.sku_code, status: "reserved", order_number: "PED-0002" }],
    [`stock_reservations:${BTG}:A-03:picked`]: [],
    [`putaway_tasks:${BTG}:planned`]: [],
    [`putaway_tasks:${BTG}:in_progress`]: [],
    [`cycle_counts:${BTG}:${RODADA}`]: [],
  };
}

let raiz: Root | null = null;
let container: HTMLDivElement;

async function esperar() {
  await act(async () => {
    for (let vez = 0; vez < 5; vez += 1) await new Promise((pronto) => setTimeout(pronto, 0));
  });
}

async function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={queryClient}>
        <Router ssrPath="/estoque/contagem/prateleira">
          <PaginaPrateleiraDaContagem />
        </Router>
      </QueryClientProvider>,
    );
  });
  await esperar();
}

function campo(id: string): HTMLInputElement {
  const elemento = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!elemento) throw new Error(`Sem o campo ${id}`);
  return elemento;
}

async function digitar(id: string, valor: string) {
  const elemento = campo(id);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(elemento, valor);
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function tocar(elemento: Element | null | undefined) {
  if (!elemento) throw new Error("Nada para tocar.");
  await act(async () => (elemento as HTMLElement).click());
  await esperar();
}

/** O botão "Contar" da caixa: ele aponta para o código dela (`aria-describedby`). */
function contar(code: string) {
  return container.querySelector(`#contar-${code}`);
}

beforeEach(() => {
  vi.setSystemTime(AGORA);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (pronto: FrameRequestCallback) => setTimeout(() => pronto(0), 0));
  recontar.mockReset();
  semear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a bancada da prateleira grava a caixa pela callable", () => {
  it("conta a caixa, acrescenta o item fora da lista e manda a lista inteira, o fora da lista e a rodada, sem campo vazio", async () => {
    recontar.mockResolvedValue({
      ok: true,
      box_recount_id: "brc_012",
      box_code: "CX-000012",
      location_id: "A-03",
      round_id: RODADA,
      status: "stored",
      expected_units: 50,
      counted_units: 50,
      difference_units: 0,
      emptied: false,
      lines: [
        { ...M, expected: 50, counted: 48, difference: -2, shelf_delta: -2 },
        { ...GG, out_of_list: true, expected: 0, counted: 2, difference: 2, shelf_delta: 2, origins: [{ kind: "entry", qty: 2 }] },
      ],
    });
    await montar();
    expect(container.textContent).toContain("Rua A · 3 caixas · 2 itens");
    // A reserva e o pedido aparecem antes de digitar.
    expect(container.textContent).toContain("60 esperadas · 20 reservadas · PED-0002");

    await tocar(contar("CX-000012"));
    // A caixa abre com o foco no primeiro campo: o esperado é a entrada menos o que a separação tirou.
    expect(document.activeElement?.id).toBe("contado-CX-000012-0");
    expect(container.textContent).toContain("entrou 60 · saiu 10");
    const confirmar = () => container.querySelector("#confirmar-CX-000012")!;
    expect(travado(confirmar())).toBe(true);

    await digitar("contado-CX-000012-0", "4a8");
    expect(campo("contado-CX-000012-0").value).toBe("48");
    expect(container.textContent).toContain("−2");

    await tocar(botaoPeloRotulo(container, "Item fora da lista"));
    await digitar("busca-CX-000012", "005.gg");
    await tocar(container.querySelector('ul[aria-label="Produtos do cliente"] button'));
    await esperar();
    expect(document.activeElement?.id).toBe("contado-CX-000012-1");
    await digitar("contado-CX-000012-1", "2");
    expect(travado(confirmar())).toBe(false);

    await tocar(confirmar());
    expect(recontar).toHaveBeenCalledTimes(1);
    const enviado = recontar.mock.calls[0][0] as Record<string, unknown>;
    expect(enviado).toEqual({
      customer_code: BTG,
      box_code: "CX-000012",
      location_id: "A-03",
      lines: [{ sku_code: M.sku_code, counted_qty: 48 }],
      extra_lines: [{ sku_code: GG.sku_code, counted_qty: 2 }],
      round_id: "recontagem-2026-11-17",
      idempotency_key: expect.any(String),
    });
    expect(JSON.stringify(enviado, (_chave, valor) => (valor === undefined ? "INDEFINIDO" : valor))).not.toMatch(/INDEFINIDO|null/);

    // A caixa sai confirmada na hora, com a origem da peça a mais; a próxima por contar abre, com o foco nela.
    expect(container.textContent).toContain("confirmada 09:30 · 50 · sem diferença");
    expect(container.textContent).toContain("+2 · fora da lista · entrada de 2 em A-03");
    expect(container.textContent).toContain("1 de 3 caixas");
    expect(document.activeElement?.id).toBe("contado-CX-000013-0");
    expect(estado.toast.at(-1)).toMatchObject({ title: "CX-000012 confirmada", description: "Sem diferença." });
  });

  it("\"Caixa vazia\" zera a lista e o confirmar diz que a caixa sai vazia; a recusa do servidor deixa a caixa aberta, com o motivo", async () => {
    recontar.mockRejectedValue(
      Object.assign(new Error("A prateleira A-03 tem uma guarda chegando ou saindo: conclua a guarda antes de recontar as caixas dela."), {
        code: "failed-precondition",
        detalhe: "BOX_RECOUNT_PUTAWAY_OPEN",
      }),
    );
    await montar();
    await tocar(contar("CX-000013"));
    await tocar(botaoPeloRotulo(container, "Caixa vazia"));
    expect(campo("contado-CX-000013-0").value).toBe("0");
    const confirmar = botaoPeloRotulo(container, "Confirmar caixa vazia");
    expect(confirmar).toBeDefined();
    await tocar(confirmar);
    expect(recontar.mock.calls[0][0]).toMatchObject({ box_code: "CX-000013", lines: [{ sku_code: M.sku_code, counted_qty: 0 }] });
    expect("extra_lines" in (recontar.mock.calls[0][0] as object)).toBe(false);
    expect(estado.toast.at(-1)).toMatchObject({ title: "CX-000013 não confirmada", variant: "destructive" });
    expect(estado.toast.at(-1)?.description).toContain("guarda chegando ou saindo");
    // A caixa continua aberta, com o que foi digitado.
    expect(campo("contado-CX-000013-0").value).toBe("0");
  });

  it("a caixa já contada nesta rodada vem confirmada, com \"Contar de novo\"", async () => {
    estado.consultas[`cycle_counts:${BTG}:${RODADA}`] = [
      {
        id: "cc_1",
        customer_code: BTG,
        location_id: "A-03",
        box_code: "CX-000010",
        box_recount_id: "brc_010",
        round_id: RODADA,
        mode: "box",
        ...P,
        qty_before: 60,
        counted_qty: 60,
        adjustment_delta: 0,
        actor: { name: "Guilherme Dantas" },
        occurred_at: "2026-11-17T12:02:00.000Z",
      },
    ];
    await montar();
    expect(container.textContent).toContain("confirmada 09:02 · 60 · sem diferença");
    expect(contar("CX-000010")?.textContent).toBe("Contar de novo");
    expect(container.textContent).toContain("1 de 3 caixas");
  });
});
