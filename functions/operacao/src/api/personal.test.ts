import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizePersonalRoute, personalCapabilities, personalEffectiveScopes, personalCustomerAllowed, type PersonalPrincipal, type PersonalRole } from "./shared/principal.js";
import { openapi } from "./openapi.js";
import { customerFilter } from "./shared/core.js";
import type { ApiScope } from "./shared/permissions.js";
const principal = (role: PersonalRole): PersonalPrincipal => ({uid:role,role,modules:["wms","operacao","financeiro"],portal_active:true,...(role === "cliente" ? {customer_code:"A"}:{})});
const cases: Array<[PersonalRole,string,string,ApiScope,boolean]> = [
  ["owner","POST","/rh/registros","rh:registros:gravar",false],
  ["owner","GET","/rh/registros","rh:ler",true],
  ["rh","POST","/rh/registros","rh:registros:gravar",true],
  ["interno","PATCH","/armazenagem/pedidos/a","armazenagem:pedidos:gravar",true],
  ["wms","PATCH","/armazenagem/pedidos/a","armazenagem:pedidos:gravar",false],
  ["wms","POST","/armazenagem/recebimentos","armazenagem:recebimentos:gravar",true],
  ["suporte","POST","/armazenagem/recebimentos","armazenagem:recebimentos:gravar",false],
  ["suporte","POST","/armazenagem/pedidos","armazenagem:pedidos:gravar",true],
  ["financeiro","GET","/armazenagem/estoque","armazenagem:ler",true],
  ["financeiro","GET","/armazenagem/catalogo","armazenagem:ler",false],
  ["financeiro","POST","/armazenagem/pedidos","armazenagem:pedidos:gravar",true],
  ["comercial","GET","/financeiro/faturas","financeiro:ler",true],
  ["comercial","POST","/financeiro/faturas","financeiro:faturas:gravar",false],
  ["comercial","GET","/financeiro/a-faturar/armazenagem","financeiro:ler",false],
  ["interno","GET","/comercial/locais","comercial:ler",true],
  ["interno","GET","/comercial/contatos","comercial:ler",false],
  ["interno","GET","/comercial/orcamentos","comercial:ler",false],
  ["cliente","GET","/armazenagem/estoque","armazenagem:ler",true],
  ["cliente","GET","/armazenagem/catalogo","armazenagem:ler",false],
  ["cliente","POST","/armazenagem/pedidos","armazenagem:pedidos:gravar",true],
  ["cliente","GET","/operacao/os","operacao:ler",true],
  ["cliente","GET","/operacao/demandas","operacao:ler",false],
  ["campo","GET","/operacao/os","operacao:ler",true],
  ["campo","GET","/operacao/demandas","operacao:ler",false],
  ["painel","GET","/operacao/agenda","operacao:ler",false],
  ["suporte","GET","/financeiro/a-faturar/armazenagem","financeiro:ler",true],
  ["suporte","GET","/financeiro/faturas","financeiro:ler",false],
  ["wms","GET","/agente/playbooks","agente:ler",false],
  ["suporte","GET","/agente/playbooks","agente:ler",true],
];
for(const [role,method,path,scope,allowed] of cases) test(`conta ${role}: ${method} ${path} ${allowed ? "permitido" : "negado"} pelo serviço humano`,()=>{
  const run=()=>authorizePersonalRoute(principal(role),method,"/api/v1"+path,scope);
  if(allowed) assert.doesNotThrow(run);else assert.throws(run);
});
test("somente leitura e custom são interseção atual, não snapshot de perfil",()=>{
  assert.ok(personalEffectiveScopes(principal("owner"),"read_only",[]).every(x=>x.endsWith(":ler")));
  assert.deepEqual(personalEffectiveScopes(principal("rh"),"custom",["financeiro:ler","rh:ler"]),["rh:ler"]);
  assert.equal(personalCapabilities(principal("painel")).scopes.length,0);
  assert.throws(()=>personalEffectiveScopes(principal("owner"),"root" as any,[]));
});
test("abrangência de cliente vem da conta atual e só aceita código válido",()=>{
  assert.equal(personalCustomerAllowed(principal("cliente"),"A"),true);
  assert.equal(personalCustomerAllowed(principal("cliente"),"B"),false);
  assert.equal(personalCustomerAllowed(principal("owner"),"B"),true);
  for(const code of ["*","../A","A/B","",null]) assert.equal(personalCustomerAllowed(principal("owner"),code),false);
  assert.equal(personalCapabilities({...principal("cliente"),portal_active:false}).scopes.length,0);
});
test("filtro pessoal omitido segue a conta; legado continua exigindo seleção explícita",()=>{
  const legacy:any={integration:{customers:["A"],scopes:[]}};
  assert.throws(()=>customerFilter(legacy,undefined));assert.equal(customerFilter(legacy,"A"),"A");
  assert.equal(customerFilter({integration:{...legacy.integration,kind:"personal",principal:principal("owner")}},undefined),undefined);
  assert.equal(customerFilter({integration:{...legacy.integration,kind:"personal",principal:principal("cliente")}},undefined),"A");
});
test("escopo de outro módulo e módulo desconhecido falham fechados",()=>{
  assert.throws(()=>authorizePersonalRoute(principal("owner"),"GET","/api/v1/financeiro/faturas","rh:ler"));
  assert.throws(()=>authorizePersonalRoute(principal("owner"),"GET","/api/v1/desconhecido/registro","financeiro:ler"));
});
test("filtro de cliente sem vínculo válido não vira listagem global",()=>{
  const noCustomer={...principal("cliente"),customer_code:undefined};
  assert.throws(()=>customerFilter({integration:{id:"a",delegated_by:"u",scopes:[],customers:[],write_policy:"scoped",kind:"personal",principal:noCustomer}},undefined));
});

test("OpenAPI documenta gestão pessoal e cliente opcional para chave pessoal",()=>{
  assert.ok(openapi.paths["/api/v1/api-keys"]?.post, "Contrato deve incluir criação de chave pessoal");
  assert.deepEqual(openapi.paths["/api/v1/api-keys"].post.security,[{FirebaseHuman:[]}]);
  assert.ok(openapi.paths["/api/v1/api-keys/{id}"].delete);
  assert.ok(openapi.paths["/api/v1/api-keys/capabilities"].get);
  assert.deepEqual(openapi.components.schemas.CreatePersonalKey.properties.permission.enum,["full","read_only","custom"]);
  assert.equal(openapi.components.schemas.CreatePersonalKey.properties.expires_in_days.default,90);
  assert.equal(openapi.components.schemas.CreatePersonalKey.properties.customers,undefined);
  assert.equal(openapi.paths["/api/v1/operacao/os"].get.parameters.find((x:any)=>x.name==="customer_code").required,false);
  assert.doesNotMatch(openapi.info.description,/demais módulos ainda não/);
});
