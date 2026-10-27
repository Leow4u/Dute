import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Dynamic URL lets the first run report a missing API as a test failure.
const api = () => import(new URL("./contract.js", import.meta.url).href);

describe("API pública v1", () => {
  it("CORS separa os endereços de produção, homologação e desenvolvimento", async () => {
    const { apiBrowserOrigins } = await import(new URL("./browser.js", import.meta.url).href);
    assert.deepEqual(apiBrowserOrigins("dute-prod"), ["https://app.dutelog.com.br"]);
    assert.ok(apiBrowserOrigins("dute-homolog").includes("https://dute-app-368642218894.southamerica-east1.run.app"));
    assert.ok(!apiBrowserOrigins("dute-prod").some((origin: string) => /localhost|127\.0\.0\.1|homolog/.test(origin)));
    assert.deepEqual(apiBrowserOrigins("unknown"), []);
    assert.ok(apiBrowserOrigins("demo-dute-operacao").includes("http://localhost:5173"));
  });
  it("reconhece somente ações publicadas, sem permitir cancelar/reabrir por campos extras", async () => {
    const { writeRoute } = await api();
    assert.deepEqual(
      writeRoute("POST", "/api/v1/operacao/os/10045-01/agendamento"),
      { kind: "schedule", numero: "10045-01", scope: "operacao:os:gravar" },
    );
    assert.equal(writeRoute("DELETE", "/api/v1/operacao/os/10045-01"), null);
    assert.equal(
      writeRoute("POST", "/api/v1/operacao/os/../agendamento"),
      null,
    );
  });
  it("vincula aprovação ao agente, método, caminho, corpo e chave; ordem dos campos não muda o hash", async () => {
    const { approvalDigest, operationKey } = await api();
    const base = ["a", "POST", "/api/v1/operacao/os", "key"];
    const original = approvalDigest(...base, {
      demanda: "10045",
      itens: [1, 2],
    });
    assert.equal(
      original,
      approvalDigest(...base, { itens: [1, 2], demanda: "10045" }),
    );
    assert.notEqual(
      original,
      approvalDigest("b", ...base.slice(1), {
        demanda: "10045",
        itens: [1, 2],
      }),
    );
    assert.notEqual(
      original,
      approvalDigest(...base, { demanda: "10046", itens: [1, 2] }),
    );
    assert.notEqual(operationKey("a", "key"), operationKey("b", "key"));
  });
  it("projeções de leitura descartam campos extras sensíveis, inclusive dentro de objetos", async () => {
    const { projectDocument } = await api();
    const os = projectDocument("os", "10045-01", {
      customer_code: "A",
      status: "agendada",
      preco: 999,
      locais: { origem: { contato: { telefone: "secret" } } },
      itens: [{ id: "x", item: "Mesa", preco: 99 }],
      equipe: [{ nome: "Ana", cpf: "secret", usuario_uid: "secret" }],
    });
    assert.doesNotMatch(JSON.stringify(os), /secret|preco|contato|usuario_uid/);
    const pessoa = projectDocument("colaboradores", "col_a", {
      nome: "Ana",
      cpf: "secret",
      telefone: "secret",
      cnh: "secret",
    });
    assert.deepEqual(pessoa, { id: "col_a", nome: "Ana" });
  });
  it("erros internos não expõem detalhes e erros de domínio têm status HTTP estável", async () => {
    const { publicError } = await api();
    assert.deepEqual(publicError(new Error("token=secret")), {
      status: 500,
      code: "internal",
      message: "Erro interno. Informe o request_id ao suporte.",
    });
    const { HttpsError } = await import("firebase-functions/https");
    assert.equal(
      publicError(new HttpsError("permission-denied", "Negado")).status,
      403,
    );
    assert.equal(
      publicError(new HttpsError("already-exists", "Conflito")).status,
      409,
    );
  });
  it("OpenAPI declara autenticação, idempotência e aprovação nas escritas", async () => {
    const { openapi } = await import(
      new URL("./openapi.js", import.meta.url).href
    );
    assert.equal(openapi.openapi, "3.0.3");
    const ids = Object.values(openapi.paths).flatMap((path: any) =>
      Object.values(path).map((op: any) => op.operationId),
    );
    assert.ok(
      ids.every((id: unknown) => typeof id === "string" && id.length > 0),
    );
    assert.equal(new Set(ids).size, ids.length);
    const checkRequired = (value: any): void => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value.required))
        assert.ok(value.required.length, "OpenAPI 3.0 proíbe required vazio");
      for (const child of Object.values(value)) checkRequired(child);
    };
    checkRequired(openapi);
    assert.ok(openapi.paths["/api/v1/operacao/os/{numero}/agendamento"].post);
    for (const [path, item] of Object.entries(openapi.paths) as [
      string,
      any,
    ][]) {
      if (path.includes("/operacao/") && item.post) {
        assert.ok(
          item.post.parameters.some(
            (p: any) => p.name === "Idempotency-Key" && p.required,
          ),
        );
        assert.ok(
          item.post.parameters.some(
            (p: any) => p.name === "X-Approval-Id" && p.required,
          ),
        );
      }
    }
  });
});
