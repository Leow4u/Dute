import { Ban, CalendarPlus, ClipboardList, IdCard, Truck, UserX } from "lucide-react";

import type { ItemDoInicio, TomDoItem } from "../inicio-do-modulo";
import { formatarData, type ColaboradorDaLista, type VeiculoDaLista } from "./cadastro";
import { nomeDe, placaDe, quando, type DemandaParaAbrir, type OsDaFila } from "./fila";
import { ROTA_HOJE, hrefDaOs, hrefDoColaborador } from "./navegacao";

/**
 * O "Precisa de você" do Início da Operação (docs/plataforma/plano-de-implantacao.md,
 * parte 2.6) e os números ao lado, só com o que a OS já grava: aberta,
 * agendada (data, hora, equipe e veículo) ou cancelada. Execução, revisão e
 * atraso entram com as partes da Fase 3 que criam esses estados. Sem preço.
 */

/** Quantos dias antes do vencimento a CNH entra no Início. */
export const DIAS_PARA_A_CNH = 30;

export type EntradaDoInicio = {
  /** O dia de hoje em São Paulo, "AAAA-MM-DD" (hojeIso). */
  hoje: string;
  /** As OS abertas e agendadas, com a demanda perdida ou cancelada marcada (comDemanda). */
  ordens: readonly OsDaFila[];
  /** As demandas em Para planejar (demandaDaFila → paraAbrir). */
  demandas: readonly DemandaParaAbrir[];
  pessoas: readonly ColaboradorDaLista[];
  veiculos: readonly VeiculoDaLista[];
  nomesClientes: Readonly<Record<string, string>>;
};

const UM_DIA_MS = 86_400_000;

/** Dias corridos de `de` até `ate` ("AAAA-MM-DD"); negativo quando `ate` já passou. */
export function diasAte(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / UM_DIA_MS);
}

function plural(quantos: number, singular: string, pluralForm: string) {
  return `${quantos} ${quantos === 1 ? singular : pluralForm}`;
}

function previa(valores: readonly string[], max = 2): string {
  const mostrados = valores.slice(0, max).join(" · ");
  return valores.length > max ? `${mostrados} e mais ${valores.length - max}` : mostrados;
}

function ativas(ordens: readonly OsDaFila[]): OsDaFila[] {
  return ordens.filter((os) => (os.status === "aberta" || os.status === "agendada") && !os.demandaFora);
}

function porNumero<T extends { numero: string }>(itens: readonly T[]): T[] {
  return [...itens].sort((a, b) => a.numero.localeCompare(b.numero, "pt-BR"));
}

/** A OS aberta ou agendada cuja demanda o Comercial perdeu ou cancelou: só se cancela. */
function itensDeDemandaFora(entrada: EntradaDoInicio): ItemDoInicio[] {
  return porNumero(entrada.ordens.filter((os) => os.status !== "cancelada" && os.demandaFora)).map((os) => ({
    id: `os-fora:${os.numero}`,
    tone: "critical",
    icon: Ban,
    title: `OS ${os.numero} de demanda ${os.demandaFora === "perdida" ? "perdida" : "cancelada"}`,
    detail: [nomeDe(os.customer_code, entrada.nomesClientes), os.agenda ? quando(os.agenda) : null].filter(Boolean).join(" · "),
    href: hrefDaOs(os.numero),
    actionLabel: "Cancelar OS",
  }));
}

/**
 * A OS agendada para hoje ou depois com alguém da equipe ou o veículo
 * desativado no cadastro (ou fora dele): a escala precisa ser refeita.
 */
function itensDeCadastroInativo(entrada: EntradaDoInicio): ItemDoInicio[] {
  const pessoas = new Map(entrada.pessoas.map((pessoa) => [pessoa.id, pessoa]));
  const veiculos = new Map(entrada.veiculos.map((veiculo) => [veiculo.id, veiculo]));
  const nomes = Object.fromEntries(entrada.pessoas.map((pessoa) => [pessoa.id, pessoa.nome]));
  const placas = Object.fromEntries(entrada.veiculos.map((veiculo) => [veiculo.id, veiculo.placa]));
  return porNumero(ativas(entrada.ordens)).flatMap((os) => {
    const agenda = os.agenda;
    if (os.status !== "agendada" || !agenda || agenda.data < entrada.hoje) return [];
    const semPessoa = agenda.equipe.filter((id) => !pessoas.get(id)?.ativo);
    const semVeiculo = !veiculos.get(agenda.veiculo_id)?.ativo;
    if (!semPessoa.length && !semVeiculo) return [];
    const oQue = semPessoa.length && semVeiculo
      ? "pessoa e veículo desativados"
      : semVeiculo
        ? "veículo desativado"
        : semPessoa.length === 1
          ? "pessoa desativada"
          : `${semPessoa.length} pessoas desativadas`;
    const quem = [...semPessoa.map((id) => nomeDe(id, nomes)), ...(semVeiculo ? [placaDe(agenda.veiculo_id, placas)] : [])];
    const tone: TomDoItem = agenda.data === entrada.hoje ? "critical" : "attention";
    return [
      {
        id: `os-cadastro:${os.numero}`,
        tone,
        icon: semPessoa.length ? UserX : Truck,
        title: `OS ${os.numero} com ${oQue}`,
        detail: [nomeDe(os.customer_code, entrada.nomesClientes), quando(agenda), quem.join(", ")].join(" · "),
        href: hrefDaOs(os.numero),
        actionLabel: "Reagendar",
      } satisfies ItemDoInicio,
    ];
  });
}

function itemDeParaAgendar(entrada: EntradaDoInicio): ItemDoInicio[] {
  const abertas = porNumero(ativas(entrada.ordens).filter((os) => os.status === "aberta"));
  if (!abertas.length) return [];
  return [
    {
      id: "os-para-agendar",
      tone: "attention",
      icon: CalendarPlus,
      title: `${abertas.length} OS para agendar`,
      detail: previa(abertas.map((os) => `${os.numero} · ${nomeDe(os.customer_code, entrada.nomesClientes)}`)),
      href: abertas.length === 1 ? hrefDaOs(abertas[0].numero) : ROTA_HOJE,
      actionLabel: "Agendar",
    },
  ];
}

/** Demandas em Para planejar que ainda não viraram OS. */
function itemDePlanejar(entrada: EntradaDoInicio): ItemDoInicio[] {
  const semOs = porNumero(entrada.demandas.filter((demanda) => demanda.os_numeros.length === 0));
  if (!semOs.length) return [];
  return [
    {
      id: "demandas-para-planejar",
      tone: "attention",
      icon: ClipboardList,
      title: `${plural(semOs.length, "demanda", "demandas")} para planejar`,
      detail: previa(semOs.map((demanda) => `${demanda.numero} · ${nomeDe(demanda.customer_code, entrada.nomesClientes)}`)),
      href: ROTA_HOJE,
      actionLabel: "Abrir OS",
    },
  ];
}

/** CNH vencida ou vencendo em até DIAS_PARA_A_CNH dias, de quem está ativo. */
function itensDeCnh(entrada: EntradaDoInicio): ItemDoInicio[] {
  const agendadas = ativas(entrada.ordens).filter((os) => os.status === "agendada" && os.agenda && os.agenda.data >= entrada.hoje);
  return entrada.pessoas
    .flatMap((pessoa) => {
      if (!pessoa.ativo || !/^\d{4}-\d{2}-\d{2}$/.test(pessoa.cnhValidade)) return [];
      const dias = diasAte(entrada.hoje, pessoa.cnhValidade);
      if (dias > DIAS_PARA_A_CNH) return [];
      const vencida = dias < 0;
      // Vencida: toda OS de hoje em diante. Vencendo: as OS até a validade.
      const escalas = agendadas.filter(
        (os) => os.agenda!.equipe.includes(pessoa.id) && (vencida || os.agenda!.data <= pessoa.cnhValidade),
      ).length;
      const validade = formatarData(pessoa.cnhValidade);
      const title = vencida
        ? `CNH de ${pessoa.nome} vencida em ${validade}`
        : dias === 0
          ? `CNH de ${pessoa.nome} vence hoje`
          : `CNH de ${pessoa.nome} vence em ${plural(dias, "dia", "dias")}`;
      const escalado = escalas ? `escalado em ${plural(escalas, "OS", "OS")}${vencida ? "" : " até lá"}` : null;
      return [
        {
          dias,
          item: {
            id: `cnh:${pessoa.id}`,
            tone: vencida ? "critical" : "attention",
            icon: IdCard,
            title,
            detail: [pessoa.cnhCategoria ? `Categoria ${pessoa.cnhCategoria}` : null, `validade ${validade}`, escalado].filter(Boolean).join(" · "),
            href: hrefDoColaborador(pessoa.id),
            actionLabel: "Ver cadastro",
          } satisfies ItemDoInicio,
        },
      ];
    })
    .sort((a, b) => a.dias - b.dias || a.item.title.localeCompare(b.item.title, "pt-BR"))
    .map(({ item }) => item);
}

const PESO_DO_TOM: Record<TomDoItem, number> = { critical: 0, attention: 1, info: 2, agent: 3 };

/**
 * As pendências da Operação, o mais urgente primeiro (crítico, atenção). No
 * mesmo tom, a ordem das fontes: OS de demanda que saiu, OS com cadastro
 * desativado, OS para agendar, demandas para planejar e CNH.
 */
export function pendenciasDaOperacao(entrada: EntradaDoInicio): ItemDoInicio[] {
  const itens = [
    ...itensDeDemandaFora(entrada),
    ...itensDeCadastroInativo(entrada),
    ...itemDeParaAgendar(entrada),
    ...itemDePlanejar(entrada),
    ...itensDeCnh(entrada),
  ];
  // Array.prototype.sort é estável: no mesmo tom, fica a ordem das fontes.
  return itens.sort((a, b) => PESO_DO_TOM[a.tone] - PESO_DO_TOM[b.tone]);
}

export type HojeNaOperacao = { agendadasHoje: number; paraAgendar: number; proximosDias: number };

/** Os números do dia: agendadas para hoje, abertas para agendar e agendadas para os próximos dias. */
export function hojeNaOperacao(entrada: Pick<EntradaDoInicio, "hoje" | "ordens">): HojeNaOperacao {
  const lista = ativas(entrada.ordens);
  return {
    agendadasHoje: lista.filter((os) => os.status === "agendada" && os.agenda?.data === entrada.hoje).length,
    paraAgendar: lista.filter((os) => os.status === "aberta").length,
    proximosDias: lista.filter((os) => os.status === "agendada" && (os.agenda?.data ?? "") > entrada.hoje).length,
  };
}

export type PessoaDeHoje = {
  id: string;
  nome: string;
  iniciais: string;
  /** A primeira OS de hoje ("10045-01 · 14:00", "+1" se houver mais), ou null quando livre. */
  escala: string | null;
};

export function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1][0] ?? "") : "";
  return `${primeira}${ultima}`.toLocaleUpperCase("pt-BR");
}

/**
 * Quem está ativo e a escala de hoje: primeiro quem está escalado, pela hora
 * da primeira OS (sem hora por último), depois quem está livre, por nome.
 */
export function equipeDeHoje(entrada: Pick<EntradaDoInicio, "hoje" | "ordens" | "pessoas">): PessoaDeHoje[] {
  const deHoje = ativas(entrada.ordens)
    .filter((os) => os.status === "agendada" && os.agenda?.data === entrada.hoje)
    .sort((a, b) => (a.agenda!.hora ?? "99:99").localeCompare(b.agenda!.hora ?? "99:99") || a.numero.localeCompare(b.numero, "pt-BR"));
  const linhas = entrada.pessoas
    .filter((pessoa) => pessoa.ativo)
    .map((pessoa) => {
      const minhas = deHoje.filter((os) => os.agenda!.equipe.includes(pessoa.id));
      const primeira = minhas[0];
      const escala = primeira
        ? [primeira.numero, primeira.agenda!.hora].filter(Boolean).join(" · ") + (minhas.length > 1 ? ` +${minhas.length - 1}` : "")
        : null;
      return { pessoa, hora: primeira ? (primeira.agenda!.hora ?? "99:99") : null, linha: { id: pessoa.id, nome: pessoa.nome, iniciais: iniciaisDe(pessoa.nome), escala } };
    });
  return linhas
    .sort((a, b) => {
      if ((a.hora === null) !== (b.hora === null)) return a.hora === null ? 1 : -1;
      return (a.hora ?? "").localeCompare(b.hora ?? "") || a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR");
    })
    .map(({ linha }) => linha);
}
