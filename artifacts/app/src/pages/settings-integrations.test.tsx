// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

const mocks = vi.hoisted(() => ({ create: vi.fn(), revoke: vi.fn(), list: vi.fn(), role: "owner" }));
vi.mock("@/lib/integracoes/api", () => ({
  criarIntegracao: mocks.create, revogarIntegracao: mocks.revoke, listarIntegracoes: mocks.list,
  INTEGRACOES_API_BASE: "https://example.invalid/api/v1",
}));
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "owner", publicMetadata: { role: mocks.role } } }) }));
import { MODULOS, PERMISSOES } from "@/lib/integracoes/model";
import SettingsIntegrations from "./settings-integrations";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
async function waitForUi(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await Promise.resolve(); });
    assertion();
  }, { timeout: 5000, interval: 10 });
}
const click = async (label: string) => {
  let button: HTMLButtonElement | undefined;
  await waitForUi(() => {
    button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label);
    expect(button, label).toBeTruthy();
  });
  await act(async () => { button!.click(); });

};
async function render() {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><SettingsIntegrations /></QueryClientProvider>);
  });
  await waitForUi(() => expect(container.textContent).not.toContain("Carregando integrações…"));
}
async function openForm() {
  await render();
  await click("Nova integração");
  await waitForUi(() => {
    expect(container.querySelector("#integration-name")).not.toBeNull();
    expect(container.querySelector('[aria-label="Autorizar Cliente Exemplo"]')).not.toBeNull();
  });
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>("#integration-name")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Parceiro externo");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    container.querySelector<HTMLButtonElement>('[aria-label="Autorizar Cliente Exemplo"]')!.click();
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mocks.role = "owner";
  mocks.create.mockReset().mockResolvedValue({ id: "a".repeat(32), token: "dute_TEST_ONLY", expires_at: "2026-11-25T00:00:00Z" });
  mocks.revoke.mockReset().mockResolvedValue(undefined);
  mocks.list.mockReset().mockResolvedValue({ data: [], next_cursor: null });
  // A resposta pode chegar depois do primeiro render do formulário, como no CI.
  vi.stubGlobal("fetch", vi.fn(async () => {
    await Promise.resolve();
    return new Response(JSON.stringify({ items: [{ code: "A", name: "Cliente Exemplo" }] }));
  }));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => undefined) } });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); vi.unstubAllGlobals(); });

it("cria com os escopos reais, mostra a chave uma vez, copia e descarta sem cache", async () => {
  await openForm();
  expect(textosForaDaLista(container.innerHTML, [
    "Integrações", "Nova integração", "Produção", "Homologação", "Nome da integração",
    "Clientes autorizados", "1 cliente selecionado", "Buscar cliente", "Cliente Exemplo", "· A",
    "Permissões da integração", "O que a integração pode fazer", "Consultar demandas, OS e agenda",
    "Consultar equipe e veículos", "Somente clientes autorizados.", "Recurso global: independe dos clientes selecionados.", "Criar demandas",
    "A chave autoriza criar e alterar dentro das permissões selecionadas.", "Planejar e agendar OS", "Validade da chave",
    "7 dias", "15 dias", "30 dias", "60 dias", "90 dias", "Máximo de 90 dias.", "Gerar chave", "Cancelar",
    "Como funciona", "Defina o acesso", "Escolha as permissões e, quando necessário, os clientes.",
    "Gere e copie a chave", "A chave será exibida uma única vez.", "Envie ao desenvolvedor",
    "Use um canal seguro para compartilhar.", "Documentação da API", "Código de cliente a autorizar", "Autorizar código", "Remover",
    "Autorize um código exato, inclusive para cadastrar um novo cliente no Comercial. Sem asteriscos ou barras.",
    ...MODULOS.map((module) => module.label), ...PERMISSOES.map((permission) => permission.label),
  ])).toEqual([]);
  expect(Array.from(container.querySelectorAll("legend")).map((legend) => legend.textContent)).toEqual(["Permissões da integração", ...MODULOS.map((module) => module.label)]);
  expect(container.querySelectorAll('button[role="checkbox"][aria-label]')).toHaveLength(PERMISSOES.length + 1);
  expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  await click("Gerar chave");
  expect(mocks.create).toHaveBeenCalledWith({ name: "Parceiro externo", customers: ["A"], scopes: ["operacao:ler"], expires_in_days: 30, write_policy: "scoped" });
  expect(container.textContent).toContain("Chave criada");
  expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("dute_TEST_ONLY");
  expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toContain("dute_TEST_ONLY");
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain("dute_TEST_ONLY");
  expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  await click("Copiar chave");
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("dute_TEST_ONLY");
  await click("Concluir");
  expect(container.querySelector("textarea")).toBeNull();
  expect(container.textContent).not.toContain("dute_TEST_ONLY");
});

it("não envia formulário inválido, cancelar não gera chave e pending impede duplo envio", async () => {
  await render(); await click("Nova integração"); await click("Gerar chave");
  expect(mocks.create).not.toHaveBeenCalled();
  await click("Cancelar"); expect(mocks.create).not.toHaveBeenCalled();
  await openForm();
  let resolve!: (value: unknown) => void;
  mocks.create.mockReturnValue(new Promise((done) => { resolve = done; }));
  await click("Gerar chave");
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  expect(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Integrações")?.disabled).toBe(true);
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ id: "a".repeat(32), token: "dute_TEST_ONLY", expires_at: "2026-11-25T00:00:00Z" }));
});

it("erro de criação mantém formulário e clipboard indisponível mantém chave para cópia manual", async () => {
  await openForm();
  mocks.create.mockRejectedValueOnce(new Error("Sem permissão."));
  await click("Gerar chave"); expect(container.textContent).toContain("Sem permissão.");
  await click("Gerar chave");
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("denied"));
  await click("Copiar chave");
  expect(container.textContent).toContain("Selecione e copie a chave manualmente");
  expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("dute_TEST_ONLY");
  expect(mocks.create).toHaveBeenCalledTimes(2);
});

it("revoga somente após confirmação e nega a tela a outros perfis", async () => {
  mocks.list.mockResolvedValue({ data: [{ id: "a".repeat(32), name: "Parceiro", customers: ["A"], scopes: ["operacao:ler"], expires_at: "2099-01-01T00:00:00Z", revoked: false }], next_cursor: null });
  await render(); await click("Revogar"); expect(mocks.revoke).not.toHaveBeenCalled();
  await click("Cancelar"); expect(mocks.revoke).not.toHaveBeenCalled();
  await click("Revogar"); await click("Revogar chave"); expect(mocks.revoke).toHaveBeenCalledWith("a".repeat(32));
  mocks.role = "suporte"; await render(); expect(container.textContent).toContain("Sem acesso");
  expect(container.textContent).not.toContain("Parceiro");
});

async function setValue(selector: string, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function togglePermission(label: string) {
  await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
}
it("gera uma chave global de RH sem clientes cadastrados", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }))));
  await render(); await click("Nova integração");
  await waitForUi(() => expect(container.querySelector("#integration-name")).not.toBeNull());
  await setValue("#integration-name", "Integração RH");
  await togglePermission("Consultar demandas, OS e agenda");
  await togglePermission("Consultar registros e vínculos do RH");
  await togglePermission("Criar e alterar registros do RH");
  expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  await click("Gerar chave");
  expect(mocks.create).toHaveBeenCalledWith({ name: "Integração RH", customers: [], scopes: ["rh:ler", "rh:registros:gravar"], expires_in_days: 30, write_policy: "scoped" });
});
it("autoriza e remove código futuro exato, recusando asteriscos e barras", async () => {
  await openForm();
  await click("Remover");
  await togglePermission("Consultar demandas, OS e agenda");
  await togglePermission("Criar e alterar cadastros comerciais");
  for (const code of ["*", "A/B", "A\\B"]) {
    await setValue("#integration-customer-code", code); await click("Autorizar código");
    expect(container.textContent).toContain("Informe um código exato, sem asteriscos ou barras.");
  }
  await setValue("#integration-customer-code", "FUTURO-01"); await click("Autorizar código");
  expect(container.querySelector('[aria-label="Remover cliente FUTURO-01"]')).not.toBeNull();
  await click("Remover");
  expect(container.querySelector('[aria-label="Remover cliente FUTURO-01"]')).toBeNull();
  await click("Gerar chave"); expect(mocks.create).not.toHaveBeenCalled();
  await setValue("#integration-customer-code", "FUTURO-01"); await click("Autorizar código");
  await click("Gerar chave");
  expect(mocks.create).toHaveBeenCalledWith({ name: "Parceiro externo", customers: ["FUTURO-01"], scopes: ["comercial:clientes:gravar"], expires_in_days: 30, write_policy: "scoped" });
});
it("exibe política por credencial sem ampliar as permissões legadas", async () => {
  const base = { customers: ["A"], scopes: ["operacao:ler"], expires_at: "2099-01-01T00:00:00Z", revoked: false };
  mocks.list.mockResolvedValue({ data: [
    { ...base, id: "a".repeat(32), name: "Legada sem política" },
    { ...base, id: "b".repeat(32), name: "Legada explícita", write_policy: "approval_required" },
    { ...base, id: "c".repeat(32), name: "Autorizada", write_policy: "scoped" },
  ], next_cursor: null });
  await render();
  const rows = Array.from(container.querySelectorAll("li"));
  expect(rows).toHaveLength(3);
  expect(rows[0].textContent).toContain("Escrita exige confirmação por ação");
  expect(rows[1].textContent).toContain("Escrita exige confirmação por ação");
  expect(rows[2].textContent).toContain("Escrita autorizada pelas permissões selecionadas");
  for (const row of rows) expect(row.textContent).not.toContain("Criar demandas");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
});
