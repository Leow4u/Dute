// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fronteiras = vi.hoisted(() => ({
  pessoas: vi.fn(),
  tela: { computador: true },
}));

vi.mock("@/lib/firebase", () => ({ firestore: {}, firebaseApp: {}, firebaseAuth: null }));
vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "admin-1", publicMetadata: { role: "admin" } }, isLoaded: true }),
}));
vi.mock("@workspace/api-client-react", () => ({ useListBillingUsers: fronteiras.pessoas }));
vi.mock("@/hooks/use-desktop", () => ({ useIsDesktop: () => fronteiras.tela.computador }));
vi.mock("@/lib/liberacao", async (original) => ({
  ...await original<typeof import("@/lib/liberacao")>(),
  PLATAFORMA_LIBERADA: true,
  COMERCIAL_LIBERADO: false,
}));

import SettingsCustomers from "./settings-customers";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/**
 * Configurações › Clientes como lista com ficha: a lista à esquerda, a ficha
 * do cliente escolhido à direita e, no celular, a ficha num sheet. O teste
 * lista os textos da tela (a trava contra legenda) e roda o axe.
 */

const BTG = {
  id: "btg", code: "BTG Pactual", name: "BTG", sku_prefix: "BTG", status: "active", portal_status: "active",
  operation_template: "uniformes", legal_name: "Banco BTG Pactual S.A.", document: "12.345.678/0001-90",
  primary_contact_name: "Ana Souza", primary_contact_email: "ana@btg.example", notes: "Retirada às terças.",
};
const ITAU = {
  id: "ITAU", code: "ITAU", name: "Itaú Unibanco", sku_prefix: "", status: "active", portal_status: "inactive",
  operation_template: "mobiliario", modules: ["wms", "operacao", "financeiro"],
};
const SAFRA = {
  id: "SAFRA", code: "SAFRA", name: "Banco Safra", sku_prefix: "SAFRA", status: "archived", portal_status: "active",
  operation_template: "uniformes",
};
const POSICOES = [
  { id: "A-01", aisle: "A", customer_code: BTG.code },
  { id: "B-01", aisle: "B", customer_code: BTG.code },
  { id: "C-01", aisle: "C", customer_code: null },
];
const PESSOAS = [
  { role: "cliente", customer_code: BTG.code },
  { role: "cliente", customer_code: BTG.code },
  { role: "cliente", customer_code: BTG.code, access_disabled: true },
  { role: "admin" },
];

const TEXTOS_DA_LISTA = [
  "Clientes", "Novo cliente",
  "BT", "BTG", "BTG Pactual · Uniformes e materiais", "Portal",
  "IU", "Itaú Unibanco", "ITAU · Mobiliário", "Sem portal",
  "Mostrar 1 arquivado",
];
const TEXTOS_DA_FICHA_BTG = [
  "BTG Pactual", "Avisos por e-mail", "Editar",
  "Operação", "Modelo de operação", "Uniformes e materiais", "Pronto", "Pacote de código", "btg",
  "Sigla do SKU", "BTG-000001", "Módulos contratados", "Armazenagem · Financeiro",
  "Armazém", "Zona", "Ruas A e B · 2 prateleiras", "Posições",
  "Portal do cliente", "Situação", "Ativo", "Pessoas", "2 pessoas", "Convidar",
  "Contrato", "Razão social", "Banco BTG Pactual S.A.", "CNPJ", "12.345.678/0001-90",
  "Contato principal", "Ana Souza", "ana@btg.example", "Observações internas", "Retirada às terças.",
];
const TEXTOS_DA_FICHA_ITAU = [
  "ITAU", "Avisos por e-mail", "Editar",
  "Operação", "Modelo de operação", "Mobiliário", "Em construção", "Pacote de código", "Nenhum",
  "Sigla do SKU", "A definir", "Módulos contratados", "Armazenagem · Operação · Financeiro",
  "Armazém", "Zona", "A definir em Posições",
  "Portal do cliente", "Situação", "Sem portal", "Pessoas", "Ninguém no portal",
  "Contrato", "Ativo", "Razão social", "CNPJ", "Contato principal", "Observações internas", "—",
];

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let clientes: Array<Record<string, unknown>>;
let falhar: boolean;

async function esperar(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assertion();
  });
}

function botao(label: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === label);
}

async function tocar(label: string, scope: ParentNode = document) {
  let button: HTMLButtonElement | undefined;
  await esperar(() => { button = botao(label, scope); expect(button, `botão ${label}`).toBeTruthy(); });
  await act(async () => button!.click());
}

function linhas() {
  return [...container.querySelectorAll<HTMLButtonElement>("li button")];
}

async function escolher(nome: string) {
  const button = linhas().find((item) => item.textContent?.includes(nome));
  expect(button, `cliente ${nome}`).toBeTruthy();
  await act(async () => button!.click());
}

function ficha(scope: ParentNode = container) {
  const article = scope.querySelector("article");
  expect(article, "ficha do cliente").toBeTruthy();
  return article!;
}

function dialogo() {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  expect(dialogs).toHaveLength(1);
  return dialogs[0]!;
}

async function montar() {
  await act(async () => root.render(<QueryClientProvider client={client}><SettingsCustomers /></QueryClientProvider>));
}

async function montarLista() {
  await montar();
  await esperar(() => expect(linhas().length).toBeGreaterThan(0));
}

beforeEach(() => {
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "dute-prod");
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  fronteiras.tela.computador = true;
  clientes = [ITAU, SAFRA, BTG];
  falhar = false;
  fronteiras.pessoas.mockReset().mockReturnValue({ data: { items: PESSOAS }, isLoading: false });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "https://dute.test").pathname;
    const headers = { "content-type": "application/json" };
    if (path === "/api/customers") {
      if (falhar) return new Response(JSON.stringify({ message: "Sem acesso ao cadastro." }), { status: 500, headers });
      return new Response(JSON.stringify({ items: clientes }), { headers });
    }
    if (path === "/api/warehouse/positions") return new Response(JSON.stringify({ items: POSICOES }), { headers });
    return new Response(JSON.stringify({ items: [] }), { headers });
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
});

describe("Configurações › Clientes, lista com ficha", () => {
  it("no computador mostra a lista e a ficha do primeiro cliente, sem tabela, sem legenda e sem violação de acessibilidade", async () => {
    await montarLista();
    expect(container.querySelector("table")).toBeNull();
    expect(linhas().map((item) => item.textContent)).toEqual([
      "BTBTGBTG Pactual · Uniformes e materiaisPortal",
      "IUItaú UnibancoITAU · MobiliárioSem portal",
    ]);
    expect(linhas()[0]!.getAttribute("aria-current")).toBe("true");
    expect(linhas()[1]!.getAttribute("aria-current")).toBeNull();
    const texto = ficha().textContent ?? "";
    for (const esperado of ["Uniformes e materiais", "Pronto", "btg", "BTG-000001", "Armazenagem · Financeiro", "Ruas A e B · 2 prateleiras", "2 pessoas", "Convidar", "Banco BTG Pactual S.A.", "Retirada às terças."]) {
      expect(texto).toContain(esperado);
    }
    expect(ficha().querySelector('a[href="/estoque/posicoes"]')?.textContent).toBe("Posições");
    expect(ficha().querySelector('a[href^="/configuracoes/pessoas?convidar=cliente&cliente=BTG%20Pactual"]')?.textContent).toBe("Convidar");
    expect(textosForaDaLista(container.innerHTML, [...TEXTOS_DA_LISTA, ...TEXTOS_DA_FICHA_BTG])).toEqual([]);
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
  });

  it("escolher outro cliente troca a ficha, com o que falta marcado como dado", async () => {
    await montarLista();
    await escolher("Itaú Unibanco");
    expect(linhas()[1]!.getAttribute("aria-current")).toBe("true");
    expect(linhas()[0]!.getAttribute("aria-current")).toBeNull();
    const texto = ficha().textContent ?? "";
    for (const esperado of ["Itaú Unibanco", "Mobiliário", "Em construção", "Nenhum", "A definir", "Armazenagem · Operação · Financeiro", "A definir em Posições", "Sem portal", "Ninguém no portal", "—"]) {
      expect(texto).toContain(esperado);
    }
    expect(texto).not.toContain("Convidar");
    expect(texto).not.toContain("BTG");
    expect(textosForaDaLista(container.innerHTML, [...TEXTOS_DA_LISTA, ...TEXTOS_DA_FICHA_ITAU])).toEqual([]);
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
  });

  it("os arquivados ficam fora da lista até 'Mostrar 1 arquivado'; a ficha do arquivado não oferece avisos", async () => {
    await montarLista();
    expect(linhas()).toHaveLength(2);
    await tocar("Mostrar 1 arquivado");
    expect(linhas()).toHaveLength(3);
    expect(linhas()[2]!.textContent).toBe("BSBanco SafraSAFRA · Uniformes e materiaisArquivado");
    await escolher("Banco Safra");
    expect(ficha().textContent).toContain("Banco Safra");
    expect([...ficha().querySelectorAll("dd")].filter((item) => item.textContent === "Arquivado")).toHaveLength(2);
    expect(botao("Avisos por e-mail", ficha())?.disabled).toBe(true);
    expect(botao("Editar", ficha())?.disabled).toBe(false);
    await tocar("Esconder arquivados");
    expect(linhas()).toHaveLength(2);
    expect(ficha().textContent).toContain("BTG Pactual");
  });

  it("'Editar' abre o diálogo com os dados do cliente escolhido", async () => {
    await montarLista();
    await escolher("Itaú Unibanco");
    await tocar("Editar", ficha());
    expect(dialogo().textContent).toContain("Dados de Itaú Unibanco");
    expect((document.getElementById("c-name") as HTMLInputElement).value).toBe("Itaú Unibanco");
    expect((document.getElementById("c-code") as HTMLInputElement).value).toBe("ITAU");
    expect((document.getElementById("c-code") as HTMLInputElement).disabled).toBe(true);
    await tocar("Cancelar", dialogo());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    for (const [, init] of vi.mocked(fetch).mock.calls) expect(init?.method ?? "GET").toBe("GET");
  });

  it("no celular a lista fica sozinha e o cliente tocado abre a ficha num sheet", async () => {
    fronteiras.tela.computador = false;
    await montarLista();
    expect(container.querySelector("article")).toBeNull();
    expect(container.querySelector("[aria-current]")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await escolher("Itaú Unibanco");
    const sheet = dialogo();
    expect(ficha(sheet).textContent).toContain("Itaú Unibanco");
    expect(ficha(sheet).textContent).toContain("Ninguém no portal");
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
    await tocar("Fechar", sheet);
    await esperar(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(container.querySelector("article")).toBeNull();
  });

  it("a leitura que falhou mostra o aviso com 'Tentar de novo' no lugar da lista, nunca o vazio", async () => {
    falhar = true;
    await montar();
    await esperar(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    const alerta = document.querySelector('[role="alert"]')!;
    expect(alerta.textContent).toContain("Tentar de novo");
    expect(container.textContent).not.toContain("Nenhum cliente cadastrado");
    expect(container.querySelector("article")).toBeNull();
    falhar = false;
    await tocar("Tentar de novo", alerta);
    await esperar(() => expect(linhas()).toHaveLength(2));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(ficha().textContent).toContain("BTG Pactual");
  });

  it("sem cliente cadastrado, a tela diz isso e deixa o 'Novo cliente'", async () => {
    clientes = [];
    await montar();
    await esperar(() => expect(container.querySelector('[role="status"]')?.textContent).toBe("Nenhum cliente cadastrado"));
    expect(botao("Novo cliente")?.disabled).toBe(false);
    expect(container.querySelector("article")).toBeNull();
    expect(textosForaDaLista(container.innerHTML, ["Clientes", "Novo cliente", "Nenhum cliente cadastrado"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
  });
});
