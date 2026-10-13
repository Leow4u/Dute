/* DEMO: agenda de destinatários do portal (creators, agências, eventos). */
import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { BookUser, MapPin, Pencil, Phone, Plus, Search, Send, Shirt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ClientModuleLoading, ClientModuleShell, formatNumber, normalizeSlug, useClientOverview } from "../../src/pages/client/shared";
import { useDeleteRecipient, useRecipients, useSaveRecipient, type Recipient, type RecipientInput } from "./demo-api";

const KINDS = ["Creator", "Agência", "Evento", "Escritório"] as const;
const SIZES = ["", "PP", "P", "M", "G", "GG"] as const;

const EMPTY: RecipientInput = { name: "", kind: "Creator", address: "", contact: "", size: "", notes: "" };

export function DemoRecipients() {
  const overview = useClientOverview();
  const recipients = useRecipients();
  const saveRecipient = useSaveRecipient();
  const deleteRecipient = useDeleteRecipient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<string>("todos");
  const [editing, setEditing] = useState<(RecipientInput & { id?: string }) | null>(null);

  if (overview.isLoading || recipients.isLoading || !overview.data) return <ClientModuleLoading title="Carregando destinatários" />;

  const all = recipients.data ?? [];
  const needle = normalizeSlug(search);
  const shown = all.filter(
    (recipient) =>
      (kind === "todos" || recipient.kind === kind) &&
      (!needle || normalizeSlug([recipient.name, recipient.address, recipient.contact, recipient.notes].join(" ")).includes(needle)),
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    saveRecipient.mutate(editing, {
      onSuccess: () => {
        toast({ title: editing.id ? "Destinatário atualizado" : "Destinatário salvo", description: editing.name });
        setEditing(null);
      },
      onError: (error) => toast({ title: "Não foi possível salvar", description: error instanceof Error ? error.message : "", variant: "destructive" }),
    });
  }

  function edit(recipient: Recipient) {
    setEditing({ id: recipient.id, name: recipient.name, kind: recipient.kind, address: recipient.address, contact: recipient.contact ?? "", size: recipient.size ?? "", notes: recipient.notes ?? "" });
  }

  return (
    <ClientModuleShell
      overview={overview.data}
      title="Destinatários"
      description={`${formatNumber(all.length)} contatos na agenda. No pedido, escolha vários de uma vez e cada um recebe a própria entrega.`}
      icon={BookUser}
    >
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, endereço ou contato" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {["todos", ...KINDS].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setKind(option)}
              className={
                kind === option
                  ? "cursor-pointer rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background"
                  : "cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
              }
            >
              {option === "todos" ? "Todos" : option}
            </button>
          ))}
        </div>
        <Button type="button" className="cursor-pointer" onClick={() => setEditing({ ...EMPTY })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Novo destinatário
        </Button>
      </div>

      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {shown.map((recipient) => (
          <li key={recipient.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {recipient.name}
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{recipient.kind}</span>
                </p>
                {recipient.notes ? <p className="mt-0.5 text-sm text-muted-foreground">{recipient.notes}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                  onClick={() => edit(recipient)}
                  aria-label={`Editar ${recipient.name}`}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
                  onClick={() => deleteRecipient.mutate(recipient.id, { onSuccess: () => toast({ title: "Removido da agenda", description: recipient.name }) })}
                  aria-label={`Remover ${recipient.name}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <span className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {recipient.address}
              </span>
              {recipient.contact ? (
                <span className="flex items-center gap-2">
                  <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {recipient.contact}
                </span>
              ) : null}
              {recipient.size ? (
                <span className="flex items-center gap-2">
                  <Shirt className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Tamanho {recipient.size}
                </span>
              ) : null}
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => navigate(`/portal/estoque?para=${encodeURIComponent(recipient.id)}`)}
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Enviar kit
              </Button>
            </div>
          </li>
        ))}
        {!shown.length ? (
          <li className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground lg:col-span-2">
            Ninguém na agenda com esse filtro.
          </li>
        ) : null}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(open) => (open ? null : setEditing(null))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Editar destinatário" : "Novo destinatário"}</DialogTitle>
            <DialogDescription>Fica na agenda para escolher direto no pedido.</DialogDescription>
          </DialogHeader>
          {editing ? (
            <form id="recipient-form" className="flex flex-col gap-3" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label htmlFor="rcp-name">Nome</Label>
                <Input id="rcp-name" autoFocus value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} placeholder="Pessoa, agência ou local" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rcp-kind">Tipo</Label>
                  <select
                    id="rcp-kind"
                    className="h-10 w-full cursor-pointer rounded-md border border-input bg-background px-3 text-sm"
                    value={editing.kind}
                    onChange={(event) => setEditing({ ...editing, kind: event.target.value })}
                  >
                    {KINDS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rcp-size">Tamanho de roupa</Label>
                  <select
                    id="rcp-size"
                    className="h-10 w-full cursor-pointer rounded-md border border-input bg-background px-3 text-sm"
                    value={editing.size ?? ""}
                    onChange={(event) => setEditing({ ...editing, size: event.target.value })}
                  >
                    {SIZES.map((option) => (
                      <option key={option} value={option}>
                        {option || "Não se aplica"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rcp-address">Endereço completo</Label>
                <Input id="rcp-address" value={editing.address} onChange={(event) => setEditing({ ...editing, address: event.target.value })} placeholder="Rua, número, complemento, bairro, cidade e CEP" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rcp-contact">Contato</Label>
                <Input id="rcp-contact" value={editing.contact ?? ""} onChange={(event) => setEditing({ ...editing, contact: event.target.value })} placeholder="Telefone ou e-mail" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rcp-notes">Observações</Label>
                <Textarea id="rcp-notes" rows={2} value={editing.notes ?? ""} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} placeholder="Horário da portaria, nicho do creator, cuidados na entrega" />
              </div>
            </form>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" className="cursor-pointer" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" form="recipient-form" className="cursor-pointer" disabled={saveRecipient.isPending || !editing?.name.trim() || !editing?.address.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ClientModuleShell>
  );
}
