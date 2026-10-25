// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O convite de cliente só sai com o cliente escolhido: o que vem do
 * "Convidar" de Configurações › Clientes ou o que a pessoa escolhe. Antes,
 * sem escolha, ia o primeiro da lista, ou a BTG enquanto a lista carregava ou
 * quando ela falhava, e quem recebia o link entrava no portal de um cliente
 * que ninguém tinha escolhido.
 */

const estado = vi.hoisted(() => ({
  convites: [] as Array<Record<string, unknown>>,
  clientesFalham: false,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListBillingUsers: () => ({ data: { items: [] }, isLoading: false }),
  getListBillingUsersQueryKey: () => ["billing-users"],
  useUpdateUserRole: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "owner-a", publicMetadata: { role: "owner" } }, isLoaded: true }),
}));

vi.mock("@/lib/firebase", () => ({ firestore: null }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import Users from "./users";

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 100; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

const criar = () =>
  [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Criar convite e copiar link") ?? null;

async function digitar(id: string, valor: string) {
  const campo = document.querySelector<HTMLInputElement>(`input#${id}`);
  if (!campo) throw new Error(`Sem o campo ${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function abrirOConvite(busca: string) {
  window.history.replaceState({}, "", `/configuracoes/usuarios${busca}`);
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <Users />
      </QueryClientProvider>,
    ),
  );
  await esperar(() => criar() !== null, "o formulário do convite");
  await digitar("invite-nome", "Paula Souza");
  await digitar("invite-email", "paula@itau.com.br");
  // A lista de clientes chegou (ou falhou).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

async function tentarCriar() {
  await act(async () => {
    criar()!.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await act(async () => {
    document.querySelector<HTMLFormElement>("form#invite-form")?.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

beforeEach(() => {
  estado.convites = [];
  estado.clientesFalham = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      if (url.pathname === "/api/customers") {
        if (estado.clientesFalham) return json({ message: "Falha ao listar" }, 500);
        return json({
          items: [
            { id: "Itau", code: "Itau", name: "Itaú Unibanco", sku_prefix: "ITAU" },
            { id: "BTG_Pactual", code: "BTG Pactual", name: "BTG Pactual", sku_prefix: "BTG" },
          ],
        });
      }
      if (url.pathname === "/api/invites" && init?.method === "POST") {
        estado.convites.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return json({ ok: true }, 201);
      }
      return json({});
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("o cliente do convite", () => {
  it("sem cliente escolhido, o convite não sai com o primeiro da lista", async () => {
    await abrirOConvite("?convidar=cliente");
    expect(criar()!.disabled).toBe(true);
    await tentarCriar();
    expect(estado.convites).toEqual([]);
  });

  it("com a lista de clientes falhando, o convite não sai para a BTG", async () => {
    estado.clientesFalham = true;
    await abrirOConvite("?convidar=cliente");
    await tentarCriar();
    expect(estado.convites).toEqual([]);
  });

  it("o cliente que vem do Convidar de Configurações › Clientes vale como escolhido", async () => {
    await abrirOConvite("?convidar=cliente&cliente=Itau");
    await tentarCriar();
    expect(estado.convites.map((convite) => convite.customer_code)).toEqual(["Itau"]);
  });
});
