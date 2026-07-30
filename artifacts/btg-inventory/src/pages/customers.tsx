import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Link2, Plus, Save, ShieldCheck, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ApiList<T> = {
  items?: T[];
  data?: T[];
};

type Customer = {
  id?: string;
  code?: string;
  name?: string;
  legal_name?: string;
  document?: string;
  status?: string;
  portal_status?: string;
  billing_mode?: string;
  default_currency?: string;
  primary_contact_name?: string;
  primary_contact_email?: string;
  notes?: string;
  updated_at?: unknown;
  created_at?: unknown;
};

type CustomerAccount = {
  id?: string;
  customer_code?: string;
  user_id?: string;
  email?: string;
  name?: string;
  role?: string;
  status?: string;
  portal_access?: string;
  notes?: string;
};

type CustomerForm = {
  code: string;
  name: string;
  legal_name: string;
  document: string;
  status: string;
  portal_status: string;
  billing_mode: string;
  primary_contact_name: string;
  primary_contact_email: string;
  notes: string;
};

type AccountForm = {
  customer_code: string;
  name: string;
  email: string;
  user_id: string;
  role: string;
  portal_access: string;
};

const emptyCustomerForm: CustomerForm = {
  code: "",
  name: "",
  legal_name: "",
  document: "",
  status: "active",
  portal_status: "active",
  billing_mode: "lpu",
  primary_contact_name: "",
  primary_contact_email: "",
  notes: "",
};

const emptyAccountForm: AccountForm = {
  customer_code: "",
  name: "",
  email: "",
  user_id: "",
  role: "cliente",
  portal_access: "enabled",
};

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
  };
  if (!response.ok) {
    throw new Error(payload.message || "Nao foi possivel concluir a operacao.");
  }
  return payload as T;
}

function listFromPayload<T>(payload: ApiList<T> | T[]): T[] {
  if (Array.isArray(payload)) return payload;
  return payload.items ?? payload.data ?? [];
}

function customerCode(customer: Customer) {
  return String(customer.code ?? customer.id ?? "").trim();
}

function statusLabel(status: unknown) {
  if (status === "active") return "Ativo";
  if (status === "paused") return "Pausado";
  if (status === "archived") return "Arquivado";
  return String(status ?? "Sem status");
}

function portalLabel(status: unknown) {
  if (status === "active") return "Portal ativo";
  if (status === "paused") return "Portal pausado";
  if (status === "disabled") return "Portal bloqueado";
  return String(status ?? "Portal sem status");
}

function modeLabel(mode: unknown) {
  if (mode === "lpu") return "LPU";
  if (mode === "custom") return "Sob medida";
  if (mode === "inactive") return "Sem cobranca";
  return String(mode ?? "LPU");
}

function makeCustomerForm(customer?: Customer): CustomerForm {
  if (!customer) return emptyCustomerForm;
  return {
    code: customerCode(customer),
    name: customer.name ?? "",
    legal_name: customer.legal_name ?? "",
    document: customer.document ?? "",
    status: customer.status ?? "active",
    portal_status: customer.portal_status ?? "active",
    billing_mode: customer.billing_mode ?? "lpu",
    primary_contact_name: customer.primary_contact_name ?? "",
    primary_contact_email: customer.primary_contact_email ?? "",
    notes: customer.notes ?? "",
  };
}

function compactPayload<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== ""),
  );
}

export default function Customers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customerForm, setCustomerForm] =
    useState<CustomerForm>(emptyCustomerForm);
  const [accountForm, setAccountForm] =
    useState<AccountForm>(emptyAccountForm);

  const customersQuery = useQuery({
    queryKey: ["admin-customers"],
    queryFn: async () =>
      listFromPayload<Customer>(
        await apiJson<ApiList<Customer> | Customer[]>("/api/customers?limit=250"),
      ),
  });

  const accountsQuery = useQuery({
    queryKey: ["admin-customer-accounts"],
    queryFn: async () =>
      listFromPayload<CustomerAccount>(
        await apiJson<ApiList<CustomerAccount> | CustomerAccount[]>(
          "/api/customer-accounts?limit=500",
        ),
      ),
  });

  const customers = useMemo(
    () =>
      [...(customersQuery.data ?? [])].sort((a, b) =>
        customerCode(a).localeCompare(customerCode(b), "pt-BR"),
      ),
    [customersQuery.data],
  );

  const accountsByCustomer = useMemo(() => {
    const map = new Map<string, CustomerAccount[]>();
    for (const account of accountsQuery.data ?? []) {
      const key = String(account.customer_code ?? "").trim();
      map.set(key, [...(map.get(key) ?? []), account]);
    }
    return map;
  }, [accountsQuery.data]);

  const activeCustomers = customers.filter(
    (customer) => customer.status !== "archived",
  );
  const portalEnabled = customers.filter(
    (customer) => customer.portal_status !== "disabled",
  );

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-customers"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-customer-accounts"] }),
    ]);
  };

  const saveCustomer = useMutation({
    mutationFn: async () => {
      const code = customerForm.code.trim();
      const data = compactPayload({
        ...customerForm,
        code,
        default_currency: "BRL",
      });
      if (!code || !customerForm.name.trim()) {
        throw new Error("Informe codigo e nome do cliente.");
      }
      const url = editingId
        ? `/api/customers/${encodeURIComponent(editingId)}`
        : "/api/customers";
      return apiJson(url, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: async () => {
      toast({ title: "Cliente salvo" });
      setEditingId(null);
      setCustomerForm(emptyCustomerForm);
      await refresh();
    },
    onError: (error) =>
      toast({
        title: "Erro ao salvar cliente",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      }),
  });

  const archiveCustomer = useMutation({
    mutationFn: async (id: string) =>
      apiJson(`/api/customers/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      toast({ title: "Cliente arquivado" });
      await refresh();
    },
  });

  const saveAccount = useMutation({
    mutationFn: async () => {
      const data = compactPayload(accountForm);
      if (!accountForm.customer_code || (!accountForm.email && !accountForm.user_id)) {
        throw new Error("Informe cliente e e-mail ou ID do usuario.");
      }
      return apiJson("/api/customer-accounts", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: async () => {
      toast({ title: "Vinculo de cliente salvo" });
      setAccountForm(emptyAccountForm);
      await refresh();
    },
    onError: (error) =>
      toast({
        title: "Erro ao vincular usuario",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      }),
  });

  const handleCustomerSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveCustomer.mutate();
  };

  const handleAccountSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveAccount.mutate();
  };

  const editCustomer = (customer: Customer) => {
    const code = customerCode(customer);
    setEditingId(customer.id ?? code);
    setCustomerForm(makeCustomerForm(customer));
    setAccountForm((current) => ({ ...current, customer_code: code }));
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-500">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal text-slate-900">
              Clientes
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Governanca de contas, portal e isolamento operacional. BTG segue
              como cliente inicial; novos contratos entram separados por codigo.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-2xl border border-slate-200 bg-white/75 px-4 py-3">
            <div className="text-xs text-slate-500">Clientes</div>
            <div className="text-xl font-semibold">{customers.length}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/75 px-4 py-3">
            <div className="text-xs text-slate-500">Ativos</div>
            <div className="text-xl font-semibold">{activeCustomers.length}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/75 px-4 py-3">
            <div className="text-xs text-slate-500">Com portal</div>
            <div className="text-xl font-semibold">{portalEnabled.length}</div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
        <Card className="rounded-3xl border-slate-200 bg-white/75 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <ShieldCheck className="h-4 w-4 text-blue-500" />
              Base de clientes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Codigo</TableHead>
                  <TableHead>Portal</TableHead>
                  <TableHead>Cobranca</TableHead>
                  <TableHead>Contatos</TableHead>
                  <TableHead className="text-right">Acoes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => {
                  const code = customerCode(customer);
                  const accounts = accountsByCustomer.get(code) ?? [];
                  return (
                    <TableRow key={customer.id ?? code}>
                      <TableCell>
                        <div className="font-medium text-slate-900">
                          {customer.name || code}
                        </div>
                        <div className="text-xs text-slate-500">
                          {customer.legal_name || customer.document || "Contrato sob medida"}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{code}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full",
                              customer.status === "archived"
                                ? "border-slate-200 text-slate-500"
                                : "border-blue-200 bg-blue-50 text-blue-600",
                            )}
                          >
                            {statusLabel(customer.status)}
                          </Badge>
                          <Badge variant="outline" className="rounded-full">
                            {portalLabel(customer.portal_status)}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>{modeLabel(customer.billing_mode)}</TableCell>
                      <TableCell>
                        <div className="text-sm">{accounts.length} vinculo(s)</div>
                        <div className="text-xs text-slate-500">
                          {customer.primary_contact_email || "Sem contato principal"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => editCustomer(customer)}
                          >
                            Editar
                          </Button>
                          {customer.status !== "archived" ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                archiveCustomer.mutate(customer.id ?? code)
                              }
                            >
                              Arquivar
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!customers.length && !customersQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-500">
                      Nenhum cliente cadastrado ainda.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-3xl border-slate-200 bg-white/75 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                {editingId ? "Editar cliente" : "Novo cliente"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleCustomerSubmit}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Codigo do cliente</Label>
                    <Input
                      value={customerForm.code}
                      onChange={(event) =>
                        setCustomerForm((current) => ({
                          ...current,
                          code: event.target.value,
                        }))
                      }
                      placeholder="BTG Pactual"
                      disabled={Boolean(editingId)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Nome exibido</Label>
                    <Input
                      value={customerForm.name}
                      onChange={(event) =>
                        setCustomerForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="BTG Pactual"
                      required
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select
                      value={customerForm.status}
                      onValueChange={(value) =>
                        setCustomerForm((current) => ({
                          ...current,
                          status: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Ativo</SelectItem>
                        <SelectItem value="paused">Pausado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Portal</Label>
                    <Select
                      value={customerForm.portal_status}
                      onValueChange={(value) =>
                        setCustomerForm((current) => ({
                          ...current,
                          portal_status: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Ativo</SelectItem>
                        <SelectItem value="paused">Pausado</SelectItem>
                        <SelectItem value="disabled">Bloqueado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Modo de cobranca</Label>
                  <Select
                    value={customerForm.billing_mode}
                    onValueChange={(value) =>
                      setCustomerForm((current) => ({
                        ...current,
                        billing_mode: value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lpu">LPU contratual</SelectItem>
                      <SelectItem value="custom">Sob medida</SelectItem>
                      <SelectItem value="inactive">Sem cobranca</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Contato principal</Label>
                    <Input
                      value={customerForm.primary_contact_name}
                      onChange={(event) =>
                        setCustomerForm((current) => ({
                          ...current,
                          primary_contact_name: event.target.value,
                        }))
                      }
                      placeholder="Nome"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>E-mail principal</Label>
                    <Input
                      type="email"
                      value={customerForm.primary_contact_email}
                      onChange={(event) =>
                        setCustomerForm((current) => ({
                          ...current,
                          primary_contact_email: event.target.value,
                        }))
                      }
                      placeholder="cliente@empresa.com.br"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Observacoes internas</Label>
                  <textarea
                    className="min-h-24 w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    value={customerForm.notes}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Regras operacionais, ponto focal, contrato..."
                  />
                </div>
                <div className="flex justify-end gap-2">
                  {editingId ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingId(null);
                        setCustomerForm(emptyCustomerForm);
                      }}
                    >
                      Cancelar
                    </Button>
                  ) : null}
                  <Button type="submit" disabled={saveCustomer.isPending}>
                    <Save className="mr-2 h-4 w-4" />
                    Salvar cliente
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-slate-200 bg-white/75 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Link2 className="h-4 w-4 text-blue-500" />
                Vincular usuario ao cliente
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleAccountSubmit}>
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <Select
                    value={accountForm.customer_code}
                    onValueChange={(value) =>
                      setAccountForm((current) => ({
                        ...current,
                        customer_code: value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((customer) => {
                        const code = customerCode(customer);
                        return (
                          <SelectItem key={code} value={code}>
                            {customer.name || code}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Nome</Label>
                    <Input
                      value={accountForm.name}
                      onChange={(event) =>
                        setAccountForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Cristiane"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>E-mail</Label>
                    <Input
                      type="email"
                      value={accountForm.email}
                      onChange={(event) =>
                        setAccountForm((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      placeholder="cliente@empresa.com.br"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>ID do usuario</Label>
                    <Input
                      value={accountForm.user_id}
                      onChange={(event) =>
                        setAccountForm((current) => ({
                          ...current,
                          user_id: event.target.value,
                        }))
                      }
                      placeholder="Opcional"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Acesso ao portal</Label>
                    <Select
                      value={accountForm.portal_access}
                      onValueChange={(value) =>
                        setAccountForm((current) => ({
                          ...current,
                          portal_access: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="enabled">Liberado</SelectItem>
                        <SelectItem value="disabled">Bloqueado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button type="submit" disabled={saveAccount.isPending}>
                  <Plus className="mr-2 h-4 w-4" />
                  Vincular
                </Button>
              </form>

              <div className="mt-6 space-y-2">
                {(accountsQuery.data ?? []).slice(0, 8).map((account) => (
                  <div
                    key={account.id ?? account.email ?? account.user_id}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white/60 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        <UserRound className="h-4 w-4 text-slate-400" />
                        <span className="truncate">{account.name || account.email || account.user_id}</span>
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {account.customer_code} · {account.email || "sem e-mail"}
                      </div>
                    </div>
                    <Badge variant="outline" className="rounded-full">
                      {account.portal_access === "disabled" ? "Bloqueado" : "Portal"}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
