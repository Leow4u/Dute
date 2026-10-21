import { hrefDoDocumento, type OrigemDoDocumento } from "./documento";
import { payloadAvancar } from "./montar";
import { COMERCIAL_ROLES } from "./navegacao";
import type { ItemDaFila, StatusOrcamento } from "./orcamentos";

/**
 * O envio ao cliente (parte 12a; "Envio" em docs/plataforma/fase-6-comercial.md):
 * "Enviar ao cliente" grava no servidor (advanceQuote send: aprovado → enviado, congela
 * a RV em revisoes/{rv}) e SÓ ENTÃO abre o documento para imprimir ou salvar
 * o PDF, que vai pelo Outlook, como hoje. O owner tem "Aprovar e enviar"
 * (approve_and_send), do "para aprovar", numa transação só. Se a gravação
 * falha, o documento não abre: nada sai como enviado sem estar enviado.
 */

export type AcaoDeEnvio = "send" | "approve_and_send";

/** Os rótulos dos mockups (ComFila, ComOrcamento, ComAprovarCelular). */
export const ROTULO_DO_ENVIO: Record<AcaoDeEnvio, string> = {
  send: "Enviar ao cliente",
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
  /** De onde o documento foi aberto, para o "voltar" dele (a aprovação; senão, a montagem). */
  de?: OrigemDoDocumento | null;
}): Promise<ResultadoDoEnvio> {
  const resultado = await entrada.chamar(payloadAvancar(entrada.acao, entrada.orcamento, entrada.chave));
  // A RV que o servidor enviou (e congelou), não a que a tela tinha.
  entrada.abrir(hrefDoDocumento(entrada.orcamento.numero, resultado.rv, { imprimir: true, de: entrada.de ?? null }));
  return resultado;
}

/** A chave de idempotência de uma intenção (request_id): a assinatura diz qual é a intenção. */
export type TentativaDeChamada = { assinatura: string; chave: string };

/**
 * Clicar de novo na mesma ação (a resposta se perdeu, a rede caiu) leva a
 * mesma chave, e o servidor devolve o que já gravou em vez de recusar;
 * outra intenção (outro orçamento, outra ação, outra edição), chave nova.
 */
export function chaveDaIntencao(atual: TentativaDeChamada | null, assinatura: string, nova: () => string): TentativaDeChamada {
  return atual?.assinatura === assinatura ? atual : { assinatura, chave: nova() };
}

/** A intenção de um envio: a ação, o orçamento, a situação e a edição que a tela viu. */
export function assinaturaDoEnvio(acao: AcaoDeEnvio, orcamento: { numero: string; status: string; edicao: number }): string {
  return `${acao}:${orcamento.numero}:${orcamento.status}:${orcamento.edicao}`;
}

/**
 * O envio que a ficha da fila oferece: "Enviar ao cliente" no aprovado, a
 * qualquer papel do Comercial. No "para aprovar" a ficha não tem ação (como
 * na ComFila): "Aprovar e enviar", que não se desfaz, fica na montagem e na
 * tela de aprovar, onde o owner vê o orçamento inteiro. A demanda perdida
 * ou cancelada não anda.
 */
export function envioDaFicha(item: Pick<ItemDaFila, "status" | "etapa">, role: string | null | undefined): AcaoDeEnvio | null {
  if (item.etapa === "perdida" || item.etapa === "cancelada") return null;
  if (!role || !(COMERCIAL_ROLES as readonly string[]).includes(role)) return null;
  return item.status === "aprovado" ? "send" : null;
}
