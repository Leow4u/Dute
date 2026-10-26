/**
 * A retenção do Agent Dute (LGPD, decisão 8 do Leonardo, 26/10/2026,
 * docs/plataforma/lgpd.md, seção 6): a mensagem e o registro de uso saem 12
 * meses depois de criados, e a conversa, 12 meses depois da última mensagem.
 * A conversa que continua em uso perde o que guardava das mensagens que
 * saíram: o título (a primeira pergunta) e o resumo das antigas. As mesmas
 * coleções servem ao agente do núcleo e ao do WMS. Ficam as contagens, por
 * cliente, no evento da rotina.
 */

export const MESES_DO_AGENTE = 12;

/** O instante antes do qual a mensagem, o uso e a conversa parada saem: o mesmo dia, 12 meses antes. */
export function limiteDoAgente(agora: Date): Date {
  const limite = new Date(agora.getTime());
  limite.setUTCMonth(limite.getUTCMonth() - MESES_DO_AGENTE);
  return limite;
}

/** O id da rodada, do instante em UTC: `ret_20261026T064000`. */
export function idDaRetencao(agora: Date): string {
  return `ret_${agora.toISOString().slice(0, 19).replace(/[-:]/g, "")}`;
}

/** `conversas_limpas`: as que ficaram e perderam o título e o resumo. */
export type Contagem = { mensagens: number; conversas: number; usos: number; conversas_limpas: number };
export type Tipo = keyof Contagem;

/** Quantos de cada tipo saíram (ou, a conversa que fica, foram limpos) de cada cliente, na ordem do código. */
export function contagemPorCliente(saidos: ReadonlyArray<{ cliente: string; tipo: Tipo }>): Array<{ cliente: string } & Contagem> {
  const contagem = new Map<string, { cliente: string } & Contagem>();
  for (const { cliente, tipo } of saidos) {
    const codigo = cliente.trim();
    if (!contagem.has(codigo)) contagem.set(codigo, { cliente: codigo, mensagens: 0, conversas: 0, usos: 0, conversas_limpas: 0 });
    contagem.get(codigo)![tipo] += 1;
  }
  return [...contagem.values()].sort((a, b) => a.cliente.localeCompare(b.cliente));
}
