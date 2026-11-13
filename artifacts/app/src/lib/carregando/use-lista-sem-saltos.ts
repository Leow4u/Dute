import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefCallback } from "react";
import { flushSync } from "react-dom";

import { CARREGANDO } from "./tempo";

/**
 * Onde a linha está na lista: `parada`; `chegando`, no realce de 1 s depois de
 * entrar; `esperando`, já fora das chaves, mas na tela enquanto alguém toca a
 * lista; `saindo`, esmaecendo nos 200 ms antes de deixar a lista.
 */
export type EstadoNaLista = "parada" | "chegando" | "esperando" | "saindo";

/** Os atributos do elemento da linha, filho direto do `ref` da lista. */
export interface AtributosDaLinha {
  "data-chave": string;
  "data-na-lista": EstadoNaLista;
  /** A linha que sai não recebe foco nem toque, e sai da árvore de acessibilidade. */
  inert?: boolean;
}

export interface OpcoesDaLista {
  /**
   * A lista já tem a primeira leitura. Antes disso, e na leitura que a deixa
   * pronta, as chaves entram de uma vez, sem realce: só o que muda depois
   * chega e sai sem salto. Pronta por padrão.
   */
  pronta?: boolean;
}

export interface ListaSemSaltos {
  /** O elemento da lista: as linhas são os filhos dele com `data-chave`. */
  ref: RefCallback<HTMLElement>;
  /** O título do grupo (com `tabIndex={-1}`): o foco vai para ele quando a última linha sai com o foco. */
  titulo: RefCallback<HTMLElement>;
  /** As chaves na tela, na ordem: as de agora e as que ainda saem, no lugar de antes. */
  chaves: readonly string[];
  estado(chave: string): EstadoNaLista;
  /** Os atributos do elemento da linha. */
  linha(chave: string): AtributosDaLinha;
}

interface Estado {
  /** Na tela, na ordem. */
  exibidas: readonly string[];
  saindo: ReadonlySet<string>;
  chegando: ReadonlySet<string>;
}

const VAZIO: ReadonlySet<string> = new Set();

/** O alvo do foco numa linha: a ação marcada com `data-foco-da-linha` ou, sem ela, o primeiro controle. */
const FOCAVEIS = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const agora = () => performance.now();

function iguais(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((chave, indice) => chave === b[indice]);
}

/** A lista nova com as linhas que ainda saem, cada uma logo depois da que vinha antes dela. */
function juntar(alvo: readonly string[], anteriores: readonly string[], retidas: ReadonlySet<string>): string[] {
  const juntas = [...alvo];
  anteriores.forEach((chave, indice) => {
    if (!retidas.has(chave)) return;
    let depoisDe = -1;
    for (let k = indice - 1; k >= 0 && depoisDe < 0; k -= 1) depoisDe = juntas.indexOf(anteriores[k]);
    juntas.splice(depoisDe + 1, 0, chave);
  });
  return juntas;
}

function semAs(conjunto: ReadonlySet<string>, tirar: Iterable<string>): ReadonlySet<string> {
  const resto = new Set(conjunto);
  for (const chave of tirar) resto.delete(chave);
  return resto.size ? resto : VAZIO;
}

function linhasDa(lista: HTMLElement): HTMLElement[] {
  return Array.from(lista.children).filter((filho): filho is HTMLElement => filho instanceof HTMLElement && filho.dataset.chave !== undefined);
}

function linhaDa(lista: HTMLElement, chave: string): HTMLElement | undefined {
  return linhasDa(lista).find((linha) => linha.dataset.chave === chave);
}

function movimentoReduzido(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A lista sem saltos do carregamento v2 (aprovado em 12/11/2026, seção 9 e
 * momento 4), no lugar da linha que some de uma vez:
 *
 * - A linha que sai das `chaves` fica na tela e esmaece em 200 ms (opacidade
 *   e −6 px, `data-na-lista="saindo"`, inert); depois deixa a lista, e as de
 *   baixo sobem por FLIP, só com `transform` (240 ms, `data-reflui`).
 * - A que chega fica `chegando` por 1 s: entra em 240 ms e tem o realce.
 * - Nada sai nem entra se alguém tocou na lista nos últimos 700 ms; a espera
 *   vai até 3 s.
 * - Se o foco estava na linha que sai, ele vai para a ação da linha seguinte
 *   ou, sem ela, para o título do grupo.
 * - No movimento reduzido, a linha some só por opacidade e as de baixo pulam
 *   para o lugar, sem deslocamento.
 *
 * A tela desenha as `chaves` devolvidas (com as que saem), espalha
 * `linha(chave)` no elemento de cada linha e congela o conteúdo da que está
 * `esperando` ou `saindo`: ela mostra o que mostrava quando saiu da fila (o
 * "Aprovado"). O desenho mora em index.css (`[data-na-lista]`).
 */
export function useListaSemSaltos(chaves: readonly string[], opcoes: OpcoesDaLista = {}): ListaSemSaltos {
  const pronta = opcoes.pronta ?? true;
  const [estado, setEstado] = useState<Estado>(() => ({ exibidas: [...chaves], saindo: VAZIO, chegando: VAZIO }));

  const alvo = useRef(chaves);
  const atual = useRef(estado);
  const estaPronta = useRef(pronta);
  /** A lista já passou pela leitura que a deixou pronta (essa entra de uma vez). */
  const jaPronta = useRef(false);
  const montada = useRef(false);
  const lista = useRef<HTMLElement | null>(null);
  const titulo = useRef<HTMLElement | null>(null);
  const ultimoToque = useRef<number | null>(null);
  /** Desde quando a mudança espera o dedo sair. */
  const pendenteDesde = useRef<number | null>(null);
  /** Quando cada linha que sai foi vista fora das chaves, e quando começou a esmaecer. */
  const removidaEm = useRef(new Map<string, number>());
  const saiuEm = useRef(new Map<string, number>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  const agendar = useCallback((fazer: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      if (montada.current) fazer();
    }, Math.max(0, ms));
    timers.current.add(timer);
    return timer;
  }, []);

  /** Até quando o dedo segura a lista; nulo se ela já pode mudar. */
  const presaAte = useCallback((instante: number, desde: number): number | null => {
    const toque = ultimoToque.current;
    if (toque === null) return null;
    const livre = toque + CARREGANDO.dedoMs;
    const limite = desde + CARREGANDO.dedoMaxMs;
    return instante >= livre || instante >= limite ? null : Math.min(livre, limite);
  }, []);

  /** O foco que estava numa linha que sai vai para a ação da linha seguinte, ou para o título. */
  const tirarFoco = useCallback((saem: readonly string[], exibidas: readonly string[], ficam: ReadonlySet<string>) => {
    const elemento = lista.current;
    const ativo = typeof document === "undefined" ? null : document.activeElement;
    if (!elemento || !ativo) return;
    for (const chave of saem) {
      if (!linhaDa(elemento, chave)?.contains(ativo)) continue;
      const seguinte = exibidas.slice(exibidas.indexOf(chave) + 1).find((outra) => ficam.has(outra));
      const linha = seguinte ? linhaDa(elemento, seguinte) : undefined;
      const destino = linha?.querySelector<HTMLElement>("[data-foco-da-linha]") ?? linha?.querySelector<HTMLElement>(FOCAVEIS) ?? titulo.current;
      destino?.focus();
      return;
    }
  }, []);

  /** As de baixo sobem por FLIP: partem de onde estavam (`antes`) e vão ao lugar novo só por transform. */
  const refluir = useCallback(
    (elemento: HTMLElement, antes: ReadonlyMap<string, number>) => {
      const linhas = linhasDa(elemento).filter((linha) => linha.dataset.naLista !== "saindo");
      for (const linha of linhas) {
        linha.removeAttribute("data-reflui");
        linha.style.transform = "";
      }
      const deltas = linhas.map((linha) => {
        const de = antes.get(linha.dataset.chave ?? "");
        return de === undefined ? 0 : de - linha.getBoundingClientRect().top;
      });
      const movidas = linhas.filter((linha, indice) => {
        if (Math.abs(deltas[indice]) < 0.5) return false;
        linha.style.transform = `translateY(${deltas[indice]}px)`;
        return true;
      });
      if (!movidas.length) return;
      // O navegador assenta o ponto de partida antes da transição.
      void elemento.getBoundingClientRect();
      for (const linha of movidas) {
        linha.setAttribute("data-reflui", "");
        linha.style.transform = "";
      }
      agendar(() => {
        for (const linha of movidas) if (!linha.style.transform) linha.removeAttribute("data-reflui");
      }, CARREGANDO.refluiMs);
    },
    [agendar],
  );

  /** A linha que esmaeceu deixa a lista; as de baixo sobem por FLIP. */
  const soltar = useCallback(() => {
    const instante = agora();
    // Quando cada uma termina de esmaecer (com 2 ms de folga entre o relógio do timer e o do performance).
    const fimDe = (chave: string) => (saiuEm.current.get(chave) ?? instante - CARREGANDO.saiLinhaMs) + CARREGANDO.saiLinhaMs - 2;
    const saindo = [...atual.current.saindo];
    const prontas = saindo.filter((chave) => fimDe(chave) <= instante);
    const depois = saindo.filter((chave) => fimDe(chave) > instante);
    if (depois.length) agendar(soltar, Math.min(...depois.map(fimDe)) - instante + 2);
    if (!prontas.length) return;
    const desde = Math.min(...prontas.map((chave) => removidaEm.current.get(chave) ?? instante));
    const ate = presaAte(instante, desde);
    if (ate !== null) {
      agendar(soltar, ate - instante);
      return;
    }
    const elemento = lista.current;
    const antes = elemento && !movimentoReduzido() ? new Map(linhasDa(elemento).map((linha) => [linha.dataset.chave ?? "", linha.getBoundingClientRect().top])) : null;
    const saem = new Set(prontas);
    for (const chave of prontas) {
      saiuEm.current.delete(chave);
      removidaEm.current.delete(chave);
    }
    flushSync(() =>
      setEstado((anterior) => ({
        exibidas: anterior.exibidas.filter((chave) => !saem.has(chave)),
        saindo: semAs(anterior.saindo, saem),
        chegando: anterior.chegando,
      })),
    );
    if (antes && lista.current) refluir(lista.current, antes);
  }, [agendar, presaAte, refluir]);

  /** Leva a tela às chaves: o que saiu esmaece, o que chegou entra; sob o dedo, espera. */
  const reconciliar = useCallback(() => {
    if (!montada.current) return;
    const desejadas = alvo.current;
    const tela = atual.current;
    if (!estaPronta.current || !jaPronta.current) {
      // Antes de pronta, e na leitura que a deixa pronta, a lista é as chaves.
      jaPronta.current = estaPronta.current;
      pendenteDesde.current = null;
      removidaEm.current.clear();
      saiuEm.current.clear();
      if (!iguais(tela.exibidas, desejadas) || tela.saindo.size || tela.chegando.size) {
        setEstado({ exibidas: [...desejadas], saindo: VAZIO, chegando: VAZIO });
      }
      return;
    }
    const naAlvo = new Set(desejadas);
    const naTela = new Set(tela.exibidas);
    const novas = desejadas.filter((chave) => !naTela.has(chave));
    const removidas = tela.exibidas.filter((chave) => !naAlvo.has(chave) && !tela.saindo.has(chave));
    const voltaram = [...tela.saindo].filter((chave) => naAlvo.has(chave));
    const reordenou = !iguais(
      tela.exibidas.filter((chave) => naAlvo.has(chave)),
      desejadas.filter((chave) => naTela.has(chave)),
    );
    if (!novas.length && !removidas.length && !voltaram.length && !reordenou) {
      pendenteDesde.current = null;
      return;
    }
    const instante = agora();
    for (const chave of removidas) if (!removidaEm.current.has(chave)) removidaEm.current.set(chave, instante);
    pendenteDesde.current ??= instante;
    const ate = presaAte(instante, pendenteDesde.current);
    if (ate !== null) {
      if (espera.current === null) {
        espera.current = agendar(() => {
          espera.current = null;
          reconciliar();
        }, ate - instante);
      }
      return;
    }
    pendenteDesde.current = null;
    tirarFoco(removidas, tela.exibidas, naAlvo);
    const saindo = new Set([...tela.saindo, ...removidas].filter((chave) => !naAlvo.has(chave)));
    for (const chave of voltaram) {
      saiuEm.current.delete(chave);
      removidaEm.current.delete(chave);
    }
    for (const chave of removidas) saiuEm.current.set(chave, instante);
    setEstado({
      exibidas: juntar(desejadas, tela.exibidas, saindo),
      saindo: saindo.size ? saindo : VAZIO,
      chegando: semAs(new Set([...tela.chegando, ...novas]), saindo),
    });
    if (removidas.length) agendar(soltar, CARREGANDO.saiLinhaMs);
    if (novas.length) {
      agendar(() => setEstado((anterior) => ({ ...anterior, chegando: semAs(anterior.chegando, novas) })), CARREGANDO.destaqueMs);
    }
  }, [agendar, presaAte, soltar, tirarFoco]);

  // Antes da reconciliação, para a primeira já valer.
  useLayoutEffect(() => {
    montada.current = true;
    const pendentes = timers.current;
    return () => {
      montada.current = false;
      for (const timer of pendentes) clearTimeout(timer);
      pendentes.clear();
      espera.current = null;
    };
  }, []);

  const assinatura = chaves.join("\u0000");
  useLayoutEffect(() => {
    alvo.current = chaves;
    atual.current = estado;
    estaPronta.current = pronta;
    reconciliar();
    // As chaves entram pela assinatura: a mesma lista em outro array não muda nada.
  }, [assinatura, estado, pronta, reconciliar]);

  const [tocou] = useState(() => () => {
    ultimoToque.current = agora();
  });

  const ref = useCallback<RefCallback<HTMLElement>>(
    (no) => {
      if (lista.current === no) return;
      lista.current?.removeEventListener("pointerdown", tocou, true);
      lista.current = no;
      no?.addEventListener("pointerdown", tocou, true);
    },
    [tocou],
  );

  const tituloRef = useCallback<RefCallback<HTMLElement>>((no) => {
    titulo.current = no;
  }, []);

  return useMemo<ListaSemSaltos>(() => {
    const naAlvo = new Set(chaves);
    const estadoDe = (chave: string): EstadoNaLista => {
      if (estado.saindo.has(chave)) return "saindo";
      if (!naAlvo.has(chave)) return "esperando";
      return estado.chegando.has(chave) ? "chegando" : "parada";
    };
    return {
      ref,
      titulo: tituloRef,
      chaves: estado.exibidas,
      estado: estadoDe,
      linha: (chave) => {
        const naLista = estadoDe(chave);
        return { "data-chave": chave, "data-na-lista": naLista, ...(naLista === "saindo" ? { inert: true } : {}) };
      },
    };
    // A assinatura diz quando as chaves mudaram.
  }, [assinatura, estado, ref, tituloRef]);
}
