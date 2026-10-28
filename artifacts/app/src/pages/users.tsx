import {
  useListBillingUsers,
  getListBillingUsersQueryKey,
  useUpdateUserRole,
} from "@workspace/api-client-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import { CircleHelp, Mail, MoreHorizontal, Plus, Search } from "lucide-react";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ROLE_INFO,
  assignableRoles,
  canManagePerson,
  roleLabel,
  visibleRoleInfo,
} from "@/lib/access";
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
  email_requested_at?: { toDate?: () => Date; seconds?: number } | string;
  reinvite_user_id?: string;
  login_preparation_pending?: boolean;
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
  lastSentAt?: Invite["email_requested_at"];
  loginPreparationPending?: boolean;
};

const INVITE_EMAIL_LABEL: Record<
  NonNullable<Invite["email_status"]>,
  string
> = {
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

function lastInviteRequest(value: Invite["email_requested_at"]) {
  if (!value) return null;
  const date =
    typeof value === "string"
      ? new Date(value)
      : (value.toDate?.() ?? new Date((value.seconds ?? 0) * 1000));
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function makeInviteToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
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
  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
  };
  if (!response.ok) throw new Error(payload.message || fallback);
  return payload;
}

export default function Users() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAppUser();
  const actorRole = normalizeProfileRole(user?.publicMetadata.role);
  const { data, isLoading, isError: usersError } = useListBillingUsers();
  const updateRole = useUpdateUserRole();

  // "Convidar" em Configurações › Clientes chega com ?convidar=cliente&cliente=<código>.
  const [inviteOpen, setInviteOpen] = useState(
    () =>
      new URLSearchParams(window.location.search).get("convidar") === "cliente",
  );
  const [inviteForm, setInviteForm] = useState<InviteForm>(() => ({
    nome: "",
    email: "",
    role: "cliente",
    customer_code:
      new URLSearchParams(window.location.search).get("cliente") ?? "",
  }));

  // Clientes com portal, para escolher a conta que a pessoa convidada acessa.
  const customers = useQuery({
    queryKey: ["invite-customers"],
    enabled: inviteOpen,
    queryFn: async (): Promise<InviteCustomer[]> => {
      const response = await fetch("/api/customers?status=active&limit=250");
      const payload = (await jsonOrThrow(
        response,
        "Não foi possível carregar os clientes.",
      )) as {
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
    portalCustomers.find((customer) => customer.code === inviteCustomerCode)
      ?.name || inviteCustomerCode;
  const inviteMissingCustomer =
    inviteForm.role === "cliente" && !inviteCustomerCode;
  const [view, setView] = useState("people");
  const [search, setSearch] = useState("");
  const [situation, setSituation] = useState("all");
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [resending, setResending] = useState<Person | null>(null);
  const [archiving, setArchiving] = useState<Person | null>(null);
  const [removing, setRemoving] = useState<Person | null>(null);
  const [reason, setReason] = useState("");

  const invites = useQuery({
    queryKey: ["invites"],
    refetchInterval: (query) =>
      query.state.data?.some((invite) => invite.status === "pending")
        ? 30_000
        : false,
    queryFn: async (): Promise<Invite[]> => {
      if (!firestore) return [];
      const snapshot = await getDocs(collection(firestore, "invites"));
      return snapshot.docs.map(
        (item) => ({ id: item.id, ...item.data() }) as Invite,
      );
    },
  });

  const pendingInviteIds = useRef(new Set<string>());
  useEffect(() => {
    if (!invites.data) return;
    const accepted = invites.data.some(
      (invite) =>
        invite.status === "used" && pendingInviteIds.current.has(invite.id),
    );
    pendingInviteIds.current = new Set(
      invites.data
        .filter((invite) => invite.status === "pending")
        .map((invite) => invite.id),
    );
    if (accepted)
      void qc.invalidateQueries({ queryKey: getListBillingUsersQueryKey() });
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
    const users = (
      (data?.items ?? []) as unknown as Array<Record<string, unknown>>
    )
      .filter((item) => item.directory_hidden !== true)
      .map((item) => ({
        key: `user:${item.id}`,
        kind: "user" as const,
        id: String(item.id),
        name: String(item.nome || item.email || "Sem nome"),
        email: String(item.email ?? ""),
        role: item.role,
        customerCode: String(item.customer_code ?? ""),
        state:
          item.access_disabled === true
            ? ("removed" as const)
            : ("active" as const),
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
        lastSentAt: invite.email_requested_at,
        loginPreparationPending: invite.login_preparation_pending,
      }));
    const stateOrder = { active: 0, pending: 1, removed: 2 };
    return [...users, ...pending].sort(
      (left, right) =>
        stateOrder[left.state] - stateOrder[right.state] ||
        roleOrder(left.role) - roleOrder(right.role) ||
        left.name.localeCompare(right.name, "pt-BR"),
    );
  }, [data, invites.data]);

  const directoryPeople = people.filter((person) => person.state !== "removed");
  const archivedPeople = people.filter((person) => person.state === "removed");
  const searchText = search.trim().toLocaleLowerCase("pt-BR");
  const visiblePeople = (
    view === "archived" ? archivedPeople : directoryPeople
  ).filter(
    (person) =>
      (situation === "all" || person.state === situation) &&
      (!searchText ||
        `${person.name} ${person.email}`
          .toLocaleLowerCase("pt-BR")
          .includes(searchText)),
  );
  const inviteAgain = (person: Person) => {
    const role = normalizeProfileRole(person.role);
    setInviteForm({
      nome: person.name,
      email: person.email,
      role: role && roles.includes(role) ? role : "cliente",
      customer_code: person.customerCode,
    });
    setInviteOpen(true);
  };

  const createAttempt = useRef<{
    fingerprint: string;
    token: string;
    idempotency_key: string;
  } | null>(null);
  const resendAttempts = useRef(new Map<string, string>());
  const createInvite = useMutation({
    mutationFn: async () => {
      const role = inviteForm.role;
      const fields = {
        nome: inviteForm.nome.trim(),
        email: inviteForm.email.trim().toLowerCase(),
        role,
        customer_code: role === "cliente" ? inviteCustomerCode : "Dutelog",
      };
      const fingerprint = JSON.stringify(fields);
      if (createAttempt.current?.fingerprint !== fingerprint)
        createAttempt.current = {
          fingerprint,
          token: makeInviteToken(),
          idempotency_key: crypto.randomUUID(),
        };
      const { token, idempotency_key } = createAttempt.current;
      const response = await fetch("/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          idempotency_key,
          ...fields,
        }),
      });
      await jsonOrThrow(response, "Não foi possível criar o convite.");
      return token;
    },
    onSuccess: async (token) => {
      createAttempt.current = null;
      setInviteOpen(false);
      setView("people");
      setSituation("all");
      setSearch("");
      setInviteForm({
        nome: "",
        email: "",
        role: "cliente",
        customer_code: "",
      });
      await refresh();
      const copied = await copyInviteLink(token);
      toast({
        title: "Convite criado",
        description: copied
          ? "O envio por e-mail foi agendado. O link também foi copiado."
          : "O envio por e-mail foi agendado. Você pode copiar o link nas ações do convite.",
      });
    },
    onError: async (error) => {
      await refresh();
      failure("Convite não criado")(error);
    },
  });

  const resendInvite = useMutation({
    mutationFn: async (token: string) => {
      if (!resendAttempts.current.has(token))
        resendAttempts.current.set(token, crypto.randomUUID());
      return jsonOrThrow(
        await fetch(`/api/invites/${encodeURIComponent(token)}/resend`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            idempotency_key: resendAttempts.current.get(token),
          }),
        }),
        "Não foi possível reenviar o convite.",
      );
    },
    onSuccess: async (_result, token) => {
      resendAttempts.current.delete(token);
      setResending(null);
      await refresh();
      toast({
        title: "Reenvio agendado",
        description: "O convite será enviado por e-mail em alguns minutos.",
      });
    },
    onError: failure("Convite não reenviado"),
  });

  const cancelInvite = useMutation({
    mutationFn: async (token: string) =>
      jsonOrThrow(
        await fetch(`/api/invites/${encodeURIComponent(token)}`, {
          method: "DELETE",
        }),
        "Não foi possível cancelar o convite.",
      ),
    onSuccess: async () => {
      await refresh();
      toast({ title: "Convite cancelado" });
    },
    onError: failure("Convite não cancelado"),
  });

  const archivePerson = useMutation({
    mutationFn: async (person: Person) =>
      jsonOrThrow(
        await fetch(
          `/api/billing/users/${encodeURIComponent(person.id)}/archive`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          },
        ),
        "Não foi possível remover a pessoa da lista.",
      ),
    onSuccess: async () => {
      setArchiving(null);
      await refresh();
      toast({
        title: "Pessoa removida da lista",
        description:
          "O histórico foi preservado. Você poderá convidar este e-mail novamente.",
      });
    },
    onError: failure("Pessoa não removida"),
  });

  const setAccess = useMutation({
    mutationFn: async (input: {
      id: string;
      active: boolean;
      reason?: string;
    }) =>
      jsonOrThrow(
        await fetch(
          `/api/billing/users/${encodeURIComponent(input.id)}/access`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              active: input.active,
              reason: input.reason || undefined,
            }),
          },
        ),
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
          toast({
            title: "Perfil alterado",
            description: `${person.name}: ${roleLabel(role)}`,
          });
        },
        onError: failure("Perfil não alterado"),
      },
    );

  const roles = assignableRoles(actorRole);

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Pessoas e acessos"
        description="Gerencie quem entra no sistema e o que cada pessoa pode fazer"
        actions={
          <>
            <Button variant="outline" onClick={() => setProfilesOpen(true)}>
              <CircleHelp className="mr-2 h-4 w-4" aria-hidden />
              Entender os perfis
            </Button>
            <Button onClick={() => setInviteOpen(true)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              Convidar pessoa
            </Button>
          </>
        }
      />

      <Tabs
        value={view}
        onValueChange={(value) => {
          setView(value);
          setSituation("all");
        }}
      >
        <TabsList aria-label="Situação das pessoas">
          <TabsTrigger
            value="people"
            className="gap-2 data-[state=active]:text-primary"
          >
            Pessoas{" "}
            <span className="rounded-sm bg-muted px-1.5 text-xs">
              {directoryPeople.length}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="archived"
            className="gap-2 data-[state=active]:text-primary"
          >
            Arquivados{" "}
            <span className="rounded-sm bg-muted px-1.5 text-xs">
              {archivedPeople.length}
            </span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value={view} className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Label htmlFor="people-search" className="sr-only">
                Buscar por nome ou e-mail
              </Label>
              <Search
                className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="people-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome ou e-mail"
                className="pl-9"
              />
            </div>
            {view === "people" ? (
              <Select value={situation} onValueChange={setSituation}>
                <SelectTrigger
                  aria-label="Filtrar por situação"
                  className="sm:w-56"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Situação: Todas</SelectItem>
                  <SelectItem value="active">Ativos</SelectItem>
                  <SelectItem value="pending">Convites pendentes</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
          </div>
          <section
            aria-label={
              view === "archived"
                ? "Pessoas com acesso removido"
                : "Pessoas e convites"
            }
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            {isLoading || invites.isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">
                Carregando pessoas...
              </p>
            ) : usersError || invites.isError ? (
              <div role="alert" className="space-y-3 p-6">
                <p className="text-sm">
                  Não foi possível carregar as pessoas e os convites.
                </p>
                <Button variant="outline" onClick={() => void refresh()}>
                  Tentar novamente
                </Button>
              </div>
            ) : visiblePeople.length === 0 ? (
              <div role="status" className="space-y-2 px-6 py-12 text-center">
                <p className="font-medium">
                  {searchText || situation !== "all"
                    ? "Nenhuma pessoa encontrada"
                    : view === "archived"
                      ? "Nenhum acesso removido"
                      : "Nenhuma pessoa cadastrada"}
                </p>
                {searchText || situation !== "all" ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSearch("");
                      setSituation("all");
                    }}
                  >
                    Limpar filtros
                  </Button>
                ) : null}
              </div>
            ) : (
              <div>
                <table className="block w-full text-sm lg:table">
                  <caption className="sr-only">
                    {view === "archived"
                      ? "Pessoas com acesso removido"
                      : "Pessoas e convites pendentes"}
                  </caption>
                  <thead className="hidden lg:table-header-group">
                    <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="w-1/3 px-5 py-3 font-semibold">
                        Pessoa
                      </th>
                      <th scope="col" className="px-3 py-3 font-semibold">
                        Perfil
                      </th>
                      <th scope="col" className="px-3 py-3 font-semibold">
                        Situação
                      </th>
                      <th
                        scope="col"
                        className="px-5 py-3 text-right font-semibold"
                      >
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody className="block lg:table-row-group">
                    {visiblePeople.map((person) => {
                      const self =
                        person.kind === "user" && person.id === user?.uid;
                      const manageable =
                        !self && canManagePerson(actorRole, person.role);
                      return (
                        <tr
                          key={person.key}
                          className={cn(
                            "grid grid-cols-2 items-center gap-x-2 gap-y-3 border-b border-border/60 p-4 last:border-0 lg:table-row lg:p-0",
                            person.state === "removed" &&
                              "text-muted-foreground",
                          )}
                        >
                          <td className="col-span-2 min-w-0 lg:px-5 lg:py-3">
                            <div className="flex items-center gap-3">
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-info-soft text-xs font-semibold text-info-soft-foreground">
                                {initials(person.name)}
                              </span>
                              <div className="min-w-0">
                                <div className="break-words font-medium text-foreground">
                                  {person.name}
                                  {self ? (
                                    <span className="ml-1.5 text-xs text-muted-foreground">
                                      (você)
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-0.5 break-all text-xs text-muted-foreground">
                                  {person.email}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="min-w-0 lg:px-3 lg:py-3">
                            <span
                              className={cn(
                                "inline-block rounded-md px-2 py-1 text-xs font-semibold lg:whitespace-nowrap",
                                roleTone(person.role),
                              )}
                            >
                              {roleLabel(person.role)}
                              {normalizeProfileRole(person.role) ===
                                "cliente" && person.customerCode
                                ? ` · ${person.customerCode}`
                                : ""}
                            </span>
                          </td>
                          <td className="min-w-0 text-right lg:whitespace-nowrap lg:px-3 lg:py-3 lg:text-left">
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
                            {person.kind === "invite" &&
                            person.lastSentAt &&
                            lastInviteRequest(person.lastSentAt) ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                Última solicitação:{" "}
                                {lastInviteRequest(person.lastSentAt)}
                              </div>
                            ) : null}
                            {person.kind === "invite" && person.emailStatus ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {INVITE_EMAIL_LABEL[person.emailStatus]}
                              </div>
                            ) : null}
                          </td>
                          <td className="col-span-2 lg:px-5 lg:py-3">
                            <div className="flex items-center justify-end gap-2">
                              {person.kind === "invite" &&
                              canManagePerson(actorRole, person.role) ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-primary"
                                  disabled={
                                    (person.emailStatus === "pending" &&
                                      !person.loginPreparationPending) ||
                                    resendInvite.isPending
                                  }
                                  onClick={() => setResending(person)}
                                >
                                  <Mail className="mr-2 h-4 w-4" aria-hidden />
                                  Reenviar convite
                                </Button>
                              ) : null}
                              {person.kind === "invite" &&
                              canManagePerson(actorRole, person.role) ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Ações de ${person.name}`}
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      disabled={
                                        (person.emailStatus === "pending" &&
                                          !person.loginPreparationPending) ||
                                        resendInvite.isPending
                                      }
                                      onSelect={() => setResending(person)}
                                    >
                                      Reenviar convite por e-mail
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={async () => {
                                        const copied = await copyInviteLink(
                                          person.id,
                                        );
                                        toast(
                                          copied
                                            ? {
                                                title:
                                                  "Link do convite copiado",
                                              }
                                            : {
                                                title:
                                                  "Não foi possível copiar o link",
                                                description:
                                                  "Permita a cópia no navegador e tente novamente.",
                                                variant: "destructive",
                                              },
                                        );
                                      }}
                                    >
                                      Copiar link do convite
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-destructive"
                                      onSelect={() =>
                                        cancelInvite.mutate(person.id)
                                      }
                                    >
                                      Cancelar convite
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : manageable ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Ações de ${person.name}`}
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    {person.state === "active" ? (
                                      <>
                                        <DropdownMenuSub>
                                          <DropdownMenuSubTrigger>
                                            Trocar perfil
                                          </DropdownMenuSubTrigger>
                                          <DropdownMenuSubContent>
                                            <DropdownMenuLabel>
                                              Perfil de {person.name}
                                            </DropdownMenuLabel>
                                            <DropdownMenuRadioGroup
                                              value={String(
                                                normalizeProfileRole(
                                                  person.role,
                                                ),
                                              )}
                                              onValueChange={(role) =>
                                                changeRole(person, role)
                                              }
                                            >
                                              {roles.map((role) => (
                                                <DropdownMenuRadioItem
                                                  key={role}
                                                  value={role}
                                                >
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
                                          Revogar acesso
                                        </DropdownMenuItem>
                                      </>
                                    ) : (
                                      <>
                                        <DropdownMenuItem
                                          onSelect={() => inviteAgain(person)}
                                        >
                                          Convidar novamente
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onSelect={() =>
                                            setAccess.mutate({
                                              id: person.id,
                                              active: true,
                                            })
                                          }
                                          disabled={setAccess.isPending}
                                        >
                                          Devolver acesso
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          className="text-destructive"
                                          onSelect={() => setArchiving(person)}
                                        >
                                          Remover da lista
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>

      <Dialog open={profilesOpen} onOpenChange={setProfilesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>O que cada perfil faz</DialogTitle>
            <DialogDescription>
              Permissões de cada perfil de acesso.
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-4">
            {visibleRoleInfo().map((info) => (
              <div key={info.role}>
                <dt className="text-sm font-semibold">{info.label}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">
                  {info.description}
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(resending)}
        onOpenChange={(open) =>
          !resendInvite.isPending && !open && setResending(null)
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reenviar convite?</DialogTitle>
            <DialogDescription>
              {resending?.name} receberá outro e-mail para aceitar o convite.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-muted p-4">
            <p className="font-medium">{resending?.name}</p>
            <p className="mt-1 break-all text-sm text-muted-foreground">
              {resending?.email}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Você não precisa excluir nem cadastrar a pessoa novamente.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={resendInvite.isPending}
              onClick={() => setResending(null)}
            >
              Cancelar
            </Button>
            <Button
              disabled={resendInvite.isPending}
              onClick={() => resending && resendInvite.mutate(resending.id)}
            >
              {resendInvite.isPending ? "Agendando..." : "Reenviar convite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(archiving)}
        onOpenChange={(open) =>
          !archivePerson.isPending && !open && setArchiving(null)
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remover {archiving?.name} da lista?
            </AlertDialogTitle>
            <AlertDialogDescription>
              O histórico de ações será preservado. Você poderá convidar este
              e-mail novamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="break-all text-sm text-muted-foreground">
            {archiving?.email}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archivePerson.isPending}>
              Manter na lista
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={archivePerson.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (archiving) archivePerson.mutate(archiving);
              }}
            >
              {archivePerson.isPending ? "Removendo..." : "Remover da lista"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Convidar pessoa</DialogTitle>
            <DialogDescription>
              O convite chega por e-mail em alguns minutos. A pessoa define a
              própria senha ao aceitar.
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
                onChange={(event) =>
                  setInviteForm((state) => ({
                    ...state,
                    nome: event.target.value,
                  }))
                }
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
                onChange={(event) =>
                  setInviteForm((state) => ({
                    ...state,
                    email: event.target.value,
                  }))
                }
                placeholder="email@empresa.com.br"
              />
            </div>
            <div className="space-y-2">
              <Label>Perfil</Label>
              <Select
                value={inviteForm.role}
                onValueChange={(role: ProfileRole) =>
                  setInviteForm((state) => ({ ...state, role }))
                }
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
                {
                  ROLE_INFO.find((info) => info.role === inviteForm.role)
                    ?.description
                }
              </p>
            </div>
            {inviteForm.role === "cliente" ? (
              <div className="space-y-2">
                <Label>Cliente</Label>
                <Select
                  value={inviteCustomerCode}
                  onValueChange={(customer_code) =>
                    setInviteForm((state) => ({ ...state, customer_code }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {(portalCustomers.length
                      ? portalCustomers
                      : inviteCustomerCode
                        ? [
                            {
                              code: inviteCustomerCode,
                              name: inviteCustomerName,
                            },
                          ]
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
                    A pessoa entra no portal de {inviteCustomerName} e vê só a
                    operação desse cliente. Cadastro em Configurações ›
                    Clientes.
                  </p>
                ) : null}
              </div>
            ) : null}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="invite-form"
              disabled={createInvite.isPending || inviteMissingCustomer}
            >
              {createInvite.isPending
                ? "Criando..."
                : "Criar convite e enviar e-mail"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revogar o acesso de {removing?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              A pessoa sai do sistema na hora e não consegue mais entrar. O
              histórico dela continua registrado, e você pode devolver o acesso
              depois.
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
                if (removing)
                  setAccess.mutate({ id: removing.id, active: false, reason });
              }}
              disabled={setAccess.isPending}
            >
              Revogar acesso
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
