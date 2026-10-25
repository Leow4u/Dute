// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O "Registrar movimentação" enviado de novo depois da resposta perdida (o
 * servidor gravou o movimento e a tela recebeu a falha) repete a chave, e o
 * servidor devolve o movimento gravado. Antes, cada clique saía com uma
 * chave nova: o segundo lançava o saldo de novo.
 */

const estado = vi.hoisted(() => ({
  envios: [] as Array<Record<string, unknown>>,
  perdidas: 0,
}));

type Opcoes = { onSuccess?: () => void; onError?: (erro: Error) => void };

vi.mock("@workspace/api-client-react", () => ({
  useCreateMovement: () => ({
    isPending: false,
    mutate: (variaveis: { data: Record<string, unknown> }, opcoes: Opcoes) => {
      estado.envios.push(variaveis.data);
      if (estado.perdidas > 0) {
        estado.perdidas -= 1;
        opcoes.onError?.(new Error("Falha interna no servidor. Tente novamente ou avise o time técnico."));
        return;
      }
      opcoes.onSuccess?.();
    },
  }),
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

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 50; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

async function digitar(id: string, valor: string) {
  const campo = document.querySelector<HTMLInputElement>(`input#${id}`);
  if (!campo) throw new Error(`Sem o campo ${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function registrar() {
  const antes = estado.envios.length;
  const enviar = document.querySelector<HTMLButtonElement>('form button[type="submit"]');
  if (!enviar) throw new Error("Sem o botão de registrar");
  await act(async () => enviar.click());
  await esperar(() => estado.envios.length > antes, "o envio");
  return estado.envios.at(-1)!;
}

beforeEach(async () => {
  estado.envios = [];
  estado.perdidas = 1;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient()}>
        <MovementModal />
      </QueryClientProvider>,
    ),
  );
  const abrir = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Registrar Movimentação"));
  await act(async () => abrir!.click());
  await digitar("cod_sku", "BTG-000101");
  await digitar("produto", "Polo feminina piquet azul marinho PP");
  await digitar("qtde", "5");
  await digitar("motivo", "Ajuste da contagem");
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
});

describe("o Registrar movimentação enviado de novo", () => {
  it("depois da resposta perdida, a nova tentativa repete a chave", async () => {
    const primeiro = await registrar();
    const segundo = await registrar();

    expect(typeof primeiro.idempotency_key).toBe("string");
    expect(String(primeiro.idempotency_key).length).toBeGreaterThan(0);
    expect(segundo.idempotency_key).toBe(primeiro.idempotency_key);
  });

  it("o ajuste mudado depois da falha é outro envio, com outra chave", async () => {
    const primeiro = await registrar();
    await digitar("qtde", "6");
    const mudado = await registrar();

    expect(mudado.qtde).toBe(6);
    expect(mudado.idempotency_key).not.toBe(primeiro.idempotency_key);
  });
});
