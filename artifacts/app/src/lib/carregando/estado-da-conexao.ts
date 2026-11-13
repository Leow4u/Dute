import { createContext, useContext, useSyncExternalStore } from "react";
import type { Query, QueryClient } from "@tanstack/react-query";

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
 * é falta de rede. Só sai do aviso depois de uma leitura que deu certo, e cada
 * aviso fica pelo menos 2 s antes de dar lugar a outro.
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
   * Quem relê o que a falta deixou sem ler: na releitura sozinha (`sondar`:
   * sem nada com a falta, relê o resto para saber se o servidor voltou), na
   * volta da rede e na do servidor.
   */
  aoReler(reler: ((sondar: boolean) => void) | null): void;
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
  let reler: ((sondar: boolean) => void) | null = null;

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

  /** A releitura sozinha, enquanto reconecta. Sem rede, espera a rede voltar. */
  const armarReleitura = () => {
    parar(relogioDaReleitura);
    relogioDaReleitura = setTimeout(() => {
      relogioDaReleitura = null;
      if (alvo === "conectado" || !temRede()) return;
      vezDaReleitura += 1;
      reler?.(true);
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
    if (exibido === "conectado" && antes !== "conectado") reler?.(false);
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
          reler?.(false);
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
 * Relê o que a falta de conexão deixou sem ler: as leituras ativas com a
 * falta. Sem nenhuma e com `sondar`, relê as ativas, para saber se o servidor
 * voltou. A que já está lendo não recomeça.
 */
export function relerFaltas(queryClient: QueryClient, sondar = false): void {
  const cache = queryClient.getQueryCache();
  const comFalta = new Set<Query>(
    cache.findAll({ type: "active", predicate: (leitura) => leitura.state.status === "error" && ehFaltaDeConexao(leitura.state.error) }),
  );
  if (!comFalta.size && !sondar) return;
  void queryClient
    .refetchQueries(
      comFalta.size ? { type: "active", predicate: (leitura) => comFalta.has(leitura) } : { type: "active" },
      { cancelRefetch: false },
    )
    .catch(() => undefined);
}

type Janela = Pick<Window, "addEventListener" | "removeEventListener">;

/**
 * Liga a conexão ao app: cada leitura do react-query diz se chegou do
 * servidor ou ficou sem resposta (com a hora em que começou, para contar só
 * as seguidas), os eventos `online` e `offline` dizem a rede do aparelho, e a
 * releitura relê as leituras com a falta. Devolve quem desliga.
 */
export function ligarConexaoDoApp(
  queryClient: QueryClient,
  conexao: Conexao = conexaoDoApp,
  janela: Janela | undefined = typeof window === "undefined" ? undefined : window,
  agora: () => number = () => performance.now(),
): () => void {
  const inicios = new WeakMap<Query, number>();
  conexao.aoReler((sondar) => relerFaltas(queryClient, sondar));
  const deixar = queryClient.getQueryCache().subscribe((evento) => {
    if (evento.type !== "updated") return;
    const acao = evento.action;
    if (acao.type === "fetch") inicios.set(evento.query, agora());
    // O `manual` é o setQueryData, que não leu nada.
    else if (acao.type === "success" && !acao.manual) conexao.leuDoServidor();
    else if (acao.type === "error" && ehFaltaDeConexao(acao.error)) conexao.ficouSemResposta(inicios.get(evento.query));
  });
  const mudou = () => conexao.redeMudou();
  janela?.addEventListener("online", mudou);
  janela?.addEventListener("offline", mudou);
  return () => {
    deixar();
    janela?.removeEventListener("online", mudou);
    janela?.removeEventListener("offline", mudou);
    conexao.aoReler(null);
  };
}
