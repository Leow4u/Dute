import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, Check, Loader2, Pencil, Plus, X } from "lucide-react";

import { fetchChatJson } from "@/components/agent/chat";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  groupPlaybooks,
  playbookForm,
  playbookPayload,
  playbookProblem,
  playbooksKey,
  type Playbook,
  type PlaybookForm,
} from "@/lib/agent-playbooks";
import { cn } from "@/lib/utils";

/**
 * Playbooks do Agent Dute em Conhecimento (só coordenação): passo a passo
 * dos procedimentos da operação. Escrito aqui vale direto; os iniciais e os
 * editados enquanto pendentes só valem depois de "Aprovar". Aprovado, o
 * agente segue o passo a passo quando alguém pergunta sobre o assunto.
 */

const field =
  "w-full min-w-0 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15";

function AudiencePill({ audience }: { audience: Playbook["audience"] }) {
  return (
    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
      {audience === "todos" ? "cliente e equipe" : "só equipe"}
    </span>
  );
}

function PlaybookDialog({ playbook, onClose }: { playbook: Playbook | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PlaybookForm>(() => playbookForm(playbook ?? undefined));
  const set = (patch: Partial<PlaybookForm>) => setForm((current) => ({ ...current, ...patch }));
  const pending = playbook?.status === "pending";
  const problem = playbookProblem(form);
  const save = useMutation({
    mutationFn: async (approve: boolean) => {
      const saved = await fetchChatJson<{ id: string }>("/api/agent-dute/playbooks", { method: "POST", body: JSON.stringify(playbookPayload(form)) });
      if (approve) await fetchChatJson(`/api/agent-dute/playbooks/${encodeURIComponent(saved.id)}/approve`, { method: "POST", body: "{}" });
      return approve;
    },
    onSuccess: async (approved) => {
      await queryClient.invalidateQueries({ queryKey: playbooksKey });
      toast({ title: !playbook ? "Playbook publicado: o Agent Dute passa a seguir" : approved ? "Playbook aprovado" : "Playbook salvo" });
      onClose();
    },
    onError: (error) => toast({ title: "Não foi possível salvar", description: error instanceof Error ? error.message : "", variant: "destructive" }),
  });
  const id = playbook?.id ?? "new";

  return (
    <Dialog open onOpenChange={(open) => (!open && !save.isPending ? onClose() : undefined)}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto bg-card">
        <DialogHeader>
          <DialogTitle>{playbook ? (pending ? "Revisar playbook" : "Editar playbook") : "Novo playbook"}</DialogTitle>
          <DialogDescription>
            O Agent Dute segue estes passos quando alguém perguntar sobre o assunto. Ele só orienta: quem faz cada passo é a pessoa, na tela indicada.
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={save.isPending} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-semibold" htmlFor={`pb-${id}-title`}>
            Nome
            <input id={`pb-${id}-title`} value={form.title} maxLength={120} onChange={(event) => set({ title: event.target.value })} className={cn(field, "font-normal")} placeholder="Ex.: Receber mercadoria" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold" htmlFor={`pb-${id}-when`}>
            Quando usar
            <input id={`pb-${id}-when`} value={form.when} maxLength={300} onChange={(event) => set({ when: event.target.value })} className={cn(field, "font-normal")} placeholder="Ex.: A mercadoria chegou na Dutelog" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold" htmlFor={`pb-${id}-steps`}>
            Passos (um por linha)
            <textarea id={`pb-${id}-steps`} rows={7} value={form.stepsText} onChange={(event) => set({ stepsText: event.target.value })} className={cn(field, "resize-y font-normal leading-6")} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold" htmlFor={`pb-${id}-open`}>
            A completar pela equipe (um por linha)
            <textarea id={`pb-${id}-open`} rows={3} value={form.openText} onChange={(event) => set({ openText: event.target.value })} className={cn(field, "resize-y font-normal leading-6")} />
            <span className="text-xs font-normal text-muted-foreground">Regras da operação que ainda faltam definir. Ficam só aqui, o agente não recebe. Quando definir, escreva a regra nos passos e apague daqui.</span>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Para quem</span>
            <div className="inline-flex self-start rounded-lg border border-border bg-card p-0.5 text-xs" role="group" aria-label="Para quem">
              {(["equipe", "todos"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={form.audience === value}
                  onClick={() => set({ audience: value })}
                  className={cn("rounded-md px-2.5 py-1", form.audience === value ? "bg-foreground text-background" : "text-muted-foreground")}
                >
                  {value === "todos" ? "Cliente e equipe" : "Só equipe"}
                </button>
              ))}
            </div>
          </div>
        </fieldset>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-warning-soft-foreground">{problem ?? ""}</span>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} disabled={save.isPending} className="rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium hover:bg-muted">
              Cancelar
            </button>
            {pending ? (
              <button
                type="button"
                disabled={Boolean(problem) || save.isPending}
                onClick={() => save.mutate(false)}
                className="rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Salvar sem aprovar
              </button>
            ) : null}
            <button
              type="button"
              disabled={Boolean(problem) || save.isPending}
              onClick={() => save.mutate(pending)}
              className="rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background hover:bg-foreground/85 disabled:opacity-50"
            >
              {save.isPending ? "Salvando…" : pending ? "Salvar e aprovar" : playbook ? "Salvar" : "Salvar e publicar"}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentPlaybooks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // "new", id do playbook aberto ou nada.
  const [editing, setEditing] = useState<string | null>(null);
  const playbooks = useQuery({
    queryKey: playbooksKey,
    queryFn: () => fetchChatJson<{ playbooks: Playbook[] }>("/api/agent-dute/playbooks"),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: playbooksKey });
  const failed = (error: unknown) => toast({ title: "Não foi possível salvar", description: error instanceof Error ? error.message : "", variant: "destructive" });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" | "archive" }) =>
      fetchChatJson(`/api/agent-dute/playbooks/${encodeURIComponent(id)}/${action}`, { method: "POST", body: "{}" }),
    onSuccess: (_result, input) => {
      toast({ title: input.action === "approve" ? "Playbook aprovado: o Agent Dute passa a seguir" : input.action === "reject" ? "Playbook recusado" : "Playbook arquivado" });
      void refresh();
    },
    onError: failed,
  });
  const seed = useMutation({
    mutationFn: () => fetchChatJson<{ created: number }>("/api/agent-dute/playbooks/seed", { method: "POST", body: "{}" }),
    onSuccess: (result) => {
      toast({ title: result.created ? `${result.created} playbooks carregados para aprovar` : "Os playbooks iniciais já foram carregados antes" });
      void refresh();
    },
    onError: failed,
  });

  const list = playbooks.data?.playbooks ?? [];
  const { pending, active } = groupPlaybooks(list);
  const open = editing && editing !== "new" ? (list.find((item) => item.id === editing) ?? null) : null;
  const busy = decide.isPending || seed.isPending;

  return (
    <section className="rounded-[18px] border border-border bg-card px-5 py-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-[320px] items-start gap-3">
          <BookOpenCheck className="mt-0.5 h-5 w-5 shrink-0 text-agent" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-semibold">Playbooks do Agent Dute</h2>
            <p className="text-sm text-muted-foreground">
              Passo a passo dos procedimentos da operação. Aprovado, o agente segue quando alguém pergunta "como faço…". O cliente só recebe os marcados "cliente e equipe".
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-semibold hover:bg-muted"
        >
          <Plus className="h-4 w-4" /> Novo playbook
        </button>
      </header>

      {playbooks.isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
      ) : playbooks.isError ? (
        <p className="mt-3 text-sm text-destructive">{playbooks.error instanceof Error ? playbooks.error.message : "Não foi possível carregar."}</p>
      ) : (
        <>
          {list.length === 0 ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-agent-border bg-agent-soft px-4 py-3">
              <p className="min-w-0 flex-1 basis-[280px] text-sm">
                Há 7 playbooks iniciais prontos para revisar: aprovar solicitação, receber, recebimento com divergência, separar e embalar, entregar, pedido pelo portal e aviso de envio. Eles entram como "para aprovar" e só valem depois de aprovados.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => seed.mutate()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-foreground px-3.5 py-2 text-sm font-semibold text-background hover:bg-foreground/85 disabled:opacity-50"
              >
                {seed.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Carregar os 7 iniciais
              </button>
            </div>
          ) : null}

          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Para aprovar{pending.length ? ` · ${pending.length}` : ""}
          </h3>
          {pending.length ? (
            <ul className="mt-2 flex flex-col gap-2">
              {pending.map((item) => (
                <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-agent-border bg-agent-soft p-3">
                  <button type="button" onClick={() => setEditing(item.id)} className="min-w-0 flex-1 basis-[260px] text-left">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {item.title} <AudiencePill audience={item.audience} />
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {item.when} · {item.steps.length} {item.steps.length === 1 ? "passo" : "passos"}
                      {item.open_points.length ? ` · ${item.open_points.length} a completar pela equipe` : ""}
                      {item.source === "inicial" ? " · inicial" : ""}
                    </span>
                  </button>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" onClick={() => setEditing(item.id)} className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted">
                      <Pencil className="h-3.5 w-3.5" /> Ver e editar
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => decide.mutate({ id: item.id, action: "reject" })}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      <X className="h-3.5 w-3.5" /> Recusar
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => decide.mutate({ id: item.id, action: "approve" })}
                      className="inline-flex items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/85 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" /> Aprovar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Nenhum playbook esperando aprovação.</p>
          )}

          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Valendo{active.length ? ` · ${active.length}` : ""}
          </h3>
          {active.length ? (
            <ul className="mt-2 divide-y divide-border/60 rounded-xl border border-border/70">
              {active.map((item) => (
                <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5 text-sm">
                  <button type="button" onClick={() => setEditing(item.id)} className="min-w-0 flex-1 basis-[260px] text-left">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {item.title} <AudiencePill audience={item.audience} />
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {item.steps.length} {item.steps.length === 1 ? "passo" : "passos"} · {item.use_count ? `usado ${item.use_count} ${item.use_count === 1 ? "vez" : "vezes"}` : "ainda não usado"}
                      {item.open_points.length ? ` · ${item.open_points.length} a completar` : ""}
                    </span>
                  </button>
                  <div className="flex shrink-0 gap-3 text-xs font-medium text-muted-foreground">
                    <button type="button" onClick={() => setEditing(item.id)} className="hover:text-foreground">
                      Editar
                    </button>
                    <button type="button" disabled={busy} onClick={() => decide.mutate({ id: item.id, action: "archive" })} className="hover:text-foreground">
                      Arquivar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Nenhum playbook valendo ainda.</p>
          )}
        </>
      )}

      {editing && (editing === "new" || open) ? <PlaybookDialog key={editing} playbook={open} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}
