/**
 * O erro de uma resposta de `/api/*` que não deu certo: a mensagem do
 * servidor, não o corpo cru, com o código e o status. As respostas de erro
 * vêm como `{ message, code }` (lib/cloud-api.ts e lib/functions-api.ts), e o
 * toast que mostrava `error.message` mostrava o JSON
 * (docs/plataforma/diagnostico-carregamento.md, seção 9, item 2).
 */
export type ErroDaResposta = Error & { status: number; code?: string };

export function erroDaResposta(status: number, corpo: string): ErroDaResposta {
  let message = corpo.trim();
  let code: string | undefined;
  if (message.startsWith("{")) {
    try {
      const lido = JSON.parse(message) as { message?: unknown; error?: unknown; code?: unknown } | null;
      const texto = lido?.message ?? lido?.error;
      if (typeof texto === "string" && texto.trim()) message = texto.trim();
      if (typeof lido?.code === "string" && lido.code) code = lido.code;
    } catch {
      // Corpo sem JSON: a mensagem é o texto.
    }
  }
  return Object.assign(new Error(message || `HTTP ${status}`), code ? { status, code } : { status });
}
