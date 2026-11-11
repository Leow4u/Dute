import { LEGACY_CUSTOMER_CODE } from "./active-customer";
import { normalizeProfileRole, type ProfileRole } from "./modules";

/**
 * Pessoas e acessos (docs/mockups/ConfigPessoas*.dc.html, avaliadas em
 * 11/11/2026): quem entra no sistema, a equipe da Dutelog e as pessoas do
 * portal de cada cliente. Convite usado vira pessoa ativa; só o pendente
 * aparece. As regras ficam aqui, sem tela, para a página de Pessoas e a
 * página do cliente contarem e filtrarem igual.
 */

export type Invite = {
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

export type Person = {
  key: string;
  kind: "user" | "invite";
  id: string;
  name: string;
  email: string;
  role: unknown;
  /** O cliente do login de portal; vazio na equipe. */
  customerCode: string;
  state: "active" | "removed" | "pending";
  emailStatus?: Invite["email_status"];
  lastSentAt?: Invite["email_requested_at"];
  loginPreparationPending?: boolean;
};

export const INVITE_EMAIL_LABEL: Record<NonNullable<Invite["email_status"]>, string> = {
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

export function roleOrder(role: unknown): number {
  const known = normalizeProfileRole(role);
  return known ? ROLE_ORDER[known] : 99;
}

const STATE_ORDER: Record<Person["state"], number> = { active: 0, pending: 1, removed: 2 };

/**
 * A lista de pessoas: os perfis (sem os removidos da lista) e os convites
 * pendentes; ativos, depois convites, depois arquivados; por perfil e nome.
 */
export function buildPeople(users: ReadonlyArray<Record<string, unknown>>, invites: readonly Invite[]): Person[] {
  const fromUsers = users
    .filter((item) => item.directory_hidden !== true)
    .map(
      (item): Person => ({
        key: `user:${item.id}`,
        kind: "user",
        id: String(item.id),
        name: String(item.nome || item.email || "Sem nome"),
        email: String(item.email ?? ""),
        role: item.role,
        customerCode: String(item.customer_code ?? ""),
        state: item.access_disabled === true ? "removed" : "active",
      }),
    );
  const pending = invites
    .filter((invite) => invite.status === "pending")
    .map(
      (invite): Person => ({
        key: `invite:${invite.id}`,
        kind: "invite",
        id: invite.id,
        name: invite.nome || invite.email,
        email: invite.email,
        role: invite.role,
        customerCode: invite.customer_code ?? "",
        state: "pending",
        emailStatus: invite.email_status,
        lastSentAt: invite.email_requested_at,
        loginPreparationPending: invite.login_preparation_pending,
      }),
    );
  return [...fromUsers, ...pending].sort(
    (left, right) =>
      STATE_ORDER[left.state] - STATE_ORDER[right.state] ||
      roleOrder(left.role) - roleOrder(right.role) ||
      left.name.localeCompare(right.name, "pt-BR"),
  );
}

/** Pessoa do portal de um cliente (perfil Cliente); as outras são da equipe. */
export function isClientPerson(person: Pick<Person, "role">): boolean {
  return normalizeProfileRole(person.role) === "cliente";
}

/** O cliente da pessoa do portal; o login antigo sem cliente é da BTG, como em Clientes. */
export function personCustomer(person: Pick<Person, "customerCode">): string {
  return person.customerCode.trim() || LEGACY_CUSTOMER_CODE;
}

// --- Situação -------------------------------------------------------------------------

export type Situacao = "todos" | "ativos" | "pendentes" | "arquivados";
export const SITUACOES: readonly Situacao[] = ["todos", "ativos", "pendentes", "arquivados"];
export const SITUACAO_ROTULO: Record<Situacao, string> = {
  todos: "Todos",
  ativos: "Ativos",
  pendentes: "Convites pendentes",
  arquivados: "Arquivados",
};

/** "Todos" é quem tem acesso ou convite; os arquivados (acesso removido) ficam à parte. */
export function inSituation(person: Pick<Person, "state">, situacao: Situacao): boolean {
  if (situacao === "ativos") return person.state === "active";
  if (situacao === "pendentes") return person.state === "pending";
  if (situacao === "arquivados") return person.state === "removed";
  return person.state !== "removed";
}

export function countSituations(people: ReadonlyArray<Pick<Person, "state">>): Record<Situacao, number> {
  return Object.fromEntries(SITUACOES.map((item) => [item, people.filter((person) => inSituation(person, item)).length])) as Record<
    Situacao,
    number
  >;
}

/** O que a linha diz da situação: o rótulo e, no convite, o e-mail e a data do último pedido. */
export function personStatus(person: Pick<Person, "state" | "kind" | "emailStatus" | "lastSentAt">): { label: string; detail: string | null } {
  if (person.state === "active") return { label: "Ativo", detail: null };
  if (person.state === "removed") return { label: "Acesso removido", detail: null };
  const parts = [person.emailStatus ? INVITE_EMAIL_LABEL[person.emailStatus] : null, lastInviteRequest(person.lastSentAt)].filter(Boolean);
  return { label: "Convite pendente", detail: parts.length ? parts.join(" · ") : null };
}

/** O dia do último pedido de envio do convite ("08/11"), ou null. */
export function lastInviteRequest(value: Invite["email_requested_at"]): string | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : (value.toDate?.() ?? new Date((value.seconds ?? 0) * 1000));
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// --- Equipe ---------------------------------------------------------------------------

/** A equipe na situação e no perfil escolhidos ("todos" não filtra o perfil). */
export function teamInFilter(people: readonly Person[], situacao: Situacao, perfil: string): Person[] {
  return people.filter(
    (person) => !isClientPerson(person) && inSituation(person, situacao) && (perfil === "todos" || normalizeProfileRole(person.role) === perfil),
  );
}

/** Os perfis que a equipe tem, na ordem da lista: as opções do filtro de perfil. */
export function teamRoles(people: readonly Person[]): ProfileRole[] {
  const roles = new Set<ProfileRole>();
  for (const person of people) {
    const role = normalizeProfileRole(person.role);
    if (role && role !== "cliente") roles.add(role);
  }
  return [...roles].sort((left, right) => roleOrder(left) - roleOrder(right));
}

// --- Busca ----------------------------------------------------------------------------

function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

/** Nome ou e-mail, sem diferença de maiúscula nem de acento. */
export function matchesSearch(person: Pick<Person, "name" | "email">, term: string): boolean {
  const wanted = plain(term.trim());
  return !wanted || plain(`${person.name} ${person.email}`).includes(wanted);
}

// --- Clientes -------------------------------------------------------------------------

export type ClienteDoIndice = {
  code: string;
  name: string;
  archived: boolean;
  /** Quem entra no portal do cliente. */
  ativos: Person[];
  pendentes: Person[];
};

export type ClienteParaIndice = { code: string; name: string; archived: boolean; portalActive: boolean };

/**
 * O índice da aba Clientes: uma linha por cliente com portal, e também a do
 * cliente sem portal (ou arquivado, ou fora do cadastro) que ainda tem gente
 * com acesso ou convite, para ninguém sumir da tela. Por nome.
 */
export function clientIndex(people: readonly Person[], customers: readonly ClienteParaIndice[]): ClienteDoIndice[] {
  const byCode = new Map<string, { ativos: Person[]; pendentes: Person[] }>();
  for (const person of people) {
    if (!isClientPerson(person) || person.state === "removed") continue;
    const code = personCustomer(person);
    const entry = byCode.get(code) ?? { ativos: [], pendentes: [] };
    (person.state === "active" ? entry.ativos : entry.pendentes).push(person);
    byCode.set(code, entry);
  }
  const rows: ClienteDoIndice[] = [];
  const known = new Set<string>();
  for (const customer of customers) {
    known.add(customer.code);
    const entry = byCode.get(customer.code);
    if (!entry && (customer.archived || !customer.portalActive)) continue;
    rows.push({ code: customer.code, name: customer.name, archived: customer.archived, ativos: entry?.ativos ?? [], pendentes: entry?.pendentes ?? [] });
  }
  for (const [code, entry] of byCode) {
    if (!known.has(code)) rows.push({ code, name: code, archived: false, ...entry });
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

/** As pessoas do portal de um cliente: quem entra, os convites pendentes e os arquivados. */
export function peopleOfCustomer(people: readonly Person[], code: string): { ativos: Person[]; pendentes: Person[]; arquivados: Person[] } {
  const own = people.filter((person) => isClientPerson(person) && personCustomer(person) === code);
  return {
    ativos: own.filter((person) => person.state === "active"),
    pendentes: own.filter((person) => person.state === "pending"),
    arquivados: own.filter((person) => person.state === "removed"),
  };
}

/** "4 pessoas", "1 pessoa", "Ninguém no portal". */
export function portalPeopleLabel(count: number): string {
  if (count === 0) return "Ninguém no portal";
  return count === 1 ? "1 pessoa" : `${count} pessoas`;
}

/** "1 convite pendente", "2 convites pendentes". */
export function pendingInvitesLabel(count: number): string {
  return count === 1 ? "1 convite pendente" : `${count} convites pendentes`;
}

/** As iniciais do nome: as duas primeiras palavras com letra ("Ana Souza" vira "AS"). */
export function personInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter((part) => /^\p{L}/u.test(part))
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}
