import { useUpdateUserRole } from "@workspace/api-client-react";
import { useMutation } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { Dialog, DialogCancelar, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { assignableRoles, canManagePerson, roleLabel } from "@/lib/access";
import { useAppUser } from "@/lib/auth";
import { normalizeProfileRole } from "@/lib/modules";
import { humanApiError } from "@/lib/permissions";
import type { Person } from "@/lib/pessoas";
import { cn } from "@/lib/utils";

/**
 * O que se faz com cada pessoa, igual na página de Pessoas e na página do
 * cliente: reenviar, copiar o link e cancelar o convite; trocar o perfil e
 * revogar o acesso de quem entra; convidar de novo, devolver o acesso e tirar
 * da lista quem saiu. Cada pedido repetido depois de uma falha leva o mesmo
 * recibo (idempotency_key), e o servidor recusa o que o papel não pode.
 */

export async function jsonOrThrow(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(payload.message || fallback);
  return payload;
}

function inviteLink(token: string) {
  return `${window.location.origin}/convite?invite=${token}`;
}

export async function copyInviteLink(token: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(inviteLink(token));
    return true;
  } catch {
    return false;
  }
}

export function useAcoesDasPessoas({ refresh, onConvidarDeNovo }: { refresh: () => Promise<void>; onConvidarDeNovo: (person: Person) => void }) {
  const { toast } = useToast();
  const { user } = useAppUser();
  const actorRole = normalizeProfileRole(user?.publicMetadata.role);
  const updateRole = useUpdateUserRole();
  const [resending, setResending] = useState<Person | null>(null);
  const [archiving, setArchiving] = useState<Person | null>(null);
  const [removing, setRemoving] = useState<Person | null>(null);
  const [reason, setReason] = useState("");
  const resendAttempts = useRef(new Map<string, string>());

  const failure = (title: string) => (error: unknown) =>
    toast({ title, description: humanApiError(error, "Tente novamente em instantes."), variant: "destructive" });

  const resendInvite = useMutation({
    mutationFn: async (token: string) => {
      if (!resendAttempts.current.has(token)) resendAttempts.current.set(token, crypto.randomUUID());
      return jsonOrThrow(
        await fetch(`/api/invites/${encodeURIComponent(token)}/resend`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotency_key: resendAttempts.current.get(token) }),
        }),
        "Não foi possível reenviar o convite.",
      );
    },
    onSuccess: async (_result, token) => {
      resendAttempts.current.delete(token);
      setResending(null);
      await refresh();
      toast({ title: "Reenvio agendado", description: "O convite será enviado por e-mail em alguns minutos." });
    },
    onError: failure("Convite não reenviado"),
  });

  const cancelInvite = useMutation({
    mutationFn: async (token: string) =>
      jsonOrThrow(await fetch(`/api/invites/${encodeURIComponent(token)}`, { method: "DELETE" }), "Não foi possível cancelar o convite."),
    onSuccess: async () => {
      await refresh();
      toast({ title: "Convite cancelado" });
    },
    onError: failure("Convite não cancelado"),
  });

  const archivePerson = useMutation({
    mutationFn: async (person: Person) =>
      jsonOrThrow(
        await fetch(`/api/billing/users/${encodeURIComponent(person.id)}/archive`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
        "Não foi possível remover a pessoa da lista.",
      ),
    onSuccess: async () => {
      setArchiving(null);
      await refresh();
      toast({ title: "Pessoa removida da lista", description: "O histórico foi preservado. Você poderá convidar este e-mail novamente." });
    },
    onError: failure("Pessoa não removida"),
  });

  const setAccess = useMutation({
    mutationFn: async (input: { id: string; active: boolean; reason?: string }) =>
      jsonOrThrow(
        await fetch(`/api/billing/users/${encodeURIComponent(input.id)}/access`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ active: input.active, reason: input.reason || undefined }),
        }),
        "Não foi possível alterar o acesso.",
      ),
    onSuccess: async (_result, input) => {
      setRemoving(null);
      setReason("");
      await refresh();
      toast({ title: input.active ? "Acesso devolvido" : "Acesso removido" });
    },
    onError: failure("Acesso não alterado"),
  });

  const changeRole = (person: Person, role: string) =>
    updateRole.mutate(
      { id: person.id, data: { role } },
      {
        onSuccess: async () => {
          await refresh();
          toast({ title: "Perfil alterado", description: `${person.name}: ${roleLabel(role)}` });
        },
        onError: failure("Perfil não alterado"),
      },
    );

  return {
    toast,
    actorRole,
    selfId: user?.uid ?? null,
    roles: assignableRoles(actorRole),
    resending,
    setResending,
    archiving,
    setArchiving,
    removing,
    setRemoving,
    reason,
    setReason,
    resendInvite,
    cancelInvite,
    archivePerson,
    setAccess,
    changeRole,
    onConvidarDeNovo,
  };
}

export type AcoesDasPessoas = ReturnType<typeof useAcoesDasPessoas>;

/** O e-mail do convite ainda está na fila: reenviar agora só repetiria o envio (salvo o reconvite a recuperar). */
function reenvioBloqueado(acoes: AcoesDasPessoas, person: Person): boolean {
  return (person.emailStatus === "pending" && !person.loginPreparationPending) || acoes.resendInvite.isPending;
}

/** "Reenviar" na linha do convite, para quem pode cuidar dele; confirma antes de enviar. */
export function BotaoReenviar({ acoes, person, className }: { acoes: AcoesDasPessoas; person: Person; className?: string }) {
  if (person.kind !== "invite" || !canManagePerson(acoes.actorRole, person.role)) return null;
  return (
    <button
      type="button"
      aria-label={`Reenviar o convite de ${person.name}`}
      disabled={reenvioBloqueado(acoes, person)}
      onClick={() => acoes.setResending(person)}
      className={cn(
        "shrink-0 rounded text-sm font-bold text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:text-muted-foreground disabled:no-underline",
        className,
      )}
    >
      Reenviar
    </button>
  );
}

/** As ações da pessoa no menu "…"; sem menu para a própria pessoa e para quem o papel não deixa mexer. */
export function MenuDaPessoa({ acoes, person }: { acoes: AcoesDasPessoas; person: Person }) {
  const self = person.kind === "user" && person.id === acoes.selfId;
  if (self || !canManagePerson(acoes.actorRole, person.role)) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={`Ações de ${person.name}`}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {person.kind === "invite" ? (
          <>
            <DropdownMenuItem disabled={reenvioBloqueado(acoes, person)} onSelect={() => acoes.setResending(person)}>
              Reenviar convite por e-mail
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                const copied = await copyInviteLink(person.id);
                acoes.toast(
                  copied
                    ? { title: "Link do convite copiado" }
                    : { title: "Não foi possível copiar o link", description: "Permita a cópia no navegador e tente novamente.", variant: "destructive" },
                );
              }}
            >
              Copiar link do convite
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onSelect={() => acoes.cancelInvite.mutate(person.id)}>
              Cancelar convite
            </DropdownMenuItem>
          </>
        ) : person.state === "active" ? (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Trocar perfil</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuLabel>Perfil de {person.name}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={String(normalizeProfileRole(person.role))} onValueChange={(role) => acoes.changeRole(person, role)}>
                  {acoes.roles.map((role) => (
                    <DropdownMenuRadioItem key={role} value={role}>
                      {roleLabel(role)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={() => acoes.setRemoving(person)}>
              Revogar acesso
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => acoes.onConvidarDeNovo(person)}>Convidar novamente</DropdownMenuItem>
            <DropdownMenuItem disabled={acoes.setAccess.isPending} onSelect={() => acoes.setAccess.mutate({ id: person.id, active: true })}>
              Devolver acesso
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={() => acoes.setArchiving(person)}>
              Remover da lista
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** As confirmações: reenviar o convite, tirar da lista e revogar o acesso. */
export function DialogosDasPessoas({ acoes }: { acoes: AcoesDasPessoas }) {
  const { resending, archiving, removing, resendInvite, archivePerson, setAccess } = acoes;
  return (
    <>
      <Dialog open={Boolean(resending)} ocupado={resendInvite.isPending} onOpenChange={(open) => !open && acoes.setResending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reenviar convite?</DialogTitle>
            <DialogDescription>{resending?.name} receberá outro e-mail para aceitar o convite.</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-muted p-4">
            <p className="font-bold">{resending?.name}</p>
            <p className="mt-1 break-all text-sm font-semibold text-muted-foreground">{resending?.email}</p>
          </div>
          <DialogFooter>
            <DialogCancelar onClick={() => acoes.setResending(null)} />
            <BotaoDeAcao
              estado={resendInvite.isPending ? "andamento" : "repouso"}
              rotulo="Reenviar convite"
              andamento="Agendando…"
              onClick={() => resending && resendInvite.mutate(resending.id)}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(archiving)} ocupado={archivePerson.isPending} onOpenChange={(open) => !open && acoes.setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {archiving?.name} da lista?</AlertDialogTitle>
            <AlertDialogDescription>O histórico de ações será preservado. Você poderá convidar este e-mail novamente.</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="break-all text-sm text-muted-foreground">{archiving?.email}</p>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter na lista</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              estado={archivePerson.isPending ? "andamento" : "repouso"}
              rotulo="Remover da lista"
              andamento="Removendo…"
              onClick={() => {
                if (archiving) archivePerson.mutate(archiving);
              }}
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(removing)} ocupado={setAccess.isPending} onOpenChange={(open) => !open && acoes.setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar o acesso de {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              A pessoa sai do sistema na hora e não consegue mais entrar. O histórico dela continua registrado, e você pode devolver o acesso depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="remove-reason">Motivo (opcional)</Label>
            <Input id="remove-reason" value={acoes.reason} onChange={(event) => acoes.setReason(event.target.value)} placeholder="Ex.: saiu da empresa" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              estado={setAccess.isPending ? "andamento" : "repouso"}
              rotulo="Revogar acesso"
              andamento="Revogando…"
              onClick={() => {
                if (removing) setAccess.mutate({ id: removing.id, active: false, reason: acoes.reason });
              }}
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
