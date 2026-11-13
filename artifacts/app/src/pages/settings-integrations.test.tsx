// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({ create: vi.fn(), revoke: vi.fn(), list: vi.fn(), capabilities: vi.fn(), role: 'cliente' }));
vi.mock('@/lib/integracoes/api', () => ({ criarChavePessoal: mocks.create, revogarChavePessoal: mocks.revoke, listarChavesPessoais: mocks.list, obterCapabilities: mocks.capabilities, INTEGRACOES_API_BASE: 'https://example.invalid/api/v1' }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock('@/lib/auth', () => ({ useAppUser: () => ({ user: { uid: 'user', publicMetadata: { role: mocks.role } } }) }));
import SettingsIntegrations from './settings-integrations';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root; let container: HTMLDivElement; let client: QueryClient;
async function wait(assertion: () => void) { await vi.waitFor(async () => { await act(async () => {}); assertion(); }); }
// O botão pelo rótulo; o botão de ação (BotaoDeAcao, parte 13e), pela camada que está na tela.
async function click(label: string) { let button: HTMLButtonElement | undefined; await wait(() => { button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label || b.querySelector('.botao-acao-camada[data-atual]')?.textContent?.trim() === label); expect(button).toBeTruthy(); }); await act(async () => button!.click()); }
// O segundo toque do botão de ação dentro de 1 s é o toque duplo: a nova tentativa vem depois.
async function depoisDoToqueDuplo() { await act(async () => new Promise(resolve => setTimeout(resolve, 1_000))); }
async function value(selector: string, text: string) { await act(async () => { const el = document.querySelector<HTMLInputElement>(selector)!; Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, text); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }); }
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><SettingsIntegrations /></QueryClientProvider>)); await wait(() => expect(container.textContent).toContain('Nenhuma chave')); }
async function form() { await render(); await click('Criar chave de API'); await wait(() => expect(document.querySelector('#key-name')).toBeTruthy()); await value('#key-name', 'Minha chave'); }
beforeEach(() => { mocks.role = 'cliente'; mocks.create.mockReset().mockResolvedValue({ id: 'a'.repeat(32), token: 'SECRET_TEST', expires_at: '2099-01-01' }); mocks.list.mockReset().mockResolvedValue({ data: [], next_cursor: null }); mocks.revoke.mockReset().mockResolvedValue(undefined); mocks.capabilities.mockReset().mockResolvedValue({ scopes: ['operacao:ler'], role: 'cliente', customer_access: 'own' }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } }); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); });
it('conta comum cria full sem clientes, copia e descarta segredo sem caches', async () => { await form(); expect(document.body.textContent).not.toContain('Clientes autorizados'); await click('Criar chave'); expect(mocks.create).toHaveBeenCalledWith({ name: 'Minha chave', permission: 'full', expires_in_days: 90 }); await wait(() => expect(document.querySelector('textarea')?.value).toBe('SECRET_TEST')); expect(JSON.stringify(client.getQueryCache().getAll().map(q => q.state.data))).not.toContain('SECRET_TEST'); expect(client.getMutationCache().getAll()).toHaveLength(0); expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('SECRET_TEST'); await click('Copiar chave'); expect(navigator.clipboard.writeText).toHaveBeenCalledWith('SECRET_TEST'); await click('Concluir'); expect(document.querySelector('textarea')).toBeNull(); });
it('cancelar e validade inválida não criam; bloqueia duplicação', async () => { await form(); await value('#key-expiry', '91'); await click('Criar chave'); expect(mocks.create).not.toHaveBeenCalled(); await click('Cancelar'); await click('Criar chave de API'); await value('#key-name', 'Minha chave'); let resolve!: (x: unknown) => void; mocks.create.mockReturnValue(new Promise(r => resolve = r)); await click('Criar chave'); await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); expect(mocks.create).toHaveBeenCalledTimes(1); await act(async () => resolve({ id: 'a', token: 'SECRET_TEST', expires_at: '2099-01-01' })); });
it('leitura com capabilities vazias e erro preservam formulário', async () => { mocks.capabilities.mockResolvedValue({ scopes: [], role: 'campo', customer_access: 'none' }); await form(); expect(document.body.textContent).toContain('Nenhuma operação disponível'); await value('#key-permission', 'read_only'); mocks.create.mockRejectedValueOnce(new Error('Falha controlada')); await click('Criar chave'); expect(document.body.textContent).toContain('Falha controlada'); await depoisDoToqueDuplo(); await click('Criar chave'); expect(mocks.create).toHaveBeenLastCalledWith({ name: 'Minha chave', permission: 'read_only', expires_in_days: 90 }); vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error()); await click('Copiar chave'); expect(document.body.textContent).toContain('Selecione e copie'); });
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

/**
 * Chaves de API no carregamento v2 (parte 13e): a espera com a caixa e o
 * rótulo, sem região viva solta; a falha com "Tentar de novo"; e o criar e o
 * revogar como o botão de ação, com o Cancelar `aria-disabled` e o diálogo
 * preso enquanto grava, nunca `disabled`. Dados sintéticos.
 */
const espera = (ms: number) => act(async () => new Promise(resolve => setTimeout(resolve, ms)));
const camada = (button: Element | null | undefined) => button?.querySelector('.botao-acao-camada[data-atual]')?.textContent;

it('as permissões lendo, no diálogo: Carregando permissões… com a caixa, sem role=status solto', async () => {
  const { textosForaDaLista } = await import('@/test/textos');
  mocks.capabilities.mockReturnValue(new Promise(() => undefined));
  await render();
  await click('Criar chave de API');
  await wait(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Carregando permissões…'));
  const dialogo = document.querySelector('[role="dialog"]')!;
  expect(dialogo.querySelector('[data-carregando-na-regiao] [data-spinner]')).not.toBeNull();
  expect(textosForaDaLista(dialogo.outerHTML, ['Criar chave de API', 'Defina o nome e a permissão da sua chave pessoal.', 'Carregando permissões…', 'Fechar'])).toEqual([]);
});

it('a lista lendo: Carregando chaves… com a caixa aos 300 ms, sem role=status solto', async () => {
  mocks.list.mockReturnValue(new Promise(() => undefined));
  await act(async () => root.render(<QueryClientProvider client={client}><SettingsIntegrations /></QueryClientProvider>));
  expect(container.textContent).not.toContain('Carregando chaves…');
  // Espera o estado chegar, e não um tempo fixo: com a máquina ocupada, 360 ms logo depois do marco falham à toa.
  await wait(() => expect(container.textContent).toContain('Carregando chaves…'));
  expect(container.textContent).toContain('Carregando chaves…');
  expect(container.querySelector('[data-carregando-na-regiao] [data-spinner]')).not.toBeNull();
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it('a lista que falhou: a falha com Tentar de novo, que lê outra vez', async () => {
  mocks.list.mockRejectedValueOnce(new Error('Falhou.'));
  await act(async () => root.render(<QueryClientProvider client={client}><SettingsIntegrations /></QueryClientProvider>));
  await wait(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível carregar as chaves.'));
  await click('Tentar de novo');
  await wait(() => expect(container.textContent).toContain('Nenhuma chave criada'));
  expect(mocks.list).toHaveBeenCalledTimes(2);
});

it('criar: Criando… com aria-busy, o Cancelar aria-disabled e o diálogo preso, nunca disabled', async () => {
  await form();
  mocks.create.mockReturnValue(new Promise(() => undefined));
  await click('Criar chave');
  await wait(() => expect(document.querySelector('[role="dialog"] button[aria-busy="true"]')).not.toBeNull());
  const dialogo = document.querySelector('[role="dialog"]')!;
  const criar = dialogo.querySelector<HTMLButtonElement>('button[aria-busy="true"]')!;
  expect(camada(criar)).toBe('Criando…');
  expect(criar.disabled).toBe(false);
  const cancelar = [...dialogo.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === 'Cancelar')!;
  expect(cancelar.getAttribute('aria-disabled')).toBe('true');
  expect(cancelar.disabled).toBe(false);
  await act(async () => cancelar.click());
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it('revogar: Revogando… com aria-busy, o Cancelar aria-disabled e a confirmação presa; no sucesso, fecha', async () => {
  mocks.list.mockResolvedValue({ data: [{ id: 'a'.repeat(32), name: 'Antiga', token_prefix: 'dute_abc…', permission: 'full', kind: 'personal', scopes: [], created_at: null, last_used_at: null, expires_at: '2099-01-01', revoked: false, write_policy: 'scoped' }], next_cursor: null });
  let soltar!: () => void;
  mocks.revoke.mockReturnValue(new Promise<void>(resolve => { soltar = resolve; }));
  await act(async () => root.render(<QueryClientProvider client={client}><SettingsIntegrations /></QueryClientProvider>));
  await wait(() => expect(container.textContent).toContain('dute_abc…'));
  await click('Revogar');
  await click('Revogar chave');
  await wait(() => expect(document.querySelector('[role="alertdialog"] button[aria-busy="true"]')).not.toBeNull());
  const confirmacao = document.querySelector('[role="alertdialog"]')!;
  const { textosForaDaLista } = await import('@/test/textos');
  expect(textosForaDaLista(confirmacao.outerHTML, ['Revogar chave?', /^A chave Antiga perderá o acesso imediatamente\./, 'Cancelar', 'Revogar chave', 'Revogando…', 'Conferir', 'Fechar'])).toEqual([]);
  const revogar = confirmacao.querySelector<HTMLButtonElement>('button[aria-busy="true"]')!;
  expect(camada(revogar)).toBe('Revogando…');
  expect(revogar.disabled).toBe(false);
  const cancelar = [...confirmacao.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === 'Cancelar')!;
  expect(cancelar.getAttribute('aria-disabled')).toBe('true');
  expect(cancelar.disabled).toBe(false);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  await act(async () => soltar());
  await wait(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
});

const UMA_CHAVE = { id: 'b'.repeat(32), name: 'Integração', token_prefix: 'dute_int…', permission: 'full', kind: 'personal', scopes: [], created_at: null, last_used_at: null, expires_at: '2099-01-01', revoked: false, write_policy: 'scoped' };
const TEXTOS_DA_TELA = [
  'Chaves de API', 'Gerencie as chaves pessoais que acessam o Dute em seu nome.', 'Criar chave de API', 'Cada chave acompanha o acesso atual da sua conta.',
  'Documentação da API', 'Buscar chave', 'Status', 'Todas', 'Ativa', 'Expirada', 'Revogada', 'Nome e chave', 'Permissão', 'Criada em', 'Validade',
  'Último uso', 'Ações', 'Integração', 'dute_int…', 'Acesso total', 'Acompanha as permissões atuais da conta.', '—', 'Nunca', 'Revogar', 'Suas chaves de API',
  'Carregando chaves…', 'Carregando…', 'Carregar mais', 'Não carregou', 'Não foi possível carregar mais chaves.', 'Não foi possível atualizar as chaves.',
  'Tentar de novo', 'Tentando de novo…', 'Conferir', /^\d{2}\/\d{2}\/\d{4}, /,
];

it('a releitura que falha com a lista na tela: a lista fica, e a falha escrita em cima, sem falar', async () => {
  const { textosForaDaLista } = await import('@/test/textos');
  mocks.list.mockResolvedValueOnce({ data: [UMA_CHAVE], next_cursor: null }).mockRejectedValueOnce(new Error('Falhou.'));
  await act(async () => root.render(<QueryClientProvider client={client}><SettingsIntegrations /></QueryClientProvider>));
  await wait(() => expect(container.textContent).toContain('dute_int…'));
  await act(async () => { await client.refetchQueries({ queryKey: ['personal-api-keys', 'user'] }).catch(() => undefined); });
  await wait(() => expect(container.querySelector('[data-falha-na-secao]')?.textContent).toContain('Não foi possível atualizar as chaves.'));
  expect(container.textContent).toContain('dute_int…');
  expect(container.querySelector('[data-falha-na-secao] [role="alert"]')).toBeNull();
  expect(textosForaDaLista(container.innerHTML, TEXTOS_DA_TELA)).toEqual([]);
});

it('a página seguinte que não veio: o botão diz Não carregou, e o motivo fica escrito, falado uma vez', async () => {
  const { textosForaDaLista } = await import('@/test/textos');
  const { violacoesDeAcessibilidade } = await import('@/test/acessibilidade');
  mocks.list.mockResolvedValueOnce({ data: [UMA_CHAVE], next_cursor: 'c2' }).mockRejectedValueOnce(new Error('Falhou.'));
  await act(async () => root.render(<QueryClientProvider client={client}><SettingsIntegrations /></QueryClientProvider>));
  await wait(() => expect(container.textContent).toContain('dute_int…'));
  await click('Carregar mais');
  await wait(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe('Não foi possível carregar mais chaves.'));
  const botao = [...container.querySelectorAll('button')].find(b => b.querySelector('.botao-acao-camada[data-atual]'))!;
  expect(camada(botao)).toBe('Não carregou');
  expect(botao.className).toContain('max-md:min-h-11');
  // Passados 2 s, o botão volta a Carregar mais, que tenta de novo; o motivo fica.
  await vi.waitFor(async () => { await act(async () => {}); expect(camada(botao)).toBe('Carregar mais'); }, { timeout: 4_000 });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Não foi possível carregar mais chaves.');
  expect(textosForaDaLista(container.innerHTML, TEXTOS_DA_TELA)).toEqual([]);
  expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
}, 10_000);

it('sem rede e sem nada lido: o aviso da conexão, e não o erro vermelho', async () => {
  const { SemConexao } = await import('@/lib/conexao');
  mocks.list.mockRejectedValue(new SemConexao());
  await act(async () => root.render(<QueryClientProvider client={client}><SettingsIntegrations /></QueryClientProvider>));
  await wait(() => expect(container.querySelector('[data-falta]')).not.toBeNull());
  expect(container.textContent).not.toContain('Não foi possível carregar as chaves.');
  expect(container.textContent).toMatch(/Sem conexão\.|Reconectando…/);
});

it('criar pelo Enter no campo Nome: os campos ficam só para leitura, nunca disabled, e o foco fica no campo', async () => {
  await form();
  let resolve!: (x: unknown) => void;
  mocks.create.mockReturnValue(new Promise(r => resolve = r));
  const nome = document.querySelector<HTMLInputElement>('#key-name')!;
  nome.focus();
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(nome.disabled).toBe(false);
  expect(nome.readOnly).toBe(true);
  expect(nome.getAttribute('aria-disabled')).toBe('true');
  expect(document.querySelector<HTMLSelectElement>('#key-permission')!.disabled).toBe(false);
  expect(document.querySelector<HTMLInputElement>('#key-expiry')!.disabled).toBe(false);
  expect(document.activeElement).toBe(nome);
  // Mudar a permissão durante a criação não muda nada.
  await value('#key-permission', 'read_only');
  expect(document.querySelector<HTMLSelectElement>('#key-permission')!.value).toBe('full');
  await act(async () => resolve({ id: 'a', token: 'SECRET_TEST', expires_at: '2099-01-01' }));
});

it('o link da documentação em tinta e sublinhado, nunca o vermelho de 4,2:1 sobre o fundo', async () => {
  await render();
  const link = [...container.querySelectorAll('a')].find(a => a.textContent?.includes('Documentação da API'))!;
  expect(link.className).toContain('text-foreground');
  expect(link.className).not.toContain('text-primary');
  expect(link.className).toContain('underline');
});
