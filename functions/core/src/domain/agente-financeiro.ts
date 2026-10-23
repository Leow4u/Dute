import { z } from "zod";

import { emReais } from "./agente-comercial.js";
import type { EscopoDoAgente } from "./agente-escopo.js";
import { ferramenta, instante, normalizado, numero, texto, type FerramentaDoAgente } from "./agente-ferramentas.js";
import type { LeitorDoAgente, RegistroLido } from "./agente-leitor.js";
import { diaEmSaoPaulo, diasCorridos } from "./parados.js";

/**
 * As ferramentas do Financeiro no Agent Dute do núcleo (parte 5.5d): as
 * faturas do cliente, as da Armazenagem (`client_invoices`) e as da Operação
 * (`client_faturas`), e o a receber da equipe (`faturas`). Têm valor: o
 * cliente vê as dele, e da equipe só quem lê valor (owner, admin e
 * financeiro, os papéis do Financeiro). O leitor recusa as coleções com valor
 * para os outros.
 */

const ROTULO_DA_FATURA: Record<string, string> = { emitida: "Emitida", enviada: "Enviada", paga: "Paga", cancelada: "Cancelada" };

function registro(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

function faturaDaArmazenagem(fatura: RegistroLido) {
  const paga = normalizado(fatura.status) === "pago" || normalizado(fatura.payment_status) === "paid";
  return {
    competencia: texto(fatura.competencia),
    situacao: paga ? "Paga" : "Emitida",
    total: emReais(fatura.total_cents) ?? emReais(Math.round(numero(fatura.total) * 100)),
    emitida_em: instante(fatura.emitido_em),
    paga_em: instante(fatura.pago_em),
  };
}

function faturaDaOperacao(fatura: RegistroLido) {
  const nf = registro(fatura.nf);
  return {
    nf: [texto(nf.numero), texto(nf.serie)].filter(Boolean).join(" série ") || undefined,
    situacao: ROTULO_DA_FATURA[texto(fatura.status)] ?? texto(fatura.status),
    valor: emReais(fatura.valor_cents),
    recebido: numero(fatura.recebido_cents) ? emReais(fatura.recebido_cents) : undefined,
    saldo: emReais(fatura.saldo_cents),
    vencimento: texto(fatura.vencimento) || undefined,
    paga_em: instante(fatura.paga_em),
    demandas: (Array.isArray(fatura.demandas) ? fatura.demandas : []).map(registro).map((demanda) => ({ numero: texto(demanda.numero), titulo: texto(demanda.titulo) || undefined })),
  };
}

export async function faturas(leitor: LeitorDoAgente, escopo: EscopoDoAgente) {
  const [daArmazenagem, daOperacao] = await Promise.all([
    escopo.modulos.includes("wms") || escopo.audiencia === "equipe" ? leitor.doCliente("client_invoices", { ordem: [["competencia", "desc"]], limite: 12 }) : Promise.resolve([]),
    leitor.doCliente("client_faturas", { ordem: [["vencimento", "desc"]], limite: 24 }),
  ]);
  return {
    armazenagem: daArmazenagem.map(faturaDaArmazenagem),
    servicos: daOperacao.map(faturaDaOperacao),
    observacao: "A armazenagem fatura por mês; o mês sem fatura ainda está em andamento ou em fechamento pela Dutelog. Os serviços faturam por demanda, pela NF.",
  };
}

/** O que o cliente deve: as faturas emitidas e enviadas, com o saldo e os dias em atraso. */
export async function aReceber(leitor: LeitorDoAgente, agora: Date) {
  const hoje = diaEmSaoPaulo(agora.toISOString()) ?? agora.toISOString().slice(0, 10);
  const [abertas, armazenagem] = await Promise.all([
    leitor.doCliente("faturas", { onde: [["status", "in", ["emitida", "enviada"]]], limite: 200 }),
    leitor.doCliente("client_invoices", { ordem: [["competencia", "desc"]], limite: 12 }),
  ]);
  const linhas = abertas
    .map((fatura) => {
      const saldo = Math.max(0, numero(fatura.valor_cents) - numero(fatura.recebido_cents));
      const vencimento = texto(fatura.vencimento);
      const atraso = /^\d{4}-\d{2}-\d{2}$/.test(vencimento) && vencimento < hoje ? diasCorridos(vencimento, hoje) : 0;
      return { fatura: faturaDaOperacao({ ...fatura, saldo_cents: saldo }), saldo, atraso };
    })
    .filter((linha) => linha.saldo > 0)
    .sort((a, b) => b.atraso - a.atraso || (a.fatura.vencimento ?? "").localeCompare(b.fatura.vencimento ?? ""));
  const armazenagemEmAberto = armazenagem.filter((fatura) => !(normalizado(fatura.status) === "pago" || normalizado(fatura.payment_status) === "paid"));
  return {
    servicos: {
      em_aberto: emReais(linhas.reduce((soma, linha) => soma + linha.saldo, 0)),
      vencido: emReais(linhas.filter((linha) => linha.atraso > 0).reduce((soma, linha) => soma + linha.saldo, 0)),
      faturas: linhas.slice(0, 30).map((linha) => ({ ...linha.fatura, dias_em_atraso: linha.atraso || undefined })),
    },
    armazenagem_em_aberto: armazenagemEmAberto.map(faturaDaArmazenagem),
  };
}

// --- O registro -------------------------------------------------------------------------------

const quemLeValor = (escopo: EscopoDoAgente) => escopo.leValor;
const equipeQueLeValor = (escopo: EscopoDoAgente) => escopo.leValor && escopo.audiencia === "equipe";

export const FERRAMENTAS_DO_FINANCEIRO: readonly FerramentaDoAgente[] = [
  ferramenta({
    nome: "faturas",
    descricao: "Faturas do cliente: as mensais da armazenagem (competência, total, se está paga) e as dos serviços por NF (valor, vencimento, saldo e as demandas).",
    modulo: "financeiro",
    entrada: z.object({}),
    para: quemLeValor,
    executar: ({ leitor, escopo }) => faturas(leitor, escopo),
  }),
  ferramenta({
    nome: "a_receber",
    descricao: "O que o cliente ainda deve à Dutelog: as faturas de serviço emitidas e enviadas, com o saldo e os dias em atraso, e a armazenagem sem pagamento.",
    modulo: "financeiro",
    entrada: z.object({}),
    para: equipeQueLeValor,
    executar: ({ leitor, agora }) => aReceber(leitor, agora),
  }),
];
