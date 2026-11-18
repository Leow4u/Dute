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

/**
 * A tela da abertura e da cíclica (as abas), desde 18/11/2026: a entrada da
 * Contagem (/wms/contagem) manda para cá com a abertura pendente ou em curso,
 * e ela volta para a entrada quando a sessão conclui.
 */
export const ROTA_DA_ABERTURA = "/wms/contagem/abertura";

export type OpeningInventorySummary = {
  status?: "not_started" | "open" | "completed" | string;
  line_count?: number;
  unit_count?: number;
  /**
   * A abertura deste cliente trava os pedidos de saída (getOpeningInventorySession).
   * Cliente novo, que começa pelo recebimento, vem com false; sem o campo
   * (backend antigo), vale como obrigatória, como sempre foi.
   */
  opening_required?: boolean;
  /** Quando e quem concluiu, gravados pela conclusão (completeOpeningInventory); ausentes antes dela. */
  completed_at?: string;
  completed_by?: { name?: string; email?: string };
};

/**
 * A Contagem abre na aba de abertura enquanto ela não for concluída; depois
 * disso, na contagem cíclica, que é a rotina.
 */
export function defaultCountMode(
  status: OpeningInventorySummary["status"],
  openingRequired?: boolean,
): CountMode {
  if (status === "completed") return "cycle";
  if (status === "not_started" && openingRequired === false) return "cycle";
  return "opening";
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
  // Cliente que não precisa de abertura (começa pelo recebimento): nada a avisar.
  if (session.status === "not_started" && session.opening_required === false) return null;
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

export type RegistroDaAberturaConcluida = {
  /** "Inventário de abertura" */
  titulo: string;
  /** "20/10/2026 às 18:40 · Leonardo"; só a data sem quem; só quem sem data válida; "" sem os dois. */
  quando: string;
  /** "249 lançamentos · 7.314 unidades", com o singular em 1. */
  numeros: string;
};

const DIA_DA_CONCLUSAO = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
const HORA_DA_CONCLUSAO = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * A linha da abertura concluída em "Anteriores" da Contagem (desenho de
 * 18/11/2026): quando e quem concluiu, no fuso do armazém, e os lançamentos
 * e unidades publicados. Sem valor nem caixas, de propósito: preço só para
 * quem vê preço, e a contagem de caixas exigiria ler todas as caixas do
 * cliente só para um número. Fora da sessão concluída, nada.
 */
export function registroDaAberturaConcluida(
  session: OpeningInventorySummary | undefined,
): RegistroDaAberturaConcluida | null {
  if (session?.status !== "completed") return null;
  const instante = Date.parse(session.completed_at ?? "");
  const data = Number.isFinite(instante) ? `${DIA_DA_CONCLUSAO.format(instante)} às ${HORA_DA_CONCLUSAO.format(instante)}` : "";
  const quem = session.completed_by?.name || session.completed_by?.email || "";
  return {
    titulo: "Inventário de abertura",
    quando: [data, quem].filter(Boolean).join(" · "),
    numeros: `${count(session.line_count, "lançamento", "lançamentos")} · ${count(session.unit_count, "unidade", "unidades")}`,
  };
}
