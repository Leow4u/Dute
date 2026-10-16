/**
 * Estado do inventário de abertura visto pelas telas internas.
 *
 * A fonte é a sessão (`getOpeningInventorySession`), que todo papel de
 * armazém pode ler. `system_controls/inventory`, onde o backend guarda
 * `opening_inventory_required`, só é legível por quem lê faturamento, então
 * as telas derivam tudo do status da sessão: `not_started` (estoque nunca
 * inicializado, ou zerado de novo), `open` (contagem em curso) e `completed`.
 */

export type CountMode = "opening" | "cycle";

export type OpeningInventorySummary = {
  status?: "not_started" | "open" | "completed" | string;
  line_count?: number;
  unit_count?: number;
};

/**
 * A Contagem abre na aba de abertura enquanto ela não for concluída; depois
 * disso, na contagem cíclica, que é a rotina.
 */
export function defaultCountMode(
  status: OpeningInventorySummary["status"],
): CountMode {
  return status === "completed" ? "cycle" : "opening";
}

export type OpeningInventoryNoticeContent = {
  tone: "warning" | "info";
  title: string;
  description: string;
};

const numberFormatter = new Intl.NumberFormat("pt-BR");

function count(value: number | undefined, singular: string, plural: string) {
  const amount = Number(value ?? 0);
  return `${numberFormatter.format(amount)} ${amount === 1 ? singular : plural}`;
}

/**
 * O aviso que Contagem e Estoque › Itens mostram enquanto a abertura está
 * pendente ou em curso. Depois de concluída, nada: a abertura vira história.
 */
export function openingInventoryNotice(
  session: OpeningInventorySummary | undefined,
): OpeningInventoryNoticeContent | null {
  if (!session) return null;
  if (session.status === "not_started") {
    return {
      tone: "warning",
      title: "Inventário de abertura pendente",
      description:
        "O estoque ainda não foi inicializado. Até a abertura ser concluída, o portal do cliente mostra \"Inventário inicial em andamento\" e pedidos de saída ficam bloqueados.",
    };
  }
  if (session.status === "open") {
    return {
      tone: "info",
      title: "Inventário de abertura em andamento",
      description: `${count(session.line_count, "produto", "produtos")} e ${count(
        session.unit_count,
        "unidade",
        "unidades",
      )} confirmados. O portal do cliente mostra "Inventário inicial em andamento" e pedidos de saída ficam bloqueados até a conclusão. Entradas pelo Receber continuam normais.`,
    };
  }
  return null;
}
