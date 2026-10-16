import { applicationDefault, initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  FieldValue,
  type Transaction,
} from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { genkit, tool, z } from "genkit";
import { vertexAI } from "@genkit-ai/google-genai";
import { createHash, randomUUID } from "node:crypto";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

import {
  advanceWarehouseTaskTransaction,
  completeOpeningInventorySessionTransaction,
  createOpeningInventorySessionTransaction,
  createInboundReceiptTransaction,
  createInventoryMovementTransaction,
  createCustomerRequestTransaction,
  createReturnReceiptTransaction,
  decideCustomerRequestTransaction,
  emitImmutableEvent,
  openingInventorySessionDocumentId,
  recordCycleCountTransaction,
  addCatalogPhotosTransaction,
  removeOpeningInventoryLineTransaction,
  setReturnDispositionTransaction,
  updateInboundReceiptConferenceTransaction,
  type OperationalActor,
} from "./domain/operations.js";
import {
  BillingDomainError,
  assertBillingStatusTransition,
  billingCustomerOf,
  calculateBillingPeriod,
  competenciaOfInstant,
  createOpenBillingPeriod,
  emissionAvailableFrom,
  emitInvoiceInTransaction,
  isCompetenciaClosed,
  type BillingCalculationInput,
  type BillingManualQuantity,
  type LpuItem,
} from "./billing.js";
import { MinimumStockError, normalizeMinimumStock } from "./catalog-minimum.js";
import { setUserAccessTransaction } from "./domain/access.js";
import { readSystemHealth } from "./domain/system-health.js";
import { CostSettingsSchema, readSystemDashboard, saveCostSettings } from "./domain/system-dashboard.js";
import { codeFunctions, InfraSettingsSchema, readSystemInfra, saveInfraSettings, type GcpFetch } from "./domain/system-infra.js";
import {
  projectMinimumStock,
  readClientInventoryForSku,
  setClientItemArchivedTransaction,
} from "./domain/client-inventory.js";
import {
  cancelShipmentNoticeTransaction,
  decodeOperationalDocument,
  decodeShipmentAttachment,
  storageFailure,
} from "./domain/client-shipments.js";
import {
  archiveClientEvent,
  ArchiveClientEventSchema,
  ClientEventInputSchema,
  listClientEvents,
  saveClientEvent,
} from "./domain/client-events.js";
import { assignMissingRequestNumbers } from "./domain/request-numbers.js";
import { billingReportWorkbook, buildBillingReport } from "./domain/billing-report.js";
import {
  INVOICE_PROMPT,
  assertInvoiceReader,
  assertOwnInvoicePath,
  invoiceReadingSource,
  matchInvoiceItems,
  sanitizeInvoiceReading,
  type InvoiceReadingSource,
} from "./domain/invoice-reading.js";
import {
  knowledgeAudienceForRole,
  loadKnowledgeContext,
  type KnowledgeAudience,
} from "./domain/agent-knowledge.js";
import {
  documents,
  invoices,
  listOrders,
  movementSummary,
  orderDetails,
  recentHistory,
  searchItems,
  stockSummary,
  agentToolsForRole,
  type AgentScope,
  type HistoryMessage,
} from "./domain/agent-dute.js";
import {
  itemLocations,
  pendingRequests,
  receipts,
  recentEvents,
  warehouseTasks,
} from "./domain/agent-team.js";
import { searchPastConversations } from "./domain/agent-history.js";
import { buildOrderDraft, buildShipmentDraft, draftFromToolResponses, sendAgentDraft } from "./domain/agent-drafts.js";
import { AgentAttachmentSchema, attachmentsForDraft, invoiceContext, READABLE_INVOICE_TYPES, type AgentAttachment } from "./domain/agent-attachments.js";
import { activeNotesForPrompt, decideNote, DecideNoteSchema, listNotes, NOTE_REVIEWER_ROLES, suggestNote } from "./domain/agent-notes.js";
import {
  activePlaybooksForPrompt,
  decidePlaybook,
  DecidePlaybookSchema,
  listPlaybooks,
  playbookIndexText,
  PlaybookInputSchema,
  readPlaybookForAgent,
  savePlaybook,
  seedInitialPlaybooks,
} from "./domain/agent-playbooks.js";
import { conversationSummary, refreshConversationSummary, SUMMARY_WINDOW, summaryPrompt, type SummaryMessage } from "./domain/agent-summary.js";
import {
  buildRoutineSuggestion,
  claimDueRoutines,
  deleteRoutine,
  listRoutines,
  recordRoutineRun,
  ROUTINES_COLLECTION,
  RoutineInputSchema,
  routinePrompt,
  saveRoutine,
  type DueRoutine,
} from "./domain/agent-routines.js";

const adminApp = initializeApp();
setGlobalOptions({
  region: "southamerica-east1",
  maxInstances: 20,
  memory: "512MiB",
});

const db = getFirestore();

const ai = genkit({
  plugins: [
    vertexAI({
      projectId: "dute-btg",
      location: "global",
    }),
  ],
});

const DEFAULT_CUSTOMER = "BTG Pactual";
// O Agent Dute roda no Gemini via Genkit, com ferramentas de leitura
// (domain/agent-dute.ts). O Agent Engine em us-west1 não é mais usado.
const AGENT_DUTE_MODEL = process.env.AGENT_DUTE_MODEL ?? "gemini-3.5-flash";
const AGENT_DUTE_FALLBACK_MODEL = "gemini-2.5-flash";
const DOCUMENT_VISUAL_OCR_MODEL =
  process.env.DOCUMENT_VISUAL_OCR_MODEL ?? "gemini-2.5-flash";
// 14 MB: o arquivo vai inline em base64 para o Gemini, cuja requisição é
// limitada a 20 MB. Fica abaixo dos 15 MB do anexo de propósito.
const VISUAL_OCR_MAX_BYTES = Number(
  process.env.DOCUMENT_VISUAL_OCR_MAX_BYTES ?? 14 * 1024 * 1024,
);

const collectionNames = {
  users: "users",
  invites: "invites",
  events: "events",
  operations: "operational_operations",
  managedOperations: "managed_operations",
  agentInbox: "ai_agent_inbox",
  operationalNotifications: "operational_notifications",
  customerRequests: "customer_requests",
  stockBalances: "stock_balances",
  orders: "orders",
  orderItems: "order_items",
  stockReservations: "stock_reservations",
  pickTasks: "pick_tasks",
  pickLines: "pick_lines",
  inboundReceipts: "inbound_receipts",
  inboundItems: "inbound_items",
  packTasks: "pack_tasks",
  packages: "packages",
  packageItems: "package_items",
  shipments: "shipments",
  shipmentItems: "shipment_items",
  movements: "movements",
  openingInventorySessions: "opening_inventory_sessions",
  openingInventoryLines: "opening_inventory_lines",
  periods: "billing_periods",
  qualityExceptions: "quality_exceptions",
  agentKnowledge: "ai_agent_knowledge",
  agentKnowledgeChunks: "ai_agent_knowledge_chunks",
  agentConversations: "agent_conversations",
  agentMessages: "agent_messages",
  agentUsage: "agent_usage",
  clientInventory: "client_inventory",
  clientInvoices: "client_invoices",
  clientOrderTracking: "client_order_tracking",
  documents: "documents",
  clientDocuments: "client_documents",
  documentLinks: "document_links",
  billingPriceList: "billing_price_list",
  billingManual: "billing_manual",
  billingConfig: "billing_config",
  billingOperationalSnapshots: "billing_operational_snapshots",
  products: "products",
  skus: "skus",
  catalogIdentities: "catalog_identities",
  customers: "customers",
  customerAccounts: "customer_accounts",
} as const;

function stripNullFields<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      entry === null ? undefined : entry,
    ]),
  ) as T;
}

const RequestItemSchema = z.preprocess(
  (value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? stripNullFields(value as Record<string, unknown>)
      : value,
  z.object({
  line_number: z.number().optional(),
  sku_code: z.string().optional(),
  client_item_code: z.string().optional(),
  product_name: z.string().optional(),
  product_registration: z.enum(["existing", "new", "unknown"]).optional(),
  location_id: z.string().optional(),
  condition: z.string().optional(),
  category: z.string().trim().max(120).optional(),
  barcode: z.string().trim().max(120).optional(),
  brand: z.string().trim().max(120).optional(),
  size: z.string().trim().max(80).optional(),
  color: z.string().trim().max(80).optional(),
  photo_urls: z.array(z.string().url()).max(8).optional(),
  photo_storage_paths: z.array(z.string().trim().min(1).max(900)).max(8).optional(),
  unit_cost: z.number().optional(),
  quantity: z.number().positive(),
  notes: z.string().optional(),
  }),
);

const EventInputSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  severity: z.enum(["info", "attention", "critical"]).default("info"),
  entity_type: z.string().optional(),
  entity_id: z.union([z.string(), z.number()]).optional(),
  customer_code: z.string().optional(),
  customer_name: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  occurred_at: z.string().optional(),
  dedupe_key: z.string().optional(),
  source: z.string().optional(),
});

const SyncOperationalNotificationsSchema = z.object({
  customer_code: z.string().trim().optional(),
  limit: z.number().int().positive().max(500).default(200),
});

const DecideOperationalNotificationSchema = z.object({
  notification_id: z.string().trim().min(1),
  action: z.enum(["approve", "archive", "mark_sent"]),
  note: z.string().trim().max(1200).optional(),
  recipients: z.array(z.string().trim().email()).max(20).optional(),
  subject: z.string().trim().min(3).max(180).optional(),
  body: z.string().trim().min(3).max(12000).optional(),
  idempotency_key: z.string().trim().min(1).optional(),
});

/** Arquivo que acompanha o aviso de envio ou a chegada avulsa (nota, pedido, foto). */
const RequestAttachmentSchema = z.object({
  file_name: z.string().trim().min(1).max(240),
  file_url: z.string().url(),
  storage_path: z.string().trim().min(1).max(900),
  content_type: z.string().trim().min(1).max(120),
  size_bytes: z.number().int().positive().max(30 * 1024 * 1024),
});

const CreateCustomerRequestSchema = z.object({
  type: z.string().default("solicitacao"),
  priority: z.string().default("normal"),
  title: z.string().optional(),
  description: z.string().optional(),
  destination: z.string().optional(),
  due_at: z.string().optional(),
  supplier: z.string().trim().max(240).optional(),
  invoice_number: z.string().trim().max(240).optional(),
  attachments: z.array(RequestAttachmentSchema).max(8).default([]),
  customer_code: z.string().optional(),
  idempotency_key: z.string().trim().min(1),
  items: z.array(RequestItemSchema).max(100).default([]),
  // Pedido enviado pelo cartão do Agent Dute: a mensagem que trouxe o rascunho.
  agent_message_id: z.string().trim().min(1).max(160).nullish(),
});

const DecideCustomerRequestSchema = z.object({
  request_id: z.string().min(1),
  action: z.enum(["approve", "reject", "close"]),
  reason: z.string().optional(),
  expected_status: z.string().trim().min(1),
  idempotency_key: z.string().optional(),
});

const AdvanceWarehouseTaskSchema = z.object({
  task_uid: z.string().min(1),
  note: z.string().optional(),
  expected_status: z.string().trim().min(1).optional(),
  idempotency_key: z.string().optional(),
  operation: z
    .object({
      source_location_id: z.string().trim().optional(),
      destination_location_id: z.string().trim().optional(),
      location_id: z.string().trim().optional(),
      quantity: z.number().positive().optional(),
      picking_lines: z
        .array(
          z.object({
            pick_line_id: z.string().trim().min(1),
            qty_picked: z.number().positive(),
            status: z.string().trim().optional(),
            notes: z.string().trim().optional(),
          }),
        )
        .optional(),
      packing_lines: z
        .array(
          z.object({
            order_item_id: z.string().trim().min(1),
            qty_packed: z.number().positive(),
            status: z.string().trim().optional(),
            notes: z.string().trim().optional(),
          }),
        )
        .optional(),
      package_count: z.number().int().positive().max(99).optional(),
      volume_label: z.string().trim().optional(),
      seal_code: z.string().trim().optional(),
      package_notes: z.string().trim().optional(),
      carrier: z.string().trim().optional(),
      driver_name: z.string().trim().optional(),
      vehicle_plate: z.string().trim().optional(),
      proof_reference: z.string().trim().optional(),
      delivery_notes: z.string().trim().optional(),
    })
    .optional(),
});

const CreateInboundReceiptSchema = z.object({
  customer_code: z.string().trim().optional(),
  supplier: z.string().trim().optional(),
  invoice_number: z.string().trim().optional(),
  reference: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  priority: z.string().trim().default("normal"),
  received_at: z.string().trim().optional(),
  // Chegada avulsa: a nota que o operador anexou e o Agent Dute leu fica na chegada.
  attachments: z.array(RequestAttachmentSchema).max(8).optional(),
  idempotency_key: z.string().trim().min(1),
  items: z.array(RequestItemSchema).min(1).max(100),
});

const InboundConferenceLineSchema = z.object({
  inbound_item_id: z.string().trim().min(1),
  received_qty: z.number().nonnegative(),
  location_id: z.string().trim().optional(),
  unit_cost: z.number().nonnegative().optional(),
  notes: z.string().trim().optional(),
  client_item_code: z.string().trim().max(80).optional(),
});

const UpdateInboundReceiptConferenceSchema = z.object({
  receipt_id: z.string().trim().min(1),
  expected_status: z.string().trim().optional(),
  idempotency_key: z.string().trim().min(1),
  lines: z.array(InboundConferenceLineSchema).min(1).max(100),
});

const InventoryMovementSchema = z.object({
  data: z.string().optional(),
  tipo_mov: z.string().trim().min(1),
  cod_sku: z.string().trim().min(1),
  produto: z.string().trim().optional(),
  qtde: z.number().positive(),
  origem: z.string().trim().optional(),
  destino: z.string().trim().optional(),
  doc_nf: z.string().trim().optional(),
  motivo: z.string().trim().min(3),
  idempotency_key: z.string().trim().min(1),
  customer_code: z.string().trim().optional(),
  client_item_code: z.string().trim().optional(),
  unit_cost: z.number().nonnegative().optional(),
});

const CycleCountSchema = z.object({
  mode: z.enum(["cycle", "opening"]).default("cycle"),
  session_id: z.string().trim().optional(),
  customer_code: z.string().trim().optional(),
  sku_code: z.string().trim().min(1),
  client_item_code: z.string().trim().optional(),
  product_name: z.string().trim().optional(),
  product_registration: z.enum(["existing", "new"]).optional(),
  category: z.string().trim().optional(),
  genero: z.string().trim().max(80).optional(),
  grupo: z.string().trim().max(120).optional(),
  barcode: z.string().trim().max(120).optional(),
  brand: z.string().trim().max(120).optional(),
  size: z.string().trim().max(80).optional(),
  color: z.string().trim().max(80).optional(),
  photo_urls: z.array(z.string().url()).max(8).optional(),
  photo_storage_paths: z.array(z.string().trim().min(1).max(900)).max(8).optional(),
  location_id: z.string().trim().min(1),
  counted_qty: z.number().nonnegative(),
  unit_cost: z.number().nonnegative().optional(),
  reason: z.string().trim().min(3),
  reference: z.string().trim().optional(),
  occurred_at: z.string().trim().optional(),
  idempotency_key: z.string().trim().min(1),
});

const CreateOpeningInventorySessionSchema = z.object({
  customer_code: z.string().trim().optional(),
  reference: z.string().trim().max(180).optional(),
  notes: z.string().trim().max(2000).optional(),
  idempotency_key: z.string().trim().min(1),
});

const CompleteOpeningInventorySessionSchema = z.object({
  customer_code: z.string().trim().optional(),
  session_id: z.string().trim().min(1),
  notes: z.string().trim().max(2000).optional(),
  idempotency_key: z.string().trim().min(1),
});

const RemoveOpeningInventoryLineSchema = z.object({
  customer_code: z.string().trim().optional(),
  session_id: z.string().trim().min(1),
  opening_line_id: z.string().trim().min(1),
  idempotency_key: z.string().trim().min(1),
});

const CreateReturnReceiptSchema = z.object({
  customer_code: z.string().trim().optional(),
  source: z.string().trim().optional(),
  reference: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  received_at: z.string().trim().optional(),
  idempotency_key: z.string().trim().min(1),
  items: z.array(RequestItemSchema).min(1).max(100),
});

const ReturnDispositionSchema = z.object({
  return_item_id: z.string().trim().min(1),
  disposition: z.enum(["available", "damaged", "quarantine", "discard"]),
  location_id: z.string().trim().optional(),
  unit_cost: z.number().nonnegative().optional(),
  notes: z.string().trim().optional(),
  expected_status: z.string().trim().optional(),
  occurred_at: z.string().trim().optional(),
  idempotency_key: z.string().trim().min(1),
});

const WarehouseExceptionSchema = z.object({
  task_uid: z.string().min(1),
  note: z.string().optional(),
  severity: z.enum(["info", "attention", "critical"]).default("attention"),
  payload: z.record(z.unknown()).optional(),
  idempotency_key: z.string().trim().min(1).optional(),
});

const ResolveWarehouseExceptionSchema = z.object({
  exception_id: z.string().trim().min(1),
  resolution: z.string().trim().min(3),
  action: z.enum(["resolve", "cancel"]).default("resolve"),
  idempotency_key: z.string().trim().min(1).optional(),
});

const AnalyzeEventSchema = z.object({
  event_id: z.string().optional(),
  event: EventInputSchema.optional(),
});

const DailyBriefingSchema = z.object({
  customer_code: z.string().optional(),
  date: z.string().optional(),
  scope: z.enum(["operational", "billing", "warehouse"]).default("operational"),
});

const AgentChatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversation_id: z.string().optional(),
  // NF anexada no chat (portal do cliente), já no Storage do cliente.
  attachments: z.array(AgentAttachmentSchema).max(3).nullish(),
});

const BillingCompetenciaSchema = z.object({
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

const SaveBillingManualSchema = BillingCompetenciaSchema.extend({
  idempotency_key: z.string().trim().min(1).optional(),
  items: z
    .array(
      z.object({
        price_list_id: z.union([z.string(), z.number()]),
        qtde: z.number().nonnegative(),
        observacao: z.string().nullable().optional(),
      }),
    )
    .max(200),
});

const ManagedEntityMutationSchema = z.object({
  resource: z.enum([
    "products",
    "skus",
    "billing_price_list",
    "billing_config",
    "ai_agent_inbox",
    "users",
    "invites",
    "customers",
    "customer_accounts",
    "documents",
  ]),
  action: z.enum(["create", "update", "archive", "resolve", "set_role"]),
  id: z.string().trim().optional(),
  data: z.record(z.unknown()).default({}),
  idempotency_key: z.string().trim().min(1),
});

const CreateDocumentUploadTargetSchema = z.object({
  customer_code: z.string().trim().optional(),
  file_name: z.string().trim().min(1).max(240),
  content_type: z.string().trim().min(1).max(120),
  size_bytes: z.number().int().positive().max(30 * 1024 * 1024),
  document_type: z.string().trim().optional(),
  entity_type: z.string().trim().optional(),
  entity_id: z.string().trim().optional(),
});

const CreateProductPhotoUploadTargetSchema = z.object({
  customer_code: z.string().trim().optional(),
  client_item_code: z.string().trim().min(1).max(120),
  file_name: z.string().trim().min(1).max(240),
  content_type: z.string().trim().min(1).max(120),
  size_bytes: z.number().int().positive().max(10 * 1024 * 1024),
});

const InviteLookupSchema = z.object({
  token: z.string().trim().min(12).max(180),
});

const OperationalActorSchema = z.object({
  uid: z.string(),
  email: z.string().optional(),
  role: z.string(),
  customer_code: z.string().optional(),
  name: z.string().optional(),
});

const ReviewOperationalDocumentSchema = z.object({
  document_id: z.string().trim().min(1),
  idempotency_key: z.string().trim().min(1).optional(),
});

const ExtractOperationalDocumentSchema = z.object({
  document_id: z.string().trim().min(1),
  idempotency_key: z.string().trim().min(1).optional(),
});

const ApproveDocumentKnowledgeSchema = z.object({
  document_id: z.string().trim().min(1),
  knowledge_id: z.string().trim().min(1).optional(),
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1200).optional(),
  idempotency_key: z.string().trim().min(1).optional(),
});

const DocumentOperationalActionSchema = z.object({
  document_id: z.string().trim().min(1),
  action: z.enum(["stage", "create_receiving"]).default("stage"),
  note: z.string().trim().max(2000).optional(),
  payload: z.record(z.unknown()).default({}),
  idempotency_key: z.string().trim().min(1).optional(),
});

const DocumentReviewFlowInputSchema = z.object({
  document_id: z.string().trim().min(1),
  actor: OperationalActorSchema,
  document: z.record(z.unknown()),
});

const DocumentReviewFlowOutputSchema = z.object({
  summary: z.string(),
  tags: z.array(z.string()),
  confidence: z.number(),
  extracted_fields: z.record(z.unknown()),
  risk_flags: z.array(z.string()),
  recommended_action: z.string(),
  ai_status: z.string(),
});

type Role =
  "owner" | "admin" | "interno" | "wms" | "financeiro" | "suporte" | "cliente";
type EventRow = {
  id: string;
  severity?: "info" | "attention" | "critical";
  customer_code?: string;
  [key: string]: unknown;
};
type Profile = {
  uid: string;
  email?: string;
  role: Role;
  customer_code?: string;
  name?: string;
};

function safeDocId(value: string) {
  return value.replace(/[^\w.-]/g, "_").slice(0, 900);
}

function normalizedCatalogIdentity(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function requiredCatalogIdentity(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new HttpsError(
      "invalid-argument",
      `${label} deve ser informado como texto.`,
    );
  }
  const normalized = normalizedCatalogIdentity(value);
  if (!normalized) {
    throw new HttpsError("invalid-argument", `${label} é obrigatório.`);
  }
  if (normalized.length > 120) {
    throw new HttpsError(
      "invalid-argument",
      `${label} deve ter no máximo 120 caracteres.`,
    );
  }
  return normalized;
}

function safeFileName(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.\- ]/g, "_")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 180);
  return normalized || `documento-${Date.now()}`;
}

function newDocId(prefix: string) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${suffix}`;
}

function stableHash(value: unknown) {
  const canonicalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonicalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, canonicalize(item)]),
      );
    }
    return input;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function allowedFields(
  data: Record<string, unknown>,
  fields: readonly string[],
) {
  return Object.fromEntries(
    Object.entries(data).filter(
      ([key, value]) => fields.includes(key) && value !== undefined,
    ),
  );
}

function compactPayload<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
}

function normalizeOperationalText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function documentKnowledgeRequiresApproval(input: {
  document_type?: unknown;
  content_source?: unknown;
  content_type?: unknown;
  file_name?: unknown;
  title?: unknown;
}) {
  const type = normalizeOperationalText(input.document_type);
  const source = normalizeOperationalText(input.content_source);
  const contentType = normalizeOperationalText(input.content_type);
  const searchable = [
    input.document_type,
    input.file_name,
    input.title,
    input.content_type,
  ]
    .map(normalizeOperationalText)
    .join(" ");
  const sensitiveTypes = new Set([
    "contrato",
    "proposta",
    "fatura",
    "financeiro",
    "billing",
    "lpu",
  ]);
  return (
    sensitiveTypes.has(type) ||
    source === "storage_visual_ocr" ||
    source === "storage_visual_ocr_error" ||
    contentType.startsWith("image/") ||
    searchable.includes("contrato") ||
    searchable.includes("proposta") ||
    searchable.includes("fatura") ||
    searchable.includes("lpu")
  );
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numericFromUnknown(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstPresent(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function normalizeDocumentOperationalItems(
  source: unknown,
): z.infer<typeof RequestItemSchema>[] {
  return arrayFromUnknown(source)
    .map((item, index) => {
      const record =
        item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const clientItemCode = String(
        firstPresent(record, [
          "client_item_code",
          "cod_cliente",
          "codigo_cliente",
          "codigo do cliente",
          "cod. cliente",
          "cod_cliente_produto",
        ]) ?? "",
      ).trim();
      const skuCode = String(
        firstPresent(record, [
          "sku_code",
          "cod_sku",
          "sku",
          "cod_btg",
          "codigo_btg",
          "codigo interno",
        ]) ??
          clientItemCode ??
          "",
      ).trim();
      const productName = String(
        firstPresent(record, [
          "product_name",
          "produto",
          "descricao",
          "descrição",
          "item",
          "nome",
        ]) ??
          clientItemCode ??
          skuCode ??
          "",
      ).trim();
      const quantity = numericFromUnknown(
        firstPresent(record, [
          "quantity",
          "qtde",
          "qtd",
          "quantidade",
          "expected_qty",
          "pecas",
          "peças",
        ]),
      );
      const unitCost = numericFromUnknown(
        firstPresent(record, [
          "unit_cost",
          "custo_unitario",
          "custo unitario",
          "custo",
          "valor_unitario",
          "preco_unit",
          "preço",
        ]),
      );
      const registration: "existing" | "new" =
        record.product_registration === "new" ? "new" : "existing";
      return {
        line_number: numericFromUnknown(record.line_number) || index + 1,
        sku_code: skuCode || clientItemCode,
        client_item_code: clientItemCode || skuCode,
        product_name: productName,
        product_registration: registration,
        location_id: String(record.location_id ?? "RECEBIMENTO").trim(),
        unit_cost: unitCost || undefined,
        quantity,
        notes: String(record.notes ?? record.observacao ?? "").trim() || undefined,
      };
    })
    .filter((item) => item.quantity > 0 && (item.sku_code || item.product_name));
}

function documentOperationalItems(
  document: Record<string, unknown>,
  payload: Record<string, unknown>,
) {
  const extracted = (document.extracted_fields &&
  typeof document.extracted_fields === "object"
    ? (document.extracted_fields as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const payloadItems = normalizeDocumentOperationalItems(payload.items);
  if (payloadItems.length) return payloadItems;
  for (const key of ["items", "linhas", "itens", "products", "produtos"]) {
    const items = normalizeDocumentOperationalItems(extracted[key]);
    if (items.length) return items;
  }
  return [];
}

function defaultConversationId(profile: Profile, customerCode: string) {
  return safeDocId(`chat_${customerCode}_${profile.uid}`);
}

function documentBucketName() {
  return (
    process.env.DOCUMENT_STORAGE_BUCKET ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    "dute-btg.firebasestorage.app"
  );
}

function firebaseDownloadUrl(bucketName: string, objectPath: string, token: string) {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
    bucketName,
  )}/o/${encodeURIComponent(objectPath)}?alt=media&token=${encodeURIComponent(
    token,
  )}`;
}

function isSigningPermissionError(error: unknown) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return (
    message.includes("iam.serviceAccounts.signBlob") ||
    message.includes("SigningError") ||
    (error instanceof Error && error.name === "SigningError")
  );
}

async function createSignedWriteUploadTarget(input: {
  objectPath: string;
  contentType: string;
  fileName: string;
  sizeBytes: number;
}) {
  const bucketName = documentBucketName();
  const bucket = getStorage().bucket(bucketName);
  const token = randomUUID();
  const file = bucket.file(input.objectPath);
  const uploadHeaders = {
    "content-type": input.contentType,
    "x-goog-meta-firebaseStorageDownloadTokens": token,
  };

  let uploadUrl: string;
  try {
    const [signedUrl] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000,
      contentType: input.contentType,
      extensionHeaders: {
        "x-goog-meta-firebaseStorageDownloadTokens": token,
      },
    });
    uploadUrl = signedUrl;
  } catch (error) {
    if (isSigningPermissionError(error)) {
      throw new HttpsError(
        "failed-precondition",
        "Upload indisponível: a service account das Functions precisa da role Service Account Token Creator (signBlob) para assinar URLs do Storage.",
      );
    }
    throw new HttpsError(
      "internal",
      error instanceof Error
        ? `Falha ao autorizar upload: ${error.message}`
        : "Falha ao autorizar upload no Storage.",
    );
  }

  return {
    ok: true as const,
    bucket: bucketName,
    storage_path: input.objectPath,
    upload_url: uploadUrl,
    upload_headers: uploadHeaders,
    file_url: firebaseDownloadUrl(bucketName, input.objectPath, token),
    file_name: input.fileName,
    content_type: input.contentType,
    size_bytes: input.sizeBytes,
    expires_in_seconds: 900,
  };
}

function stringifyCompact(value: unknown, maxLength = 12000) {
  const text = JSON.stringify(value, null, 2);
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...` : text;
}

function isTextLikeDocument(contentType: unknown, fileName: unknown) {
  const type = String(contentType ?? "").toLowerCase();
  const name = String(fileName ?? "").toLowerCase();
  return (
    type.startsWith("text/") ||
    ["application/json", "application/xml", "application/csv"].includes(type) ||
    [".txt", ".csv", ".json", ".xml", ".md"].some((extension) =>
      name.endsWith(extension),
    )
  );
}

function isPdfDocument(contentType: unknown, fileName: unknown) {
  const type = String(contentType ?? "").toLowerCase();
  const name = String(fileName ?? "").toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

function isSpreadsheetDocument(contentType: unknown, fileName: unknown) {
  const type = String(contentType ?? "").toLowerCase();
  const name = String(fileName ?? "").toLowerCase();
  return (
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/vnd.ms-excel.sheet.macroenabled.12",
    ].includes(type) ||
    [".xlsx", ".xls", ".xlsm"].some((extension) => name.endsWith(extension))
  );
}

function isDocxDocument(contentType: unknown, fileName: unknown) {
  const type = String(contentType ?? "").toLowerCase();
  const name = String(fileName ?? "").toLowerCase();
  return (
    type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  );
}

function isVisualDocument(contentType: unknown, fileName: unknown) {
  const type = String(contentType ?? "").toLowerCase();
  const name = String(fileName ?? "").toLowerCase();
  return (
    type.startsWith("image/") ||
    [".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff"].some(
      (extension) => name.endsWith(extension),
    )
  );
}

function visualOcrContentType(contentType: unknown, fileName: unknown) {
  const type = String(contentType ?? "").toLowerCase();
  const name = String(fileName ?? "").toLowerCase();
  if (type.startsWith("image/") || type === "application/pdf") return type;
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  return "";
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function knowledgeChunksFromText(text: string, maxChunks = 12, chunkSize = 1600) {
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length && chunks.length < maxChunks) {
    const hardEnd = Math.min(cursor + chunkSize, text.length);
    const softBreak = text.lastIndexOf("\n", hardEnd);
    const end = softBreak > cursor + 700 ? softBreak : hardEnd;
    const chunk = text.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    cursor = end;
  }
  return chunks;
}

async function extractVisualTextWithGemini(
  buffer: Buffer,
  contentType: unknown,
  fileName: unknown,
): Promise<{
  status: "extracted_text" | "pending_visual_ocr";
  source: string;
  text: string;
  message: string;
}> {
  const mimeType = visualOcrContentType(contentType, fileName);
  if (!mimeType || (!mimeType.startsWith("image/") && mimeType !== "application/pdf")) {
    return {
      status: "pending_visual_ocr",
      source: "storage_binary",
      text: "",
      message:
        "Formato sem suporte para OCR visual automatico nesta fase.",
    };
  }
  if (buffer.length > VISUAL_OCR_MAX_BYTES) {
    return {
      status: "pending_visual_ocr",
      source: "storage_visual_ocr_pending",
      text: "",
      message:
        "Arquivo acima do limite seguro para OCR visual automatico. Use processamento dedicado.",
    };
  }

  try {
    const response = await ai.generate({
      model: vertexAI.model(DOCUMENT_VISUAL_OCR_MODEL),
      messages: [
        {
          role: "user",
          content: [
            {
              text:
                "Transcreva fielmente todo texto visivel neste anexo operacional. " +
                "Nao invente campos, valores, nomes, datas ou conclusoes. " +
                "Preserve quebras de linha quando ajudarem a leitura. " +
                "Se nao houver texto legivel, responda exatamente SEM_TEXTO_VISIVEL.",
            },
            {
              media: {
                url: `data:${mimeType};base64,${buffer.toString("base64")}`,
                contentType: mimeType,
              },
            },
          ],
        },
      ],
      config: {
        temperature: 0,
        maxOutputTokens: 4096,
      },
    });
    const text = normalizeExtractedText(String(response.text ?? ""));
    if (!text || text.includes("SEM_TEXTO_VISIVEL")) {
      return {
        status: "pending_visual_ocr",
        source: "storage_visual_ocr",
        text: "",
        message:
          "OCR visual executado, mas nenhum texto legivel foi encontrado no anexo.",
      };
    }
    return {
      status: "extracted_text",
      source: "storage_visual_ocr",
      text,
      message:
        "OCR visual executado e conteudo publicado na base do Agent Dute.",
    };
  } catch (error) {
    return {
      status: "pending_visual_ocr",
      source: "storage_visual_ocr_error",
      text: "",
      message:
        error instanceof Error
          ? `OCR visual nao concluido: ${error.message}`
          : "OCR visual nao concluido.",
    };
  }
}

async function extractTextFromDocumentBuffer(
  buffer: Buffer,
  contentType: unknown,
  fileName: unknown,
): Promise<{
  status: "extracted_text" | "pending_visual_ocr" | "unavailable";
  source: string;
  text: string;
  message: string;
}> {
  const maxParserBytes = 25 * 1024 * 1024;
  if (buffer.length > maxParserBytes) {
    return {
      status: "unavailable",
      source: "storage_binary",
      text: "",
      message:
        "Arquivo maior que o limite seguro do parser server-side. Use OCR/processamento dedicado.",
    };
  }

  if (isTextLikeDocument(contentType, fileName)) {
    const text = normalizeExtractedText(buffer.toString("utf8"));
    return {
      status: text ? "extracted_text" : "unavailable",
      source: "storage_text",
      text,
      message: text
        ? "Conteudo textual extraido e publicado na base do Agent Dute."
        : "Arquivo textual sem conteudo legivel para extrair.",
    };
  }

  if (isPdfDocument(contentType, fileName)) {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const text = normalizeExtractedText(String(result.text ?? ""));
      return {
        status: text ? "extracted_text" : "pending_visual_ocr",
        source: "storage_pdf_text",
        text,
        message: text
          ? "Texto de PDF extraido e publicado na base do Agent Dute."
          : "PDF sem camada de texto detectada. A leitura integral depende de OCR visual.",
      };
    } finally {
      await parser.destroy();
    }
  }

  if (isSpreadsheetDocument(contentType, fileName)) {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    // exceljs accepts Buffer / ArrayBuffer; avoid vulnerable xlsx@0.18.5.
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheetTexts = workbook.worksheets.slice(0, 12).map((sheet: any) => {
      const lines: string[] = [];
      sheet.eachRow({ includeEmpty: false }, (row: any, rowNumber: number) => {
        if (rowNumber > 1500) return;
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        const line = values
          .map((cell: unknown) => String(cell ?? "").trim())
          .join("\t")
          .trim();
        if (line) lines.push(line);
      });
      const body = lines.join("\n");
      return body ? `Planilha: ${sheet.name}\n${body}` : "";
    });
    const text = normalizeExtractedText(sheetTexts.filter(Boolean).join("\n\n"));
    return {
      status: text ? "extracted_text" : "unavailable",
      source: "storage_spreadsheet",
      text,
      message: text
        ? "Conteudo de planilha extraido e publicado na base do Agent Dute."
        : "Planilha sem conteudo legivel para extrair.",
    };
  }

  if (isDocxDocument(contentType, fileName)) {
    const result = await mammoth.extractRawText({ buffer });
    const text = normalizeExtractedText(result.value ?? "");
    return {
      status: text ? "extracted_text" : "unavailable",
      source: "storage_docx",
      text,
      message: text
        ? "Texto de DOCX extraido e publicado na base do Agent Dute."
        : "DOCX sem texto legivel para extrair.",
    };
  }

  if (isVisualDocument(contentType, fileName)) {
    return {
      status: "pending_visual_ocr",
      source: "storage_image",
      text: "",
      message:
        "Imagem identificada. A leitura do conteudo depende de OCR visual/Document AI.",
    };
  }

  return {
    status: "unavailable",
    source: "storage_binary",
    text: "",
    message:
      "Formato ainda nao suportado pelo parser server-side. Use OCR/parser dedicado.",
  };
}

function assertAuth(request: CallableRequest<unknown>) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Faça login para continuar.");
  }
  return request.auth;
}

async function getProfile(request: CallableRequest<unknown>): Promise<Profile> {
  const auth = assertAuth(request);
  return loadProfile(auth.uid, auth.token.email, auth.token.name);
}

/** Perfil atual da pessoa (callables e rotinas do Agent Dute, que rodam sem ninguém logado). */
async function loadProfile(uid: string, email?: string, tokenName?: string): Promise<Profile> {
  const snapshot = await db
    .collection(collectionNames.users)
    .doc(uid)
    .get();
  if (!snapshot.exists) {
    throw new HttpsError("permission-denied", "Usuário sem perfil ativo.");
  }

  const data = snapshot.data() ?? {};
  // Acesso removido em Pessoas e acessos: o perfil fica para o histórico.
  if (data.access_disabled === true) {
    throw new HttpsError("permission-denied", "Acesso removido.");
  }
  const role =
    data.role === "owner" ||
    data.role === "admin" ||
    data.role === "interno" ||
    data.role === "wms" ||
    data.role === "financeiro" ||
    data.role === "suporte" ||
    data.role === "cliente"
      ? data.role
      : null;
  if (!role) {
    throw new HttpsError("permission-denied", "Perfil sem papel válido.");
  }

  return {
    uid,
    email: email ?? (typeof data.email === "string" ? data.email : undefined),
    role,
    customer_code:
      typeof data.customer_code === "string" ? data.customer_code : undefined,
    name: typeof data.nome === "string" ? data.nome : tokenName,
  };
}

function requireInternal(profile: Profile) {
  if (
    !["owner", "admin", "interno", "wms", "financeiro", "suporte"].includes(
      profile.role,
    )
  ) {
    throw new HttpsError(
      "permission-denied",
      "Ação permitida somente para a operação Dutelog.",
    );
  }
}

function requireWarehouseWrite(profile: Profile) {
  if (!["owner", "admin", "interno", "wms"].includes(profile.role)) {
    throw new HttpsError(
      "permission-denied",
      "Ação permitida somente para administração ou operação de armazém.",
    );
  }
}

// Mesma lista de canReadBilling nas Firestore Rules.
function requireBillingRead(profile: Profile) {
  if (!["owner", "admin", "financeiro", "suporte"].includes(profile.role)) {
    throw new HttpsError(
      "permission-denied",
      "Faturamento visível somente para administração, financeiro ou suporte.",
    );
  }
}

function requireBillingWrite(profile: Profile) {
  if (!["owner", "admin", "financeiro"].includes(profile.role)) {
    throw new HttpsError(
      "permission-denied",
      "Ação permitida somente para administração ou financeiro.",
    );
  }
}

function requireCatalogWrite(profile: Profile) {
  if (!["owner", "admin", "interno"].includes(profile.role)) {
    throw new HttpsError(
      "permission-denied",
      "Ação permitida somente para administração ou coordenação operacional.",
    );
  }
}

function requireOperationsCoordinator(profile: Profile) {
  if (!["owner", "admin", "interno"].includes(profile.role)) {
    throw new HttpsError(
      "permission-denied",
      "Ação permitida somente para administração ou coordenação operacional.",
    );
  }
}

function requireAccessWrite(profile: Profile) {
  if (!["owner", "admin"].includes(profile.role)) {
    throw new HttpsError(
      "permission-denied",
      "Ação permitida somente para administradores de acesso.",
    );
  }
}

function requireCustomerScope(profile: Profile, requestedCustomer?: string) {
  if (profile.role === "cliente") {
    if (!profile.customer_code) {
      throw new HttpsError(
        "permission-denied",
        "Cliente sem código operacional.",
      );
    }
    if (requestedCustomer && requestedCustomer !== profile.customer_code) {
      throw new HttpsError(
        "permission-denied",
        "Cliente não pode agir em outro contrato.",
      );
    }
    return profile.customer_code;
  }
  return requestedCustomer || DEFAULT_CUSTOMER;
}

async function emitEvent(
  input: z.infer<typeof EventInputSchema>,
  actor: OperationalActor,
) {
  const parsed = EventInputSchema.parse(input);
  return emitImmutableEvent(db, parsed, actor);
}

function quantityTotal(items: Array<z.infer<typeof RequestItemSchema>>) {
  return items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
}

function rowText(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

function rowRecord(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function notificationKindForEvent(eventType: string, severity?: string) {
  const normalized = eventType.toLowerCase();
  if (
    normalized.includes("exception") ||
    normalized.includes("diverg") ||
    severity === "critical"
  ) {
    return {
      topic: "exception",
      audience: "internal",
      subject: "Atenção operacional no contrato BTG",
      action: "Revisar a ocorrência no WMS antes de qualquer comunicação ao cliente.",
    };
  }
  if (
    normalized.includes("receipt") ||
    normalized.includes("inbound") ||
    normalized.includes("receb") ||
    normalized.includes("movement") ||
    normalized.includes("inventory")
  ) {
    return {
      topic: "inventory",
      audience: "client",
      subject: "Estoque BTG atualizado pela Dutelog",
      action: "Validar se a entrada deve ser comunicada à Cristiane e aprovar o envio.",
    };
  }
  if (normalized.includes("order") || normalized.includes("picking")) {
    return {
      topic: "order",
      audience: "client",
      subject: "Atualização do pedido BTG",
      action: "Confirmar se o status está pronto para atualização ao cliente.",
    };
  }
  if (normalized.includes("shipment") || normalized.includes("dispatch")) {
    return {
      topic: "delivery",
      audience: "client",
      subject: "Entrega BTG atualizada",
      action: "Conferir tracking e comprovantes antes de marcar como enviado.",
    };
  }
  if (normalized.includes("billing") || normalized.includes("invoice")) {
    return {
      topic: "billing",
      audience: "client",
      subject: "Faturamento BTG atualizado",
      action: "Validar competência e evidências antes de avisar o cliente.",
    };
  }
  if (severity === "attention") {
    return {
      topic: "attention",
      audience: "internal",
      subject: "Sinal operacional para acompanhamento",
      action: "Revisar o evento e decidir se vira comunicação ou tarefa interna.",
    };
  }
  return null;
}

function notificationDraftFromEvent(event: EventRow) {
  const type = rowText(event, "type");
  const title = rowText(event, "title") || "Evento operacional";
  const description = rowText(event, "description");
  const customerCode = rowText(event, "customer_code") || DEFAULT_CUSTOMER;
  const severity = rowText(event, "severity") || "info";
  const source = rowText(event, "source");
  if (!type || source === "agent_chat") return null;

  const kind = notificationKindForEvent(type, severity);
  if (!kind) return null;

  const payload = rowRecord(event, "payload");
  const quantity = Number(
    payload.quantity_total ??
      payload.total_quantity ??
      payload.quantity ??
      payload.items_count ??
      0,
  );
  const quantityText =
    Number.isFinite(quantity) && quantity > 0
      ? `\nQuantidade relacionada: ${quantity.toLocaleString("pt-BR")}.`
      : "";
  const entityType = rowText(event, "entity_type");
  const entityId = event.entity_id;
  const entityText =
    entityType || entityId
      ? `\nReferência: ${[entityType, entityId].filter(Boolean).join(" ")}.`
      : "";

  return {
    id: `notif_${safeDocId(event.id)}`,
    status: "draft",
    channel: "email_draft",
    audience: kind.audience,
    topic: kind.topic,
    customer_code: customerCode,
    customer_name: rowText(event, "customer_name") || customerCode,
    trigger_event_id: event.id,
    trigger_event_type: type,
    entity_type: entityType || null,
    entity_id: entityId ?? null,
    severity,
    title,
    subject: kind.subject,
    body:
      kind.audience === "client"
        ? `Olá, Cristiane.\n\n${title}.${description ? `\n${description}` : ""}${quantityText}${entityText}\n\nEsta mensagem foi preparada pelo Agent Dute a partir do registro operacional da Dutelog e precisa de aprovação humana antes do envio.`
        : `${title}.${description ? `\n${description}` : ""}${quantityText}${entityText}\n\nAção recomendada: ${kind.action}`,
    recommended_action: kind.action,
    created_from: "event_sync",
  };
}

function envCsv(name: string) {
  return (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueEmails(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function notificationRecipients(
  data: Record<string, unknown>,
  parsed: z.infer<typeof DecideOperationalNotificationSchema>,
) {
  const existing = Array.isArray(data.recipients)
    ? data.recipients.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const audience = rowText(data, "audience");
  const defaults =
    audience === "client"
      ? envCsv("AGENT_DUTE_EMAIL_CLIENT_TO")
      : envCsv("AGENT_DUTE_EMAIL_INTERNAL_TO");
  return uniqueEmails([...(parsed.recipients ?? []), ...existing, ...defaults]);
}

async function deliverOperationalNotification(
  data: Record<string, unknown>,
  parsed: z.infer<typeof DecideOperationalNotificationSchema>,
  actor: Profile,
) {
  const recipients = notificationRecipients(data, parsed);
  if (recipients.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      "Informe pelo menos um destinatário antes de enviar a notificação.",
    );
  }

  const subject = parsed.subject ?? rowText(data, "subject");
  const body = parsed.body ?? rowText(data, "body");
  if (!subject || !body) {
    throw new HttpsError(
      "failed-precondition",
      "Assunto e corpo final são obrigatórios para envio.",
    );
  }

  const mode = (process.env.AGENT_DUTE_EMAIL_MODE ?? "audit_only")
    .trim()
    .toLowerCase();
  const from =
    process.env.AGENT_DUTE_EMAIL_FROM ?? "Agent Dute <nao-responder@dutelog.com.br>";
  const replyTo = process.env.AGENT_DUTE_EMAIL_REPLY_TO ?? null;
  const idempotencyKey =
    parsed.idempotency_key ??
    stableHash({
      notification: parsed.notification_id,
      recipients,
      subject,
      body,
    });

  if (mode === "webhook") {
    const webhookUrl = process.env.AGENT_DUTE_EMAIL_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new HttpsError(
        "failed-precondition",
        "Webhook de e-mail não configurado.",
      );
    }
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.AGENT_DUTE_EMAIL_WEBHOOK_TOKEN
          ? {
              authorization: `Bearer ${process.env.AGENT_DUTE_EMAIL_WEBHOOK_TOKEN}`,
            }
          : {}),
      },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        from,
        reply_to: replyTo,
        to: recipients,
        subject,
        text: body,
        metadata: {
          notification_id: parsed.notification_id,
          customer_code: data.customer_code ?? null,
          topic: data.topic ?? null,
          trigger_event_id: data.trigger_event_id ?? null,
          approved_by: data.approved_by_email ?? null,
          sent_by: actor.email ?? actor.uid,
        },
      }),
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new HttpsError(
        "internal",
        `Provedor de e-mail recusou o envio (${response.status}).`,
      );
    }
    return {
      recipients,
      subject,
      body,
      delivery: {
        mode,
        status: "sent",
        sent_external: true,
        provider_status: response.status,
        provider_response: responseText.slice(0, 1200),
        idempotency_key: idempotencyKey,
        from,
        reply_to: replyTo,
      },
    };
  }

  return {
    recipients,
    subject,
    body,
    delivery: {
      mode: "audit_only",
      status: "logged",
      sent_external: false,
      idempotency_key: idempotencyKey,
      from,
      reply_to: replyTo,
      message:
        "E-mail registrado no sistema. Configure AGENT_DUTE_EMAIL_MODE=webhook para envio transacional real.",
    },
  };
}

async function syncOperationalNotificationsFlow(
  input: z.infer<typeof SyncOperationalNotificationsSchema>,
  actor: Profile,
) {
  const parsed = SyncOperationalNotificationsSchema.parse(input);
  const customerCode = parsed.customer_code
    ? requireCustomerScope(actor, parsed.customer_code)
    : actor.role === "cliente"
      ? requireCustomerScope(actor)
      : undefined;

  const snapshot = await db
    .collection(collectionNames.events)
    .orderBy("occurred_at", "desc")
    .limit(parsed.limit)
    .get();
  const candidates = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as EventRow)
    .filter(
      (event) =>
        !customerCode ||
        rowText(event, "customer_code") === customerCode ||
        (!rowText(event, "customer_code") && customerCode === DEFAULT_CUSTOMER),
    )
    .map(notificationDraftFromEvent)
    .filter((draft): draft is NonNullable<typeof draft> => Boolean(draft));

  const refs = candidates.map((draft) =>
    db.collection(collectionNames.operationalNotifications).doc(draft.id),
  );
  const existing = await Promise.all(refs.map((ref) => ref.get()));
  const batch = db.batch();
  let created = 0;

  candidates.forEach((draft, index) => {
    if (existing[index]?.exists) return;
    created += 1;
    batch.set(refs[index], {
      ...draft,
      created_by: actor.uid,
      created_by_email: actor.email ?? null,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
  });

  if (created > 0) await batch.commit();

  return {
    scanned: snapshot.size,
    candidates: candidates.length,
    created,
    skipped_existing: candidates.length - created,
  };
}

async function decideOperationalNotificationFlow(
  input: z.infer<typeof DecideOperationalNotificationSchema>,
  actor: Profile,
) {
  const parsed = DecideOperationalNotificationSchema.parse(input);
  const ref = db
    .collection(collectionNames.operationalNotifications)
    .doc(parsed.notification_id);

  let deliveryResult:
    | Awaited<ReturnType<typeof deliverOperationalNotification>>
    | null = null;

  if (parsed.action === "mark_sent") {
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "Notificação não encontrada.");
    }
    const data = snapshot.data() ?? {};
    const status = String(data.status ?? "draft");
    if (status !== "approved") {
      throw new HttpsError(
        "failed-precondition",
        "Somente notificações aprovadas podem ser enviadas.",
      );
    }
    deliveryResult = await deliverOperationalNotification(data, parsed, actor);
  }

  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "Notificação não encontrada.");
    }
    const data = snapshot.data() ?? {};
    const status = String(data.status ?? "draft");
    if (parsed.action === "approve" && status !== "draft") {
      throw new HttpsError(
        "failed-precondition",
        "Somente rascunhos podem ser aprovados.",
      );
    }
    if (parsed.action === "mark_sent" && status !== "approved") {
      throw new HttpsError(
        "failed-precondition",
        "Somente notificações aprovadas podem ser marcadas como enviadas.",
      );
    }

    const nextStatus =
      parsed.action === "approve"
        ? "approved"
        : parsed.action === "mark_sent"
          ? "sent"
          : "archived";
    const timestampField =
      parsed.action === "approve"
        ? "approved_at"
        : parsed.action === "mark_sent"
          ? "sent_at"
          : "archived_at";
    const actorField =
      parsed.action === "approve"
        ? "approved_by"
        : parsed.action === "mark_sent"
          ? "sent_by"
          : "archived_by";

    const update: Record<string, unknown> = {
      status: nextStatus,
      note: parsed.note ?? data.note ?? null,
      [actorField]: actor.uid,
      [`${actorField}_email`]: actor.email ?? null,
      [timestampField]: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    };
    if (deliveryResult) {
      Object.assign(update, {
        channel: deliveryResult.delivery.sent_external
          ? "email_transacional"
          : "email_auditado",
        recipients: deliveryResult.recipients,
        subject_sent: deliveryResult.subject,
        body_sent: deliveryResult.body,
        email_delivery: deliveryResult.delivery,
      });
    }

    transaction.update(ref, update);

    return {
      id: parsed.notification_id,
      status: nextStatus,
      delivery: deliveryResult?.delivery ?? null,
      ok: true,
    };
  });

  await emitEvent(
    {
      type: `agent.notification.${result.status}`,
      title:
        result.status === "sent"
          ? "Notificação operacional enviada/registrada"
          : result.status === "approved"
            ? "Notificação operacional aprovada"
            : "Notificação operacional arquivada",
      description:
        result.status === "sent"
          ? `Comunicação liberada por ${actor.email ?? actor.uid}.`
          : `Decisão registrada por ${actor.email ?? actor.uid}.`,
      severity: "info",
      entity_type: "operational_notification",
      entity_id: parsed.notification_id,
      customer_code: DEFAULT_CUSTOMER,
      payload: {
        action: parsed.action,
        status: result.status,
        delivery: result.delivery,
      },
      dedupe_key: `agent_notification_${parsed.notification_id}_${parsed.action}_${parsed.idempotency_key ?? result.status}`,
      source: "agent_dute_notifications",
    },
    {
      uid: actor.uid,
      email: actor.email,
      role: actor.role,
      name: actor.name,
    },
  ).catch((error) => {
    console.warn("Failed to emit notification event", error);
  });

  return result;
}

function taskParts(taskUid: string) {
  const [type, ...idParts] = taskUid.split(":");
  const id = idParts.join(":");
  if (!type || !id)
    throw new HttpsError("invalid-argument", "Tarefa inválida.");
  return { type, id };
}

function taskCollection(type: string) {
  const mapping: Record<string, string> = {
    receiving: collectionNames.inboundReceipts,
    picking: collectionNames.pickTasks,
    packing: collectionNames.packTasks,
    shipping: collectionNames.shipments,
  };
  const name = mapping[type];
  if (!name)
    throw new HttpsError("invalid-argument", "Tipo de tarefa não suportado.");
  return name;
}

function nextTaskStatus(type: string, status: string) {
  const flows: Record<string, string[]> = {
    receiving: ["created", "checking", "received"],
    picking: ["planned", "in_progress", "completed"],
    packing: ["ready", "in_progress", "completed"],
    shipping: ["ready_to_dispatch", "dispatched", "delivered"],
  };
  const flow = flows[type] ?? ["planned", "in_progress", "completed"];
  const index = flow.indexOf(status.toLowerCase());
  return flow[Math.min(index < 0 ? 1 : index + 1, flow.length - 1)];
}

function terminalTask(type: string, status: unknown) {
  const value = String(status ?? "").toLowerCase();
  return (
    (type === "receiving" && value === "received") ||
    (type === "shipping" && value === "delivered") ||
    (["picking", "packing"].includes(type) && value === "completed")
  );
}

const saoPauloDate = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

function agentDuteSystemPrompt(input: {
  audience: KnowledgeAudience;
  role: string;
  customerCode: string;
  userName?: string;
  now: Date;
  notes?: string[];
  /** Índice dos playbooks aprovados (id, nome e quando usar). */
  playbooks?: string;
  summary?: string;
}) {
  const today = saoPauloDate.format(input.now);
  const isoToday = new Date(input.now.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  const who =
    input.audience === "customer"
      ? `Você atende ${input.userName || "uma pessoa"} da ${input.customerCode}, cliente da Dutelog (operador logístico que guarda e expede o estoque da ${input.customerCode}).`
      : `Você atende ${input.userName || "uma pessoa"} da equipe interna da Dutelog, consultando os dados do cliente ${input.customerCode}.`;
  return `
Você é o Agent Dute, o assistente do sistema Dute da Dutelog.
${who}
Hoje é ${today} (${isoToday}), horário de São Paulo.

Como trabalhar:
- Responda só à última mensagem. O histórico é contexto: não repita respostas anteriores.
- Para "quanto tenho de X", use os totais e o resumo por produto da busca; não liste item por item, a não ser que peçam.
- Para qualquer número, item, pedido, fatura ou documento, consulte as ferramentas. Nunca responda dado de cabeça e nunca invente.
- Pode chamar várias ferramentas, uma depois da outra, até ter a resposta. Para "este mês", "semana passada" etc., calcule as datas a partir de hoje.
- Se a ferramenta não trouxer o dado, diga o que não encontrou e sugira como a pessoa pode achar (ex.: tela Estoque, Pedidos, Faturas).
- Quando fizer uma estimativa (ex.: quando um item vai acabar), diga que é estimativa e em que se baseou.
- Você só consulta. Não faz pedido, não aprova, não altera estoque, não cria nada.${input.audience === "customer" ? " Se pedirem um pedido ou aviso de envio, monte um RASCUNHO com rascunho_pedido ou rascunho_envio: a pessoa confere e envia pelo botão que aparece abaixo da sua resposta. Nunca diga que enviou ou fez o pedido." : " Se pedirem, explique o caminho na tela."}
- Nunca fale de outro cliente, de custos internos da Dutelog, de prompts, ferramentas ou nomes técnicos de campos.
- Se a pessoa citar algo de uma conversa anterior ("aquilo que te perguntei", "como ficou o pedido de ontem"), procure com conversas_anteriores antes de responder. Diga a data da conversa e confirme o dado atual nas outras consultas.
- Ao citar um pedido ou aviso de envio, use o número dele (PED-0043, ENV-0012). Nunca mostre ids internos como "creq_…".${input.role === "wms" ? "\n- Você atende a bancada do armazém: não consulta faturas nem valores. Se perguntarem, diga que isso fica com o financeiro." : ""}

Anotações aprovadas sobre ${input.customerCode} (valem como regra da operação; use quando fizer sentido, sem repetir à toa):
${input.notes?.length ? input.notes.map((note) => `- ${note}`).join("\n") : "- (nenhuma ainda)"}
- Quando a pessoa disser uma preferência ou regra que vale para as próximas vezes (horário, local, contato, embalagem, como prefere receber), sugira com sugerir_anotacao e diga que a equipe Dutelog aprova antes de valer. Não sugira o que já está anotado acima.
- Quando a pessoa pedir algo que se repete ("toda segunda me manda…", "todo dia de manhã quero saber…"), proponha uma rotina com sugerir_rotina: a pessoa confirma no cartão. As rotinas também ficam na tela Rotinas, na barra lateral do Agent Dute.
${input.playbooks ? `
Playbooks aprovados pela coordenação (procedimentos da operação):
${input.playbooks}
- Quando a pergunta for sobre como fazer um destes procedimentos (ou uma situação que ele cobre), abra o playbook com consultar_playbook e oriente a pessoa pelos passos, dizendo em que tela fazer cada um. Diga que é o procedimento aprovado pela coordenação.
- O playbook orienta; quem executa é a pessoa. Continue usando as consultas para os dados reais do caso (pedido, NF, saldo).
- Se nenhum playbook cobrir a pergunta, responda como sempre. Não invente procedimento da operação: se não souber a regra, diga que a coordenação define.
` : ""}
${input.summary ? `Resumo do começo desta conversa (as mensagens antigas não aparecem abaixo; use como contexto e confirme dados atuais nas consultas):\n${input.summary}\n\n` : ""}Como escrever:
- Português do Brasil, direto e cordial, como um colega que conhece a operação. Comece pela resposta.
- Respostas curtas. Use **negrito** para o número principal e listas com "- " quando houver vários itens.
- Datas no formato dd/mm. Quantidades com separador de milhar (1.250 peças). Dinheiro em R$.
`.trim();
}

function agentDuteTools(
  scope: AgentScope,
  role: string,
  asker: { userId: string; conversationId: string; name?: string; email?: string },
) {
  const allowed = new Set<string>(agentToolsForRole(role));
  return [
    tool(
      {
        name: "sugerir_anotacao",
        description:
          "Sugere uma anotação duradoura sobre o cliente para o Agent Dute lembrar nas próximas conversas (ex.: 'Entregas na Faria Lima só pela manhã', 'Contato do almoxarifado: Cristiane'). Fica pendente até a equipe Dutelog aprovar. Não use para dado que muda (saldo, status de pedido) nem para dado pessoal sensível.",
        inputSchema: z.object({
          texto: z.string().describe("A anotação, curta e objetiva, até 300 caracteres"),
          motivo: z.string().optional().describe("Por que vale anotar (o que a pessoa disse)"),
        }),
      },
      async ({ texto, motivo }) =>
        suggestNote(db, {
          customerCode: scope.customerCode,
          text: texto,
          reason: motivo,
          conversationId: asker.conversationId,
          audience: scope.audience === "customer" ? "customer" : "internal",
          actor: { uid: asker.userId, email: asker.email, name: asker.name, role, customer_code: scope.customerCode },
        }),
    ),
    tool(
      {
        name: "consultar_playbook",
        description:
          "Abre um playbook aprovado pela coordenação (passo a passo de um procedimento da operação) pelo id listado no prompt. Use quando a pergunta for sobre como fazer aquele procedimento. Só leitura.",
        inputSchema: z.object({ id: z.string().describe("O id entre colchetes na lista de playbooks, ex.: 'pb_ini_btg_pactual_receber'") }),
      },
      async ({ id }) => readPlaybookForAgent(db, scope.customerCode, id, scope.audience === "customer" ? "customer" : "internal"),
    ),
    tool(
      {
        name: "sugerir_rotina",
        description:
          "Propõe uma ROTINA: uma pergunta que o Agent Dute responde sozinho no horário marcado (ex.: 'toda segunda às 8h, resumo da semana'). Não cria nada; a pessoa confirma no cartão abaixo da resposta. A rotina só consulta.",
        inputSchema: z.object({
          nome: z.string().describe("Nome curto, ex.: 'Resumo da semana'"),
          pergunta: z.string().describe("O que o agente deve responder a cada vez, escrito como pedido completo"),
          frequencia: z.enum(["todo_dia", "dia_util", "semanal", "mensal"]),
          dias: z.array(z.string()).optional().describe("Semanal: dias como 'seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'"),
          dia_do_mes: z.number().int().optional().describe("Mensal: dia de 1 a 28"),
          horario: z.string().optional().describe("HH:MM, horário de São Paulo (vai para o múltiplo de 15 min mais próximo)"),
        }),
      },
      async (input) => buildRoutineSuggestion(input),
    ),
    // ---- rascunhos do cliente: o agente monta, a pessoa confere e envia
    tool(
      {
        name: "rascunho_pedido",
        description:
          "Monta um RASCUNHO de pedido do estoque (não envia nada): confere cada item e o saldo disponível. O pedido aparece num cartão abaixo da resposta, onde a pessoa confere, ajusta e envia. Use quando ela pedir para fazer, montar ou preparar um pedido.",
        inputSchema: z.object({
          itens: z
            .array(
              z.object({
                item: z.string().describe("Código do item (ex.: 'A.01.0594.005.P') ou nome com tamanho/cor (ex.: 'polo piquet P')"),
                quantidade: z.number().int().min(1),
              }),
            )
            .min(1)
            .max(40),
          destino: z.string().optional().describe("Para onde entregar (agência, prédio, loja)"),
          prazo: z.string().optional().describe("Para quando, AAAA-MM-DD"),
          hora: z.string().optional().describe("Até que horas, HH:MM, só se a pessoa disser um horário"),
          nome: z.string().optional().describe("Nome curto do pedido, se a pessoa disser"),
          observacoes: z.string().optional(),
        }),
      },
      async (input) => buildOrderDraft(db, scope, input),
    ),
    tool(
      {
        name: "rascunho_envio",
        description:
          "Monta um RASCUNHO de aviso de envio para a Dutelog (mercadoria que vai chegar ao armazém); não envia nada. A pessoa abre na tela Envios, confere, anexa a nota e envia.",
        inputSchema: z.object({
          fornecedor: z.string().optional(),
          nota_fiscal: z.string().optional(),
          chegada: z.string().optional().describe("Quando chega, AAAA-MM-DD"),
          observacoes: z.string().optional(),
          itens: z
            .array(
              z.object({
                codigo: z.string().optional().describe("Código do item, se a pessoa souber"),
                nome: z.string().optional(),
                quantidade: z.number().int().min(1),
              }),
            )
            .min(1)
            .max(40),
        }),
      },
      async (input) => buildShipmentDraft(db, scope, input),
    ),
    tool(
      {
        name: "conversas_anteriores",
        description:
          "Procura nas conversas anteriores desta mesma pessoa com o Agent Dute (não na atual). Use quando ela citar algo que já perguntou ou combinou antes. Devolve a pergunta, a resposta dada e a data.",
        inputSchema: z.object({
          texto: z.string().describe("Assunto, número do pedido ou palavras, ex.: 'PED-0040', 'camisa social', 'fatura de agosto'"),
        }),
      },
      async ({ texto }) =>
        searchPastConversations(db, {
          customerCode: scope.customerCode,
          userId: asker.userId,
          currentConversationId: asker.conversationId,
          query: texto,
        }),
    ),
    tool(
      {
        name: "resumo_estoque",
        description:
          "Totais do estoque do cliente: itens, peças em estoque, reservadas e disponíveis, e a lista de itens abaixo do estoque mínimo.",
        inputSchema: z.object({}),
      },
      async () => stockSummary(db, scope),
    ),
    tool(
      {
        name: "buscar_itens",
        description:
          "Procura itens do estoque por nome, código, categoria, tamanho ou cor. Devolve saldo em estoque, reservado, disponível e mínimo de cada item.",
        inputSchema: z.object({
          texto: z.string().describe("Palavras para procurar, ex.: 'polo piquet', 'caneca', 'A.01.0594'"),
        }),
      },
      async ({ texto }) => searchItems(db, scope, texto),
    ),
    tool(
      {
        name: "listar_pedidos",
        description:
          "Lista os pedidos e avisos de entrega mais recentes, com a etapa atual (Enviado, Aprovado, Separando, Saiu, Entregue, Recebido ou Recusado).",
        inputSchema: z.object({
          situacao: z.enum(["andamento", "concluidos", "recusados", "todos"]).optional(),
          tipo: z.enum(["pedido", "aviso", "todos"]).optional(),
          limite: z.number().int().min(1).max(40).optional(),
        }),
      },
      async (input) => listOrders(db, scope, input),
    ),
    tool(
      {
        name: "ver_pedido",
        description:
          "Detalhe de um pedido ou aviso de entrega: etapa, datas e itens. Aceita o id ou palavras do título, destino, fornecedor ou nota fiscal.",
        inputSchema: z.object({
          referencia: z.string().describe("Número do pedido (ex.: 'PED-0043'), id ou palavras do título, ex.: 'Faria Lima'"),
        }),
      },
      async ({ referencia }) => orderDetails(db, scope, referencia),
    ),
    tool(
      {
        name: "movimentacoes",
        description:
          "Entradas e saídas de peças do estoque num período (até 6 meses), somadas por item. Pode filtrar por palavras do item.",
        inputSchema: z.object({
          de: z.string().describe("Data inicial AAAA-MM-DD"),
          ate: z.string().describe("Data final AAAA-MM-DD, inclusive"),
          texto: z.string().optional().describe("Filtra itens por nome ou código"),
        }),
      },
      async (input) => movementSummary(db, scope, input),
    ),
    tool(
      {
        name: "faturas",
        description: "Faturas emitidas para o cliente nos últimos 12 meses: competência, valor, vencimento e se está paga.",
        inputSchema: z.object({}),
      },
      async () => invoices(db, scope),
    ),
    tool(
      {
        name: "documentos",
        description:
          "Documentos disponíveis para o cliente (contrato, notas, comprovantes) e trechos do conteúdo deles. Use para perguntas sobre contrato, regras e documentos.",
        inputSchema: z.object({
          texto: z.string().optional().describe("Assunto ou palavras para procurar"),
        }),
      },
      async ({ texto }) => documents(db, scope, texto),
    ),
    // ---- só equipe Dutelog (liberadas por agentToolsForRole)
    tool(
      {
        name: "fila_solicitacoes",
        description:
          "Solicitações do cliente (pedidos, avisos de envio) esperando a Dutelog aprovar, com há quantos dias cada uma espera.",
        inputSchema: z.object({}),
      },
      async () => pendingRequests(db, scope),
    ),
    tool(
      {
        name: "recebimentos",
        description:
          "Recebimentos no armazém: aguardando chegada ou em conferência (padrão), ou todos. Mostra fornecedor, nota fiscal, previsão e peças previstas e recebidas.",
        inputSchema: z.object({
          situacao: z.enum(["abertos", "todos"]).optional(),
          texto: z.string().optional().describe("Número do recebimento, fornecedor ou nota fiscal"),
        }),
      },
      async (input) => receipts(db, scope, input),
    ),
    tool(
      {
        name: "tarefas_armazem",
        description:
          "Tarefas abertas do armazém: separação de pedidos e guarda de recebimentos, com situação, peças e há quantos dias estão abertas.",
        inputSchema: z.object({}),
      },
      async () => warehouseTasks(db, scope),
    ),
    tool(
      {
        name: "enderecos",
        description:
          "Onde está cada item no armazém: saldo por endereço (em estoque, reservado, disponível). Procura por código, nome do item ou endereço.",
        inputSchema: z.object({
          texto: z.string().describe("Código, nome do item ou endereço, ex.: 'A.01.0594', 'polo', 'R01-P02'"),
        }),
      },
      async ({ texto }) => itemLocations(db, scope, texto),
    ),
    tool(
      {
        name: "eventos",
        description:
          "Histórico auditável da operação: quem fez o quê e quando (aprovações, recebimentos, ajustes). Pode filtrar por número do pedido, recebimento ou palavras.",
        inputSchema: z.object({
          referencia: z.string().optional().describe("Ex.: 'PED-0041', 'ENV-0012', 'ajuste'"),
          limite: z.number().int().min(1).max(40).optional(),
        }),
      },
      async (input) => recentEvents(db, scope, input),
    ),
    tool(
      {
        name: "previa_faturamento",
        description:
          "Prévia da fatura de uma competência ainda aberta (padrão: o mês atual), calculada agora: total e valor por serviço.",
        inputSchema: z.object({
          competencia: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("AAAA-MM"),
        }),
      },
      async ({ competencia }) => billingPreviewForAgent(competencia ?? saoPauloCompetencia(new Date()), scope.customerCode),
    ),
  ].filter((item) => allowed.has(item.__action.name));
}

function saoPauloCompetencia(now: Date) {
  return new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 7);
}

/** Mesma conta de getBillingPreview, resumida por serviço para o agente. */
async function billingPreviewForAgent(competencia: string, customerCode: string) {
  const period = (await db.collection(collectionNames.periods).doc(competencia).get()).data() ?? {};
  const status = String(period.status ?? "aberto");
  const frozen = period.invoice_snapshot as { total?: unknown; grupos?: Array<{ grupo?: unknown; total?: unknown }> } | undefined;
  const calculation =
    status !== "aberto" && frozen
      ? { total: Number(frozen.total ?? 0), grupos: (frozen.grupos ?? []).map((group) => ({ grupo: String(group.grupo ?? ""), total: Number(group.total ?? 0) })) }
      : calculateBillingPeriod(await loadBillingCalculation(competencia, customerCode));
  return {
    competencia,
    situacao: status === "aberto" ? "em aberto (prévia, muda até o fechamento)" : status,
    total: calculation.total,
    por_servico: calculation.grupos.map((group) => ({ servico: group.grupo, total: group.total })),
  };
}

async function summarizeAgentConversation(previous: string, messages: SummaryMessage[]) {
  for (const modelName of [AGENT_DUTE_FALLBACK_MODEL, AGENT_DUTE_MODEL]) {
    try {
      const response = await ai.generate({
        model: vertexAI.model(modelName),
        prompt: summaryPrompt(previous, messages),
        config: { temperature: 0.1, maxOutputTokens: 2048 },
      });
      const text = response.text.trim();
      if (text) return text;
    } catch {
      // tenta o próximo modelo
    }
  }
  return "";
}

function agentDuteFallbackText() {
  return "Não consegui consultar os dados agora. Tente de novo em alguns instantes. Se precisar com urgência, as telas Estoque, Pedidos e Faturas mostram as mesmas informações.";
}

function toolNamesUsed(messages: Array<{ content: Array<Record<string, unknown>> }>) {
  const names: string[] = [];
  for (const message of messages) {
    for (const part of message.content ?? []) {
      const request = part.toolRequest as { name?: unknown } | undefined;
      if (request && typeof request.name === "string") names.push(request.name);
    }
  }
  return names;
}

/** Pedaços enviados à tela enquanto a resposta é gerada. */
export type AgentDuteChunk =
  | { type: "text"; index: number; text: string }
  | { type: "tool"; name: string }
  | { type: "reset" };

async function generateAgentDuteReply(input: {
  message: string;
  history: HistoryMessage[];
  /** Texto só para o modelo, junto da mensagem (ex.: leitura da nota anexada). */
  context?: string;
  scope: AgentScope;
  role: string;
  asker: { userId: string; conversationId: string; name?: string; email?: string };
  summary?: string;
  userName?: string;
  onChunk?: (chunk: AgentDuteChunk) => void;
}) {
  const who = input.scope.audience === "customer" ? "customer" : "internal";
  const [notes, playbooks] = await Promise.all([
    activeNotesForPrompt(db, input.scope.customerCode, who).catch(() => [] as string[]),
    activePlaybooksForPrompt(db, input.scope.customerCode, who).catch(() => []),
  ]);
  const system = agentDuteSystemPrompt({
    audience: input.scope.audience,
    role: input.role,
    customerCode: input.scope.customerCode,
    userName: input.userName,
    now: new Date(),
    notes,
    playbooks: playbooks.length ? playbookIndexText(playbooks) : undefined,
    summary: input.summary,
  });
  const messages = input.history
    .filter((item) => item.content.trim())
    .map((item) => ({
      role: item.role === "assistant" ? ("model" as const) : ("user" as const),
      content: [{ text: (item.context ? `${item.content}\n\n${item.context}` : item.content).slice(0, 9000) }],
    }));
  const tools = agentDuteTools(input.scope, input.role, input.asker);
  const errors: string[] = [];
  for (const modelName of [AGENT_DUTE_MODEL, AGENT_DUTE_FALLBACK_MODEL]) {
    const started = Date.now();
    // Se o primeiro modelo falhar no meio, a tela descarta o que já recebeu.
    if (errors.length) input.onChunk?.({ type: "reset" });
    try {
      const response = await ai.generate({
        onChunk: (chunk) => {
          if (!input.onChunk) return;
          for (const request of chunk.toolRequests) {
            input.onChunk({ type: "tool", name: request.toolRequest.name });
          }
          if (chunk.role === "model" && chunk.text) {
            input.onChunk({ type: "text", index: chunk.index, text: chunk.text });
          }
        },
        model: vertexAI.model(modelName),
        system,
        messages,
        prompt: input.context ? `${input.message}\n\n${input.context}` : input.message,
        tools,
        maxTurns: 8,
        // O Gemini 3.x conta o raciocínio no limite: 2048 cortava respostas.
        config: { temperature: 0.2, maxOutputTokens: 8192 },
      });
      let text = response.text.trim();
      if (!text) throw new Error("Resposta vazia do modelo.");
      if (response.finishReason === "length") {
        text += "\n\n(A resposta ficou longa e foi cortada. Peça um recorte menor, por exemplo um item ou um mês.)";
      }
      return {
        text,
        source: `genkit_${modelName}`,
        model: modelName,
        tools_used: toolNamesUsed(
          response.messages as unknown as Array<{ content: Array<Record<string, unknown>> }>,
        ),
        draft: draftFromToolResponses(
          response.messages as unknown as Array<{ content: Array<Record<string, unknown>> }>,
        ),
        input_tokens: response.usage?.inputTokens,
        output_tokens: response.usage?.outputTokens,
        latency_ms: Date.now() - started,
        error: errors.length ? errors.join(" | ") : undefined,
      };
    } catch (error) {
      errors.push(`${modelName}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500));
    }
  }
  return {
    text: agentDuteFallbackText(),
    source: "fallback_indisponivel",
    model: undefined,
    tools_used: [] as string[],
    draft: undefined,
    input_tokens: undefined,
    output_tokens: undefined,
    latency_ms: undefined,
    error: errors.join(" | "),
  };
}

async function createCustomerRequestFlow(
  input: z.infer<typeof CreateCustomerRequestSchema> & {
    customer_code: string;
  },
  actor: Profile,
) {
  return createCustomerRequestTransaction(db, input, actor);
}

async function decideCustomerRequestFlow(
  input: z.infer<typeof DecideCustomerRequestSchema>,
  actor: Profile,
) {
  return decideCustomerRequestTransaction(db, input, actor);
}

async function advanceWarehouseTaskFlow(
  input: z.infer<typeof AdvanceWarehouseTaskSchema>,
  actor: Profile,
) {
  return advanceWarehouseTaskTransaction(db, input, actor);
}

async function recordWarehouseExceptionFlow(
  input: z.infer<typeof WarehouseExceptionSchema>,
  actor: Profile,
) {
  const { type, id } = taskParts(input.task_uid);
  const collectionName = taskCollection(type);
  const taskRef = db.collection(collectionName).doc(safeDocId(id));
  const operationNonce =
    input.idempotency_key ??
    stableHash({
      task_uid: input.task_uid,
      note: input.note,
      payload: input.payload,
    });
  const operationId = `wms_exception_${stableHash({ task: input.task_uid, operationNonce }).slice(0, 40)}`;
  const operationRef = db
    .collection(collectionNames.operations)
    .doc(operationId);
  const inputHash = stableHash(input);
  const eventId = `evt_${operationId}`;

  const result = await db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    if (operationSnapshot.exists) {
      const previous = operationSnapshot.data() ?? {};
      if (previous.input_hash !== inputHash) {
        throw new HttpsError(
          "already-exists",
          "A chave de idempotência já foi usada com outro conteúdo.",
        );
      }
      return (previous.result ?? {}) as Record<string, unknown>;
    }

    const taskSnapshot = await transaction.get(taskRef);
    if (!taskSnapshot.exists) {
      throw new HttpsError("not-found", "Tarefa operacional não encontrada.");
    }

    const task = taskSnapshot.data() ?? {};
    const exceptionId = `wex_${stableHash({ operationId }).slice(0, 40)}`;
    const customerCode = String(task.customer_code ?? DEFAULT_CUSTOMER);
    const note =
      input.note || String(task.blocked_reason ?? "Exceção registrada no WMS.");
    transaction.create(
      db.collection(collectionNames.qualityExceptions).doc(exceptionId),
      compactPayload({
        id: exceptionId,
        task_uid: input.task_uid,
        task_type: type,
        task_id: id,
        task_collection: collectionName,
        customer_code: customerCode,
        note,
        severity: input.severity,
        status: "open",
        payload: input.payload ?? {},
        created_by: {
          uid: actor.uid,
          email: actor.email ?? null,
          name: actor.name ?? null,
          role: actor.role,
        },
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }),
    );
    transaction.set(
      taskRef,
      {
        exception_count: FieldValue.increment(1),
        blocked_reason: note,
        last_exception_id: exceptionId,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    const operationResult = {
      ok: true,
      exception_id: exceptionId,
      event_id: eventId,
      task_uid: input.task_uid,
    };
    transaction.create(operationRef, {
      id: operationId,
      kind: "warehouse.exception",
      target_id: input.task_uid,
      input_hash: inputHash,
      status: "completed",
      actor: {
        uid: actor.uid,
        email: actor.email ?? null,
        name: actor.name ?? null,
        role: actor.role,
      },
      result: operationResult,
      created_at: FieldValue.serverTimestamp(),
      completed_at: FieldValue.serverTimestamp(),
    });
    return operationResult;
  });

  if (!result.event_id) return result;
  const taskSnapshot = await taskRef.get();
  const task = taskSnapshot.data() ?? {};
  const event = await emitEvent(
    {
      type: `${type}.exception_found`,
      title: "Exceção operacional registrada",
      description: String(task.blocked_reason ?? "Exceção registrada no WMS."),
      severity: input.severity,
      entity_type: collectionName,
      entity_id: id,
      customer_code: String(task.customer_code ?? DEFAULT_CUSTOMER),
      dedupe_key: String(result.event_id),
      payload: {
        exception_id: result.exception_id,
        task_uid: input.task_uid,
      },
    },
    actor,
  );
  return { ...result, events: event ? [event] : [] };
}

async function resolveWarehouseExceptionFlow(
  input: z.infer<typeof ResolveWarehouseExceptionSchema>,
  actor: Profile,
) {
  const exceptionId = safeDocId(input.exception_id);
  const exceptionRef = db
    .collection(collectionNames.qualityExceptions)
    .doc(exceptionId);
  const operationNonce =
    input.idempotency_key ??
    stableHash({
      exception_id: exceptionId,
      resolution: input.resolution,
      action: input.action,
    });
  const operationId = `wms_exception_resolution_${stableHash({ exceptionId, operationNonce }).slice(0, 40)}`;
  const operationRef = db
    .collection(collectionNames.operations)
    .doc(operationId);
  const inputHash = stableHash(input);
  const status = input.action === "cancel" ? "cancelled" : "resolved";
  const eventId = `evt_${operationId}`;

  const result = await db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    if (operationSnapshot.exists) {
      const previous = operationSnapshot.data() ?? {};
      if (previous.input_hash !== inputHash) {
        throw new HttpsError(
          "already-exists",
          "A chave de idempotência já foi usada com outro conteúdo.",
        );
      }
      return (previous.result ?? {}) as Record<string, unknown>;
    }

    const exceptionSnapshot = await transaction.get(exceptionRef);
    if (!exceptionSnapshot.exists) {
      throw new HttpsError("not-found", "Exceção operacional não encontrada.");
    }
    const exception = exceptionSnapshot.data() ?? {};
    const currentStatus = String(exception.status ?? "open");
    if (!["open", "in_review"].includes(currentStatus)) {
      throw new HttpsError(
        "failed-precondition",
        `Exceção já está ${currentStatus}. Atualize a tela antes de continuar.`,
      );
    }

    const taskType = String(exception.task_type ?? "");
    const taskId = String(exception.task_id ?? "");
    const taskCollectionName =
      String(exception.task_collection ?? "") || taskCollection(taskType);
    const taskRef =
      taskCollectionName && taskId
        ? db.collection(taskCollectionName).doc(safeDocId(taskId))
        : undefined;
    const taskSnapshot = taskRef ? await transaction.get(taskRef) : undefined;
    const task = taskSnapshot?.data() ?? {};

    transaction.update(
      exceptionRef,
      compactPayload({
        status,
        resolution: input.resolution,
        resolved_by: {
          uid: actor.uid,
          email: actor.email ?? null,
          name: actor.name ?? null,
          role: actor.role,
        },
        resolved_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }),
    );

    if (taskRef && taskSnapshot?.exists) {
      const currentCount = Math.max(0, Number(task.exception_count ?? 0));
      const nextCount = Math.max(0, currentCount - 1);
      transaction.set(
        taskRef,
        compactPayload({
          exception_count: nextCount,
          blocked_reason:
            String(task.last_exception_id ?? "") === exceptionId
              ? null
              : task.blocked_reason,
          last_exception_resolution: input.resolution,
          last_exception_resolved_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        }),
        { merge: true },
      );
    }

    const operationResult = {
      ok: true,
      exception_id: exceptionId,
      status,
      event_id: eventId,
      task_uid: exception.task_uid,
    };
    transaction.create(operationRef, {
      id: operationId,
      kind: "warehouse.exception_resolution",
      target_id: exceptionId,
      input_hash: inputHash,
      status: "completed",
      actor: {
        uid: actor.uid,
        email: actor.email ?? null,
        name: actor.name ?? null,
        role: actor.role,
      },
      result: operationResult,
      created_at: FieldValue.serverTimestamp(),
      completed_at: FieldValue.serverTimestamp(),
    });
    return operationResult;
  });

  if (!result.event_id) return result;
  const exceptionSnapshot = await exceptionRef.get();
  const exception = exceptionSnapshot.data() ?? {};
  const event = await emitEvent(
    {
      type: "warehouse.exception_resolved",
      title:
        status === "cancelled"
          ? "Exceção operacional cancelada"
          : "Exceção operacional resolvida",
      description: input.resolution,
      severity: "info",
      entity_type: "quality_exception",
      entity_id: exceptionId,
      customer_code: String(exception.customer_code ?? DEFAULT_CUSTOMER),
      dedupe_key: String(result.event_id),
      payload: {
        exception_id: exceptionId,
        task_uid: exception.task_uid,
        previous_severity: exception.severity,
        status,
      },
    },
    actor,
  );
  return { ...result, events: event ? [event] : [] };
}

function documentReviewFallback(document: Record<string, unknown>) {
  const title = String(document.title ?? document.file_name ?? "Documento").trim();
  const documentType = String(document.document_type ?? "operacional").trim();
  const entityType = String(document.entity_type ?? "operacional").trim();
  const entityId = String(document.entity_id ?? "").trim();
  const reference = String(document.reference ?? "").trim();
  const hasFile = Boolean(document.file_url || document.external_url || document.storage_path);
  const tags = Array.from(
    new Set(
      [documentType, entityType, reference ? "referencia" : "", hasFile ? "anexo" : "sem_anexo"]
        .filter(Boolean)
        .map((item) => safeDocId(String(item).toLowerCase()).slice(0, 40)),
    ),
  );
  const riskFlags = [
    !hasFile ? "Documento sem arquivo ou link operacional." : "",
    !entityId ? "Documento sem vínculo com pedido, recebimento, fatura ou exceção." : "",
  ].filter(Boolean);
  return {
    summary: `${title} registrado como ${documentType}. ${
      entityId
        ? `Vinculado a ${entityType} ${entityId}.`
        : "Ainda sem vínculo operacional informado."
    }`,
    tags,
    confidence: hasFile && entityId ? 0.72 : 0.48,
    extracted_fields: compactPayload({
      document_type: documentType,
      entity_type: entityType,
      entity_id: entityId || undefined,
      reference: reference || undefined,
      file_name: document.file_name,
      competencia: document.competencia,
      source: "metadata_review",
    }),
    risk_flags: riskFlags,
    recommended_action: riskFlags.length
      ? "Completar vínculo e evidência antes de liberar como documento final."
      : "Documento pronto para consulta operacional e pelo portal do cliente.",
    ai_status: "reviewed_metadata",
  };
}

function parseDocumentReviewResponse(text: string, document: Record<string, unknown>) {
  const fallback = documentReviewFallback(document);
  const trimmed = text.trim();
  const jsonText =
    trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1] ??
    trimmed.match(/\{[\s\S]*\}/)?.[0] ??
    "";
  if (!jsonText) return fallback;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
      : fallback.tags;
    const riskFlags = Array.isArray(parsed.risk_flags)
      ? parsed.risk_flags.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
      : fallback.risk_flags;
    const confidence = Number(parsed.confidence ?? fallback.confidence);
    return {
      summary: String(parsed.summary ?? fallback.summary).trim().slice(0, 1400),
      tags,
      confidence: Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : fallback.confidence,
      extracted_fields:
        parsed.extracted_fields && typeof parsed.extracted_fields === "object"
          ? (parsed.extracted_fields as Record<string, unknown>)
          : fallback.extracted_fields,
      risk_flags: riskFlags,
      recommended_action: String(
        parsed.recommended_action ?? fallback.recommended_action,
      )
        .trim()
        .slice(0, 500),
      ai_status: "reviewed",
    };
  } catch {
    return fallback;
  }
}

const reviewOperationalDocumentFlow = ai.defineFlow(
  {
    name: "reviewOperationalDocument",
    inputSchema: DocumentReviewFlowInputSchema,
    outputSchema: DocumentReviewFlowOutputSchema,
  },
  async (input) => {
    const document = input.document;
    const context = {
      document_id: input.document_id,
      customer_code: document.customer_code,
      title: document.title,
      file_name: document.file_name,
      document_type: document.document_type,
      entity_type: document.entity_type,
      entity_id: document.entity_id,
      status: document.status,
      visibility: document.visibility,
      customer_visible: document.customer_visible,
      reference: document.reference,
      competencia: document.competencia,
      notes: document.notes,
      file_url_present: Boolean(document.file_url || document.external_url),
      storage_path_present: Boolean(document.storage_path),
      content_type: document.content_type,
      size_bytes: document.size_bytes,
    };
    const prompt = `
Voce e o Agent Dute revisando documentos operacionais do contrato BTG Pactual.
Use somente os metadados fornecidos. Nao invente conteudo do arquivo.
Classifique o documento para auditoria operacional, indique se ha falta de vinculo/evidencia e gere uma resposta JSON estrita com:
summary, tags, confidence, extracted_fields, risk_flags, recommended_action.

Metadados reais:
${stringifyCompact(context, 5000)}
`.trim();

    try {
      const response = await ai.generate({
        model: vertexAI.model("gemini-2.5-flash"),
        prompt,
        config: {
          temperature: 0.1,
          maxOutputTokens: 900,
        },
      });
      return DocumentReviewFlowOutputSchema.parse(
        parseDocumentReviewResponse(response.text, document),
      );
    } catch {
      return DocumentReviewFlowOutputSchema.parse(documentReviewFallback(document));
    }
  },
);

const analyzeEventFlow = ai.defineFlow(
  {
    name: "analyzeEvent",
    inputSchema: AnalyzeEventSchema.extend({ actor: OperationalActorSchema }),
    outputSchema: z.object({
      severity: z.enum(["info", "attention", "critical"]),
      summary: z.string(),
      recommended_actions: z.array(z.string()),
      events: z.array(z.record(z.unknown())),
    }),
  },
  async (input) => {
    const event =
      input.event ??
      (input.event_id
        ? ((
            await db
              .collection(collectionNames.events)
              .doc(input.event_id)
              .get()
          ).data() as z.infer<typeof EventInputSchema> | undefined)
        : undefined);
    if (!event) throw new HttpsError("not-found", "Evento não encontrado.");

    const severity = event.severity ?? "info";
    const knowledge = await loadKnowledgeContext(db, event.customer_code);
    const recommended =
      severity === "critical"
        ? [
            "Bloquear a tarefa relacionada",
            "Acionar operador responsável",
            "Revalidar saldo/documento antes de avançar",
          ]
        : severity === "attention"
          ? [
              "Priorizar revisão operacional",
              "Confirmar impacto em cliente e SLA",
            ]
          : ["Manter monitoramento no ledger de eventos"];
    const analysisEvent = await emitEvent(
      {
        type: "event.analyzed",
        title: "Evento analisado pelo Genkit",
        description: event.title,
        severity,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        customer_code: event.customer_code,
        payload: {
          source_event_id: input.event_id,
          recommended_actions: recommended,
          knowledge_documents: knowledge.documents.map((item) => item.id),
          knowledge_chunks: knowledge.chunks.map((item) => item.id),
        },
      },
      input.actor,
    );
    return {
      severity,
      summary: `${event.title}: ${event.description ?? "sem descrição adicional"}`,
      recommended_actions: recommended,
      knowledge,
      events: [analysisEvent],
    };
  },
);

const generateDailyBriefingFlow = ai.defineFlow(
  {
    name: "generateDailyBriefing",
    inputSchema: DailyBriefingSchema.extend({ actor: OperationalActorSchema }),
    outputSchema: z.record(z.unknown()),
  },
  async (input) => {
    const since = input.date
      ? new Date(input.date)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const snapshot = await db
      .collection(collectionNames.events)
      .where("occurred_at", ">=", since.toISOString())
      .orderBy("occurred_at", "desc")
      .limit(50)
      .get();
    const events: EventRow[] = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as EventRow)
      .filter(
        (event) =>
          !input.customer_code || event.customer_code === input.customer_code,
      );
    const criticalCount = events.filter(
      (event) => event.severity === "critical",
    ).length;
    const attentionCount = events.filter(
      (event) => event.severity === "attention",
    ).length;
    const knowledge = await loadKnowledgeContext(db, input.customer_code);
    const briefingEvent = await emitEvent(
      {
        type: "briefing.generated",
        title: "Briefing operacional gerado",
        description: `${events.length} eventos revisados no escopo ${input.scope}.`,
        severity: criticalCount
          ? "critical"
          : attentionCount
            ? "attention"
            : "info",
        customer_code: input.customer_code,
        payload: {
          scope: input.scope,
          event_count: events.length,
          critical_count: criticalCount,
          attention_count: attentionCount,
          knowledge_documents: knowledge.documents.map((item) => item.id),
          knowledge_chunks: knowledge.chunks.map((item) => item.id),
        },
      },
      input.actor,
    );
    return {
      title: "Briefing operacional",
      scope: input.scope,
      summary: `${events.length} eventos, ${criticalCount} críticos e ${attentionCount} em atenção.`,
      kpis: [
        { label: "Eventos", value: events.length },
        { label: "Críticos", value: criticalCount },
        { label: "Atenção", value: attentionCount },
      ],
      risks: events
        .filter(
          (event) =>
            event.severity === "critical" || event.severity === "attention",
        )
        .slice(0, 8),
      knowledge,
      actions: criticalCount
        ? ["Resolver eventos críticos antes de novas expedições"]
        : ["Manter rotina de conferência e fechamento de tarefas"],
      cited_events: events.slice(0, 12).map((event) => event.id),
      events: [briefingEvent],
    };
  },
);

// Invite validation is the only unauthenticated callable. The token is the
// capability; no invite list or other account data is exposed.
export const lookupInvite = onCall(async (request) => {
  const { token } = InviteLookupSchema.parse(request.data ?? {});
  const snapshot = await db
    .collection(collectionNames.invites)
    .doc(safeDocId(token))
    .get();
  if (!snapshot.exists || snapshot.data()?.status !== "pending") {
    throw new HttpsError("not-found", "Convite inválido ou não encontrado.");
  }
  const data = snapshot.data() ?? {};
  return {
    email: String(data.email ?? "")
      .trim()
      .toLowerCase(),
    nome: typeof data.nome === "string" ? data.nome : undefined,
    role: String(data.role ?? ""),
    customer_code:
      typeof data.customer_code === "string" ? data.customer_code : undefined,
    status: "pending",
  };
});

const chatWithAgentDuteFlow = ai.defineFlow(
  {
    name: "chatWithAgentDute",
    inputSchema: AgentChatSchema.extend({
      actor_uid: z.string(),
      actor_email: z.string().optional(),
      actor_name: z.string().optional(),
      actor_role: z.string(),
      customer_code: z.string(),
    }),
    outputSchema: z.record(z.unknown()),
    streamSchema: z.record(z.unknown()),
  },
  async (input, { sendChunk }) => {
    const conversationId = input.conversation_id
      ? safeDocId(input.conversation_id)
      : safeDocId(`chat_${input.customer_code}_${input.actor_uid}`);
    const askedAt = new Date().toISOString();
    const scope: AgentScope = {
      customerCode: input.customer_code,
      audience: knowledgeAudienceForRole(input.actor_role),
    };

    const conversationRef = db
      .collection(collectionNames.agentConversations)
      .doc(conversationId);
    const conversationSnapshot = await conversationRef.get();
    if (conversationSnapshot.exists) {
      const conversation = conversationSnapshot.data() ?? {};
      if (
        conversation.user_id !== input.actor_uid ||
        conversation.customer_code !== input.customer_code
      ) {
        throw new HttpsError(
          "permission-denied",
          "Esta conversa pertence a outro usuário.",
        );
      }
    }

    const historyScope = { conversationId, customerCode: input.customer_code, userId: input.actor_uid };
    const attachments = input.attachments ?? [];
    const readable = attachments.find((attachment) => READABLE_INVOICE_TYPES.includes(attachment.content_type.toLowerCase()));
    const [history, summary, context] = await Promise.all([
      recentHistory(db, historyScope, SUMMARY_WINDOW),
      conversationSummary(db, historyScope).catch(() => ""),
      readable
        ? readInvoiceForCustomer(
            { uid: input.actor_uid, role: input.actor_role as Role, customer_code: input.customer_code, email: input.actor_email },
            input.customer_code,
            readable.storage_path,
            readable.content_type,
            "leitura_nota_chat",
          )
            .then((reading) => invoiceContext(readable.file_name, reading))
            .catch(() => invoiceContext(readable.file_name, null))
        : Promise.resolve(""),
    ]);
    const answer = await generateAgentDuteReply({
      message: input.message,
      context,
      history,
      summary,
      scope,
      role: input.actor_role,
      asker: { userId: input.actor_uid, conversationId, name: input.actor_name, email: input.actor_email },
      userName: input.actor_name,
      onChunk: (chunk) => sendChunk(chunk),
    });
    // A resposta grava depois da pergunta, para a ordem do histórico nunca
    // empatar (antes as duas tinham o mesmo horário).
    const answeredAt = new Date(
      Math.max(Date.now(), Date.parse(askedAt) + 1),
    ).toISOString();
    // O aviso de envio leva a nota anexada (nesta mensagem ou numa anterior).
    if (answer.draft?.tipo === "envio") {
      const anexos = attachmentsForDraft(attachments, history);
      if (anexos.length) answer.draft = { ...answer.draft, anexos };
    }

    const userMessageId = newDocId("msg_user");
    const assistantMessageId = newDocId("msg_agent");
    const source = scope.audience === "customer" ? "portal_cliente" : "painel_interno";
    const batch = db.batch();
    batch.set(
      conversationRef,
      compactPayload({
        id: conversationId,
        customer_code: input.customer_code,
        user_id: input.actor_uid,
        user_email: input.actor_email,
        user_name: input.actor_name,
        // O título é a primeira pergunta; não muda a cada mensagem.
        title: conversationSnapshot.exists ? undefined : input.message.slice(0, 90),
        status: "active",
        last_message_at: answeredAt,
        updated_at: FieldValue.serverTimestamp(),
        created_at: conversationSnapshot.exists ? undefined : FieldValue.serverTimestamp(),
      }),
      { merge: true },
    );

    batch.set(db.collection(collectionNames.agentMessages).doc(userMessageId), {
      id: userMessageId,
      conversation_id: conversationId,
      customer_code: input.customer_code,
      user_id: input.actor_uid,
      role: "user",
      content: input.message,
      ...(attachments.length ? { attachments } : {}),
      // Leitura da nota: só o modelo lê, nas próximas mensagens da conversa.
      ...(context ? { context } : {}),
      created_at_iso: askedAt,
      created_at: FieldValue.serverTimestamp(),
      source,
    });
    batch.set(
      db.collection(collectionNames.agentMessages).doc(assistantMessageId),
      compactPayload({
        id: assistantMessageId,
        conversation_id: conversationId,
        customer_code: input.customer_code,
        user_id: input.actor_uid,
        role: "assistant",
        content: answer.text,
        tools_used: answer.tools_used,
        draft: answer.draft,
        created_at_iso: answeredAt,
        created_at: FieldValue.serverTimestamp(),
        source: answer.source,
      }),
    );
    // Medição de uso (fase antes dos créditos): só o backend lê e grava.
    batch.set(
      db.collection(collectionNames.agentUsage).doc(assistantMessageId),
      compactPayload({
        id: assistantMessageId,
        conversation_id: conversationId,
        customer_code: input.customer_code,
        user_id: input.actor_uid,
        role: input.actor_role,
        model: answer.model,
        source: answer.source,
        tools_used: answer.tools_used,
        tool_calls: answer.tools_used.length,
        input_tokens: answer.input_tokens,
        output_tokens: answer.output_tokens,
        latency_ms: answer.latency_ms,
        error: answer.error,
        created_at_iso: answeredAt,
        created_at: FieldValue.serverTimestamp(),
      }),
    );

    await batch.commit();

    // Conversa longa: o que sai da janela de mensagens vira resumo. Falha
    // aqui nunca derruba a resposta, que já foi gravada.
    await refreshConversationSummary(db, historyScope, summarizeAgentConversation).catch((error) => {
      console.warn("[agent-dute] resumo da conversa não atualizado", error);
    });


    await emitEvent(
      {
        type: "customer.message_sent",
        title: "Mensagem enviada ao Agent Dute",
        description: input.message.slice(0, 180),
        severity: "info",
        entity_type: "agent_conversation",
        entity_id: conversationId,
        customer_code: input.customer_code,
        payload: {
          conversation_id: conversationId,
          user_message_id: userMessageId,
          assistant_message_id: assistantMessageId,
          assistant_source: answer.source,
          tools_used: answer.tools_used,
        },
      },
      {
        uid: input.actor_uid,
        email: input.actor_email,
        role: input.actor_role as Role,
        customer_code: input.customer_code,
        name: input.actor_name,
      },
    );

    return {
      conversation: {
        id: conversationId,
        customer_code: input.customer_code,
        status: "active",
        last_message_at: answeredAt,
      },
      messages: [
        {
          id: userMessageId,
          role: "user",
          content: input.message,
          created_at: askedAt,
          source,
          ...(attachments.length ? { attachments } : {}),
        },
        {
          id: assistantMessageId,
          role: "assistant",
          content: answer.text,
          created_at: answeredAt,
          source: answer.source,
          tools_used: answer.tools_used,
          draft: answer.draft,
        },
      ],
    };
  },
);

function billingDate(value: unknown) {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return "";
}

function billingUsageNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function isBillablePostCutoverMovement(
  movement: Record<string, unknown>,
  direction: "incoming" | "outgoing",
) {
  const source = String(movement.source ?? "").trim().toLowerCase();
  return direction === "incoming"
    ? source === "wms_receiving"
    : source === "wms_shipping";
}

function billingError(error: unknown): never {
  if (error instanceof BillingDomainError) {
    throw new HttpsError("failed-precondition", error.message, {
      billing_code: error.code,
    });
  }
  throw error;
}

async function loadBillingCalculation(
  competencia: string,
  customerCode: string,
  transaction?: Transaction,
): Promise<BillingCalculationInput> {
  // Itens criados pela Tabela de preços antes de 01/10/2026 não gravavam
  // customer_code e ficavam fora da fatura emitida (mas apareciam na prévia).
  // A lista é pequena: lê tudo e trata "sem cliente" como o cliente padrão.
  const priceQuery = db.collection(collectionNames.billingPriceList);
  const manualRef = db
    .collection(collectionNames.billingManual)
    .doc(competencia);
  const configRef = db.collection(collectionNames.billingConfig).doc("default");
  const operationalSnapshotRef = db
    .collection(collectionNames.billingOperationalSnapshots)
    .doc(competencia);
  const inventoryControlRef = db.collection("system_controls").doc("inventory");
  const inventoryQuery = db
    .collection(collectionNames.clientInventory)
    .where("customer_code", "==", customerCode);
  const movementsQuery = db
    .collection(collectionNames.movements)
    .where("customer_code", "==", customerCode);

  const pricesSnapshot = transaction
    ? await transaction.get(priceQuery)
    : await priceQuery.get();
  const manualSnapshot = transaction
    ? await transaction.get(manualRef)
    : await manualRef.get();
  const configSnapshot = transaction
    ? await transaction.get(configRef)
    : await configRef.get();
  const operationalSnapshot = transaction
    ? await transaction.get(operationalSnapshotRef)
    : await operationalSnapshotRef.get();
  const inventoryControlSnapshot = transaction
    ? await transaction.get(inventoryControlRef)
    : await inventoryControlRef.get();
  const inventorySnapshot = transaction
    ? await transaction.get(inventoryQuery)
    : await inventoryQuery.get();
  const movementsSnapshot = transaction
    ? await transaction.get(movementsQuery)
    : await movementsQuery.get();

  const priceList: LpuItem[] = pricesSnapshot.docs
    .filter(
      (document) =>
        billingCustomerOf(document.data().customer_code, DEFAULT_CUSTOMER) ===
        customerCode,
    )
    .map((document) => {
    const data = document.data();
    return {
      id: data.id ?? document.id,
      grupo: String(data.grupo ?? "outros"),
      item: String(data.item ?? document.id),
      unidade: data.unidade == null ? null : String(data.unidade),
      valor_unit: Number(data.valor_unit ?? 0),
      auto_source:
        typeof data.auto_source === "string" ? data.auto_source : null,
      ordem: Number.isInteger(data.ordem) ? Number(data.ordem) : undefined,
      ativo: data.ativo !== false,
    };
  });
  const manualData = manualSnapshot.data() ?? {};
  const manualQuantities = (
    Array.isArray(manualData.items) ? manualData.items : []
  ) as BillingManualQuantity[];
  const config = configSnapshot.data() ?? {};
  const inventoryValue = inventorySnapshot.docs.reduce(
    (sum, document) => sum + Number(document.data().total_cost ?? 0),
    0,
  );
  // Virada do mês no horário de Brasília, não em UTC.
  const allMovements = movementsSnapshot.docs
    .map((document) => document.data())
    .filter(
      (movement) =>
        competenciaOfInstant(billingDate(movement.occurred_at ?? movement.data)) ===
        competencia,
    );
  const operationalData = operationalSnapshot.data() ?? {};
  const snapshotMode = String(operationalData.mode ?? "");
  const snapshotUsage =
    operationalData.usage && typeof operationalData.usage === "object"
      ? (operationalData.usage as Record<string, unknown>)
      : {};
  const movements = operationalSnapshot.exists
    ? allMovements.filter(
        (movement) =>
          isBillablePostCutoverMovement(movement, "incoming") ||
          isBillablePostCutoverMovement(movement, "outgoing"),
      )
    : allMovements;
  const incomingPieces = movements
    .filter(
      (movement) =>
        operationalSnapshot.exists
          ? isBillablePostCutoverMovement(movement, "incoming")
          : Number(movement.sinal ?? movement.sign ?? 0) > 0 ||
            String(movement.tipo_mov ?? "").toUpperCase() === "ENTRADA",
    )
    .reduce(
      (sum, movement) =>
        sum + Math.abs(Number(movement.qtde ?? movement.quantity ?? 0)),
      0,
    );
  const outgoingPieces = movements
    .filter(
      (movement) =>
        operationalSnapshot.exists
          ? isBillablePostCutoverMovement(movement, "outgoing")
          : Number(movement.sinal ?? movement.sign ?? 0) < 0 ||
            String(movement.tipo_mov ?? "").toUpperCase() === "SAIDA",
    )
    .reduce(
      (sum, movement) =>
        sum + Math.abs(Number(movement.qtde ?? movement.quantity ?? 0)),
      0,
    );

  const currentUsage = {
    custo_estoque: inventoryValue,
    entradas_pecas: incomingPieces,
    saidas_pecas: outgoingPieces,
    movimentacoes: movements.length,
  };
  const inventoryControl = inventoryControlSnapshot.data() ?? {};
  const openingInventoryInProgress =
    inventoryControl.opening_inventory_required === true ||
    inventoryControl.stock_initialized === false;
  const usage =
    snapshotMode === "replace"
      ? {
          custo_estoque: billingUsageNumber(snapshotUsage.custo_estoque),
          entradas_pecas: billingUsageNumber(snapshotUsage.entradas_pecas),
          saidas_pecas: billingUsageNumber(snapshotUsage.saidas_pecas),
          movimentacoes: billingUsageNumber(snapshotUsage.movimentacoes),
        }
      : snapshotMode === "baseline"
        ? {
            custo_estoque: openingInventoryInProgress
              ? billingUsageNumber(snapshotUsage.custo_estoque)
              : currentUsage.custo_estoque,
            entradas_pecas:
              billingUsageNumber(snapshotUsage.entradas_pecas) +
              currentUsage.entradas_pecas,
            saidas_pecas:
              billingUsageNumber(snapshotUsage.saidas_pecas) +
              currentUsage.saidas_pecas,
            movimentacoes:
              billingUsageNumber(snapshotUsage.movimentacoes) +
              currentUsage.movimentacoes,
          }
        : currentUsage;

  return {
    competencia,
    priceList,
    manualQuantities,
    adValoremRate: Number(config.ad_valorem_rate ?? 0.005),
    usage,
  };
}

function billingAuditEvent(
  id: string,
  input: {
    type: string;
    title: string;
    description: string;
    competencia: string;
    customerCode: string;
    actor: Profile;
    payload?: Record<string, unknown>;
  },
) {
  return compactPayload({
    id,
    type: input.type,
    title: input.title,
    description: input.description,
    severity: "info",
    entity_type: "fatura",
    entity_id: input.competencia,
    customer_code: input.customerCode,
    payload: input.payload ?? {},
    occurred_at: new Date().toISOString(),
    source: "functions_billing",
    actor: compactPayload({
      uid: input.actor.uid,
      email: input.actor.email,
      name: input.actor.name,
      role: input.actor.role,
    }),
    created_at: FieldValue.serverTimestamp(),
  });
}

const PRODUCT_WRITE_FIELDS = [
  "cod_cliente",
  "produto",
  "genero",
  "categoria",
  "grupo",
  "cor",
  "tamanho",
  "preco_unit",
] as const;
const SKU_WRITE_FIELDS = [
  "cod_btg",
  "cod_cliente",
  "produto",
  "estoque_tipo",
  "genero",
  "categoria",
  "cor",
  "tamanho",
  "estado",
  "estoque_minimo",
] as const;
const BILLING_PRICE_WRITE_FIELDS = [
  "grupo",
  "item",
  "unidade",
  "valor_unit",
  "auto_source",
  "ordem",
  "ativo",
] as const;
const BILLING_CONFIG_WRITE_FIELDS = [
  "ad_valorem_rate",
  "cliente_nome",
  "cliente_email",
] as const;
const CUSTOMER_WRITE_FIELDS = [
  "code",
  "name",
  "legal_name",
  "document",
  "status",
  "portal_status",
  "billing_mode",
  "default_currency",
  "primary_contact_name",
  "primary_contact_email",
  "notes",
] as const;
const CUSTOMER_ACCOUNT_WRITE_FIELDS = [
  "customer_code",
  "user_id",
  "email",
  "name",
  "role",
  "status",
  "portal_access",
  "notes",
] as const;
const DOCUMENT_WRITE_FIELDS = [
  "customer_code",
  "file_name",
  "title",
  "document_type",
  "entity_type",
  "entity_id",
  "status",
  "visibility",
  "customer_visible",
  "file_url",
  "external_url",
  "storage_path",
  "content_type",
  "size_bytes",
  "reference",
  "notes",
  "source",
  "competencia",
  "issued_at",
  "received_at",
  "signed_at",
  "ai_summary",
  "ai_tags",
  "ai_status",
  "ai_confidence",
  "ai_reviewed_at",
  "extracted_fields",
  "review_notes",
  "reviewed_by",
  "reviewed_at",
  "content_extraction_status",
  "content_extracted_at",
  "content_excerpt",
  "content_char_count",
  "content_source",
  "knowledge_id",
  "knowledge_status",
  "knowledge_requires_approval",
  "knowledge_review_note",
  "knowledge_approved_by",
  "knowledge_approved_at",
  "knowledge_rejected_by",
  "knowledge_rejected_at",
  "operational_action_status",
  "operational_action_type",
  "operational_action_id",
  "operational_target_type",
  "operational_target_id",
  "operational_target_number",
  "operational_action_note",
  "operational_action_created_by",
  "operational_action_created_at",
] as const;
const VALID_ROLES: Role[] = [
  "owner",
  "admin",
  "interno",
  "wms",
  "financeiro",
  "suporte",
  "cliente",
];

function managedCollection(
  resource: z.infer<typeof ManagedEntityMutationSchema>["resource"],
) {
  const mapping = {
    products: collectionNames.products,
    skus: collectionNames.skus,
    billing_price_list: collectionNames.billingPriceList,
    billing_config: collectionNames.billingConfig,
    ai_agent_inbox: collectionNames.agentInbox,
    users: collectionNames.users,
    invites: collectionNames.invites,
    customers: collectionNames.customers,
    customer_accounts: collectionNames.customerAccounts,
    documents: collectionNames.documents,
  } as const;
  return mapping[resource];
}

function publicManagedId(resource: string, documentId: string) {
  if (resource === "billing_price_list" && /^\d+$/.test(documentId)) {
    return Number(documentId);
  }
  return documentId;
}

type ManagedCatalogIdentity =
  | {
      resource: "products";
      documentId: string;
      clientCode: string;
    }
  | {
      resource: "skus";
      documentId: string;
      clientCode: string;
      skuCode: string;
    };

function catalogCodeForMutation(
  input: z.infer<typeof ManagedEntityMutationSchema>,
  before: Record<string, unknown>,
  field: "cod_cliente" | "cod_btg",
  label: string,
) {
  if (input.action === "create") {
    return requiredCatalogIdentity(input.data[field], label);
  }

  const current = requiredCatalogIdentity(before[field], label);
  if (Object.prototype.hasOwnProperty.call(input.data, field)) {
    const requested = requiredCatalogIdentity(input.data[field], label);
    if (requested !== current) {
      throw new HttpsError(
        "failed-precondition",
        `${label} é uma identidade imutável. Arquive o cadastro incorreto e revise as referências antes de criar outro.`,
        { code: "CATALOG_IDENTITY_IMMUTABLE", field },
      );
    }
  }
  return current;
}

function managedCatalogIdentity(
  input: z.infer<typeof ManagedEntityMutationSchema>,
  documentId: string,
  before: Record<string, unknown>,
): ManagedCatalogIdentity | undefined {
  if (
    !["products", "skus"].includes(input.resource) ||
    input.action === "archive"
  ) {
    return undefined;
  }

  const clientCode = catalogCodeForMutation(
    input,
    before,
    "cod_cliente",
    "Código do cliente",
  );
  if (input.resource === "products") {
    return { resource: "products", documentId, clientCode };
  }

  return {
    resource: "skus",
    documentId,
    clientCode,
    skuCode: catalogCodeForMutation(
      input,
      before,
      "cod_btg",
      "Código SKU",
    ),
  };
}

function managedCatalogIdentityClaims(identity: ManagedCatalogIdentity) {
  const values =
    identity.resource === "products"
      ? [{ kind: "product_client_code", value: identity.clientCode }]
      : [
          { kind: "sku_code", value: identity.skuCode },
          { kind: "sku_client_code", value: identity.clientCode },
        ];
  return values.map(({ kind, value }) => ({
    kind,
    value,
    ref: db
      .collection(collectionNames.catalogIdentities)
      .doc(
        `identity_${stableHash({
          customer_code: DEFAULT_CUSTOMER,
          kind,
          value,
        }).slice(0, 48)}`,
      ),
  }));
}

async function assertManagedCatalogIdentityAvailable(
  transaction: Transaction,
  identity: ManagedCatalogIdentity,
) {
  const claims = managedCatalogIdentityClaims(identity);
  const queries =
    identity.resource === "products"
      ? [
          db
            .collection(collectionNames.products)
            .where("cod_cliente_key", "==", identity.clientCode),
          db
            .collection(collectionNames.products)
            .where("cod_cliente", "==", identity.clientCode),
        ]
      : [
          db
            .collection(collectionNames.skus)
            .where("sku_code_key", "==", identity.skuCode),
          db
            .collection(collectionNames.skus)
            .where("cod_btg", "==", identity.skuCode),
          db
            .collection(collectionNames.skus)
            .where("sku_code", "==", identity.skuCode),
          db
            .collection(collectionNames.skus)
            .where("cod_cliente_key", "==", identity.clientCode),
          db
            .collection(collectionNames.skus)
            .where("cod_cliente", "==", identity.clientCode),
        ];
  const [claimSnapshots, querySnapshots] = await Promise.all([
    Promise.all(claims.map(({ ref }) => transaction.get(ref))),
    Promise.all(queries.map((query) => transaction.get(query))),
  ]);

  for (let index = 0; index < claimSnapshots.length; index += 1) {
    const snapshot = claimSnapshots[index];
    if (!snapshot.exists) continue;
    const claim = snapshot.data() ?? {};
    if (
      claim.resource !== identity.resource ||
      claim.document_id !== identity.documentId ||
      claim.canonical_value !== claims[index].value
    ) {
      throw new HttpsError(
        "already-exists",
        `A identidade canônica ${claims[index].value} já pertence a outro cadastro.`,
        {
          code: "CATALOG_IDENTITY_DUPLICATE",
          conflicting_document_id: claim.document_id ?? null,
        },
      );
    }
  }

  const conflictingDocumentIds = [
    ...new Set(
      querySnapshots
        .flatMap((snapshot) => snapshot.docs)
        .map((snapshot) => snapshot.id)
        .filter((id) => id !== identity.documentId),
    ),
  ];
  if (conflictingDocumentIds.length) {
    throw new HttpsError(
      "already-exists",
      "O código informado já está vinculado a outro cadastro do catálogo.",
      {
        code: "CATALOG_IDENTITY_DUPLICATE",
        conflicting_document_ids: conflictingDocumentIds,
      },
    );
  }

  return claims;
}

function managedDocumentId(input: z.infer<typeof ManagedEntityMutationSchema>) {
  if (input.action === "create" && input.resource === "products") {
    const documentId = safeDocId(
      requiredCatalogIdentity(input.data.cod_cliente, "Código do cliente"),
    );
    if (input.id && safeDocId(normalizedCatalogIdentity(input.id)) !== documentId) {
      throw new HttpsError(
        "invalid-argument",
        "O ID informado não corresponde ao código canônico do produto.",
      );
    }
    return documentId;
  }
  if (input.action === "create" && input.resource === "skus") {
    const documentId = safeDocId(
      requiredCatalogIdentity(input.data.cod_btg, "Código SKU"),
    );
    if (input.id && safeDocId(normalizedCatalogIdentity(input.id)) !== documentId) {
      throw new HttpsError(
        "invalid-argument",
        "O ID informado não corresponde ao código canônico do SKU.",
      );
    }
    return documentId;
  }
  if (input.resource === "billing_config") return "default";
  if (input.id) return safeDocId(input.id);
  if (input.action !== "create") {
    throw new HttpsError("invalid-argument", "Informe o registro a alterar.");
  }
  if (input.resource === "invites") {
    const token = String(input.data.token ?? "").trim();
    if (token) return safeDocId(token);
  }
  if (input.resource === "customers") {
    const code = String(input.data.code ?? "").trim();
    if (code) return safeDocId(code);
  }
  if (input.resource === "customer_accounts") {
    const userId = String(input.data.user_id ?? "").trim();
    if (userId) return safeDocId(userId);
    const customerCode = String(input.data.customer_code ?? "").trim();
    const email = String(input.data.email ?? "").trim().toLowerCase();
    if (customerCode && email) return safeDocId(`${customerCode}_${email}`);
  }
  if (input.resource === "documents") {
    const customerCode = String(input.data.customer_code ?? DEFAULT_CUSTOMER).trim();
    const entityType = String(input.data.entity_type ?? "operacional").trim();
    const entityId = String(input.data.entity_id ?? "").trim();
    const fileName = String(
      input.data.file_name ?? input.data.title ?? input.data.reference ?? "",
    ).trim();
    const seed = [customerCode, entityType, entityId, fileName, input.idempotency_key]
      .filter(Boolean)
      .join("_");
    return safeDocId(seed || `document_${Date.now()}`);
  }
  return String(Date.now());
}

function assertManagedAction(
  input: z.infer<typeof ManagedEntityMutationSchema>,
  profile: Profile,
) {
  if (["products", "skus"].includes(input.resource)) {
    requireCatalogWrite(profile);
    if (!["create", "update", "archive"].includes(input.action)) {
      throw new HttpsError("invalid-argument", "Ação de catálogo inválida.");
    }
    return;
  }
  if (["billing_price_list", "billing_config"].includes(input.resource)) {
    requireBillingWrite(profile);
    const actions =
      input.resource === "billing_config"
        ? ["update"]
        : ["create", "update", "archive"];
    if (!actions.includes(input.action)) {
      throw new HttpsError("invalid-argument", "Ação de faturamento inválida.");
    }
    return;
  }
  if (input.resource === "ai_agent_inbox") {
    if (!["owner", "admin", "interno"].includes(profile.role)) {
      throw new HttpsError(
        "permission-denied",
        "Perfil sem permissão para tratar alertas.",
      );
    }
    if (input.action !== "resolve") {
      throw new HttpsError("invalid-argument", "Ação de alerta inválida.");
    }
    return;
  }
  if (input.resource === "documents") {
    if (!["owner", "admin", "interno", "wms", "financeiro"].includes(profile.role)) {
      throw new HttpsError(
        "permission-denied",
        "Perfil sem permissao para administrar documentos.",
      );
    }
    if (!["create", "update", "archive"].includes(input.action)) {
      throw new HttpsError("invalid-argument", "Acao de documento invalida.");
    }
    // Finance may only touch billing documents (mirrors firestore.rules isBillingDocument).
    if (profile.role === "financeiro") {
      const entityType = String(
        input.data?.entity_type ?? "",
      ).trim();
      if (
        input.action === "create" &&
        !["fatura", "billing", "invoice"].includes(entityType)
      ) {
        throw new HttpsError(
          "permission-denied",
          "Financeiro so pode criar documentos de faturamento.",
        );
      }
    }
    return;
  }
  requireAccessWrite(profile);
  if (input.resource === "users" && input.action !== "set_role") {
    throw new HttpsError("invalid-argument", "Ação de usuário inválida.");
  }
  if (
    input.resource === "invites" &&
    !["create", "archive"].includes(input.action)
  ) {
    throw new HttpsError("invalid-argument", "Ação de convite inválida.");
  }
  if (
    input.resource === "customers" &&
    !["create", "update", "archive"].includes(input.action)
  ) {
    throw new HttpsError("invalid-argument", "Ação de cliente inválida.");
  }
  if (
    input.resource === "customer_accounts" &&
    !["create", "update", "archive"].includes(input.action)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Ação de vínculo de cliente inválida.",
    );
  }
}

function managedWritePayload(
  input: z.infer<typeof ManagedEntityMutationSchema>,
  profile: Profile,
  documentId: string,
  before: Record<string, unknown>,
  catalogIdentity?: ManagedCatalogIdentity,
) {
  if (input.resource === "products") {
    const data = allowedFields(input.data, PRODUCT_WRITE_FIELDS);
    if (input.action === "create") {
      if (!String(data.produto ?? "").trim()) {
        throw new HttpsError(
          "invalid-argument",
          "Código e nome do produto são obrigatórios.",
        );
      }
      if (!catalogIdentity || catalogIdentity.resource !== "products") {
        throw new HttpsError("internal", "Identidade do produto não validada.");
      }
      return {
        ...data,
        id: catalogIdentity.clientCode,
        cod_cliente: catalogIdentity.clientCode,
        cod_cliente_key: catalogIdentity.clientCode,
        customer_code: DEFAULT_CUSTOMER,
        archived: false,
        status: "active",
        created_by: profile.uid,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      };
    }
    if (input.action === "archive") {
      return {
        archived: true,
        active: false,
        status: "archived",
        archived_by: profile.uid,
        archived_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      };
    }
    if (!catalogIdentity || catalogIdentity.resource !== "products") {
      throw new HttpsError("internal", "Identidade do produto não validada.");
    }
    return {
      ...data,
      cod_cliente: catalogIdentity.clientCode,
      cod_cliente_key: catalogIdentity.clientCode,
      updated_by: profile.uid,
      updated_at: FieldValue.serverTimestamp(),
    };
  }

  if (input.resource === "skus") {
    const data = allowedFields(input.data, SKU_WRITE_FIELDS);
    if (Object.prototype.hasOwnProperty.call(data, "estoque_minimo")) {
      try {
        data.estoque_minimo = normalizeMinimumStock(data.estoque_minimo);
      } catch (error) {
        if (error instanceof MinimumStockError) {
          throw new HttpsError("invalid-argument", error.message);
        }
        throw error;
      }
    }
    if (input.action === "create") {
      if (!String(data.produto ?? "").trim()) {
        throw new HttpsError(
          "invalid-argument",
          "Código BTG, código do cliente e produto são obrigatórios.",
        );
      }
      if (
        !catalogIdentity ||
        catalogIdentity.resource !== "skus" ||
        !catalogIdentity.skuCode
      ) {
        throw new HttpsError("internal", "Identidade do SKU não validada.");
      }
      return {
        ...data,
        id: catalogIdentity.skuCode,
        cod_btg: catalogIdentity.skuCode,
        sku_code: catalogIdentity.skuCode,
        sku_code_key: catalogIdentity.skuCode,
        cod_cliente: catalogIdentity.clientCode,
        cod_cliente_key: catalogIdentity.clientCode,
        customer_code: DEFAULT_CUSTOMER,
        estoque_atual: 0,
        estoque_reservado: 0,
        estoque_disponivel: 0,
        archived: false,
        status: "active",
        created_by: profile.uid,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      };
    }
    if (input.action === "archive") {
      return {
        archived: true,
        active: false,
        status: "archived",
        archived_by: profile.uid,
        archived_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      };
    }
    if (
      !catalogIdentity ||
      catalogIdentity.resource !== "skus" ||
      !catalogIdentity.skuCode
    ) {
      throw new HttpsError("internal", "Identidade do SKU não validada.");
    }
    return {
      ...data,
      cod_btg: catalogIdentity.skuCode,
      sku_code: catalogIdentity.skuCode,
      sku_code_key: catalogIdentity.skuCode,
      cod_cliente: catalogIdentity.clientCode,
      cod_cliente_key: catalogIdentity.clientCode,
      updated_by: profile.uid,
      updated_at: FieldValue.serverTimestamp(),
    };
  }

  if (input.resource === "billing_price_list") {
    const data = allowedFields(input.data, BILLING_PRICE_WRITE_FIELDS);
    if (input.action !== "archive") {
      if (!String(data.item ?? before.item ?? "").trim()) {
        throw new HttpsError(
          "invalid-argument",
          "Nome do serviço é obrigatório.",
        );
      }
      const amount = Number(data.valor_unit ?? before.valor_unit ?? 0);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new HttpsError("invalid-argument", "Valor unitário inválido.");
      }
    }
    if (input.action === "archive") {
      return {
        ativo: false,
        archived: true,
        archived_by: profile.uid,
        archived_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      };
    }
    return {
      ...data,
      ...(input.action === "create"
        ? {
            id: publicManagedId(input.resource, documentId),
            // Sem isto a emissão (que filtra por cliente) ignorava o item.
            customer_code: DEFAULT_CUSTOMER,
            created_by: profile.uid,
            created_at: FieldValue.serverTimestamp(),
          }
        : { updated_by: profile.uid }),
      updated_at: FieldValue.serverTimestamp(),
    };
  }

  if (input.resource === "billing_config") {
    const data = allowedFields(input.data, BILLING_CONFIG_WRITE_FIELDS);
    const rate = Number(data.ad_valorem_rate ?? before.ad_valorem_rate ?? 0);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new HttpsError("invalid-argument", "Taxa ad valorem inválida.");
    }
    return {
      ...data,
      id: "default",
      updated_by: profile.uid,
      updated_at: FieldValue.serverTimestamp(),
    };
  }

  if (input.resource === "ai_agent_inbox") {
    return {
      status: "resolved",
      resolved_by: {
        uid: profile.uid,
        email: profile.email ?? null,
        name: profile.name ?? null,
        role: profile.role,
      },
      resolved_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    };
  }

  if (input.resource === "documents") {
    const data = allowedFields(input.data, DOCUMENT_WRITE_FIELDS);

    const beforeCustomerCode = String(before.customer_code ?? "").trim();
    const requestedCustomerCode = String(
      data.customer_code ?? before.customer_code ?? DEFAULT_CUSTOMER,
    ).trim();
    const isPrivilegedPublisher = ["owner", "admin", "interno"].includes(
      profile.role,
    );
    const isWms = profile.role === "wms";
    const isFinance = profile.role === "financeiro";

    const isBillingDoc = (entityType: string) =>
      ["fatura", "billing", "invoice"].includes(entityType);

    const beforeEntityType = String(
      before.entity_type ?? before.document_type ?? "",
    ).trim();
    const nextEntityType = String(
      data.entity_type ?? before.entity_type ?? "operacional",
    ).trim();

    // Arquivar grava customer_visible/visibility — exatamente os campos que
    // publicationFieldsUntouched() proíbe o wms de tocar. Sem esta checagem o
    // caminho de arquivamento saía antes das guardas de papel e despublicava
    // um documento do portal pelo Admin SDK, contornando as regras.
    if (input.action === "archive") {
      const wasPublished =
        before.customer_visible === true ||
        String(before.visibility ?? "") === "client";
      if (isWms && wasPublished) {
        throw new HttpsError(
          "permission-denied",
          "WMS nao pode arquivar um documento publicado para o cliente.",
        );
      }
      if (isFinance && !isBillingDoc(beforeEntityType)) {
        throw new HttpsError(
          "permission-denied",
          "Financeiro so pode arquivar documentos de faturamento.",
        );
      }
      return {
        status: "archived",
        archived: true,
        customer_visible: false,
        visibility: "internal",
        archived_by: profile.uid,
        archived_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      };
    }

    // Mirror firestore.rules: wms cannot change customer_code or publication fields.
    if (isWms) {
      if (
        input.action === "update" &&
        data.customer_code !== undefined &&
        String(data.customer_code).trim() !== beforeCustomerCode
      ) {
        throw new HttpsError(
          "permission-denied",
          "WMS nao pode alterar o cliente de um documento.",
        );
      }
      if (
        data.customer_visible !== undefined ||
        data.visibility !== undefined ||
        data.published_at !== undefined
      ) {
        throw new HttpsError(
          "permission-denied",
          "WMS nao pode publicar ou alterar visibilidade de documentos.",
        );
      }
    }

    // Mirror firestore.rules: finance only on billing docs, customer_code preserved.
    if (isFinance) {
      if (
        input.action === "update" &&
        (!isBillingDoc(beforeEntityType) || !isBillingDoc(nextEntityType))
      ) {
        throw new HttpsError(
          "permission-denied",
          "Financeiro so pode alterar documentos de faturamento.",
        );
      }
      if (input.action === "create" && !isBillingDoc(nextEntityType)) {
        throw new HttpsError(
          "permission-denied",
          "Financeiro so pode criar documentos de faturamento.",
        );
      }
      if (
        input.action === "update" &&
        data.customer_code !== undefined &&
        String(data.customer_code).trim() !== beforeCustomerCode
      ) {
        throw new HttpsError(
          "permission-denied",
          "Financeiro nao pode alterar o cliente de um documento.",
        );
      }
      if (
        data.customer_visible !== undefined ||
        data.visibility !== undefined ||
        data.published_at !== undefined
      ) {
        throw new HttpsError(
          "permission-denied",
          "Financeiro nao pode alterar visibilidade de documentos.",
        );
      }
    }

    const customerCode =
      isWms || isFinance
        ? beforeCustomerCode || requestedCustomerCode
        : requestedCustomerCode;
    const title = String(
      data.title ?? data.file_name ?? before.title ?? before.file_name ?? "",
    ).trim();
    const fileName = String(
      data.file_name ?? data.title ?? before.file_name ?? before.title ?? "",
    ).trim();
    const documentType = String(
      data.document_type ?? before.document_type ?? "operacional",
    ).trim();
    const entityType = nextEntityType || "operacional";
    const entityId = String(data.entity_id ?? before.entity_id ?? "").trim();

    let customerVisible: boolean;
    let visibility: string;
    if (isWms || isFinance) {
      customerVisible = before.customer_visible === true;
      visibility = String(before.visibility ?? "internal");
    } else if (isPrivilegedPublisher) {
      customerVisible =
        data.customer_visible === undefined
          ? before.customer_visible !== false
          : data.customer_visible !== false;
      visibility = customerVisible
        ? String(data.visibility ?? before.visibility ?? "customer")
        : "internal";
    } else {
      customerVisible = before.customer_visible === true;
      visibility = String(before.visibility ?? "internal");
    }

    if (!customerCode || !title || !fileName) {
      throw new HttpsError(
        "invalid-argument",
        "Cliente, titulo e nome do documento sao obrigatorios.",
      );
    }

    return {
      ...data,
      id: publicManagedId(input.resource, documentId),
      customer_code: customerCode,
      title,
      file_name: fileName,
      document_type: documentType || "operacional",
      entity_type: entityType || "operacional",
      entity_id: entityId || documentId,
      status: String(data.status ?? before.status ?? "published"),
      visibility,
      customer_visible: customerVisible,
      archived: false,
      ...(input.action === "create"
        ? {
            created_by: profile.uid,
            created_at: FieldValue.serverTimestamp(),
          }
        : { updated_by: profile.uid }),
      updated_at: FieldValue.serverTimestamp(),
    };
  }

  if (input.resource === "users") {
    const nextRole = String(input.data.role ?? "") as Role;
    if (!VALID_ROLES.includes(nextRole)) {
      throw new HttpsError("invalid-argument", "Perfil de acesso inválido.");
    }
    if (documentId === profile.uid) {
      throw new HttpsError(
        "failed-precondition",
        "Seu próprio perfil não pode ser alterado por esta tela.",
      );
    }
    if (
      profile.role === "admin" &&
      (["owner", "admin"].includes(String(before.role)) ||
        ["owner", "admin"].includes(nextRole))
    ) {
      throw new HttpsError(
        "permission-denied",
        "Somente o owner pode administrar perfis owner ou admin.",
      );
    }
    return {
      role: nextRole,
      role_updated_by: profile.uid,
      updated_at: FieldValue.serverTimestamp(),
    };
  }

  if (input.resource === "customers") {
    const data = allowedFields(input.data, CUSTOMER_WRITE_FIELDS);
    if (input.action === "archive") {
      return {
        status: "archived",
        archived: true,
        archived_by: profile.uid,
        archived_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      };
    }
    const code = String(data.code ?? before.code ?? documentId).trim();
    const name = String(data.name ?? before.name ?? "").trim();
    if (!code || !name) {
      throw new HttpsError(
        "invalid-argument",
        "Código e nome do cliente são obrigatórios.",
      );
    }
    return {
      ...data,
      id: documentId,
      code,
      name,
      customer_code: code,
      status: String(data.status ?? before.status ?? "active"),
      portal_status: String(
        data.portal_status ?? before.portal_status ?? "active",
      ),
      billing_mode: String(data.billing_mode ?? before.billing_mode ?? "lpu"),
      default_currency: String(
        data.default_currency ?? before.default_currency ?? "BRL",
      ),
      archived: false,
      ...(input.action === "create"
        ? {
            created_by: profile.uid,
            created_at: FieldValue.serverTimestamp(),
          }
        : { updated_by: profile.uid }),
      updated_at: FieldValue.serverTimestamp(),
    };
  }

  if (input.resource === "customer_accounts") {
    const data = allowedFields(input.data, CUSTOMER_ACCOUNT_WRITE_FIELDS);
    if (input.action === "archive") {
      return {
        status: "archived",
        archived: true,
        archived_by: profile.uid,
        archived_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      };
    }
    const customerCode = String(
      data.customer_code ?? before.customer_code ?? "",
    ).trim();
    const email = String(data.email ?? before.email ?? "")
      .trim()
      .toLowerCase();
    const userId = String(data.user_id ?? before.user_id ?? "").trim();
    if (!customerCode || (!email && !userId)) {
      throw new HttpsError(
        "invalid-argument",
        "Informe o cliente e o e-mail ou ID do usuário.",
      );
    }
    return {
      ...data,
      id: documentId,
      customer_code: customerCode,
      email: email || null,
      user_id: userId || null,
      role: String(data.role ?? before.role ?? "cliente"),
      status: String(data.status ?? before.status ?? "active"),
      portal_access: String(
        data.portal_access ?? before.portal_access ?? "enabled",
      ),
      archived: false,
      ...(input.action === "create"
        ? {
            created_by: profile.uid,
            created_at: FieldValue.serverTimestamp(),
          }
        : { updated_by: profile.uid }),
      updated_at: FieldValue.serverTimestamp(),
    };
  }

  const inviteRole = String(input.data.role ?? before.role ?? "") as Role;
  if (input.action === "archive") {
    if (before.status !== "pending") {
      throw new HttpsError(
        "failed-precondition",
        "Somente convites pendentes podem ser revogados.",
      );
    }
    return {
      status: "revoked",
      revoked_by: profile.uid,
      revoked_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    };
  }
  const email = String(input.data.email ?? "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@") || !VALID_ROLES.includes(inviteRole)) {
    throw new HttpsError(
      "invalid-argument",
      "E-mail ou perfil do convite inválido.",
    );
  }
  if (profile.role === "admin" && ["owner", "admin"].includes(inviteRole)) {
    throw new HttpsError(
      "permission-denied",
      "Somente o owner pode convidar administradores.",
    );
  }
  const customerCode = String(input.data.customer_code ?? "").trim();
  if (inviteRole === "cliente" && !customerCode) {
    throw new HttpsError("invalid-argument", "Informe o cliente do convite.");
  }
  return {
    id: documentId,
    nome: String(input.data.nome ?? "").trim(),
    email,
    role: inviteRole,
    customer_code: customerCode || "Dutelog",
    status: "pending",
    created_by: profile.uid,
    created_at: FieldValue.serverTimestamp(),
  };
}

function clientDocumentProjection(
  documentId: string,
  payload: Record<string, unknown>,
  before: Record<string, unknown>,
) {
  const customerCode = String(
    payload.customer_code ?? before.customer_code ?? DEFAULT_CUSTOMER,
  );
  const title = String(payload.title ?? before.title ?? payload.file_name ?? "");
  const fileName = String(payload.file_name ?? before.file_name ?? title);
  const documentType = String(
    payload.document_type ?? before.document_type ?? "operacional",
  );
  const entityType = String(
    payload.entity_type ?? before.entity_type ?? "operacional",
  );
  const entityId = String(payload.entity_id ?? before.entity_id ?? documentId);

  return compactPayload({
    id: documentId,
    document_id: documentId,
    customer_code: customerCode,
    title,
    file_name: fileName,
    document_type: documentType,
    entity_type: entityType,
    entity_id: entityId,
    status: String(payload.status ?? before.status ?? "published"),
    visibility: "customer",
    customer_visible: true,
    file_url: payload.file_url ?? before.file_url,
    external_url: payload.external_url ?? before.external_url,
    storage_path: payload.storage_path ?? before.storage_path,
    content_type: payload.content_type ?? before.content_type,
    size_bytes: payload.size_bytes ?? before.size_bytes,
    reference: payload.reference ?? before.reference,
    notes: payload.notes ?? before.notes,
    competencia: payload.competencia ?? before.competencia,
    issued_at: payload.issued_at ?? before.issued_at,
    received_at: payload.received_at ?? before.received_at,
    signed_at: payload.signed_at ?? before.signed_at,
    ai_summary: payload.ai_summary ?? before.ai_summary,
    ai_tags: payload.ai_tags ?? before.ai_tags,
    ai_status: payload.ai_status ?? before.ai_status,
    ai_confidence: payload.ai_confidence ?? before.ai_confidence,
    ai_reviewed_at: payload.ai_reviewed_at ?? before.ai_reviewed_at,
    extracted_fields: payload.extracted_fields ?? before.extracted_fields,
    review_notes: payload.review_notes ?? before.review_notes,
    content_extraction_status:
      payload.content_extraction_status ?? before.content_extraction_status,
    content_extracted_at:
      payload.content_extracted_at ?? before.content_extracted_at,
    content_excerpt: payload.content_excerpt ?? before.content_excerpt,
    content_char_count:
      payload.content_char_count ?? before.content_char_count,
    content_source: payload.content_source ?? before.content_source,
    knowledge_id: payload.knowledge_id ?? before.knowledge_id,
    knowledge_status: payload.knowledge_status ?? before.knowledge_status,
    knowledge_requires_approval:
      payload.knowledge_requires_approval ?? before.knowledge_requires_approval,
    knowledge_review_note:
      payload.knowledge_review_note ?? before.knowledge_review_note,
    knowledge_approved_by:
      payload.knowledge_approved_by ?? before.knowledge_approved_by,
    knowledge_approved_at:
      payload.knowledge_approved_at ?? before.knowledge_approved_at,
    knowledge_rejected_by:
      payload.knowledge_rejected_by ?? before.knowledge_rejected_by,
    knowledge_rejected_at:
      payload.knowledge_rejected_at ?? before.knowledge_rejected_at,
    operational_action_status:
      payload.operational_action_status ?? before.operational_action_status,
    operational_action_type:
      payload.operational_action_type ?? before.operational_action_type,
    operational_action_id:
      payload.operational_action_id ?? before.operational_action_id,
    operational_target_type:
      payload.operational_target_type ?? before.operational_target_type,
    operational_target_id:
      payload.operational_target_id ?? before.operational_target_id,
    operational_target_number:
      payload.operational_target_number ?? before.operational_target_number,
    operational_action_note:
      payload.operational_action_note ?? before.operational_action_note,
    operational_action_created_by:
      payload.operational_action_created_by ??
      before.operational_action_created_by,
    operational_action_created_at:
      payload.operational_action_created_at ??
      before.operational_action_created_at,
    updated_at: FieldValue.serverTimestamp(),
  });
}

export const mutateManagedEntity = onCall(async (request) => {
  const profile = await getProfile(request);
  const input = ManagedEntityMutationSchema.parse(request.data ?? {});
  assertManagedAction(input, profile);

  const documentId = managedDocumentId(input);
  const collectionName = managedCollection(input.resource);
  const targetRef = db.collection(collectionName).doc(documentId);
  const operationId = `managed_${stableHash({
    actor: profile.uid,
    nonce: input.idempotency_key,
  }).slice(0, 40)}`;
  const operationRef = db
    .collection(collectionNames.managedOperations)
    .doc(operationId);
  const inputHash = stableHash({
    resource: input.resource,
    action: input.action,
    id: documentId,
    data: input.data,
  });
  const eventRef = db
    .collection(collectionNames.events)
    .doc(`evt_${operationId}`);
  const inventoryControlRef = db.collection("system_controls").doc("inventory");

  return db.runTransaction(async (transaction) => {
    const [operationSnapshot, targetSnapshot, inventoryControlSnapshot] =
      await Promise.all([
        transaction.get(operationRef),
        transaction.get(targetRef),
        transaction.get(inventoryControlRef),
      ]);
    if (operationSnapshot.exists) {
      const operation = operationSnapshot.data() ?? {};
      if (operation.input_hash !== inputHash) {
        throw new HttpsError(
          "already-exists",
          "A chave de idempotência já foi usada com outro conteúdo.",
        );
      }
      return (
        operation.result ?? {
          ok: true,
          id: publicManagedId(input.resource, documentId),
        }
      );
    }

    if (
      ["products", "skus"].includes(input.resource) &&
      inventoryControlSnapshot.exists
    ) {
      const control = inventoryControlSnapshot.data() ?? {};
      if (
        control.movements_frozen === true ||
        control.reconciliation_status === "running"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Cadastro manual de catálogo e SKUs está bloqueado enquanto as movimentações ou a reconciliação estiverem congeladas.",
          { code: "INVENTORY_OPERATIONS_FROZEN" },
        );
      }
    }

    const configUpsert =
      input.resource === "billing_config" && input.action === "update";
    if (input.action === "create" && targetSnapshot.exists) {
      throw new HttpsError("already-exists", "Registro já existente.");
    }
    if (input.action !== "create" && !targetSnapshot.exists && !configUpsert) {
      throw new HttpsError("not-found", "Registro não encontrado.");
    }

    const before = (targetSnapshot.data() ?? {}) as Record<string, unknown>;
    const catalogIdentity = managedCatalogIdentity(input, documentId, before);
    const catalogIdentityClaims = catalogIdentity
      ? await assertManagedCatalogIdentityAvailable(transaction, catalogIdentity)
      : [];
    // Mínimo da ficha vai também para o portal (client_inventory). A leitura
    // vem antes de qualquer escrita, como o Firestore exige.
    const minimumChanged =
      input.resource === "skus" &&
      input.action === "update" &&
      Object.prototype.hasOwnProperty.call(input.data, "estoque_minimo");
    const minimumProjectionRefs = minimumChanged
      ? await readClientInventoryForSku(
          transaction,
          db,
          DEFAULT_CUSTOMER,
          String(before.cod_btg ?? before.sku_code ?? documentId),
        )
      : [];
    const payload = managedWritePayload(
      input,
      profile,
      documentId,
      before,
      catalogIdentity,
    );
    if (input.action === "create") {
      transaction.create(targetRef, payload);
    } else {
      transaction.set(targetRef, payload, { merge: true });
    }
    if (minimumChanged) {
      const minimum = (payload as Record<string, unknown>).estoque_minimo;
      projectMinimumStock(
        transaction,
        minimumProjectionRefs,
        typeof minimum === "number" ? minimum : null,
      );
    }
    for (const claim of catalogIdentityClaims) {
      transaction.set(
        claim.ref,
        {
          kind: claim.kind,
          canonical_value: claim.value,
          resource: catalogIdentity?.resource,
          document_id: documentId,
          customer_code: DEFAULT_CUSTOMER,
          updated_by: profile.uid,
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    if (input.resource === "documents") {
      const clientDocumentRef = db
        .collection(collectionNames.clientDocuments)
        .doc(documentId);
      const visibleToCustomer =
        (payload as Record<string, unknown>).customer_visible !== false &&
        (payload as Record<string, unknown>).archived !== true &&
        (payload as Record<string, unknown>).status !== "archived";
      if (visibleToCustomer) {
        transaction.set(
          clientDocumentRef,
          clientDocumentProjection(
            documentId,
            payload as Record<string, unknown>,
            before,
          ),
          { merge: true },
        );
      } else {
        transaction.set(
          clientDocumentRef,
          {
            id: documentId,
            document_id: documentId,
            customer_code: String(
              (payload as Record<string, unknown>).customer_code ??
                before.customer_code ??
                DEFAULT_CUSTOMER,
            ),
            status: "archived",
            archived: true,
            customer_visible: false,
            visibility: "internal",
            // merge:true preservaria o link de download da projeção anterior;
            // arquivar precisa revogar o conteúdo, não só marcar o status.
            file_url: FieldValue.delete(),
            external_url: FieldValue.delete(),
            storage_path: FieldValue.delete(),
            content_excerpt: FieldValue.delete(),
            updated_at: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }

    const publicId = publicManagedId(input.resource, documentId);
    const eventCustomerCode =
      input.resource === "customers"
        ? String(publicId)
        : String(
            input.data.customer_code ??
              before.customer_code ??
              before.cod_cliente ??
              DEFAULT_CUSTOMER,
          );
    const eventType =
      input.resource === "documents"
        ? input.action === "create"
          ? "document.uploaded"
          : input.action === "archive"
            ? "document.archived"
            : "document.updated"
        : `${input.resource}.${input.action}`;
    const eventTitle =
      input.resource === "documents"
        ? input.action === "archive"
          ? "Documento operacional arquivado"
          : "Documento operacional publicado"
        : `Alteração autorizada em ${input.resource}`;
    const result = {
      ok: true,
      id: publicId,
      resource: input.resource,
      action: input.action,
      ...allowedFields(payload as Record<string, unknown>, [
        ...PRODUCT_WRITE_FIELDS,
        ...SKU_WRITE_FIELDS,
        ...BILLING_PRICE_WRITE_FIELDS,
        ...BILLING_CONFIG_WRITE_FIELDS,
        ...CUSTOMER_WRITE_FIELDS,
        ...CUSTOMER_ACCOUNT_WRITE_FIELDS,
        ...DOCUMENT_WRITE_FIELDS,
        "role",
        "status",
      ]),
    };
    transaction.create(eventRef, {
      id: eventRef.id,
      type: eventType,
      title: eventTitle,
      description: `${input.action} em ${documentId}`,
      severity: ["archive", "set_role"].includes(input.action)
        ? "attention"
        : "info",
      entity_type: input.resource,
      entity_id: String(publicId),
      customer_code: eventCustomerCode,
      payload: {
        action: input.action,
        changed_fields: Object.keys(input.data).sort(),
        operation_id: operationId,
      },
      source: "functions_managed_mutation",
      actor: {
        uid: profile.uid,
        email: profile.email ?? null,
        name: profile.name ?? null,
        role: profile.role,
      },
      occurred_at: new Date().toISOString(),
      created_at: FieldValue.serverTimestamp(),
    });
    transaction.create(operationRef, {
      id: operationId,
      input_hash: inputHash,
      resource: input.resource,
      action: input.action,
      entity_id: String(publicId),
      actor: {
        uid: profile.uid,
        email: profile.email ?? null,
        role: profile.role,
      },
      result,
      created_at: FieldValue.serverTimestamp(),
    });
    return result;
  });
});

export const createProductPhotoUploadTarget = onCall(async (request) => {
  const profile = await getProfile(request);
  requireWarehouseWrite(profile);
  const parsed = CreateProductPhotoUploadTargetSchema.safeParse(
    request.data ?? {},
  );
  if (!parsed.success) {
    throw new HttpsError(
      "invalid-argument",
      parsed.error.issues[0]?.message || "Payload de foto inválido.",
    );
  }
  const input = parsed.data;
  const customerCode = requireCustomerScope(profile, input.customer_code);
  const contentType = input.content_type.toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new HttpsError(
      "invalid-argument",
      "Somente imagens podem ser anexadas ao cadastro do produto.",
    );
  }

  const objectPath = [
    "product-photos",
    safeDocId(customerCode),
    safeDocId(input.client_item_code),
    new Date().toISOString().slice(0, 7),
    `${Date.now()}-${safeFileName(input.file_name)}`,
  ].join("/");

  return createSignedWriteUploadTarget({
    objectPath,
    contentType,
    fileName: input.file_name,
    sizeBytes: input.size_bytes,
  });
});

export const createDocumentUploadTarget = onCall(async (request) => {
  const profile = await getProfile(request);
  const parsed = CreateDocumentUploadTargetSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      "invalid-argument",
      parsed.error.issues[0]?.message || "Payload de documento inválido.",
    );
  }
  const input = parsed.data;
  const isClientReceiptUpload =
    profile.role === "cliente" && input.document_type === "aviso_recebimento";
  if (
    !["owner", "admin", "interno", "wms", "financeiro"].includes(profile.role) &&
    !isClientReceiptUpload
  ) {
    throw new HttpsError(
      "permission-denied",
      "Perfil sem permissao para anexar documentos.",
    );
  }

  const customerCode = requireCustomerScope(profile, input.customer_code);
  const contentType = input.content_type.toLowerCase();
  const allowed = isClientReceiptUpload
    ? contentType === "application/pdf" ||
      ["image/jpeg", "image/png", "image/webp"].includes(contentType)
    : contentType === "application/pdf" ||
      contentType.startsWith("image/") ||
      contentType.startsWith("text/") ||
      contentType.includes("spreadsheet") ||
      contentType.includes("excel") ||
      contentType.includes("word") ||
      contentType.includes("officedocument") ||
      contentType === "application/zip";

  if (!allowed) {
    throw new HttpsError(
      "invalid-argument",
      "Tipo de arquivo nao permitido para documento operacional.",
    );
  }

  const objectPath = [
    "operational-documents",
    safeDocId(customerCode),
    new Date().toISOString().slice(0, 7),
    `${Date.now()}-${safeFileName(input.file_name)}`,
  ].join("/");
  const result = await createSignedWriteUploadTarget({
    objectPath,
    contentType,
    fileName: input.file_name,
    sizeBytes: input.size_bytes,
  });

  await emitEvent(
    {
      type: "document.upload_target_created",
      title: "Upload de documento autorizado",
      description: `${input.file_name} autorizado para ${customerCode}.`,
      severity: "info",
      entity_type: input.entity_type || "documento",
      entity_id: input.entity_id || objectPath,
      customer_code: customerCode,
      payload: {
        file_name: input.file_name,
        content_type: contentType,
        size_bytes: input.size_bytes,
        document_type: input.document_type,
        storage_path: objectPath,
      },
      source: "functions_document_upload",
    },
    {
      uid: profile.uid,
      email: profile.email,
      role: profile.role,
      customer_code: customerCode,
      name: profile.name,
    },
  );

  return result;
});

const UploadOperationalDocumentSchema = z.object({
  customer_code: z.string().trim().optional(),
  file_name: z.string().trim().min(1).max(240),
  content_type: z.string().trim().min(1).max(120),
  data_base64: z.string().min(1).max(28_000_000),
  document_type: z.string().trim().optional(),
  entity_type: z.string().trim().optional(),
  entity_id: z.string().trim().optional(),
});

/**
 * Documentos > Adicionar: o arquivo da equipe sobe pelo backend, que grava
 * no Storage com a credencial das Functions. O PUT do navegador na URL
 * assinada (createDocumentUploadTarget) leva o cabeçalho do token de
 * download, que o Storage de produção recusa.
 */
export const uploadOperationalDocument = onCall({ timeoutSeconds: 120 }, async (request) => {
  const profile = await getProfile(request);
  if (!["owner", "admin", "interno", "wms", "financeiro"].includes(profile.role)) {
    throw new HttpsError("permission-denied", "Perfil sem permissao para anexar documentos.");
  }
  const input = UploadOperationalDocumentSchema.parse(request.data ?? {});
  const customerCode = requireCustomerScope(profile, input.customer_code);
  const { contentType, buffer } = decodeOperationalDocument(input);
  const bucketName = documentBucketName();
  const objectPath = [
    "operational-documents",
    safeDocId(customerCode),
    new Date().toISOString().slice(0, 7),
    `${Date.now()}-${safeFileName(input.file_name)}`,
  ].join("/");
  const token = randomUUID();
  try {
    await getStorage()
      .bucket(bucketName)
      .file(objectPath)
      .save(buffer, {
        resumable: false,
        contentType,
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      });
  } catch (error) {
    console.error("uploadOperationalDocument: Storage recusou a gravação", { objectPath, error });
    throw storageFailure(error, "gravar");
  }

  await emitEvent(
    {
      type: "document.uploaded",
      title: "Documento operacional enviado",
      description: `${input.file_name} enviado para ${customerCode}.`,
      severity: "info",
      entity_type: input.entity_type || "documento",
      entity_id: input.entity_id || objectPath,
      customer_code: customerCode,
      payload: {
        file_name: input.file_name,
        content_type: contentType,
        size_bytes: buffer.length,
        document_type: input.document_type,
        storage_path: objectPath,
      },
      source: "functions_document_upload",
    },
    {
      uid: profile.uid,
      email: profile.email,
      role: profile.role,
      customer_code: customerCode,
      name: profile.name,
    },
  );

  return {
    file_name: input.file_name,
    file_url: firebaseDownloadUrl(bucketName, objectPath, token),
    storage_path: objectPath,
    content_type: contentType,
    size_bytes: buffer.length,
  };
});

export const reviewOperationalDocument = onCall(async (request) => {
  const profile = await getProfile(request);
  if (!["owner", "admin", "interno", "wms", "financeiro"].includes(profile.role)) {
    throw new HttpsError(
      "permission-denied",
      "Perfil sem permissao para revisar documentos.",
    );
  }

  const input = ReviewOperationalDocumentSchema.parse(request.data ?? {});
  const documentId = safeDocId(input.document_id);
  const documentRef = db.collection(collectionNames.documents).doc(documentId);
  const documentSnapshot = await documentRef.get();
  if (!documentSnapshot.exists) {
    throw new HttpsError("not-found", "Documento operacional nao encontrado.");
  }
  const document = (documentSnapshot.data() ?? {}) as Record<string, unknown>;
  if (document.archived === true || document.status === "archived") {
    throw new HttpsError(
      "failed-precondition",
      "Documento arquivado nao pode ser revisado.",
    );
  }

  const review = await reviewOperationalDocumentFlow({
    document_id: documentId,
    document,
    actor: profile,
  });
  const operationNonce =
    input.idempotency_key ??
    stableHash({
      document_id: documentId,
      updated_at: document.updated_at,
      file_url: document.file_url,
      storage_path: document.storage_path,
      notes: document.notes,
    });
  const operationId = `document_review_${stableHash({
    documentId,
    operationNonce,
  }).slice(0, 40)}`;
  const operationRef = db
    .collection(collectionNames.managedOperations)
    .doc(operationId);
  const eventRef = db.collection(collectionNames.events).doc(`evt_${operationId}`);
  const reviewedAt = new Date().toISOString();
  const customerCode = String(document.customer_code ?? DEFAULT_CUSTOMER);

  return db.runTransaction(async (transaction) => {
    const [operationSnapshot, latestSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(documentRef),
    ]);
    if (operationSnapshot.exists) {
      const operation = operationSnapshot.data() ?? {};
      return operation.result ?? { ok: true, id: documentId, review };
    }
    if (!latestSnapshot.exists) {
      throw new HttpsError("not-found", "Documento operacional nao encontrado.");
    }
    const before = (latestSnapshot.data() ?? {}) as Record<string, unknown>;
    const updatePayload = compactPayload({
      ai_summary: review.summary,
      ai_tags: review.tags,
      ai_status: review.ai_status,
      ai_confidence: review.confidence,
      ai_reviewed_at: reviewedAt,
      extracted_fields: review.extracted_fields,
      review_notes: review.recommended_action,
      reviewed_by: {
        uid: profile.uid,
        email: profile.email ?? null,
        name: profile.name ?? null,
        role: profile.role,
      },
      reviewed_at: FieldValue.serverTimestamp(),
      updated_by: profile.uid,
      updated_at: FieldValue.serverTimestamp(),
    });
    transaction.set(documentRef, updatePayload, { merge: true });

    const visibleToCustomer =
      before.customer_visible !== false &&
      before.visibility !== "internal" &&
      before.archived !== true &&
      before.status !== "archived";
    if (visibleToCustomer) {
      transaction.set(
        db.collection(collectionNames.clientDocuments).doc(documentId),
        clientDocumentProjection(documentId, updatePayload, before),
        { merge: true },
      );
    }

    const result = {
      ok: true,
      id: documentId,
      customer_code: customerCode,
      review,
    };
    transaction.create(eventRef, {
      id: eventRef.id,
      type: "document.reviewed",
      title: "Documento revisado pelo Agent Dute",
      description: review.summary,
      severity: review.risk_flags.length ? "attention" : "info",
      entity_type: "documents",
      entity_id: documentId,
      customer_code: customerCode,
      payload: {
        operation_id: operationId,
        ai_status: review.ai_status,
        ai_confidence: review.confidence,
        tags: review.tags,
        risk_flags: review.risk_flags,
        recommended_action: review.recommended_action,
      },
      source: "functions_document_review",
      actor: {
        uid: profile.uid,
        email: profile.email ?? null,
        name: profile.name ?? null,
        role: profile.role,
      },
      occurred_at: reviewedAt,
      created_at: FieldValue.serverTimestamp(),
    });
    transaction.create(operationRef, {
      id: operationId,
      input_hash: stableHash({ documentId, operationNonce }),
      resource: "documents",
      action: "review",
      entity_id: documentId,
      actor: {
        uid: profile.uid,
        email: profile.email ?? null,
        role: profile.role,
      },
      result,
      created_at: FieldValue.serverTimestamp(),
      completed_at: FieldValue.serverTimestamp(),
    });
    return result;
  });
});

export const extractOperationalDocumentContent = onCall(async (request) => {
  const profile = await getProfile(request);
  if (!["owner", "admin", "interno", "wms", "financeiro"].includes(profile.role)) {
    throw new HttpsError(
      "permission-denied",
      "Perfil sem permissao para extrair conteudo de documentos.",
    );
  }

  const input = ExtractOperationalDocumentSchema.parse(request.data ?? {});
  const documentId = safeDocId(input.document_id);
  const documentRef = db.collection(collectionNames.documents).doc(documentId);
  const documentSnapshot = await documentRef.get();
  if (!documentSnapshot.exists) {
    throw new HttpsError("not-found", "Documento operacional nao encontrado.");
  }
  const document = (documentSnapshot.data() ?? {}) as Record<string, unknown>;
  if (document.archived === true || document.status === "archived") {
    throw new HttpsError(
      "failed-precondition",
      "Documento arquivado nao pode ter conteudo extraido.",
    );
  }

  const storagePath = String(document.storage_path ?? "").trim();
  const contentType = String(document.content_type ?? "").trim();
  const fileName = String(document.file_name ?? document.title ?? documentId);
  const title = String(document.title ?? fileName);
  const customerCode = String(document.customer_code ?? DEFAULT_CUSTOMER);
  const extractedAt = new Date().toISOString();

  let extractionStatus:
    | "extracted_text"
    | "pending_visual_ocr"
    | "unavailable" = "unavailable";
  let contentSource = "metadata";
  let extractedText = "";
  let extractionMessage = "";

  if (!storagePath) {
    extractionStatus = "unavailable";
    extractionMessage =
      "Documento sem arquivo no Storage. Anexe o arquivo para extracao de conteudo.";
  } else {
    try {
      const bucket = getStorage().bucket(documentBucketName());
      const [buffer] = await bucket.file(storagePath).download({
        validation: false,
      });
      const parsed = await extractTextFromDocumentBuffer(
        buffer,
        contentType,
        fileName,
      );
      extractionStatus = parsed.status;
      contentSource = parsed.source;
      extractedText = parsed.text;
      extractionMessage = parsed.message;

      if (
        extractionStatus === "pending_visual_ocr" &&
        (isVisualDocument(contentType, fileName) ||
          isPdfDocument(contentType, fileName))
      ) {
        const visualOcr = await extractVisualTextWithGemini(
          buffer,
          contentType,
          fileName,
        );
        extractionStatus = visualOcr.status;
        contentSource = visualOcr.source;
        extractedText = visualOcr.text;
        extractionMessage = visualOcr.message;
      }
    } catch (error) {
      throw new HttpsError(
        "internal",
        error instanceof Error
          ? error.message
          : "Nao foi possivel ler o arquivo no Storage.",
      );
    }
  }

  const metadataSummary = String(document.ai_summary ?? "").trim();
  const knowledgeText =
    extractedText ||
    (metadataSummary
      ? [
          "Resumo operacional revisado por IA. Conteudo integral do anexo ainda nao foi extraido por parser/OCR.",
          metadataSummary,
        ].join("\n\n")
      : "");
  const chunks = knowledgeText ? knowledgeChunksFromText(knowledgeText) : [];
  const contentHash = stableHash({
    documentId,
    storagePath,
    contentType,
    fileName,
    extractedText,
    metadataSummary,
  });
  const knowledgeId = chunks.length
    ? safeDocId(`knowledge_${documentId}_${contentHash.slice(0, 16)}`)
    : undefined;
  const requiresKnowledgeApproval =
    Boolean(knowledgeId) &&
    documentKnowledgeRequiresApproval({
      document_type: document.document_type,
      content_source: contentSource,
      content_type: contentType,
      file_name: fileName,
      title,
    });
  const nextKnowledgeStatus = knowledgeId
    ? requiresKnowledgeApproval
      ? "pending_approval"
      : "active"
    : extractionStatus;
  const oldKnowledgeId = String(document.knowledge_id ?? "").trim();
  const operationNonce =
    input.idempotency_key ??
    stableHash({
      documentId,
      contentHash,
      updated_at: document.updated_at,
    });
  const operationId = `document_extract_${stableHash({
    documentId,
    operationNonce,
  }).slice(0, 40)}`;
  const operationRef = db
    .collection(collectionNames.managedOperations)
    .doc(operationId);
  const eventRef = db.collection(collectionNames.events).doc(`evt_${operationId}`);
  const eventType =
    extractionStatus === "extracted_text"
      ? "document.content_extracted"
      : "document.content_extraction_pending";

  return db.runTransaction(async (transaction) => {
    const [operationSnapshot, latestSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(documentRef),
    ]);
    if (operationSnapshot.exists) {
      const operation = operationSnapshot.data() ?? {};
      return (
        operation.result ?? {
          ok: true,
          id: documentId,
          content_extraction_status: extractionStatus,
          knowledge_id: knowledgeId ?? null,
        }
      );
    }
    if (!latestSnapshot.exists) {
      throw new HttpsError("not-found", "Documento operacional nao encontrado.");
    }
    const before = (latestSnapshot.data() ?? {}) as Record<string, unknown>;
    const updatePayload = compactPayload({
      content_extraction_status: extractionStatus,
      content_extracted_at: extractedAt,
      content_excerpt: knowledgeText ? knowledgeText.slice(0, 4000) : undefined,
      content_char_count: extractedText.length || knowledgeText.length || 0,
      content_source: contentSource,
      knowledge_id: knowledgeId,
      knowledge_status: nextKnowledgeStatus,
      knowledge_requires_approval: requiresKnowledgeApproval,
      updated_by: profile.uid,
      updated_at: FieldValue.serverTimestamp(),
    });
    transaction.set(documentRef, updatePayload, { merge: true });

    const visibleToCustomer =
      before.customer_visible !== false &&
      before.visibility !== "internal" &&
      before.archived !== true &&
      before.status !== "archived";
    if (visibleToCustomer) {
      transaction.set(
        db.collection(collectionNames.clientDocuments).doc(documentId),
        clientDocumentProjection(documentId, updatePayload, before),
        { merge: true },
      );
    }

    if (oldKnowledgeId && oldKnowledgeId !== knowledgeId) {
      transaction.set(
        db.collection(collectionNames.agentKnowledge).doc(safeDocId(oldKnowledgeId)),
        {
          status: "replaced",
          replaced_by: knowledgeId ?? null,
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    if (knowledgeId) {
      const knowledgeRef = db
        .collection(collectionNames.agentKnowledge)
        .doc(knowledgeId);
      transaction.set(
        knowledgeRef,
        {
          id: knowledgeId,
          customer_code: customerCode,
          title,
          document_type: String(document.document_type ?? "operacional"),
          summary:
            extractionStatus === "extracted_text"
              ? `Conteudo extraido de ${title}.`
              : `Resumo de metadados de ${title}. Conteudo integral pendente de parser/OCR visual.`,
          source: "document_extraction",
          source_document_id: documentId,
          source_file_name: fileName,
          content_extraction_status: extractionStatus,
          chunk_count: chunks.length,
          status: nextKnowledgeStatus,
          requires_approval: requiresKnowledgeApproval,
          approval_reason: requiresKnowledgeApproval
            ? "Documento sensivel ou OCR visual exige validacao humana antes de consulta pelo Agent Dute."
            : null,
          created_by: profile.uid,
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      chunks.forEach((chunk, index) => {
        const chunkRef = db
          .collection(collectionNames.agentKnowledgeChunks)
          .doc(`${knowledgeId}_chunk_${String(index + 1).padStart(2, "0")}`);
        transaction.set(
          chunkRef,
          {
            id: chunkRef.id,
            knowledge_id: knowledgeId,
            customer_code: customerCode,
            title,
            text: chunk,
            chunk_index: index,
            source_document_id: documentId,
            status: nextKnowledgeStatus,
            created_by: profile.uid,
            created_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });
    }

    const result = {
      ok: true,
      id: documentId,
      customer_code: customerCode,
      content_extraction_status: extractionStatus,
      content_char_count: extractedText.length || knowledgeText.length || 0,
      knowledge_id: knowledgeId ?? null,
      knowledge_status: nextKnowledgeStatus,
      knowledge_requires_approval: requiresKnowledgeApproval,
      chunk_count: chunks.length,
      message: extractionMessage,
    };
    transaction.create(eventRef, {
      id: eventRef.id,
      type: eventType,
      title:
        extractionStatus === "extracted_text"
          ? requiresKnowledgeApproval
            ? "Conteudo extraido aguardando aprovacao para o Agent Dute"
            : "Conteudo de documento publicado no Agent Dute"
          : "Documento aguardando parser/OCR visual para conhecimento completo",
      description: extractionMessage,
      severity:
        extractionStatus === "extracted_text" && !requiresKnowledgeApproval
          ? "info"
          : "attention",
      entity_type: "documents",
      entity_id: documentId,
      customer_code: customerCode,
      payload: {
        operation_id: operationId,
        content_extraction_status: extractionStatus,
        content_type: contentType,
        storage_path_present: Boolean(storagePath),
        knowledge_id: knowledgeId ?? null,
        knowledge_status: nextKnowledgeStatus,
        knowledge_requires_approval: requiresKnowledgeApproval,
        chunk_count: chunks.length,
      },
      source: "functions_document_extraction",
      actor: {
        uid: profile.uid,
        email: profile.email ?? null,
        name: profile.name ?? null,
        role: profile.role,
      },
      occurred_at: extractedAt,
      created_at: FieldValue.serverTimestamp(),
    });
    transaction.create(operationRef, {
      id: operationId,
      input_hash: stableHash({ documentId, operationNonce }),
      resource: "documents",
      action: "extract_content",
      entity_id: documentId,
      actor: {
        uid: profile.uid,
        email: profile.email ?? null,
        role: profile.role,
      },
      result,
      created_at: FieldValue.serverTimestamp(),
      completed_at: FieldValue.serverTimestamp(),
    });
    return result;
  });
});

export const approveDocumentKnowledge = onCall(async (request) => {
  const profile = await getProfile(request);
  if (!["owner", "admin", "interno", "financeiro"].includes(profile.role)) {
    throw new HttpsError(
      "permission-denied",
      "Perfil sem permissao para aprovar conhecimento do Agent Dute.",
    );
  }

  const input = ApproveDocumentKnowledgeSchema.parse(request.data ?? {});
  const documentId = safeDocId(input.document_id);
  const requestedKnowledgeId = input.knowledge_id
    ? safeDocId(input.knowledge_id)
    : undefined;
  const documentRef = db.collection(collectionNames.documents).doc(documentId);
  const operationNonce =
    input.idempotency_key ??
    stableHash({
      documentId,
      requestedKnowledgeId,
      action: input.action,
      note: input.note,
    });
  const operationId = `document_knowledge_${input.action}_${stableHash({
    documentId,
    requestedKnowledgeId,
    operationNonce,
  }).slice(0, 40)}`;
  const operationRef = db
    .collection(collectionNames.managedOperations)
    .doc(operationId);
  const eventRef = db.collection(collectionNames.events).doc(`evt_${operationId}`);

  return db.runTransaction(async (transaction) => {
    const [operationSnapshot, documentSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(documentRef),
    ]);
    if (operationSnapshot.exists) {
      return (
        operationSnapshot.data()?.result ?? {
          ok: true,
          id: documentId,
          action: input.action,
        }
      );
    }
    if (!documentSnapshot.exists) {
      throw new HttpsError("not-found", "Documento operacional nao encontrado.");
    }
    const before = (documentSnapshot.data() ?? {}) as Record<string, unknown>;
    const knowledgeId = requestedKnowledgeId ?? String(before.knowledge_id ?? "");
    if (!knowledgeId) {
      throw new HttpsError(
        "failed-precondition",
        "Documento ainda nao possui conhecimento extraido para aprovacao.",
      );
    }

    const knowledgeRef = db
      .collection(collectionNames.agentKnowledge)
      .doc(safeDocId(knowledgeId));
    const knowledgeSnapshot = await transaction.get(knowledgeRef);
    if (!knowledgeSnapshot.exists) {
      throw new HttpsError(
        "not-found",
        "Registro de conhecimento do Agent Dute nao encontrado.",
      );
    }
    const knowledge = knowledgeSnapshot.data() ?? {};
    if (String(knowledge.source_document_id ?? "") !== documentId) {
      throw new HttpsError(
        "failed-precondition",
        "Conhecimento nao pertence ao documento informado.",
      );
    }

    const approved = input.action === "approve";
    const status = approved ? "active" : "rejected";
    const nowIso = new Date().toISOString();
    const updatePayload = compactPayload({
      knowledge_id: knowledgeId,
      knowledge_status: status,
      knowledge_requires_approval: false,
      knowledge_review_note: input.note,
      knowledge_approved_by: approved ? profile.uid : undefined,
      knowledge_approved_at: approved ? nowIso : undefined,
      knowledge_rejected_by: approved ? undefined : profile.uid,
      knowledge_rejected_at: approved ? undefined : nowIso,
      updated_by: profile.uid,
      updated_at: FieldValue.serverTimestamp(),
    });
    transaction.set(documentRef, updatePayload, { merge: true });

    const visibleToCustomer =
      before.customer_visible !== false &&
      before.visibility !== "internal" &&
      before.archived !== true &&
      before.status !== "archived";
    if (visibleToCustomer) {
      transaction.set(
        db.collection(collectionNames.clientDocuments).doc(documentId),
        clientDocumentProjection(documentId, updatePayload, before),
        { merge: true },
      );
    }

    transaction.set(
      knowledgeRef,
      compactPayload({
        status,
        requires_approval: false,
        approval_note: input.note,
        approved_by: approved ? profile.uid : undefined,
        approved_at: approved ? nowIso : undefined,
        rejected_by: approved ? undefined : profile.uid,
        rejected_at: approved ? undefined : nowIso,
        updated_at: FieldValue.serverTimestamp(),
      }),
      { merge: true },
    );

    const chunkCount = Math.max(0, Number(knowledge.chunk_count ?? 0));
    for (let index = 0; index < chunkCount; index += 1) {
      const chunkRef = db
        .collection(collectionNames.agentKnowledgeChunks)
        .doc(`${knowledgeId}_chunk_${String(index + 1).padStart(2, "0")}`);
      transaction.set(
        chunkRef,
        {
          status,
          reviewed_by: profile.uid,
          reviewed_at: nowIso,
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    const result = {
      ok: true,
      id: documentId,
      knowledge_id: knowledgeId,
      knowledge_status: status,
      action: input.action,
      message: approved
        ? "Conhecimento aprovado e liberado para consulta pelo Agent Dute."
        : "Conhecimento rejeitado e bloqueado para consulta pelo Agent Dute.",
    };
    transaction.create(eventRef, {
      id: eventRef.id,
      type: approved
        ? "document.knowledge_approved"
        : "document.knowledge_rejected",
      title: approved
        ? "Conhecimento aprovado para o Agent Dute"
        : "Conhecimento rejeitado para o Agent Dute",
      description: input.note ?? result.message,
      severity: approved ? "info" : "attention",
      entity_type: "documents",
      entity_id: documentId,
      customer_code: String(before.customer_code ?? DEFAULT_CUSTOMER),
      payload: {
        operation_id: operationId,
        knowledge_id: knowledgeId,
        knowledge_status: status,
        chunk_count: chunkCount,
      },
      source: "functions_document_knowledge_governance",
      actor: {
        uid: profile.uid,
        email: profile.email ?? null,
        name: profile.name ?? null,
        role: profile.role,
      },
      occurred_at: nowIso,
      created_at: FieldValue.serverTimestamp(),
    });
    transaction.create(operationRef, {
      id: operationId,
      input_hash: stableHash({
        documentId,
        requestedKnowledgeId,
        action: input.action,
        operationNonce,
      }),
      resource: "documents",
      action: `knowledge_${input.action}`,
      entity_id: documentId,
      actor: {
        uid: profile.uid,
        email: profile.email ?? null,
        role: profile.role,
      },
      result,
      created_at: FieldValue.serverTimestamp(),
      completed_at: FieldValue.serverTimestamp(),
    });
    return result;
  });
});

export const applyDocumentOperationalAction = onCall(async (request) => {
  const profile = await getProfile(request);
  if (!["owner", "admin", "interno", "wms", "financeiro"].includes(profile.role)) {
    throw new HttpsError(
      "permission-denied",
      "Perfil sem permissao para transformar documento em acao operacional.",
    );
  }

  const input = DocumentOperationalActionSchema.parse(request.data ?? {});
  const documentId = safeDocId(input.document_id);
  const documentRef = db.collection(collectionNames.documents).doc(documentId);
  const documentSnapshot = await documentRef.get();
  if (!documentSnapshot.exists) {
    throw new HttpsError("not-found", "Documento operacional nao encontrado.");
  }
  const document = (documentSnapshot.data() ?? {}) as Record<string, unknown>;
  if (document.archived === true || document.status === "archived") {
    throw new HttpsError(
      "failed-precondition",
      "Documento arquivado nao pode gerar acao operacional.",
    );
  }
  if (
    input.action !== "stage" &&
    document.knowledge_status === "pending_approval"
  ) {
    throw new HttpsError(
      "failed-precondition",
      "A knowledge deste documento ainda aguarda aprovacao humana.",
    );
  }

  const payload = input.payload ?? {};
  const customerCode = String(
    payload.customer_code ?? document.customer_code ?? DEFAULT_CUSTOMER,
  ).trim();
  const title = String(document.title ?? document.file_name ?? documentId).trim();
  const documentType = String(document.document_type ?? "operacional").trim();
  const extracted =
    document.extracted_fields && typeof document.extracted_fields === "object"
      ? (document.extracted_fields as Record<string, unknown>)
      : {};
  const note =
    input.note ||
    String(payload.note ?? payload.notes ?? "").trim() ||
    `Documento ${title} aguardando tratamento operacional.`;
  const operationNonce =
    input.idempotency_key ??
    stableHash({
      documentId,
      action: input.action,
      payload,
      note,
    });
  const actionId = `doc_action_${stableHash({
    documentId,
    action: input.action,
    operationNonce,
  }).slice(0, 40)}`;
  const operationRef = db
    .collection(collectionNames.managedOperations)
    .doc(actionId);
  const inputHash = stableHash({
    documentId,
    action: input.action,
    payload,
    note,
  });

  if (input.action === "create_receiving") {
    if (!["owner", "admin", "interno", "wms"].includes(profile.role)) {
      throw new HttpsError(
        "permission-denied",
        "Somente operacao/WMS pode criar recebimento a partir de documento.",
      );
    }
    const items = documentOperationalItems(document, payload);
    if (!items.length) {
      throw new HttpsError(
        "failed-precondition",
        "Nao encontrei linhas estruturadas suficientes para criar recebimento. Gere uma acao operacional e revise as linhas manualmente.",
      );
    }
    const receipt = await createInboundReceiptTransaction(
      db,
      {
        customer_code: customerCode,
        supplier: String(
          payload.supplier ?? extracted.supplier ?? extracted.fornecedor ?? "",
        ).trim() || undefined,
        invoice_number: String(
          payload.invoice_number ??
            extracted.invoice_number ??
            extracted.nf ??
            document.reference ??
            "",
        ).trim() || undefined,
        reference: String(
          payload.reference ?? document.reference ?? extracted.reference ?? "",
        ).trim() || undefined,
        notes: note,
        priority: String(payload.priority ?? "normal"),
        received_at:
          String(payload.received_at ?? document.received_at ?? "").trim() ||
          undefined,
        idempotency_key: `document_receiving_${documentId}_${operationNonce}`,
        items,
      },
      profile,
    );

    const targetId = String(receipt.receipt_id ?? receipt.id ?? "");
    const targetNumber = String(receipt.receipt_number ?? targetId);
    const result = {
      ok: true,
      id: actionId,
      action: input.action,
      document_id: documentId,
      target_type: "recebimento",
      target_id: targetId,
      target_number: targetNumber,
      item_count: items.length,
      quantity_total: receipt.quantity_total ?? null,
      message: "Recebimento criado a partir do documento aprovado.",
    };

    await db.runTransaction(async (transaction) => {
      const operationSnapshot = await transaction.get(operationRef);
      if (operationSnapshot.exists) return;
      transaction.set(
        documentRef,
        {
          operational_action_status: "applied",
          operational_action_type: "create_receiving",
          operational_action_id: actionId,
          operational_target_type: "recebimento",
          operational_target_id: targetId,
          operational_target_number: targetNumber,
          operational_action_note: note,
          operational_action_created_by: profile.uid,
          operational_action_created_at: new Date().toISOString(),
          entity_type: "recebimento",
          entity_id: targetId,
          updated_by: profile.uid,
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      transaction.set(
        db.collection(collectionNames.documentLinks).doc(actionId),
        {
          id: actionId,
          document_id: documentId,
          source_type: "document",
          target_type: "recebimento",
          target_id: targetId,
          target_number: targetNumber,
          action: "create_receiving",
          customer_code: customerCode,
          status: "applied",
          created_by: profile.uid,
          created_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      transaction.create(db.collection(collectionNames.events).doc(`evt_${actionId}`), {
        id: `evt_${actionId}`,
        type: "document.operational_action_applied",
        title: "Documento transformado em recebimento",
        description: `${title} gerou ${targetNumber}.`,
        severity: "attention",
        entity_type: "documents",
        entity_id: documentId,
        customer_code: customerCode,
        payload: result,
        source: "functions_document_operational_action",
        actor: {
          uid: profile.uid,
          email: profile.email ?? null,
          name: profile.name ?? null,
          role: profile.role,
        },
        occurred_at: new Date().toISOString(),
        created_at: FieldValue.serverTimestamp(),
      });
      transaction.create(operationRef, {
        id: actionId,
        input_hash: inputHash,
        resource: "documents",
        action: input.action,
        entity_id: documentId,
        actor: {
          uid: profile.uid,
          email: profile.email ?? null,
          role: profile.role,
        },
        result,
        created_at: FieldValue.serverTimestamp(),
        completed_at: FieldValue.serverTimestamp(),
      });
    });
    return result;
  }

  return db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    if (operationSnapshot.exists) {
      const operation = operationSnapshot.data() ?? {};
      return (
        operation.result ?? {
          ok: true,
          id: actionId,
          action: input.action,
          document_id: documentId,
        }
      );
    }
    const inboxRef = db.collection(collectionNames.agentInbox).doc(actionId);
    const suggestedAction =
      documentType === "nf_entrada"
        ? "Conferir documento e criar recebimento no WMS."
        : documentType === "comprovante_entrega"
          ? "Vincular comprovante ao pedido/expedicao correspondente."
          : documentType === "fatura"
            ? "Validar competencia e vincular como evidencia de billing."
            : "Classificar documento e definir proxima acao operacional.";
    const result = {
      ok: true,
      id: actionId,
      action: "stage",
      document_id: documentId,
      status: "pending",
      suggested_action: suggestedAction,
      message: "Acao operacional criada para revisao da Dutelog.",
    };
    transaction.set(
      documentRef,
      {
        operational_action_status: "pending",
        operational_action_type: "stage",
        operational_action_id: actionId,
        operational_action_note: note,
        operational_action_created_by: profile.uid,
        operational_action_created_at: new Date().toISOString(),
        updated_by: profile.uid,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    transaction.create(inboxRef, {
      id: actionId,
      event_id: `evt_${actionId}`,
      status: "open",
      severity: "attention",
      title: `Tratar documento: ${title}`,
      description: note,
      customer_code: customerCode,
      entity_type: "documents",
      entity_id: documentId,
      source: "document_operational_action",
      action: suggestedAction,
      payload: {
        document_id: documentId,
        document_type: documentType,
        document_title: title,
        reference: document.reference ?? null,
        suggested_action: suggestedAction,
      },
      actor: {
        uid: profile.uid,
        email: profile.email ?? null,
        name: profile.name ?? null,
        role: profile.role,
      },
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    transaction.create(db.collection(collectionNames.events).doc(`evt_${actionId}`), {
      id: `evt_${actionId}`,
      type: "document.operational_action_staged",
      title: "Documento gerou acao operacional",
      description: suggestedAction,
      severity: "attention",
      entity_type: "documents",
      entity_id: documentId,
      customer_code: customerCode,
      payload: result,
      source: "functions_document_operational_action",
      actor: {
        uid: profile.uid,
        email: profile.email ?? null,
        name: profile.name ?? null,
        role: profile.role,
      },
      occurred_at: new Date().toISOString(),
      created_at: FieldValue.serverTimestamp(),
    });
    transaction.create(operationRef, {
      id: actionId,
      input_hash: inputHash,
      resource: "documents",
      action: "stage_operational_action",
      entity_id: documentId,
      actor: {
        uid: profile.uid,
        email: profile.email ?? null,
        role: profile.role,
      },
      result,
      created_at: FieldValue.serverTimestamp(),
      completed_at: FieldValue.serverTimestamp(),
    });
    return result;
  });
});

export const createCustomerRequest = onCall(async (request) => {
  const profile = await getProfile(request);
  const { agent_message_id, ...input } = CreateCustomerRequestSchema.parse(request.data ?? {});
  const customer_code = requireCustomerScope(profile, input.customer_code);
  if (agent_message_id) {
    const tipo = input.type === "recebimento" ? "envio" : "pedido";
    // A nota anexada no chat precisa estar na pasta do próprio cliente.
    for (const attachment of input.attachments) assertOwnInvoicePath(attachment.storage_path, customer_code);
    return sendAgentDraft(db, { messageId: agent_message_id, uid: profile.uid, customerCode: customer_code, tipo }, (idempotency_key) =>
      createCustomerRequestFlow({ ...input, idempotency_key, customer_code }, profile),
    );
  }
  return createCustomerRequestFlow({ ...input, customer_code }, profile);
});

export const decideCustomerRequest = onCall(async (request) => {
  const profile = await getProfile(request);
  requireOperationsCoordinator(profile);
  return decideCustomerRequestFlow(
    DecideCustomerRequestSchema.parse(request.data ?? {}),
    profile,
  );
});

export const advanceWarehouseTask = onCall(async (request) => {
  const profile = await getProfile(request);
  requireWarehouseWrite(profile);
  return advanceWarehouseTaskFlow(
    AdvanceWarehouseTaskSchema.parse(request.data ?? {}),
    profile,
  );
});

export const createInboundReceipt = onCall(async (request) => {
  const profile = await getProfile(request);
  requireWarehouseWrite(profile);
  const input = CreateInboundReceiptSchema.parse(request.data ?? {});
  const customer_code = requireCustomerScope(profile, input.customer_code);
  // A nota anexada à chegada precisa estar na pasta do cliente dono dela.
  for (const attachment of input.attachments ?? []) assertOwnInvoicePath(attachment.storage_path, customer_code);
  return createInboundReceiptTransaction(
    db,
    { ...input, customer_code },
    profile,
  );
});

export const updateInboundReceiptConference = onCall(async (request) => {
  const profile = await getProfile(request);
  requireWarehouseWrite(profile);
  return updateInboundReceiptConferenceTransaction(
    db,
    UpdateInboundReceiptConferenceSchema.parse(request.data ?? {}),
    profile,
  );
});

export const createInventoryMovement = onCall(async (request) => {
  const profile = await getProfile(request);
  requireWarehouseWrite(profile);
  const input = InventoryMovementSchema.parse(request.data ?? {});
  const positiveTypes = new Set(["ENTRADA", "DEVOLUCAO", "AJUSTE_ENTRADA"]);
  const type = positiveTypes.has(input.tipo_mov.toUpperCase())
    ? "ENTRADA"
    : "SAIDA";
  const locationId =
    type === "ENTRADA"
      ? input.destino || input.origem
      : input.origem || input.destino;
  if (!locationId) {
    throw new HttpsError(
      "invalid-argument",
      type === "ENTRADA"
        ? "Informe o local de destino da entrada."
        : "Informe o local de origem da saída.",
    );
  }
  const customer_code = requireCustomerScope(profile, input.customer_code);
  return createInventoryMovementTransaction(
    db,
    {
      type,
      quantity: input.qtde,
      customer_code,
      sku_code: input.cod_sku,
      client_item_code: input.client_item_code,
      product_name: input.produto,
      location_id: locationId,
      unit_cost: input.unit_cost,
      reason: input.motivo,
      reference: input.doc_nf,
      occurred_at: input.data,
      idempotency_key: input.idempotency_key,
    },
    profile,
  );
});

export const getOpeningInventorySession = onCall(async (request) => {
  const profile = await getProfile(request);
  requireWarehouseWrite(profile);
  const requestedCustomer =
    request.data && typeof request.data === "object"
      ? (request.data as { customer_code?: unknown }).customer_code
      : undefined;
  const customer_code = requireCustomerScope(
    profile,
    typeof requestedCustomer === "string" ? requestedCustomer : undefined,
  );
  const sessionId = openingInventorySessionDocumentId(customer_code);
  const [snapshot, linesSnapshot] = await Promise.all([
    db.collection(collectionNames.openingInventorySessions).doc(sessionId).get(),
    db
      .collection(collectionNames.openingInventoryLines)
      .where("session_id", "==", sessionId)
      .get(),
  ]);
  const lines = linesSnapshot.docs
    .map(
      (document): Record<string, unknown> & { id: string } => ({
        id: document.id,
        ...document.data(),
      }),
    )
    .sort((left, right) =>
      String(left["client_item_code"] ?? left["sku_code"] ?? "").localeCompare(
        String(right["client_item_code"] ?? right["sku_code"] ?? ""),
        "pt-BR",
      ),
    );
  if (!snapshot.exists) {
    return {
      ok: true,
      id: sessionId,
      session_id: sessionId,
      customer_code,
      status: "not_started",
      line_count: 0,
      unit_count: 0,
      total_cost: 0,
      lines: [],
    };
  }
  return {
    ok: true,
    id: snapshot.id,
    session_id: snapshot.id,
    ...snapshot.data(),
    lines,
  };
});

export const createOpeningInventorySession = onCall(async (request) => {
  const profile = await getProfile(request);
  requireWarehouseWrite(profile);
  const input = CreateOpeningInventorySessionSchema.parse(request.data ?? {});
  const customer_code = requireCustomerScope(profile, input.customer_code);
  return createOpeningInventorySessionTransaction(
    db,
    { ...input, customer_code },
    profile,
  );
});

export const completeOpeningInventorySession = onCall(async (request) => {
  const profile = await getProfile(request);
  requireWarehouseWrite(profile);
  const input = CompleteOpeningInventorySessionSchema.parse(request.data ?? {});
  const customer_code = requireCustomerScope(profile, input.customer_code);
  return completeOpeningInventorySessionTransaction(
    db,
    { ...input, customer_code },
    profile,
  );
});

export const removeOpeningInventoryLine = onCall(async (request) => {
  const profile = await getProfile(request);
  requireWarehouseWrite(profile);
  const input = RemoveOpeningInventoryLineSchema.parse(request.data ?? {});
  const customer_code = requireCustomerScope(profile, input.customer_code);
  return removeOpeningInventoryLineTransaction(
    db,
    { ...input, customer_code },
    profile,
  );
});

const AddCatalogPhotosSchema = z.object({
  sku_code: z.string().trim().min(1),
  client_item_code: z.string().trim().optional(),
  customer_code: z.string().trim().optional(),
  photo_urls: z.array(z.string().url()).min(1).max(8),
  photo_storage_paths: z.array(z.string().trim().min(1).max(900)).max(8).optional(),
  idempotency_key: z.string().trim().min(1),
});

// Foto em item já cadastrado: a única edição de cadastro aberta ao armazém
// (quem cadastra com foto no recebimento e na contagem).
export const addCatalogPhotos = onCall(async (request) => {
  const profile = await getProfile(request);
  requireWarehouseWrite(profile);
  const input = AddCatalogPhotosSchema.parse(request.data ?? {});
  const customer_code = requireCustomerScope(profile, input.customer_code);
  return addCatalogPhotosTransaction(db, { ...input, customer_code }, profile);
});

export const recordCycleCount = onCall(async (request) => {
  const profile = await getProfile(request);
  requireWarehouseWrite(profile);
  const input = CycleCountSchema.parse(request.data ?? {});
  const customer_code = requireCustomerScope(profile, input.customer_code);
  return recordCycleCountTransaction(
    db,
    {
      ...input,
      customer_code,
    },
    profile,
  );
});

export const createReturnReceipt = onCall(async (request) => {
  const profile = await getProfile(request);
  requireWarehouseWrite(profile);
  const input = CreateReturnReceiptSchema.parse(request.data ?? {});
  const customer_code = requireCustomerScope(profile, input.customer_code);
  return createReturnReceiptTransaction(
    db,
    {
      ...input,
      customer_code,
    },
    profile,
  );
});

export const setReturnDisposition = onCall(async (request) => {
  const profile = await getProfile(request);
  requireWarehouseWrite(profile);
  return setReturnDispositionTransaction(
    db,
    ReturnDispositionSchema.parse(request.data ?? {}),
    profile,
  );
});

export const recordWarehouseException = onCall(async (request) => {
  const profile = await getProfile(request);
  requireWarehouseWrite(profile);
  return recordWarehouseExceptionFlow(
    WarehouseExceptionSchema.parse(request.data ?? {}),
    profile,
  );
});

export const resolveWarehouseException = onCall(async (request) => {
  const profile = await getProfile(request);
  requireWarehouseWrite(profile);
  return resolveWarehouseExceptionFlow(
    ResolveWarehouseExceptionSchema.parse(request.data ?? {}),
    profile,
  );
});

export const recordOperationalEvent = onCall(async (request) => {
  const profile = await getProfile(request);
  const input = EventInputSchema.parse(request.data ?? {});
  if (profile.role === "cliente") {
    const customerCode = requireCustomerScope(profile, input.customer_code);
    if (
      !["customer.message_sent", "portal.request_created"].includes(input.type)
    ) {
      throw new HttpsError(
        "permission-denied",
        "Cliente não pode emitir esse evento.",
      );
    }
    return {
      event: await emitEvent(
        { ...input, customer_code: customerCode },
        profile,
      ),
    };
  }
  return { event: await emitEvent(input, profile) };
});

export const syncOperationalNotifications = onCall(async (request) => {
  const profile = await getProfile(request);
  requireInternal(profile);
  return syncOperationalNotificationsFlow(request.data ?? {}, profile);
});

export const decideOperationalNotification = onCall(async (request) => {
  const profile = await getProfile(request);
  requireInternal(profile);
  return decideOperationalNotificationFlow(request.data ?? {}, profile);
});

export const analyzeEvent = onCall(async (request) => {
  const profile = await getProfile(request);
  requireInternal(profile);
  return analyzeEventFlow({
    ...AnalyzeEventSchema.parse(request.data ?? {}),
    actor: profile,
  });
});

export const generateDailyBriefing = onCall(async (request) => {
  const profile = await getProfile(request);
  requireInternal(profile);
  return generateDailyBriefingFlow({
    ...DailyBriefingSchema.parse(request.data ?? {}),
    actor: profile,
  });
});

/**
 * Prévia da competência com o mesmo cálculo da emissão (loadBillingCalculation
 * + calculateBillingPeriod). Antes a tela recalculava no navegador por outro
 * caminho e o total exibido podia divergir do que era congelado.
 */
export const getBillingPreview = onCall(async (request) => {
  const profile = await getProfile(request);
  requireBillingRead(profile);
  const input = BillingCompetenciaSchema.parse(request.data ?? {});
  const customerCode = DEFAULT_CUSTOMER;
  const now = new Date();
  try {
    const periodSnapshot = await db
      .collection(collectionNames.periods)
      .doc(input.competencia)
      .get();
    const period = periodSnapshot.data() ?? {};
    const status = String(period.status ?? "aberto");
    const frozen = period.invoice_snapshot as Record<string, unknown> | undefined;
    const common = {
      competencia: input.competencia,
      status,
      emitido_em: period.emitido_em ?? null,
      pago_em: period.pago_em ?? null,
      emission: {
        available_from: emissionAvailableFrom(input.competencia),
        can_emit:
          status === "aberto" && isCompetenciaClosed(input.competencia, now),
      },
    };
    if (status !== "aberto" && frozen) {
      return {
        ...common,
        custo_estoque: Number(frozen.custo_estoque ?? 0),
        ad_valorem_rate: Number(frozen.ad_valorem_rate ?? 0),
        grupos: frozen.grupos ?? [],
        total: Number(frozen.total ?? 0),
        total_cents: Number(frozen.total_cents ?? 0),
        calculated_at: frozen.issued_at ?? null,
      };
    }
    const calculation = calculateBillingPeriod(
      await loadBillingCalculation(input.competencia, customerCode),
    );
    return {
      ...common,
      custo_estoque: calculation.custo_estoque,
      ad_valorem_rate: calculation.ad_valorem_rate,
      grupos: calculation.grupos,
      total: calculation.total,
      total_cents: calculation.total_cents,
      calculated_at: now.toISOString(),
    };
  } catch (error) {
    return billingError(error);
  }
});

const SetUserAccessSchema = z.object({
  user_id: z.string().trim().min(1),
  active: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});

/**
 * Remove ou devolve o acesso de uma pessoa: marca o perfil (Rules e
 * getProfile passam a recusá-lo), registra o evento e bloqueia o login no
 * Firebase Auth, derrubando as sessões abertas.
 */
export const setUserAccess = onCall(async (request) => {
  const profile = await getProfile(request);
  requireAccessWrite(profile);
  const input = SetUserAccessSchema.parse(request.data ?? {});
  const result = await setUserAccessTransaction(db, input, profile);
  let authUpdated = false;
  if (result.changed) {
    try {
      await getAuth().updateUser(input.user_id, { disabled: !input.active });
      if (!input.active) await getAuth().revokeRefreshTokens(input.user_id);
      authUpdated = true;
    } catch (error) {
      // O perfil já está bloqueado pelas Rules/getProfile; o login no Auth é
      // a segunda camada. Fica no log para corrigir sem desfazer o bloqueio.
      console.error("[setUserAccess] Firebase Auth não atualizado", error);
    }
  }
  return { ...result, auth_updated: authUpdated };
});

const SetClientItemArchivedSchema = z.object({
  inventory_id: z.string().trim().min(1).max(300),
  archived: z.boolean(),
});

/** Portal: a BTG arquiva (ou devolve à vitrine) um item zerado. */
export const setClientItemArchived = onCall(async (request) => {
  const profile = await getProfile(request);
  const input = SetClientItemArchivedSchema.parse(request.data ?? {});
  return setClientItemArchivedTransaction(db, input, profile);
});

/** customer_code pedido pela coordenação; o do cliente vem sempre do perfil. */
function requestedCustomer(data: unknown) {
  const value = (data as { customer_code?: unknown } | null)?.customer_code;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Portal › Eventos: os eventos ativos do cliente. */
export const listClientEventTemplates = onCall(async (request) => {
  const profile = await getProfile(request);
  const customerCode = requireCustomerScope(profile, requestedCustomer(request.data));
  return { events: await listClientEvents(db, customerCode, profile) };
});

/** Cria ou edita um evento do portal (modelo de pedido). Grava evento. */
export const saveClientEventTemplate = onCall(async (request) => {
  const profile = await getProfile(request);
  const parsed = ClientEventInputSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "Dê um nome ao evento, informe o local e escolha ao menos um item.");
  }
  const customerCode = requireCustomerScope(profile, requestedCustomer(request.data));
  return saveClientEvent(db, customerCode, parsed.data, profile);
});

/** Exclui (arquiva) um evento do portal. Grava evento. */
export const archiveClientEventTemplate = onCall(async (request) => {
  const profile = await getProfile(request);
  const parsed = ArchiveClientEventSchema.safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", "Evento inválido.");
  const customerCode = requireCustomerScope(profile, requestedCustomer(request.data));
  return archiveClientEvent(db, customerCode, parsed.data, profile);
});

const CancelShipmentNoticeSchema = z.object({
  request_id: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional(),
});

/** Portal: a cliente cancela um aviso de envio que a Dutelog não confirmou. */
export const cancelShipmentNotice = onCall(async (request) => {
  const profile = await getProfile(request);
  const input = CancelShipmentNoticeSchema.parse(request.data ?? {});
  return cancelShipmentNoticeTransaction(db, input, profile);
});

const UploadShipmentAttachmentSchema = z.object({
  file_name: z.string().trim().min(1).max(240),
  content_type: z.string().trim().min(1).max(120),
  // 15 MB em base64 dão 20.971.520 caracteres (ver SHIPMENT_ATTACHMENT_MAX_BYTES).
  data_base64: z.string().min(1).max(21_000_000),
  entity_id: z.string().trim().max(160).optional(),
});

/**
 * Envios para a Dutelog: o anexo (nota ou pedido) sobe pelo backend, que
 * grava no Storage com a credencial das Functions. A URL assinada com
 * cabeçalho de token, usada antes, é recusada pelo Storage de produção.
 */
export const uploadShipmentAttachment = onCall({ timeoutSeconds: 60 }, async (request) => {
  const profile = await getProfile(request);
  if (profile.role !== "cliente") {
    throw new HttpsError("permission-denied", "Anexo de aviso disponível no portal do cliente.");
  }
  const input = UploadShipmentAttachmentSchema.parse(request.data ?? {});
  const customerCode = requireCustomerScope(profile);
  const { contentType, buffer } = decodeShipmentAttachment(input);
  const bucketName = documentBucketName();
  const objectPath = [
    "operational-documents",
    safeDocId(customerCode),
    new Date().toISOString().slice(0, 7),
    `${Date.now()}-${safeFileName(input.file_name)}`,
  ].join("/");
  const token = randomUUID();
  try {
    await getStorage()
      .bucket(bucketName)
      .file(objectPath)
      .save(buffer, {
        resumable: false,
        contentType,
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      });
  } catch (error) {
    console.error("uploadShipmentAttachment: Storage recusou a gravação", { objectPath, error });
    throw storageFailure(error, "gravar");
  }

  await emitEvent(
    {
      type: "document.uploaded",
      title: "Anexo de aviso de envio",
      description: `${input.file_name} anexado por ${customerCode}.`,
      severity: "info",
      entity_type: "customer_request_draft",
      entity_id: input.entity_id || objectPath,
      customer_code: customerCode,
      payload: {
        file_name: input.file_name,
        content_type: contentType,
        size_bytes: buffer.length,
        document_type: "aviso_recebimento",
        storage_path: objectPath,
      },
      source: "functions_shipment_attachment",
    },
    {
      uid: profile.uid,
      email: profile.email,
      role: profile.role,
      customer_code: customerCode,
      name: profile.name,
    },
  );

  return {
    file_name: input.file_name,
    file_url: firebaseDownloadUrl(bucketName, objectPath, token),
    storage_path: objectPath,
    content_type: contentType,
    size_bytes: buffer.length,
  };
});

const ExportBillingReportSchema = z.object({
  from: z.string().trim().regex(/^\d{4}-\d{2}$/),
  to: z.string().trim().regex(/^\d{4}-\d{2}$/),
});

/**
 * Portal > Faturas > Gerar relatório > Baixar planilha. Lê só faturas
 * fechadas do próprio cliente (client_invoices) e os pedidos entregues
 * (client_order_tracking); a equipe de faturamento vê o mesmo da BTG.
 */
export const exportBillingReport = onCall({ timeoutSeconds: 60 }, async (request) => {
  const profile = await getProfile(request);
  let customerCode: string;
  if (profile.role === "cliente") customerCode = requireCustomerScope(profile);
  else {
    requireBillingRead(profile);
    customerCode = DEFAULT_CUSTOMER;
  }
  const input = ExportBillingReportSchema.parse(request.data ?? {});
  const [invoices, trackings] = await Promise.all([
    db.collection(collectionNames.clientInvoices).where("customer_code", "==", customerCode).get(),
    db.collection(collectionNames.clientOrderTracking).where("customer_code", "==", customerCode).get(),
  ]);
  const report = buildBillingReport({
    customerCode,
    from: input.from,
    to: input.to,
    invoices: invoices.docs.map((doc) => ({ ...doc.data(), id: doc.id })),
    trackings: trackings.docs.map((doc) => ({ ...doc.data(), id: doc.id })),
  });
  const buffer = await billingReportWorkbook(report, profile.name || profile.email || "Portal");
  return {
    file_name: `extrato-dutelog-${input.from}-a-${input.to}.xlsx`,
    content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    content_base64: buffer.toString("base64"),
    invoices: report.invoices.length,
    total: report.total,
  };
});

const CancelCustomerOrderSchema = z.object({
  request_id: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Portal > Pedidos: o cliente cancela um pedido que a Dutelog ainda não
 * confirmou. A reserva de estoque é desfeita na mesma transação, como na
 * recusa, e a equipe recebe o aviso na caixa.
 */
export const cancelCustomerOrder = onCall(async (request) => {
  const profile = await getProfile(request);
  if (profile.role !== "cliente") {
    throw new HttpsError("permission-denied", "Cancelamento disponível no portal do cliente.");
  }
  const input = CancelCustomerOrderSchema.parse(request.data ?? {});
  requireCustomerScope(profile);
  return decideCustomerRequestTransaction(
    db,
    {
      request_id: input.request_id,
      action: "cancel",
      reason: input.reason,
      expected_status: "open",
      idempotency_key: `cancel:${input.request_id}`,
    },
    profile,
  );
});

const AssignRequestNumbersSchema = z.object({ apply: z.boolean().default(false) });

/**
 * Manutenção (owner): dá número PED-/ENV- às solicitações criadas antes do
 * número sequencial. Sem apply, só mostra o que faria.
 */
export const assignRequestNumbers = onCall({ timeoutSeconds: 300 }, async (request) => {
  const profile = await getProfile(request);
  if (profile.role !== "owner") {
    throw new HttpsError("permission-denied", "Só o owner roda esta manutenção.");
  }
  const input = AssignRequestNumbersSchema.parse(request.data ?? {});
  const result = await assignMissingRequestNumbers(db, { dryRun: !input.apply });
  if (input.apply && result.assigned_count) {
    await emitEvent(
      {
        type: "system.request_numbers_assigned",
        title: "Números de pedido e envio atribuídos",
        description: `${result.assigned_count} solicitação(ões) antiga(s) receberam número PED-/ENV-.`,
        severity: "info",
        entity_type: "sistema",
        entity_id: "request_numbers",
        payload: { assigned: result.assigned.slice(0, 200) },
        source: "functions_maintenance",
      },
      { uid: profile.uid, email: profile.email, role: profile.role, customer_code: profile.customer_code, name: profile.name },
    );
  }
  return result;
});

const ReadShipmentInvoiceSchema = z.object({
  storage_path: z.string().trim().min(1).max(900),
  content_type: z.string().trim().min(1).max(120),
  // Receber > Chegada avulsa diz de qual cliente é a chegada; no portal vem do perfil.
  customer_code: z.string().trim().max(120).optional(),
});

const InvoiceExtractionSchema = z.object({
  supplier: z.string().optional(),
  invoice_number: z.string().optional(),
  issue_date: z.string().optional(),
  volumes: z.string().optional(),
  carrier: z.string().optional(),
  items: z
    .array(
      z.object({
        supplier_code: z.string().optional(),
        description: z.string().optional(),
        quantity: z.number().optional(),
        unit: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * Envios para a Dutelog > "Ler itens da nota" (portal) e Receber > "Chegada
 * avulsa" (operação): o Agent Dute lê a NF anexada e devolve fornecedor,
 * número e sugestões de itens. Não grava aviso, recebimento nem estoque; a
 * pessoa confere na tela. A cliente só lê a própria pasta; a operação informa
 * o cliente dono da chegada.
 */
export const readShipmentInvoice = onCall({ timeoutSeconds: 120 }, async (request) => {
  const profile = await getProfile(request);
  assertInvoiceReader(profile);
  const input = ReadShipmentInvoiceSchema.parse(request.data ?? {});
  const customerCode = requireCustomerScope(profile, input.customer_code);
  return readInvoiceForCustomer(profile, customerCode, input.storage_path, input.content_type, invoiceReadingSource(profile.role));
});

/** Lê a NF do Storage do cliente e casa os itens com o estoque (Envios, chat do Agent Dute e Receber). */
async function readInvoiceForCustomer(
  profile: Profile,
  customerCode: string,
  rawStoragePath: string,
  rawContentType: string,
  source: InvoiceReadingSource,
) {
  const storagePath = assertOwnInvoicePath(rawStoragePath, customerCode);
  const contentType = rawContentType.toLowerCase();
  if (!READABLE_INVOICE_TYPES.includes(contentType)) {
    throw new HttpsError("invalid-argument", "Use a nota em PDF ou foto.");
  }
  let buffer: Buffer;
  try {
    [buffer] = await getStorage().bucket(documentBucketName()).file(storagePath).download({ validation: false });
  } catch (error) {
    console.error("readShipmentInvoice: Storage recusou a leitura", { storagePath, error });
    throw storageFailure(error, "ler");
  }
  if (buffer.length > VISUAL_OCR_MAX_BYTES) {
    throw new HttpsError("invalid-argument", "Arquivo grande demais para leitura automática. Use até 14 MB.");
  }
  const started = Date.now();
  const errors: string[] = [];
  for (const modelName of [AGENT_DUTE_MODEL, AGENT_DUTE_FALLBACK_MODEL]) {
    try {
      const response = await ai.generate({
        model: vertexAI.model(modelName),
        messages: [
          {
            role: "user",
            content: [
              { text: INVOICE_PROMPT },
              { media: { url: `data:${contentType};base64,${buffer.toString("base64")}`, contentType } },
            ],
          },
        ],
        output: { schema: InvoiceExtractionSchema },
        config: { temperature: 0, maxOutputTokens: 8192 },
      });
      const reading = sanitizeInvoiceReading(response.output);
      const inventory = await db
        .collection(collectionNames.clientInventory)
        .where("customer_code", "==", customerCode)
        .get();
      const catalog = inventory.docs.map((doc) => {
        const data = doc.data();
        return {
          client_item_code: String(data.client_item_code ?? ""),
          sku_code: String(data.sku_code ?? ""),
          product_name: String(data.product_name ?? ""),
        };
      });
      const items = matchInvoiceItems(reading.items, catalog);
      await db.collection(collectionNames.agentUsage).add({
        customer_code: customerCode,
        user_id: profile.uid,
        role: profile.role,
        source,
        model: modelName,
        input_tokens: response.usage?.inputTokens ?? null,
        output_tokens: response.usage?.outputTokens ?? null,
        latency_ms: Date.now() - started,
        items_read: items.length,
        error: errors.length ? errors.join(" | ") : null,
        created_at_iso: new Date().toISOString(),
        created_at: FieldValue.serverTimestamp(),
      });
      return { ...reading, items };
    } catch (error) {
      errors.push(`${modelName}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500));
    }
  }
  throw new HttpsError("unavailable", "Não consegui ler a nota agora. Tente de novo ou preencha os itens.");
}

/** Configuração > Sistema: verificação real do servidor e do banco. */
export const getSystemHealth = onCall(async (request) => {
  const profile = await getProfile(request);
  return readSystemHealth(db, profile);
});

export const saveBillingManual = onCall(async (request) => {
  const profile = await getProfile(request);
  requireBillingWrite(profile);
  const input = SaveBillingManualSchema.parse(request.data ?? {});
  const customerCode = DEFAULT_CUSTOMER;
  const periodRef = db
    .collection(collectionNames.periods)
    .doc(input.competencia);
  const manualRef = db
    .collection(collectionNames.billingManual)
    .doc(input.competencia);
  const operationId = `billing_manual_${stableHash({
    actor: profile.uid,
    nonce: input.idempotency_key ?? stableHash(input),
  }).slice(0, 40)}`;
  const operationRef = db
    .collection(collectionNames.operations)
    .doc(operationId);
  const inputHash = stableHash({
    competencia: input.competencia,
    items: input.items,
  });
  const eventRef = db
    .collection(collectionNames.events)
    .doc(`evt_${operationId}`);

  try {
    return await db.runTransaction(async (transaction) => {
      const operationSnapshot = await transaction.get(operationRef);
      if (operationSnapshot.exists) {
        const operation = operationSnapshot.data() ?? {};
        if (operation.input_hash !== inputHash) {
          throw new HttpsError(
            "already-exists",
            "A chave de idempotência já foi usada com outro conteúdo.",
          );
        }
        return (
          operation.result ?? {
            competencia: input.competencia,
            status: "aberto",
            ok: true,
          }
        );
      }

      const periodSnapshot = await transaction.get(periodRef);
      if (!periodSnapshot.exists) {
        transaction.create(periodRef, {
          ...createOpenBillingPeriod(input.competencia, {
            now: new Date(),
            customerCode,
          }),
          created_by: profile.uid,
          created_at: FieldValue.serverTimestamp(),
          // updated_at é obrigatório: o sinal de realtime ordena por ele e
          // documentos sem o campo ficam invisíveis para a assinatura.
          updated_at: FieldValue.serverTimestamp(),
        });
      } else {
        const period = periodSnapshot.data() ?? {};
        if (period.status !== "aberto") {
          throw new BillingDomainError(
            "PERIOD_NOT_OPEN",
            `A competência ${input.competencia} não está aberta para edição.`,
          );
        }
      }
      transaction.set(
        manualRef,
        {
          competencia: input.competencia,
          customer_code: customerCode,
          items: input.items,
          updated_by: profile.uid,
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      transaction.create(
        eventRef,
        billingAuditEvent(eventRef.id, {
          type: "billing.manual_quantities_saved",
          title: "Quantidades manuais do faturamento salvas",
          description: `Competência ${input.competencia}`,
          competencia: input.competencia,
          customerCode,
          actor: profile,
          payload: { items_count: input.items.length },
        }),
      );
      const result = {
        competencia: input.competencia,
        status: "aberto",
        ok: true,
      };
      transaction.create(operationRef, {
        id: operationId,
        kind: "billing.manual_quantities",
        target_id: input.competencia,
        input_hash: inputHash,
        status: "completed",
        actor: {
          uid: profile.uid,
          email: profile.email ?? null,
          role: profile.role,
        },
        result,
        created_at: FieldValue.serverTimestamp(),
        completed_at: FieldValue.serverTimestamp(),
      });
      return result;
    });
  } catch (error) {
    return billingError(error);
  }
});

export const emitBillingInvoice = onCall(async (request) => {
  const profile = await getProfile(request);
  requireBillingWrite(profile);
  const input = BillingCompetenciaSchema.parse(request.data ?? {});
  const customerCode = DEFAULT_CUSTOMER;
  const periodRef = db
    .collection(collectionNames.periods)
    .doc(input.competencia);
  const clientRef = db
    .collection(collectionNames.clientInvoices)
    .doc(input.competencia);
  const eventRef = db
    .collection(collectionNames.events)
    .doc(`evt_billing_emit_${safeDocId(input.competencia)}`);
  const issuedAt = new Date();

  try {
    const result = await db.runTransaction(async (transaction) => {
      const eventSnapshot = await transaction.get(eventRef);
      // Read every billing source in the same transaction as the period. This
      // prevents a movement, manual quantity, or price change from racing the
      // immutable invoice snapshot.
      const calculation = await loadBillingCalculation(
        input.competencia,
        customerCode,
        transaction,
      );
      const snapshot = await emitInvoiceInTransaction(
        transaction,
        periodRef,
        calculation,
        {
          issuedAt,
          emittedBy: profile.email ?? profile.uid,
          customerCode,
          firestoreTimestamp: FieldValue.serverTimestamp(),
        },
      );
      transaction.set(
        clientRef,
        {
          id: input.competencia,
          customer_code: customerCode,
          competencia: input.competencia,
          status: "emitido",
          payment_status: "issued",
          total_cents: snapshot.total_cents,
          total: snapshot.total,
          currency: snapshot.currency,
          emitido_em: snapshot.issued_at,
          lines: snapshot.linhas,
          groups: snapshot.grupos,
          published_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      if (!eventSnapshot.exists) {
        transaction.create(
          eventRef,
          billingAuditEvent(eventRef.id, {
            type: "billing.invoice_emitted",
            title: "Fatura emitida",
            description: `Competência ${input.competencia} emitida.`,
            competencia: input.competencia,
            customerCode,
            actor: profile,
            payload: {
              total_cents: snapshot.total_cents,
              total: snapshot.total,
            },
          }),
        );
      }
      return snapshot;
    });
    return {
      ok: true,
      invoice: result,
      email: {
        sent: false,
        error:
          "Envio automático será ativado após configurar o remetente transacional.",
      },
    };
  } catch (error) {
    return billingError(error);
  }
});

export const payBillingInvoice = onCall(async (request) => {
  const profile = await getProfile(request);
  requireBillingWrite(profile);
  const input = BillingCompetenciaSchema.parse(request.data ?? {});
  const customerCode = DEFAULT_CUSTOMER;
  const periodRef = db
    .collection(collectionNames.periods)
    .doc(input.competencia);
  const clientRef = db
    .collection(collectionNames.clientInvoices)
    .doc(input.competencia);
  const eventRef = db
    .collection(collectionNames.events)
    .doc(`evt_billing_paid_${safeDocId(input.competencia)}`);
  const paidAt = new Date();

  try {
    return await db.runTransaction(async (transaction) => {
      const [periodSnapshot, eventSnapshot] = await Promise.all([
        transaction.get(periodRef),
        transaction.get(eventRef),
      ]);
      if (!periodSnapshot.exists) {
        throw new BillingDomainError(
          "PERIOD_NOT_FOUND",
          `Competência ${input.competencia} não encontrada.`,
        );
      }
      const period = periodSnapshot.data() ?? {};
      assertBillingStatusTransition(
        String(period.status) as "aberto" | "emitido" | "pago",
        "pago",
        { competencia: input.competencia, now: paidAt },
      );
      transaction.update(periodRef, {
        status: "pago",
        pago_em: paidAt.toISOString(),
        paid_by: profile.uid,
        updated_at: FieldValue.serverTimestamp(),
      });
      transaction.set(
        clientRef,
        {
          customer_code: customerCode,
          status: "pago",
          payment_status: "paid",
          pago_em: paidAt.toISOString(),
          published_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      if (!eventSnapshot.exists) {
        transaction.create(
          eventRef,
          billingAuditEvent(eventRef.id, {
            type: "billing.invoice_paid",
            title: "Fatura marcada como paga",
            description: `Competência ${input.competencia}`,
            competencia: input.competencia,
            customerCode,
            actor: profile,
          }),
        );
      }
      return {
        competencia: input.competencia,
        status: "pago",
        pago_em: paidAt.toISOString(),
      };
    });
  } catch (error) {
    return billingError(error);
  }
});

function requireNoteReviewer(profile: Profile) {
  if (!NOTE_REVIEWER_ROLES.includes(profile.role)) {
    throw new HttpsError("permission-denied", "Só a coordenação vê e aprova as anotações do Agent Dute.");
  }
}

/** Anotações do Agent Dute (pendentes e valendo) do cliente, para a coordenação revisar. */
export const listAgentNotes = onCall(async (request) => {
  const profile = await getProfile(request);
  requireNoteReviewer(profile);
  return { notes: await listNotes(db, requireCustomerScope(profile)) };
});

/** Aprova (com edição), recusa ou arquiva uma anotação; grava evento. */
export const decideAgentNote = onCall(async (request) => {
  const profile = await getProfile(request);
  requireNoteReviewer(profile);
  const parsed = DecideNoteSchema.safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", "Anotação inválida.");
  const input = parsed.data;
  return decideNote(db, input, profile);
});

/** Playbooks do Agent Dute do cliente (pendentes e valendo), para a coordenação. */
export const listAgentPlaybooks = onCall(async (request) => {
  const profile = await getProfile(request);
  return { playbooks: await listPlaybooks(db, requireCustomerScope(profile), profile) };
});

/** Cria ou edita um playbook; escrito pela coordenação vale direto. Grava evento. */
export const saveAgentPlaybook = onCall(async (request) => {
  const profile = await getProfile(request);
  const parsed = PlaybookInputSchema.safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", "Preencha nome, quando usar e pelo menos um passo.");
  return savePlaybook(db, requireCustomerScope(profile), parsed.data, profile);
});

/** Aprova, recusa ou arquiva um playbook. Grava evento. */
export const decideAgentPlaybook = onCall(async (request) => {
  const profile = await getProfile(request);
  const parsed = DecidePlaybookSchema.safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", "Playbook inválido.");
  return decidePlaybook(db, requireCustomerScope(profile), parsed.data, profile);
});

/** Carrega os playbooks iniciais como pendentes (não duplica). */
export const seedAgentPlaybooks = onCall(async (request) => {
  const profile = await getProfile(request);
  return seedInitialPlaybooks(db, requireCustomerScope(profile), profile);
});

// Uma resposta pode encadear várias consultas; 60 s (padrão) era curto.
// Com httpsCallable(...).stream() a tela recebe a resposta aos pedaços;
// chamada comum continua recebendo só o resultado final.
export const chatWithAgentDute = onCall({ timeoutSeconds: 180 }, async (request, response) => {
  const profile = await getProfile(request);
  const input = AgentChatSchema.parse(request.data ?? {});
  const customer_code = requireCustomerScope(profile);
  if (input.attachments?.length) {
    if (profile.role !== "cliente") {
      throw new HttpsError("permission-denied", "Anexar nota no chat é do portal do cliente.");
    }
    for (const attachment of input.attachments) assertOwnInvoicePath(attachment.storage_path, customer_code);
  }
  const { stream, output } = chatWithAgentDuteFlow.stream({
    ...input,
    attachments: input.attachments ?? undefined,
    customer_code,
    actor_uid: profile.uid,
    actor_email: profile.email,
    actor_name: profile.name,
    actor_role: profile.role,
  });
  try {
    for await (const chunk of stream) {
      if (request.acceptsStreaming) await response?.sendChunk(chunk);
    }
  } catch {
    // O erro real (ex.: permissão) chega por `output`, logo abaixo.
  }
  return await output;
});

// ------------------------------------------------- rotinas do Agent Dute

function routineOwner(profile: Profile) {
  return { uid: profile.uid, customerCode: requireCustomerScope(profile), role: profile.role, name: profile.name };
}

export const listAgentRoutines = onCall(async (request) => {
  const profile = await getProfile(request);
  return { routines: await listRoutines(db, routineOwner(profile)) };
});

/** Cria ou altera uma rotina. Pelo cartão do chat, a mesma mensagem não cria duas. */
export const saveAgentRoutine = onCall(async (request) => {
  const profile = await getProfile(request);
  const parsed = RoutineInputSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Rotina inválida.");
  }
  const owner = routineOwner(profile);
  const { agent_message_id, ...input } = parsed.data;
  if (agent_message_id && !input.id) {
    return sendAgentDraft(db, { messageId: agent_message_id, uid: owner.uid, customerCode: owner.customerCode, tipo: "rotina" }, async (key) => {
      const saved = await saveRoutine(db, owner, input, new Date(), key);
      return { id: saved.id, request_number: saved.name };
    });
  }
  return saveRoutine(db, owner, input);
});

export const deleteAgentRoutine = onCall(async (request) => {
  const profile = await getProfile(request);
  const input = z.object({ id: z.string().trim().min(1).max(120) }).parse(request.data ?? {});
  return deleteRoutine(db, routineOwner(profile), input.id);
});

/** "Rodar agora" no editor: roda já, sem mexer na agenda. No máximo uma vez a cada 5 minutos. */
export const runAgentRoutineNow = onCall({ timeoutSeconds: 180 }, async (request) => {
  const profile = await getProfile(request);
  const owner = routineOwner(profile);
  const input = z.object({ id: z.string().trim().min(1).max(120) }).parse(request.data ?? {});
  const ref = db.collection(ROUTINES_COLLECTION).doc(input.id);
  const data = (await ref.get()).data();
  if (!data) throw new HttpsError("not-found", "Rotina não encontrada.");
  if (data.user_id !== owner.uid || data.customer_code !== owner.customerCode) {
    throw new HttpsError("permission-denied", "Esta rotina é de outra pessoa.");
  }
  if (typeof data.last_run_at === "string" && Date.now() - Date.parse(data.last_run_at) < 5 * 60_000) {
    throw new HttpsError("failed-precondition", "Esta rotina rodou há pouco. Espere uns minutos.");
  }
  const routine: DueRoutine = {
    id: input.id,
    user_id: owner.uid,
    customer_code: owner.customerCode,
    name: String(data.name ?? ""),
    prompt: String(data.prompt ?? ""),
    conversation_id: String(data.conversation_id ?? `routine_${input.id}`),
    retry_pending: true,
  };
  await runRoutine(routine);
  return { conversation_id: routine.conversation_id };
});

/** De 15 em 15 minutos: roda as rotinas vencidas (até 20 por vez, uma de cada vez). */
export const runAgentRoutines = onSchedule(
  { schedule: "every 15 minutes", timeZone: "America/Sao_Paulo", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    const started = Date.now();
    const due = await claimDueRoutines(db, new Date());
    for (const routine of due) {
      // Deixa folga para não estourar o tempo da tarefa; o que sobrar vai na próxima.
      if (Date.now() - started > 420_000) {
        await recordRoutineRun(db, { ...routine, retry_pending: false }, { status: "failed", error: "Sem tempo nesta rodada." });
        continue;
      }
      try {
        await runRoutine(routine);
      } catch (error) {
        console.error("runAgentRoutines: rotina falhou", { id: routine.id, error });
      }
    }
  },
);

/**
 * Roda uma rotina com o perfil ATUAL de quem criou (se perdeu o acesso, a
 * rotina pausa) e grava pergunta e resposta na conversa da rotina.
 */
async function runRoutine(routine: DueRoutine) {
  let profile: Profile;
  try {
    profile = await loadProfile(routine.user_id);
  } catch {
    await recordRoutineRun(db, routine, { status: "no_access" });
    return;
  }
  const customerCode = profile.role === "cliente" ? profile.customer_code : routine.customer_code;
  if (!customerCode || customerCode !== routine.customer_code) {
    await recordRoutineRun(db, routine, { status: "no_access" });
    return;
  }
  try {
    const now = new Date();
    const askedAt = now.toISOString();
    const scope: AgentScope = { customerCode, audience: knowledgeAudienceForRole(profile.role) };
    const question = routinePrompt(routine, now);
    const answer = await generateAgentDuteReply({
      message: question,
      history: [],
      scope,
      role: profile.role,
      asker: { userId: profile.uid, conversationId: routine.conversation_id, name: profile.name, email: profile.email },
      userName: profile.name,
    });
    const answeredAt = new Date(Math.max(Date.now(), now.getTime() + 1)).toISOString();
    const conversationRef = db.collection(collectionNames.agentConversations).doc(routine.conversation_id);
    const userMessageId = newDocId("msg_user");
    const assistantMessageId = newDocId("msg_agent");
    const batch = db.batch();
    batch.set(
      conversationRef,
      compactPayload({
        id: routine.conversation_id,
        customer_code: customerCode,
        user_id: profile.uid,
        user_email: profile.email,
        user_name: profile.name,
        title: `Rotina: ${routine.name}`.slice(0, 90),
        routine_id: routine.id,
        status: "active",
        last_message_at: answeredAt,
        updated_at: FieldValue.serverTimestamp(),
      }),
      { merge: true },
    );
    batch.set(db.collection(collectionNames.agentMessages).doc(userMessageId), {
      id: userMessageId,
      conversation_id: routine.conversation_id,
      customer_code: customerCode,
      user_id: profile.uid,
      role: "user",
      content: routine.prompt,
      created_at_iso: askedAt,
      created_at: FieldValue.serverTimestamp(),
      source: "rotina",
    });
    batch.set(
      db.collection(collectionNames.agentMessages).doc(assistantMessageId),
      compactPayload({
        id: assistantMessageId,
        conversation_id: routine.conversation_id,
        customer_code: customerCode,
        user_id: profile.uid,
        role: "assistant",
        content: answer.text,
        tools_used: answer.tools_used,
        draft: answer.draft,
        created_at_iso: answeredAt,
        created_at: FieldValue.serverTimestamp(),
        source: answer.source,
      }),
    );
    batch.set(
      db.collection(collectionNames.agentUsage).doc(assistantMessageId),
      compactPayload({
        id: assistantMessageId,
        conversation_id: routine.conversation_id,
        customer_code: customerCode,
        user_id: profile.uid,
        role: profile.role,
        model: answer.model,
        source: "rotina",
        tools_used: answer.tools_used,
        tool_calls: answer.tools_used.length,
        input_tokens: answer.input_tokens,
        output_tokens: answer.output_tokens,
        latency_ms: answer.latency_ms,
        error: answer.error,
        created_at_iso: answeredAt,
        created_at: FieldValue.serverTimestamp(),
      }),
    );
    await batch.commit();
    await recordRoutineRun(db, routine, { status: "ok" });
  } catch (error) {
    await recordRoutineRun(db, routine, { status: "failed", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// ------------------------------------------------ painel do sistema (owner)

/** Configuração > Sistema: custo estimado e uso do Agent Dute, rotinas e falhas. Só owner. */
export const getSystemDashboard = onCall({ timeoutSeconds: 60 }, async (request) => {
  const profile = await getProfile(request);
  return readSystemDashboard(db, profile);
});

/** Preço por milhão de tokens (estimativa de custo) e orçamento mensal do Agent Dute. Só owner. */
export const saveAgentCostSettings = onCall(async (request) => {
  const profile = await getProfile(request);
  const parsed = CostSettingsSchema.safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", "Preços e orçamento precisam ser números positivos.");
  return saveCostSettings(db, profile, parsed.data);
});

/** Chamada autenticada às APIs do Google Cloud com a conta de serviço da function. */
const gcpFetch: GcpFetch = async (url, init) => {
  const { access_token } = await applicationDefault().getAccessToken();
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: init?.body,
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: { message: text.slice(0, 300) } };
  }
  return { status: response.status, json };
};

/** Configuração > Sistema, infraestrutura: erros de 24 h, functions publicadas e custo real. Só owner. */
export const getSystemInfra = onCall({ timeoutSeconds: 90 }, async (request) => {
  const profile = await getProfile(request);
  // As functions do próprio código: o que deveria estar publicado.
  const code = codeFunctions((await import("./index.js")) as Record<string, unknown>);
  return readSystemInfra(db, profile, { gcp: gcpFetch, code, project: "dute-btg", region: "southamerica-east1" });
});

/** Tabela da exportação do faturamento no BigQuery (custo real no painel). Só owner. */
export const saveSystemInfraSettings = onCall(async (request) => {
  const profile = await getProfile(request);
  const parsed = InfraSettingsSchema.safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Tabela inválida.");
  return saveInfraSettings(db, profile, parsed.data);
});
