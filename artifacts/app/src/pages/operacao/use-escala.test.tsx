// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OsDaFila } from "@/lib/operacao/fila";

/**
 * O painel Escalar/Reagendar grava com a edição de quando abriu: se outra
 * tela reagendou a OS nesse meio-tempo, o servidor recusa, em vez de o
 * formulário velho (data, equipe e veículo de antes) apagar a mudança.
 */

const estado = vi.hoisted(() => ({ chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }> }));

vi.mock("@/lib/operacao/api", async (original) => ({
  ...(await original<typeof import("@/lib/operacao/api")>()),
  chamarOperacao: async (nome: string, dados: Record<string, unknown>) => {
    estado.chamadas.push({ nome, dados });
    return {};
  },
}));

import { useEscala } from "./use-escala";

const CARLOS = "col_cccccccccccccccc";
const PEDRO = "col_pppppppppppppppp";
const V1 = "vei_1111111111111111";
const V2 = "vei_2222222222222222";

function os(edicao: number, agenda: Partial<NonNullable<OsDaFila["agenda"]>> = {}): OsDaFila {
  return {
    numero: "10045-01",
    demanda: "10045",
    customer_code: "ITAU",
    status: "agendada",
    edicao,
    itens: [],
    agenda: { data: "2026-10-27", hora: "08:00", fim: null, equipe: [CARLOS], veiculos: [V1], ...agenda },
  };
}

let painel: ReturnType<typeof useEscala> | null = null;
let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

function Painel({ lista }: { lista: OsDaFila[] }) {
  painel = useEscala({ lista, pessoas: [], veiculos: [], nomesClientes: {}, hoje: "2026-10-25" });
  return null;
}

async function mostrar(lista: OsDaFila[]) {
  await act(async () => raiz!.render(<Painel lista={lista} />));
}

function acoes() {
  return (painel!.escala!.conteudo as ReactElement<{ onSalvar: () => void; onCancelar: () => void }>).props;
}

beforeEach(() => {
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
  painel = null;
});

describe("o painel Escalar/Reagendar e a OS que mudou por outra tela", () => {
  it("reagendar leva a edição de quando o painel abriu, não a da lista ao vivo", async () => {
    await mostrar([os(3)]);
    act(() => painel!.escalar(os(3)));
    // Outra pessoa reagendou a OS para 28/10, com Pedro e o V2: a lista ao vivo traz a edição 4.
    await mostrar([os(4, { data: "2026-10-28", equipe: [PEDRO], veiculos: [V2] })]);
    await act(async () => acoes().onSalvar());
    expect(estado.chamadas).toHaveLength(1);
    expect(estado.chamadas[0].dados).toMatchObject({ action: "schedule", numero: "10045-01", expected_edicao: 3 });
  });

  it("cancelar também leva a edição de quando o painel abriu", async () => {
    await mostrar([os(3)]);
    act(() => painel!.escalar(os(3)));
    await mostrar([os(4, { data: "2026-10-28" })]);
    await act(async () => acoes().onCancelar());
    expect(estado.chamadas[0].dados).toMatchObject({ action: "cancel", numero: "10045-01", expected_edicao: 3 });
  });
});
