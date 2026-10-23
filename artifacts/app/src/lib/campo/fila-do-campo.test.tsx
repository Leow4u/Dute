// @vitest-environment jsdom
import { IDBFactory } from "fake-indexeddb";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A fila do campo no aparelho (parte 3.8c): o registro feito sem sinal fica
 * guardado, sobrevive a fechar o app e, quando o sinal volta, vai com a mesma
 * chave e o instante do toque. A callable é um espião: conta o que chega.
 */

const rede = vi.hoisted(() => ({
  chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }>,
  falhar: null as null | { code: string; message: string },
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "uid-carlos", fullName: "Carlos Silva" }, isLoaded: true }) }));
vi.mock("@/lib/firebase", () => ({ firebaseStorage: null }));
vi.mock("@/lib/operacao/api", async (original) => ({
  ...(await original<typeof import("@/lib/operacao/api")>()),
  chamarOperacao: async (nome: string, dados: Record<string, unknown>) => {
    if (rede.falhar) throw Object.assign(new Error(rede.falhar.message), { code: rede.falhar.code });
    rede.chamadas.push({ nome, dados });
    return {};
  },
}));

import { FilaDoCampoProvider, useFilaDoCampo } from "./fila-do-campo";
import { armazemNoAparelho, type ArmazemDaFila } from "./fila-guardada";
import { registroDeEtapa } from "./os-no-campo";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let fila: ReturnType<typeof useFilaDoCampo> | null = null;

function Espiao() {
  const atual = useFilaDoCampo();
  useEffect(() => {
    fila = atual;
  });
  return null;
}

function sinal(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

async function abrirApp(armazem: ArmazemDaFila) {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <FilaDoCampoProvider armazem={armazem}>
        <Espiao />
      </FilaDoCampoProvider>,
    );
  });
}

async function fecharApp() {
  await act(async () => raiz?.unmount());
  container?.remove();
  raiz = null;
  fila = null;
}

async function esperar(condicao: () => boolean | Promise<boolean>) {
  for (let tentativa = 0; tentativa < 100 && !(await condicao()); tentativa += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  expect(await condicao()).toBe(true);
}

beforeEach(() => {
  rede.chamadas.length = 0;
  rede.falhar = null;
  sinal(true);
});

afterEach(async () => {
  await fecharApp();
});

const TOQUE = new Date("2026-10-20T13:20:00.000Z");

describe("fila do campo no aparelho", () => {
  it("sem sinal, guarda; fechado e aberto de novo, envia com a mesma chave e o instante do toque", async () => {
    const armazem = armazemNoAparelho(new IDBFactory());
    sinal(false);
    await abrirApp(armazem);
    await act(async () => fila!.enviar(registroDeEtapa({ numero: "10211-01" }, "saida_origem", TOQUE)));
    await esperar(() => fila!.pendentes.length === 1);
    expect(fila!.aviso).toBe("Sem sinal · 1 registro guardado");
    const chave = fila!.pendentes[0].chave;
    // Guardado no aparelho, e nada saiu sem sinal.
    await esperar(async () => (await armazem.carregar("uid-carlos")).length === 1);
    expect(rede.chamadas).toEqual([]);

    // O app fecha sem sinal e abre de novo depois: a fila volta do aparelho.
    await fecharApp();
    await abrirApp(armazem);
    await esperar(() => fila!.pendentes.length === 1);
    expect(fila!.pendentes[0].chave).toBe(chave);

    await act(async () => sinal(true));
    await esperar(() => rede.chamadas.length === 1 && fila!.pendentes.length === 0);
    expect(rede.chamadas[0]).toEqual({
      nome: "registerStep",
      dados: { numero: "10211-01", etapa: "saida_origem", instante: "2026-10-20T13:20:00.000Z", idempotency_key: chave },
    });
    // O que chegou sai do aparelho.
    await esperar(async () => (await armazem.carregar("uid-carlos")).length === 0);
  });

  it("recusado pela callable sai da fila e aparece como falha; falha de rede fica para depois", async () => {
    const armazem = armazemNoAparelho(new IDBFactory());
    await abrirApp(armazem);
    rede.falhar = { code: "unavailable", message: "Sem conexão" };
    await act(async () => fila!.enviar(registroDeEtapa({ numero: "10211-01" }, "saida_origem", TOQUE)));
    await esperar(() => (fila!.pendentes[0]?.tentativas ?? 0) >= 1);
    expect(fila!.falhas).toEqual([]);
    await esperar(async () => (await armazem.carregar("uid-carlos")).length === 1);

    // O sinal cai e volta: quem esperava a vez tenta já.
    rede.falhar = { code: "failed-precondition", message: "Saída da origem já foi registrada." };
    await act(async () => sinal(false));
    await act(async () => sinal(true));
    await esperar(() => fila!.pendentes.length === 0);
    expect(fila!.falhas.map((falha) => [falha.rotulo, falha.mensagem])).toEqual([["Saída da origem", "Saída da origem já foi registrada."]]);
  });
});
