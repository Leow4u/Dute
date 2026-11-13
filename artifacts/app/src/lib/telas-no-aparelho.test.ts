// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { act, createElement, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BUILD_COMMIT } from "./build-info";
import { getRouteAppRoles, getRouteProfileRoles } from "./modules";
import {
  abreATela,
  agendarGuardaDasTelas,
  arquivosDasTelas,
  ESPERA_PARA_GUARDAR_MS,
  guardaFeita,
  guardarArquivos,
  guardavel,
  MAPA_DAS_TELAS,
  marcaDaGuarda,
  PRAZO_DO_ARQUIVO_MS,
  telaSobDemanda,
  telasDoPapel,
  type MapaDasTelas,
} from "./telas-no-aparelho";
import { mapaDasTelas, telasDeclaradas, type PedacoDoBuild } from "./telas-no-aparelho-no-build";

/**
 * As telas da equipe no aparelho (diagnóstico do carregamento, 9.3, PR 2 do
 * celular, e decisão 3 de 06/11/2026): o service worker guardava só o shell, e
 * a tela ainda não aberta desde a última publicação quebrava sem sinal. Depois
 * de entrar, os papéis internos baixam os arquivos das telas que podem abrir.
 *
 * A guarda nunca importa a tela: o import que falha (a rede que pisca) fica
 * guardado no mapa de módulos do navegador, e a tela aberta depois, já com
 * sinal, cairia em "Sem conexão." sem pedir o arquivo de novo.
 */

const Componente = () => null;
const carregarModulo = () => Promise.resolve({ default: Componente });

const MAPA: MapaDasTelas = {
  versao: BUILD_COMMIT,
  telas: {
    "pages/pedidos": { arquivos: ["assets/pedidos-1.js", "assets/fila-1.js"], dentro: [] },
    "pages/estoque": { arquivos: ["assets/estoque-1.js", "assets/fila-1.js"], dentro: [] },
    "pages/billing-hub": { arquivos: ["assets/billing-hub-1.js"], dentro: ["pages/billing", "pages/price-list"] },
    "pages/billing": { arquivos: ["assets/billing-1.js", "assets/fila-1.js"], dentro: [] },
    "pages/price-list": { arquivos: ["assets/price-list-1.js"], dentro: [] },
    "pages/operacao/inicio": { arquivos: ["assets/operacao-inicio-1.js"], dentro: [] },
  },
};

describe("telaSobDemanda", () => {
  it("é o lazy do React com o arquivo da tela, e só importa quando a tela abre", () => {
    const carregar = vi.fn(carregarModulo);
    const tela = telaSobDemanda("pages/pedidos", carregar);
    expect(guardavel(tela)).toBe(true);
    expect(tela.arquivo).toBe("pages/pedidos");
    expect((tela as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.lazy"));
    expect(carregar).not.toHaveBeenCalled();
  });

  it("a rota que mostra a tela por um componente próprio leva o arquivo dela", () => {
    const bancada = telaSobDemanda("pages/warehouse-ops", carregarModulo);
    const qualidade = abreATela(() => null, bancada);
    expect(guardavel(qualidade)).toBe(true);
    expect(qualidade.arquivo).toBe("pages/warehouse-ops");
    expect(guardavel(() => null)).toBe(false);
  });

  it("a tela que abre larga o arquivo que a guarda baixava: o pedido parado não segura a tela", async () => {
    let largou = false;
    const baixando = guardarArquivos(["assets/mapa-1.js"], {
      baixar: (_arquivo, sinal) =>
        new Promise((_, recusar) => {
          sinal.addEventListener("abort", () => {
            largou = true;
            recusar(new DOMException("largado", "AbortError"));
          });
        }),
    });
    await Promise.resolve();
    const carregar = vi.fn(carregarModulo);
    const Mapa = telaSobDemanda("pages/warehouse-map", carregar);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const raiz = createRoot(document.createElement("div"));
    try {
      await act(async () => {
        raiz.render(createElement(Suspense, { fallback: null }, createElement(Mapa)));
      });
      expect(largou).toBe(true);
      expect(carregar).toHaveBeenCalledTimes(1);
      expect(await baixando).toEqual({ guardados: 0, falhas: 1, interrompida: false });
    } finally {
      act(() => raiz.unmount());
      vi.unstubAllGlobals();
    }
  });
});

describe("arquivosDasTelas", () => {
  it("junta os arquivos das telas e das de dentro delas, sem repetir, na ordem", () => {
    expect(arquivosDasTelas(MAPA, ["pages/pedidos", "pages/billing-hub", "pages/estoque"])).toEqual([
      "assets/pedidos-1.js",
      "assets/fila-1.js",
      "assets/billing-hub-1.js",
      "assets/estoque-1.js",
      "assets/billing-1.js",
      "assets/price-list-1.js",
    ]);
  });

  it("só as telas pedidas: a de um módulo que este ambiente não tem fica de fora", () => {
    const arquivos = arquivosDasTelas(MAPA, ["pages/pedidos"]);
    expect(arquivos).not.toContain("assets/operacao-inicio-1.js");
    // A tela que o mapa não conhece não quebra a guarda.
    expect(arquivosDasTelas(MAPA, ["pages/sumiu"])).toEqual([]);
  });
});

describe("guardarArquivos", () => {
  it("baixa um por vez, na ordem, e conta o que falhou sem parar", async () => {
    const baixados: string[] = [];
    const pausa = vi.fn(async () => undefined);
    const resultado = await guardarArquivos(["a.js", "quebra.js", "b.js"], {
      baixar: async (arquivo) => {
        if (arquivo === "quebra.js") throw new TypeError("Failed to fetch");
        baixados.push(arquivo);
      },
      pausa,
    });
    expect(baixados).toEqual(["a.js", "b.js"]);
    expect(resultado).toEqual({ guardados: 2, falhas: 1, interrompida: false });
    expect(pausa).toHaveBeenCalledTimes(3);
  });

  it("o arquivo que não responde é largado no prazo e conta como falha", async () => {
    vi.useFakeTimers();
    try {
      const resultado = guardarArquivos(["parado.js"], {
        baixar: (_arquivo, sinal) =>
          new Promise((_, recusar) => sinal.addEventListener("abort", () => recusar(new DOMException("prazo", "AbortError")))),
      });
      await vi.advanceTimersByTimeAsync(PRAZO_DO_ARQUIVO_MS);
      expect(await resultado).toEqual({ guardados: 0, falhas: 1, interrompida: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("para no meio quando pedem (a pessoa saiu, a rede caiu)", async () => {
    const baixados: string[] = [];
    let parar = false;
    const resultado = await guardarArquivos(["a.js", "b.js"], {
      baixar: async (arquivo) => {
        baixados.push(arquivo);
        parar = true;
      },
      parar: () => parar,
    });
    expect(baixados).toEqual(["a.js"]);
    expect(resultado.interrompida).toBe(true);
  });
});

describe("telasDoPapel", () => {
  const rota = (path: string, arquivo: string | null) => ({
    path,
    component: arquivo ? telaSobDemanda(arquivo, carregarModulo) : () => null,
    appRoles: getRouteAppRoles(path),
    profileRoles: getRouteProfileRoles(path),
  });
  const ROTAS = [
    rota("/pedidos", "pages/pedidos"),
    rota("/estoque", "pages/estoque"),
    rota("/wms/receber", "pages/receber"),
    rota("/faturamento", "pages/billing-hub"),
    rota("/faturamento/tabela", "pages/billing-hub"),
    rota("/configuracoes/pessoas", "pages/users"),
    rota("/portal", "pages/client"),
    rota("/portal/estoque", "pages/client"),
    // A rota que só redireciona não tem o que guardar.
    rota("/wms", null),
  ];
  const entrada = telaSobDemanda("pages/entrada", carregarModulo);

  it("a operação (wms) guarda as telas da Armazenagem, não as do portal nem as que não abre", () => {
    const daOperacao = telasDoPapel(ROTAS, "wms");
    expect(daOperacao).toEqual(expect.arrayContaining(["pages/pedidos", "pages/estoque", "pages/receber"]));
    expect(daOperacao).not.toContain("pages/client");
    expect(daOperacao).not.toContain("pages/users");
  });

  it("o owner guarda também o Faturamento (uma vez) e as Pessoas; as telas sem rota entram como extras", () => {
    const doOwner = telasDoPapel(ROTAS, "owner", [entrada]);
    expect(doOwner).toEqual(expect.arrayContaining(["pages/pedidos", "pages/billing-hub", "pages/users", "pages/entrada"]));
    expect(doOwner.filter((arquivo) => arquivo === "pages/billing-hub")).toHaveLength(1);
    expect(doOwner).not.toContain("pages/client");
  });

  it("o cliente e quem não entrou não baixam nada, nem os extras", () => {
    expect(telasDoPapel(ROTAS, "cliente", [entrada])).toEqual([]);
    expect(telasDoPapel(ROTAS, null, [entrada])).toEqual([]);
    expect(telasDoPapel(ROTAS, undefined)).toEqual([]);
  });
});

describe("agendarGuardaDasTelas", () => {
  const CHAVE = "dute.telas-no-aparelho";
  let online = true;
  let mapa: unknown = MAPA;
  let pedidos: Array<{ endereco: string; opcoes?: RequestInit }> = [];
  let quebrados = new Set<string>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("DEV", false);
    online = true;
    mapa = MAPA;
    pedidos = [];
    quebrados = new Set();
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (endereco: string, opcoes?: RequestInit) => {
        pedidos.push({ endereco, opcoes });
        if (quebrados.has(endereco)) throw new TypeError("Failed to fetch");
        if (endereco.endsWith(MAPA_DAS_TELAS)) return new Response(JSON.stringify(mapa), { status: 200 });
        return new Response("export default 1;", { status: 200 });
      }),
    );
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  async function correr(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
  }
  const arquivosPedidos = () => pedidos.map((pedido) => pedido.endereco).filter((endereco) => !endereco.endsWith(MAPA_DAS_TELAS));

  it("espera a tela aberta, lê o mapa sem cache, baixa os arquivos e marca a versão e o papel; na próxima entrada, não baixa de novo", async () => {
    agendarGuardaDasTelas("wms", ["pages/pedidos", "pages/estoque"]);
    await correr(ESPERA_PARA_GUARDAR_MS - 1);
    expect(pedidos).toEqual([]);
    await correr(10_000);
    expect(pedidos[0]).toEqual({ endereco: `/${MAPA_DAS_TELAS}`, opcoes: { cache: "no-store" } });
    expect(arquivosPedidos()).toEqual(["/assets/pedidos-1.js", "/assets/fila-1.js", "/assets/estoque-1.js"]);
    expect(window.localStorage.getItem(CHAVE)).toBe(marcaDaGuarda("wms"));
    expect(guardaFeita("wms")).toBe(true);
    // Outro papel no mesmo aparelho guarda as telas dele.
    expect(guardaFeita("owner")).toBe(false);
    pedidos = [];
    agendarGuardaDasTelas("wms", ["pages/pedidos"]);
    await correr(60_000);
    expect(pedidos).toEqual([]);
  });

  it("nunca importa a tela: a guarda com a rede que pisca não envenena a tela aberta depois", async () => {
    const carregar = vi.fn(carregarModulo);
    const Pedidos = telaSobDemanda("pages/pedidos", carregar);
    quebrados = new Set(["/assets/pedidos-1.js"]);
    agendarGuardaDasTelas("wms", [Pedidos.arquivo]);
    await correr(60_000);
    expect(arquivosPedidos()).toContain("/assets/pedidos-1.js");
    expect(carregar).not.toHaveBeenCalled();
    // Com falha, não marca: a próxima entrada tenta de novo.
    expect(window.localStorage.getItem(CHAVE)).toBeNull();
  });

  it("o mapa de outra versão (saiu uma publicação no meio) ou que não veio não baixa nada", async () => {
    mapa = { ...MAPA, versao: "outra" };
    agendarGuardaDasTelas("wms", ["pages/pedidos"]);
    await correr(60_000);
    expect(arquivosPedidos()).toEqual([]);
    quebrados = new Set([`/${MAPA_DAS_TELAS}`]);
    mapa = MAPA;
    agendarGuardaDasTelas("wms", ["pages/pedidos"]);
    await correr(60_000);
    expect(arquivosPedidos()).toEqual([]);
    expect(window.localStorage.getItem(CHAVE)).toBeNull();
  });

  it("sem rede não começa, e a rede que cai no meio para a guarda sem marcar", async () => {
    online = false;
    agendarGuardaDasTelas("wms", ["pages/pedidos"]);
    await correr(60_000);
    expect(pedidos).toEqual([]);
    online = true;
    vi.mocked(fetch).mockImplementation(async (endereco) => {
      pedidos.push({ endereco: String(endereco) });
      if (String(endereco).endsWith(MAPA_DAS_TELAS)) return new Response(JSON.stringify(MAPA));
      online = false;
      return new Response("1");
    });
    agendarGuardaDasTelas("wms", ["pages/pedidos", "pages/estoque"]);
    await correr(60_000);
    expect(arquivosPedidos()).toEqual(["/assets/pedidos-1.js"]);
    expect(window.localStorage.getItem(CHAVE)).toBeNull();
  });

  it("quem sai antes cancela", async () => {
    const cancelar = agendarGuardaDasTelas("wms", ["pages/pedidos"]);
    cancelar();
    await correr(60_000);
    expect(pedidos).toEqual([]);
  });

  it("no desenvolvimento não baixa nada (o Vite serve cada arquivo solto)", async () => {
    vi.stubEnv("DEV", true);
    agendarGuardaDasTelas("wms", ["pages/pedidos"]);
    await correr(60_000);
    expect(pedidos).toEqual([]);
  });
});

describe("o mapa do build", () => {
  const SRC = "/app/src";
  const pedaco = (fileName: string, extra: Partial<PedacoDoBuild> = {}): PedacoDoBuild => ({
    type: "chunk",
    fileName,
    imports: [],
    moduleIds: [],
    ...extra,
  });
  const BUNDLE: Record<string, PedacoDoBuild> = {
    "assets/shell-app-1.js": pedaco("assets/shell-app-1.js", {
      isEntry: true,
      imports: ["assets/shell-react-1.js"],
      moduleIds: [`${SRC}/main.tsx`, `${SRC}/App.tsx`],
      viteMetadata: { importedCss: new Set(["assets/index-1.css"]) },
    }),
    "assets/shell-react-1.js": pedaco("assets/shell-react-1.js", { moduleIds: ["/app/node_modules/react/index.js"] }),
    "assets/billing-hub-1.js": pedaco("assets/billing-hub-1.js", {
      imports: ["assets/shell-react-1.js", "assets/fila-1.js"],
      moduleIds: [`${SRC}/pages/billing-hub.tsx`],
    }),
    "assets/fila-1.js": pedaco("assets/fila-1.js", { moduleIds: [`${SRC}/components/fila.tsx`] }),
    "assets/billing-1.js": pedaco("assets/billing-1.js", {
      imports: ["assets/fila-1.js"],
      moduleIds: [`${SRC}/pages/billing.tsx`],
      viteMetadata: { importedCss: new Set(["assets/billing-1.css"]) },
    }),
    // A tela que divide o arquivo com outro módulo (o Vite junta os dois).
    "assets/customer-requests-1.js": pedaco("assets/customer-requests-1.js", {
      moduleIds: [`${SRC}/pages/customer-requests.tsx`, `${SRC}/lib/fila-de-pedidos.ts`],
    }),
    "assets/client-1.js": pedaco("assets/client-1.js", { moduleIds: [`${SRC}/pages/client/index.tsx`] }),
    "assets/index-1.css": { type: "asset", fileName: "assets/index-1.css" },
  };
  const DECLARADAS = new Map<string, string[]>([
    [`${SRC}/App.tsx`, ["pages/billing-hub", "pages/customer-requests", "pages/client"]],
    [`${SRC}/pages/billing-hub.tsx`, ["pages/billing"]],
  ]);

  it("cada tela leva o arquivo dela e o que ele importa, menos o shell; as de dentro vêm de quem as declara", () => {
    const mapa = mapaDasTelas(BUNDLE, DECLARADAS, SRC, "abc123");
    expect(mapa.versao).toBe("abc123");
    expect(mapa.telas["pages/billing-hub"]).toEqual({
      arquivos: ["assets/billing-hub-1.js", "assets/fila-1.js"],
      dentro: ["pages/billing"],
    });
    expect(mapa.telas["pages/billing"]).toEqual({ arquivos: ["assets/billing-1.js", "assets/fila-1.js", "assets/billing-1.css"], dentro: [] });
    expect(mapa.telas["pages/customer-requests"].arquivos).toEqual(["assets/customer-requests-1.js"]);
    expect(mapa.telas["pages/client"].arquivos).toEqual(["assets/client-1.js"]);
    // As telas do App (o shell) não são de dentro de nenhuma.
    for (const tela of Object.values(mapa.telas)) expect(tela.arquivos).not.toContain("assets/shell-app-1.js");
  });

  it("a tela declarada que não está no build derruba o build", () => {
    const comSumida = new Map([[`${SRC}/App.tsx`, ["pages/sumiu"]]]);
    expect(() => mapaDasTelas(BUNDLE, comSumida, SRC, "abc123")).toThrow(/pages\/sumiu/);
  });

  it("lê as declarações no código", () => {
    expect(
      telasDeclaradas(`const A = telaSobDemanda("pages/a", () => import("./a"));\nconst B = telaSobDemanda(\n  "pages/b", () =>\n  import("./b"));`),
    ).toEqual(["pages/a", "pages/b"]);
  });
});

describe("no código", () => {
  const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const APP_DIR = resolve(SRC, "..");
  const APP = readFileSync(resolve(SRC, "App.tsx"), "utf8");
  const VITE = readFileSync(resolve(APP_DIR, "vite.config.ts"), "utf8");

  function arquivos(pasta: string): string[] {
    return readdirSync(pasta).flatMap((nome) => {
      const caminho = join(pasta, nome);
      if (statSync(caminho).isDirectory()) return arquivos(caminho);
      return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
    });
  }

  it("toda tela do App chega sob demanda pelo telaSobDemanda, com o arquivo do próprio import", () => {
    expect(APP).not.toMatch(/\blazy\(/);
    const declaracoes = arquivos(SRC).flatMap((arquivo) => {
      const codigo = readFileSync(arquivo, "utf8");
      return [...codigo.matchAll(/\btelaSobDemanda\(\s*"([^"]+)",\s*\(\)\s*=>\s*import\("([^"]+)"\)/g)].map(([, chave, caminho]) => ({
        arquivo: relative(SRC, arquivo),
        chave,
        doImport: posix.normalize(posix.join(posix.dirname(relative(SRC, arquivo).split("\\").join("/")), caminho)),
      }));
    });
    expect(declaracoes.length).toBeGreaterThan(90);
    for (const declaracao of declaracoes) expect(declaracao.chave, declaracao.arquivo).toBe(declaracao.doImport);
    // Nenhuma chamada sem o arquivo (fora a definição e o leitor do build).
    const todas = arquivos(SRC)
      .filter((arquivo) => !/[\\/]telas-no-aparelho(?:-no-build)?\.ts$/.test(arquivo))
      .reduce((total, arquivo) => total + (readFileSync(arquivo, "utf8").match(/\btelaSobDemanda\(/g) ?? []).length, 0);
    expect(todas).toBe(declaracoes.length);
  });

  it("a guarda fica montada no App, dentro do AuthProvider, com as rotas deste ambiente e a Entrada", () => {
    expect(APP).toContain("<GuardarTelasNoAparelho />");
    expect(APP.indexOf("<GuardarTelasNoAparelho />")).toBeGreaterThan(APP.indexOf("<AuthProvider>"));
    expect(APP).toMatch(/rotaDisponivelNaArmazenagem\(route\.path\)\);\s*\/\/[^\n]*\n\s*const extras = PLATAFORMA_LIBERADA \? \[EntradaPage\] : \[\];/);
    expect(APP).toContain("agendarGuardaDasTelas(papel, telasDoPapel(rotas, papel, extras))");
    expect(APP).toContain('abreATela(() => <WmsModuleScreen module="quality" />, WarehouseOps)');
  });

  it("o vite.config.ts publica o mapa com o nome que a guarda lê, na versão do build", () => {
    expect(VITE).toContain('import { pluginDoMapaDasTelas } from "./src/lib/telas-no-aparelho-no-build";');
    expect(VITE).toContain(`nome: "${MAPA_DAS_TELAS}"`);
    expect(VITE).toMatch(/versao: buildCommit \|\| "desconhecida"/);
    expect(VITE).toMatch(/__BUILD_COMMIT__: JSON\.stringify\(buildCommit\)/);
    // O precache do service worker não pega o mapa (só json na raiz, que nenhum padrão cobre).
    const padroes = VITE.slice(VITE.indexOf("globPatterns:"), VITE.indexOf("navigateFallback:"));
    expect(padroes).not.toMatch(/json/);
  });
});
