// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A chegada avulsa acha o produto pelo código em todo o catálogo do cliente
 * ativo. A lista da API devolve a página padrão (50 linhas,
 * DEFAULT_LIST_LIMIT em lib/cloud-api.ts, os maiores códigos primeiro)
 * quando a tela não pede um limite, e a busca lia só essa página: em
 * 30/10/2026 o A.01.0806.005.GG (BTG-000090) ficou fora dela, a pessoa
 * cadastrou como novo e as Functions recusaram com "já existe no cadastro
 * com SKU BTG-000090". A Contagem e as devoluções já pediam o catálogo
 * inteiro.
 */

const estado = vi.hoisted(() => {
  const PAGINA_PADRAO = 50;
  // 200 SKUs: a página padrão são os 50 maiores (BTG-000151 a 200), e o BTG-000090 fica fora dela.
  const catalogo = Array.from({ length: 200 }, (_, indice) => {
    const numero = String(indice + 1).padStart(3, "0");
    const sku = `BTG-000${numero}`;
    const codigo = `A.01.0806.${numero}.GG`;
    return {
      sku: { id: sku, cod_btg: sku, sku_code: sku, cod_cliente: codigo, cod_cliente_key: codigo, produto: `Camisa ${codigo}`, customer_code: "BTG Pactual", estoque_atual: 0 },
      produto: { id: codigo, cod_cliente: codigo, cod_cliente_key: codigo, produto: `Camisa ${codigo}`, customer_code: "BTG Pactual" },
    };
  });
  return { PAGINA_PADRAO, catalogo, chamadas: [] as string[] };
});

vi.mock("@/lib/warehouse-ops/model", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/warehouse-ops/model")>();
  return {
    ...original,
    // A lista da API: a página pedida em `limit`, ou a padrão, em ordem
    // decrescente de código (como a rota de lib/cloud-api.ts).
    fetchJson: async (url: string) => {
      estado.chamadas.push(url);
      const { pathname, searchParams } = new URL(url, "http://dute.local");
      const limite = Number(searchParams.get("limit")) || estado.PAGINA_PADRAO;
      const decrescente = [...estado.catalogo].reverse();
      if (pathname === "/api/skus") {
        return { items: decrescente.map((item) => item.sku).slice(0, limite), total: estado.catalogo.length };
      }
      if (pathname === "/api/products") {
        return { items: decrescente.map((item) => item.produto).slice(0, limite), total: estado.catalogo.length };
      }
      throw new Error(`Chamada inesperada: ${url}`);
    },
  };
});

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({
    code: "BTG Pactual",
    active: { code: "BTG Pactual", name: "BTG" },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { UnplannedReceiptDialog } from "./receiving";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 50; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

function campo(rotulo: string) {
  const elemento = document.querySelector<HTMLInputElement>(`input[aria-label="${rotulo}"]`);
  if (!elemento) throw new Error(`Sem o campo ${rotulo}`);
  return elemento;
}

async function digitar(rotulo: string, valor: string) {
  const elemento = campo(rotulo);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(elemento, valor);
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  estado.chamadas.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient()}>
        <UnplannedReceiptDialog open isPending={false} onOpenChange={() => undefined} onCreate={() => undefined} />
      </QueryClientProvider>,
    ),
  );
  await esperar(
    () => estado.chamadas.some((url) => url.startsWith("/api/skus")) && estado.chamadas.some((url) => url.startsWith("/api/products")),
    "a leitura do catálogo",
  );
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
});

describe("a busca de produto da chegada avulsa", () => {
  it("pede o catálogo inteiro do cliente, não a página padrão da API", () => {
    const limites = estado.chamadas.map((url) => Number(new URL(url, "http://dute.local").searchParams.get("limit")));
    expect(limites).toHaveLength(2);
    // CATALOG_READ_CAP (lib/cloud-api.ts) corta em 2000; pedir menos esconde produto.
    for (const limite of limites) expect(limite).toBeGreaterThanOrEqual(2000);
  });

  it("acha pelo código do cliente um produto fora da página de 50 e mostra o SKU dele", async () => {
    await digitar("Código do produto da linha 1", "A.01.0806.090.GG");
    await esperar(() => campo("SKU da linha 1").value === "BTG-000090", "o cadastro encontrado");
    expect(document.body.textContent).toContain("Cadastro encontrado");
    expect(document.body.textContent).not.toContain("Identificação pendente");
  });
});

describe("as buscas de catálogo das telas do WMS", () => {
  it("toda leitura de /api/skus e /api/products de um formulário pede o limite", () => {
    for (const arquivo of ["./receiving.tsx", "./inventory.tsx", "./exceptions.tsx"]) {
      const fonte = readFileSync(new URL(arquivo, import.meta.url), "utf8");
      const leituras = [...fonte.matchAll(/fetchJson<unknown>\("\/api\/(?:skus|products)([^"]*)"\)/g)];
      expect(leituras.length, arquivo).toBeGreaterThan(0);
      for (const leitura of leituras) expect(leitura[1], `${arquivo}: ${leitura[0]}`).toMatch(/^\?limit=\d+$/);
    }
  });
});
