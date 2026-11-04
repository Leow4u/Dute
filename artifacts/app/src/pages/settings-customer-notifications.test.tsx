// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fronteiras = vi.hoisted(() => ({
  chamar: vi.fn(),
  escutar: vi.fn(),
  pessoas: vi.fn(),
}));

vi.mock("@/lib/firebase", () => ({ firestore: {}, firebaseApp: {}, firebaseAuth: null }));
vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "admin-1", publicMetadata: { role: "admin" } }, isLoaded: true }),
}));
vi.mock("@workspace/api-client-react", () => ({ useListBillingUsers: fronteiras.pessoas }));
vi.mock("@/lib/liberacao", async (original) => ({
  ...await original<typeof import("@/lib/liberacao")>(),
  COMERCIAL_LIBERADO: false,
}));
vi.mock("firebase/firestore", async (original) => ({
  ...await original<typeof import("firebase/firestore")>(),
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  where: vi.fn((field: string, operator: string, value: string) => ({ field, operator, value })),
  query: vi.fn((collection: unknown, ...constraints: unknown[]) => ({ collection, constraints })),
  onSnapshot: fronteiras.escutar,
}));
vi.mock("firebase/functions", async (original) => ({
  ...await original<typeof import("firebase/functions")>(),
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn((_functions: unknown, name: string) => (payload: unknown) => fronteiras.chamar(name, payload)),
}));

import SettingsCustomers from "./settings-customers";
import SettingsCustomerNotifications from "./settings-customer-notifications";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";
import { COMERCIAL_LIBERADO, comercialLiberado } from "@/lib/liberacao";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const CLIENTE = {
  id: "ITAU", code: "ITAU", name: "Itaú Unibanco", sku_prefix: "ITAU", status: "active",
  portal_status: "inactive", operation_template: "uniformes",
  primary_contact_name: "Contato principal", primary_contact_email: "principal@cliente.example",
};
const OUTRO_CLIENTE = { ...CLIENTE, id: "SAFRA", code: "SAFRA", name: "Banco Safra", sku_prefix: "SAFRA" };
const CONTATO = {
  id: "ct_ana", customer_code: CLIENTE.code, nome: "Ana Silva", email: "ana@cliente.example",
  empresa: null, telefone: null, papel: "gestor_cliente", ativo: true,
  avisos: ["os_concluida", "nf_emitida", "estoque_parado"],
};
type Contato = typeof CONTATO;
type Consulta = { collection: { path: string }; constraints: Array<{ field: string; operator: string; value: string }> };
type Assinatura = {
  consulta: Consulta;
  next: (snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => void;
  error: () => void;
  ativa: boolean;
  parar: ReturnType<typeof vi.fn>;
};

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let clientes: Array<typeof CLIENTE>;
let assinaturas: Assinatura[];

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

function dialogo() {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  expect(dialogs).toHaveLength(1);
  return dialogs[0]!;
}

function linhaDoContato(nome = CONTATO.nome) {
  const row = [...dialogo().querySelectorAll("li")].find((item) => item.textContent?.includes(nome));
  expect(row, `linha de ${nome}`).toBeTruthy();
  return row!;
}

function assinatura(code = CLIENTE.code) {
  const subscription = [...assinaturas].reverse().find((item) => item.ativa && item.consulta.constraints.some((constraint) => constraint.value === code));
  expect(subscription, `leitura ativa de ${code}`).toBeTruthy();
  return subscription!;
}

async function publicar(contatos: Contato[], code = CLIENTE.code) {
  await act(async () => assinatura(code).next({ docs: contatos.map(({ id, ...data }) => ({ id, data: () => data })) }));
}

async function preencher(id: string, value: string) {
  await act(async () => {
    const input = document.getElementById(id) as HTMLInputElement;
    expect(input).not.toBeNull();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function marcar(modelo: string) {
  await act(async () => {
    const checkbox = document.getElementById(`contato-aviso-${modelo}`);
    expect(checkbox).not.toBeNull();
    checkbox!.click();
  });
}

function payload(index = -1) {
  const call = fronteiras.chamar.mock.calls.at(index);
  expect(call?.[0]).toBe("saveCustomerContact");
  return call![1] as Record<string, unknown>;
}

async function montarClientes() {
  await act(async () => root.render(<QueryClientProvider client={client}><SettingsCustomers /></QueryClientProvider>));
  await esperar(() => expect(container.textContent).toContain(CLIENTE.name));
}

async function abrir(customer = CLIENTE) {
  await montarClientes();
  const row = [...container.querySelectorAll("tbody tr")].find((item) => item.textContent?.includes(customer.name));
  expect(row).toBeTruthy();
  await tocar("Avisos por e-mail", row!);
}

async function novoContato() {
  await abrir();
  await publicar([]);
  await tocar("Novo contato", dialogo());
  expect(dialogo().textContent).toContain(`Novo contato · ${CLIENTE.name}`);
  await preencher("contato-nome", "Novo contato");
  await preencher("contato-email", "novo@cliente.example");
}

beforeEach(() => {
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "dute-prod");
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  clientes = [CLIENTE];
  assinaturas = [];
  fronteiras.chamar.mockReset().mockResolvedValue({ data: { contato_id: "ct_novo" } });
  fronteiras.escutar.mockReset().mockImplementation((consulta: Consulta, next: Assinatura["next"], error: Assinatura["error"]) => {
    const item: Assinatura = { consulta, next, error, ativa: true, parar: vi.fn(() => { item.ativa = false; }) };
    assinaturas.push(item);
    return item.parar;
  });
  fronteiras.pessoas.mockReset().mockReturnValue({ data: { items: [] }, isLoading: false });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "https://dute.test").pathname;
    const payload = path === "/api/customers" ? { items: clientes } : { items: [] };
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
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

describe("destinatários de avisos em Configurações › Clientes", () => {
  it("abre pelo cliente sem portal nem usuários e lê apenas os contatos desse cliente", async () => {
    expect(COMERCIAL_LIBERADO).toBe(false);
    expect(comercialLiberado(import.meta.env.VITE_FIREBASE_PROJECT_ID)).toBe(true);
    await abrir();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(fronteiras.escutar).toHaveBeenCalledWith(
      { collection: { path: "customer_contacts" }, constraints: [{ field: "customer_code", operator: "==", value: CLIENTE.code }] },
      expect.any(Function), expect.any(Function),
    );
    expect(fronteiras.chamar).not.toHaveBeenCalled();
  });

  it("não oferece a ação para cliente arquivado", async () => {
    clientes.push({ ...OUTRO_CLIENTE, status: "archived" });
    await montarClientes();
    await tocar("Mostrar 1 arquivado");
    const row = [...container.querySelectorAll("tbody tr")].find((item) => item.textContent?.includes(OUTRO_CLIENTE.name))!;
    expect(botao("Avisos por e-mail", row)?.disabled).toBe(true);
    expect(fronteiras.escutar).not.toHaveBeenCalled();
  });

  it("não oferece a ação no ambiente legado em que as callables de contato estão desligadas", async () => {
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "dute-btg");
    await montarClientes();
    expect(botao("Avisos por e-mail")).toBeUndefined();
    expect(fronteiras.escutar).not.toHaveBeenCalled();
  });

  it("distingue carregamento, erro e lista vazia; tentar novamente refaz a leitura", async () => {
    await abrir();
    expect(dialogo().textContent).toContain("Carregando contatos…");
    expect(dialogo().textContent).not.toContain("Nenhum contato cadastrado.");
    await act(async () => assinatura().error());
    expect(dialogo().querySelector('[role="alert"]')?.textContent).toContain("Não foi possível carregar os contatos.");
    expect(dialogo().textContent).not.toContain("Nenhum contato cadastrado.");
    const anterior = assinatura();
    await tocar("Tentar novamente", dialogo());
    expect(anterior.parar).toHaveBeenCalledTimes(1);
    expect(assinaturas).toHaveLength(2);
    await publicar([]);
    expect(dialogo().textContent).toContain("Nenhum contato cadastrado.");
    expect(dialogo().textContent).not.toContain("Carregando contatos…");
    expect(dialogo().querySelector('[role="alert"]')).toBeNull();
  });

  it("cria contato com e-mail obrigatório e opt-in explícito, sem cadastrar pessoa ou convidar", async () => {
    await abrir();
    await publicar([]);
    await tocar("Novo contato", dialogo());
    expect((document.getElementById("contato-nome") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("contato-email") as HTMLInputElement).value).toBe("");
    await preencher("contato-nome", "Novo contato");
    expect(botao("Salvar contato", dialogo())?.disabled).toBe(true);
    expect((document.getElementById("contato-email") as HTMLInputElement).required).toBe(true);
    await preencher("contato-email", "novo@cliente.example");
    expect(dialogo().querySelectorAll('[role="checkbox"]')).toHaveLength(2);
    expect([...dialogo().querySelectorAll('[role="checkbox"]')].every((item) => item.getAttribute("aria-checked") === "false")).toBe(true);
    expect(dialogo().textContent).not.toContain("NF emitida");
    expect(dialogo().textContent).not.toContain("OS agendada");
    await marcar("estoque_disponivel");
    await tocar("Salvar contato", dialogo());
    expect(fronteiras.chamar).toHaveBeenCalledTimes(1);
    expect(payload()).toMatchObject({
      customer_code: CLIENTE.code, nome: "Novo contato", email: "novo@cliente.example", papel: "outro",
      avisos: ["estoque_disponivel"], idempotency_key: expect.any(String),
    });
    expect(payload()).not.toHaveProperty("contato_id");
    expect(dialogo().textContent).toContain(`Avisos por e-mail · ${CLIENTE.name}`);
    for (const [, init] of vi.mocked(fetch).mock.calls) expect(init?.method ?? "GET").toBe("GET");
    expect(fronteiras.chamar.mock.calls.every(([name]) => name === "saveCustomerContact")).toBe(true);
  });

  it("editar altera somente os avisos de estoque e preserva os avisos de OS e NF existentes", async () => {
    await abrir();
    await publicar([CONTATO]);
    await tocar("Editar", linhaDoContato());
    expect(dialogo().textContent).toContain(`Editar ${CONTATO.nome} · ${CLIENTE.name}`);
    expect((document.getElementById("contato-papel") as HTMLSelectElement).disabled).toBe(true);
    expect(document.getElementById("contato-aviso-estoque_parado")?.getAttribute("aria-checked")).toBe("true");
    expect(dialogo().querySelectorAll('[role="checkbox"]')).toHaveLength(2);
    await marcar("estoque_parado");
    await marcar("estoque_disponivel");
    await tocar("Salvar contato", dialogo());
    expect(payload()).toMatchObject({
      customer_code: CLIENTE.code, contato_id: CONTATO.id, nome: CONTATO.nome,
      avisos: ["os_concluida", "nf_emitida", "estoque_disponivel"],
    });
    expect(payload()).not.toHaveProperty("email");
  });

  it("desativa e reativa o contato sem apagar suas preferências", async () => {
    await abrir();
    await publicar([CONTATO]);
    await tocar("Desativar", linhaDoContato());
    const desativacao = payload();
    expect(desativacao).toMatchObject({ customer_code: CLIENTE.code, contato_id: CONTATO.id, nome: CONTATO.nome, ativo: false });
    expect(desativacao).not.toHaveProperty("avisos");
    await publicar([{ ...CONTATO, ativo: false }]);
    await tocar("Reativar", linhaDoContato());
    expect(payload()).toMatchObject({ customer_code: CLIENTE.code, contato_id: CONTATO.id, ativo: true });
    expect(payload()).not.toHaveProperty("avisos");
    expect(payload().idempotency_key).not.toBe(desativacao.idempotency_key);
  });

  it("resposta perdida preserva a chave e os campos; envio em andamento bloqueia submissão duplicada", async () => {
    await novoContato();
    await marcar("estoque_disponivel");
    fronteiras.chamar.mockRejectedValueOnce(new Error("Resposta perdida; tente novamente."));
    await tocar("Salvar contato", dialogo());
    const primeiro = payload();
    expect(dialogo().textContent).toContain("Resposta perdida; tente novamente.");
    expect((document.getElementById("contato-email") as HTMLInputElement).value).toBe("novo@cliente.example");
    let concluir!: (result: unknown) => void;
    fronteiras.chamar.mockImplementationOnce(() => new Promise((resolve) => { concluir = resolve; }));
    const form = dialogo().querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(fronteiras.chamar).toHaveBeenCalledTimes(2);
    expect(payload()).toEqual(primeiro);
    await act(async () => concluir({ data: { contato_id: "ct_novo" } }));
    expect(dialogo().textContent).toContain(`Avisos por e-mail · ${CLIENTE.name}`);
    await tocar("Novo contato", dialogo());
    await preencher("contato-nome", "Outra pessoa");
    await preencher("contato-email", "outra@cliente.example");
    await tocar("Salvar contato", dialogo());
    expect(payload().idempotency_key).not.toBe(primeiro.idempotency_key);
    expect(payload().avisos).toEqual([]);
  });

  it("desativação repetida após falha mantém a chave e bloqueia dois cliques enquanto grava", async () => {
    await abrir();
    await publicar([CONTATO]);
    fronteiras.chamar.mockRejectedValueOnce(new Error("Falha ao desativar."));
    await tocar("Desativar", linhaDoContato());
    const primeira = payload();
    expect(dialogo().textContent).toContain("Falha ao desativar.");
    let concluir!: (result: unknown) => void;
    fronteiras.chamar.mockImplementationOnce(() => new Promise((resolve) => { concluir = resolve; }));
    const button = botao("Desativar", linhaDoContato())!;
    await act(async () => { button.click(); button.click(); });
    expect(fronteiras.chamar).toHaveBeenCalledTimes(2);
    expect(payload()).toEqual(primeira);
    await act(async () => concluir({ data: { contato_id: CONTATO.id } }));
  });

  it("trocar o cliente descarta lista, erro e formulário anteriores antes da próxima leitura", async () => {
    const fechar = vi.fn();
    const render = async (customer: typeof CLIENTE) => {
      await act(async () => root.render(<SettingsCustomerNotifications customer={customer} onClose={fechar} />));
    };
    await render(CLIENTE);
    await publicar([CONTATO]);
    await tocar("Editar", linhaDoContato());
    await preencher("contato-nome", "Rascunho do Itaú");
    fronteiras.chamar.mockRejectedValueOnce(new Error("Falha do Itaú."));
    await tocar("Salvar contato", dialogo());
    expect(dialogo().textContent).toContain("Falha do Itaú.");
    const antiga = assinatura();
    await render(OUTRO_CLIENTE);
    expect(antiga.parar).toHaveBeenCalledTimes(1);
    expect(dialogo().textContent).toContain(`Avisos por e-mail · ${OUTRO_CLIENTE.name}`);
    expect(dialogo().textContent).toContain("Carregando contatos…");
    expect(dialogo().textContent).not.toContain(CONTATO.nome);
    expect(dialogo().textContent).not.toContain("Falha do Itaú.");
    expect(document.getElementById("contato-nome")).toBeNull();
    await publicar([], OUTRO_CLIENTE.code);
    await tocar("Novo contato", dialogo());
    expect((document.getElementById("contato-nome") as HTMLInputElement).value).toBe("");
    await preencher("contato-nome", "Contato Safra");
    await preencher("contato-email", "contato@safra.example");
    await tocar("Salvar contato", dialogo());
    expect(payload().customer_code).toBe(OUTRO_CLIENTE.code);
  });

  it("lista e edição mantêm um único diálogo, textos previstos e acessibilidade", async () => {
    await abrir();
    await publicar([CONTATO]);
    expect(textosForaDaLista(dialogo().innerHTML, [
      `Avisos por e-mail · ${CLIENTE.name}`, "Fechar", "Novo contato", CONTATO.nome, CONTATO.email,
      "Ativo", "Editar", "Desativar", "Itens parados", "Produtos disponíveis em estoque", "Gestor do cliente",
    ])).toEqual([]);
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
    await tocar("Editar", linhaDoContato());
    expect(textosForaDaLista(dialogo().innerHTML, [
      `Editar ${CONTATO.nome} · ${CLIENTE.name}`, "Fechar", "Nome", "Empresa", "Papel", "—", "Gestor do cliente",
      "Gerenciadora", "Financeiro", "Outro", "E-mail", "Telefone", "Avisos por e-mail", "Itens parados",
      "Produtos disponíveis em estoque", "Cancelar", "Salvar contato",
    ])).toEqual([]);
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
    await tocar("Cancelar", dialogo());
    expect(dialogo().textContent).toContain(`Avisos por e-mail · ${CLIENTE.name}`);
    expect(fronteiras.chamar).not.toHaveBeenCalled();
  });
});
