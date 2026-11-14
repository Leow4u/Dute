import { useCallback, useEffect, useRef, useState } from "react";
import { onSnapshot, type DocumentData, type DocumentReference, type Firestore, type Query } from "firebase/firestore";

import { firestore } from "../firebase";

/**
 * Coleção ao vivo nas telas do cadastro. As regras abrem a leitura a owner,
 * admin e interno; a escrita é só das callables.
 */

export type Leitura<T> = { itens: T[] | null; erro: boolean };

/**
 * A nova tentativa da leitura ao vivo (carregamento v2, parte 13g, a mesma do
 * portal na 13f): o `onSnapshot` que falha não volta sozinho, e a falha sem
 * "Tentar de novo" deixava a pessoa sem saída. `tentar` assina de novo;
 * enquanto a nova assinatura não responde, a falha fica (`erro`, com
 * `tentando`), para o aviso não sair com o foco nele nem a tela voltar a
 * "carregando" (como a `useLeituraComFalha`).
 */
export type NovaTentativa = { tentando: boolean; tentar: () => void };

/**
 * A nova tentativa de uma leitura ao vivo de verdade: a promessa de `tentar`
 * acaba quando a nova assinatura responde (o dado ou a falha), para quem diz
 * "Tentando de novo…" até lá (a `FalhaNaLeitura`; parte 13c).
 */
export type NovaTentativaAoVivo = { tentando: boolean; tentar: () => Promise<void> };

/** Sem nova tentativa (a tela montada sem a leitura de verdade, como nos testes da apresentação). */
export const SEM_NOVA_TENTATIVA: NovaTentativa = { tentando: false, tentar: () => undefined };

/**
 * As leituras ao vivo de cada chave na tela agora (a do Início, a do menu do
 * shell, a da Entrada): a nova tentativa que uma pede chega a todas as que
 * ainda não leram, e o contador do menu volta junto com o Início (a mesma
 * regra de contagem nas duas).
 */
const ouvintesDaChave = new Map<string, Set<() => void>>();

function ouvirNovaTentativa(chave: string, ouvinte: () => void): () => void {
  let ouvintes = ouvintesDaChave.get(chave);
  if (!ouvintes) ouvintesDaChave.set(chave, (ouvintes = new Set()));
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
    if (!ouvintes.size) ouvintesDaChave.delete(chave);
  };
}

function pedirNovaTentativa(chave: string) {
  for (const ouvinte of [...(ouvintesDaChave.get(chave) ?? [])]) ouvinte();
}

/**
 * A tentativa da chave: a assinatura muda a cada `tentar`, e a chave que
 * falhou por último fica na falha até a nova assinatura responder. A falha é
 * da chave em que aconteceu: com a chave nova (outro pedido aberto), a leitura
 * começa sem falha, na espera.
 *
 * Só a leitura sem resposta (a que falhou, ou a que ainda não chegou) assina
 * de novo: a já lida fica com o que leu, e a tela não volta a "carregando"
 * quando a nova tentativa é de outra leitura (a lateral do Início do
 * Financeiro, as faturas dos Relatórios). O pedido chega também às outras
 * leituras da mesma chave na tela que ainda não leram. A promessa de `tentar`
 * acaba quando a assinatura de agora responde (o dado ou a falha), na hora
 * para a já lida, ou quando a tela sai.
 */
export function useNovaTentativa(chave: string | null) {
  const [tentativa, setTentativa] = useState(0);
  const falhou = useRef<string | null>(null);
  // A resposta da assinatura de agora, como a tela a viu no último render: sem resposta (falhou ou não chegou)
  // pede nova assinatura; respondeu (o dado ou a falha) solta quem esperava a nova tentativa.
  const semResposta = useRef(true);
  const respondeu = useRef(false);
  const esperando = useRef<Array<() => void>>([]);
  useEffect(() => {
    if (chave === null) return undefined;
    return ouvirNovaTentativa(chave, () => {
      if (semResposta.current) setTentativa((atual) => atual + 1);
    });
  }, [chave]);
  const tentar = useCallback(
    () =>
      new Promise<void>((pronto) => {
        // A já lida não assina de novo: a promessa acaba na hora.
        if (chave === null || !semResposta.current) {
          pronto();
          return;
        }
        esperando.current.push(pronto);
        pedirNovaTentativa(chave);
      }),
    [chave],
  );
  useEffect(() => {
    if (respondeu.current && esperando.current.length) for (const pronto of esperando.current.splice(0)) pronto();
  });
  useEffect(
    () => () => {
      for (const pronto of esperando.current.splice(0)) pronto();
    },
    [],
  );
  return {
    assinatura: chave === null ? null : `${chave}#${tentativa}`,
    /** A resposta da assinatura de agora: devolve se a nova tentativa ainda espera. */
    tentando: (erro: boolean, respondeuAgora: boolean) => {
      respondeu.current = erro || respondeuAgora;
      if (erro) falhou.current = chave;
      else if (respondeuAgora) falhou.current = null;
      semResposta.current = erro || !respondeuAgora;
      return chave !== null && tentativa > 0 && falhou.current === chave && !erro && !respondeuAgora;
    },
    tentar,
  };
}

export function useLeitura<T>(
  chave: string | null,
  consulta: (db: Firestore) => Query<DocumentData>,
  mapear: (id: string, data: DocumentData) => T | null,
): Leitura<T> & NovaTentativaAoVivo {
  const nova = useNovaTentativa(chave);
  const { assinatura } = nova;
  const [estado, setEstado] = useState<Leitura<T> & { chave: string | null }>({ chave: null, itens: null, erro: false });
  useEffect(() => {
    if (!assinatura) return undefined;
    if (!firestore) {
      setEstado({ chave: assinatura, itens: null, erro: true });
      return undefined;
    }
    return onSnapshot(
      consulta(firestore),
      (snapshot) =>
        setEstado({
          chave: assinatura,
          itens: snapshot.docs.map((row) => mapear(row.id, row.data())).filter((item): item is T => item !== null),
          erro: false,
        }),
      () => setEstado({ chave: assinatura, itens: null, erro: true }),
    );
    // A consulta e o mapeamento dependem só da chave (e da tentativa).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);
  const leitura = estado.chave === assinatura ? estado : { itens: null, erro: false };
  const tentando = nova.tentando(leitura.erro, leitura.itens !== null);
  return { itens: leitura.itens, erro: leitura.erro || tentando, tentando, tentar: nova.tentar };
}

/** Um documento ao vivo: undefined enquanto carrega, null quando não existe (ou o mapeamento recusa). */
export type LeituraDeDocumento<T> = { item: T | null | undefined; erro: boolean };

export function useDocumento<T>(
  chave: string | null,
  referencia: (db: Firestore) => DocumentReference<DocumentData>,
  mapear: (id: string, data: DocumentData) => T | null,
): LeituraDeDocumento<T> & NovaTentativaAoVivo {
  const nova = useNovaTentativa(chave);
  const { assinatura } = nova;
  const [estado, setEstado] = useState<LeituraDeDocumento<T> & { chave: string | null }>({ chave: null, item: undefined, erro: false });
  useEffect(() => {
    if (!assinatura) return undefined;
    if (!firestore) {
      setEstado({ chave: assinatura, item: undefined, erro: true });
      return undefined;
    }
    return onSnapshot(
      referencia(firestore),
      (snapshot) => setEstado({ chave: assinatura, item: snapshot.exists() ? mapear(snapshot.id, snapshot.data()) : null, erro: false }),
      () => setEstado({ chave: assinatura, item: undefined, erro: true }),
    );
    // A referência e o mapeamento dependem só da chave (e da tentativa).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);
  const leitura = estado.chave === assinatura ? estado : { item: undefined, erro: false };
  const tentando = nova.tentando(leitura.erro, leitura.item !== undefined);
  return { item: leitura.item, erro: leitura.erro || tentando, tentando, tentar: nova.tentar };
}

/** Uma leitura ao vivo de qualquer forma (a coleção, o documento): o que a nova tentativa de várias precisa. */
type LeituraQueTenta = { erro: boolean; tentando?: boolean; tentar?: () => void } & (
  | { itens: readonly unknown[] | null }
  | { item: unknown }
  | { dados: unknown }
);

/** A leitura ainda sem resposta: falhou, ou não chegou. */
function semResposta(leitura: LeituraQueTenta): boolean {
  if (leitura.erro) return true;
  if ("itens" in leitura) return leitura.itens === null;
  if ("item" in leitura) return leitura.item === undefined;
  return leitura.dados === undefined;
}

/**
 * A nova tentativa da tela que junta várias leituras ao vivo (parte 13g): o
 * toque em "Tentar de novo" assina de novo só as que falharam ou ainda não
 * responderam (as lidas ficam na tela), e `tentando` vale enquanto alguma
 * delas ainda espera a resposta pedida.
 */
export function novaTentativaDe(leituras: ReadonlyArray<LeituraQueTenta>): NovaTentativa {
  return {
    tentando: leituras.some((leitura) => Boolean(leitura.tentando)),
    tentar: () => {
      for (const leitura of leituras) if (semResposta(leitura)) leitura.tentar?.();
    },
  };
}

/**
 * Várias novas tentativas como uma (a tela que junta leituras de origens
 * diferentes, como o Financeiro). Cada `tentar` relê só o que não respondeu:
 * a leitura ao vivo já lida não assina de novo, e a consulta lida não relê.
 */
export function juntarTentativas(...tentativas: ReadonlyArray<NovaTentativa>): NovaTentativa {
  return {
    tentando: tentativas.some((tentativa) => tentativa.tentando),
    tentar: () => {
      for (const tentativa of tentativas) tentativa.tentar();
    },
  };
}
