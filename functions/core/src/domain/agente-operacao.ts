import { z } from "zod";

import type { EscopoDoAgente } from "./agente-escopo.js";
import { bate, ferramenta, instante, numero, texto, type FerramentaDoAgente } from "./agente-ferramentas.js";
import type { LeitorDoAgente, RegistroLido } from "./agente-leitor.js";
import { diaEmSaoPaulo } from "./parados.js";
import { PLANEJAMENTO_ROLES } from "./platform-roles.js";
import { MINIMO_DO_CLIENTE, MINIMO_GERAL, PLANO_OTIMISTA_PCT } from "./sugestao.js";

/**
 * As ferramentas da Operação no Agent Dute do núcleo (parte 5.5d): as
 * demandas, a agenda das OS e o detalhe de cada uma, e o tempo dos itens da
 * memória (parte 5.1). Nada aqui tem valor: a demanda e a OS não guardam
 * preço, e a Operação nunca vê valores.
 *
 * A equipe e o veículo saem da cópia que a OS guarda, nunca do cadastro de
 * colaboradores (que tem CPF). O cliente vê as demandas dele a partir do
 * envio da proposta; o que ainda está em montagem na Dutelog fica de fora.
 */

const ROTULO_DA_ETAPA: Record<string, string> = {
  em_montagem: "Em montagem",
  para_aprovar: "Para aprovar",
  para_enviar: "Para enviar",
  aguardando_cliente: "Aguardando o cliente",
  para_planejar: "Para planejar",
  execucao_a_orcar: "Execução a orçar",
  aguardando_autorizacao: "Aguardando autorização",
  a_faturar: "A faturar",
  faturada: "Faturada",
  paga: "Paga",
  perdida: "Perdida",
  cancelada: "Cancelada",
};

/** As etapas internas da proposta, antes de ir ao cliente: o cliente não as vê. */
export const ETAPAS_SO_DA_EQUIPE = ["em_montagem", "para_aprovar", "para_enviar"];
const ETAPAS_ENCERRADAS = ["faturada", "paga", "perdida", "cancelada"];

const ROTULO_DA_OS: Record<string, string> = {
  aberta: "A agendar",
  agendada: "Agendada",
  em_execucao: "Em execução",
  em_revisao: "Concluída, em revisão",
  revisada: "Concluída",
  cancelada: "Cancelada",
};

function etapaDa(demanda: RegistroLido): string {
  return texto(demanda.etapa);
}

function visivel(demanda: RegistroLido, escopo: EscopoDoAgente): boolean {
  return escopo.audiencia === "equipe" || !ETAPAS_SO_DA_EQUIPE.includes(etapaDa(demanda));
}

function registro(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

function lista(valor: unknown): Array<Record<string, unknown>> {
  return Array.isArray(valor) ? valor.map(registro) : [];
}

function demandaLida(demanda: RegistroLido) {
  const execucao = registro(demanda.execucao);
  const faturamento = registro(demanda.faturamento);
  const nf = registro(faturamento.nf);
  return {
    numero: texto(demanda.numero) || demanda.id,
    titulo: texto(demanda.titulo) || undefined,
    ref_cliente: texto(demanda.ref_cliente) || undefined,
    etapa: ROTULO_DA_ETAPA[etapaDa(demanda)] ?? etapaDa(demanda),
    recebida_em: instante(demanda.recebida_em),
    execucao: execucao.a_definir === true ? "a definir" : [texto(execucao.de), texto(execucao.ate)].filter(Boolean).join(" a ") || undefined,
    os: Array.isArray(demanda.os_numeros) ? demanda.os_numeros.map(texto).filter(Boolean) : [],
    nf: texto(nf.numero) || undefined,
  };
}

export async function demandas(leitor: LeitorDoAgente, escopo: EscopoDoAgente, entrada: { situacao?: "abertas" | "todas"; texto?: string; limite?: number }) {
  const limite = Math.min(Math.max(entrada.limite ?? 15, 1), 40);
  const lidas = (await leitor.doCliente("demands", { ordem: [["updated_at", "desc"]], limite: 150 }))
    .filter((demanda) => visivel(demanda, escopo))
    .filter((demanda) => (entrada.situacao ?? "abertas") === "todas" || !ETAPAS_ENCERRADAS.includes(etapaDa(demanda)))
    .filter((demanda) => bate(entrada.texto, demanda.numero, demanda.titulo, demanda.ref_cliente))
    .map(demandaLida);
  return { encontradas: lidas.length, demandas: lidas.slice(0, limite) };
}

function osResumida(os: RegistroLido) {
  const janela = registro(os.janela);
  return {
    numero: texto(os.numero) || os.id,
    tipo: texto(os.tipo) === "vistoria" ? "vistoria" : "serviço",
    situacao: ROTULO_DA_OS[texto(os.status)] ?? texto(os.status),
    dia: texto(janela.data) || undefined,
    horario: [texto(janela.inicio), texto(janela.fim)].filter(Boolean).join("–") || undefined,
    servicos: Array.isArray(os.servicos) ? os.servicos.map(texto).filter(Boolean) : [],
  };
}

/** A equipe e o veículo da OS, da cópia que ela guarda: só para a equipe Dutelog. */
function equipeDaOs(os: RegistroLido) {
  return {
    equipe: lista(os.equipe).map((pessoa) => ({ nome: texto(pessoa.nome) || undefined, papel: texto(pessoa.papel) || undefined })),
    veiculos: lista(os.veiculos).map((veiculo) => ({ placa: texto(veiculo.placa) || undefined, tipo: texto(veiculo.tipo) || undefined })),
  };
}

export async function verDemanda(leitor: LeitorDoAgente, escopo: EscopoDoAgente, numeroDaDemanda: string) {
  const demanda = await leitor.documento("demands", numeroDaDemanda);
  if (!demanda || !visivel(demanda, escopo)) return { encontrada: false };
  const ordens = await leitor.doCliente("service_orders", { onde: [["demanda", "==", demanda.id]], limite: 50 });
  return {
    encontrada: true,
    demanda: demandaLida(demanda),
    escopo: lista(demanda.escopo).slice(0, 60).map((linha) => ({ item: texto(linha.item), unidade: texto(linha.unidade) || undefined, quantidade: texto(linha.quantidade) || undefined })),
    ordens: ordens.map(osResumida).sort((a, b) => a.numero.localeCompare(b.numero)),
  };
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function somarDias(dia: string, dias: number): string {
  return new Date(Date.parse(`${dia}T12:00:00.000Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

export async function agenda(leitor: LeitorDoAgente, escopo: EscopoDoAgente, agora: Date, entrada: { de?: string; ate?: string }) {
  const hoje = diaEmSaoPaulo(agora.toISOString()) ?? agora.toISOString().slice(0, 10);
  const de = entrada.de ?? hoje;
  const ate = entrada.ate ?? somarDias(de, 7);
  if (!DIA.test(de) || !DIA.test(ate) || ate < de) return { erro: "Período inválido. Use datas no formato AAAA-MM-DD, com início antes do fim." };
  if (somarDias(de, 31) < ate) return { erro: "Período longo demais. Consulte até 31 dias por vez." };
  const ordens = await leitor.doCliente("service_orders", {
    onde: [
      ["janela.data", ">=", de],
      ["janela.data", "<=", ate],
    ],
    ordem: [["janela.data", "asc"]],
    limite: 300,
  });
  const linhas = ordens
    .filter((os) => texto(os.status) !== "cancelada")
    .map((os) => ({ ...osResumida(os), demanda: texto(os.demanda) || undefined, ...(escopo.audiencia === "equipe" ? equipeDaOs(os) : {}) }))
    .sort((a, b) => (a.dia ?? "").localeCompare(b.dia ?? "") || (a.horario ?? "").localeCompare(b.horario ?? "") || a.numero.localeCompare(b.numero));
  return { periodo: { de, ate }, ordens: linhas.length, agenda: linhas.slice(0, 60), observacao: linhas.length > 60 ? `Mostrando 60 de ${linhas.length} OS.` : undefined };
}

export async function verOs(leitor: LeitorDoAgente, escopo: EscopoDoAgente, numeroDaOs: string) {
  const os = await leitor.documento("service_orders", numeroDaOs);
  if (!os) return { encontrada: false };
  const conclusao = registro(os.conclusao);
  const revisao = registro(os.revisao);
  return {
    encontrada: true,
    os: { ...osResumida(os), demanda: texto(os.demanda) || undefined },
    itens: lista(os.itens)
      .slice(0, 60)
      .map((item) => ({ item: texto(item.item), unidade: texto(item.unidade) || undefined, planejado: texto(item.planejado) || undefined, executado: texto(item.executado) || undefined })),
    etapas: lista(os.etapas).map((etapa) => ({ etapa: texto(etapa.etapa), quando: instante(etapa.instante) })),
    concluida: Object.keys(conclusao).length
      ? { quando: instante(conclusao.instante), aceite: texto(conclusao.aceite) || undefined, responsavel: texto(registro(conclusao.responsavel).nome) || texto(conclusao.responsavel) || undefined }
      : undefined,
    ...(escopo.audiencia === "equipe"
      ? {
          ...equipeDaOs(os),
          revisao: Object.keys(revisao).length ? { minutos_planejados: numero(revisao.minutos_planejados) || undefined, minutos_reais: numero(revisao.minutos_reais) || undefined, pessoas: numero(revisao.pessoas) || undefined } : undefined,
        }
      : {}),
  };
}

/**
 * O tempo dos itens na memória (parte 5.1), com a mesma base da duração
 * sugerida: a medida do cliente com 5 execuções; sem ela, a geral com 15;
 * abaixo disso, sem base. A medida geral não mostra as OS de origem, que
 * são de outros clientes.
 */
export async function tempoDosItens(leitor: LeitorDoAgente, busca: string) {
  const [doCliente, gerais, planejamento] = await Promise.all([
    leitor.doCliente("ai_measures", { onde: [["tipo", "==", "duracao_item"]], limite: 1000 }),
    leitor.geral("ai_measures", { onde: [["tipo", "==", "duracao_item"]], limite: 2000 }),
    leitor.doCliente("ai_measures", { onde: [["tipo", "==", "erro_planejamento"]], limite: 1 }),
  ]);
  const porItem = new Map<string, { item: string; unidade?: string; cliente?: RegistroLido; geral?: RegistroLido }>();
  for (const [base, medidas] of [
    ["cliente", doCliente],
    ["geral", gerais],
  ] as const) {
    for (const medida of medidas) {
      const chave = texto(medida.lpu_item_id);
      if (!chave || !bate(busca, medida.item, medida.unidade)) continue;
      const linha = porItem.get(chave) ?? { item: texto(medida.item), unidade: texto(medida.unidade) || undefined };
      linha[base] = medida;
      porItem.set(chave, linha);
    }
  }
  const itens = [...porItem.values()].map((linha) => {
    if (linha.cliente && numero(linha.cliente.execucoes) >= MINIMO_DO_CLIENTE) {
      return { item: linha.item, unidade: linha.unidade, homem_minuto_por_unidade: numero(linha.cliente.homem_minuto_por_unidade), base: "deste cliente", execucoes: numero(linha.cliente.execucoes), os_de_origem: Array.isArray(linha.cliente.os_recentes) ? linha.cliente.os_recentes.slice(0, 5) : [] };
    }
    if (linha.geral && numero(linha.geral.execucoes) >= MINIMO_GERAL) {
      return { item: linha.item, unidade: linha.unidade, homem_minuto_por_unidade: numero(linha.geral.homem_minuto_por_unidade), base: "média de todos os clientes", execucoes: numero(linha.geral.execucoes) };
    }
    return { item: linha.item, unidade: linha.unidade, base: "ainda sem base", execucoes: Math.max(numero(linha.cliente?.execucoes), numero(linha.geral?.execucoes)) };
  });
  const erro = planejamento[0];
  const erroPct = erro ? numero(erro.erro_medio_pct) : null;
  return {
    regra: `A base é a medida do cliente com ${MINIMO_DO_CLIENTE} execuções do item; sem ela, a média de todos os clientes com ${MINIMO_GERAL}. O tempo é em homem-minuto: 2 pessoas fazem na metade do tempo de 1. Não inclui o deslocamento.`,
    itens: itens.sort((a, b) => a.item.localeCompare(b.item)).slice(0, 30),
    plano: erro
      ? {
          erro_medio_pct: erroPct,
          os_revisadas: numero(erro.execucoes),
          aviso: erroPct !== null && erroPct >= PLANO_OTIMISTA_PCT ? "Os planos deste cliente costumam ser otimistas: as OS levam mais que o planejado." : undefined,
        }
      : undefined,
    observacao: itens.length ? undefined : "Nenhum item com essas palavras na memória ainda.",
  };
}

// --- O registro -------------------------------------------------------------------------------

const todos = () => true;
const quemPlaneja = (escopo: EscopoDoAgente) => (PLANEJAMENTO_ROLES as readonly string[]).includes(escopo.role);

export const FERRAMENTAS_DA_OPERACAO: readonly FerramentaDoAgente[] = [
  ferramenta({
    nome: "demandas",
    descricao: "Demandas de serviço do cliente (mudança, montagem, transporte), com a etapa, a execução prevista e as OS. Padrão: as abertas.",
    modulo: "operacao",
    entrada: z.object({
      situacao: z.enum(["abertas", "todas"]).optional(),
      texto: z.string().max(200).optional().describe("Número, título ou referência do cliente"),
      limite: z.number().int().min(1).max(40).optional(),
    }),
    para: todos,
    executar: ({ leitor, escopo }, entrada) => demandas(leitor, escopo, entrada),
  }),
  ferramenta({
    nome: "ver_demanda",
    descricao: "Detalhe de uma demanda: a etapa, o escopo fechado (itens e quantidades) e as OS com a situação de cada uma.",
    modulo: "operacao",
    entrada: z.object({ numero: z.string().max(20).describe("Número da demanda, ex.: '10050'") }),
    para: todos,
    executar: ({ leitor, escopo }, { numero: alvo }) => verDemanda(leitor, escopo, alvo),
  }),
  ferramenta({
    nome: "agenda",
    descricao: "As OS do cliente num período (padrão: hoje e os próximos 7 dias, até 31 dias), com o dia, o horário, a situação e os serviços. Para a equipe Dutelog, também a equipe e o veículo.",
    modulo: "operacao",
    entrada: z.object({
      de: z.string().max(10).optional().describe("Data inicial AAAA-MM-DD"),
      ate: z.string().max(10).optional().describe("Data final AAAA-MM-DD, inclusive"),
    }),
    para: todos,
    executar: ({ leitor, escopo, agora }, entrada) => agenda(leitor, escopo, agora, entrada),
  }),
  ferramenta({
    nome: "ver_os",
    descricao: "Detalhe de uma OS: a situação, o dia, os itens planejados e executados, as etapas registradas e a conclusão. Para a equipe Dutelog, também a equipe, o veículo e a revisão.",
    modulo: "operacao",
    entrada: z.object({ numero: z.string().max(20).describe("Número da OS, ex.: '10050-01'") }),
    para: todos,
    executar: ({ leitor, escopo }, { numero: alvo }) => verOs(leitor, escopo, alvo),
  }),
  ferramenta({
    nome: "tempo_dos_itens",
    descricao: "Quanto tempo cada item da LPU costuma levar (homem-minuto por unidade), pela memória das OS revisadas, com a base de onde saiu; e se os planos deste cliente costumam ser otimistas.",
    modulo: "operacao",
    entrada: z.object({ texto: z.string().max(200).describe("Palavras do item, ex.: 'mesa', 'armário', 'montagem'") }),
    para: quemPlaneja,
    executar: ({ leitor }, { texto: busca }) => tempoDosItens(leitor, busca),
  }),
];
