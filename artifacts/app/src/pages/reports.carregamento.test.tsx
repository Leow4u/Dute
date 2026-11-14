// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

/**
 * Os Relatórios na primeira leitura (carregamento v2, parte 13d; diagnóstico,
 * seção 4.9 e necessidades 3, 9 e 10). Antes, a prévia dizia "Carregando..."
 * em texto seco, o resumo sumia e a caixa da prévia encolhia e crescia na
 * chegada; a lateral só mostrava os contadores com os dados. Agora a linha de
 * estado diz o relatório que lê, a prévia tem a forma final (o resumo e as
 * linhas-fantasma) e a lateral guarda a casa do número. Relógio simulado.
 * Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ atraso: 30 }));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", publicMetadata: { role: "admin" } }, isLoaded: true }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import Reports from "./reports";

const AGORA = Date.parse("2026-11-13T13:42:00Z");
const SKUS = Array.from({ length: 4 }, (_, i) => ({
  id: `BTG-00000${i + 1}`,
  sku_code: `BTG-00000${i + 1}`,
  client_item_code: `A.01.0806.00${i + 1}.M`,
  product_name: "Polo Masculino Piquet Preto",
  customer_code: "BTG",
  unit_cost: 52,
  min_stock: 5,
}));
const SALDOS = SKUS.map((sku, i) => ({ sku_code: sku.sku_code, customer_code: "BTG", location_id: `A-0${i + 1}`, qty_on_hand: i * 3, qty_reserved: 0, qty_available: i * 3 }));

async function servir(entrada: RequestInfo | URL) {
  const url = new URL(String(entrada instanceof Request ? entrada.url : entrada), "http://localhost");
  await new Promise((pronto) => setTimeout(pronto, estado.atraso));
  const corpo =
    url.pathname === "/api/skus" ? { items: SKUS } : url.pathname === "/api/stock-balances" ? { items: SALDOS } : { items: [], capped: false };
  return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
}

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  estado.atraso = 30;
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  cliente.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function montar() {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={cliente}>
          <Anunciador />
          <Reports />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

const semAnunciador = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return copia.innerHTML;
};
const texto = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};
const linha = () => container.querySelector("[data-linha-de-estado]");
const itemDaLateral = (titulo: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("nav button")).find((botao) => botao.textContent?.includes(titulo));

/** O HTML visto em cada estado, para o axe no fim do teste, com o relógio de verdade (o do jsdom dele). */
const paraOAxe: string[] = [];
async function axeDoQueVimos() {
  vi.useRealTimers();
  for (const html of paraOAxe.splice(0)) expect(await violacoesDeAcessibilidade(html)).toEqual([]);
}

describe("Relatórios, antes de ler", () => {
  it("nunca \"Carregando...\": a linha diz o relatório que lê, a prévia tem o resumo e as linhas-fantasma, e a lateral guarda a casa do número", async () => {
    estado.atraso = 2_000;
    await montar();
    expect(texto()).not.toContain("Carregando...");
    // A casa do número na lateral desde o começo: o número entra sem mexer o item.
    expect(itemDaLateral("Posição de estoque")?.querySelector("[data-esqueleto]")).not.toBeNull();
    expect(itemDaLateral("Abaixo do mínimo")?.querySelector("[data-esqueleto]")).not.toBeNull();
    expect(container.querySelector("[data-fantasmas][data-visivel]")).toBeNull();
    await passar(350);
    expect(linha()?.textContent).toContain("Carregando a posição de estoque…");
    expect(container.querySelectorAll("[data-fantasmas][data-visivel]").length).toBeGreaterThan(0);
    const ocupada = container.querySelector('[aria-busy="true"][aria-describedby]');
    expect(ocupada?.getAttribute("aria-describedby")).toBe(linha()?.id);
    expect(
      textosForaDaLista(semAnunciador(), [
        "Relatórios", "Escolha um relatório, confira a prévia e baixe a planilha. Ela abre direto no Excel.",
        "Carregando a posição de estoque…", "Estoque", "Posição de estoque", "Saldo e valor de cada item", "Abaixo do mínimo",
        "Itens para repor", "Itens parados", "Sem entrada nem saída", "Operação", "Movimentações", "Entradas, saídas e ajustes",
        "Pedidos", "Pedidos e avisos", "Saldo de cada item, onde está e quanto vale. Os mesmos números da tela Estoque.",
        "Baixar planilha",
      ]),
    ).toEqual([]);
    paraOAxe.push(semAnunciador());
    await passar(2_000);
    expect(container.querySelector("[data-fantasmas]")).toBeNull();
    expect(itemDaLateral("Posição de estoque")?.querySelector("[data-esqueleto]")).toBeNull();
    expect(itemDaLateral("Posição de estoque")?.textContent).toMatch(/\d/);
    expect(linha()?.textContent).toMatch(/Atualizado às/);
    await axeDoQueVimos();
  });

  it("cada relatório diz o seu objeto: \"Carregando movimentações…\"", async () => {
    await montar();
    await passar(100);
    estado.atraso = 2_000;
    const movimentacoes = itemDaLateral("Movimentações");
    await act(async () => {
      movimentacoes!.click();
    });
    await passar(350);
    expect(linha()?.textContent).toContain("Carregando movimentações…");
    expect(texto()).not.toContain("Carregando...");
  });
});

describe("Relatórios depois da revisão (parte 13d)", () => {
  it("um brilho só, o da prévia, nunca um por bloco; e o dado chega em cascata", async () => {
    estado.atraso = 2_000;
    await montar();
    await passar(350);
    expect(container.querySelectorAll(".carregando-com-brilho")).toHaveLength(1);
    expect(container.querySelectorAll("[data-esqueleto].carregando-com-brilho")).toHaveLength(0);
    await passar(1_700);
    expect(container.querySelector("[data-fantasmas]")).toBeNull();
    expect(container.querySelector("[data-chegada]")).not.toBeNull();
  });
});
