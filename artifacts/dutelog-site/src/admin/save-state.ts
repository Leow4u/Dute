import { validatePublication, type BlogDraft } from "../blog/model";

const clock = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function saveStatusLabel(input: {
  saving: boolean;
  dirty: boolean;
  savedAt?: string | null;
}): string {
  if (input.saving) return "Salvando…";
  if (input.dirty) return "Alterações não salvas";
  if (!input.savedAt) return "Novo rascunho";
  return `Salvo às ${clock.format(new Date(input.savedAt))}`;
}

export function publishActionLabel(needsSave: boolean, published: boolean): string {
  if (needsSave) return published ? "Salvar e atualizar" : "Salvar e publicar";
  return published ? "Atualizar publicação" : "Publicar";
}

export function publishBlockReason(draft: BlogDraft): string | null {
  try {
    validatePublication(draft);
    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Confira os campos obrigatórios antes de publicar.";
  }
}
