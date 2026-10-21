/**
 * Código de cliente sugerido pelo nome, no diálogo "Novo prospect"
 * (docs/plataforma/fase-6-comercial.md, parte 13).
 *
 * CÓPIA LITERAL de functions/comercial/src/domain/customer-identity.ts
 * (text, CUSTOMER_CODE_PATTERN, CUSTOMER_CODE_MAX, SUFIXOS_SOCIETARIOS e
 * sugerirCodigo): o app não importa das Functions. codigo.test.ts lê os dois
 * fontes e reprova qualquer diferença. Mudou lá, muda aqui no mesmo PR. O
 * servidor continua sendo quem decide: código vazio vira o sugerido por ele, e
 * código fora do formato é recusado com invalid-argument.
 */

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

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
