import { useEffect, useRef } from "react";

import { useAnuncio } from "@/lib/carregando/anunciador";

/**
 * A leitura de apoio que não chegou, nas telas do pedido (a bancada de
 * Separar, o pedido separado, a lista de separação; carregamento v2, parte
 * 13m e a revisão dela): a frase diz o que falta, numa frase só, na voz do
 * romaneio ("Não foi possível carregar as caixas e o prazo do pedido.").
 */

const LISTA = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });

/** "Não foi possível carregar as caixas e o prazo do pedido."; sem nada, null. */
export function fraseDoQueNaoChegou(oQue: readonly string[]): string | null {
  return oQue.length ? `Não foi possível carregar ${LISTA.format(oQue)}.` : null;
}

/** Uma leitura ao vivo de apoio: a falta dela e a nova assinatura. */
export type LeituraDeApoio = {
  erro: boolean;
  falta?: "conexao" | "servidor" | null;
  tentando: boolean;
  tentar: () => Promise<unknown> | unknown;
};

/** O que a tela lê de apoio: o nome na frase ("as caixas") e as leituras de que ele depende. */
export type ApoioDaTela = { oQue: string; leituras: readonly LeituraDeApoio[] };

/** A frase, a nova tentativa do que não chegou e as recusas do servidor; sem falta, `frase` é null. */
export type OQueNaoChegou = {
  frase: string | null;
  /** O que não chegou pela recusa do servidor (as outras faltas são de conexão). */
  recusados: string[];
  tentando: boolean;
  /** Assina de novo só as leituras que falharam; a promessa acaba quando todas respondem. */
  tentar: () => Promise<unknown>;
};

export function oQueNaoChegou(apoio: readonly ApoioDaTela[]): OQueNaoChegou {
  const faltam = apoio.filter((item) => item.leituras.some((leitura) => leitura.erro));
  const falharam = faltam.flatMap((item) => item.leituras.filter((leitura) => leitura.erro));
  return {
    frase: fraseDoQueNaoChegou(faltam.map((item) => item.oQue)),
    recusados: faltam.filter((item) => item.leituras.some((leitura) => leitura.erro && leitura.falta === "servidor")).map((item) => item.oQue),
    tentando: falharam.some((leitura) => leitura.tentando),
    tentar: () => Promise.all(falharam.map((leitura) => leitura.tentar())),
  };
}

/**
 * A frase não é região viva (uma por tela, o Anunciador): ela muda quando uma
 * leitura volta ou cai sozinha, e a releitura automática não fala. Quem fala é
 * o Anunciador, uma vez, quando entra uma recusa do servidor que a tela ainda
 * não tinha dito. A falta de conexão o Anunciador já diz ("Sem conexão"); a
 * frase que encolhe ou sai, na volta, não fala. A nova tentativa pedida que
 * falha de novo, a `FalhaNaSecao` diz.
 */
export function useAnunciarARecusa({ frase, recusados }: Pick<OQueNaoChegou, "frase" | "recusados">): void {
  const anunciar = useAnuncio();
  const ditos = useRef<ReadonlySet<string>>(new Set());
  const texto = useRef(frase);
  texto.current = frase;
  const chave = recusados.join("|");
  useEffect(() => {
    const agora = chave ? chave.split("|") : [];
    const novo = agora.some((oQue) => !ditos.current.has(oQue));
    ditos.current = new Set(agora);
    if (novo && texto.current) anunciar(texto.current);
  }, [chave, anunciar]);
}
