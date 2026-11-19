// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As rodadas do cliente ao vivo (o registro da rodada, 18/11/2026): a
 * recontagem geral de 17/11, sem documento, é a rodada aberta só do cliente
 * legado (a BTG); outro cliente nem lê as recontagens dela, e a leitura que
 * ele não faz não o deixa esperando.
 */

const lidas = vi.hoisted(() => ({ chaves: [] as Array<string | null>, docs: {} as Record<string, Array<Record<string, unknown>>> }));

vi.mock("@/lib/firebase", () => ({ firestore: {}, firebaseApp: {}, firebaseAuth: null }));
vi.mock("@/lib/operacao/leitura", async (original) => ({
  ...(await original<object>()),
  useLeitura: (chave: string | null, _consulta: unknown, mapear: (id: string, data: Record<string, unknown>) => unknown) => {
    lidas.chaves.push(chave);
    const docs = chave ? lidas.docs[chave] : undefined;
    return { itens: docs ? docs.map((data) => mapear(String(data.id), data)).filter((item) => item !== null) : null, erro: false, tentando: false, tentar: async () => undefined, falta: null, lidaEm: null };
  },
}));

import { LEGACY_CUSTOMER_CODE } from "@/lib/active-customer";

import { RODADA_DA_RECONTAGEM_GERAL } from "./recontagem-por-caixa";
import { useRodadasDaContagem, type LeituraDasRodadas } from "./use-rodadas";

let resultado: LeituraDasRodadas | null = null;
let raiz: Root | null = null;
let container: HTMLDivElement;

function Sonda({ cliente }: { cliente: string | null }) {
  resultado = useRodadasDaContagem(cliente);
  return null;
}

async function montar(cliente: string | null) {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(<Sonda cliente={cliente} />);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  lidas.chaves.length = 0;
  lidas.docs = {};
  resultado = null;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  vi.unstubAllGlobals();
});

describe("as rodadas do cliente ao vivo", () => {
  it("o cliente legado com recontagem no id fixo e sem documento: a recontagem geral é a aberta", async () => {
    lidas.docs[`count_rounds:${LEGACY_CUSTOMER_CODE}`] = [];
    lidas.docs[`cycle_counts:${LEGACY_CUSTOMER_CODE}:${RODADA_DA_RECONTAGEM_GERAL.id}:uma`] = [{ id: "cc_1" }];
    await montar(LEGACY_CUSTOMER_CODE);
    expect(resultado?.carregando).toBe(false);
    expect(resultado?.aberta).toEqual(RODADA_DA_RECONTAGEM_GERAL);
  });

  it("outro cliente nem lê a recontagem geral: não fica preso nela nem esperando por ela", async () => {
    lidas.docs["count_rounds:Outro Cliente"] = [];
    lidas.docs[`cycle_counts:Outro Cliente:${RODADA_DA_RECONTAGEM_GERAL.id}:uma`] = [{ id: "cc_9" }];
    await montar("Outro Cliente");
    expect(resultado?.carregando).toBe(false);
    expect(resultado?.aberta).toBeNull();
    expect(lidas.chaves).not.toContain(`cycle_counts:Outro Cliente:${RODADA_DA_RECONTAGEM_GERAL.id}:uma`);
  });
});
