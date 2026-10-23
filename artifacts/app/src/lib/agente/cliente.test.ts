import { beforeEach, describe, expect, it, vi } from "vitest";

const chamadas = vi.hoisted(() => ({ nucleo: [] as Array<[string, Record<string, unknown>]>, wms: [] as Array<[string, RequestInit | undefined]> }));

vi.mock("../memoria/api", () => ({
  chamarNucleo: vi.fn(async (nome: string, dados: Record<string, unknown>) => {
    chamadas.nucleo.push([nome, dados]);
    if (nome.startsWith("list")) return { items: [{ id: "x" }] };
    if (nome === "seedDutePlaybooks") return { created: 7 };
    if (nome === "runDuteRoutineNow") return { id: dados.id, conversation_id: `routine_${String(dados.id)}` };
    return { id: "pb_novo123" };
  }),
}));

vi.mock("@/components/agent/chat", () => ({
  fetchChatJson: vi.fn(async (url: string, init?: RequestInit) => {
    chamadas.wms.push([url, init]);
    return {};
  }),
}));

import { CLIENTE_DO_WMS, chaveNoAlvo, clienteDoNucleo, conversasDoModulo, mensagensDaConversa } from "./cliente";

/**
 * O cliente do Agent Dute no app (parte 5.5i): o do WMS segue os caminhos de
 * antes; o do núcleo leva o cliente e o módulo da conversa a cada callable, e
 * a rotina alterada fica no módulo dela.
 */

beforeEach(() => {
  chamadas.nucleo.length = 0;
  chamadas.wms.length = 0;
});

describe("as conversas e as mensagens do núcleo", () => {
  it("só as do módulo, da mais recente; a de antes do núcleo é da Armazenagem", () => {
    const lidas = [
      { id: "a", title: "Estoque", last_message_at: "2026-10-23T10:00:00.000Z" },
      { id: "b", title: "Orçamento", modulo: "comercial", last_message_at: "2026-10-23T12:00:00.000Z" },
      { id: "c", title: "", modulo: "wms", last_message_at: "2026-10-23T11:00:00.000Z", routine_id: "rot_1" },
      { id: "d", title: "Sem data", modulo: "wms", last_message_at: "" },
    ];
    expect(conversasDoModulo(lidas, "wms")).toEqual([
      { id: "c", title: "Conversa", last_message_at: "2026-10-23T11:00:00.000Z", routine_id: "rot_1" },
      { id: "a", title: "Estoque", last_message_at: "2026-10-23T10:00:00.000Z" },
    ]);
    expect(conversasDoModulo(lidas, "comercial").map((conversa) => conversa.id)).toEqual(["b"]);
    expect(conversasDoModulo(lidas, "financeiro")).toEqual([]);
  });

  it("as mensagens em ordem, a pergunta antes da resposta no empate, sem a leitura da nota", () => {
    const mensagens = mensagensDaConversa([
      { id: "r", role: "assistant", content: "Feito.", created_at_iso: "2026-10-23T10:00:00.000Z", tools_used: ["resumo_estoque"], draft: { tipo: "anotacao", texto: "x" } },
      { id: "p", role: "user", content: "Oi", created_at_iso: "2026-10-23T10:00:00.000Z", context: "[Nota fiscal anexada…]", attachments: [{ file_name: "nf.pdf", storage_path: "operational-documents/ITAU/nf.pdf", file_url: "https://x" }] },
    ]);
    expect(mensagens.map((mensagem) => mensagem.id)).toEqual(["p", "r"]);
    expect(mensagens[0]).toEqual({ id: "p", role: "user", content: "Oi", created_at: "2026-10-23T10:00:00.000Z", source: null, tools_used: [], draft: undefined, draft_sent: undefined, attachments: [{ file_name: "nf.pdf", storage_path: "operational-documents/ITAU/nf.pdf" }] });
    expect("context" in mensagens[0]!).toBe(false);
    expect(mensagens[1]!.tools_used).toEqual(["resumo_estoque"]);
  });
});

describe("o agente do núcleo", () => {
  const agente = clienteDoNucleo("comercial", "ITAU");

  it("cada alvo tem o cache dele; o do WMS fica com as chaves de antes", () => {
    expect(chaveNoAlvo(agente, ["agent-dute-routines"])).toEqual(["nucleo", "comercial", "ITAU", "agent-dute-routines"]);
    expect(chaveNoAlvo(CLIENTE_DO_WMS, ["agent-dute-routines"])).toEqual(["agent-dute-routines"]);
  });

  it("as rotinas levam o cliente e o módulo; a alterada fica no módulo dela", async () => {
    expect(await agente.rotinas.listar()).toEqual({ routines: [{ id: "x" }] });
    await agente.rotinas.salvar({ name: "Saldo", prompt: "Quanto tenho?", frequency: "daily", time: "08:00", active: true });
    await agente.rotinas.salvar({ id: "rot_0123456789abcdef0123", modulo: "wms", name: "Saldo", prompt: "Quanto tenho?", frequency: "daily", time: "08:00", active: false });
    expect(await agente.rotinas.rodar("rot_0123456789abcdef0123")).toEqual({ id: "rot_0123456789abcdef0123", conversation_id: "routine_rot_0123456789abcdef0123" });
    await agente.rotinas.excluir("rot_0123456789abcdef0123");
    expect(chamadas.nucleo).toEqual([
      ["listDuteRoutines", { customer_code: "ITAU", modulo: "comercial" }],
      ["saveDuteRoutine", { name: "Saldo", prompt: "Quanto tenho?", frequency: "daily", time: "08:00", active: true, customer_code: "ITAU", modulo: "comercial" }],
      ["saveDuteRoutine", { id: "rot_0123456789abcdef0123", name: "Saldo", prompt: "Quanto tenho?", frequency: "daily", time: "08:00", active: false, customer_code: "ITAU", modulo: "wms" }],
      ["runDuteRoutineNow", { id: "rot_0123456789abcdef0123" }],
      ["deleteDuteRoutine", { id: "rot_0123456789abcdef0123" }],
    ]);
  });

  it("as anotações e os playbooks do cliente; a decisão só com o que foi preenchido; o cartão pela mensagem", async () => {
    expect(await agente.anotacoes.listar()).toEqual({ notes: [{ id: "x" }] });
    await agente.anotacoes.decidir("note_1", "approve", { text: "  ", visibility: "todos" });
    await agente.anotacoes.sugerir!("msg_agent_1");
    expect(await agente.playbooks.listar()).toEqual({ playbooks: [{ id: "x" }] });
    expect(await agente.playbooks.salvar({ title: "Devolução", when: "Quando devolve", steps: ["Abrir"], open_points: [], audience: "equipe" })).toEqual({ id: "pb_novo123" });
    await agente.playbooks.decidir("pb_novo123", "archive");
    expect(await agente.playbooks.carregar()).toEqual({ created: 7 });
    const [lista, decisao, sugestao, playbooks, salvo, decidido, carga] = chamadas.nucleo;
    expect(lista).toEqual(["listDuteNotes", { customer_code: "ITAU" }]);
    expect(decisao).toEqual(["decideDuteNote", { customer_code: "ITAU", id: "note_1", action: "approve", visibility: "todos" }]);
    expect(sugestao).toEqual(["suggestDuteNote", { agent_message_id: "msg_agent_1" }]);
    expect(playbooks).toEqual(["listDutePlaybooks", { customer_code: "ITAU" }]);
    expect(salvo![0]).toBe("saveDutePlaybook");
    expect(salvo![1]).toMatchObject({ customer_code: "ITAU", title: "Devolução", audience: "equipe" });
    expect(String(salvo![1].idempotency_key)).toMatch(/^[0-9a-f-]{36}$/);
    expect(decidido).toEqual(["decideDutePlaybook", { customer_code: "ITAU", id: "pb_novo123", action: "archive" }]);
    expect(carga).toEqual(["seedDutePlaybooks", { customer_code: "ITAU" }]);
  });
});

describe("o agente do WMS", () => {
  it("os caminhos de antes, sem o módulo da rotina, e sem cartão de anotação", async () => {
    await CLIENTE_DO_WMS.rotinas.salvar({ modulo: "wms", name: "Saldo", prompt: "Quanto tenho?", frequency: "daily", time: "08:00", active: true });
    await CLIENTE_DO_WMS.rotinas.rodar("rot_1");
    await CLIENTE_DO_WMS.anotacoes.decidir("note_1", "reject");
    expect(chamadas.wms.map(([url, init]) => [url, init?.body ? JSON.parse(String(init.body)) : undefined])).toEqual([
      ["/api/agent-dute/routines", { name: "Saldo", prompt: "Quanto tenho?", frequency: "daily", time: "08:00", active: true }],
      ["/api/agent-dute/routines/rot_1/run", {}],
      ["/api/agent-dute/notes/note_1/reject", {}],
    ]);
    expect(CLIENTE_DO_WMS.anotacoes.sugerir).toBeNull();
    expect(chamadas.nucleo).toEqual([]);
  });
});
