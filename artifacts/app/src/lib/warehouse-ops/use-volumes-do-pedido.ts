import { useMemo } from "react";
import { collection, doc, query, where } from "firebase/firestore";

import { useDocumento, useLeitura } from "@/lib/operacao/leitura";

import { itemDaLinhaDeSeparacao } from "./separacao";
import { volumesDaRemessa, volumesDaSeparacao, volumesDaTarefa, type VolumeDoPedido } from "./volumes-do-pedido";

/**
 * Os volumes de um pedido, lidos ao vivo (separação com caixas, parte 4): da
 * tarefa de separação e das linhas dela, enquanto o pedido separa; dos
 * `packages` e `package_items`, depois de concluído. É o que a etiqueta do
 * volume, o romaneio e "Para entregar" mostram. Só leitura.
 */

/** O pedido com o que a etiqueta e o romaneio dizem dele. */
export type PedidoDosVolumes = {
  id: string;
  /** "PED-0001" */
  numero: string;
  clienteCodigo: string;
  destino: string;
  /** A solicitação que originou o pedido: é dela o "Para quando". */
  solicitacaoId: string | null;
  /** O lacre, um por pedido; "" antes de concluir. */
  lacre: string;
  /** A separação e a embalagem concluídas: os volumes são os da remessa, e o total existe. */
  concluido: boolean;
  /** Quando a primeira linha foi separada e quando o pedido concluiu, em ISO. */
  separadoDe: string | null;
  separadoAte: string | null;
  /** Quem concluiu a separação. */
  por: string;
};

export type EstadoDosVolumes = "carregando" | "nao_encontrado" | "erro" | "pronto";

export type LeituraDosVolumes = {
  estado: EstadoDosVolumes;
  pedido: PedidoDosVolumes | null;
  volumes: VolumeDoPedido[];
};

/**
 * Uma das leituras ao vivo do pedido, para a nova tentativa: `ativa` quando
 * tem chave (a de agora, pelo estado do pedido), e `semResposta` quando falhou
 * ou ainda não chegou.
 */
export type LeituraQueTenta = { ativa: boolean; semResposta: boolean; tentar: () => Promise<void> };

/**
 * A nova tentativa do "Tentar de novo" (carregamento v2, junção das partes 10
 * e 13; a leitura ao vivo relê desde a parte 13g): assina de novo só as
 * leituras ativas que falharam ou não chegaram (as lidas ficam na tela, e a
 * sem chave nunca responderia), e a promessa acaba quando todas elas
 * respondem.
 */
export function tentarOsQueFaltam(leituras: readonly LeituraQueTenta[]): Promise<void> {
  return Promise.all(leituras.filter((leitura) => leitura.ativa && leitura.semResposta).map((leitura) => leitura.tentar())).then(() => undefined);
}

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

function instante(valor: unknown): string | null {
  if (!valor) return null;
  if (typeof valor === "string") return valor.trim() || null;
  const carimbo = valor as { toDate?: () => Date; seconds?: unknown };
  if (typeof carimbo.toDate === "function") return carimbo.toDate().toISOString();
  const segundos = Number(carimbo.seconds);
  return Number.isFinite(segundos) ? new Date(segundos * 1000).toISOString() : null;
}

/** As remessas que ainda valem: a cancelada não conta como pedido concluído. */
const REMESSA_VALIDA = new Set(["ready_to_dispatch", "dispatched", "delivered"]);

/**
 * Junta as leituras num estado só. Exportada para o teste: a regra de qual
 * fonte vale (a tarefa ou a remessa) não depende do Firestore.
 */
export function leituraDosVolumes(dados: {
  pedido: { numero: string; clienteCodigo: string; destino: string; solicitacaoId: string | null } | null | undefined;
  remessa: { status: string; lacre: string } | null | undefined;
  tarefa: { volumes: unknown; comecouEm: string | null; concluidaEm: string | null; por: string } | null | undefined;
  linhas: ReturnType<typeof itemDaLinhaDeSeparacao>[] | null;
  pacotes: Array<Record<string, unknown>> | null;
  itensDosPacotes: Array<Record<string, unknown>> | null;
  erro: boolean;
  id: string | null;
}): LeituraDosVolumes {
  const vazio = (estado: EstadoDosVolumes): LeituraDosVolumes => ({ estado, pedido: null, volumes: [] });
  if (!dados.id) return vazio("nao_encontrado");
  if (dados.erro) return vazio("erro");
  if (dados.pedido === undefined || dados.remessa === undefined || dados.tarefa === undefined) return vazio("carregando");
  if (dados.pedido === null) return vazio("nao_encontrado");
  const concluido = Boolean(dados.remessa && REMESSA_VALIDA.has(dados.remessa.status));
  if (concluido ? !dados.pacotes || !dados.itensDosPacotes : !dados.linhas) return vazio("carregando");
  const pedido: PedidoDosVolumes = {
    id: dados.id,
    ...dados.pedido,
    lacre: concluido ? (dados.remessa?.lacre ?? "") : "",
    concluido,
    separadoDe: dados.tarefa?.comecouEm ?? null,
    separadoAte: concluido ? (dados.tarefa?.concluidaEm ?? null) : null,
    por: dados.tarefa?.por ?? "",
  };
  const volumes = concluido
    ? volumesDaRemessa(dados.pacotes ?? [], dados.itensDosPacotes ?? [])
    : // O volume aberto ainda não tem etiqueta nem vai ao romaneio: só os fechados.
      volumesDaSeparacao(volumesDaTarefa(dados.tarefa?.volumes), dados.linhas ?? []).filter((volume) => !volume.aberto);
  return { estado: "pronto", pedido, volumes };
}

export function useVolumesDoPedido(pedidoId: string | null): LeituraDosVolumes & { tentar: () => Promise<void> } {
  const id = texto(pedidoId) || null;
  const pedido = useDocumento(
    id ? `orders/${id}:volumes` : null,
    (db) => doc(db, "orders", id ?? "-"),
    (_id, data) => ({
      numero: texto(data.order_number) || texto(data.num_pedido),
      clienteCodigo: texto(data.customer_code),
      destino: texto(data.destination),
      solicitacaoId: texto(data.customer_request_id) || null,
    }),
  );
  const remessa = useDocumento(
    id ? `shipments/ship_${id}:volumes` : null,
    (db) => doc(db, "shipments", `ship_${id ?? "-"}`),
    (_id, data) => ({ status: texto(data.status), lacre: texto(data.seal_code) }),
  );
  const tarefa = useDocumento(
    id ? `pick_tasks/pick_${id}:volumes` : null,
    (db) => doc(db, "pick_tasks", `pick_${id ?? "-"}`),
    (_id, data) => {
      const por = data.advanced_by && typeof data.advanced_by === "object" ? (data.advanced_by as { name?: unknown; email?: unknown }) : null;
      const concluida = texto(data.status) === "completed";
      return {
        volumes: data.volumes as unknown,
        comecouEm: instante(data.separation_started_at),
        // A conclusão da separação carimba `picking_confirmed_at` (operations.ts).
        concluidaEm: concluida ? (instante(data.picking_confirmed_at) ?? instante(data.advanced_at)) : null,
        por: concluida ? texto(por?.name) || texto(por?.email) : "",
      };
    },
  );
  const concluido = Boolean(remessa.item && REMESSA_VALIDA.has(remessa.item.status));
  const emSeparacao = remessa.item !== undefined && !concluido;
  const linhas = useLeitura(
    id && emSeparacao ? `pick_lines:pick_${id}:volumes` : null,
    (db) => query(collection(db, "pick_lines"), where("pick_task_id", "==", `pick_${id}`)),
    itemDaLinhaDeSeparacao,
  );
  const pacotes = useLeitura(
    id && concluido ? `packages:${id}` : null,
    (db) => query(collection(db, "packages"), where("order_id", "==", id)),
    (pacoteId, data) => ({ ...data, id: pacoteId }) as Record<string, unknown>,
  );
  const itensDosPacotes = useLeitura(
    id && concluido ? `package_items:${id}` : null,
    (db) => query(collection(db, "package_items"), where("order_id", "==", id)),
    (itemId, data) => ({ ...data, id: itemId }) as Record<string, unknown>,
  );
  const lida = useMemo(
    () =>
      leituraDosVolumes({
        id,
        pedido: pedido.item,
        remessa: remessa.item,
        tarefa: tarefa.item,
        linhas: linhas.itens,
        pacotes: pacotes.itens,
        itensDosPacotes: itensDosPacotes.itens,
        erro: pedido.erro || remessa.erro || tarefa.erro || linhas.erro || pacotes.erro || itensDosPacotes.erro,
      }),
    [id, pedido.item, pedido.erro, remessa.item, remessa.erro, tarefa.item, tarefa.erro, linhas.itens, linhas.erro, pacotes.itens, pacotes.erro, itensDosPacotes.itens, itensDosPacotes.erro],
  );
  const tentar = () =>
    tentarOsQueFaltam([
      { ativa: Boolean(id), semResposta: pedido.erro || pedido.item === undefined, tentar: pedido.tentar },
      { ativa: Boolean(id), semResposta: remessa.erro || remessa.item === undefined, tentar: remessa.tentar },
      { ativa: Boolean(id), semResposta: tarefa.erro || tarefa.item === undefined, tentar: tarefa.tentar },
      { ativa: Boolean(id && emSeparacao), semResposta: linhas.erro || linhas.itens === null, tentar: linhas.tentar },
      { ativa: Boolean(id && concluido), semResposta: pacotes.erro || pacotes.itens === null, tentar: pacotes.tentar },
      { ativa: Boolean(id && concluido), semResposta: itensDosPacotes.erro || itensDosPacotes.itens === null, tentar: itensDosPacotes.tentar },
    ]);
  return { ...lida, tentar };
}
