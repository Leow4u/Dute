// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A ficha ao lado da fila não passa sozinha ao orçamento vizinho. O que
 * está nela e sai do segmento (outra pessoa o enviou) continua nela, como
 * está agora, e "Enviar ao cliente" não manda o vizinho. Antes, a ficha
 * caía no primeiro da fila, e o envio de um clique ia para ele.
 */

type Registro = Record<string, unknown>;

const estado = vi.hoisted(() => ({
  demandas: [] as Array<Record<string, unknown>>,
  orcamentos: [] as Array<Record<string, unknown>>,
  chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }>,
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "u-gui", fullName: "Guilherme", publicMetadata: { role: "comercial" } }, isLoaded: true }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

vi.mock("@/lib/comercial/api", async (original) => ({
  ...(await original<typeof import("@/lib/comercial/api")>()),
  chamarComercial: async (nome: string, dados: Record<string, unknown>) => {
    estado.chamadas.push({ nome, dados });
    return { numero: dados.numero, status: "enviado", etapa: "aguardando_cliente", edicao: 5, rv: 0 };
  },
}));

vi.mock("@/lib/comercial/leitura", () => ({
  useLeitura: (chave: string | null, _consulta: unknown, mapear: (id: string, dados: Registro) => unknown) => {
    const fonte = chave === "demands" ? estado.demandas : chave === "quotes" ? estado.orcamentos : [];
    return { itens: fonte.map((dados) => mapear(String(dados.numero), dados)).filter(Boolean), erro: false };
  },
  useNomes: () => () => null,
  useDocumento: () => ({ dados: null, erro: false }),
}));

import ComercialOrcamentosPage from "./orcamentos";

function demanda(numero: string, extra: Registro = {}): Registro {
  return {
    numero,
    customer_code: "ITAU-UNIBANCO",
    customer_name: "Itaú Unibanco",
    contrato_id: "ct-itau",
    entrada: "comercial",
    canal: "email",
    tipo: "planejada",
    titulo: `Mudança ${numero}`,
    recebida_em: "2026-10-20T11:47:00.000Z",
    origem: { local_id: "loc_ceic", complemento: "6º andar" },
    destino: null,
    execucao: { datas: [], de: null, ate: null, a_definir: true, visita_tecnica: null },
    etapa: "para_enviar",
    etapa_desde: "2026-10-21T11:50:00.000Z",
    marcos: [{ etapa: "para_enviar", em: "2026-10-21T11:50:00.000Z", por_uid: "u-leo" }],
    numero_legado: null,
    perda: null,
    cancelamento: null,
    ...extra,
  };
}

function orcamento(numero: string, extra: Registro = {}): Registro {
  return {
    numero,
    rotulo: numero,
    customer_code: "ITAU-UNIBANCO",
    rv: 0,
    tipo_rv: "proposta",
    status: "aprovado",
    edicao: 4,
    data_base: "2026-10-20",
    tabela: { id: "pt_itau_com", nome: "LPU Itaú v2.0", variante: "Comercial" },
    linhas: [{ id: "ln_1", origem: "tabela", total_cents: 1_000_000, quantidade: "1", preco: "10000" }],
    subtotal_cents: 1_000_000,
    ajustes_cents: 0,
    total_cents: 1_000_000,
    marcas: [],
    autor_uid: "u-gui",
    aprovacao: { por_uid: "u-leo", em: "2026-10-21T11:50:00.000Z", edicao: 4 },
    devolucao: null,
    passo_em: "2026-10-21T11:50:00.000Z",
    ...extra,
  };
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function mostrar() {
  await act(async () => raiz!.render(<ComercialOrcamentosPage />));
  await act(async () => raiz!.render(<ComercialOrcamentosPage />));
}

function naFicha(): string {
  return container!.querySelector('aside[aria-label="Orçamento selecionado"] a')?.textContent ?? "";
}

function botao(texto: string): HTMLButtonElement | undefined {
  return [...container!.querySelectorAll<HTMLButtonElement>('aside[aria-label="Orçamento selecionado"] button')].find((item) => item.textContent?.trim() === texto);
}

beforeEach(() => {
  window.history.replaceState({}, "", "/comercial/orcamentos");
  // A 10045 espera há mais tempo: a fila de "Para enviar" abre nela.
  estado.demandas = [demanda("10045", { etapa_desde: "2026-10-21T10:00:00.000Z" }), demanda("10050")];
  estado.orcamentos = [orcamento("10045"), orcamento("10050")];
  estado.chamadas = [];
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

describe("a ficha ao lado da fila do Comercial", () => {
  it("o orçamento que outra pessoa enviou fica na ficha, e o envio de um clique não vai para o vizinho", async () => {
    await mostrar();
    expect(naFicha()).toBe("10045");
    expect(botao("Enviar ao cliente")).toBeDefined();

    // Outra pessoa enviou a 10045: ela sai de "Para enviar".
    estado.demandas = [demanda("10045", { etapa: "aguardando_cliente", etapa_desde: "2026-10-25T12:00:00.000Z" }), demanda("10050")];
    estado.orcamentos = [orcamento("10045", { status: "enviado", edicao: 5 }), orcamento("10050")];
    await mostrar();
    expect(naFicha()).toBe("10045");
    expect(botao("Enviar ao cliente")).toBeUndefined();
    expect(estado.chamadas).toEqual([]);
  });
});
