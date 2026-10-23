import { Ban, CalendarClock, CalendarPlus, ClipboardList, IdCard, Truck, UserX, Wrench } from "lucide-react";

import type { ItemDoInicio, TomDoItem } from "../inicio-do-modulo";
import { formatarData, type ColaboradorDaLista, type VeiculoDaLista } from "./cadastro";
import { nomeDe, placaDe, quando, type DemandaParaAbrir, type OsDaFila } from "./fila";
import { prazoDaDemanda } from "./hoje";
import { ROTA_HOJE, hrefDaOs, hrefDoColaborador, hrefDoVeiculo } from "./navegacao";

/**
 * O "Precisa de você" do Início da Operação (docs/plataforma/plano-de-implantacao.md,
 * parte 2.6) e os números ao lado, só com o que a OS já grava: aberta,
 * agendada (data, hora, equipe e veículo) ou cancelada. Execução, revisão e
 * atraso entram com as partes da Fase 3 que criam esses estados. Sem preço.
 */

/** Quantos dias antes do vencimento a CNH entra no Início. A mesma janela da rotina diária (functions/operacao, rotina.ts). */
export const DIAS_PARA_A_CNH = 30;

/** Quantos dias antes da revisão preventiva o veículo entra no Início (parte 3.13b). A mesma janela da rotina diária. */
export const DIAS_PARA_A_REVISAO = 15;

/** A OS aberta da demanda direta entra no Início quando faltam até 24 horas para o prazo (ou ele passou). */
export const PRAZO_PERTO_MS = 24 * 60 * 60 * 1000;

export type EntradaDoInicio = {
  /** O dia de hoje em São Paulo, "AAAA-MM-DD" (hojeIso). */
  hoje: string;
  /** Agora: o prazo da demanda direta conta em horas. Sem ele, vale o começo do dia. */
  agora?: Date;
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
    const veiculosParados = agenda.veiculos.filter((id) => !veiculos.get(id)?.ativo);
    const semVeiculo = veiculosParados.length > 0;
    if (!semPessoa.length && !semVeiculo) return [];
    const oQue = semPessoa.length && semVeiculo
      ? "pessoa e veículo desativados"
      : semVeiculo
        ? "veículo desativado"
        : semPessoa.length === 1
          ? "pessoa desativada"
          : `${semPessoa.length} pessoas desativadas`;
    const quem = [...semPessoa.map((id) => nomeDe(id, nomes)), ...veiculosParados.map((id) => placaDe(id, placas))];
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

function agoraDe(entrada: EntradaDoInicio): Date {
  return entrada.agora ?? new Date(`${entrada.hoje}T00:00:00-03:00`);
}

/** A OS aberta da demanda direta com o prazo em até 24 horas (ou passado): sem agenda, é urgente. */
function abertaPertoDoPrazo(os: OsDaFila, agora: Date): boolean {
  return os.status === "aberta" && Boolean(os.prazo) && Date.parse(os.prazo!) - agora.getTime() <= PRAZO_PERTO_MS;
}

function amanha(hoje: string): string {
  return new Date(Date.parse(`${hoje}T12:00:00Z`) + UM_DIA_MS).toISOString().slice(0, 10);
}

/**
 * A OS perto do prazo sem quem ou sem o que a faça (parte 3.13b): a agendada
 * para hoje ou amanhã sem equipe, ou com transporte e sem veículo; e a aberta
 * da demanda direta com o prazo em até 24 horas, ainda sem agenda.
 */
function itensDeOsDesfalcada(entrada: EntradaDoInicio): ItemDoInicio[] {
  const agora = agoraDe(entrada);
  const ate = amanha(entrada.hoje);
  return porNumero(ativas(entrada.ordens)).flatMap((os): ItemDoInicio[] => {
    const cliente = nomeDe(os.customer_code, entrada.nomesClientes);
    if (abertaPertoDoPrazo(os, agora)) {
      const prazo = prazoDaDemanda(os.prazo ?? null, agora);
      return [
        {
          id: `os-sem-agenda:${os.numero}`,
          tone: "critical",
          icon: CalendarClock,
          title: `OS ${os.numero} sem agenda`,
          detail: [cliente, prazo ? [prazo.texto, prazo.falta].filter(Boolean).join(" · ") : null].filter(Boolean).join(" · "),
          href: hrefDaOs(os.numero),
          actionLabel: "Escalar",
        },
      ];
    }
    const agenda = os.agenda;
    if (os.status !== "agendada" || !agenda || agenda.data < entrada.hoje || agenda.data > ate) return [];
    const semEquipe = agenda.equipe.length === 0;
    const semVeiculo = (os.servicos ?? []).includes("transporte") && agenda.veiculos.length === 0;
    if (!semEquipe && !semVeiculo) return [];
    const falta = semEquipe && semVeiculo ? "sem equipe e sem veículo" : semEquipe ? "sem equipe" : "sem veículo";
    return [
      {
        id: `os-desfalcada:${os.numero}`,
        tone: agenda.data === entrada.hoje ? "critical" : "attention",
        icon: semEquipe ? UserX : Truck,
        title: `OS ${os.numero} ${falta}`,
        detail: [cliente, quando(agenda)].join(" · "),
        href: hrefDaOs(os.numero),
        actionLabel: "Escalar",
      },
    ];
  });
}

function itemDeParaAgendar(entrada: EntradaDoInicio): ItemDoInicio[] {
  const agora = agoraDe(entrada);
  // A aberta perto do prazo já tem o item dela (itensDeOsDesfalcada).
  const abertas = porNumero(ativas(entrada.ordens).filter((os) => os.status === "aberta" && !abertaPertoDoPrazo(os, agora)));
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

/**
 * A revisão preventiva do veículo ativo em até DIAS_PARA_A_REVISAO dias, ou
 * com a data já passada (parte 3.13b). No dia da revisão o veículo está na
 * oficina: a OS agendada com ele nesse dia precisa trocar de veículo.
 */
function itensDeRevisao(entrada: EntradaDoInicio): ItemDoInicio[] {
  const agendadas = ativas(entrada.ordens).filter((os) => os.status === "agendada" && os.agenda && os.agenda.data >= entrada.hoje);
  return entrada.veiculos
    .flatMap((veiculo) => {
      if (!veiculo.ativo || !/^\d{4}-\d{2}-\d{2}$/.test(veiculo.revisaoEm)) return [];
      const dias = diasAte(entrada.hoje, veiculo.revisaoEm);
      if (dias > DIAS_PARA_A_REVISAO) return [];
      const noDia = porNumero(agendadas.filter((os) => os.agenda!.data === veiculo.revisaoEm && os.agenda!.veiculos.includes(veiculo.id)));
      const data = formatarData(veiculo.revisaoEm);
      const title = dias < 0 ? `Revisão do ${veiculo.placa} passou em ${data}` : dias === 0 ? `Revisão do ${veiculo.placa} é hoje` : `Revisão do ${veiculo.placa} em ${plural(dias, "dia", "dias")}`;
      const conflito = noDia.length ? `${noDia.length === 1 ? "na OS" : "nas OS"} ${noDia.map((os) => os.numero).join(", ")} no dia` : null;
      return [
        {
          dias,
          item: {
            id: `revisao:${veiculo.id}`,
            tone: noDia.length || dias === 0 ? "critical" : "attention",
            icon: Wrench,
            title,
            detail: [veiculo.tipo || null, `revisão preventiva ${data}`, conflito].filter(Boolean).join(" · "),
            href: noDia.length === 1 ? hrefDaOs(noDia[0].numero) : hrefDoVeiculo(veiculo.id),
            actionLabel: noDia.length === 1 ? "Reagendar" : "Ver cadastro",
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
 * desativado, OS perto do prazo sem equipe ou veículo, OS para agendar,
 * demandas para planejar, CNH e revisão do veículo.
 */
export function pendenciasDaOperacao(entrada: EntradaDoInicio): ItemDoInicio[] {
  const itens = [
    ...itensDeDemandaFora(entrada),
    ...itensDeCadastroInativo(entrada),
    ...itensDeOsDesfalcada(entrada),
    ...itemDeParaAgendar(entrada),
    ...itemDePlanejar(entrada),
    ...itensDeCnh(entrada),
    ...itensDeRevisao(entrada),
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
