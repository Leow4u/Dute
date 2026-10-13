/*
 * Na demo, o Agent Dute responde daqui: respostas roteirizadas a partir dos
 * dados fictícios, chegando aos pedaços como no sistema de verdade. O resto
 * do módulo original continua igual.
 */
import type { AgentDuteStreamChunk } from "../src/lib/functions-api";
import { customerRequests, demoFacts, saveConversationTurn } from "./data";

export * from "../src/lib/functions-api";

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const int = (value: number) => value.toLocaleString("pt-BR");

function stockAnswer(question: string) {
  const words = question
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);
  const plain = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const matches = demoFacts.catalog.filter((item) => words.some((word) => plain(item.name).includes(word.replace(/s$/, ""))));
  const rows = (matches.length ? matches : demoFacts.catalog.filter((item) => item.cat === "Mobiliário")).slice(0, 6);
  const lines = rows.map((item) => {
    const free = Math.max(0, item.qty - item.res);
    const status = item.qty === 0 ? " · **zerado**" : item.qty < item.min ? " · abaixo do mínimo" : "";
    return `- **${demoFacts.fullName(item)}**: ${int(item.qty)} no galpão, ${int(free)} livres${status}`;
  });
  const intro = matches.length ? "Aqui está o saldo agora:" : "Esse é o mobiliário guardado agora:";
  return `${intro}\n\n${lines.join("\n")}\n\nQuer que eu monte um pedido com algum desses itens?`;
}

function ordersAnswer() {
  const active = customerRequests().filter((item) => item.type === "retirada" && ["submitted", "approved"].includes(item.status));
  const label = (item: Record<string, any>) =>
    item.status === "submitted"
      ? "aguardando a confirmação da Dutelog"
      : item.operational_status === "dispatched"
        ? "saiu para entrega"
        : item.operational_status === "ready_to_dispatch"
          ? "pronto para sair"
          : "em separação no galpão";
  const lines = active.slice(0, 6).map((item) => `- **${item.request_number}** · ${item.title}: ${label(item)}`);
  return `Você tem **${active.length} pedidos em andamento**:\n\n${lines.join("\n")}\n\nO PED-0413 está com o motorista Edson e deve chegar na Vila Olímpia até as 14h.`;
}

function billingAnswer() {
  const [current, previous] = demoFacts.periods;
  return `A fatura de outubro está aberta e soma **${brl(current.total)}** até agora. Ela fecha no dia 30 e é emitida no dia 1º.\n\nA de setembro foi de **${brl(previous.total)}**. O maior peso é a área de mobiliário, cobrada por m² ocupado no mês, seguida da montagem e desmontagem nos eventos.`;
}

function inboundAnswer() {
  return "Há **2 envios** chegando:\n\n- **Retorno do Rio2C**: 22 peças em conferência agora. Duas poltronas rosa voltaram com o tecido marcado e as fotos estão em Documentos.\n- **NF 7.731 · Gráfica Ideal**: 5.000 pacotes de adesivos, 4.000 folders e 50 caixas de som, previstos para quinta.\n\nPara avisar um envio novo, é só me mandar a nota fiscal aqui.";
}

function kitsAnswer() {
  const free = new Map(demoFacts.catalog.map((item) => [demoFacts.code(item.n), Math.max(0, item.qty - item.res)]));
  const lines = demoFacts.kits().map((kit) => {
    const count = Math.min(...kit.items.map((item) => Math.floor((free.get(item.sku) ?? 0) / Math.max(1, item.quantity))));
    const limit = kit.items.reduce((worst, item) => ((free.get(item.sku) ?? 0) / item.quantity < (free.get(worst.sku) ?? 0) / worst.quantity ? item : worst), kit.items[0]);
    return `- **${kit.name}**: dá para montar **${int(count)}** agora. Quem limita é ${limit.name.toLowerCase()}.`;
  });
  return `Com o estoque livre de hoje:\n\n${lines.join("\n")}\n\nPara enviar, abra o kit em **Kits**, clique em Usar no pedido e escolha os destinatários na agenda. Cada um vira um pedido com entrega própria.`;
}

function defaultAnswer() {
  return `Posso ajudar com o estoque, os pedidos, os envios para a Dutelog e as faturas. Hoje a conta tem **${demoFacts.catalog.length} itens** e **${int(demoFacts.totalPieces)} peças** guardadas, com valor de **${brl(demoFacts.totalCost)}**.\n\nExperimente perguntar \"quantos pufes temos livres?\" ou \"como estão meus pedidos?\".`;
}

function answerFor(question: string): { tools: string[]; text: string } {
  const q = question.toLowerCase();
  if (/\bkits?\b|influenc|creators?\b/.test(q)) return { tools: ["buscar_itens", "resumo_estoque"], text: kitsAnswer() };
  if (/(fatur|cobran|custo|preç|preco|pagar|valor)/.test(q)) return { tools: ["faturas", "tabela_precos"], text: billingAnswer() };
  if (/(pedido|entreg|evento|separa|rota|chega)/.test(q) && !/(nota|nf|envio|recebimento|retorno)/.test(q)) return { tools: ["listar_pedidos"], text: ordersAnswer() };
  if (/(envio|recebimento|retorno|nota|\bnf\b|chegando)/.test(q)) return { tools: ["recebimentos"], text: inboundAnswer() };
  if (/(estoque|saldo|quant|tem|temos|livre|dispon|sofá|sofa|poltron|pufe|mesa|banner|backdrop|totem|kit|brinde|moletom|ring)/.test(q)) return { tools: ["resumo_estoque"], text: stockAnswer(question) };
  return { tools: [], text: defaultAnswer() };
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Conversa interrompida."));
    });
  });

export async function streamAgentDuteChat<T>(
  payload: { message: string; conversation_id?: string },
  onChunk: (chunk: AgentDuteStreamChunk) => void,
  signal?: AbortSignal,
): Promise<T> {
  const id = payload.conversation_id || `conv_demo_${Date.now()}`;
  const { tools, text } = answerFor(payload.message);
  for (const tool of tools) {
    onChunk({ type: "tool", name: tool });
    await wait(650, signal);
  }
  const pieces = text.match(/\S+\s*/g) ?? [text];
  for (let i = 0; i < pieces.length; i += 3) {
    onChunk({ type: "text", index: 0, text: pieces.slice(i, i + 3).join("") });
    await wait(45, signal);
  }
  const now = new Date().toISOString();
  const messages = [
    { id: `${id}_u_${Date.now()}`, role: "user", content: payload.message, created_at: now },
    { id: `${id}_a_${Date.now()}`, role: "assistant", content: text, created_at: now, tools_used: tools },
  ];
  saveConversationTurn(id, payload.message, messages);
  return { conversation: { id, status: "open", last_message_at: now }, messages } as T;
}
