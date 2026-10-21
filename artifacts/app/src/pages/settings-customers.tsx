import { useListBillingUsers } from "@workspace/api-client-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight, Pencil, Plus } from "lucide-react";

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
import { MODULOS_CONTRATAVEIS, MODULO_ROTULO } from "@workspace/dominio";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  buildCustomerRows,
  customerDocumentId,
  customerFormFrom,
  customerFormProblem,
  customerPayload,
  emptyCustomerForm,
  peopleLabel,
  portalStatusFor,
  toggleContractedModule,
  zoneLabel,
  type CustomerForm,
  type CustomerRecord,
  type CustomerRow,
  type FormMode,
  type PersonRecord,
} from "@/lib/customer-registry";
import {
  OPERATION_PACKS,
  OPERATION_TEMPLATES,
  canonicalSkuPrefix,
  operationTemplate,
  packForCustomer,
  skuExample,
  suggestSkuPrefix,
  templateStatusLabel,
  type OperationTemplateKey,
} from "@/lib/operations";
import { PLATAFORMA_LIBERADA } from "@/lib/liberacao";
import { CLIENT_PROFILES_QUERY_KEY } from "@/lib/active-customer-context";
import { humanApiError } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/warehouse-ops/model";
import type { WarehousePosition } from "@/lib/warehouse-positions";

/**
 * Configurações › Clientes: cada cliente nasce de um modelo de operação
 * (código, lib/operations). O que o modelo define vive em código; o que muda
 * por contrato entra no pacote do cliente, também em código. Aqui só se
 * escolhe o modelo, a sigla do SKU e o portal
 * (docs/multicliente-modelos-de-operacao.md).
 */

const CUSTOMERS_KEY = ["admin-customers"];
const POSITIONS_KEY = ["warehouse-positions"];

type PositionsResponse = { items?: WarehousePosition[] };
type CustomersResponse = { items?: CustomerRecord[]; data?: CustomerRecord[] } | CustomerRecord[];
type DialogState = { mode: "create" } | { mode: "edit"; row: CustomerRow };

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(payload.message || "Não foi possível concluir a operação.");
  return payload as T;
}

function CodeBadge({ children, muted }: { children: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-0.5 font-mono text-xs font-medium",
        muted ? "bg-muted text-muted-foreground" : "bg-info-soft text-info-soft-foreground",
      )}
    >
      {children}
    </span>
  );
}

function StatusBadge({ tone, children }: { tone: "ok" | "off" | "warn"; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold",
        tone === "ok" && "bg-success-soft text-success-soft-foreground",
        tone === "warn" && "bg-warning-soft text-warning-soft-foreground",
        tone === "off" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function FormField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function SettingsCustomers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [form, setForm] = useState<CustomerForm>(emptyCustomerForm());
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [archiving, setArchiving] = useState<CustomerRow | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const customers = useQuery({
    queryKey: CUSTOMERS_KEY,
    queryFn: async () => {
      const payload = await apiJson<CustomersResponse>("/api/customers?limit=250");
      return Array.isArray(payload) ? payload : (payload.items ?? payload.data ?? []);
    },
  });
  const positions = useQuery({
    queryKey: POSITIONS_KEY,
    queryFn: () => fetchJson<PositionsResponse>("/api/warehouse/positions?limit=2000"),
  });
  const users = useListBillingUsers();

  const rows = useMemo(
    () =>
      buildCustomerRows(
        customers.data ?? [],
        positions.data?.items ?? [],
        (users.data?.items ?? []) as unknown as PersonRecord[],
      ),
    [customers.data, positions.data, users.data],
  );
  const archivedCount = rows.filter((row) => row.archived).length;
  const visible = showArchived ? rows : rows.filter((row) => !row.archived);

  const mode: FormMode = dialog?.mode === "edit" ? "edit" : "create";
  const template = operationTemplate(form.operation_template) ?? OPERATION_TEMPLATES[0];
  const pack = packForCustomer(form.code);
  const packApplies = pack !== null && pack.template === form.operation_template;
  const templateWithoutPortal = template.portal === null;

  const closeDialog = () => setDialog(null);

  const openCreate = () => {
    setForm(emptyCustomerForm());
    setPrefixTouched(false);
    setDialog({ mode: "create" });
  };

  const openEdit = (row: CustomerRow) => {
    setForm(customerFormFrom(row.customer));
    setPrefixTouched(true);
    setDialog({ mode: "edit", row });
  };

  const update = (patch: Partial<CustomerForm>) => setForm((state) => ({ ...state, ...patch }));

  const onNameChange = (name: string) => {
    // No cadastro novo a sigla acompanha o nome até a pessoa mexer nela.
    update(prefixTouched || mode === "edit" ? { name } : { name, sku_prefix: suggestSkuPrefix(name) });
  };

  const onTemplateChange = (operation_template: OperationTemplateKey) => {
    update({
      operation_template,
      portal_status: portalStatusFor(operation_template, form.portal_status),
    });
  };

  // O seletor de cliente ativo lê client_profiles, que o cadastro publica.
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY }),
      queryClient.invalidateQueries({ queryKey: CLIENT_PROFILES_QUERY_KEY }),
    ]);

  const save = useMutation({
    mutationFn: async () => {
      const problem = customerFormProblem(form, mode);
      if (problem) throw new Error(problem);
      if (dialog?.mode === "edit") {
        return apiJson(`/api/customers/${encodeURIComponent(customerDocumentId(dialog.row.customer))}`, {
          method: "PATCH",
          body: JSON.stringify(customerPayload(form, "edit", { modules: PLATAFORMA_LIBERADA })),
        });
      }
      return apiJson("/api/customers", {
        method: "POST",
        body: JSON.stringify(customerPayload(form, "create", { modules: PLATAFORMA_LIBERADA })),
      });
    },
    onSuccess: async () => {
      closeDialog();
      await invalidate();
      toast({ title: mode === "create" ? "Cliente cadastrado" : "Dados do cliente salvos" });
    },
    onError: (error) =>
      toast({
        title: "Cliente não salvo",
        description: humanApiError(error, "Tente novamente em instantes."),
        variant: "destructive",
      }),
  });

  const archive = useMutation({
    mutationFn: (row: CustomerRow) =>
      apiJson(`/api/customers/${encodeURIComponent(customerDocumentId(row.customer))}`, { method: "DELETE" }),
    onSuccess: async (_result, row) => {
      setArchiving(null);
      closeDialog();
      await invalidate();
      toast({ title: `${row.name} arquivado`, description: "O portal do cliente foi desligado." });
    },
    onError: (error) =>
      toast({
        title: "Cliente não arquivado",
        description: humanApiError(error, "Tente novamente em instantes."),
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clientes"
        description="Cada cliente nasce de um modelo de operação. O que o modelo define vive em código; o que muda por contrato entra no pacote do cliente, também em código. Aqui só se escolhe."
        actions={
          <Button onClick={openCreate} disabled={customers.isLoading}>
            <Plus className="h-4 w-4" />
            Novo cliente
          </Button>
        }
      />

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        {customers.isLoading ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        ) : customers.isError ? (
          <p className="px-5 py-4 text-sm text-destructive">
            {humanApiError(customers.error, "Não foi possível carregar os clientes.")}
          </p>
        ) : visible.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Nenhum cliente cadastrado. Comece pelo primeiro em "Novo cliente".
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="px-4 py-2.5 font-medium">Sigla do SKU</th>
                  <th className="px-4 py-2.5 font-medium">Modelo de operação</th>
                  <th className="px-4 py-2.5 font-medium">Pacote de código</th>
                  <th className="px-4 py-2.5 font-medium">Zona no armazém</th>
                  <th className="px-4 py-2.5 font-medium">Portal</th>
                  <th className="px-4 py-2.5 font-medium">Pessoas</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={row.code}
                    className={cn(
                      "border-b border-border/40 align-middle last:border-0",
                      row.archived && "text-muted-foreground",
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{row.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.code}
                        {row.paused ? " · pausado" : ""}
                        {row.archived ? " · arquivado" : ""}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {row.profile.skuPrefix ? (
                        <CodeBadge>{row.profile.skuPrefix}</CodeBadge>
                      ) : (
                        <StatusBadge tone="warn">a definir</StatusBadge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {row.profile.template.label}
                      {row.profile.template.status === "building" ? (
                        <span className="ml-1.5 text-xs text-muted-foreground">em construção</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {row.profile.pack ? (
                        <CodeBadge>{row.profile.pack.key}</CodeBadge>
                      ) : (
                        <span className="text-xs text-muted-foreground">sem pacote (só o modelo)</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {row.zone ? (
                        zoneLabel(row.zone)
                      ) : (
                        <Link href="/estoque/posicoes" className="text-muted-foreground hover:underline">
                          {zoneLabel(null)}
                        </Link>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {row.archived ? (
                        <StatusBadge tone="off">Arquivado</StatusBadge>
                      ) : row.profile.portalStatus === "active" ? (
                        <StatusBadge tone="ok">Ativo</StatusBadge>
                      ) : (
                        <StatusBadge tone="off">Sem portal</StatusBadge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {peopleLabel(row.people)}
                      {row.invitable ? (
                        <Link
                          href={`/configuracoes/pessoas?convidar=cliente&cliente=${encodeURIComponent(row.code)}`}
                          className="ml-2 inline-flex items-center text-xs font-medium text-primary hover:underline"
                        >
                          Convidar
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                        <Pencil className="h-4 w-4" />
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {archivedCount > 0 ? (
          <div className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => setShowArchived((state) => !state)}
            >
              {showArchived ? "Esconder arquivados" : `Mostrar ${archivedCount} arquivado${archivedCount === 1 ? "" : "s"}`}
            </button>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            1 · Modelo de operação (código)
          </div>
          <ul className="mt-3 space-y-2.5 text-sm">
            {OPERATION_TEMPLATES.map((item) => (
              <li key={item.key}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{item.label}</span>
                  <StatusBadge tone={item.status === "ready" ? "ok" : "off"}>{templateStatusLabel(item)}</StatusBadge>
                </div>
                <div className="text-xs leading-5 text-muted-foreground">{item.summary}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-border bg-card px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            2 · Pacote do cliente (código, opcional)
          </div>
          <ul className="mt-3 space-y-2.5 text-sm">
            {OPERATION_PACKS.map((item) => (
              <li key={item.key}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{item.label}</span>
                  <CodeBadge>{item.key}</CodeBadge>
                </div>
                <div className="text-xs leading-5 text-muted-foreground">{item.summary}</div>
              </li>
            ))}
            <li className="text-xs leading-5 text-muted-foreground">
              Uma solicitação específica de um cliente vira regra no pacote dele, com teste. Quando outro
              cliente pedir o mesmo, a regra sobe para o modelo.
            </li>
          </ul>
        </div>
        <div className="rounded-lg border border-border bg-card px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            3 · Cadastro (aqui)
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            O cadastro só aponta para o modelo e guarda a sigla do SKU. A zona no armazém é definida em
            Estoque › Posições; quem entra no portal, em Pessoas e acessos. O portal do cliente mostra só os
            módulos do modelo dele.
          </p>
        </div>
      </section>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[780px]">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Novo cliente" : `Dados de ${form.name || form.code}`}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_240px]">
            <form
              id="customer-form"
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id="c-name" label="Nome exibido">
                  <Input
                    id="c-name"
                    required
                    value={form.name}
                    onChange={(event) => onNameChange(event.target.value)}
                    placeholder="Itaú Unibanco"
                  />
                </FormField>
                <FormField
                  id="c-code"
                  label="Código operacional"
                  hint={
                    mode === "create"
                      ? "Como o cliente aparece em todo o sistema. Não muda depois."
                      : "Identifica o cliente em todo o sistema; não muda."
                  }
                >
                  <Input
                    id="c-code"
                    required={mode === "create"}
                    disabled={mode === "edit"}
                    value={form.code}
                    onChange={(event) => update({ code: event.target.value })}
                    placeholder="Itaú"
                  />
                </FormField>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <FormField id="c-prefix" label="Sigla do SKU" hint={`SKU gerado: ${skuExample(form.sku_prefix)}`}>
                  <Input
                    id="c-prefix"
                    required
                    value={form.sku_prefix}
                    maxLength={6}
                    className="font-mono uppercase"
                    onChange={(event) => {
                      setPrefixTouched(true);
                      update({ sku_prefix: canonicalSkuPrefix(event.target.value) });
                    }}
                    placeholder="ITAU"
                  />
                </FormField>
                <FormField id="c-template" label="Modelo de operação">
                  <Select
                    value={form.operation_template}
                    onValueChange={(value) => onTemplateChange(value as OperationTemplateKey)}
                  >
                    <SelectTrigger id="c-template">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATION_TEMPLATES.map((item) => (
                        <SelectItem key={item.key} value={item.key}>
                          {item.label}
                          {item.status === "building" ? " (em construção)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField
                  id="c-portal"
                  label="Portal do cliente"
                  hint={templateWithoutPortal ? "Este modelo não tem portal." : undefined}
                >
                  <Select
                    value={form.portal_status}
                    disabled={templateWithoutPortal}
                    onValueChange={(value) => update({ portal_status: value === "inactive" ? "inactive" : "active" })}
                  >
                    <SelectTrigger id="c-portal">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Ativo (módulos do modelo)</SelectItem>
                      <SelectItem value="inactive">Sem portal</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
              </div>

              {PLATAFORMA_LIBERADA ? (
                <fieldset className="min-w-0 space-y-1.5">
                  <legend className="text-sm font-medium leading-none">Módulos contratados</legend>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
                    {MODULOS_CONTRATAVEIS.map((key) => (
                      <label key={key} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={form.modules.includes(key)}
                          onCheckedChange={(checked) =>
                            update({ modules: toggleContractedModule(form.modules, key, checked === true) })
                          }
                        />
                        {MODULO_ROTULO[key]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              <div
                className={cn(
                  "space-y-1 rounded-md border px-3.5 py-3",
                  packApplies ? "border-info-soft bg-info-soft/60" : "border-border bg-muted/40",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
                  <span>Pacote de código do cliente</span>
                  {pack ? <CodeBadge muted={!packApplies}>{pack.file}</CodeBadge> : null}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {packApplies
                    ? `Encontrado no repositório para o código operacional "${form.code.trim()}". Ele parte do modelo ${template.label} e muda só o que o contrato pede.`
                    : pack
                      ? `O pacote ${pack.key} é do modelo ${operationTemplate(pack.template)?.label ?? pack.template}; com outro modelo ele não se aplica e o cliente usa o modelo puro.`
                      : form.code.trim()
                        ? `Nenhum pacote no repositório para "${form.code.trim()}": o cliente usa o modelo puro. Regra própria dele entra num pacote, por PR.`
                        : "Sem pacote, o cliente usa o modelo puro. Regra própria de um cliente entra num pacote, por PR."}
                </p>
              </div>

              {mode === "edit" ? (
                <FormField id="c-status" label="Situação do contrato">
                  <Select value={form.status} onValueChange={(value) => update({ status: value === "paused" ? "paused" : "active" })}>
                    <SelectTrigger id="c-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="paused">Pausado</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id="c-legal" label="Razão social">
                  <Input id="c-legal" value={form.legal_name} onChange={(event) => update({ legal_name: event.target.value })} />
                </FormField>
                <FormField id="c-doc" label="CNPJ">
                  <Input id="c-doc" value={form.document} onChange={(event) => update({ document: event.target.value })} />
                </FormField>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id="c-contact" label="Contato principal">
                  <Input
                    id="c-contact"
                    value={form.primary_contact_name}
                    onChange={(event) => update({ primary_contact_name: event.target.value })}
                    placeholder="Nome"
                  />
                </FormField>
                <FormField id="c-email" label="E-mail do contato">
                  <Input
                    id="c-email"
                    type="email"
                    value={form.primary_contact_email}
                    onChange={(event) => update({ primary_contact_email: event.target.value })}
                    placeholder="nome@empresa.com.br"
                  />
                </FormField>
              </div>
              <FormField id="c-notes" label="Observações internas" hint="Só a equipe Dutelog vê; o portal não recebe este campo.">
                <Textarea
                  id="c-notes"
                  value={form.notes}
                  onChange={(event) => update({ notes: event.target.value })}
                  placeholder="Regras do contrato, ponto focal..."
                />
              </FormField>
            </form>

            <aside className="h-fit space-y-3 rounded-lg border border-border bg-muted/40 px-4 py-4 text-sm">
              <div>
                <div className="font-semibold">O que o modelo {template.label} define</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{templateStatusLabel(template)}</div>
              </div>
              <dl className="space-y-2">
                {template.defines.map((item) => (
                  <div key={item.label} className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 text-xs leading-5">
                    <dt className="text-muted-foreground">{item.label}</dt>
                    <dd className="min-w-0">{item.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="border-t border-border/60 pt-3 text-xs leading-5 text-muted-foreground">
                Definido em código, em {template.file}, com teste. Mudar o modelo é um PR, não uma tela.
              </p>
            </aside>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {dialog?.mode === "edit" && !dialog.row.archived ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setArchiving(dialog.row)}
              >
                Arquivar cliente
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeDialog}>
                Cancelar
              </Button>
              <Button type="submit" form="customer-form" disabled={save.isPending}>
                {save.isPending ? "Salvando..." : mode === "create" ? "Criar cliente" : "Salvar"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={archiving !== null} onOpenChange={(open) => !open && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar {archiving?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              O cadastro sai da lista e o portal do cliente é desligado. Estoque, pedidos, faturas e
              eventos continuam no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={archive.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (archiving) archive.mutate(archiving);
              }}
            >
              {archive.isPending ? "Arquivando..." : "Arquivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
