import { describe, expect, it } from "vitest";

import {
  agentAskHref,
  agentPathFor,
  isAgentScreen,
  teamSuggestions,
  daySuggestions,
  isAgentShortcut,
  filterConversations,
  groupConversations,
  parseInline,
  parseMarkdown,
  settleStreamingMarkdown,
  toolLabel,
  uniqueTools,
} from "./agent-chat";

describe("Markdown das respostas", () => {
  it("negrito, itálico e código; asterisco solto fica como texto", () => {
    expect(parseInline('Você tem **412 polos** e *"Pedido do estoque"* com `A.01`')).toEqual([
      { kind: "text", text: "Você tem " },
      { kind: "bold", text: "412 polos" },
      { kind: "text", text: " e " },
      { kind: "italic", text: '"Pedido do estoque"' },
      { kind: "text", text: " com " },
      { kind: "code", text: "A.01" },
    ]);
    expect(parseInline("2 * 3 = 6")).toEqual([{ kind: "text", text: "2 * 3 = 6" }]);
  });

  it("parágrafos, título, listas e linha", () => {
    const blocks = parseMarkdown("## Saldo\nPrimeira linha\ncontinua\n\n- um\n- **dois**\n\n1. a\n2. b\n\n---\nfim");
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "list", "list", "rule", "paragraph"]);
    expect(blocks[1]).toEqual({ kind: "paragraph", content: [{ kind: "text", text: "Primeira linha continua" }] });
    expect(blocks[2]).toMatchObject({ kind: "list", ordered: false, items: [[{ text: "um" }], [{ kind: "bold", text: "dois" }]] });
    expect(blocks[3]).toMatchObject({ kind: "list", ordered: true });
  });

  it("tabela com números alinhados à direita", () => {
    const [table] = parseMarkdown("| Tamanho | Disponível |\n|---|---:|\n| P | 96 |\n| GG | **18** |");
    expect(table).toMatchObject({ kind: "table", align: ["left", "right"] });
    if (table.kind !== "table") throw new Error("esperava tabela");
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1][1]).toEqual([{ kind: "bold", text: "18" }]);
  });
});

describe("texto chegando", () => {
  it("esconde o ** que ainda não fechou", () => {
    expect(settleStreamingMarkdown("o **GG ac")).toBe("o GG ac");
    expect(settleStreamingMarkdown("o **GG** acaba")).toBe("o **GG** acaba");
  });
});

describe("consultas feitas", () => {
  it("rótulo em português e sem repetição", () => {
    expect(toolLabel("buscar_itens")).toBe("Buscou itens no estoque");
    expect(toolLabel("listar_pedidos", true)).toBe("Consultando os pedidos");
    expect(toolLabel("desconhecida")).toBe("Consultou os dados");
    expect(toolLabel("tarefas_armazem", true)).toBe("Consultando as tarefas do armazém");
    expect(toolLabel("previa_faturamento")).toBe("Calculou a prévia da fatura");
    expect(uniqueTools(["buscar_itens", "movimentacoes", "buscar_itens"])).toEqual(["buscar_itens", "movimentacoes"]);
  });
});

describe("lista de conversas", () => {
  const now = new Date("2026-10-01T15:00:00Z"); // 12:00 em São Paulo
  const list = [
    { id: "a", title: "Polo piquet: saldo", last_message_at: "2026-10-01T04:00:00Z" }, // 01:00 SP, hoje
    { id: "b", title: "Fatura de agosto", last_message_at: "2026-10-01T02:00:00Z" }, // 23:00 SP, ontem
    { id: "c", title: "Kits outubro", last_message_at: "2026-09-27T12:00:00Z" },
    { id: "d", title: "Antiga", last_message_at: "2026-07-01T12:00:00Z" },
  ];

  it("agrupa pelo dia de São Paulo", () => {
    expect(groupConversations(list, now).map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ["Hoje", ["a"]],
      ["Ontem", ["b"]],
      ["Últimos 7 dias", ["c"]],
      ["Mais antigas", ["d"]],
    ]);
  });

  it("busca sem acento", () => {
    expect(filterConversations(list, "polo").map((item) => item.id)).toEqual(["a"]);
    expect(filterConversations(list, "FATURA agosto").map((item) => item.id)).toEqual(["b"]);
    expect(filterConversations(list, "")).toHaveLength(4);
  });
});

describe("sugestões do dia", () => {
  it("usa o pedido em andamento, o mínimo e a fatura", () => {
    const suggestions = daySuggestions(
      {
        activeOrder: { title: "Abastecimento loja Faria Lima", stage: "Separando" },
        belowMinimum: 4,
        lastInvoice: { label: "Agosto/2026", detail: "emitida" },
      },
      new Date("2026-10-01T15:00:00Z"),
    );
    expect(suggestions.map((item) => item.prompt)).toEqual([
      "Onde está o pedido Abastecimento loja Faria Lima?",
      "O que está abaixo do estoque mínimo?",
      "Quanto saiu de cada item em setembro?",
      "Explique a fatura de agosto/2026",
    ]);
    expect(suggestions[1].hint).toBe("4 itens hoje");
  });

  it("sem dados do dia, completa com perguntas gerais", () => {
    const suggestions = daySuggestions({ belowMinimum: 0 }, new Date("2026-10-01T15:00:00Z"));
    expect(suggestions).toHaveLength(4);
    expect(suggestions[1].prompt).toBe("Qual é o resumo do meu estoque hoje?");
  });
});

describe("atalhos para o Agent Dute", () => {
  it("leva a pergunta da barra do Início", () => {
    expect(agentAskHref("  onde está meu pedido?  ")).toBe("/portal/agente?q=onde%20est%C3%A1%20meu%20pedido%3F");
    expect(agentAskHref("   ")).toBe("/portal/agente");
  });

  it("'/' abre o agente, menos quando a pessoa está digitando", () => {
    expect(isAgentShortcut({ key: "/", target: { tagName: "BODY" } })).toBe(true);
    expect(isAgentShortcut({ key: "/", target: { tagName: "INPUT" } })).toBe(false);
    expect(isAgentShortcut({ key: "/", target: { tagName: "TEXTAREA" } })).toBe(false);
    expect(isAgentShortcut({ key: "/", target: { tagName: "DIV", isContentEditable: true } })).toBe(false);
    expect(isAgentShortcut({ key: "/", ctrlKey: true, target: { tagName: "BODY" } })).toBe(false);
    expect(isAgentShortcut({ key: "a", target: { tagName: "BODY" } })).toBe(false);
  });
});

describe("agente para todos os papéis", () => {
  it("cliente no portal, equipe em /agente", () => {
    expect(agentPathFor("cliente")).toBe("/portal/agente");
    expect(agentPathFor("wms")).toBe("/agente");
    expect(agentPathFor("financeiro")).toBe("/agente");
    expect(isAgentScreen("/agente")).toBe(true);
    expect(isAgentScreen("/portal/agente")).toBe(true);
    expect(isAgentScreen("/agente/painel")).toBe(false);
    expect(agentAskHref("Quanto saiu?", "/agente")).toBe("/agente?q=Quanto%20saiu%3F");
  });

  it("sugestões por papel; WMS sem valores", () => {
    for (const role of ["owner", "admin", "interno", "suporte", "wms", "financeiro"]) {
      expect(teamSuggestions(role)).toHaveLength(4);
    }
    expect(teamSuggestions("wms").some((item) => /fatura|valor|R\$/i.test(item.prompt))).toBe(false);
    expect(teamSuggestions("financeiro")[0]?.prompt).toMatch(/prévia/);
    expect(teamSuggestions("wms").some((item) => /prévia|fatura/i.test(item.prompt))).toBe(false);
    expect(teamSuggestions("interno")[0]?.prompt).toMatch(/aprovação/);
  });
});
