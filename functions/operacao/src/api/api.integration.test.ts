import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { readFileSync } from "node:fs";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const PROJECT = "demo-dute-operacao";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let handle: (request: any) => Promise<any>;
const root = "/api/v1";
const human = { authorization: "Bearer human-token" };
const request = (
  method: string,
  path: string,
  headers: any = {},
  body?: any,
  query: any = {},
) => handle({ method, path: root + path, headers, body, query });

before(async () => {
  app = initializeApp({ projectId: PROJECT }, "api-integration");
  db = getFirestore(app);
  const { createApiHandler } = await import(
    new URL("./handler.js", import.meta.url).href
  );
  handle = createApiHandler(db, "dute-homolog", async (token: string) => {
    if (token !== "human-token") throw new Error("Invalid token");
    return { uid: "owner" };
  });
});
beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(host, "Use somente o emulador");
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  await db.doc("users/owner").set({ role: "owner", nome: "Responsável" });
  await db.doc("customers/customer-a").set({ code: "A", name: "Cliente A" });
});
after(async () => {
  await db.terminate();
  await deleteApp(app);
});

async function integration(
  scopes = [
    "operacao:ler",
    "operacao:demanda:criar",
    "operacao:os:gravar",
    "operacao:recursos:ler",
  ],
) {
  const response = await request("POST", "/integrations", human, {
    name: "Grok Bot",
    scopes,
    customers: ["A"],
    expires_in_days: 30,
  });
  assert.equal(response.status, 201, JSON.stringify(response));
  return response.body.data;
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("API de integração no emulador", () => {
  it("cria chave global scoped, preserva padrão legado e recusa política ou clientes inválidos", async () => {
    const input = { name: "Integração RH", scopes: ["rh:ler", "rh:registros:gravar"], customers: [], write_policy: "scoped" };
    const response = await request("POST", "/integrations", human, input);
    assert.equal(response.status, 201, JSON.stringify(response));
    const stored = (await db.doc(`api_integrations/${response.body.data.id}`).get()).data()!;
    assert.equal(stored.write_policy, "scoped");
    assert.deepEqual(stored.customers, []);
    const legacy = await integration();
    assert.equal((await db.doc(`api_integrations/${legacy.id}`).get()).data()!.write_policy, "approval_required");
    for (const invalid of [
      { ...input, write_policy: "admin" },
      { ...input, scopes: ["rh:ler", "operacao:ler"] },
      { ...input, customers: ["*"] },
    ]) assert.equal((await request("POST", "/integrations", human, invalid)).status, 400);
  });
  it("chave scoped cria demanda sem aprovação por ação e preserva idempotência", async () => {
    const created = await request("POST", "/integrations", human, {
      name: "Integração Operação", scopes: ["operacao:demanda:criar"], customers: ["A"], write_policy: "scoped",
    });
    assert.equal(created.status, 201);
    const key = created.body.data;
    const body = {
      customer_code: "A", titulo: "Mudança", canal: "telefone",
      recebida_em: new Date().toISOString(), executar_ate: new Date(Date.now() + 86400000).toISOString(),
      itens: [{ item: "Mesa", unidade: "UN", quantidade: "1" }],
    };
    const headers = { ...bearer(key.token), "idempotency-key": "scoped-demand-1" };
    const result = await request("POST", "/operacao/demandas", headers, body);
    assert.equal(result.status, 201, JSON.stringify(result));
    assert.equal((await request("POST", "/operacao/demandas", headers, body)).body.data.replayed, true);
    assert.equal((await db.collection("demands").get()).size, 1);
    assert.equal((await db.collection("api_approvals").get()).size, 0);
    assert.equal((await request("POST", "/operacao/demandas", { ...headers, "idempotency-key": "outside-1" }, { ...body, customer_code: "B" })).status, 403);
  });
  it("lista metadados paginados sem segredo, incluindo revogadas e expiradas", async () => {
    const first = await integration();
    const second = await integration();
    await request("DELETE", `/integrations/${first.id}`, human);
    await db.doc(`api_integrations/${second.id}`).update({ expires_at_ms: Date.now() - 1000 });
    const page = await request("GET", "/integrations", human, undefined, { limit: "1" });
    assert.equal(page.status, 200, JSON.stringify(page));
    assert.equal(page.body.data.length, 1);
    assert.ok(page.body.next_cursor);
    const next = await request("GET", "/integrations", human, undefined, { limit: "1", cursor: page.body.next_cursor });
    assert.equal(next.status, 200);
    assert.equal(next.body.data.length, 1);
    assert.equal(next.body.next_cursor, null);
    assert.notEqual(page.body.data[0].id, next.body.data[0].id);
    const rows = [...page.body.data, ...next.body.data];
    assert.deepEqual(rows.map((row: any) => row.id).sort(), [first.id, second.id].sort());
    assert.equal(rows.find((row: any) => row.id === first.id).revoked, true);
    assert.ok(Date.parse(rows.find((row: any) => row.id === second.id).expires_at) < Date.now());
    assert.doesNotMatch(JSON.stringify(rows), /token|hash|rate_count|rate_window/);
    assert.equal(rows[0].name, "Grok Bot");
    assert.deepEqual(rows[0].customers, ["A"]);
    assert.equal((await request("GET", "/integrations", human, undefined, { limit: "101" })).status, 400);
    assert.equal((await request("GET", "/integrations", human, undefined, { cursor: "../bad" })).status, 400);
  });
  it("listagem exige humano owner/admin ativo, nunca a chave da integração", async () => {
    const key = await integration();
    assert.equal((await request("GET", "/integrations")).status, 401);
    assert.equal((await request("GET", "/integrations", bearer(key.token))).status, 401);
    await db.doc("users/owner").update({ role: "interno" });
    assert.equal((await request("GET", "/integrations", human)).status, 403);
    await db.doc("users/owner").update({ role: "admin" });
    assert.equal((await request("GET", "/integrations", human)).status, 200);
    await db.doc("users/owner").update({ access_disabled: true });
    assert.equal((await request("GET", "/integrations", human)).status, 403);
  });
  it("Rules reais negam leitura e escrita das credenciais/aprovações/auditoria até ao owner", async () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    const rules = readFileSync(
      new URL("../../../../firestore.rules", import.meta.url),
      "utf8",
    );
    const loaded = await fetch(
      `http://${host}/emulator/v1/projects/${PROJECT}:securityRules`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: { files: [{ name: "firestore.rules", content: rules }] },
        }),
      },
    );
    assert.equal(loaded.status, 200, await loaded.text());
    const encoded = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = `${encoded({ alg: "none", typ: "JWT" })}.${encoded({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: "owner", user_id: "owner", auth_time: Math.floor(Date.now() / 1000), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, firebase: { identities: {}, sign_in_provider: "custom" } })}.`;
    const headers = {
      authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const base = `http://${host}/v1/projects/${PROJECT}/databases/(default)/documents`;
    const control = await fetch(`${base}/users/owner`, { headers });
    assert.equal(
      control.status,
      200,
      "O token simulado precisa ser um owner válido no emulador",
    );
    for (const collection of [
      "api_integrations",
      "api_approvals",
      "api_audit",
      "api_receipts",
    ]) {
      await db.doc(`${collection}/private`).set({ secret: "test-only" });
      assert.equal(
        (await fetch(`${base}/${collection}/private`, { headers })).status,
        403,
      );
      assert.equal(
        (
          await fetch(`${base}/${collection}/private`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({
              fields: { secret: { stringValue: "changed" } },
            }),
          })
        ).status,
        403,
      );
    }
  });
  it("nega anônimo e token inventado; documento público não contém dados operacionais", async () => {
    assert.equal((await request("GET", "/operacao/os")).status, 401);
    assert.equal(
      (await request("GET", "/operacao/os", bearer("fake"))).status,
      401,
    );
    assert.equal((await request("GET", "/openapi.json")).status, 200);
  });
  it("guarda só o hash, permite revogar e não aceita chave de integração na gestão", async () => {
    const key = await integration();
    const stored = (await db.doc(`api_integrations/${key.id}`).get()).data();
    assert.doesNotMatch(
      JSON.stringify(stored),
      new RegExp(key.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.equal(
      (await request("POST", "/integrations", bearer(key.token), {})).status,
      401,
    );
    assert.equal(
      (await request("DELETE", `/integrations/${key.id}`, human)).status,
      200,
    );
    assert.equal(
      (
        await request("GET", "/operacao/os", bearer(key.token), undefined, {
          customer_code: "A",
        })
      ).status,
      401,
    );
  });
  it("consulta com paginação e isolamento; não retorna dinheiro nem dados pessoais extras", async () => {
    const key = await integration();
    for (const numero of ["10045-01", "10045-02"])
      await db
        .doc(`service_orders/${numero}`)
        .set({ customer_code: "A", status: "aberta", preco: 999 });
    await db
      .doc("service_orders/10046-01")
      .set({ customer_code: "B", status: "aberta" });
    const first = await request(
      "GET",
      "/operacao/os",
      bearer(key.token),
      undefined,
      { customer_code: "A", limit: "1" },
    );
    assert.equal(first.status, 200);
    assert.equal(first.body.data.length, 1);
    assert.ok(first.body.next_cursor);
    assert.doesNotMatch(JSON.stringify(first.body.data), /preco/);
    const next = await request(
      "GET",
      "/operacao/os",
      bearer(key.token),
      undefined,
      { customer_code: "A", limit: "1", cursor: first.body.next_cursor },
    );
    assert.equal(next.body.data[0].id, "10045-02");
    assert.equal(
      (await request("GET", "/operacao/os/10046-01", bearer(key.token))).status,
      403,
    );
    assert.equal(
      (
        await request("GET", "/operacao/os", bearer(key.token), undefined, {
          customer_code: "B",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("GET", "/operacao/os", bearer(key.token), undefined, {
          customer_code: "A",
          limit: "-1",
        })
      ).status,
      400,
    );
  });
  it("recursos compartilhados precisam de escopo; delegante removido perde acesso imediatamente", async () => {
    const key = await integration(["operacao:ler"]);
    assert.equal(
      (await request("GET", "/operacao/colaboradores", bearer(key.token)))
        .status,
      403,
    );
    await db.doc("users/owner").update({ access_disabled: true });
    assert.equal(
      (
        await request("GET", "/operacao/os", bearer(key.token), undefined, {
          customer_code: "A",
        })
      ).status,
      403,
    );
  });
  it("aprovação humana exata permite demanda real, evento e repetição sem duplicar", async () => {
    const key = await integration();
    const path = "/operacao/demandas";
    const now = Date.now();
    const body = {
      customer_code: "A",
      titulo: "Mudança",
      canal: "telefone",
      recebida_em: new Date(now).toISOString(),
      executar_ate: new Date(now + 86400000).toISOString(),
      itens: [{ item: "Mesa", unidade: "UN", quantidade: "1" }],
    };
    const headers = { ...bearer(key.token), "idempotency-key": "call-1" };
    assert.equal((await request("POST", path, headers, body)).status, 403);
    const approved = await request(
      "POST",
      `/integrations/${key.id}/approvals`,
      human,
      { method: "POST", path: root + path, body, idempotency_key: "call-1" },
    );
    assert.equal(approved.status, 201, JSON.stringify(approved));
    const approvedHeaders = {
      ...headers,
      "x-approval-id": approved.body.data.id,
    };
    assert.equal(
      (
        await request("POST", path, approvedHeaders, {
          ...body,
          customer_code: "B",
        })
      ).status,
      403,
    );
    const result = await request("POST", path, approvedHeaders, body);
    assert.equal(result.status, 201, JSON.stringify(result));
    assert.equal(
      (await request("POST", path, approvedHeaders, body)).body.data.replayed,
      true,
    );
    assert.equal((await db.collection("demands").get()).size, 1);
    const demand = await request(
      "GET",
      `/operacao/demandas/${result.body.data.numero}`,
      bearer(key.token),
    );
    assert.equal(demand.body.data.etapa, "para_planejar");
    assert.ok(
      demand.body.data.itens[0].id,
      "O agente precisa do id para planejar sem abrir uma OS antes",
    );
    assert.equal(demand.body.data.itens[0].planejado, "1");
    assert.doesNotMatch(JSON.stringify(demand.body.data), /preco|pedido_por/);
    const events = (await db.collection("events").get()).docs.map((doc) =>
      doc.data(),
    );
    assert.equal(events[0].actor.uid, `api:${key.id}`);
    const audits = (await db.collection("api_audit").get()).docs.map((doc) =>
      doc.data(),
    );
    assert.ok(
      audits.some(
        (entry) => entry.approved_by === "owner" && entry.status === 201,
      ),
    );
    assert.doesNotMatch(JSON.stringify(audits), /Bearer|Mudança/);
  });

  it("detalhe de demanda fechada usa revisão sem preços para oferecer ids de planejamento", async () => {
    const key = await integration();
    await db
      .doc("demands/10045")
      .set({ customer_code: "A", etapa: "para_planejar", escopo_rv: 0 });
    await db.doc("quotes/10045/revisoes/0").set({
      linhas: [
        {
          id: "ln_1",
          item: "Mesa",
          quantidade: "3",
          preco: "999",
          descricao: "Montagem",
        },
      ],
    });
    const result = await request(
      "GET",
      "/operacao/demandas/10045",
      bearer(key.token),
    );
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.body.data.itens[0].id, "ln_1");
    assert.equal(result.body.data.itens[0].planejado, "3");
    assert.doesNotMatch(JSON.stringify(result.body.data), /preco|999/);
  });
  it("expiração da chave/aprovação e escopo de escrita ausente são recusados", async () => {
    const key = await integration(["operacao:ler"]);
    assert.equal(
      (
        await request(
          "POST",
          "/operacao/os",
          { ...bearer(key.token), "idempotency-key": "x" },
          { demanda: "10045" },
        )
      ).status,
      403,
    );
    await db.doc(`api_integrations/${key.id}`).update({ expires_at_ms: 0 });
    assert.equal(
      (
        await request("GET", "/operacao/os", bearer(key.token), undefined, {
          customer_code: "A",
        })
      ).status,
      401,
    );
  });
  it("limita uso por integração e recusa ambiente antigo", async () => {
    const key = await integration();
    await db
      .doc(`api_integrations/${key.id}`)
      .update({ rate_window: Math.floor(Date.now() / 60000), rate_count: 60 });
    assert.equal(
      (
        await request("GET", "/operacao/os", bearer(key.token), undefined, {
          customer_code: "A",
        })
      ).status,
      429,
    );
    const { createApiHandler } = await import(
      new URL("./handler.js", import.meta.url).href
    );
    const disabled = createApiHandler(db, "dute-btg", async () => ({
      uid: "owner",
    }));
    assert.equal(
      (
        await disabled({
          method: "GET",
          path: root + "/openapi.json",
          headers: {},
          query: {},
        })
      ).status,
      412,
    );
  });

  it("aprovação expirada, de outro agente ou de aprovador removido nunca executa", async () => {
    const key = await integration();
    const other = await integration();
    const body = {
      customer_code: "A",
      titulo: "Entrega",
      canal: "telefone",
      recebida_em: new Date().toISOString(),
      executar_ate: new Date(Date.now() + 86400000).toISOString(),
      itens: [{ item: "Mesa", unidade: "UN", quantidade: "1" }],
    };
    const approved = await request(
      "POST",
      `/integrations/${key.id}/approvals`,
      human,
      {
        method: "POST",
        path: root + "/operacao/demandas",
        body,
        idempotency_key: "same",
      },
    );
    const id = approved.body.data.id;
    const headers = {
      ...bearer(other.token),
      "idempotency-key": "same",
      "x-approval-id": id,
    };
    assert.equal(
      (await request("POST", "/operacao/demandas", headers, body)).status,
      403,
    );
    const ownHeaders = { ...headers, ...bearer(key.token) };
    await db.doc(`api_approvals/${id}`).update({ expires_at_ms: 0 });
    assert.equal(
      (await request("POST", "/operacao/demandas", ownHeaders, body)).status,
      403,
    );
    await db
      .doc(`api_approvals/${id}`)
      .update({ expires_at_ms: Date.now() + 60000, approved_by: "removed" });
    await db.doc("users/removed").set({ role: "owner", access_disabled: true });
    assert.equal(
      (await request("POST", "/operacao/demandas", ownHeaders, body)).status,
      403,
    );
    assert.equal((await db.collection("demands").get()).size, 0);
  });

  it("mesma chave em agentes diferentes não colide; mesma chave com outro conteúdo conflita", async () => {
    const first = await integration();
    const second = await integration();
    const body = {
      customer_code: "A",
      titulo: "Entrega",
      canal: "telefone",
      recebida_em: new Date().toISOString(),
      executar_ate: new Date(Date.now() + 86400000).toISOString(),
      itens: [{ item: "Mesa", unidade: "UN", quantidade: "1" }],
    };
    async function perform(key: any, input: any) {
      const approval = await request(
        "POST",
        `/integrations/${key.id}/approvals`,
        human,
        {
          method: "POST",
          path: root + "/operacao/demandas",
          body: input,
          idempotency_key: "same",
        },
      );
      assert.equal(approval.status, 201);
      return request(
        "POST",
        "/operacao/demandas",
        {
          ...bearer(key.token),
          "idempotency-key": "same",
          "x-approval-id": approval.body.data.id,
        },
        input,
      );
    }
    assert.equal((await perform(first, body)).status, 201);
    assert.equal((await perform(second, body)).status, 201);
    assert.equal(
      (await perform(first, { ...body, titulo: "Outra entrega" })).status,
      409,
    );
    assert.equal((await db.collection("demands").get()).size, 2);
  });

  it("ciclo REST: cria demanda, lê ids, planeja várias OS e agenda com controle de edição", async () => {
    const key = await integration();
    let sequence = 0;
    async function approvedWrite(path: string, body: any) {
      const nonce = `cycle-${sequence++}`;
      const approval = await request(
        "POST",
        `/integrations/${key.id}/approvals`,
        human,
        { method: "POST", path: root + path, body, idempotency_key: nonce },
      );
      assert.equal(approval.status, 201, JSON.stringify(approval));
      return request(
        "POST",
        path,
        {
          ...bearer(key.token),
          "idempotency-key": nonce,
          "x-approval-id": approval.body.data.id,
        },
        body,
      );
    }
    const direct = await approvedWrite("/operacao/demandas", {
      customer_code: "A",
      titulo: "Entrega",
      canal: "telefone",
      recebida_em: new Date().toISOString(),
      executar_ate: new Date(Date.now() + 86400000).toISOString(),
      itens: [{ item: "Mesa", unidade: "UN", quantidade: "2" }],
    });
    assert.equal(direct.status, 201, JSON.stringify(direct));
    const demanda = direct.body.data.numero;
    const detail = await request(
      "GET",
      `/operacao/demandas/${demanda}`,
      bearer(key.token),
    );
    const line = detail.body.data.itens[0];
    const plan = await approvedWrite("/operacao/os/planejamento", {
      demanda,
      ordens: [
        { itens: [{ id: line.id, planejado: "1" }] },
        { itens: [{ id: line.id, planejado: "1" }] },
      ],
    });
    assert.equal(plan.status, 201, JSON.stringify(plan));
    assert.equal(plan.body.data.numeros.length, 2);
    const eventsBefore = (await db.collection("events").get()).size;
    const excess = await approvedWrite("/operacao/os", { demanda });
    assert.equal(excess.status, 412);
    assert.equal((await db.collection("service_orders").get()).size, 2);
    assert.equal((await db.collection("events").get()).size, eventsBefore);
    const numero = plan.body.data.numeros[0];
    const schedule = {
      expected_edicao: 1,
      janela: { data: "2099-01-27", inicio: "08:00", fim: "12:00" },
      equipe: [],
      veiculos: [],
    };
    const scheduled = await approvedWrite(
      `/operacao/os/${numero}/agendamento`,
      schedule,
    );
    assert.equal(scheduled.status, 201, JSON.stringify(scheduled));
    const stale = await approvedWrite(
      `/operacao/os/${numero}/agendamento`,
      schedule,
    );
    assert.equal(stale.status, 412, JSON.stringify(stale));
    const os = await request(
      "GET",
      `/operacao/os/${numero}`,
      bearer(key.token),
    );
    assert.equal(os.body.data.status, "agendada");
    assert.equal(os.body.data.edicao, 2);
    const agenda = await request(
      "GET",
      "/operacao/agenda",
      bearer(key.token),
      undefined,
      { customer_code: "A", from: "2099-01-27", to: "2099-01-27" },
    );
    assert.equal(agenda.body.data.length, 1);
  });
});
