// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { normalizeQueues, type WarehouseTask } from "@/lib/warehouse-ops/model";
import { conexaoEm } from "@/test/conexao";

/**
 * A chave por tentativa nas escritas da Armazenagem que ainda geravam uma
 * chave nova a cada toque (carregamento v2, parte 13k; o diagnóstico, seção
 * 9.1, item 11, e a necessidade 5 do celular). A parte 13i fez isso na guarda
 * da caixa e na exceção da tarefa; ficaram a devolução, a contagem cíclica, a
 * caixa já armazenada da abertura e a conferência da chegada por linha. Em
 * cada uma, o servidor guarda o recibo pela chave: com uma chave nova, a
 * repetição depois de um resultado incerto (a resposta que não chegou) grava
 * de novo. A devolução e a caixa nascem com o id tirado da chave, e a
 * repetição criava a segunda; a contagem e a conferência gravavam outra vez
 * o registro e o evento. Agora a repetição leva a mesma chave e o mesmo
 * corpo (a hora da primeira tentativa); a chave é nova quando o servidor
 * recusa, quando a escrita vale e quando a pessoa muda o pedido. A chegada
 * avulsa, que já guardava a tentativa, passa a trocar a chave na recusa.
 * Relógio simulado; dados sintéticos.
 */

type Resposta = "incerto" | "recusa" | "ok";
type Enviado = { caminho: string; corpo: Record<string, unknown> };

const estado = vi.hoisted(() => ({
  enviados: [] as Array<{ caminho: string; corpo: Record<string, unknown> }>,
  /** O que as próximas escritas respondem, na ordem; sem nada na fila, dá certo. */
  respostas: [] as Array<"incerto" | "recusa" | "ok">,
  /** O que a escrita que dá certo devolve, por caminho. */
  resultados: {} as Record<string, unknown>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({
    code: "BTG Pactual",
    active: { code: "BTG Pactual", name: "BTG Pactual", profile: { skuPrefix: "BTG", source: "published", template: "uniformes" } },
    isLoading: false,
  }),
}));
vi.mock("wouter", async (original) => ({ ...(await original<typeof import("wouter")>()), useLocation: () => ["/wms/contagem", () => undefined] }));

import { ReturnWorkspace } from "./exceptions";
import { ExistingCycleCountWorkspace, OpeningInventoryWorkspace } from "./inventory";
import { ReceivingTaskDetailCard, UnplannedReceiptDialog } from "./receiving";

const SKUS = [
  { id: "BTG-000087", sku_code: "BTG-000087", cod_btg: "BTG-000087", client_item_code: "A.01.0806.004.GG", cod_cliente: "A.01.0806.004.GG", cod_cliente_key: "A.01.0806.004.GG", product_name: "Polo Masculino Piquet Preto · GG", produto: "Polo Masculino Piquet Preto · GG", customer_code: "BTG Pactual", unit_cost: 52 },
];
const SESSAO_ABERTA = { session_id: "abertura-1", customer_code: "BTG Pactual", status: "open", lines: [], line_count: 0, unit_count: 0, total_cost: 0 };

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

async function servir(entrada: RequestInfo | URL, init?: RequestInit) {
  const { pathname } = new URL(String(entrada), "http://localhost");
  const metodo = (init?.method ?? "GET").toUpperCase();
  if (metodo === "POST" && pathname === "/api/warehouse/boxes/suggest") {
    const candidato = (code: string, sequence: number) => ({ code, reason: "Cabe na prateleira", tier: 1, leftover_m: 0.4, sequence, placement: { front_m: 0.5, depth_m: 0.4, orientation: "standard" } });
    return json({ ok: true, customer_code: "BTG Pactual", position: candidato("A-03", 3), alternatives: [candidato("A-04", 4)], rejected: null, checked: 9 });
  }
  if (metodo === "POST" && !pathname.endsWith("/read")) {
    estado.enviados.push({ caminho: pathname, corpo: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    const resposta = estado.respostas.shift() ?? "ok";
    // A rota de /api/* devolve 503 quando a callable não teve resposta (o resultado é incerto) e 4xx quando o servidor recusou.
    if (resposta === "incerto") return json({ message: "Sem resposta do servidor.", code: "sem_resposta" }, 503);
    if (resposta === "recusa") return json({ message: "Recusado pelo servidor.", code: "failed-precondition" }, 409);
    return json(estado.resultados[pathname] ?? { ok: true });
  }
  if (pathname === "/api/skus") return json({ items: SKUS });
  if (pathname === "/api/products") return json({ items: [] });
  if (pathname === "/api/return-items" || pathname === "/api/returns") return json({ items: [] });
  if (pathname.startsWith("/api/warehouse/opening-inventory/session/")) return json(SESSAO_ABERTA);
  if (pathname === "/api/warehouse/boxes" || pathname === "/api/warehouse/positions") return json({ items: [], has_more: false });
  throw new Error(`API inesperada: ${metodo} ${pathname}`);
}

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 300; volta += 1) {
    if (condicao()) return;
    await passar(10);
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

const naTela = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
/** O botão pelo rótulo: o do texto, ou o da camada atual do BotaoDeAcao. */
const botao = (rotulo: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => (item.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? item.textContent)?.trim() === rotulo,
  );

async function digitar(seletor: string, valor: string) {
  const campo = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(seletor)!;
  const prototipo = campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototipo, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function enviarFormulario(seletor = "form") {
  await act(async () => {
    document.querySelector(seletor)!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await passar(50);
}

/**
 * O toque seguinte no mesmo botão: o BotaoDeAcao trava o segundo toque dentro de 1 s (o toque duplo), e quem tenta
 * de novo depois de um erro toca depois disso.
 */
const TOQUE_SEGUINTE = 1_100;

/** As escritas que foram a um caminho, na ordem. */
const escritasEm = (caminho: string): Enviado[] => estado.enviados.filter((enviado) => enviado.caminho === caminho);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-14T13:42:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(servir));
  estado.enviados.length = 0;
  estado.respostas = [];
  estado.resultados = {};
  container = document.createElement("div");
  document.body.appendChild(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, networkMode: "always" }, mutations: { retry: false, networkMode: "always" } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  cliente.clear();
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function montar(tela: ReactElement) {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={cliente}>
          <Anunciador />
          {tela}
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

/** As três regras, numa escrita: `tentar` faz o toque; `mudar` muda o pedido. */
async function conferirAsRegras(caminho: string, tentar: () => Promise<void>, mudar: () => Promise<void>) {
  // 1. O resultado incerto: a repetição, minutos depois, leva a mesma chave e o mesmo corpo (a hora da primeira). A
  // repetição também fica sem resposta, para o formulário continuar com o pedido.
  estado.respostas = ["incerto", "incerto"];
  await tentar();
  vi.setSystemTime(Date.parse("2026-11-14T13:47:00Z"));
  await tentar();
  const [primeira, repeticao] = escritasEm(caminho);
  expect(primeira, "a primeira tentativa").toBeTruthy();
  expect(typeof primeira!.corpo.idempotency_key).toBe("string");
  expect(String(primeira!.corpo.idempotency_key)).not.toBe("");
  expect(repeticao, "a repetição").toBeTruthy();
  expect(repeticao!.corpo).toEqual(primeira!.corpo);

  // 2. A recusa do servidor encerra a tentativa: o toque seguinte, com o mesmo pedido, é outro.
  estado.respostas = ["recusa", "incerto"];
  await tentar();
  await tentar();
  const [, , recusada, depoisDaRecusa] = escritasEm(caminho);
  expect(recusada!.corpo.idempotency_key).toBe(primeira!.corpo.idempotency_key);
  expect(depoisDaRecusa!.corpo.idempotency_key).not.toBe(recusada!.corpo.idempotency_key);

  // 3. A pessoa muda o pedido: chave nova.
  estado.respostas = ["incerto"];
  await mudar();
  await tentar();
  const mudado = escritasEm(caminho)[4]!;
  expect(mudado.corpo.idempotency_key).not.toBe(depoisDaRecusa!.corpo.idempotency_key);
  expect(mudado.corpo).not.toEqual(depoisDaRecusa!.corpo);
}

describe("a devolução", () => {
  it("repete a chave e o corpo depois do resultado incerto, e troca na recusa e com outro pedido", async () => {
    await montar(<ReturnWorkspace />);
    await digitar("#return-client-code-0", "A.01.0806.004.GG");
    await esperar(() => naTela().includes("cadastro localizado"), "o cadastro achado");
    await conferirAsRegras(
      "/api/warehouse/returns",
      () => enviarFormulario(),
      () => digitar("#return-notes", "Caixa amassada"),
    );
  });

  it("depois do sucesso, a próxima devolução é outra tentativa", async () => {
    estado.resultados["/api/warehouse/returns"] = { ok: true, return_id: "ret_1", return_item_ids: ["ri_1"] };
    await montar(<ReturnWorkspace />);
    await digitar("#return-client-code-0", "A.01.0806.004.GG");
    await esperar(() => naTela().includes("cadastro localizado"), "o cadastro achado");
    await enviarFormulario();
    await passar(600);
    await digitar("#return-client-code-0", "A.01.0806.004.GG");
    await esperar(() => naTela().includes("cadastro localizado"), "o cadastro achado de novo");
    await enviarFormulario();
    const [primeira, segunda] = escritasEm("/api/warehouse/returns");
    expect(segunda!.corpo.idempotency_key).not.toBe(primeira!.corpo.idempotency_key);
  });
});

describe("a contagem cíclica", () => {
  it("repete a chave e o corpo (o occurred_at da primeira) depois do resultado incerto, e troca na recusa e com outra quantidade", async () => {
    await montar(<ExistingCycleCountWorkspace />);
    await digitar("#cycle-client-code", "A.01.0806.004.GG");
    await esperar(() => Boolean(botao("Usar este cadastro")), "o cadastro achado");
    await act(async () => botao("Usar este cadastro")!.click());
    await digitar("#cycle-location", "A-01");
    await digitar("#cycle-count", "10");
    await digitar("#cycle-reason", "Contagem da rua A");
    await conferirAsRegras(
      "/api/warehouse/cycle-counts",
      () => enviarFormulario(),
      () => digitar("#cycle-count", "12"),
    );
  });

  it("a contagem que volta ao valor de antes é outro pedido: só a última tentativa fica", async () => {
    await montar(<ExistingCycleCountWorkspace />);
    await digitar("#cycle-client-code", "A.01.0806.004.GG");
    await esperar(() => Boolean(botao("Usar este cadastro")), "o cadastro achado");
    await act(async () => botao("Usar este cadastro")!.click());
    await digitar("#cycle-location", "A-01");
    await digitar("#cycle-reason", "Contagem da rua A");
    estado.respostas = ["incerto", "ok", "ok"];
    await digitar("#cycle-count", "10");
    await enviarFormulario();
    await digitar("#cycle-count", "12");
    await enviarFormulario();
    await digitar("#cycle-count", "10");
    await digitar("#cycle-reason", "Contagem da rua A");
    await enviarFormulario();
    const [dez, doze, dezDeNovo] = escritasEm("/api/warehouse/cycle-counts");
    expect(doze!.corpo.idempotency_key).not.toBe(dez!.corpo.idempotency_key);
    // Voltar a 10 depois dos 12 gravados é contar de novo: com a chave dos 10, o servidor devolveria o recibo e o saldo ficaria em 12.
    expect(dezDeNovo!.corpo.idempotency_key).not.toBe(dez!.corpo.idempotency_key);
  });
});

describe("a caixa já armazenada da abertura", () => {
  it("repete a chave e o corpo depois do resultado incerto, e troca na recusa e com outra prateleira", async () => {
    await montar(<OpeningInventoryWorkspace />);
    await esperar(() => Boolean(botao("Cadastrar caixa já armazenada")), "a sessão aberta");
    await act(async () => botao("Cadastrar caixa já armazenada")!.click());
    await digitar("#box-length", "50");
    await digitar("#box-width", "40");
    await digitar("#box-height", "35");
    await act(async () => botao("Onde guardar?")!.click());
    await esperar(() => Boolean(botao("Confirmar guarda em A-03")), "a sugestão");
    await conferirAsRegras(
      "/api/warehouse/boxes",
      async () => {
        await act(async () => botao("Confirmar guarda em A-03")!.click());
        await passar(TOQUE_SEGUINTE);
      },
      async () => {
        // A outra prateleira: a pessoa guarda na alternativa, e o toque seguinte volta à sugerida.
        await act(async () => botao("Guardar em A-04")!.click());
        await passar(TOQUE_SEGUINTE);
      },
    );
  });
});

describe("a conferência da chegada por linha", () => {
  const chegada = (status = "created"): WarehouseTask => ({
    id: "receiving:inb_1",
    reference: "inb_1",
    title: "NF 4521",
    status,
    can_advance: true,
    items: [{ id: "l1", sku_code: "BTG-000001", expected_quantity: 10, received_qty: 10, conference_status: "ok" }],
  });
  const entrada = (status?: string) => {
    const fila = normalizeQueues({ receiving: { key: "receiving", name: "Recebimento", tasks: [chegada(status)] } }).find((item) => item.key === "receiving")!;
    return { task: fila.tasks[0]!, queue: fila };
  };
  const ficha = (status?: string) => (
    <div className="v3">
      <ReceivingTaskDetailCard entry={entrada(status)} alerts={[]} onAdvance={() => undefined} onOpenException={() => undefined} />
    </div>
  );

  it("repete a chave e o corpo depois do resultado incerto, e troca na recusa e com outra quantidade", async () => {
    await montar(ficha());
    await esperar(() => Boolean(botao("Salvar conferência")), "a conferência");
    await conferirAsRegras(
      "/api/warehouse/receipts/inb_1/conference",
      async () => {
        await act(async () => botao("Salvar conferência")!.click());
        await passar(TOQUE_SEGUINTE);
      },
      () => digitar('input[aria-label="Quantidade conferida"]', "9"),
    );
  });

  it("a ficha relida depois do resultado incerto (a chegada já em conferência) repete o pedido da primeira, com o status que ela viu", async () => {
    estado.respostas = ["incerto"];
    await montar(ficha("created"));
    await esperar(() => Boolean(botao("Salvar conferência")), "a conferência");
    await act(async () => botao("Salvar conferência")!.click());
    await passar(TOQUE_SEGUINTE);
    // A primeira valeu: a bancada releu, e a chegada está em conferência.
    await act(async () => raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={cliente}>
          <Anunciador />
          {ficha("checking")}
        </QueryClientProvider>
      </ProvedorDaConexao>,
    ));
    await passar(50);
    await act(async () => botao("Salvar conferência")!.click());
    await passar(TOQUE_SEGUINTE);
    const [primeira, repeticao] = escritasEm("/api/warehouse/receipts/inb_1/conference");
    expect(primeira!.corpo.expected_status).toBe("created");
    // Com a chave e o corpo da primeira, o servidor devolve o recibo; com uma nova e "checking", gravaria de novo.
    expect(repeticao!.corpo).toEqual(primeira!.corpo);
  });
});

describe("a chegada avulsa", () => {
  it("a recusa do servidor encerra a tentativa: o toque seguinte, com o mesmo rascunho, leva chave nova", async () => {
    const recusa = Object.assign(new Error("Recusado pelo servidor."), { status: 409, code: "failed-precondition" });
    const onCreate = vi.fn().mockRejectedValueOnce(recusa).mockRejectedValueOnce(new Error("Resposta perdida")).mockResolvedValue(undefined);
    await montar(
      <UnplannedReceiptDialog open isPending={false} onOpenChange={() => undefined} onCreate={onCreate} receipts={[]} />,
    );
    const campo = () => document.querySelector<HTMLInputElement>('input[aria-label="Código do produto da linha 1"]');
    await esperar(() => Boolean(campo()), "o formulário");
    await digitar('input[aria-label="Código do produto da linha 1"]', "A.01.0806.004.GG");
    await esperar(() => document.querySelector<HTMLInputElement>('input[aria-label="SKU da linha 1"]')?.value === "BTG-000087", "o produto");
    await enviarFormulario("form");
    await enviarFormulario("form");
    await enviarFormulario("form");
    expect(onCreate).toHaveBeenCalledTimes(3);
    const [recusada, depois, repeticao] = onCreate.mock.calls.map((chamada) => chamada[0] as Record<string, unknown>);
    expect(depois!.idempotency_key).not.toBe(recusada!.idempotency_key);
    // A resposta perdida não diz se gravou: a repetição leva o mesmo pedido.
    expect(repeticao).toEqual(depois);
  });
});
