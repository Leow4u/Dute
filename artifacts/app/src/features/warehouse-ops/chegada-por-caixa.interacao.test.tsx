// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskQueueEntry } from "@/lib/warehouse-ops/model";

/**
 * A bancada na mão de quem usa (parte 5b): iniciar a caixa, selecionar a linha da NF,
 * salvar o total informado e fechar com as medidas. Conteúdo e revisão
 * avançam juntos após a confirmação de cada escrita.
 */

const estado = vi.hoisted(() => ({
  chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }>,
  revisao: 2,
  avisos: [] as Array<{ title?: string; description?: string }>,
  recusadas: [] as string[],
  linhasDePrateleiras: [] as string[],
  falhasDestino: 0,
  codigoFalhaDestino: null as string | null,
  destinoPendente: null as Promise<Record<string, unknown>> | null,
}));

const candidato = (code: string, tier: number) => ({
  code,
  reason:
    tier === 1
      ? "Já tem BTG-000086 nesta prateleira e ainda cabe."
      : "A mais próxima de B-02, que já tem o mesmo produto.",
  tier,
  leftover_m: 0.8,
  sequence: 14,
  placement: {
    front_m: 0.48,
    depth_m: 0.38,
    height_m: 0.3,
    orientation: "width_length_height",
    support_box_code: "CX-000090",
  },
});

vi.mock("@/lib/wms/caixas-do-recebimento", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/wms/caixas-do-recebimento")>();
  const registra =
    (nome: string, resultado: () => Record<string, unknown>) =>
    async (dados: Record<string, unknown>) => {
      estado.chamadas.push({ nome, dados });
      return resultado();
    };
  return {
    ...original,
    iniciarCaixa: registra("iniciar", () => ({
      ok: true,
      box: { code: "CX-000133" },
    })),
    lancarNaCaixa: registra("lancar", () => {
      estado.revisao += 1;
      return { ok: true, conference_revision: estado.revisao };
    }),
    fecharCaixa: registra("fechar", () => {
      estado.revisao += 1;
      return {
        ok: true,
        status: "reviewed",
        conference_revision: estado.revisao,
      };
    }),
    // A sugestão tira as prateleiras já recusadas, como o servidor.
    sugerirPrateleira: registra("sugerir", () =>
      estado.recusadas.includes("B-02")
        ? {
            ok: true,
            position: candidato("B-03", 2),
            alternatives: [],
            rejected: null,
            checked: 43,
          }
        : {
            ok: true,
            position: candidato("B-02", 1),
            alternatives: [candidato("B-03", 2)],
            rejected: null,
            checked: 43,
          },
    ),
    confirmarDestino: async (dados: Record<string, unknown>) => {
      estado.chamadas.push({ nome: "confirmar", dados });
      if (estado.falhasDestino > 0) {
        estado.falhasDestino -= 1;
        throw Object.assign(new Error("Não foi possível confirmar a reserva."), estado.codigoFalhaDestino ? { code: estado.codigoFalhaDestino } : {});
      }
      return estado.destinoPendente ?? {
        ok: true,
        status: "committing",
        conference_revision: Number(dados.expected_revision) + 1,
      };
    },
    reabrirCaixa: registra("reabrir", () => ({
      ok: true,
      status: "counting",
      conference_revision: 5,
    })),
    removerCaixa: registra("remover", () => ({ ok: true })),
    recusarSugestao: async (dados: Record<string, unknown>) => {
      estado.chamadas.push({ nome: "recusar", dados });
      estado.recusadas.push(String(dados.position));
      return { ok: true, conference_revision: 5 };
    },
    marcarFalta: registra("marcar", () => ({ ok: true })),
    desmarcarFalta: registra("desmarcar", () => ({ ok: true })),
    concluirEntradaPorCaixa: registra("concluir", () => ({
      ok: true,
      status: "received",
    })),
  };
});

vi.mock("@/lib/warehouse-rows", () => ({
  fetchWarehouseRows: async (url: string) => {
    estado.linhasDePrateleiras.push(url);
    return [
      {
        code: "A-03",
        customer_code: "BTG Pactual",
        status: "active",
        sequence: 3,
      },
      {
        code: "B-02",
        customer_code: "BTG Pactual",
        status: "active",
        sequence: 14,
      },
    ];
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: (aviso: { title?: string; description?: string }) =>
      estado.avisos.push(aviso),
  }),
}));

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG Pactual" }),
}));

import { FichaDaChegadaPorCaixa } from "./chegada-por-caixa";

const RECEIPT = "inb_avulso_0d0e620b";

const entry = {
  queue: { key: "receiving", label: "Recebimento" },
  task: {
    id: `receiving:${RECEIPT}`,
    reference: RECEIPT,
    status: "checking",
    conference_mode: "per_box",
    receipt_number: "AVL-0D0E620B",
    boxes: [
      {
        code: "CX-000131",
        status: "reviewed",
        location_id: "",
        lines: [
          {
            inbound_item_id: `${RECEIPT}_01`,
            line_number: 1,
            sku_code: "BTG-000086",
            client_item_code: "A.01.0806.004.XG",
            product_name: "POLO MASCULINO PIQUET PRETO XG",
            size: "XG",
            counted_qty: 29,
          },
        ],
        unit_count: 29,
        length_m: 0.48,
        width_m: 0.38,
        height_m: 0.3,
        gross_weight_kg: 9.4,
        allow_tilt: false,
        allow_stacking: true,
        conference_revision: 4,
        refused_positions: [],
      },
      {
        code: "CX-000132",
        status: "counting",
        location_id: "",
        lines: [
          {
            inbound_item_id: `${RECEIPT}_02`,
            line_number: 2,
            sku_code: "BTG-000087",
            client_item_code: "A.01.0806.004.GG",
            product_name: "POLO MASCULINO PIQUET PRETO GG",
            size: "GG",
            counted_qty: 18,
          },
        ],
        unit_count: 18,
        length_m: null,
        width_m: null,
        height_m: null,
        gross_weight_kg: null,
        allow_tilt: false,
        allow_stacking: false,
        conference_revision: 2,
        refused_positions: [],
      },
    ],
    items: [
      {
        id: `${RECEIPT}_01`,
        line_number: 1,
        client_item_code: "A.01.0806.004.XG",
        sku_code: "BTG-000086",
        expected_quantity: 41,
        boxed_qty: 29,
      },
      {
        id: `${RECEIPT}_02`,
        line_number: 2,
        client_item_code: "A.01.0806.004.GG",
        sku_code: "BTG-000087",
        expected_quantity: 30,
        boxed_qty: 18,
      },
    ],
  },
} as unknown as TaskQueueEntry;

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let cliente: QueryClient;

beforeEach(async () => {
  estado.chamadas = [];
  estado.revisao = 2;
  estado.avisos = [];
  estado.recusadas = [];
  estado.linhasDePrateleiras = [];
  estado.falhasDestino = 0;
  estado.codigoFalhaDestino = null;
  estado.destinoPendente = null;
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <FichaDaChegadaPorCaixa
          entry={entry}
          onOpenException={() => undefined}
        />
      </QueryClientProvider>,
    );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
});

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 50; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

function botao(texto: string) {
  const achado = [...document.querySelectorAll("button")].find(
    (elemento) => elemento.textContent?.trim() === texto,
  );
  if (!achado) throw new Error(`Sem o botão ${texto}`);
  return achado as HTMLButtonElement;
}

async function clicar(texto: string) {
  await act(async () => {
    botao(texto).click();
  });
}

async function digitar(id: string, valor: string) {
  const elemento = document.getElementById(id) as HTMLInputElement | null;
  if (!elemento) throw new Error(`Sem o campo ${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(elemento, valor);
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const dados = (nome: string) =>
  estado.chamadas
    .filter((chamada) => chamada.nome === nome)
    .map((chamada) => chamada.dados);

describe("a bancada da chegada por caixa na mão de quem usa", () => {
  it("iniciar a caixa manda a chegada e o cliente ativo", async () => {
    await clicar("Iniciar outra caixa");
    await esperar(() => dados("iniciar").length === 1, "a caixa iniciada");
    expect(dados("iniciar")[0]).toMatchObject({
      receipt_id: RECEIPT,
      customer_code: "BTG Pactual",
    });
    expect(String(dados("iniciar")[0]!.idempotency_key)).not.toBe("");
  });

  it("a seleção da NF salva o total e a próxima edição usa a revisão confirmada", async () => {
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find(
          (elemento) =>
            elemento.getAttribute("aria-pressed") === "false" &&
            elemento.textContent?.startsWith("A.01.0806.004.GG"),
        )!
        .click();
    });
    expect(
      (document.getElementById("caixa-quantidade") as HTMLInputElement).value,
    ).toBe("18");
    await digitar("caixa-quantidade", "19");
    await clicar("Salvar quantidade");
    await esperar(
      () => !botao("Revisar caixa").disabled,
      "a confirmação da quantidade",
    );
    expect(dados("lancar")[0]).toMatchObject({
      receipt_id: RECEIPT,
      box_code: "CX-000132",
      expected_revision: 2,
      inbound_item_id: `${RECEIPT}_02`,
      counted_qty: 19,
    });
    await digitar("caixa-quantidade", "20");
    await clicar("Salvar quantidade");
    await esperar(() => dados("lancar").length === 2, "a quantidade lançada");
    expect(dados("lancar")[1]).toMatchObject({
      expected_revision: 3,
      counted_qty: 20,
    });
  });

  it("a busca fora da NF não grava e informa que nenhum produto foi encontrado", async () => {
    await digitar("caixa-busca", "BTG-000999");
    expect(dados("lancar")).toEqual([]);
    expect(document.body.textContent).toContain(
      "Nenhum produto da NF encontrado.",
    );
  });

  it("fechar a caixa manda as medidas em metros, o peso em quilos e se pode virar ou empilhar", async () => {
    await clicar("Revisar caixa");
    // A vista da caixa no lugar da chegada (mockup WmsRecebimentoFecharCaixa).
    expect(document.body.textContent).toContain("Caixa CX-000132");
    expect(document.body.textContent).not.toContain("Linhas da NF");
    expect(botao("Fechar caixa").disabled).toBe(true);
    await digitar("fechar-length_cm", "48");
    await digitar("fechar-width_cm", "38");
    await digitar("fechar-height_cm", "30");
    await digitar("fechar-weight_kg", "6,1");
    await act(async () => {
      (document.getElementById("fechar-tombar") as HTMLButtonElement).click();
    });
    await clicar("Fechar caixa");
    await esperar(() => dados("fechar").length === 1, "a caixa fechada");
    expect(dados("fechar")[0]).toMatchObject({
      receipt_id: RECEIPT,
      box_code: "CX-000132",
      expected_revision: 2,
      length_m: 0.48,
      width_m: 0.38,
      height_m: 0.3,
      gross_weight_kg: 6.1,
      allow_tilt: true,
      allow_stacking: false,
    });
  });

  it("Editar conteúdo volta da medida à conferência sem fechar a caixa", async () => {
    await clicar("Revisar caixa");
    await clicar("Editar conteúdo");
    expect(document.body.textContent).toContain("Produtos da NF");
    expect(document.getElementById("caixa-busca")).not.toBeNull();
    expect(dados("fechar")).toEqual([]);
  });

  it("a caixa fechada mostra medidas sem edição e permite seguir sem prateleira", async () => {
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[aria-label="Selecionar caixa CX-000131"]',
        )!
        .click();
    });
    expect(document.body.textContent).toContain("48 × 38 × 30 cm");
    expect(document.getElementById("fechar-length_cm")).toBeNull();
    expect(botao("Reabrir para ajustar").disabled).toBe(false);
    await clicar("Continuar sem prateleira");
    expect(document.body.textContent).toContain("Conferência da NF");
    expect(dados("confirmar")).toEqual([]);
    await clicar("Voltar à conferência");
    expect(document.getElementById("caixa-busca")).not.toBeNull();
  });

  it("fechar de novo a caixa reaberta começa pelas medidas que ela já tem", async () => {
    const reaberta = {
      ...entry,
      task: {
        ...entry.task,
        boxes: [
          {
            ...entry.task.boxes![1]!,
            length_m: 0.5,
            width_m: 0.4,
            height_m: 0.35,
            gross_weight_kg: 7.25,
            allow_tilt: true,
          },
        ],
      },
    } as TaskQueueEntry;
    await act(async () => {
      raiz!.render(
        <QueryClientProvider client={new QueryClient()}>
          <FichaDaChegadaPorCaixa
            entry={reaberta}
            onOpenException={() => undefined}
          />
        </QueryClientProvider>,
      );
    });
    await clicar("Revisar caixa");
    const valor = (id: string) =>
      (document.getElementById(id) as HTMLInputElement).value;
    expect([
      valor("fechar-length_cm"),
      valor("fechar-width_cm"),
      valor("fechar-height_cm"),
      valor("fechar-weight_kg"),
    ]).toEqual(["50", "40", "35", "7,25"]);
    expect(
      document.getElementById("fechar-tombar")!.getAttribute("aria-checked"),
    ).toBe("true");
    expect(botao("Fechar caixa").disabled).toBe(false);
  });

  async function abrirCaixaFechada() {
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((elemento) => elemento.textContent?.includes("CX-000131"))!
        .click();
    });
    await esperar(
      () =>
        Boolean(
          document.body.textContent?.includes("Confirmar destino em B-02"),
        ),
      "a sugestão B-02",
    );
  }

  it("a caixa fechada pede a sugestão e confirma o destino com o encaixe e a sugestão do motor", async () => {
    await abrirCaixaFechada();
    expect(dados("sugerir")[0]).toEqual({
      receipt_id: RECEIPT,
      customer_code: "BTG Pactual",
      box_code: "CX-000131",
    });
    expect(document.body.textContent).toContain("alternativas B-03");
    await clicar("Confirmar destino em B-02");
    await esperar(
      () => dados("confirmar").length === 1,
      "o destino confirmado",
    );
    expect(dados("confirmar")[0]).toMatchObject({
      receipt_id: RECEIPT,
      box_code: "CX-000131",
      expected_revision: 4,
      location_id: "B-02",
      orientation: "width_length_height",
      support_box_code: "CX-000090",
      suggestion: { position: "B-02", alternatives: ["B-03"], tier: 1 },
    });
    expect(String(dados("confirmar")[0]!.idempotency_key)).not.toBe("");
    // Confirmado, a ficha volta à chegada.
    await esperar(
      () => Boolean(document.body.textContent?.includes("Conferência da NF")),
      "a volta à chegada",
    );
  });

  it.each(["Reabrir para ajustar", "Remover caixa"])(
    "confirmar duas vezes e tocar %s no mesmo turno grava só o destino",
    async (outraAcao) => {
      let responder!: (resultado: Record<string, unknown>) => void;
      estado.destinoPendente = new Promise((resolve) => { responder = resolve; });
      await abrirCaixaFechada();
      const confirmar = botao("Confirmar destino em B-02");
      const outra = botao(outraAcao);
      expect(confirmar.disabled).toBe(false);
      expect(outra.disabled).toBe(false);
      await act(async () => {
        confirmar.click();
        confirmar.click();
        outra.click();
      });
      await esperar(() => dados("confirmar").length === 1, "um único pedido de destino");
      expect(dados("reabrir")).toEqual([]);
      expect(dados("remover")).toEqual([]);
      await esperar(() => confirmar.disabled && outra.disabled, "os controles ocupados durante a confirmação");
      expect(confirmar.disabled).toBe(true);
      expect(outra.disabled).toBe(true);
      await act(async () => responder({ ok: true, status: "committing", conference_revision: 5 }));
      await esperar(
        () => Boolean(document.body.textContent?.includes("Conferência da NF")),
        "a revisão depois de confirmar o destino",
      );
      expect(dados("confirmar")).toHaveLength(1);
      expect(dados("reabrir")).toEqual([]);
      expect(dados("remover")).toEqual([]);
    },
  );

  it("retentar o destino após falha conserva a chave, a revisão e todo o pedido", async () => {
    estado.falhasDestino = 1;
    await abrirCaixaFechada();
    await clicar("Confirmar destino em B-02");
    await esperar(
      () => Boolean(container?.querySelector('[role="alert"]')?.textContent?.includes("Não foi possível confirmar a reserva.")),
      "o erro da confirmação do destino",
    );
    expect(dados("confirmar")).toHaveLength(1);
    const tentativa = dados("confirmar")[0]!;
    expect(tentativa).toMatchObject({
      box_code: "CX-000131",
      expected_revision: 4,
      location_id: "B-02",
      idempotency_key: expect.any(String),
    });
    expect(String(tentativa.idempotency_key)).not.toBe("");
    await esperar(() => !botao("Confirmar destino em B-02").disabled, "a retentativa disponível");
    await clicar("Confirmar destino em B-02");
    await esperar(
      () => Boolean(document.body.textContent?.includes("Conferência da NF")),
      "o destino confirmado na retentativa",
    );
    expect(dados("confirmar")).toHaveLength(2);
    expect(dados("confirmar")[1]).toEqual(tentativa);
    expect(dados("reabrir")).toEqual([]);
    expect(dados("remover")).toEqual([]);
  });

  it("conflito definitivo do destino relê a caixa e retenta com nova revisão e chave", async () => {
    estado.falhasDestino = 1;
    estado.codigoFalhaDestino = "functions/aborted";
    await abrirCaixaFechada();
    const atualizada = {
      ...entry,
      task: {
        ...entry.task,
        boxes: entry.task.boxes!.map((caixa) => caixa.code === "CX-000131" ? { ...caixa, conference_revision: 6 } : caixa),
      },
    };
    const reler = vi.spyOn(cliente, "invalidateQueries").mockImplementationOnce(async () => {
      // A releitura publica a revisão nova, como a consulta que alimenta a fila.
      raiz!.render(
        <QueryClientProvider client={cliente}>
          <FichaDaChegadaPorCaixa entry={atualizada} onOpenException={() => undefined} />
        </QueryClientProvider>,
      );
    });
    await clicar("Confirmar destino em B-02");
    await esperar(() => reler.mock.calls.length === 1, "a releitura após a rejeição definitiva");
    expect(reler).toHaveBeenCalledWith({ queryKey: ["warehouse-ops"] });
    expect(dados("confirmar")).toHaveLength(1);
    const tentativa = { ...dados("confirmar")[0]! };
    expect(tentativa.expected_revision).toBe(4);
    await esperar(
      () => Boolean(document.body.textContent?.includes("Confirmar destino em B-02")),
      "a sugestão atualizada para retentar",
    );
    await clicar("Confirmar destino em B-02");
    await esperar(() => dados("confirmar").length === 2, "a confirmação com a revisão relida");
    expect(dados("confirmar")[1]).toMatchObject({
      box_code: "CX-000131", expected_revision: 6, location_id: "B-02",
    });
    expect(dados("confirmar")[1]!.idempotency_key).not.toBe(tentativa.idempotency_key);
    await esperar(
      () => Boolean(document.body.textContent?.includes("Conferência da NF")),
      "a revisão da entrada após confirmar o destino",
    );
    expect(document.body.textContent).toContain("CX-000131 · destino B-02");
  });

  it("a falha de confirmar destino após sair da chegada não mostra aviso antigo", async () => {
    let rejeitar!: (error: Error) => void;
    estado.destinoPendente = new Promise((_, reject) => { rejeitar = reject; });
    await abrirCaixaFechada();
    await clicar("Confirmar destino em B-02");
    await esperar(() => dados("confirmar").length === 1, "o pedido de destino pendente");
    await act(async () => raiz!.unmount());
    raiz = null;
    await act(async () => rejeitar(new Error("Falha na reserva da chegada anterior.")));
    expect(estado.avisos).toEqual([]);
    expect(container?.textContent).toBe("");
    expect(dados("confirmar")).toHaveLength(1);
  });

  it("Não cabe aqui pede o motivo, recusa a prateleira com a revisão e traz outra sugestão", async () => {
    await abrirCaixaFechada();
    await clicar("Não cabe aqui");
    expect(botao("Recusar B-02").disabled).toBe(true);
    await digitar(
      "nao-cabe-motivo",
      "Outra caixa ocupando a frente da prateleira",
    );
    await clicar("Recusar B-02");
    await esperar(() => dados("recusar").length === 1, "a recusa");
    expect(dados("recusar")[0]).toMatchObject({
      receipt_id: RECEIPT,
      box_code: "CX-000131",
      expected_revision: 4,
      position: "B-02",
      reason: "Outra caixa ocupando a frente da prateleira",
    });
    // A revisão nova pede outra sugestão, já sem B-02.
    await esperar(
      () =>
        Boolean(
          document.body.textContent?.includes("Confirmar destino em B-03"),
        ),
      "a sugestão nova",
    );
    expect(document.getElementById("nao-cabe-motivo")).toBeNull();
  });

  it("Escolher prateleira busca as prateleiras da zona; a sugestão continua à mão", async () => {
    await abrirCaixaFechada();
    await clicar("Escolher prateleira");
    await esperar(
      () => estado.linhasDePrateleiras.length === 1,
      "as prateleiras",
    );
    expect(estado.linhasDePrateleiras[0]).toBe(
      "/api/warehouse/positions?limit=2000",
    );
    expect(document.body.textContent).toContain("Prateleira cadastrada");
    expect(document.body.textContent).not.toContain("Confirmar destino");
    await clicar("Sugestão do sistema");
    expect(document.body.textContent).toContain("Confirmar destino em B-02");
  });

  it("Marcar falta abre o diálogo e manda o motivo, o detalhe e o que estava nas caixas", async () => {
    await clicar("Revisar entrada");
    await clicar("Marcar falta");
    expect(document.body.textContent).toContain("Marcar falta · linha 1");
    await clicar("Avaria");
    await digitar("falta-detalhe", "Volume 3 molhado");
    await clicar("Marcar falta de 12 un.");
    await esperar(() => dados("marcar").length === 1, "a falta marcada");
    expect(dados("marcar")[0]).toMatchObject({
      receipt_id: RECEIPT,
      customer_code: "BTG Pactual",
      inbound_item_id: `${RECEIPT}_01`,
      reason: "avaria",
      detail: "Volume 3 molhado",
      expected_boxed_qty: 29,
    });
    await esperar(
      () => !document.body.textContent?.includes("Marcar falta · linha 1"),
      "o diálogo fechado",
    );
  });

  describe("a chegada pronta para concluir", () => {
    const pronta = {
      ...entry,
      task: {
        ...entry.task,
        boxes: [
          {
            ...entry.task.boxes![0]!,
            status: "committing",
            location_id: "B-02",
          },
        ],
        items: [
          {
            ...entry.task.items![0]!,
            shortage: {
              qty: 12,
              boxed_qty: 29,
              expected_qty: 41,
              reason: "falta",
              detail: "Volume 3 não veio",
            },
          },
          { ...entry.task.items![1]!, boxed_qty: 30 },
        ],
      },
    } as TaskQueueEntry;

    beforeEach(async () => {
      await act(async () => {
        raiz!.render(
          <QueryClientProvider client={new QueryClient()}>
            <FichaDaChegadaPorCaixa
              entry={pronta}
              onOpenException={() => undefined}
            />
          </QueryClientProvider>,
        );
      });
      await clicar("Revisar entrada");
    });

    it("Concluir entrada espera a justificativa e manda o status que a tela viu", async () => {
      expect(botao("Concluir entrada").disabled).toBe(true);
      await act(async () => {
        const campo = document.getElementById(
          "justificativa-da-divergencia",
        ) as HTMLTextAreaElement;
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(campo, "Fornecedor envia o volume 3 na próxima NF.");
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(botao("Concluir entrada").disabled).toBe(false);
      await clicar("Concluir entrada");
      await esperar(
        () => dados("concluir").length === 1,
        "a entrada concluída",
      );
      expect(dados("concluir")[0]).toMatchObject({
        receipt_id: RECEIPT,
        customer_code: "BTG Pactual",
        expected_status: "checking",
        note: "Fornecedor envia o volume 3 na próxima NF.",
      });
      await esperar(
        () =>
          estado.avisos.some((aviso) => aviso.title === "Entrada concluída"),
        "o aviso",
      );
    });

    it("Desmarcar tira a falta da linha", async () => {
      await clicar("Desmarcar");
      await esperar(
        () => dados("desmarcar").length === 1,
        "a falta desmarcada",
      );
      expect(dados("desmarcar")[0]).toMatchObject({
        receipt_id: RECEIPT,
        inbound_item_id: `${RECEIPT}_01`,
      });
    });
  });
});
