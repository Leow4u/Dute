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
// A foto sobe ao Storage antes da callable: aqui, sempre sobe.
vi.mock("@/lib/firebase", () => ({ firebaseStorage: {} }));
vi.mock("firebase/storage", () => ({ ref: () => ({}), uploadBytes: async () => ({}) }));
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
import { registroDeEtapa, registroDeFoto } from "./os-no-campo";
import { comAmbiente, comFotos, guardarRascunho, lerRascunho, rascunhoInicial } from "./vistoria";

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
  window.localStorage.clear();
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

  it("a foto recusada sai do rascunho guardado da vistoria e leva o id dela na falha", async () => {
    const vistoria = comFotos(comAmbiente(rascunhoInicial(), "Recepção", "amb_1"), "amb_1", ["ft_a000000000000001", "ft_a000000000000002"]);
    guardarRascunho("10230-01", vistoria);
    const armazem = armazemNoAparelho(new IDBFactory());
    await abrirApp(armazem);
    rede.falhar = { code: "failed-precondition", message: "A OS já tem 200 fotos." };
    const arquivo = new Blob(["x"], { type: "image/jpeg" });
    await act(async () =>
      fila!.enviar(registroDeFoto({ numero: "10230-01" }, { arquivo, nome: "ft_a000000000000002.jpg", contentType: "image/jpeg", instante: TOQUE.toISOString() }, { legenda: "Recepção" })),
    );
    await esperar(() => fila!.falhas.length === 1);
    expect(fila!.falhas[0]).toMatchObject({ rotulo: "Foto", mensagem: "A OS já tem 200 fotos.", foto: "ft_a000000000000002" });
    // A tela da vistoria pode nem estar aberta: o rascunho guardado já sai sem ela.
    expect(lerRascunho("10230-01")?.ambientes[0].fotos).toEqual(["ft_a000000000000001"]);
  });

  it("a recusa fica na lista até a pessoa dispensar, mesmo trocando de tela ou fechando o app", async () => {
    const armazem = armazemNoAparelho(new IDBFactory());
    await abrirApp(armazem);
    rede.falhar = { code: "failed-precondition", message: "A OS já foi concluída." };
    await act(async () => fila!.enviar(registroDeEtapa({ numero: "10211-01" }, "saida_origem", TOQUE)));
    await esperar(() => fila!.falhas.length === 1);
    await esperar(async () => (await armazem.carregarFalhas("uid-carlos")).length === 1);

    // Cada tela do /campo monta a fila de novo, e fechar o app também.
    await fecharApp();
    await abrirApp(armazem);
    await esperar(() => fila!.falhas.length === 1);
    expect(fila!.falhas.map((falha) => [falha.rotulo, falha.mensagem])).toEqual([["Saída da origem", "A OS já foi concluída."]]);

    await act(async () => fila!.dispensarFalha(fila!.falhas[0].chave));
    await esperar(async () => (await armazem.carregarFalhas("uid-carlos")).length === 0);
    await fecharApp();
    await abrirApp(armazem);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(fila!.falhas).toEqual([]);
  });
});
