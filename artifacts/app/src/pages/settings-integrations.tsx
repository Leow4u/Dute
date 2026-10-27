import { useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { IntegrationForm, type IntegrationCustomer } from "@/components/integracoes/integration-form";
import { CreatedKey } from "@/components/integracoes/created-key";
import { useAppUser } from "@/lib/auth";
import { INTEGRACOES_API_BASE, listarIntegracoes, revogarIntegracao } from "@/lib/integracoes/api";
import { integrationStatus, PERMISSOES, type CreatedIntegration, type IntegrationRow } from "@/lib/integracoes/model";
import { cn } from "@/lib/utils";

export default function SettingsIntegrations() {
  const { user } = useAppUser();
  if (!user || !["owner", "admin"].includes(user.publicMetadata.role ?? "")) return <PageHeader title="Sem acesso" description="Somente owner/admin gerencia integrações." />;
  return <Integrations key={user.uid} uid={user.uid} />;
}

function Integrations({ uid }: { uid: string }) {
  const client = useQueryClient();
  const queryKey = ["api-integrations", uid];
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Segredo fora do cache TanStack e de qualquer persistência.
  const [credential, setCredential] = useState<CreatedIntegration | null>(null);
  const [revoking, setRevoking] = useState<IntegrationRow | null>(null);
  const [pending, setPending] = useState(false);
  const revokingRef = useRef(false);
  const [error, setError] = useState("");
  const list = useInfiniteQuery({
    queryKey, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => listarIntegracoes(pageParam, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    retry: false,
  });
  const customers = useQuery({
    queryKey: ["integration-customers", uid], enabled: creating,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/customers?limit=250", { signal });
      if (!response.ok) throw new Error("Não foi possível carregar os clientes.");
      const payload = await response.json();
      const rows: { code?: string; id?: string; name?: string; archived?: boolean; status?: string }[] = Array.isArray(payload) ? payload : (payload.items ?? payload.data ?? []);
      return rows.filter((row) => !row.archived && row.status !== "paused" && (row.code || row.id)).map((row) => ({ code: row.code || row.id!, name: row.name || row.code || row.id! })) as IntegrationCustomer[];
    },
  });
  const environment = import.meta.env.VITE_FIREBASE_PROJECT_ID === "dute-prod" ? "Produção" : "Homologação";
  const docs = <a href={`${INTEGRACOES_API_BASE}/openapi.json`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"><ExternalLink className="h-4 w-4" aria-hidden="true" />Documentação da API</a>;

  async function revoke() {
    if (!revoking || revokingRef.current) return;
    revokingRef.current = true; setPending(true); setError("");
    try { await revogarIntegracao(revoking.id); setRevoking(null); await client.invalidateQueries({ queryKey }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível revogar a chave."); }
    finally { revokingRef.current = false; setPending(false); }
  }

  if (credential) return <CreatedKey credential={credential} onDone={() => { setCredential(null); setCreating(false); void client.invalidateQueries({ queryKey }); }} />;

  if (creating) return (
    <div>
      <Button variant="ghost" size="sm" className="mb-4" disabled={generating} onClick={() => setCreating(false)}><ChevronLeft className="h-4 w-4" />Integrações</Button>
      <PageHeader className="mb-8" title="Nova integração" actions={<span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{environment}</span>} />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div>
          {customers.isPending ? <p role="status" className="text-sm text-muted-foreground">Carregando clientes…</p> : customers.isError ? <div role="alert"><p className="text-sm text-destructive">Não foi possível carregar os clientes.</p><Button className="mt-3" variant="outline" onClick={() => void customers.refetch()}>Tentar novamente</Button></div> : <>
            <IntegrationForm customers={customers.data} onPendingChange={setGenerating} onCancel={() => setCreating(false)} onCreated={(key) => { setCredential(key); void client.invalidateQueries({ queryKey }); }} />
          </>}
        </div>
        <aside className="space-y-7 border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0" aria-label="Como funciona">
          <h2 className="text-base font-semibold">Como funciona</h2>
          <ol className="list-inside list-decimal space-y-5 text-sm marker:font-semibold">
            <li>Defina o acesso<p className="mt-1 text-xs leading-5 text-muted-foreground">Escolha as permissões e, quando necessário, os clientes.</p></li>
            <li>Gere e copie a chave<p className="mt-1 text-xs leading-5 text-muted-foreground">A chave será exibida uma única vez.</p></li>
            <li>Envie ao desenvolvedor<p className="mt-1 text-xs leading-5 text-muted-foreground">Use um canal seguro para compartilhar.</p></li>
          </ol>
          <div className="border-t border-border pt-6">{docs}</div>
        </aside>
      </div>
    </div>
  );

  const rows = list.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <div>
      <PageHeader title="Integrações" description="Conecte sistemas externos aos módulos do Dute." actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Nova integração</Button>} />
      <div className="my-6 flex flex-wrap items-center justify-between gap-3"><span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{environment}</span>{docs}</div>
      {list.isPending ? <p role="status" className="py-8 text-sm text-muted-foreground">Carregando integrações…</p> : list.isError ? <div role="alert"><p className="text-sm text-destructive">Não foi possível carregar as integrações.</p><Button variant="outline" className="mt-3" onClick={() => void list.refetch()}>Tentar novamente</Button></div> : !rows.length ? <div className="border-y border-border py-12"><h2 className="font-semibold">Nenhuma integração criada</h2><p className="mt-2 text-sm text-muted-foreground">Crie uma chave para conectar o sistema do seu desenvolvedor.</p></div> : <ul className="divide-y divide-border border-y border-border">
        {rows.map((row) => {
          const status = integrationStatus(row);
          return <li key={row.id} className="space-y-3 py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><h2 className="break-words text-base font-semibold">{row.name}</h2><p className="mt-1 text-xs text-muted-foreground">Até {new Date(row.expires_at).toLocaleDateString("pt-BR")} · {row.customers.length ? row.customers.join(", ") : "Recursos globais"}</p></div>
              <div className="flex items-center gap-4"><span className={cn("rounded-md px-2 py-1 text-xs font-medium", status === "Ativa" ? "bg-success-soft text-success-soft-foreground" : "bg-muted text-muted-foreground")}>{status}</span>{!row.revoked && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { setError(""); setRevoking(row); }}>Revogar</Button>}</div>
            </div>
            <p className="text-xs font-medium">{row.write_policy === "scoped" ? "Escrita autorizada pelas permissões selecionadas" : "Escrita exige confirmação por ação"}</p>
            <p className="text-xs leading-5 text-muted-foreground">{row.scopes.map((scope) => PERMISSOES.find((p) => p.value === scope)?.label ?? scope).join(" · ")}</p>
          </li>;
        })}
      </ul>}
      {list.hasNextPage && <Button variant="outline" className="mt-5" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? "Carregando…" : "Carregar mais"}</Button>}
      <AlertDialog open={!!revoking} onOpenChange={(open) => { if (!open && !pending) setRevoking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Revogar chave?</AlertDialogTitle><AlertDialogDescription>A integração {revoking?.name} perderá o acesso imediatamente. Para conectar novamente, será necessário gerar outra chave.</AlertDialogDescription></AlertDialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel><Button variant="destructive" disabled={pending} onClick={() => void revoke()}>{pending ? "Revogando…" : "Revogar chave"}</Button></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
