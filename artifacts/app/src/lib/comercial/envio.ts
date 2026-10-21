import { hrefDoDocumento } from "./documento";
import { payloadAvancar } from "./montar";
import type { ItemDaFila, StatusOrcamento } from "./orcamentos";

/**
 * O envio ao cliente (parte 12a; "Envio" em docs/plataforma/fase-6-comercial.md):
 * "Enviar" grava no servidor (advanceQuote send: aprovado → enviado, congela
 * a RV em revisoes/{rv}) e SÓ ENTÃO abre o documento para imprimir ou salvar
 * o PDF, que vai pelo Outlook, como hoje. O owner tem "Aprovar e enviar"
 * (approve_and_send), do "para aprovar", numa transação só. Se a gravação
 * falha, o documento não abre: nada sai como enviado sem estar enviado.
 */

export type AcaoDeEnvio = "send" | "approve_and_send";

export const ROTULO_DO_ENVIO: Record<AcaoDeEnvio, string> = {
  send: "Enviar",
  approve_and_send: "Aprovar e enviar",
};

/** O que advanceQuote devolve (AdvanceQuoteResult): a RV enviada e a situação depois. */
export type ResultadoDoEnvio = { rv: number; status: StatusOrcamento | string; edicao: number; etapa?: string };

export async function enviarEAbrirDocumento(entrada: {
  acao: AcaoDeEnvio;
  /** A situação e a edição que a tela viu (expected_status e expected_edicao). */
  orcamento: { numero: string; status: StatusOrcamento | string; edicao: number };
  chave: string;
  chamar: (payload: Record<string, unknown>) => Promise<ResultadoDoEnvio>;
  abrir: (href: string) => void;
}): Promise<ResultadoDoEnvio> {
  const resultado = await entrada.chamar(payloadAvancar(entrada.acao, entrada.orcamento, entrada.chave));
  // A RV que o servidor enviou (e congelou), não a que a tela tinha.
  entrada.abrir(hrefDoDocumento(entrada.orcamento.numero, resultado.rv, { imprimir: true }));
  return resultado;
}

/**
 * O envio que a ficha da fila oferece: "Enviar" no aprovado (qualquer papel
 * do Comercial); "Aprovar e enviar" no "para aprovar", só para o owner. A
 * demanda perdida ou cancelada não anda.
 */
export function envioDaFicha(item: Pick<ItemDaFila, "status" | "etapa">, role: string | null | undefined): AcaoDeEnvio | null {
  if (item.etapa === "perdida" || item.etapa === "cancelada") return null;
  if (item.status === "aprovado") return "send";
  if (item.status === "para_aprovar" && role === "owner") return "approve_and_send";
  return null;
}
