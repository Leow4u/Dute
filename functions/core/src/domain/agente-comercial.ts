import { z } from "zod";

import type { EscopoDoAgente } from "./agente-escopo.js";
import { bate, ferramenta, numero, texto, type FerramentaDoAgente } from "./agente-ferramentas.js";
import type { LeitorDoAgente, RegistroLido } from "./agente-leitor.js";
import { milesimos } from "./medidas.js";
import { casoDoRegistro } from "./parecidos-gravacao.js";
import { CASOS_POR_PEDIDO, parecidosDoPedido, SEMELHANCA_MINIMA_PCT, type CasoLido } from "./parecidos.js";
import { ORCAMENTO_ROLES } from "./platform-roles.js";

/**
 * As ferramentas do Comercial no Agent Dute do núcleo (parte 5.5d): os
 * orçamentos do cliente, com o preço, a LPU com o preço da tabela dele e os
 * orçamentos parecidos da memória (parte 5.3). Só para quem orça
 * (ORCAMENTO_ROLES), que lê valor; o leitor recusa as coleções com valor para
 * os outros papéis.
 */

const ROTULO_DO_ORCAMENTO: Record<string, string> = {
  rascunho: "Rascunho",
  para_aprovar: "Para aprovar",
  aprovado: "Aprovado",
  enviado: "Enviado",
};

const formato = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "R$ 1.250,50", com o espaço comum (o Intl usa o rígido, que o modelo não precisa). */
function reais(valor: number): string {
  return formato.format(valor).replace(/\s/gu, " ");
}

/** Os centavos em R$; vazio sem o valor. */
export function emReais(centavos: unknown): string | undefined {
  return typeof centavos === "number" && Number.isFinite(centavos) ? reais(centavos / 100) : undefined;
}

/** O preço guardado como texto decimal ("1250.5") em R$. */
function precoEmReais(preco: unknown): string | undefined {
  const lido = Number(texto(preco));
  return texto(preco) && Number.isFinite(lido) ? reais(lido) : undefined;
}

function linhas(orcamento: RegistroLido): Array<Record<string, unknown>> {
  return Array.isArray(orcamento.linhas) ? orcamento.linhas.filter((linha): linha is Record<string, unknown> => Boolean(linha) && typeof linha === "object") : [];
}

function orcamentoResumido(orcamento: RegistroLido) {
  return {
    numero: texto(orcamento.numero) || orcamento.id,
    rotulo: texto(orcamento.rotulo) || undefined,
    revisao: numero(orcamento.rv) || undefined,
    tipo: texto(orcamento.tipo_rv) || undefined,
    situacao: ROTULO_DO_ORCAMENTO[texto(orcamento.status)] ?? texto(orcamento.status),
    data_base: texto(orcamento.data_base) || undefined,
    total: emReais(orcamento.total_cents),
    itens: linhas(orcamento).length,
    validade_dias: numero(orcamento.validade_dias) || undefined,
  };
}

export async function orcamentos(leitor: LeitorDoAgente, entrada: { situacao?: "abertos" | "todos"; limite?: number }) {
  const limite = Math.min(Math.max(entrada.limite ?? 15, 1), 40);
  const lidos = (await leitor.doCliente("quotes", { ordem: [["updated_at", "desc"]], limite: 100 }))
    .filter((orcamento) => (entrada.situacao ?? "todos") === "todos" || texto(orcamento.status) !== "enviado")
    .map(orcamentoResumido);
  return { encontrados: lidos.length, orcamentos: lidos.slice(0, limite) };
}

export async function verOrcamento(leitor: LeitorDoAgente, numeroDoOrcamento: string) {
  const orcamento = await leitor.documento("quotes", numeroDoOrcamento);
  if (!orcamento) return { encontrado: false };
  return {
    encontrado: true,
    orcamento: { ...orcamentoResumido(orcamento), subtotal: emReais(orcamento.subtotal_cents), ajustes: emReais(orcamento.ajustes_cents), condicoes: texto(orcamento.condicoes) || undefined },
    linhas: linhas(orcamento)
      .slice(0, 80)
      .map((linha) => ({
        item: texto(linha.item),
        servico: texto(linha.servico) || undefined,
        unidade: texto(linha.unidade) || undefined,
        quantidade: texto(linha.quantidade) || undefined,
        preco: precoEmReais(linha.preco),
        total: emReais(linha.total_cents),
        fora_da_tabela: texto(linha.origem) === "alterado" || texto(linha.origem) === "avulso" ? true : undefined,
      })),
  };
}

/** A tabela ativa do cliente; sem ela, a Padrão Dutelog. */
async function tabelaDoCliente(leitor: LeitorDoAgente): Promise<RegistroLido | null> {
  const doCliente = await leitor.doCliente("price_tables", { onde: [["status", "==", "ativa"]], limite: 5 });
  if (doCliente.length) return doCliente[0];
  const padrao = await leitor.geral("price_tables", { onde: [["status", "==", "ativa"]], limite: 5 });
  return padrao[0] ?? null;
}

export async function lpu(leitor: LeitorDoAgente, busca: string) {
  const [itens, tabela] = await Promise.all([leitor.geral("lpu_items", { limite: 3000 }), tabelaDoCliente(leitor)]);
  const precos = tabela && tabela.precos && typeof tabela.precos === "object" ? (tabela.precos as Record<string, Record<string, unknown>>) : {};
  const achados = itens
    .filter((item) => item.orcavel !== false)
    .filter((item) => bate(busca, item.item, item.servico, item.categoria, item.descricao))
    .map((item) => ({
      item: texto(item.item),
      servico: texto(item.servico) || undefined,
      unidade: texto(item.unidade) || undefined,
      categoria: texto(item.categoria) || undefined,
      preco: precoEmReais(precos[item.id]?.preco),
    }))
    .sort((a, b) => a.item.localeCompare(b.item) || (a.servico ?? "").localeCompare(b.servico ?? ""));
  return {
    tabela: tabela ? { nome: texto(tabela.nome) || undefined, vigente_de: texto(tabela.vigente_de) || undefined, do_cliente: tabela.customer_code !== null } : undefined,
    encontrados: achados.length,
    itens: achados.slice(0, 30),
    observacao: tabela ? undefined : "Sem tabela de preço ativa para este cliente.",
  };
}

/**
 * Os orçamentos parecidos com o da demanda, pela memória (parte 5.3): os
 * itens da LPU do orçamento atual comparados com as demandas fechadas do
 * mesmo cliente, com o orçado e o realizado de cada caso.
 */
export async function orcamentosParecidos(leitor: LeitorDoAgente, numeroDaDemanda: string) {
  const orcamento = await leitor.documento("quotes", numeroDaDemanda);
  if (!orcamento) return { encontrado: false };
  const itens = linhas(orcamento)
    .map((linha) => ({ lpu_item_id: texto(linha.lpu_item_id), quantidade: texto(linha.quantidade) }))
    .filter((item) => item.lpu_item_id && milesimos(item.quantidade) > 0);
  if (!itens.length) return { encontrado: true, casos: [], observacao: "O orçamento ainda não tem itens da LPU para comparar." };
  const lembrancas = await leitor.doCliente("ai_case_memory", { ordem: [["fechada_em", "desc"]], limite: 300 });
  const casos = lembrancas.map((lembranca) => casoDoRegistro(lembranca.id, lembranca)).filter((caso): caso is CasoLido => caso !== null);
  const parecidos = parecidosDoPedido({ demanda: orcamento.id, itens }, leitor.customerCode, casos);
  return {
    encontrado: true,
    regra: `Os ${CASOS_POR_PEDIDO} casos fechados mais parecidos deste cliente, a partir de ${SEMELHANCA_MINIMA_PCT}% de semelhança pelos itens e quantidades.`,
    demandas_fechadas: parecidos.lembrancas,
    casos: parecidos.casos.map((caso) => ({
      demanda: caso.demanda,
      titulo: caso.titulo ?? undefined,
      semelhanca_pct: caso.semelhanca_pct,
      itens_em_comum: caso.itens_em_comum,
      orcado: emReais(caso.orcado_cents),
      realizado: emReais(caso.realizado_cents),
      executado: [caso.executado_de, caso.executado_ate].filter(Boolean).join(" a ") || undefined,
      itens: caso.itens.slice(0, 20),
    })),
    observacao: parecidos.casos.length ? undefined : "Ainda não há demanda fechada parecida deste cliente: a memória ainda não tem base.",
  };
}

// --- O registro -------------------------------------------------------------------------------

const quemOrca = (escopo: EscopoDoAgente) => escopo.leValor && (ORCAMENTO_ROLES as readonly string[]).includes(escopo.role);

export const FERRAMENTAS_DO_COMERCIAL: readonly FerramentaDoAgente[] = [
  ferramenta({
    nome: "orcamentos",
    descricao: "Orçamentos do cliente, os mais recentes primeiro, com a revisão, a situação (Rascunho, Para aprovar, Aprovado, Enviado) e o total.",
    modulo: "comercial",
    entrada: z.object({ situacao: z.enum(["abertos", "todos"]).optional(), limite: z.number().int().min(1).max(40).optional() }),
    para: quemOrca,
    executar: ({ leitor }, entrada) => orcamentos(leitor, entrada),
  }),
  ferramenta({
    nome: "ver_orcamento",
    descricao: "Detalhe de um orçamento: as linhas com item, quantidade, preço e total, os ajustes, as condições e a validade.",
    modulo: "comercial",
    entrada: z.object({ numero: z.string().max(20).describe("Número do orçamento (o da demanda), ex.: '10045'") }),
    para: quemOrca,
    executar: ({ leitor }, { numero: alvo }) => verOrcamento(leitor, alvo),
  }),
  ferramenta({
    nome: "lpu",
    descricao: "Itens da LPU (lista de preços unitários) com o preço da tabela ativa do cliente, ou da Padrão Dutelog quando ele não tem a dele.",
    modulo: "comercial",
    entrada: z.object({ texto: z.string().max(200).describe("Palavras do item ou do serviço, ex.: 'mesa montagem'") }),
    para: quemOrca,
    executar: ({ leitor }, { texto: busca }) => lpu(leitor, busca),
  }),
  ferramenta({
    nome: "orcamentos_parecidos",
    descricao: "Demandas fechadas deste cliente parecidas com o orçamento atual, pela memória, com a semelhança, o orçado e o realizado de cada caso.",
    modulo: "comercial",
    entrada: z.object({ demanda: z.string().max(20).describe("Número da demanda do orçamento, ex.: '10045'") }),
    para: quemOrca,
    executar: ({ leitor }, { demanda }) => orcamentosParecidos(leitor, demanda),
  }),
];
