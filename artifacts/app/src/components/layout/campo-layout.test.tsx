// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

/**
 * O aviso da fila do campo no relógio da espera (carregamento v2, seções 3 e
 * 7; revisão da parte 13g). Com sinal, cada toque ("Cheguei", "Iniciar")
 * passa uns milissegundos na fila enquanto a callable responde: antes, a
 * faixa "Enviando" piscava com a caixa girando, e o leitor de tela ouvia
 * "Enviando os registros guardados" a cada toque, em 0 ms, sobre um registro
 * que nunca ficou guardado. Agora a faixa e o anúncio só entram aos 300 ms. A
 * fila sem sinal (lib/campo) não muda. Dados sintéticos.
 */

const rede = vi.hoisted(() => ({ chamadas: 0, demora: 20 }));
vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "uid-carlos", fullName: "Carlos Silva", email: "carlos@dutelog.com.br", role: "interno", platformRole: "campo" }, isLoaded: true }),
  useAppAuth: () => ({ signOut: async () => undefined }),
}));
vi.mock("@/components/layout/account-menu", () => ({ AccountMenu: () => null }));
vi.mock("@/lib/firebase", () => ({ firebaseStorage: {} }));
vi.mock("@/lib/operacao/api", async (original) => ({
  ...(await original<typeof import("@/lib/operacao/api")>()),
  chamarOperacao: async () => {
    rede.chamadas += 1;
    await new Promise((fim) => setTimeout(fim, rede.demora));
    return {};
  },
}));

import CampoLayout from "@/components/layout/campo-layout";
import { Anunciador } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { useFilaDoCampo } from "@/lib/campo/fila-do-campo";
import { registroDeEtapa } from "@/lib/campo/os-no-campo";

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => true });
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
  rede.chamadas = 0;
  rede.demora = 20;
});

afterEach(() => {
  act(() => raiz?.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const fala = () => document.querySelector("[data-anunciador]")?.textContent ?? "";
const faixa = () => [...document.querySelectorAll("header p")].map((p) => p.textContent).join(" | ") || null;
const gira = () => Boolean(document.querySelector("header [data-spinner]"));

let enviar: ((dados: Parameters<ReturnType<typeof useFilaDoCampo>["enviar"]>[0]) => void) | null = null;
function Tela() {
  const fila = useFilaDoCampo();
  useEffect(() => {
    enviar = fila.enviar;
  });
  return <h1>Minhas OS</h1>;
}

async function montar() {
  await act(async () =>
    raiz!.render(
      <Router ssrPath="/campo">
        <CampoLayout>
          <Tela />
        </CampoLayout>
        <Anunciador />
      </Router>,
    ),
  );
  await act(async () => vi.advanceTimersByTime(50));
}

describe("o aviso da fila do campo", () => {
  it("com sinal, o registro que vai na hora não mostra a faixa nem fala", async () => {
    await montar();
    await act(async () => enviar!(registroDeEtapa({ numero: "10211-01" }, "saida_patio", new Date("2026-10-23T12:00:00.000Z"))));
    const quadros: Array<{ faixa: string | null; gira: boolean; fala: string }> = [];
    for (let ms = 0; ms < 3_000; ms += 10) {
      quadros.push({ faixa: faixa(), gira: gira(), fala: fala() });
      await act(async () => vi.advanceTimersByTime(10));
    }
    expect(rede.chamadas).toBe(1);
    expect(quadros.every((quadro) => quadro.faixa === null && !quadro.gira)).toBe(true);
    expect(quadros.map((quadro) => quadro.fala)).not.toContain("Enviando os registros guardados");
  });

  it("o envio que demora: a faixa e a caixa aos 300 ms, o anúncio uma vez, e a faixa fica pelo menos 500 ms", async () => {
    rede.demora = 2_000;
    await montar();
    await act(async () => enviar!(registroDeEtapa({ numero: "10211-01" }, "saida_patio", new Date("2026-10-23T12:00:00.000Z"))));
    await act(async () => vi.advanceTimersByTime(CARREGANDO.atrasoMs - 20));
    expect(faixa()).toBeNull();
    await act(async () => vi.advanceTimersByTime(40));
    expect(faixa()).toBe("Enviando · 1 registro guardado");
    expect(gira()).toBe(true);
    expect(fala()).toBe("Enviando os registros guardados");
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(faixa()).toBeNull();
    expect(rede.chamadas).toBe(1);
  });
});
