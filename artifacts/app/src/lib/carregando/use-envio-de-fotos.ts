import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EnvioCancelado, FOTO_PARADA } from "@/lib/envio-de-fotos";

import { useAnuncio } from "./anunciador";
import { CARREGANDO } from "./tempo";

/** Onde cada foto está: esperando a vez, subindo, enviada ou não enviada. */
export type EstadoDaFoto = "fila" | "andamento" | "feito" | "erro";

export interface FotoNoEnvio<T> {
  chave: string;
  arquivo: File;
  /** A miniatura local (object URL), enquanto a foto está no envio. */
  miniatura: string | null;
  estado: EstadoDaFoto;
  /** A fração dos bytes enviados da foto que sobe; só cresce. */
  fracao: number;
  /** A vez em que entrou na fila (a escolha, ou o "Tentar de novo"): a estimativa conta só a vez atual. */
  vez: number;
  /** Quando começou a subir e quando chegou o último byte novo (`performance.now()`): a estimativa sai com a foto parada. */
  comecouEm: number | null;
  byteEm: number | null;
  resultado?: T;
  erro?: unknown;
}

export interface OpcoesDoEnvio<T> {
  /**
   * Compacta e sobe uma foto: chama `aoProgredir` a cada evento de bytes e
   * para quando o `sinal` cancela. O que ela devolve chega em `aoConcluir`.
   */
  enviarUma: (arquivo: File, aoProgredir: (fracao: number) => void, sinal: AbortSignal) => Promise<T>;
  /** Quando a fila esvazia: as fotos enviadas desde a última entrega, na ordem da escolha. */
  aoConcluir?: (resultados: T[]) => void;
  /** A foto que não foi enviada, com o motivo (o toast); a parada vem como `EnvioCancelado`. */
  aoFalhar?: (erro: unknown) => void;
  /** Sem nenhum byte novo por esse tempo, a foto é cancelada e fica "não enviada" (70 s, a desistência). */
  paradaMs?: number;
}

export interface EnvioDeFotos<T> {
  itens: readonly FotoNoEnvio<T>[];
  /** Alguma foto ainda espera ou sobe: o diálogo não fecha, e a escolha nova espera. */
  enviando: boolean;
  /** Põe as fotos na fila. As enviadas da vez anterior saem da lista; as não enviadas ficam, com o "Tentar de novo". */
  enviar: (arquivos: readonly File[]) => void;
  /** Põe a foto não enviada de volta na fila. */
  tentarDeNovo: (chave: string) => void;
  /** Esvazia a lista (a tela trocou de produto ou de rascunho); a que sobe é cancelada e não é entregue. */
  limpar: () => void;
}

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

/** "Enviando 4 fotos": o começo, pelo Anunciador. */
export function anuncioDoComeco(total: number): string {
  return `Enviando ${plural(total, "foto", "fotos")}`;
}

/** "4 fotos enviadas", ou quantas não foram: o fim, pelo Anunciador. */
export function anuncioDoFim(feitas: number, falhas: number): string {
  return falhas > 0 ? plural(falhas, "foto não enviada", "fotos não enviadas") : plural(feitas, "foto enviada", "fotos enviadas");
}

type ItemDaEstimativa = Pick<FotoNoEnvio<unknown>, "estado" | "fracao"> & Partial<Pick<FotoNoEnvio<unknown>, "vez" | "comecouEm" | "byteEm">>;

/**
 * Quanto falta, pelo que já subiu: o tempo decorrido dividido pela parte
 * feita da vez atual (as enviadas nela mais a fração da que sobe); as
 * enviadas numa vez anterior não contam, porque o decorrido é desta vez.
 * Sem nada enviado ainda, não há estimativa; com `agoraMs`, também não há
 * quando a foto que sobe está há 10 s sem um byte novo (parada, ou sem rede).
 */
export function restanteDoEnvio(itens: readonly ItemDaEstimativa[], decorridoMs: number, agoraMs?: number): number | undefined {
  const ativos = itens.filter((item) => item.estado === "fila" || item.estado === "andamento");
  if (ativos.length === 0 || !(decorridoMs > 0)) return undefined;
  const vez = Math.max(...ativos.map((item) => item.vez ?? 0));
  const davez = itens.filter((item) => (item.vez ?? 0) === vez && item.estado !== "erro");
  const subindo = itens.find((item) => item.estado === "andamento");
  const ultimoByte = subindo ? (subindo.byteEm ?? subindo.comecouEm ?? null) : null;
  if (agoraMs !== undefined && ultimoByte !== null && agoraMs - ultimoByte >= CARREGANDO.estimativaSemByteMs) return undefined;
  const feito = davez.reduce((soma, item) => soma + (item.estado === "feito" ? 1 : item.estado === "andamento" ? item.fracao : 0), 0);
  if (!(feito > 0) || feito >= davez.length) return undefined;
  return (decorridoMs * (davez.length - feito)) / feito;
}

/** A estimativa na tela: o valor e quando ele entrou (no relógio da espera). */
export interface EstimativaNaTela {
  ms: number;
  em: number;
}

/** O que a estimativa na tela diz agora: ela conta para baixo desde que entrou. */
export function restanteExibido(estimativa: EstimativaNaTela | null, agoraMs: number): number | undefined {
  return estimativa ? Math.max(0, estimativa.ms - (agoraMs - estimativa.em)) : undefined;
}

/**
 * A estimativa que não pisca. Entre dois eventos de bytes, o decorrido anda
 * e a fração não, e a conta sobe; no evento, ela cai: "55 s", "50 s", "55 s"
 * em décimos de segundo. A da tela conta para baixo, e a conta nova só entra
 * quando é menor que ela, quando sobe de verdade (mais de um quarto e 5 s) ou
 * quando a da tela já chegou a zero.
 */
export function estimativaEstavel(anterior: EstimativaNaTela | null, restanteMs: number | undefined, agoraMs: number): EstimativaNaTela | null {
  if (restanteMs === undefined || !Number.isFinite(restanteMs)) return null;
  const contando = restanteExibido(anterior, agoraMs);
  if (contando === undefined || contando <= 0 || restanteMs <= contando || restanteMs > contando * 1.25 + 5_000) {
    return { ms: restanteMs, em: agoraMs };
  }
  return anterior;
}

function miniaturaDe(arquivo: File): string | null {
  try {
    return typeof URL.createObjectURL === "function" ? URL.createObjectURL(arquivo) : null;
  } catch {
    return null;
  }
}

function soltar(miniatura: string | null) {
  if (miniatura && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(miniatura);
}

/**
 * O envio das fotos do celular (carregamento v2, parte 11 e momento 6): uma
 * foto por vez, na ordem da escolha, cada uma com a fração dos bytes. A que
 * falha fica "não enviada", com o próprio "Tentar de novo", e não derruba as
 * outras (o `Promise.all` de antes perdia as que já tinham subido). A que
 * fica 70 s sem um byte novo é cancelada e também fica "não enviada". O
 * Anunciador fala o começo ("Enviando 4 fotos") e o fim ("4 fotos
 * enviadas").
 */
export function useEnvioDeFotos<T>(opcoes: OpcoesDoEnvio<T>): EnvioDeFotos<T> {
  const [itens, setItens] = useState<FotoNoEnvio<T>[]>([]);
  const atuais = useRef(itens);
  atuais.current = itens;
  const ultimas = useRef(opcoes);
  ultimas.current = opcoes;
  const anunciar = useAnuncio();
  const subindo = useRef<{ chave: string; parar: AbortController } | null>(null);
  const entregues = useRef(new Set<string>());
  const vezes = useRef(0);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      subindo.current?.parar.abort();
      for (const item of atuais.current) soltar(item.miniatura);
    };
  }, []);

  const mudar = useCallback((chave: string, mudanca: (item: FotoNoEnvio<T>) => FotoNoEnvio<T>) => {
    setItens((lista) => lista.map((item) => (item.chave === chave ? mudanca(item) : item)));
  }, []);

  // A próxima da fila sobe quando nenhuma está subindo.
  const proxima = itens.find((item) => item.estado === "fila")?.chave ?? null;
  const algumaSobe = itens.some((item) => item.estado === "andamento");
  useEffect(() => {
    if (proxima === null || algumaSobe || subindo.current) return;
    const item = atuais.current.find((candidato) => candidato.chave === proxima);
    if (!item) return;
    const parar = new AbortController();
    subindo.current = { chave: item.chave, parar };
    mudar(item.chave, (atual) => ({ ...atual, estado: "andamento", fracao: 0, comecouEm: performance.now(), byteEm: null, erro: undefined }));
    const paradaMs = ultimas.current.paradaMs ?? CARREGANDO.desisteMs;
    let prazo: ReturnType<typeof setTimeout> | undefined = setTimeout(() => parar.abort(), paradaMs);
    const aoProgredir = (fracao: number) => {
      if (parar.signal.aborted || !Number.isFinite(fracao)) return;
      const limitada = Math.min(1, Math.max(0, fracao));
      clearTimeout(prazo);
      // O último byte subiu: o que vem depois (o endereço da foto, a callable da OS) tem o próprio prazo.
      prazo = limitada >= 1 ? undefined : setTimeout(() => parar.abort(), paradaMs);
      const instante = performance.now();
      mudar(item.chave, (atual) => (atual.estado === "andamento" && limitada > atual.fracao ? { ...atual, fracao: limitada, byteEm: instante } : atual));
    };
    let resultado: Promise<T>;
    try {
      resultado = Promise.resolve(ultimas.current.enviarUma(item.arquivo, aoProgredir, parar.signal));
    } catch (erro) {
      resultado = Promise.reject(erro);
    }
    resultado
      .then(
        (valor) => {
          if (!vivo.current || subindo.current?.parar !== parar) return;
          mudar(item.chave, (atual) => ({ ...atual, estado: "feito", fracao: 1, resultado: valor }));
        },
        (erro: unknown) => {
          if (!vivo.current || subindo.current?.parar !== parar) return;
          const motivo = parar.signal.aborted ? new EnvioCancelado(FOTO_PARADA) : erro;
          mudar(item.chave, (atual) => ({ ...atual, estado: "erro", erro: motivo }));
          ultimas.current.aoFalhar?.(motivo);
        },
      )
      .finally(() => {
        clearTimeout(prazo);
        if (subindo.current?.parar === parar) subindo.current = null;
      });
  }, [proxima, algumaSobe, mudar]);

  // A fila esvaziou: entrega as enviadas que ainda não foram entregues e anuncia o fim.
  const enviando = itens.some((item) => item.estado === "fila" || item.estado === "andamento");
  useEffect(() => {
    if (enviando) return;
    const novas = itens.filter((item) => item.estado === "feito" && !entregues.current.has(item.chave));
    const falhas = itens.filter((item) => item.estado === "erro").length;
    if (novas.length === 0 && falhas === 0) return;
    if (novas.length > 0) {
      for (const item of novas) entregues.current.add(item.chave);
      ultimas.current.aoConcluir?.(novas.map((item) => item.resultado as T));
    }
    anunciar(anuncioDoFim(itens.filter((item) => item.estado === "feito").length, falhas));
  }, [enviando, itens, anunciar]);

  const enviar = useCallback(
    (arquivos: readonly File[]) => {
      if (arquivos.length === 0) return;
      vezes.current += 1;
      const vez = vezes.current;
      const novos = arquivos.map<FotoNoEnvio<T>>((arquivo) => ({
        chave: crypto.randomUUID(),
        arquivo,
        miniatura: miniaturaDe(arquivo),
        estado: "fila",
        fracao: 0,
        vez,
        comecouEm: null,
        byteEm: null,
      }));
      setItens((lista) => {
        // As enviadas da vez anterior já estão na tela; as não enviadas continuam com o "Tentar de novo".
        const ficam = lista.filter((item) => item.estado !== "feito");
        for (const item of lista) if (item.estado === "feito") soltar(item.miniatura);
        return [...ficam, ...novos];
      });
      anunciar(anuncioDoComeco(novos.length));
    },
    [anunciar],
  );

  const tentarDeNovo = useCallback(
    (chave: string) => {
      // Com outras na fila, a foto entra na vez delas; sem nenhuma, começa uma vez nova.
      const ativas = atuais.current.filter((item) => item.estado === "fila" || item.estado === "andamento");
      if (ativas.length === 0) vezes.current += 1;
      const vez = ativas.length ? Math.max(...ativas.map((item) => item.vez)) : vezes.current;
      mudar(chave, (item) => (item.estado === "erro" ? { ...item, estado: "fila", fracao: 0, vez, comecouEm: null, byteEm: null, erro: undefined } : item));
      anunciar(anuncioDoComeco(1));
    },
    [mudar, anunciar],
  );

  const limpar = useCallback(() => {
    subindo.current?.parar.abort();
    subindo.current = null;
    setItens((lista) => {
      for (const item of lista) soltar(item.miniatura);
      return [];
    });
  }, []);

  return useMemo(() => ({ itens, enviando, enviar, tentarDeNovo, limpar }), [itens, enviando, enviar, tentarDeNovo, limpar]);
}
