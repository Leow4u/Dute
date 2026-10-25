import type { CallableDaOperacao } from "../operacao/api";

/**
 * A fila de registros do campo (docs/plataforma/fase-3-operacao.md, partes
 * 3.8b e 3.8c). Cada toque no celular vira um registro com a própria chave
 * de idempotência e o instante em que aconteceu; a fila envia um de cada vez,
 * na ordem. Sem sinal, o registro espera e volta a ser enviado depois: a
 * callable grava uma vez só (mesma chave), com o instante original.
 *
 * O feito de uma linha é absoluto: dois toques seguidos na mesma linha viram
 * um registro só, o último (o grupo).
 */

export type FotoDoRegistro = { caminho: string; arquivo: Blob; contentType: string };

export type RegistroNaFila = {
  chave: string;
  callable: CallableDaOperacao;
  dados: Record<string, unknown>;
  /** Registros do mesmo grupo se substituem enquanto esperam: só o último vai. */
  grupo: string | null;
  /** A foto que sobe ao Storage antes da callable (attachPhoto). */
  foto: FotoDoRegistro | null;
  /** O que a tela mostra enquanto o registro espera: "Saída da origem", "Foto". */
  rotulo: string;
  criadoEm: string;
  tentativas: number;
  /** Depois de uma falha de rede, quando tentar de novo (ISO), ou null. */
  esperarAte: string | null;
};

export type NovoRegistro = Pick<RegistroNaFila, "callable" | "dados" | "rotulo"> & Partial<Pick<RegistroNaFila, "grupo" | "foto">>;

/** O registro que a callable recusou: fica na lista até a pessoa dispensar. */
export type FalhaDaFila = { chave: string; rotulo: string; mensagem: string };

/** Um registro novo, com a chave dentro dos dados (é a idempotency_key da callable). */
export function registroNovo(novo: NovoRegistro, chave: string, agora: Date): RegistroNaFila {
  return {
    chave,
    callable: novo.callable,
    dados: { ...novo.dados, idempotency_key: chave },
    grupo: novo.grupo ?? null,
    foto: novo.foto ?? null,
    rotulo: novo.rotulo,
    criadoEm: agora.toISOString(),
    tentativas: 0,
    esperarAte: null,
  };
}

/**
 * Põe o registro na fila. Do mesmo grupo, o novo substitui o que ainda não
 * foi enviado (menos o que está indo agora, que segue).
 */
export function enfileirar(fila: readonly RegistroNaFila[], registro: RegistroNaFila, enviando: string | null = null): RegistroNaFila[] {
  const semOMesmoGrupo = registro.grupo ? fila.filter((item) => item.grupo !== registro.grupo || item.chave === enviando) : [...fila];
  return [...semOMesmoGrupo, registro];
}

/** O que fazer com o erro: tentar de novo depois (sem sinal, servidor fora) ou desistir e avisar. */
export type DestinoDoErro = "tentar_de_novo" | "desistir";

const DEFINITIVOS = new Set(["invalid-argument", "failed-precondition", "permission-denied", "not-found", "already-exists", "unauthenticated", "out-of-range"]);

export function destinoDoErro(error: unknown): DestinoDoErro {
  const code = String((error as { code?: unknown })?.code ?? "").replace(/^functions\//, "");
  return DEFINITIVOS.has(code) ? "desistir" : "tentar_de_novo";
}

/** Espera antes de tentar de novo: 2 s, 4 s, 8 s... até 1 minuto. */
export function esperaDaTentativa(tentativas: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, tentativas - 1));
}

/** O registro depois de uma falha de rede: mais uma tentativa e a espera até a próxima. */
export function adiado(registro: RegistroNaFila, agora: Date): RegistroNaFila {
  const tentativas = registro.tentativas + 1;
  return { ...registro, tentativas, esperarAte: new Date(agora.getTime() + esperaDaTentativa(tentativas)).toISOString() };
}

/** Quantos milissegundos faltam para o registro poder ser enviado (0: já pode). */
export function faltaParaEnviar(registro: Pick<RegistroNaFila, "esperarAte">, agora: Date): number {
  if (!registro.esperarAte) return 0;
  return Math.max(0, Date.parse(registro.esperarAte) - agora.getTime());
}

/** "Sem sinal · 4 registros guardados"; "Enviando 2 registros"; null quando nada espera. */
export function avisoDaFila(pendentes: number, online: boolean): string | null {
  if (!pendentes) return online ? null : "Sem sinal";
  const registros = `${pendentes} ${pendentes === 1 ? "registro guardado" : "registros guardados"}`;
  return online ? `Enviando · ${registros}` : `Sem sinal · ${registros}`;
}
