/*
 * Na demo, o Agent Dute responde daqui: respostas roteirizadas a partir dos
 * dados fictícios, chegando aos pedaços como no sistema de verdade. O resto
 * do módulo original continua igual.
 */
import type { AgentDuteStreamChunk } from "../src/lib/functions-api";
import { customerRequests, demoFacts, saveConversationTurn } from "./data";
import { pick } from "./i18n/lang";
import { translate } from "./i18n/translator";

export * from "../src/lib/functions-api";

// Em inglês, o locale da demo troca pt-BR por en-US: R$ 1,234.56 e 1,234.
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
  const rows = (matches.length ? matches : demoFacts.catalog.filter((item) => item.cat === "Ícones TikTok" || item.cat === "Cenografia")).slice(0, 7);
  const lines = rows.map((item) => {
    const free = Math.max(0, item.qty - item.res);
    const status = item.qty === 0 ? pick(" · **zerado**", " · **out of stock**") : item.qty < item.min ? pick(" · abaixo do mínimo", " · below minimum") : "";
    return pick(
      `- **${demoFacts.fullName(item)}**: ${int(item.qty)} no galpão, ${int(free)} livres${status}`,
      `- **${demoFacts.fullName(item)}**: ${int(item.qty)} in the warehouse, ${int(free)} available${status}`,
    );
  });
  const intro = matches.length ? pick("Aqui está o saldo agora:", "Here's the stock right now:") : pick("Esses são os ícones e a cenografia guardados agora:", "These are the icons and set pieces in storage right now:");
  return `${intro}\n\n${lines.join("\n")}\n\n${pick("Quer que eu monte um pedido com algum desses itens?", "Want me to put together an order with any of these items?")}`;
}

function ordersAnswer() {
  const active = customerRequests().filter((item) => item.type === "retirada" && ["submitted", "approved"].includes(item.status));
  const label = (item: Record<string, any>) =>
    item.status === "submitted"
      ? pick("aguardando a confirmação da Dutelog", "waiting for Dutelog to confirm")
      : item.operational_status === "dispatched"
        ? pick("saiu para entrega", "out for delivery")
        : item.operational_status === "ready_to_dispatch"
          ? pick("pronto para sair", "ready to ship")
          : pick("em separação no galpão", "being picked in the warehouse");
  // Títulos do roteiro estão em português; em inglês passam pelo mesmo dicionário da tela.
  const lines = active.slice(0, 6).map((item) => `- **${item.request_number}** · ${pick(item.title, translate(item.title))}: ${label(item)}`);
  return pick(
    `Você tem **${active.length} pedidos em andamento**:\n\n${lines.join("\n")}\n\nO PED-0413 está com o motorista Edson e deve chegar na Vila Olímpia até as 14h.`,
    `You have **${active.length} orders in progress**:\n\n${lines.join("\n")}\n\nPED-0413 is with our driver Edson and should reach Vila Olímpia by 2 pm.`,
  );
}

function billingAnswer() {
  const [current, previous] = demoFacts.periods;
  return pick(
    `A fatura de outubro está aberta e soma **${brl(current.total)}** até agora. Ela fecha no dia 30 e é emitida no dia 1º.\n\nA de setembro foi de **${brl(previous.total)}**. O maior peso é a área de mobiliário, cobrada por m² ocupado no mês, seguida da montagem e desmontagem nos eventos.`,
    `The October invoice is open and comes to **${brl(current.total)}** so far. It closes on the 30th and is issued on the 1st.\n\nSeptember's was **${brl(previous.total)}**. The biggest share is furniture storage, charged per m² occupied in the month, followed by event setup and teardown.`,
  );
}

function inboundAnswer() {
  return pick(
    "Há **2 envios** chegando:\n\n- **Retorno do Rio2C**: 22 peças em conferência agora. Duas poltronas rosa voltaram com o tecido marcado e as fotos estão em Documentos.\n- **NF 7.731 · Gráfica Ideal**: 5.000 pacotes de adesivos, 4.000 folders e 50 caixas de som, previstos para quinta.\n\nPara avisar um envio novo, é só me mandar a nota fiscal aqui.",
    "There are **2 shipments** on the way in:\n\n- **Rio2C return**: 22 pieces being checked right now. Two pink armchairs came back with stained fabric and the photos are in Documents.\n- **Invoice 7.731 · Gráfica Ideal**: 5,000 sticker packs, 4,000 brochures and 50 speakers, expected Thursday.\n\nTo notify a new shipment, just send me the invoice here.",
  );
}

function kitsAnswer() {
  const free = new Map(demoFacts.catalog.map((item) => [demoFacts.code(item.n), Math.max(0, item.qty - item.res)]));
  const lines = demoFacts.kits().map((kit) => {
    const count = Math.min(...kit.items.map((item) => Math.floor((free.get(item.sku) ?? 0) / Math.max(1, item.quantity))));
    const limit = kit.items.reduce((worst, item) => ((free.get(item.sku) ?? 0) / item.quantity < (free.get(worst.sku) ?? 0) / worst.quantity ? item : worst), kit.items[0]);
    return pick(
      `- **${kit.name}**: dá para montar **${int(count)}** agora. Quem limita é ${limit.name.toLowerCase()}.`,
      `- **${kit.name}**: you can build **${int(count)}** right now. The limiting item is the ${limit.name.toLowerCase()}.`,
    );
  });
  return pick(
    `Com o estoque livre de hoje:\n\n${lines.join("\n")}\n\nPara enviar, abra o kit em **Kits**, clique em Usar no pedido e escolha os destinatários na agenda. Cada um vira um pedido com entrega própria.`,
    `With today's available stock:\n\n${lines.join("\n")}\n\nTo send one, open the kit in **Kits**, click Use in order and pick the recipients from the address book. Each one becomes an order with its own delivery.`,
  );
}

function eventsAnswer() {
  const free = new Map(demoFacts.catalog.map((item) => [demoFacts.code(item.n), Math.max(0, item.qty - item.res)]));
  const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "");
  const lines = demoFacts.events().map((event) => {
    const short = event.items.filter((item) => (free.get(item.sku) ?? 0) < item.quantity);
    const pieces = event.items.reduce((sum, item) => sum + item.quantity, 0);
    const status = short.length
      ? pick(`falta ${short.map((item) => item.name.toLowerCase()).join(", ")}`, `short on ${short.map((item) => item.name.toLowerCase()).join(", ")}`)
      : pick("tudo disponível hoje", "everything available today");
    return pick(
      `- **${event.name}** (${date(event.next_date)}, ${event.venue}): ${int(event.items.length)} itens e ${int(pieces)} peças, ${status}.`,
      `- **${event.name}** (${date(event.next_date)}, ${event.venue}): ${int(event.items.length)} items and ${int(pieces)} pieces, ${status}.`,
    );
  });
  return pick(
    `Seus eventos modelo:\n\n${lines.join("\n")}\n\nO ícone gigante tem 2 unidades e 1 já está reservada para a ativação na Paulista; se o Live Fest e a Game XP caírem na mesma semana, só um leva o ícone. Para pedir, abra o evento em **Eventos** e clique em Usar no pedido: local, data e montagem já vêm preenchidos, e a Dutelog traz tudo de volta e confere peça a peça.`,
    `Your event templates:\n\n${lines.join("\n")}\n\nThe giant icon has 2 units and 1 is already reserved for the Paulista activation; if Live Fest and Game XP fall in the same week, only one gets the icon. To order, open the event in **Events** and click Use in order: venue, date and setup come filled in, and Dutelog brings everything back and checks it piece by piece.`,
  );
}

function defaultAnswer() {
  return pick(
    `Posso ajudar com o estoque, os pedidos, os envios para a Dutelog e as faturas. Hoje a conta tem **${demoFacts.catalog.length} itens** e **${int(demoFacts.totalPieces)} peças** guardadas, com valor de **${brl(demoFacts.totalCost)}**.\n\nExperimente perguntar \"quantos pufes temos livres?\" ou \"como estão meus pedidos?\".`,
    `I can help with stock, orders, shipments to Dutelog and invoices. Today the account has **${demoFacts.catalog.length} items** and **${int(demoFacts.totalPieces)} pieces** in storage, worth **${brl(demoFacts.totalCost)}**.\n\nTry asking \"how many poufs do we have available?\" or \"how are my orders doing?\".`,
  );
}

function answerFor(question: string): { tools: string[]; text: string } {
  const q = question.toLowerCase();
  // Palavras em português e em inglês: a demo responde no idioma escolhido na entrada.
  if (/(live fest|shop day|game xp|eventos?\b.*(modelo|próxim|proxim)|(modelo|próxim|proxim).*eventos?\b|events?\b.*(template|next|upcoming)|(template|next|upcoming).*events?\b|^eventos?\??$|^events?\??$|meus eventos|my events)/.test(q)) return { tools: ["eventos_modelo", "resumo_estoque"], text: eventsAnswer() };
  if (/\bkits?\b|influenc|creators?\b/.test(q)) return { tools: ["buscar_itens", "resumo_estoque"], text: kitsAnswer() };
  if (/(fatur|cobran|custo|preç|preco|pagar|valor|invoice|bill|cost|price|\bpay|charge|\bfees?\b)/.test(q)) return { tools: ["faturas", "tabela_precos"], text: billingAnswer() };
  if (/(pedido|entreg|evento|separa|rota|chega|order|deliver|event|picking|route|arriv)/.test(q) && !/(nota|nf|envio|recebimento|retorno|shipment|inbound|receiv|return|incoming)/.test(q)) return { tools: ["listar_pedidos"], text: ordersAnswer() };
  if (/(envio|recebimento|retorno|nota|\bnf\b|chegando|shipment|inbound|receiv|return|incoming)/.test(q)) return { tools: ["recebimentos"], text: inboundAnswer() };
  if (/(estoque|saldo|quant|tem|temos|livre|dispon|sofá|sofa|poltron|pufe|mesa|banner|backdrop|totem|kit|brinde|moletom|ring|stock|inventory|how many|available|armchair|chair|pouf|table|stool|hoodie|cap|bottle|tote|sticker|speaker|microphone|light|[íi]cone|icon|cubo|cube|mala|suitcase|cabine|booth|p[óo]rtico|arch|palco|stage|celular|phone|caneta|pen\b|caderno|notebook|copo|tumbler|power bank|chaveiro|keychain|brinde|giveaway)/.test(q)) return { tools: ["resumo_estoque"], text: stockAnswer(question) };
  return { tools: [], text: defaultAnswer() };
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error(pick("Conversa interrompida.", "Conversation stopped.")));
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
