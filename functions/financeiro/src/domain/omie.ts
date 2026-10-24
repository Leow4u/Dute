/**
 * O cliente da API da Omie (parte 7.4a; desenho em
 * docs/plataforma/fase-7-financeiro-unificado.md, "A NFS-e pela Omie").
 *
 * A API é sempre POST com JSON, em https://app.omie.com.br/api/v1/<serviço>/,
 * com o corpo `{call, app_key, app_secret, param: [ {...} ]}`. O erro volta
 * com `faultstring` e `faultcode`, quase sempre com HTTP 500, inclusive a
 * recusa de negócio. Por isso a falha é classificada pelo texto e pelo
 * status, e quem chama espaça as tentativas e para depois de algumas: a
 * Omie bloqueia o método por 30 minutos depois de 10 erros seguidos.
 *
 * Os limites (ajuda.omie.com.br, "Limites de consumo da API"): 240 chamadas
 * por minuto por método, 4 simultâneas, e a mesma consulta repetida em 60
 * segundos só traz dados na primeira (consumo redundante). A rotina faz uma
 * chamada por vez.
 */

export const OMIE_API = "https://app.omie.com.br/api/v1";

export const SERVICOS_DA_OMIE = ["geral/clientes", "servicos/os", "servicos/osp", "financas/contareceber", "financas/pesquisartitulos"] as const;
export type ServicoDaOmie = (typeof SERVICOS_DA_OMIE)[number];

export type ChavesDaOmie = { app_key: string; app_secret: string };

/** O transporte HTTP; nos testes, um de mentira. */
export type TransporteDaOmie = (url: string, corpo: string) => Promise<{ status: number; corpo: unknown }>;

export type TipoDeFalha = "chave" | "limite" | "instavel" | "duplicado" | "recusa";

export type FalhaDaOmie = {
  tipo: TipoDeFalha;
  /** A mensagem da Omie, sem as chaves. */
  mensagem: string;
  /** Quanto esperar antes da próxima chamada a esse método. */
  esperar_ms: number;
};

export class ErroDaOmie extends Error {
  constructor(readonly falha: FalhaDaOmie) {
    super(falha.mensagem);
    this.name = "ErroDaOmie";
  }
}

const MINUTO = 60_000;

function textoDaFalha(corpo: unknown): string {
  if (!corpo || typeof corpo !== "object") return "";
  const registro = corpo as Record<string, unknown>;
  for (const campo of ["faultstring", "message", "descricao_status", "cDescStatus"]) {
    const valor = registro[campo];
    if (typeof valor === "string" && valor.trim()) return valor.trim().slice(0, 500);
  }
  return "";
}

/**
 * A falha da resposta, ou null quando deu certo. A ordem importa: a chave
 * inválida para tudo; o limite e a instabilidade esperam e tentam de novo;
 * o duplicado é a idempotência funcionando; o resto é recusa, que também
 * tenta de novo algumas vezes, porque a Omie devolve 500 para os dois.
 */
export function classificarResposta(status: number, corpo: unknown): FalhaDaOmie | null {
  const texto = textoDaFalha(corpo);
  const temFalha = Boolean(corpo && typeof corpo === "object" && "faultstring" in corpo);
  if (status >= 200 && status < 300 && !temFalha) return null;
  const mensagem = texto || `A Omie respondeu ${status} sem mensagem.`;
  if (/chave de acesso|app_key|app_secret|aplicativo.*(inativo|bloqueado|suspenso)|acesso.*pausado/i.test(texto) || status === 401) {
    return { tipo: "chave", mensagem, esperar_ms: 0 };
  }
  if (status === 429 || /too many requests/i.test(texto)) return { tipo: "limite", mensagem, esperar_ms: MINUTO };
  // O bloqueio de consumo é do método; "Cliente bloqueado" é recusa de negócio.
  if (status === 425 || /consumo indevido|m[eé]todo.{0,40}bloquead|bloquead.{0,40}(minutos|requisi)/i.test(texto)) {
    return { tipo: "limite", mensagem, esperar_ms: 30 * MINUTO };
  }
  if (/consumo redundante/i.test(texto)) return { tipo: "limite", mensagem, esperar_ms: MINUTO };
  if (/j[aá] cadastrad[oa].*c[oó]digo de integra[cç][aã]o/i.test(texto)) return { tipo: "duplicado", mensagem, esperar_ms: 0 };
  if (/PROTO_BYEBYE|timeout|tempo limite|indispon[ií]vel|instabilidade/i.test(texto) || (status >= 500 && !texto)) {
    return { tipo: "instavel", mensagem, esperar_ms: 2 * MINUTO };
  }
  return { tipo: "recusa", mensagem, esperar_ms: 2 * MINUTO };
}

/** O corpo da chamada. As chaves só existem aqui e nunca vão para log nem evento. */
export function corpoDaChamada(chaves: ChavesDaOmie, call: string, param: Record<string, unknown>): string {
  return JSON.stringify({ call, app_key: chaves.app_key, app_secret: chaves.app_secret, param: [param] });
}

/** Tira as chaves de um texto antes de guardar a mensagem. */
export function semChaves(texto: string, chaves: ChavesDaOmie): string {
  let limpo = texto;
  for (const segredo of [chaves.app_key, chaves.app_secret]) if (segredo) limpo = limpo.split(segredo).join("***");
  return limpo;
}

export async function chamarOmie(
  transporte: TransporteDaOmie,
  chaves: ChavesDaOmie,
  servico: ServicoDaOmie,
  call: string,
  param: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let resposta: { status: number; corpo: unknown };
  try {
    resposta = await transporte(`${OMIE_API}/${servico}/`, corpoDaChamada(chaves, call, param));
  } catch (error) {
    const mensagem = semChaves(error instanceof Error ? error.message : String(error), chaves);
    throw new ErroDaOmie({ tipo: "instavel", mensagem: `Sem resposta da Omie: ${mensagem}`.slice(0, 500), esperar_ms: 2 * MINUTO });
  }
  const falha = classificarResposta(resposta.status, resposta.corpo);
  if (falha) throw new ErroDaOmie({ ...falha, mensagem: semChaves(falha.mensagem, chaves) });
  if (!resposta.corpo || typeof resposta.corpo !== "object") {
    throw new ErroDaOmie({ tipo: "instavel", mensagem: "A Omie respondeu sem corpo.", esperar_ms: 2 * MINUTO });
  }
  return resposta.corpo as Record<string, unknown>;
}

/** O transporte de verdade, pelo fetch do Node, com o tempo limite de 30 segundos. */
export function transportePeloFetch(buscar: typeof fetch = fetch): TransporteDaOmie {
  return async (url, corpo) => {
    const resposta = await buscar(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corpo,
      signal: AbortSignal.timeout(30_000),
    });
    const texto = await resposta.text();
    let lido: unknown = null;
    try {
      lido = texto ? JSON.parse(texto) : null;
    } catch {
      lido = { faultstring: texto.slice(0, 500) };
    }
    return { status: resposta.status, corpo: lido };
  };
}
