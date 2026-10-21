export type Mannequin = "male" | "female" | "child" | "neutral";
export type PhotoContext = {
  description?: string;
  gender?: string;
  group?: string;
  size?: string;
  color?: string;
  brand?: string;
};
export const mannequinLabels: Record<Mannequin, string> = {
  male: "Masculino",
  female: "Feminino",
  child: "Infantil",
  neutral: "Neutro",
};

function audience(value: string): Mannequin | undefined {
  const text = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const male = /\b(masculin[oa]s?|male|men'?s?)\b/.test(text);
  const female = /\b(feminin[oa]s?|female|women'?s?)\b/.test(text);
  if (male && female) return undefined;
  if (/\b(infantil|infantis|criancas?|child|kids?)\b/.test(text))
    return "child";
  if (/\b(unissex|unisex|neutr[oa])\b/.test(text)) return "neutral";
  return male ? "male" : female ? "female" : undefined;
}

export function suggestMannequin(name: string, context: PhotoContext) {
  const fromGender = audience(context.gender ?? "");
  const description = [name, context.description].filter(Boolean).join(" ");
  const fromDescription = audience(description);
  const normalized = [description, context.gender].filter(Boolean).join(" ").toLowerCase();
  const conflictingDescription =
    /\b(masculin[oa]s?|male|men'?s?)\b/.test(normalized) &&
    /\b(feminin[oa]s?|female|women'?s?)\b/.test(normalized);
  const conflict =
    conflictingDescription ||
    Boolean(fromGender && fromDescription && fromGender !== fromDescription);
  return {
    value: conflict ? undefined : (fromGender ?? fromDescription),
    conflict,
  };
}

export function photoContextFromRecord(
  record: Record<string, unknown>,
): PhotoContext {
  const first = (...keys: string[]) =>
    keys
      .map((key) => record[key])
      .find((value) => typeof value === "string" && value.trim()) as
      string | undefined;
  return {
    description: first("description", "descricao", "produto", "product_name"),
    gender: first("gender", "genero"),
    group: first("group", "grupo"),
    size: first("size", "tamanho"),
    color: first("color", "cor"),
    brand: first("brand", "marca"),
  };
}

export function isGeneratedPhoto(url: string) {
  try {
    return /\/generated\//.test(decodeURIComponent(new URL(url).pathname));
  } catch {
    return false;
  }
}
