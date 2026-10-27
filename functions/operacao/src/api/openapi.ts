import { PREFIX } from "./contract.js";
import { API_SCOPES } from "./shared/permissions.js";
import { PLATFORM_ROUTES } from "./shared/manifests.js";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({
  content: { "application/json": { schema } },
});
const response = (description: string, schema: unknown = ref("Result")) => ({
  description,
  ...json(schema),
});
const errors = {
  "400": response("Entrada inválida", ref("Error")),
  "401": response("Credencial inválida/expirada/revogada", ref("Error")),
  "403": response("Sem escopo, cliente ou aprovação", ref("Error")),
  "404": response("Não encontrado", ref("Error")),
  "409": response("Conflito de edição/idempotência", ref("Error")),
  "412": response("Pré-condição de negócio", ref("Error")),
  "429": response("Limite de chamadas", ref("Error")),
  "500": response("Falha interna; use request_id", ref("Error")),
};
const parameter = (
  name: string,
  location: string,
  schema: unknown,
  required = false,
) => ({ name, in: location, required, schema });
const numberParam = parameter(
  "numero",
  "path",
  { type: "string", pattern: "^\\d{5,8}-\\d{2}$" },
  true,
);
const page = [
  parameter("limit", "query", {
    type: "integer",
    minimum: 1,
    maximum: 100,
    default: 50,
  }),
  parameter("cursor", "query", { type: "string" }),
];
const customer = parameter("customer_code", "query", { type: "string", description: "Integração legada exige cliente explícito. Chave pessoal pode omitir para usar a abrangência atual da conta; cliente usa sempre seu próprio código." }, false);
const filters = [
  parameter("status", "query", { type: "string" }),
  ...["from", "to"].map((name) =>
    parameter(name, "query", { type: "string", format: "date" }),
  ),
];
const integrationAuth = [{ IntegrationBearer: [] }];
const humanAuth = [{ FirebaseHuman: [] }];
const writeHeaders = [
  parameter(
    "Idempotency-Key",
    "header",
    { type: "string", minLength: 1, maxLength: 200 },
    true,
  ),
  parameter(
    "X-Approval-Id",
    "header",
    { type: "string", format: "uuid", description: "Obrigatório somente para write_policy approval_required; chaves scoped usam seus escopos." },
    false,
  ),
];
function read(summary: string, parameters: unknown[]) {
  return {
    summary,
    security: integrationAuth,
    parameters,
    responses: { "200": response("Consulta autorizada"), ...errors },
  };
}
function write(summary: string, schema: string, parameters: unknown[] = []) {
  return {
    summary,
    security: integrationAuth,
    parameters: [...parameters, ...writeHeaders],
    requestBody: { required: true, ...json(ref(schema)) },
    responses: {
      "201": response("Executada; repetição pode incluir replayed=true"),
      ...errors,
    },
  };
}
const str = { type: "string" };
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
});
const array = (items: unknown, maxItems: number) => ({
  type: "array",
  items,
  maxItems,
});
const team = array(
  object(
    {
      colaborador_id: { type: "string", pattern: "^col_[a-f0-9]{16}$" },
      papel: {
        type: "string",
        nullable: true,
        enum: ["lider", "motorista", "montador", "ajudante", null],
      },
    },
    ["colaborador_id"],
  ),
  20,
);
const window = object(
  {
    data: { type: "string", format: "date" },
    inicio: {
      type: "string",
      nullable: true,
      pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
    },
    fim: {
      type: "string",
      nullable: true,
      pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
    },
  },
  ["data"],
);
const contact = object(
  { nome: str, telefone: { type: "string", nullable: true } },
  ["nome"],
);
const scheduling = {
  janela: window,
  equipe: team,
  veiculos: array({ type: "string", pattern: "^vei_[a-f0-9]{16}$" }, 6),
  instrucoes: { type: "string", nullable: true, maxLength: 1000 },
  contatos: object({
    origem: { ...contact, nullable: true },
    destino: { ...contact, nullable: true },
  }),
};
const location = object({
  local_id: { type: "string", nullable: true },
  complemento: { type: "string", nullable: true },
});
const operation = object(
  {
    itens: {
      ...array(
        object(
          {
            id: str,
            planejado: { type: "string", pattern: "^\\d{1,9}(\\.\\d{1,3})?$" },
          },
          ["id", "planejado"],
        ),
        300,
      ),
      minItems: 1,
    },
    ...scheduling,
  },
  ["itens"],
);

export const openapi: Record<string, any> = {
  openapi: "3.0.3",
  info: {
    title: "API Dute",
    version: "1.1.0",
    description:
      "API dos seis módulos. Chaves pessoais acompanham as permissões atuais da conta e são gerenciadas pelo titular em api-keys. Integrações legadas mantêm clientes, escopos e política original; approval_required exige aprovação humana exata de15min. Bearer individual,60 chamadas/minuto, corpo até64KiB. Credenciais independentes por ambiente.",
  },
  servers: [
    {
      url: "https://southamerica-east1-dute-prod.cloudfunctions.net/duteApi",
      description: "Produção",
    },
    {
      url: "https://southamerica-east1-dute-homolog.cloudfunctions.net/duteApi",
      description: "Homologação",
    },
  ],
  paths: {
    [`${PREFIX}/openapi.json`]: {
      get: {
        summary: "Contrato público da API",
        security: [],
        responses: { "200": { description: "OpenAPI 3.0.3" } },
      },
    },
    [`${PREFIX}/integrations`]: {
      get: {
        summary: "Listar metadados de integrações, sem tokens ou hashes (owner/admin humano)",
        security: humanAuth,
        parameters: page,
        responses: { "200": response("Metadados paginados; inclui revogadas e expiradas"), ...errors },
      },
      post: {
        summary:
          "Criar credencial (owner/admin humano). Token exibido uma vez.",
        security: humanAuth,
        requestBody: { required: true, ...json(ref("CreateIntegration")) },
        responses: { "201": response("id, token e expires_at"), ...errors },
      },
    },
    [`${PREFIX}/integrations/{id}`]: {
      delete: {
        summary: "Revogar credencial (owner/admin humano)",
        security: humanAuth,
        parameters: [
          parameter(
            "id",
            "path",
            { type: "string", pattern: "^[a-f0-9]{32}$" },
            true,
          ),
        ],
        responses: { "200": response("Revogada"), ...errors },
      },
    },
    [`${PREFIX}/integrations/{id}/approvals`]: {
      post: {
        summary: "Aprovar uma ação exata (owner/admin humano)",
        security: humanAuth,
        parameters: [
          parameter(
            "id",
            "path",
            { type: "string", pattern: "^[a-f0-9]{32}$" },
            true,
          ),
        ],
        requestBody: { required: true, ...json(ref("Approval")) },
        responses: {
          "201": response("id para X-Approval-Id e expires_at"),
          ...errors,
        },
      },
    },
    [`${PREFIX}/operacao/demandas`]: {
      get: read("Demandas por cliente; escopo operacao:ler", [
        customer,
        ...page,
      ]),
      post: write(
        "Criar demanda direta; operacao:demanda:criar",
        "DirectDemand",
      ),
    },
    [`${PREFIX}/operacao/demandas/{numero}`]: {
      get: read("Detalhe de demanda", [
        parameter(
          "numero",
          "path",
          { type: "string", pattern: "^\\d{5,8}$" },
          true,
        ),
      ]),
    },
    [`${PREFIX}/operacao/os`]: {
      get: read("OS por cliente; operacao:ler", [
        customer,
        ...page,
        ...filters,
      ]),
      post: write(
        "Abrir OS com o saldo da demanda; operacao:os:gravar",
        "CreateOrder",
      ),
    },
    [`${PREFIX}/operacao/os/{numero}`]: {
      get: read("Detalhe de OS; operacao:ler", [numberParam]),
    },
    [`${PREFIX}/operacao/os/planejamento`]: {
      post: write(
        "Planejar até dez OS da demanda; operacao:os:gravar",
        "PlanOrders",
      ),
    },
    [`${PREFIX}/operacao/os/{numero}/agendamento`]: {
      post: write(
        "Agendar OS com controle de edição; operacao:os:gravar",
        "ScheduleOrder",
        [numberParam],
      ),
    },
    [`${PREFIX}/operacao/agenda`]: {
      get: read("Agenda por cliente e período; operacao:ler", [
        customer,
        ...page,
        ...filters,
      ]),
    },
    [`${PREFIX}/operacao/colaboradores`]: {
      get: read(
        "Recursos compartilhados; operacao:recursos:ler. Sem CPF, CNH e telefone.",
        page,
      ),
    },
    [`${PREFIX}/operacao/veiculos`]: {
      get: read("Frota compartilhada; operacao:recursos:ler", page),
    },
  },
  components: {
    securitySchemes: {
      IntegrationBearer: {
        type: "http",
        scheme: "bearer",
        description:
          "Chave pessoal ou de integração legada no formato dute_ID.SEGREDO. Permissões e abrangência conferidas a cada chamada; não é token Firebase nem chave web Firebase.",
      },
      FirebaseHuman: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "ID token Firebase de usuário humano ativo, verificado com revogação. Gestão de api-keys exige o próprio titular; integrations/approvals legados exigem owner/admin. Nunca entregar este token ao integrador.",
      },
    },
    schemas: {
      Result: {
        type: "object",
        properties: {
          data: { description: "Registro, lista ou resultado da operação" },
          next_cursor: {
            type: "string",
            nullable: true,
            description:
              "Seguir até null, inclusive se data vier vazio após filtros. Cursor é ID do último documento examinado.",
          },
          request_id: { type: "string", format: "uuid" },
        },
      },
      Error: object(
        {
          error: object({ code: str, message: str }, ["code", "message"]),
          request_id: str,
        },
        ["error", "request_id"],
      ),
      CreateIntegration: object(
        {
          name: { type: "string", minLength: 2, maxLength: 80 },
          scopes: {
            ...array(
              {
                type: "string",
                enum: API_SCOPES,
              },
              API_SCOPES.length,
            ),
            minItems: 1,
          },
          customers: {
            ...array({ type: "string", maxLength: 80 }, 50),
            minItems: 0,
          },
          expires_in_days: {
            type: "integer",
            minimum: 1,
            maximum: 90,
            default: 30,
          },
          write_policy: { type: "string", enum: ["scoped", "approval_required"], default: "approval_required", description: "scoped autoriza pelas permissões da chave. Omitir preserva aprovação humana por escrita; não amplia chaves já emitidas." },
        },
        ["name", "scopes", "customers"],
      ),
      Approval: object(
        {
          method: { type: "string", enum: ["POST", "PATCH"] },
          path: {
            type: "string",
            description: "Caminho exato, incluindo /api/v1",
          },
          body: {
            type: "object",
            description:
              "Mesmo objeto JSON que o agente enviará, sem action/idempotency_key/numero",
          },
          idempotency_key: { type: "string", maxLength: 200 },
        },
        ["method", "path", "body", "idempotency_key"],
      ),
      CreateOrder: object(
        { demanda: { type: "string", pattern: "^\\d{5,8}$" } },
        ["demanda"],
      ),
      PlanOrders: object(
        {
          demanda: { type: "string", pattern: "^\\d{5,8}$" },
          ordens: { ...array(operation, 10), minItems: 1 },
        },
        ["demanda", "ordens"],
      ),
      ScheduleOrder: object(
        { expected_edicao: { type: "integer", minimum: 1 }, ...scheduling },
        ["expected_edicao", "janela", "equipe", "veiculos"],
      ),
      DirectDemand: object(
        {
          customer_code: { type: "string", maxLength: 80 },
          titulo: { type: "string", minLength: 2, maxLength: 120 },
          canal: {
            type: "string",
            enum: ["telefone", "whatsapp", "email", "portal"],
          },
          pedido_por: { ...contact, nullable: true },
          recebida_em: {
            type: "string",
            format: "date-time",
            description:
              "Obrigatório sem solicitacao_id; proibido quando ela existe",
          },
          executar_ate: { type: "string", format: "date-time" },
          tipo: {
            type: "string",
            enum: ["planejada", "emergencial", "paraquedas"],
          },
          origem: { ...location, nullable: true },
          destino: { ...location, nullable: true },
          solicitacao_id: {
            type: "string",
            nullable: true,
            description: "Solicitação do mesmo cliente; exige canal portal",
          },
          itens: {
            ...array(
              object(
                {
                  lpu_item_id: { type: "string", nullable: true },
                  item: { type: "string", nullable: true },
                  unidade: { type: "string", nullable: true },
                  quantidade: {
                    type: "string",
                    pattern: "^\\d{1,9}(\\.\\d{1,3})?$",
                  },
                },
                ["quantidade"],
              ),
              100,
            ),
            minItems: 1,
          },
        },
        ["customer_code", "titulo", "canal", "executar_ate", "itens"],
      ),
    },
  },
};

// Concrete response fields make the contract usable by generated clients/tools.
const optionalText = { type: "string", nullable: true };
const fields = (names: string[]) =>
  Object.fromEntries(names.map((name) => [name, optionalText]));
const item = object(
  {
    ...fields([
      "id",
      "lpu_item_id",
      "codigo",
      "item",
      "descricao",
      "servico",
      "unidade",
      "planejado",
      "consumido",
      "saldo",
    ]),
  },
  ["id"],
);
const demand = object(
  {
    ...fields([
      "id",
      "customer_code",
      "customer_name",
      "titulo",
      "tipo",
      "etapa",
      "executar_ate",
      "recebida_em",
    ]),
    escopo_rv: { type: "integer", nullable: true },
    itens: array(item, 300),
  },
  ["id"],
);
const order = object(
  {
    ...fields([
      "id",
      "numero",
      "demanda",
      "customer_code",
      "cliente_nome",
      "tipo",
      "status",
    ]),
    edicao: { type: "integer" },
    servicos: array(str, 10),
    janela: { ...window, nullable: true },
    itens: array(item, 300),
    equipe: array(
      object(fields(["colaborador_id", "nome", "papel", "vinculo"])),
      20,
    ),
    veiculos: array(
      object(fields(["veiculo_id", "placa", "tipo", "modelo"])),
      6,
    ),
  },
  ["id"],
);
const collaborator = object(
  {
    ...fields(["id", "nome", "funcao", "vinculo"]),
    ativo: { type: "boolean" },
  },
  ["id"],
);
const vehicle = object(
  {
    ...fields(["id", "placa", "tipo", "modelo"]),
    ativo: { type: "boolean" },
    capacidade_kg: { type: "number", nullable: true },
    capacidade_m3: { type: "number", nullable: true },
  },
  ["id"],
);
Object.assign(openapi.components.schemas, {
  Demand: demand,
  ServiceOrder: order,
  Collaborator: collaborator,
  Vehicle: vehicle,
});
const envelope = (data: unknown, paged = false) =>
  object(
    {
      data,
      request_id: { type: "string", format: "uuid" },
      ...(paged
        ? {
            next_cursor: {
              type: "string",
              nullable: true,
              description:
                "Continuar até null, inclusive depois de página filtrada vazia",
            },
          }
        : {}),
    },
    ["data", "request_id"],
  );

// Gestão pessoal usa a sessão humana; segredo não aparece nas listagens.
Object.assign(openapi.components.schemas, {
  CreatePersonalKey: object({
    name: { type: "string", minLength: 2, maxLength: 80 },
    permission: { type: "string", enum: ["full", "read_only", "custom"], description: "full/read_only seguem a conta atual; custom intersecta os escopos escolhidos com o acesso atual." },
    scopes: { ...array({ type: "string", enum: API_SCOPES }, API_SCOPES.length), description: "Somente custom aceita escopos não vazios; full/read_only omitem este campo ou enviam lista vazia." },
    expires_in_days: { type: "integer", minimum: 1, maximum: 90, default: 90 },
  }, ["name", "permission"]),
  PersonalKey: object({
    id: str, name: str, token_prefix: { type: "string", description: "Identificador público mascarado; não contém segredo recuperável." },
    permission: { type: "string", enum: ["full", "read_only", "custom", "legacy"] },
    kind: { type: "string", enum: ["personal", "legacy"] },
    scopes: array({ type: "string", enum: API_SCOPES }, API_SCOPES.length),
    created_at: { type: "string", format: "date-time", nullable: true },
    expires_at: { type: "string", format: "date-time" },
    last_used_at: { type: "string", format: "date-time", nullable: true },
    revoked: { type: "boolean" },
    write_policy: { type: "string", enum: ["scoped", "approval_required"] },
  }, ["id", "name", "token_prefix", "permission", "kind", "scopes", "created_at", "expires_at", "last_used_at", "revoked"]),
  PersonalKeyCapabilities: object({
    scopes: array({ type: "string", enum: API_SCOPES }, API_SCOPES.length),
    role: str, customer_code: str, customer_access: { type: "string", enum: ["all", "own", "none"] },
  }, ["scopes", "role", "customer_access"]),
});
Object.assign(openapi.paths, {
  [`${PREFIX}/api-keys/capabilities`]: { get: {
    summary: "Permissões atuais da própria conta para criar chaves pessoais", security: humanAuth,
    responses: { "200": response("Escopos elegíveis; cada rota ainda confere restrições por recurso", envelope(ref("PersonalKeyCapabilities"))), ...errors },
  } },
  [`${PREFIX}/api-keys`]: {
    get: { summary: "Listar apenas suas chaves, incluindo legadas próprias identificadas", security: humanAuth, parameters: page,
      responses: { "200": response("Metadados paginados; nunca token/hash", envelope({ type: "array", items: ref("PersonalKey") }, true)), ...errors } },
    post: { summary: "Criar chave pessoal; segredo exibido uma vez", security: humanAuth,
      requestBody: { required: true, ...json(ref("CreatePersonalKey")) },
      responses: { "201": response("Guarde o token antes de fechar; somente o hash é salvo", envelope(object({ id: str, token: str, expires_at: { type: "string", format: "date-time" } }, ["id", "token", "expires_at"]))), ...errors } },
  },
  [`${PREFIX}/api-keys/{id}`]: { delete: { summary: "Revogar somente uma chave da própria conta", security: humanAuth,
    parameters: [parameter("id", "path", { type: "string", pattern: "^[a-f0-9]{32}$" }, true)],
    responses: { "200": response("Chave própria revogada", envelope(object({ id: str, revoked: { type: "boolean" } }, ["id", "revoked"]))), ...errors } } },
});

/** Converte o subconjunto de JSON Schema emitido pelos parsers para OpenAPI 3.0. */
export function openapiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(openapiSchema);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  if (Array.isArray(source.anyOf) && source.anyOf.some((item) => item && typeof item === "object" && item.type === "null")) {
    const alternatives = source.anyOf.filter((item) => !(item && typeof item === "object" && item.type === "null"));
    if (alternatives.length === 1) {
      const { anyOf: _anyOf, ...rest } = source;
      return openapiSchema({ ...rest, ...alternatives[0], nullable: true });
    }
  }
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "required" && Array.isArray(child) && child.length === 0) continue;
    if (key === "type" && Array.isArray(child) && child.includes("null")) {
      const nonNull = child.filter((type) => type !== "null");
      if (nonNull.length === 1) { result.type = nonNull[0]; result.nullable = true; continue; }
    }
    if (["exclusiveMinimum", "exclusiveMaximum"].includes(key) && typeof child === "number") {
      result[key === "exclusiveMinimum" ? "minimum" : "maximum"] = child; result[key] = true; continue;
    }
    result[key] = openapiSchema(child);
  }
  return result;
}
for (const entry of PLATFORM_ROUTES) {
  const list = entry.method === "GET" && (!entry.path.includes("{") || /\/(itens|aditivos|revisoes)$/.test(entry.path));
  const parameters: unknown[] = [...entry.path.matchAll(/\{([a-z_]+)\}/g)].map((match: RegExpMatchArray) => parameter(match[1], "path", { type: "string", maxLength: 200 }, true));
  if (list) parameters.push(...page);
  if (entry.customerRequired && entry.method === "GET") parameters.push(customer);
  if (entry.method !== "GET") parameters.push(parameter("Idempotency-Key", "header", { type: "string", minLength: 1, maxLength: 200 }, true), parameter("X-Approval-Id", "header", { type: "string", format: "uuid", description: "Obrigatório somente para chaves com write_policy approval_required." }));
  const fields = [...new Set(["id", ...(entry.responseFields ?? [])])] as string[];
  const projected = object(Object.fromEntries(fields.map((field) => [field, {}])));
  const resultSchema = entry.method === "GET" ? envelope(list ? { type: "array", items: projected } : projected, list) : ref("Result");
  const operation = {
    summary: entry.summary,
    description: `Escopo: ${entry.scope}. ${entry.description ?? ""} Chave pessoal também exige as permissões atuais da conta para esta rota/recurso. ${entry.method === "GET" ? "Leitura autorizada e projetada." : "Chave scoped executa com seus escopos. Chave legada/approval_required exige aprovação exata. Não há repetição automática com uma chave de idempotência nova."}`,
    security: integrationAuth, parameters,
    ...(entry.requestSchema ? { requestBody: { required: true, ...json(openapiSchema(entry.requestSchema)) } } : {}),
    responses: { [entry.method === "POST" ? "201" : "200"]: response(`Campos de resposta: ${(entry.responseFields ?? []).join(", ") || "recibo da operação"}`, resultSchema), ...(entry.method === "POST" ? { "200": response("Recibo da repetição idempotente", resultSchema) } : {}), ...errors },
    "x-required-scope": entry.scope,
  };
  openapi.paths[entry.path] ??= {};
  openapi.paths[entry.path][String(entry.method).toLowerCase()] = operation;
}

for (const [path, operations] of Object.entries(openapi.paths) as [
  string,
  Record<string, any>,
][]) {
  for (const [method, operation] of Object.entries(operations)) {
    operation.operationId = `${method}_${path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
    operation.responses["503"] = response(
      "Indisponível; repetir escrita com a mesma chave",
      ref("Error"),
    );
    if (method === "get" && path === `${PREFIX}/integrations`) {
      operation.responses["200"] = response("Metadados sem credenciais", envelope({
        type: "array",
        items: object({
          id: str, name: str, customers: array(str, 50), scopes: array(str, API_SCOPES.length), write_policy: { type: "string", enum: ["scoped", "approval_required"] },
          delegated_by: str, expires_at: { type: "string", format: "date-time" }, revoked: { type: "boolean" },
        }, ["id", "name", "customers", "scopes", "delegated_by", "expires_at", "revoked"]),
      }, true));
    }
    if (method === "get" && path.includes("/operacao/")) {
      const kind = path.split("/")[4];
      const schema =
        kind === "demandas"
          ? "Demand"
          : kind === "colaboradores"
            ? "Collaborator"
            : kind === "veiculos"
              ? "Vehicle"
              : "ServiceOrder";
      const detail = path.includes("{numero}");
      operation.responses["200"] = response(
        "Consulta autorizada",
        envelope(
          detail ? ref(schema) : { type: "array", items: ref(schema) },
          !detail,
        ),
      );
    }
    if (method === "post" && path.includes("/operacao/")) {
      const result = path.endsWith("/demandas")
        ? object({
            numero: str,
            tipo: str,
            linhas: { type: "integer" },
            replayed: { type: "boolean" },
          })
        : object({
            numero: str,
            demanda: str,
            numeros: array(str, 10),
            edicao: { type: "integer" },
            replayed: { type: "boolean" },
          });
      operation.responses["201"] = response(
        "Operação concluída ou recibo da repetição",
        envelope(result),
      );
    }
  }
}
