import { useListBillingUsers } from "@workspace/api-client-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight, Mail, Pencil, Plus } from "lucide-react";

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
import { ErroNaLeitura } from "@/components/ui/erro-na-leitura";
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useIsDesktop } from "@/hooks/use-desktop";
import { useToast } from "@/hooks/use-toast";
import {
  buildCustomerRows,
  customerDocumentId,
  customerFormFrom,
  customerFormProblem,
  customerInitials,
  customerPayload,
  customerSituation,
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
  OPERATION_TEMPLATES,
  canonicalSkuPrefix,
  operationTemplate,
  packForCustomer,
  skuExample,
  suggestSkuPrefix,
  templateStatusLabel,
  type OperationTemplateKey,
} from "@/lib/operations";
import { comercialLiberado, PLATAFORMA_LIBERADA } from "@/lib/liberacao";
import { CLIENT_PROFILES_QUERY_KEY } from "@/lib/active-customer-context";
import { humanApiError } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/warehouse-ops/model";
import type { WarehousePosition } from "@/lib/warehouse-positions";
import SettingsCustomerNotifications from "./settings-customer-notifications";

/**
 * Configurações › Clientes: cada cliente nasce de um modelo de operação
 * (código, lib/operations). O que o modelo define vive em código; o que muda
 * por contrato entra no pacote do cliente, também em código. Aqui só se
 * escolhe o modelo, a sigla do SKU e o portal
 * (docs/multicliente-modelos-de-operacao.md).
 *
 * A tela é lista com ficha, como Clientes nos outros módulos
 * (docs/mockups/Cadastros.dc.html, ModOpClientes.dc.html): a lista à esquerda,
 * com nome, código, modelo e o selo do portal; a ficha do cliente escolhido à
 * direita, por seção (operação, armazém, portal e contrato), com "Editar" e
 * "Avisos por e-mail". No celular a ficha abre num sheet. Sem legenda: só
 * rótulos, dados e ações.
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

function Initials({ name, muted, large }: { name: string; muted?: boolean; large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-md font-semibold",
        large ? "h-12 w-12 text-sm" : "h-9 w-9 text-xs",
        muted ? "bg-muted text-muted-foreground" : "bg-info-soft text-info-soft-foreground",
      )}
    >
      {customerInitials(name)}
    </span>
  );
}

function FichaLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-0.5 text-sm font-medium text-primary hover:underline">
      {children}
      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

function Secao({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-5 py-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <dl className="mt-3 space-y-2.5">{children}</dl>
    </section>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[148px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** A lista: uma linha por cliente, com a linha escolhida marcada. */
function ListaDeClientes({
  rows,
  selectedCode,
  onSelect,
  archivedCount,
  showArchived,
  onToggleArchived,
}: {
  rows: CustomerRow[];
  selectedCode: string | null;
  onSelect: (code: string) => void;
  archivedCount: number;
  showArchived: boolean;
  onToggleArchived: () => void;
}) {
  return (
    <section aria-label="Lista de clientes" className="overflow-hidden rounded-lg border border-border bg-card">
      {rows.length === 0 ? (
        <p role="status" className="px-5 py-6 text-sm text-muted-foreground">
          Nenhum cliente ativo
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((row) => {
            const current = row.code === selectedCode;
            const situation = customerSituation(row);
            return (
              <li key={row.code}>
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  onClick={() => onSelect(row.code)}
                  className={cn(
                    "relative flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
                    current &&
                      "bg-muted/60 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary",
                  )}
                >
                  <Initials name={row.name} muted={row.archived} />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn("block truncate text-sm font-medium", row.archived ? "text-muted-foreground" : "text-foreground")}
                    >
                      {row.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {`${row.code} · ${row.profile.template.label}`}
                    </span>
                  </span>
                  <StatusBadge tone={situation.tone}>{situation.label}</StatusBadge>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground lg:hidden" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {archivedCount > 0 ? (
        <div className="border-t border-border/60 px-4 py-2 text-xs">
          <button type="button" className="font-medium text-primary hover:underline" onClick={onToggleArchived}>
            {showArchived ? "Esconder arquivados" : `Mostrar ${archivedCount} arquivado${archivedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * A ficha do cliente escolhido: o que o cadastro aponta (modelo, pacote e
 * sigla), o que vem de outras telas (a zona, de Estoque › Posições; as
 * pessoas, de Pessoas e acessos) e o contrato. Mudar é pelo diálogo "Editar".
 */
function FichaDoCliente({
  row,
  contactsEnabled,
  embedded = false,
  onEdit,
  onNotifications,
}: {
  row: CustomerRow;
  contactsEnabled: boolean;
  /** Dentro do sheet do celular: sem a própria borda e com espaço para o "Fechar". */
  embedded?: boolean;
  onEdit: () => void;
  onNotifications: () => void;
}) {
  const { profile, customer } = row;
  const contact = String(customer.primary_contact_name ?? "").trim();
  const email = String(customer.primary_contact_email ?? "").trim();
  const notes = String(customer.notes ?? "").trim();
  return (
    <article
      aria-labelledby="cliente-ficha-titulo"
      className={cn("overflow-hidden bg-card", !embedded && "rounded-lg border border-border")}
    >
      <header
        className={cn(
          "flex flex-col gap-4 border-b border-border/60 px-5 py-4 sm:flex-row sm:items-center",
          embedded && "pr-14",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Initials name={row.name} muted={row.archived} large />
          <div className="min-w-0">
            <h2 id="cliente-ficha-titulo" className="truncate text-lg font-semibold text-foreground">
              {row.name}
            </h2>
            <p className="truncate text-sm text-muted-foreground">{row.code}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {contactsEnabled ? (
            <Button variant="outline" size="sm" disabled={row.archived} onClick={onNotifications}>
              <Mail aria-hidden="true" />
              Avisos por e-mail
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil aria-hidden="true" />
            Editar
          </Button>
        </div>
      </header>
      <div className="divide-y divide-border/60">
        <Secao title="Operação">
          <Campo label="Modelo de operação">
            <span className="inline-flex flex-wrap items-center gap-2">
              {profile.template.label}
              <StatusBadge tone={profile.template.status === "ready" ? "ok" : "off"}>
                {templateStatusLabel(profile.template)}
              </StatusBadge>
            </span>
          </Campo>
          <Campo label="Pacote de código">{profile.pack ? <CodeBadge>{profile.pack.key}</CodeBadge> : "Nenhum"}</Campo>
          <Campo label="Sigla do SKU">
            {profile.skuPrefix ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <CodeBadge>{profile.skuPrefix}</CodeBadge>
                <span className="font-mono text-xs text-muted-foreground">{skuExample(profile.skuPrefix)}</span>
              </span>
            ) : (
              <StatusBadge tone="warn">A definir</StatusBadge>
            )}
          </Campo>
          {PLATAFORMA_LIBERADA ? (
            <Campo label="Módulos contratados">{profile.modules.map((key) => MODULO_ROTULO[key]).join(" · ")}</Campo>
          ) : null}
        </Secao>
        <Secao title="Armazém">
          <Campo label="Zona">
            {row.zone ? (
              <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                {zoneLabel(row.zone)}
                <FichaLink href="/estoque/posicoes">Posições</FichaLink>
              </span>
            ) : (
              <FichaLink href="/estoque/posicoes">{zoneLabel(null)}</FichaLink>
            )}
          </Campo>
        </Secao>
        <Secao title="Portal do cliente">
          <Campo label="Situação">
            {row.archived ? (
              <StatusBadge tone="off">Arquivado</StatusBadge>
            ) : profile.portalStatus === "active" ? (
              <StatusBadge tone="ok">Ativo</StatusBadge>
            ) : (
              <StatusBadge tone="off">Sem portal</StatusBadge>
            )}
          </Campo>
          <Campo label="Pessoas">
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              {peopleLabel(row.people)}
              {row.invitable ? (
                <FichaLink href={`/configuracoes/pessoas?convidar=cliente&cliente=${encodeURIComponent(row.code)}`}>
                  Convidar
                </FichaLink>
              ) : null}
            </span>
          </Campo>
        </Secao>
        <Secao title="Contrato">
          <Campo label="Situação">
            {row.archived ? (
              <StatusBadge tone="off">Arquivado</StatusBadge>
            ) : row.paused ? (
              <StatusBadge tone="warn">Pausado</StatusBadge>
            ) : (
              <StatusBadge tone="ok">Ativo</StatusBadge>
            )}
          </Campo>
          <Campo label="Razão social">{String(customer.legal_name ?? "").trim() || "—"}</Campo>
          <Campo label="CNPJ">{String(customer.document ?? "").trim() || "—"}</Campo>
          <Campo label="Contato principal">
            {contact || email ? (
              <>
                {contact ? <span className="block">{contact}</span> : null}
                {email ? <span className="block text-muted-foreground">{email}</span> : null}
              </>
            ) : (
              "—"
            )}
          </Campo>
          <Campo label="Observações internas">
            <span className="whitespace-pre-line">{notes || "—"}</span>
          </Campo>
        </Secao>
      </div>
    </article>
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
  const [notificationCustomer, setNotificationCustomer] = useState<CustomerRow | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const desktop = useIsDesktop();
  // O cadastro de contatos continua disponível quando só as telas do
  // Comercial estão pausadas; fora dos projetos liberados, a callable não atende.
  const contactsEnabled = comercialLiberado(import.meta.env.VITE_FIREBASE_PROJECT_ID);

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
  // No computador a ficha mostra sempre alguém: a escolha ou o primeiro da
  // lista. No celular só a escolha, que abre o sheet.
  const chosen = visible.find((row) => row.code === selectedCode) ?? null;
  const shown = chosen ?? (desktop ? (visible[0] ?? null) : null);

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
    mutationFn: async (): Promise<string | null> => {
      const problem = customerFormProblem(form, mode);
      if (problem) throw new Error(problem);
      if (dialog?.mode === "edit") {
        await apiJson(`/api/customers/${encodeURIComponent(customerDocumentId(dialog.row.customer))}`, {
          method: "PATCH",
          body: JSON.stringify(customerPayload(form, "edit", { modules: PLATAFORMA_LIBERADA })),
        });
        return null;
      }
      await apiJson("/api/customers", {
        method: "POST",
        body: JSON.stringify(customerPayload(form, "create", { modules: PLATAFORMA_LIBERADA })),
      });
      return form.code.trim();
    },
    onSuccess: async (created) => {
      closeDialog();
      await invalidate();
      // O cliente novo já abre na ficha.
      if (created) setSelectedCode(created);
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
    <div className="space-y-5">
      <PageHeader
        title="Clientes"
        actions={
          <Button onClick={openCreate} disabled={customers.isLoading}>
            <Plus aria-hidden="true" />
            Novo cliente
          </Button>
        }
      />

      {customers.isLoading ? (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-5 py-6 text-sm text-muted-foreground"
        >
          <Spinner />
          Carregando clientes…
        </div>
      ) : customers.isError ? (
        <ErroNaLeitura
          mensagem={humanApiError(customers.error, "Não foi possível carregar os clientes.")}
          tentando={customers.isFetching}
          onTentar={() => void customers.refetch()}
        />
      ) : rows.length === 0 ? (
        <p role="status" className="rounded-lg border border-border bg-card px-5 py-12 text-center text-sm font-medium">
          Nenhum cliente cadastrado
        </p>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <ListaDeClientes
            rows={visible}
            selectedCode={shown?.code ?? null}
            onSelect={setSelectedCode}
            archivedCount={archivedCount}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived((state) => !state)}
          />
          {desktop && shown ? (
            <FichaDoCliente
              row={shown}
              contactsEnabled={contactsEnabled}
              onEdit={() => openEdit(shown)}
              onNotifications={() => setNotificationCustomer(shown)}
            />
          ) : null}
        </div>
      )}

      {!desktop ? (
        <Sheet
          open={chosen !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedCode(null);
          }}
        >
          <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-lg bg-card p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{chosen?.name}</SheetTitle>
              <SheetDescription>{chosen?.code}</SheetDescription>
            </SheetHeader>
            {chosen ? (
              <FichaDoCliente
                row={chosen}
                embedded
                contactsEnabled={contactsEnabled}
                onEdit={() => openEdit(chosen)}
                onNotifications={() => setNotificationCustomer(chosen)}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      ) : null}

      {notificationCustomer ? (
        <SettingsCustomerNotifications
          key={notificationCustomer.code}
          customer={{ code: notificationCustomer.code, name: notificationCustomer.name }}
          onClose={() => setNotificationCustomer(null)}
        />
      ) : null}

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
