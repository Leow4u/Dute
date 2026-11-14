import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readDocs, disableNetwork, enableNetwork, ordem, escutar, sessao } = vi.hoisted(() => {
  const ordem: string[] = [];
  return {
    ordem,
    sessao: { usuario: null as null | { uid: string } },
    escutar: vi.fn(),
    readDocs: vi.fn(),
    disableNetwork: vi.fn(async () => void ordem.push("desliga")),
    enableNetwork: vi.fn(async () => void ordem.push("liga")),
  };
});

vi.mock("./firebase", () => ({
  get firebaseAuth() {
    return sessao.usuario ? { currentUser: sessao.usuario } : null;
  },
  firestore: {},
}));
vi.mock("./functions-api", () => ({ callFunctionsApi: vi.fn(async () => null) }));
vi.mock("firebase/firestore", async (importOriginal) => {
  const original = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...original,
    collection: vi.fn((_store: unknown, path: string) => ({ path })),
    query: vi.fn((target: unknown, ...constraints: unknown[]) => ({ target, constraints })),
    doc: vi.fn((_store: unknown, path: string, id: string) => ({ path, id })),
    where: () => ({ tipo: "where" }),
    orderBy: () => ({ tipo: "orderBy" }),
    limit: (n: number) => ({ tipo: "limit", n }),
    startAfter: () => ({ tipo: "outra" }),
    documentId: () => "__name__",
    getDocs: readDocs,
    disableNetwork,
    enableNetwork,
    onSnapshot: escutar,
  };
});

import { criarConexao, ligarConexaoDoApp, type Conexao, type EstadoDaConexao } from "./carregando/estado-da-conexao";
import { acordarFirestore, aoVoltarOFirestore, installCloudApi } from "./cloud-api";
import { CODIGO_SEM_CONEXAO, CODIGO_SEM_RESPOSTA, SEM_CONEXAO, SEM_RESPOSTA } from "./conexao";

/**
 * O falso "Sem conexão" (docs/plataforma/diagnostico-carregamento.md, seção
 * 10.1; parte 7a), com o SDK do Firestore simulado e o relógio falso. Depois
 * de 10 s sem o servidor, o SDK se dá por offline e responde do cache com o
 * aparelho conectado: a tela dizia "Sem conexão." e não se refazia, porque o
 * refetchOnReconnect do react-query espera o evento online, que não vem.
 * Agora é "Reconectando", o app relê sozinho em 2, 4, 8, 16 e 30 s e a volta
 * limpa o aviso.
 */

function document(id: string, data: Record<string, unknown>) {
  return { id, data: () => data, get: (field: string) => data[field] };
}

/** O que o getDocs devolve com o SDK offline: o que estava na memória, marcado como do cache. */
const DO_CACHE = { docs: [], metadata: { fromCache: true } };
const DO_SERVIDOR = { docs: [document("BTG-000001", { sku_code: "BTG-000001", customer_code: "BTG" })], metadata: { fromCache: false } };

type ErroDaApi = Error & { status: number; data: { message: string; code?: string } };

let rede = true;
let conexao: Conexao;
let cliente: QueryClient;
let desligar: () => void;
let janela: EventTarget & { fetch: typeof fetch; location: { origin: string } };
let lidas: number[];
let zero = 0;
const agora = () => performance.now() - zero;

/** A leitura da tela: o fetchJson das telas, com o corpo da resposta no erro. */
async function lerProdutos() {
  lidas.push(agora());
  const resposta = await janela.fetch("/api/products?limit=50");
  const corpo = await resposta.json();
  if (!resposta.ok) throw Object.assign(new Error(corpo.message), { status: resposta.status, data: corpo }) as ErroDaApi;
  return corpo;
}

function observar() {
  const leitura = new QueryObserver(cliente, { queryKey: ["/api/products", { limit: 50 }], queryFn: lerProdutos });
  const resultados: Array<ReturnType<typeof leitura.getCurrentResult>> = [];
  const deixar = leitura.subscribe((resultado) => resultados.push(resultado));
  return { leitura, resultados, deixar };
}

beforeEach(() => {
  vi.useFakeTimers();
  zero = performance.now();
  rede = true;
  lidas = [];
  readDocs.mockReset();
  disableNetwork.mockClear();
  enableNetwork.mockClear();
  ordem.length = 0;
  escutar.mockReset();
  sessao.usuario = null;
  vi.stubGlobal("navigator", {
    get onLine() {
      return rede;
    },
  });
  janela = Object.assign(new EventTarget(), { fetch: vi.fn() as unknown as typeof fetch, location: { origin: "https://dute.test" } });
  vi.stubGlobal("window", janela);
  installCloudApi();
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
  conexao = criarConexao();
  desligar = ligarConexaoDoApp(cliente, conexao, janela);
});

afterEach(() => {
  desligar();
  conexao.fechar();
  cliente.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("o SDK offline com o aparelho conectado", () => {
  it("a leitura do cache é o servidor sem resposta (503 sem_resposta), e o app fica Reconectando, nunca Sem conexão", async () => {
    readDocs.mockResolvedValue(DO_CACHE);
    const { leitura, deixar } = observar();
    await vi.advanceTimersByTimeAsync(0);
    const erro = leitura.getCurrentResult().error as ErroDaApi;
    expect(erro.status).toBe(503);
    expect(erro.data).toEqual({ message: SEM_RESPOSTA, code: CODIGO_SEM_RESPOSTA });
    expect(conexao.estado()).toBe("reconectando");
    const vistos = new Set<EstadoDaConexao>();
    for (let s = 0; s < 120; s += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      vistos.add(conexao.estado());
    }
    expect([...vistos]).toEqual(["reconectando"]);
    deixar();
  });

  it("o app relê sozinho em 2, 4, 8, 16 e 30 s, sem a pessoa e sem o evento online", async () => {
    readDocs.mockResolvedValue(DO_CACHE);
    const { deixar } = observar();
    await vi.advanceTimersByTimeAsync(90_500);
    expect(lidas.map((t) => Math.round(t))).toEqual([0, 2_000, 6_000, 14_000, 30_000, 60_000, 90_000]);
    deixar();
  });

  it("a volta limpa o aviso: a releitura seguinte lê do servidor, a lista chega e o app fica conectado", async () => {
    readDocs.mockResolvedValue(DO_CACHE);
    const { leitura, deixar } = observar();
    await vi.advanceTimersByTimeAsync(6_500);
    expect(lidas).toHaveLength(3);
    // O SDK voltou ao servidor; ninguém tocou em nada.
    readDocs.mockResolvedValue(DO_SERVIDOR);
    await vi.advanceTimersByTimeAsync(7_500);
    expect(lidas).toHaveLength(4);
    const resultado = leitura.getCurrentResult();
    expect(resultado.error).toBeNull();
    expect(resultado.data.items.map((item: { sku_code: string }) => item.sku_code)).toEqual(["BTG-000001"]);
    expect(conexao.estado()).toBe("conectado");
    // E não relê mais sozinho.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(lidas).toHaveLength(4);
    deixar();
  });
});

describe("o aparelho sem rede", () => {
  it("há 3 s é Sem conexão (503 sem_conexao); antes, Reconectando", async () => {
    readDocs.mockResolvedValue(DO_CACHE);
    rede = false;
    janela.dispatchEvent(new Event("offline"));
    const { leitura, deixar } = observar();
    await vi.advanceTimersByTimeAsync(0);
    expect((leitura.getCurrentResult().error as ErroDaApi).data).toEqual({ message: SEM_CONEXAO, code: CODIGO_SEM_CONEXAO });
    expect(conexao.estado()).toBe("reconectando");
    await vi.advanceTimersByTimeAsync(2_999);
    expect(conexao.estado()).toBe("reconectando");
    await vi.advanceTimersByTimeAsync(1);
    expect(conexao.estado()).toBe("sem-conexao");
    // Sem rede, não relê sozinho.
    expect(lidas).toHaveLength(1);
    // A rede volta: o app relê na hora, e a leitura do servidor dá o conectado.
    readDocs.mockResolvedValue(DO_SERVIDOR);
    rede = true;
    janela.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(lidas).toHaveLength(2);
    expect(leitura.getCurrentResult().error).toBeNull();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(conexao.estado()).toBe("conectado");
    deixar();
  });
});

describe("acordar o SDK do Firestore que se deu por offline", () => {
  it("só depois de uma leitura do cache, e só com o aparelho com rede: desliga e religa a rede do SDK, uma vez por vez", async () => {
    // Uma leitura do servidor: nada a acordar.
    readDocs.mockResolvedValue(DO_SERVIDOR);
    await janela.fetch("/api/products?limit=50");
    expect(acordarFirestore()).toBeNull();
    // Uma do cache: acorda, e dois pedidos juntos acordam uma vez só.
    readDocs.mockResolvedValue(DO_CACHE);
    await janela.fetch("/api/products?limit=50");
    const primeiro = acordarFirestore();
    expect(primeiro).not.toBeNull();
    expect(acordarFirestore()).toBe(primeiro);
    await primeiro;
    expect(ordem).toEqual(["desliga", "liga"]);
    // Sem rede, não há o que acordar: o próprio SDK tenta quando a rede volta.
    rede = false;
    expect(acordarFirestore()).toBeNull();
    rede = true;
    // A leitura do servidor que vem depois tira a marca.
    readDocs.mockResolvedValue(DO_SERVIDOR);
    await janela.fetch("/api/products?limit=50");
    expect(acordarFirestore()).toBeNull();
  });

  it("a releitura sozinha acorda o SDK antes de ler, e a volta do servidor aparece na releitura seguinte", async () => {
    desligar();
    desligar = ligarConexaoDoApp(cliente, conexao, janela, undefined, { acordar: acordarFirestore });
    readDocs.mockImplementation(async () => {
      ordem.push("lê");
      return DO_CACHE;
    });
    const { leitura, deixar } = observar();
    await vi.advanceTimersByTimeAsync(2_100);
    expect(ordem).toEqual(["lê", "desliga", "liga", "lê"]);
    // O servidor voltou: a releitura dos 6 s, depois de acordar o SDK, lê dele.
    readDocs.mockImplementation(async () => {
      ordem.push("lê");
      return DO_SERVIDOR;
    });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(ordem).toEqual(["lê", "desliga", "liga", "lê", "desliga", "liga", "lê"]);
    expect(leitura.getCurrentResult().error).toBeNull();
    expect(leitura.getCurrentResult().data.items).toHaveLength(1);
    deixar();
  });
});

describe("a volta do SDK do Firestore", () => {
  it("com o SDK offline, escuta o perfil até ele chegar do servidor, e o app relê na hora, sem esperar a releitura sozinha", async () => {
    sessao.usuario = { uid: "u-teste" };
    const deixarDeEscutar = vi.fn();
    let avisar: (perfil: { metadata: { fromCache: boolean } }) => void = () => undefined;
    escutar.mockImplementation((_referencia: unknown, _opcoes: unknown, proximo: typeof avisar) => {
      avisar = proximo;
      return deixarDeEscutar;
    });
    desligar();
    desligar = ligarConexaoDoApp(cliente, conexao, janela, undefined, { acordar: acordarFirestore, aoVoltar: aoVoltarOFirestore });
    readDocs.mockResolvedValue(DO_CACHE);
    const { leitura, deixar } = observar();
    await vi.advanceTimersByTimeAsync(100);
    expect(leitura.getCurrentResult().error).not.toBeNull();
    // Escuta o próprio perfil, com as mudanças de metadados.
    expect(escutar).toHaveBeenCalledTimes(1);
    expect(escutar.mock.calls[0][0]).toEqual({ path: "users", id: "u-teste" });
    expect(escutar.mock.calls[0][1]).toEqual({ includeMetadataChanges: true });
    // Ainda do cache: nada.
    avisar({ metadata: { fromCache: true } });
    await vi.advanceTimersByTimeAsync(100);
    expect(lidas).toHaveLength(1);
    // O SDK voltou ao servidor aos 0,3 s: o app relê na hora, e a lista chega.
    readDocs.mockResolvedValue(DO_SERVIDOR);
    avisar({ metadata: { fromCache: false } });
    await vi.advanceTimersByTimeAsync(10);
    expect(deixarDeEscutar).toHaveBeenCalledTimes(1);
    expect(lidas).toHaveLength(2);
    expect(leitura.getCurrentResult().error).toBeNull();
    expect(leitura.getCurrentResult().data.items).toHaveLength(1);
    deixar();
  });
});
