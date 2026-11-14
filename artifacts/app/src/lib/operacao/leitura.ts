import { useCallback, useEffect, useRef, useState } from "react";
import {
  onSnapshot,
  queryEqual,
  refEqual,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type FirestoreError,
  type Query,
  type QuerySnapshot,
} from "firebase/firestore";

import { leituraDeFora, useConexaoDaTela } from "../carregando/estado-da-conexao";
import {
  firestoreRespondeu,
  firestoreSoNoCache,
  firestoreSoNoCacheDesde,
  ouvirRespostasDoFirestore,
} from "../carregando/respostas-do-firestore";
import { aparelhoSemRede, firestoreSemConexao } from "../conexao";
import { firestore } from "../firebase";

/**
 * Coleção ao vivo nas telas do cadastro. As regras abrem a leitura a owner,
 * admin e interno; a escrita é só das callables.
 */

export type Leitura<T> = { itens: T[] | null; erro: boolean };

/**
 * O que falta à leitura ao vivo (carregamento v2, parte 13j): a conexão (o
 * aparelho sem rede, ou o SDK do Firestore que se deu por offline e responde
 * só do cache) ou o servidor (a escuta recusada: a permissão, outro erro).
 * Nulo quando nada falta.
 */
export type FaltaDaLeitura = "conexao" | "servidor" | null;

/** A falta da leitura ao vivo e a hora do que ficou na tela. */
export type FaltaAoVivo = {
  falta: FaltaDaLeitura;
  /**
   * Com a falta de conexão e o que já estava lido na tela: até quando ele
   * estava em dia com o servidor, para "Sem conexão · lista de 10:42". Nulo
   * sem nada lido, ou sem a falta.
   */
  lidaEm: number | null;
};

/**
 * A escuta ao vivo pede as mudanças de metadados: sem elas, o servidor que
 * responde o mesmo que o cache já tinha (a lista vazia, o documento que não
 * existe) não chega à tela, que ficaria na falta de conexão, e a vista que
 * perde o servidor (o SDK que se dá por offline) não avisa a escuta.
 */
export const ESCUTA_COM_METADADOS = { includeMetadataChanges: true } as const;

/** O que a escuta ouve: a consulta (a coleção) ou o documento. */
export type AlvoDaEscuta = Query<DocumentData> | DocumentReference<DocumentData>;

/**
 * Uma escuta ao vivo aberta agora, e se ela já tem o que mostrar: a resposta
 * do servidor, ou a vista que outra escuta da mesma consulta leu dele.
 */
export type EscutaAoVivo = {
  alvo: AlvoDaEscuta;
  lida: boolean;
  /** Está sem o servidor: só o cache, sem nada lido, ou a vista que deixou de estar em dia. */
  falta: boolean;
  /** Com a falta e o que já foi lido: até quando ela estava em dia com o servidor (`Date.now()`). */
  lidaEm: number | null;
  /** Desde quando ela espera o servidor, no relógio da conexão (`performance.now()`): a abertura ou a última resposta dele. */
  desde: number;
};

/** As escutas abertas agora (o shell, a página, a ficha): o SDK guarda uma vista por consulta, a mesma para todas. */
const escutasAbertas = new Set<EscutaAoVivo>();

/** Abre o registro da escuta; `fecharEscuta` o tira quando ela para. */
export function abrirEscuta(alvo: AlvoDaEscuta): EscutaAoVivo {
  const escuta: EscutaAoVivo = { alvo, lida: false, falta: false, lidaEm: null, desde: performance.now() };
  escutasAbertas.add(escuta);
  return escuta;
}

export function fecharEscuta(escuta: EscutaAoVivo) {
  escutasAbertas.delete(escuta);
}

function tipoDoAlvo(alvo: AlvoDaEscuta): unknown {
  return (alvo as { type?: unknown }).type;
}

/** O mesmo alvo do SDK: a mesma consulta (`queryEqual`) ou o mesmo documento (`refEqual`). */
function mesmoAlvo(a: AlvoDaEscuta, b: AlvoDaEscuta): boolean {
  if (a === b) return true;
  const tipoA = tipoDoAlvo(a);
  const tipoB = tipoDoAlvo(b);
  if (typeof tipoA !== "string" || typeof tipoB !== "string") return false;
  if (tipoA === "document" || tipoB === "document") {
    return tipoA === tipoB && refEqual(a as DocumentReference<DocumentData>, b as DocumentReference<DocumentData>);
  }
  return queryEqual(a as Query<DocumentData>, b as Query<DocumentData>);
}

/** Outra escuta aberta agora, do mesmo alvo, que já tem a vista lida: o SDK entrega a mesma a esta. */
function outraEscutaQueLeu(escuta: EscutaAoVivo): EscutaAoVivo | null {
  for (const outra of escutasAbertas) if (outra !== escuta && outra.lida && mesmoAlvo(outra.alvo, escuta.alvo)) return outra;
  return null;
}

/** O pedaço da resposta do `onSnapshot` que a regra lê: a consulta traz `docs`, o documento traz `exists`. */
export type RespostaDoSnapshot = { metadata?: { fromCache?: boolean }; exists?: () => boolean; docs?: readonly unknown[] };

/** A resposta da escuta: se a tela mostra o que veio (a lista, o documento) e se ele está sem o servidor. */
export type RespostaDaEscuta = { mostrar: boolean; falta: boolean };

/** A escuta que já tinha o que mostrar ficou sem o servidor: o que ela mostra fica, com a hora em que deixou de estar em dia. */
function semOServidor(escuta: EscutaAoVivo, lidaEm: number): RespostaDaEscuta {
  escuta.lida = true;
  if (!escuta.falta) {
    escuta.falta = true;
    escuta.lidaEm = lidaEm;
  }
  return { mostrar: true, falta: true };
}

/**
 * A resposta da escuta (carregamento v2, partes 13i e 13j; o momento 8 e a
 * decisão 9.4.2). Sem o servidor, o `onSnapshot` não falha: responde com o que
 * estiver no cache, vazio na primeira visita, e a tela dizia "Nenhuma OS" ou
 * que o documento não existe. A regra é a do `lib/cloud-api.ts`
 * (`lib/carregando/respostas-do-firestore.ts`): a resposta só do cache é a
 * falta de conexão, e a do servidor é a volta. Aqui, com o que a escuta sabe
 * a mais:
 *
 * - do servidor: lida, e em dia;
 * - só do cache, depois de ter lido: a vista deixou de estar em dia (o SDK se
 *   deu por offline, com o aparelho sem rede ou com o servidor sem resposta).
 *   O que ela mostrava fica, com a falta e a hora em que deixou de estar em
 *   dia ("Sem conexão · lista de 10:42");
 * - só do cache, sem nada lido, com outra escuta aberta da mesma consulta que
 *   já leu do servidor: o SDK guarda uma vista por consulta e a entrega à
 *   escuta nova, marcada `fromCache` (a revisão da 13i). É a lista lida, com a
 *   falta. Só a aberta conta: a que fechou leva a vista junto;
 * - só do cache, o documento que existe no cache, com o SDK sem o servidor (o
 *   aparelho sem rede, ou o SDK que se deu por offline): o cache do app é só
 *   de memória, e o SDK só guarda o documento que uma escuta aberta trouxe do
 *   servidor (a ficha da demanda que a lista do shell já leu). É o documento
 *   lido, com a falta. O que não está no cache não diz que ele não existe;
 * - só do cache, sem nada lido, com o SDK sem o servidor, ou vazio (o SDK só
 *   entrega a primeira resposta vazia do cache quando se dá por offline): a
 *   falta de conexão, nunca a lista vazia;
 * - só do cache, sem nada lido, com o aparelho conectado e o SDK em dia: o
 *   cache que chega antes do servidor, que vem logo depois. Vale como lido.
 *
 * A lista de outra consulta não conta: o cache dela pode estar pela metade.
 */
export function respostaDaEscuta(escuta: EscutaAoVivo, snapshot: RespostaDoSnapshot, agora: () => number = Date.now): RespostaDaEscuta {
  if (snapshot.metadata?.fromCache !== true) {
    escuta.lida = true;
    escuta.falta = false;
    escuta.lidaEm = null;
    return { mostrar: true, falta: false };
  }
  if (escuta.lida) return semOServidor(escuta, agora());
  const outra = outraEscutaQueLeu(escuta);
  if (outra) return semOServidor(escuta, outra.lidaEm ?? agora());
  const semServidor = aparelhoSemRede() || firestoreSoNoCache();
  const documento = !Array.isArray(snapshot.docs);
  if (documento && snapshot.exists?.() === true) {
    return semServidor ? semOServidor(escuta, firestoreSoNoCacheDesde() ?? agora()) : { mostrar: true, falta: false };
  }
  const vazia = documento ? true : snapshot.docs!.length === 0;
  if (semServidor || vazia) {
    escuta.falta = true;
    return { mostrar: false, falta: true };
  }
  return { mostrar: true, falta: false };
}

/**
 * A nova tentativa da leitura ao vivo (carregamento v2, parte 13g, a mesma do
 * portal na 13f): o `onSnapshot` que falha não volta sozinho, e a falha sem
 * "Tentar de novo" deixava a pessoa sem saída. `tentar` assina de novo;
 * enquanto a nova assinatura não responde, a falha fica (`erro`, com
 * `tentando`), para o aviso não sair com o foco nele nem a tela voltar a
 * "carregando" (como a `useLeituraComFalha`).
 */
export type NovaTentativa = { tentando: boolean; tentar: () => void } & Partial<FaltaAoVivo>;

/**
 * A nova tentativa de uma leitura ao vivo de verdade: a promessa de `tentar`
 * acaba quando a nova assinatura responde (o dado ou a falha), para quem diz
 * "Tentando de novo…" até lá (a `FalhaNaLeitura`; parte 13c).
 */
export type NovaTentativaAoVivo = { tentando: boolean; tentar: () => Promise<void> };

/** A leitura ao vivo inteira: a nova tentativa e a falta (parte 13j). */
export type LeituraAoVivo = NovaTentativaAoVivo & FaltaAoVivo;

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

/** O que a escuta mostra agora, da assinatura dela. */
type EstadoDaEscuta<R> = { assinatura: string | null; valor: R | undefined; erro: boolean } & FaltaAoVivo;

const SEM_RESPOSTA = { valor: undefined, erro: false, falta: null, lidaEm: null } as const;

/** Assina o alvo, a consulta ou o documento, com as mudanças de metadados. */
function escutar(
  alvo: AlvoDaEscuta,
  proximo: (snapshot: RespostaDoSnapshot) => void,
  falha: (erro: FirestoreError) => void,
): () => void {
  if (tipoDoAlvo(alvo) === "document") {
    return onSnapshot(alvo as DocumentReference<DocumentData>, ESCUTA_COM_METADADOS, proximo, falha);
  }
  return onSnapshot(alvo as Query<DocumentData>, ESCUTA_COM_METADADOS, proximo, falha);
}

/**
 * A escuta ao vivo de um alvo, com a regra das respostas (`respostaDaEscuta`)
 * e a nova tentativa (`useNovaTentativa`). É o corpo de `useLeitura` e
 * `useDocumento`, aqui e no Comercial (parte 13j: uma escuta só).
 *
 * - O resultado diz o que falta (`falta`): a conexão, sem nada lido (`erro`)
 *   ou com o que já estava na tela (com `lidaEm`), ou o servidor (a escuta
 *   recusada). Na nova tentativa, a falta é a da falha que ela repete.
 * - A escuta alimenta o estado único da conexão como o react-query faz pelas
 *   leituras do `lib/cloud-api.ts`: a resposta só do cache que é a falta conta
 *   como a leitura sem resposta, uma vez por queda, e marca o SDK só no cache
 *   (`firestoreRespondeu`), para o app acordá-lo; a do servidor é a volta.
 * - O cache que valeu como lido antes do servidor (o aparelho conectado e o
 *   SDK em dia) vira a falta se, depois, o aparelho perde a rede ou outra
 *   leitura acha o SDK só no cache: a vista que nunca esteve em dia não muda
 *   quando o SDK se dá por offline.
 */
export function useEscutaAoVivo<R>(
  chave: string | null,
  alvoDa: (db: Firestore) => AlvoDaEscuta,
  ler: (snapshot: never) => R,
): { valor: R | undefined; erro: boolean } & LeituraAoVivo {
  const nova = useNovaTentativa(chave);
  const { assinatura } = nova;
  const conexao = useConexaoDaTela();
  const [estado, setEstado] = useState<EstadoDaEscuta<R>>({ assinatura: null, ...SEM_RESPOSTA });
  // A falta da última falha: a nova tentativa a repete enquanto não responde (o aviso não troca de peça).
  const faltaDaFalha = useRef<FaltaDaLeitura>(null);
  useEffect(() => {
    if (!assinatura) return undefined;
    if (!firestore) {
      setEstado({ assinatura, valor: undefined, erro: true, falta: "servidor", lidaEm: null });
      return undefined;
    }
    const escuta = abrirEscuta(alvoDa(firestore));
    const naConexao = leituraDeFora(conexao);
    let ultima: RespostaDoSnapshot | null = null;
    const responder = (snapshot: RespostaDoSnapshot) => {
      ultima = snapshot;
      const doServidor = snapshot.metadata?.fromCache !== true;
      const resposta = respostaDaEscuta(escuta, snapshot);
      if (doServidor) {
        escuta.desde = performance.now();
        firestoreRespondeu(true);
        naConexao.leuDoServidor();
      } else if (resposta.falta) {
        firestoreRespondeu(false);
        naConexao.ficouSemResposta(escuta.desde);
      }
      setEstado(
        resposta.mostrar
          ? { assinatura, valor: ler(snapshot as never), erro: false, falta: resposta.falta ? "conexao" : null, lidaEm: resposta.falta ? escuta.lidaEm : null }
          : { assinatura, valor: undefined, erro: true, falta: "conexao", lidaEm: null },
      );
    };
    // O cache que valeu antes do servidor, quando o SDK se dá por offline ou o aparelho perde a rede.
    const reavaliar = () => {
      if (ultima?.metadata?.fromCache === true && !escuta.falta && (aparelhoSemRede() || firestoreSoNoCache())) responder(ultima);
    };
    const parar = escutar(escuta.alvo, responder, (erro) => {
      ultima = null;
      // O `unavailable` é a conexão; a permissão e o resto, o servidor. A escuta que falhou não volta sozinha.
      setEstado({ assinatura, valor: undefined, erro: true, falta: firestoreSemConexao(erro) ? "conexao" : "servidor", lidaEm: null });
    });
    const deixarDeOuvir = ouvirRespostasDoFirestore(reavaliar);
    window.addEventListener("offline", reavaliar);
    return () => {
      deixarDeOuvir();
      window.removeEventListener("offline", reavaliar);
      fecharEscuta(escuta);
      naConexao.fechar();
      parar();
    };
    // O alvo e a leitura dependem só da chave (e da tentativa).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura, conexao]);
  const leitura = estado.assinatura === assinatura ? estado : SEM_RESPOSTA;
  if (leitura.erro) faltaDaFalha.current = leitura.falta;
  const tentando = nova.tentando(leitura.erro, leitura.valor !== undefined);
  return {
    valor: leitura.valor,
    erro: leitura.erro || tentando,
    tentando,
    tentar: nova.tentar,
    falta: tentando ? faltaDaFalha.current : leitura.falta,
    lidaEm: leitura.lidaEm,
  };
}

export function useLeitura<T>(
  chave: string | null,
  consulta: (db: Firestore) => Query<DocumentData>,
  mapear: (id: string, data: DocumentData) => T | null,
): Leitura<T> & LeituraAoVivo {
  const leitura = useEscutaAoVivo(chave, consulta, (snapshot: QuerySnapshot<DocumentData>) =>
    snapshot.docs.map((row) => mapear(row.id, row.data())).filter((item): item is T => item !== null),
  );
  return { itens: leitura.valor ?? null, erro: leitura.erro, tentando: leitura.tentando, tentar: leitura.tentar, falta: leitura.falta, lidaEm: leitura.lidaEm };
}

/** Um documento ao vivo: undefined enquanto carrega, null quando não existe (ou o mapeamento recusa). */
export type LeituraDeDocumento<T> = { item: T | null | undefined; erro: boolean };

export function useDocumento<T>(
  chave: string | null,
  referencia: (db: Firestore) => DocumentReference<DocumentData>,
  mapear: (id: string, data: DocumentData) => T | null,
): LeituraDeDocumento<T> & LeituraAoVivo {
  const leitura = useEscutaAoVivo(chave, referencia, (snapshot: DocumentSnapshot<DocumentData>) =>
    snapshot.exists() ? mapear(snapshot.id, snapshot.data()) : null,
  );
  return { item: leitura.valor, erro: leitura.erro, tentando: leitura.tentando, tentar: leitura.tentar, falta: leitura.falta, lidaEm: leitura.lidaEm };
}

/** Uma leitura ao vivo de qualquer forma (a coleção, o documento): o que a nova tentativa de várias precisa. */
type LeituraQueTenta = { erro: boolean; tentando?: boolean; tentar?: () => void } & Partial<FaltaAoVivo> & (
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
 * A falta da tela que junta leituras (parte 13j), como a `FalhaNaLeitura` faz
 * com as do react-query: entre as que falharam sem nada lido, a de conexão
 * vem antes da do servidor (o aviso no lugar da seção é o `BlocoSemConexao`);
 * sem falha, a de conexão das lidas (a lista fica, com "lista de 10:42", a
 * hora da mais antiga).
 */
function faltaDe(leituras: ReadonlyArray<{ erro?: boolean } & Partial<FaltaAoVivo>>): FaltaAoVivo {
  const falhas = leituras.filter((leitura) => leitura.erro !== false);
  const falta: FaltaDaLeitura = falhas.some((leitura) => leitura.falta === "conexao")
    ? "conexao"
    : falhas.some((leitura) => leitura.falta === "servidor")
      ? "servidor"
      : leituras.some((leitura) => leitura.falta === "conexao")
        ? "conexao"
        : null;
  const horas = leituras.flatMap((leitura) => (leitura.falta === "conexao" && typeof leitura.lidaEm === "number" ? [leitura.lidaEm] : []));
  return { falta, lidaEm: horas.length ? Math.min(...horas) : null };
}

/**
 * A nova tentativa da tela que junta várias leituras ao vivo (parte 13g): o
 * toque em "Tentar de novo" assina de novo só as que falharam ou ainda não
 * responderam (as lidas ficam na tela), e `tentando` vale enquanto alguma
 * delas ainda espera a resposta pedida. Leva a falta das leituras (parte
 * 13j), para a tela dizer se é a conexão ou o servidor.
 */
export function novaTentativaDe(leituras: ReadonlyArray<LeituraQueTenta>): NovaTentativa {
  return {
    tentando: leituras.some((leitura) => Boolean(leitura.tentando)),
    tentar: () => {
      for (const leitura of leituras) if (semResposta(leitura)) leitura.tentar?.();
    },
    ...faltaDe(leituras),
  };
}

/**
 * Várias novas tentativas como uma (a tela que junta leituras de origens
 * diferentes, como o Financeiro). Cada `tentar` relê só o que não respondeu:
 * a leitura ao vivo já lida não assina de novo, e a consulta lida não relê.
 * A falta é a de conexão antes da do servidor.
 */
export function juntarTentativas(...tentativas: ReadonlyArray<NovaTentativa>): NovaTentativa {
  return {
    tentando: tentativas.some((tentativa) => tentativa.tentando),
    tentar: () => {
      for (const tentativa of tentativas) tentativa.tentar();
    },
    ...faltaDe(tentativas),
  };
}
