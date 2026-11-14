// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

/**
 * A bancada de Separar (e o pedido separado, que abre por ela) e a lista de
 * separação na primeira visita sem rede (revisão da parte 13l). A fila do
 * armazém falhou sem nada lido, e a tela diz "Sem conexão." com "Tentar de
 * novo". O toque relia a fila do zero, e o react-query volta a leitura sem
 * dado a "pending": a tela trocava o aviso pela espera e o trazia de volta no
 * mesmo quadro, e o foco ia do botão ao título da página. Agora a falha fica
 * na tela enquanto tenta de novo, com o foco no botão. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ leiturasDaFila: 0 }));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", fullName: "Guilherme Dantas", publicMetadata: { role: "admin" } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ options: [], code: "BTG", isLoading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
// As escutas não chegam a abrir: sem a fila, a bancada não sabe qual pedido ler.
vi.mock("@/lib/operacao/leitura", async (original) => ({
  ...(await original<object>()),
  useLeitura: () => ({ itens: null, erro: false, tentando: false, tentar: () => Promise.resolve(), falta: null, lidaEm: null }),
  useDocumento: () => ({ item: undefined, erro: false, tentando: false, tentar: () => Promise.resolve(), falta: null, lidaEm: null }),
}));
vi.mock("@/lib/use-item-photos", () => ({ useItemPhotos: () => () => null, useCatalogoDeSkus: () => ({ data: { items: [] }, isError: false, isPending: false }) }));

import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { SemConexao } from "@/lib/conexao";
import { conexaoEm } from "@/test/conexao";

import PaginaPedidosLista from "./pedidos-lista";
import PaginaPedidosSeparar from "./pedidos-separar";

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.leiturasDaFila = 0;
  // Sem rede: toda leitura falha, depois de alguns milissegundos (o navegador que desiste do pedido).
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      if (new URL(String(entrada), "http://localhost").pathname === "/api/warehouse/ops") estado.leiturasDaFila += 1;
      await new Promise((pronto) => setTimeout(pronto, 20));
      throw new SemConexao();
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  cliente.clear();
  vi.unstubAllGlobals();
});

const aviso = () => container.querySelector<HTMLElement>("[data-falha-na-leitura]");
const tentar = () => aviso()?.querySelector<HTMLButtonElement>("button") ?? null;

const PAGINAS: Array<[string, string, () => ReactElement]> = [
  ["a bancada de Separar", "/pedidos/separar?pedido=ord_1", () => <PaginaPedidosSeparar />],
  ["a lista de separação", "/pedidos/lista?pedido=ord_1", () => <PaginaPedidosLista />],
];

describe("a primeira visita sem rede e o Tentar de novo (revisão da parte 13l)", () => {
  for (const [nome, caminho, pagina] of PAGINAS) {
    it(`${nome}: o aviso da conexão fica na tela enquanto tenta de novo, com o foco no botão`, async () => {
      window.history.replaceState(null, "", caminho);
      raiz = createRoot(container);
      await act(async () => {
        raiz!.render(
          <ProvedorDaConexao value={conexaoEm("sem-conexao")}>
            <QueryClientProvider client={cliente}>
              <Router>{pagina()}</Router>
            </QueryClientProvider>
          </ProvedorDaConexao>,
        );
      });
      await vi.waitFor(() => expect(aviso()?.textContent).toContain("Sem conexão."), { timeout: 3_000 });
      const botao = tentar()!;
      const primeiro = aviso();
      botao.focus();
      const leituras = estado.leiturasDaFila;
      await act(async () => botao.click());
      await vi.waitFor(() => expect(estado.leiturasDaFila).toBeGreaterThan(leituras), { timeout: 3_000 });
      await vi.waitFor(() => expect(cliente.isFetching()).toBe(0), { timeout: 3_000 });
      // O mesmo aviso, sem sair e voltar, com o foco no "Tentar de novo" que a pessoa tocou.
      expect(aviso()).toBe(primeiro);
      expect(aviso()?.textContent).toContain("Sem conexão.");
      expect(document.activeElement).toBe(tentar());
    });
  }
});
