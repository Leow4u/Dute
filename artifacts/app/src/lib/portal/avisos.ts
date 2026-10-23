import { MODELOS_DE_AVISO, type ModeloDeAviso } from "@workspace/dominio";

/**
 * O sino do portal (docs/plataforma/fase-4-financeiro.md, parte 4.6c;
 * docs/mockups/Portal.dc.html): os últimos avisos do cliente
 * (`client_notifications`, gravados pela rotina dos avisos da Operação) e
 * até quando este login os viu (`client_notification_reads/{uid}`). Abrir o
 * sino marca tudo como visto (`markNotificationsRead`).
 */

export const AVISOS_NO_SINO = 20;

export type AvisoDoPortal = {
  id: string;
  modelo: ModeloDeAviso;
  titulo: string;
  texto: string;
  /** A tela do portal que o aviso abre; nunca fora do portal. */
  link: string;
  criadoEm: Date | null;
};

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** O instante de um Timestamp do Firestore (ou de um texto ISO), ou null. */
export function instanteDe(valor: unknown): Date | null {
  if (valor && typeof (valor as { toDate?: unknown }).toDate === "function") {
    const data = (valor as { toDate: () => Date }).toDate();
    return Number.isNaN(data.getTime()) ? null : data;
  }
  if (typeof valor === "string" && !Number.isNaN(Date.parse(valor))) return new Date(valor);
  return null;
}

export function avisoDoPortal(id: string, dados: Record<string, unknown>): AvisoDoPortal | null {
  const modelo = texto(dados.modelo) as ModeloDeAviso;
  const titulo = texto(dados.titulo);
  const link = texto(dados.link);
  if (!(MODELOS_DE_AVISO as readonly string[]).includes(modelo) || !titulo) return null;
  return {
    id,
    modelo,
    titulo,
    texto: texto(dados.texto),
    link: /^\/portal(\/|\?|$)/.test(link) ? link : "/portal",
    criadoEm: instanteDe(dados.created_at) ?? instanteDe(dados.ocorrido_em),
  };
}

/** Até quando o login viu os avisos, ou null quando nunca abriu o sino. */
export function vistosAteDoDocumento(dados: Record<string, unknown> | null | undefined): Date | null {
  return instanteDe(dados?.lidos_ate);
}

/** O aviso chegou depois da última vez que o login abriu o sino. */
export function avisoNovo(aviso: Pick<AvisoDoPortal, "criadoEm">, vistosAte: Date | null): boolean {
  if (!vistosAte) return true;
  return Boolean(aviso.criadoEm && aviso.criadoEm.getTime() > vistosAte.getTime());
}

export function avisosNovos(avisos: readonly AvisoDoPortal[], vistosAte: Date | null): number {
  return avisos.filter((aviso) => avisoNovo(aviso, vistosAte)).length;
}

/** "Avisos", "Avisos: 1 novo", "Avisos: 3 novos". */
export function rotuloDoSino(novos: number): string {
  if (novos <= 0) return "Avisos";
  return `Avisos: ${novos} ${novos === 1 ? "novo" : "novos"}`;
}

const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false });

/** "agora", "há 12 min", "hoje 14:05", "ontem 09:10", "22/10 09:10" ou "22/10/2025". */
export function quandoDoAviso(criadoEm: Date | null, agora: Date): string {
  if (!criadoEm) return "";
  const minutos = Math.floor((agora.getTime() - criadoEm.getTime()) / 60_000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const dia = DIA.format(criadoEm);
  const hoje = DIA.format(agora);
  const ontem = DIA.format(new Date(agora.getTime() - 86_400_000));
  const hora = HORA.format(criadoEm);
  const [ano, mes, dd] = dia.split("-");
  if (dia === hoje) return `hoje ${hora}`;
  if (dia === ontem) return `ontem ${hora}`;
  if (ano !== hoje.slice(0, 4)) return `${dd}/${mes}/${ano}`;
  return `${dd}/${mes} ${hora}`;
}
