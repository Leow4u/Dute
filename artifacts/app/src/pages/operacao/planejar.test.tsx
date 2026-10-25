// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Planejar com o formulário aberto enquanto outro plano gasta o saldo de uma
 * linha: a linha fica no plano, e a conferência diz que as OS passam do
 * saldo. Antes, ela sumia da grade e do pedido, e o plano gravava sem ela.
 */

const estado = vi.hoisted(() => ({
  ordens: [] as Array<{ id: string; dados: Record<string, unknown> }>,
  chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }>,
}));

vi.mock("@/lib/liberacao", async (original) => ({
  ...(await original<typeof import("@/lib/liberacao")>()),
  MEMORIA_LIBERADA: false,
}));

vi.mock("@/lib/memoria/use-sugestoes", () => ({ useSugestoes: () => [] }));

vi.mock("@/lib/operacao/api", async (original) => ({
  ...(await original<typeof import("@/lib/operacao/api")>()),
  chamarOperacao: async (nome: string, dados: Record<string, unknown>) => {
    estado.chamadas.push({ nome, dados });
    return { numeros: ["10045-01"] };
  },
}));

vi.mock("@/lib/operacao/leitura", () => ({
  useDocumento: (chave: string | null, _referencia: unknown, mapear: (id: string, dados: Record<string, unknown>) => unknown) => ({
    item:
      chave === "demands/10045"
        ? mapear("10045", {
            customer_code: "ITAU",
            customer_name: "Itaú Unibanco",
            titulo: "Mudança do 6º para o 9º andar",
            tipo: "planejada",
            entrada: "comercial",
            etapa: "aguardando_autorizacao",
            escopo: [
              { linha_id: "ln_mesas", item: "Mesa", quantidade: "20", unidade: "UN" },
              { linha_id: "ln_cadeiras", item: "Cadeira", quantidade: "40", unidade: "UN" },
            ],
          })
        : null,
    erro: false,
  }),
  useLeitura: (chave: string | null, _consulta: unknown, mapear: (id: string, dados: Record<string, unknown>) => unknown) => ({
    itens: chave === "service_orders" ? estado.ordens.map((os) => mapear(os.id, os.dados)).filter(Boolean) : [],
    erro: false,
  }),
}));

import PaginaPlanejar from "./planejar";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function mostrar() {
  await act(async () => raiz!.render(<PaginaPlanejar />));
  await act(async () => raiz!.render(<PaginaPlanejar />));
}

async function clicar(texto: string) {
  const botao = [...container!.querySelectorAll("button")].find((item) => item.textContent?.trim() === texto);
  if (!botao) throw new Error(`Sem o botão ${texto}`);
  await act(async () => botao.click());
}

beforeEach(() => {
  window.history.replaceState({}, "", "/operacao/planejar?demanda=10045");
  estado.ordens = [];
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

describe("o plano e o saldo que outro plano gastou", () => {
  it("a linha zerada por outro plano fica, e a conferência recusa o plano", async () => {
    await mostrar();
    expect(container!.textContent).toContain("Mesa");

    // Outra pessoa planejou as 20 mesas numa OS.
    estado.ordens = [
      { id: "10045-01", dados: { status: "aberta", edicao: 1, demanda: "10045", customer_code: "ITAU", itens: [{ id: "ln_mesas", item: "Mesa", planejado: "20" }] } },
    ];
    await mostrar();
    await clicar("Salvar rascunho");
    expect(estado.chamadas).toEqual([]);
    expect(container!.textContent).toContain("Mesa: as OS somam 20 e o saldo é 0.");
  });
});
