import {
  useListBillingUsers,
  getListBillingUsersQueryKey,
  useUpdateUserRole,
} from "@workspace/api-client-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { Copy, Plus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { firestore } from "@/lib/firebase";
import { useAppUser } from "@/lib/auth";
import { normalizeProfileRole, type ProfileRole } from "@/lib/modules";

type InviteRole = ProfileRole;

const ACCESS_ROLE_OPTIONS: Array<{ value: InviteRole; label: string }> = [
  { value: "cliente", label: "Cliente" },
  { value: "interno", label: "Interno Dutelog" },
  { value: "wms", label: "Operação WMS" },
  { value: "financeiro", label: "Financeiro" },
  { value: "suporte", label: "Suporte" },
];

function roleLabel(role: unknown) {
  const normalized = normalizeProfileRole(role);
  if (normalized === "owner") return "Owner Dutelog";
  if (normalized === "admin") return "Admin Dutelog";
  if (normalized === "wms") return "Operação WMS";
  if (normalized === "financeiro") return "Financeiro";
  if (normalized === "suporte") return "Suporte";
  if (normalized === "interno") return "Interno Dutelog";
  if (normalized === "cliente") return "Cliente";
  return "Sem perfil";
}

function isClientRole(role: unknown) {
  return normalizeProfileRole(role) === "cliente";
}

type Invite = {
  id: string;
  nome?: string;
  email: string;
  role: InviteRole;
  customer_code?: string;
  status: "pending" | "used";
  used_by?: string;
};

type InviteForm = {
  nome: string;
  email: string;
  role: InviteRole;
};

const initialInviteForm: InviteForm = {
  nome: "",
  email: "",
  role: "cliente",
};

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

async function copyInvite(token: string) {
  await navigator.clipboard.writeText(inviteLink(token));
}

export default function Users() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAppUser();
  const { data, isLoading } = useListBillingUsers();
  const update = useUpdateUserRole();
  const [form, setForm] = useState<InviteForm>(initialInviteForm);

  const invites = useQuery({
    queryKey: ["invites"],
    queryFn: async (): Promise<Invite[]> => {
      if (!firestore) return [];
      const snapshot = await getDocs(collection(firestore, "invites"));
      return snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }) as Invite)
        .sort((a, b) => a.email.localeCompare(b.email));
    },
  });

  const createInvite = useMutation({
    mutationFn: async (input: InviteForm) => {
      if (!firestore) throw new Error("Firestore não configurado.");
      const token = makeInviteToken();
      const email = input.email.trim().toLowerCase();
      const customerCode = isClientRole(input.role) ? "BTG Pactual" : "Dutelog";

      await setDoc(doc(firestore, "invites", token), {
        nome: input.nome.trim(),
        email,
        role: input.role,
        customer_code: customerCode,
        status: "pending",
        created_by: user?.uid ?? null,
        created_at: serverTimestamp(),
      });

      await fetch("/api/ai/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "access.invite_created",
          title: "Convite de acesso criado",
          description: `${roleLabel(input.role)} convidado: ${email}`,
          severity: "info",
          entity_type: "convite",
          entity_id: token,
          customer_code: customerCode,
          payload: {
            nome: input.nome.trim(),
            email,
            role: input.role,
            customer_code: customerCode,
          },
        }),
      }).catch(() => undefined);

      return token;
    },
    onSuccess: async (token) => {
      setForm(initialInviteForm);
      await invites.refetch();
      await copyInvite(token).catch(() => undefined);
      toast({ title: "Convite criado e link copiado" });
    },
    onError: () => {
      toast({ title: "Erro ao criar convite", variant: "destructive" });
    },
  });

  const handleChange = (id: string, role: string) => {
    update.mutate(
      { id, data: { role } },
      {
        onSuccess: () => {
          toast({ title: "Papel atualizado" });
          qc.invalidateQueries({ queryKey: getListBillingUsersQueryKey() });
        },
        onError: () =>
          toast({ title: "Erro ao atualizar papel", variant: "destructive" }),
      },
    );
  };

  const submitInvite = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createInvite.mutate(form);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          Usuários & Acessos
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Convide funcionários da Dutelog e clientes. O cadastro só funciona
          pelo link de convite.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Novo convite</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={submitInvite}
            className="grid gap-3 md:grid-cols-[1fr_1.2fr_180px_auto] md:items-end"
          >
            <div className="space-y-2">
              <Label htmlFor="invite-nome">Nome</Label>
              <Input
                id="invite-nome"
                value={form.nome}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    nome: event.target.value,
                  }))
                }
                placeholder="Nome do convidado"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">E-mail</Label>
              <Input
                id="invite-email"
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                placeholder="email@empresa.com.br"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Perfil</Label>
              <Select
                value={form.role}
                onValueChange={(value: InviteRole) =>
                  setForm((current) => ({ ...current, role: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCESS_ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={createInvite.isPending}>
              <Plus className="mr-2 h-4 w-4" />
              {createInvite.isPending ? "Criando..." : "Convidar"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Convites</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {invites.isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Carregando...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-28">Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.data?.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell className="font-medium">
                      {invite.nome || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {invite.email}
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={invite.role} />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          invite.status === "used"
                            ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                            : "bg-amber-100 text-amber-800 border-amber-200"
                        }
                      >
                        {invite.status === "used" ? "Usado" : "Pendente"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={invite.status !== "pending"}
                        onClick={async () => {
                          await copyInvite(invite.id);
                          toast({ title: "Link copiado" });
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usuários ativos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Carregando...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead className="w-48">Alterar papel</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.nome}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.email}
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={u.role as InviteRole} />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={u.role}
                        onValueChange={(v) => handleChange(u.id, v)}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ACCESS_ROLE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RoleBadge({ role }: { role: unknown }) {
  const normalized = normalizeProfileRole(role);
  const className =
    normalized === "cliente"
      ? "bg-blue-50 text-blue-700 border-blue-100"
      : normalized === "financeiro"
        ? "bg-emerald-50 text-emerald-700 border-emerald-100"
        : normalized === "wms"
          ? "bg-amber-50 text-amber-700 border-amber-100"
          : normalized === "suporte"
            ? "bg-sky-50 text-sky-700 border-sky-100"
            : normalized === "owner" || normalized === "admin"
              ? "bg-slate-100 text-slate-800 border-slate-200"
              : "bg-slate-50 text-slate-600 border-slate-100";

  return (
    <Badge variant="outline" className={className}>
      {roleLabel(role)}
    </Badge>
  );
}
