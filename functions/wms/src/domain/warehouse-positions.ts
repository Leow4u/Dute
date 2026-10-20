import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

/**
 * Cadastro de posições do armazém: cada prateleira com as medidas úteis,
 * a sequência de caminhada e a zona (cliente dona). É a base do mapa do
 * armazém e do endereçamento dirigido (docs/mapa-do-armazem-enderecamento-dirigido.md).
 *
 * Vocabulário da planilha de medidas de 16/10/2026, mantido na tela:
 * comprimento = a frente da prateleira, que vai sendo ocupada caixa a caixa;
 * largura = a profundidade; altura = a altura livre.
 *
 * A coleção é estrutura, não movimento: a zeragem total preserva
 * (tools/full_reset_btg.py, SETUP_COLLECTIONS). Só administração e
 * coordenação alteram; todo papel de armazém lê (firestore.rules).
 */

export const WAREHOUSE_POSITIONS_COLLECTION = "warehouse_positions";
export const POSITION_EDITOR_ROLES = ["owner", "admin", "interno"] as const;
export const POSITION_STATUSES = ["active", "blocked", "review"] as const;

export type PositionStatus = (typeof POSITION_STATUSES)[number];

export type WarehousePositionActor = {
  uid: string;
  role: string;
  email?: string;
  name?: string;
  customer_code?: string;
};

export type WarehousePositionInput = {
  aisle: string;
  shelf: number;
  length_m: number;
  depth_m: number;
  height_m: number;
  max_weight_kg?: number | null;
  sequence?: number | null;
  customer_code?: string | null;
  status?: PositionStatus;
  notes?: string | null;
};

export type NormalizedPosition = {
  code: string;
  aisle: string;
  shelf: number;
  length_m: number;
  depth_m: number;
  height_m: number;
  max_weight_kg?: number | null;
  sequence?: number;
  customer_code?: string | null;
  status?: PositionStatus;
  notes?: string | null;
};

const AISLE_PATTERN = /^[A-Z0-9]{1,4}$/;
const MAX_METERS = 50;

/** Número opcional vindo do formulário: vazio e null viram null, nunca 0. */
function optionalNumber(min: number, max: number, label: string) {
  return z.preprocess(
    (value) => (value === null || value === undefined || value === "" ? null : Number(value)),
    z
      .number({ invalid_type_error: `${label} inválido.` })
      .min(min, `${label} inválido.`)
      .max(max, `${label} inválido.`)
      .nullable(),
  );
}

/** `problem` já concorda com o campo: "Comprimento inválido", "Largura inválida". */
const meters = (problem: string) =>
  z.coerce
    .number({ invalid_type_error: `${problem}: informe em metros.` })
    .positive(`${problem}: informe em metros.`)
    .max(MAX_METERS, `${problem}: informe em metros.`);

export const WarehousePositionInputSchema = z.object({
  aisle: z.string().trim().min(1, "Informe a rua.").max(4, "Rua inválida."),
  shelf: z.coerce.number().int("Prateleira inválida.").min(1, "Prateleira inválida.").max(999, "Prateleira inválida."),
  length_m: meters("Comprimento inválido"),
  depth_m: meters("Largura inválida"),
  height_m: meters("Altura inválida"),
  max_weight_kg: optionalNumber(0, 100_000, "Peso máximo").optional(),
  sequence: optionalNumber(1, 100_000, "Sequência").optional(),
  customer_code: z.string().trim().max(120).nullable().optional(),
  status: z.enum(POSITION_STATUSES).optional(),
  notes: z.string().trim().max(500, "Observação longa demais.").nullable().optional(),
});

export const SaveWarehousePositionsSchema = z.object({
  positions: z.array(WarehousePositionInputSchema).min(1, "Informe ao menos uma posição.").max(200),
});

export const CreateWarehouseAisleSchema = z.object({
  aisle: z.string().trim().min(1, "Informe a rua.").max(4, "Rua inválida."),
  shelves: z.coerce.number().int().min(1, "Informe quantas prateleiras.").max(200, "No máximo 200 prateleiras por vez."),
  length_m: meters("Comprimento inválido"),
  depth_m: meters("Largura inválida"),
  height_m: meters("Altura inválida"),
  max_weight_kg: optionalNumber(0, 100_000, "Peso máximo").optional(),
  customer_code: z.string().trim().max(120).nullable().optional(),
});

export const DeleteWarehousePositionSchema = z.object({
  code: z.string().trim().min(1, "Informe a posição.").max(12),
});

export type SaveWarehousePositionsInput = z.infer<typeof SaveWarehousePositionsSchema>;
export type CreateWarehouseAisleInput = z.infer<typeof CreateWarehouseAisleSchema>;

/** Código legível da prateleira, o que vai na etiqueta dela: rua e prateleira (A-01). */
export function positionCode(aisle: string, shelf: number) {
  return `${aisle.trim().toUpperCase()}-${String(shelf).padStart(2, "0")}`;
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function requireMeters(value: unknown, problem: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_METERS) {
    throw new HttpsError("invalid-argument", `${problem}: informe em metros.`);
  }
  return round(parsed, 3);
}

/** Valida e padroniza uma posição; os campos ausentes continuam ausentes (não zeram o que já existe). */
export function normalizePosition(raw: WarehousePositionInput): NormalizedPosition {
  const aisle = String(raw.aisle ?? "").trim().toUpperCase();
  if (!AISLE_PATTERN.test(aisle)) {
    throw new HttpsError("invalid-argument", "Rua inválida: use letras ou números, até 4 caracteres.");
  }
  const shelf = Number(raw.shelf);
  if (!Number.isInteger(shelf) || shelf < 1 || shelf > 999) {
    throw new HttpsError("invalid-argument", "Prateleira inválida: use um número de 1 a 999.");
  }
  const normalized: NormalizedPosition = {
    code: positionCode(aisle, shelf),
    aisle,
    shelf,
    length_m: requireMeters(raw.length_m, "Comprimento inválido"),
    depth_m: requireMeters(raw.depth_m, "Largura inválida"),
    height_m: requireMeters(raw.height_m, "Altura inválida"),
  };
  if (raw.max_weight_kg !== undefined) {
    if (raw.max_weight_kg === null) {
      normalized.max_weight_kg = null;
    } else {
      const weight = Number(raw.max_weight_kg);
      if (!Number.isFinite(weight) || weight < 0) {
        throw new HttpsError("invalid-argument", "Peso máximo inválido: informe em quilos.");
      }
      normalized.max_weight_kg = round(weight, 2);
    }
  }
  if (raw.sequence !== undefined && raw.sequence !== null) {
    const sequence = Number(raw.sequence);
    if (!Number.isInteger(sequence) || sequence < 1) {
      throw new HttpsError("invalid-argument", "Sequência inválida: use um número inteiro a partir de 1.");
    }
    normalized.sequence = sequence;
  }
  if (raw.customer_code !== undefined) {
    const customer = raw.customer_code === null ? "" : String(raw.customer_code).trim();
    normalized.customer_code = customer || null;
  }
  if (raw.status !== undefined) {
    if (!POSITION_STATUSES.includes(raw.status)) {
      throw new HttpsError("invalid-argument", "Situação inválida.");
    }
    normalized.status = raw.status;
  }
  if (raw.notes !== undefined) {
    const notes = raw.notes === null ? "" : String(raw.notes).trim();
    if (notes.length > 500) {
      throw new HttpsError("invalid-argument", "Observação longa demais (máximo 500 caracteres).");
    }
    normalized.notes = notes || null;
  }
  return normalized;
}

function requireEditor(actor: WarehousePositionActor) {
  if (!(POSITION_EDITOR_ROLES as readonly string[]).includes(actor.role)) {
    throw new HttpsError(
      "permission-denied",
      "Posições do armazém: somente administração ou coordenação operacional alteram.",
    );
  }
}

function actorFields(actor: WarehousePositionActor) {
  return {
    uid: actor.uid,
    role: actor.role,
    email: actor.email ?? null,
    name: actor.name ?? null,
    customer_code: actor.customer_code ?? null,
  };
}

type Shelf = [shelf: number, depth: number, length: number, height: number, notes?: string];

function aisleLayout(aisle: string, shelves: Shelf[]): WarehousePositionInput[] {
  return shelves.map(([shelf, depth, length, height, notes]) => ({
    aisle,
    shelf,
    length_m: length,
    depth_m: depth,
    height_m: height,
    ...(notes ? { notes } : {}),
  }));
}

/**
 * Mapa inicial do galpão, levantado por Leonardo em 16/10/2026 (planilha de
 * medidas, ruas A, B e C). Rua A não tem prateleira 8 na planilha; a altura
 * da A-16 estava sendo digitada e ficou registrada como "9", lida aqui como
 * 0,90 m e marcada para conferência. Peso máximo e zona não foram levantados:
 * entram pela tela de Posições. Se o galpão mudar, edite as posições ou
 * cadastre uma rua nova; este mapa é só a carga inicial.
 */
export const DEFAULT_WAREHOUSE_LAYOUT: WarehousePositionInput[] = [
  ...aisleLayout("A", [
    [1, 0.75, 1.8, 0.65],
    [2, 0.75, 1.8, 0.65],
    [3, 0.75, 1.8, 0.65],
    [4, 0.75, 1.8, 1.9],
    [5, 0.75, 1.8, 0.9],
    [6, 0.75, 1.8, 0.9],
    [7, 0.75, 1.8, 0.9],
    [9, 0.75, 1.8, 0.9],
    [10, 0.75, 1.8, 0.9],
    [11, 0.75, 1.8, 0.9],
    [12, 0.75, 1.8, 0.9],
    [13, 0.75, 1.8, 1.5],
    [14, 0.75, 1.8, 1.5],
    [15, 0.75, 1.8, 1.5],
    [16, 0.75, 1.8, 0.9, "Altura a confirmar: na planilha de 16/10/2026 a célula estava incompleta (\"9\")."],
  ]),
  ...aisleLayout("B", [
    [1, 0.75, 1.78, 0.65],
    [2, 0.75, 1.78, 0.65],
    [3, 0.75, 1.78, 0.65],
    [4, 0.75, 1.78, 0.65],
    [5, 0.75, 1.78, 0.88],
    [6, 0.75, 1.78, 0.88],
    [7, 0.75, 1.78, 0.88],
    [8, 0.75, 1.78, 0.88],
    [9, 0.75, 1.78, 0.88],
    [10, 0.75, 1.78, 0.88],
    [11, 0.75, 1.78, 0.88],
    [12, 0.75, 1.78, 0.88],
    [13, 0.75, 1.78, 1.5],
    [14, 0.75, 1.78, 1.5],
    [15, 0.75, 1.78, 1.5],
    [16, 0.75, 1.78, 1.5],
  ]),
  ...aisleLayout("C", [
    [1, 0.88, 1.78, 0.9],
    [2, 0.75, 1.78, 0.65],
    [3, 0.75, 1.78, 0.65],
    [4, 0.75, 1.78, 0.88],
    [5, 0.75, 1.78, 0.88],
    [6, 0.75, 1.78, 0.88],
    [7, 0.75, 1.78, 0.9],
    [8, 0.75, 1.78, 0.9],
    [9, 0.75, 1.78, 0.9],
    [10, 0.75, 1.78, 1.5],
    [11, 0.75, 1.78, 1.5],
    [12, 0.75, 1.78, 1.5],
  ]),
];

export type SavePositionsResult = {
  ok: true;
  created: string[];
  updated: string[];
};

type UpsertOptions = {
  source: "manual" | "default_layout" | "new_aisle";
  /** Nenhum dos códigos pode existir ainda (rua nova, mapa inicial). */
  requireNew?: boolean;
  eventTitle?: string;
};

function describeCodes(codes: string[]) {
  if (codes.length <= 3) return codes.join(", ");
  return `${codes[0]} a ${codes[codes.length - 1]} (${codes.length})`;
}

/** Lê tudo primeiro (o Firestore exige), depois grava posições e um evento. */
async function upsertInTransaction(
  transaction: Transaction,
  db: Firestore,
  positions: NormalizedPosition[],
  actor: WarehousePositionActor,
  options: UpsertOptions,
): Promise<SavePositionsResult> {
  const collection = db.collection(WAREHOUSE_POSITIONS_COLLECTION);
  const refs = positions.map((position) => collection.doc(position.code));
  const [snapshots, lastSequence] = await Promise.all([
    transaction.getAll(...refs),
    transaction.get(collection.orderBy("sequence", "desc").limit(1)),
  ]);
  let nextSequence = Number(lastSequence.docs[0]?.data()?.sequence ?? 0) + 1;

  const created: string[] = [];
  const updated: string[] = [];
  const now = new Date().toISOString();
  positions.forEach((position, index) => {
    const ref = refs[index]!;
    const snapshot = snapshots[index]!;
    if (snapshot.exists && options.requireNew) {
      throw new HttpsError(
        "failed-precondition",
        `A posição ${position.code} já existe. Edite a existente ou use outra rua.`,
      );
    }
    const { code, ...fields } = position;
    if (snapshot.exists) {
      transaction.update(ref, {
        ...fields,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: actor.uid,
      });
      updated.push(code);
    } else {
      transaction.create(ref, {
        id: code,
        code,
        ...fields,
        max_weight_kg: fields.max_weight_kg ?? null,
        sequence: fields.sequence ?? nextSequence++,
        customer_code: fields.customer_code ?? null,
        status: fields.status ?? "active",
        notes: fields.notes ?? null,
        source: options.source,
        created_at: FieldValue.serverTimestamp(),
        created_by: actor.uid,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: actor.uid,
      });
      created.push(code);
    }
  });

  const codes = positions.map((position) => position.code);
  const eventRef = db.collection("events").doc();
  transaction.create(eventRef, {
    id: eventRef.id,
    type: options.source === "manual" && created.length === 0 ? "warehouse.positions_updated" : "warehouse.positions_created",
    title:
      options.eventTitle ??
      (created.length && !updated.length
        ? `Posições cadastradas: ${describeCodes(codes)}`
        : `Posições alteradas: ${describeCodes(codes)}`),
    description: `${created.length} nova(s), ${updated.length} alterada(s) · origem ${options.source}`,
    severity: "info",
    entity_type: "warehouse_position",
    entity_id: codes.length === 1 ? codes[0] : null,
    customer_code: null,
    payload: { codes, created, updated, source: options.source },
    occurred_at: now,
    source: "functions_warehouse_positions",
    actor: actorFields(actor),
    created_at: FieldValue.serverTimestamp(),
  });

  return { ok: true, created, updated };
}

function normalizeAll(inputs: WarehousePositionInput[]) {
  const positions = inputs.map(normalizePosition);
  const seen = new Set<string>();
  for (const position of positions) {
    if (seen.has(position.code)) {
      throw new HttpsError("invalid-argument", `A posição ${position.code} aparece mais de uma vez.`);
    }
    seen.add(position.code);
  }
  return positions;
}

/** Cria ou altera posições. Campo ausente numa posição existente fica como está. */
export async function upsertWarehousePositions(
  db: Firestore,
  input: { positions: WarehousePositionInput[] },
  actor: WarehousePositionActor,
): Promise<SavePositionsResult> {
  requireEditor(actor);
  if (!Array.isArray(input.positions) || !input.positions.length) {
    throw new HttpsError("invalid-argument", "Informe ao menos uma posição.");
  }
  if (input.positions.length > 200) {
    throw new HttpsError("invalid-argument", "No máximo 200 posições por vez.");
  }
  const positions = normalizeAll(input.positions);
  return db.runTransaction((transaction) =>
    upsertInTransaction(transaction, db, positions, actor, { source: "manual" }),
  );
}

/** Carga inicial: só com o cadastro vazio. Depois disso o mapa muda pela tela. */
export async function seedDefaultWarehouseLayout(
  db: Firestore,
  actor: WarehousePositionActor,
): Promise<SavePositionsResult> {
  requireEditor(actor);
  const positions = normalizeAll(DEFAULT_WAREHOUSE_LAYOUT);
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(
      db.collection(WAREHOUSE_POSITIONS_COLLECTION).limit(1),
    );
    if (!existing.empty) {
      throw new HttpsError(
        "failed-precondition",
        "O cadastro de posições já tem prateleiras. O mapa inicial só entra com o cadastro vazio; edite as posições ou cadastre uma rua nova.",
      );
    }
    return upsertInTransaction(transaction, db, positions, actor, {
      source: "default_layout",
      requireNew: true,
      eventTitle: `Mapa inicial do galpão carregado: ${positions.length} prateleiras (ruas A, B e C)`,
    });
  });
}

/** Rua nova com N prateleiras de medidas iguais; a sequência continua depois da última. */
export async function createWarehouseAisle(
  db: Firestore,
  input: CreateWarehouseAisleInput,
  actor: WarehousePositionActor,
): Promise<SavePositionsResult> {
  requireEditor(actor);
  const shelves = Number(input.shelves);
  if (!Number.isInteger(shelves) || shelves < 1 || shelves > 200) {
    throw new HttpsError("invalid-argument", "Informe de 1 a 200 prateleiras.");
  }
  const positions = normalizeAll(
    Array.from({ length: shelves }, (_, index) => ({
      aisle: input.aisle,
      shelf: index + 1,
      length_m: input.length_m,
      depth_m: input.depth_m,
      height_m: input.height_m,
      max_weight_kg: input.max_weight_kg ?? null,
      customer_code: input.customer_code ?? null,
    })),
  );
  return db.runTransaction((transaction) =>
    upsertInTransaction(transaction, db, positions, actor, {
      source: "new_aisle",
      requireNew: true,
      eventTitle: `Rua ${positions[0]!.aisle} cadastrada: ${positions.length} prateleiras`,
    }),
  );
}

export type DeletePositionResult = { ok: true; code: string };

/** Remove uma posição sem saldo. Com caixa guardada, mova antes. */
export async function deleteWarehousePosition(
  db: Firestore,
  input: { code: string },
  actor: WarehousePositionActor,
): Promise<DeletePositionResult> {
  requireEditor(actor);
  const code = String(input.code ?? "").trim().toUpperCase();
  if (!code || code.includes("/")) {
    throw new HttpsError("invalid-argument", "Posição inválida.");
  }
  const ref = db.collection(WAREHOUSE_POSITIONS_COLLECTION).doc(code);
  return db.runTransaction(async (transaction) => {
    const [snapshot, balances] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.collection("stock_balances").where("location_id", "==", code)),
    ]);
    if (!snapshot.exists) throw new HttpsError("not-found", `Posição ${code} não encontrada.`);
    const occupied = balances.docs.some((row) => {
      const data = row.data();
      return Number(data.qty_on_hand ?? 0) > 0 || Number(data.qty_reserved ?? 0) > 0;
    });
    if (occupied) {
      throw new HttpsError(
        "failed-precondition",
        `A posição ${code} ainda tem saldo em estoque. Mova as caixas antes de removê-la.`,
      );
    }
    const data = snapshot.data() ?? {};
    transaction.delete(ref);
    const eventRef = db.collection("events").doc();
    transaction.create(eventRef, {
      id: eventRef.id,
      type: "warehouse.position_deleted",
      title: `Posição removida: ${code}`,
      description: `Rua ${String(data.aisle ?? "")}, prateleira ${String(data.shelf ?? "")}`,
      severity: "warning",
      entity_type: "warehouse_position",
      entity_id: code,
      customer_code: data.customer_code ?? null,
      payload: { code, position: data },
      occurred_at: new Date().toISOString(),
      source: "functions_warehouse_positions",
      actor: actorFields(actor),
      created_at: FieldValue.serverTimestamp(),
    });
    return { ok: true, code };
  });
}

/** Posições em ordem de caminhada (uso em testes e rotinas). */
export async function listWarehousePositions(db: Firestore) {
  const snapshot = await db
    .collection(WAREHOUSE_POSITIONS_COLLECTION)
    .orderBy("sequence", "asc")
    .get();
  return snapshot.docs.map((document) => document.data());
}
