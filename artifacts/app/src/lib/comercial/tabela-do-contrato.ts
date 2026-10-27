import { CASAS_DO_PRECO, dataValida, lerDecimal } from "@workspace/dominio";

import { paraDecimal } from "./montar";

export const MAXIMO_DE_ITENS_DA_TABELA = 480;

export type ItemDaTabelaForm = {
  chave: string;
  codigo: string;
  descricao: string;
  unidade: string;
  preco: string;
};

export type FormDaTabela = {
  nome: string;
  codigo: string;
  variante: string;
  vigenteDe: string;
  vigenteAte: string;
  itens: ItemDaTabelaForm[];
};

export function itemDaTabelaVazio(chave: string): ItemDaTabelaForm {
  return { chave, codigo: "", descricao: "", unidade: "", preco: "" };
}

export function formDaTabela(): FormDaTabela {
  return { nome: "", codigo: "", variante: "Comercial", vigenteDe: "", vigenteAte: "", itens: [itemDaTabelaVazio("1")] };
}

/** O preço segue como texto, com até quatro casas, até a callable. */
function precoDaEntrada(valor: string): string | null {
  const decimal = paraDecimal(valor);
  if (!decimal || decimal.startsWith("-")) return null;
  try {
    const preco = lerDecimal(decimal, CASAS_DO_PRECO, "preço");
    return preco.coeficiente >= 0n ? decimal : null;
  } catch {
    return null;
  }
}

export function problemasDaTabela(form: FormDaTabela, inicioDoContrato?: string): string[] {
  const problemas: string[] = [];
  if (!form.nome.trim()) problemas.push("Informe o nome da tabela.");
  else if (form.nome.trim().length > 120) problemas.push("O nome da tabela aceita até 120 caracteres.");
  if (form.codigo.trim().length > 40) problemas.push("O código da tabela aceita até 40 caracteres.");
  const variante = form.variante.trim() || "Comercial";
  if (variante.length > 40 || !/^[\p{L}]+(?:[\s-]+[\p{L}]+)*$/u.test(variante)) {
    problemas.push("Informe uma variante com até 40 caracteres, só com letras, espaço e hífen.");
  }
  if (form.vigenteDe && !dataValida(form.vigenteDe)) problemas.push("Informe uma data de início válida.");
  if (form.vigenteAte && !dataValida(form.vigenteAte)) problemas.push("Informe uma data de fim válida.");
  const inicio = form.vigenteDe || inicioDoContrato;
  if (inicio && dataValida(inicio) && dataValida(form.vigenteAte) && form.vigenteAte < inicio) {
    problemas.push("O fim da vigência deve ser igual ou posterior ao início.");
  }
  if (form.itens.length === 0) problemas.push("Adicione ao menos um item.");
  if (form.itens.length > MAXIMO_DE_ITENS_DA_TABELA) problemas.push(`A tabela aceita até ${MAXIMO_DE_ITENS_DA_TABELA} itens.`);
  for (const [index, item] of form.itens.entries()) {
    const prefixo = `Item ${index + 1}:`;
    if (!item.codigo.trim() || !item.descricao.trim() || !item.unidade.trim()) {
      problemas.push(`${prefixo} informe o código, a descrição e a unidade.`);
    } else if (item.codigo.trim().length > 40 || item.descricao.trim().length > 500 || item.unidade.trim().length > 20) {
      problemas.push(`${prefixo} use até 40 caracteres no código, 500 na descrição e 20 na unidade.`);
    }
    if (precoDaEntrada(item.preco) === null) {
      problemas.push(`${prefixo} informe um preço a partir de zero, com até 4 casas decimais.`);
    }
  }
  return problemas;
}

/** Escrita exclusivamente por saveContractPriceTable; o servidor valida contrato e itens. */
export function payloadDaTabela(contratoId: string, form: FormDaTabela, chave: string): Record<string, unknown> {
  return {
    contrato_id: contratoId,
    idempotency_key: chave,
    nome: form.nome.trim(),
    codigo: form.codigo.trim() || null,
    variante: form.variante.trim() || "Comercial",
    vigente_de: form.vigenteDe || null,
    vigente_ate: form.vigenteAte || null,
    itens: form.itens.map((item) => ({
      codigo: item.codigo.trim(),
      descricao: item.descricao.trim(),
      unidade: item.unidade.trim(),
      preco: precoDaEntrada(item.preco),
    })),
  };
}
