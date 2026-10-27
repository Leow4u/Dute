import { randomUUID } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";
import { assertLiberado } from "../domain/liberacao.js";
import { loadProfile } from "../domain/profile.js";
import {
  API_APPROVALS_COLLECTION,
  API_AUDIT_COLLECTION,
  API_INTEGRATIONS_COLLECTION,
  authenticate,
  bearer,
  createIntegration,
  delegatedProfile,
  humanCaller,
  listIntegrations,
  loadIntegration,
  type Integration,
  type VerifyHuman,
} from "./auth.js";
import {
  PREFIX,
  approvalDigest,
  denied,
  invalid,
  publicError,
  writeRoute,
} from "./contract.js";
import { executeWrite, prepareWrite, readResource } from "./resources.js";
import { openapi } from "./openapi.js";

export type ApiRequest = {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  query: Record<string, unknown>;
  body?: unknown;
};
export type ApiResponse = { status: number; body: Record<string, unknown> };
const Approve = z
  .object({
    method: z.literal("POST"),
    path: z.string().max(150),
    body: z.record(z.unknown()),
    idempotency_key: z.string().min(1).max(200),
  })
  .strict();

export function createApiHandler(
  db: Firestore,
  project: string,
  verify: VerifyHuman,
) {
  return async (request: ApiRequest): Promise<ApiResponse> => {
    const request_id = randomUUID();
    let integration: Integration | undefined;
    let approved_by: string | undefined;
    let auditId: string | undefined;
    let status = 500;
    try {
      assertLiberado(project);
      if (request.path === `${PREFIX}/openapi.json` && request.method === "GET")
        return { status: 200, body: openapi };
      if (!request.path.startsWith(`${PREFIX}/`))
        throw new HttpsError("not-found", "Endpoint não encontrado.");
      if (Buffer.byteLength(JSON.stringify(request.body ?? null)) > 65536)
        invalid("O corpo passa de 64 KiB.");
      const token = bearer(request.headers);
      if (
        request.path === `${PREFIX}/integrations` ||
        request.path.startsWith(`${PREFIX}/integrations/`)
      ) {
        const human = await humanCaller(db, token, verify);
        approved_by = human.uid;
        auditId = request_id;
        await db.collection(API_AUDIT_COLLECTION).doc(auditId).create({
          request_id,
          actor_uid: human.uid,
          action: "integration_management",
          status: 0,
          created_at: FieldValue.serverTimestamp(),
        });
        if (request.path === `${PREFIX}/integrations` && request.method === "GET") {
          const result = await listIntegrations(db, request.query);
          status = 200;
          return { status, body: { ...result, request_id } };
        }
        if (
          request.path === `${PREFIX}/integrations` &&
          request.method === "POST"
        ) {
          const data = await createIntegration(db, human, request.body);
          status = 201;
          return { status, body: { data, request_id } };
        }
        const match = new RegExp(
          `^${PREFIX}/integrations/([a-f0-9]{32})(/approvals)?$`,
        ).exec(request.path);
        if (!match)
          throw new HttpsError("not-found", "Endpoint não encontrado.");
        if (request.method === "DELETE" && !match[2]) {
          const ref = db.collection(API_INTEGRATIONS_COLLECTION).doc(match[1]);
          if (!(await ref.get()).exists)
            throw new HttpsError("not-found", "Integração não encontrada.");
          await ref.update({
            revoked: true,
            revoked_by: human.uid,
            revoked_at: FieldValue.serverTimestamp(),
          });
          status = 200;
          return {
            status,
            body: { data: { id: match[1], revoked: true }, request_id },
          };
        }
        if (request.method === "POST" && match[2]) {
          const parsed = Approve.safeParse(request.body);
          if (!parsed.success)
            invalid(
              "Informe method, path, body e idempotency_key da ação aprovada.",
            );
          const approval = parsed.data;
          const route = writeRoute(approval.method, approval.path);
          if (!route) invalid("Ação não disponível nesta versão da API.");
          const target = await loadIntegration(db, match[1]);
          await delegatedProfile(db, target);
          const prepared = await prepareWrite(
            db,
            target,
            route,
            approval.body,
            approval.idempotency_key,
          );
          const id = randomUUID();
          const expires_at_ms = Date.now() + 15 * 60000;
          await db
            .collection(API_APPROVALS_COLLECTION)
            .doc(id)
            .create({
              integration_id: target.id,
              digest: approvalDigest(
                target.id,
                approval.method,
                approval.path,
                approval.idempotency_key,
                approval.body,
              ),
              customer_code: prepared.customer,
              approved_by: human.uid,
              expires_at_ms,
              created_at: FieldValue.serverTimestamp(),
            });
          status = 201;
          return {
            status,
            body: {
              data: { id, expires_at: new Date(expires_at_ms).toISOString() },
              request_id,
            },
          };
        }
        throw new HttpsError("not-found", "Endpoint não encontrado.");
      }
      integration = await authenticate(db, token);
      auditId = request_id;
      await db.collection(API_AUDIT_COLLECTION).doc(auditId).create({
        request_id,
        integration_id: integration.id,
        method: request.method,
        action: "operations_request",
        status: 0,
        created_at: FieldValue.serverTimestamp(),
      });
      if (request.method === "GET") {
        const result = await readResource(
          db,
          integration,
          request.path,
          request.query,
        );
        await db
          .collection(API_AUDIT_COLLECTION)
          .doc(auditId)
          .update({ route: request.path });
        status = 200;
        return { status, body: { ...result, request_id } };
      }
      const route = writeRoute(request.method, request.path);
      if (!route) throw new HttpsError("not-found", "Endpoint não encontrado.");
      const key = request.headers["idempotency-key"] ?? "";
      const prepared = await prepareWrite(
        db,
        integration,
        route,
        request.body,
        key,
      );
      const approvalId = request.headers["x-approval-id"] ?? "";
      if (!/^[a-f0-9-]{36}$/.test(approvalId))
        denied("Esta ação exige aprovação humana em X-Approval-Id.");
      const approval = (
        await db.collection(API_APPROVALS_COLLECTION).doc(approvalId).get()
      ).data();
      if (
        !approval ||
        approval.integration_id !== integration.id ||
        approval.expires_at_ms <= Date.now() ||
        approval.customer_code !== prepared.customer ||
        approval.digest !==
          approvalDigest(
            integration.id,
            request.method,
            request.path,
            key,
            request.body,
          )
      )
        denied("Aprovação ausente, expirada ou diferente desta ação.");
      const approver = await loadProfile(db, approval.approved_by);
      if (approver.role !== "owner" && approver.role !== "admin")
        denied("O aprovador perdeu a permissão.");
      approved_by = approver.uid;
      // Write approval provenance before the effect; a failed audit prevents it.
      await db.collection(API_AUDIT_COLLECTION).doc(auditId).update({
        approved_by,
        approval_id: approvalId,
        customer_code: prepared.customer,
        route: request.path,
      });
      const actor = await delegatedProfile(db, integration);
      const data = await executeWrite(
        db,
        actor,
        route,
        prepared.input,
        prepared.customer,
      );
      status = 201;
      return { status, body: { data, request_id } };
    } catch (error) {
      const failure = publicError(error);
      status = failure.status;
      return {
        status,
        body: {
          error: { code: failure.code, message: failure.message },
          request_id,
        },
      };
    } finally {
      // Never store tokens, request body, customer contacts or raw errors.
      if (auditId)
        await db
          .collection(API_AUDIT_COLLECTION)
          .doc(auditId)
          .update({
            status,
            ...(approved_by ? { approved_by } : {}),
            completed_at: FieldValue.serverTimestamp(),
          });
    }
  };
}
