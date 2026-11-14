/**
 * Sem conexão na leitura e na ação (docs/plataforma/diagnostico-carregamento.md,
 * seção 9, decisões 1 e 2 do celular, de 06/11/2026). Sem rede, a leitura
 * vira erro de conexão em vez de lista vazia, e a ação é recusada na hora em
 * vez de ficar parada e sair minutos depois.
 *
 * São duas faltas (carregamento v2, momento 8, e a parte 7a): o aparelho sem
 * rede é "Sem conexão"; o aparelho conectado com o servidor sem resposta (a
 * leitura que só achou o cache, o `unavailable`, a callable sem resposta) é o
 * "Reconectando". O SDK do Firestore se dá por offline depois de 10 s sem o
 * servidor e responde do cache mesmo com o aparelho conectado: aquilo não é
 * falta de rede. O que a tela mostra, com a histerese, é o estado único de
 * `lib/carregando/estado-da-conexao.ts`.
 */

/** O que a tela diz quando o aparelho está sem rede. */
export const SEM_CONEXAO = "Sem conexão. Tente de novo quando o sinal voltar.";

/**
 * O que a tela diz quando a chamada passou do prazo sem resposta (o
 * `deadline-exceeded` do SDK, aos 70 s; 180 s no chat e na foto por IA), no
 * lugar do código cru em inglês. A escrita pode ter valido: conferir antes de
 * repetir.
 */
export const PRAZO_ESGOTADO = "O servidor não respondeu a tempo. Confira antes de tentar de novo.";

/** O mesmo prazo na leitura, em que repetir é seguro: tentar de novo, sem conferir. */
export const PRAZO_ESGOTADO_NA_LEITURA = "O servidor não respondeu a tempo. Tente de novo.";

function prazoDaEscrita(): Error {
  return Object.assign(new Error(PRAZO_ESGOTADO), { code: "deadline-exceeded" });
}

/**
 * O prazo da escrita que anda em pedaços (os lotes do arquivo no Firestore,
 * que crescem com ele): conta de cada avanço, e não do começo. A gravação
 * lenta, mas andando, nunca desiste; a que para fica 70 s sem avançar e
 * rejeita com o `deadline-exceeded`. A escrita continua por baixo; quem chama
 * confere antes de repetir.
 */
export function comPrazoSemAvanco<T>(fazer: (avancou: () => void) => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolver, rejeitar) => {
    let terminou = false;
    let prazo: ReturnType<typeof setTimeout> | undefined;
    const armar = () => {
      clearTimeout(prazo);
      prazo = setTimeout(() => {
        terminou = true;
        rejeitar(prazoDaEscrita());
      }, ms);
    };
    const avancou = () => {
      if (!terminou) armar();
    };
    armar();
    let promessa: Promise<T>;
    try {
      promessa = Promise.resolve(fazer(avancou));
    } catch (erro) {
      promessa = Promise.reject(erro);
    }
    promessa.then(
      (valor) => {
        terminou = true;
        clearTimeout(prazo);
        resolver(valor);
      },
      (erro: unknown) => {
        terminou = true;
        clearTimeout(prazo);
        rejeitar(erro);
      },
    );
  });
}

/**
 * O prazo da escrita que não passa por callable (a gravação direta no
 * Firestore, que sem rede espera para sempre): a promessa que não termina
 * em `ms` rejeita com o `deadline-exceeded`, como a callable. A escrita
 * continua por baixo; quem chama confere antes de repetir.
 */
export function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolver, rejeitar) => {
    const prazo = setTimeout(() => rejeitar(prazoDaEscrita()), ms);
    promessa.then(
      (valor) => {
        clearTimeout(prazo);
        resolver(valor);
      },
      (erro: unknown) => {
        clearTimeout(prazo);
        rejeitar(erro);
      },
    );
  });
}

/** A chamada passou do prazo sem resposta: o servidor pode ter gravado ou não. */
export function prazoEsgotado(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? "").replace(/^functions\//, "");
  return code === "deadline-exceeded";
}

/** O código da resposta de `/api/*` (status 503) quando o aparelho está sem rede. */
export const CODIGO_SEM_CONEXAO = "sem_conexao";

/** O que a tela diz quando o aparelho está conectado e o servidor não respondeu (a especificação, seção 3). */
export const SEM_RESPOSTA = "Sem resposta do servidor.";

/** O código da resposta de `/api/*` (status 503) quando o servidor não respondeu ao aparelho conectado. */
export const CODIGO_SEM_RESPOSTA = "sem_resposta";

/** A leitura ou a ação não alcançou o servidor, com o aparelho sem rede. */
export class SemConexao extends Error {
  readonly code = CODIGO_SEM_CONEXAO;

  constructor() {
    super(SEM_CONEXAO);
    this.name = "SemConexao";
  }
}

/** A leitura ou a ação não alcançou o servidor, com o aparelho conectado. */
export class SemResposta extends Error {
  readonly code = CODIGO_SEM_RESPOSTA;

  constructor() {
    super(SEM_RESPOSTA);
    this.name = "SemResposta";
  }
}

/** O corpo da resposta de `/api/*` quando o aparelho está sem rede. */
export function corpoSemConexao() {
  return { message: SEM_CONEXAO, code: CODIGO_SEM_CONEXAO };
}

/** O corpo da resposta de `/api/*` quando o servidor não respondeu ao aparelho conectado. */
export function corpoSemResposta() {
  return { message: SEM_RESPOSTA, code: CODIGO_SEM_RESPOSTA };
}

/**
 * O aparelho sabe que está sem rede. `navigator.onLine` só erra para o lado
 * de "conectado" (sinal fraco); o "desconectado" é confiável.
 */
export function aparelhoSemRede(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * A falta de agora, pelo aparelho: sem rede, "Sem conexão"; conectado, o
 * servidor sem resposta. A ação sem rede continua recusada na hora com "Sem
 * conexão" (decisão 9.4.1).
 */
export function faltaDeAgora(): SemConexao | SemResposta {
  return aparelhoSemRede() ? new SemConexao() : new SemResposta();
}

/** O texto da falta de agora, para o erro que a tela mostra como está. */
export function mensagemDaFalta(): string {
  return faltaDeAgora().message;
}

/**
 * O corpo da resposta de `/api/*` para a leitura que não alcançou o
 * servidor: o da própria falta, quando ela já diz qual é, ou o da falta de
 * agora (o `unavailable` do SDK não diz).
 */
export function corpoDaFalta(error?: unknown) {
  const falta = error instanceof SemConexao || error instanceof SemResposta ? error : faltaDeAgora();
  return { message: falta.message, code: falta.code };
}

/**
 * A callable não teve resposta nenhuma. Quando o fetch nem chega a uma
 * resposta (status 0), o SDK do Firebase devolve o código `internal` com a
 * mensagem "internal", em minúsculas; a falha do servidor vem com a mensagem
 * dele ("INTERNAL" ou o texto do HttpsError) e continua sendo do servidor.
 * Com o aparelho conectado, é o servidor sem resposta, e não falta de rede: o
 * texto é o de `mensagemDaFalta`. O resultado da ação continua incerto, e a
 * repetição leva a mesma chave (`useAcaoNaLinha`).
 */
export function callableSemResposta(error: unknown): boolean {
  if (aparelhoSemRede()) return true;
  const code = String((error as { code?: unknown } | null)?.code ?? "").replace(/^functions\//, "");
  return code === "internal" && error instanceof Error && error.message === "internal";
}

/**
 * A leitura do Firestore não alcançou o servidor: a que só achou o cache da
 * memória (`SemConexao` ou `SemResposta`, pelo aparelho) ou a que o SDK
 * recusou por se achar offline (`unavailable`, no `getDoc` do documento que
 * não está na memória e na contagem).
 */
export function firestoreSemConexao(error: unknown): boolean {
  return (
    error instanceof SemConexao ||
    error instanceof SemResposta ||
    (error as { code?: unknown } | null)?.code === "unavailable"
  );
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
 * O erro que a tela recebeu tem o código (ou só a mensagem) da falta: o
 * próprio erro, o `ApiError` da resposta 503 com o código, ou o erro dos
 * `fetchJson` das telas, que guardam na mensagem o corpo da resposta ou só a
 * mensagem dele.
 */
function temAFalta(error: unknown, codigo: string, mensagem: string): boolean {
  if (!error || typeof error !== "object") return false;
  if ((error as { code?: unknown }).code === codigo) return true;
  const data = (error as { data?: unknown }).data;
  if (data && typeof data === "object" && (data as { code?: unknown }).code === codigo) return true;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  return message === mensagem || codigoNoTexto(message) === codigo;
}

/** O erro que a tela recebeu é do aparelho sem rede. */
export function ehSemConexao(error: unknown): boolean {
  return temAFalta(error, CODIGO_SEM_CONEXAO, SEM_CONEXAO);
}

/** O erro que a tela recebeu é do servidor sem resposta, com o aparelho conectado. */
export function ehSemResposta(error: unknown): boolean {
  return temAFalta(error, CODIGO_SEM_RESPOSTA, SEM_RESPOSTA);
}

/**
 * O erro que a tela recebeu é falta de conexão, das duas: o aparelho sem
 * rede ou o servidor sem resposta. A lista que já estava fica, e o app relê
 * sozinho (`lib/carregando/estado-da-conexao.ts`).
 */
export function ehFaltaDeConexao(error: unknown): boolean {
  return ehSemConexao(error) || ehSemResposta(error);
}

/** O pedaço da leitura do react-query que a tela usa para decidir. */
export type LeituraNaTela = { data: unknown; error: unknown; dataUpdatedAt: number };

/**
 * Na falta de conexão, o que a tela mostra (decisão 2 do celular): a lista
 * que já estava, marcada com a hora da última leitura (`lidaEm`), ou o aviso
 * no lugar dela quando ainda não há nada lido (`lidaEm: null`). Sem falta de
 * conexão, `null`, e a tela segue como sempre. Recebe só as leituras que a
 * tela precisa para a lista (a desligada fica de fora). Vale para as duas
 * faltas; se o aviso diz "Sem conexão" ou "Reconectando…" é o estado único da
 * conexão (`FaixaSemConexao` e `BlocoSemConexao`).
 */
export function semConexaoNaLeitura(...leituras: LeituraNaTela[]): { lidaEm: number | null } | null {
  const semRede = leituras.filter((leitura) => ehFaltaDeConexao(leitura.error));
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
