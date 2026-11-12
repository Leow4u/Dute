// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CaixaDaChegada } from "@/lib/wms/caixas-do-recebimento";

/**
 * "Confirmar destino" quando a sugestão do sistema não carregou (achado de
 * 12/11/2026, docs/plataforma/recebimento-com-caixas.md). O SDK do Firebase
 * manda o campo `undefined` como `null`, e o servidor recusa `suggestion: null`
 * ("Campo inválido: suggestion."): quem escolhia a prateleira com a sugestão
 * fora do ar não conseguia confirmar. A caixa de apoio vazia vai como `null`
 * de propósito: para o servidor, é "no piso, sem empilhar".
 */

const estado = vi.hoisted(() => ({
  enviados: [] as Array<{ nome: string; dados: Record<string, unknown> }>,
  sugestaoFora: true,
  falhas: [] as string[],
  confirmado: false,
}));

const noPiso = (code: string, tier: number, reason: string) => ({
  code,
  reason,
  tier,
  leftover_m: 0.7,
  sequence: 3,
  // Como o servidor manda a da base: sem a chave da caixa de apoio.
  placement: { front_m: 0.48, depth_m: 0.38, height_m: 0.3, orientation: "length_width_height" },
});

// O que a callable recebe aqui é o que o SDK põe na rede.
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, nome: string) => async (dados: Record<string, unknown>) => {
    estado.enviados.push({ nome, dados });
    if (nome === "suggestInboundBoxPosition") {
      if (dados.location_id) {
        return { data: { ok: true, position: noPiso(String(dados.location_id), 3, "Prateleira selecionada manualmente."), alternatives: [], rejected: null, checked: 1 } };
      }
      // A sugestão sem resposta, como o celular sem sinal.
      if (estado.sugestaoFora) throw Object.assign(new Error("internal"), { code: "functions/internal" });
      return { data: { ok: true, position: noPiso("B-02", 1, "Já tem BTG-000086 nesta prateleira e ainda cabe."), alternatives: [noPiso("B-03", 2, "A mais próxima de B-02.")], rejected: null, checked: 43 } };
    }
    if (nome === "confirmInboundBoxDestination") {
      return { data: { ok: true, status: "committing", conference_revision: Number(dados.expected_revision) + 1 } };
    }
    throw new Error(`Callable inesperada: ${nome}`);
  },
}));
vi.mock("@/lib/firebase", () => ({ firebaseApp: {} }));
vi.mock("@/lib/firebase-functions", () => ({ functionsDoApp: () => ({}) }));
vi.mock("@/lib/warehouse-rows", () => ({
  fetchWarehouseRows: async () => [
    { id: "A-03", code: "A-03", customer_code: "BTG Pactual", status: "active", sequence: 3, length_m: 1.2, depth_m: 0.7, height_m: 1 },
  ],
}));

import { useDestinoDaCaixa } from "./destino-da-caixa";

const RECEIPT = "inb_avulso_0d0e620b";

const CAIXA = {
  code: "CX-000131",
  status: "reviewed",
  location_id: "",
  lines: [],
  unit_count: 29,
  length_m: 0.48,
  width_m: 0.38,
  height_m: 0.3,
  gross_weight_kg: 9.4,
  allow_tilt: false,
  allow_stacking: true,
  conference_revision: 4,
  refused_positions: [],
} as unknown as CaixaDaChegada;

let destino: ReturnType<typeof useDestinoDaCaixa> | null = null;

function Bancada() {
  destino = useDestinoDaCaixa({
    caixa: CAIXA,
    receiptId: RECEIPT,
    customerCode: "BTG Pactual",
    revisao: 4,
    chave: () => "confirmar-0001",
    anotarRevisao: () => undefined,
    releitura: async () => undefined,
    onConfirmado: () => {
      estado.confirmado = true;
    },
    falhou: (titulo) => (error) => {
      estado.falhas.push(`${titulo}: ${error instanceof Error ? error.message : String(error)}`);
    },
  });
  return null;
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  estado.enviados = [];
  estado.sugestaoFora = true;
  estado.falhas = [];
  estado.confirmado = false;
  destino = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/** A caixa fechada na bancada: a sugestão é pedida ao abrir. */
async function abrirACaixa() {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <Bancada />
      </QueryClientProvider>,
    );
  });
}

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

/** Escolher prateleira › A-03 › Confirmar destino em A-03. */
async function confirmarNaPrateleiraEscolhida() {
  await act(async () => destino!.acoes.onModo("escolha"));
  await act(async () => destino!.acoes.onEscolher("A-03"));
  await esperar(() => destino!.estado.previa?.code === "A-03", "a prévia de A-03");
  const candidato = destino!.estado.previa!;
  await act(async () => destino!.acoes.onConfirmar(candidato));
  await esperar(() => estado.confirmado || estado.falhas.length > 0, "a resposta da confirmação");
}

function confirmacoes() {
  return estado.enviados.filter((envio) => envio.nome === "confirmInboundBoxDestination").map((envio) => envio.dados);
}

/** O que o servidor recebe: o SDK troca o `undefined` por `null` (@firebase/functions, `encode`). */
function comoChegaAoServidor(dados: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(dados, (_chave, valor: unknown) => (valor === undefined ? null : valor))) as Record<string, unknown>;
}

describe("Confirmar destino com a prateleira escolhida", () => {
  it("sem a sugestão do sistema, o pedido não leva a sugestão vazia e a caixa no piso vai sem apoio", async () => {
    await abrirACaixa();
    await esperar(() => Boolean(destino?.estado.erroSugestao), "a sugestão fora do ar");
    expect(destino!.estado.erroSugestao).toBe("Sem conexão. Tente de novo quando o sinal voltar.");

    await confirmarNaPrateleiraEscolhida();

    expect(estado.falhas).toEqual([]);
    expect(confirmacoes()).toHaveLength(1);
    const enviado = confirmacoes()[0]!;
    expect("suggestion" in enviado).toBe(false);
    expect(enviado).toEqual({
      receipt_id: RECEIPT,
      customer_code: "BTG Pactual",
      box_code: "CX-000131",
      expected_revision: 4,
      location_id: "A-03",
      orientation: "length_width_height",
      support_box_code: null,
      idempotency_key: "confirmar-0001",
    });
    // O único null que chega ao servidor é o de propósito.
    const recebido = comoChegaAoServidor(enviado);
    expect(Object.keys(recebido).filter((chave) => recebido[chave] === null)).toEqual(["support_box_code"]);
  });

  it("com a sugestão carregada, a escolha de outra prateleira leva a sugestão do motor junto", async () => {
    estado.sugestaoFora = false;
    await abrirACaixa();
    await esperar(() => destino?.estado.sugestao?.position?.code === "B-02", "a sugestão B-02");

    await confirmarNaPrateleiraEscolhida();

    expect(estado.falhas).toEqual([]);
    const enviado = confirmacoes()[0]!;
    expect(enviado).toMatchObject({
      location_id: "A-03",
      support_box_code: null,
      suggestion: { position: "B-02", reason: "Já tem BTG-000086 nesta prateleira e ainda cabe.", alternatives: ["B-03"], tier: 1 },
    });
    const recebido = comoChegaAoServidor(enviado);
    expect(Object.keys(recebido).filter((chave) => recebido[chave] === null)).toEqual(["support_box_code"]);
  });
});
