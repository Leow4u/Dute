import { formatarReais } from "@workspace/dominio";

import { rotuloDaCompetencia } from "../financeiro/a-faturar";
import { faturaDoFinanceiro, rotuloDaNf, situacaoDaCobranca, textoDaSituacao, type FaturaDoFinanceiro, type SituacaoDaCobranca } from "../financeiro/faturas";
import { ETAPA_ROTULO, horaDe, janelaEmTexto, servicosEmTexto, type FichaDaOs } from "../operacao/ficha-da-os";
import { temComprovante } from "./comprovante";

/**
 * O portal do cliente com a Operação e o Financeiro (docs/plataforma/fase-4-financeiro.md,
 * parte 4.3b): as OS dele, com o andamento em etapas, e as NFs dos serviços
 * (`client_faturas`). O cliente vê o que é dele: o número, o serviço, a data,
 * os locais, o motorista e a placa, o andamento e quem recebeu; concluída, o
 * comprovante (parte 4.3d). Fica de fora o que é interno: a revisão, as
 * ocorrências, as presenças, os itens previstos e as fotos fora do final. As regras já limitam a leitura às OS e NFs do
 * próprio cliente, com o módulo no contrato.
 */

export type SituacaoNoPortal = "para_agendar" | "agendada" | "em_execucao" | "concluida" | "cancelada";

export const SITUACAO_NO_PORTAL_ROTULO: Record<SituacaoNoPortal, string> = {
  para_agendar: "Para agendar",
  agendada: "Agendada",
  em_execucao: "Em execução",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

/** A revisão é interna: para o cliente, a OS concluída no local já está concluída. */
export function situacaoNoPortal(ficha: Pick<FichaDaOs, "status">): SituacaoNoPortal {
  switch (ficha.status) {
    case "aberta":
      return "para_agendar";
    case "agendada":
      return "agendada";
    case "em_execucao":
      return "em_execucao";
    case "em_revisao":
    case "revisada":
      return "concluida";
    case "cancelada":
      return "cancelada";
  }
}

export type MarcoNoPortal = { titulo: string; detalhe: string | null; feito: boolean };

export type OsDoPortal = {
  numero: string;
  demanda: string;
  vistoria: boolean;
  situacao: SituacaoNoPortal;
  /** "Transporte e montagem"; "Vistoria" na vistoria. */
  servicos: string;
  /** "Qui 22/10 07:30–12:00". */
  janela: string | null;
  /** A data da janela, para ordenar. */
  dia: string | null;
  origem: string | null;
  destino: string | null;
  /** "João Pereira · DEF-4G56". */
  motorista: string | null;
  andamento: MarcoNoPortal[];
  /** "Recebido por Ana Souza · 22/10/2026 11:40". */
  recebimento: string | null;
  /** A OS concluída tem o comprovante (parte 4.3d), com a assinatura e as fotos do final. */
  comprovante: boolean;
};

function endereco(local: FichaDaOs["locais"]["origem"]): string | null {
  if (!local) return null;
  return [local.nome, local.endereco].filter(Boolean).join(" · ") || null;
}

function instanteEmTexto(instante: string): string {
  const dia = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(instante));
  return `${dia} ${horaDe(instante)}`;
}

/** O andamento como o cliente acompanha: pedido, agendada, em execução (a última etapa) e concluída. */
function andamentoDaOs(ficha: FichaDaOs, situacao: SituacaoNoPortal, hoje: string): MarcoNoPortal[] {
  const etapas = [...ficha.etapas].sort((a, b) => a.instante.localeCompare(b.instante));
  const ultima = etapas.at(-1) ?? null;
  const concluida = situacao === "concluida";
  return [
    { titulo: "Pedido recebido", detalhe: null, feito: true },
    { titulo: "Agendada", detalhe: janelaEmTexto(ficha.janela, hoje), feito: Boolean(ficha.janela) && situacao !== "para_agendar" },
    { titulo: "Em execução", detalhe: ultima ? `${ETAPA_ROTULO[ultima.etapa]} · ${horaDe(ultima.instante)}` : null, feito: Boolean(ultima) || concluida },
    { titulo: "Concluída", detalhe: ficha.conclusao ? instanteEmTexto(ficha.conclusao.instante) : null, feito: concluida },
  ];
}

export function osDoPortal(ficha: FichaDaOs, hoje: string): OsDoPortal {
  const situacao = situacaoNoPortal(ficha);
  const motorista = ficha.equipe.find((pessoa) => pessoa.papel === "motorista") ?? null;
  const placa = ficha.veiculos[0]?.placa ?? null;
  const conclusao = ficha.conclusao;
  return {
    numero: ficha.numero,
    demanda: ficha.demanda,
    vistoria: ficha.tipo === "vistoria",
    situacao,
    servicos: ficha.tipo === "vistoria" ? "Vistoria" : (servicosEmTexto(ficha.servicos) ?? "Serviço"),
    janela: janelaEmTexto(ficha.janela, hoje),
    dia: ficha.janela?.data ?? null,
    origem: endereco(ficha.locais.origem),
    destino: endereco(ficha.locais.destino),
    motorista: [motorista?.nome ?? null, placa].filter(Boolean).join(" · ") || null,
    andamento: situacao === "cancelada" ? [] : andamentoDaOs(ficha, situacao, hoje),
    recebimento:
      conclusao && conclusao.aceite === "assinatura" && conclusao.responsavel.nome
        ? `Recebido por ${conclusao.responsavel.nome} · ${instanteEmTexto(conclusao.instante)}`
        : null,
    comprovante: temComprovante(ficha),
  };
}

const ORDEM_DA_SITUACAO: Record<SituacaoNoPortal, number> = { em_execucao: 0, agendada: 1, para_agendar: 2, concluida: 3, cancelada: 4 };

/** Em andamento primeiro (em execução, agendadas pela data, para agendar); depois as concluídas, a mais recente primeiro. */
export function ordenarOs(lista: readonly OsDoPortal[]): OsDoPortal[] {
  return [...lista].sort((a, b) => {
    const porSituacao = ORDEM_DA_SITUACAO[a.situacao] - ORDEM_DA_SITUACAO[b.situacao];
    if (porSituacao) return porSituacao;
    const depois = a.situacao === "concluida" || a.situacao === "cancelada";
    const porDia = depois ? (b.dia ?? "").localeCompare(a.dia ?? "") : (a.dia ?? "9999").localeCompare(b.dia ?? "9999");
    return porDia || a.numero.localeCompare(b.numero, "pt-BR", { numeric: true });
  });
}

export type NumerosDoPortal = { emAndamento: number; agendadas: number; concluidas: number };

export function numerosDasOs(lista: readonly OsDoPortal[]): NumerosDoPortal {
  return {
    emAndamento: lista.filter((os) => os.situacao === "em_execucao").length,
    agendadas: lista.filter((os) => os.situacao === "agendada" || os.situacao === "para_agendar").length,
    concluidas: lista.filter((os) => os.situacao === "concluida").length,
  };
}

// --- As NFs dos serviços ----------------------------------------------------------------------

export type NfDoPortal = {
  fatura: FaturaDoFinanceiro;
  /** O título de cada demanda, como o registro da NF leu. */
  titulos: ReadonlyMap<string, string>;
};

/** A NF de `client_faturas` (a projeção do Financeiro), lida com a mesma régua das telas internas. */
export function nfDoPortal(id: string, dados: Record<string, unknown>): NfDoPortal | null {
  const fatura = faturaDoFinanceiro(id, dados);
  if (!fatura) return null;
  const titulos = new Map<string, string>();
  for (const item of Array.isArray(dados.demandas) ? dados.demandas : []) {
    if (!item || typeof item !== "object") continue;
    const linha = item as Record<string, unknown>;
    if (typeof linha.numero === "string" && typeof linha.titulo === "string" && linha.titulo.trim()) titulos.set(linha.numero, linha.titulo.trim());
  }
  return { fatura, titulos };
}

export type CobrancaDaOs = { nf: string; situacao: SituacaoDaCobranca; texto: string };

/** A NF da demanda de cada OS: "NF 1234 · Vence em 7 dias", "NF 1234 · Paga em 22/10/2026". */
export function cobrancaPorDemanda(nfs: readonly NfDoPortal[], hoje: string): Map<string, CobrancaDaOs> {
  const porDemanda = new Map<string, CobrancaDaOs>();
  for (const { fatura } of nfs) {
    for (const demanda of fatura.demandas) {
      porDemanda.set(demanda.numero, { nf: rotuloDaNf(fatura), situacao: situacaoDaCobranca(fatura, hoje), texto: `${rotuloDaNf(fatura)} · ${textoDaSituacao(fatura, hoje)}` });
    }
  }
  return porDemanda;
}

/** As NFs que esperam pagamento primeiro, pelo vencimento; depois as pagas, a mais recente primeiro. */
export function ordenarNfs(nfs: readonly NfDoPortal[], hoje: string): NfDoPortal[] {
  const aberta = (nf: NfDoPortal) => situacaoDaCobranca(nf.fatura, hoje) !== "paga";
  return [...nfs].sort((a, b) => {
    if (aberta(a) !== aberta(b)) return aberta(a) ? -1 : 1;
    return aberta(a) ? a.fatura.vencimento.localeCompare(b.fatura.vencimento) : (b.fatura.pagaEm ?? "").localeCompare(a.fatura.pagaEm ?? "");
  });
}

/** "10045 · Desmontagem de mobiliário · R$ 10.000,00". */
export function textoDaDemandaNaNf(nf: NfDoPortal, numero: string, valorCents: number): string {
  return [numero, nf.titulos.get(numero) ?? null, formatarReais(valorCents)].filter(Boolean).join(" · ");
}

/** "Armazenagem 09/2026 · R$ 3.200,00": a competência do WMS que entrou na NF. */
export function textoDaArmazenagemNaNf(competencia: string, valorCents: number): string {
  return `Armazenagem ${rotuloDaCompetencia(competencia)} · ${formatarReais(valorCents)}`;
}

/** "Equipe fixa · Medição 10/2026 · R$ 12.000,00": as linhas sem demanda da medição que entrou na NF (pergunta 64). */
export function textoDaMedicaoNaNf(servico: string, competencia: string, valorCents: number): string {
  return `${servico} · Medição ${rotuloDaCompetencia(competencia)} · ${formatarReais(valorCents)}`;
}

/** Quanto falta pagar nas NFs abertas. */
export function aPagar(nfs: readonly NfDoPortal[], hoje: string): number {
  return nfs.filter((nf) => situacaoDaCobranca(nf.fatura, hoje) !== "paga").reduce((soma, nf) => soma + nf.fatura.saldoCents, 0);
}
