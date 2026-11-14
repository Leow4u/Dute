// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * O "Guardar do RECEBIMENTO" enquanto lê o saldo da área e quando a leitura
 * falha (carregamento v2, parte 13c; diagnóstico, 4.4). Antes, o diálogo
 * dizia "Carregando..." seco e, na falha, só o texto do erro, sem nova
 * tentativa. Agora a espera em bloco (nada antes de 300 ms) e a falha com
 * "Tentar de novo", que fica no diálogo enquanto tenta. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ falhar: false, recusar: false, segurar: null as Promise<void> | null }));

vi.mock("@/lib/wms/guarda-da-area", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/wms/guarda-da-area")>();
  return {
    ...original,
    verGuardaDaArea: async (input: { location_id: string }) => {
      if (estado.segurar) await estado.segurar;
      if (estado.recusar) {
        throw Object.assign(new Error(`O local ${input.location_id} não tem saldo livre deste item.`), { code: "failed-precondition" });
      }
      if (estado.falhar) throw new Error("Falha no servidor.");
      return {
        customer_code: "BTG Pactual",
        sku_code: "BTG-000214",
        location_id: input.location_id,
        area: "RECEBIMENTO",
        product_name: "Camisa Polo Manga Longa",
        client_item_code: "A.01.0806.005.GG",
        livre: 30,
        em_guardas_abertas: 6,
        sem_guarda: 24,
      };
    },
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { GuardarDaAreaDialog } from "./guardar-da-area";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 80; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.falhar = false;
  estado.recusar = false;
  estado.segurar = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function abrir(locationId = "RECEBIMENTO") {
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <GuardarDaAreaDialog aberto onFechar={() => undefined} customerCode="BTG Pactual" skuCode="BTG-000214" locationId={locationId} nome="Camisa Polo Manga Longa · GG" codigo="BTG-000214" />
      </QueryClientProvider>,
    ),
  );
}

describe("Guardar do RECEBIMENTO, a leitura do saldo", () => {
  it("enquanto lê: a espera em bloco, sem o \"Carregando...\" seco", async () => {
    let soltar!: () => void;
    estado.segurar = new Promise<void>((pronto) => {
      soltar = pronto;
    });
    await abrir();
    expect(dialogo()!.textContent).not.toContain("Carregando...");
    expect(dialogo()!.querySelector("[data-carregando-na-regiao]")).not.toBeNull();
    await esperar(() => Boolean(dialogo()!.textContent?.includes("Carregando o saldo…")), "a espera aos 300 ms");
    expect(textosForaDaLista(dialogo()!.outerHTML, ["Guardar do RECEBIMENTO", "Carregando o saldo…", "Fechar"])).toEqual([]);
    await act(async () => soltar());
    await esperar(() => Boolean(document.getElementById("guardar-quantidade")), "o saldo");
  });

  it("a falha diz o motivo, com \"Tentar de novo\", e a nova tentativa traz o saldo", async () => {
    estado.falhar = true;
    await abrir();
    await esperar(() => Boolean(dialogo()!.textContent?.includes("Não consegui carregar o saldo do RECEBIMENTO.")), "a falha");
    expect(dialogo()!.textContent).toContain("Falha no servidor.");
    expect(dialogo()!.querySelector('[role="alert"]')).not.toBeNull();
    expect(
      textosForaDaLista(dialogo()!.outerHTML, [
        "Guardar do RECEBIMENTO", "Não consegui carregar o saldo do RECEBIMENTO. Falha no servidor.", "Tentar de novo", "Tentando de novo…", "Fechar",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(dialogo()!.outerHTML)).toEqual([]);
    estado.falhar = false;
    const tentar = Array.from(dialogo()!.querySelectorAll("button")).find((botao) => botao.textContent?.includes("Tentar de novo"))!;
    await act(async () => tentar.click());
    await esperar(() => Boolean(document.getElementById("guardar-quantidade")), "o saldo depois da nova tentativa");
  });

  it("a recusa do servidor diz o motivo sem \"Tentar de novo\" (a nova tentativa não muda nada), com o artigo da área", async () => {
    estado.recusar = true;
    await abrir("EXPEDICAO");
    await esperar(() => Boolean(dialogo()!.textContent?.includes("não tem saldo livre")), "a recusa");
    expect(dialogo()!.textContent).toContain("Guardar da EXPEDICAO");
    expect(dialogo()!.textContent).not.toContain("do EXPEDICAO");
    expect(dialogo()!.textContent).not.toContain("Não consegui carregar o saldo");
    expect(Array.from(dialogo()!.querySelectorAll("button")).some((botao) => botao.textContent?.includes("Tentar de novo"))).toBe(false);
    expect(textosForaDaLista(dialogo()!.outerHTML, ["Guardar da EXPEDICAO", "O local EXPEDICAO não tem saldo livre deste item.", "Fechar"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(dialogo()!.outerHTML)).toEqual([]);
  });
});
