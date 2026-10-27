import {
  useListBillingUsers,
  getListBillingUsersQueryKey,
  useUpdateUserRole,
} from "@workspace/api-client-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  DialogDescription,
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
import { ROLE_INFO, assignableRoles, canManagePerson, roleLabel, visibleRoleInfo } from "@/lib/access";
import { useAppUser } from "@/lib/auth";
import { inviteCustomers } from "@/lib/customer-registry";
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
  customer_code?: string;
  status: "pending" | "used" | "revoked";
  email_status?: "pending" | "sent" | "audit" | "failed" | "cancelled";
};

type InviteForm = {
  nome: string;
  email: string;
  role: ProfileRole;
  /** Conta do portal (vazio = primeiro cliente com portal). Só para o perfil cliente. */
  customer_code: string;
};

type InviteCustomer = {
  id?: string;
  code: string;
  name?: string;
  archived?: boolean;
  portal_status?: string;
  sku_prefix?: string;
};


type Person = {
  key: string;
  kind: "user" | "invite";
  id: string;
  name: string;
  email: string;
  role: unknown;
  /** O cliente do login de portal; os internos são da Dutelog. */
  customerCode: string;
  state: "active" | "removed" | "pending";
  emailStatus?: Invite["email_status"];
};

const INVITE_EMAIL_LABEL: Record<NonNullable<Invite["email_status"]>, string> = {
  pending: "E-mail agendado",
  sent: "E-mail enviado",
  audit: "E-mail não enviado",
  failed: "Falha no envio do e-mail",
  cancelled: "Envio cancelado",
};

const ROLE_ORDER: Record<ProfileRole, number> = {
  owner: 0,
  admin: 0,
  interno: 1,
  wms: 2,
  financeiro: 3,
  suporte: 4,
  campo: 5,
  comercial: 6,
  rh: 7,
  painel: 8,
  cliente: 9,
};

const ROLE_TONE: Record<ProfileRole, string> = {
  owner: "bg-muted text-foreground",
  admin: "bg-muted text-foreground",
  interno: "bg-info-soft text-info-soft-foreground",
  wms: "bg-warning-soft text-warning-soft-foreground",
  financeiro: "bg-success-soft text-success-soft-foreground",
  suporte: "bg-info-soft text-info-soft-foreground",
  campo: "bg-warning-soft text-warning-soft-foreground",
  comercial: "bg-success-soft text-success-soft-foreground",
  rh: "bg-info-soft text-info-soft-foreground",
  painel: "bg-muted text-foreground",
  cliente: "bg-agent-soft text-agent",
};

function roleOrder(role: unknown) {
  const known = normalizeProfileRole(role);
  return known ? ROLE_ORDER[known] : 99;
}

function roleTone(role: unknown) {
  const known = normalizeProfileRole(role);
  return known ? ROLE_TONE[known] : "bg-muted";
}

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

async function copyInviteLink(token: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(inviteLink(token));
    return true;
  } catch {
    return false;
  }
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

  // "Convidar" em Configurações › Clientes chega com ?convidar=cliente&cliente=<código>.
  const [inviteOpen, setInviteOpen] = useState(
    () => new URLSearchParams(window.location.search).get("convidar") === "cliente",
  );
  const [inviteForm, setInviteForm] = useState<InviteForm>(() => ({
    nome: "",
    email: "",
    role: "cliente",
    customer_code: new URLSearchParams(window.location.search).get("cliente") ?? "",
  }));

  // Clientes com portal, para escolher a conta que a pessoa convidada acessa.
  const customers = useQuery({
    queryKey: ["invite-customers"],
    enabled: inviteOpen,
    queryFn: async (): Promise<InviteCustomer[]> => {
      const response = await fetch("/api/customers?status=active&limit=250");
      const payload = (await jsonOrThrow(response, "Não foi possível carregar os clientes.")) as {
        items?: InviteCustomer[];
        data?: InviteCustomer[];
      };
      return inviteCustomers(payload.items ?? payload.data ?? []);
    },
  });
  const portalCustomers = customers.data ?? [];
  // Só o cliente escolhido (o do "Convidar" de Clientes ou o da lista): o
  // link dá o portal dele a quem o recebe.
  const inviteCustomerCode = inviteForm.customer_code;
  const inviteCustomerName =
    portalCustomers.find((customer) => customer.code === inviteCustomerCode)?.name || inviteCustomerCode;
  const inviteMissingCustomer = inviteForm.role === "cliente" && !inviteCustomerCode;
  const [removing, setRemoving] = useState<Person | null>(null);
  const [reason, setReason] = useState("");

  const invites = useQuery({
    queryKey: ["invites"],
    refetchInterval: (query) => query.state.data?.some((invite) => invite.status === "pending") ? 30_000 : false,
    queryFn: async (): Promise<Invite[]> => {
      if (!firestore) return [];
      const snapshot = await getDocs(collection(firestore, "invites"));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Invite);
    },
  });

  const pendingInviteIds = useRef(new Set<string>());
  useEffect(() => {
    if (!invites.data) return;
    const accepted = invites.data.some((invite) => invite.status === "used" && pendingInviteIds.current.has(invite.id));
    pendingInviteIds.current = new Set(invites.data.filter((invite) => invite.status === "pending").map((invite) => invite.id));
    if (accepted) void qc.invalidateQueries({ queryKey: getListBillingUsersQueryKey() });
  }, [invites.data, qc]);

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
      customerCode: String(item.customer_code ?? ""),
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
        customerCode: invite.customer_code ?? "",
        state: "pending" as const,
        emailStatus: invite.email_status,
      }));
    const stateOrder = { active: 0, pending: 1, removed: 2 };
    return [...users, ...pending].sort(
      (left, right) =>
        stateOrder[left.state] - stateOrder[right.state] ||
        roleOrder(left.role) - roleOrder(right.role) ||
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
          customer_code: role === "cliente" ? inviteCustomerCode : "Dutelog",
        }),
      });
      await jsonOrThrow(response, "Não foi possível criar o convite.");
      return token;
    },
    onSuccess: async (token) => {
      setInviteOpen(false);
      setInviteForm({ nome: "", email: "", role: "cliente", customer_code: "" });
      await refresh();
      const copied = await copyInviteLink(token);
      toast({
        title: "Convite criado",
        description: copied
          ? "O envio por e-mail foi agendado. O link também foi copiado."
          : "O envio por e-mail foi agendado. Você pode copiar o link nas ações do convite.",
      });
    },
    onError: failure("Convite não criado"),
  });

  const resendInvite = useMutation({
    mutationFn: async (token: string) =>
      jsonOrThrow(
        await fetch(`/api/invites/${encodeURIComponent(token)}/resend`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
        "Não foi possível reenviar o convite.",
      ),
    onSuccess: async () => {
      await refresh();
      toast({ title: "Reenvio agendado", description: "O convite será enviado por e-mail em alguns minutos." });
    },
    onError: failure("Convite não reenviado"),
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
                              roleTone(person.role),
                            )}
                          >
                            {roleLabel(person.role)}
                            {normalizeProfileRole(person.role) === "cliente" && person.customerCode ? ` · ${person.customerCode}` : ""}
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
                          {person.kind === "invite" && person.emailStatus ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {INVITE_EMAIL_LABEL[person.emailStatus]}
                            </div>
                          ) : null}
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
                                  disabled={person.emailStatus === "pending" || resendInvite.isPending}
                                  onSelect={() => resendInvite.mutate(person.id)}
                                >
                                  Reenviar convite por e-mail
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={async () => {
                                    const copied = await copyInviteLink(person.id);
                                    toast(copied
                                      ? { title: "Link do convite copiado" }
                                      : { title: "Não foi possível copiar o link", description: "Permita a cópia no navegador e tente novamente.", variant: "destructive" });
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
            {visibleRoleInfo().map((info) => (
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
            <DialogDescription>
              O convite chega por e-mail em alguns minutos. A pessoa define a própria senha ao aceitar.
            </DialogDescription>
          </DialogHeader>
          <form
            id="invite-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (inviteMissingCustomer) return;
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
              </p>
            </div>
            {inviteForm.role === "cliente" ? (
              <div className="space-y-2">
                <Label>Cliente</Label>
                <Select
                  value={inviteCustomerCode}
                  onValueChange={(customer_code) => setInviteForm((state) => ({ ...state, customer_code }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {(portalCustomers.length
                      ? portalCustomers
                      : inviteCustomerCode
                        ? [{ code: inviteCustomerCode, name: inviteCustomerName }]
                        : []
                    ).map((customer) => (
                      <SelectItem key={customer.code} value={customer.code}>
                        {customer.name || customer.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {inviteCustomerCode ? (
                  <p className="text-xs text-muted-foreground">
                    A pessoa entra no portal de {inviteCustomerName} e vê só a operação desse cliente. Cadastro
                    em Configurações › Clientes.
                  </p>
                ) : null}
              </div>
            ) : null}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="invite-form" disabled={createInvite.isPending || inviteMissingCustomer}>
              {createInvite.isPending ? "Criando..." : "Criar convite e enviar e-mail"}
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
