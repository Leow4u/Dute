import {
  useListBillingUsers,
  getListBillingUsersQueryKey,
  useUpdateUserRole,
} from "@workspace/api-client-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import { MoreHorizontal, Plus } from "lucide-react";

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
import { PageHeader } from "@/components/ui/page-header";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ROLE_INFO, assignableRoles, canManagePerson, roleLabel } from "@/lib/access";
import { useAppUser } from "@/lib/auth";
import { firestore } from "@/lib/firebase";
import { normalizeProfileRole, type ProfileRole } from "@/lib/modules";
import { humanApiError } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * Pessoas e acessos: quem entra no sistema, com que perfil, e como tirar o
 * acesso de quem sai. Convite usado vira pessoa ativa; só o pendente aparece.
 */

type Invite = {
  id: string;
  nome?: string;
  email: string;
  role: ProfileRole;
  status: "pending" | "used" | "revoked";
};

type Person = {
  key: string;
  kind: "user" | "invite";
  id: string;
  name: string;
  email: string;
  role: unknown;
  state: "active" | "removed" | "pending";
};

const ROLE_ORDER: Record<string, number> = {
  owner: 0,
  admin: 0,
  interno: 1,
  wms: 2,
  financeiro: 3,
  suporte: 4,
  cliente: 5,
};

const ROLE_TONE: Record<string, string> = {
  owner: "bg-muted text-foreground",
  admin: "bg-muted text-foreground",
  interno: "bg-info-soft text-info-soft-foreground",
  wms: "bg-warning-soft text-warning-soft-foreground",
  financeiro: "bg-success-soft text-success-soft-foreground",
  suporte: "bg-info-soft text-info-soft-foreground",
  cliente: "bg-agent-soft text-agent",
};

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter((part) => /^\p{L}/u.test(part))
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

function makeInviteToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function inviteLink(token: string) {
  return `${window.location.origin}/convite?invite=${token}`;
}

async function jsonOrThrow(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(payload.message || fallback);
  return payload;
}

export default function Users() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAppUser();
  const actorRole = normalizeProfileRole(user?.publicMetadata.role);
  const { data, isLoading } = useListBillingUsers();
  const updateRole = useUpdateUserRole();

  // "Convidar pessoa da BTG" (Cliente BTG) chega com ?convidar=cliente.
  const [inviteOpen, setInviteOpen] = useState(
    () => new URLSearchParams(window.location.search).get("convidar") === "cliente",
  );
  const [inviteForm, setInviteForm] = useState({ nome: "", email: "", role: "cliente" as ProfileRole });
  const [removing, setRemoving] = useState<Person | null>(null);
  const [reason, setReason] = useState("");

  const invites = useQuery({
    queryKey: ["invites"],
    queryFn: async (): Promise<Invite[]> => {
      if (!firestore) return [];
      const snapshot = await getDocs(collection(firestore, "invites"));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Invite);
    },
  });

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListBillingUsersQueryKey() }),
      invites.refetch(),
    ]);
  };
  const failure = (title: string) => (error: unknown) =>
    toast({
      title,
      description: humanApiError(error, "Tente novamente em instantes."),
      variant: "destructive",
    });

  const people = useMemo<Person[]>(() => {
    const users = ((data?.items ?? []) as unknown as Array<Record<string, unknown>>).map((item) => ({
      key: `user:${item.id}`,
      kind: "user" as const,
      id: String(item.id),
      name: String(item.nome || item.email || "Sem nome"),
      email: String(item.email ?? ""),
      role: item.role,
      state: item.access_disabled === true ? ("removed" as const) : ("active" as const),
    }));
    const pending = (invites.data ?? [])
      .filter((invite) => invite.status === "pending")
      .map((invite) => ({
        key: `invite:${invite.id}`,
        kind: "invite" as const,
        id: invite.id,
        name: invite.nome || invite.email,
        email: invite.email,
        role: invite.role,
        state: "pending" as const,
      }));
    const stateOrder = { active: 0, pending: 1, removed: 2 };
    return [...users, ...pending].sort(
      (left, right) =>
        stateOrder[left.state] - stateOrder[right.state] ||
        (ROLE_ORDER[String(left.role)] ?? 9) - (ROLE_ORDER[String(right.role)] ?? 9) ||
        left.name.localeCompare(right.name, "pt-BR"),
    );
  }, [data, invites.data]);

  const createInvite = useMutation({
    mutationFn: async () => {
      const token = makeInviteToken();
      const role = inviteForm.role;
      const response = await fetch("/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          nome: inviteForm.nome.trim(),
          email: inviteForm.email.trim().toLowerCase(),
          role,
          customer_code: role === "cliente" ? "BTG Pactual" : "Dutelog",
        }),
      });
      await jsonOrThrow(response, "Não foi possível criar o convite.");
      return token;
    },
    onSuccess: async (token) => {
      setInviteOpen(false);
      setInviteForm({ nome: "", email: "", role: "cliente" });
      await refresh();
      await navigator.clipboard.writeText(inviteLink(token)).catch(() => undefined);
      toast({
        title: "Convite criado",
        description: "O link foi copiado. Envie para a pessoa entrar com o e-mail convidado.",
      });
    },
    onError: failure("Convite não criado"),
  });

  const cancelInvite = useMutation({
    mutationFn: async (token: string) =>
      jsonOrThrow(
        await fetch(`/api/invites/${encodeURIComponent(token)}`, { method: "DELETE" }),
        "Não foi possível cancelar o convite.",
      ),
    onSuccess: async () => {
      await refresh();
      toast({ title: "Convite cancelado" });
    },
    onError: failure("Convite não cancelado"),
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

  const roles = assignableRoles(actorRole);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pessoas e acessos"
        description="Quem entra no sistema e o que cada perfil pode fazer"
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Convidar pessoa
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          {isLoading || invites.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Carregando pessoas...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-foreground/50">
                    <th className="px-5 py-2.5 font-semibold">Pessoa</th>
                    <th className="px-3 py-2.5 font-semibold">Perfil</th>
                    <th className="px-3 py-2.5 font-semibold">Situação</th>
                    <th className="w-12 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {people.map((person) => {
                    const self = person.kind === "user" && person.id === user?.uid;
                    const manageable = !self && canManagePerson(actorRole, person.role);
                    return (
                      <tr
                        key={person.key}
                        className={cn(
                          "border-b border-border/40 last:border-0",
                          person.state === "removed" && "text-muted-foreground",
                        )}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-info-soft text-xs font-semibold text-info-soft-foreground">
                              {initials(person.name)}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">
                                {person.name}
                                {self ? <span className="ml-1.5 text-xs text-muted-foreground">(você)</span> : null}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">{person.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={cn(
                              "rounded-lg px-2 py-1 text-xs font-semibold",
                              ROLE_TONE[String(normalizeProfileRole(person.role))] ?? "bg-muted",
                            )}
                          >
                            {roleLabel(person.role)}
                            {normalizeProfileRole(person.role) === "cliente" ? " · BTG" : ""}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <span
                            className={cn(
                              "mr-2 inline-block h-2 w-2 rounded-full",
                              person.state === "active"
                                ? "bg-green-600"
                                : person.state === "pending"
                                  ? "bg-amber-500"
                                  : "bg-slate-400",
                            )}
                          />
                          {person.state === "active"
                            ? "Ativo"
                            : person.state === "pending"
                              ? "Convite pendente"
                              : "Acesso removido"}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {person.kind === "invite" ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" aria-label={`Ações de ${person.name}`}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onSelect={async () => {
                                    await navigator.clipboard.writeText(inviteLink(person.id)).catch(() => undefined);
                                    toast({ title: "Link do convite copiado" });
                                  }}
                                >
                                  Copiar link do convite
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onSelect={() => cancelInvite.mutate(person.id)}
                                >
                                  Cancelar convite
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : manageable ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" aria-label={`Ações de ${person.name}`}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {person.state === "active" ? (
                                  <>
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger>Trocar perfil</DropdownMenuSubTrigger>
                                      <DropdownMenuSubContent>
                                        <DropdownMenuLabel>Perfil de {person.name}</DropdownMenuLabel>
                                        <DropdownMenuRadioGroup
                                          value={String(normalizeProfileRole(person.role))}
                                          onValueChange={(role) => changeRole(person, role)}
                                        >
                                          {roles.map((role) => (
                                            <DropdownMenuRadioItem key={role} value={role}>
                                              {roleLabel(role)}
                                            </DropdownMenuRadioItem>
                                          ))}
                                        </DropdownMenuRadioGroup>
                                      </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-destructive"
                                      onSelect={() => setRemoving(person)}
                                    >
                                      Remover acesso
                                    </DropdownMenuItem>
                                  </>
                                ) : (
                                  <DropdownMenuItem
                                    onSelect={() => setAccess.mutate({ id: person.id, active: true })}
                                  >
                                    Devolver acesso
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="h-fit rounded-lg border border-border bg-card">
          <h2 className="border-b border-border/60 px-5 py-3.5 text-sm font-semibold">O que cada perfil faz</h2>
          <div className="space-y-3 px-5 py-4">
            {ROLE_INFO.map((info) => (
              <div key={info.role} className="text-sm">
                <div className="font-medium">{info.label}</div>
                <div className="text-xs leading-5 text-muted-foreground">{info.description}</div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Convidar pessoa</DialogTitle>
          </DialogHeader>
          <form
            id="invite-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              createInvite.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="invite-nome">Nome</Label>
              <Input
                id="invite-nome"
                value={inviteForm.nome}
                onChange={(event) => setInviteForm((state) => ({ ...state, nome: event.target.value }))}
                placeholder="Nome da pessoa"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">E-mail</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={inviteForm.email}
                onChange={(event) => setInviteForm((state) => ({ ...state, email: event.target.value }))}
                placeholder="email@empresa.com.br"
              />
            </div>
            <div className="space-y-2">
              <Label>Perfil</Label>
              <Select
                value={inviteForm.role}
                onValueChange={(role: ProfileRole) => setInviteForm((state) => ({ ...state, role }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role} value={role}>
                      {roleLabel(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {ROLE_INFO.find((info) => info.role === inviteForm.role)?.description}
                {inviteForm.role === "cliente" ? " Acesso à conta BTG Pactual." : ""}
              </p>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="invite-form" disabled={createInvite.isPending}>
              {createInvite.isPending ? "Criando..." : "Criar convite e copiar link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover o acesso de {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              A pessoa sai do sistema na hora e não consegue mais entrar. O histórico dela continua
              registrado, e você pode devolver o acesso depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="remove-reason">Motivo (opcional)</Label>
            <Input
              id="remove-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ex.: saiu da empresa"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (removing) setAccess.mutate({ id: removing.id, active: false, reason });
              }}
              disabled={setAccess.isPending}
            >
              Remover acesso
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
