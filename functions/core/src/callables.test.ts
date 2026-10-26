import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * As functions do núcleo (codebase `core`). A callable fica no formato que a
 * conferência do invoker lê (tools/check_functions_invoker.ps1), numa linha
 * só, e começa pela liberação e pelo perfil (requireCoreCaller). A rotina
 * confere a liberação antes de tudo.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const rawIndex = read("../src/index.ts");
const index = rawIndex.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const invokerScript = read("../../../tools/check_functions_invoker.ps1");

function invokerPattern(): RegExp {
  const literals = [...invokerScript.matchAll(/'(\^export const [^']*onCall[^']*)'/g)].map((match) => match[1]);
  assert.equal(literals.length, 1, `esperava um padrão de callable em tools/check_functions_invoker.ps1, achei ${literals.length}`);
  return new RegExp(literals[0]);
}

const ENTRADA = /^export const \w+ = onCall(?:<[^>]*>)?\(async \(request\) => \{\s*const caller = await requireCoreCaller\(db, request, PROJECT_ID\);/;
// A do Agent Dute (parte 5.5e) entra pela liberação própria do agente e pode responder em partes.
const ENTRADA_DO_AGENTE = /^export const \w+Dute\w* = onCall(?:<[^>]*>)?\((?:\{[^}]*\}, )?async \(request(?:, response)?\) => \{\s*const caller = await requireDuteCaller\(db, request, PROJECT_ID\);/;

describe("functions do núcleo", () => {
  it("toda linha com onCall está no formato que a conferência do invoker lê, inclusive comentário", () => {
    const pattern = invokerPattern();
    const used = rawIndex.split(/\r?\n/).filter((line) => /\bonCall\s*[<(]/.test(line));
    assert.deepEqual(used.map((line) => line.match(pattern)?.[1]), [
      "suggestDuration",
      "answerSuggestion",
      "findSimilarQuotes",
      "answerStockAlert",
      "chatWithDute",
      "suggestDuteNote",
      "listDuteNotes",
      "decideDuteNote",
      "listDutePlaybooks",
      "saveDutePlaybook",
      "decideDutePlaybook",
      "seedDutePlaybooks",
      "listDuteRoutines",
      "saveDuteRoutine",
      "deleteDuteRoutine",
      "runDuteRoutineNow",
    ]);
  });

  it("as callables começam pela liberação e pelo perfil, e nada é reexportado; as do Agent Dute, pela liberação do agente", () => {
    assert.doesNotMatch(index, /^export\s*\{/m);
    const blocks = index.split(/^(?=export const )/m).filter((block) => /^export const \w+ = onCall/.test(block));
    assert.equal(blocks.length, 16);
    for (const block of blocks) {
      const doAgente = /^export const \w*Dute\w* = /.test(block);
      assert.match(block, doAgente ? ENTRADA_DO_AGENTE : ENTRADA);
      assert.doesNotMatch(block, doAgente ? /requireCoreCaller/ : /requireDuteCaller/);
    }
  });

  it("a rotina da memória (partes 5.1a, 5.3a, 5.4a e 5.4d), a cada 15 minutos, uma instância, confere a liberação antes de tudo e roda as medidas, as lembranças e o estoque (o relógio e a proposta do alerta)", () => {
    const agendadas = [...index.matchAll(/^export const (\w+) = onSchedule\(/gm)].map((match) => match[1]);
    assert.deepEqual(agendadas, ["runMeasures", "runDuteRoutines", "runAgentRetention"]);
    assert.match(
      index,
      /export const runMeasures = onSchedule\(\{[^}]*schedule: "every 15 minutes"[^}]*timeZone: "America\/Sao_Paulo"[^}]*maxInstances: 1[^}]*\}, async \(\) => \{\s*if \(!memoriaLiberada\(PROJECT_ID\)\) return;\s*const \[medidas, lembrancas, estoque\] = await Promise\.allSettled\(\[runMeasuresFor\(db\), runCasesFor\(db\), runStockFor\(db\)\]\);/,
    );
  });

  it("a retenção do Agent Dute (LGPD, decisão 8), todo dia, uma instância, confere a liberação da retenção antes de tudo", () => {
    assert.match(
      index,
      /export const runAgentRetention = onSchedule\(\{[^}]*schedule: "every day 03:40"[^}]*timeZone: "America\/Sao_Paulo"[^}]*maxInstances: 1[^}]*\}, async \(\) => \{\s*if \(!retencaoLiberada\(PROJECT_ID\)\) return;\s*console\.info\("runAgentRetention", await runAgentRetentionFor\(db\)\);/,
    );
  });

  it("a rotina do Agent Dute (parte 5.5g), a cada 15 minutos, uma instância, confere a liberação do agente antes de tudo", () => {
    assert.match(
      index,
      /export const runDuteRoutines = onSchedule\(\{[^}]*schedule: "every 15 minutes"[^}]*timeZone: "America\/Sao_Paulo"[^}]*maxInstances: 1[^}]*\}, async \(\) => \{\s*if \(!agenteLiberado\(PROJECT_ID\)\) return;\s*console\.info\("runDuteRoutines", await rodarRotinasVencidas\(db, /,
    );
  });
});
