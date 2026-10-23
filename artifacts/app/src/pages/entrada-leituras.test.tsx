// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

/**
 * Parte 2.4: a entrada e os menus contam pelas mesmas leituras dos Inícios, e
 * só dos módulos que a pessoa abre. Aqui o Firestore e o fetch são espiões:
 * o teste conta o que cada papel pede.
 */

const leituras = vi.hoisted(() => ({
  assinadas: [] as string[],
  lidas: [] as string[],
  usuario: { uid: "u-1", fullName: "Pessoa Teste", publicMetadata: { role: "owner" as string } },
}));

vi.mock("@/lib/liberacao", async (original) => ({
  ...(await original<typeof import("@/lib/liberacao")>()),
  COMERCIAL_LIBERADO: true,
  OPERACAO_LIBERADO: true,
  PLATAFORMA_LIBERADA: true,
}));

vi.mock("@/lib/firebase", () => ({ firestore: { falso: true }, firebaseAuth: null }));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: leituras.usuario, isLoaded: true }),
  useAppAuth: () => ({ signOut: async () => undefined }),
}));

vi.mock("firebase/firestore", () => {
  const caminho = (alvo: { caminho?: string }) => alvo.caminho ?? "?";
  return {
    collection: (_db: unknown, ...partes: string[]) => ({ caminho: partes.join("/") }),
    query: (alvo: { caminho: string }) => alvo,
    where: () => ({}),
    documentId: () => "__name__",
    Timestamp: { fromDate: (data: Date) => data },
    onSnapshot: (alvo: { caminho: string }) => {
      leituras.assinadas.push(caminho(alvo));
      return () => undefined;
    },
    getDocs: async (alvo: { caminho: string }) => {
      leituras.lidas.push(caminho(alvo));
      return { docs: [] };
    },
  };
});

import EntradaPage from "./entrada";
import { useInicioDaOperacao } from "@/lib/operacao/use-inicio";
import { useInicioDoComercial } from "@/lib/comercial/use-inicio";
import { entrada } from "@/lib/platform-modules";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
const fetchs: string[] = [];

beforeEach(() => {
  leituras.assinadas.length = 0;
  leituras.lidas.length = 0;
  fetchs.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetchs.push(url);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

async function montar(no: React.ReactNode) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <Router ssrPath="/">{no}</Router>
      </QueryClientProvider>,
    );
  });
  // Deixa as consultas do react-query saírem.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function Operacao({ role }: { role: string }) {
  useInicioDaOperacao(role as never);
  return null;
}

function Comercial({ role }: { role: string }) {
  useInicioDoComercial(role as never, "u-1");
  return null;
}

describe("leituras dos Inícios por papel", () => {
  it("o papel comercial não assina nada da Operação; o interno assina as seis coleções (com as solicitações do portal, parte 4.4c)", async () => {
    await montar(<Operacao role="comercial" />);
    expect(leituras.assinadas).toEqual([]);
    act(() => raiz!.unmount());
    raiz = createRoot(container!);
    await montar(<Operacao role="interno" />);
    expect([...leituras.assinadas].sort()).toEqual(["collaborators", "customers", "demands", "service_orders", "service_requests", "vehicles"]);
  });

  it("o interno não consulta nada do Comercial", async () => {
    await montar(<Comercial role="interno" />);
    expect(leituras.lidas).toEqual([]);
  });

  it("a entrada do owner sem Operação nos cards não assina a Operação, e lê o Comercial e o WMS", async () => {
    leituras.usuario.publicMetadata.role = "owner";
    const decisao = entrada("owner", null, true, false);
    if (decisao.kind !== "cards") throw new Error("owner deveria ver cards");
    expect(decisao.modules.map((item) => item.module.key)).not.toContain("operacao");
    await montar(<EntradaPage decision={decisao} />);
    expect(leituras.assinadas).toEqual([]);
    expect(leituras.lidas).toContain("demands");
    expect(fetchs).toContain("/api/warehouse/ops");
  });

  it("a entrada do interno lê a Operação e o WMS, e nada do Comercial", async () => {
    leituras.usuario.publicMetadata.role = "interno";
    const decisao = entrada("interno", null, false, true);
    if (decisao.kind !== "cards") throw new Error("interno deveria ver cards");
    await montar(<EntradaPage decision={decisao} />);
    expect(leituras.assinadas.length).toBeGreaterThan(0);
    expect(leituras.lidas).toEqual([]);
    expect(fetchs).toContain("/api/warehouse/ops");
  });
});
