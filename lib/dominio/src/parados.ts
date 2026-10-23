/**
 * Os dias parado do estoque (docs/plataforma/fase-5-memoria.md, parte 5.4a):
 * a regra de cada modelo de operação, os movimentos do razão que contam, o
 * relógio de cada item e as etiquetas "Parado 90+ dias" e "Sem giro".
 *
 * Funções puras, sem Firestore. A rotina do núcleo grava só o relógio do item
 * e o saldo; a tela e o alerta aplicam a regra na hora, com o dia de hoje, e a
 * etiqueta nunca fica velha. functions/core guarda uma cópia literal
 * (domain/parados.ts), e os dois rodam os mesmos casos de parados.casos.json.
 * O instante é texto ISO; o dia é "AAAA-MM-DD" no calendário de São Paulo.
 */

export const MODELOS_DE_OPERACAO = ["uniformes", "mobiliario", "insumos"] as const;
export type ModeloDeOperacao = (typeof MODELOS_DE_OPERACAO)[number];

/** O cadastro sem o modelo é o da BTG, como em customer-profile.ts. */
export const MODELO_DE_OPERACAO_PADRAO: ModeloDeOperacao = "uniformes";

export type RegraDeParado = {
  /** Os dias sem entrada nem saída que fazem o "Parado N+ dias". */
  parado_dias: number;
  /** Os dias sem saída que fazem o "Sem giro"; sem saída nenhuma, contados da primeira entrada. */
  sem_giro_dias: number;
};

/**
 * A regra de cada modelo. Os três têm os mesmos limites até a resposta da
 * pergunta 30 do plano de implantação. Regra própria de um cliente é PR, com
 * teste, nunca configuração de tela.
 */
export const REGRAS_DE_PARADO: Readonly<Record<ModeloDeOperacao, RegraDeParado>> = {
  uniformes: { parado_dias: 90, sem_giro_dias: 180 },
  mobiliario: { parado_dias: 90, sem_giro_dias: 180 },
  insumos: { parado_dias: 90, sem_giro_dias: 180 },
};

/** A regra do modelo do cadastro; sem o modelo, ou com um que não existe, a do modelo padrão. */
export function regraDoModelo(modelo: unknown): RegraDeParado {
  const chave = typeof modelo === "string" ? modelo.trim() : "";
  const conhecido = (MODELOS_DE_OPERACAO as readonly string[]).includes(chave);
  return REGRAS_DE_PARADO[conhecido ? (chave as ModeloDeOperacao) : MODELO_DE_OPERACAO_PADRAO];
}

/**
 * As origens do razão (`movements.source`) que contam no relógio: a entrada e
 * a saída de verdade. A contagem de abertura conta como a entrada: o estoque
 * que já estava no armazém entra no dia em que foi contado. A guarda
 * (`wms_putaway`) e a troca de caixa da abertura só mudam o lugar; a contagem
 * cíclica e o estorno da abertura corrigem o saldo. Mudam o saldo, não o relógio.
 */
export const ORIGENS_QUE_CONTAM = [
  "wms_receiving",
  "wms_shipping",
  "functions_manual_inventory",
  "functions_return_disposition",
  "functions_opening_inventory",
] as const;

export type SentidoDoMovimento = "entrada" | "saida";

/** O sentido do movimento que conta no relógio; null para o que não conta. */
export function sentidoDoMovimento(origem: unknown, tipoMov: unknown): SentidoDoMovimento | null {
  if (typeof origem !== "string" || !(ORIGENS_QUE_CONTAM as readonly string[]).includes(origem)) return null;
  if (tipoMov === "ENTRADA") return "entrada";
  if (tipoMov === "SAIDA") return "saida";
  return null;
}

/** O instante em ISO de UTC; null quando não é data. */
export function instanteValido(valor: unknown): string | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

export type RelogioDoItem = {
  primeira_entrada: string | null;
  ultima_entrada: string | null;
  ultima_saida: string | null;
};

export const RELOGIO_VAZIO: RelogioDoItem = { primeira_entrada: null, ultima_entrada: null, ultima_saida: null };

// Instantes em ISO de UTC, do mesmo tamanho: a ordem do texto é a do tempo.
function menor(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

function maior(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/**
 * O relógio depois do movimento. Guarda só o menor e o maior instante: o
 * resultado não depende da ordem dos movimentos nem de ler um deles duas vezes.
 * Instante que não é data não muda nada.
 */
export function marcarMovimento(relogio: RelogioDoItem, sentido: SentidoDoMovimento, instante: unknown): RelogioDoItem {
  const em = instanteValido(instante);
  if (!em) return relogio;
  if (sentido === "saida") return { ...relogio, ultima_saida: maior(relogio.ultima_saida, em) };
  return { ...relogio, primeira_entrada: menor(relogio.primeira_entrada, em), ultima_entrada: maior(relogio.ultima_entrada, em) };
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

const CALENDARIO_DE_SAO_PAULO = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** O dia do instante no calendário de São Paulo; null quando não é data. */
export function diaEmSaoPaulo(instante: unknown): string | null {
  const em = instanteValido(instante);
  if (!em) return null;
  const partes = Object.fromEntries(CALENDARIO_DE_SAO_PAULO.formatToParts(new Date(em)).map((parte) => [parte.type, parte.value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

/** Os dias corridos de um dia ao outro; negativo quando o segundo vem antes. */
export function diasCorridos(de: string, ate: string): number {
  if (!DIA.test(de) || !DIA.test(ate)) throw new Error("Dia inválido: use AAAA-MM-DD.");
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

export const ETIQUETAS_DE_PARADO = ["parado", "sem_giro"] as const;
export type EtiquetaDeParado = (typeof ETIQUETAS_DE_PARADO)[number];

export type IdadeDoItem = {
  /** Os dias desde a última entrada ou saída; null sem saldo ou sem movimento que conte. */
  dias_parado: number | null;
  /** Os dias desde a última saída; sem saída nenhuma, desde a primeira entrada. */
  dias_sem_saida: number | null;
  etiquetas: EtiquetaDeParado[];
};

/**
 * A idade do item hoje e as etiquetas que a regra dá. Sem saldo não há o que
 * estar parado. O movimento depois de hoje (relógio adiantado) conta como de hoje.
 */
export function idadeDoItem(relogio: RelogioDoItem, saldo: number, regra: RegraDeParado, hoje: string): IdadeDoItem {
  if (!DIA.test(hoje)) throw new Error("Dia inválido: use AAAA-MM-DD.");
  if (!(saldo > 0)) return { dias_parado: null, dias_sem_saida: null, etiquetas: [] };
  const diasDesde = (instante: string | null) => {
    const dia = diaEmSaoPaulo(instante);
    return dia === null ? null : Math.max(0, diasCorridos(dia, hoje));
  };
  const diasParado = diasDesde(maior(relogio.ultima_entrada, relogio.ultima_saida));
  const diasSemSaida = diasDesde(relogio.ultima_saida ?? relogio.primeira_entrada);
  const etiquetas: EtiquetaDeParado[] = [];
  if (diasParado !== null && diasParado >= regra.parado_dias) etiquetas.push("parado");
  if (diasSemSaida !== null && diasSemSaida >= regra.sem_giro_dias) etiquetas.push("sem_giro");
  return { dias_parado: diasParado, dias_sem_saida: diasSemSaida, etiquetas };
}

/** "Parado 90+ dias" e "Sem giro". */
export function rotuloDaEtiqueta(etiqueta: EtiquetaDeParado, regra: RegraDeParado): string {
  return etiqueta === "parado" ? `Parado ${regra.parado_dias}+ dias` : "Sem giro";
}

/** A regra numa linha, para a ficha do modelo. */
export function regraEmTexto(regra: RegraDeParado): string {
  return `Parado ${regra.parado_dias}+ dias sem entrada nem saída; sem giro aos ${regra.sem_giro_dias} dias sem saída`;
}
