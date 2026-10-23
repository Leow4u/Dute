import { formatarPlaca } from "../operacao/cadastro";
import { ETAPAS_DA_OS, ETAPA_ROTULO, type EtapaDaOs } from "../operacao/ficha-da-os";
import { SERVICO_ROTULO, duracao, iniciais } from "../operacao/hoje";

/**
 * A TV da sala (docs/plataforma/fase-3-operacao.md, parte 3.12b;
 * docs/mockups/TVSala.dc.html): o quadro que a callable getRoomBoard devolve
 * (só o que a TV mostra, parte 3.12a) vira as três colunas, os indicadores e
 * a próxima saída. O atraso conta pelo relógio da TV, que anda entre uma
 * leitura e outra. Nunca valor.
 */

export const COLUNAS_DA_TV = ["agendada", "em_execucao", "concluida"] as const;
export type ColunaDaTv = (typeof COLUNAS_DA_TV)[number];

export type OsDaTv = {
  numero: string;
  tipo: "servico" | "vistoria";
  coluna: ColunaDaTv;
  cliente: string;
  servicos: string[];
  rota: string | null;
  /** O dia da janela (AAAA-MM-DD). */
  dia: string | null;
  /** A hora marcada, em UTC. */
  inicio: string | null;
  /** O prazo, em UTC. */
  ate: string | null;
  etapa: { etapa: EtapaDaOs; instante: string } | null;
  etapas: { feitas: number; previstas: number };
  concluidaEm: string | null;
  aceite: "assinatura" | "sem_aceite" | null;
  equipe: string[];
  placas: string[];
};

export type QuadroDaTv = { hoje: string; geradoEm: string; ordens: OsDaTv[] };

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function instante(valor: unknown): string | null {
  const lido = texto(valor);
  return lido && !Number.isNaN(Date.parse(lido)) ? lido : null;
}

function textos(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.map(texto).filter(Boolean) : [];
}

function contagem(valor: unknown): number {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 ? valor : 0;
}

function osLida(bruto: Registro): OsDaTv | null {
  const numero = texto(bruto.numero);
  const coluna = texto(bruto.coluna);
  if (!/^\d{5,8}-\d{2}$/.test(numero) || !(COLUNAS_DA_TV as readonly string[]).includes(coluna)) return null;
  const etapaBruta = bruto.etapa && typeof bruto.etapa === "object" ? (bruto.etapa as Registro) : null;
  const nomeDaEtapa = texto(etapaBruta?.etapa);
  const quando = instante(etapaBruta?.instante);
  const etapas = bruto.etapas && typeof bruto.etapas === "object" ? (bruto.etapas as Registro) : {};
  const dia = texto(bruto.dia);
  const aceite = texto(bruto.aceite);
  return {
    numero,
    tipo: bruto.tipo === "vistoria" ? "vistoria" : "servico",
    coluna: coluna as ColunaDaTv,
    cliente: texto(bruto.cliente),
    servicos: textos(bruto.servicos),
    rota: texto(bruto.rota) || null,
    dia: /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : null,
    inicio: instante(bruto.inicio),
    ate: instante(bruto.ate),
    etapa: quando && (ETAPAS_DA_OS as readonly string[]).includes(nomeDaEtapa) ? { etapa: nomeDaEtapa as EtapaDaOs, instante: quando } : null,
    etapas: { feitas: contagem(etapas.feitas), previstas: contagem(etapas.previstas) },
    concluidaEm: instante(bruto.concluida_em),
    aceite: aceite === "assinatura" || aceite === "sem_aceite" ? aceite : null,
    equipe: textos(bruto.equipe),
    placas: textos(bruto.placas),
  };
}

/** O quadro como a callable devolve; a OS que não se lê fica de fora. */
export function quadroLido(bruto: unknown): QuadroDaTv | null {
  if (!bruto || typeof bruto !== "object") return null;
  const quadro = bruto as Registro;
  const geradoEm = instante(quadro.gerado_em);
  if (!geradoEm) return null;
  const ordens = Array.isArray(quadro.ordens)
    ? quadro.ordens.flatMap((os) => (os && typeof os === "object" ? [osLida(os as Registro)].filter((lida): lida is OsDaTv => lida !== null) : []))
    : [];
  return { hoje: texto(quadro.hoje), geradoEm, ordens };
}

// --- O relógio -------------------------------------------------------------------------------

const HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const DATA_LONGA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" });

/** "14:32". */
export function horaDaTv(quando: Date | string): string {
  return HORA.format(typeof quando === "string" ? new Date(quando) : quando);
}

/** "Sexta-feira, 23 de outubro". */
export function dataDaTv(agora: Date): string {
  const data = DATA_LONGA.format(agora);
  return `${data.charAt(0).toLocaleUpperCase("pt-BR")}${data.slice(1)}`;
}

function diaDe(quando: Date): string {
  return DIA.format(quando);
}

/** "22/10". */
function diaCurto(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

// --- O cartão --------------------------------------------------------------------------------

export type TomDoSelo = "critico" | "alerta" | "ok";

/** O ícone do cartão: o serviço que leva a OS. */
export type IconeDaOs = "transporte" | "montagem" | "armazenagem" | "vistoria";

export type CartaoDaTv = {
  numero: string;
  hora: string;
  cliente: string;
  icone: IconeDaOs;
  descricao: string;
  /** "Ana Lima + 1", ou null sem equipe. */
  equipe: string | null;
  iniciais: string | null;
  /** "ABC-1D23", ou null sem veículo. */
  placa: string | null;
  selo: { texto: string; tom: TomDoSelo } | null;
  atrasada: boolean;
  /** Na em execução: "Chegada na origem · 10:10". */
  etapa: string | null;
  progresso: { feitas: number; previstas: number } | null;
};

const LISTA = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });

/** "Transporte", "Desmontagem, transporte e montagem", "Vistoria". */
export function servicoDaOs(os: Pick<OsDaTv, "tipo" | "servicos">): string {
  if (os.tipo === "vistoria") return SERVICO_ROTULO.vistoria;
  const rotulos = os.servicos.map((servico) => SERVICO_ROTULO[servico] ?? servico);
  if (!rotulos.length) return "Serviço";
  const lista = LISTA.format(rotulos.map((rotulo, i) => (i === 0 ? rotulo : rotulo.toLocaleLowerCase("pt-BR"))));
  return lista;
}

function iconeDaOs(os: Pick<OsDaTv, "tipo" | "servicos">): IconeDaOs {
  if (os.tipo === "vistoria") return "vistoria";
  if (os.servicos.includes("transporte")) return "transporte";
  if (os.servicos.includes("armazenagem") || os.servicos.includes("embalagem")) return "armazenagem";
  return "montagem";
}

/** O atraso pelo relógio: a agendada que passou da hora (ou do dia) sem começar; a em execução que passou do prazo. */
export function atrasoDaOs(os: OsDaTv, agora: Date): string | null {
  const hoje = diaDe(agora);
  if (os.coluna === "agendada") {
    if (os.dia && os.dia < hoje) return `Atrasada desde ${diaCurto(os.dia)}`;
    if (os.inicio && Date.parse(os.inicio) < agora.getTime()) return `Atrasada ${duracao(agora.getTime() - Date.parse(os.inicio))}`;
    return null;
  }
  if (os.coluna === "em_execucao" && os.ate && Date.parse(os.ate) < agora.getTime()) {
    return `Atrasada ${duracao(agora.getTime() - Date.parse(os.ate))}`;
  }
  return null;
}

function prazoEmTexto(ate: string, agora: Date): string {
  const quando = new Date(ate);
  const dia = diaDe(quando);
  return dia === diaDe(agora) ? `até ${horaDaTv(quando)}` : `até ${diaCurto(dia)} ${horaDaTv(quando)}`;
}

function horaDoCartao(os: OsDaTv, agora: Date): string {
  if (os.coluna === "concluida") return os.concluidaEm ? horaDaTv(os.concluidaEm) : "Sem hora";
  if (os.inicio) return horaDaTv(os.inicio);
  if (os.dia && os.dia !== diaDe(agora)) return diaCurto(os.dia);
  return "Sem hora";
}

function seloDaOs(os: OsDaTv, atraso: string | null): CartaoDaTv["selo"] {
  if (atraso) return { texto: atraso, tom: "critico" };
  if (os.coluna === "concluida") {
    if (os.tipo === "vistoria") return { texto: "Enviada ao Comercial", tom: "ok" };
    return { texto: os.aceite === "assinatura" ? "Assinada" : "Concluída", tom: "ok" };
  }
  if (os.coluna === "agendada") {
    if (!os.equipe.length) return { texto: "Sem equipe", tom: "alerta" };
    if (os.servicos.includes("transporte") && !os.placas.length) return { texto: "Sem veículo", tom: "alerta" };
  }
  return null;
}

function comMais(primeiro: string, total: number): string {
  return total > 1 ? `${primeiro} + ${total - 1}` : primeiro;
}

export function cartaoDaTv(os: OsDaTv, agora: Date): CartaoDaTv {
  const atraso = atrasoDaOs(os, agora);
  const partes = [servicoDaOs(os), os.rota, os.coluna !== "concluida" && os.ate ? prazoEmTexto(os.ate, agora) : null].filter((parte): parte is string => Boolean(parte));
  const emExecucao = os.coluna === "em_execucao";
  return {
    numero: os.numero,
    hora: horaDoCartao(os, agora),
    cliente: os.cliente,
    icone: iconeDaOs(os),
    descricao: partes.join(" · "),
    equipe: os.equipe.length ? comMais(os.equipe[0], os.equipe.length) : null,
    iniciais: os.equipe.length ? iniciais(os.equipe[0]) : null,
    placa: os.placas.length ? comMais(formatarPlaca(os.placas[0]), os.placas.length) : null,
    selo: seloDaOs(os, atraso),
    atrasada: atraso !== null,
    etapa: emExecucao && os.etapa ? `${ETAPA_ROTULO[os.etapa.etapa]} · ${horaDaTv(os.etapa.instante)}` : null,
    progresso: emExecucao && os.etapas.previstas > 0 ? { feitas: Math.min(os.etapas.feitas, os.etapas.previstas), previstas: os.etapas.previstas } : null,
  };
}

// --- O painel --------------------------------------------------------------------------------

export type IndicadoresDaTv = { total: number; agendadas: number; emExecucao: number; concluidas: number; atrasadas: number };

export type PainelDaTv = {
  agendadas: CartaoDaTv[];
  emExecucao: CartaoDaTv[];
  concluidas: CartaoDaTv[];
  indicadores: IndicadoresDaTv;
  /** A agendada de hoje que sai em seguida; null sem nenhuma. */
  proximaSaida: { hora: string; cliente: string } | null;
};

/** A atrasada sobe para o topo da coluna; o resto segue a ordem do quadro. */
function atrasadasPrimeiro(cartoes: CartaoDaTv[]): CartaoDaTv[] {
  return [...cartoes.filter((cartao) => cartao.atrasada), ...cartoes.filter((cartao) => !cartao.atrasada)];
}

export function painelDaTv(quadro: QuadroDaTv, agora: Date): PainelDaTv {
  const da = (coluna: ColunaDaTv) => quadro.ordens.filter((os) => os.coluna === coluna);
  const agendadas = atrasadasPrimeiro(da("agendada").map((os) => cartaoDaTv(os, agora)));
  const emExecucao = atrasadasPrimeiro(da("em_execucao").map((os) => cartaoDaTv(os, agora)));
  const concluidas = da("concluida").map((os) => cartaoDaTv(os, agora));
  const proxima = da("agendada")
    .filter((os) => os.inicio && Date.parse(os.inicio) >= agora.getTime())
    .sort((a, b) => Date.parse(a.inicio!) - Date.parse(b.inicio!))[0];
  return {
    agendadas,
    emExecucao,
    concluidas,
    indicadores: {
      total: agendadas.length + emExecucao.length + concluidas.length,
      agendadas: agendadas.length,
      emExecucao: emExecucao.length,
      concluidas: concluidas.length,
      atrasadas: [...agendadas, ...emExecucao].filter((cartao) => cartao.atrasada).length,
    },
    proximaSaida: proxima ? { hora: horaDaTv(proxima.inicio!), cliente: proxima.cliente } : null,
  };
}

/** De quanto em quanto a TV relê o quadro e anda o relógio. */
export const RELEITURA_MS = 30_000;
export const RELOGIO_MS = 15_000;
