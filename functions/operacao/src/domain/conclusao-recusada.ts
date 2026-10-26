import { z } from "zod";

import { conclusaoLida, type ConclusaoDaOs, type PedidoDeConclusao } from "./conclusao.js";
import { chave, falha, interpretar, numero } from "./execucao.js";
import type { OsGravada } from "./os.js";

/**
 * A conclusão do celular recusada depois de a assinatura subir (pergunta 66,
 * canvas de 26/10/2026, item 2). Acontece quando o escritório já concluiu a
 * OS, ou quando a hora vem antes da última etapa, e a assinatura do cliente
 * ficava no Storage sem a OS apontar para ela.
 *
 * O servidor guarda na OS o que chegou (`conclusao_recusada`): a hora, quem
 * concluiu, quem recebeu (nome e cargo, sem o documento: decisão 3 da LGPD),
 * a assinatura e o motivo da recusa. A coordenação anexa a assinatura à
 * conclusão (na OS concluída, também na revisada: só junta o aceite, sem
 * mexer em itens nem em valores) ou dispensa. O registro fica na OS, como
 * histórico, com quem resolveu e quando.
 */

export type MarcaDaCoordenacao = { instante: string; por: { uid: string; nome: string | null } };

export type ConclusaoRecusada = {
  /** A chave do pedido recusado: o mesmo pedido repetido não grava de novo. */
  chave: string;
  /** Quando o servidor recusou. */
  recusada_em: string;
  /** A hora da conclusão no celular. */
  instante: string;
  /** Quem concluiu: o id do cadastro na equipe e o login. */
  informado_por: string | null;
  registrado_por: { uid: string; role: string };
  responsavel: { nome: string; cargo: string | null };
  /** O caminho da assinatura no Storage. */
  assinatura: string;
  motivo: string;
  anexada: MarcaDaCoordenacao | null;
  dispensada: MarcaDaCoordenacao | null;
};

/**
 * O que o servidor guarda da conclusão recusada, ou null quando não há o
 * que guardar: sem a assinatura conferida, ou de quem não está na equipe.
 */
export function recusaDaConclusao(
  os: Pick<OsGravada, "equipe" | "equipe_uids">,
  pedido: PedidoDeConclusao,
  caller: { uid: string; role: string },
  assinatura: string | null,
  motivo: string,
  agora: Date,
): ConclusaoRecusada | null {
  if (pedido.aceite !== "assinatura" || !assinatura || !os.equipe_uids.includes(caller.uid)) return null;
  return {
    chave: pedido.idempotency_key,
    recusada_em: agora.toISOString(),
    instante: new Date(pedido.instante).toISOString(),
    informado_por: os.equipe.find((pessoa) => pessoa.usuario_uid === caller.uid)?.colaborador_id ?? null,
    registrado_por: { uid: caller.uid, role: caller.role },
    responsavel: { nome: pedido.responsavel.nome, cargo: pedido.responsavel.cargo },
    assinatura,
    motivo,
    anexada: null,
    dispensada: null,
  };
}

// --- Resolver -----------------------------------------------------------------------------

export const ACOES_DA_RECUSA = ["anexar", "dispensar"] as const;
export type AcaoDaRecusa = (typeof ACOES_DA_RECUSA)[number];

const Resolver = z
  .object({
    idempotency_key: chave,
    numero,
    acao: z.enum(ACOES_DA_RECUSA),
    /** A recusa que a tela mostrou: outra, mais nova, não se resolve por engano. */
    recusada_em: z.string().trim().min(10).max(40),
  })
  .strict();

export type PedidoDaRecusa = z.infer<typeof Resolver>;

export function interpretarResolucao(data: unknown): PedidoDaRecusa {
  return interpretar(Resolver, data);
}

export type RecusaResolvida = { recusa: ConclusaoRecusada; conclusao: ConclusaoDaOs | null };

/**
 * Anexar põe na conclusão sem aceite a assinatura e quem assinou; dispensar
 * só marca. Nos dois, a recusa fica na OS com a marca de quem resolveu.
 */
export function recusaResolvida(
  os: Pick<OsGravada, "status">,
  dados: Record<string, unknown>,
  pedido: PedidoDaRecusa,
  marca: MarcaDaCoordenacao,
): RecusaResolvida {
  const recusa = conclusaoRecusadaLida(dados.conclusao_recusada);
  if (!recusa) falha("A OS não tem conclusão recusada do campo.");
  if (recusa.recusada_em !== pedido.recusada_em) falha("A conclusão recusada mudou. Recarregue e tente de novo.");
  if (recusa.anexada || recusa.dispensada) falha("A conclusão recusada já foi resolvida.");
  if (pedido.acao === "dispensar") return { recusa: { ...recusa, dispensada: marca }, conclusao: null };

  const conclusao = os.status === "em_revisao" || os.status === "revisada" ? conclusaoLida(dados) : null;
  if (!conclusao) falha("Só a OS concluída recebe a assinatura do campo: conclua a OS com estes dados.");
  if (conclusao.aceite === "assinatura") falha("A conclusão já tem a assinatura.");
  return {
    recusa: { ...recusa, anexada: marca },
    conclusao: {
      ...conclusao,
      aceite: "assinatura",
      responsavel: { nome: recusa.responsavel.nome, cargo: recusa.responsavel.cargo, documento: null },
      assinatura: recusa.assinatura,
    },
  };
}

// --- Leitura ------------------------------------------------------------------------------

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function marcaLida(valor: unknown): MarcaDaCoordenacao | null {
  if (!valor || typeof valor !== "object") return null;
  const marca = valor as Record<string, unknown>;
  const por = marca.por && typeof marca.por === "object" ? (marca.por as Record<string, unknown>) : null;
  if (!texto(marca.instante) || !por || !texto(por.uid)) return null;
  return { instante: texto(marca.instante), por: { uid: texto(por.uid), nome: texto(por.nome) || null } };
}

/** A conclusão recusada gravada na OS, ou null. */
export function conclusaoRecusadaLida(valor: unknown): ConclusaoRecusada | null {
  if (!valor || typeof valor !== "object") return null;
  const bruto = valor as Record<string, unknown>;
  const registrado = bruto.registrado_por && typeof bruto.registrado_por === "object" ? (bruto.registrado_por as Record<string, unknown>) : {};
  const responsavel = bruto.responsavel && typeof bruto.responsavel === "object" ? (bruto.responsavel as Record<string, unknown>) : {};
  const lida = {
    chave: texto(bruto.chave),
    recusada_em: texto(bruto.recusada_em),
    instante: texto(bruto.instante),
    assinatura: texto(bruto.assinatura),
    motivo: texto(bruto.motivo),
    nome: texto(responsavel.nome),
  };
  if (Object.values(lida).some((campo) => !campo)) return null;
  return {
    chave: lida.chave,
    recusada_em: lida.recusada_em,
    instante: lida.instante,
    informado_por: texto(bruto.informado_por) || null,
    registrado_por: { uid: texto(registrado.uid), role: texto(registrado.role) },
    responsavel: { nome: lida.nome, cargo: texto(responsavel.cargo) || null },
    assinatura: lida.assinatura,
    motivo: lida.motivo,
    anexada: marcaLida(bruto.anexada),
    dispensada: marcaLida(bruto.dispensada),
  };
}
