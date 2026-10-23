import { PAPEL_ROTULO, type ColaboradorDaLista, type PapelDeCampo, type VeiculoDaLista } from "./cadastro";
import { placaDe, type OsDaFila, type StatusDaOs } from "./fila";
import type { TipoDaDemanda } from "./hoje";

/**
 * Agenda da semana (docs/plataforma/fase-3-operacao.md, parte 3.6b;
 * docs/mockups/OpAgenda.dc.html): uma linha por pessoa (equipe própria,
 * freelancers, terceiros) e por veículo, um dia por coluna, as OS de cada um
 * em cada dia. Quem está em duas OS no mesmo dia aparece nas duas e conta no
 * dia. A OS agendada sem ninguém fica em Sem equipe. Sem valor.
 */

/** As OS que ocupam gente e veículo no dia: da agendada à revisada. */
const STATUS_DA_AGENDA: readonly StatusDaOs[] = ["agendada", "em_execucao", "em_revisao", "revisada"];

const DIA_DA_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;
const MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function emUtc(data: string): Date {
  return new Date(`${data}T12:00:00Z`);
}

function somarDias(data: string, dias: number): string {
  const dia = emUtc(data);
  dia.setUTCDate(dia.getUTCDate() + dias);
  return dia.toISOString().slice(0, 10);
}

/** A data existe no calendário (2026-02-30 não). */
export function dataValida(data: string): boolean {
  return DATA.test(data) && !Number.isNaN(emUtc(data).getTime()) && emUtc(data).toISOString().slice(0, 10) === data;
}

/** A segunda-feira da semana do dia. */
export function inicioDaSemana(data: string): string {
  const semana = emUtc(data).getUTCDay();
  return somarDias(data, semana === 0 ? -6 : 1 - semana);
}

export function semanaAnterior(segunda: string): string {
  return somarDias(segunda, -7);
}

export function proximaSemana(segunda: string): string {
  return somarDias(segunda, 7);
}

export type DiaDaAgenda = { data: string; rotulo: string; hoje: boolean };

/** Segunda a sábado; o domingo entra só quando tem OS. */
export function diasDaSemana(segunda: string, hoje: string, comDomingo: boolean): DiaDaAgenda[] {
  return Array.from({ length: comDomingo ? 7 : 6 }, (_, indice) => {
    const data = somarDias(segunda, indice);
    return { data, rotulo: `${DIA_DA_SEMANA[emUtc(data).getUTCDay()]} ${Number(data.slice(8, 10))}`, hoje: data === hoje };
  });
}

/** "19 a 24 de outubro"; "28 de setembro a 3 de outubro"; "28 de dezembro de 2026 a 2 de janeiro de 2027". */
export function tituloDaSemana(dias: readonly DiaDaAgenda[]): string {
  const primeiro = dias[0].data;
  const ultimo = dias[dias.length - 1].data;
  const dia = (data: string) => Number(data.slice(8, 10));
  const mes = (data: string) => MES[Number(data.slice(5, 7)) - 1];
  if (primeiro.slice(0, 7) === ultimo.slice(0, 7)) return `${dia(primeiro)} a ${dia(ultimo)} de ${mes(ultimo)}`;
  if (primeiro.slice(0, 4) === ultimo.slice(0, 4)) return `${dia(primeiro)} de ${mes(primeiro)} a ${dia(ultimo)} de ${mes(ultimo)}`;
  return `${dia(primeiro)} de ${mes(primeiro)} de ${primeiro.slice(0, 4)} a ${dia(ultimo)} de ${mes(ultimo)} de ${ultimo.slice(0, 4)}`;
}

/** A OS como a Agenda mostra: no bloco do dia, na barra da seleção e em Sem equipe. */
export type OsNaAgenda = {
  numero: string;
  status: StatusDaOs;
  demanda: string;
  cliente: string;
  titulo: string | null;
  tipo: TipoDaDemanda | null;
  /** A OS é uma vistoria (parte 3.11a). */
  vistoria: boolean;
  /** "07:30–18:00", "13:00" ou null (sem hora). */
  janela: string | null;
  /** "Ter 20/10 07:30–18:00". */
  quando: string;
  equipe: string[];
  placas: string[];
};

export type LinhaDaAgenda = {
  id: string;
  nome: string;
  detalhe: string | null;
  /** As OS de cada dia (pela data), pela hora. */
  dias: Record<string, OsNaAgenda[]>;
  /** O dia em que a linha está fora: o veículo na revisão preventiva (parte 3.13b). */
  fora?: Record<string, string>;
};

export type GrupoDaAgenda = { titulo: string; linhas: LinhaDaAgenda[] };

export type ResumoDoDia = { ordens: number; semEquipe: number; emDuasOs: number };

export type Agenda = {
  dias: DiaDaAgenda[];
  grupos: GrupoDaAgenda[];
  /** As OS agendadas na semana sem ninguém, pela data e hora. */
  semEquipe: OsNaAgenda[];
  resumo: Record<string, ResumoDoDia>;
  /** Toda OS da semana, pelo número: o que a barra da seleção mostra. */
  ordens: Record<string, OsNaAgenda>;
  /** As OS de cada dia, pela hora, com a busca: a lista do celular. */
  porDia: Record<string, OsNaAgenda[]>;
};

export type DemandaDaAgenda = { titulo: string | null; tipo: TipoDaDemanda };

export type EntradaDaAgenda = {
  segunda: string;
  hoje: string;
  ordens: readonly OsDaFila[];
  pessoas: readonly ColaboradorDaLista[];
  veiculos: readonly VeiculoDaLista[];
  nomesClientes: Readonly<Record<string, string>>;
  demandas: Readonly<Record<string, DemandaDaAgenda>>;
  busca: string;
};

function janelaDa(os: OsDaFila): string | null {
  const agenda = os.agenda;
  if (!agenda?.hora) return null;
  return agenda.fim ? `${agenda.hora}–${agenda.fim}` : agenda.hora;
}

function normalizar(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

/** Quem está na OS: a equipe copiada (parte 3.4b) ou, na OS de antes, os ids da agenda. */
function idsDaEquipe(os: OsDaFila): string[] {
  return os.pessoas?.length ? os.pessoas.map((pessoa) => pessoa.id) : (os.agenda?.equipe ?? []);
}

function pelaHora(a: OsDaFila, b: OsDaFila): number {
  return `${a.agenda?.data}${a.agenda?.hora ?? "99"}${a.numero}`.localeCompare(`${b.agenda?.data}${b.agenda?.hora ?? "99"}${b.numero}`);
}

function mesmoDia(os: OsDaFila, data: string): boolean {
  return os.agenda?.data === data;
}

export function agendaDaSemana(entrada: EntradaDaAgenda): Agenda {
  const semana = new Set(Array.from({ length: 7 }, (_, indice) => somarDias(entrada.segunda, indice)));
  const daSemana = entrada.ordens
    .filter((os) => STATUS_DA_AGENDA.includes(os.status) && os.agenda && semana.has(os.agenda.data))
    .sort(pelaHora);
  const domingo = somarDias(entrada.segunda, 6);
  const dias = diasDaSemana(entrada.segunda, entrada.hoje, daSemana.some((os) => mesmoDia(os, domingo)));

  const nomes = new Map(entrada.pessoas.map((pessoa) => [pessoa.id, pessoa.nome]));
  const placas = Object.fromEntries(entrada.veiculos.map((veiculo) => [veiculo.id, veiculo.placa]));
  const ordens: Record<string, OsNaAgenda> = {};
  for (const os of daSemana) {
    const agenda = os.agenda!;
    const janela = janelaDa(os);
    const demanda = entrada.demandas[os.demanda] ?? null;
    ordens[os.numero] = {
      numero: os.numero,
      status: os.status,
      demanda: os.demanda,
      cliente: entrada.nomesClientes[os.customer_code] || os.customer_code,
      titulo: demanda?.titulo ?? null,
      tipo: demanda?.tipo ?? null,
      vistoria: os.tipo === "vistoria",
      janela,
      quando: [`${DIA_DA_SEMANA[emUtc(agenda.data).getUTCDay()]} ${agenda.data.slice(8, 10)}/${agenda.data.slice(5, 7)}`, janela].filter(Boolean).join(" "),
      equipe: os.pessoas?.length ? os.pessoas.map((pessoa) => pessoa.nome) : agenda.equipe.map((id) => nomes.get(id) ?? id),
      placas: os.placas?.length ? os.placas : agenda.veiculos.map((id) => placaDe(id, placas)),
    };
  }

  const porPessoa = new Map<string, OsDaFila[]>();
  const porVeiculo = new Map<string, OsDaFila[]>();
  for (const os of daSemana) {
    for (const id of idsDaEquipe(os)) porPessoa.set(id, [...(porPessoa.get(id) ?? []), os]);
    for (const id of os.agenda?.veiculos ?? []) porVeiculo.set(id, [...(porVeiculo.get(id) ?? []), os]);
  }
  const diasDe = (lista: readonly OsDaFila[]): Record<string, OsNaAgenda[]> => {
    const resultado: Record<string, OsNaAgenda[]> = {};
    for (const os of lista) resultado[os.agenda!.data] = [...(resultado[os.agenda!.data] ?? []), ordens[os.numero]];
    return resultado;
  };

  const termo = normalizar(entrada.busca.trim());
  const daOs = (os: OsDaFila) => [os.numero, ordens[os.numero].cliente];
  const passa = (campos: ReadonlyArray<string | null | undefined>) => !termo || campos.some((campo) => campo && normalizar(campo).includes(termo));

  /** O papel da pessoa na semana (o da primeira OS dela) ou o primeiro do cadastro; sem nenhum, a função. */
  const papelNaSemana = (pessoa: ColaboradorDaLista): string | null => {
    for (const os of porPessoa.get(pessoa.id) ?? []) {
      const papel = os.pessoas?.find((naOs) => naOs.id === pessoa.id)?.papel;
      if (papel && papel in PAPEL_ROTULO) return PAPEL_ROTULO[papel as PapelDeCampo];
    }
    const doCadastro = pessoa.papeis[0];
    return doCadastro ? PAPEL_ROTULO[doCadastro] : pessoa.funcao || null;
  };
  const pessoasVisiveis = entrada.pessoas
    .filter((pessoa) => pessoa.ativo || porPessoa.has(pessoa.id))
    .filter((pessoa) => passa([pessoa.nome, ...(porPessoa.get(pessoa.id) ?? []).flatMap(daOs)]))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const linhasDoVinculo = (vinculo: ColaboradorDaLista["vinculo"]): LinhaDaAgenda[] =>
    pessoasVisiveis
      .filter((pessoa) => pessoa.vinculo === vinculo)
      .map((pessoa) => ({
        id: pessoa.id,
        nome: pessoa.nome,
        detalhe: [papelNaSemana(pessoa), vinculo === "terceiro" ? pessoa.empresa || null : null].filter(Boolean).join(" · ") || null,
        dias: diasDe(porPessoa.get(pessoa.id) ?? []),
      }));
  const veiculos: LinhaDaAgenda[] = entrada.veiculos
    .filter((veiculo) => veiculo.ativo || porVeiculo.has(veiculo.id))
    .filter((veiculo) => passa([veiculo.placa, ...(porVeiculo.get(veiculo.id) ?? []).flatMap(daOs)]))
    .sort((a, b) => a.placa.localeCompare(b.placa, "pt-BR"))
    .map((veiculo) => ({
      id: veiculo.id,
      nome: veiculo.placa,
      detalhe: [veiculo.tipo, veiculo.dono === "terceiro" ? veiculo.empresa || null : null].filter(Boolean).join(" · ") || null,
      dias: diasDe(porVeiculo.get(veiculo.id) ?? []),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(veiculo.revisaoEm) ? { fora: { [veiculo.revisaoEm]: "Revisão preventiva" } } : {}),
    }));
  const grupos: GrupoDaAgenda[] = [
    { titulo: "Equipe própria", linhas: linhasDoVinculo("proprio") },
    { titulo: "Freelancers", linhas: linhasDoVinculo("freelancer") },
    { titulo: "Terceiros", linhas: linhasDoVinculo("terceiro") },
    { titulo: "Veículos", linhas: veiculos },
  ].filter((grupo) => grupo.linhas.length);

  const semEquipe = daSemana.filter((os) => os.status === "agendada" && !idsDaEquipe(os).length && passa(daOs(os))).map((os) => ordens[os.numero]);

  const porDia: Record<string, OsNaAgenda[]> = {};
  for (const os of daSemana) {
    const item = ordens[os.numero];
    if (passa([item.numero, item.cliente, item.titulo, ...item.equipe, ...item.placas])) porDia[os.agenda!.data] = [...(porDia[os.agenda!.data] ?? []), item];
  }

  const resumo: Record<string, ResumoDoDia> = {};
  for (const dia of dias) {
    const doDia = daSemana.filter((os) => mesmoDia(os, dia.data));
    let emDuasOs = 0;
    for (const lista of porPessoa.values()) if (lista.filter((os) => mesmoDia(os, dia.data)).length > 1) emDuasOs += 1;
    resumo[dia.data] = { ordens: doDia.length, semEquipe: doDia.filter((os) => os.status === "agendada" && !idsDaEquipe(os).length).length, emDuasOs };
  }
  return { dias, grupos, semEquipe, resumo, ordens, porDia };
}

export type ParteDoResumo = { texto: string; alerta: boolean };

/** O cabeçalho do dia: "3 OS · 1 sem equipe · 1 em duas OS"; o dia sem OS fica em branco. */
export function resumoDoDiaEmPartes(resumo: ResumoDoDia | undefined): ParteDoResumo[] {
  if (!resumo?.ordens) return [];
  return [
    { texto: `${resumo.ordens} OS`, alerta: false },
    ...(resumo.semEquipe ? [{ texto: `${resumo.semEquipe} sem equipe`, alerta: true }] : []),
    ...(resumo.emDuasOs ? [{ texto: `${resumo.emDuasOs} em duas OS`, alerta: true }] : []),
  ];
}
