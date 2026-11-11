// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fronteiras = vi.hoisted(() => ({
  pessoas: vi.fn(),
  escutar: vi.fn(),
  convites: vi.fn(),
}));

vi.mock("@/lib/firebase", () => ({ firestore: {}, firebaseApp: {}, firebaseAuth: null }));
vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "admin-1", publicMetadata: { role: "admin" } }, isLoaded: true }),
}));
vi.mock("@workspace/api-client-react", () => ({
  useListBillingUsers: fronteiras.pessoas,
  getListBillingUsersQueryKey: () => ["billing-users"],
  useUpdateUserRole: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/liberacao", async (original) => ({
  ...await original<typeof import("@/lib/liberacao")>(),
  PLATAFORMA_LIBERADA: true,
  COMERCIAL_LIBERADO: false,
  RECEBIMENTO_POR_CAIXA_LIBERADO: true,
}));
vi.mock("firebase/firestore", async (original) => ({
  ...await original<typeof import("firebase/firestore")>(),
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  where: vi.fn((field: string, operator: string, value: string) => ({ field, operator, value })),
  query: vi.fn((collection: unknown, ...constraints: unknown[]) => ({ collection, constraints })),
  onSnapshot: fronteiras.escutar,
  // Os convites pendentes (components/pessoas/dados.ts).
  getDocs: fronteiras.convites,
}));

import SettingsCustomers from "./settings-customers";
import { operationTemplate } from "@/lib/operations";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/**
 * Configurações › Clientes (docs/mockups/ConfigClientes.dc.html e
 * ConfigCliente.dc.html): a galeria de cartões e a página do cliente, com a
 * edição por seção, e o diálogo "Novo cliente". Os textos de cada estado
 * estão listados (a trava contra legenda) e o axe roda sobre cada um.
 */

type Cliente = Record<string, unknown> & { id: string; code: string; name: string };

const BTG: Cliente = {
  id: "btg", code: "BTG Pactual", name: "BTG", sku_prefix: "BTG", status: "active", portal_status: "active",
  operation_template: "uniformes", legal_name: "Banco BTG Pactual S.A.", document: "12.345.678/0001-90",
  primary_contact_name: "Ana Souza", primary_contact_email: "ana@btg.example", notes: "Retirada às terças.",
  modules: ["wms", "financeiro"], created_at: "2026-07-30T13:00:00.000Z",
};
const ITAU: Cliente = {
  id: "ITAU", code: "ITAU", name: "Itaú Unibanco", sku_prefix: "", status: "active", portal_status: "inactive",
  operation_template: "mobiliario", modules: ["wms", "operacao", "financeiro"],
};
const SAFRA: Cliente = {
  id: "SAFRA", code: "SAFRA", name: "Banco Safra", sku_prefix: "SAFRA", status: "archived", archived: true,
  portal_status: "inactive", operation_template: "uniformes",
};
const posicao = (code: string, aisle: string, customer_code: string | null, sequence: number) => ({
  id: code, code, aisle, shelf: sequence, length_m: 1.2, depth_m: 0.6, height_m: 0.5, sequence, customer_code,
});
const POSICOES = [
  posicao("A-01", "A", BTG.code, 1), posicao("A-02", "A", BTG.code, 2), posicao("A-03", "A", BTG.code, 3),
  posicao("B-01", "B", BTG.code, 4), posicao("C-01", "C", null, 5),
];
const caixa = (code: string, location_id: string) => ({
  id: code, code, customer_code: BTG.code, status: "stored", location_id, length_m: 0.5, width_m: 0.5, height_m: 0.35,
});
const CAIXAS = [caixa("CX-000001", "A-01"), caixa("CX-000002", "A-01"), caixa("CX-000003", "B-01")];
const PESSOAS = [
  { id: "p1", nome: "Ana Souza", email: "ana@btg.example", role: "cliente", customer_code: BTG.code },
  { id: "p2", nome: "Marcos Ribeiro", email: "marcos@btg.example", role: "cliente", customer_code: BTG.code },
  { id: "p3", nome: "Zeca", email: "zeca@btg.example", role: "cliente", customer_code: BTG.code, access_disabled: true },
  { id: "p4", nome: "Leonardo", email: "diretoria@dutelog.example", role: "admin" },
];
const CONVITES = [
  {
    id: "t".repeat(36), nome: "Tiago Moreira", email: "tiago@btg.example", role: "cliente", customer_code: BTG.code,
    status: "pending", email_status: "sent", email_requested_at: "2026-10-20T13:00:00.000Z",
  },
];
const CONTATO = {
  id: "ct_ana", customer_code: BTG.code, nome: "Ana Souza", email: "ana@btg.example", empresa: null, telefone: null,
  papel: "gestor_cliente", ativo: true, avisos: ["estoque_parado"],
};

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let clientes: Cliente[];
let falharClientes: boolean;
let falharPosicoes: boolean;
let respostaDoPatch: { status: number; body: unknown };
let chamadas: Array<{ method: string; path: string; body: Record<string, unknown> | null }>;
let assinaturas: Array<{ value: string; next: (snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => void }>;

async function esperar(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assertion();
  });
}

function botao(label: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === label || button.getAttribute("aria-label") === label,
  );
}

async function tocar(label: string, scope: ParentNode = document) {
  let button: HTMLButtonElement | undefined;
  await esperar(() => { button = botao(label, scope); expect(button, `botão ${label}`).toBeTruthy(); });
  await act(async () => button!.click());
}

function link(texto: string, scope: ParentNode = container) {
  return [...scope.querySelectorAll<HTMLAnchorElement>("a")].find((item) => item.textContent?.trim() === texto);
}

async function preencher(id: string, value: string) {
  await act(async () => {
    const input = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
    expect(input, `campo ${id}`).not.toBeNull();
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function buscar(value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** O filtro da galeria pelo rótulo (o botão traz a contagem junto). */
async function filtrar(rotulo: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Filtrar clientes"] button')].find((item) =>
    item.textContent?.startsWith(rotulo),
  );
  expect(button, `filtro ${rotulo}`).toBeTruthy();
  await act(async () => button!.click());
}

function cartoes() {
  return [...container.querySelectorAll<HTMLAnchorElement>('ul[aria-label="Clientes"] a')];
}

function secao(titulo: string) {
  const heading = [...container.querySelectorAll("h2")].find((item) => item.textContent?.trim() === titulo);
  expect(heading, `seção ${titulo}`).toBeTruthy();
  return heading!.closest("section")!;
}

function patches() {
  return chamadas.filter((chamada) => chamada.method === "PATCH");
}

function dialogo() {
  const elemento = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(elemento, "o diálogo").not.toBeNull();
  return elemento!;
}

/** O dado do diálogo pelo rótulo: o <dd> do <dt>. */
function dadoDoDialogo(rotulo: string) {
  const termo = [...dialogo().querySelectorAll("dt")].find((item) => item.textContent?.trim() === rotulo);
  expect(termo, `dado ${rotulo}`).toBeTruthy();
  return termo!.nextElementSibling as HTMLElement;
}

/** Troca o modelo pelo <select> que o Radix guarda para o formulário. */
async function escolherModelo(modelo: string) {
  await act(async () => {
    const select = [...dialogo().querySelectorAll<HTMLSelectElement>("select")].find((item) =>
      [...item.options].some((option) => option.value === modelo),
    );
    expect(select, `seletor do modelo ${modelo}`).toBeTruthy();
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, modelo);
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function montar(endereco = "/configuracoes/clientes") {
  window.history.replaceState(null, "", endereco);
  await act(async () => root.render(<QueryClientProvider client={client}><SettingsCustomers /></QueryClientProvider>));
}

async function abrirGaleria() {
  await montar();
  await esperar(() => expect(cartoes().length).toBeGreaterThan(0));
}

async function abrirCliente(code: string) {
  await montar(`/configuracoes/clientes?cliente=${encodeURIComponent(code)}`);
  await esperar(() => expect(container.querySelector("h1#cliente-titulo")).not.toBeNull());
}

async function publicarContatos(contatos: Array<typeof CONTATO>) {
  await esperar(() => expect(assinaturas.length).toBeGreaterThan(0));
  const ultima = assinaturas.at(-1)!;
  await act(async () => ultima.next({ docs: contatos.map(({ id, ...data }) => ({ id, data: () => data })) }));
}

beforeEach(() => {
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "dute-prod");
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  clientes = [ITAU, SAFRA, BTG];
  falharClientes = false;
  falharPosicoes = false;
  respostaDoPatch = { status: 200, body: { ok: true } };
  chamadas = [];
  assinaturas = [];
  fronteiras.pessoas.mockReset().mockReturnValue({ data: { items: PESSOAS }, isLoading: false });
  fronteiras.convites.mockReset().mockResolvedValue({ docs: CONVITES.map(({ id, ...data }) => ({ id, data: () => data })) });
  fronteiras.escutar.mockReset().mockImplementation((consulta: { constraints: Array<{ value: string }> }, next: (typeof assinaturas)[number]["next"]) => {
    assinaturas.push({ value: consulta.constraints[0]!.value, next });
    return () => undefined;
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = decodeURIComponent(new URL(String(input), "https://dute.test").pathname);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    chamadas.push({ method, path, body });
    const resposta = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    if (path === "/api/customers" && method === "GET") {
      return falharClientes ? resposta({ message: "Sem acesso ao cadastro." }, 500) : resposta({ items: clientes });
    }
    if (path === "/api/customers" && method === "POST") {
      clientes = [...clientes, { ...(body as Cliente), id: String(body!.code) }];
      return resposta({ ok: true });
    }
    if (path.startsWith("/api/customers/") && method === "PATCH") return resposta(respostaDoPatch.body, respostaDoPatch.status);
    if (path.startsWith("/api/customers/") && method === "DELETE") return resposta({ ok: true });
    if (path === "/api/warehouse/positions") {
      return falharPosicoes ? resposta({ message: "Falhou." }, 500) : resposta({ items: POSICOES, has_more: false });
    }
    if (path === "/api/warehouse/boxes") return resposta({ items: CAIXAS, has_more: false });
    if (path === "/api/invites" && method === "POST") return resposta({ ok: true }, 201);
    return resposta({ items: [], has_more: false });
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  client.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

const TEXTOS_DA_GALERIA = [
  "Clientes", "Todos", "Com portal", "Sem portal", "Arquivados", /^\d+$/, "Novo cliente",
  // BTG
  "BT", "BTG", "BTG Pactual", "Portal ativo", "Uniformes e materiais", "btg", "prateleiras · Ruas A e B", "no portal",
  "sigla do SKU", "Armazenagem", "Financeiro", "4 prateleiras · 2 no portal",
  // Itaú, sem sigla nem zona
  "IU", "Itaú Unibanco", "ITAU", "Mobiliário", "Em construção", "—", "zona a definir", "A definir", "Operação",
  "Zona a definir · 0 no portal · sigla a definir",
];

const UNIFORMES = operationTemplate("uniformes")!;
const INSUMOS = operationTemplate("insumos")!;
const TEXTOS_DO_NOVO_CLIENTE = [
  "Novo cliente", "Nome exibido", "Código operacional", "Sigla do SKU", "SKU gerado: SIGLA-000001", "SKU gerado: BTG-000001",
  "Modelo de operação", "Uniformes e materiais", "Mobiliário (em construção)", "Insumos internos (em construção)",
  "Portal do cliente", "Ativo", "Sem portal", "Módulos contratados", "Armazenagem", "Operação", "Financeiro",
  "Pacote de código do cliente", "Nenhum", "lib/operations/packs/btg.ts",
  "Razão social", "CNPJ", "Contato principal", "E-mail do contato", "Observações internas",
  `O que o modelo ${UNIFORMES.label} define`, `O que o modelo ${INSUMOS.label} define`, "Pronto", "Em construção",
  // A ficha do modelo (rótulo e valor) é dado: vem do código do modelo, em lib/operations/templates.
  ...[UNIFORMES, INSUMOS].flatMap((modelo) => modelo.defines.flatMap(({ label, value }) => [label, value])),
  "Cancelar", "Criar cliente", "Fechar",
];

describe("Configurações › Clientes, a galeria", () => {
  it("um cartão por cliente ativo, com os números e os módulos; sem tabela, sem legenda e sem violação de acessibilidade", async () => {
    await abrirGaleria();
    expect(container.querySelector("table")).toBeNull();
    expect(cartoes().map((cartao) => cartao.getAttribute("href"))).toEqual([
      "/configuracoes/clientes?cliente=BTG%20Pactual",
      "/configuracoes/clientes?cliente=ITAU",
    ]);
    const [btg, itau] = cartoes();
    for (const texto of ["BTG Pactual", "Portal ativo", "Uniformes e materiais", "btg", "prateleiras · Ruas A e B", "no portal", "Armazenagem", "Financeiro"]) {
      expect(btg!.textContent?.replace(/ /g, " ")).toContain(texto);
    }
    expect(btg!.querySelectorAll("dd")[0]!.textContent).toBe("4");
    expect(btg!.querySelectorAll("dd")[1]!.textContent).toBe("2");
    for (const texto of ["ITAU", "Sem portal", "Mobiliário", "Em construção", "zona a definir", "A definir", "Operação"]) {
      expect(itau!.textContent).toContain(texto);
    }
    const filtros = [...container.querySelectorAll('[aria-label="Filtrar clientes"] button')].map((button) => button.textContent);
    expect(filtros).toEqual(["Todos2", "Com portal1", "Sem portal1", "Arquivados1"]);
    expect(textosForaDaLista(container.innerHTML, TEXTOS_DA_GALERIA)).toEqual([]);
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
  });

  it("os filtros e a busca escolhem os cartões; sem resultado, a tela diz isso", async () => {
    await abrirGaleria();
    await filtrar("Arquivados");
    expect(cartoes().map((cartao) => cartao.textContent?.includes("Banco Safra"))).toEqual([true]);
    expect(cartoes()[0]!.textContent).toContain("Arquivado");
    await filtrar("Com portal");
    expect(cartoes()).toHaveLength(1);
    expect(cartoes()[0]!.textContent).toContain("BTG Pactual");
    await filtrar("Todos");
    await buscar("itau");
    expect(cartoes()).toHaveLength(1);
    expect(cartoes()[0]!.textContent).toContain("Itaú Unibanco");
    await buscar("12.345.678");
    expect(cartoes()[0]!.textContent).toContain("BTG Pactual");
    await buscar("zzz");
    expect(cartoes()).toHaveLength(0);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Nenhum cliente encontrado");
    await buscar("");
    await filtrar("Sem portal");
    expect(cartoes().map((cartao) => cartao.textContent?.includes("Itaú Unibanco"))).toEqual([true]);
  });

  it("a leitura que falhou mostra o aviso com 'Tentar de novo', nunca o vazio; tentar de novo lê outra vez", async () => {
    falharClientes = true;
    await montar();
    await esperar(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("Sem acesso ao cadastro.");
    expect(container.textContent).not.toContain("Nenhum cliente cadastrado");
    falharClientes = false;
    await tocar("Tentar de novo");
    await esperar(() => expect(cartoes()).toHaveLength(2));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("sem cliente cadastrado, a tela diz isso e deixa o 'Novo cliente'", async () => {
    clientes = [];
    await montar();
    await esperar(() => expect(container.querySelector('[role="status"]')?.textContent).toBe("Nenhum cliente cadastrado"));
    expect(botao("Novo cliente")?.disabled).toBe(false);
    expect(container.querySelector('[aria-label="Filtrar clientes"]')).toBeNull();
    expect(textosForaDaLista(container.innerHTML, ["Clientes", "Novo cliente", "Nenhum cliente cadastrado"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
  });

  it("sem as posições lidas, o cartão não afirma a zona", async () => {
    falharPosicoes = true;
    await abrirGaleria();
    await esperar(() => expect(cartoes()[0]!.querySelectorAll("dt")[0]!.textContent).toBe("prateleiras"));
    expect(cartoes()[0]!.querySelectorAll("dd")[0]!.textContent).toBe("—");
    expect(container.textContent).not.toContain("zona a definir");
    expect(container.textContent).not.toContain("Ruas A e B");
  });

  it("o cartão abre a página do cliente, e o caminho volta à galeria", async () => {
    await abrirGaleria();
    await act(async () => cartoes()[1]!.click());
    await esperar(() => expect(container.querySelector("h1#cliente-titulo")?.textContent).toContain("Itaú Unibanco"));
    expect(window.location.search).toBe("?cliente=ITAU");
    await act(async () => link("Clientes")!.click());
    await esperar(() => expect(cartoes()).toHaveLength(2));
    expect(window.location.search).toBe("");
  });

  it("'Novo cliente': as observações internas sem texto de exemplo", async () => {
    await abrirGaleria();
    await tocar("Novo cliente");
    const observacoes = document.getElementById("c-notes");
    expect(observacoes, "campo c-notes").not.toBeNull();
    expect(observacoes!.getAttribute("placeholder")).toBeNull();
  });

  it("'Novo cliente' cadastra, e o cliente criado abre na página dele", async () => {
    await abrirGaleria();
    await tocar("Novo cliente");
    await preencher("c-name", "Banco Inter");
    await preencher("c-code", "INTER");
    expect((document.getElementById("c-prefix") as HTMLInputElement).value).toBe("BANCO");
    await tocar("Criar cliente");
    await esperar(() => expect(container.querySelector("h1#cliente-titulo")?.textContent).toContain("Banco Inter"));
    const criacao = chamadas.find((chamada) => chamada.method === "POST")!;
    expect(criacao.body).toMatchObject({ code: "INTER", name: "Banco Inter", sku_prefix: "BANCO", operation_template: "uniformes", modules: ["wms", "financeiro"] });
    expect(window.location.search).toBe("?cliente=INTER");
  });

  it("'Novo cliente' só tem rótulos, dados e ações: o pacote é o arquivo ou 'Nenhum', e sem violação de acessibilidade", async () => {
    await abrirGaleria();
    await tocar("Novo cliente");
    expect(textosForaDaLista(dialogo().innerHTML, TEXTOS_DO_NOVO_CLIENTE)).toEqual([]);
    expect(dadoDoDialogo("Pacote de código do cliente").textContent).toBe("Nenhum");
    expect(await violacoesDeAcessibilidade(dialogo().outerHTML)).toEqual([]);

    // O código do pacote da BTG, no modelo dele: o pacote é o arquivo, em fonte fixa.
    await preencher("c-name", "BTG Pactual");
    await preencher("c-code", "BTG Pactual");
    expect(textosForaDaLista(dialogo().innerHTML, TEXTOS_DO_NOVO_CLIENTE)).toEqual([]);
    expect(dadoDoDialogo("Pacote de código do cliente").querySelector(".font-mono")?.textContent).toBe("lib/operations/packs/btg.ts");
    expect(await violacoesDeAcessibilidade(dialogo().outerHTML)).toEqual([]);

    // Noutro modelo o pacote não se aplica; o modelo sem portal deixa o portal em "Sem portal".
    await escolherModelo("insumos");
    expect(dialogo().textContent).toContain(`O que o modelo ${INSUMOS.label} define`);
    expect(textosForaDaLista(dialogo().innerHTML, TEXTOS_DO_NOVO_CLIENTE)).toEqual([]);
    expect(dadoDoDialogo("Pacote de código do cliente").textContent).toBe("Nenhum");
    expect(document.getElementById("c-portal")?.textContent).toBe("Sem portal");
    expect((document.getElementById("c-portal") as HTMLButtonElement).disabled).toBe(true);
    expect(await violacoesDeAcessibilidade(dialogo().outerHTML)).toEqual([]);
  });
});

const TEXTOS_DA_PAGINA_BTG = [
  "Clientes", "BTG", "BT", "Portal ativo", "BTG Pactual", "·", "Uniformes e materiais", "btg", "cliente desde 30/07/2026",
  "Avisos", "Avisos por e-mail", "Convidar",
  "4", "prateleiras · Ruas A e B", "2", "pessoas no portal", "1", "contatos de aviso", "sigla do SKU",
  "Operação", "Editar", "Modelo de operação", "Pronto", "Pacote de código", "Sigla do SKU", "BTG-000001",
  "Módulos contratados", "Armazenagem", "Financeiro", "Conferência da chegada", "Por caixa",
  "Armazém", "Posições", "Zona", "Ruas A e B · 4 prateleiras", "Rua A", "1 de 3 ocupadas", "Rua B", "1 de 1 ocupadas", "Caixas guardadas", "3",
  "Portal do cliente", "Situação", "Ativo",
  "Telas do portal", "Agent Dute, Início, Estoque, Eventos, Envios para a Dutelog, Pedidos, Faturas, Documentos",
  // As pessoas do portal (docs/mockups/ConfigClientePessoas.dc.html).
  "Pessoas · 2 · 1 convite pendente", "Arquivados · 1", "AS", "MR", "TM", "Marcos Ribeiro", "marcos@btg.example",
  "Tiago Moreira", "tiago@btg.example", "Convite pendente", /^E-mail enviado · \d{2}\/\d{2}$/, "Reenviar",
  "Contrato", "Razão social", "Banco BTG Pactual S.A.", "CNPJ", "12.345.678/0001-90", "Contato principal", "Ana Souza", "ana@btg.example",
  "Observações internas", "Retirada às terças.",
  "Novo contato", "Gestor do cliente", "Itens parados", "Desativar",
];

describe("Configurações › Clientes, a página do cliente", () => {
  it("o cabeçalho, os números e as seções; sem legenda e sem violação de acessibilidade", async () => {
    await abrirCliente(BTG.code);
    await publicarContatos([CONTATO]);
    await esperar(() => expect(secao("Armazém").textContent).toContain("1 de 3 ocupadas"));
    const cabecalho = container.querySelector("h1#cliente-titulo")!.closest("section")!;
    expect(cabecalho.textContent).toContain("cliente desde 30/07/2026");
    // O "Convidar" saiu do cabeçalho: mora na seção do portal e abre o convite ali.
    expect(botao("Convidar", cabecalho)).toBeUndefined();
    expect(link("Convidar")).toBeUndefined();
    expect(container.querySelector('a[href="#avisos-por-email"]')).not.toBeNull();
    expect(botao("Mais ações")).toBeTruthy();
    const numeros = [...cabecalho.querySelectorAll("dl > div")].map((item) => item.textContent?.replace(/ /g, " "));
    expect(numeros).toEqual(["prateleiras · Ruas A e B4", "pessoas no portal2", "contatos de aviso1", "sigla do SKUBTG"]);
    expect(secao("Operação").textContent).toContain("Por caixa");
    expect(secao("Armazém").textContent).toContain("Caixas guardadas3");
    await esperar(() => expect(secao("Portal do cliente").textContent).toContain("Pessoas · 2 · 1 convite pendente"));
    expect(botao("Convidar", secao("Portal do cliente"))).toBeTruthy();
    const pessoas = [...secao("Portal do cliente").querySelectorAll("li")].map((item) => item.textContent);
    expect(pessoas).toHaveLength(3);
    expect(pessoas.join(" | ")).toContain("Ana Souza");
    expect(pessoas.join(" | ")).toContain("Tiago Moreira");
    expect(pessoas.join(" | ")).not.toContain("Zeca");
    expect(secao("Contrato").textContent).toContain("Retirada às terças.");
    expect(secao("Avisos por e-mail").textContent).toContain("Itens parados");
    expect(assinaturas.every((assinatura) => assinatura.value === BTG.code)).toBe(true);
    expect(textosForaDaLista(container.innerHTML, TEXTOS_DA_PAGINA_BTG)).toEqual([]);
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
  });

  it("Editar a operação grava o cadastro inteiro com a sigla nova e volta à leitura", async () => {
    await abrirCliente(BTG.code);
    await tocar("Editar operação");
    expect((document.getElementById("operacao-sigla") as HTMLInputElement).value).toBe("BTG");
    expect(textosForaDaLista(secao("Operação").innerHTML, [
      "Operação", "Modelo de operação", "Uniformes e materiais", "Sigla do SKU", "Módulos contratados", "Armazenagem", "Operação",
      "Financeiro", "Cancelar", "Salvar",
      // As opções do seletor do modelo (o <select> que o Radix guarda para o formulário).
      "Mobiliário (em construção)", "Insumos internos (em construção)",
    ])).toEqual([]);
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
    await preencher("operacao-sigla", "btgp");
    await tocar("Salvar", secao("Operação"));
    await esperar(() => expect(secao("Operação").querySelector("form")).toBeNull());
    expect(patches()).toHaveLength(1);
    expect(patches()[0]!.path).toBe("/api/customers/btg");
    expect(patches()[0]!.body).toMatchObject({
      sku_prefix: "BTGP", name: "BTG", operation_template: "uniformes", portal_status: "active", status: "active",
      legal_name: "Banco BTG Pactual S.A.", primary_contact_email: "ana@btg.example", modules: ["wms", "financeiro"],
    });
    expect(patches()[0]!.body).not.toHaveProperty("code");
  });

  it("o contrato: o erro de validação e o do servidor ficam no formulário; o certo grava", async () => {
    await abrirCliente(BTG.code);
    await tocar("Editar contrato");
    // "ana@btg" passa na validação do navegador (type=email) e não na do cadastro.
    await preencher("contrato-email", "ana@btg");
    await tocar("Salvar", secao("Contrato"));
    await esperar(() => expect(secao("Contrato").querySelector('[role="alert"]')?.textContent).toBe("E-mail do contato inválido."));
    expect(patches()).toHaveLength(0);
    await preencher("contrato-email", "ana@btg.example");
    await preencher("contrato-nome", "BTG Pactual Asset");
    respostaDoPatch = { status: 400, body: { message: "Falha do servidor." } };
    await tocar("Salvar", secao("Contrato"));
    await esperar(() => expect(secao("Contrato").querySelector('[role="alert"]')?.textContent).toBe("Falha do servidor."));
    expect((document.getElementById("contrato-nome") as HTMLInputElement).value).toBe("BTG Pactual Asset");
    respostaDoPatch = { status: 200, body: { ok: true } };
    await tocar("Salvar", secao("Contrato"));
    await esperar(() => expect(secao("Contrato").querySelector("form")).toBeNull());
    expect(patches().at(-1)!.body).toMatchObject({ name: "BTG Pactual Asset", sku_prefix: "BTG", primary_contact_email: "ana@btg.example" });
  });

  it("sem sigla no cadastro, a seção pede a sigla para gravar; sem sigla não há arquivar", async () => {
    await abrirCliente(ITAU.code);
    expect(secao("Operação").textContent).toContain("A definir");
    expect(botao("Mais ações")).toBeUndefined();
    expect(link("Convidar")).toBeUndefined();
    await tocar("Editar contrato");
    expect((document.getElementById("contrato-sigla") as HTMLInputElement).value).toBe("ITAU");
    await tocar("Salvar", secao("Contrato"));
    await esperar(() => expect(secao("Contrato").querySelector("form")).toBeNull());
    expect(patches()[0]!.body).toMatchObject({ sku_prefix: "ITAU", name: "Itaú Unibanco", operation_template: "mobiliario", portal_status: "inactive" });
    await tocar("Editar portal do cliente");
    expect(document.getElementById("portal-sigla")).not.toBeNull();
  });

  it("o arquivado fica só para leitura e não lê os contatos", async () => {
    await abrirCliente(SAFRA.code);
    expect(container.querySelector("h1#cliente-titulo")!.textContent).toContain("Arquivado");
    expect([...container.querySelectorAll("button")].filter((button) => button.textContent?.includes("Editar"))).toHaveLength(0);
    expect(botao("Mais ações")).toBeUndefined();
    expect(link("Convidar")).toBeUndefined();
    expect(container.querySelector("#avisos-por-email")).toBeNull();
    expect(fronteiras.escutar).not.toHaveBeenCalled();
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
  });

  it("'Mais ações' › 'Arquivar cliente' pede a confirmação e arquiva", async () => {
    await abrirCliente(BTG.code);
    await act(async () => {
      botao("Mais ações")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    await esperar(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent === "Arquivar cliente");
    await act(async () => item!.click());
    await esperar(() => expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Arquivar BTG?"));
    await tocar("Arquivar", document.querySelector('[role="alertdialog"]')!);
    await esperar(() => expect(chamadas.some((chamada) => chamada.method === "DELETE")).toBe(true));
    expect(chamadas.find((chamada) => chamada.method === "DELETE")!.path).toBe("/api/customers/btg");
  });

  it("o código que não é de nenhum cliente diz isso e volta à galeria", async () => {
    await montar("/configuracoes/clientes?cliente=NINGUEM");
    await esperar(() => expect(container.querySelector('[role="status"]')?.textContent).toBe("Cliente não encontrado"));
    expect(link("Clientes")?.getAttribute("href")).toBe("/configuracoes/clientes");
  });

  it("sem as posições lidas, a página não afirma a zona e oferece ler de novo", async () => {
    falharPosicoes = true;
    await abrirCliente(BTG.code);
    await esperar(() => expect(secao("Armazém").querySelector('[role="alert"]')?.textContent).toBe("Não foi possível ler a ocupação."));
    expect(secao("Armazém").textContent).not.toContain("Ruas A e B");
    falharPosicoes = false;
    await tocar("Tentar de novo", secao("Armazém"));
    await esperar(() => expect(secao("Armazém").textContent).toContain("1 de 3 ocupadas"));
  });
});

describe("Configurações › Clientes, as pessoas do portal", () => {
  /** Abre o menu "…" de uma pessoa e devolve o item pelo texto. */
  async function itemDoMenu(pessoa: string, item: string) {
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(`[aria-label="Ações de ${pessoa}"]`)!
        .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    await esperar(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    const achado = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent === item);
    expect(achado, `item ${item}`).toBeTruthy();
    return achado!;
  }

  function convites() {
    return chamadas.filter((chamada) => chamada.method === "POST" && chamada.path === "/api/invites");
  }

  it("'Convidar' abre o convite do portal já com o cliente: o perfil Cliente e as telas; sem legenda e sem violação de acessibilidade", async () => {
    await abrirCliente(BTG.code);
    await tocar("Convidar", secao("Portal do cliente"));
    await esperar(() => expect(dialogo().textContent).toContain("Convidar para o portal · BTG"));
    expect(dialogo().querySelector("#invite-cliente")).toBeNull();
    expect(dadoDoDialogo("Perfil").textContent).toBe("Cliente");
    expect(dadoDoDialogo("Telas do portal").textContent).toBe(
      "Agent Dute, Início, Estoque, Eventos, Envios para a Dutelog, Pedidos, Faturas, Documentos",
    );
    expect(
      textosForaDaLista(dialogo().innerHTML, [
        "Convidar para o portal · BTG", "Nome", "E-mail", "Perfil", "Cliente", "Telas do portal",
        "Agent Dute, Início, Estoque, Eventos, Envios para a Dutelog, Pedidos, Faturas, Documentos", "Cancelar", "Enviar convite", "Fechar",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
    await preencher("invite-nome", "Juliana Prado");
    await preencher("invite-email", "Juliana@BTG.example");
    await tocar("Enviar convite", dialogo());
    await esperar(() => expect(convites()).toHaveLength(1));
    expect(convites()[0]!.body).toMatchObject({ nome: "Juliana Prado", email: "juliana@btg.example", role: "cliente", customer_code: BTG.code });
    await esperar(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });

  it("os arquivados do cliente aparecem a pedido, e 'Convidar novamente' traz a pessoa para o convite do mesmo cliente", async () => {
    await abrirCliente(BTG.code);
    await esperar(() => expect(botao("Arquivados · 1", secao("Portal do cliente"))).toBeTruthy());
    expect(botao("Arquivados · 1")!.getAttribute("aria-expanded")).toBe("false");
    await tocar("Arquivados · 1", secao("Portal do cliente"));
    expect(botao("Arquivados · 1")!.getAttribute("aria-expanded")).toBe("true");
    const zeca = [...secao("Portal do cliente").querySelectorAll("li")].find((item) => item.textContent?.includes("Zeca"));
    expect(zeca?.textContent).toContain("Acesso removido");
    await act(async () => (await itemDoMenu("Zeca", "Convidar novamente")).click());
    await esperar(() => expect(dialogo().textContent).toContain("Convidar para o portal · BTG"));
    expect((document.getElementById("invite-nome") as HTMLInputElement).value).toBe("Zeca");
    expect((document.getElementById("invite-email") as HTMLInputElement).value).toBe("zeca@btg.example");
    await tocar("Enviar convite", dialogo());
    await esperar(() => expect(convites()).toHaveLength(1));
    expect(convites()[0]!.body).toMatchObject({ email: "zeca@btg.example", role: "cliente", customer_code: BTG.code });
  });

  it("o convite pendente: 'Reenviar' na linha pede a confirmação e reenvia", async () => {
    await abrirCliente(BTG.code);
    await esperar(() => expect(botao("Reenviar o convite de Tiago Moreira")).toBeTruthy());
    await tocar("Reenviar o convite de Tiago Moreira");
    await esperar(() => expect(dialogo().textContent).toContain("tiago@btg.example"));
    await tocar("Reenviar convite", dialogo());
    await esperar(() => expect(chamadas.some((chamada) => chamada.path === `/api/invites/${"t".repeat(36)}/resend`)).toBe(true));
  });

  it("sem portal e sem gente, a seção não lista pessoas nem convida; o arquivado não convida", async () => {
    await abrirCliente(ITAU.code);
    await esperar(() => expect(secao("Portal do cliente").textContent).toContain("Sem portal"));
    expect(secao("Portal do cliente").textContent).not.toContain("Pessoas ·");
    expect(botao("Convidar", secao("Portal do cliente"))).toBeUndefined();
    await act(async () => root.unmount());
    root = createRoot(container);
    await abrirCliente(SAFRA.code);
    expect(botao("Convidar", secao("Portal do cliente"))).toBeUndefined();
  });

  it("a leitura das pessoas que falhou diz isso na seção e lê de novo", async () => {
    fronteiras.convites.mockRejectedValueOnce(new Error("sem rede"));
    await abrirCliente(BTG.code);
    await esperar(() => expect(secao("Portal do cliente").querySelector('[role="alert"]')?.textContent).toBe("Não foi possível ler as pessoas."));
    await tocar("Tentar de novo", secao("Portal do cliente"));
    await esperar(() => expect(secao("Portal do cliente").textContent).toContain("Pessoas · 2 · 1 convite pendente"));
  });
});
