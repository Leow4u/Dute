import { formatarReais } from "@workspace/dominio";

import { carregarItens, formatarDecimal, paraDecimal, type ItemDaTabela, type LinhaForm } from "../comercial/montar";
import { duracaoEmTexto } from "./sugestao";

/**
 * Os orçamentos parecidos na montagem do orçamento (docs/plataforma/fase-5-memoria.md,
 * parte 5.3c): o pedido, pelos itens da tabela do orçamento, os textos de
 * cada caso e o "Usar as quantidades". A conta é do servidor (functions/core,
 * findSimilarQuotes), só com as demandas fechadas do mesmo cliente. Usar só
 * preenche as linhas: quem salva é a pessoa.
 */

export type ItemDoCaso = { lpu_item_id: string | null; item: string; unidade: string | null; orcado: string | null; realizado: string | null };

export type CasoParecido = {
  demanda: string;
  titulo: string | null;
  itens: ItemDoCaso[];
  orcado_cents: number | null;
  realizado_cents: number | null;
  executado_de: string | null;
  executado_ate: string | null;
  os: number;
  minutos_de_trabalho: number | null;
  fechada_em: string | null;
  semelhanca_pct: number;
  itens_em_comum: number;
};

export type Parecidos = { casos: CasoParecido[]; lembrancas: number };

export type PedidoDeParecidos = { demanda: string; itens: Array<{ lpu_item_id: string; quantidade: string }> };

const QUANTIDADE = /^\d{1,9}(\.\d{1,3})?$/;

/** A quantidade em decimal com ponto, positiva; senão, null. */
function decimalPositivo(decimal: string | null | undefined): string | null {
  return decimal && QUANTIDADE.test(decimal) && Number(decimal) > 0 ? decimal : null;
}

/** A quantidade como a pessoa digitou na linha ("1.234,5"), em decimal com ponto. */
function quantidadeDaLinha(valor: string): string | null {
  return decimalPositivo(paraDecimal(valor));
}

/**
 * O pedido dos parecidos: as linhas da tabela com o item da LPU e quantidade.
 * Em ordem do item, para mudar só quando o que se pede muda. Sem nenhuma,
 * não há o que comparar.
 */
export function pedidoDosParecidos(demanda: string, linhas: ReadonlyArray<Pick<LinhaForm, "origem" | "lpuItemId" | "quantidade">>): PedidoDeParecidos | null {
  const itens = linhas
    .flatMap((linha) => {
      const quantidade = quantidadeDaLinha(linha.quantidade);
      return linha.origem === "tabela" && linha.lpuItemId && quantidade ? [{ lpu_item_id: linha.lpuItemId, quantidade }] : [];
    })
    .sort((a, b) => a.lpu_item_id.localeCompare(b.lpu_item_id) || a.quantidade.localeCompare(b.quantidade));
  return itens.length ? { demanda, itens } : null;
}

const FUSO = "America/Sao_Paulo";

function diaDoInstante(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? iso : data.toLocaleDateString("pt-BR", { timeZone: FUSO });
}

function diaBr(data: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : data;
}

/** "95% parecido". */
export function semelhancaEmTexto(caso: Pick<CasoParecido, "semelhanca_pct">): string {
  return `${caso.semelhanca_pct}% parecido`;
}

/** "Fechada em 20/10/2026". */
export function fechamentoEmTexto(caso: Pick<CasoParecido, "fechada_em">): string | null {
  return caso.fechada_em ? `Fechada em ${diaDoInstante(caso.fechada_em)}` : null;
}

/** "14 un", "3,5 m²"; sem quantidade, "—". */
export function quantidadeDoCaso(quantidade: string | null, unidade: string | null): string {
  if (quantidade === null) return "—";
  return `${formatarDecimal(quantidade, 0)} ${unidade ? unidade.toLocaleLowerCase("pt-BR") : "un"}`;
}

/** "R$ 5.000,00"; sem valor, "—". */
export function valorDoCaso(centavos: number | null): string {
  return centavos === null ? "—" : formatarReais(centavos);
}

/** "15/10/2026" ou "15/10/2026 a 16/10/2026". */
export function periodoEmTexto(caso: Pick<CasoParecido, "executado_de" | "executado_ate">): string | null {
  const { executado_de: de, executado_ate: ate } = caso;
  if (!de) return null;
  return ate && ate !== de ? `${diaBr(de)} a ${diaBr(ate)}` : diaBr(de);
}

/** "3h em 2 OS", "2 OS"; sem OS, null. */
export function trabalhoEmTexto(caso: Pick<CasoParecido, "os" | "minutos_de_trabalho">): string | null {
  if (!caso.os) return null;
  const os = `${caso.os} OS`;
  return caso.minutos_de_trabalho ? `${duracaoEmTexto(caso.minutos_de_trabalho)} em ${os}` : os;
}

/** Os itens do caso que a tabela do orçamento tem, com a quantidade feita (o realizado; sem ele, o orçado). */
export function itensParaUsar(caso: Pick<CasoParecido, "itens">, catalogo: readonly ItemDaTabela[]): Array<{ lpuItemId: string; quantidade: string }> {
  const naTabela = new Set(catalogo.map((item) => item.lpuItemId));
  return caso.itens.flatMap((item) => {
    // O caso vem do servidor em decimal com ponto ("1.234" é um e pouco, não mil).
    const quantidade = decimalPositivo(item.realizado ?? item.orcado);
    return item.lpu_item_id && naTabela.has(item.lpu_item_id) && quantidade ? [{ lpuItemId: item.lpu_item_id, quantidade }] : [];
  });
}

/** "Usar as quantidades": o item que já está numa linha fica com a quantidade do caso; o outro entra pela tabela. Só preenche. */
export function usarQuantidades(linhas: readonly LinhaForm[], caso: Pick<CasoParecido, "itens">, catalogo: readonly ItemDaTabela[], novaChave: () => string): LinhaForm[] {
  return carregarItens(linhas, itensParaUsar(caso, catalogo), catalogo, novaChave);
}

/** As linhas já têm as quantidades do caso: cada item dele que a tabela tem está numa linha com a mesma quantidade. */
export function quantidadesUsadas(linhas: ReadonlyArray<Pick<LinhaForm, "origem" | "lpuItemId" | "quantidade">>, caso: Pick<CasoParecido, "itens">, catalogo: readonly ItemDaTabela[]): boolean {
  const itens = itensParaUsar(caso, catalogo);
  return (
    itens.length > 0 &&
    itens.every((item) =>
      linhas.some((linha) => linha.origem === "tabela" && linha.lpuItemId === item.lpuItemId && Number(quantidadeDaLinha(linha.quantidade)) === Number(item.quantidade)),
    )
  );
}
