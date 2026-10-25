import { describe, expect, it } from "vitest";

import {
  cartFromDraft,
  draftFromOrderForm,
  draftHref,
  dueAtFromDraft,
  orderFormFromDraft,
  orderFormProblem,
  orderPayloadFromForm,
  parseDraft,
  parseDraftSent,
  saveDraft,
  shipmentFormFromDraft,
  shipmentFormProblem,
  shipmentPayloadFromForm,
  takeDraft,
  withLiveAvailability,
  type OrderDraft,
} from "./agent-draft";

const order = {
  tipo: "pedido",
  destino: "Loja Faria Lima",
  prazo: "2026-10-04",
  linhas: [
    { sku_code: "S1", codigo: "A.01.P", nome: "Polo P", quantidade: 20, disponivel: 30 },
    { sku_code: "S2", codigo: "A.01.GG", nome: "Polo GG", quantidade: 8, disponivel: 8 },
    { sku_code: "", codigo: "X", nome: "sem sku", quantidade: 1, disponivel: 1 },
  ],
  pendencias: [{ item: "caneca", motivo: "sem saldo disponível" }],
};

describe("rascunho do Agent Dute", () => {
  it("lê o rascunho de pedido e descarta linha sem SKU", () => {
    const draft = parseDraft(order) as OrderDraft;
    expect(draft.linhas.map((line) => line.sku_code)).toEqual(["S1", "S2"]);
    expect(draft.pendencias).toHaveLength(1);
    expect(draftHref(draft)).toBe("/portal/estoque?rascunho=1");
    expect(parseDraft({ tipo: "outro" })).toBeNull();
    expect(parseDraft(null)).toBeNull();
  });

  it("lê o aviso de envio", () => {
    const draft = parseDraft({
      tipo: "envio",
      fornecedor: "Uniformes",
      linhas: [
        { codigo: "A.01.P", nome: "Polo", quantidade: 120, situacao: "no_estoque" },
        { nome: "Boné", quantidade: 30, situacao: "codigo_a_definir" },
        { quantidade: 5 },
      ],
    });
    expect(draft?.tipo).toBe("envio");
    expect(draft?.linhas).toHaveLength(2);
    expect(draft && draftHref(draft)).toBe("/portal/recebimentos?rascunho=1");
  });

  it("guarda na aba e entrega uma vez, só para a tela do mesmo tipo", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    };
    saveDraft(parseDraft(order)!, storage);
    expect(takeDraft("envio", storage)).toBeNull();
    expect(takeDraft("pedido", storage)?.destino).toBe("Loja Faria Lima");
    expect(takeDraft("pedido", storage)).toBeNull();
  });

  it("monta o carrinho pelo SKU, sem passar do disponível", () => {
    const { cart, missing } = cartFromDraft(
      [
        { key: "S1::A.01.P", sku: "S1", available: 10 },
        { key: "S3::C", sku: "S3", available: 5 },
      ],
      parseDraft(order) as OrderDraft,
    );
    expect(cart).toEqual({ "S1::A.01.P": 10 });
    expect(missing).toEqual(["A.01.GG"]);
    expect(dueAtFromDraft("2026-10-04")).toBe("2026-10-04T12:00");
    expect(dueAtFromDraft("sexta")).toBe("");
    expect(dueAtFromDraft("2026-10-04", "11:00")).toBe("2026-10-04T11:00");
  });
});

describe("pedido enviado pelo cartão", () => {
  const draft = parseDraft({ ...order, hora: "11:00", observacoes: "falar com a recepção" }) as OrderDraft;

  it("o cartão começa com o que o agente montou", () => {
    const form = orderFormFromDraft(draft);
    expect(form).toMatchObject({ destino: "Loja Faria Lima", dia: "2026-10-04", hora: "11:00", nome: "", observacoes: "falar com a recepção" });
    expect(form.linhas.map((line) => [line.sku_code, line.quantidade])).toEqual([["S1", 20], ["S2", 8]]);
  });

  it("usa o saldo de agora quando a tela já tem o estoque", () => {
    const form = withLiveAvailability(orderFormFromDraft(draft), new Map([["S2", 5]]));
    expect(form.linhas.map((line) => line.disponivel)).toEqual([30, 5]);
    expect(withLiveAvailability(orderFormFromDraft(draft), null).linhas[1]!.disponivel).toBe(8);
  });

  it("diz o que falta antes de enviar", () => {
    const form = orderFormFromDraft(draft);
    const today = "2026-10-02";
    expect(orderFormProblem(form, today)).toBeNull();
    expect(orderFormProblem({ ...form, destino: " " }, today)).toBe("Diga onde entregar.");
    expect(orderFormProblem({ ...form, linhas: [] }, today)).toBe("Coloque ao menos um item.");
    expect(orderFormProblem({ ...form, dia: "2026-10-01" }, today)).toBe("A data já passou.");
    expect(orderFormProblem(withLiveAvailability(form, new Map([["S2", 5]])), today)).toBe("A.01.GG: só 5 disponíveis.");
  });

  it("monta o mesmo pedido do Estoque, ligado à mensagem", () => {
    const payload = orderPayloadFromForm({ ...orderFormFromDraft(draft), nome: "Abastecimento" }, "msg_1");
    expect(payload).toMatchObject({
      type: "retirada",
      title: "Abastecimento",
      destination: "Loja Faria Lima",
      description: "Pedido montado com o Agent Dute para Loja Faria Lima | falar com a recepção",
      due_at: "2026-10-04T14:00:00.000Z",
      agent_message_id: "msg_1",
    });
    expect(payload.items).toEqual([
      { sku_code: "S1", client_item_code: "A.01.P", product_name: "Polo P", quantity: 20 },
      { sku_code: "S2", client_item_code: "A.01.GG", product_name: "Polo GG", quantity: 8 },
    ]);
    const noTime = orderPayloadFromForm({ ...orderFormFromDraft(draft), hora: "" }, "msg_1");
    expect(noTime.due_at).toBe("2026-10-04T21:00:00.000Z");
    expect(orderPayloadFromForm({ ...orderFormFromDraft(draft), dia: "" }, "msg_1").due_at).toBeUndefined();
  });

  it("lê o envio gravado na mensagem e leva o que foi ajustado para o Estoque", () => {
    expect(parseDraftSent({ request_id: "creq_1", request_number: "PED-0045", sent_at: "x" })?.request_number).toBe("PED-0045");
    expect(parseDraftSent({})).toBeNull();
    const back = draftFromOrderForm({ ...orderFormFromDraft(draft), destino: "Prédio BTG" });
    expect(back).toMatchObject({ tipo: "pedido", destino: "Prédio BTG", prazo: "2026-10-04", hora: "11:00" });
  });
});

describe("aviso de envio enviado pelo cartão", () => {
  const nota = { file_name: "nf-2471.pdf", file_url: "https://x/nf.pdf", storage_path: "operational-documents/BTG/chat/nf.pdf", content_type: "application/pdf", size_bytes: 1200 };
  const draft = parseDraft({
    tipo: "envio",
    fornecedor: "Gráfica Alfa",
    nota_fiscal: "2471",
    chegada: "2026-10-10",
    linhas: [
      { sku_code: "S1", codigo: "A.01.P", nome: "Polo P", quantidade: 120, situacao: "no_estoque" },
      { codigo: "NOVO-1", nome: "Camiseta nova", quantidade: 50, situacao: "novo" },
      { nome: "Sacola kraft", quantidade: 300, situacao: "codigo_a_definir" },
    ],
    anexos: [nota, { file_name: "sem caminho" }],
  }) as Extract<ReturnType<typeof parseDraft>, { tipo: "envio" }>;

  it("lê a nota anexada e descarta anexo incompleto", () => {
    expect(draft.anexos).toEqual([nota]);
    expect(draft.linhas[0]!.sku_code).toBe("S1");
  });

  it("diz o que falta antes de enviar", () => {
    const form = shipmentFormFromDraft(draft);
    expect(shipmentFormProblem(form, "2026-10-02")).toBeNull();
    expect(shipmentFormProblem({ ...form, fornecedor: "" }, "2026-10-02")).toBe("Diga quem vai entregar (fornecedor).");
    expect(shipmentFormProblem({ ...form, chegada: "2026-10-01" }, "2026-10-02")).toBe("A data de chegada já passou.");
    expect(shipmentFormProblem({ ...form, linhas: [{ ...form.linhas[1]!, nome: "" }] }, "2026-10-02")).toBe("Item 1: produto novo, informe o nome.");
  });

  it("monta o mesmo aviso da tela Envios, com a nota e ligado à mensagem", () => {
    const payload = shipmentPayloadFromForm(shipmentFormFromDraft(draft), "msg_9");
    expect(payload).toMatchObject({
      type: "recebimento",
      title: "Envio de Gráfica Alfa",
      supplier: "Gráfica Alfa",
      invoice_number: "2471",
      destination: "Recebimento Dutelog",
      due_at: "2026-10-10T15:00:00.000Z",
      attachments: [nota],
      agent_message_id: "msg_9",
    });
    expect(payload.items).toEqual([
      { sku_code: "S1", client_item_code: "A.01.P", product_name: "Polo P", product_registration: "existing", location_id: null, quantity: 120 },
      { sku_code: "NOVO-1", client_item_code: "NOVO-1", product_name: "Camiseta nova", product_registration: "new", location_id: null, quantity: 50 },
      { product_name: "Sacola kraft", product_registration: "unknown", location_id: null, quantity: 300 },
    ]);
  });
});

describe("o rascunho levado à tela fica ligado à mensagem do cartão", () => {
  it("o pedido e o aviso guardam a mensagem, que volta ao abrir a tela", () => {
    const storage = new Map<string, string>();
    const sessao = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value), removeItem: (key: string) => void storage.delete(key) };
    const pedido = draftFromOrderForm(orderFormFromDraft(parseDraft(order) as OrderDraft), "msg_agent_1");
    expect(pedido.mensagem).toBe("msg_agent_1");
    saveDraft(pedido, sessao);
    expect(takeDraft("pedido", sessao)?.mensagem).toBe("msg_agent_1");

    saveDraft({ tipo: "envio", fornecedor: "Malharia Sul", linhas: [{ codigo: "A.01", nome: "Polo", quantidade: 5, situacao: "no_estoque" }], mensagem: "msg_agent_2" }, sessao);
    expect(takeDraft("envio", sessao)?.mensagem).toBe("msg_agent_2");
  });

  it("sem mensagem, ou com um id que o servidor não aceita, o rascunho vai sem ela", () => {
    expect(draftFromOrderForm(orderFormFromDraft(parseDraft(order) as OrderDraft))).not.toHaveProperty("mensagem");
    expect(parseDraft({ ...order, mensagem: "../outra/mensagem" })).not.toHaveProperty("mensagem");
    expect(parseDraft({ ...order, mensagem: "m".repeat(161) })).not.toHaveProperty("mensagem");
  });
});

