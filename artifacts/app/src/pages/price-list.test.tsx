import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Tabela de preços só se afirma depois de lida
 * (docs/plataforma/diagnostico-carregamento.md, decisão 6 de 06/11/2026):
 * antes, "Nenhum serviço na tabela" aparecia enquanto a lista carregava e
 * também quando ela falhava, e a cobrança vazia podia ser salva antes de a
 * configuração chegar, com a taxa 0.
 */

const estado = vi.hoisted(() => ({
  lista: { data: undefined as unknown, isLoading: true, isError: false, isFetching: true, refetch: () => undefined },
  config: { data: undefined as unknown, isLoading: true, isError: false, isFetching: true, refetch: () => undefined },
}));

vi.mock("@workspace/api-client-react", () => {
  const mutacao = () => ({ mutate: () => undefined, isPending: false });
  return {
    useListPriceList: () => estado.lista,
    getListPriceListQueryKey: () => ["price-list"],
    useCreatePriceListItem: mutacao,
    useUpdatePriceListItem: mutacao,
    useDeletePriceListItem: mutacao,
    useGetBillingConfig: () => estado.config,
    getGetBillingConfigQueryKey: () => ["billing-config"],
    useUpdateBillingConfig: mutacao,
  };
});

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import PriceList from "./price-list";

function tela() {
  const client = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PriceList />
    </QueryClientProvider>,
  );
}

const CONFIG = { id: 1, ad_valorem_rate: 0.005, cliente_nome: "BTG", cliente_email: "fatura@btg.com" };

beforeEach(() => {
  estado.lista = { data: undefined, isLoading: true, isError: false, isFetching: true, refetch: () => undefined };
  estado.config = { data: undefined, isLoading: true, isError: false, isFetching: true, refetch: () => undefined };
});

describe("a Tabela de preços antes de ler", () => {
  it("carregando, diz que está carregando e não que a tabela está vazia", () => {
    const html = tela();
    expect(html).toContain("Carregando serviços...");
    expect(html).not.toContain("Nenhum serviço na tabela");
  });

  it("com a leitura que falhou, diz que não conseguiu e oferece a nova tentativa", () => {
    estado.lista = { data: undefined, isLoading: false, isError: true, isFetching: false, refetch: () => undefined };
    const html = tela();
    expect(html).toContain("Não consegui carregar a tabela.");
    expect(html).toContain("Tentar de novo");
    expect(html).not.toContain("Nenhum serviço na tabela");
  });

  it("lida e vazia, diz que não há serviço", () => {
    estado.lista = { data: { items: [] }, isLoading: false, isError: false, isFetching: false, refetch: () => undefined };
    expect(tela()).toContain("Nenhum serviço na tabela");
  });

  it("a cobrança só salva depois de a configuração chegar", () => {
    expect(tela()).toMatch(/<button[^>]*disabled=""[^>]*>Salvar cobrança<\/button>/);
    expect(tela()).toMatch(/<input[^>]*id="billing-rate"[^>]*disabled=""/);
    estado.config = { data: CONFIG, isLoading: false, isError: false, isFetching: false, refetch: () => undefined };
    expect(tela()).not.toMatch(/<button[^>]*disabled=""[^>]*>Salvar cobrança<\/button>/);
    expect(tela()).not.toMatch(/<input[^>]*id="billing-rate"[^>]*disabled=""/);
  });

  it("com a configuração que não veio, diz que não conseguiu em vez de mostrar a cobrança vazia", () => {
    estado.config = { data: undefined, isLoading: false, isError: true, isFetching: false, refetch: () => undefined };
    const html = tela();
    expect(html).toContain("Não consegui carregar a cobrança.");
    expect(html).not.toContain("Salvar cobrança");
  });
});
