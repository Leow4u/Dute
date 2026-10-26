import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * As callables da Operação precisam estar no formato que a conferência do
 * invoker lê (tools/check_functions_invoker.ps1): `export const nome = onCall`
 * com o parêntese na mesma linha. Toda callable começa pela liberação e pelo
 * perfil (requireOperacaoCaller).
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const rawIndex = read("../src/index.ts");
const index = rawIndex.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const invokerScript = read("../../../tools/check_functions_invoker.ps1");

const ON_CALL_USE = /\bonCall\s*[<(]/;

function invokerPattern(): RegExp {
  const literals = [...invokerScript.matchAll(/'(\^export const [^']*onCall[^']*)'/g)].map((match) => match[1]);
  assert.equal(literals.length, 1, `esperava um padrão de callable em tools/check_functions_invoker.ps1, achei ${literals.length}`);
  return new RegExp(literals[0]);
}

const ENTRADA = /^export const \w+ = onCall(?:<[^>]*>)?\(async \(request\) => \{\s*const caller = await requireOperacaoCaller\(db, request, PROJECT_ID(?:, \{ (?:campo|painel|portal|sino|wms): true \})?\);/;
/** As callables da execução também atendem o campo escalado (parte 3.8a); o cadastro e o planejamento, não. */
const DO_CAMPO = ["registerStep", "registerOccurrence", "registerItem", "attachPhoto", "registerPresence", "completeServiceOrder", "sendSurveyToCommercial"];
/** O painel (parte 3.12) só chama a leitura da TV. */
const DA_TV = ["getRoomBoard"];
/** O cliente (parte 4.4a) só chama a solicitação pelo portal. */
const DO_PORTAL = ["requestService"];
/** O sino do portal (parte 4.6c): o cliente, com qualquer módulo, só marca os avisos como vistos. */
const DO_SINO = ["markNotificationsRead"];
/** A operação do armazém (parte 4.5b) só abre a entrega do pedido de saída. */
const DO_ARMAZEM = ["openStorageDemand"];

describe("callables da Operação", () => {
  it("toda linha com onCall está no formato que a conferência do invoker lê, inclusive comentário", () => {
    const pattern = invokerPattern();
    const used = rawIndex.split(/\r?\n/).map((line, i) => [i + 1, line] as const).filter(([, line]) => ON_CALL_USE.test(line));
    assert.deepEqual(used.map(([, line]) => line.match(pattern)?.[1]), ["saveCollaborator", "saveVehicle", "saveServiceOrder", "openDirectDemand", "openStorageDemand", "registerStep", "registerOccurrence", "registerItem", "attachPhoto", "registerPresence", "completeServiceOrder", "resolveFieldCompletion", "reviewServiceOrder", "reopenServiceOrder", "sendSurveyToCommercial", "requestService", "declineServiceRequest", "markNotificationsRead", "getRoomBoard"]);
  });

  it("as callables começam pela liberação e pelo perfil, e nada é reexportado", () => {
    assert.doesNotMatch(index, /^export\s*\{/m);
    const blocks = index.split(/^(?=export const )/m).filter((block) => /^export const \w+ = onCall/.test(block));
    assert.equal(blocks.length, 19);
    for (const block of blocks) {
      assert.match(block, ENTRADA);
      const nome = /^export const (\w+)/.exec(block)?.[1] ?? "";
      assert.equal(block.includes("{ campo: true }"), DO_CAMPO.includes(nome), nome);
      assert.equal(block.includes("{ painel: true }"), DA_TV.includes(nome), nome);
      assert.equal(block.includes("{ portal: true }"), DO_PORTAL.includes(nome), nome);
      assert.equal(block.includes("{ sino: true }"), DO_SINO.includes(nome), nome);
      assert.equal(block.includes("{ wms: true }"), DO_ARMAZEM.includes(nome), nome);
    }
  });

  it("as functions agendadas são a rotina diária (parte 3.13a), a da retenção (LGPD, decisão 8) e a dos avisos (parte 4.6a), e conferem a liberação antes de tudo", () => {
    const agendadas = [...index.matchAll(/^export const (\w+) = onSchedule\(/gm)].map((match) => match[1]);
    assert.deepEqual(agendadas, ["runDailyAlerts", "runOperacaoRetention", "runNotifications"]);
    // A retenção apaga o que passou do prazo: confere a liberação própria dela, não a da Operação.
    const liberacao: Record<string, string> = { runDailyAlerts: "operacaoLiberada", runOperacaoRetention: "retencaoLiberada", runNotifications: "operacaoLiberada" };
    for (const nome of agendadas) {
      assert.match(index, new RegExp(`export const ${nome} = onSchedule\\(\\{[^}]*timeZone: "America\\/Sao_Paulo"[^}]*\\}, async \\(\\) => \\{\\s*if \\(!${liberacao[nome]}\\(PROJECT_ID\\)\\) return;`), nome);
    }
  });

  it("a rotina da retenção roda uma instância de cada vez, com os avisos e as fotos da OS, uma parte sem segurar a outra", () => {
    assert.match(index, /export const runOperacaoRetention = onSchedule\(\{[^}]*maxInstances: 1[^}]*\}/);
    assert.match(index, /await Promise\.allSettled\(\[runRetentionFor\(db\), runPhotoRetentionFor\(db, apagarDoBucket\)\]\)/);
  });

  it("a rotina dos avisos roda uma instância de cada vez, declara a chave do Resend só onde ela existe e, fora da produção, só envia para a Dutelog", () => {
    assert.match(index, /export const runNotifications = onSchedule\(\{[^}]*maxInstances: 1[^}]*secrets: segredosDoResend\(PROJECT_ID\)[^}]*\}/);
    assert.match(index, /const pelaApi = chave \? enviarPeloResend\(chave\) : enviarSoAuditoria;/);
    assert.match(index, /const enviar = emailParaQualquerContato\(PROJECT_ID\) \? pelaApi : soParaADutelog\(pelaApi\);/);
  });
});
