// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({ create: vi.fn(), revoke: vi.fn(), list: vi.fn(), capabilities: vi.fn(), role: 'cliente' }));
vi.mock('@/lib/integracoes/api', () => ({ criarChavePessoal: mocks.create, revogarChavePessoal: mocks.revoke, listarChavesPessoais: mocks.list, obterCapabilities: mocks.capabilities, INTEGRACOES_API_BASE: 'https://example.invalid/api/v1' }));
vi.mock('@/lib/auth', () => ({ useAppUser: () => ({ user: { uid: 'user', publicMetadata: { role: mocks.role } } }) }));
import SettingsIntegrations from './settings-integrations';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root; let container: HTMLDivElement; let client: QueryClient;
async function wait(assertion: () => void) { await vi.waitFor(async () => { await act(async () => {}); assertion(); }); }
async function click(label: string) { let button: HTMLButtonElement | undefined; await wait(() => { button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label); expect(button).toBeTruthy(); }); await act(async () => button!.click()); }
async function value(selector: string, text: string) { await act(async () => { const el = document.querySelector<HTMLInputElement>(selector)!; Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, text); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }); }
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><SettingsIntegrations /></QueryClientProvider>)); await wait(() => expect(container.textContent).toContain('Nenhuma chave')); }
async function form() { await render(); await click('Criar chave de API'); await wait(() => expect(document.querySelector('#key-name')).toBeTruthy()); await value('#key-name', 'Minha chave'); }
beforeEach(() => { mocks.role = 'cliente'; mocks.create.mockReset().mockResolvedValue({ id: 'a'.repeat(32), token: 'SECRET_TEST', expires_at: '2099-01-01' }); mocks.list.mockReset().mockResolvedValue({ data: [], next_cursor: null }); mocks.revoke.mockReset().mockResolvedValue(undefined); mocks.capabilities.mockReset().mockResolvedValue({ scopes: ['operacao:ler'], role: 'cliente', customer_access: 'own' }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } }); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); });
it('conta comum cria full sem clientes, copia e descarta segredo sem caches', async () => { await form(); expect(document.body.textContent).not.toContain('Clientes autorizados'); await click('Criar chave'); expect(mocks.create).toHaveBeenCalledWith({ name: 'Minha chave', permission: 'full', expires_in_days: 90 }); await wait(() => expect(document.querySelector('textarea')?.value).toBe('SECRET_TEST')); expect(JSON.stringify(client.getQueryCache().getAll().map(q => q.state.data))).not.toContain('SECRET_TEST'); expect(client.getMutationCache().getAll()).toHaveLength(0); expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('SECRET_TEST'); await click('Copiar chave'); expect(navigator.clipboard.writeText).toHaveBeenCalledWith('SECRET_TEST'); await click('Concluir'); expect(document.querySelector('textarea')).toBeNull(); });
it('cancelar e validade inválida não criam; bloqueia duplicação', async () => { await form(); await value('#key-expiry', '91'); await click('Criar chave'); expect(mocks.create).not.toHaveBeenCalled(); await click('Cancelar'); await click('Criar chave de API'); await value('#key-name', 'Minha chave'); let resolve!: (x: unknown) => void; mocks.create.mockReturnValue(new Promise(r => resolve = r)); await click('Criar chave'); await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); expect(mocks.create).toHaveBeenCalledTimes(1); await act(async () => resolve({ id: 'a', token: 'SECRET_TEST', expires_at: '2099-01-01' })); });
it('leitura com capabilities vazias e erro preservam formulário', async () => { mocks.capabilities.mockResolvedValue({ scopes: [], role: 'campo', customer_access: 'none' }); await form(); expect(document.body.textContent).toContain('Nenhuma operação disponível'); await value('#key-permission', 'read_only'); mocks.create.mockRejectedValueOnce(new Error('Falha controlada')); await click('Criar chave'); expect(document.body.textContent).toContain('Falha controlada'); await click('Criar chave'); expect(mocks.create).toHaveBeenLastCalledWith({ name: 'Minha chave', permission: 'read_only', expires_in_days: 90 }); vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error()); await click('Copiar chave'); expect(document.body.textContent).toContain('Selecione e copie'); });
it('custom exibe apenas capabilities e exige seleção', async () => { await form(); await value('#key-permission', 'custom'); expect(document.querySelectorAll('input[type=checkbox]')).toHaveLength(1); await click('Criar chave'); expect(mocks.create).not.toHaveBeenCalled(); await act(async () => document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click()); await click('Criar chave'); expect(mocks.create).toHaveBeenCalledWith({ name: 'Minha chave', permission: 'custom', scopes: ['operacao:ler'], expires_in_days: 90 }); });
it('lista mascarada, legado, busca, filtro e revogação confirmada', async () => { mocks.list.mockResolvedValue({ data: [{ id: 'a'.repeat(32), name: 'Antiga', token_prefix: 'dute_abc…', permission: 'legacy', kind: 'legacy', scopes: ['operacao:ler'], created_at: null, last_used_at: null, expires_at: '2099-01-01', revoked: false, write_policy: 'approval_required' }], next_cursor: null }); await act(async () => root.render(<QueryClientProvider client={client}><SettingsIntegrations /></QueryClientProvider>)); await wait(() => expect(container.textContent).toContain('dute_abc…')); expect(container.textContent).toContain('Escrita exige confirmação por ação'); await value('#key-search', 'inexistente'); expect(container.textContent).toContain('Nenhuma chave encontrada'); await value('#key-search', ''); await value('#key-status', 'Revogada'); expect(container.textContent).toContain('Nenhuma chave encontrada'); await value('#key-status', 'Todas'); await click('Revogar'); expect(mocks.revoke).not.toHaveBeenCalled(); await click('Cancelar'); await click('Revogar'); await click('Revogar chave'); expect(mocks.revoke).toHaveBeenCalledWith('a'.repeat(32)); });

it('diálogo pessoal e revelação preservam acessibilidade', async () => {
  const { violacoesDeAcessibilidade } = await import('@/test/acessibilidade');
  await form();
  expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
  await click('Criar chave');
  expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
});

it('lista descreve full e somente leitura como acesso da conta mesmo sem escopos fixos', async () => {
  mocks.list.mockResolvedValue({ data: ['full', 'read_only'].map((permission, i) => ({
    id: String(i + 1).repeat(32), name: `Chave ${permission}`, token_prefix: `dute_${i}…`,
    permission, kind: 'personal', scopes: [], created_at: null, last_used_at: null,
    expires_at: '2099-01-01', revoked: false, write_policy: 'scoped',
  })), next_cursor: null });
  await act(async () => root.render(<QueryClientProvider client={client}><SettingsIntegrations /></QueryClientProvider>));
  await wait(() => expect(container.textContent).toContain('Acompanha as permissões atuais da conta'));
  expect(container.textContent).toContain('Somente as leituras permitidas pela conta');
  expect(container.textContent).not.toContain('Sem operações selecionadas');
});
