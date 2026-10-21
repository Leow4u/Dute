import { centavosDaLinha, formatarReais } from "@workspace/dominio";

import { linhasGravadas, type LinhaGravada } from "./documento";
import { formatarDecimal } from "./montar";
import { ROTA_APROVAR } from "./navegacao";
import { ORIGEM_ROTULO, dataHoraCurta, filtrarFila, itemDaFila, type ItemDaFila, type OrigemLinha } from "./orcamentos";

/**
 * Aprovar no celular (docs/mockups/ComAprovarCelular.dc.html; parte 12a de
 * docs/plataforma/fase-6-comercial.md): o owner percorre os orçamentos em
 * "Para aprovar" ("1 de N", anterior e próximo), confere o que fugiu da
 * tabela (o bloco Conferir) e aprova, devolve com nota ou aprova e envia.
 * Meta: aprovar em menos de um minuto. Regras puras; a tela lê pelo
 * Firestore e grava só por advanceQuote.
 */

type Registro = Record<string, unknown>;
type Documento = { id: string; data: Registro };

/** A aprovação numa tela: "/comercial/aprovar", ou já num orçamento ("?numero=10045"). */
export function hrefDaAprovacao(numero?: string | null): string {
  return numero ? `${ROTA_APROVAR}?numero=${encodeURIComponent(numero)}` : ROTA_APROVAR;
}

/** O orçamento da busca da URL (`?numero=10045`), ou null. */
export function numeroDaBusca(busca: string): string | null {
  const numero = (new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca).get("numero") ?? "").trim();
  return /^\d{5,8}$/.test(numero) ? numero : null;
}

export type OrcamentoParaAprovar = { item: ItemDaFila; linhas: LinhaGravada[] };

/**
 * Os orçamentos que esperam o owner: a demanda em "Para aprovar" (a fila lê
 * `demands.etapa`) com a RV em curso "para aprovar". Quem espera há mais
 * tempo vem primeiro, como na fila.
 */
export function filaDeAprovacao(demandas: readonly Documento[], orcamentos: readonly Documento[]): OrcamentoParaAprovar[] {
  const porNumero = new Map(orcamentos.map((quote) => [quote.id, quote.data]));
  const itens = demandas.flatMap((demanda) => {
    const quote = porNumero.get(demanda.id);
    if (!quote) return [];
    const item = itemDaFila(demanda.id, demanda.data, quote);
    return item && item.etapa === "para_aprovar" && item.status === "para_aprovar" ? [item] : [];
  });
  return filtrarFila(itens, "para_aprovar", "")
    .flatMap((grupo) => grupo.itens)
    .map((item) => ({ item, linhas: linhasGravadas(porNumero.get(item.numero)?.linhas) }));
}

/** O orçamento no item do Início: o número e o cliente ("10045 · Itaú Unibanco"). */
export type OrcamentoParaAprovarNoInicio = { numero: string; cliente: string };

/** As demandas em "Para aprovar" para o Início, de quem espera há mais tempo. */
export function orcamentosParaOInicio(demandas: readonly Documento[]): OrcamentoParaAprovarNoInicio[] {
  const texto = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return demandas
    .filter((demanda) => texto(demanda.data.etapa) === "para_aprovar")
    .map((demanda) => ({
      numero: demanda.id,
      cliente: texto(demanda.data.customer_name) || texto(demanda.data.customer_code),
      desde: texto(demanda.data.etapa_desde),
    }))
    .sort((a, b) => a.desde.localeCompare(b.desde) || a.numero.localeCompare(b.numero))
    .map(({ numero, cliente }) => ({ numero, cliente }));
}

// --- Navegação ------------------------------------------------------------------------------------

export type PosicaoNaFila = {
  atual: string | null;
  /** 1 de N (0 com a fila vazia). */
  indice: number;
  total: number;
  anterior: string | null;
  proximo: string | null;
};

/** Onde a pessoa está na fila: o escolhido, ou o primeiro quando ele saiu (ou nada foi escolhido). */
export function posicaoNaFila(numeros: readonly string[], escolhido: string | null): PosicaoNaFila {
  if (!numeros.length) return { atual: null, indice: 0, total: 0, anterior: null, proximo: null };
  const achado = escolhido ? numeros.indexOf(escolhido) : -1;
  const indice = achado >= 0 ? achado : 0;
  return {
    atual: numeros[indice],
    indice: indice + 1,
    total: numeros.length,
    anterior: indice > 0 ? numeros[indice - 1] : null,
    proximo: indice < numeros.length - 1 ? numeros[indice + 1] : null,
  };
}

/**
 * O "Próximo" depois de decidir: o orçamento decidido sai da fila ao vivo, e
 * o próximo é o que vinha depois dele na fila que a pessoa via; se ele era o
 * último, volta ao primeiro que ainda espera. Fila vazia: null.
 */
export function proximoDepois(agora: readonly string[], naHora: readonly string[], decidido: string): string | null {
  const vivos = new Set(agora.filter((numero) => numero !== decidido));
  const depois = naHora.slice(naHora.indexOf(decidido) + 1).find((numero) => vivos.has(numero));
  return depois ?? agora.find((numero) => numero !== decidido) ?? null;
}

// --- O que conferir -------------------------------------------------------------------------------

export type PontoDeConferir = {
  chave: string;
  /** A origem da linha; null para a marca do orçamento (tabela fora da vigência, sem tabela). */
  origem: OrigemLinha | null;
  rotulo: string;
  titulo: string;
  /** O preço que vale (unitário; no ajuste, o desconto). */
  valor: string | null;
  /** O preço da tabela, riscado ao lado do alterado. */
  riscado: string | null;
  motivo: string | null;
};

/** "R$ 8,50" a partir do decimal com ponto, com o espaço fixo de formatarReais (lib/dominio). */
export function reaisDoDecimal(decimal: string): string {
  const negativo = decimal.trim().startsWith("-");
  const valor = `R$ ${formatarDecimal(decimal.trim().replace(/^-/, ""), 2)}`;
  return negativo ? `-${valor}` : valor;
}

function nomeDaLinha(linha: LinhaGravada): string {
  if (linha.origem === "ajuste") return linha.descricao || linha.item || "Ajuste";
  const item = linha.item || linha.descricao;
  return [item, linha.servico].filter(Boolean).join(" · ");
}

const MARCAS_PARA_CONFERIR: Record<string, string> = {
  tabela_vencida: "Tabela fora da vigência na data-base",
  sem_tabela: "Sem tabela",
};

/**
 * O bloco Conferir: o que fugiu da tabela, linha a linha (alterada com o
 * preço da tabela riscado e o motivo, avulsa, ajuste), e as marcas da tabela
 * que o servidor deu. Orçamento todo de tabela: nada a conferir.
 */
export function pontosDeConferir(linhas: readonly LinhaGravada[], marcas: readonly string[] = []): PontoDeConferir[] {
  const pontos: PontoDeConferir[] = [];
  for (const marca of marcas) {
    const titulo = MARCAS_PARA_CONFERIR[marca];
    if (titulo) pontos.push({ chave: `marca-${marca}`, origem: null, rotulo: "Tabela", titulo, valor: null, riscado: null, motivo: null });
  }
  for (const linha of linhas) {
    if (linha.origem === "tabela") continue;
    pontos.push({
      chave: linha.id,
      origem: linha.origem,
      rotulo: ORIGEM_ROTULO[linha.origem],
      titulo: nomeDaLinha(linha),
      valor: linha.origem === "ajuste" ? formatarReais(linha.totalCents) : linha.preco ? reaisDoDecimal(linha.preco) : null,
      riscado: linha.origem === "alterado" && linha.precoTabela ? reaisDoDecimal(linha.precoTabela) : null,
      motivo: linha.motivo,
    });
  }
  return pontos;
}

export type LinhaCompacta = {
  chave: string;
  nome: string;
  /** "24 UN"; vazio no ajuste. */
  quantidade: string;
  origem: OrigemLinha;
  total: string;
  /** No alterado, o total pela tabela, riscado. */
  riscado: string | null;
};

function totalPelaTabela(linha: LinhaGravada): string | null {
  if (linha.origem !== "alterado" || !linha.precoTabela) return null;
  try {
    return formatarReais(centavosDaLinha(linha.quantidade, linha.precoTabela));
  } catch {
    return null;
  }
}

/** A lista compacta das linhas: o nome, a quantidade com a unidade, a origem e o total. */
export function linhasCompactas(linhas: readonly LinhaGravada[]): LinhaCompacta[] {
  return linhas.map((linha) => ({
    chave: linha.id,
    nome: nomeDaLinha(linha),
    quantidade:
      linha.origem === "ajuste" ? "" : [linha.quantidade ? formatarDecimal(linha.quantidade, 0) : "", linha.unidade ?? ""].join(" ").trim(),
    origem: linha.origem,
    total: formatarReais(linha.totalCents),
    riscado: totalPelaTabela(linha),
  }));
}

// --- Depois da ação ---------------------------------------------------------------------------------

export type AcaoDaAprovacao = "approve" | "approve_and_send" | "return";

const HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** A confirmação no rodapé: "Aprovado 17:05", "Aprovado e enviado 17:05", "Devolvido a Guilherme". */
export function confirmacaoDaAcao(acao: AcaoDaAprovacao, em: string, autor: string | null): string {
  const ms = Date.parse(em);
  const hora = Number.isNaN(ms) ? "" : HORA.format(new Date(ms));
  if (acao === "approve") return `Aprovado ${hora}`.trim();
  if (acao === "approve_and_send") return `Aprovado e enviado ${hora}`.trim();
  return autor ? `Devolvido a ${autor}` : "Devolvido";
}

/** "Guilherme · 20/10 16:40": quem montou e quando mandou para aprovação. */
export function quemOrcou(autor: string | null, passoEm: string | null): string {
  return [autor, dataHoraCurta(passoEm)].filter(Boolean).join(" · ") || "—";
}
