import type { Celula } from "../planilha-xlsx";

/**
 * Os relatórios da Operação (docs/plataforma/fase-4-financeiro.md, parte
 * 4.8a; docs/mockups/Relatorios.dc.html): as OS do período por semana ou mês,
 * por cliente, por tipo de serviço, por pessoa da equipe e por veículo, e as
 * solicitações do portal por cliente. Nenhum valor: a OS não tem preço, e a
 * receita fica no Financeiro (parte 4.8b).
 *
 * A OS entra pelo dia agendado (`janela.data`). A concluída é a que passou
 * pela conclusão (em revisão ou revisada). No prazo: concluída até o dia
 * agendado, e até o fim da janela quando ele foi marcado.
 */

export const RELATORIOS_DA_OPERACAO = ["periodo", "cliente", "servico", "equipe", "veiculos", "solicitacoes"] as const;
export type RelatorioDaOperacao = (typeof RELATORIOS_DA_OPERACAO)[number];

export const RELATORIO_ROTULO: Record<RelatorioDaOperacao, string> = {
  periodo: "OS por período",
  cliente: "OS por cliente",
  servico: "OS por tipo",
  equipe: "Produtividade da equipe",
  veiculos: "Uso dos veículos",
  solicitacoes: "Solicitações do portal",
};

export type Agrupamento = "semana" | "mes";

/** O relatório pedido na busca da URL (`?relatorio=`); sem ele, as OS por período. */
export function relatorioDaBusca(busca: string): RelatorioDaOperacao {
  const valor = new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca).get("relatorio");
  return (RELATORIOS_DA_OPERACAO as readonly string[]).includes(valor ?? "") ? (valor as RelatorioDaOperacao) : "periodo";
}

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "";
}

function registro(valor: unknown): Registro {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Registro) : {};
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// --- A OS e a solicitação lidas -----------------------------------------------------------

export type OsDoRelatorio = {
  numero: string;
  customerCode: string;
  cliente: string;
  status: string;
  tipo: "servico" | "vistoria";
  servicos: string[];
  /** O dia agendado (aaaa-mm-dd). */
  data: string;
  /** O fim da janela (hh:mm), quando marcado. */
  fim: string | null;
  /** Quando foi concluída (ISO), ou null. */
  concluidaEm: string | null;
  equipe: Array<{ id: string; nome: string }>;
  veiculos: Array<{ id: string; placa: string }>;
};

/** A OS do banco para o relatório, ou null sem o dia agendado. Não lê valor nenhum. */
export function osDoRelatorio(id: string, dados: Registro): OsDoRelatorio | null {
  const janela = registro(dados.janela);
  const data = texto(janela.data);
  if (!DIA.test(data)) return null;
  const fim = texto(janela.fim);
  const conclusao = registro(dados.conclusao);
  const concluidaEm = texto(conclusao.instante);
  const customerCode = texto(dados.customer_code);
  return {
    numero: texto(dados.numero) || id,
    customerCode,
    cliente: texto(dados.cliente_nome) || customerCode || "—",
    status: texto(dados.status),
    tipo: dados.tipo === "vistoria" ? "vistoria" : "servico",
    servicos: (Array.isArray(dados.servicos) ? dados.servicos : []).map(texto).filter(Boolean),
    data,
    fim: HORA.test(fim) ? fim : null,
    concluidaEm: concluidaEm && !Number.isNaN(Date.parse(concluidaEm)) ? concluidaEm : null,
    equipe: (Array.isArray(dados.equipe) ? dados.equipe : []).flatMap((pessoa) => {
      const linha = registro(pessoa);
      const idDaPessoa = texto(linha.colaborador_id);
      return idDaPessoa ? [{ id: idDaPessoa, nome: texto(linha.nome) || idDaPessoa }] : [];
    }),
    veiculos: (Array.isArray(dados.veiculos) ? dados.veiculos : []).flatMap((veiculo) => {
      const linha = registro(veiculo);
      const idDoVeiculo = texto(linha.veiculo_id);
      return idDoVeiculo ? [{ id: idDoVeiculo, placa: texto(linha.placa) || idDoVeiculo }] : [];
    }),
  };
}

export type SolicitacaoDoRelatorio = { id: string; customerCode: string; cliente: string; status: "recebida" | "aceita" | "recusada"; recebidaEm: string };

export function solicitacaoDoRelatorio(id: string, dados: Registro): SolicitacaoDoRelatorio | null {
  const status = texto(dados.status);
  const recebidaEm = texto(dados.recebida_em);
  if ((status !== "recebida" && status !== "aceita" && status !== "recusada") || Number.isNaN(Date.parse(recebidaEm))) return null;
  const customerCode = texto(dados.customer_code);
  return { id, customerCode, cliente: texto(dados.customer_name) || customerCode || "—", status, recebidaEm };
}

// --- Datas de São Paulo -------------------------------------------------------------------

const DIA_EM_SP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const HORA_EM_SP = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false });

export function diaEmSaoPaulo(instante: Date): string {
  return DIA_EM_SP.format(instante);
}

/** O dia somado de n dias (aaaa-mm-dd), sem fuso. */
export function somarDias(dia: string, dias: number): string {
  const data = new Date(`${dia}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

/** A segunda-feira da semana do dia. */
export function inicioDaSemana(dia: string): string {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return somarDias(dia, -((semana + 6) % 7));
}

function curto(dia: string): string {
  const [, mes, dd] = dia.split("-");
  return `${dd}/${mes}`;
}

const MES_ROTULO = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });

/** O início do dia de São Paulo em ISO (UTC), para comparar com `recebida_em`. */
export function inicioDoDiaIso(dia: string): string {
  return new Date(`${dia}T00:00:00-03:00`).toISOString();
}

// --- Regras ---------------------------------------------------------------------------------

/** Concluída: em revisão ou revisada. A OS reaberta volta à execução e deixa de contar até concluir de novo. */
export function concluida(os: Pick<OsDoRelatorio, "status">): boolean {
  return os.status === "em_revisao" || os.status === "revisada";
}

export function cancelada(os: Pick<OsDoRelatorio, "status">): boolean {
  return os.status === "cancelada";
}

/** No prazo: concluída até o dia agendado e, com o fim da janela, até ele. Null na OS não concluída. */
export function noPrazo(os: Pick<OsDoRelatorio, "status" | "concluidaEm" | "data" | "fim">): boolean | null {
  if (!concluida(os) || !os.concluidaEm) return null;
  const instante = new Date(os.concluidaEm);
  const dia = diaEmSaoPaulo(instante);
  if (dia !== os.data) return dia < os.data;
  return !os.fim || HORA_EM_SP.format(instante) <= os.fim;
}

function porcentagem(parte: number, todo: number): number | null {
  return todo > 0 ? Math.round((parte / todo) * 100) : null;
}

export type ResumoDasOs = { total: number; concluidas: number; canceladas: number; noPrazo: number | null };

export function resumoDasOs(oss: readonly OsDoRelatorio[]): ResumoDasOs {
  const concluidas = oss.filter(concluida);
  return {
    total: oss.length,
    concluidas: concluidas.length,
    canceladas: oss.filter(cancelada).length,
    noPrazo: porcentagem(concluidas.filter((os) => noPrazo(os) === true).length, concluidas.length),
  };
}

// --- As tabelas -----------------------------------------------------------------------------

export type ValorDaCelula = string | number | null;
export type TabelaDoRelatorio = {
  colunas: string[];
  linhas: Array<{ chave: string; celulas: ValorDaCelula[] }>;
  total: ValorDaCelula[] | null;
};

type Grupo = { chave: string; rotulo: string; oss: OsDoRelatorio[] };

function agrupar(oss: readonly OsDoRelatorio[], chaves: (os: OsDoRelatorio) => Array<{ chave: string; rotulo: string }>): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const os of oss) {
    for (const { chave, rotulo } of chaves(os)) {
      const grupo = grupos.get(chave) ?? { chave, rotulo, oss: [] };
      grupo.oss.push(os);
      grupos.set(chave, grupo);
    }
  }
  return [...grupos.values()];
}

function pelaQuantidade(a: Grupo, b: Grupo): number {
  return b.oss.length - a.oss.length || a.rotulo.localeCompare(b.rotulo, "pt-BR");
}

function celulasDoResumo(oss: readonly OsDoRelatorio[]): ValorDaCelula[] {
  const resumo = resumoDasOs(oss);
  return [resumo.total, resumo.concluidas, resumo.canceladas, resumo.noPrazo];
}

const COLUNAS_DAS_OS = ["OS", "Concluídas", "Canceladas", "No prazo (%)"];

export const SERVICO_ROTULO: Record<string, string> = {
  vistoria: "Vistoria",
  desmontagem: "Desmontagem",
  embalagem: "Embalagem",
  transporte: "Transporte",
  montagem: "Montagem",
  armazenagem: "Armazenagem",
};

export function tabelaPorPeriodo(oss: readonly OsDoRelatorio[], agrupamento: Agrupamento): TabelaDoRelatorio {
  const grupos = agrupar(oss, (os) => {
    if (agrupamento === "mes") {
      const chave = os.data.slice(0, 7);
      return [{ chave, rotulo: MES_ROTULO.format(new Date(`${chave}-15T12:00:00Z`)).replace(".", "").replace(" de ", "/") }];
    }
    const segunda = inicioDaSemana(os.data);
    return [{ chave: segunda, rotulo: `${curto(segunda)} – ${curto(somarDias(segunda, 6))}` }];
  }).sort((a, b) => a.chave.localeCompare(b.chave));
  return {
    colunas: [agrupamento === "mes" ? "Mês" : "Semana", ...COLUNAS_DAS_OS],
    linhas: grupos.map((grupo) => ({ chave: grupo.chave, celulas: [grupo.rotulo, ...celulasDoResumo(grupo.oss)] })),
    total: oss.length ? ["Total", ...celulasDoResumo(oss)] : null,
  };
}

export function tabelaPorCliente(oss: readonly OsDoRelatorio[]): TabelaDoRelatorio {
  const grupos = agrupar(oss, (os) => [{ chave: os.customerCode || os.cliente, rotulo: os.cliente }]).sort(pelaQuantidade);
  return {
    colunas: ["Cliente", ...COLUNAS_DAS_OS],
    linhas: grupos.map((grupo) => ({ chave: grupo.chave, celulas: [grupo.rotulo, ...celulasDoResumo(grupo.oss)] })),
    total: oss.length ? ["Total", ...celulasDoResumo(oss)] : null,
  };
}

/** A OS com mais de um serviço conta em cada um; a vistoria é o serviço dela. */
export function tabelaPorServico(oss: readonly OsDoRelatorio[]): TabelaDoRelatorio {
  const grupos = agrupar(oss, (os) => {
    const servicos = os.tipo === "vistoria" ? ["vistoria"] : os.servicos.length ? os.servicos : ["sem_servico"];
    return servicos.map((servico) => ({ chave: servico, rotulo: SERVICO_ROTULO[servico] ?? "Sem serviço" }));
  }).sort(pelaQuantidade);
  return {
    colunas: ["Serviço", ...COLUNAS_DAS_OS],
    linhas: grupos.map((grupo) => ({ chave: grupo.chave, celulas: [grupo.rotulo, ...celulasDoResumo(grupo.oss)] })),
    total: null,
  };
}

/** Por pessoa escalada: as OS, as concluídas e quantas no prazo. */
export function tabelaDaEquipe(oss: readonly OsDoRelatorio[]): TabelaDoRelatorio {
  const grupos = agrupar(oss, (os) => os.equipe.map((pessoa) => ({ chave: pessoa.id, rotulo: pessoa.nome }))).sort(pelaQuantidade);
  return {
    colunas: ["Pessoa", "OS", "Concluídas", "No prazo (%)"],
    linhas: grupos.map((grupo) => {
      const resumo = resumoDasOs(grupo.oss);
      return { chave: grupo.chave, celulas: [grupo.rotulo, resumo.total, resumo.concluidas, resumo.noPrazo] };
    }),
    total: null,
  };
}

/** Por veículo: as OS, os dias em uso (dias agendados diferentes) e as concluídas. */
export function tabelaDosVeiculos(oss: readonly OsDoRelatorio[]): TabelaDoRelatorio {
  const grupos = agrupar(oss, (os) => os.veiculos.map((veiculo) => ({ chave: veiculo.id, rotulo: veiculo.placa }))).sort(pelaQuantidade);
  return {
    colunas: ["Veículo", "OS", "Dias em uso", "Concluídas"],
    linhas: grupos.map((grupo) => ({
      chave: grupo.chave,
      celulas: [grupo.rotulo, grupo.oss.length, new Set(grupo.oss.map((os) => os.data)).size, grupo.oss.filter(concluida).length],
    })),
    total: null,
  };
}

/** As solicitações do portal por cliente: recebidas no período, as que viraram demanda, as recusadas e as em aberto. */
export function tabelaDasSolicitacoes(solicitacoes: readonly SolicitacaoDoRelatorio[]): TabelaDoRelatorio {
  const porCliente = new Map<string, { rotulo: string; lista: SolicitacaoDoRelatorio[] }>();
  for (const solicitacao of solicitacoes) {
    const chave = solicitacao.customerCode || solicitacao.cliente;
    const grupo = porCliente.get(chave) ?? { rotulo: solicitacao.cliente, lista: [] };
    grupo.lista.push(solicitacao);
    porCliente.set(chave, grupo);
  }
  const contar = (lista: readonly SolicitacaoDoRelatorio[]): ValorDaCelula[] => [
    lista.length,
    lista.filter((item) => item.status === "aceita").length,
    lista.filter((item) => item.status === "recusada").length,
    lista.filter((item) => item.status === "recebida").length,
  ];
  return {
    colunas: ["Cliente", "Recebidas", "Viraram demanda", "Recusadas", "Em aberto"],
    linhas: [...porCliente.entries()]
      .sort(([, a], [, b]) => b.lista.length - a.lista.length || a.rotulo.localeCompare(b.rotulo, "pt-BR"))
      .map(([chave, grupo]) => ({ chave, celulas: [grupo.rotulo, ...contar(grupo.lista)] })),
    total: solicitacoes.length ? ["Total", ...contar(solicitacoes)] : null,
  };
}

// --- O filtro e a planilha ------------------------------------------------------------------

export type FiltroDoRelatorio = { de: string; ate: string; cliente: string | null; agrupamento: Agrupamento };

/** As últimas quatro semanas até hoje, todos os clientes, por semana. */
export function filtroInicial(hoje: string): FiltroDoRelatorio {
  return { de: somarDias(hoje, -27), ate: hoje, cliente: null, agrupamento: "semana" };
}

export function problemaDoFiltro(filtro: Pick<FiltroDoRelatorio, "de" | "ate">): string | null {
  if (!DIA.test(filtro.de) || !DIA.test(filtro.ate)) return "Informe o período.";
  if (filtro.de > filtro.ate) return "O início vem antes do fim.";
  if (somarDias(filtro.de, 366) <= filtro.ate) return "Use um período de até um ano.";
  return null;
}

export function doCliente<T extends { customerCode: string }>(lista: readonly T[], cliente: string | null): T[] {
  return cliente ? lista.filter((item) => item.customerCode === cliente) : [...lista];
}

/** Os clientes que aparecem nas OS e nas solicitações, para o filtro. */
export function clientesDoPeriodo(oss: readonly OsDoRelatorio[], solicitacoes: readonly SolicitacaoDoRelatorio[]): Array<{ code: string; nome: string }> {
  const nomes = new Map<string, string>();
  for (const item of [...oss, ...solicitacoes]) if (item.customerCode && !nomes.has(item.customerCode)) nomes.set(item.customerCode, item.cliente);
  return [...nomes.entries()].map(([code, nome]) => ({ code, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export function tabelaDoRelatorio(relatorio: RelatorioDaOperacao, oss: readonly OsDoRelatorio[], solicitacoes: readonly SolicitacaoDoRelatorio[], agrupamento: Agrupamento): TabelaDoRelatorio {
  switch (relatorio) {
    case "periodo":
      return tabelaPorPeriodo(oss, agrupamento);
    case "cliente":
      return tabelaPorCliente(oss);
    case "servico":
      return tabelaPorServico(oss);
    case "equipe":
      return tabelaDaEquipe(oss);
    case "veiculos":
      return tabelaDosVeiculos(oss);
    case "solicitacoes":
      return tabelaDasSolicitacoes(solicitacoes);
  }
}

/** As linhas da planilha, com o total no fim: o número fica número, para somar; o sem dado fica vazio. */
export function linhasDaPlanilha(tabela: TabelaDoRelatorio): Celula[][] {
  return [...tabela.linhas.map((linha) => [...linha.celulas]), ...(tabela.total ? [[...tabela.total]] : [])];
}

export function nomeDaPlanilha(relatorio: RelatorioDaOperacao, filtro: Pick<FiltroDoRelatorio, "de" | "ate">): string {
  return `relatorio-${relatorio}-${filtro.de}-a-${filtro.ate}.xlsx`;
}
