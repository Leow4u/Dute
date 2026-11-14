import { useRef, useState } from 'react';
import { BotaoDeAcao } from '@/components/ui/botao-de-acao';
import { DialogCancelar } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { criarChavePessoal } from '@/lib/integracoes/api';
import { PERMISSOES, type CreatedIntegration, type PersonalKeyCapabilities, type PersonalPermission } from '@/lib/integracoes/model';

export function PersonalKeyForm({ capabilities, onCreated, onCancel, onPendingChange }: { capabilities: PersonalKeyCapabilities; onCreated: (key: CreatedIntegration) => void; onCancel: () => void; onPendingChange: (pending: boolean) => void }) {
  const [name, setName] = useState('');
  const [permission, setPermission] = useState<PersonalPermission>('full');
  const [days, setDays] = useState('90');
  const [scopes, setScopes] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (submitting.current) return;
    const expiry = days === '' ? 90 : Number(days);
    if (name.trim().length < 2 || name.trim().length > 80) { setError('Informe um nome de 2 a 80 caracteres.'); return; }
    if (!Number.isInteger(expiry) || expiry < 1 || expiry > 90) { setError('A validade deve ser de 1 a 90 dias.'); return; }
    if (permission === 'custom' && (!scopes.length || scopes.some(scope => !capabilities.scopes.includes(scope)))) { setError('Selecione pelo menos uma permissão disponível.'); return; }
    submitting.current = true; setPending(true); onPendingChange(true); setError('');
    try { onCreated(await criarChavePessoal({ name: name.trim(), permission, expires_in_days: expiry, ...(permission === 'custom' ? { scopes } : {}) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar a chave.'); }
    finally { submitting.current = false; setPending(false); onPendingChange(false); }
  }
  return <form onSubmit={submit} noValidate className="space-y-5">
    <div className="space-y-2"><Label htmlFor="key-name">Nome</Label><Input id="key-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} autoComplete="off" readOnly={pending} aria-disabled={pending || undefined} placeholder="Ex.: Integração do meu sistema" /></div>
    <div className="space-y-2"><Label htmlFor="key-permission">Permissão</Label><select id="key-permission" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={permission} onChange={e => { if (!pending) setPermission(e.target.value as PersonalPermission); }} aria-disabled={pending || undefined}><option value="full">Acesso total</option><option value="read_only">Somente leitura</option><option value="custom">Personalizada</option></select><p className="text-xs text-muted-foreground">O acesso acompanha as permissões atuais da sua conta e as operações disponíveis na API. Somente leitura não permite gravações.</p></div>
    {!capabilities.scopes.length && <p role="status" className="text-sm text-muted-foreground">Nenhuma operação disponível para sua conta no momento. A chave só terá acesso quando sua conta tiver operações permitidas.</p>}
    {permission === 'custom' && <fieldset className="max-h-52 space-y-3 overflow-auto rounded-md border p-3"><legend className="px-1 text-sm font-medium">Permissões disponíveis</legend>{capabilities.scopes.map(scope => <label key={scope} className="flex items-start gap-2 text-sm"><input type="checkbox" aria-disabled={pending || undefined} checked={scopes.includes(scope)} onChange={e => { if (!pending) setScopes(current => e.target.checked ? [...current, scope] : current.filter(s => s !== scope)); }} />{PERMISSOES.find(p => p.value === scope)?.label ?? scope}</label>)}</fieldset>}
    <div className="space-y-2"><Label htmlFor="key-expiry">Validade em dias (opcional)</Label><Input id="key-expiry" type="number" min={1} max={90} value={days} onChange={e => setDays(e.target.value)} readOnly={pending} aria-disabled={pending || undefined} /><p className="text-xs text-muted-foreground">Padrão e máximo de 90 dias.</p></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {/* Ocupado não é desabilitado (parte 13e): os campos ficam só para leitura (aria-disabled, com a trava no código), e o
        foco que estava num deles, pelo Enter, não cai no body; o Cancelar segue o diálogo em ação, e o Criar é o botão de ação. */}
    <div className="flex justify-end gap-2"><DialogCancelar onClick={onCancel} /><BotaoDeAcao type="submit" estado={pending ? 'andamento' : 'repouso'} rotulo="Criar chave" andamento="Criando…" /></div>
  </form>;
}
