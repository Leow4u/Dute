import { useEffect, useMemo, useState } from "react";

import { CARREGANDO, faseDaEspera, podeEsconder, type FaseDaEspera } from "./tempo";

export interface OpcoesDaEspera {
  /**
   * Segura o indicador que apareceu pelo mínimo de 500 ms: o indicador
   * sozinho e o "em andamento" da ação. A lista com esqueleto não segura, porque
   * o dado não espera.
   */
  segurarMinimo?: boolean;
  /** A desistência: 70 s por padrão; 180 s no chat do Agent Dute e na foto por IA. */
  desisteMs?: number;
  /**
   * Quando a espera começou (`performance.now()`), se ela continua uma que já
   * estava na tela: o relógio não volta ao zero, e o que já tinha aparecido
   * aparece na hora. Lido só quando a espera começa.
   */
  desde?: number;
}

export interface Espera {
  /** O indicador está na tela: depois de 300 ms e, com o mínimo, até completar 500 ms. */
  visivel: boolean;
  /** `oculta` exatamente quando não está visível. */
  fase: FaseDaEspera;
  /** Desde quando a espera começou. Anda nos marcos e, depois de 10 s, a cada segundo (o "0:12"). */
  decorridoMs: number;
  /** Depois de 10 s, a volta passa a durar 2 s. */
  calmo: boolean;
  /** O movimento decorativo (brilho, barras, trilha do agente) ainda anda: até 5 s. */
  movimento: boolean;
}

type Relogio =
  | { modo: "parado" }
  | { modo: "correndo"; inicio: number; agora: number; apareceuEm: number | null }
  | { modo: "segurando"; inicio: number; fim: number; apareceuEm: number };

const PARADO: Relogio = { modo: "parado" };
const OCULTA: Espera = { visivel: false, fase: "oculta", decorridoMs: 0, calmo: false, movimento: false };

const agora = () => performance.now();

/** A espera que começa agora, ou que continua a que começou em `desde`. */
function comecar(desde: number | undefined): Relogio {
  const instante = agora();
  const inicio = desde !== undefined && Number.isFinite(desde) && desde <= instante ? desde : instante;
  return { modo: "correndo", inicio, agora: instante, apareceuEm: instante - inicio >= CARREGANDO.atrasoMs ? instante : null };
}

function ligar(relogio: Relogio, instante: number): Relogio {
  if (relogio.modo === "correndo") return relogio;
  // Voltar a esperar durante o mínimo não pisca: o indicador continua na tela.
  const apareceuEm = relogio.modo === "segurando" ? relogio.apareceuEm : null;
  return { modo: "correndo", inicio: instante, agora: instante, apareceuEm };
}

function desligar(relogio: Relogio, instante: number, segurarMinimo: boolean): Relogio {
  if (relogio.modo !== "correndo") return relogio;
  // O que nunca apareceu sai sem piscar; o que apareceu, com o mínimo pedido, fica até completar 500 ms.
  if (relogio.apareceuEm !== null && segurarMinimo && !podeEsconder(relogio.apareceuEm, instante)) {
    return { modo: "segurando", inicio: relogio.inicio, fim: instante, apareceuEm: relogio.apareceuEm };
  }
  return PARADO;
}

/** O tique da espera que começou em `inicio`; o de uma espera que já acabou não muda nada. */
function avancar(relogio: Relogio, inicio: number, instante: number): Relogio {
  if (relogio.modo !== "correndo" || relogio.inicio !== inicio) return relogio;
  const apareceuEm = relogio.apareceuEm ?? (instante - relogio.inicio >= CARREGANDO.atrasoMs ? instante : null);
  return { ...relogio, agora: instante, apareceuEm };
}

/** O próximo instante (desde o início) em que algo muda; nulo quando nada mais muda. */
function proximoMarco(decorridoMs: number, desisteMs: number): number | null {
  let proximo = Number.POSITIVE_INFINITY;
  for (const marco of [CARREGANDO.atrasoMs, CARREGANDO.objetoNaLinhaMs, CARREGANDO.movimentoMaxMs, CARREGANDO.demoraMs, desisteMs]) {
    if (marco > decorridoMs && marco < proximo) proximo = marco;
  }
  // Depois de 10 s o "0:12" conta os segundos, até a desistência.
  if (decorridoMs >= CARREGANDO.demoraMs && decorridoMs < desisteMs) {
    proximo = Math.min(proximo, (Math.floor(decorridoMs / 1_000) + 1) * 1_000);
  }
  return Number.isFinite(proximo) ? proximo : null;
}

function esperaDoRelogio(relogio: Relogio, desisteMs: number): Espera {
  if (relogio.modo === "parado") return OCULTA;
  const decorridoMs = (relogio.modo === "correndo" ? relogio.agora : relogio.fim) - relogio.inicio;
  if (relogio.apareceuEm === null) return { ...OCULTA, decorridoMs };
  const fase = faseDaEspera(decorridoMs, desisteMs);
  return {
    visivel: true,
    fase: fase === "oculta" ? "andamento" : fase,
    decorridoMs,
    calmo: decorridoMs >= CARREGANDO.demoraMs,
    movimento: decorridoMs < CARREGANDO.movimentoMaxMs,
  };
}

/**
 * A espera no relógio (carregamento v2, seção 3), no lugar do `isPending`
 * lido direto, que pisca ou não aparece. Nada aparece antes de 300 ms; o
 * indicador que apareceu fica pelo menos 500 ms, quando pedido; aos 3 s o
 * objeto entra na linha; aos 5 s o movimento decorativo para; aos 10 s vêm a
 * demora e a volta calma; aos 70 s, a desistência. Cada espera conta do zero,
 * menos a que continua outra (`desde`).
 */
export function useEspera(ativa: boolean, opcoes: OpcoesDaEspera = {}): Espera {
  const segurarMinimo = opcoes.segurarMinimo ?? false;
  const desisteMs = opcoes.desisteMs ?? CARREGANDO.desisteMs;
  const [relogio, setRelogio] = useState<Relogio>(() => (ativa ? comecar(opcoes.desde) : PARADO));

  useEffect(() => {
    const instante = agora();
    setRelogio((atual) => (ativa ? ligar(atual, instante) : desligar(atual, instante, segurarMinimo)));
  }, [ativa, segurarMinimo]);

  // Os tiques da espera que corre, nos marcos e, depois de 10 s, a cada segundo.
  // Cada tique arma o seguinte pelo relógio, sem esperar a tela renderizar.
  const corrida = relogio.modo === "correndo" ? relogio.inicio : null;
  useEffect(() => {
    if (corrida === null) return undefined;
    // O relógio alcança o agora ao armar: o marco que passou enquanto a tela
    // não rodava (a thread ocupada por mais de 300 ms, a foto sendo
    // compactada) entra na hora, e não só no marco seguinte (aos 3 s).
    setRelogio((atual) => {
      if (atual.modo !== "correndo" || atual.inicio !== corrida) return atual;
      const instante = agora();
      const marco = proximoMarco(atual.agora - corrida, desisteMs);
      return marco !== null && instante - corrida >= marco ? avancar(atual, corrida, instante) : atual;
    });
    let tique: ReturnType<typeof setTimeout> | undefined;
    // O tique foi armado para o marco: quando ele dispara, o marco chegou,
    // mesmo que o relógio leia um décimo de milissegundo antes (o atraso
    // fracionário do setTimeout é truncado). Sem isso, o tique lia 299,9 ms,
    // não marcava, e quem armava o seguinte já lia 300 e pulava para os 3 s.
    const armar = (alcancado: number) => {
      const instante = agora();
      const marco = proximoMarco(Math.max(instante - corrida, alcancado), desisteMs);
      if (marco === null) return;
      tique = setTimeout(() => {
        const disparo = Math.max(agora(), corrida + marco);
        setRelogio((atual) => avancar(atual, corrida, disparo));
        armar(marco);
      }, Math.max(0, corrida + marco - instante));
    };
    armar(0);
    return () => clearTimeout(tique);
  }, [corrida, desisteMs]);

  // O mínimo na tela: o indicador que ficou segurando sai quando completa 500 ms.
  const seguraAte = relogio.modo === "segurando" ? relogio.apareceuEm + CARREGANDO.minimoMs : null;
  useEffect(() => {
    if (seguraAte === null) return undefined;
    const fim = setTimeout(
      () => setRelogio((atual) => (atual.modo === "segurando" ? PARADO : atual)),
      Math.max(0, seguraAte - agora()),
    );
    return () => clearTimeout(fim);
  }, [seguraAte]);

  return useMemo(() => esperaDoRelogio(relogio, desisteMs), [relogio, desisteMs]);
}
