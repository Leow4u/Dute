// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskQueueEntry } from "@/lib/warehouse-ops/model";

const chamadas = vi.hoisted(() => ({ lancar: vi.fn(), iniciar: vi.fn(), fechar: vi.fn(), sugerir: vi.fn(), avisar: vi.fn(), voltar: vi.fn() }));
vi.mock("@/lib/wms/caixas-do-recebimento", async (original) => ({
  ...await original<typeof import("@/lib/wms/caixas-do-recebimento")>(),
  lancarNaCaixa: chamadas.lancar,
  iniciarCaixa: chamadas.iniciar,
  fecharCaixa: chamadas.fechar,
  sugerirPrateleira: chamadas.sugerir,
}));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: "BTG Pactual" }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: chamadas.avisar }) }));

import { FichaDaChegadaPorCaixa } from "./chegada-por-caixa";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const RECEIPT = "inb_manual";
const BOX = "CX-000132";
const NOVO = {
  id: `${RECEIPT}_01`, line_number: 1, client_item_code: "A.01.0806.004.XG", sku_code: "BTG-000086",
  product_name: "Polo preto XG", expected_quantity: 41, boxed_qty: 0,
};
const EXISTENTE = {
  id: `${RECEIPT}_02`, line_number: 2, client_item_code: "A.01.0806.004.GG", sku_code: "BTG-000087",
  product_name: "Polo preto GG", expected_quantity: 30, boxed_qty: 18,
};

function entrada(): TaskQueueEntry {
  return {
    queue: { key: "receiving", label: "Recebimento" },
    task: {
      id: `receiving:${RECEIPT}`, reference: RECEIPT, status: "checking", conference_mode: "per_box",
      receipt_number: "AVL-MANUAL", can_advance: true, can_register_exception: true,
      boxes: [{
        code: BOX, status: "counting", location_id: "", unit_count: 18, conference_revision: 2,
        length_m: null, width_m: null, height_m: null, gross_weight_kg: null,
        allow_tilt: false, allow_stacking: false, refused_positions: [],
        lines: [{
          inbound_item_id: EXISTENTE.id, line_number: 2, sku_code: EXISTENTE.sku_code,
          client_item_code: EXISTENTE.client_item_code, product_name: EXISTENTE.product_name,
          size: "GG", counted_qty: 18,
        }],
      }],
      items: [{ ...NOVO }, { ...EXISTENTE }],
    },
  } as unknown as TaskQueueEntry;
}

let servidor: TaskQueueEntry;
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const lerFila = vi.fn<() => Promise<TaskQueueEntry>>();

function confirmarLancamento(dados: Record<string, unknown>) {
  const caixa = servidor.task.boxes!.find((item) => item.code === dados.box_code)!;
  const produto = servidor.task.items!.find((item) => item.id === dados.inbound_item_id)!;
  const anterior = caixa.lines.find((item) => item.inbound_item_id === produto.id)?.counted_qty ?? 0;
  const total = Number(dados.counted_qty);
  const line = {
    inbound_item_id: produto.id!, line_number: Number(produto.line_number), sku_code: produto.sku_code!,
    client_item_code: produto.client_item_code!, product_name: produto.product_name!,
    size: produto.id === NOVO.id ? "XG" : "GG", counted_qty: total,
  };
  const lines = [...caixa.lines.filter((item) => item.inbound_item_id !== produto.id), ...(total > 0 ? [line] : [])];
  const revision = Number(dados.expected_revision) + 1;
  const boxedQty = Number(produto.boxed_qty ?? 0) - anterior + total;
  servidor = {
    ...servidor,
    task: {
      ...servidor.task,
      boxes: servidor.task.boxes!.map((item) => item.code === caixa.code
        ? { ...item, lines, unit_count: lines.reduce((sum, item) => sum + item.counted_qty, 0), conference_revision: revision }
        : item),
      items: servidor.task.items!.map((item) => item.id === produto.id ? { ...item, boxed_qty: boxedQty } : item),
    },
  };
  return {
    ok: true, box_code: caixa.code, line: total > 0 ? line : null, conference_revision: revision,
    draft_line_count: lines.length, draft_unit_count: lines.reduce((sum, item) => sum + item.counted_qty, 0),
    inbound_item: { id: produto.id, boxed_qty: boxedQty, box_codes: total > 0 ? [caixa.code] : [] },
  };
}

/** A releitura da fila entrega o conteúdo que a escrita confirmou. */
function Bancada({ entradaVisivel }: { entradaVisivel?: TaskQueueEntry }) {
  const consulta = useQuery({ queryKey: ["warehouse-ops"], queryFn: () => lerFila(), initialData: servidor });
  return <FichaDaChegadaPorCaixa entry={entradaVisivel ?? consulta.data} onOpenException={() => undefined} onBack={chamadas.voltar} />;
}

async function esperar(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assertion();
  });
}

function botao(texto: string) {
  // O BotaoDeAcao empilha as camadas (repouso, em andamento, fim): o rótulo é o da camada atual (carregamento v2).
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => (item.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? item.textContent)?.trim() === texto,
  );
}

async function selecionar(nome: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
    `${item.getAttribute("aria-label") ?? ""} ${item.textContent ?? ""}`.includes(nome),
  );
  expect(button, `selecionar produto ${nome}`).toBeTruthy();
  await act(async () => button!.click());
}

function quantidade() {
  const label = [...container.querySelectorAll<HTMLLabelElement>("label")].find((item) => item.textContent?.trim() === "Quantidade nesta caixa");
  expect(label, "rótulo Quantidade nesta caixa").toBeTruthy();
  const input = document.getElementById(label!.htmlFor) as HTMLInputElement | null;
  expect(input).not.toBeNull();
  return input!;
}

async function digitar(valor: string) {
  await preencher(quantidade(), valor);
}

async function preencher(input: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function trocarCaixa(code: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="Selecionar caixa ${code}"]`);
  expect(button, `selecionar caixa ${code}`).not.toBeNull();
  await act(async () => button!.click());
}

function adicionarOutraCaixa() {
  const primeira = servidor.task.boxes![0]!;
  servidor = {
    ...servidor,
    task: {
      ...servidor.task,
      boxes: [...servidor.task.boxes!, {
        ...primeira, code: "CX-000133", unit_count: 5,
        lines: [{
          inbound_item_id: NOVO.id, line_number: 1, sku_code: NOVO.sku_code,
          client_item_code: NOVO.client_item_code, product_name: NOVO.product_name,
          size: "XG", counted_qty: 5,
        }],
      }],
      items: servidor.task.items!.map((item) => item.id === NOVO.id ? { ...item, boxed_qty: 5 } : item),
    },
  };
}


/** Travado: o `disabled` (o que não tem o que fazer) ou o `aria-disabled` do botão ocupado (carregamento v2, parte 13c). */
function travado(button: HTMLButtonElement | null | undefined) {
  return Boolean(button && (button.disabled || button.getAttribute("aria-disabled") === "true"));
}

async function clicar(texto: string) {
  // Cada toque um segundo depois do anterior: o BotaoDeAcao ignora o segundo toque dentro de 1 s (o toque único).
  vi.setSystemTime(Date.now() + 1_100);
  const button = botao(texto);
  expect(button, `botão ${texto}`).toBeTruthy();
  await act(async () => button!.click());
}

async function enter() {
  const input = quantidade();
  expect(input.form, "formulário da quantidade").not.toBeNull();
  await act(async () => {
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    // O jsdom não executa a submissão implícita do navegador após keydown.
    // Se não houver handler próprio, reproduzimos a ação padrão do formulário real.
    if (input.dispatchEvent(event)) input.form!.requestSubmit();
  });
}

async function conferirTotalSalvo(itemId: string, total: number) {
  await esperar(() => {
    const entry = client.getQueryData<TaskQueueEntry>(["warehouse-ops"]);
    expect(entry?.task.boxes?.[0]?.lines.find((item) => item.inbound_item_id === itemId)?.counted_qty).toBe(total);
  });
}

async function montar(entradaVisivel?: TaskQueueEntry) {
  await act(async () => root.render(<QueryClientProvider client={client}><Bancada entradaVisivel={entradaVisivel} /></QueryClientProvider>));
}

beforeEach(() => {
  servidor = entrada();
  lerFila.mockReset().mockImplementation(async () => servidor);
  chamadas.lancar.mockReset().mockImplementation(async (dados: Record<string, unknown>) => confirmarLancamento(dados));
  chamadas.iniciar.mockReset();
  chamadas.fechar.mockReset().mockImplementation(async (dados: Record<string, unknown>) => {
    const revision = Number(dados.expected_revision) + 1;
    servidor = {
      ...servidor,
      task: {
        ...servidor.task,
        boxes: servidor.task.boxes!.map((caixa) => caixa.code === dados.box_code ? {
          ...caixa, status: "reviewed", conference_revision: revision,
          length_m: Number(dados.length_m), width_m: Number(dados.width_m), height_m: Number(dados.height_m),
          gross_weight_kg: Number(dados.gross_weight_kg), allow_tilt: Boolean(dados.allow_tilt), allow_stacking: Boolean(dados.allow_stacking),
        } : caixa),
      },
    };
    return { ok: true, status: "reviewed", conference_revision: revision };
  });
  chamadas.sugerir.mockReset().mockResolvedValue({ ok: true, position: null, alternatives: [], rejected: null, checked: 0 });
  chamadas.avisar.mockReset();
  chamadas.voltar.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
  client.clear();
});

describe("conferência manual por produto da NF", () => {
  it("seleciona o produto da NF e começa com quantidade física vazia, sem copiar a prevista", async () => {
    await montar();
    await selecionar(NOVO.product_name);
    expect(quantidade().value).toBe("");
    expect(document.activeElement).toBe(quantidade());
    expect(botao("Adicionar à caixa")).toBeTruthy();
    expect(chamadas.lancar).not.toHaveBeenCalled();
  });

  it("salvar e sugerir destino usam o cliente da entrada mesmo com outro cliente no seletor", async () => {
    servidor = { ...servidor, task: { ...servidor.task, customer_code: "CLIENTE-DA-ENTRADA" } };
    await montar();
    await selecionar(NOVO.product_name);
    await digitar("12");
    await clicar("Adicionar à caixa");
    expect(chamadas.lancar).toHaveBeenCalledTimes(1);
    expect(chamadas.lancar.mock.calls[0]![0]).toMatchObject({
      receipt_id: RECEIPT, box_code: BOX, customer_code: "CLIENTE-DA-ENTRADA",
    });
    await conferirTotalSalvo(NOVO.id, 12);
    await clicar("Revisar caixa");
    for (const [campo, valor] of [["length_cm", "48"], ["width_cm", "38"], ["height_cm", "30"], ["weight_kg", "6,1"]]) {
      await preencher(document.getElementById(`fechar-${campo}`) as HTMLInputElement, valor!);
    }
    await clicar("Fechar caixa");
    await esperar(() => expect(chamadas.sugerir).toHaveBeenCalledTimes(1));
    expect(chamadas.fechar.mock.calls[0]![0]).toMatchObject({ customer_code: "CLIENTE-DA-ENTRADA" });
    expect(chamadas.sugerir.mock.calls[0]![0]).toMatchObject({
      receipt_id: RECEIPT, box_code: BOX, customer_code: "CLIENTE-DA-ENTRADA",
    });
  });

  it.each(["botão", "Enter"] as const)("%s adiciona o total contado e a seleção seguinte mostra o total confirmado", async (acao) => {
    await montar();
    await selecionar(NOVO.product_name);
    await digitar("12");
    expect(chamadas.lancar).not.toHaveBeenCalled();
    if (acao === "Enter") await enter();
    else await clicar("Adicionar à caixa");
    expect(chamadas.lancar).toHaveBeenCalledTimes(1);
    expect(chamadas.lancar).toHaveBeenLastCalledWith(expect.objectContaining({
      receipt_id: RECEIPT, customer_code: "BTG Pactual", box_code: BOX,
      inbound_item_id: NOVO.id, counted_qty: 12, expected_revision: 2, idempotency_key: expect.any(String),
    }));
    await conferirTotalSalvo(NOVO.id, 12);
    await selecionar(NOVO.product_name);
    expect(quantidade().value).toBe("12");
    expect(botao("Salvar quantidade")).toBeTruthy();
    expect(botao("Adicionar à caixa")).toBeUndefined();
  });

  it("produto existente começa com o total atual; Salvar quantidade substitui, sem somar ou duplicar", async () => {
    await montar();
    await selecionar(EXISTENTE.product_name);
    expect(quantidade().value).toBe("18");
    expect(botao("Salvar quantidade")).toBeTruthy();
    expect(botao("Adicionar à caixa")).toBeUndefined();
    await digitar("20");
    await clicar("Salvar quantidade");
    expect(chamadas.lancar).toHaveBeenCalledTimes(1);
    expect(chamadas.lancar.mock.calls[0]![0]).toMatchObject({ inbound_item_id: EXISTENTE.id, counted_qty: 20 });
    await conferirTotalSalvo(EXISTENTE.id, 20);
    await selecionar(EXISTENTE.product_name);
    expect(quantidade().value).toBe("20");
    const entry = client.getQueryData<TaskQueueEntry>(["warehouse-ops"]);
    expect(entry?.task.boxes?.[0]?.lines.filter((item) => item.inbound_item_id === EXISTENTE.id)).toHaveLength(1);
  });

  it("apagar a quantidade e sair do campo não remove silenciosamente o produto", async () => {
    await montar();
    await selecionar(EXISTENTE.product_name);
    await digitar("");
    await act(async () => { quantidade().dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(chamadas.lancar).not.toHaveBeenCalled();
    expect(quantidade().value).toBe("");
    expect(travado(botao("Salvar quantidade"))).toBe(true);
    await enter();
    expect(chamadas.lancar).not.toHaveBeenCalled();
  });

  it("a falha conserva produto, quantidade e erro; retentar repete a intenção", async () => {
    chamadas.lancar.mockRejectedValueOnce(new Error("Não foi possível confirmar a contagem."));
    await montar();
    await selecionar(NOVO.product_name);
    await digitar("12");
    await clicar("Adicionar à caixa");
    expect(quantidade().value).toBe("12");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Não foi possível confirmar a contagem.");
    const tentativa = chamadas.lancar.mock.calls[0]![0];
    await clicar("Adicionar à caixa");
    expect(chamadas.lancar).toHaveBeenCalledTimes(2);
    expect(chamadas.lancar.mock.calls[1]![0]).toEqual(tentativa);
    await conferirTotalSalvo(NOVO.id, 12);
  });

  it("conflito definitivo relê a caixa, mantém o rascunho e retenta com revisão e chave novas", async () => {
    chamadas.lancar.mockImplementationOnce(async () => {
      servidor = {
        ...servidor,
        task: {
          ...servidor.task,
          boxes: servidor.task.boxes!.map((caixa) => ({
            ...caixa, conference_revision: 3, unit_count: 19,
            lines: caixa.lines.map((linha) => ({ ...linha, counted_qty: 19 })),
          })),
          items: servidor.task.items!.map((item) => item.id === EXISTENTE.id ? { ...item, boxed_qty: 19 } : item),
        },
      };
      throw Object.assign(new Error("Caixa alterada por outra pessoa."), { code: "functions/failed-precondition" });
    });
    await montar();
    await selecionar(EXISTENTE.product_name);
    await digitar("20");
    await clicar("Salvar quantidade");
    await esperar(() => expect(client.getQueryData<TaskQueueEntry>(["warehouse-ops"])?.task.boxes?.[0]?.conference_revision).toBe(3));
    expect(quantidade().value).toBe("20");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Caixa alterada por outra pessoa.");
    const tentativa = { ...chamadas.lancar.mock.calls[0]![0] };
    expect(tentativa.expected_revision).toBe(2);
    await clicar("Salvar quantidade");
    expect(chamadas.lancar).toHaveBeenCalledTimes(2);
    const novaTentativa = chamadas.lancar.mock.calls[1]![0];
    expect(novaTentativa).toMatchObject({ inbound_item_id: EXISTENTE.id, counted_qty: 20, expected_revision: 3 });
    expect(novaTentativa.idempotency_key).not.toBe(tentativa.idempotency_key);
    await conferirTotalSalvo(EXISTENTE.id, 20);
  });

  it("dois cliques antes da resposta disparam só uma gravação", async () => {
    let responder!: (resultado: unknown) => void;
    chamadas.lancar.mockImplementationOnce(() => new Promise((resolve) => { responder = resolve; }));
    await montar();
    await selecionar(NOVO.product_name);
    await digitar("12");
    const button = botao("Adicionar à caixa")!;
    await act(async () => { button.click(); button.click(); });
    expect(chamadas.lancar).toHaveBeenCalledTimes(1);
    expect(quantidade().disabled).toBe(true);
    expect(travado(button)).toBe(true);
    const dados = chamadas.lancar.mock.calls[0]![0] as Record<string, unknown>;
    await act(async () => responder(confirmarLancamento(dados)));
    await conferirTotalSalvo(NOVO.id, 12);
  });

  it("a escrita confirmada mantém a edição ocupada enquanto a releitura está pendente", async () => {
    await montar();
    let responder!: (entry: TaskQueueEntry) => void;
    lerFila.mockImplementationOnce(() => new Promise((resolve) => { responder = resolve; }));
    await selecionar(NOVO.product_name);
    await digitar("12");
    await clicar("Adicionar à caixa");
    await esperar(() => expect(responder).toBeTypeOf("function"));
    expect(chamadas.lancar).toHaveBeenCalledTimes(1);
    expect(quantidade().disabled).toBe(true);
    expect(travado(botao("Salvar quantidade"))).toBe(true);
    await enter();
    await clicar("Salvar quantidade");
    expect(chamadas.lancar).toHaveBeenCalledTimes(1);
    await act(async () => responder(servidor));
    await esperar(() => expect(quantidade().disabled).toBe(false));
    await digitar("13");
    await clicar("Salvar quantidade");
    expect(chamadas.lancar).toHaveBeenCalledTimes(2);
    expect(chamadas.lancar.mock.calls[1]![0]).toMatchObject({ expected_revision: 3, counted_qty: 13 });
    await conferirTotalSalvo(NOVO.id, 13);
  });

  it("a releitura remove uma caixa já salva que foi excluída em outra tela e corrige os totais", async () => {
    adicionarOutraCaixa();
    await montar();
    await selecionar(NOVO.product_name);
    await digitar("12");
    await clicar("Adicionar à caixa");
    await conferirTotalSalvo(NOVO.id, 12);
    expect(container.textContent).toContain(`Caixa ativa ${BOX}`);
    const caixasRestantes = servidor.task.boxes!.filter((caixa) => caixa.code !== BOX);
    servidor = {
      ...servidor,
      task: {
        ...servidor.task,
        boxes: caixasRestantes,
        items: servidor.task.items!.map((item) => ({
          ...item,
          boxed_qty: caixasRestantes.reduce((total, caixa) => total + (caixa.lines.find((linha) => linha.inbound_item_id === item.id)?.counted_qty ?? 0), 0),
        })),
      },
    };
    await act(async () => { await client.invalidateQueries({ queryKey: ["warehouse-ops"] }); });
    await esperar(() => expect(container.textContent).not.toContain(BOX));
    expect(container.textContent).toContain("Caixa ativa CX-000133");
    await selecionar(NOVO.product_name);
    expect(quantidade().value).toBe("5");
    const resumo = (label: string) => [...container.querySelectorAll("dt")].find((item) => item.textContent === label)?.nextElementSibling?.textContent;
    expect(resumo("Salvo nesta caixa")).toBe("5 un.");
    expect(resumo("Faltam na chegada")).toBe("66 un.");
    expect(chamadas.lancar).toHaveBeenCalledTimes(1);
  });

  it("a caixa recém-iniciada continua visível enquanto a releitura ainda não a trouxe", async () => {
    chamadas.iniciar.mockResolvedValueOnce({ ok: true, box: { code: "CX-000133", conference_revision: 0 } });
    await montar();
    // A fila muda, mas sua resposta ainda não inclui a caixa que a escrita confirmou.
    servidor = {
      ...servidor,
      task: {
        ...servidor.task,
        boxes: servidor.task.boxes!.map((caixa) => ({ ...caixa, conference_revision: 3 })),
      },
    };
    await clicar("Iniciar outra caixa");
    await esperar(() => expect(client.getQueryData<TaskQueueEntry>(["warehouse-ops"])?.task.boxes?.[0]?.conference_revision).toBe(3));
    expect(client.getQueryData<TaskQueueEntry>(["warehouse-ops"])?.task.boxes?.map((caixa) => caixa.code)).toEqual([BOX]);
    expect(container.textContent).toContain("Caixa ativa CX-000133");
    await selecionar(NOVO.product_name);
    expect(quantidade().value).toBe("");
    expect(botao("Adicionar à caixa")).toBeTruthy();
    expect(chamadas.iniciar).toHaveBeenCalledTimes(1);
  });

  it("rascunhos do mesmo produto ficam separados por caixa e sobrevivem à troca", async () => {
    adicionarOutraCaixa();
    await montar();
    await selecionar(NOVO.product_name);
    await digitar("12");
    await trocarCaixa("CX-000133");
    await selecionar(NOVO.product_name);
    expect(quantidade().value).toBe("5");
    await digitar("7");
    await trocarCaixa(BOX);
    await selecionar(NOVO.product_name);
    expect(quantidade().value).toBe("12");
    expect(botao("Adicionar à caixa")).toBeTruthy();
    await trocarCaixa("CX-000133");
    await selecionar(NOVO.product_name);
    expect(quantidade().value).toBe("7");
    expect(botao("Salvar quantidade")).toBeTruthy();
    expect(chamadas.lancar).not.toHaveBeenCalled();
  });

  it("um rascunho em outra caixa bloqueia sair e revisar até ser descartado", async () => {
    adicionarOutraCaixa();
    await montar();
    await selecionar(NOVO.product_name);
    await digitar("12");
    await trocarCaixa("CX-000133");
    for (const acao of ["Voltar à fila", "Revisar entrada", "Revisar caixa"]) {
      expect(travado(botao(acao)), acao).toBe(true);
      await clicar(acao);
    }
    expect(chamadas.voltar).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Caixa ativa CX-000133");
    await trocarCaixa(BOX);
    await selecionar(NOVO.product_name);
    expect(quantidade().value).toBe("12");
    await clicar("Descartar alteração");
    expect(quantidade().value).toBe("");
    for (const acao of ["Voltar à fila", "Revisar entrada", "Revisar caixa"]) {
      expect(travado(botao(acao)), acao).toBe(false);
    }
    await clicar("Voltar à fila");
    expect(chamadas.voltar).toHaveBeenCalledTimes(1);
    expect(chamadas.lancar).not.toHaveBeenCalled();
  });

  it.each(["sucesso", "falha"] as const)("%s de uma gravação antiga não altera nem avisa em outra chegada", async (resultado) => {
    let responder!: (value: unknown) => void;
    let rejeitar!: (error: Error) => void;
    chamadas.lancar.mockImplementationOnce(() => new Promise((resolve, reject) => { responder = resolve; rejeitar = reject; }));
    await montar();
    await selecionar(NOVO.product_name);
    await digitar("12");
    await clicar("Adicionar à caixa");
    expect(chamadas.lancar).toHaveBeenCalledTimes(1);
    const dadosAntigos = chamadas.lancar.mock.calls[0]![0] as Record<string, unknown>;
    const outra = entrada();
    outra.task = {
      ...outra.task,
      id: "receiving:inb_outro", reference: "inb_outro", receipt_number: "AVL-OUTRO",
      boxes: [{ ...outra.task.boxes![0]!, code: "CX-000999", lines: [], unit_count: 0 }],
      items: [{ ...NOVO, id: "inb_outro_01", product_name: "Camisa de outro recebimento", expected_quantity: 8 }],
    };
    await montar(outra);
    await selecionar("Camisa de outro recebimento");
    expect(quantidade().disabled).toBe(false);
    expect(quantidade().value).toBe("");
    await act(async () => {
      if (resultado === "sucesso") responder(confirmarLancamento(dadosAntigos));
      else rejeitar(new Error("Falha na chegada anterior."));
    });
    expect(container.textContent).toContain("AVL-OUTRO");
    expect(container.textContent).toContain("Camisa de outro recebimento");
    expect(container.textContent).not.toContain(NOVO.product_name);
    expect(container.textContent).not.toContain("Quantidade salva nesta caixa.");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(quantidade().value).toBe("");
    expect(quantidade().disabled).toBe(false);
    expect(chamadas.avisar).not.toHaveBeenCalled();
    expect(chamadas.lancar).toHaveBeenCalledTimes(1);
  });

  it("fechar a caixa ativa avança ao destino dela mesmo com outra caixa em conferência", async () => {
    adicionarOutraCaixa();
    await montar();
    // A primeira caixa está ativa por padrão; não a selecionamos explicitamente.
    await clicar("Revisar caixa");
    for (const [campo, valor] of [["length_cm", "48"], ["width_cm", "38"], ["height_cm", "30"], ["weight_kg", "6,1"]]) {
      const input = document.getElementById(`fechar-${campo}`) as HTMLInputElement | null;
      expect(input).not.toBeNull();
      await preencher(input!, valor!);
    }
    await clicar("Fechar caixa");
    await esperar(() => expect(chamadas.sugerir).toHaveBeenCalledTimes(1));
    expect(chamadas.fechar).toHaveBeenCalledTimes(1);
    expect(chamadas.fechar.mock.calls[0]![0]).toMatchObject({ box_code: BOX, expected_revision: 2 });
    expect(container.textContent).toContain("Definir destino");
    expect(container.textContent).toContain(`Caixa ${BOX}`);
    expect(container.textContent).not.toContain("Caixa CX-000133");
    expect(chamadas.sugerir.mock.calls[0]![0]).toMatchObject({ box_code: BOX });
    expect(servidor.task.boxes?.find((caixa) => caixa.code === "CX-000133")?.status).toBe("counting");
  });

  it.each([
    { caso: "somente consulta", status: "checking", can_advance: false, can_register_exception: false },
    { caso: "entrada recebida", status: "received", can_advance: true, can_register_exception: true },
    { caso: "entrada cancelada", status: "cancelled", can_advance: true, can_register_exception: true },
  ])("$caso mostra dados sem ações de edição", async ({ status, can_advance, can_register_exception }) => {
    servidor = { ...servidor, task: { ...servidor.task, status, can_advance, can_register_exception } };
    await montar();
    expect(container.textContent).toContain(NOVO.product_name);
    for (const label of ["Iniciar caixa", "Iniciar outra caixa", "Adicionar à caixa", "Salvar quantidade", "Fechar caixa", "Revisar caixa", "Remover caixa", "Remover produto da caixa", "Concluir entrada", "Registrar divergência"]) {
      expect(botao(label), label).toBeUndefined();
    }
    expect([...container.querySelectorAll("label")].some((item) => item.textContent?.trim() === "Quantidade nesta caixa")).toBe(false);
    expect(chamadas.lancar).not.toHaveBeenCalled();
  });

  it("seleção e campo de quantidade preservam rótulos e acessibilidade", async () => {
    await montar();
    await selecionar(NOVO.product_name);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
    await digitar("12");
    chamadas.lancar.mockRejectedValueOnce(new Error("Contagem não salva."));
    await clicar("Adicionar à caixa");
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });
});
