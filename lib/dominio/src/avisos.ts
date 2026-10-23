/**
 * Os avisos por modelo (docs/plataforma/fase-4-financeiro.md, parte 4.6): a
 * OS agendada, iniciada e concluída, a NF emitida e a solicitação do portal
 * recebida. O sino do portal mostra todos ao cliente; o e-mail vai ao
 * contato do cliente que ligou o modelo no cadastro (parte 4.6b).
 *
 * As Functions guardam cópias literais: functions/comercial
 * (domain/cadastro.ts) e functions/operacao (domain/avisos.ts), travadas por
 * artifacts/app/src/lib/platform-lists.test.ts.
 */

export const MODELOS_DE_AVISO = ["os_agendada", "os_iniciada", "os_concluida", "nf_emitida", "pedido_do_portal"] as const;

export type ModeloDeAviso = (typeof MODELOS_DE_AVISO)[number];

export const MODELO_DE_AVISO_ROTULO: Record<ModeloDeAviso, string> = {
  os_agendada: "OS agendada",
  os_iniciada: "OS em execução",
  os_concluida: "OS concluída",
  nf_emitida: "NF emitida",
  pedido_do_portal: "Solicitação recebida",
};

/** Os papéis do contato do cliente no cadastro comercial. */
export const PAPEIS_DE_CONTATO = ["gestor_cliente", "gerenciadora", "financeiro", "outro"] as const;

export type PapelDeContato = (typeof PAPEIS_DE_CONTATO)[number];

/** A NF leva o valor: por e-mail, só o gestor e o financeiro do cliente recebem, nunca a gerenciadora. */
export const MODELOS_DE_AVISO_COM_VALOR = ["nf_emitida"] as const satisfies readonly ModeloDeAviso[];

export const PAPEIS_DE_CONTATO_QUE_LEEM_VALOR = ["gestor_cliente", "financeiro"] as const satisfies readonly PapelDeContato[];

/** O contato com esse papel pode receber o modelo por e-mail? */
export function contatoPodeReceberAviso(modelo: ModeloDeAviso, papel: string | null | undefined): boolean {
  if (!(MODELOS_DE_AVISO_COM_VALOR as readonly string[]).includes(modelo)) return true;
  return (PAPEIS_DE_CONTATO_QUE_LEEM_VALOR as readonly string[]).includes(String(papel ?? ""));
}
