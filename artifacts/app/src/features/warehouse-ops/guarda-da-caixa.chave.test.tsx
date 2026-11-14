// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskQueueEntry } from "@/lib/warehouse-ops/model";

/**
 * A chave de idempotência por tentativa na guarda da caixa (carregamento v2,
 * parte 13i; o diagnóstico, seção 9.1, item 11, e a necessidade 5 do
 * celular): repetir "Concluir guarda" ou "Liberar" depois de um resultado
 * incerto (sem resposta, sem conexão) leva a mesma chave e o mesmo pedido, e
 * o servidor devolve o recibo da primeira, se ela valeu. A chave é nova só
 * quando o servidor recusa ou a pessoa muda o pedido (o motivo). Antes, cada
 * toque gerava uma chave nova, e a guarda que tinha valido voltava como
 * "já foi guardada". Dados sintéticos.
 */

type Chamada = { nome: string; dados: Record<string, unknown> };

const estado = vi.hoisted(() => ({
  chamadas: [] as Chamada[],
  /** O que as próximas chamadas respondem, na ordem; sem resposta na fila, dá certo. */
  respostas: [] as Array<"incerto" | "recusa" | "ok">,
}));

function responder(nome: string, dados: Record<string, unknown>, sucesso: Record<string, unknown>) {
  estado.chamadas.push({ nome, dados });
  const resposta = estado.respostas.shift() ?? "ok";
  // O SDK sem resposta (o prazo de 70 s) não diz se gravou; a recusa do servidor diz que não.
  if (resposta === "incerto") return Promise.reject(Object.assign(new Error("O servidor não respondeu a tempo."), { code: "functions/deadline-exceeded" }));
  if (resposta === "recusa") {
    return Promise.reject(Object.assign(new Error("A caixa mudou em outra tela. Atualize antes de continuar."), { code: "functions/aborted" }));
  }
  return Promise.resolve(sucesso);
}

vi.mock("@/lib/wms/caixas-do-recebimento", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/wms/caixas-do-recebimento")>();
  return {
    ...original,
    guardarCaixa: (dados: Record<string, unknown>) => responder("guardar", dados, { ok: true, status: "stored" }),
    naoCabeNaPrateleira: (dados: Record<string, unknown>) => responder("liberar", dados, { ok: true, conference_revision: 10 }),
    sugerirPrateleira: async () => ({ ok: true, position: null, alternatives: [], rejected: null, checked: 0 }),
  };
});

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: "BTG Pactual" }) }));
vi.mock("@/lib/warehouse-rows", () => ({
  fetchWarehouseRows: async () => [{ code: "B-02", aisle: "B", shelf: 2, customer_code: "BTG Pactual", status: "active" }],
}));

import { GuardaDaCaixa } from "./guarda-da-caixa";

const RECEIPT = "inb_avulso_0d0e620b";

function entrada(revisao = 9) {
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
      source_location_id: "RECEBIMENTO",
      box_lines: [],
      box: {
        code: "CX-000131",
        status: "committing",
        location_id: "B-02",
        lines: [],
        unit_count: 18,
        length_m: 0.48,
        width_m: 0.38,
        height_m: 0.3,
        gross_weight_kg: 6.1,
        allow_tilt: false,
        allow_stacking: false,
        conference_revision: revisao,
        refused_positions: [],
      },
    },
  } as unknown as TaskQueueEntry;
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let cliente: QueryClient;

async function montar(entry: TaskQueueEntry) {
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
  estado.respostas = [];
  // Só o Date: cada toque do teste vem mais de 1 s depois do outro (a trava do toque duplo do BotaoDeAcao).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  cliente.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function botao(texto: string): HTMLButtonElement {
  const achado = [...document.querySelectorAll("button")].find(
    (elemento) => elemento.textContent?.trim() === texto || elemento.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === texto,
  );
  if (!achado) throw new Error(`Sem o botão ${texto}`);
  return achado;
}

/** Toca quando o botão estiver solto (o toque duplo e a espera o travam), e espera a chamada sair. */
async function tocar(texto: string, nome: string) {
  const antes = estado.chamadas.filter((chamada) => chamada.nome === nome).length;
  await vi.waitFor(() => expect(botao(texto).getAttribute("aria-disabled")).toBeNull(), { timeout: 3_000 });
  vi.setSystemTime(Date.now() + 1_100);
  await act(async () => botao(texto).click());
  await vi.waitFor(() => expect(estado.chamadas.filter((chamada) => chamada.nome === nome).length).toBe(antes + 1), { timeout: 3_000 });
  // A resposta chega e a tela volta a soltar o botão.
  await act(async () => {
    await new Promise((pronto) => setTimeout(pronto, 0));
  });
}

async function digitarMotivo(motivo: string) {
  await act(async () => {
    const campo = document.getElementById("nao-cabe-motivo") as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, motivo);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const dados = (nome: string) => estado.chamadas.filter((chamada) => chamada.nome === nome).map((chamada) => chamada.dados);

describe("a chave por tentativa na guarda da caixa", () => {
  it("Concluir guarda repetido depois do resultado incerto leva a mesma chave e o mesmo pedido, mesmo com a revisão relida", async () => {
    estado.respostas = ["incerto"];
    await montar(entrada(9));
    await tocar("Concluir guarda em B-02", "guardar");
    // A bancada releu e a revisão subiu (a primeira pode ter valido): a repetição é a mesma tentativa.
    await montar(entrada(10));
    await vi.waitFor(() => expect(document.body.textContent).toContain("O servidor não respondeu a tempo."), { timeout: 3_000 });
    await tocar("Concluir guarda em B-02", "guardar");
    const [primeira, segunda] = dados("guardar");
    expect(String(primeira!.idempotency_key)).not.toBe("");
    expect(segunda).toEqual(primeira);
  });

  it("depois da recusa do servidor, a próxima tentativa é nova: outra chave, com a revisão de agora", async () => {
    estado.respostas = ["recusa"];
    await montar(entrada(9));
    await tocar("Concluir guarda em B-02", "guardar");
    await montar(entrada(10));
    await vi.waitFor(() => expect(document.body.textContent).toContain("A caixa mudou em outra tela."), { timeout: 3_000 });
    await tocar("Concluir guarda em B-02", "guardar");
    const [primeira, segunda] = dados("guardar");
    expect(segunda!.idempotency_key).not.toBe(primeira!.idempotency_key);
    expect(segunda!.expected_revision).toBe(10);
  });

  it("Liberar repetido com o mesmo motivo leva a mesma chave; com outro motivo, é outro pedido", async () => {
    estado.respostas = ["incerto", "incerto"];
    await montar(entrada(9));
    await act(async () => botao("Não cabe aqui").click());
    await digitarMotivo("Outra caixa ocupando a frente");
    await tocar("Liberar B-02", "liberar");
    await tocar("Liberar B-02", "liberar");
    await digitarMotivo("A prateleira está avariada");
    await tocar("Liberar B-02", "liberar");
    const [primeira, segunda, terceira] = dados("liberar");
    expect(segunda).toEqual(primeira);
    expect(terceira!.reason).toBe("A prateleira está avariada");
    expect(terceira!.idempotency_key).not.toBe(primeira!.idempotency_key);
  });
});
