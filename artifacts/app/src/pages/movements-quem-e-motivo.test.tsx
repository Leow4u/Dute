// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * Quem fez e por quê no Histórico do Estoque, como nas Movimentações
 * (anotado em 18/11/2026): o servidor grava o `actor` e os vínculos do
 * movimento; o `responsavel` e o `doc_nf` são do razão de antes das
 * Functions. Dados sintéticos, no formato do `createMovement`
 * (functions/wms/src/domain/operations.ts).
 */

const estado = vi.hoisted(() => ({ itens: [] as Array<Record<string, unknown>> }));

vi.mock("@workspace/api-client-react", () => ({
  useCreateMovement: () => ({ mutate: vi.fn(), isPending: false }),
  useListMovements: () => ({ data: { items: estado.itens, total: estado.itens.length }, isLoading: false }),
  getListMovementsQueryKey: (params: unknown) => ["/api/movements", params],
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "op-1", fullName: "Operador", publicMetadata: { role: "interno" } }, isLoaded: true }),
}));

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG Pactual", isLoading: false }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import Movements from "./movements";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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
  estado.itens = [];
});

function movimentoGravado(campos: Record<string, unknown>) {
  return {
    id: "mov_op_1",
    data: "2026-11-27T15:00:00.000Z",
    occurred_at: "2026-11-27T15:00:00.000Z",
    type: "inventory.shipped",
    tipo_mov: "SAIDA",
    sign: -1,
    sinal: -1,
    quantity: 4,
    qtde: 4,
    customer_code: "BTG Pactual",
    cod_cliente: "BTG Pactual",
    sku_code: "BTG-000126",
    cod_sku: "BTG-000126",
    client_item_code: "A.01.0806.005.XG",
    product_name: "Polo Masculino Piquet Preto",
    produto: "Polo Masculino Piquet Preto",
    location_id: "B-05",
    qty_before: 30,
    estoque_anterior: 30,
    qty_after: 26,
    estoque_resultante: 26,
    saldo_delta: -4,
    source: "wms_shipping",
    actor: { uid: "u-guilherme", email: "guilherme@dutelog.com.br", name: "Guilherme Dantas", role: "admin" },
    created_at: { seconds: 1_764_255_600, nanoseconds: 0 },
    ...campos,
  };
}

const SAIDA_DO_PEDIDO = movimentoGravado({
  order_id: "creq_1",
  order_number: "PED-0012",
  shipment_id: "shp_1",
  stock_reservation_id: "res_1",
  origem: "B-05",
  destino: "Faria Lima",
});

const AJUSTE_MANUAL = movimentoGravado({
  id: "mov_op_2",
  data: "2026-11-27T14:00:00.000Z",
  occurred_at: "2026-11-27T14:00:00.000Z",
  type: "inventory.received",
  tipo_mov: "ENTRADA",
  sign: 1,
  sinal: 1,
  quantity: 2,
  qtde: 2,
  qty_before: 26,
  estoque_anterior: 26,
  qty_after: 28,
  estoque_resultante: 28,
  saldo_delta: 2,
  source: "functions_manual_inventory",
  actor: { uid: "u-rafael", email: "rafael@dutelog.com.br", role: "interno" },
  reason: "Achado na conferência",
  operational_operation_id: "op_inventory_1",
});

async function montar() {
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient()}>
        <Movements embedded />
      </QueryClientProvider>,
    ),
  );
}

const cabecalho = () => [...container!.querySelectorAll("thead th")].map((celula) => celula.textContent);
const linhas = () => [...container!.querySelectorAll("tbody tr")].map((linha) => [...linha.querySelectorAll("td")].map((celula) => celula.textContent));
const DATA = /^27\/11\/2026, \d\d:\d\d$/;

describe("quem fez e por quê no Histórico", () => {
  it("a tabela diz o motivo e o operador do movimento gravado pelo servidor", async () => {
    estado.itens = [SAIDA_DO_PEDIDO, AJUSTE_MANUAL];
    await montar();
    expect(cabecalho()).toEqual(["Data", "Tipo", "Código", "Produto", "Qtde", "Trajeto", "Saldo", "Motivo", "Operador"]);
    expect(linhas()).toEqual([
      [
        expect.stringMatching(DATA),
        "Saída",
        "BTG-000126",
        "Polo Masculino Piquet Preto · XG",
        "-4",
        "B-05 → Faria Lima",
        "26",
        "Pedido PED-0012",
        "Guilherme Dantas",
      ],
      [
        expect.stringMatching(DATA),
        "Entrada",
        "BTG-000126",
        "Polo Masculino Piquet Preto · XG",
        "+2",
        "- → -",
        "28",
        "Ajuste: Achado na conferência",
        "rafael@dutelog.com.br",
      ],
    ]);
  });

  it("a lista do celular diz o motivo e quem fez", async () => {
    estado.itens = [SAIDA_DO_PEDIDO, AJUSTE_MANUAL];
    await montar();
    const detalhes = [...container!.querySelectorAll("ul > li")].map((cartao) => cartao.lastElementChild!.lastElementChild!.textContent);
    expect(detalhes).toEqual([
      "B-05 → Faria Lima · saldo 26 · Pedido PED-0012 · Guilherme Dantas",
      "saldo 28 · Ajuste: Achado na conferência · rafael@dutelog.com.br",
    ]);
  });

  it("a tabela e a lista só com rótulos e dados, e o axe passa", async () => {
    estado.itens = [SAIDA_DO_PEDIDO, AJUSTE_MANUAL];
    await montar();
    const lista = container!.querySelector("ul")!.outerHTML + container!.querySelector("table")!.outerHTML;
    expect(
      textosForaDaLista(lista, [
        "Data",
        "Tipo",
        "Código",
        "Produto",
        "Qtde",
        "Trajeto",
        "Saldo",
        "Motivo",
        "Operador",
        DATA,
        "Saída",
        "Entrada",
        "BTG-000126",
        "Polo Masculino Piquet Preto · XG",
        "-4",
        "+2",
        "B-05 → Faria Lima",
        "- → -",
        "26",
        "28",
        "Pedido PED-0012",
        "Ajuste: Achado na conferência",
        "Guilherme Dantas",
        "rafael@dutelog.com.br",
        "B-05 → Faria Lima · saldo 26 · Pedido PED-0012 · Guilherme Dantas",
        "saldo 28 · Ajuste: Achado na conferência · rafael@dutelog.com.br",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(container!.innerHTML)).toEqual([]);
  });

  it("o movimento antigo segue com o responsavel; sem vínculo nem motivo, a coluna Motivo não aparece", async () => {
    estado.itens = [
      {
        id: 7,
        data: "2026-07-30T15:00:00.000Z",
        tipo_mov: "ENTRADA",
        cod_sku: "BTG-000101",
        produto: "Polo Feminina Piquet Azul Marinho",
        qtde: 6,
        sinal: 1,
        doc_nf: "NF 7.640",
        responsavel: "João Operador",
        source: "wms_receiving",
      },
    ];
    await montar();
    expect(cabecalho()).toEqual(["Data", "Tipo", "Código", "Produto", "Qtde", "Doc/NF", "Operador"]);
    expect(linhas()[0].slice(-2)).toEqual(["NF 7.640", "João Operador"]);
    expect(container!.textContent).not.toContain("wms_receiving");
  });
});
