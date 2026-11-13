import { createContext, useContext, useSyncExternalStore } from "react";
import type { Query, QueryClient, QueryFunctionContext } from "@tanstack/react-query";

import { aparelhoSemRede, ehFaltaDeConexao } from "@/lib/conexao";

import { CARREGANDO } from "./tempo";

/**
 * O estado único da conexão do app (carregamento v2, momento 8; parte 7a).
 *
 * - `conectado`: a última leitura chegou do servidor.
 * - `reconectando`: o aparelho está conectado e o servidor demora ou falha
 *   (a leitura que só achou o cache, o `unavailable`, a callable sem
 *   resposta). O app relê sozinho em 2, 4, 8, 16 e 30 s.
 * - `sem-conexao`: o aparelho está sem rede há 3 s, ou duas leituras
 *   seguidas ficaram sem resposta com ele sem rede.
 *
 * Com o aparelho conectado nunca é "Sem conexão": o SDK do Firestore se dá
 * por offline depois de 10 s sem o servidor e responde do cache, e aquilo não
 * é falta de rede. Só sai do aviso depois de uma leitura que deu certo (a de
 * uma leitura que tinha ficado sem resposta), e cada aviso fica pelo menos 2 s
 * antes de dar lugar a outro.
 */
export type EstadoDaConexao = "conectado" | "reconectando" | "sem-conexao";

/** Com o aparelho sem rede, tantas leituras seguidas sem resposta já são "Sem conexão", antes dos 3 s. */
export const LEITURAS_ATE_SEM_CONEXAO = 2;

/** A espera antes da releitura sozinha de número `vez` (de 0): 2, 4, 8, 16 e 30 s, e 30 s daí em diante. */
export function esperaDaReleitura(vez: number): number {
  return Math.min(CARREGANDO.releituraMs * 2 ** Math.max(0, vez), CARREGANDO.releituraMaxMs);
}

export interface OpcoesDaConexao {
  /** O aparelho tem rede: `navigator.onLine`, que só erra para o lado de conectado. */
  temRede?: () => boolean;
  /** O relógio (o `performance.now()`, o mesmo do useEspera). */
  agora?: () => number;
}

export interface Conexao {
  /** O estado que a tela mostra, já com a histerese. */
  estado(): EstadoDaConexao;
  assinar(ouvinte: () => void): () => void;
  /** Uma leitura chegou do servidor. */
  leuDoServidor(): void;
  /** Uma leitura não alcançou o servidor; `inicio` é quando ela começou, no mesmo relógio. */
  ficouSemResposta(inicio?: number): void;
  /** O aparelho ganhou ou perdeu a rede (os eventos `online` e `offline`). */
  redeMudou(): void;
  /**
   * Quem relê o que a falta deixou sem ler: na releitura sozinha, na volta da
   * rede e na do servidor. Devolve se havia o que reler; sem nada, a releitura
   * sozinha para, e a próxima falta recomeça dos 2 s.
   */
  aoReler(reler: (() => boolean) | null): void;
  /**
   * Quem acorda a conexão de quem lê antes de reler: o SDK do Firestore que
   * se deu por offline só tentaria o servidor de novo no relógio dele (até
   * 60 s), e a releitura e o "Tentar de novo" leriam só o cache.
   */
  aoAcordar(acordar: (() => Promise<void> | null) | null): void;
  /** Acorda a conexão de quem lê; devolve a espera, ou nulo quando não há o que acordar. */
  acordar(): Promise<void> | null;
  /** Para os relógios. */
  fechar(): void;
}

type Relogio = ReturnType<typeof setTimeout> | null;

function parar(relogio: Relogio) {
  if (relogio !== null) clearTimeout(relogio);
}

export function criarConexao(opcoes: OpcoesDaConexao = {}): Conexao {
  const temRede = opcoes.temRede ?? (() => !aparelhoSemRede());
  const agora = opcoes.agora ?? (() => performance.now());
  const ouvintes = new Set<() => void>();
  let reler: (() => boolean) | null = null;
  let acordar: (() => Promise<void> | null) | null = null;

  /** O que a tela mostra, e desde quando. */
  let exibido: EstadoDaConexao = "conectado";
  let exibidoDesde = agora();
  /** O que as regras pedem; vira o exibido quando o aviso de agora completa os 2 s. */
  let alvo: EstadoDaConexao = "conectado";
  let semRedeDesde: number | null = temRede() ? null : agora();
  /** As leituras seguidas sem resposta: a que começou antes da última contada saiu junto com ela e não conta. */
  let falhas = 0;
  let ultimaFalhaEm = Number.NEGATIVE_INFINITY;
  let vezDaReleitura = 0;
  let troca: Relogio = null;
  let relogioSemRede: Relogio = null;
  let relogioDaReleitura: Relogio = null;

  const publicar = () => {
    for (const ouvinte of ouvintes) ouvinte();
  };

  const esquecerFalhas = () => {
    falhas = 0;
    ultimaFalhaEm = Number.NEGATIVE_INFINITY;
  };

  const pararReleitura = () => {
    parar(relogioDaReleitura);
    relogioDaReleitura = null;
    vezDaReleitura = 0;
  };

  /**
   * A releitura sozinha, enquanto reconecta. Sem rede, espera a rede voltar;
   * sem nada com a falta para reler, para até a próxima falta.
   */
  const armarReleitura = () => {
    parar(relogioDaReleitura);
    relogioDaReleitura = setTimeout(() => {
      relogioDaReleitura = null;
      if (alvo === "conectado" || !temRede()) return;
      if (!reler?.()) {
        vezDaReleitura = 0;
        return;
      }
      vezDaReleitura += 1;
      armarReleitura();
    }, esperaDaReleitura(vezDaReleitura));
  };

  /** O alvo vira o exibido: na hora, saindo do "conectado"; senão, quando o aviso de agora completa os 2 s. */
  const aplicar = () => {
    parar(troca);
    troca = null;
    if (alvo === exibido) return;
    const instante = agora();
    const livreEm = exibido === "conectado" ? instante : exibidoDesde + CARREGANDO.avisoMinimoMs;
    if (livreEm > instante) {
      troca = setTimeout(aplicar, livreEm - instante);
      return;
    }
    const antes = exibido;
    exibido = alvo;
    exibidoDesde = instante;
    publicar();
    // O servidor voltou: relê o que ainda está sem ler.
    if (exibido === "conectado" && antes !== "conectado") reler?.();
  };

  /** Sem rede há 3 s, ou com as leituras seguidas sem resposta, é "Sem conexão". */
  const conferirSemRede = () => {
    parar(relogioSemRede);
    relogioSemRede = null;
    if (temRede()) {
      semRedeDesde = null;
      return;
    }
    if (semRedeDesde === null) semRedeDesde = agora();
    const falta = semRedeDesde + CARREGANDO.semRedeMs - agora();
    if (falta <= 0 || falhas >= LEITURAS_ATE_SEM_CONEXAO) {
      alvo = "sem-conexao";
      pararReleitura();
      return;
    }
    relogioSemRede = setTimeout(() => {
      relogioSemRede = null;
      conferirSemRede();
      aplicar();
    }, falta);
  };

  const conexao: Conexao = {
    estado: () => exibido,
    assinar: (ouvinte) => {
      ouvintes.add(ouvinte);
      return () => {
        ouvintes.delete(ouvinte);
      };
    },
    leuDoServidor: () => {
      // Sem rede, nada vem do servidor: o que deu certo foi outra coisa.
      if (!temRede()) return;
      esquecerFalhas();
      alvo = "conectado";
      pararReleitura();
      aplicar();
    },
    ficouSemResposta: (inicio = agora()) => {
      if (inicio >= ultimaFalhaEm) {
        falhas += 1;
        ultimaFalhaEm = agora();
      }
      if (alvo === "conectado") {
        alvo = "reconectando";
        vezDaReleitura = 0;
        if (temRede()) armarReleitura();
      } else if (alvo === "reconectando" && relogioDaReleitura === null && temRede()) {
        armarReleitura();
      }
      conferirSemRede();
      aplicar();
    },
    redeMudou: () => {
      esquecerFalhas();
      if (temRede()) {
        semRedeDesde = null;
        parar(relogioSemRede);
        relogioSemRede = null;
        // Com rede, o que era "Sem conexão" é o servidor que ainda não respondeu.
        if (alvo === "sem-conexao") alvo = "reconectando";
        if (alvo !== "conectado" || exibido !== "conectado") {
          vezDaReleitura = 0;
          armarReleitura();
          reler?.();
        }
      } else {
        semRedeDesde = agora();
        pararReleitura();
        conferirSemRede();
      }
      aplicar();
    },
    aoReler: (funcao) => {
      reler = funcao;
    },
    aoAcordar: (funcao) => {
      acordar = funcao;
    },
    acordar: () => (temRede() ? (acordar?.() ?? null) : null),
    fechar: () => {
      parar(troca);
      parar(relogioSemRede);
      parar(relogioDaReleitura);
      troca = relogioSemRede = relogioDaReleitura = null;
    },
  };
  // O app que abre sem rede: os 3 s contam desde já.
  if (semRedeDesde !== null) conferirSemRede();
  return conexao;
}

/** A conexão do app inteiro: uma só, para todas as telas. */
export const conexaoDoApp: Conexao = criarConexao();

const ContextoDaConexao = createContext<Conexao>(conexaoDoApp);

/** Troca a conexão que as telas de dentro leem (o teste que mostra a tela num estado). */
export const ProvedorDaConexao = ContextoDaConexao.Provider;

/** O estado da conexão do app, com a histerese, para a tela. */
export function useConexao(): EstadoDaConexao {
  const conexao = useContext(ContextoDaConexao);
  return useSyncExternalStore(conexao.assinar, conexao.estado, conexao.estado);
}

/**
 * O "Tentar de novo" de quem mostra a falta: acorda a conexão de quem lê (o
 * SDK do Firestore que se deu por offline) e só então relê, para o toque
 * alcançar o servidor, e não só o cache.
 */
export function useTentarDeNovo(): (reler: () => void) => void {
  const conexao = useContext(ContextoDaConexao);
  return (fazer) => {
    const acordando = conexao.acordar();
    if (acordando) void acordando.then(fazer, fazer);
    else fazer();
  };
}

/** As leituras com a falta que estão sendo relidas em silêncio agora. */
const relendoEmSilencio = new WeakSet<Query>();

/** A leitura que está com a falta de conexão. */
function temAFalta(leitura: Query): boolean {
  return leitura.state.status === "error" && ehFaltaDeConexao(leitura.state.error);
}

/** A leitura que ninguém está lendo agora: nem a de verdade, nem a releitura em silêncio. */
function livre(leitura: Query): boolean {
  return leitura.state.fetchStatus === "idle" && !relendoEmSilencio.has(leitura);
}

export interface OpcoesDaReleitura {
  /** A conexão que fica sabendo da falha da releitura (o sucesso ela sabe pela leitura). */
  conexao: Conexao;
  /** O relógio da conexão. */
  agora?: () => number;
  /** Quando foi o último toque na tela, no mesmo relógio (a regra do dedo). */
  ultimoToque?: () => number;
}

/**
 * Espera o dedo: nada sai nem entra na tela se houve toque nos últimos 700
 * ms, e a espera nunca passa de 3 s (a regra do dedo, momento 4).
 */
function esperarODedo(ultimoToque: () => number, agora: () => number): Promise<void> {
  const limite = agora() + CARREGANDO.dedoMaxMs;
  return new Promise((resolver) => {
    const conferir = () => {
      const falta = Math.min(ultimoToque() + CARREGANDO.dedoMs, limite) - agora();
      if (falta <= 0) resolver();
      else setTimeout(conferir, falta);
    };
    conferir();
  });
}

/**
 * A releitura sozinha de uma leitura com a falta, em silêncio: chama a
 * leitura sem passar pelo estado do react-query, que poria a leitura sem
 * dado de volta em "carregando" (o bloco "Reconectando…" sairia da tela, e o
 * foco com ele) e a com dado em `isFetching` (o Atualizar giraria e se
 * desabilitaria). A tela não muda enquanto lê (momento 7). Se o servidor
 * respondeu, o dado entra como o de uma leitura de verdade, esperando o dedo;
 * se não, a conexão fica sabendo e a tela fica como estava; se o servidor
 * respondeu com outro erro, a leitura de verdade mostra qual.
 */
function relerEmSilencio(queryClient: QueryClient, leitura: Query, opcoes: Required<OpcoesDaReleitura>): void {
  const lerDeVerdade = () =>
    void queryClient.refetchQueries({ predicate: (outra) => outra === leitura }, { cancelRefetch: false }).catch(() => undefined);
  const funcao = leitura.options.queryFn ?? leitura.observers.find((observador) => observador.options.queryFn)?.options.queryFn;
  // A paginada (useInfiniteQuery) junta as páginas no react-query: relê de verdade.
  if (typeof funcao !== "function" || leitura.queryType === "infinite") {
    lerDeVerdade();
    return;
  }
  relendoEmSilencio.add(leitura);
  const inicio = opcoes.agora();
  const desde = Date.now();
  const contexto = { client: queryClient, queryKey: leitura.queryKey, meta: leitura.meta, signal: new AbortController().signal };
  void Promise.resolve()
    .then(() => funcao(contexto as QueryFunctionContext))
    .then(
      async (dados) => {
        await esperarODedo(opcoes.ultimoToque, opcoes.agora);
        // A leitura de verdade que começou depois grava o que ela leu.
        if (dados !== undefined && leitura.state.fetchStatus === "idle" && leitura.state.dataUpdatedAt <= desde) leitura.setData(dados);
      },
      (erro: unknown) => {
        if (ehFaltaDeConexao(erro)) opcoes.conexao.ficouSemResposta(inicio);
        else lerDeVerdade();
      },
    )
    .finally(() => relendoEmSilencio.delete(leitura));
}

/**
 * Relê, em silêncio, o que a falta de conexão deixou sem ler: as leituras
 * ativas com a falta. Antes, acorda a conexão de quem lê. A que já está
 * lendo não recomeça. Devolve se havia leitura com a falta.
 */
export function relerFaltas(queryClient: QueryClient, opcoes: OpcoesDaReleitura): boolean {
  const comFalta = queryClient.getQueryCache().findAll({ type: "active", predicate: temAFalta });
  if (!comFalta.length) return false;
  const completas: Required<OpcoesDaReleitura> = {
    agora: () => performance.now(),
    ultimoToque: () => Number.NEGATIVE_INFINITY,
    ...opcoes,
  };
  const ler = () => {
    for (const leitura of comFalta) if (livre(leitura) && temAFalta(leitura)) relerEmSilencio(queryClient, leitura, completas);
  };
  const acordando = comFalta.some(livre) ? opcoes.conexao.acordar() : null;
  if (acordando) void acordando.then(ler, ler);
  else ler();
  return true;
}

type Janela = Pick<Window, "addEventListener" | "removeEventListener">;

export interface OpcoesDaLigacao {
  /** Acorda a conexão de quem lê antes de reler (no app, o SDK do Firestore: `acordarFirestore`). */
  acordar?: () => Promise<void> | null;
  /**
   * Avisa quando quem lê voltou a ouvir o servidor (no app, `aoVoltarOFirestore`):
   * o app relê na hora, sem esperar a próxima releitura sozinha. Devolve quem desliga.
   */
  aoVoltar?: (ouvinte: () => void) => () => void;
}

/**
 * Liga a conexão ao app: cada leitura do react-query diz se ficou sem
 * resposta (com a hora em que começou, para contar só as seguidas) e, quando
 * uma que tinha ficado volta a dar certo, que o servidor respondeu; os
 * eventos `online` e `offline` dizem a rede do aparelho, e a releitura relê
 * em silêncio as leituras com a falta (também na hora em que quem lê volta a
 * ouvir o servidor). Só a volta de uma leitura que tinha ficado sem resposta
 * conta: a que leu do cache do Firestore sem passar pelo `lib/cloud-api.ts`
 * dá certo sem o servidor. O toque na tela vale para a regra do dedo.
 * Devolve quem desliga.
 */
export function ligarConexaoDoApp(
  queryClient: QueryClient,
  conexao: Conexao = conexaoDoApp,
  janela: Janela | undefined = typeof window === "undefined" ? undefined : window,
  agora: () => number = () => performance.now(),
  opcoes: OpcoesDaLigacao = {},
): () => void {
  const inicios = new WeakMap<Query, number>();
  /** As leituras cuja última ida ficou sem resposta. */
  const semResposta = new WeakSet<Query>();
  let ultimoToque = Number.NEGATIVE_INFINITY;
  const reler = () => relerFaltas(queryClient, { conexao, agora, ultimoToque: () => ultimoToque });
  conexao.aoAcordar(opcoes.acordar ?? null);
  conexao.aoReler(reler);
  const deixarAVolta = opcoes.aoVoltar?.(() => void reler());
  const deixar = queryClient.getQueryCache().subscribe((evento) => {
    if (evento.type !== "updated") return;
    const acao = evento.action;
    if (acao.type === "fetch") inicios.set(evento.query, agora());
    // O `manual` é o setQueryData, que não leu nada.
    else if (acao.type === "success" && !acao.manual) {
      if (semResposta.delete(evento.query)) conexao.leuDoServidor();
    } else if (acao.type === "error") {
      if (ehFaltaDeConexao(acao.error)) {
        semResposta.add(evento.query);
        conexao.ficouSemResposta(inicios.get(evento.query));
      } else semResposta.delete(evento.query);
    }
  });
  const mudou = () => conexao.redeMudou();
  const tocou = () => {
    ultimoToque = agora();
  };
  janela?.addEventListener("online", mudou);
  janela?.addEventListener("offline", mudou);
  janela?.addEventListener("pointerdown", tocou, true);
  return () => {
    deixar();
    janela?.removeEventListener("online", mudou);
    janela?.removeEventListener("offline", mudou);
    janela?.removeEventListener("pointerdown", tocou, true);
    deixarAVolta?.();
    conexao.aoReler(null);
    conexao.aoAcordar(null);
  };
}
