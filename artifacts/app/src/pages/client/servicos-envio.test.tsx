// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

/**
 * O "Enviar solicitação" do Solicitar OS repete a chave só enquanto o pedido
 * é o mesmo. A nova tentativa do mesmo pedido, depois da resposta perdida,
 * repete a chave, e o servidor devolve a solicitação gravada; o pedido
 * editado depois da falha é outro envio, com outra chave. Antes, a chave
 * durava até a solicitação sair: o pedido editado ia com a chave do
 * primeiro, e o servidor que já o tinha gravado respondia "A chave de
 * idempotência já foi usada com outro conteúdo.".
 */

const estado = vi.hoisted(() => ({ envios: [] as Array<{ descricao: string; chave: string }>, perdidas: 0 }));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "uid-ana", publicMetadata: { role: "cliente", customer_code: "BTG Pactual" } }, isLoaded: true }),
}));

vi.mock("@/lib/operation-profile", () => ({ useOperationProfile: () => ({ profile: { modules: ["wms", "operacao"] } }) }));

vi.mock("@/lib/liberacao", async (original) => ({ ...(await original<typeof import("@/lib/liberacao")>()), OPERACAO_LIBERADO: true }));

vi.mock("@/lib/portal/use-servicos", () => ({
  useOsDoCliente: () => ({ os: [], erro: null }),
  useNfsDoCliente: () => ({ nfs: [], erro: null }),
  useSolicitacoesDoCliente: () => ({ solicitacoes: [], erro: null }),
}));

vi.mock("@/lib/portal/enviar-solicitacao", () => ({
  enviarSolicitacao: async (_codigo: string, form: { descricao: string }, chave: string) => {
    estado.envios.push({ descricao: form.descricao, chave });
    if (estado.perdidas > 0) {
      estado.perdidas -= 1;
      throw new Error("Falha interna no servidor. Tente novamente ou avise o time técnico.");
    }
    return { solicitacao_id: "sol_1" };
  },
}));

import { ClienteServicos } from "./servicos";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

const botao = (texto: string) => [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === texto) ?? null;

async function escrever(seletor: string, valor: string) {
  const campo = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(seletor);
  if (!campo) throw new Error(`Sem o campo ${seletor}`);
  const prototipo = campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototipo, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function enviar() {
  const antes = estado.envios.length;
  await act(async () => botao("Enviar solicitação")!.click());
  if (estado.envios.length === antes) throw new Error("A solicitação não saiu");
  return estado.envios.at(-1)!;
}

beforeEach(async () => {
  estado.envios = [];
  estado.perdidas = 2;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <Router ssrPath="/portal/servicos">
        <ClienteServicos />
      </Router>,
    ),
  );
  await act(async () => botao("Solicitar OS")!.click());
  await escrever("#solicitar-origem", "Rua da Consolação, 100");
  await escrever("#solicitar-descricao", "Levar 3 caixas ao escritório");
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
});

describe("a chave do Solicitar OS", () => {
  it("a nova tentativa do mesmo pedido repete a chave", async () => {
    const primeiro = await enviar();
    const segundo = await enviar();
    expect(segundo.chave).toBe(primeiro.chave);
  });

  it("o pedido editado depois da falha sai com outra chave, e o que volta ao de antes repete a dele", async () => {
    const primeiro = await enviar();
    await escrever("#solicitar-descricao", "Levar 4 caixas ao escritório");
    const editado = await enviar();
    expect(editado.descricao).toBe("Levar 4 caixas ao escritório");
    expect(editado.chave).not.toBe(primeiro.chave);

    await escrever("#solicitar-descricao", "Levar 3 caixas ao escritório");
    const deVolta = await enviar();
    expect(deVolta.chave).toBe(primeiro.chave);
  });
});
