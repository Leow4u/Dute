import { afterEach, beforeEach, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ currentUser: { getIdToken: vi.fn(async () => "human-id-token") } as null | { getIdToken: ReturnType<typeof vi.fn> } }));
vi.mock("../firebase", () => ({ firebaseAuth: session }));
import { apiBase, criarIntegracao, listarIntegracoes, revogarIntegracao } from "./api";

beforeEach(() => { session.currentUser = { getIdToken: vi.fn(async () => "human-id-token") }; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("resolve a base por projeto e só usa emulador explicitamente", () => {
  expect(apiBase("dute-prod")).toBe("https://southamerica-east1-dute-prod.cloudfunctions.net/duteApi/api/v1");
  expect(apiBase("demo-dute-local", true)).toBe("http://127.0.0.1:5101/demo-dute-local/southamerica-east1/duteApi/api/v1");
  expect(() => apiBase("")).toThrow();
});

it("envia token humano atual sem cookies, cache, redirects ou repetição", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { id: "a", token: "one-time", expires_at: "2026-11-25T00:00:00Z" } }), { status: 201 }));
  vi.stubGlobal("fetch", fetcher);
  const input = { name: "Parceiro", scopes: ["operacao:ler"] as const, customers: ["A"], expires_in_days: 30, write_policy: "scoped" as const };
  expect((await criarIntegracao({ ...input, scopes: [...input.scopes] })).token).toBe("one-time");
  expect(fetcher).toHaveBeenCalledTimes(1);
  const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(options[1]).toMatchObject({ method: "POST", cache: "no-store", credentials: "omit", redirect: "error" });
  expect(new Headers(options[1].headers).get("Authorization")).toBe("Bearer human-id-token");
  expect(JSON.parse(String(options[1].body))).toEqual(input);
});

it("lista com cursor e revoga a chave por id", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [], next_cursor: null })));
  vi.stubGlobal("fetch", fetcher);
  await listarIntegracoes("a".repeat(32));
  await revogarIntegracao("a".repeat(32));
  expect(String(fetcher.mock.calls[0][0])).toContain("/integrations?limit=50&cursor=");
  expect(String(fetcher.mock.calls[1][0])).toContain(`/integrations/${"a".repeat(32)}`);
});

it("não chama a API sem sessão e não repete uma criação que falha", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Somente owner/admin." } }), { status: 403 }));
  vi.stubGlobal("fetch", fetcher);
  session.currentUser = null;
  await expect(listarIntegracoes()).rejects.toThrow("Entre novamente");
  expect(fetcher).not.toHaveBeenCalled();
  session.currentUser = { getIdToken: vi.fn(async () => "human-id-token") };
  await expect(criarIntegracao({ name: "Parceiro", scopes: ["operacao:ler"], customers: ["A"], expires_in_days: 30, write_policy: "scoped" as const })).rejects.toThrow("Somente owner/admin.");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("perda de conexão não repete criação e orienta conferir/revogar uma chave sem recibo", async () => {
  const fetcher = vi.fn(async () => { throw new TypeError("network"); });
  vi.stubGlobal("fetch", fetcher);
  await expect(criarIntegracao({ name: "Parceiro", scopes: ["operacao:ler"], customers: ["A"], expires_in_days: 30, write_policy: "scoped" as const })).rejects.toThrow("Confira a lista antes de tentar novamente");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('usa endpoints pessoais e nunca inclui clientes na criação pessoal', async () => {
  const { criarChavePessoal, listarChavesPessoais, obterCapabilities, revogarChavePessoal } = await import('./api');
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'a', token: 'one-time', expires_at: '2099-01-01' }, next_cursor: null })));
  vi.stubGlobal('fetch', fetcher);
  await obterCapabilities();
  await listarChavesPessoais('cursor');
  await criarChavePessoal({ name: 'Pessoal', permission: 'read_only', expires_in_days: 90 });
  await revogarChavePessoal('a'.repeat(32));
  const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
  expect(calls[0][0]).toContain('/api-keys/capabilities');
  expect(calls[1][0]).toContain('/api-keys?limit=50&cursor=cursor');
  expect(JSON.parse(String(calls[2][1].body))).toEqual({ name: 'Pessoal', permission: 'read_only', expires_in_days: 90 });
  expect(calls[2][1]).toMatchObject({ cache: 'no-store', method: 'POST' });
  expect(calls[3][0]).toContain(`/api-keys/${'a'.repeat(32)}`);
});
