import { conclusaoLida, type AceiteDaConclusao } from "./conclusao.js";
import { ETAPAS_DA_OS, ETAPAS_DA_VISTORIA, execucaoLida, type EtapaDaOs } from "./execucao.js";
import { osLida, type OsGravada, type ServicoDaOs, type TipoDaOs } from "./os.js";

/**
 * A TV da sala de operações (docs/plataforma/fase-3-operacao.md, parte 3.12;
 * docs/mockups/TVSala.dc.html): as OS do dia em três colunas, agendadas,
 * em execução e concluídas hoje.
 *
 * O papel `painel` não lê nenhuma coleção pelo navegador. A TV recebe só o
 * quadro montado aqui, campo a campo: cliente, serviço, o nome dos locais,
 * as horas, as etapas, os nomes da equipe e as placas. Nada de valor (a OS
 * não tem), contato, telefone, endereço, instruções, ocorrência, foto, CPF
 * ou documento de quem assinou. A callable só lê: a TV não tem ação.
 */

export const COLUNAS_DA_TV = ["agendada", "em_execucao", "concluida"] as const;
export type ColunaDaTv = (typeof COLUNAS_DA_TV)[number];

export type EtapaNaTv = { etapa: EtapaDaOs; instante: string };

export type OsNaTv = {
  numero: string;
  tipo: TipoDaOs;
  coluna: ColunaDaTv;
  cliente: string;
  servicos: ServicoDaOs[];
  /** "Agência Rebouças → Faria Lima": só o nome dos locais. */
  rota: string | null;
  /** A hora marcada para começar, em UTC; null sem hora. */
  inicio: string | null;
  /** Até quando: o prazo da demanda direta ou o fim da janela, em UTC; null sem prazo. */
  ate: string | null;
  /** A última etapa registrada. */
  etapa: EtapaNaTv | null;
  etapas: { feitas: number; previstas: number };
  /** Quando terminou (a etapa Fim), na concluída. */
  concluida_em: string | null;
  /** A OS de serviço concluída: com a assinatura do responsável ou sem aceite. */
  aceite: AceiteDaConclusao | null;
  /** Os nomes da equipe, na ordem da OS. */
  equipe: string[];
  placas: string[];
};

export type QuadroDaTv = { hoje: string; gerado_em: string; ordens: OsNaTv[] };

/** A demanda da OS, só no que a TV usa: o prazo pedido na demanda direta. */
export type DemandaNaTv = { executar_ate: string | null };

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/** O dia em São Paulo (AAAA-MM-DD). */
export function diaEmSaoPaulo(instante: Date): string {
  return DIA_EM_SAO_PAULO.format(instante);
}

/**
 * A data e a hora da janela, em São Paulo, como instante UTC. O Brasil não
 * tem horário de verão desde 2019: o fuso é sempre -03:00.
 */
export function instanteDaJanela(data: string, hora: string | null): string | null {
  if (!hora) return null;
  const instante = new Date(`${data}T${hora}:00-03:00`);
  return Number.isNaN(instante.getTime()) ? null : instante.toISOString();
}

/** O começo do dia em São Paulo, como instante. */
export function inicioDoDia(dia: string): Date {
  return new Date(`${dia}T00:00:00-03:00`);
}

const COM_TRANSPORTE: readonly EtapaDaOs[] = ["carregamento", "saida_origem", "chegada_destino"];

/**
 * As etapas que a OS percorre: a vistoria vai, chega e termina; o serviço
 * carrega e leva quando tem transporte e monta quando tem montagem. Etapa
 * registrada fora do previsto também conta (pular e incluir valem).
 */
export function etapasDaOs(os: Pick<OsGravada, "tipo" | "servicos">, registradas: readonly EtapaDaOs[]): EtapaDaOs[] {
  const previstas: readonly EtapaDaOs[] =
    os.tipo === "vistoria"
      ? ETAPAS_DA_VISTORIA
      : ETAPAS_DA_OS.filter((etapa) => {
          if (COM_TRANSPORTE.includes(etapa)) return os.servicos.includes("transporte");
          if (etapa === "montagem") return os.servicos.includes("montagem");
          return true;
        });
  return ETAPAS_DA_OS.filter((etapa) => previstas.includes(etapa) || registradas.includes(etapa));
}

function nomeDoLocal(local: OsGravada["locais"]["origem"]): string | null {
  const nome = local?.nome?.trim();
  return nome ? nome : null;
}

export function rotaDaOs(os: Pick<OsGravada, "locais">): string | null {
  const nomes = [nomeDoLocal(os.locais.origem), nomeDoLocal(os.locais.destino)].filter((nome): nome is string => Boolean(nome));
  if (nomes.length === 2 && nomes[0] === nomes[1]) return nomes[0];
  return nomes.length ? nomes.join(" → ") : null;
}

/**
 * Em que coluna a OS fica hoje, ou null quando a TV não a mostra: a
 * agendada para hoje (ou para um dia que já passou, sem ter começado), a em
 * execução e a que terminou hoje. A aberta sem data, a cancelada, a
 * agendada para outro dia e a concluída antes de hoje ficam fora.
 */
export function colunaDaOs(os: Pick<OsGravada, "status" | "janela">, concluidaEm: string | null, hoje: string): ColunaDaTv | null {
  switch (os.status) {
    case "agendada":
      return os.janela && os.janela.data <= hoje ? "agendada" : null;
    case "em_execucao":
      return "em_execucao";
    case "em_revisao":
    case "revisada":
      return concluidaEm && diaEmSaoPaulo(new Date(concluidaEm)) === hoje ? "concluida" : null;
    default:
      return null;
  }
}

/**
 * A OS como a TV a mostra, ou null quando não é do quadro de hoje (ou o
 * documento não se lê). Só os campos listados em OsNaTv saem daqui.
 */
export function osNaTv(numero: string, data: Record<string, unknown>, demanda: DemandaNaTv | null, hoje: string): OsNaTv | null {
  let os: OsGravada;
  try {
    os = osLida(numero, data);
  } catch {
    return null;
  }
  const etapas = execucaoLida(data).etapas;
  const fim = etapas.find((registro) => registro.etapa === "fim") ?? null;
  const coluna = colunaDaOs(os, fim?.instante ?? null, hoje);
  if (!coluna) return null;
  const registradas = [...new Set(etapas.map((registro) => registro.etapa))];
  const ultima = etapas.reduce<(typeof etapas)[number] | null>((mais, registro) => (!mais || registro.instante >= mais.instante ? registro : mais), null);
  const conclusao = coluna === "concluida" && os.tipo === "servico" ? conclusaoLida(data) : null;
  const prazo = demanda?.executar_ate && !Number.isNaN(Date.parse(demanda.executar_ate)) ? new Date(demanda.executar_ate).toISOString() : null;
  return {
    numero: os.numero,
    tipo: os.tipo,
    coluna,
    cliente: os.cliente_nome ?? os.customer_code,
    servicos: [...os.servicos],
    rota: rotaDaOs(os),
    inicio: os.janela ? instanteDaJanela(os.janela.data, os.janela.inicio) : null,
    ate: prazo ?? (os.janela ? instanteDaJanela(os.janela.data, os.janela.fim) : null),
    etapa: ultima ? { etapa: ultima.etapa, instante: new Date(ultima.instante).toISOString() } : null,
    etapas: { feitas: registradas.length, previstas: etapasDaOs(os, registradas).length },
    concluida_em: coluna === "concluida" && fim ? new Date(fim.instante).toISOString() : null,
    aceite: conclusao?.aceite ?? null,
    equipe: os.equipe.map((pessoa) => pessoa.nome).filter((nome) => nome.trim().length > 0),
    placas: os.veiculos.map((veiculo) => veiculo.placa).filter((placa) => placa.trim().length > 0),
  };
}

function horaDeOrdem(os: OsNaTv): string {
  if (os.coluna === "concluida") return os.concluida_em ?? "";
  return os.inicio ?? os.etapa?.instante ?? "9999";
}

/**
 * O quadro: as OS do dia, a agendada e a em execução pela hora marcada, a
 * concluída da mais recente para a mais antiga.
 */
export function quadroDaTv(
  documentos: ReadonlyArray<{ id: string; data: Record<string, unknown> }>,
  demandas: ReadonlyMap<string, DemandaNaTv>,
  agora: Date,
): QuadroDaTv {
  const hoje = diaEmSaoPaulo(agora);
  const vistos = new Set<string>();
  const ordens: OsNaTv[] = [];
  for (const documento of documentos) {
    if (vistos.has(documento.id)) continue;
    vistos.add(documento.id);
    const demanda = typeof documento.data.demanda === "string" ? demandas.get(documento.data.demanda) ?? null : null;
    const os = osNaTv(documento.id, documento.data, demanda, hoje);
    if (os) ordens.push(os);
  }
  ordens.sort((a, b) => {
    const porColuna = COLUNAS_DA_TV.indexOf(a.coluna) - COLUNAS_DA_TV.indexOf(b.coluna);
    if (porColuna) return porColuna;
    const porHora = a.coluna === "concluida" ? horaDeOrdem(b).localeCompare(horaDeOrdem(a)) : horaDeOrdem(a).localeCompare(horaDeOrdem(b));
    return porHora || a.numero.localeCompare(b.numero);
  });
  return { hoje, gerado_em: agora.toISOString(), ordens };
}
