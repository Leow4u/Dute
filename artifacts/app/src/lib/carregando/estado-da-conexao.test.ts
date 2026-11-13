import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { criarConexao, esperaDaReleitura, type Conexao, type EstadoDaConexao } from "./estado-da-conexao";
import { CARREGANDO } from "./tempo";

/**
 * O estado único da conexão (carregamento v2, momento 8; parte 7a), no
 * relógio falso. O aparelho conectado com o servidor sem resposta é
 * "Reconectando", nunca "Sem conexão"; só o aparelho sem rede há 3 s (ou com
 * duas leituras seguidas sem resposta) é "Sem conexão". Só sai do aviso
 * depois de uma leitura que deu certo, e cada aviso fica pelo menos 2 s.
 * Enquanto reconecta, o app relê sozinho em 2, 4, 8, 16 e 30 s.
 */

let rede = true;
let conexao: Conexao;
let reler: ReturnType<typeof vi.fn<(sondar: boolean) => void>>;
/** Cada mudança do estado, com o instante. */
let historico: Array<{ t: number; estado: EstadoDaConexao }>;
let zero = 0;

const agora = () => performance.now() - zero;

function passar(ms: number) {
  vi.advanceTimersByTime(ms);
}

/** A rede do aparelho muda, com o evento. */
function aparelho(temRede: boolean) {
  rede = temRede;
  conexao.redeMudou();
}

/** O `sondar` de cada releitura. */
const releituras = () => reler.mock.calls.map(([sondar]) => sondar);

beforeEach(() => {
  vi.useFakeTimers();
  zero = performance.now();
  rede = true;
  reler = vi.fn<(sondar: boolean) => void>();
  conexao = criarConexao({ temRede: () => rede });
  conexao.aoReler(reler);
  historico = [];
  conexao.assinar(() => historico.push({ t: agora(), estado: conexao.estado() }));
});

afterEach(() => {
  conexao.fechar();
  vi.useRealTimers();
});

describe("a espera entre as releituras sozinhas", () => {
  it("é 2, 4, 8, 16 e 30 s, e 30 s daí em diante", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(esperaDaReleitura)).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    expect(CARREGANDO.releituraMs).toBe(2_000);
    expect(CARREGANDO.releituraMaxMs).toBe(30_000);
  });
});

describe("com o aparelho conectado e o servidor sem resposta", () => {
  it("a leitura do cache dá Reconectando, nunca Sem conexão, por mais que falhe", () => {
    conexao.ficouSemResposta(agora());
    expect(conexao.estado()).toBe("reconectando");
    // Cada releitura sozinha falha de novo, por dois minutos.
    reler.mockImplementation(() => conexao.ficouSemResposta(agora()));
    for (let s = 0; s < 120; s += 1) {
      passar(1_000);
      expect(conexao.estado()).toBe("reconectando");
    }
    expect(historico.map((mudanca) => mudanca.estado)).toEqual(["reconectando"]);
  });

  it("relê sozinho em 2, 4, 8, 16 e 30 s, e 30 s daí em diante", () => {
    const instantes: number[] = [];
    reler.mockImplementation(() => {
      instantes.push(agora());
      conexao.ficouSemResposta(agora());
    });
    conexao.ficouSemResposta(agora());
    passar(120_000);
    expect(instantes).toEqual([2_000, 6_000, 14_000, 30_000, 60_000, 90_000, 120_000]);
    // A releitura sozinha sonda: sem nada com a falta, relê o resto para saber se o servidor voltou.
    expect(releituras().every((sondar) => sondar === true)).toBe(true);
  });

  it("a volta limpa o aviso: a leitura que deu certo leva ao conectado e relê o que ficou sem ler", () => {
    conexao.ficouSemResposta(agora());
    passar(2_000);
    expect(reler).toHaveBeenCalledTimes(1);
    conexao.leuDoServidor();
    expect(conexao.estado()).toBe("conectado");
    expect(historico).toEqual([
      { t: 0, estado: "reconectando" },
      { t: 2_000, estado: "conectado" },
    ]);
    // O servidor voltou: relê o que ainda está com a falta, sem sondar o resto.
    expect(reler).toHaveBeenLastCalledWith(false);
    // E não relê mais sozinho.
    reler.mockClear();
    passar(120_000);
    expect(reler).not.toHaveBeenCalled();
  });

  it("um evento online sem nada faltando não muda nada nem relê", () => {
    aparelho(true);
    passar(10_000);
    expect(conexao.estado()).toBe("conectado");
    expect(reler).not.toHaveBeenCalled();
  });
});

describe("a histerese", () => {
  it("o aparelho sem rede há 3 s dá Sem conexão, mesmo sem leitura nenhuma", () => {
    aparelho(false);
    passar(2_999);
    expect(conexao.estado()).toBe("conectado");
    passar(1);
    expect(conexao.estado()).toBe("sem-conexao");
  });

  it("a piscada de menos de 3 s sem leitura não avisa nada", () => {
    aparelho(false);
    passar(1_500);
    aparelho(true);
    passar(10_000);
    expect(historico).toEqual([]);
  });

  it("sem rede, a primeira leitura sem resposta é Reconectando; aos 3 s, Sem conexão", () => {
    aparelho(false);
    passar(200);
    conexao.ficouSemResposta(agora());
    expect(conexao.estado()).toBe("reconectando");
    passar(2_799);
    expect(conexao.estado()).toBe("reconectando");
    passar(1);
    expect(historico).toEqual([
      { t: 200, estado: "reconectando" },
      { t: 3_000, estado: "sem-conexao" },
    ]);
  });

  it("sem rede, duas leituras seguidas sem resposta dão Sem conexão antes dos 3 s, depois dos 2 s do aviso", () => {
    aparelho(false);
    conexao.ficouSemResposta(agora());
    passar(500);
    // A segunda começou depois de a primeira falhar.
    conexao.ficouSemResposta(agora());
    expect(conexao.estado()).toBe("reconectando");
    passar(1_499);
    expect(conexao.estado()).toBe("reconectando");
    passar(1);
    expect(historico).toEqual([
      { t: 0, estado: "reconectando" },
      { t: 2_000, estado: "sem-conexao" },
    ]);
  });

  it("as leituras que saíram juntas contam como uma", () => {
    aparelho(false);
    passar(100);
    const juntas = agora();
    passar(50);
    conexao.ficouSemResposta(juntas);
    conexao.ficouSemResposta(juntas);
    passar(2_000);
    expect(conexao.estado()).toBe("reconectando");
    passar(850);
    expect(conexao.estado()).toBe("sem-conexao");
  });

  it("com o aparelho conectado, as falhas seguidas nunca são Sem conexão", () => {
    for (let vez = 0; vez < 10; vez += 1) {
      conexao.ficouSemResposta(agora());
      passar(300);
    }
    passar(10_000);
    expect(conexao.estado()).toBe("reconectando");
  });

  it("só sai depois de uma leitura que deu certo: a rede que volta é Reconectando, e a leitura dá o conectado", () => {
    aparelho(false);
    passar(5_000);
    expect(conexao.estado()).toBe("sem-conexao");
    aparelho(true);
    expect(conexao.estado()).toBe("reconectando");
    // A volta da rede relê na hora o que ficou sem ler.
    expect(reler).toHaveBeenCalledWith(false);
    passar(30_000);
    expect(conexao.estado()).toBe("reconectando");
    conexao.leuDoServidor();
    passar(0);
    expect(conexao.estado()).toBe("conectado");
  });

  it("cada aviso fica pelo menos 2 s: a leitura que dá certo logo depois espera o aviso completar", () => {
    conexao.ficouSemResposta(agora());
    passar(300);
    conexao.leuDoServidor();
    expect(conexao.estado()).toBe("reconectando");
    passar(1_699);
    expect(conexao.estado()).toBe("reconectando");
    passar(1);
    expect(historico).toEqual([
      { t: 0, estado: "reconectando" },
      { t: 2_000, estado: "conectado" },
    ]);
  });

  it("a falha que chega dentro dos 2 s cancela a saída", () => {
    conexao.ficouSemResposta(agora());
    passar(300);
    conexao.leuDoServidor();
    passar(500);
    conexao.ficouSemResposta(agora());
    passar(10_000);
    expect(historico.map((mudanca) => mudanca.estado)).toEqual(["reconectando"]);
  });

  it("sem rede, nada vem do servidor: a leitura que deu certo não tira o Sem conexão", () => {
    aparelho(false);
    passar(3_000);
    conexao.leuDoServidor();
    passar(5_000);
    expect(conexao.estado()).toBe("sem-conexao");
  });

  it("sem rede, não relê sozinho: espera a rede voltar, e aí relê na hora e recomeça dos 2 s", () => {
    conexao.ficouSemResposta(agora());
    aparelho(false);
    passar(60_000);
    expect(reler).not.toHaveBeenCalled();
    aparelho(true);
    expect(reler).toHaveBeenCalledTimes(1);
    const desde = agora();
    const instantes: number[] = [];
    reler.mockImplementation(() => {
      instantes.push(agora() - desde);
      conexao.ficouSemResposta(agora());
    });
    passar(14_000);
    expect(instantes).toEqual([2_000, 6_000, 14_000]);
  });

  it("o app que abre sem rede conta os 3 s desde já", () => {
    conexao.fechar();
    rede = false;
    const outra = criarConexao({ temRede: () => rede });
    passar(2_999);
    expect(outra.estado()).toBe("conectado");
    passar(1);
    expect(outra.estado()).toBe("sem-conexao");
    outra.fechar();
  });
});
