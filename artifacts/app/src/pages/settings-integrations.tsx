import { useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { PersonalKeyForm } from '@/components/integracoes/personal-key-form';
import { CreatedKey } from '@/components/integracoes/created-key';
import { useAppUser } from '@/lib/auth';
import { INTEGRACOES_API_BASE, listarChavesPessoais, obterCapabilities, revogarChavePessoal } from '@/lib/integracoes/api';
import { integrationStatus, PERMISSOES, type CreatedIntegration, type PersonalKeyRow } from '@/lib/integracoes/model';

const permissions = { full: 'Acesso total', read_only: 'Somente leitura', custom: 'Personalizada', legacy: 'Legada' };
const date = (value: string | null) => value ? new Date(value).toLocaleString('pt-BR') : '—';
export default function SettingsIntegrations() {
  const { user } = useAppUser();
  return user ? <Keys key={user.uid} uid={user.uid} /> : <PageHeader title="Entre na sua conta" />;
}
function Keys({ uid }: { uid: string }) {
  const client = useQueryClient();
  const queryKey = ['personal-api-keys', uid];
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Apenas memória do componente: nunca usar mutation/cache/storage para o segredo.
  const [credential, setCredential] = useState<CreatedIntegration | null>(null);
  const [revoking, setRevoking] = useState<PersonalKeyRow | null>(null);
  const [pending, setPending] = useState(false);
  const revokingRef = useRef(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('Todas');
  const list = useInfiniteQuery({ queryKey, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam, signal }) => listarChavesPessoais(pageParam, signal), getNextPageParam: last => last.next_cursor ?? undefined, retry: false });
  const capabilities = useQuery({ queryKey: ['api-key-capabilities', uid], enabled: creating, queryFn: ({ signal }) => obterCapabilities(signal), retry: false, staleTime: 0 });
  async function revoke() {
    if (!revoking || revokingRef.current) return;
    revokingRef.current = true; setPending(true); setError('');
    try { await revogarChavePessoal(revoking.id); setRevoking(null); await client.invalidateQueries({ queryKey }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível revogar a chave.'); }
    finally { revokingRef.current = false; setPending(false); }
  }
  const rows = list.data?.pages.flatMap(page => page.data) ?? [];
  const filtered = rows.filter(row => `${row.name} ${row.token_prefix}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (statusFilter === 'Todas' || integrationStatus(row) === statusFilter));
  const details = (row: PersonalKeyRow) => <><p className="text-xs text-muted-foreground">{row.scopes.map(scope => PERMISSOES.find(p => p.value === scope)?.label ?? scope).join(' · ') || 'Sem operações selecionadas'}</p>{row.kind === 'legacy' && <p className="mt-1 text-xs">Legada · {row.write_policy === 'scoped' ? 'Escrita autorizada pelas permissões selecionadas' : 'Escrita exige confirmação por ação'} · Política original preservada</p>}</>;
  const revokeButton = (row: PersonalKeyRow) => !row.revoked ? <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { setError(''); setRevoking(row); }}>Revogar</Button> : null;
  return <div>
    <PageHeader title="Chaves de API" description="Gerencie as chaves pessoais que acessam o Dute em seu nome." actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Criar chave de API</Button>} />
    <div className="my-6 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Cada chave acompanha o acesso atual da sua conta.</p><a href={`${INTEGRACOES_API_BASE}/openapi.json`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:underline"><ExternalLink className="h-4 w-4" />Documentação da API</a></div>
    <div className="mb-5 flex flex-wrap gap-4"><div className="min-w-48 flex-1 space-y-2"><Label htmlFor="key-search">Buscar chave</Label><Input id="key-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome ou prefixo" /></div><div className="space-y-2"><Label htmlFor="key-status">Status</Label><select id="key-status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="block h-10 rounded-md border bg-background px-3 text-sm">{['Todas', 'Ativa', 'Expirada', 'Revogada'].map(status => <option key={status}>{status}</option>)}</select></div></div>
    {list.isPending ? <p role="status">Carregando chaves…</p> : list.isError ? <div role="alert"><p>Não foi possível carregar as chaves.</p><Button variant="outline" onClick={() => void list.refetch()}>Tentar novamente</Button></div> : !filtered.length ? <div className="border-y py-12"><h2 className="font-semibold">{rows.length ? 'Nenhuma chave encontrada' : 'Nenhuma chave criada'}</h2><p className="mt-2 text-sm text-muted-foreground">Crie uma chave para conectar seu sistema.</p></div> : <>
      <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><caption className="sr-only">Suas chaves de API</caption><thead className="border-y bg-muted/40"><tr>{['Nome e chave', 'Permissão', 'Criada em', 'Validade', 'Último uso', 'Status', 'Ações'].map(label => <th key={label} scope="col" className="px-3 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{filtered.map(row => <tr key={row.id} className="border-b"><td className="max-w-xs px-3 py-4"><p className="break-words font-medium">{row.name}</p><code className="text-xs text-muted-foreground">{row.token_prefix}</code>{details(row)}</td><td className="px-3 py-4">{permissions[row.permission]}</td><td className="px-3 py-4">{date(row.created_at)}</td><td className="px-3 py-4">{date(row.expires_at)}</td><td className="px-3 py-4">{row.last_used_at ? date(row.last_used_at) : row.kind === 'legacy' ? 'Sem registro' : 'Nunca'}</td><td className="px-3 py-4">{integrationStatus(row)}</td><td className="px-3 py-4">{revokeButton(row)}</td></tr>)}</tbody></table></div>
      <ul className="space-y-3 md:hidden">{filtered.map(row => <li key={row.id} className="space-y-3 rounded-lg border p-4"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h2 className="break-words font-medium">{row.name}</h2><code className="break-all text-xs">{row.token_prefix}</code></div><span className="text-xs">{integrationStatus(row)}</span></div><p className="text-sm">{permissions[row.permission]}</p>{details(row)}<dl className="grid grid-cols-2 gap-2 text-xs"><dt>Criada em</dt><dd>{date(row.created_at)}</dd><dt>Validade</dt><dd>{date(row.expires_at)}</dd><dt>Último uso</dt><dd>{row.last_used_at ? date(row.last_used_at) : row.kind === 'legacy' ? 'Sem registro' : 'Nunca'}</dd></dl>{revokeButton(row)}</li>)}</ul>
    </>}
    {list.hasNextPage && <Button variant="outline" className="mt-5" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}</Button>}
    <Dialog open={creating} onOpenChange={open => { if (!generating) { setCreating(open); if (!open) setCredential(null); } }}><DialogContent className="v3 max-h-[90dvh] overflow-y-auto" onEscapeKeyDown={event => { if (generating) event.preventDefault(); }} onInteractOutside={event => { if (generating) event.preventDefault(); }}><DialogHeader><DialogTitle>{credential ? 'Guarde sua chave' : 'Criar chave de API'}</DialogTitle><DialogDescription>{credential ? 'O segredo será descartado ao fechar esta janela.' : 'Defina o nome e a permissão da sua chave pessoal.'}</DialogDescription></DialogHeader>{credential ? <CreatedKey credential={credential} onDone={() => { setCredential(null); setCreating(false); }} /> : capabilities.isPending ? <p role="status">Carregando permissões…</p> : capabilities.isError ? <div role="alert"><p>Não foi possível carregar as permissões.</p><Button variant="outline" onClick={() => void capabilities.refetch()}>Tentar novamente</Button></div> : <PersonalKeyForm capabilities={capabilities.data} onPendingChange={setGenerating} onCancel={() => setCreating(false)} onCreated={key => { setCredential(key); void client.invalidateQueries({ queryKey }); }} />}</DialogContent></Dialog>
    <AlertDialog open={!!revoking} onOpenChange={open => { if (!open && !pending) setRevoking(null); }}><AlertDialogContent className="v3"><AlertDialogHeader><AlertDialogTitle>Revogar chave?</AlertDialogTitle><AlertDialogDescription>A chave {revoking?.name} perderá o acesso imediatamente. Para conectar novamente, crie outra chave.</AlertDialogDescription></AlertDialogHeader>{error && <p role="alert" className="text-destructive">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel><Button variant="destructive" disabled={pending} onClick={() => void revoke()}>{pending ? 'Revogando…' : 'Revogar chave'}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
