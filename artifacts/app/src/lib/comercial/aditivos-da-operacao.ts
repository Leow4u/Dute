/**
 * O aditivo que a revisão da Operação pediu ao Comercial (docs/plataforma/fase-3-operacao.md,
 * partes 3.10a e 3.10c): o que foi executado além do orçado, no resumo
 * `demands/{numero}.operacao`, que só a Operação escreve. O Comercial lê e
 * faz a RV de aditivo pelo caminho que já existe (Aditivo, motivo aditivo).
 *
 * O pedido fica "a fazer" até o Comercial abrir uma RV de aditivo depois
 * dele, recusar um aditivo depois dele, ou a demanda sair do Comercial
 * (perdida, cancelada, validada). Sem valor: o resumo da Operação não tem
 * preço; o preço sai da tabela na RV de aditivo.
 */

export type ItemDoAditivo = { item: string; quantidade: string; unidade: string | null; os: string };

export type AditivoAFazer = { numero: string; cliente: string; pedidoEm: string; itens: ItemDoAditivo[] };

/** As etapas em que o pedido de aditivo da Operação espera o Comercial. */
export const ETAPAS_COM_ADITIVO_A_FAZER = ["para_planejar", "execucao_a_orcar"] as const;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function objetos(valor: unknown): Record<string, unknown>[] {
  return Array.isArray(valor) ? valor.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

/** Os itens pedidos pela Operação e o último pedido, do resumo da demanda. */
export function aditivoPedido(demanda: Record<string, unknown>): { pedidoEm: string; itens: ItemDoAditivo[] } | null {
  const operacao = demanda.operacao && typeof demanda.operacao === "object" ? (demanda.operacao as Record<string, unknown>) : null;
  const pedidos = objetos(operacao?.aditivo).filter((pedido) => texto(pedido.item) && texto(pedido.quantidade) && texto(pedido.pedido_em));
  if (!pedidos.length) return null;
  return {
    pedidoEm: pedidos.map((pedido) => texto(pedido.pedido_em)).sort().at(-1) as string,
    itens: pedidos.map((pedido) => ({ item: texto(pedido.item), quantidade: texto(pedido.quantidade), unidade: texto(pedido.unidade) || null, os: texto(pedido.os) })),
  };
}

/**
 * O aditivo a fazer da demanda, ou null: há pedido da Operação, a demanda
 * está numa etapa que espera o Comercial, e nenhuma RV de aditivo nem
 * recusa de aditivo veio depois do pedido.
 */
export function aditivoAFazer(numero: string, demanda: Record<string, unknown>, quote: Record<string, unknown> | null): AditivoAFazer | null {
  const pedido = aditivoPedido(demanda);
  if (!pedido) return null;
  if (!(ETAPAS_COM_ADITIVO_A_FAZER as readonly string[]).includes(texto(demanda.etapa))) return null;
  const rvDeAditivoDepois = quote !== null && texto(quote.tipo_rv) === "aditivo" && texto(quote.passo_em) >= pedido.pedidoEm;
  const recusaDepois = objetos(demanda.aditivos_recusados).some((recusa) => texto(recusa.registrada_em) >= pedido.pedidoEm);
  if (rvDeAditivoDepois || recusaDepois) return null;
  return { numero, cliente: texto(demanda.customer_name) || texto(demanda.customer_code), ...pedido };
}

/** "+4 Mesa · +10 Cadeira". */
export function itensDoAditivoEmTexto(itens: readonly ItemDoAditivo[]): string {
  return itens.map((item) => `+${item.quantidade.replace(".", ",")} ${item.item}`).join(" · ");
}

// --- A execução da Operação no orçamento --------------------------------------------------

export type LinhaDaExecucao = { item: string; unidade: string | null; executado: string; aCobrar: string; absorvido: string; aditivo: string };

export type ExecucaoDaOperacao = {
  /** "OS 10045-01 e 10045-02 revisadas · 22/10 a 23/10". */
  titulo: string;
  linhas: LinhaDaExecucao[];
  /** O aditivo que a Operação pediu e ainda espera a RV de aditivo, ou null. */
  aditivo: AditivoAFazer | null;
};

function lista(numeros: readonly string[]): string {
  return numeros.length <= 1 ? numeros.join("") : `${numeros.slice(0, -1).join(", ")} e ${numeros.at(-1)}`;
}

function diaMes(data: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(data) ? `${data.slice(8, 10)}/${data.slice(5, 7)}` : data;
}

function quantidade(valor: unknown): string {
  return texto(valor).replace(".", ",") || "0";
}

/**
 * O que a Operação executou e revisou, para o Comercial orçar a execução e
 * fazer o aditivo (parte 3.10c): por linha, o executado, o que se cobra, o
 * absorvido e o que foi para aditivo. Null antes da primeira OS revisada.
 */
export function execucaoDaOperacao(numero: string, demanda: Record<string, unknown> | null, quote: Record<string, unknown> | null): ExecucaoDaOperacao | null {
  const operacao = demanda?.operacao && typeof demanda.operacao === "object" ? (demanda.operacao as Record<string, unknown>) : null;
  const revisadas = Array.isArray(operacao?.os_revisadas) ? (operacao.os_revisadas as unknown[]).filter((os): os is string => typeof os === "string") : [];
  if (!operacao || !revisadas.length) return null;
  const periodo = operacao.periodo && typeof operacao.periodo === "object" ? (operacao.periodo as Record<string, unknown>) : null;
  const de = texto(periodo?.de);
  const ate = texto(periodo?.ate);
  const quando = de ? (ate && ate !== de ? `${diaMes(de)} a ${diaMes(ate)}` : diaMes(de)) : null;
  return {
    titulo: [`OS ${lista(revisadas)} ${revisadas.length === 1 ? "revisada" : "revisadas"}`, quando].filter(Boolean).join(" · "),
    linhas: objetos(operacao.itens).map((linha) => ({
      item: texto(linha.item),
      unidade: texto(linha.unidade).toLocaleLowerCase("pt-BR") || null,
      executado: quantidade(linha.executado),
      aCobrar: quantidade(linha.a_cobrar),
      absorvido: quantidade(linha.absorvido),
      aditivo: quantidade(linha.aditivo),
    })),
    aditivo: demanda ? aditivoAFazer(numero, demanda, quote) : null,
  };
}
