import { QueryClient, QueryObserver, type QueryObserverResult } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SemConexao, SemResposta } from "@/lib/conexao";

import { criarConexao, ligarConexaoDoApp, type Conexao } from "./estado-da-conexao";

/**
 * A conexão ligada ao react-query (carregamento v2, momentos 7 e 8; parte
 * 7a), no relógio falso. A releitura sozinha é em silêncio: a tela não muda
 * enquanto relê. A leitura sem dado não volta a "carregando" (o bloco
 * "Reconectando…" e o foco nele ficam), a com dado não fica em `isFetching`
 * (o Atualizar não gira nem se desabilita), e só a volta do servidor muda a
 * tela. Só a volta de uma leitura que tinha ficado sem resposta conta como o
 * servidor que voltou.
 */

let rede = true;
let conexao: Conexao;
let cliente: QueryClient;
let janela: EventTarget;
let desligar: () => void;
let zero = 0;
const agora = () => performance.now() - zero;

beforeEach(() => {
  vi.useFakeTimers();
  zero = performance.now();
  rede = true;
  conexao = criarConexao({ temRede: () => rede, agora });
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false, refetchOnReconnect: false } } });
  janela = new EventTarget();
});

afterEach(() => {
  desligar?.();
  conexao.fechar();
  cliente.clear();
  vi.useRealTimers();
});

function ligar(acordar?: () => Promise<void> | null) {
  desligar = ligarConexaoDoApp(cliente, conexao, janela as unknown as Window, agora, { acordar });
}

/** Uma leitura na tela, com cada resultado que a tela viu. */
function observar<T>(chave: string, ler: () => Promise<T>) {
  const leitura = new QueryObserver(cliente, { queryKey: [chave], queryFn: ler });
  const vistos: Array<QueryObserverResult<T>> = [];
  const deixar = leitura.subscribe((resultado) => vistos.push(resultado));
  return { leitura, vistos, deixar };
}

/** Uma leitura que fica sem resposta em `ms` (o cache do SDK offline com o aparelho conectado). */
function semResposta(ms = 5) {
  return () => new Promise<never>((_, recusar) => setTimeout(() => recusar(new SemResposta()), ms));
}

describe("a releitura sozinha não mexe na tela", () => {
  it("a leitura sem dado não volta a carregando: fica no erro, sem isFetching, enquanto relê em 2, 4, 8 e 16 s", async () => {
    ligar();
    const ler = vi.fn(semResposta());
    const { vistos, deixar } = observar("skus", ler);
    await vi.advanceTimersByTimeAsync(100);
    expect(vistos.at(-1)?.status).toBe("error");
    const desde = vistos.length;
    await vi.advanceTimersByTimeAsync(31_000);
    // Leu de novo em 2, 6, 14 e 30 s, sem a tela ver nada.
    expect(ler).toHaveBeenCalledTimes(5);
    expect(vistos.slice(desde)).toEqual([]);
    expect(conexao.estado()).toBe("reconectando");
    deixar();
  });

  it("a leitura com dado fica sem isFetching: o Atualizar não gira nem se desabilita", async () => {
    ligar();
    let falhar = false;
    const ler = vi.fn(async () => {
      if (falhar) return semResposta()();
      return { itens: [1] };
    });
    const { leitura, vistos, deixar } = observar("ops", ler);
    await vi.advanceTimersByTimeAsync(10);
    falhar = true;
    void leitura.refetch();
    await vi.advanceTimersByTimeAsync(10);
    expect(vistos.at(-1)?.status).toBe("error");
    expect(vistos.at(-1)?.data).toEqual({ itens: [1] });
    const desde = vistos.length;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ler).toHaveBeenCalledTimes(5);
    expect(vistos.slice(desde).some((resultado) => resultado.isFetching)).toBe(false);
    deixar();
  });

  it("a volta: o dado entra direto, sem passar por carregando, e o app fica conectado", async () => {
    ligar();
    let voltou = false;
    const ler = vi.fn(async () => {
      if (!voltou) return semResposta()();
      return { itens: ["BTG-000001"] };
    });
    const { vistos, deixar } = observar("skus", ler);
    await vi.advanceTimersByTimeAsync(2_500);
    const desde = vistos.length;
    voltou = true;
    await vi.advanceTimersByTimeAsync(4_000);
    const depois = vistos.slice(desde);
    expect(depois.map((resultado) => resultado.status)).toEqual(["success"]);
    expect(depois[0].data).toEqual({ itens: ["BTG-000001"] });
    expect(depois[0].error).toBeNull();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(conexao.estado()).toBe("conectado");
    deixar();
  });

  it("o servidor que responde com outro erro: a leitura de verdade mostra qual", async () => {
    ligar();
    let outro = false;
    const ler = vi.fn(async () => {
      if (!outro) return semResposta()();
      throw new Error("Permissão negada.");
    });
    const { leitura, deixar } = observar("skus", ler);
    await vi.advanceTimersByTimeAsync(100);
    outro = true;
    await vi.advanceTimersByTimeAsync(2_100);
    expect((leitura.getCurrentResult().error as Error).message).toBe("Permissão negada.");
    deixar();
  });

  it("não relê a leitura que já está lendo: o toque que ainda lê não recomeça nem dobra", async () => {
    ligar();
    let fase: "dado" | "falta" | "lenta" = "dado";
    const ler = vi.fn(async () => {
      if (fase === "dado") return { itens: [1] };
      if (fase === "falta") return semResposta()();
      return new Promise<{ itens: number[] }>((resolver) => setTimeout(() => resolver({ itens: [2] }), 10_000));
    });
    const { leitura, deixar } = observar("ops", ler);
    await vi.advanceTimersByTimeAsync(10);
    fase = "falta";
    void leitura.refetch();
    await vi.advanceTimersByTimeAsync(10);
    // A pessoa toca em Tentar de novo, e a leitura demora 10 s.
    fase = "lenta";
    void leitura.refetch();
    await vi.advanceTimersByTimeAsync(9_000);
    // A releitura dos 2 s e a dos 6 s acharam a leitura do toque andando e não leram de novo.
    expect(ler).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(leitura.getCurrentResult().data).toEqual({ itens: [2] });
    deixar();
  });

  it("antes de reler, acorda a conexão de quem lê, e só lê depois", async () => {
    let acordou: (() => void) | null = null;
    const acordar = vi.fn(() => new Promise<void>((resolver) => (acordou = resolver)));
    ligar(acordar);
    const ler = vi.fn(semResposta());
    const { deixar } = observar("skus", ler);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(acordar).toHaveBeenCalledTimes(1);
    expect(ler).toHaveBeenCalledTimes(1);
    acordou!();
    await vi.advanceTimersByTimeAsync(0);
    expect(ler).toHaveBeenCalledTimes(2);
    deixar();
  });

  it("a tela não muda sob o dedo: o dado da releitura espera 700 ms do último toque, até 3 s", async () => {
    ligar();
    let voltou = false;
    const ler = vi.fn(async () => {
      if (!voltou) return semResposta()();
      return { itens: [2] };
    });
    const { leitura, deixar } = observar("ops", ler);
    await vi.advanceTimersByTimeAsync(100);
    voltou = true;
    // A releitura dos 2 s lê do servidor, mas a pessoa tocou na tela aos 1,9 s.
    await vi.advanceTimersByTimeAsync(1_800);
    janela.dispatchEvent(new Event("pointerdown"));
    // Leu aos 2 s; o dado espera até 700 ms depois do toque (2,6 s).
    await vi.advanceTimersByTimeAsync(690);
    expect(leitura.getCurrentResult().data).toBeUndefined();
    await vi.advanceTimersByTimeAsync(20);
    expect(leitura.getCurrentResult().data).toEqual({ itens: [2] });
    deixar();
  });

  it("o dedo que não sai segura no máximo 3 s", async () => {
    ligar();
    let voltou = false;
    const ler = vi.fn(async () => {
      if (!voltou) return semResposta()();
      return { itens: [2] };
    });
    const { leitura, deixar } = observar("ops", ler);
    await vi.advanceTimersByTimeAsync(100);
    voltou = true;
    await vi.advanceTimersByTimeAsync(1_900);
    for (let vez = 0; vez < 29; vez += 1) {
      janela.dispatchEvent(new Event("pointerdown"));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(leitura.getCurrentResult().data).toBeUndefined();
    janela.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(110);
    expect(leitura.getCurrentResult().data).toEqual({ itens: [2] });
    deixar();
  });
});

describe("o que diz que o servidor voltou", () => {
  it("a leitura que nunca ficou sem resposta (a do cache do Firestore, fora do cloud-api) não tira o Reconectando", async () => {
    ligar();
    const estados: string[] = [];
    conexao.assinar(() => estados.push(conexao.estado()));
    const { deixar } = observar("skus", vi.fn(semResposta()));
    await vi.advanceTimersByTimeAsync(100);
    expect(conexao.estado()).toBe("reconectando");
    // Os convites, lidos do cache do SDK offline, "dão certo" a cada segundo.
    const convites = observar("convites", async () => ["convite"]);
    for (let vez = 0; vez < 10; vez += 1) {
      await convites.leitura.refetch();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(estados).toEqual(["reconectando"]);
    convites.deixar();
    deixar();
  });

  it("a releitura em silêncio que fica sem resposta de novo devolve o Reconectando, e a releitura segue", async () => {
    ligar();
    const lerA = vi.fn(semResposta());
    let bVoltou = false;
    const a = observar("ops", lerA);
    const b = observar("solicitacoes", async () => {
      if (!bVoltou) return semResposta()();
      return ["solicitacao"];
    });
    await vi.advanceTimersByTimeAsync(100);
    // A pessoa relê as solicitações, e elas vêm: o servidor voltou para elas.
    bVoltou = true;
    void b.leitura.refetch();
    await vi.advanceTimersByTimeAsync(1_950);
    // Aos 2 s o aviso pode sair: o app relê em silêncio o que ainda está com a falta, e ela fica sem resposta.
    expect(lerA).toHaveBeenCalledTimes(2);
    expect(conexao.estado()).toBe("reconectando");
    await vi.advanceTimersByTimeAsync(2_100);
    expect(lerA).toHaveBeenCalledTimes(3);
    a.deixar();
    b.deixar();
  });

  it("o setQueryData não leu nada: não tira o Reconectando", async () => {
    ligar();
    const { deixar } = observar("skus", vi.fn(semResposta(5_000)));
    await vi.advanceTimersByTimeAsync(5_100);
    expect(conexao.estado()).toBe("reconectando");
    cliente.setQueryData(["skus"], { itens: [] });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(conexao.estado()).toBe("reconectando");
    deixar();
  });

  it("sem rede, as leituras que saíram juntas (Pedidos lê três) contam como uma: Sem conexão só aos 3 s", async () => {
    rede = false;
    conexao.fechar();
    conexao = criarConexao({ temRede: () => rede, agora });
    ligar();
    const falhar = () => new Promise<never>((_, recusar) => setTimeout(() => recusar(new SemConexao()), 5));
    const leituras = ["ops", "solicitacoes", "saldos"].map((chave) => observar(chave, falhar));
    await vi.advanceTimersByTimeAsync(100);
    expect(conexao.estado()).toBe("reconectando");
    await vi.advanceTimersByTimeAsync(2_800);
    expect(conexao.estado()).toBe("reconectando");
    await vi.advanceTimersByTimeAsync(100);
    expect(conexao.estado()).toBe("sem-conexao");
    for (const { deixar } of leituras) deixar();
  });
});
