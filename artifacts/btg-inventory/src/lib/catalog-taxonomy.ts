/** Taxonomia comercial do catálogo BTG (colunas GÊNERO e GRUPO da planilha). */

export const CATALOG_GENEROS = [
  "Masculino",
  "Feminino",
  "Outros",
  "—",
] as const;

export const CATALOG_GRUPOS = [
  "VESTUÁRIO",
  "BOLSAS E MALAS",
  "ACESSÓRIOS",
  "MATERIAL DE EVENTO",
  "BEBIDAS E MESA",
  "ESCRITÓRIOS E PAPELARIA",
  "OUTROS",
] as const;

export type CatalogGenero = (typeof CATALOG_GENEROS)[number];
export type CatalogGrupo = (typeof CATALOG_GRUPOS)[number];

const GENERO_BY_PREFIX: Array<{ prefix: string; genero: CatalogGenero }> = [
  { prefix: "A.01", genero: "Masculino" },
  { prefix: "A.02", genero: "Feminino" },
  { prefix: "A.03", genero: "Outros" },
  { prefix: "MAT-", genero: "—" },
];

const GRUPO_BY_PRODUTO: Array<{ match: RegExp; grupo: CatalogGrupo }> = [
  {
    match: /^(POLO|JAQUETA|CAMISETA|TRICO|SU[ÉE]TER|LEGGING|BLUSA|CAMISA|REGATA|MOLETOM|COLETE|BLAZER)/i,
    grupo: "VESTUÁRIO",
  },
  { match: /^(MOCHILA|SACOLA|MALA)/i, grupo: "BOLSAS E MALAS" },
  {
    match: /^(CESTO|BON[ÉE]|TOALHA|GUARDA CHUVA|BANDANA|ORGANIZADOR|PORTA|LANCHEIRA|ANTIVIBRADOR|MOLESKINE)/i,
    grupo: "ACESSÓRIOS",
  },
  { match: /^MAT-/i, grupo: "MATERIAL DE EVENTO" },
  { match: /^(COPO|GARRAFA|TA[ÇC]A|PORTA VINHO)/i, grupo: "BEBIDAS E MESA" },
  { match: /^(CADERNO|CANETA|PAPEL|ESCRIT)/i, grupo: "ESCRITÓRIOS E PAPELARIA" },
];

export function normalizeClientCodePrefix(code: string): string {
  return code.trim().toUpperCase();
}

/** Sugere gênero a partir do prefixo do código cliente BTG. */
export function inferGeneroFromClientCode(code: string): CatalogGenero | undefined {
  const normalized = normalizeClientCodePrefix(code);
  if (!normalized) return undefined;
  const match = GENERO_BY_PREFIX.find(({ prefix }) => normalized.startsWith(prefix));
  return match?.genero;
}

/** Sugere grupo comercial a partir do nome do produto. */
export function inferGrupoFromProduto(produto: string): CatalogGrupo | undefined {
  const normalized = produto.trim();
  if (!normalized) return undefined;
  const match = GRUPO_BY_PRODUTO.find(({ match: pattern }) => pattern.test(normalized));
  return match?.grupo;
}

export function isCatalogGenero(value: string): value is CatalogGenero {
  return (CATALOG_GENEROS as readonly string[]).includes(value);
}

export function isCatalogGrupo(value: string): value is CatalogGrupo {
  return (CATALOG_GRUPOS as readonly string[]).includes(value);
}

/** Classes visuais do badge de gênero na tabela de produtos. */
export function catalogGeneroBadgeClass(genero?: string | null): string {
  switch (genero?.trim()) {
    case "Masculino":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "Feminino":
      return "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800";
    case "Outros":
      return "border-amber-200 bg-amber-50 text-amber-800";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

export function formatCatalogGenero(genero?: string | null): string {
  const value = genero?.trim();
  return value || "—";
}
