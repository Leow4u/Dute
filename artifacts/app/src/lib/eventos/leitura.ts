import { collection, doc, orderBy, query, where, type DocumentData, type DocumentReference, type Firestore, type Query } from "firebase/firestore";
import { ORIGENS_DO_FEITO, STATUS_DA_EDICAO, TIPOS_DE_MOMENTO, type OrigemDoFeito, type StatusDaEdicao, type TipoDeMomento } from "@workspace/dominio";

import type {
  ActorRef,
  EdicaoView,
  FeitoDoMomentoView,
  ItemView,
  MomentoView,
  PedidoView,
  RetornoView,
} from "./tipos";

/**
 * A leitura das três coleções dos Eventos pelo portal, ao vivo pelas regras
 * do Firestore (o cliente lê as dele, com a armazenagem no contrato): o mesmo
 * contrato de viewDaEdicao (functions/wms/src/domain/eventos/edicao.ts), com
 * os carimbos em ISO, o ausente em null e as listas sempre listas. A edição
 * sem um status da lista não é lida (o servidor a leria como cancelada).
 */

export const EVENTOS_COLLECTION = "client_events";
export const EDICOES_COLLECTION = "client_event_editions";
export const PRECOS_COLLECTION = "client_event_prices";

/** A capa do evento que se repete. */
export type EventoView = {
  id: string;
  customer_code: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  editions_count: number;
  last_edition_id: string | null;
  last_edition_label: string | null;
};

/** O dinheiro da edição que o portal mostra: o valor declarado da coleta e o preço fechado. */
export type PrecoDaEdicao = { id: string; valor_declarado_cents: number | null; fechado_cents: number | null };

type Dados = Record<string, unknown>;

function registro(value: unknown): Dados {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dados) : {};
}

function texto(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numeroOuNulo(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function lista(value: unknown): Dados[] {
  return Array.isArray(value) ? value.map(registro) : [];
}

/** O carimbo em ISO: o Timestamp lido, o Date ou o texto ISO gravado. */
function iso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === "string" && value ? value : null;
}

function ator(value: unknown): ActorRef | null {
  const dados = registro(value);
  if (!texto(dados.uid)) return null;
  return { uid: String(dados.uid), name: texto(dados.name), role: String(dados.role ?? "") };
}

function feitoDe(value: unknown): FeitoDoMomentoView | null {
  if (!value || typeof value !== "object") return null;
  const dados = registro(value);
  return {
    inicio: iso(dados.inicio) ?? "",
    fim: iso(dados.fim),
    observacao: texto(dados.observacao),
    origem: (ORIGENS_DO_FEITO as readonly unknown[]).includes(dados.origem) ? (dados.origem as OrigemDoFeito) : "registro",
    registrado_por: ator(dados.registrado_por),
    registrado_em: iso(dados.registrado_em),
    corrigido_em: iso(dados.corrigido_em),
  };
}

function momentoDe(dados: Dados): MomentoView {
  const previsto = registro(dados.previsto);
  return {
    id: String(dados.id ?? ""),
    tipo: (TIPOS_DE_MOMENTO as readonly unknown[]).includes(dados.tipo) ? (dados.tipo as TipoDeMomento) : "outro",
    rotulo: texto(dados.rotulo),
    previsto: {
      data: String(previsto.data ?? ""),
      hora: texto(previsto.hora),
      ate: texto(previsto.ate),
      local: texto(previsto.local),
      observacao: texto(previsto.observacao),
    },
    feito: feitoDe(dados.feito),
  };
}

function itemDe(dados: Dados): ItemView {
  return {
    sku_code: String(dados.sku_code ?? ""),
    client_item_code: texto(dados.client_item_code),
    product_name: String(dados.product_name ?? ""),
    size: texto(dados.size),
    category: texto(dados.category),
    quantity: numero(dados.quantity),
    foi: numeroOuNulo(dados.foi),
    voltou: numeroOuNulo(dados.voltou),
    avariadas: numeroOuNulo(dados.avariadas),
    nao_voltaram: numeroOuNulo(dados.nao_voltaram),
    observacao: texto(dados.observacao),
  };
}

function pedidoDe(value: unknown): PedidoView | null {
  if (!value || typeof value !== "object") return null;
  const dados = registro(value);
  return {
    request_id: texto(dados.request_id),
    request_number: texto(dados.request_number),
    order_id: texto(dados.order_id),
    order_number: texto(dados.order_number),
    separado_em: iso(dados.separado_em),
    lacre: texto(dados.lacre),
    volumes_total: numeroOuNulo(dados.volumes_total),
    volumes: lista(dados.volumes).map((volume) => ({
      numero: numero(volume.numero),
      unidades: numero(volume.unidades),
      peso_kg: numeroOuNulo(volume.peso_kg),
      itens: lista(volume.itens).map((item) => ({
        client_item_code: texto(item.client_item_code),
        product_name: String(item.product_name ?? ""),
        size: texto(item.size),
        quantidade: numero(item.quantidade),
      })),
    })),
    entregue_em: iso(dados.entregue_em),
    entregue_por: ator(dados.entregue_por),
    comprovante: texto(dados.comprovante),
    cancelado_em: iso(dados.cancelado_em),
  };
}

function retornoDe(value: unknown): RetornoView | null {
  if (!value || typeof value !== "object") return null;
  const dados = registro(value);
  return {
    chegou_em: iso(dados.chegou_em),
    registrado_por: ator(dados.registrado_por),
    registrado_em: iso(dados.registrado_em),
    observacao: texto(dados.observacao),
    return_id: texto(dados.return_id),
  };
}

/** A edição lida; null sem um status da lista. */
export function edicaoDaLeitura(id: string, data: DocumentData): EdicaoView | null {
  if (!(STATUS_DA_EDICAO as readonly unknown[]).includes(data.status)) return null;
  const onde = registro(data.onde);
  const contato = registro(onde.contato);
  const coleta = registro(data.coleta);
  const equipe = registro(data.equipe);
  return {
    id,
    customer_code: String(data.customer_code ?? ""),
    event_id: String(data.event_id ?? ""),
    event_name: String(data.event_name ?? ""),
    label: texto(data.label),
    status: data.status as StatusDaEdicao,
    edicao: numero(data.edicao),
    origem_edicao_id: texto(data.origem_edicao_id),
    onde: { local: texto(onde.local), endereco: texto(onde.endereco), contato: { nome: texto(contato.nome), telefone: texto(contato.telefone) } },
    cronograma: lista(data.cronograma).map(momentoDe),
    itens: lista(data.itens).map(itemDe),
    itens_total: numero(data.itens_total),
    pecas_total: numero(data.pecas_total),
    coleta: { onde: texto(coleta.onde), quantidade: numero(coleta.quantidade), voltou: numeroOuNulo(coleta.voltou), distribuidos: numeroOuNulo(coleta.distribuidos) },
    observacoes: texto(data.observacoes),
    observacoes_dutelog: texto(data.observacoes_dutelog),
    documentos: lista(data.documentos).map((documento) => ({
      id: String(documento.id ?? ""),
      caminho: String(documento.caminho ?? ""),
      nome: String(documento.nome ?? ""),
      tipo: String(documento.tipo ?? ""),
      tamanho: numero(documento.tamanho),
      origem: documento.origem === "dutelog" ? "dutelog" : "cliente",
      momento_id: texto(documento.momento_id),
      registrado_por: ator(documento.registrado_por),
      registrado_em: iso(documento.registrado_em),
    })),
    fotos: lista(data.fotos).map((foto) => ({
      id: String(foto.id ?? ""),
      caminho: String(foto.caminho ?? ""),
      momento_id: texto(foto.momento_id),
      legenda: texto(foto.legenda),
      instante: iso(foto.instante),
      registrado_por: ator(foto.registrado_por),
      registrado_em: iso(foto.registrado_em),
    })),
    equipe: {
      estoquistas: texto(equipe.estoquistas),
      do_cliente: texto(equipe.do_cliente),
      veiculo: texto(equipe.veiculo),
      contato_no_local: texto(equipe.contato_no_local),
    },
    separar_ate: texto(data.separar_ate),
    pedido: pedidoDe(data.pedido),
    retorno: retornoDe(data.retorno),
    enviada_em: iso(data.enviada_em),
    confirmada_em: iso(data.confirmada_em),
    fechada_em: iso(data.fechada_em),
    cancelada_em: iso(data.cancelada_em),
    cancelada_por: ator(data.cancelada_por),
    cancelamento_motivo: texto(data.cancelamento_motivo),
    created_by: ator(data.created_by),
    created_at: iso(data.created_at),
    updated_by: ator(data.updated_by),
    updated_at: iso(data.updated_at),
  };
}

/** A capa lida; null sem o nome. */
export function eventoDaLeitura(id: string, data: DocumentData): EventoView | null {
  const name = texto(data.name);
  if (!name) return null;
  return {
    id,
    customer_code: String(data.customer_code ?? ""),
    name,
    description: texto(data.description),
    status: data.status === "archived" ? "archived" : "active",
    editions_count: numero(data.editions_count),
    last_edition_id: texto(data.last_edition_id),
    last_edition_label: texto(data.last_edition_label),
  };
}

export function precoDaLeitura(id: string, data: DocumentData): PrecoDaEdicao {
  return { id, valor_declarado_cents: numeroOuNulo(data.valor_declarado_cents), fechado_cents: numeroOuNulo(data.fechado_cents) };
}

/** As edições do cliente, da mudada por último à mais antiga (o índice customer_code + updated_at desc). */
export function consultaDasEdicoesDoCliente(db: Firestore, customerCode: string): Query<DocumentData> {
  return query(collection(db, EDICOES_COLLECTION), where("customer_code", "==", customerCode), orderBy("updated_at", "desc"));
}

/** Os eventos ativos do cliente, pelo nome (o índice customer_code + status + name). */
export function consultaDosEventosDoCliente(db: Firestore, customerCode: string): Query<DocumentData> {
  return query(collection(db, EVENTOS_COLLECTION), where("customer_code", "==", customerCode), where("status", "==", "active"), orderBy("name", "asc"));
}

/** Os preços das edições do cliente: a regra só abre os dele. */
export function consultaDosPrecosDoCliente(db: Firestore, customerCode: string): Query<DocumentData> {
  return query(collection(db, PRECOS_COLLECTION), where("customer_code", "==", customerCode));
}

export function referenciaDaEdicao(db: Firestore, id: string): DocumentReference<DocumentData> {
  return doc(db, EDICOES_COLLECTION, id);
}
