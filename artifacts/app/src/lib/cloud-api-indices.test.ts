import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cada consulta que as telas fazem pelo roteador do navegador (cloud-api.ts)
 * tem o índice composto no firestore.indexes.json. O emulador não confere
 * índice, e sem ele a tela não quebra: readPaged cai na leitura das mais
 * recentes (o hardCap da rota) e filtra em memória, e o que é mais antigo
 * some sem aviso. Tela nova, ou filtro novo numa tela, entra na lista.
 */

type Restricao =
  | { tipo: "where"; campo: string; op: string }
  | { tipo: "orderBy"; campo: string; direcao: "asc" | "desc" }
  | { tipo: "outra" };
type Consulta = { colecao: string; restricoes: Restricao[] };

const { lidas } = vi.hoisted(() => ({ lidas: [] as Consulta[] }));

vi.mock("./firebase", () => ({ firebaseAuth: null, firestore: {} }));
vi.mock("./functions-api", () => ({ callFunctionsApi: vi.fn(async () => null) }));
vi.mock("firebase/firestore", async (importOriginal) => {
  const original = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...original,
    collection: (_db: unknown, caminho: string) => ({ caminho }),
    documentId: () => "__name__",
    where: (campo: unknown, op: string) => ({ tipo: "where", campo: String(campo), op }),
    orderBy: (campo: unknown, direcao: "asc" | "desc" = "asc") => ({ tipo: "orderBy", campo: String(campo), direcao }),
    limit: () => ({ tipo: "outra" }),
    startAfter: () => ({ tipo: "outra" }),
    query: (alvo: { caminho: string }, ...restricoes: Restricao[]) => ({ colecao: alvo.caminho, restricoes }),
    getDocs: async (consulta: Consulta) => {
      lidas.push(consulta);
      return { docs: [] };
    },
    getCountFromServer: async (consulta: Consulta) => {
      lidas.push(consulta);
      return { data: () => ({ count: 0 }) };
    },
  };
});

import { installCloudApi } from "./cloud-api";
import { documentsListUrl } from "./document-rows";

type Indice = {
  collectionGroup: string;
  queryScope: string;
  fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>;
};

const INDICES = (
  JSON.parse(readFileSync(fileURLToPath(new URL("../../../../firestore.indexes.json", import.meta.url)), "utf8")) as {
    indexes: Indice[];
  }
).indexes;

const IGUALDADE = new Set(["==", "in", "array-contains", "array-contains-any"]);
const DIRECAO = { asc: "ASCENDING", desc: "DESCENDING" } as const;
type Ordem = [campo: string, direcao: string];

/** Sem a ordem pelo id no fim quando ela segue a direção da anterior: o Firestore a põe sozinho. */
function semIdImplicito(ordens: Ordem[]): Ordem[] {
  const ultima = ordens.at(-1);
  if (!ultima || ultima[0] !== "__name__") return ordens;
  const anterior = ordens.at(-2);
  return (anterior ? anterior[1] : "ASCENDING") === ultima[1] ? ordens.slice(0, -1) : ordens;
}

/** O índice composto que a consulta pede, ou null quando os de campo único bastam. */
function indicePedido(consulta: Consulta): { igualdades: string[]; ordens: Ordem[] } | null {
  const filtros = consulta.restricoes.flatMap((restricao) => (restricao.tipo === "where" ? [restricao] : []));
  const igualdades = [...new Set(filtros.filter((filtro) => IGUALDADE.has(filtro.op)).map((filtro) => filtro.campo))].sort();
  const faixas = [...new Set(filtros.filter((filtro) => !IGUALDADE.has(filtro.op)).map((filtro) => filtro.campo))];
  let ordens = consulta.restricoes.flatMap((restricao): Ordem[] => (restricao.tipo === "orderBy" ? [[restricao.campo, DIRECAO[restricao.direcao]]] : []));
  // A contagem não ordena: com faixa, o Firestore ordena pelo campo dela.
  if (!ordens.length) ordens = faixas.map((campo): Ordem => [campo, "ASCENDING"]);
  ordens = semIdImplicito(ordens);
  // Só igualdades o Firestore junta pelos índices de campo único; sem
  // igualdade, uma ordem só usa o índice do próprio campo.
  if (!ordens.length || (!igualdades.length && ordens.length === 1)) return null;
  return { igualdades, ordens };
}

function serve(indice: Indice, pedido: { igualdades: string[]; ordens: Ordem[] }): boolean {
  const campos = semIdImplicito(indice.fields.map((campo): Ordem => [campo.fieldPath, campo.order ?? campo.arrayConfig ?? ""]));
  if (campos.length !== pedido.igualdades.length + pedido.ordens.length) return false;
  const iniciais = campos.slice(0, pedido.igualdades.length).map(([campo]) => campo).sort();
  const resto = campos.slice(pedido.igualdades.length);
  return iniciais.join() === pedido.igualdades.join() && resto.every(([campo, direcao], posicao) => campo === pedido.ordens[posicao]?.[0] && direcao === pedido.ordens[posicao]?.[1]);
}

/** O índice que falta para a consulta, escrito como no firestore.indexes.json, ou null. */
function indiceQueFalta(consulta: Consulta): string | null {
  const pedido = indicePedido(consulta);
  if (!pedido) return null;
  const doGrupo = INDICES.filter((indice) => indice.collectionGroup === consulta.colecao && indice.queryScope === "COLLECTION");
  if (doGrupo.some((indice) => serve(indice, pedido))) return null;
  const campos = [...pedido.igualdades.map((campo) => `${campo} ASCENDING`), ...pedido.ordens.map(([campo, direcao]) => `${campo} ${direcao}`)];
  return `${consulta.colecao} (${campos.join(", ")})`;
}

/** As consultas das telas, com a tela que as faz. */
const CONSULTAS_DAS_TELAS: Array<[tela: string, caminho: string]> = [
  ["Configurações › Usuários: os clientes do convite", "/api/customers?status=active&limit=250"],
  ["Receber: as solicitações abertas do cliente", "/api/customer-requests?customer_code=Itau&status=open&limit=200"],
  ["Exceções: as devoluções sem destino", "/api/return-items?status=pending_disposition&limit=500"],
  ["Documentos do financeiro", documentsListUrl("financeiro")],
  ["Estoque: as últimas movimentações do item", "/api/movements?cod_sku=ITAU-000001&limit=5"],
  ["Estoque › Histórico: o tipo", "/api/movements?tipo_mov=ENTRADA&limit=50&offset=0"],
  ["Estoque › Histórico: a busca", "/api/movements?search=ITAU-0001&limit=50&offset=0"],
  ["Estoque › Histórico: o tipo e a busca", "/api/movements?search=ITAU-0001&tipo_mov=ENTRADA&limit=50&offset=0"],
  ["Estoque, Etiquetas e Inventário: as caixas do cliente", "/api/warehouse/boxes?customer_code=Itau&limit=1000"],
  ["Pedidos: a situação", "/api/orders?status=pending&limit=50&offset=0"],
];

beforeEach(() => {
  lidas.length = 0;
  vi.stubGlobal("window", { fetch: vi.fn(), location: { origin: "https://dute.test" } });
  installCloudApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("o índice de cada consulta das telas", () => {
  it.each(CONSULTAS_DAS_TELAS)("%s", async (_tela, caminho) => {
    const resposta = await window.fetch(caminho);
    expect(resposta.status).toBe(200);
    expect(lidas.length).toBeGreaterThan(0);
    expect(lidas.map(indiceQueFalta).filter(Boolean)).toEqual([]);
  });

  it("a conta do índice: igualdade antes, depois a ordem, na direção dela", () => {
    const tipoEBusca: Consulta = {
      colecao: "movements",
      restricoes: [
        { tipo: "where", campo: "tipo_mov", op: "==" },
        { tipo: "where", campo: "cod_sku", op: ">=" },
        { tipo: "where", campo: "cod_sku", op: "<" },
        { tipo: "orderBy", campo: "cod_sku", direcao: "asc" },
        { tipo: "orderBy", campo: "__name__", direcao: "asc" },
      ],
    };
    expect(indicePedido(tipoEBusca)).toEqual({ igualdades: ["tipo_mov"], ordens: [["cod_sku", "ASCENDING"]] });
    // A mesma ordem ao contrário pede outro índice.
    const aoContrario: Consulta = {
      colecao: "movements",
      restricoes: [
        { tipo: "where", campo: "tipo_mov", op: "==" },
        { tipo: "orderBy", campo: "data", direcao: "asc" },
        { tipo: "orderBy", campo: "__name__", direcao: "asc" },
      ],
    };
    expect(indiceQueFalta(aoContrario)).toBe("movements (tipo_mov ASCENDING, data ASCENDING)");
    // Uma ordem só, sem igualdade, usa o índice do próprio campo.
    expect(indicePedido({ colecao: "movements", restricoes: [{ tipo: "orderBy", campo: "data", direcao: "desc" }, { tipo: "orderBy", campo: "__name__", direcao: "desc" }] })).toBeNull();
  });
});
