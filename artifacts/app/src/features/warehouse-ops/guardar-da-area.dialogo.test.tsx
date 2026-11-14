// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O diálogo "Guardar do RECEBIMENTO" na mão de quem usa (decisão 16, parte
 * 7e): a quantidade começa no sem guarda uma vez por abertura, apagar o campo
 * não a traz de volta, e fechar o diálogo não apaga o local que ele mostra.
 */

const estado = vi.hoisted(() => ({
  abertas: [] as Array<Record<string, unknown>>,
  avisos: [] as Array<{ title?: string; description?: string }>,
}));

vi.mock("@/lib/wms/guarda-da-area", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/wms/guarda-da-area")>();
  return {
    ...original,
    verGuardaDaArea: async (input: { location_id: string }) => ({
      customer_code: "BTG Pactual",
      sku_code: "BTG-000214",
      location_id: input.location_id,
      area: "RECEBIMENTO",
      product_name: "CAMISA POLO MANGA LONGA GG",
      client_item_code: "A.01.0806.005.GG",
      livre: 30,
      em_guardas_abertas: 6,
      sem_guarda: 24,
    }),
    abrirGuardaDaArea: async (input: Record<string, unknown>) => {
      estado.abertas.push(input);
      return { ok: true, putaway_task_id: "put_area_1", location_id: input.location_id, quantity: input.quantity, sem_guarda: 14 };
    },
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (aviso: { title?: string; description?: string }) => estado.avisos.push(aviso) }),
}));

import { GuardarDaAreaDialog } from "./guardar-da-area";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

/** A ficha, como na tela: o local fica guardado depois de fechar. */
function Ficha() {
  const [aberto, setAberto] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)}>
        Reabrir
      </button>
      <GuardarDaAreaDialog
        aberto={aberto}
        onFechar={() => setAberto(false)}
        customerCode="BTG Pactual"
        skuCode="BTG-000214"
        locationId="RECEBIMENTO"
        nome="CAMISA POLO MANGA LONGA GG"
        codigo="BTG-000214 · A.01.0806.005.GG"
      />
    </>
  );
}

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 50; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

const campo = (id: string) => document.getElementById(id) as HTMLInputElement | null;

async function digitar(id: string, valor: string) {
  const elemento = campo(id);
  if (!elemento) throw new Error(`Sem o campo ${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(elemento, valor);
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** O botão pelo rótulo: o texto inteiro, ou a camada atual do BotaoDeAcao. */
function botao(texto: string) {
  return (
    [...document.querySelectorAll("button")].find(
      (elemento) =>
        elemento.textContent?.trim() === texto || elemento.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === texto,
    ) ?? null
  );
}
/** Travado (sem dado que preste ou no meio da ação): aria-disabled, nunca disabled. */
const travado = (elemento: HTMLButtonElement | null) => elemento!.getAttribute("aria-disabled") === "true" && !elemento!.disabled;

beforeEach(async () => {
  estado.abertas.length = 0;
  estado.avisos.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient()}>
        <Ficha />
      </QueryClientProvider>,
    ),
  );
  await esperar(() => campo("guardar-quantidade")?.value === "24", "a quantidade no sem guarda");
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
});

describe("o diálogo Guardar do RECEBIMENTO na mão de quem usa", () => {
  it("apagar a quantidade não a traz de volta, e a guarda sai com o que a pessoa digitou", async () => {
    await digitar("guardar-quantidade", "");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(campo("guardar-quantidade")!.value).toBe("");
    await digitar("guardar-quantidade", "10");
    await digitar("guardar-motivo", "Contagem achou no RECEBIMENTO");
    expect(travado(botao("Abrir a guarda"))).toBe(false);
    await act(async () => botao("Abrir a guarda")!.click());
    await esperar(() => estado.avisos.length > 0, "o aviso da guarda aberta");
    expect(estado.abertas).toHaveLength(1);
    expect(estado.abertas[0]).toMatchObject({ customer_code: "BTG Pactual", sku_code: "BTG-000214", location_id: "RECEBIMENTO", quantity: 10, reason: "Contagem achou no RECEBIMENTO" });
    expect(estado.avisos[0]).toEqual({ title: "Guarda aberta", description: "10 un. · RECEBIMENTO · em Receber › Para guardar" });
  });

  it("acima do sem guarda ou sem motivo, Abrir a guarda fica desligado", async () => {
    await digitar("guardar-motivo", "Contagem achou no RECEBIMENTO");
    expect(travado(botao("Abrir a guarda"))).toBe(false);
    await digitar("guardar-quantidade", "25");
    expect(travado(botao("Abrir a guarda"))).toBe(true);
    await digitar("guardar-quantidade", "24");
    await digitar("guardar-motivo", "");
    expect(travado(botao("Abrir a guarda"))).toBe(true);
  });

  it("reaberto, começa de novo no sem guarda e sem motivo, com outra chave", async () => {
    await digitar("guardar-quantidade", "10");
    await digitar("guardar-motivo", "Contagem achou no RECEBIMENTO");
    await act(async () => botao("Abrir a guarda")!.click());
    await esperar(() => estado.avisos.length > 0, "a primeira guarda");
    await act(async () => botao("Reabrir")!.click());
    await esperar(() => campo("guardar-quantidade")?.value === "24", "a quantidade de novo no sem guarda");
    expect(campo("guardar-motivo")!.value).toBe("");
    await digitar("guardar-motivo", "Resto da contagem");
    await act(async () => botao("Abrir a guarda")!.click());
    await esperar(() => estado.abertas.length === 2, "a segunda guarda");
    expect(estado.abertas[1]!.idempotency_key).not.toBe(estado.abertas[0]!.idempotency_key);
  });
});
