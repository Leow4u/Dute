import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { resolveOperationProfile } from "@/lib/operations";

/**
 * Parte 2.7: o Início do portal mostra só as seções das telas que o contrato
 * abre. O perfil é o publicado em client_profiles, com os módulos contratados.
 */

const estado = vi.hoisted(() => ({ modules: ["wms", "financeiro"] as string[] }));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "c1", fullName: "Cliente Teste", publicMetadata: { role: "cliente", customer_code: "ACME" } } }),
}));

vi.mock("@/lib/operation-profile", () => ({
  useOperationProfile: () => ({
    profile: resolveOperationProfile({ customer_code: "ACME", operation_template: "uniformes", modules: estado.modules }),
    isLoading: false,
  }),
}));

vi.mock("./shared", async (original) => ({
  ...(await original<typeof import("./shared")>()),
  ClientDataBoundary: ({ children }: { children: (overview: object) => React.ReactNode }) => <>{children({})}</>,
}));

import { ClienteInicio } from "./inicio";

function render(modules: string[]) {
  estado.modules = modules;
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Router ssrPath="/portal">
        <ClienteInicio />
      </Router>
    </QueryClientProvider>,
  );
}

const DO_ARMAZEM = ["Pedir itens do estoque", "Avisar um envio", "Pedidos em andamento", "Envios a caminho", "Seu estoque"];

describe("Início do portal pelos módulos contratados", () => {
  it("armazenagem e faturas (o padrão): tudo como hoje", () => {
    const html = render(["wms", "financeiro"]);
    for (const texto of [...DO_ARMAZEM, "Faturas"]) expect(html, texto).toContain(texto);
  });

  it("só a Operação: nada do armazém, do Agent Dute nem das faturas", () => {
    const html = render(["operacao"]);
    for (const texto of [...DO_ARMAZEM, "Faturas"]) expect(html, texto).not.toContain(texto);
    expect(html).not.toContain('href="/portal/agente');
    expect(html).toContain("Olá, Cliente");
  });

  it("armazenagem sem financeiro: sem o painel de faturas", () => {
    const html = render(["wms", "operacao"]);
    for (const texto of DO_ARMAZEM) expect(html, texto).toContain(texto);
    expect(html).not.toContain('href="/portal/faturas"');
  });

  it("só o financeiro: as faturas e mais nada do armazém", () => {
    const html = render(["financeiro"]);
    expect(html).toContain('href="/portal/faturas"');
    for (const texto of DO_ARMAZEM) expect(html, texto).not.toContain(texto);
  });
});
