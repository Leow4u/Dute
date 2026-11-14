// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { normalizeQueues, type WarehouseTask } from "@/lib/warehouse-ops/model";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

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
 * Na revisão da parte: a ficha relida não muda o pedido da conferência (a
 * observação, o código da etiqueta, o custo relido como número), o encaixe
 * do motor não muda o da caixa, e o resultado incerto diz "Sem confirmação do
 * servidor", com o botão em "Tentar de novo" enquanto o pedido é o mesmo.
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
  /** Os toasts da tela, na ordem. */
  toasts: [] as Array<{ title?: unknown; description?: unknown; variant?: unknown }>,
  /** Quantas vezes a tela perguntou onde guardar a caixa. */
  sugestoes: 0,
  /** A caixa de apoio que o motor devolve a partir da segunda pergunta (a da primeira guarda, que valeu). */
  apoioNaSegunda: null as string | null,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (toast: { title?: unknown; description?: unknown; variant?: unknown }) => estado.toasts.push(toast) }),
}));
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
    estado.sugestoes += 1;
    const apoio = estado.sugestoes > 1 && estado.apoioNaSegunda ? { support_box_code: estado.apoioNaSegunda } : {};
    const candidato = (code: string, sequence: number) => ({ code, reason: "Cabe na prateleira", tier: 1, leftover_m: 0.4, sequence, placement: { front_m: 0.5, depth_m: 0.4, orientation: "standard", ...apoio } });
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

/** O rótulo à vista no botão: a camada atual do BotaoDeAcao. */
const rotuloDe = (botaoDaTela: HTMLButtonElement | null | undefined) =>
  (botaoDaTela?.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? botaoDaTela?.textContent ?? "").trim();
/** O axe roda no relógio de verdade (ele espera com temporizadores próprios); o simulado volta na mesma hora. */
async function axe(html: string) {
  const agora = Date.now();
  vi.useRealTimers();
  const violacoes = await violacoesDeAcessibilidade(html);
  vi.useFakeTimers();
  vi.setSystemTime(agora);
  return violacoes;
}
/** O último toast da tela. */
const ultimoToast = () => estado.toasts[estado.toasts.length - 1];

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
  estado.toasts = [];
  estado.sugestoes = 0;
  estado.apoioNaSegunda = null;
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

function arvore(tela: ReactElement) {
  return (
    <ProvedorDaConexao value={conexaoEm("conectado")}>
      <QueryClientProvider client={cliente}>
        <Anunciador />
        {tela}
      </QueryClientProvider>
    </ProvedorDaConexao>
  );
}

async function montar(tela: ReactElement) {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(arvore(tela));
  });
}

/** A tela relida: a mesma árvore, com os dados novos. */
async function reler(tela: ReactElement) {
  await act(async () => raiz!.render(arvore(tela)));
  await passar(50);
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

/** O botão que guarda a caixa na prateleira: "Confirmar guarda em A-03" ou, depois do resultado incerto, "Tentar de novo em A-03". */
const guardaEm = (codigo: string) => botao(`Confirmar guarda em ${codigo}`) ?? botao(`Tentar de novo em ${codigo}`);

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
        await act(async () => guardaEm("A-03")!.click());
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

describe("a caixa já armazenada da abertura, perguntando de novo", () => {
  it("o encaixe que o motor devolve de novo, sobre a caixa da primeira, não muda a tentativa: a repetição leva o corpo da primeira", async () => {
    // A primeira guarda em A-03 valeu, mas a resposta não chegou. A pessoa corrige e desfaz uma medida, e o "Onde
    // guardar?" volta: o motor já vê a caixa nova em A-03 e devolve A-03 empilhada sobre ela. O pedido é a caixa, a
    // prateleira e a recusa que a pessoa escolheu; o encaixe é do motor.
    estado.apoioNaSegunda = "CX-000123";
    await montar(<OpeningInventoryWorkspace />);
    await esperar(() => Boolean(botao("Cadastrar caixa já armazenada")), "a sessão aberta");
    await act(async () => botao("Cadastrar caixa já armazenada")!.click());
    await digitar("#box-length", "50");
    await digitar("#box-width", "40");
    await digitar("#box-height", "35");
    await act(async () => botao("Onde guardar?")!.click());
    await esperar(() => Boolean(guardaEm("A-03")), "a sugestão");
    estado.respostas = ["incerto", "incerto"];
    await act(async () => guardaEm("A-03")!.click());
    await passar(TOQUE_SEGUINTE);
    await digitar("#box-height", "36");
    await digitar("#box-height", "35");
    await esperar(() => Boolean(botao("Onde guardar?")), "o Onde guardar? de novo");
    await act(async () => botao("Onde guardar?")!.click());
    await esperar(() => estado.sugestoes === 2 && Boolean(guardaEm("A-03")), "a sugestão de novo");
    await act(async () => guardaEm("A-03")!.click());
    await passar(TOQUE_SEGUINTE);
    const [primeira, repeticao] = escritasEm("/api/warehouse/boxes");
    expect(primeira!.corpo.support_box_code).toBeNull();
    // Com a chave e o corpo da primeira, o servidor devolve o recibo dela; com uma nova, cadastraria a segunda caixa.
    expect(repeticao!.corpo).toEqual(primeira!.corpo);
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
  /** "Salvar conferência", ou "Tentar de novo" depois do resultado incerto. */
  const salvar = () => botao("Salvar conferência") ?? botao("Tentar de novo");

  it("repete a chave e o corpo depois do resultado incerto, e troca na recusa e com outra quantidade", async () => {
    await montar(ficha());
    await esperar(() => Boolean(botao("Salvar conferência")), "a conferência");
    await conferirAsRegras(
      "/api/warehouse/receipts/inb_1/conference",
      async () => {
        await act(async () => salvar()!.click());
        await passar(TOQUE_SEGUINTE);
      },
      () => digitar('input[aria-label="Quantidade conferida"]', "9"),
    );
  });

  it("a ficha relida depois do resultado incerto (a chegada já em conferência) repete o pedido da primeira, com o status que ela viu", async () => {
    estado.respostas = ["incerto"];
    await montar(ficha("created"));
    await esperar(() => Boolean(botao("Salvar conferência")), "a conferência");
    await act(async () => salvar()!.click());
    await passar(TOQUE_SEGUINTE);
    // A primeira valeu: a bancada releu, e a chegada está em conferência.
    await reler(ficha("checking"));
    await act(async () => salvar()!.click());
    await passar(TOQUE_SEGUINTE);
    const [primeira, repeticao] = escritasEm("/api/warehouse/receipts/inb_1/conference");
    expect(primeira!.corpo.expected_status).toBe("created");
    // Com a chave e o corpo da primeira, o servidor devolve o recibo; com uma nova e "checking", gravaria de novo.
    expect(repeticao!.corpo).toEqual(primeira!.corpo);
  });
});

describe("a conferência relida depois do resultado incerto, com o que só a pessoa tem", () => {
  const chegadaCom = (status: string, item: NonNullable<WarehouseTask["items"]>[number]): WarehouseTask => ({
    id: "receiving:inb_1", reference: "inb_1", title: "NF 4521", status, can_advance: true, items: [item],
  });
  const fichaCom = (status: string, item: NonNullable<WarehouseTask["items"]>[number]) => {
    const fila = normalizeQueues({ receiving: { key: "receiving", name: "Recebimento", tasks: [chegadaCom(status, item)] } }).find((q) => q.key === "receiving")!;
    return (
      <div className="v3">
        <ReceivingTaskDetailCard entry={{ task: fila.tasks[0]!, queue: fila }} alerts={[]} onAdvance={() => undefined} onOpenException={() => undefined} />
      </div>
    );
  };
  const salvar = async () => {
    await act(async () => (botao("Salvar conferência") ?? botao("Tentar de novo"))!.click());
    await passar(TOQUE_SEGUINTE);
  };
  const conferencias = () => escritasEm("/api/warehouse/receipts/inb_1/conference");

  // A primeira gravação valeu e a resposta se perdeu; a bancada relê (o intervalo de 60 s do Receber, a volta da rede,
  // o Atualizar) e a chegada vem em conferência, com a linha conferida. A observação e o código da etiqueta não voltam
  // do servidor, e o custo volta como número: a releitura não pode mudar o pedido.
  it("a observação continua no campo, e a repetição leva a chave e o corpo da primeira", async () => {
    estado.respostas = ["incerto"];
    await montar(fichaCom("created", { id: "l1", sku_code: "BTG-000001", expected_quantity: 10 }));
    await digitar('input[aria-label="Quantidade conferida"]', "9");
    await digitar("textarea", "Uma peça com avaria");
    await salvar();
    await reler(fichaCom("checking", { id: "l1", sku_code: "BTG-000001", expected_quantity: 10, received_qty: 9, conference_status: "short", location: "RECEBIMENTO" }));
    expect(document.querySelector("textarea")!.value).toBe("Uma peça com avaria");
    await salvar();
    const [primeira, repeticao] = conferencias();
    expect(repeticao!.corpo).toEqual(primeira!.corpo);
    expect(primeira!.corpo.expected_status).toBe("created");
  });

  it("o código da etiqueta da linha sem código fica no pedido, e a repetição leva a chave da primeira", async () => {
    estado.respostas = ["incerto"];
    await montar(fichaCom("created", { id: "l1", product_name: "Polo", expected_quantity: 10 }));
    await digitar('input[aria-label="Código da etiqueta"]', "A.01.0806.004.GG");
    await digitar('input[aria-label="Quantidade conferida"]', "10");
    await salvar();
    await reler(fichaCom("checking", { id: "l1", product_name: "Polo", sku_code: "BTG-000087", client_item_code: "A.01.0806.004.GG", expected_quantity: 10, received_qty: 10, conference_status: "ok", location: "RECEBIMENTO" }));
    await salvar();
    const [primeira, repeticao] = conferencias();
    expect(repeticao!.corpo).toEqual(primeira!.corpo);
  });

  it("o custo com zero à direita (12.50), relido como 12.5, é o mesmo pedido", async () => {
    estado.respostas = ["incerto"];
    await montar(fichaCom("created", { id: "l1", sku_code: "BTG-000001", expected_quantity: 10 }));
    await digitar('input[aria-label="Quantidade conferida"]', "10");
    await digitar('input[aria-label="Custo unitário"]', "12.50");
    await salvar();
    await reler(fichaCom("checking", { id: "l1", sku_code: "BTG-000001", expected_quantity: 10, received_qty: 10, unit_cost: 12.5, conference_status: "ok", location: "RECEBIMENTO" }));
    await salvar();
    const [primeira, repeticao] = conferencias();
    expect(repeticao!.corpo).toEqual(primeira!.corpo);
  });

  it("a releitura de outra chegada recomeça as linhas, sem a observação da anterior", async () => {
    await montar(fichaCom("created", { id: "l1", sku_code: "BTG-000001", expected_quantity: 10 }));
    await digitar("textarea", "Uma peça com avaria");
    const outra = normalizeQueues({
      receiving: { key: "receiving", name: "Recebimento", tasks: [{ id: "receiving:inb_2", reference: "inb_2", title: "NF 4522", status: "created", can_advance: true, items: [{ id: "l1", sku_code: "BTG-000002", expected_quantity: 5 }] }] },
    }).find((q) => q.key === "receiving")!;
    await reler(
      <div className="v3">
        <ReceivingTaskDetailCard entry={{ task: outra.tasks[0]!, queue: outra }} alerts={[]} onAdvance={() => undefined} onOpenException={() => undefined} />
      </div>,
    );
    expect(document.querySelector("textarea")!.value).toBe("");
  });
});

/**
 * O resultado incerto na tela: o servidor pode ter gravado. O aviso não diz que falhou ("Sem confirmação do
 * servidor", sem o vermelho da recusa), e o botão diz "Tentar de novo" enquanto o pedido é o mesmo: repetir assim leva
 * a mesma chave e nunca grava duas vezes. A recusa diz que não gravou, e o botão volta ao rótulo dele; mudar o pedido
 * também volta.
 */
describe("o resultado incerto diz que não houve confirmação, e o botão repete", () => {
  async function conferirOAviso(opcoes: {
    tentar: () => Promise<void>;
    /** O botão que repete: "Tentar de novo" tem 44 px no celular (especificação, seção 7). */
    botao: () => HTMLButtonElement | null | undefined;
    rotulo: () => string;
    original: string;
    repetir: string;
    recusa: string;
    mudar: () => Promise<void>;
  }) {
    estado.respostas = ["incerto"];
    await opcoes.tentar();
    expect(ultimoToast()?.title).toBe("Sem confirmação do servidor");
    expect(ultimoToast()?.variant).not.toBe("destructive");
    expect(opcoes.rotulo()).toBe(opcoes.repetir);
    expect(opcoes.botao()?.className).toMatch(/(?:^|\s)max-md:min-h-1[12](?:\s|$)/);
    expect(await axe(container.innerHTML)).toEqual([]);

    estado.respostas = ["recusa"];
    await opcoes.tentar();
    expect(ultimoToast()?.title).toBe(opcoes.recusa);
    expect(ultimoToast()?.variant).toBe("destructive");
    expect(opcoes.rotulo()).toBe(opcoes.original);

    estado.respostas = ["incerto"];
    await opcoes.tentar();
    expect(opcoes.rotulo()).toBe(opcoes.repetir);
    await opcoes.mudar();
    expect(opcoes.rotulo()).toBe(opcoes.original);
  }

  it("na devolução", async () => {
    await montar(<ReturnWorkspace />);
    await digitar("#return-client-code-0", "A.01.0806.004.GG");
    await esperar(() => naTela().includes("cadastro localizado"), "o cadastro achado");
    const registrar = () => rotuloDe(document.querySelector<HTMLButtonElement>('form button[type="submit"]'));
    estado.respostas = ["incerto"];
    await enviarFormulario();
    // Só rótulos, dados e ações no formulário que repete, e o axe.
    const form = container.querySelector("form")!.outerHTML;
    expect(
      textosForaDaLista(form, [
        "Origem", "Referência", "Itens devolvidos", "Adicionar linha", "Linha 1", "cadastro localizado", "Cadastro encontrado",
        "Sem foto", "Polo Masculino Piquet Preto · GG", "Cód. cliente", "A.01.0806.004.GG", "SKU", "BTG-000087", "Tamanho",
        "Não informado", "Cor", "Marca", "Código de barras", "Usar este cadastro", "Observações",
        "Criar devolução não altera saldo. O estoque só muda quando a disposição for “volta para disponível”.",
        "Tentar de novo", "Registrando…", "Conferir",
      ]),
    ).toEqual([]);
    expect(await axe(form)).toEqual([]);
    estado.toasts = [];
    await conferirOAviso({
      tentar: () => enviarFormulario(),
      botao: () => document.querySelector<HTMLButtonElement>('form button[type="submit"]'),
      rotulo: registrar,
      original: "Registrar devolução",
      repetir: "Tentar de novo",
      recusa: "Não consegui registrar a devolução",
      mudar: () => digitar("#return-notes", "Caixa amassada"),
    });
  });

  it("na contagem cíclica", async () => {
    await montar(<ExistingCycleCountWorkspace />);
    await digitar("#cycle-client-code", "A.01.0806.004.GG");
    await esperar(() => Boolean(botao("Usar este cadastro")), "o cadastro achado");
    await act(async () => botao("Usar este cadastro")!.click());
    await digitar("#cycle-location", "A-01");
    await digitar("#cycle-count", "10");
    await digitar("#cycle-reason", "Contagem da rua A");
    await conferirOAviso({
      tentar: () => enviarFormulario(),
      botao: () => document.querySelector<HTMLButtonElement>('form button[type="submit"]'),
      rotulo: () => rotuloDe(document.querySelector<HTMLButtonElement>('form button[type="submit"]')),
      original: "Registrar contagem",
      repetir: "Tentar de novo",
      recusa: "Não consegui registrar a contagem",
      mudar: () => digitar("#cycle-count", "12"),
    });
  });

  it("na caixa já armazenada da abertura", async () => {
    await montar(<OpeningInventoryWorkspace />);
    await esperar(() => Boolean(botao("Cadastrar caixa já armazenada")), "a sessão aberta");
    await act(async () => botao("Cadastrar caixa já armazenada")!.click());
    await digitar("#box-length", "50");
    await digitar("#box-width", "40");
    await digitar("#box-height", "35");
    await act(async () => botao("Onde guardar?")!.click());
    await esperar(() => Boolean(guardaEm("A-03")), "a sugestão");
    await conferirOAviso({
      tentar: async () => {
        await act(async () => guardaEm("A-03")!.click());
        await passar(TOQUE_SEGUINTE);
      },
      botao: () => guardaEm("A-03"),
      rotulo: () => rotuloDe(guardaEm("A-03")),
      original: "Confirmar guarda em A-03",
      repetir: "Tentar de novo em A-03",
      recusa: "Não consegui guardar a caixa",
      // Permitir inclinar é outro pedido; a sugestão continua a mesma.
      mudar: async () => {
        await act(async () => document.querySelector<HTMLButtonElement>("#box-allow-tilt")?.click());
        await esperar(() => Boolean(botao("Onde guardar?")), "o Onde guardar? de novo");
        await act(async () => botao("Onde guardar?")!.click());
        await esperar(() => Boolean(guardaEm("A-03")), "a sugestão de novo");
      },
    });
  });

  it("na conferência da chegada", async () => {
    const fila = normalizeQueues({
      receiving: { key: "receiving", name: "Recebimento", tasks: [{ id: "receiving:inb_1", reference: "inb_1", title: "NF 4521", status: "created", can_advance: true, items: [{ id: "l1", sku_code: "BTG-000001", expected_quantity: 10, received_qty: 10, conference_status: "ok" }] }] },
    }).find((q) => q.key === "receiving")!;
    await montar(
      <div className="v3">
        <ReceivingTaskDetailCard entry={{ task: fila.tasks[0]!, queue: fila }} alerts={[]} onAdvance={() => undefined} onOpenException={() => undefined} />
      </div>,
    );
    const salvar = () => botao("Salvar conferência") ?? botao("Tentar de novo");
    await esperar(() => Boolean(salvar()), "a conferência");
    await conferirOAviso({
      tentar: async () => {
        await act(async () => salvar()!.click());
        await passar(TOQUE_SEGUINTE);
      },
      botao: salvar,
      rotulo: () => rotuloDe(salvar()),
      original: "Salvar conferência",
      repetir: "Tentar de novo",
      recusa: "Não foi possível salvar a conferência",
      mudar: () => digitar('input[aria-label="Quantidade conferida"]', "9"),
    });
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
