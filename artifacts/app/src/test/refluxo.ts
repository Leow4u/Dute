import { REFLUXO } from "@/lib/carregando/palco-sem-saltos";

/**
 * O refluxo do palco nos testes (lib/carregando/palco-sem-saltos.ts): o
 * jsdom não tem Web Animations, então o `animate` do elemento é gravado. Cada
 * refluxo diz de onde a peça parte (o `translate` e o `scale` do primeiro
 * quadro), quanto dura, com que curva, e se ainda corre (no relógio falso do
 * teste) ou foi cancelado por um refluxo seguinte.
 */
export interface Refluxo {
  alvo: Element;
  /** De quantos px a peça parte (o translate do primeiro quadro). */
  anda: number;
  /** De que escala vertical ela parte (o scale do primeiro quadro; 1 sem ele). */
  estica: number;
  /** Os quadros, para conferir que só anima translate e scale. */
  quadros: Keyframe[];
  duracao: number;
  curva: string;
  /** "replace" sozinho; "add" quando soma com um refluxo que ainda corre na peça. */
  composicao: string;
  cancelado: boolean;
  inicio: number;
}

export interface RefluxosGravados {
  /** Todos, na ordem em que começaram. */
  todos(): Refluxo[];
  /** Os da peça, na ordem. */
  de(alvo: Element): Refluxo[];
  /** Os que ainda correm na peça (nem cancelados nem terminados), na ordem. */
  correndo(alvo: Element): Refluxo[];
  /** O deslocamento que os refluxos que correm na peça dão agora (somados, cada um linear, para o teste). */
  noMeio(alvo: Element): number;
  /** Desfaz a gravação. */
  restaurar(): void;
}

function numero(valor: unknown, indice: number, padrao: number): number {
  const partes = String(valor ?? "").trim().split(/\s+/);
  const achado = Number.parseFloat(partes[indice] ?? "");
  return Number.isFinite(achado) ? achado : padrao;
}

export function gravarRefluxos(): RefluxosGravados {
  const gravados: Refluxo[] = [];
  const antes = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
  const terminou = (refluxo: Refluxo) => performance.now() - refluxo.inicio >= refluxo.duracao;
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value: function animate(this: Element, quadros: Keyframe[], opcoes: KeyframeAnimationOptions) {
      const primeiro = quadros[0] ?? {};
      const refluxo: Refluxo = {
        alvo: this,
        anda: numero(primeiro.translate, 1, 0),
        estica: numero(primeiro.scale, 1, 1),
        quadros,
        duracao: Number(opcoes.duration),
        curva: String(opcoes.easing),
        composicao: opcoes.composite ?? "replace",
        cancelado: false,
        inicio: performance.now(),
      };
      if (opcoes.id !== REFLUXO) throw new Error(`animação inesperada: ${String(opcoes.id)}`);
      gravados.push(refluxo);
      // Começa na hora (o ready já resolvido, como depois do primeiro quadro) e termina no relógio do teste,
      // como no navegador; cancelada, sai na hora (e não deixa relógio). O startTime posto pela tela vale.
      let fim: ReturnType<typeof setTimeout> | null = null;
      const terminar = () => {
        if (fim !== null) clearTimeout(fim);
        fim = setTimeout(() => {
          fim = null;
          animacao.onfinish?.();
        }, Math.max(0, refluxo.inicio + refluxo.duracao - performance.now()));
      };
      const animacao = {
        id: opcoes.id,
        onfinish: null as null | (() => void),
        oncancel: null as null | (() => void),
        get startTime() {
          return refluxo.cancelado ? null : refluxo.inicio;
        },
        set startTime(valor: number | null) {
          if (valor === null) return;
          refluxo.inicio = valor;
          terminar();
        },
        ready: Promise.resolve(),
        cancel() {
          if (refluxo.cancelado) return;
          refluxo.cancelado = true;
          if (fim !== null) clearTimeout(fim);
          fim = null;
          animacao.oncancel?.();
        },
      };
      terminar();
      return animacao as unknown as Animation;
    },
  });
  return {
    todos: () => [...gravados],
    de: (alvo) => gravados.filter((refluxo) => refluxo.alvo === alvo),
    correndo: (alvo) => gravados.filter((refluxo) => refluxo.alvo === alvo && !refluxo.cancelado && !terminou(refluxo)),
    noMeio: (alvo) =>
      gravados
        .filter((refluxo) => refluxo.alvo === alvo && !refluxo.cancelado && !terminou(refluxo))
        .reduce((soma, refluxo) => soma + refluxo.anda * (1 - (performance.now() - refluxo.inicio) / refluxo.duracao), 0),
    restaurar() {
      if (antes) Object.defineProperty(Element.prototype, "animate", antes);
      else delete (Element.prototype as unknown as { animate?: unknown }).animate;
    },
  };
}
