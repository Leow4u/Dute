import { formatarCnpj } from "./clientes";

/**
 * Quem emite a proposta no cabeçalho do PDF (pergunta 15 da Fase 6, parte
 * 6.20 do plano de implantação): a razão social, o CNPJ e a cidade da
 * Dutelog, como em docs/mockups/ComDocumento.dc.html.
 *
 * Os três ficam vazios até o Leonardo informar: o repositório não tem o CNPJ,
 * e nada se inventa. Vazios, o cabeçalho mostra o nome que o app usa e nenhuma
 * linha de CNPJ. O teste confere os dígitos verificadores do CNPJ preenchido.
 */
export type Emissor = { razaoSocial: string; cnpj: string; cidade: string };

export const EMISSOR_DO_DOCUMENTO: Emissor = { razaoSocial: "", cnpj: "", cidade: "" };

/** O nome do app, enquanto a razão social não vem. */
export const NOME_DA_DUTELOG = "Dutelog Soluções Logísticas";

/** O valor de cada caractere do CNPJ: o algarismo, ou o código ASCII menos 48 (CNPJ alfanumérico). */
function valor(caractere: string): number {
  return caractere.charCodeAt(0) - 48;
}

function digito(base: string): number {
  const pesos = Array.from({ length: base.length }, (_, indice) => ((base.length - 1 - indice) % 8) + 2);
  const soma = [...base].reduce((total, caractere, indice) => total + valor(caractere) * pesos[indice], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * CNPJ com os dígitos verificadores certos: 14 caracteres (os 12 primeiros
 * podem ter letra, como no CNPJ alfanumérico; os 2 últimos são algarismos).
 */
export function cnpjValido(cnpj: string): boolean {
  const limpo = cnpj.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!/^[0-9A-Z]{12}\d{2}$/.test(limpo) || /^(\d)\1{13}$/.test(limpo)) return false;
  const base = limpo.slice(0, 12);
  const primeiro = digito(base);
  const segundo = digito(`${base}${primeiro}`);
  return limpo.endsWith(`${primeiro}${segundo}`);
}

/** O nome em negrito e a linha "CNPJ ... · Cidade" (ou nada) do cabeçalho do documento. */
export function cabecalhoDoEmissor(emissor: Emissor): { nome: string; linha: string | null } {
  const cnpj = emissor.cnpj.trim();
  const linha = [cnpj ? `CNPJ ${formatarCnpj(cnpj)}` : null, emissor.cidade.trim() || null].filter(Boolean).join(" · ");
  return { nome: emissor.razaoSocial.trim() || NOME_DA_DUTELOG, linha: linha || null };
}
