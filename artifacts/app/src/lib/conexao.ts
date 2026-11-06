/**
 * Sem conexão na leitura e na ação (docs/plataforma/diagnostico-carregamento.md,
 * seção 9, decisões 1 e 2 do celular, de 06/11/2026). Sem rede, a leitura
 * vira erro de conexão em vez de lista vazia, e a ação é recusada na hora em
 * vez de ficar parada e sair minutos depois.
 */

/** O que a tela diz quando a leitura ou a ação não alcançou o servidor. */
export const SEM_CONEXAO = "Sem conexão. Tente de novo quando o sinal voltar.";

/** O código da resposta de `/api/*` (status 503) quando faltou conexão. */
export const CODIGO_SEM_CONEXAO = "sem_conexao";

/** A leitura ou a ação não alcançou o servidor. */
export class SemConexao extends Error {
  readonly code = CODIGO_SEM_CONEXAO;

  constructor() {
    super(SEM_CONEXAO);
    this.name = "SemConexao";
  }
}

/** O corpo da resposta de `/api/*` quando faltou conexão. */
export function corpoSemConexao() {
  return { message: SEM_CONEXAO, code: CODIGO_SEM_CONEXAO };
}

/**
 * O aparelho sabe que está sem rede. `navigator.onLine` só erra para o lado
 * de "conectado" (sinal fraco); o "desconectado" é confiável.
 */
export function aparelhoSemRede(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * A callable não teve resposta nenhuma. Quando o fetch nem chega a uma
 * resposta (status 0), o SDK do Firebase devolve o código `internal` com a
 * mensagem "internal", em minúsculas; a falha do servidor vem com a mensagem
 * dele ("INTERNAL" ou o texto do HttpsError) e continua sendo do servidor.
 */
export function callableSemResposta(error: unknown): boolean {
  if (aparelhoSemRede()) return true;
  const code = String((error as { code?: unknown } | null)?.code ?? "").replace(/^functions\//, "");
  return code === "internal" && error instanceof Error && error.message === "internal";
}

/**
 * A leitura do Firestore não alcançou o servidor: a que só achou o cache da
 * memória (`SemConexao`) ou a que o SDK recusou por estar sem rede
 * (`unavailable`, no `getDoc` do documento que não está na memória e na
 * contagem).
 */
export function firestoreSemConexao(error: unknown): boolean {
  return error instanceof SemConexao || (error as { code?: unknown } | null)?.code === "unavailable";
}

function codigoNoTexto(texto: string): unknown {
  if (!texto.trimStart().startsWith("{")) return undefined;
  try {
    return (JSON.parse(texto) as { code?: unknown } | null)?.code;
  } catch {
    return undefined;
  }
}

/**
 * O erro que a tela recebeu é falta de conexão: o `SemConexao`, o `ApiError`
 * da resposta 503 com o código, ou o erro dos `fetchJson` das telas, que
 * guardam na mensagem o corpo da resposta ou só a mensagem dele.
 */
export function ehSemConexao(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ((error as { code?: unknown }).code === CODIGO_SEM_CONEXAO) return true;
  const data = (error as { data?: unknown }).data;
  if (data && typeof data === "object" && (data as { code?: unknown }).code === CODIGO_SEM_CONEXAO) return true;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  return message === SEM_CONEXAO || codigoNoTexto(message) === CODIGO_SEM_CONEXAO;
}

/** O pedaço da leitura do react-query que a tela usa para decidir. */
export type LeituraNaTela = { data: unknown; error: unknown; dataUpdatedAt: number };

/**
 * Sem rede, o que a tela mostra (decisão 2 do celular): a lista que já
 * estava, marcada com a hora da última leitura (`lidaEm`), ou o aviso no
 * lugar dela quando ainda não há nada lido (`lidaEm: null`). Sem falta de
 * conexão, `null`, e a tela segue como sempre. Recebe só as leituras que a
 * tela precisa para a lista (a desligada fica de fora).
 */
export function semConexaoNaLeitura(...leituras: LeituraNaTela[]): { lidaEm: number | null } | null {
  const semRede = leituras.filter((leitura) => ehSemConexao(leitura.error));
  if (!semRede.length) return null;
  if (leituras.some((leitura) => leitura.data === undefined)) return { lidaEm: null };
  return { lidaEm: Math.min(...semRede.map((leitura) => leitura.dataUpdatedAt)) };
}

const HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "10:42": a hora da última leitura, no fuso do armazém. */
export function horaDaLeitura(quando: number): string {
  return HORA.format(new Date(quando));
}
