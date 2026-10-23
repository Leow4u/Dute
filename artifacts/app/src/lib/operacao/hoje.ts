import type { OsDaFila } from "./fila";

/**
 * O Hoje da Operação (docs/plataforma/fase-3-operacao.md, parte 3.5a;
 * docs/mockups/ModOpHoje.dc.html): Para planejar, Para agendar, Agendadas
 * hoje, Em execução e Em revisão, com filtros por tipo, entrada, cliente e
 * pessoa, e a busca. Só o que a OS e a demanda gravam; nunca valor.
 */

export const TIPOS_DA_DEMANDA = ["paraquedas", "emergencial", "planejada"] as const;
export type TipoDaDemanda = (typeof TIPOS_DA_DEMANDA)[number];
export const TIPO_ROTULO: Record<TipoDaDemanda, string> = { paraquedas: "Paraquedas", emergencial: "Emergencial", planejada: "Planejada" };

export const ENTRADAS_DA_DEMANDA = ["comercial", "direta", "armazenagem"] as const;
export type EntradaDaDemanda = (typeof ENTRADAS_DA_DEMANDA)[number];
export const ENTRADA_ROTULO: Record<EntradaDaDemanda, string> = { comercial: "Comercial", direta: "Direta", armazenagem: "Armazenagem" };

export const SERVICO_ROTULO: Record<string, string> = {
  vistoria: "Vistoria",
  desmontagem: "Desmontagem",
  embalagem: "Embalagem",
  transporte: "Transporte",
  montagem: "Montagem",
  armazenagem: "Armazenagem",
};

/** A linha do escopo que a Operação lê sem preço: `escopo` (fechado) ou `itens_pedidos` (direta). */
export type LinhaDoEscopo = { id: string; item: string; quantidade: string; unidade?: string | null };

export type DemandaDoHoje = {
  numero: string;
  customerCode: string;
  titulo: string | null;
  tipo: TipoDaDemanda;
  entrada: EntradaDaDemanda;
  etapa: string;
  /** Até quando executar (ISO), na demanda direta. */
  executarAte: string | null;
  osNumeros: string[];
  escopo: LinhaDoEscopo[];
  /** Perdida ou cancelada no Comercial: as OS dela só se cancelam. */
  fora: "perdida" | "cancelada" | null;
};

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function daLista<T extends string>(lista: readonly T[], valor: unknown, padrao: T): T {
  return (lista as readonly string[]).includes(texto(valor)) ? (texto(valor) as T) : padrao;
}

function preenchido(valor: unknown): boolean {
  return valor !== undefined && valor !== null && valor !== false;
}

function linhasDoEscopo(valor: unknown, campoDoId: "linha_id" | "id"): LinhaDoEscopo[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((bruto) => {
    if (!bruto || typeof bruto !== "object") return [];
    const linha = bruto as Record<string, unknown>;
    const id = texto(linha[campoDoId]) || texto(linha.id);
    const quantidade = texto(linha.quantidade);
    if (!id || !quantidade) return [];
    return [{ id, item: texto(linha.item) || texto(linha.descricao), quantidade, unidade: texto(linha.unidade) || null }];
  });
}

/** A demanda como o Hoje usa. O escopo é o fechado pelo cliente ou, na direta, os itens pedidos. */
export function demandaDoHoje(id: string, data: Record<string, unknown>): DemandaDoHoje | null {
  const customerCode = texto(data.customer_code);
  if (!customerCode) return null;
  const fechado = linhasDoEscopo(data.escopo, "linha_id");
  return {
    numero: id,
    customerCode,
    titulo: texto(data.titulo) || null,
    tipo: daLista(TIPOS_DA_DEMANDA, data.tipo, "planejada"),
    entrada: daLista(ENTRADAS_DA_DEMANDA, data.entrada, "comercial"),
    etapa: texto(data.etapa),
    executarAte: texto(data.executar_ate) || null,
    osNumeros: Array.isArray(data.os_numeros) ? data.os_numeros.filter((numero): numero is string => typeof numero === "string" && Boolean(numero)) : [],
    escopo: fechado.length ? fechado : linhasDoEscopo(data.itens_pedidos, "id"),
    fora: preenchido(data.cancelamento) ? "cancelada" : preenchido(data.perda) ? "perdida" : null,
  };
}

/** "12.5" → 12500 (milésimos), como a callable conta o saldo. */
export function milesimos(quantidade: string): number {
  const match = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(quantidade.trim());
  return match ? Number(match[1]) * 1000 + Number((match[2] ?? "").padEnd(3, "0")) : 0;
}

/**
 * Quantas linhas do escopo ainda têm saldo, descontada a fatia das OS que não
 * foram canceladas (a mesma conta de functions/operacao, saldoDoEscopo).
 */
export function linhasComSaldo(demanda: Pick<DemandaDoHoje, "numero" | "escopo">, ordens: readonly Pick<OsDaFila, "demanda" | "status" | "itens">[]): number {
  const saldo = new Map(demanda.escopo.map((linha) => [linha.id, milesimos(linha.quantidade)]));
  for (const os of ordens) {
    if (os.demanda !== demanda.numero || os.status === "cancelada") continue;
    for (const item of os.itens) {
      const restante = item.id ? saldo.get(item.id) : undefined;
      if (item.id && restante !== undefined) saldo.set(item.id, restante - milesimos(item.quantidade));
    }
  }
  return [...saldo.values()].filter((restante) => restante > 0).length;
}

// --- Prazo --------------------------------------------------------------------------------

const DIA_DA_SEMANA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short" });
const HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false });
const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

function diaCurto(iso: string): string {
  const data = new Date(iso);
  const semana = DIA_DA_SEMANA.format(data).replace(".", "");
  const [, mes, dia] = DIA.format(data).split("-");
  return `${semana.charAt(0).toUpperCase()}${semana.slice(1)} ${dia}/${mes}`;
}

function duracao(ms: number): string {
  const minutos = Math.max(1, Math.round(ms / 60_000));
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  return resto ? `${horas}h${String(resto).padStart(2, "0")}` : `${horas}h`;
}

export type PrazoDoHoje = { texto: string; falta: string | null; atrasada: boolean };

/** "Hoje até 19:00" com "faltam 4h40"; "Qua 28/10 até 18:00"; vencido, "atrasada 32 min". */
export function prazoDaDemanda(executarAte: string | null, agora: Date): PrazoDoHoje | null {
  if (!executarAte || Number.isNaN(Date.parse(executarAte))) return null;
  const prazo = new Date(executarAte);
  const hora = HORA.format(prazo);
  const hoje = DIA.format(agora) === DIA.format(prazo);
  const texto = `${hoje ? "Hoje" : diaCurto(executarAte)} até ${hora}`;
  const diferenca = prazo.getTime() - agora.getTime();
  if (diferenca < 0) return { texto, falta: `atrasada ${duracao(-diferenca)}`, atrasada: true };
  return { texto, falta: hoje ? `faltam ${duracao(diferenca)}` : null, atrasada: false };
}

// --- Quadro -------------------------------------------------------------------------------

export type FiltrosDoHoje = {
  tipo: TipoDaDemanda | "";
  entrada: EntradaDaDemanda | "";
  cliente: string;
  /** Id do colaborador na equipe. */
  pessoa: string;
};

export const SEM_FILTRO: FiltrosDoHoje = { tipo: "", entrada: "", cliente: "", pessoa: "" };

export type CartaoDeDemanda = { demanda: DemandaDoHoje; cliente: string; linhasComSaldo: number; prazo: PrazoDoHoje | null };

export type CartaoDeOs = {
  os: OsDaFila;
  cliente: string;
  demanda: DemandaDoHoje | null;
  prazo: PrazoDoHoje | null;
  /** Os nomes da equipe (da OS ou, na antiga, do cadastro). */
  equipe: string[];
  placas: string[];
};

export type QuadroDoHoje = {
  paraPlanejar: CartaoDeDemanda[];
  paraAgendar: CartaoDeOs[];
  agendadasHoje: CartaoDeOs[];
  proximosDias: CartaoDeOs[];
  emExecucao: CartaoDeOs[];
  emRevisao: CartaoDeOs[];
};

export type EntradaDoQuadro = {
  hoje: string;
  agora: Date;
  demandas: readonly DemandaDoHoje[];
  ordens: readonly OsDaFila[];
  nomesClientes: Readonly<Record<string, string>>;
  nomesPessoas: Readonly<Record<string, string>>;
  placas: Readonly<Record<string, string>>;
  filtros: FiltrosDoHoje;
  busca: string;
};

function nomeDoCliente(code: string, nomes: Readonly<Record<string, string>>): string {
  return nomes[code] || code;
}

function normalizar(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

function equipeDaOs(os: OsDaFila, nomes: Readonly<Record<string, string>>): string[] {
  if (os.pessoas?.length) return os.pessoas.map((pessoa) => pessoa.nome);
  return (os.agenda?.equipe ?? []).map((id) => nomes[id] || id);
}

function placasDaOs(os: OsDaFila, placas: Readonly<Record<string, string>>): string[] {
  if (os.placas?.length) return os.placas;
  return (os.agenda?.veiculos ?? []).map((id) => placas[id] || id);
}

function idsDaEquipe(os: OsDaFila): string[] {
  return os.pessoas?.length ? os.pessoas.map((pessoa) => pessoa.id) : os.agenda?.equipe ?? [];
}

function porHora(a: CartaoDeOs, b: CartaoDeOs): number {
  const horaA = a.os.agenda?.hora ?? "99:99";
  const horaB = b.os.agenda?.hora ?? "99:99";
  return (a.os.agenda?.data ?? "").localeCompare(b.os.agenda?.data ?? "") || horaA.localeCompare(horaB) || a.os.numero.localeCompare(b.os.numero, "pt-BR");
}

/** Mais urgente primeiro: paraquedas, emergencial e planejada; dentro do tipo, o prazo e o número. */
function porUrgencia<T extends { demanda: DemandaDoHoje | null; numero: string }>(a: T, b: T): number {
  const peso = (cartao: T) => TIPOS_DA_DEMANDA.indexOf(cartao.demanda?.tipo ?? "planejada");
  return peso(a) - peso(b) || (a.demanda?.executarAte ?? "9999").localeCompare(b.demanda?.executarAte ?? "9999") || a.numero.localeCompare(b.numero, "pt-BR");
}

export function quadroDoHoje(entrada: EntradaDoQuadro): QuadroDoHoje {
  const demandas = new Map(entrada.demandas.map((demanda) => [demanda.numero, demanda]));
  const termo = normalizar(entrada.busca.trim());
  const { tipo, entrada: porEntrada, cliente, pessoa } = entrada.filtros;
  const passaDemanda = (demanda: DemandaDoHoje | null, customerCode: string) =>
    (!tipo || (demanda?.tipo ?? "planejada") === tipo) &&
    (!porEntrada || (demanda?.entrada ?? "comercial") === porEntrada) &&
    (!cliente || customerCode === cliente);
  const busca = (...campos: Array<string | null | undefined>) => !termo || campos.some((campo) => campo && normalizar(campo).includes(termo));

  const ordens = entrada.ordens.map((os) => {
    const demanda = demandas.get(os.demanda) ?? null;
    return {
      os,
      cliente: nomeDoCliente(os.customer_code, entrada.nomesClientes),
      demanda,
      prazo: demanda?.entrada === "direta" ? prazoDaDemanda(demanda.executarAte, entrada.agora) : null,
      equipe: equipeDaOs(os, entrada.nomesPessoas),
      placas: placasDaOs(os, entrada.placas),
    } satisfies CartaoDeOs;
  });
  const visiveis = ordens.filter(
    (cartao) =>
      passaDemanda(cartao.demanda, cartao.os.customer_code) &&
      (!pessoa || idsDaEquipe(cartao.os).includes(pessoa)) &&
      busca(cartao.os.numero, cartao.os.demanda, cartao.cliente, cartao.demanda?.titulo),
  );
  const com = (status: OsDaFila["status"]) => visiveis.filter((cartao) => cartao.os.status === status);
  const agendadas = com("agendada");

  const paraPlanejar = entrada.demandas
    .filter((demanda) => demanda.etapa === "para_planejar" && !demanda.fora)
    .map((demanda) => ({
      demanda,
      cliente: nomeDoCliente(demanda.customerCode, entrada.nomesClientes),
      linhasComSaldo: demanda.escopo.length ? linhasComSaldo(demanda, entrada.ordens) : demanda.osNumeros.length ? 0 : 1,
      prazo: demanda.entrada === "direta" ? prazoDaDemanda(demanda.executarAte, entrada.agora) : null,
    }))
    .filter(
      (cartao) =>
        cartao.linhasComSaldo > 0 &&
        !pessoa &&
        passaDemanda(cartao.demanda, cartao.demanda.customerCode) &&
        busca(cartao.demanda.numero, cartao.cliente, cartao.demanda.titulo),
    )
    .sort((a, b) => porUrgencia({ ...a, numero: a.demanda.numero }, { ...b, numero: b.demanda.numero }));

  return {
    paraPlanejar,
    paraAgendar: com("aberta").sort((a, b) => porUrgencia({ ...a, numero: a.os.numero }, { ...b, numero: b.os.numero })),
    agendadasHoje: agendadas.filter((cartao) => cartao.os.agenda?.data === entrada.hoje).sort(porHora),
    proximosDias: agendadas.filter((cartao) => (cartao.os.agenda?.data ?? "") > entrada.hoje).sort(porHora),
    emExecucao: com("em_execucao").sort(porHora),
    emRevisao: com("em_revisao").sort(porHora),
  };
}

/** Os clientes e as pessoas que aparecem no quadro, para os filtros. */
export function opcoesDosFiltros(entrada: Pick<EntradaDoQuadro, "demandas" | "ordens" | "nomesClientes" | "nomesPessoas">) {
  const codigos = new Set([...entrada.demandas.filter((demanda) => demanda.etapa === "para_planejar").map((demanda) => demanda.customerCode), ...entrada.ordens.map((os) => os.customer_code)]);
  const clientes = [...codigos]
    .map((code) => ({ valor: code, rotulo: nomeDoCliente(code, entrada.nomesClientes) }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  const pessoas = new Map<string, string>();
  for (const os of entrada.ordens) {
    if (os.pessoas?.length) for (const pessoa of os.pessoas) pessoas.set(pessoa.id, pessoa.nome);
    else for (const id of os.agenda?.equipe ?? []) pessoas.set(id, entrada.nomesPessoas[id] || id);
  }
  return {
    clientes,
    pessoas: [...pessoas].map(([valor, rotulo]) => ({ valor, rotulo })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR")),
  };
}

const DIA_POR_EXTENSO = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" });

/** "Sexta, 23 de outubro · 9 OS · 1 demanda para planejar". */
export function resumoDoHoje(agora: Date, quadro: QuadroDoHoje): string {
  const dia = DIA_POR_EXTENSO.format(agora).replace(/^(\p{L})/u, (letra) => letra.toLocaleUpperCase("pt-BR")).replace("-feira", "");
  const ordens = quadro.paraAgendar.length + quadro.agendadasHoje.length + quadro.emExecucao.length + quadro.emRevisao.length;
  const partes = [dia, `${ordens} OS`];
  const planejar = quadro.paraPlanejar.length;
  if (planejar) partes.push(`${planejar} ${planejar === 1 ? "demanda" : "demandas"} para planejar`);
  return partes.join(" · ");
}

/** "Ana Lima +2". */
export function equipeCurta(nomes: readonly string[]): string | null {
  if (!nomes.length) return null;
  return nomes.length === 1 ? nomes[0] : `${nomes[0]} +${nomes.length - 1}`;
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "";
  const primeira = partes[0][0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] ?? "" : "";
  return `${primeira}${ultima}`.toLocaleUpperCase("pt-BR");
}
