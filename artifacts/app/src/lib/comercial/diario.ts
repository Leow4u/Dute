import { CASAS_DA_QUANTIDADE, formatarReais, lerDecimal, somarCentavos } from "@workspace/dominio";

import type { ItemDaMedicao, LinhaDaMedicao } from "./medicoes";

/**
 * Diário de Bordo do cliente (docs/mockups/ComMedicaoMensal.dc.html, parte
 * 16b de docs/plataforma/fase-6-comercial.md): as linhas da medição no
 * formato do arquivo que o Safra pede, geradas no navegador.
 *
 * É a mesma conta de exportarDiarioDeBordo em functions/comercial
 * (domain/medicao.ts, parte 16a); diario.test.ts roda as duas contra as
 * mesmas medições. Aqui a classe de cada item (veículo, ajudante) é a que o
 * servidor gravou na linha; o item sem classe (gravado antes dela) conta como
 * "outros".
 */

/**
 * As colunas do Diário de Bordo, na ordem e com o cabeçalho do arquivo que o
 * cliente pede (os dois "Custo (R$)" são o do veículo e o dos ajudantes). A
 * chave orçamentária é do cliente e sai vazia.
 */
export const COLUNAS_DO_DIARIO = [
  "OS",
  "Data Solic.",
  "Solicitante",
  "Data Frete",
  "Veículo",
  "Veículo Quant.",
  "Custo (R$)",
  "Horário Ajudante",
  "Ajudante Quant.",
  "Custo (R$)",
  "Custo Total (R$)",
  "Local Origem",
  "Local Destino",
  "Descrição Mercadoria",
  "Chave",
] as const;

export type LinhaDoDiario = {
  /** A linha da medição de onde saiu (a linha com dois veículos sai em duas do Diário). */
  linha_id: string;
  os: string;
  data_solicitacao: string;
  solicitante: string;
  data_frete: string;
  veiculo: string;
  veiculo_quantidade: string;
  veiculo_custo_cents: number;
  ajudante_horario: string;
  ajudante_quantidade: string;
  ajudante_custo_cents: number;
  /** O custo total da linha do Diário: veículo, ajudantes e o que não é nem um nem outro. */
  valor_cents: number;
  origem: string;
  destino: string;
  mercadoria: string;
  chave: string;
  /** As células, na ordem de COLUNAS_DO_DIARIO; dinheiro como "1.180,00" (sem o R$). */
  colunas: string[];
};

/** Soma quantidades em texto decimal sem passar por float ("1.5" + "2" = "3,5"). */
export function somarQuantidades(quantidades: readonly string[]): string {
  let soma = 0n;
  for (const quantidade of quantidades) {
    const valor = lerDecimal(quantidade, CASAS_DA_QUANTIDADE, "quantidade");
    soma += valor.coeficiente * 10n ** BigInt(CASAS_DA_QUANTIDADE - valor.casas);
  }
  const divisor = 10n ** BigInt(CASAS_DA_QUANTIDADE);
  const inteiro = soma / divisor;
  const fracao = (soma % divisor).toString().padStart(CASAS_DA_QUANTIDADE, "0").replace(/0+$/, "");
  return fracao ? `${inteiro},${fracao}` : String(inteiro);
}

function dataBr(data: string): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** Dinheiro na coluna: "1.180,00", sem o "R$" (e o espaço que não quebra depois dele). */
function reaisDaColuna(centavos: number): string {
  return formatarReais(centavos).replace(/^(-?)R\$\s/, "$1");
}

/** A descrição do item como o cliente a chama na tabela (a chave do Diário: "VUC", "Seg. Sex. | 09h às 18h"). */
function nomeNoDiario(item: Pick<ItemDaMedicao, "descricao" | "item">): string {
  return item.descricao.replace(/\s+/g, " ").trim() || item.item.replace(/\s+/g, " ").trim();
}

/**
 * As linhas da medição no formato do Diário de Bordo (COLUNAS_DO_DIARIO), em
 * ordem de execução:
 * - o veículo e o horário do ajudante são a descrição do item na tabela do
 *   cliente (a chave que o Diário usa), com a quantidade e o custo de cada um;
 * - a linha da medição com dois tipos de veículo sai em uma linha do Diário
 *   por veículo; os ajudantes e o que não é veículo nem ajudante ficam na
 *   primeira. A soma das linhas do Diário é o total da linha da medição;
 * - o solicitante é a área, nunca o nome da pessoa; a chave orçamentária sai
 *   vazia.
 */
export function exportarDiarioDeBordo(medicao: { linhas: readonly LinhaDaMedicao[] }): LinhaDoDiario[] {
  return [...medicao.linhas]
    .sort((a, b) => a.executada_em.localeCompare(b.executada_em) || a.os.localeCompare(b.os, "pt-BR"))
    .flatMap((linha) => {
      const veiculos = linha.itens.filter((item) => item.classe?.veiculo);
      const ajudantes = linha.itens.filter((item) => !item.classe?.veiculo && item.classe?.ajudante);
      const outros = linha.itens.filter((item) => !item.classe?.veiculo && !item.classe?.ajudante);
      const grupos = new Map<string, ItemDaMedicao[]>();
      for (const item of veiculos) grupos.set(nomeNoDiario(item), [...(grupos.get(nomeNoDiario(item)) ?? []), item]);
      const porVeiculo: Array<[string, ItemDaMedicao[]]> = grupos.size > 0 ? [...grupos.entries()] : [["", []]];
      const custo = (itens: readonly ItemDaMedicao[]) => somarCentavos(itens.map((item) => item.total_cents));
      const quantidade = (itens: readonly ItemDaMedicao[]) => (itens.length ? somarQuantidades(itens.map((item) => item.quantidade)) : "0");

      return porVeiculo.map(([veiculo, itensDoVeiculo], indice): LinhaDoDiario => {
        const primeira = indice === 0;
        const ajudantesDaLinha = primeira ? ajudantes : [];
        const veiculoCusto = custo(itensDoVeiculo);
        const ajudanteCusto = custo(ajudantesDaLinha);
        const valor = somarCentavos([veiculoCusto, ajudanteCusto, primeira ? custo(outros) : 0]);
        const saida = {
          linha_id: linha.id,
          os: linha.os,
          data_solicitacao: dataBr(linha.solicitada_em),
          solicitante: linha.area_solicitante,
          data_frete: dataBr(linha.executada_em),
          veiculo,
          veiculo_quantidade: quantidade(itensDoVeiculo),
          veiculo_custo_cents: veiculoCusto,
          ajudante_horario: [...new Set(ajudantesDaLinha.map(nomeNoDiario))].join(" + "),
          ajudante_quantidade: quantidade(ajudantesDaLinha),
          ajudante_custo_cents: ajudanteCusto,
          valor_cents: valor,
          origem: linha.origem,
          destino: linha.destino,
          mercadoria: linha.mercadoria,
          chave: "",
        };
        return {
          ...saida,
          colunas: [
            saida.os,
            saida.data_solicitacao,
            saida.solicitante,
            saida.data_frete,
            saida.veiculo,
            saida.veiculo_quantidade,
            reaisDaColuna(saida.veiculo_custo_cents),
            saida.ajudante_horario,
            saida.ajudante_quantidade,
            reaisDaColuna(saida.ajudante_custo_cents),
            reaisDaColuna(saida.valor_cents),
            saida.origem,
            saida.destino,
            saida.mercadoria,
            saida.chave,
          ],
        };
      });
    });
}

// --- Arquivo --------------------------------------------------------------------------------------

/** Texto que o Excel leria como fórmula (=, +, -, @) ganha o apóstrofo; número com sinal fica como está. */
function celula(valor: string): string {
  let texto = valor;
  if (/^[=+\-@\t\r]/.test(texto) && !/^-?[\d.,]+$/.test(texto)) texto = `'${texto}`;
  return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/**
 * O Diário em CSV para o Excel em português: ponto e vírgula, linhas com
 * CRLF e o BOM do UTF-8 (sem ele o Excel quebra os acentos).
 */
export function csvDoDiario(linhas: readonly Pick<LinhaDoDiario, "colunas">[]): string {
  const registros = [COLUNAS_DO_DIARIO.join(";"), ...linhas.map((linha) => linha.colunas.map(celula).join(";"))];
  return `﻿${registros.join("\r\n")}\r\n`;
}

/** "diario-de-bordo-banco-safra-2026-10.csv". */
export function nomeDoArquivoDoDiario(cliente: string, competencia: string): string {
  const nome = cliente
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ["diario-de-bordo", nome, competencia].filter(Boolean).join("-") + ".csv";
}

/** Baixa o CSV no navegador. */
export function baixarCsv(nome: string, conteudo: string): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8" }));
  const ancora = document.createElement("a");
  ancora.href = url;
  ancora.download = nome;
  document.body.appendChild(ancora);
  ancora.click();
  ancora.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
