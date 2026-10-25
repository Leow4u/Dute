import { z } from "zod";

import type { EscopoDoAgente } from "./agente-escopo.js";
import { bate, ferramenta, numero, texto, type FerramentaDoAgente } from "./agente-ferramentas.js";
import type { LeitorDoAgente, RegistroLido } from "./agente-leitor.js";
import { milesimos } from "./medidas.js";
import { diaEmSaoPaulo } from "./parados.js";
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

/** A vigência contém o dia (AAAA-MM-DD): de `vigente_de` até `vigente_ate`, ou em aberto. */
function valeNoDia(tabela: RegistroLido, dia: string): boolean {
  const de = texto(tabela.vigente_de);
  const ate = texto(tabela.vigente_ate);
  return de !== "" && de <= dia && (ate === "" || dia <= ate);
}

/** A variante normalizada, que a carga grava junto (`variante_chave`). */
function varianteDa(tabela: RegistroLido): string {
  return texto(tabela.variante_chave) || texto(tabela.variante).toLowerCase();
}

/**
 * As tabelas que valem no dia, pela regra do orçamento (functions/comercial,
 * tabelas.ts, "Escolha da tabela no orçamento"): a vigência contém o dia,
 * ativa ou já encerrada. "Ativa" não quer dizer vigente: a tabela carregada
 * com início no futuro entra ativa e encerra a anterior na véspera. Em cada
 * variante, o cliente que tem tabela nela fica com as dele (uma por contrato,
 * e a sem contrato), mesmo sem nenhuma que valha no dia; só a variante em que
 * ele não tem tabela cai na Padrão Dutelog.
 */
async function tabelasDoDia(leitor: LeitorDoAgente, dia: string): Promise<RegistroLido[]> {
  const [doCliente, padrao] = await Promise.all([
    leitor.doCliente("price_tables", { limite: 500 }),
    leitor.geral("price_tables", { limite: 500 }),
  ]);
  const variantesDoCliente = new Set(doCliente.map(varianteDa));
  const doDia = [
    ...doCliente.filter((tabela) => valeNoDia(tabela, dia)),
    ...padrao.filter((tabela) => !variantesDoCliente.has(varianteDa(tabela)) && valeNoDia(tabela, dia)),
  ];
  return doDia.sort((a, b) => varianteDa(a).localeCompare(varianteDa(b)) || texto(a.contract_id).localeCompare(texto(b.contract_id)));
}

/** "Tabela Itaú 2026 · Noturna · contrato CT-7": o nome, a variante e o contrato, quando há. */
function rotuloDaTabela(tabela: RegistroLido): string {
  const contrato = texto(tabela.contract_id);
  return [texto(tabela.nome) || tabela.id, texto(tabela.variante), contrato ? `contrato ${contrato}` : ""].filter(Boolean).join(" · ");
}

function precosDa(tabela: RegistroLido): Record<string, Record<string, unknown>> {
  return tabela.precos && typeof tabela.precos === "object" ? (tabela.precos as Record<string, Record<string, unknown>>) : {};
}

export async function lpu(leitor: LeitorDoAgente, busca: string, agora: Date) {
  const dia = diaEmSaoPaulo(agora.toISOString()) ?? agora.toISOString().slice(0, 10);
  const [itens, tabelas] = await Promise.all([leitor.geral("lpu_items", { limite: 3000 }), tabelasDoDia(leitor, dia)]);
  const comPrecos = tabelas.map((tabela) => ({ rotulo: rotuloDaTabela(tabela), precos: precosDa(tabela) }));
  const achados = itens
    .filter((item) => item.orcavel !== false)
    .filter((item) => bate(busca, item.item, item.servico, item.categoria, item.descricao))
    .map((item) => ({
      item: texto(item.item),
      servico: texto(item.servico) || undefined,
      unidade: texto(item.unidade) || undefined,
      categoria: texto(item.categoria) || undefined,
      precos: comPrecos.flatMap(({ rotulo, precos }) => {
        const preco = precoEmReais(precos[item.id]?.preco);
        return preco ? [{ tabela: rotulo, preco }] : [];
      }),
    }))
    .sort((a, b) => a.item.localeCompare(b.item) || (a.servico ?? "").localeCompare(b.servico ?? ""));
  return {
    dia,
    tabelas: tabelas.map((tabela) => ({
      tabela: rotuloDaTabela(tabela),
      vigente_de: texto(tabela.vigente_de) || undefined,
      vigente_ate: texto(tabela.vigente_ate) || undefined,
      do_cliente: tabela.customer_code !== null,
    })),
    encontrados: achados.length,
    itens: achados.slice(0, 30),
    observacao: tabelas.length ? undefined : "Nenhuma tabela de preço vale hoje para este cliente: o orçamento fica sem preço da tabela.",
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
    descricao:
      "Itens da LPU (lista de preços unitários) com o preço de cada tabela que vale hoje para o cliente (uma por variante e contrato), ou da Padrão Dutelog na variante em que ele não tem tabela.",
    modulo: "comercial",
    entrada: z.object({ texto: z.string().max(200).describe("Palavras do item ou do serviço, ex.: 'mesa montagem'") }),
    para: quemOrca,
    executar: ({ leitor, agora }, { texto: busca }) => lpu(leitor, busca, agora),
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
