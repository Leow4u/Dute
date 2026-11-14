import { useLayoutEffect, useState, useSyncExternalStore } from "react";

import { aberturaNaTela } from "../abertura";

/**
 * A espera da rota (a `CarregandoTela`: o arquivo da tela que chega, o perfil,
 * o cliente) e a da lista que a continua são uma espera só (carregamento v2,
 * seção 3). Quando o arquivo da tela chega e a lista ainda lê, a linha de
 * estado e as linhas-fantasma seguem o relógio de quando a rota começou a
 * esperar: o indicador não some entre uma e outra, a demora vem aos 10 s do
 * toque, e a entrada já anunciada ("Abrindo Pedidos") não é anunciada de novo
 * como "Carregando pedidos".
 *
 * O anúncio da rota que ainda espera a vez no `Anunciador` passa à lista
 * (`herdada`): ela o retira quando a espera dela acaba. Sem lista que continue,
 * a `CarregandoTela` o retira quando sai.
 */
export interface EsperaDaRota {
  /** Quando a espera começou (`performance.now()`). */
  readonly inicio: number;
  /** A entrada ("Abrindo Pedidos") já foi pedida ao Anunciador. */
  entrada: boolean;
  /** A demora ("Demorando mais que o normal") já foi pedida. */
  demora: boolean;
  /** Retira o último anúncio da rota, se ele ainda espera a vez. */
  retirar: (() => void) | null;
  /** Uma lista continuou esta espera: o anúncio que ainda espera a vez é dela. */
  herdada: boolean;
  /**
   * A espera é de uma região da tela que já chegou (a leitura do portal), e
   * não do arquivo de uma tela: a região seguinte a continua, mas o item do
   * menu não mostra a caixa por ela (`useRotaEsperando`).
   */
  daRegiao?: boolean;
}

/** As esperas de rota na tela agora; a última é a que a tela que chega continua. */
const naTela: EsperaDaRota[] = [];

/** Quem quer saber quando uma espera de rota entra ou sai da tela (o item do menu, `useRotaEsperando`). */
const ouvintes = new Set<() => void>();

function avisarOsOuvintes() {
  for (const ouvinte of ouvintes) ouvinte();
}

function ouvirAsEsperas(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/**
 * Alguma tela ainda abre (a `CarregandoTela` está na tela): o item do menu
 * tocado mostra a caixa de 16 px no lugar do contador enquanto a tela baixa
 * (carregamento v2, momento 1; o relógio dos 300 ms é de quem mostra).
 */
export function useRotaEsperando(): boolean {
  return useSyncExternalStore(ouvirAsEsperas, () => naTela.some((espera) => !espera.daRegiao), () => false);
}

/** A espera de rota que começa agora, ou que continua a que começou em `desde`. */
export function novaEsperaDaRota(desde?: number): EsperaDaRota {
  const agora = performance.now();
  const inicio = desde !== undefined && Number.isFinite(desde) && desde <= agora ? desde : agora;
  return { inicio, entrada: false, demora: false, retirar: null, herdada: false };
}

/**
 * A `CarregandoTela` (ou a região que passa a espera adiante) está na tela com
 * esta espera, desde o commit em que entrou até o em que sai. Sem espera, nada.
 */
export function useEsperaDaRotaNaTela(espera: EsperaDaRota | null): void {
  useLayoutEffect(() => {
    if (!espera) return undefined;
    naTela.push(espera);
    avisarOsOuvintes();
    return () => {
      const posicao = naTela.indexOf(espera);
      if (posicao >= 0) naTela.splice(posicao, 1);
      avisarOsOuvintes();
    };
  }, [espera]);
}

/**
 * A espera de rota que a lista que começa a ler agora continua: a que está na
 * tela, no desenho em que a tela chega no lugar dela. Com a abertura ainda na
 * tela, nenhuma: quem esperava era a abertura, e a lista conta do zero.
 */
function esperaDaRotaQueAcaba(): EsperaDaRota | null {
  if (aberturaNaTela()) return null;
  return naTela[naTela.length - 1] ?? null;
}

/**
 * A espera da rota que esta lista continua, lida uma vez, quando ela entra na
 * tela já lendo (`lendo`); nula quando a lista entra com o dado, ou sem rota
 * esperando. Com `herdar`, o anúncio da rota que ainda espera a vez passa a
 * esta lista: quem fala é a linha de estado; as linhas-fantasma só seguem o
 * relógio.
 */
export function useEsperaDaRota(lendo: boolean, herdar = false): EsperaDaRota | null {
  const [continua] = useState(() => (lendo ? esperaDaRotaQueAcaba() : null));
  // No layout, antes de a `CarregandoTela` que sai retirar o anúncio dela (o efeito dela roda depois).
  useLayoutEffect(() => {
    if (continua && herdar) continua.herdada = true;
  }, [continua, herdar]);
  return continua;
}
