// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BarraDeEspera } from "@/components/ui/barra-de-espera";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { SemConexao, SemResposta } from "@/lib/conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { CARREGANDO } from "./tempo";
import { desfechoDoErro, resultadoNaTelaEm, useAcaoNaLinha, type AcaoNaLinha, type OpcoesDaAcao } from "./use-acao-na-linha";

/**
 * A ação por linha (carregamento v2, seção 9 e momento 4), no lugar do `busy`
 * global de Pedidos: cada linha tem o próprio estado, várias andam ao mesmo
 * tempo, o segundo toque na linha ocupada é ignorado e a chave de
 * idempotência é por tentativa, repetida quando o resultado ficou incerto
 * (o "Conferir" dos 70 s e a falta de conexão).
 */

type Pedido = "1042" | "1043" | "1045";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let acoes: AcaoNaLinha<Pedido>;
let desenhos = 0;

function Sonda() {
  acoes = useAcaoNaLinha<Pedido>();
  desenhos += 1;
  return null;
}

/** Uma promessa que o teste resolve ou rejeita quando quiser. */
function adiada<T = unknown>() {
  let resolver!: (valor: T) => void;
  let rejeitar!: (erro: unknown) => void;
  const promessa = new Promise<T>((ok, falha) => {
    resolver = ok;
    rejeitar = falha;
  });
  return { promessa, resolver, rejeitar };
}

/** O `fazer` de uma linha: guarda cada chave recebida e devolve a promessa da vez. */
function chamada() {
  const chaves: string[] = [];
  const vezes: Array<ReturnType<typeof adiada>> = [];
  const fazer = vi.fn((chave: string) => {
    chaves.push(chave);
    const vez = adiada();
    vezes.push(vez);
    return vez.promessa;
  });
  return { fazer, chaves, vezes, ultima: () => vezes[vezes.length - 1] };
}

async function executar(id: Pedido, acao: string, fazer: (chave: string) => Promise<unknown>, opcoes?: OpcoesDaAcao) {
  await act(async () => {
    void acoes.executar(id, acao, fazer, opcoes);
  });
}

/** Resolve (ou rejeita) e deixa o React e as microtarefas assentarem. */
async function assentar(fazer: () => void) {
  await act(async () => {
    fazer();
  });
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const RECUSA_DO_SERVIDOR = Object.assign(new Error("Saldo insuficiente para 12 un."), { code: "failed-precondition", status: 400 });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  desenhos = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  act(() => raiz!.render(<Sonda />));
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("cada linha tem o próprio estado", () => {
  it("em repouso, nenhuma linha está ocupada", () => {
    expect(acoes.estado("1042", "aprovar")).toBe("repouso");
    expect(acoes.ocupada("1042")).toBe(false);
    expect(acoes.desde("1042")).toBeNull();
    expect(acoes.motivo("1042")).toBeNull();
  });

  it("aprovar a 1042 deixa a 1043 e a 1045 livres; o Recusar da 1042 continua em repouso, com a linha ocupada", async () => {
    const aprovar = chamada();
    const inicio = performance.now();
    await executar("1042", "aprovar", aprovar.fazer);
    expect(acoes.estado("1042", "aprovar")).toBe("andamento");
    expect(acoes.ocupada("1042")).toBe(true);
    expect(acoes.desde("1042")).toBe(inicio);
    expect(acoes.estado("1042", "recusar")).toBe("repouso");
    for (const livre of ["1043", "1045"] as const) {
      expect(acoes.estado(livre, "aprovar"), livre).toBe("repouso");
      expect(acoes.ocupada(livre), livre).toBe(false);
      expect(acoes.desde(livre), livre).toBeNull();
    }
  });

  it("duas linhas andam ao mesmo tempo, e cada uma termina por si", async () => {
    const a1042 = chamada();
    const a1043 = chamada();
    await executar("1042", "aprovar", a1042.fazer);
    await passar(200);
    await executar("1043", "aprovar", a1043.fazer);
    expect(acoes.estado("1042", "aprovar")).toBe("andamento");
    expect(acoes.estado("1043", "aprovar")).toBe("andamento");
    expect(acoes.desde("1043")! - acoes.desde("1042")!).toBe(200);
    // As chaves são de cada linha.
    expect(a1042.chaves[0]).not.toBe(a1043.chaves[0]);

    await assentar(() => a1043.ultima().resolver({ ok: true }));
    expect(acoes.estado("1043", "aprovar")).toBe("sucesso");
    expect(acoes.estado("1042", "aprovar")).toBe("andamento");
    expect(acoes.ocupada("1042")).toBe(true);

    await assentar(() => a1042.ultima().rejeitar(RECUSA_DO_SERVIDOR));
    expect(acoes.estado("1042", "aprovar")).toBe("erro");
    expect(acoes.estado("1043", "aprovar")).toBe("sucesso");
  });

  it("o segundo toque na linha ocupada é ignorado, também o de outra ação da mesma linha", async () => {
    const aprovar = chamada();
    const recusar = chamada();
    await executar("1042", "aprovar", aprovar.fazer);
    await executar("1042", "aprovar", aprovar.fazer);
    await executar("1042", "recusar", recusar.fazer);
    expect(aprovar.fazer).toHaveBeenCalledTimes(1);
    expect(recusar.fazer).not.toHaveBeenCalled();
    expect(acoes.estado("1042", "recusar")).toBe("repouso");
    // Ocupada também no sucesso: a linha está de saída.
    await assentar(() => aprovar.ultima().resolver(undefined));
    expect(acoes.ocupada("1042")).toBe(true);
    await executar("1042", "aprovar", aprovar.fazer);
    await executar("1042", "recusar", recusar.fazer);
    expect(aprovar.fazer).toHaveBeenCalledTimes(1);
    expect(recusar.fazer).not.toHaveBeenCalled();
  });

  it("dois toques no mesmo instante, antes de a tela redesenhar, chamam uma vez só", async () => {
    const aprovar = chamada();
    await act(async () => {
      void acoes.executar("1042", "aprovar", aprovar.fazer);
      void acoes.executar("1042", "aprovar", aprovar.fazer);
    });
    expect(aprovar.fazer).toHaveBeenCalledTimes(1);
  });

  it("o fazer que quebra na hora vira erro da linha, sem derrubar a tela", async () => {
    await executar("1042", "aprovar", () => {
      throw RECUSA_DO_SERVIDOR;
    });
    expect(acoes.estado("1042", "aprovar")).toBe("erro");
    expect(acoes.motivo("1042")).toEqual({ acao: "aprovar", erro: RECUSA_DO_SERVIDOR });
  });
});

describe("o sucesso fica pelo menos 1 s, contado de quando o botão o mostra", () => {
  it("antes de 300 ms o botão vai direto ao sucesso, e ele fica 1 s", async () => {
    const aprovar = chamada();
    await executar("1042", "aprovar", aprovar.fazer);
    await passar(100);
    await assentar(() => aprovar.ultima().resolver(undefined));
    expect(acoes.estado("1042", "aprovar")).toBe("sucesso");
    expect(acoes.desde("1042")).toBeNull();
    await passar(CARREGANDO.sucessoVisivelMs - 1);
    expect(acoes.estado("1042", "aprovar")).toBe("sucesso");
    await passar(1);
    expect(acoes.estado("1042", "aprovar")).toBe("repouso");
    expect(acoes.ocupada("1042")).toBe(false);
  });

  it("depois de 300 ms, o em andamento fica o mínimo de 500 ms no botão, e o sucesso conta dali", async () => {
    const aprovar = chamada();
    await executar("1042", "aprovar", aprovar.fazer);
    await passar(400);
    await assentar(() => aprovar.ultima().resolver(undefined));
    // O botão mostra o sucesso aos 800 ms (300 + 500): fica até 1800 ms.
    await passar(1_399);
    expect(acoes.estado("1042", "aprovar")).toBe("sucesso");
    await passar(1);
    expect(acoes.estado("1042", "aprovar")).toBe("repouso");
  });

  it("com a releitura, fica até ela chegar", async () => {
    const aprovar = chamada();
    const releitura = adiada();
    await executar("1042", "aprovar", aprovar.fazer, { releitura: () => releitura.promessa });
    await assentar(() => aprovar.ultima().resolver(undefined));
    await passar(3_000);
    expect(acoes.estado("1042", "aprovar")).toBe("sucesso");
    await assentar(() => releitura.resolver(undefined));
    expect(acoes.estado("1042", "aprovar")).toBe("repouso");
  });

  it("a releitura que falha ou não chega não prende a linha", async () => {
    const aprovar = chamada();
    await executar("1042", "aprovar", aprovar.fazer, { releitura: () => Promise.reject(new Error("sem rede")) });
    await assentar(() => aprovar.ultima().resolver(undefined));
    await passar(CARREGANDO.sucessoVisivelMs);
    expect(acoes.estado("1042", "aprovar")).toBe("repouso");

    const recusar = chamada();
    await executar("1043", "recusar", recusar.fazer, { releitura: () => new Promise(() => undefined) });
    await assentar(() => recusar.ultima().resolver(undefined));
    await passar(CARREGANDO.desisteMs - 1);
    expect(acoes.estado("1043", "recusar")).toBe("sucesso");
    await passar(1);
    expect(acoes.estado("1043", "recusar")).toBe("repouso");
  });

  it("a próxima ação depois do sucesso leva chave nova", async () => {
    const aprovar = chamada();
    await executar("1042", "aprovar", aprovar.fazer);
    await assentar(() => aprovar.ultima().resolver(undefined));
    await passar(CARREGANDO.sucessoVisivelMs);
    await executar("1042", "aprovar", aprovar.fazer);
    expect(aprovar.chaves).toHaveLength(2);
    expect(aprovar.chaves[1]).not.toBe(aprovar.chaves[0]);
  });
});

describe("o erro volta ao repouso em 2 s, e o motivo fica na linha", () => {
  it("'Não aprovado' fica 2 s; depois o botão volta, com o motivo até a próxima ação", async () => {
    const aprovar = chamada();
    await executar("1042", "aprovar", aprovar.fazer);
    await passar(100);
    await assentar(() => aprovar.ultima().rejeitar(RECUSA_DO_SERVIDOR));
    expect(acoes.estado("1042", "aprovar")).toBe("erro");
    expect(acoes.ocupada("1042")).toBe(false);
    expect(acoes.motivo("1042")).toEqual({ acao: "aprovar", erro: RECUSA_DO_SERVIDOR });
    await passar(CARREGANDO.erroVisivelMs - 1);
    expect(acoes.estado("1042", "aprovar")).toBe("erro");
    await passar(1);
    expect(acoes.estado("1042", "aprovar")).toBe("repouso");
    expect(acoes.motivo("1042")).toEqual({ acao: "aprovar", erro: RECUSA_DO_SERVIDOR });

    // A próxima ação na linha limpa o motivo.
    await executar("1042", "recusar", chamada().fazer);
    expect(acoes.motivo("1042")).toBeNull();
    expect(acoes.estado("1042", "recusar")).toBe("andamento");
  });

  it("a recusa do servidor encerra a tentativa: a próxima leva chave nova", async () => {
    const aprovar = chamada();
    await executar("1042", "aprovar", aprovar.fazer);
    await assentar(() => aprovar.ultima().rejeitar(RECUSA_DO_SERVIDOR));
    // Durante os 2 s do erro a linha está livre: tocar de novo é nova tentativa.
    await executar("1042", "aprovar", aprovar.fazer);
    expect(aprovar.chaves).toHaveLength(2);
    expect(aprovar.chaves[1]).not.toBe(aprovar.chaves[0]);
  });

  it("depois da falta de conexão, a repetição leva a mesma chave", async () => {
    for (const falta of [
      new SemConexao(),
      Object.assign(new Error("internal"), { code: "functions/internal" }),
      // O servidor sem resposta com o aparelho conectado (parte 7a), como o fetchJson de Pedidos o devolve.
      Object.assign(new Error("Sem resposta do servidor."), { status: 503, data: { message: "Sem resposta do servidor.", code: "sem_resposta" } }),
    ]) {
      const aprovar = chamada();
      await executar("1045", "aprovar", aprovar.fazer);
      await assentar(() => aprovar.ultima().rejeitar(falta));
      expect(acoes.estado("1045", "aprovar")).toBe("erro");
      expect(acoes.motivo("1045")).toEqual({ acao: "aprovar", erro: falta });
      await passar(CARREGANDO.erroVisivelMs);
      await executar("1045", "aprovar", aprovar.fazer);
      expect(aprovar.chaves).toHaveLength(2);
      expect(aprovar.chaves[1]).toBe(aprovar.chaves[0]);
      await assentar(() => aprovar.ultima().resolver(undefined));
      await passar(CARREGANDO.sucessoVisivelMs);
    }
  });

  it("a falha interna do servidor e o erro sem código não dizem se gravou: a repetição leva a mesma chave", async () => {
    for (const falha of [
      // O que o fetchJson de Pedidos (erroDaResposta) devolve da callable que quebrou no servidor.
      Object.assign(new Error("Falha interna no servidor. Tente novamente ou avise o time técnico."), { status: 500, code: "internal" }),
      Object.assign(new Error("INTERNAL"), { code: "functions/internal" }),
      new TypeError("Failed to fetch"),
      // A resposta 2xx que não se leu: o servidor gravou.
      Object.assign(new Error("Unexpected end of JSON input"), { status: 200 }),
    ]) {
      const aprovar = chamada();
      await executar("1045", "aprovar", aprovar.fazer);
      await assentar(() => aprovar.ultima().rejeitar(falha));
      expect(acoes.estado("1045", "aprovar")).toBe("erro");
      await passar(CARREGANDO.erroVisivelMs);
      await executar("1045", "aprovar", aprovar.fazer);
      expect(aprovar.chaves[1], falha.message).toBe(aprovar.chaves[0]);
      await assentar(() => aprovar.ultima().resolver(undefined));
      await passar(CARREGANDO.sucessoVisivelMs);
    }
  });

  it("depois dos 70 s, a falha interna que chega não tira o 'Conferir'", async () => {
    const aprovar = chamada();
    await executar("1042", "aprovar", aprovar.fazer);
    await passar(CARREGANDO.desisteMs);
    await assentar(() => aprovar.ultima().rejeitar(Object.assign(new Error("Falha interna no servidor."), { status: 500, code: "internal" })));
    expect(acoes.estado("1042", "aprovar")).toBe("sem-resposta");
  });

  it("o sucesso de outra ação na linha encerra a chave guardada: a ação seguinte é nova, sem repetir um recibo velho", async () => {
    // Separar, sem conexão (o servidor pode ter gravado); Desfazer vale; Separar de novo é outra tentativa.
    const separar = chamada();
    const desfazer = chamada();
    await executar("1042", "separar", separar.fazer);
    await assentar(() => separar.ultima().rejeitar(new SemConexao()));
    await passar(CARREGANDO.erroVisivelMs);
    await executar("1042", "desfazer", desfazer.fazer);
    await assentar(() => desfazer.ultima().resolver(undefined));
    await passar(CARREGANDO.sucessoVisivelMs);
    await executar("1042", "separar", separar.fazer);
    expect(separar.chaves).toHaveLength(2);
    expect(separar.chaves[1]).not.toBe(separar.chaves[0]);
  });

  it("o sucesso numa linha não mexe na chave guardada de outra", async () => {
    const a1042 = chamada();
    const a1043 = chamada();
    await executar("1042", "aprovar", a1042.fazer);
    await assentar(() => a1042.ultima().rejeitar(new SemConexao()));
    await executar("1043", "aprovar", a1043.fazer);
    await assentar(() => a1043.ultima().resolver(undefined));
    await passar(CARREGANDO.erroVisivelMs);
    await executar("1042", "aprovar", a1042.fazer);
    expect(a1042.chaves[1]).toBe(a1042.chaves[0]);
  });

  it("a chave guardada é da linha e da ação: o Recusar da mesma linha leva a dele", async () => {
    const aprovar = chamada();
    const recusar = chamada();
    await executar("1042", "aprovar", aprovar.fazer);
    await assentar(() => aprovar.ultima().rejeitar(new SemConexao()));
    await executar("1042", "recusar", recusar.fazer);
    expect(recusar.chaves[0]).not.toBe(aprovar.chaves[0]);
  });
});

describe("aos 70 s, sem resposta: 'Conferir' relê e não reenvia", () => {
  it("fica em andamento até 70 s e então sem resposta, com a linha ainda ocupada", async () => {
    const aprovar = chamada();
    await executar("1042", "aprovar", aprovar.fazer);
    await passar(CARREGANDO.desisteMs - 1);
    expect(acoes.estado("1042", "aprovar")).toBe("andamento");
    await passar(1);
    expect(acoes.estado("1042", "aprovar")).toBe("sem-resposta");
    expect(acoes.ocupada("1042")).toBe(true);
    expect(acoes.desde("1042")).toBeNull();
    // O Recusar continua travado: não se sabe se o pedido foi aprovado.
    const recusar = chamada();
    await executar("1042", "recusar", recusar.fazer);
    expect(recusar.fazer).not.toHaveBeenCalled();
  });

  it("o deadline-exceeded antes dos 70 s também é sem resposta", async () => {
    const aprovar = chamada();
    await executar("1042", "aprovar", aprovar.fazer);
    await assentar(() => aprovar.ultima().rejeitar(Object.assign(new Error("deadline-exceeded"), { code: "functions/deadline-exceeded" })));
    expect(acoes.estado("1042", "aprovar")).toBe("sem-resposta");
  });

  it("se já valeu, segue o sucesso, sem chamar de novo", async () => {
    const aprovar = chamada();
    const conferir = vi.fn(async () => true);
    await executar("1042", "aprovar", aprovar.fazer, { conferir });
    await passar(CARREGANDO.desisteMs);
    expect(conferir).not.toHaveBeenCalled();
    await executar("1042", "aprovar", aprovar.fazer, { conferir });
    expect(conferir).toHaveBeenCalledTimes(1);
    expect(aprovar.fazer).toHaveBeenCalledTimes(1);
    expect(acoes.estado("1042", "aprovar")).toBe("sucesso");
    await passar(CARREGANDO.sucessoVisivelMs);
    expect(acoes.estado("1042", "aprovar")).toBe("repouso");
  });

  it("se não valeu, volta a Aprovar, e a nova tentativa leva a mesma chave", async () => {
    const aprovar = chamada();
    const conferir = vi.fn(async () => false);
    await executar("1042", "aprovar", aprovar.fazer, { conferir });
    await passar(CARREGANDO.desisteMs);
    await executar("1042", "aprovar", aprovar.fazer, { conferir });
    expect(aprovar.fazer).toHaveBeenCalledTimes(1);
    expect(acoes.estado("1042", "aprovar")).toBe("repouso");
    expect(acoes.ocupada("1042")).toBe(false);

    await executar("1042", "aprovar", aprovar.fazer, { conferir });
    expect(aprovar.fazer).toHaveBeenCalledTimes(2);
    expect(aprovar.chaves[1]).toBe(aprovar.chaves[0]);
    expect(acoes.estado("1042", "aprovar")).toBe("andamento");
  });

  it("enquanto confere, a linha está em andamento; a leitura que falha volta ao sem resposta", async () => {
    const aprovar = chamada();
    const leitura = adiada<boolean>();
    await executar("1042", "aprovar", aprovar.fazer, { conferir: () => leitura.promessa });
    await passar(CARREGANDO.desisteMs);
    await executar("1042", "aprovar", aprovar.fazer, { conferir: () => leitura.promessa });
    expect(acoes.estado("1042", "aprovar")).toBe("andamento");
    expect(acoes.desde("1042")).toBe(performance.now());
    await assentar(() => leitura.rejeitar(new SemConexao()));
    expect(acoes.estado("1042", "aprovar")).toBe("sem-resposta");
    expect(aprovar.fazer).toHaveBeenCalledTimes(1);
  });

  it("sem como conferir, 'Conferir' volta ao repouso e guarda a chave", async () => {
    const aprovar = chamada();
    await executar("1042", "aprovar", aprovar.fazer);
    await passar(CARREGANDO.desisteMs);
    await executar("1042", "aprovar", aprovar.fazer);
    expect(aprovar.fazer).toHaveBeenCalledTimes(1);
    expect(acoes.estado("1042", "aprovar")).toBe("repouso");
    await executar("1042", "aprovar", aprovar.fazer);
    expect(aprovar.chaves[1]).toBe(aprovar.chaves[0]);
  });

  it("a resposta que chega depois dos 70 s ainda vale: o sucesso entra; o prazo do SDK não muda nada", async () => {
    const aprovar = chamada();
    await executar("1042", "aprovar", aprovar.fazer);
    await passar(CARREGANDO.desisteMs);
    await assentar(() => aprovar.ultima().resolver(undefined));
    expect(acoes.estado("1042", "aprovar")).toBe("sucesso");

    const outra = chamada();
    await executar("1043", "aprovar", outra.fazer);
    await passar(CARREGANDO.desisteMs);
    await assentar(() => outra.ultima().rejeitar(Object.assign(new Error("deadline-exceeded"), { code: "deadline-exceeded", status: 504 })));
    expect(acoes.estado("1043", "aprovar")).toBe("sem-resposta");
  });
});

describe("desmontada", () => {
  it("não sobra relógio, e o que chega depois não mexe em nada", async () => {
    const aprovar = chamada();
    await executar("1042", "aprovar", aprovar.fazer);
    act(() => raiz!.unmount());
    raiz = null;
    expect(vi.getTimerCount()).toBe(0);
    const antes = desenhos;
    await assentar(() => aprovar.ultima().resolver(undefined));
    await passar(CARREGANDO.desisteMs);
    expect(vi.getTimerCount()).toBe(0);
    expect(desenhos).toBe(antes);
  });
});

describe("as regras puras", () => {
  it("o resultado entra no botão na hora antes de 300 ms; depois, só ao fim do mínimo de 500 ms", () => {
    expect(resultadoNaTelaEm(1_000, 1_100)).toBe(1_100);
    expect(resultadoNaTelaEm(1_000, 1_299)).toBe(1_299);
    expect(resultadoNaTelaEm(1_000, 1_300)).toBe(1_800);
    expect(resultadoNaTelaEm(1_000, 1_700)).toBe(1_800);
    expect(resultadoNaTelaEm(1_000, 4_000)).toBe(4_000);
  });

  it("o desfecho do erro: sem resposta, incerto (guarda a chave) ou recusado (chave nova)", () => {
    expect(desfechoDoErro(Object.assign(new Error("deadline-exceeded"), { code: "functions/deadline-exceeded" }))).toBe("sem-resposta");
    expect(desfechoDoErro(Object.assign(new Error("Tempo esgotado"), { code: "deadline-exceeded", status: 504 }))).toBe("sem-resposta");
    expect(desfechoDoErro(Object.assign(new Error("HTTP 504"), { status: 504, data: { code: "deadline-exceeded" } }))).toBe("sem-resposta");
    expect(desfechoDoErro(new SemConexao())).toBe("incerto");
    expect(desfechoDoErro(Object.assign(new Error("Sem conexão. Tente de novo quando o sinal voltar."), { status: 503, code: "sem_conexao" }))).toBe("incerto");
    // O servidor sem resposta com o aparelho conectado (parte 7a): continua incerto, e a repetição leva a mesma chave.
    expect(desfechoDoErro(new SemResposta())).toBe("incerto");
    expect(desfechoDoErro(Object.assign(new Error("Sem resposta do servidor."), { status: 503, data: { message: "Sem resposta do servidor.", code: "sem_resposta" } }))).toBe("incerto");
    expect(desfechoDoErro(new Error("Sem resposta do servidor."))).toBe("incerto");
    expect(desfechoDoErro(Object.assign(new Error("internal"), { code: "functions/internal" }))).toBe("incerto");
    expect(desfechoDoErro(Object.assign(new Error("indisponível"), { code: "functions/unavailable" }))).toBe("incerto");
    // O servidor disse que não, antes de gravar: a tentativa acabou.
    expect(desfechoDoErro(RECUSA_DO_SERVIDOR)).toBe("recusado");
    expect(desfechoDoErro(Object.assign(new Error("Já usada"), { code: "functions/already-exists" }))).toBe("recusado");
    expect(desfechoDoErro(Object.assign(new Error("A tela mudou"), { status: 409, code: "SEPARATION_VOLUMES_CHANGED" }))).toBe("recusado");
    expect(desfechoDoErro(Object.assign(new Error("HTTP 403"), { status: 403 }))).toBe("recusado");
    // O que não diz se gravou: o recibo só nasce no sucesso, e repetir com a mesma chave nunca duplica.
    expect(desfechoDoErro(Object.assign(new Error("INTERNAL"), { code: "functions/internal" }))).toBe("incerto");
    expect(desfechoDoErro(Object.assign(new Error("Falha interna no servidor."), { status: 500, code: "internal" }))).toBe("incerto");
    expect(desfechoDoErro(Object.assign(new Error("HTTP 502"), { status: 502 }))).toBe("incerto");
    expect(desfechoDoErro(Object.assign(new Error("Unexpected end of JSON input"), { status: 200 }))).toBe("incerto");
    expect(desfechoDoErro(Object.assign(new Error("cancelado"), { code: "functions/cancelled" }))).toBe("incerto");
    expect(desfechoDoErro(new TypeError("Failed to fetch"))).toBe("incerto");
    expect(desfechoDoErro(new Error("qualquer"))).toBe("incerto");
    expect(desfechoDoErro(undefined)).toBe("incerto");
  });
});

/*
 * As peças juntas, numa lista de teste (a tela de Pedidos entra na parte 6b):
 * o botão de cada linha lê o estado dela, o Recusar da linha ocupada fica
 * travado e a barra corre só na linha que aprova.
 */

const TEXTOS = ["Pedido 1042", "Pedido 1043", "Aprovar", "Aprovando…", "Aprovado", "Não aprovado", "Conferir", "Recusar", "Recusando…", "Recusado", "Não recusado"];

function Lista({ fazer }: { fazer: (chave: string) => Promise<unknown> }) {
  const linhas = useAcaoNaLinha<Pedido>();
  return (
    <ul>
      {(["1042", "1043"] as const).map((id) => {
        const aprovar = linhas.estado(id, "aprovar");
        const recusar = linhas.estado(id, "recusar");
        return (
          <li key={id} data-linha={id} className="relative">
            <span>{`Pedido ${id}`}</span>
            <BotaoDeAcao
              estado={recusar}
              variant="outline"
              rotulo="Recusar"
              andamento="Recusando…"
              sucesso="Recusado"
              erro="Não recusado"
              bloqueado={linhas.ocupada(id) && recusar === "repouso"}
              onClick={() => void linhas.executar(id, "recusar", fazer)}
            />
            <BotaoDeAcao
              estado={aprovar}
              rotulo="Aprovar"
              andamento="Aprovando…"
              sucesso="Aprovado"
              erro="Não aprovado"
              bloqueado={linhas.ocupada(id) && aprovar === "repouso"}
              onClick={() => void linhas.executar(id, "aprovar", fazer)}
            />
            <BarraDeEspera
              lugar="linha"
              ativa={aprovar === "andamento" || recusar === "andamento"}
              resultado={aprovar === "sucesso" || recusar === "sucesso" ? "ok" : aprovar === "erro" || recusar === "erro" ? "erro" : undefined}
            />
          </li>
        );
      })}
    </ul>
  );
}

function botaoDa(id: Pedido, rotulo: "Aprovar" | "Recusar"): HTMLButtonElement {
  const linha = container!.querySelector(`[data-linha="${id}"]`)!;
  const achado = Array.from(linha.querySelectorAll("button")).find((botao) => botao.querySelector(`[data-camada="repouso"]`)?.textContent === rotulo);
  if (!achado) throw new Error(`sem ${rotulo} na ${id}`);
  return achado;
}

describe("na lista, com o botão e a barra", () => {
  it("aprovar a 1042 deixa a 1043 livre, trava o Recusar da 1042 e põe a barra só nela", async () => {
    const fazer = chamada();
    act(() => raiz!.render(<Lista fazer={fazer.fazer} />));
    await act(async () => {
      botaoDa("1042", "Aprovar").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await passar(CARREGANDO.atrasoMs);
    const linha1042 = container!.querySelector('[data-linha="1042"]')!;
    const linha1043 = container!.querySelector('[data-linha="1043"]')!;
    expect(botaoDa("1042", "Aprovar").getAttribute("aria-busy")).toBe("true");
    expect(botaoDa("1042", "Recusar").getAttribute("aria-disabled")).toBe("true");
    expect(botaoDa("1042", "Recusar").hasAttribute("disabled")).toBe(false);
    expect(botaoDa("1043", "Aprovar").hasAttribute("aria-disabled")).toBe(false);
    expect(botaoDa("1043", "Recusar").hasAttribute("aria-disabled")).toBe(false);
    expect(linha1042.querySelector("[data-barra]")?.getAttribute("aria-hidden")).toBe("true");
    expect(linha1043.querySelector("[data-barra]")).toBeNull();
    // Nenhuma região viva na lista: quem fala é o Anunciador.
    expect(container!.querySelector("[aria-live]")).toBeNull();
    expect(textosForaDaLista(container!.innerHTML, TEXTOS)).toEqual([]);

    // A 1043 aprova ao mesmo tempo.
    await act(async () => {
      botaoDa("1043", "Aprovar").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(fazer.fazer).toHaveBeenCalledTimes(2);
    await passar(CARREGANDO.atrasoMs);
    expect(linha1043.querySelector("[data-barra]")?.getAttribute("data-estado")).toBe("andamento");
    expect(linha1042.querySelector("[data-barra]")?.getAttribute("data-estado")).toBe("andamento");

    // O axe usa o relógio de verdade.
    const html = container!.innerHTML;
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
