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

/**
 * O que cada consulta do Agent Dute diz na trilha (carregamento v2, momento
 * 9) e no "De onde tirei" da resposta (invariante 3: a IA mostra de onde
 * tirou). As ferramentas são as do agente do WMS (functions/wms,
 * AGENT_TOOL_NAMES) e as do núcleo (functions/core, FERRAMENTAS_DO_AGENTE).
 *
 * - `vez`: a linha da vez, no gerúndio e com a reticência de um caractere
 *   ("Consultando o estoque…").
 * - `feita`: a linha feita, o nome curto do que leu ("Estoque").
 * - `objeto`: o que leu, com o artigo, para a trilha recolhida ("Leu o
 *   estoque e o razão de movimentos").
 * - `fonte`: o chip do "De onde tirei". Só o que é leitura tem fonte: o
 *   rascunho, a rotina e a anotação são propostas do agente, não de onde ele
 *   tirou a resposta.
 */
export type ConsultaNaTrilha = { vez: string; feita: string; objeto: string | null; fonte: string | null };

function leitura(vez: string, feita: string, objeto: string): ConsultaNaTrilha {
  return { vez, feita, objeto, fonte: feita };
}

function proposta(vez: string, feita: string): ConsultaNaTrilha {
  return { vez, feita, objeto: null, fonte: null };
}

const CONSULTAS: Record<string, ConsultaNaTrilha> = {
  // Armazenagem (WMS e núcleo).
  resumo_estoque: leitura("Consultando o estoque…", "Estoque", "o estoque"),
  buscar_itens: leitura("Buscando itens no estoque…", "Itens do estoque", "os itens do estoque"),
  listar_pedidos: leitura("Consultando os pedidos…", "Pedidos", "os pedidos"),
  ver_pedido: leitura("Abrindo o pedido…", "Pedido", "o pedido"),
  movimentacoes: leitura("Consultando o razão de movimentos…", "Razão de movimentos", "o razão de movimentos"),
  documentos: leitura("Consultando os documentos…", "Documentos", "os documentos"),
  itens_parados: leitura("Consultando os itens parados…", "Itens parados", "os itens parados"),
  recebimentos: leitura("Consultando as chegadas…", "Chegadas", "as chegadas"),
  tarefas_armazem: leitura("Consultando as tarefas do armazém…", "Tarefas do armazém", "as tarefas do armazém"),
  enderecos: leitura("Consultando os endereços…", "Endereços", "os endereços"),
  fila_solicitacoes: leitura("Consultando a fila de solicitações…", "Fila de solicitações", "a fila de solicitações"),
  eventos: leitura("Consultando o histórico…", "Histórico", "o histórico"),
  previa_faturamento: leitura("Calculando a prévia da fatura…", "Prévia da fatura", "a prévia da fatura"),
  // Financeiro.
  faturas: leitura("Consultando as faturas…", "Faturas", "as faturas"),
  a_receber: leitura("Consultando o a receber…", "A receber", "o a receber"),
  // Operação.
  demandas: leitura("Consultando as demandas…", "Demandas", "as demandas"),
  ver_demanda: leitura("Abrindo a demanda…", "Demanda", "a demanda"),
  agenda: leitura("Consultando a agenda…", "Agenda", "a agenda"),
  ver_os: leitura("Abrindo a OS…", "OS", "a OS"),
  tempo_dos_itens: leitura("Consultando o tempo dos itens…", "Tempo dos itens", "o tempo dos itens"),
  // Comercial.
  orcamentos: leitura("Consultando os orçamentos…", "Orçamentos", "os orçamentos"),
  ver_orcamento: leitura("Abrindo o orçamento…", "Orçamento", "o orçamento"),
  lpu: leitura("Consultando a tabela de preços…", "Tabela de preços", "a tabela de preços"),
  orcamentos_parecidos: leitura("Procurando orçamentos parecidos…", "Orçamentos parecidos", "os orçamentos parecidos"),
  // Comuns a todos.
  conversas_anteriores: leitura("Procurando nas conversas anteriores…", "Conversas anteriores", "as conversas anteriores"),
  consultar_playbook: leitura("Abrindo o playbook…", "Playbook da coordenação", "o playbook da coordenação"),
  sugerir_anotacao: proposta("Sugerindo uma anotação…", "Anotação sugerida"),
  sugerir_rotina: proposta("Montando a rotina…", "Rotina proposta"),
  rascunho_pedido: proposta("Montando o pedido…", "Pedido montado"),
  rascunho_envio: proposta("Montando o rascunho do aviso…", "Rascunho do aviso"),
};

/** A consulta que a tela ainda não conhece: o servidor ganhou uma ferramenta nova. */
const CONSULTA_DESCONHECIDA = leitura("Consultando os dados…", "Dados", "os dados");

/** O que a consulta `nome` (o nome da ferramenta, como o stream manda) diz na trilha e nas fontes. */
export function consultaDoAgente(nome: string): ConsultaNaTrilha {
  return Object.hasOwn(CONSULTAS, nome) ? CONSULTAS[nome] : CONSULTA_DESCONHECIDA;
}

/** Os chips do "De onde tirei", na ordem das consultas e sem repetir. */
export function fontesDaResposta(nomes: readonly string[] | null | undefined): string[] {
  return [...new Set(uniqueTools(nomes).flatMap((nome) => consultaDoAgente(nome).fonte ?? []))];
}

/** "o estoque", "o estoque e os pedidos", "o estoque, os pedidos e as chegadas". */
function emSerie(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * A trilha recolhida numa linha, quando o texto começa: "Leu o estoque e o
 * razão de movimentos". Até três leituras pelo nome; daí em diante, as duas
 * primeiras e "mais N". Sem leitura (só propostas, ou nenhuma consulta),
 * nulo: a trilha some.
 */
export function resumoDaTrilha(nomes: readonly string[] | null | undefined): string | null {
  const objetos = [...new Set(uniqueTools(nomes).flatMap((nome) => consultaDoAgente(nome).objeto ?? []))];
  if (!objetos.length) return null;
  if (objetos.length <= 3) return `Leu ${emSerie(objetos)}`;
  return `Leu ${objetos.slice(0, 2).join(", ")} e mais ${objetos.length - 2}`;
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
  /** Conversa onde chegam as respostas de uma rotina. */
  routine_id?: string;
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

export type AgentView = "chat" | "rotinas" | "whatsapp";

/** Tela do Agent Dute pela busca da URL: ?v=rotinas, ?v=whatsapp ou a conversa. */
export function agentView(search: string): AgentView {
  const view = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("v");
  return view === "rotinas" || view === "whatsapp" ? view : "chat";
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
