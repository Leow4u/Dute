import { useListBillingUsers } from "@workspace/api-client-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { humanApiError } from "@/lib/permissions";
import { normalizeProfileRole } from "@/lib/modules";
import { cn } from "@/lib/utils";

/**
 * Cliente BTG: os dados do contrato e quem da BTG entra no portal. A operação
 * tem um cliente só; o cadastro dele é o documento `customers/BTG Pactual`.
 * O acesso de cada pessoa é decidido em Pessoas e acessos (perfil Cliente).
 */

export const BTG_CUSTOMER_CODE = "BTG Pactual";

type Customer = {
  id?: string;
  code?: string;
  name?: string;
  legal_name?: string;
  document?: string;
  status?: string;
  billing_mode?: string;
  primary_contact_name?: string;
  primary_contact_email?: string;
  notes?: string;
};

type ContractForm = {
  name: string;
  legal_name: string;
  document: string;
  primary_contact_name: string;
  primary_contact_email: string;
  notes: string;
};

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a operação.");
  return payload as T;
}

function customerCode(customer: Customer) {
  return String(customer.code ?? customer.id ?? "").trim();
}

/** O cadastro da BTG; sem ele, o primeiro cliente não arquivado. */
export function pickBtgCustomer(customers: Customer[]): Customer | undefined {
  return (
    customers.find((customer) => customerCode(customer) === BTG_CUSTOMER_CODE) ??
    customers.find((customer) => customer.status !== "archived")
  );
}

function billingModeLabel(mode: unknown) {
  if (mode === "custom") return "Sob medida";
  if (mode === "inactive") return "Sem cobrança";
  return "LPU";
}

function formFrom(customer?: Customer): ContractForm {
  return {
    name: customer?.name ?? BTG_CUSTOMER_CODE,
    legal_name: customer?.legal_name ?? "",
    document: customer?.document ?? "",
    primary_contact_name: customer?.primary_contact_name ?? "",
    primary_contact_email: customer?.primary_contact_email ?? "",
    notes: customer?.notes ?? "",
  };
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

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words", !value && "text-muted-foreground")}>
        {value || "Não informado"}
      </dd>
    </>
  );
}

export default function SettingsCustomer() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ContractForm>(formFrom());

  const customers = useQuery({
    queryKey: ["admin-customers"],
    queryFn: async () => {
      const payload = await apiJson<{ items?: Customer[]; data?: Customer[] } | Customer[]>(
        "/api/customers?limit=250",
      );
      return Array.isArray(payload) ? payload : (payload.items ?? payload.data ?? []);
    },
  });
  const customer = pickBtgCustomer(customers.data ?? []);

  const users = useListBillingUsers();
  const portalPeople = useMemo(
    () =>
      ((users.data?.items ?? []) as unknown as Array<Record<string, unknown>>)
        .filter((item) => normalizeProfileRole(item.role) === "cliente")
        .map((item) => ({
          id: String(item.id),
          name: String(item.nome || item.email || "Sem nome"),
          email: String(item.email ?? ""),
          active: item.access_disabled !== true,
        }))
        .sort(
          (left, right) =>
            Number(right.active) - Number(left.active) ||
            left.name.localeCompare(right.name, "pt-BR"),
        ),
    [users.data],
  );

  const save = useMutation({
    mutationFn: async () => {
      const data = {
        ...form,
        name: form.name.trim(),
        primary_contact_email: form.primary_contact_email.trim().toLowerCase(),
      };
      if (!data.name) throw new Error("Informe o nome do cliente.");
      if (customer) {
        return apiJson(`/api/customers/${encodeURIComponent(customer.id ?? customerCode(customer))}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        });
      }
      return apiJson("/api/customers", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          code: BTG_CUSTOMER_CODE,
          status: "active",
          billing_mode: "lpu",
          default_currency: "BRL",
        }),
      });
    },
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["admin-customers"] });
      toast({ title: "Dados do cliente salvos" });
    },
    onError: (error) =>
      toast({
        title: "Dados não salvos",
        description: humanApiError(error, "Tente novamente em instantes."),
        variant: "destructive",
      }),
  });

  const openEdit = () => {
    setForm(formFrom(customer));
    setEditing(true);
  };

  const contact = [customer?.primary_contact_name, customer?.primary_contact_email]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cliente BTG</h1>
          <p className="text-sm text-muted-foreground">
            Dados do contrato e quem da BTG acessa o portal
          </p>
        </div>
        <Button variant="outline" onClick={openEdit} disabled={customers.isLoading}>
          Editar dados
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <section className="overflow-hidden rounded-[18px] border border-border bg-white">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
              <h2 className="text-sm font-semibold">Contrato</h2>
              {customer ? (
                <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                  {customer.status === "paused" ? "Pausado" : "Ativo"}
                </span>
              ) : null}
            </div>
            {customers.isLoading ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">Carregando...</p>
            ) : (
              <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2.5 px-5 py-4 text-sm sm:grid-cols-[170px_minmax(0,1fr)]">
                <Field label="Cliente" value={customer?.name ?? BTG_CUSTOMER_CODE} />
                <Field label="Razão social" value={customer?.legal_name} />
                <Field label="CNPJ" value={customer?.document} />
                <Field label="Contato principal" value={contact} />
                <Field label="Observações" value={customer?.notes} />
              </dl>
            )}
          </section>

          <section className="overflow-hidden rounded-[18px] border border-border bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-3.5">
              <h2 className="text-sm font-semibold">Quem da BTG acessa o portal</h2>
              <Link
                href="/configuracoes/pessoas?convidar=cliente"
                className="inline-flex items-center gap-0.5 text-sm font-medium text-primary hover:underline"
              >
                Convidar pessoa da BTG
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
            {users.isLoading ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">Carregando...</p>
            ) : portalPeople.length ? (
              <ul>
                {portalPeople.map((person) => (
                  <li
                    key={person.id}
                    className={cn(
                      "flex items-center gap-3 border-b border-border/40 px-5 py-3 text-sm last:border-0",
                      !person.active && "text-muted-foreground",
                    )}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                      {initials(person.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-foreground">{person.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{person.email}</div>
                    </div>
                    <span className="whitespace-nowrap">
                      <span
                        className={cn(
                          "mr-2 inline-block h-2 w-2 rounded-full",
                          person.active ? "bg-green-600" : "bg-slate-400",
                        )}
                      />
                      {person.active ? "Ativo" : "Acesso removido"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                Ninguém da BTG tem acesso ao portal ainda.
              </p>
            )}
          </section>
        </div>

        <aside className="h-fit space-y-3">
          <Link
            href="/faturamento"
            className="block rounded-[18px] border border-border bg-white px-5 py-4 transition-colors hover:border-primary/40"
          >
            <div className="text-xs text-muted-foreground">Cobrança</div>
            <div className="mt-1 text-lg font-semibold">{billingModeLabel(customer?.billing_mode)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Tabela de preços e fechamento do mês em Faturamento ›
            </div>
          </Link>
          <p className="px-1 text-xs leading-5 text-muted-foreground">
            Para tirar o acesso de alguém da BTG ou trocar o perfil, use Pessoas e acessos.
          </p>
        </aside>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Dados do contrato</DialogTitle>
          </DialogHeader>
          <form
            id="contract-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="c-name">Nome exibido</Label>
              <Input
                id="c-name"
                required
                value={form.name}
                onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="c-legal">Razão social</Label>
                <Input
                  id="c-legal"
                  value={form.legal_name}
                  onChange={(event) => setForm((state) => ({ ...state, legal_name: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-doc">CNPJ</Label>
                <Input
                  id="c-doc"
                  value={form.document}
                  onChange={(event) => setForm((state) => ({ ...state, document: event.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="c-contact">Contato principal</Label>
                <Input
                  id="c-contact"
                  value={form.primary_contact_name}
                  onChange={(event) =>
                    setForm((state) => ({ ...state, primary_contact_name: event.target.value }))
                  }
                  placeholder="Nome"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-email">E-mail do contato</Label>
                <Input
                  id="c-email"
                  type="email"
                  value={form.primary_contact_email}
                  onChange={(event) =>
                    setForm((state) => ({ ...state, primary_contact_email: event.target.value }))
                  }
                  placeholder="nome@btgpactual.com"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-notes">Observações internas</Label>
              <Textarea
                id="c-notes"
                value={form.notes}
                onChange={(event) => setForm((state) => ({ ...state, notes: event.target.value }))}
                placeholder="Regras do contrato, ponto focal..."
              />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="contract-form" disabled={save.isPending}>
              {save.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
