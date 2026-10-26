import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Timestamp } from "firebase-admin/firestore";

import {
  ACCOUNT_RETENTION_PROJECTS,
  MONTHS_AFTER_REMOVAL,
  accountRetentionEnabled,
  accountState,
  removalLimit,
  removedAt,
} from "./account-retention.js";

/** A regra da conta removida há mais de 12 meses (LGPD, decisão 8, parte 8c), sem o banco. */

const NOW = new Date("2026-10-26T06:50:00.000Z");
const LIMIT = removalLimit(NOW);

describe("a conta removida há mais de 12 meses", () => {
  it("o prazo é de 12 meses, no mesmo dia do ano anterior", () => {
    assert.equal(MONTHS_AFTER_REMOVAL, 12);
    assert.equal(LIMIT.toISOString(), "2025-10-26T06:50:00.000Z");
  });

  it("a data da remoção vem do texto do setUserAccess ou de uma data do Firestore", () => {
    assert.equal(removedAt("2025-09-20T15:00:00.000Z"), Date.parse("2025-09-20T15:00:00.000Z"));
    assert.equal(removedAt(Timestamp.fromDate(new Date("2025-09-20T15:00:00.000Z"))), Date.parse("2025-09-20T15:00:00.000Z"));
    for (const value of [undefined, null, "", "ontem", 123]) assert.equal(removedAt(value), null, String(value));
  });

  it("sai só o perfil com o acesso removido antes do prazo e ainda não anonimizado", () => {
    const removed = { access_disabled: true, access_changed_at: "2025-09-20T15:00:00.000Z", nome: "Rafael" };
    assert.equal(accountState(removed, LIMIT), "anonymize");
    assert.equal(accountState({ ...removed, access_changed_at: "2025-12-01T12:00:00.000Z" }, LIMIT), "keep");
    assert.equal(accountState({ ...removed, anonymized_at: "2026-10-01T06:50:00.000Z" }, LIMIT), "keep");
    // O acesso que voltou fica, mesmo com a data antiga.
    assert.equal(accountState({ ...removed, access_disabled: false }, LIMIT), "keep");
    assert.equal(accountState({ nome: "Ana", role: "wms" }, LIMIT), "keep");
    assert.equal(accountState({ access_disabled: true, nome: "Sem data" }, LIMIT), "no_date");
  });

  it("só a homologação anonimiza, até o OK do Leonardo para a produção", () => {
    assert.deepEqual(ACCOUNT_RETENTION_PROJECTS, ["dute-homolog"]);
    assert.equal(accountRetentionEnabled("dute-homolog"), true);
    for (const project of ["dute-prod", "dute-btg", "demo-dute-operations", "", undefined]) assert.equal(accountRetentionEnabled(project), false, String(project));
  });

  it("a rotina roda todo dia, uma instância de cada vez, e confere a liberação antes de tudo", () => {
    const index = readFileSync(fileURLToPath(new URL("../../src/index.ts", import.meta.url)), "utf8");
    assert.match(
      index,
      /export const runAccountRetention = onSchedule\(\s*\{[^}]*schedule: "every day 03:50"[^}]*timeZone: "America\/Sao_Paulo"[^}]*maxInstances: 1[^}]*\},\s*async \(\) => \{\s*if \(!accountRetentionEnabled\(PROJECT_ID\)\) return;\s*console\.info\("runAccountRetention", await anonymizeRemovedAccounts\(db, getAuth\(\)\)\);/,
    );
  });
});
