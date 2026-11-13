// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRouteAppRoles, getRouteProfileRoles } from "./modules";
import {
  agendarGuardaDasTelas,
  ESPERA_PARA_GUARDAR_MS,
  guardaFeita,
  guardavel,
  marcaDaGuarda,
  telaSobDemanda,
  telasDoPapel,
  type Guardavel,
} from "./telas-no-aparelho";

/**
 * As telas da equipe no aparelho (diagnóstico do carregamento, 9.3, PR 2 do
 * celular, e decisão 3 de 06/11/2026): o service worker guardava só o shell, e
 * a tela ainda não aberta desde a última publicação quebrava sem sinal. Depois
 * de entrar, os papéis internos baixam as telas que podem abrir.
 */

const Componente = () => null;
const carregarModulo = () => Promise.resolve({ default: Componente });

describe("telaSobDemanda", () => {
  it("guardar baixa a tela uma vez, e a tela aberta depois usa o mesmo arquivo", async () => {
    const carregar = vi.fn(carregarModulo);
    const tela = telaSobDemanda(carregar);
    expect(guardavel(tela)).toBe(true);
    await tela.guardar();
    await tela.guardar();
    expect(carregar).toHaveBeenCalledTimes(1);
    // É o lazy do React: a mesma tela entra numa rota.
    expect((tela as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.lazy"));
  });

  it("o arquivo que não veio (sem sinal) não fica preso: a próxima vez tenta de novo", async () => {
    const carregar = vi
      .fn<() => Promise<{ default: typeof Componente }>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"))
      .mockImplementation(carregarModulo);
    const tela = telaSobDemanda(carregar);
    await expect(tela.guardar()).rejects.toThrow("Failed to fetch");
    await expect(tela.guardar()).resolves.toBeUndefined();
    expect(carregar).toHaveBeenCalledTimes(2);
  });
});

function falsa(nome: string, registro: string[], efeito?: () => void): Guardavel {
  return {
    guardar: vi.fn(async () => {
      registro.push(nome);
      efeito?.();
    }),
  };
}

describe("guardarTelas", () => {
  // Cada caso com o registro das telas criadas zerado, como num app recém-aberto.
  let modulo: typeof import("./telas-no-aparelho");
  beforeEach(async () => {
    vi.resetModules();
    modulo = await import("./telas-no-aparelho");
  });

  it("guarda uma por vez, na ordem, e conta o que falhou sem parar", async () => {
    const feitas: string[] = [];
    const quebra: Guardavel = { guardar: vi.fn(async () => Promise.reject(new Error("sem sinal"))) };
    const pausa = vi.fn(async () => undefined);
    const resultado = await modulo.guardarTelas([falsa("pedidos", feitas), quebra, falsa("estoque", feitas)], { pausa });
    expect(feitas).toEqual(["pedidos", "estoque"]);
    expect(resultado).toEqual({ guardadas: 2, falhas: 1, interrompida: false });
    expect(pausa).toHaveBeenCalledTimes(3);
  });

  it("as telas de dentro de uma tela guardada (as abas do Faturamento) entram na fila; as das outras rotas, não", async () => {
    const feitas: string[] = [];
    let aba: Guardavel | null = null;
    // Outra rota do App, que este papel não abre: já existe, mas não é de dentro de nenhuma tela guardada.
    const carregarOutra = vi.fn(carregarModulo);
    const outraRota = modulo.telaSobDemanda(carregarOutra);
    const faturamento = falsa("faturamento", feitas, () => {
      // O arquivo do Faturamento chega e cria as abas dele.
      aba = modulo.telaSobDemanda(async () => {
        feitas.push("fechamento do mês");
        return carregarModulo();
      });
    });
    const resultado = await modulo.guardarTelas([faturamento], { rotas: [faturamento, outraRota] });
    expect(aba).not.toBeNull();
    expect(feitas).toEqual(["faturamento", "fechamento do mês"]);
    expect(resultado.guardadas).toBe(2);
    expect(carregarOutra).not.toHaveBeenCalled();
  });

  it("para no meio quando pedem (a pessoa saiu, a rede caiu)", async () => {
    const feitas: string[] = [];
    let parar = false;
    const resultado = await modulo.guardarTelas(
      [falsa("pedidos", feitas, () => (parar = true)), falsa("estoque", feitas)],
      { parar: () => parar },
    );
    expect(feitas).toEqual(["pedidos"]);
    expect(resultado.interrompida).toBe(true);
  });
});

describe("telasDoPapel", () => {
  const telas = new Map<string, Guardavel>();
  const rota = (path: string) => {
    const component = telas.get(path) ?? { guardar: async () => undefined };
    telas.set(path, component);
    return { path, component, appRoles: getRouteAppRoles(path), profileRoles: getRouteProfileRoles(path) };
  };
  const ROTAS = [
    rota("/pedidos"),
    rota("/estoque"),
    rota("/wms/receber"),
    rota("/faturamento"),
    rota("/configuracoes/pessoas"),
    rota("/portal"),
    rota("/portal/estoque"),
    // A rota que só redireciona não tem o que guardar.
    { path: "/wms", component: () => null, appRoles: getRouteAppRoles("/wms"), profileRoles: getRouteProfileRoles("/wms") },
  ];
  const caminhos = (papel: Parameters<typeof telasDoPapel>[1]) =>
    telasDoPapel(ROTAS, papel).map((tela) => [...telas].find(([, valor]) => valor === tela)?.[0]);

  it("a operação (wms) guarda as telas da Armazenagem, não as do portal nem as que não abre", () => {
    const daOperacao = caminhos("wms");
    expect(daOperacao).toEqual(expect.arrayContaining(["/pedidos", "/estoque", "/wms/receber"]));
    expect(daOperacao).not.toContain("/portal");
    expect(daOperacao).not.toContain("/portal/estoque");
    expect(daOperacao).not.toContain("/configuracoes/pessoas");
    expect(daOperacao).not.toContain(undefined);
  });

  it("o owner guarda também o Faturamento e as Pessoas", () => {
    expect(caminhos("owner")).toEqual(expect.arrayContaining(["/pedidos", "/faturamento", "/configuracoes/pessoas"]));
    expect(caminhos("owner")).not.toContain("/portal");
  });

  it("o cliente e quem não entrou não baixam nada", () => {
    expect(caminhos("cliente")).toEqual([]);
    expect(caminhos(null)).toEqual([]);
    expect(caminhos(undefined)).toEqual([]);
  });
});

describe("agendarGuardaDasTelas", () => {
  const CHAVE = "dute.telas-no-aparelho";
  let online = true;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("DEV", false);
    online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  async function correr(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
  }

  it("espera a tela aberta, guarda as telas e marca a versão e o papel; na próxima entrada, não baixa de novo", async () => {
    const feitas: string[] = [];
    agendarGuardaDasTelas("wms", [falsa("pedidos", feitas), falsa("estoque", feitas)], []);
    await correr(ESPERA_PARA_GUARDAR_MS - 1);
    expect(feitas).toEqual([]);
    await correr(10_000);
    expect(feitas).toEqual(["pedidos", "estoque"]);
    expect(window.localStorage.getItem(CHAVE)).toBe(marcaDaGuarda("wms"));
    expect(guardaFeita("wms")).toBe(true);
    // Outro papel no mesmo aparelho guarda as telas dele.
    expect(guardaFeita("owner")).toBe(false);
    const deNovo: string[] = [];
    agendarGuardaDasTelas("wms", [falsa("pedidos", deNovo)], []);
    await correr(60_000);
    expect(deNovo).toEqual([]);
  });

  it("sem rede não começa, e a rede que cai no meio para a guarda sem marcar", async () => {
    online = false;
    const feitas: string[] = [];
    agendarGuardaDasTelas("wms", [falsa("pedidos", feitas)], []);
    await correr(60_000);
    expect(feitas).toEqual([]);
    online = true;
    agendarGuardaDasTelas("wms", [falsa("pedidos", feitas, () => (online = false)), falsa("estoque", feitas)], []);
    await correr(60_000);
    expect(feitas).toEqual(["pedidos"]);
    expect(window.localStorage.getItem(CHAVE)).toBeNull();
  });

  it("a guarda com falha não marca: a próxima entrada tenta de novo", async () => {
    const quebra: Guardavel = { guardar: async () => Promise.reject(new Error("sem sinal")) };
    agendarGuardaDasTelas("wms", [quebra], []);
    await correr(60_000);
    expect(window.localStorage.getItem(CHAVE)).toBeNull();
  });

  it("quem sai antes cancela", async () => {
    const feitas: string[] = [];
    const cancelar = agendarGuardaDasTelas("wms", [falsa("pedidos", feitas)], []);
    cancelar();
    await correr(60_000);
    expect(feitas).toEqual([]);
  });

  it("no desenvolvimento não baixa nada (o Vite serve cada arquivo solto)", async () => {
    vi.stubEnv("DEV", true);
    const feitas: string[] = [];
    agendarGuardaDasTelas("wms", [falsa("pedidos", feitas)], []);
    await correr(60_000);
    expect(feitas).toEqual([]);
  });
});

describe("no App", () => {
  const APP = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../App.tsx"), "utf8");

  it("toda tela do App chega sob demanda pelo telaSobDemanda, que sabe se guardar", () => {
    expect(APP).not.toMatch(/\blazy\(/);
    expect((APP.match(/= telaSobDemanda\(/g) ?? []).length).toBeGreaterThan(80);
  });

  it("a guarda fica montada no App, dentro do AuthProvider, com as rotas que cada papel abre", () => {
    expect(APP).toContain("<GuardarTelasNoAparelho />");
    expect(APP.indexOf("<GuardarTelasNoAparelho />")).toBeGreaterThan(APP.indexOf("<AuthProvider>"));
    expect(APP).toMatch(/telasDoPapel\(rotas, papel\)/);
  });
});
