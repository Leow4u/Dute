// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A leitura ao vivo sem o servidor (carregamento v2, parte 13j). Até a 13i, a
 * escuta só dizia `erro`: a tela não sabia se era a conexão ou o servidor, e
 * mostrava a falha da seção nos dois casos; com o aparelho conectado e o SDK
 * que se deu por offline, o cache valia como lido; e as escutas não avisavam o
 * estado único da conexão. Agora:
 *
 * - a leitura diz o que falta (`falta`): a conexão (o aparelho sem rede, ou o
 *   SDK só no cache), sem nada lido ou com o que já estava na tela (com a hora,
 *   `lidaEm`), ou o servidor (a escuta recusada);
 * - a resposta só do cache conta como a falta também com o aparelho conectado,
 *   quando o SDK se deu por offline;
 * - a escuta alimenta o estado da conexão como o react-query faz pelas leituras
 *   do `lib/cloud-api.ts`, e a releitura sozinha acorda o SDK por ela;
 * - o portal usa a nova tentativa da `useLeitura`, sem outra por cima.
 *
 * Dados sintéticos; o Firestore é de mentira. Cada teste carrega os módulos de
 * novo: o que o SDK sabe (as escutas abertas, o sinal do cache) não passa de um
 * teste ao outro.
 */

type Assinatura = { alvo: unknown; proximo: (snapshot: unknown) => void; falha: (erro: Error) => void; ativa: boolean };

const estado = vi.hoisted(() => ({ assinaturas: [] as Assinatura[] }));

vi.mock("../firebase", () => ({ firestore: {}, firebaseAuth: null }));
vi.mock("../auth", () => ({ useAppUser: () => ({ user: null, isLoaded: true }) }));
vi.mock("firebase/firestore", () => ({
  onSnapshot: (alvo: unknown, ...resto: unknown[]) => {
    const [proximo, falha] = (typeof resto[0] === "function" ? resto : resto.slice(1)) as [Assinatura["proximo"], Assinatura["falha"]];
    const assinatura: Assinatura = { alvo, proximo, falha, ativa: true };
    estado.assinaturas.push(assinatura);
    return () => {
      assinatura.ativa = false;
    };
  },
  doc: (_db: unknown, caminho: string) => ({ type: "document", caminho }),
  getDoc: async () => ({ exists: () => false }),
  queryEqual: (a: { chave?: string }, b: { chave?: string }) => a.chave === b.chave,
  refEqual: (a: { caminho?: string }, b: { caminho?: string }) => a.caminho === b.caminho,
}));

type Modulos = {
  leitura: typeof import("./leitura");
  comercial: typeof import("../comercial/leitura");
  portal: typeof import("../portal/leitura-do-portal");
  conexao: typeof import("../carregando/estado-da-conexao");
};

async function carregar(): Promise<Modulos> {
  vi.resetModules();
  return {
    leitura: await import("./leitura"),
    comercial: await import("../comercial/leitura"),
    portal: await import("../portal/leitura-do-portal"),
    conexao: await import("../carregando/estado-da-conexao"),
  };
}

const lista = (ids: string[], fromCache: boolean) => ({ docs: ids.map((id) => ({ id, data: () => ({ nome: id }) })), metadata: { fromCache } });
const documento = (id: string | null, fromCache: boolean) => ({ id: id ?? "x", exists: () => id !== null, data: () => ({ nome: id }), metadata: { fromCache } });
const consulta = (chave: string) => () => ({ type: "query", chave }) as never;

let raiz: Root | null = null;
let container: HTMLDivElement;
let semRede = false;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  semRede = false;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => !semRede);
  estado.assinaturas = [];
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const daChave = (chave: string) => estado.assinaturas.filter((assinatura) => assinatura.ativa && (assinatura.alvo as { chave?: string }).chave === chave);

type Vista = { itens: string[] | null; erro: boolean; falta: unknown; lidaEm: unknown; tentando: boolean; tentar: () => unknown };

function montarListas(m: Modulos, chaves: string[], provedor?: (filhos: ReactNode) => ReactNode) {
  const vistos: Record<string, Vista> = {};
  function Lista({ chave }: { chave: string }) {
    const leitura = m.leitura.useLeitura(`sonda:${chave}`, consulta(chave), (id) => id) as unknown as Vista;
    vistos[chave] = leitura;
    return null;
  }
  const arvore = (quais: string[]) => <>{quais.map((chave) => <Lista key={chave} chave={chave} />)}</>;
  act(() => raiz!.render(provedor ? provedor(arvore(chaves)) : arvore(chaves)));
  return {
    vistos,
    trocar: (quais: string[]) => act(() => raiz!.render(provedor ? provedor(arvore(quais)) : arvore(quais))),
  };
}

const forma = (vista: Vista) => ({ itens: vista.itens, erro: vista.erro, falta: vista.falta, lidaEm: vista.lidaEm });

describe("a falta da leitura ao vivo: a conexão ou o servidor", () => {
  it("sem rede e sem nada lido, é a conexão; a escuta recusada é o servidor", async () => {
    const m = await carregar();
    semRede = true;
    const { vistos } = montarListas(m, ["ordens", "clientes"]);
    act(() => daChave("ordens")[0]!.proximo(lista([], true)));
    expect(forma(vistos.ordens!)).toEqual({ itens: null, erro: true, falta: "conexao", lidaEm: null });

    semRede = false;
    act(() => daChave("clientes")[0]!.falha(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" })));
    expect(forma(vistos.clientes!)).toEqual({ itens: null, erro: true, falta: "servidor", lidaEm: null });
  });

  it("a lista lida que perde o servidor fica, com a falta e a hora em que deixou de estar em dia; o servidor a tira", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T13:00:00Z"));
    const m = await carregar();
    const { vistos } = montarListas(m, ["ordens"]);
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1", "OS-2"], false)));
    expect(forma(vistos.ordens!)).toEqual({ itens: ["OS-1", "OS-2"], erro: false, falta: null, lidaEm: null });

    // Dez minutos depois, a rede cai e o SDK se dá por offline: a vista deixa de estar em dia.
    vi.setSystemTime(new Date("2026-11-14T13:10:00Z"));
    semRede = true;
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1", "OS-2"], true)));
    const caiuEm = new Date("2026-11-14T13:10:00Z").getTime();
    expect(forma(vistos.ordens!)).toEqual({ itens: ["OS-1", "OS-2"], erro: false, falta: "conexao", lidaEm: caiuEm });

    // Outra resposta do cache (uma mudança local) não muda a hora.
    vi.setSystemTime(new Date("2026-11-14T13:15:00Z"));
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1", "OS-2"], true)));
    expect(vistos.ordens!.lidaEm).toBe(caiuEm);

    semRede = false;
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1", "OS-2", "OS-3"], false)));
    expect(forma(vistos.ordens!)).toEqual({ itens: ["OS-1", "OS-2", "OS-3"], erro: false, falta: null, lidaEm: null });
  });

  it("a nova tentativa repete a falta da falha enquanto não responde: o aviso não troca de peça", async () => {
    const m = await carregar();
    semRede = true;
    const { vistos } = montarListas(m, ["ordens"]);
    act(() => daChave("ordens")[0]!.proximo(lista([], true)));
    expect(vistos.ordens!.falta).toBe("conexao");
    await act(async () => {
      void vistos.ordens!.tentar();
    });
    expect(vistos.ordens).toMatchObject({ erro: true, tentando: true, falta: "conexao" });
  });

  it("o documento do Comercial, a leitura e o documento do portal dizem a falta", async () => {
    const m = await carregar();
    semRede = true;
    const vistos: Record<string, { erro: boolean; falta: unknown }> = {};
    function Telas() {
      const orcamento = m.comercial.useDocumento("quotes/10045");
      const avisos = m.portal.useLeituraDoPortal("avisos:ACME", consulta("avisos"), (id) => id);
      const comprovante = m.portal.useDocumentoDoPortal("service_orders/10045-01", () => ({ type: "document", caminho: "service_orders/10045-01" }) as never, (id) => id);
      vistos.orcamento = { erro: orcamento.erro, falta: orcamento.falta };
      vistos.avisos = { erro: avisos.erro, falta: avisos.falta };
      vistos.comprovante = { erro: comprovante.erro, falta: comprovante.falta };
      return null;
    }
    act(() => raiz!.render(<Telas />));
    const [orcamento, avisos, comprovante] = estado.assinaturas;
    act(() => orcamento!.proximo(documento(null, true)));
    act(() => avisos!.proximo(lista([], true)));
    act(() => comprovante!.falha(Object.assign(new Error("denied"), { code: "permission-denied" })));
    expect(vistos).toEqual({
      orcamento: { erro: true, falta: "conexao" },
      avisos: { erro: true, falta: "conexao" },
      comprovante: { erro: true, falta: "servidor" },
    });
  });

  it("a tela que junta leituras: a conexão das que falharam vem antes; sem falha, a das lidas, com a hora da mais antiga", async () => {
    const m = await carregar();
    const { novaTentativaDe } = m.leitura;
    const lida = (lidaEm: number | null, falta: "conexao" | null = lidaEm === null ? null : "conexao") => ({ itens: [], erro: false, falta, lidaEm });
    const falhou = (falta: "conexao" | "servidor") => ({ itens: null, erro: true, falta, lidaEm: null });
    expect(novaTentativaDe([lida(null), falhou("servidor"), falhou("conexao")])).toMatchObject({ falta: "conexao" });
    expect(novaTentativaDe([lida(1_000), falhou("servidor")])).toMatchObject({ falta: "servidor" });
    expect(novaTentativaDe([lida(2_000), lida(1_000), lida(null)])).toMatchObject({ falta: "conexao", lidaEm: 1_000 });
    expect(novaTentativaDe([lida(null), lida(null)])).toMatchObject({ falta: null, lidaEm: null });
  });
});

describe("com o aparelho conectado e o SDK do Firestore que se deu por offline", () => {
  it("o cache de outra consulta não vale como lido: é a falta de conexão, nunca a lista pela metade", async () => {
    const m = await carregar();
    const { vistos, trocar } = montarListas(m, ["demandas"]);
    act(() => daChave("demandas")[0]!.proximo(lista(["D-1"], false)));
    // O servidor não responde há 10 s: o SDK se dá por offline, e a vista que estava em dia avisa.
    act(() => daChave("demandas")[0]!.proximo(lista(["D-1"], true)));
    expect(vistos.demandas!.falta).toBe("conexao");

    trocar(["demandas", "ordens"]);
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], true)));
    expect(forma(vistos.ordens!)).toEqual({ itens: null, erro: true, falta: "conexao", lidaEm: null });

    // O servidor volta: a lista chega.
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1", "OS-2"], false)));
    expect(forma(vistos.ordens!)).toEqual({ itens: ["OS-1", "OS-2"], erro: false, falta: null, lidaEm: null });
  });

  it("a primeira resposta vazia do cache é a falta: o SDK só a entrega quando se dá por offline", async () => {
    const m = await carregar();
    const { vistos } = montarListas(m, ["ordens"]);
    act(() => daChave("ordens")[0]!.proximo(lista([], true)));
    expect(forma(vistos.ordens!)).toEqual({ itens: null, erro: true, falta: "conexao", lidaEm: null });
  });

  it("o cache que valeu antes do servidor vira a falta quando o SDK se dá por offline depois", async () => {
    const m = await carregar();
    const { vistos } = montarListas(m, ["demandas", "abertas"]);
    act(() => daChave("demandas")[0]!.proximo(lista(["D-1", "D-2"], false)));
    // A consulta das abertas recebe do cache o que a outra trouxe, antes do servidor: vale, como antes.
    act(() => daChave("abertas")[0]!.proximo(lista(["D-1"], true)));
    expect(forma(vistos.abertas!)).toEqual({ itens: ["D-1"], erro: false, falta: null, lidaEm: null });
    // O servidor não responde, e o SDK se dá por offline: a outra vista avisa, e a das abertas, que nunca esteve em dia, não.
    act(() => daChave("demandas")[0]!.proximo(lista(["D-1", "D-2"], true)));
    expect(forma(vistos.abertas!)).toEqual({ itens: null, erro: true, falta: "conexao", lidaEm: null });
  });

  it("o aparelho que perde a rede depois do cache que valeu: a falta", async () => {
    const m = await carregar();
    const { vistos } = montarListas(m, ["abertas"]);
    act(() => daChave("abertas")[0]!.proximo(lista(["D-1"], true)));
    expect(vistos.abertas!.erro).toBe(false);
    semRede = true;
    act(() => window.dispatchEvent(new Event("offline")));
    expect(forma(vistos.abertas!)).toEqual({ itens: null, erro: true, falta: "conexao", lidaEm: null });
  });
});

describe("a escuta alimenta o estado único da conexão", () => {
  it("a vista que perde o servidor é a leitura sem resposta: Reconectando; a volta dele é a leitura que deu certo", async () => {
    vi.useFakeTimers();
    const m = await carregar();
    const conexao = m.conexao.criarConexao({ temRede: () => !semRede });
    const { vistos } = montarListas(m, ["ordens"], (filhos) => <m.conexao.ProvedorDaConexao value={conexao}>{filhos}</m.conexao.ProvedorDaConexao>);
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], false)));
    expect(conexao.estado()).toBe("conectado");

    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], true)));
    expect(vistos.ordens!.falta).toBe("conexao");
    expect(conexao.estado()).toBe("reconectando");

    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], false)));
    // O aviso fica os 2 s mínimos e sai.
    act(() => vi.advanceTimersByTime(2_000));
    expect(conexao.estado()).toBe("conectado");
    conexao.fechar();
  });

  it("sem rede, a mesma escuta conta uma vez por queda: Sem conexão só aos 3 s, como manda o estado único", async () => {
    vi.useFakeTimers();
    const m = await carregar();
    const conexao = m.conexao.criarConexao({ temRede: () => !semRede });
    montarListas(m, ["ordens"], (filhos) => <m.conexao.ProvedorDaConexao value={conexao}>{filhos}</m.conexao.ProvedorDaConexao>);
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], false)));
    semRede = true;
    conexao.redeMudou();
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], true)));
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], true)));
    expect(conexao.estado()).toBe("reconectando");
    act(() => vi.advanceTimersByTime(3_000));
    expect(conexao.estado()).toBe("sem-conexao");
    conexao.fechar();
  });

  it("com só as escutas na falta, a releitura sozinha acorda o SDK em 2, 4 e 8 s, até o servidor voltar", async () => {
    vi.useFakeTimers();
    const m = await carregar();
    const conexao = m.conexao.criarConexao({ temRede: () => !semRede });
    const acordar = vi.fn(() => Promise.resolve());
    const desligar = m.conexao.ligarConexaoDoApp(new QueryClient(), conexao, window, undefined, { acordar });
    montarListas(m, ["ordens"], (filhos) => <m.conexao.ProvedorDaConexao value={conexao}>{filhos}</m.conexao.ProvedorDaConexao>);
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], false)));
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], true)));
    expect(acordar).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2_000));
    expect(acordar).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(4_000));
    expect(acordar).toHaveBeenCalledTimes(2);
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], false)));
    act(() => vi.advanceTimersByTime(60_000));
    expect(acordar).toHaveBeenCalledTimes(2);
    desligar();
    conexao.fechar();
  });

  it("a escuta que sai da tela com a falta deixa de contar: a releitura para", async () => {
    vi.useFakeTimers();
    const m = await carregar();
    const conexao = m.conexao.criarConexao({ temRede: () => !semRede });
    const acordar = vi.fn(() => Promise.resolve());
    const desligar = m.conexao.ligarConexaoDoApp(new QueryClient(), conexao, window, undefined, { acordar });
    const { trocar } = montarListas(m, ["ordens"], (filhos) => <m.conexao.ProvedorDaConexao value={conexao}>{filhos}</m.conexao.ProvedorDaConexao>);
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], false)));
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], true)));
    trocar([]);
    act(() => vi.advanceTimersByTime(60_000));
    expect(acordar).not.toHaveBeenCalled();
    desligar();
    conexao.fechar();
  });
});

describe("o portal usa a nova tentativa da useLeitura, sem outra por cima", () => {
  it("o toque numa leitura pede a nova assinatura também à outra da mesma chave que ainda não leu", async () => {
    const m = await carregar();
    const vistos: Array<{ erro: boolean; tentar: () => void }> = [];
    function Avisos({ indice }: { indice: number }) {
      const leitura = m.portal.useLeituraDoPortal("client_notifications:ACME", consulta("avisos"), (id) => id);
      vistos[indice] = leitura;
      return null;
    }
    act(() =>
      raiz!.render(
        <>
          <Avisos indice={0} />
          <Avisos indice={1} />
        </>,
      ),
    );
    for (const assinatura of daChave("avisos")) act(() => assinatura.falha(Object.assign(new Error("unavailable"), { code: "internal" })));
    expect(vistos.map((vista) => vista.erro)).toEqual([true, true]);
    const antes = estado.assinaturas.length;
    act(() => vistos[0]!.tentar());
    // As duas assinam de novo (o sino e a lista do portal com a mesma chave voltam juntos).
    expect(estado.assinaturas.length - antes).toBe(2);
    expect(daChave("avisos")).toHaveLength(2);
  });
});

/**
 * A revisão da parte 13j: a escuta e o estado único da conexão andam juntos.
 * A leitura do react-query que volta (a callable) não tira o "Reconectando"
 * enquanto uma escuta segue sem o servidor, e a releitura sozinha continua
 * acordando o SDK; a nova tentativa que deu certo, e a escuta que saiu da tela
 * com a falta, devolvem o estado a "conectado" na próxima resposta do servidor.
 */
describe("a escuta e o estado único da conexão, juntos (revisão da 13j)", () => {
  const passar = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
      await Promise.resolve();
    });
  };

  it("a callable que volta não desliga o despertar das escutas que seguem sem o servidor", async () => {
    vi.useFakeTimers();
    const m = await carregar();
    const conexao = m.conexao.criarConexao({ temRede: () => !semRede });
    const acordar = vi.fn(() => Promise.resolve());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const desligar = m.conexao.ligarConexaoDoApp(queryClient, conexao, window, undefined, { acordar });
    const { vistos } = montarListas(m, ["ordens"], (filhos) => <m.conexao.ProvedorDaConexao value={conexao}>{filhos}</m.conexao.ProvedorDaConexao>);
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], false)));
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], true)));
    // Uma callable que tinha ficado sem resposta volta: o servidor das callables respondeu, o do Firestore não.
    const { SemResposta } = await import("../conexao");
    let vez = 0;
    const opcoes = { queryKey: ["callable"], queryFn: async () => (vez++ === 0 ? Promise.reject(new SemResposta()) : "ok") };
    await act(async () => void (await queryClient.fetchQuery(opcoes).catch(() => undefined)));
    await act(async () => void (await queryClient.fetchQuery({ ...opcoes, staleTime: 0 }).catch(() => undefined)));
    const antes = acordar.mock.calls.length;
    for (const segundos of [2, 4, 8, 16, 30]) await passar(segundos * 1_000);
    expect(vistos.ordens!.falta).toBe("conexao");
    expect(conexao.estado()).toBe("reconectando");
    expect(acordar.mock.calls.length - antes).toBeGreaterThanOrEqual(4);
    // O servidor do Firestore volta: aí sim, conectado, e a releitura para.
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], false)));
    await passar(2_000);
    expect(conexao.estado()).toBe("conectado");
    const depois = acordar.mock.calls.length;
    await passar(120_000);
    expect(acordar.mock.calls.length).toBe(depois);
    desligar();
    conexao.fechar();
  });

  it("o Tentar de novo que deu certo devolve o estado único a conectado", async () => {
    vi.useFakeTimers();
    const m = await carregar();
    const conexao = m.conexao.criarConexao({ temRede: () => !semRede });
    const desligar = m.conexao.ligarConexaoDoApp(new QueryClient(), conexao, window, undefined, { acordar: () => Promise.resolve() });
    const { vistos } = montarListas(m, ["ordens"], (filhos) => <m.conexao.ProvedorDaConexao value={conexao}>{filhos}</m.conexao.ProvedorDaConexao>);
    // A primeira visita com o SDK offline: a resposta vazia do cache é a falta.
    act(() => daChave("ordens")[0]!.proximo(lista([], true)));
    expect(vistos.ordens!.falta).toBe("conexao");
    expect(conexao.estado()).toBe("reconectando");
    await act(async () => {
      vistos.ordens!.tentar();
      await Promise.resolve();
    });
    // A nova assinatura ouve o servidor: a lista chega, e o estado único fica sabendo.
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1", "OS-2"], false)));
    expect(vistos.ordens!.itens).toEqual(["OS-1", "OS-2"]);
    await passar(2_000);
    expect(conexao.estado()).toBe("conectado");
    desligar();
    conexao.fechar();
  });

  it("a escuta que sai da tela com a falta: a próxima escuta que ouve o servidor devolve o conectado; a volta do SDK também", async () => {
    vi.useFakeTimers();
    const m = await carregar();
    const conexao = m.conexao.criarConexao({ temRede: () => !semRede });
    const desligar = m.conexao.ligarConexaoDoApp(new QueryClient(), conexao, window, undefined, { acordar: () => Promise.resolve() });
    const { trocar } = montarListas(m, ["ordens"], (filhos) => <m.conexao.ProvedorDaConexao value={conexao}>{filhos}</m.conexao.ProvedorDaConexao>);
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], false)));
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], true)));
    expect(conexao.estado()).toBe("reconectando");
    // A pessoa vai para outra tela, com outra escuta, que ouve o servidor.
    trocar(["pessoas"]);
    act(() => daChave("pessoas")[0]!.proximo(lista(["Ana"], false)));
    await passar(2_000);
    expect(conexao.estado()).toBe("conectado");
    desligar();
    conexao.fechar();

    // Sem outra escuta: quando o SDK volta a ouvir o servidor (o perfil, no app), o estado volta.
    const outra = m.conexao.criarConexao({ temRede: () => !semRede });
    let voltou: (() => void) | null = null;
    const desligarOutra = m.conexao.ligarConexaoDoApp(new QueryClient(), outra, window, undefined, {
      acordar: () => Promise.resolve(),
      aoVoltar: (ouvinte) => {
        voltou = ouvinte;
        return () => undefined;
      },
    });
    trocar([]);
    const segunda = montarListas(m, ["ordens"], (filhos) => <m.conexao.ProvedorDaConexao value={outra}>{filhos}</m.conexao.ProvedorDaConexao>);
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], false)));
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], true)));
    expect(outra.estado()).toBe("reconectando");
    segunda.trocar([]);
    act(() => voltou!());
    await passar(2_000);
    expect(outra.estado()).toBe("conectado");
    desligarOutra();
    outra.fechar();
  });

  it("a volta devida não sobra: depois de outra leitura que deu certo, a escuta em dia não tira o Reconectando de uma callable", async () => {
    vi.useFakeTimers();
    const m = await carregar();
    const conexao = m.conexao.criarConexao({ temRede: () => !semRede });
    const { trocar } = montarListas(m, ["ordens"], (filhos) => <m.conexao.ProvedorDaConexao value={conexao}>{filhos}</m.conexao.ProvedorDaConexao>);
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], false)));
    act(() => daChave("ordens")[0]!.proximo(lista(["OS-1"], true)));
    trocar(["pessoas"]);
    // Uma leitura que tinha falhado volta (a dívida da escuta que saiu fica paga) e, depois, uma callable fica sem resposta.
    conexao.leuDoServidor();
    await passar(2_000);
    expect(conexao.estado()).toBe("conectado");
    conexao.ficouSemResposta();
    expect(conexao.estado()).toBe("reconectando");
    // A escuta que ouve o servidor não diz nada da callable.
    act(() => daChave("pessoas")[0]!.proximo(lista(["Ana"], false)));
    await passar(2_000);
    expect(conexao.estado()).toBe("reconectando");
    conexao.fechar();
  });
});

describe("a tela que junta as tentativas de várias leituras (revisão da 13j)", () => {
  it("a juntarTentativas classifica a falta como a novaTentativaDe: a lida sem o servidor não é falha", async () => {
    const m = await carregar();
    const noop = () => undefined;
    const lida = { itens: [], erro: false, falta: "conexao" as const, lidaEm: 1_000, tentando: false, tentar: noop };
    const recusada = { itens: null, erro: true, falta: "servidor" as const, lidaEm: null, tentando: false, tentar: noop };
    const semNada = { itens: null, erro: true, falta: "conexao" as const, lidaEm: null, tentando: false, tentar: noop };
    const porNova = m.leitura.novaTentativaDe([lida, recusada]);
    const porJuntar = m.leitura.juntarTentativas(m.leitura.novaTentativaDe([lida]), m.leitura.novaTentativaDe([recusada]));
    expect(porNova.falta).toBe("servidor");
    expect(porJuntar.falta).toBe("servidor");
    // Sem nada lido sem conexão vem antes do servidor; sem falha, a das lidas, com a hora.
    expect(m.leitura.juntarTentativas(m.leitura.novaTentativaDe([recusada]), m.leitura.novaTentativaDe([semNada])).falta).toBe("conexao");
    expect(m.leitura.juntarTentativas(m.leitura.novaTentativaDe([lida]), { tentando: false, tentar: noop })).toMatchObject({ falta: "conexao", lidaEm: 1_000 });
    // A junção de junções classifica do mesmo jeito.
    expect(m.leitura.juntarTentativas(porJuntar, m.leitura.novaTentativaDe([lida])).falta).toBe("servidor");
  });
});
