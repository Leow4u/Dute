/**
 * Conta de dinheiro exata do Comercial: quantidade × preço por linha, em
 * centavos inteiros, com arredondamento por linha (meio para longe do zero),
 * a mesma ideia do cálculo do WMS (functions/wms/src/billing.ts).
 *
 * Quantidade e preço entram sempre como texto decimal com ponto ("0.335"),
 * nunca como number: assim nenhum float entra na conta. A conta toda é em
 * bigint e só o resultado vira number, se for inteiro seguro.
 *
 * O app usa para a prévia do orçamento; o servidor sempre recalcula.
 * functions/comercial guarda uma cópia literal, e os dois rodam os mesmos
 * casos de dinheiro.casos.json (docs/plataforma/fase-6-comercial.md).
 */

/** Casas decimais máximas do preço unitário. */
export const CASAS_DO_PRECO = 4;

/** Casas decimais máximas da quantidade. */
export const CASAS_DA_QUANTIDADE = 3;

export const ERROS_DO_DINHEIRO = [
  "NAO_E_TEXTO",
  "DECIMAL_INVALIDO",
  "CASAS_DEMAIS",
  "NEGATIVO_FORA_DE_AJUSTE",
  "TOTAL_NEGATIVO",
  "CENTAVOS_INVALIDOS",
  "FORA_DO_LIMITE",
] as const;

export type CodigoErroDinheiro = (typeof ERROS_DO_DINHEIRO)[number];

export class ErroDinheiro extends Error {
  readonly codigo: CodigoErroDinheiro;

  constructor(codigo: CodigoErroDinheiro, mensagem: string) {
    super(mensagem);
    this.name = "ErroDinheiro";
    this.codigo = codigo;
  }
}

/** Decimal exato: valor = coeficiente / 10^casas. */
export interface DecimalExato {
  coeficiente: bigint;
  casas: number;
}

export interface LinhaDeDinheiro {
  quantidade: string;
  preco: string;
  /** Linha de ajuste: só ela aceita negativo. */
  ajuste?: boolean;
}

// Só dígitos, ponto decimal e sinal de menos. Sem vírgula, espaço, "+" ou
// expoente.
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;
const LIMITE = 9007199254740991n; // Number.MAX_SAFE_INTEGER

// Teto da parte inteira, sem os zeros à esquerda. O limite seguro em reais
// tem 14 dígitos; acima de 15 não é orçamento. Recusar antes do BigInt evita
// gastar CPU do servidor com um texto enorme.
const DIGITOS_DA_PARTE_INTEIRA = 15;

function potenciaDeDez(expoente: number): bigint {
  return 10n ** BigInt(expoente);
}

function centavosSeguros(centavos: bigint, campo: string): number {
  if (centavos > LIMITE || centavos < -LIMITE) {
    throw new ErroDinheiro("FORA_DO_LIMITE", `${campo} passa do limite seguro.`);
  }
  return Number(centavos);
}

function conferirCentavos(valor: unknown, campo: string): number {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor)) {
    throw new ErroDinheiro("CENTAVOS_INVALIDOS", `${campo} deve ser centavo inteiro seguro.`);
  }
  return valor;
}

/**
 * Lê um decimal em texto com ponto, sem passar por float. Recusa number,
 * vírgula, expoente, espaço, mais casas que o permitido e parte inteira com
 * mais de 15 dígitos.
 */
export function lerDecimal(valor: unknown, casasMaximas: number, campo = "valor"): DecimalExato {
  if (typeof valor !== "string") {
    throw new ErroDinheiro("NAO_E_TEXTO", `${campo} deve ser texto decimal com ponto.`);
  }
  const partes = DECIMAL.exec(valor);
  if (!partes) {
    throw new ErroDinheiro("DECIMAL_INVALIDO", `${campo} deve ser decimal com ponto, como 1234.56.`);
  }
  const [, sinal, inteiroEscrito, fracao = ""] = partes;
  if (fracao.length > casasMaximas) {
    throw new ErroDinheiro("CASAS_DEMAIS", `${campo} aceita até ${casasMaximas} casas decimais.`);
  }
  const inteiro = inteiroEscrito.replace(/^0+(?=\d)/, "");
  if (inteiro.length > DIGITOS_DA_PARTE_INTEIRA) {
    throw new ErroDinheiro("FORA_DO_LIMITE", `${campo} passa de ${DIGITOS_DA_PARTE_INTEIRA} dígitos na parte inteira.`);
  }
  const absoluto = BigInt(`${inteiro}${fracao}`);
  return { coeficiente: sinal === "-" ? -absoluto : absoluto, casas: fracao.length };
}

/** Passa para centavos, arredondando o meio para longe do zero. */
function paraCentavos(valor: DecimalExato): bigint {
  if (valor.casas <= 2) return valor.coeficiente * potenciaDeDez(2 - valor.casas);
  const divisor = potenciaDeDez(valor.casas - 2);
  const quociente = valor.coeficiente / divisor;
  const resto = valor.coeficiente % divisor;
  const restoAbsoluto = resto < 0n ? -resto : resto;
  if (restoAbsoluto * 2n < divisor) return quociente;
  return valor.coeficiente < 0n ? quociente - 1n : quociente + 1n;
}

/**
 * Centavos de uma linha: quantidade × preço, arredondado na linha. Negativo
 * só em linha de ajuste ({ ajuste: true }).
 */
export function centavosDaLinha(
  quantidade: string,
  preco: string,
  opcoes: { ajuste?: boolean } = {},
): number {
  const qtd = lerDecimal(quantidade, CASAS_DA_QUANTIDADE, "quantidade");
  const unitario = lerDecimal(preco, CASAS_DO_PRECO, "preço");
  if (opcoes?.ajuste !== true && (qtd.coeficiente < 0n || unitario.coeficiente < 0n)) {
    throw new ErroDinheiro("NEGATIVO_FORA_DE_AJUSTE", "Negativo, em quantidade ou preço, só em linha de ajuste.");
  }
  const centavos = paraCentavos({
    coeficiente: qtd.coeficiente * unitario.coeficiente,
    casas: qtd.casas + unitario.casas,
  });
  return centavosSeguros(centavos, "o valor da linha");
}

/** Soma centavos inteiros sem perder precisão. Aceita negativo. */
export function somarCentavos(valores: readonly number[]): number {
  let soma = 0n;
  for (const valor of valores) soma += BigInt(conferirCentavos(valor, "cada parcela"));
  return centavosSeguros(soma, "a soma");
}

/**
 * Total do orçamento: soma dos centavos de cada linha, já arredondados.
 * Total negativo é recusado.
 */
export function totalEmCentavos(linhas: readonly LinhaDeDinheiro[]): number {
  const total = somarCentavos(
    linhas.map((linha) => centavosDaLinha(linha.quantidade, linha.preco, { ajuste: linha.ajuste })),
  );
  if (total < 0) {
    throw new ErroDinheiro("TOTAL_NEGATIVO", "O total não pode ser negativo.");
  }
  return total;
}

/**
 * "R$ 1.234,56" a partir de centavos inteiros, igual ao Intl pt-BR das telas
 * (espaço que não quebra depois do R$; negativo como "-R$ 25,00").
 */
export function formatarReais(centavos: number): string {
  const valor = BigInt(conferirCentavos(centavos, "centavos"));
  const absoluto = valor < 0n ? -valor : valor;
  const reais = (absoluto / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const resto = (absoluto % 100n).toString().padStart(2, "0");
  return `${valor < 0n ? "-" : ""}R$ ${reais},${resto}`;
}
