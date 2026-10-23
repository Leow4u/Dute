/**
 * Modelos de operação e pacotes de cliente são código no repositório
 * (docs/multicliente-modelos-de-operacao.md). O cadastro do cliente em
 * `customers` só aponta para o modelo; o pacote é encontrado pelo código
 * operacional do cliente. As chaves de modelo precisam bater com
 * functions/wms/src/domain/customer-profile.ts: o teste operations.test.ts trava.
 */

export type OperationTemplateKey = "uniformes" | "mobiliario" | "insumos";

export type OperationPackKey = "btg";

/** Módulos do portal (lib/modules.ts, audience "client"). */
export type PortalModuleKey =
  | "assistant"
  | "home"
  | "inventory"
  | "events"
  | "requests"
  | "orders"
  | "services"
  | "invoices"
  | "documents";

/** Como o estoque é contado: por quantidade em cada SKU ou por peça com patrimônio. */
export type StockControl = "quantity" | "piece";

/**
 * "ready": o modelo existe inteiro no sistema. "building": o cadastro já
 * aceita o modelo, mas as telas ainda são as do modelo base; o que falta
 * está na ficha do modelo e no doc.
 */
export type TemplateStatus = "ready" | "building";

export type OperationTemplate = {
  key: OperationTemplateKey;
  label: string;
  summary: string;
  status: TemplateStatus;
  control: StockControl;
  /**
   * Módulos que o portal deste modelo mostra; null = modelo sem portal.
   * A ordem do menu é a de lib/modules.ts, não desta lista.
   */
  portal: readonly PortalModuleKey[] | null;
  /** Ficha "O que o modelo define", em Configurações › Clientes. */
  defines: ReadonlyArray<{ label: string; value: string }>;
  /** Caminho no repositório, mostrado na tela: mudar o modelo é um PR. */
  file: string;
};

export type OperationPack = {
  key: OperationPackKey;
  label: string;
  /** Modelo sobre o qual o pacote muda só o que o contrato pede. */
  template: OperationTemplateKey;
  /** Códigos operacionais dos clientes que usam o pacote. */
  customers: readonly string[];
  summary: string;
  file: string;
};
