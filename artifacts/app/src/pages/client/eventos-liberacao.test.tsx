// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import type { ClientEvent } from "@/lib/client-events";

/**
 * O Eventos novo do portal só com a liberação dos Eventos (EVENTOS_LIBERADO,
 * só a homologação até a parte 12): fora dela, a tela de hoje, com "Usar no
 * pedido"; com ela, a lista nova, com "Novo evento". Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ liberado: false }));

const MODELO: ClientEvent = {
  id: "ev_1",
  name: "Feira de Investimentos",
  description: null,
  venue: "Expo Center Norte",
  address: null,
  next_date: "2026-12-10",
  schedule: null,
  logistics: null,
  items: [],
};

vi.mock("@/lib/liberacao", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/liberacao")>();
  return {
    ...original,
    get EVENTOS_LIBERADO() {
      return estado.liberado;
    },
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { publicMetadata: { customer_code: "BTG", role: "cliente" } }, isLoaded: true }) }));
vi.mock("@/lib/operation-profile", () => ({ useOperationProfile: () => ({ profile: { modules: ["wms"] } }) }));
vi.mock("@/lib/eventos/use-eventos", () => {
  const aoVivo = { erro: false, tentando: false, tentar: () => undefined, falta: null, lidaEm: null, itens: [] };
  return { useEventosDoCliente: () => aoVivo, useEdicoesDoCliente: () => aoVivo, usePrecosDoCliente: () => aoVivo, useEdicaoDoEvento: () => ({ ...aoVivo, edicao: undefined }) };
});
vi.mock("./events-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./events-api")>();
  return { ...original, useClientEvents: () => ({ isLoading: false, isError: false, isFetching: false, data: [MODELO], refetch: async () => undefined }) };
});
vi.mock("./shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("./shared")>();
  return { ...original, ClientDataBoundary: ({ children }: { children: (overview: Record<string, unknown>) => React.ReactNode }) => <>{children({})}</> };
});

import { ClienteEventos } from "./eventos";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function abrir() {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  const memoria = memoryLocation({ path: "/portal/eventos" });
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Router hook={memoria.hook} searchHook={memoria.searchHook}>
          <ClienteEventos />
        </Router>
      </QueryClientProvider>,
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Portal › Eventos com e sem a liberação", () => {
  it("sem a liberação, a tela de hoje: 'Usar no pedido' e nada de 'Novo evento'", async () => {
    estado.liberado = false;
    await abrir();
    expect(container!.textContent).toContain("Usar no pedido");
    expect(container!.textContent).not.toContain("Novo evento");
  });

  it("com a liberação, a lista nova: 'Novo evento' e nada de 'Usar no pedido'", async () => {
    estado.liberado = true;
    await abrir();
    expect(container!.textContent).toContain("Novo evento");
    expect(container!.textContent).not.toContain("Usar no pedido");
  });
});
