import { useRef, useState, type FormEvent } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { criarIntegracao } from "@/lib/integracoes/api";
import { integrationProblem, PERMISSOES, type CreatedIntegration, type IntegrationInput } from "@/lib/integracoes/model";

export type IntegrationCustomer = { code: string; name: string };

export function IntegrationForm({ customers, onCreated, onCancel, onPendingChange }: {
  customers: IntegrationCustomer[]; onCreated: (key: CreatedIntegration) => void; onCancel: () => void; onPendingChange: (pending: boolean) => void;
}) {
  const [input, setInput] = useState<IntegrationInput>({ name: "", customers: [], scopes: ["operacao:ler"], expires_in_days: 30 });
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    const problem = integrationProblem(input);
    if (problem) { setError(problem); return; }
    sending.current = true; setPending(true); onPendingChange(true); setError(null);
    try { onCreated(await criarIntegracao({ ...input, name: input.name.trim() })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível gerar a chave."); }
    finally { sending.current = false; setPending(false); onPendingChange(false); }
  }
  const visible = customers.filter((c) => `${c.name} ${c.code}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));
  return (
    <form onSubmit={submit} noValidate aria-label="Nova integração">
      <fieldset disabled={pending} className="min-w-0 space-y-7">
        <div className="space-y-2">
          <Label htmlFor="integration-name">Nome da integração</Label>
          <Input id="integration-name" value={input.name} maxLength={80} autoComplete="off" placeholder="Ex.: Sistema do parceiro" onChange={(e) => setInput({ ...input, name: e.target.value })} required />
        </div>
        <div className="space-y-2">
          <div id="integration-customers-label" className="text-sm font-medium">Clientes autorizados</div>
          <details className="rounded-lg border border-input" aria-labelledby="integration-customers-label">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-base md:text-sm">
              <span>{input.customers.length ? `${input.customers.length} cliente${input.customers.length > 1 ? "s" : ""} selecionado${input.customers.length > 1 ? "s" : ""}` : "Selecione os clientes"}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </summary>
            <div className="space-y-2 border-t border-border p-3">
              <Label htmlFor="integration-customer-search" className="sr-only">Buscar cliente</Label>
              <Input id="integration-customer-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome ou código" />
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {visible.map((customer) => (
                  <label key={customer.code} className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-2 text-sm">
                    <Checkbox aria-label={`Autorizar ${customer.name}`} checked={input.customers.includes(customer.code)} disabled={pending || (!input.customers.includes(customer.code) && input.customers.length >= 50)} onCheckedChange={(checked) => setInput({ ...input, customers: checked ? [...input.customers, customer.code] : input.customers.filter((c) => c !== customer.code) })} />
                    <span>{customer.name} <span className="text-muted-foreground">· {customer.code}</span></span>
                  </label>
                ))}
                {!visible.length && <p className="py-2 text-sm text-muted-foreground">Nenhum cliente encontrado.</p>}
              </div>
            </div>
          </details>
          {input.customers.length > 0 && <p className="text-xs text-muted-foreground">{input.customers.map((code) => customers.find((c) => c.code === code)?.name ?? code).join(", ")}</p>}
        </div>
        <fieldset className="space-y-4 border-y border-border py-6">
          <legend className="sr-only">Permissões da Operação</legend>
          <h2 className="text-base font-semibold">O que a integração pode fazer</h2>
          {PERMISSOES.map((permission) => (
            <label key={permission.value} className="flex cursor-pointer items-start gap-3 py-1">
              <Checkbox className="mt-0.5" checked={input.scopes.includes(permission.value)} onCheckedChange={(checked) => setInput({ ...input, scopes: checked ? [...input.scopes, permission.value] : input.scopes.filter((s) => s !== permission.value) })} />
              <span className="text-sm"><span className="font-medium">{permission.label}</span>{"hint" in permission && <span className="mt-1 block text-xs leading-5 text-muted-foreground">{permission.hint}</span>}</span>
            </label>
          ))}
        </fieldset>
        <div className="max-w-xs space-y-2">
          <Label htmlFor="integration-expiry">Validade da chave</Label>
          <select id="integration-expiry" value={input.expires_in_days} onChange={(e) => setInput({ ...input, expires_in_days: Number(e.target.value) })} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm" aria-describedby="integration-expiry-hint">
            {[7, 15, 30, 60, 90].map((days) => <option key={days} value={days}>{days} dias</option>)}
          </select>
          <p id="integration-expiry-hint" className="text-xs text-muted-foreground">Máximo de 90 dias.</p>
        </div>
      </fieldset>
      {error && <p role="alert" className="mt-5 text-sm text-destructive">{error}</p>}
      <div className="mt-7 flex flex-wrap gap-3">
        <Button type="submit" disabled={pending || !customers.length}>{pending ? "Gerando chave…" : "Gerar chave"}</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  );
}
