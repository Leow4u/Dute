// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O "Registrar movimentação" abre com a hora de agora no fuso do aparelho,
 * que é como o campo datetime-local mostra e como o envio lê. Antes, abria
 * com a hora de Greenwich lida como local (três horas à frente em São
 * Paulo; às 21h30 do último dia, o ajuste caía no mês seguinte), congelada
 * na hora em que a tela montou.
 */

vi.mock("@workspace/api-client-react", () => ({
  useCreateMovement: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "op-1", fullName: "Operador", publicMetadata: { role: "interno" } }, isLoaded: true }),
}));

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG Pactual", isLoading: false }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { MovementModal } from "./movements";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

const campoDaData = () => document.querySelector<HTMLInputElement>("input#data");

async function abrirOFormulario() {
  const abrir = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Registrar Movimentação"));
  if (!abrir) throw new Error("Sem o botão Registrar Movimentação");
  await act(async () => abrir.click());
  if (!campoDaData()) throw new Error("O formulário não abriu");
}

beforeAll(() => {
  // São Paulo, sem horário de verão desde 2019: três horas atrás de Greenwich.
  vi.stubEnv("TZ", "America/Sao_Paulo");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  vi.useRealTimers();
});

describe("a data do Registrar movimentação", () => {
  it("abre com a hora de agora em São Paulo, mesmo com a tela montada antes", async () => {
    // A tela monta às 11h30 de São Paulo.
    vi.setSystemTime(new Date("2026-10-25T14:30:00.000Z"));
    await act(async () =>
      raiz!.render(
        <QueryClientProvider client={new QueryClient()}>
          <MovementModal />
        </QueryClientProvider>,
      ),
    );

    // O ajuste é registrado às 21h30 de 31/10, com a tela aberta desde a manhã.
    vi.setSystemTime(new Date("2026-11-01T00:30:00.000Z"));
    await abrirOFormulario();
    expect(campoDaData()!.value).toBe("2026-10-31T21:30");
  });
});
