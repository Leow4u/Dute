import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { createApiHandler } from "./handler.js";
import { createModuleHandler } from "./shared/handler.js";
import { requireCustomer, type ModuleDefinition, type ApiRequest } from "./shared/core.js";

const project = "demo-dute-personal-keys";
const prefix = "/api/v1";
const roles = ["owner", "admin", "interno", "wms", "campo", "comercial", "financeiro", "rh", "suporte", "painel", "cliente"];
let app: ReturnType<typeof initializeApp>; let db: Firestore; let executed = 0;
const verify = async (token: string) => { if (!token.startsWith("human:")) throw new Error("bad human"); return { uid: token.slice(6) }; };
const fixture = (module: string): ModuleDefinition => ({ module, released: () => true, routes: [
  { method: "GET", path: `${prefix}/${module}/${module === "rh" ? "registros" : "estoque"}`, scope: module === "rh" ? "rh:ler" : "armazenagem:ler", role: module === "rh" ? "rh" : "wms", summary: "Fixture", run: async (ctx) => ({ data: { actor: ctx.actor.uid, role: ctx.actor.role } }) },
  { method: "POST", path: `${prefix}/${module}/${module === "rh" ? "registros" : "movimentacoes"}`, scope: module === "rh" ? "rh:registros:gravar" : "armazenagem:estoque:movimentar", role: module === "rh" ? "rh" : "wms", summary: "Fixture", run: async (ctx, _, req) => { if(module !== "rh") requireCustomer(ctx, (req.body as any)?.customer_code ?? "A"); executed++; return { actor: ctx.actor.uid, role: ctx.actor.role }; } },
] });
const call = (uid: string, method: string, path: string, body?: unknown, query: Record<string,unknown> = {}) => createApiHandler(db, "dute-homolog", verify)({method,path:prefix+path,body,query,headers:{authorization:`Bearer human:${uid}`}});
const keyRequest = (token: string, method: string, path: string, body?: unknown, query: Record<string,unknown> = {}) => ({method,path:prefix+path,body,query,headers:{authorization:`Bearer ${token}`,"idempotency-key":"personal-one"}});
const use = (token: string, method: string, path: string, body?: unknown, query: Record<string,unknown> = {}) => createApiHandler(db,"dute-homolog",verify)(keyRequest(token,method,path,body,query));
const moduleCall = (token: string, method: string, path: string, body?: unknown) => createModuleHandler(db,"dute-homolog",verify,fixture(path.startsWith("/rh/")?"rh":"armazenagem"))(keyRequest(token,method,path,body) as ApiRequest);
async function create(uid: string, permission = "full", extra: Record<string,unknown> = {}) {
  const response = await call(uid,"POST","/api-keys",{name:"Chave de teste",permission,...extra});
  assert.equal(response.status,201,JSON.stringify(response)); return response.body.data as any;
}
before(() => { assert.ok(process.env.FIRESTORE_EMULATOR_HOST); app=initializeApp({projectId:project},"personal-keys"); db=getFirestore(app); });
beforeEach(async()=>{
  executed=0;
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`,{method:"DELETE"});
  for(const role of roles) await db.doc(`users/${role}`).set({role,nome:role,...(role==="cliente"?{customer_code:"A"}:{})});
  await db.doc("users/other").set({role:"owner"});
  await db.doc("client_access/A").set({portal_ativo:true,modules:["wms","financeiro","operacao"]});
});
after(async()=>{await db.terminate();await deleteApp(app);});

test("qualquer perfil ativo cria sua chave pessoal sem escolher clientes",async()=>{
  for(const role of roles){
    const key=await create(role);
    const row=(await db.doc(`api_integrations/${key.id}`).get()).data()!;
    assert.equal(row.kind,"personal");assert.equal(row.delegated_by,role);assert.equal(row.permission,"full");assert.deepEqual(row.customers,[]);
    assert.equal(row.write_policy,"scoped");assert.equal(typeof row.token_hash,"string");assert.ok(!JSON.stringify(row).includes(key.token));
    const list=await call(role,"GET","/api-keys");assert.equal(list.status,200);assert.equal((list.body.data as any[]).length,1);
    assert.equal((list.body.data as any[])[0].id,key.id);
  }
});
test("gestão pessoal exige humano e isola lista e revogação até entre owners",async()=>{
  const mine=await create("owner");const theirs=await create("other");
  const list=await call("owner","GET","/api-keys");assert.deepEqual((list.body.data as any[]).map(x=>x.id),[mine.id]);
  assert.equal((await call("owner","DELETE",`/api-keys/${theirs.id}`)).status,404);
  assert.equal((await use(mine.token,"GET","/api-keys")).status,401);
  assert.equal((await use(mine.token,"POST","/api-keys",{name:"abuso",permission:"full"})).status,401);
  assert.equal((await call("owner","DELETE",`/integrations/${theirs.id}`)).status,403);
  assert.equal((await call("owner","DELETE",`/api-keys/${mine.id}`)).status,200);
  assert.equal((await moduleCall(mine.token,"GET","/armazenagem/estoque")).status,401);
});
test("metadados têm prefixo mascarado datas e último uso, nunca segredo ou hash",async()=>{
  const key=await create("interno");
  let row=(await call("interno","GET","/api-keys")).body.data as any[];
  assert.equal(row[0].last_used_at,null);assert.ok(Date.parse(row[0].created_at));assert.match(row[0].token_prefix,/^dute_.*…$/);
  assert.ok(!JSON.stringify(row).includes(key.token));assert.doesNotMatch(JSON.stringify(row),/token_hash|rate_count/);
  const result=await moduleCall(key.token,"GET","/armazenagem/estoque");assert.equal(result.status,200,JSON.stringify(result));
  assert.deepEqual(result.body.data,{actor:`api:${key.id}`,role:"interno"});
  row=(await call("interno","GET","/api-keys")).body.data as any[];assert.ok(Date.parse(row[0].last_used_at));
  const audit=(await db.collection("api_audit").get()).docs.map(x=>x.data());
  assert.ok(audit.some(x=>x.integration_id===key.id&&x.user_uid==="interno"));assert.ok(!JSON.stringify(audit).includes(key.token));
});
test("capabilities refletem permissões atuais, inclusive restrições específicas de RH",async()=>{
  const owner=await call("owner","GET","/api-keys/capabilities");assert.equal(owner.status,200);
  assert.ok((owner.body.data as any).scopes.includes("financeiro:ler"));assert.ok(!(owner.body.data as any).scopes.includes("rh:registros:gravar"));
  const rh=await call("rh","GET","/api-keys/capabilities");assert.ok((rh.body.data as any).scopes.includes("rh:registros:gravar"));
  assert.ok(!(rh.body.data as any).scopes.includes("financeiro:ler"));
  const key=await create("owner");
  assert.equal((await moduleCall(key.token,"POST","/rh/registros",{value:"ok"})).status,403);
  await db.doc("users/owner").update({role:"rh"});
  const changed=await moduleCall(key.token,"POST","/rh/registros",{value:"ok"});assert.equal(changed.status,201,JSON.stringify(changed));assert.equal((changed.body.data as any).role,"rh");
  await db.doc("users/owner").update({access_disabled:true});
  assert.equal((await moduleCall(key.token,"GET","/rh/registros")).status,403);
});
test("somente leitura e escopos personalizados limitam o acesso total da conta",async()=>{
  const read=await create("owner","read_only");
  assert.equal((await moduleCall(read.token,"GET","/armazenagem/estoque")).status,200);
  assert.equal((await moduleCall(read.token,"POST","/armazenagem/movimentacoes",{customer_code:"A"})).status,403);
  const custom=await create("owner","custom",{scopes:["armazenagem:ler"]});
  assert.equal((await moduleCall(custom.token,"GET","/rh/registros")).status,403);
  assert.equal((await moduleCall(custom.token,"GET","/armazenagem/estoque")).status,200);
  assert.equal((await call("interno","POST","/api-keys",{name:"abuso",permission:"custom",scopes:["financeiro:ler"]})).status,403);
  await db.doc("users/owner").update({role:"rh"});
  assert.equal((await moduleCall(custom.token,"GET","/armazenagem/estoque")).status,403);
  assert.equal(executed,0);
});
test("contrato portal e troca do cliente são reavaliados sem ampliar a chave",async()=>{
  const key=await create("cliente");
  const ok=await moduleCall(key.token,"POST","/armazenagem/movimentacoes",{customer_code:"A"});assert.equal(ok.status,403,"cliente não movimenta estoque diretamente");
  const read=await moduleCall(key.token,"GET","/armazenagem/estoque");assert.equal(read.status,200);
  await db.doc("client_access/A").update({modules:["operacao"]});
  assert.equal((await moduleCall(key.token,"GET","/armazenagem/estoque")).status,403);
  await db.doc("client_access/A").update({modules:["wms"],portal_ativo:false});
  assert.equal((await moduleCall(key.token,"GET","/armazenagem/estoque")).status,403);
  await db.doc("client_access/B").set({modules:["wms"],portal_ativo:true});await db.doc("users/cliente").update({customer_code:"B"});
  const caps=await call("cliente","GET","/api-keys/capabilities");assert.equal((caps.body.data as any).customer_code,"B");
});
test("corpo e configurações desconhecidas falham fechados e validade segue teto existente",async()=>{
  for(const body of [{name:"chave",permission:"admin"},{name:"chave",permission:"full",customers:["*"]},{name:"chave",permission:"custom",scopes:[]},{name:"chave",permission:"full",expires_in_days:91}]) assert.equal((await call("owner","POST","/api-keys",body)).status,400);
  const key=await create("owner");await db.doc(`api_integrations/${key.id}`).update({kind:"unknown"});
  assert.equal((await moduleCall(key.token,"GET","/armazenagem/estoque")).status,403);
  await db.doc("users/bad").set({role:"god"});assert.equal((await call("bad","GET","/api-keys")).status,403);
});

test("leitura pessoal da Operação abrange a conta sem seleção manual de clientes",async()=>{
  const key=await create("owner");
  await db.doc("service_orders/10001-01").set({numero:"10001-01",customer_code:"A",status:"planejada"});
  await db.doc("service_orders/10002-01").set({numero:"10002-01",customer_code:"B",status:"planejada"});
  const all=await use(key.token,"GET","/operacao/os");assert.equal(all.status,200,JSON.stringify(all));assert.equal((all.body.data as any[]).length,2);
  const filtered=await use(key.token,"GET","/operacao/os",undefined,{customer_code:"B"});assert.equal(filtered.status,200);assert.equal((filtered.body.data as any[]).length,1);
  const customer=await create("cliente");const own=await use(customer.token,"GET","/operacao/os");assert.equal(own.status,200);assert.deepEqual((own.body.data as any[]).map(x=>x.customer_code),["A"]);
  assert.equal((await use(customer.token,"GET","/operacao/os/10002-01")).status,403);
  assert.equal((await use(customer.token,"GET","/operacao/demandas")).status,403);
  await db.doc("users/cliente").update({customer_code:"B"});await db.doc("client_access/B").set({modules:["operacao"]});
  const moved=await use(customer.token,"GET","/operacao/os");assert.equal(moved.status,200);assert.deepEqual((moved.body.data as any[]).map(x=>x.customer_code),["B"]);
});
test("campo lê só suas OS usando UID humano, inclusive em detalhe e paginação",async()=>{
  const key=await create("campo");
  await db.doc("service_orders/10001-01").set({numero:"10001-01",customer_code:"A",status:"planejada",equipe_uids:["campo"]});
  await db.doc("service_orders/10002-01").set({numero:"10002-01",customer_code:"A",status:"planejada",equipe_uids:["outro"]});
  const all=await use(key.token,"GET","/operacao/os");assert.equal(all.status,200,JSON.stringify(all));assert.deepEqual((all.body.data as any[]).map(x=>x.id),["10001-01"]);
  assert.equal((await use(key.token,"GET","/operacao/os/10001-01")).status,200);
  const filtered=await use(key.token,"GET","/operacao/os",undefined,{customer_code:"A"});assert.equal(filtered.status,200);assert.deepEqual((filtered.body.data as any[]).map(x=>x.id),["10001-01"]);
  assert.equal((await use(key.token,"GET","/operacao/os/10002-01")).status,403);
  assert.equal((await use(key.token,"POST","/operacao/os",{demanda:"10001"})).status,403);
});
test("chaves legadas mantêm seleção de clientes e aprovação, sem virar pessoais",async()=>{
  const response=await call("owner","POST","/integrations",{name:"Legada",scopes:["operacao:ler","operacao:demanda:criar"],customers:["A"]});assert.equal(response.status,201);
  const legacy=response.body.data as any;
  assert.equal((await use(legacy.token,"GET","/operacao/os",undefined,{customer_code:"B"})).status,403);
  assert.equal((await use(legacy.token,"GET","/operacao/os")).status,403);
  assert.equal((await use(legacy.token,"POST","/operacao/demandas",{})).status>=400,true);
  const personal=await create("owner");
  const rows=(await call("owner","GET","/api-keys")).body.data as any[];
  assert.equal(rows.find(x=>x.id===legacy.id).kind,"legacy");assert.equal(rows.find(x=>x.id===legacy.id).write_policy,"approval_required");
  assert.equal(rows.find(x=>x.id===personal.id).kind,"personal");
  const oldList=(await call("owner","GET","/integrations")).body.data as any[];assert.ok(!oldList.some(x=>x.id===personal.id));
  await db.doc("users/owner").update({role:"interno"});
  assert.equal((await use(legacy.token,"GET","/operacao/os",undefined,{customer_code:"A"})).status,403);
  assert.equal((await use(personal.token,"GET","/operacao/os")).status,200);
});
test("contrato explicitamente vazio não herda módulos padrão; ausência do campo preserva padrão",async()=>{
  const key=await create("cliente");await db.doc("client_access/A").set({modules:[],portal_ativo:true});
  assert.equal((await moduleCall(key.token,"GET","/armazenagem/estoque")).status,403);
  await db.doc("client_access/A").set({portal_ativo:true});
  assert.equal((await moduleCall(key.token,"GET","/armazenagem/estoque")).status,200);
  assert.equal((await use(key.token,"GET","/operacao/os")).status,403);
});
test("escala malformada não autoriza o campo por coincidência de texto",async()=>{
  const key=await create("campo");
  await db.doc("service_orders/10009-01").set({numero:"10009-01",customer_code:"A",equipe_uids:"outra-campo-pessoa"});
  assert.equal((await use(key.token,"GET","/operacao/os/10009-01")).status,403);
});
