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
import SettingsIntegrations from "./settings-integrations";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const click = async (label: string) => {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label);
  expect(button, label).toBeTruthy();
  await act(async () => { button!.click(); await tick(); });
};
async function render() {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><SettingsIntegrations /></QueryClientProvider>);
    await tick();
  });
  await act(async () => { await tick(); });
}
async function openForm() {
  await render();
  await click("Nova integração");
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
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [{ code: "A", name: "Cliente Exemplo" }] }))));
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
    "Permissões da Operação", "O que a integração pode fazer", "Consultar demandas, OS e agenda",
    "Consultar equipe e veículos", "Recursos compartilhados entre clientes.", "Criar demandas",
    "Exige aprovação humana a cada ação.", "Planejar e agendar OS", "Validade da chave",
    "7 dias", "15 dias", "30 dias", "60 dias", "90 dias", "Máximo de 90 dias.", "Gerar chave", "Cancelar",
    "Como funciona", "Defina o acesso", "Escolha os clientes e as permissões da Operação.",
    "Gere e copie a chave", "A chave será exibida uma única vez.", "Envie ao desenvolvedor",
    "Use um canal seguro para compartilhar.", "Documentação da API",
  ])).toEqual([]);
  expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  await click("Gerar chave");
  expect(mocks.create).toHaveBeenCalledWith({ name: "Parceiro externo", customers: ["A"], scopes: ["operacao:ler"], expires_in_days: 30 });
  expect(container.textContent).toContain("Chave criada");
  expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("dute_TEST_ONLY");
  expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toContain("dute_TEST_ONLY");
  expect(client.getMutationCache().getAll()).toHaveLength(0);
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
