import type { OrigemDoFeito, StatusDaEdicao, TipoDeMomento } from "@workspace/dominio";

/**
 * Os tipos da edição do evento no app (docs/superpowers/specs/2026-11-26-eventos-design.md,
 * "A edição, campo a campo"): o espelho das entradas e da leitura de
 * functions/wms/src/domain/eventos/edicao.ts. As telas das partes seguintes
 * importam daqui, sem cópia.
 */

export type { StatusDaEdicao, TipoDeMomento } from "@workspace/dominio";

/** Um momento do cronograma como a tela o manda: o `id` só no momento já gravado (o patch funde por ele). */
export type MomentoPrevisto = {
  id?: string;
  tipo: TipoDeMomento;
  /** Só no tipo outro. */
  rotulo?: string | null;
  /** AAAA-MM-DD */
  data: string;
  /** HH:MM */
  hora: string;
  ate?: string | null;
  local?: string | null;
  observacao?: string | null;
};

export type ItemDaEdicao = {
  sku_code: string;
  client_item_code?: string | null;
  product_name: string;
  /** O servidor copia de client_inventory; o que vai aqui só vale sem o campo lá. */
  size?: string | null;
  category?: string | null;
  quantity: number;
};

/** A coleta no cliente: quantidade 0 é sem coleta. O valor declarado vai ao documento de preço, nunca à edição. */
export type Coleta = {
  onde?: string | null;
  quantidade: number;
  valor_declarado_cents?: number | null;
};

export type Onde = {
  local?: string | null;
  endereco?: string | null;
  contato?: { nome?: string | null; telefone?: string | null } | null;
};

/** O conteúdo de um patch: o campo presente troca o gravado inteiro; o ausente fica. */
export type ConteudoDaEdicao = {
  label?: string | null;
  onde?: Onde | null;
  cronograma?: MomentoPrevisto[];
  itens?: ItemDaEdicao[];
  coleta?: Coleta | null;
  observacoes?: string | null;
  /** Só a coordenação, de confirmado a separado. */
  separar_ate?: string | null;
  /** O nome e a descrição da capa, mudados depois do nascimento. */
  evento?: { name?: string; description?: string | null };
};

/** A criação: um evento existente (`event_id`) ou um novo, pelo nome. */
export type CriarEdicao = {
  idempotency_key: string;
  customer_code?: string;
  event_id?: string | null;
  name?: string | null;
  description?: string | null;
  origem_edicao_id?: string | null;
  patch?: ConteudoDaEdicao;
};

export type PatchDaEdicao = { id: string; expected_edicao: number; customer_code?: string; patch: ConteudoDaEdicao };

export type EnviarEdicao = { id: string; expected_edicao: number; idempotency_key: string; customer_code?: string };

export type CancelarEdicao = { id: string; idempotency_key: string; motivo?: string | null; customer_code?: string };

export type ArquivarEvento = { event_id: string; idempotency_key: string; customer_code?: string };

export type ActorRef = { uid: string; name: string | null; role: string };

export type FeitoDoMomentoView = {
  inicio: string;
  fim: string | null;
  observacao: string | null;
  origem: OrigemDoFeito;
  registrado_por: ActorRef | null;
  registrado_em: string | null;
  corrigido_em: string | null;
};

export type MomentoView = {
  id: string;
  tipo: TipoDeMomento;
  rotulo: string | null;
  previsto: { data: string; hora: string; ate: string | null; local: string | null; observacao: string | null };
  feito: FeitoDoMomentoView | null;
};

export type ItemView = {
  sku_code: string;
  client_item_code: string | null;
  product_name: string;
  size: string | null;
  category: string | null;
  quantity: number;
  foi: number | null;
  voltou: number | null;
  avariadas: number | null;
  nao_voltaram: number | null;
  observacao: string | null;
};

export type DocumentoView = {
  id: string;
  caminho: string;
  nome: string;
  tipo: string;
  tamanho: number;
  origem: "cliente" | "dutelog";
  momento_id: string | null;
  registrado_por: ActorRef | null;
  registrado_em: string | null;
};

export type FotoView = {
  id: string;
  caminho: string;
  momento_id: string | null;
  legenda: string | null;
  instante: string | null;
  registrado_por: ActorRef | null;
  registrado_em: string | null;
};

export type VolumeView = {
  numero: number;
  unidades: number;
  peso_kg: number | null;
  itens: Array<{ client_item_code: string | null; product_name: string; size: string | null; quantidade: number }>;
};

export type PedidoView = {
  request_id: string | null;
  request_number: string | null;
  order_id: string | null;
  order_number: string | null;
  separado_em: string | null;
  lacre: string | null;
  volumes_total: number | null;
  volumes: VolumeView[];
  entregue_em: string | null;
  entregue_por: ActorRef | null;
  comprovante: string | null;
  cancelado_em: string | null;
};

export type RetornoView = {
  chegou_em: string | null;
  registrado_por: ActorRef | null;
  registrado_em: string | null;
  observacao: string | null;
  return_id: string | null;
};

/** A edição como o servidor a devolve: os carimbos em ISO e o ausente em null. */
export type EdicaoView = {
  id: string;
  customer_code: string;
  event_id: string;
  event_name: string;
  label: string | null;
  status: StatusDaEdicao;
  edicao: number;
  origem_edicao_id: string | null;
  onde: { local: string | null; endereco: string | null; contato: { nome: string | null; telefone: string | null } };
  cronograma: MomentoView[];
  itens: ItemView[];
  itens_total: number;
  pecas_total: number;
  coleta: { onde: string | null; quantidade: number; voltou: number | null; distribuidos: number | null };
  observacoes: string | null;
  observacoes_dutelog: string | null;
  documentos: DocumentoView[];
  fotos: FotoView[];
  equipe: { estoquistas: string | null; do_cliente: string | null; veiculo: string | null; contato_no_local: string | null };
  /** Na raiz, nunca em `pedido`. */
  separar_ate: string | null;
  pedido: PedidoView | null;
  retorno: RetornoView | null;
  enviada_em: string | null;
  confirmada_em: string | null;
  fechada_em: string | null;
  cancelada_em: string | null;
  cancelada_por: ActorRef | null;
  cancelamento_motivo: string | null;
  created_by: ActorRef | null;
  created_at: string | null;
  updated_by: ActorRef | null;
  updated_at: string | null;
};

export type ResultadoDoSalvar = { id: string; edicao: number; created: boolean; edition: EdicaoView };
export type ResultadoDoEnvio = { id: string; status: "enviado"; request_id: string | null; edition: EdicaoView };
export type ResultadoDoCancelamento = { id: string; resultado: "excluida" | "cancelada" };
export type ResultadoDoArquivamento = { event_id: string; changed: boolean };
