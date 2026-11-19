import { callableSemResposta, mensagemDaFalta } from "../conexao";
import { mensagemDoErro } from "../operacao/api";

/**
 * O erro de uma callable do WMS na tela: a mensagem para quem opera (a falta
 * de conexão tem a dela), o código da callable (`failed-precondition`, para a
 * tentativa da escrita saber que nada foi gravado) e o motivo do servidor em
 * `detalhe` (`details.code`: `BOX_RECOUNT_LIST_CHANGED`, `COUNT_ROUND_NOT_OPEN`
 * e os outros).
 */
export type ErroDaCallable = Error & { code?: string; detalhe?: string };

/** O motivo da recusa que o servidor mandou em `details.code`; "" sem ele. */
export function detalheDaRecusa(erro: unknown): string {
  return String((erro as { detalhe?: unknown } | null)?.detalhe ?? "");
}

export function erroDaCallable(error: unknown): ErroDaCallable {
  const codigo = String((error as { code?: unknown } | null)?.code ?? "").replace(/^functions\//, "");
  const detalhes = (error as { details?: unknown } | null)?.details;
  const detalhe = detalhes && typeof detalhes === "object" ? String((detalhes as { code?: unknown }).code ?? "") : "";
  return Object.assign(new Error(callableSemResposta(error) ? mensagemDaFalta() : mensagemDoErro(error)), {
    ...(codigo ? { code: codigo } : {}),
    ...(detalhe ? { detalhe } : {}),
  });
}
