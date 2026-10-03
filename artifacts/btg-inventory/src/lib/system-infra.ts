/**
 * Painel do sistema, infraestrutura (functions/src/domain/system-infra.ts):
 * tipos que vêm do servidor e os textos dos quadros.
 */

export type Section<T> = ({ status: "ok" } & T) | { status: "error"; message: string } | { status: "not_configured" };

export type ErrorGroup = { service: string; message: string; count: number; first_at: string; last_at: string; blocked: boolean; admin: boolean };
export type FunctionStatus = "ok" | "sem_acesso" | "nao_publicada";
export type FunctionRow = { name: string; service: string; status: FunctionStatus; state: string | null; updated_at: string | null; fix: string | null };

export type SystemInfra = {
  checked_at: string;
  settings: { billing_table: string | null };
  errors: Section<{ total: number; blocked: number; services: number; groups: ErrorGroup[] }>;
  functions: Section<{ total: number; ok: number; sem_acesso: number; nao_publicada: number; last_deploy_at: string | null; list: FunctionRow[] }>;
  billing: Section<{ table: string; total: number; currency: string; vertex_ai: number; data_until: string | null; services: Array<{ service: string; cost: number }> }>;
};

export const infraKey = ["system-infra"] as const;

type Tile = { value: string; detail: string; tone: "ok" | "warn" | "bad" };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Quadros do topo: erros de 24 h e functions. */
export function infraTiles(infra: SystemInfra | undefined, loading: boolean): { errors: Tile; functions: Tile } {
  const waiting: Tile = { value: loading ? "Verificando…" : "—", detail: "", tone: "ok" };
  if (!infra) return { errors: waiting, functions: waiting };

  let errors: Tile;
  if (infra.errors.status !== "ok") {
    errors = { value: "Sem leitura", detail: "Veja o quadro Erros do servidor", tone: "warn" };
  } else {
    const { total, blocked, services } = infra.errors;
    errors = {
      value: total ? `${plural(total, "erro", "erros")} em ${plural(services, "function", "functions")}` : "Nenhum erro",
      detail: blocked ? `+ ${plural(blocked, "chamada bloqueada", "chamadas bloqueadas")}` : "Nenhuma chamada bloqueada",
      tone: blocked ? "bad" : total ? "warn" : "ok",
    };
  }

  let functions: Tile;
  if (infra.functions.status !== "ok") {
    functions = { value: "Sem leitura", detail: "Veja o quadro Functions", tone: "warn" };
  } else {
    const { total, ok, sem_acesso, nao_publicada } = infra.functions;
    const issues = [sem_acesso ? `${sem_acesso} sem acesso` : "", nao_publicada ? `${nao_publicada} não ${nao_publicada === 1 ? "publicada" : "publicadas"}` : ""].filter(Boolean);
    functions = {
      value: ok === total ? `${plural(total, "function", "functions")} ok` : `${ok} de ${total} ok`,
      detail: issues.length ? issues.join(" · ") : "Todas publicadas e com acesso",
      tone: issues.length ? "bad" : "ok",
    };
  }
  return { errors, functions };
}

/** Nome da function (como no código) a partir do serviço do Cloud Run, quando conhecido. */
export function serviceNames(infra: SystemInfra) {
  const names = new Map<string, string>([["dute-btg-app", "Site (dute-btg-app)"]]);
  if (infra.functions.status === "ok") for (const row of infra.functions.list) names.set(row.service, row.name);
  return (service: string) => names.get(service) ?? service;
}

export const FUNCTION_STATUS_LABELS: Record<FunctionStatus, string> = {
  ok: "ok",
  sem_acesso: "sem acesso",
  nao_publicada: "não publicada",
};

/** Só as que têm problema; a lista inteira fica atrás de "ver todas". */
export function functionsToShow(list: FunctionRow[], showAll: boolean) {
  return showAll ? list : list.filter((row) => row.status !== "ok");
}

/** Vertex AI da fatura contra a estimativa do painel (mesmo mês). */
export function vertexComparison(billed: number, estimated: number) {
  if (billed <= 0 || estimated <= 0) return null;
  const diff = (estimated - billed) / billed;
  if (Math.abs(diff) < 0.15) return "A estimativa está perto da fatura.";
  return diff > 0
    ? "A estimativa está acima da fatura: o preço informado pode estar alto."
    : "A estimativa está abaixo da fatura: confira o preço informado ou a cotação do dólar.";
}
