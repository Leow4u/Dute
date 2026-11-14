import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { textosDaTela } from "@/test/textos";

/**
 * O Início da Armazenagem com o painel (`useGetDashboard`) ainda sem dado:
 * antes, "SKUs em estoque" mostrava 0 enquanto ele carregava ou quando falhava
 * (docs/plataforma/diagnostico-carregamento.md, decisão 6 de 06/11/2026).
 */

const estado = vi.hoisted(() => ({ painel: { data: undefined as unknown, isLoading: true, isError: false } }));

vi.mock("@workspace/api-client-react", () => ({ useGetDashboard: () => estado.painel }));
vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { fullName: "Sandra Melo", publicMetadata: { role: "owner" } } }),
}));
vi.mock("@/lib/use-inicio-do-wms", () => ({
  useInicioDoWms: () => ({
    items: [],
    carregando: false,
    falhas: [],
    summary: { toPick: 3, toShip: 1, inTransit: 2, openReceipts: 4 },
  }),
}));

import Home from "./home";

function html() {
  return renderToStaticMarkup(<Router ssrPath="/dashboard"><Home /></Router>);
}

function skus() {
  const textos = textosDaTela(html());
  return textos[textos.indexOf("SKUs em estoque") + 1];
}

/** A linha "SKUs em estoque" inteira, do rótulo ao fim do item. */
function linhaDosSkus() {
  return html().match(/SKUs em estoque<\/span>.*?<\/li>/)?.[0] ?? "";
}

beforeEach(() => {
  estado.painel = { data: undefined, isLoading: true, isError: false };
});

describe("o total de SKUs do Início", () => {
  it("carregando, mostra o bloco do esqueleto, e não 0 nem — (parte 13e)", () => {
    expect(skus()).toBeUndefined();
    expect(linhaDosSkus()).toContain('data-esqueleto=""');
    expect(linhaDosSkus()).not.toContain(">0<");
  });

  it("com a leitura que falhou, mostra — e não 0", () => {
    estado.painel = { data: undefined, isLoading: false, isError: true };
    expect(skus()).toBe("—");
  });

  it("lido, mostra o total", () => {
    estado.painel = { data: { total_skus: 128 }, isLoading: false, isError: false };
    expect(skus()).toBe("128");
  });
});
