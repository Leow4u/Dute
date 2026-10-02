/**
 * Peças sem React do chat do Agent Dute: Markdown das respostas, rótulos das
 * consultas, lista de conversas e sugestões do dia.
 */

// ------------------------------------------------------------- Markdown

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string };

export type Block =
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "heading"; content: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][]; align: Array<"left" | "right"> }
  | { kind: "rule" };

/** Negrito, itálico e código; o resto é texto. Marcador sem par fica como texto. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /\*\*([^*]+?)\*\*|__([^_]+?)__|`([^`]+?)`|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])/g;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > last) out.push({ kind: "text", text: source.slice(last, match.index) });
    if (match[1] ?? match[2]) out.push({ kind: "bold", text: (match[1] ?? match[2]) as string });
    else if (match[3]) out.push({ kind: "code", text: match[3] });
    else out.push({ kind: "italic", text: (match[4] ?? match[5]) as string });
    last = match.index + match[0].length;
  }
  if (last < source.length) out.push({ kind: "text", text: source.slice(last) });
  return out.length ? out : [{ kind: "text", text: "" }];
}

const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function tableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const NUMERIC = /^[-+]?(R\$\s*)?[\d.,]+\s*%?$|^[-+]?[\d.,]+(\s*(peças|itens|un))?$/i;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    const heading = trimmed.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", content: parseInline(heading[1]) });
      continue;
    }
    if (trimmed.startsWith("|") && TABLE_RULE.test(lines[index + 1] ?? "")) {
      flush();
      const header = tableCells(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      const align = header.map((_, column) =>
        rows.length > 0 && rows.every((row) => !row[column] || NUMERIC.test(row[column].replace(/\*\*/g, "")))
          ? ("right" as const)
          : ("left" as const),
      );
      blocks.push({
        kind: "table",
        header: header.map(parseInline),
        rows: rows.map((row) => header.map((_, column) => parseInline(row[column] ?? ""))),
        align,
      });
      continue;
    }
    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const items: Inline[][] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        const match = ordered ? current.match(/^\d+[.)]\s+(.*)$/) : current.match(/^[-*•]\s+(.*)$/);
        if (!match) break;
        items.push(parseInline(match[1]));
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    paragraph.push(trimmed);
  }
  flush();
  return blocks;
}

/**
 * Texto ainda chegando: um "**" sem par no fim apareceria cru até o
 * fechamento chegar. Some até lá.
 */
export function settleStreamingMarkdown(text: string) {
  const marks = text.match(/\*\*/g)?.length ?? 0;
  if (marks % 2 === 0) return text;
  const last = text.lastIndexOf("**");
  return text.slice(0, last) + text.slice(last + 2);
}

// ------------------------------------------------------------- consultas

const TOOL_LABELS: Record<string, { done: string; running: string }> = {
  resumo_estoque: { done: "Consultou o estoque", running: "Consultando o estoque" },
  buscar_itens: { done: "Buscou itens no estoque", running: "Buscando itens no estoque" },
  listar_pedidos: { done: "Consultou os pedidos", running: "Consultando os pedidos" },
  ver_pedido: { done: "Abriu o pedido", running: "Abrindo o pedido" },
  movimentacoes: { done: "Consultou as movimentações", running: "Consultando as movimentações" },
  faturas: { done: "Consultou as faturas", running: "Consultando as faturas" },
  documentos: { done: "Consultou os documentos", running: "Consultando os documentos" },
  rascunho_pedido: { done: "Montou o pedido", running: "Montando o pedido" },
  rascunho_envio: { done: "Montou o rascunho do aviso", running: "Montando o rascunho do aviso" },
  sugerir_anotacao: { done: "Sugeriu uma anotação para a equipe aprovar", running: "Sugerindo uma anotação" },
  conversas_anteriores: { done: "Procurou nas conversas anteriores", running: "Procurando nas conversas anteriores" },
  fila_solicitacoes: { done: "Consultou a fila de solicitações", running: "Consultando a fila de solicitações" },
  recebimentos: { done: "Consultou os recebimentos", running: "Consultando os recebimentos" },
  tarefas_armazem: { done: "Consultou as tarefas do armazém", running: "Consultando as tarefas do armazém" },
  enderecos: { done: "Consultou os endereços", running: "Consultando os endereços" },
  eventos: { done: "Consultou o histórico", running: "Consultando o histórico" },
  previa_faturamento: { done: "Calculou a prévia da fatura", running: "Calculando a prévia da fatura" },
};

export function toolLabel(name: string, running = false) {
  const label = TOOL_LABELS[name];
  if (!label) return running ? "Consultando os dados" : "Consultou os dados";
  return running ? label.running : label.done;
}

/** Uma etiqueta por ferramenta, na ordem em que foram usadas. */
export function uniqueTools(names: readonly string[] | null | undefined) {
  return [...new Set((names ?? []).filter(Boolean))];
}

// ------------------------------------------------------------- conversas

export type ConversationSummary = {
  id: string;
  title: string;
  last_message_at: string;
};

const DAY = 86_400_000;

function startOfDaySaoPaulo(date: Date) {
  const local = new Date(date.getTime() - 3 * 3_600_000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + 3 * 3_600_000;
}

export function groupConversations(list: ConversationSummary[], now: Date) {
  const today = startOfDaySaoPaulo(now);
  const groups: Array<{ label: string; items: ConversationSummary[] }> = [
    { label: "Hoje", items: [] },
    { label: "Ontem", items: [] },
    { label: "Últimos 7 dias", items: [] },
    { label: "Últimos 30 dias", items: [] },
    { label: "Mais antigas", items: [] },
  ];
  const sorted = [...list].sort((left, right) => right.last_message_at.localeCompare(left.last_message_at));
  for (const item of sorted) {
    const time = new Date(item.last_message_at).getTime();
    const slot = Number.isNaN(time)
      ? 4
      : time >= today
        ? 0
        : time >= today - DAY
          ? 1
          : time >= today - 7 * DAY
            ? 2
            : time >= today - 30 * DAY
              ? 3
              : 4;
    groups[slot].items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}

function fold(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function filterConversations(list: ConversationSummary[], query: string) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return list;
  return list.filter((item) => terms.every((term) => fold(item.title).includes(term)));
}

export function newConversationId() {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 18);
  return `conv_${Date.now()}_${random}`;
}

// ------------------------------------------------------------- sugestões

export type Suggestion = { prompt: string; hint: string };

const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "America/Sao_Paulo" });

/**
 * Sugestões a partir do que a pessoa tem hoje: o pedido em andamento, o
 * estoque abaixo do mínimo, o mês anterior e a última fatura. Completa com
 * perguntas gerais até `limit`.
 */
export function daySuggestions(
  input: {
    activeOrder?: { title: string; stage: string } | null;
    belowMinimum: number;
    lastInvoice?: { label: string; detail: string } | null;
  },
  now: Date,
  limit = 4,
): Suggestion[] {
  const previousMonth = monthName.format(new Date(now.getTime() - (now.getUTCDate() + 1) * DAY));
  const list: Suggestion[] = [];
  if (input.activeOrder) {
    list.push({ prompt: `Onde está o pedido ${input.activeOrder.title}?`, hint: input.activeOrder.stage.toLowerCase() });
  }
  if (input.belowMinimum > 0) {
    list.push({
      prompt: "O que está abaixo do estoque mínimo?",
      hint: input.belowMinimum === 1 ? "1 item hoje" : `${input.belowMinimum} itens hoje`,
    });
  }
  list.push({ prompt: `Quanto saiu de cada item em ${previousMonth}?`, hint: "movimentações do mês" });
  if (input.lastInvoice) {
    list.push({ prompt: `Explique a fatura de ${input.lastInvoice.label.toLowerCase()}`, hint: input.lastInvoice.detail });
  }
  for (const fallback of [
    { prompt: "Qual é o resumo do meu estoque hoje?", hint: "peças, reservas e disponível" },
    { prompt: "Quais pedidos estão em andamento?", hint: "etapa de cada um" },
    { prompt: "Quais itens estão zerados?", hint: "para repor ou arquivar" },
  ]) {
    if (list.length >= limit) break;
    list.push(fallback);
  }
  return list.slice(0, limit);
}

// ------------------------------------------------------------- atalhos

export const AGENT_PATH = "/portal/agente";
/** A mesma tela do agente para a equipe Dutelog (todos os papéis internos). */
export const TEAM_AGENT_PATH = "/agente";

export function agentPathFor(role: unknown) {
  return role === "cliente" ? AGENT_PATH : TEAM_AGENT_PATH;
}

export function isAgentScreen(location: string) {
  return location === AGENT_PATH || location === TEAM_AGENT_PATH;
}

/**
 * Sugestões da tela do agente para a equipe, pelo papel. Cada uma usa uma
 * consulta que o papel tem (agentToolsForRole, no backend): o WMS não recebe
 * sugestão de valores; a prévia do mês é de quem lê faturamento.
 */
export function teamSuggestions(role: unknown): Suggestion[] {
  if (role === "wms") {
    return [
      { prompt: "Quais tarefas de separação e guarda estão abertas?", hint: "tarefas do armazém" },
      { prompt: "O que está para chegar ou em conferência?", hint: "recebimentos" },
      { prompt: "Em que endereços está o item CAM-01?", hint: "troque pelo código que procura" },
      { prompt: "Quais itens estão zerados?", hint: "para conferir no endereço" },
    ];
  }
  if (role === "financeiro") {
    return [
      { prompt: "Quanto está a prévia da fatura deste mês?", hint: "por serviço, até hoje" },
      { prompt: "Explique a última fatura emitida", hint: "serviços e valores" },
      { prompt: "Como os valores das faturas mudaram nos últimos meses?", hint: "comparação mês a mês" },
      { prompt: "Quantos pedidos foram entregues este mês?", hint: "base da expedição" },
    ];
  }
  return [
    { prompt: "Quais solicitações estão esperando aprovação?", hint: "fila, a mais antiga primeiro" },
    { prompt: "O que está para chegar ou em conferência?", hint: "recebimentos" },
    { prompt: "Quais tarefas do armazém estão atrasadas?", hint: "separação e guarda" },
    { prompt: "Quem aprovou o último pedido e quando?", hint: "histórico de eventos" },
  ];
}

/** Leva uma pergunta feita fora do chat (barra do Início) para o Agent Dute. */
export function agentAskHref(question: string, path = AGENT_PATH) {
  const trimmed = question.trim();
  return trimmed ? `${path}?q=${encodeURIComponent(trimmed.slice(0, 4000))}` : path;
}

/**
 * A tecla "/" abre o Agent Dute, a não ser que a pessoa esteja digitando ou
 * use a tecla com Ctrl, Alt ou Cmd.
 */
export function isAgentShortcut(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}) {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return false;
  const tag = (event.target?.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
  return !event.target?.isContentEditable;
}
