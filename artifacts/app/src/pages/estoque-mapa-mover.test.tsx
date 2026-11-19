// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { INTERVALO_DO_TOQUE_MS } from "@/lib/campo/toque-unico";
import { botaoPeloRotulo } from "@/test/botoes";

/**
 * Estoque › Mapa › Mover caixa, pelo caminho de verdade: a página abre a
 * caixa da busca (`?caixa=`), mostra a prévia do servidor e manda o mover com
 * a prateleira de origem que a tela viu, o destino, a sugestão e a chave da
 * tentativa, sem campo vazio. A recusa do servidor aparece no lugar; a
 * repetição depois de um resultado incerto leva a mesma chave. Dados
 * sintéticos; as callables simuladas (lib/wms/mover-caixa.ts).
 */

const BTG = "BTG Pactual";

const chamadas = vi.hoisted(() => ({ previa: vi.fn(), mover: vi.fn(), toast: vi.fn(), busca: { atual: "caixa=cx-121" }, papel: { atual: "admin" }, cliente: { falhou: false } }));

vi.mock("wouter", async (original) => ({
  ...(await original<typeof import("wouter")>()),
  useSearch: () => chamadas.busca.atual,
}));
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u_1", fullName: "Leonardo", publicMetadata: { role: chamadas.papel.atual } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({
    code: "BTG Pactual",
    isLoading: false,
    falhou: chamadas.cliente.falhou,
    erro: chamadas.cliente.falhou ? Object.assign(new Error("Falha no servidor."), { code: "internal" }) : null,
    tentar: async () => undefined,
    options: [],
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: chamadas.toast }) }));
vi.mock("@/lib/firebase", () => ({ firestore: {}, firebaseApp: {}, firebaseAuth: null }));
vi.mock("@/lib/warehouse-rows", () => ({ fetchWarehouseRows: async () => [] }));
vi.mock("@/lib/wms/mover-caixa", () => ({ previaDoMover: chamadas.previa, moverCaixa: chamadas.mover }));

import EstoqueMapaMover from "./estoque-mapa-mover";

const DE_PE = { front_m: 0.4, depth_m: 0.6, height_m: 0.35, orientation: "length_width_height" };

const PREVIA = {
  ok: true,
  box: {
    code: "CX-000121",
    status: "stored",
    location_id: "A-01",
    units: 20,
    items: [{ sku_code: "BTG-000112", qty: 20, client_item_code: "A.01.0713.005.M", product_name: "Polo Masculino Piquet Preto", size: "M" }],
    origin_kind: "opening_inventory",
    stored_at: "2026-10-22T13:00:00.000Z",
    length_m: 0.4,
    width_m: 0.6,
    height_m: 0.35,
    gross_weight_kg: 10,
  },
  bloqueio: null,
  prateleiras: [
    { code: "B-09", tier: 1, reason: "Já tem Polo Masculino Piquet Preto · M e ainda cabe.", free_front_m: 1.42, box_count: 2, sequence: 9, placement: DE_PE },
    {
      code: "B-10",
      tier: 1,
      reason: "Já tem Polo Masculino Piquet Preto · M e ainda cabe.",
      free_front_m: 0.62,
      box_count: 4,
      sequence: 10,
      placement: { ...DE_PE, orientation: "width_length_height", support_box_code: "CX-000150", base_height_m: 0.35 },
    },
    { code: "C-02", tier: 2, reason: "A mais vazia da zona: 1,78 m livres de frente.", free_front_m: 1.78, box_count: 0, sequence: 12, placement: DE_PE },
  ],
  nao_cabem: [],
  com_reserva: [],
  em_contagem: [],
  rejected: null,
};

/** Outra caixa, em C-01: a que se abre enquanto a primeira ainda move. */
const PREVIA_130 = {
  ...PREVIA,
  box: { ...PREVIA.box, code: "CX-000130", location_id: "C-01", units: 10, items: [{ ...PREVIA.box.items[0]!, qty: 10 }] },
};

const MOVIDA = {
  ok: true,
  box_move_id: "bmv_1",
  box_code: "CX-000121",
  from_location_id: "A-01",
  to_location_id: "B-09",
  units: 20,
  items: PREVIA.box.items,
  moved_at: "2026-11-19T17:32:00.000Z",
  moved_by_name: "Leonardo",
  suggestion_followed: true,
  placement: DE_PE,
  movement_ids: [],
};

let raiz: Root | null = null;
let container: HTMLDivElement;

async function esperar() {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(1_000);
    else for (let vez = 0; vez < 6; vez += 1) await new Promise((pronto) => setTimeout(pronto, 0));
  });
}

async function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={queryClient}>
        <Router ssrPath="/estoque/mapa/mover">
          <EstoqueMapaMover />
        </Router>
      </QueryClientProvider>,
    );
  });
  await esperar();
}

/** Digita no campo "Caixa" (o input controlado do React) e abre. */
async function abrirACaixa(valor: string) {
  const campo = container.querySelector<HTMLInputElement>("#mover-caixa-codigo");
  if (!campo) throw new Error("Sem o campo da caixa.");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await tocar(botaoPeloRotulo(container, "Abrir"));
}

async function tocar(elemento: Element | null | undefined) {
  if (!elemento) throw new Error("Nada para tocar.");
  await act(async () => (elemento as HTMLElement).click());
  await esperar();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  chamadas.previa.mockReset();
  chamadas.mover.mockReset();
  chamadas.busca.atual = "caixa=cx-121";
  chamadas.papel.atual = "admin";
  chamadas.cliente.falhou = false;
  chamadas.toast.mockReset();
  chamadas.previa.mockResolvedValue(PREVIA);
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  vi.useRealTimers();
  raiz = null;
  container.remove();
  vi.unstubAllGlobals();
});

describe("a página Mover caixa", () => {
  it("abre a caixa da busca e move pela sugestão", async () => {
    chamadas.mover.mockResolvedValue(MOVIDA);
    await montar();
    expect(chamadas.previa).toHaveBeenCalledWith({ customer_code: BTG, box_code: "CX-000121" });
    await tocar(botaoPeloRotulo(container, "Mover para B-09"));
    expect(chamadas.mover).toHaveBeenCalledTimes(1);
    const [entrada] = chamadas.mover.mock.calls[0]!;
    expect(entrada).toEqual({
      customer_code: BTG,
      box_code: "CX-000121",
      from_location_id: "A-01",
      to_location_id: "B-09",
      suggestion: { position: "B-09", alternatives: ["B-10", "C-02"] },
      orientation: "length_width_height",
      support_box_code: null,
      idempotency_key: expect.any(String),
    });
    expect(container.textContent).toContain("CX-000121 em B-09");
    expect(container.textContent).toContain("saiu de A-01 · 20 un. · 19/11 14:32 · Leonardo");
  });

  it("escolhe a prateleira à mão e manda o encaixe dela", async () => {
    chamadas.mover.mockResolvedValue({ ...MOVIDA, to_location_id: "B-10", suggestion_followed: false });
    await montar();
    await tocar(botaoPeloRotulo(container, "Escolher prateleira"));
    await tocar(container.querySelector("#destino-B-10"));
    await tocar(botaoPeloRotulo(container, "Mover para B-10"));
    expect(chamadas.mover).toHaveBeenCalledTimes(1);
    expect(chamadas.mover.mock.calls[0]![0]).toEqual({
      customer_code: BTG,
      box_code: "CX-000121",
      from_location_id: "A-01",
      to_location_id: "B-10",
      suggestion: { position: "B-09", alternatives: ["B-10", "C-02"] },
      orientation: "width_length_height",
      support_box_code: "CX-000150",
      idempotency_key: expect.any(String),
    });
    expect(container.textContent).toContain("CX-000121 em B-10");
  });

  it("a recusa do servidor aparece no lugar, e o mover continua à mão", async () => {
    const frase = "Polo Masculino Piquet Preto · M está reservado em B-09 para o pedido PED-0043: escolha outra prateleira ou mova depois da entrega.";
    chamadas.mover.mockRejectedValue(Object.assign(new Error(frase), { code: "failed-precondition", detalhe: "BOX_MOVE_DESTINATION_RESERVED" }));
    await montar();
    await tocar(botaoPeloRotulo(container, "Mover para B-09"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(frase);
    expect(botaoPeloRotulo(container, "Mover para B-09")).toBeTruthy();
  });

  it("a mesma tentativa repete a mesma chave depois de um resultado incerto", async () => {
    // O relógio falso: o "Movendo…" fica os 500 ms do mínimo antes do "Tentar de novo".
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-19T17:30:00Z"));
    chamadas.mover.mockRejectedValueOnce(Object.assign(new Error("Sem conexão."), { code: "unavailable" })).mockResolvedValueOnce(MOVIDA);
    await montar();
    await tocar(botaoPeloRotulo(container, "Mover para B-09"));
    await tocar(botaoPeloRotulo(container, "Tentar de novo"));
    expect(chamadas.mover).toHaveBeenCalledTimes(2);
    expect(chamadas.mover.mock.calls[1]![0].idempotency_key).toBe(chamadas.mover.mock.calls[0]![0].idempotency_key);
    expect(container.textContent).toContain("CX-000121 em B-09");
  });

  it("sem o papel de quem opera o armazém, a página diz o bloqueio e não chama nada", async () => {
    chamadas.papel.atual = "suporte";
    await montar();
    expect(chamadas.previa).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Ação permitida somente para administração ou operação de armazém.");
    expect(container.textContent).not.toContain("Carregando a caixa");
  });

  it("o código que não é de caixa não chama o servidor", async () => {
    chamadas.busca.atual = "caixa=A-01";
    await montar();
    expect(chamadas.previa).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Caixa inválida: confira o código e tente de novo.");
  });
});

/** As correções da revisão final do PR da tela (19/11/2026). */
describe("a página Mover caixa, a leitura e o resultado", () => {
  it("sem o cliente ativo, a falha dele no lugar da caixa, e nada vai ao servidor", async () => {
    chamadas.cliente.falhou = true;
    await montar();
    expect(chamadas.previa).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Não consegui carregar o cliente ativo.");
    expect(container.textContent).not.toContain("Carregando a caixa");
    expect(container.textContent).not.toContain("Caixa inválida");
  });

  it("a nova tentativa depois da falha deixa o aviso na tela até a leitura responder", async () => {
    let responder: (valor: unknown) => void = () => undefined;
    chamadas.previa.mockReset();
    chamadas.previa
      .mockRejectedValueOnce(Object.assign(new Error("Falha no servidor."), { code: "internal" }))
      .mockImplementationOnce(() => new Promise((pronto) => (responder = pronto)));
    await montar();
    expect(container.textContent).toContain("Não consegui carregar a caixa.");
    await tocar(botaoPeloRotulo(container, "Tentar de novo"));
    expect(chamadas.previa).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Não consegui carregar a caixa.");
    expect(container.textContent).not.toContain("Carregando a caixa");
    await act(async () => responder(PREVIA));
    await esperar();
    expect(botaoPeloRotulo(container, "Mover para B-09")).toBeTruthy();
  });

  it("a primeira leitura presa recomeça no Tentar de novo da demora", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-19T17:30:00Z"));
    chamadas.previa.mockReset();
    chamadas.previa.mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValue(PREVIA);
    await montar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await tocar(botaoPeloRotulo(container, "Tentar de novo"));
    expect(chamadas.previa).toHaveBeenCalledTimes(2);
    expect(botaoPeloRotulo(container, "Mover para B-09")).toBeTruthy();
  });

  it("depois de mover, o toast diz onde a caixa ficou e o foco vai ao Imprimir etiqueta", async () => {
    chamadas.mover.mockResolvedValue(MOVIDA);
    await montar();
    await tocar(botaoPeloRotulo(container, "Mover para B-09"));
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 60));
    });
    expect(chamadas.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "CX-000121 em B-09" }));
    expect(document.activeElement?.textContent).toBe("Imprimir etiqueta");
  });

  it("a escolhida que saiu da lista na releitura volta à sugestão, e o mover leva o encaixe dela", async () => {
    const naoCabe = "A caixa não cabe em C-02 agora: escolha outra prateleira.";
    chamadas.previa.mockReset();
    chamadas.previa.mockResolvedValueOnce(PREVIA).mockResolvedValue({ ...PREVIA, prateleiras: PREVIA.prateleiras.slice(0, 2), nao_cabem: ["C-02"] });
    chamadas.mover.mockRejectedValueOnce(Object.assign(new Error(naoCabe), { code: "failed-precondition", detalhe: "BOX_MOVE_DOES_NOT_FIT" })).mockResolvedValueOnce(MOVIDA);
    await montar();
    await tocar(botaoPeloRotulo(container, "Escolher prateleira"));
    await tocar(container.querySelector("#destino-C-02"));
    await tocar(botaoPeloRotulo(container, "Mover para C-02"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(naoCabe);
    // A releitura tirou a C-02: o botão volta à sugestão, com o encaixe que a tela mostra.
    expect(botaoPeloRotulo(container, "Mover para C-02")).toBeUndefined();
    // O segundo toque logo depois do primeiro é ignorado (toque duplo): a pessoa toca de novo depois.
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, INTERVALO_DO_TOQUE_MS + 50));
    });
    await tocar(botaoPeloRotulo(container, "Mover para B-09"));
    expect(chamadas.mover).toHaveBeenCalledTimes(2);
    expect(chamadas.mover.mock.calls[1]![0]).toEqual(expect.objectContaining({ to_location_id: "B-09", orientation: "length_width_height", support_box_code: null }));
  });

  it("a recusa sai quando a pessoa escolhe de novo", async () => {
    const reservada = "Polo Masculino Piquet Preto · M está reservado em B-09 para o pedido PED-0043: escolha outra prateleira ou mova depois da entrega.";
    chamadas.mover.mockRejectedValue(Object.assign(new Error(reservada), { code: "failed-precondition", detalhe: "BOX_MOVE_DESTINATION_RESERVED" }));
    await montar();
    await tocar(botaoPeloRotulo(container, "Mover para B-09"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(reservada);
    await tocar(botaoPeloRotulo(container, "Escolher prateleira"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("o resultado de uma caixa não aparece sobre outra que se abriu enquanto ela movia", async () => {
    let concluir: (valor: unknown) => void = () => undefined;
    chamadas.previa.mockReset();
    chamadas.previa.mockImplementation(async ({ box_code }: { box_code: string }) => (box_code === "CX-000130" ? PREVIA_130 : PREVIA));
    chamadas.mover.mockImplementation(() => new Promise((pronto) => (concluir = pronto)));
    await montar();
    await tocar(botaoPeloRotulo(container, "Mover para B-09"));
    await abrirACaixa("cx-130");
    expect(chamadas.previa).toHaveBeenLastCalledWith({ customer_code: BTG, box_code: "CX-000130" });
    await act(async () => concluir(MOVIDA));
    await esperar();
    // A CX-000121 moveu (o toast diz), mas a tela é da CX-000130, que continua em C-01.
    expect(chamadas.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "CX-000121 em B-09" }));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).toContain("CX-000130");
    expect(container.textContent).toContain("em C-01");
    expect(container.textContent).not.toContain("CX-000121 em B-09");
  });
});
