import {
  MODULOS_CONTRATAVEIS,
  MODULOS_PADRAO_CLIENTE,
  modulosContratados,
  type ModuloContratavel,
} from "@workspace/dominio";

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
import { RECEBIMENTO_POR_CAIXA_LIBERADO } from "./liberacao";
import { APP_MODULES } from "./modules";
import { portalModulesFor, type PortalModuleKey } from "./operations";
import { groupByAisle, inZone, summarizeZone, type Shelf } from "./warehouse-map";

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
  modules?: unknown;
  /** ISO, gravado pela Function na criação (cadastros antigos não têm). */
  created_at?: unknown;
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
  /** Módulos contratados (lib/dominio, MODULOS_CONTRATAVEIS). */
  modules: ModuloContratavel[];
};

export type FormMode = "create" | "edit";

/** Pessoa como vem da lista de Pessoas e acessos. */
export type PersonRecord = {
  role?: unknown;
  customer_code?: unknown;
  access_disabled?: unknown;
  nome?: unknown;
  email?: unknown;
};

export type CustomerZone = { positions: number; aisles: string[] };

export type CustomerRow = {
  customer: CustomerRecord;
  code: string;
  name: string;
  profile: OperationProfile;
  zone: CustomerZone | null;
  people: number;
  /** Os nomes de quem entra no portal do cliente, em ordem. */
  peopleNames: string[];
  archived: boolean;
  paused: boolean;
  /** "Convidar" na lista: portal ativo e armazenagem; a Function recusa o resto. */
  invitable: boolean;
};


export function customerCode(customer: Pick<CustomerRecord, "code" | "id">): string {
  return String(customer.code ?? customer.id ?? "").trim();
}

export function customerDocumentId(customer: Pick<CustomerRecord, "code" | "id">): string {
  return String(customer.id ?? "").trim() || customerCode(customer);
}

/**
 * Cadastro com armazenagem: tem sigla do SKU (sem sigla não há SKU, zona nem
 * portal). A BTG conta sempre: o cadastro dela pode nunca ter sido salvo com
 * sigla (docs/multicliente-modelos-de-operacao.md).
 */
export function customerHasStorage(customer: Pick<CustomerRecord, "code" | "id" | "sku_prefix">): boolean {
  return Boolean(canonicalSkuPrefix(customer.sku_prefix)) || customerCode(customer) === LEGACY_CUSTOMER_CODE;
}

/**
 * Clientes oferecidos no convite do perfil cliente: com portal e armazenagem.
 * A Function recusa o resto (functions/wms/src/domain/customer-invite.ts).
 */
export function inviteCustomers<
  T extends Pick<CustomerRecord, "code" | "id" | "sku_prefix" | "archived" | "portal_status">,
>(customers: readonly T[]): T[] {
  return customers.filter(
    (customer) => customer.archived !== true && customer.portal_status !== "inactive" && customerHasStorage(customer),
  );
}

/** Clientes que podem ser zona em Estoque › Posições: com código e armazenagem. */
export function zoneCustomers<T extends Pick<CustomerRecord, "code" | "id" | "sku_prefix" | "status">>(
  customers: readonly T[],
): T[] {
  return customers.filter(
    (customer) => Boolean(customer.code) && customer.status !== "inactive" && customerHasStorage(customer),
  );
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
    modules: [...MODULOS_PADRAO_CLIENTE],
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
    modules: modulosContratados(customer.modules),
  };
}

/** Liga ou desliga um módulo, na ordem do registro. */
export function toggleContractedModule(
  modules: readonly ModuloContratavel[],
  module: ModuloContratavel,
  on: boolean,
): ModuloContratavel[] {
  return MODULOS_CONTRATAVEIS.filter((key) => (key === module ? on : modules.includes(key)));
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
  if (!form.modules.length) return "Marque ao menos um módulo contratado.";
  const email = form.primary_contact_email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "E-mail do contato inválido.";
  return null;
}

/**
 * O que vai para a Function. No update o código não vai (não muda); a sigla
 * vai sempre em maiúsculas; o portal de um modelo sem portal vai desligado.
 * Os módulos só vão onde a plataforma está liberada (lib/liberacao.ts); sem
 * o campo, a Function mantém os do cadastro.
 */
export function customerPayload(
  form: CustomerForm,
  mode: FormMode,
  options: { modules?: boolean } = {},
): Record<string, unknown> {
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
    ...(options.modules ? { modules: MODULOS_CONTRATAVEIS.filter((key) => form.modules.includes(key)) } : {}),
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
  for (const [code, names] of peopleNamesByCustomer(people)) counts.set(code, names.length);
  return counts;
}

/** Os nomes de quem entra no portal de cada cliente (o e-mail, sem nome), em ordem. */
export function peopleNamesByCustomer(people: PersonRecord[]): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const person of people) {
    if (!isActiveClientPerson(person)) continue;
    const code = String(person.customer_code ?? "").trim() || LEGACY_CUSTOMER_CODE;
    const name = String(person.nome ?? "").trim() || String(person.email ?? "").trim() || "Sem nome";
    names.set(code, [...(names.get(code) ?? []), name]);
  }
  for (const list of names.values()) list.sort((left, right) => left.localeCompare(right, "pt-BR"));
  return names;
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
  const names = peopleNamesByCustomer(people);
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
        people: names.get(code)?.length ?? 0,
        peopleNames: names.get(code) ?? [],
        archived,
        paused: customer.status === "paused",
        invitable: !archived && profile.portalStatus === "active" && customerHasStorage(customer),
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

/**
 * A sigla que abre a linha do cliente na lista: a inicial das duas primeiras
 * palavras ("Itaú Unibanco" vira "IU") ou, com uma palavra só, as duas
 * primeiras letras ("BTG" vira "BT"). Sem letra, "?".
 */
export function customerInitials(name: string): string {
  const words = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter((part) => /^\p{L}/u.test(part));
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** O selo do cliente: arquivado e pausado antes do portal; o resto diz se tem portal. */
export function customerSituation(
  row: Pick<CustomerRow, "archived" | "paused" | "profile">,
): { tone: "ok" | "off" | "warn"; label: string } {
  if (row.archived) return { tone: "off", label: "Arquivado" };
  if (row.paused) return { tone: "warn", label: "Pausado" };
  if (row.profile.portalStatus === "active") return { tone: "ok", label: "Portal ativo" };
  return { tone: "off", label: "Sem portal" };
}

// --- A galeria e a página do cliente (docs/mockups/ConfigClientes.dc.html) -----------

export const CUSTOMERS_PATH = "/configuracoes/clientes";

/** A página do cliente: a galeria com `?cliente=<código operacional>`. */
export function customerHref(code: string): string {
  return `${CUSTOMERS_PATH}?cliente=${encodeURIComponent(code)}`;
}

/** O código da página aberta, lido da busca do endereço; sem ele, a galeria. */
export function customerCodeFromSearch(search: string): string | null {
  const code = new URLSearchParams(search.startsWith("?") ? search : `?${search}`).get("cliente");
  return code?.trim() || null;
}

/** A cor do cliente (o quadro da sigla), tirada do código: a mesma sempre. */
export type CustomerTone = "info" | "teal" | "violet" | "amber";
const CUSTOMER_TONES: readonly CustomerTone[] = ["info", "teal", "violet", "amber"];

export function customerTone(code: string): CustomerTone {
  let hash = 0;
  for (const char of code) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return CUSTOMER_TONES[hash % CUSTOMER_TONES.length]!;
}

export type CustomerFilter = "todos" | "com_portal" | "sem_portal" | "arquivados";
export const CUSTOMER_FILTERS: readonly CustomerFilter[] = ["todos", "com_portal", "sem_portal", "arquivados"];
export const CUSTOMER_FILTER_LABEL: Record<CustomerFilter, string> = {
  todos: "Todos",
  com_portal: "Com portal",
  sem_portal: "Sem portal",
  arquivados: "Arquivados",
};

/** "Todos" são os não arquivados; o portal conta só entre eles. */
export function customerInFilter(row: Pick<CustomerRow, "archived" | "profile">, filter: CustomerFilter): boolean {
  if (filter === "arquivados") return row.archived;
  if (row.archived) return false;
  if (filter === "com_portal") return row.profile.portalStatus === "active";
  if (filter === "sem_portal") return row.profile.portalStatus !== "active";
  return true;
}

export function countCustomerFilters(rows: ReadonlyArray<Pick<CustomerRow, "archived" | "profile">>): Record<CustomerFilter, number> {
  return Object.fromEntries(
    CUSTOMER_FILTERS.map((filter) => [filter, rows.filter((row) => customerInFilter(row, filter)).length]),
  ) as Record<CustomerFilter, number>;
}

function plain(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Busca por nome, código, razão social ou CNPJ (com ou sem pontuação). */
export function searchCustomerRows<T extends Pick<CustomerRow, "name" | "code" | "customer">>(rows: readonly T[], term: string): T[] {
  const needle = plain(term);
  if (!needle) return [...rows];
  const digits = needle.replace(/\D/g, "");
  return rows.filter((row) => {
    const text = [row.name, row.code, row.customer.legal_name].map(plain).join(" ");
    if (text.includes(needle)) return true;
    return digits.length >= 3 && String(row.customer.document ?? "").replace(/\D/g, "").includes(digits);
  });
}

/** "cliente desde 30/07/2026", pela data de criação do cadastro; sem ela, null. */
export function customerSince(customer: Pick<CustomerRecord, "created_at">, timeZone = "America/Sao_Paulo"): string | null {
  const value = customer.created_at;
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" });
}

const PORTAL_SCREENS: ReadonlyArray<{ key: PortalModuleKey; label: string }> = APP_MODULES.filter(
  (module): module is typeof module & { portal: PortalModuleKey } => Boolean(module.portal),
).map((module) => ({ key: module.portal, label: module.label }));

/** As telas que o portal mostra ao cliente (o modelo dentro do contrato), na ordem do menu. */
export function portalScreens(profile: OperationProfile): string[] {
  if (profile.portalStatus !== "active") return [];
  const screens = portalModulesFor(profile) ?? [];
  return PORTAL_SCREENS.filter((screen) => screens.includes(screen.key)).map((screen) => screen.label);
}

/**
 * Como a chegada do cliente é conferida no Receber: por caixa onde a caixa
 * está liberada e o modelo pede; senão, por linha. A mesma regra de
 * `modoDaChegadaAvulsa` (lib/wms/caixas-do-recebimento.ts), sem o Firebase dela.
 */
export function inboundConferenceLabel(profile: OperationProfile, liberado = RECEBIMENTO_POR_CAIXA_LIBERADO): string {
  return liberado && profile.template.inboundConference === "per_box" ? "Por caixa" : "Por linha";
}

export type AisleOccupancy = { aisle: string; occupied: number; total: number };

/**
 * A ocupação da zona do cliente, como no Mapa (lib/warehouse-map.ts): por
 * rua, as prateleiras com ao menos uma caixa sobre as da zona, e as caixas
 * guardadas nelas.
 */
export function zoneOccupancy(shelves: Shelf[], code: string): { aisles: AisleOccupancy[]; boxes: number } {
  const own = shelves.filter((shelf) => inZone(shelf, code));
  return {
    aisles: groupByAisle(own).map(({ aisle, shelves: items }) => ({
      aisle,
      occupied: items.filter((shelf) => shelf.boxes.length > 0).length,
      total: items.length,
    })),
    boxes: summarizeZone(own, code).boxes,
  };
}

/** O formulário de uma seção: o cadastro de agora com só o que a seção mudou. */
export function customerFormWith(customer: CustomerRecord, patch: Partial<CustomerForm>): CustomerForm {
  return { ...customerFormFrom(customer), ...patch };
}

