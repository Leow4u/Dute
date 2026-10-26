/**
 * A retenção dos avisos (LGPD, decisão 8 do Leonardo, 26/10/2026,
 * docs/plataforma/lgpd.md): o aviso do sino (`client_notifications`) e o
 * e-mail da fila (`email_outbox`) saem 90 dias depois de criados. Ficam as
 * contagens, por cliente, no evento da rotina; o evento que deu o aviso
 * continua em `events`. O e-mail ainda pendente não sai: a fila o tenta até
 * enviar ou desistir.
 */

export const DIAS_DOS_AVISOS = 90;
const DIA_MS = 24 * 60 * 60 * 1000;

/** O instante antes do qual o aviso e o e-mail saem. */
export function limiteDosAvisos(agora: Date): Date {
  return new Date(agora.getTime() - DIAS_DOS_AVISOS * DIA_MS);
}

/** O e-mail que já saiu da fila: enviado, só auditado (sem a chave do provedor) ou desistido. */
export function emailForaDaFila(status: unknown): boolean {
  return status === "sent" || status === "audit" || status === "failed";
}

/** O id da rodada, do instante em UTC: `ret_20261026T062000`. */
export function idDaRetencao(agora: Date): string {
  return `ret_${agora.toISOString().slice(0, 19).replace(/[-:]/g, "")}`;
}

export const SEM_CLIENTE = "sem cliente";

export type ContagemDoCliente = { cliente: string; avisos: number; emails: number };

/** Quantos avisos e e-mails saíram de cada cliente, na ordem do código. */
export function contagemPorCliente(clientesDosAvisos: readonly string[], clientesDosEmails: readonly string[]): ContagemDoCliente[] {
  const contagem = new Map<string, ContagemDoCliente>();
  const linha = (cliente: string) => {
    const codigo = cliente.trim() || SEM_CLIENTE;
    if (!contagem.has(codigo)) contagem.set(codigo, { cliente: codigo, avisos: 0, emails: 0 });
    return contagem.get(codigo)!;
  };
  for (const cliente of clientesDosAvisos) linha(cliente).avisos += 1;
  for (const cliente of clientesDosEmails) linha(cliente).emails += 1;
  return [...contagem.values()].sort((a, b) => a.cliente.localeCompare(b.cliente));
}
