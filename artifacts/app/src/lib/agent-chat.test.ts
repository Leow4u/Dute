import { describe, expect, it } from "vitest";

import {
  agentView,
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
  consultaDoAgente,
  fontesDaResposta,
  resumoDaTrilha,
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

describe("as consultas na trilha e nas fontes (carregamento v2, momento 9)", () => {
  it("a da vez no gerúndio com a reticência de um caractere; a feita pelo nome do que leu", () => {
    expect(consultaDoAgente("resumo_estoque")).toEqual({ vez: "Consultando o estoque…", feita: "Estoque", objeto: "o estoque", fonte: "Estoque" });
    expect(consultaDoAgente("movimentacoes")).toEqual({
      vez: "Consultando o razão de movimentos…",
      feita: "Razão de movimentos",
      objeto: "o razão de movimentos",
      fonte: "Razão de movimentos",
    });
    expect(consultaDoAgente("listar_pedidos").vez).toBe("Consultando os pedidos…");
    expect(consultaDoAgente("recebimentos").feita).toBe("Chegadas");
    expect(consultaDoAgente("tarefas_armazem").vez).toBe("Consultando as tarefas do armazém…");
    expect(consultaDoAgente("previa_faturamento").vez).toBe("Calculando a prévia da fatura…");
    expect(consultaDoAgente("conversas_anteriores").feita).toBe("Conversas anteriores");
    expect(consultaDoAgente("desconhecida")).toEqual({ vez: "Consultando os dados…", feita: "Dados", objeto: "os dados", fonte: "Dados" });
    // O nome que é de Object não vira consulta.
    expect(consultaDoAgente("toString").feita).toBe("Dados");
    expect(uniqueTools(["buscar_itens", "movimentacoes", "buscar_itens"])).toEqual(["buscar_itens", "movimentacoes"]);
  });

  it("toda ferramenta dos dois agentes tem rótulo próprio, com a reticência de um caractere e sem os três pontos", () => {
    const ferramentas = [
      // functions/wms/src/domain/agent-dute.ts (AGENT_TOOL_NAMES)
      "resumo_estoque", "buscar_itens", "listar_pedidos", "ver_pedido", "movimentacoes", "faturas", "documentos",
      "conversas_anteriores", "sugerir_anotacao", "sugerir_rotina", "consultar_playbook", "rascunho_pedido", "rascunho_envio",
      "fila_solicitacoes", "recebimentos", "tarefas_armazem", "enderecos", "eventos", "previa_faturamento",
      // functions/core/src/domain/agente-*.ts (FERRAMENTAS_DO_AGENTE)
      "itens_parados", "demandas", "ver_demanda", "agenda", "ver_os", "tempo_dos_itens",
      "orcamentos", "ver_orcamento", "lpu", "orcamentos_parecidos", "a_receber",
    ];
    for (const nome of ferramentas) {
      const consulta = consultaDoAgente(nome);
      expect(consulta.feita, nome).not.toBe("Dados");
      expect(consulta.vez, nome).toMatch(/^\S.*[^.]…$/);
      expect(consulta.vez, nome).not.toContain("...");
      expect(consulta.feita, nome).not.toMatch(/…|\.\.\./);
    }
  });

  it("De onde tirei: só as leituras, na ordem e sem repetir; o rascunho e a rotina não são fonte", () => {
    expect(fontesDaResposta(["resumo_estoque", "movimentacoes", "resumo_estoque"])).toEqual(["Estoque", "Razão de movimentos"]);
    expect(fontesDaResposta(["buscar_itens", "rascunho_pedido", "sugerir_rotina", "sugerir_anotacao", "rascunho_envio"])).toEqual(["Itens do estoque"]);
    expect(fontesDaResposta(["rascunho_pedido"])).toEqual([]);
    expect(fontesDaResposta(undefined)).toEqual([]);
  });

  it("a trilha recolhida numa linha diz o que leu", () => {
    expect(resumoDaTrilha(["resumo_estoque"])).toBe("Leu o estoque");
    expect(resumoDaTrilha(["resumo_estoque", "movimentacoes"])).toBe("Leu o estoque e o razão de movimentos");
    expect(resumoDaTrilha(["resumo_estoque", "listar_pedidos", "recebimentos"])).toBe("Leu o estoque, os pedidos e as chegadas");
    expect(resumoDaTrilha(["resumo_estoque", "movimentacoes", "listar_pedidos", "recebimentos", "itens_parados"])).toBe(
      "Leu o estoque, o razão de movimentos e mais 3 fontes",
    );
    expect(resumoDaTrilha(["rascunho_pedido"])).toBeNull();
    expect(resumoDaTrilha([])).toBeNull();
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

describe("telas do Agent Dute", () => {
  it("?v= escolhe Rotinas ou WhatsApp; o resto é a conversa", () => {
    expect(agentView("?v=rotinas")).toBe("rotinas");
    expect(agentView("v=whatsapp")).toBe("whatsapp");
    expect(agentView("?c=abc")).toBe("chat");
    expect(agentView("?v=outra")).toBe("chat");
    expect(agentView("")).toBe("chat");
  });
});
