import { HttpsError } from "firebase-functions/https";

/**
 * Identidade do cadastro de clientes no Comercial (docs/plataforma/fase-6-comercial.md,
 * "Cadastro"; parte 6).
 *
 * O Comercial grava no mesmo documento `customers` do WMS, com o Admin SDK.
 * As regras que os dois precisam ter iguais (estágio, código canônico, raiz
 * do CNPJ, conflito de identidade, id do documento e o cliente legado) são
 * CÓPIAS LITERAIS do WMS: as codebases não importam umas das outras. O teste
 * customer-identity.test.ts lê os fontes do WMS e reprova qualquer diferença:
 *
 * - functions/wms/src/domain/customer-profile.ts: text, CUSTOMER_STAGES,
 *   CustomerStage, customerStage, isProspect, canonicalSkuPrefix,
 *   canonicalCustomerCode, CNPJ_PATTERN, cnpjCheckDigit, isValidCnpj,
 *   cnpjRoot, CustomerIdentityCandidate, CustomerIdentityRow e
 *   customerIdentityConflict;
 * - functions/wms/src/index.ts: safeDocId;
 * - functions/wms/src/domain/customer-scope.ts: LEGACY_CUSTOMER_CODE.
 *
 * Mudou lá, muda aqui no mesmo PR. O que vem depois das cópias é só do
 * Comercial.
 */

// --- Cópias literais do WMS (não editar aqui sem editar lá) ------------------

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export const CUSTOMER_STAGES = ["prospect", "cliente"] as const;
export type CustomerStage = (typeof CUSTOMER_STAGES)[number];

/** Leitura tolerante do estágio: sem o campo (a BTG e os cadastros do WMS), cliente. */
export function customerStage(value: unknown): CustomerStage {
  return text(value).toLowerCase() === "prospect" ? "prospect" : "cliente";
}

export function isProspect(record: Record<string, unknown> | null | undefined): boolean {
  return customerStage(record?.stage) === "prospect";
}

/** Maiúsculas, sem acento e sem separadores (a sigla do SKU, como o WMS lê). */
export function canonicalSkuPrefix(value: unknown): string {
  return text(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Código comparado na unicidade: sem acento, sem diferenciar maiúsculas e sem
 * separador. "Itau" e "ITAÚ" são o mesmo código, e "BTG Pactual" (WMS) e
 * "BTG-PACTUAL" (Comercial) também.
 */
export function canonicalCustomerCode(value: unknown): string {
  return text(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** CNPJ sem máscara: 12 letras ou números e 2 dígitos verificadores (IN RFB 2.229/2024). */
const CNPJ_PATTERN = /^[0-9A-Z]{12}[0-9]{2}$/;

/** Dígito verificador do CNPJ, numérico ou alfanumérico (cada caractere vale o código ASCII menos 48). */
function cnpjCheckDigit(base: string): number {
  let weight = 2;
  let sum = 0;
  for (let index = base.length - 1; index >= 0; index -= 1) {
    sum += (base.charCodeAt(index) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function isValidCnpj(cnpj: string): boolean {
  if (!CNPJ_PATTERN.test(cnpj) || /^0+$/.test(cnpj)) return false;
  const first = cnpjCheckDigit(cnpj.slice(0, 12));
  const second = cnpjCheckDigit(`${cnpj.slice(0, 12)}${first}`);
  return cnpj.endsWith(`${first}${second}`);
}

/**
 * Raiz do CNPJ (8 primeiros caracteres), tirada de `document`. Só CNPJ inteiro
 * com os dígitos verificadores certos tem raiz.
 */
export function cnpjRoot(value: unknown): string | null {
  const raw = text(value).toUpperCase();
  const cnpj = [raw.replace(/[^0-9A-Z]/g, ""), raw.replace(/\D/g, "")].find(isValidCnpj);
  return cnpj ? cnpj.slice(0, 8) : null;
}

export type CustomerIdentityCandidate = {
  code: unknown;
  document?: unknown;
  /** Id do documento que está sendo gravado: não conflita consigo mesmo. */
  documentId: string;
};

export type CustomerIdentityRow = { id: string; data: Record<string, unknown> };

/**
 * Conflito de identidade de um cadastro novo contra todos os outros,
 * inclusive arquivados e prospects: o código canônico (contra `code` e
 * `customer_code`) e, quando vier, a raiz do CNPJ. Mensagem do conflito, ou
 * null.
 */
export function customerIdentityConflict(
  candidate: CustomerIdentityCandidate,
  rows: readonly CustomerIdentityRow[],
): string | null {
  const code = text(candidate.code);
  const canonical = canonicalCustomerCode(code);
  // Código sem letra nem número: a comparação volta a ser exata.
  const sameCode = (existing: string) =>
    canonical ? canonicalCustomerCode(existing) === canonical : existing === code;
  const root = cnpjRoot(candidate.document);
  const others = rows.filter((row) => row.id !== candidate.documentId);
  // O prospect não aparece no WMS: a mensagem diz onde ele está.
  const ownerOf = (row: CustomerIdentityRow) => {
    const name = text(row.data.name) || row.id;
    return isProspect(row.data) ? `do prospect ${name}, no Comercial` : `do cliente ${name}`;
  };

  if (code) {
    for (const row of others) {
      const taken = [row.data.code, row.data.customer_code].map(text).find((existing) => existing && sameCode(existing));
      if (taken === undefined) continue;
      const detail = taken === code ? "" : ` (cadastrado como ${taken})`;
      return `O código ${code} já é ${ownerOf(row)}${detail}.`;
    }
  }
  if (root) {
    const conflict = others.find((row) => cnpjRoot(row.data.document) === root);
    if (conflict) {
      return `A raiz do CNPJ ${root} já é ${ownerOf(conflict)}. Filiais ficam no mesmo cadastro.`;
    }
  }
  return null;
}

/** Id do documento em `customers`: o mesmo que o WMS dá ao código. */
function safeDocId(value: string) {
  return value.replace(/[^\w.-]/g, "_").slice(0, 900);
}

/** A BTG: o cliente legado do WMS, que pode não ter sigla nem projeção. */
export const LEGACY_CUSTOMER_CODE = "BTG Pactual";

// --- Regras do Comercial -------------------------------------------------------

/**
 * Código novo de cliente criado pelo Comercial: letras maiúsculas, números e
 * hífen, de 2 a 20 caracteres, começando por letra ou número. Vira o
 * `customer_code` de todo o resto (orçamento, OS, fatura, eventos) e não muda
 * depois da criação.
 */
export const CUSTOMER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
export const CUSTOMER_CODE_MAX = 20;

/** Sufixos societários que não entram no código sugerido. */
const SUFIXOS_SOCIETARIOS = new Set(["LTDA", "SA", "ME", "EPP", "EIRELI", "MEI", "SS"]);

/**
 * Código sugerido a partir do nome: sem acento, em maiúsculas, palavras
 * ligadas por hífen, sem o sufixo societário do fim ("Itaú Unibanco S.A." vira
 * ITAU-UNIBANCO) e cortado em palavra inteira até 20 caracteres. Vazio quando
 * o nome não rende um código válido; a tela pede para digitar.
 */
export function sugerirCodigo(nome: unknown): string {
  const palavras = text(nome)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  while (palavras.length > 1) {
    const ultima = palavras[palavras.length - 1];
    const penultima = palavras[palavras.length - 2];
    if (SUFIXOS_SOCIETARIOS.has(ultima)) {
      palavras.pop();
    } else if (palavras.length > 2 && penultima === "S" && (ultima === "A" || ultima === "S")) {
      // "S.A.", "S/A" e "S/S" viram duas palavras de uma letra.
      palavras.splice(-2, 2);
    } else {
      break;
    }
  }
  let codigo = "";
  for (const palavra of palavras) {
    const proximo = codigo ? `${codigo}-${palavra}` : palavra;
    if (proximo.length > CUSTOMER_CODE_MAX) {
      if (!codigo) codigo = palavra.slice(0, CUSTOMER_CODE_MAX);
      break;
    }
    codigo = proximo;
  }
  return CUSTOMER_CODE_PATTERN.test(codigo) ? codigo : "";
}

/**
 * Código de um cadastro novo: o informado (só sem espaços nas pontas e em
 * maiúsculas) ou, sem ele, o sugerido pelo nome. Fora do formato,
 * invalid-argument: acento e espaço não são trocados em silêncio, porque o
 * código fica para sempre.
 */
export function codigoDoNovoCadastro(codigo: unknown, nome: unknown): string {
  const informado = text(codigo).toUpperCase();
  const code = informado || sugerirCodigo(nome);
  if (!code) {
    throw new HttpsError("invalid-argument", "Informe o código do cliente: letras, números e hífen, de 2 a 20 caracteres.");
  }
  if (!CUSTOMER_CODE_PATTERN.test(code)) {
    throw new HttpsError(
      "invalid-argument",
      `Código do cliente inválido: ${code}. Use letras sem acento, números e hífen, de 2 a 20 caracteres, começando por letra ou número.`,
    );
  }
  return code;
}

/**
 * CNPJ inteiro sem máscara (14 caracteres), ou null quando o texto não tem um
 * CNPJ válido. Lê o texto do mesmo jeito que cnpjRoot, então a raiz gravada é
 * sempre a que a unicidade compara.
 */
export function cnpjNormalizado(value: unknown): string | null {
  const raw = text(value).toUpperCase();
  return [raw.replace(/[^0-9A-Z]/g, ""), raw.replace(/\D/g, "")].find(isValidCnpj) ?? null;
}

/** CNPJ da entrada: vazio vira null; texto sem CNPJ válido é invalid-argument. */
export function cnpjDaEntrada(value: unknown): string | null {
  if (!text(value)) return null;
  const cnpj = cnpjNormalizado(value);
  if (!cnpj) {
    throw new HttpsError(
      "invalid-argument",
      "CNPJ inválido: confira os 14 caracteres e os dígitos verificadores. O cadastro é de pessoa jurídica.",
    );
  }
  return cnpj;
}

export function cadastroArquivado(record: Record<string, unknown> | null | undefined): boolean {
  return record?.archived === true || text(record?.status) === "archived";
}

/**
 * Cadastro que o WMS opera: tem sigla do SKU, tem projeção para o portal
 * (`client_profiles`) ou é a BTG, que pode não ter nenhuma das duas. A
 * identidade (nome, razão social, CNPJ) desse cadastro se edita em
 * Configurações › Clientes, e o Comercial não o arquiva: as projeções, que
 * só o WMS grava, ficariam com o dado antigo.
 */
export function cadastroDoWms(record: Record<string, unknown>, temProjecao: boolean): boolean {
  if (canonicalSkuPrefix(record.sku_prefix)) return true;
  if (temProjecao) return true;
  const legado = canonicalCustomerCode(LEGACY_CUSTOMER_CODE);
  return [record.code, record.customer_code].some((code) => canonicalCustomerCode(code) === legado);
}

/**
 * entity_id do evento a partir do id do documento: o contrato dos eventos
 * aceita letras, números, `_` e `-`. O id que o WMS deu a um código com ponto
 * ("Itaú S.A." vira `Ita__S.A.`) ganha `_` no lugar do ponto; o código real
 * vai em customer_code.
 */
export function entityIdDoCadastro(documentId: string): string {
  return documentId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

export { safeDocId, text as textoLimpo };
