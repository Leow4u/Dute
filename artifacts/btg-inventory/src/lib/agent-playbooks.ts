/**
 * Playbooks do Agent Dute (functions/src/domain/agent-playbooks.ts): passo a
 * passo de procedimentos da operação, que a coordenação escreve e aprova em
 * Conhecimento e o agente segue na conversa.
 */

export type PlaybookAudience = "equipe" | "todos";

export type Playbook = {
  id: string;
  title: string;
  when: string;
  steps: string[];
  /** Regras da operação para a equipe completar; o agente não recebe. */
  open_points: string[];
  audience: PlaybookAudience;
  status: "pending" | "active";
  source: "inicial" | "coordenacao";
  updated_by_name: string | null;
  decided_by_name: string | null;
  updated_at: string | null;
  use_count: number;
};

export const playbooksKey = ["agent-dute-playbooks"] as const;

export type PlaybookForm = { id?: string; title: string; when: string; stepsText: string; openText: string; audience: PlaybookAudience };

/** Um passo por linha; tira a numeração ("1.", "2)", "-") que a pessoa digitar. */
export function stepsFromText(text: string) {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:\d+\s*[.)-]|[-•*])\s*/, "").trim())
    .filter(Boolean);
}

export function stepsToText(steps: string[]) {
  return steps.join("\n");
}

export function playbookForm(playbook?: Playbook): PlaybookForm {
  return playbook
    ? { id: playbook.id, title: playbook.title, when: playbook.when, stepsText: stepsToText(playbook.steps), openText: stepsToText(playbook.open_points), audience: playbook.audience }
    : { title: "", when: "", stepsText: "", openText: "", audience: "equipe" };
}

export function playbookProblem(form: Pick<PlaybookForm, "title" | "when" | "stepsText">) {
  if (!form.title.trim()) return "Dê um nome ao playbook.";
  if (!form.when.trim()) return "Diga quando usar.";
  if (!stepsFromText(form.stepsText).length) return "Escreva pelo menos um passo.";
  return null;
}

/** Corpo para saveAgentPlaybook (sem undefined: o SDK do Firebase vira null). */
export function playbookPayload(form: PlaybookForm) {
  return {
    ...(form.id ? { id: form.id } : {}),
    title: form.title.trim(),
    when: form.when.trim(),
    steps: stepsFromText(form.stepsText),
    open_points: stepsFromText(form.openText),
    audience: form.audience,
  };
}

export function groupPlaybooks(list: Playbook[]) {
  const byTitle = (left: Playbook, right: Playbook) => left.title.localeCompare(right.title, "pt-BR");
  return {
    pending: list.filter((item) => item.status === "pending").sort(byTitle),
    active: list.filter((item) => item.status === "active").sort(byTitle),
  };
}
