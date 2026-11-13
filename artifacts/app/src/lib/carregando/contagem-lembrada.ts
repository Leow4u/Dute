import { useEffect, useMemo } from "react";

/**
 * A contagem lembrada (carregamento v2, seção 5.2, e a decisão P3 de
 * 12/11/2026): a última contagem lida de cada grupo de uma lista, por cliente
 * ativo, guardada no aparelho. Na primeira leitura da próxima visita, ela
 * reserva a altura das linhas-fantasma, para a lista não saltar quando o dado
 * chega. Ela só dimensiona o esqueleto e nunca aparece como número.
 */

/** Sem leitura anterior daquela lista e daquele cliente, duas linhas-fantasma por grupo. */
export const FANTASMAS_SEM_LEMBRANCA = 2;
/** A contagem lembrada dimensiona o esqueleto entre uma e cinco linhas. */
export const FANTASMAS_MIN = 1;
export const FANTASMAS_MAX = 5;

/** A contagem de cada grupo da lista ("aprovar", "separar"…). */
export type ContagensDaLista = Readonly<Record<string, number>>;

const PREFIXO = "dute:contagem-lembrada";

function chaveDa(lista: string, cliente: string): string {
  return `${PREFIXO}:${lista}:${cliente}`;
}

/** Quantas linhas-fantasma o grupo tem: a contagem lembrada, entre 1 e 5; sem ela, 2. */
export function linhasDosFantasmas(lembrada: number | null | undefined): number {
  if (typeof lembrada !== "number" || !Number.isFinite(lembrada)) return FANTASMAS_SEM_LEMBRANCA;
  return Math.min(FANTASMAS_MAX, Math.max(FANTASMAS_MIN, Math.round(lembrada)));
}

/**
 * A última contagem lida da lista daquele cliente, ou nulo: sem cliente, sem
 * nada guardado, com o guardado estragado ou sem o armazenamento do aparelho
 * (a janela anônima, o bloqueio do navegador). Só fica o que é número inteiro
 * de zero para cima.
 */
export function lerContagens(lista: string, cliente: string): ContagensDaLista | null {
  if (!cliente) return null;
  try {
    const bruto = window.localStorage.getItem(chaveDa(lista, cliente));
    if (!bruto) return null;
    const lido: unknown = JSON.parse(bruto);
    if (!lido || typeof lido !== "object" || Array.isArray(lido)) return null;
    const contagens: Record<string, number> = {};
    for (const [grupo, valor] of Object.entries(lido)) {
      if (typeof valor === "number" && Number.isInteger(valor) && valor >= 0) contagens[grupo] = valor;
    }
    return contagens;
  } catch {
    return null;
  }
}

/** Guarda a contagem lida. Sem o armazenamento do aparelho, nada: a próxima visita usa as duas linhas. */
export function lembrarContagens(lista: string, cliente: string, contagens: ContagensDaLista): void {
  if (!cliente) return;
  try {
    window.localStorage.setItem(chaveDa(lista, cliente), JSON.stringify(contagens));
  } catch {
    // O armazenamento indisponível não pode travar a lista.
  }
}

export interface ContagemLembrada {
  /** Quantas linhas-fantasma o grupo tem na primeira leitura (linhasDosFantasmas). */
  linhas(grupo: string): number;
  /** A contagem lembrada do grupo, sem o limite de 1 a 5; nula sem lembrança (o grupo que só aparece com linha). */
  lembrada(grupo: string): number | null;
}

/**
 * A contagem lembrada da lista para o cliente ativo: lida quando a tela abre
 * (e quando o cliente muda) e guardada a cada leitura nova (`lidas`; nulo
 * enquanto a lista não leu, para a primeira leitura não apagar a lembrança).
 */
export function useContagemLembrada(lista: string, cliente: string, lidas: ContagensDaLista | null): ContagemLembrada {
  const lembradas = useMemo(() => lerContagens(lista, cliente), [lista, cliente]);
  // A mesma contagem num objeto novo não grava de novo.
  const assinatura = lidas ? JSON.stringify(lidas) : null;
  useEffect(() => {
    if (assinatura !== null) lembrarContagens(lista, cliente, JSON.parse(assinatura) as ContagensDaLista);
  }, [assinatura, cliente, lista]);
  return useMemo(
    () => ({
      linhas: (grupo) => linhasDosFantasmas(lembradas?.[grupo]),
      lembrada: (grupo) => lembradas?.[grupo] ?? null,
    }),
    [lembradas],
  );
}
