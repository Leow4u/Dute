import {
  DEFAULT_OPERATION_TEMPLATE,
  canonicalSkuPrefix,
  isOperationTemplateKey,
  operationTemplate,
  resolveOperationProfile,
  skuPrefixProblem,
  suggestSkuPrefix,
  type OperationProfile,
  type OperationTemplateKey,
  type PortalStatus,
} from "./operations";
import { summarizeZones, type WarehousePosition } from "./warehouse-positions";
import { LEGACY_CUSTOMER_CODE } from "./active-customer";

/**
 * Configurações › Clientes: o cadastro de cada cliente aponta para um modelo
 * de operação (código) e guarda a sigla que abre o SKU dele. A zona no
 * armazém vem de Estoque › Posições; as pessoas, de Pessoas e acessos. Aqui
 * ficam as regras puras da tela (formulário, payload e linhas da lista).
 */

export type CustomerRecord = {
  id?: string;
  code?: string;
  name?: string;
  legal_name?: string;
  document?: string;
  status?: string;
  portal_status?: string;
  billing_mode?: string;
  primary_contact_name?: string;
  primary_contact_email?: string;
  notes?: string;
  operation_template?: string;
  sku_prefix?: string;
  archived?: boolean;
};

export type CustomerStatus = "active" | "paused";

export type CustomerForm = {
  code: string;
  name: string;
  sku_prefix: string;
  operation_template: OperationTemplateKey;
  portal_status: PortalStatus;
  status: CustomerStatus;
  legal_name: string;
  document: string;
  primary_contact_name: string;
  primary_contact_email: string;
  notes: string;
};

export type FormMode = "create" | "edit";

/** Pessoa como vem da lista de Pessoas e acessos. */
export type PersonRecord = {
  role?: unknown;
  customer_code?: unknown;
  access_disabled?: unknown;
};

export type CustomerZone = { positions: number; aisles: string[] };

export type CustomerRow = {
  customer: CustomerRecord;
  code: string;
  name: string;
  profile: OperationProfile;
  zone: CustomerZone | null;
  people: number;
  archived: boolean;
  paused: boolean;
};


export function customerCode(customer: Pick<CustomerRecord, "code" | "id">): string {
  return String(customer.code ?? customer.id ?? "").trim();
}

export function customerDocumentId(customer: Pick<CustomerRecord, "code" | "id">): string {
  return String(customer.id ?? "").trim() || customerCode(customer);
}

export function emptyCustomerForm(): CustomerForm {
  return {
    code: "",
    name: "",
    sku_prefix: "",
    operation_template: DEFAULT_OPERATION_TEMPLATE,
    portal_status: "active",
    status: "active",
    legal_name: "",
    document: "",
    primary_contact_name: "",
    primary_contact_email: "",
    notes: "",
  };
}

/**
 * Formulário a partir do cadastro. Cadastro anterior ao modelo (a BTG) abre
 * no modelo padrão e com a sigla sugerida pelo nome, para a pessoa só confirmar.
 */
export function customerFormFrom(customer: CustomerRecord): CustomerForm {
  const template = isOperationTemplateKey(customer.operation_template)
    ? customer.operation_template
    : DEFAULT_OPERATION_TEMPLATE;
  const name = String(customer.name ?? "").trim() || customerCode(customer);
  return {
    code: customerCode(customer),
    name,
    sku_prefix: canonicalSkuPrefix(customer.sku_prefix) || suggestSkuPrefix(name),
    operation_template: template,
    portal_status: portalStatusFor(template, customer.portal_status),
    status: customer.status === "paused" ? "paused" : "active",
    legal_name: String(customer.legal_name ?? ""),
    document: String(customer.document ?? ""),
    primary_contact_name: String(customer.primary_contact_name ?? ""),
    primary_contact_email: String(customer.primary_contact_email ?? ""),
    notes: String(customer.notes ?? ""),
  };
}

/** Modelo sem portal força "sem portal"; os outros respeitam o cadastro. */
export function portalStatusFor(template: OperationTemplateKey, requested: unknown): PortalStatus {
  if (operationTemplate(template)?.portal === null) return "inactive";
  return requested === "inactive" ? "inactive" : "active";
}

/** Mensagem do primeiro problema do formulário, ou null quando pode salvar. */
export function customerFormProblem(form: CustomerForm, mode: FormMode): string | null {
  if (!form.name.trim()) return "Informe o nome do cliente.";
  if (mode === "create" && !form.code.trim()) {
    return "Informe o código operacional: é como o cliente aparece em todo o sistema.";
  }
  const prefix = skuPrefixProblem(form.sku_prefix);
  if (prefix) return prefix;
  if (!operationTemplate(form.operation_template)) return "Escolha o modelo de operação.";
  const email = form.primary_contact_email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "E-mail do contato inválido.";
  return null;
}

/**
 * O que vai para a Function. No update o código não vai (não muda); a sigla
 * vai sempre em maiúsculas; o portal de um modelo sem portal vai desligado.
 */
export function customerPayload(form: CustomerForm, mode: FormMode): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: form.name.trim(),
    sku_prefix: canonicalSkuPrefix(form.sku_prefix),
    operation_template: form.operation_template,
    portal_status: portalStatusFor(form.operation_template, form.portal_status),
    status: form.status,
    legal_name: form.legal_name.trim(),
    document: form.document.trim(),
    primary_contact_name: form.primary_contact_name.trim(),
    primary_contact_email: form.primary_contact_email.trim().toLowerCase(),
    notes: form.notes.trim(),
  };
  if (mode === "create") {
    return { ...payload, code: form.code.trim(), billing_mode: "lpu", default_currency: "BRL" };
  }
  return payload;
}

function isActiveClientPerson(person: PersonRecord): boolean {
  return person.role === "cliente" && person.access_disabled !== true;
}

export function peopleByCustomer(people: PersonRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const person of people) {
    if (!isActiveClientPerson(person)) continue;
    const code = String(person.customer_code ?? "").trim() || LEGACY_CUSTOMER_CODE;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

/** Linhas da lista: ativos primeiro, pausados depois, arquivados por último; por nome. */
export function buildCustomerRows(
  customers: CustomerRecord[],
  positions: Array<Pick<WarehousePosition, "aisle" | "customer_code">>,
  people: PersonRecord[],
): CustomerRow[] {
  const zones = new Map(
    summarizeZones(positions)
      .filter((zone) => zone.customer_code !== null)
      .map((zone) => [zone.customer_code as string, { positions: zone.positions, aisles: zone.aisles }]),
  );
  const counts = peopleByCustomer(people);
  const order = (row: CustomerRow) => (row.archived ? 2 : row.paused ? 1 : 0);
  return customers
    .map((customer): CustomerRow | null => {
      const code = customerCode(customer);
      if (!code) return null;
      const archived = customer.archived === true || customer.status === "archived";
      const profile = resolveOperationProfile({ ...customer, customer_code: code }, code);
      return {
        customer,
        code,
        name: String(customer.name ?? "").trim() || code,
        profile,
        zone: zones.get(code) ?? null,
        people: counts.get(code) ?? 0,
        archived,
        paused: customer.status === "paused",
      };
    })
    .filter((row): row is CustomerRow => row !== null)
    .sort((left, right) => order(left) - order(right) || left.name.localeCompare(right.name, "pt-BR"));
}

const aisleList = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });

/** "Rua A · 3 prateleiras", "Ruas A e B · 12 prateleiras" ou "A definir em Posições". */
export function zoneLabel(zone: CustomerZone | null): string {
  if (!zone || zone.positions === 0) return "A definir em Posições";
  const aisles = zone.aisles.length === 1 ? `Rua ${zone.aisles[0]}` : `Ruas ${aisleList.format(zone.aisles)}`;
  const shelves = zone.positions === 1 ? "1 prateleira" : `${zone.positions} prateleiras`;
  return `${aisles} · ${shelves}`;
}

export function peopleLabel(count: number): string {
  if (count === 0) return "Ninguém no portal";
  return count === 1 ? "1 pessoa" : `${count} pessoas`;
}
