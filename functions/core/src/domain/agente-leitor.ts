import type { Firestore, Query } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import type { AudienciaDoAgente } from "./agente-escopo.js";

/**
 * O leitor do Agent Dute (docs/plataforma/fase-5-memoria.md, parte 5.5b): o
 * que as ferramentas recebem no lugar do banco. Só lê, por construção: não
 * tem gravação, lote nem transação.
 *
 * - `doCliente` consulta sempre com o `customer_code` do escopo. A ferramenta
 *   não escolhe o cliente nem filtra por ele.
 * - `documento` devolve vazio quando o documento é de outro cliente.
 * - `geral` lê só o que não tem cliente, numa lista fechada, e cada coleção
 *   leva o filtro dela (a medida geral, nunca a de um cliente). O cliente
 *   não lê nada geral.
 *
 * - As coleções com valor (preço, total, fatura) só abrem para quem lê
 *   valor: o leitor de quem não lê recusa antes de consultar.
 *
 * As listas crescem com as ferramentas (partes 5.5c e 5.5d). Coleção fora
 * delas não se lê.
 */

/** As coleções com `customer_code` que as ferramentas leem. */
export const COLECOES_DO_CLIENTE = [
  // Armazenagem
  "client_inventory",
  "client_request_status",
  "customer_requests",
  "movements",
  "client_documents",
  "inbound_receipts",
  "pick_tasks",
  "putaway_tasks",
  "stock_balances",
  "events",
  "ai_stock_age",
  // Operação (sem valor)
  "demands",
  "service_orders",
  // Comercial (com valor: só para quem orça)
  "quotes",
  "price_tables",
  // Financeiro: as faturas da Armazenagem, as da Operação e a cobrança interna
  "client_invoices",
  "client_faturas",
  "faturas",
  // Memória (parte 5.1 e 5.3)
  "ai_measures",
  "ai_case_memory",
  // O próprio agente
  "agent_conversations",
  "agent_messages",
  "ai_agent_notes",
  "ai_agent_playbooks",
  "ai_agent_knowledge",
  "ai_agent_knowledge_chunks",
] as const;
export type ColecaoDoCliente = (typeof COLECOES_DO_CLIENTE)[number];

/** O que não tem cliente, com o filtro obrigatório de cada coleção. */
export const COLECOES_GERAIS = {
  /** A medida geral, que junta os clientes e serve só à equipe (parte 5.1). */
  ai_measures: ["escopo", "==", "geral"],
  /** O catálogo da LPU, sem preço: só os itens ativos. */
  lpu_items: ["ativo", "==", true],
  /** A tabela Padrão Dutelog, a que não é de nenhum cliente. */
  price_tables: ["customer_code", "==", null],
} as const satisfies Record<string, Filtro>;
export type ColecaoGeral = keyof typeof COLECOES_GERAIS;

/** As coleções que guardam valor: só para quem lê valor (`VALOR_ROLES` e o cliente, nos documentos dele). */
export const COLECOES_COM_VALOR: ReadonlyArray<ColecaoDoCliente | ColecaoGeral> = ["quotes", "price_tables", "client_invoices", "client_faturas", "faturas", "ai_case_memory"];

export const OPERADORES = ["==", "in", ">=", ">", "<=", "<", "array-contains"] as const;
export type Operador = (typeof OPERADORES)[number];
export type Filtro = readonly [campo: string, operador: Operador, valor: unknown];

export type Consulta = {
  onde?: readonly Filtro[];
  ordem?: ReadonlyArray<readonly [campo: string, direcao: "asc" | "desc"]>;
  limite: number;
};

/** O maior lote de uma consulta: o do razão de um mês, como no WMS. */
export const LIMITE_DA_CONSULTA = 5000;

export type RegistroLido = Record<string, unknown> & { id: string };

export interface LeitorDoAgente {
  readonly customerCode: string;
  readonly audiencia: AudienciaDoAgente;
  readonly leValor: boolean;
  doCliente(colecao: ColecaoDoCliente, consulta: Consulta): Promise<RegistroLido[]>;
  documento(colecao: ColecaoDoCliente, id: string): Promise<RegistroLido | null>;
  geral(colecao: ColecaoGeral, consulta: Consulta): Promise<RegistroLido[]>;
}

const CAMPO = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function erroDoLeitor(mensagem: string): HttpsError {
  return new HttpsError("internal", `Leitor do Agent Dute: ${mensagem}`);
}

function conferirConsulta(consulta: Consulta): void {
  if (!Number.isInteger(consulta.limite) || consulta.limite < 1 || consulta.limite > LIMITE_DA_CONSULTA) throw erroDoLeitor(`limite fora de 1 a ${LIMITE_DA_CONSULTA}.`);
  for (const [campo, operador] of consulta.onde ?? []) {
    if (!CAMPO.test(campo)) throw erroDoLeitor(`campo inválido (${campo}).`);
    if (campo === "customer_code") throw erroDoLeitor("o cliente vem do escopo, não da ferramenta.");
    if (!(OPERADORES as readonly string[]).includes(operador)) throw erroDoLeitor(`operador inválido (${operador}).`);
  }
  for (const [campo, direcao] of consulta.ordem ?? []) {
    if (!CAMPO.test(campo) || (direcao !== "asc" && direcao !== "desc")) throw erroDoLeitor(`ordem inválida (${campo}).`);
  }
}

function montar(base: Query, consulta: Consulta): Query {
  let query = base;
  for (const [campo, operador, valor] of consulta.onde ?? []) query = query.where(campo, operador, valor);
  for (const [campo, direcao] of consulta.ordem ?? []) query = query.orderBy(campo, direcao);
  return query.limit(consulta.limite);
}

function ehInstante(valor: object): valor is { toDate(): Date } {
  return typeof (valor as { toDate?: unknown }).toDate === "function";
}

/** O valor lido em JSON puro, para o modelo: o instante vira ISO; o que não é dado, some. */
export function valorLimpo(valor: unknown): unknown {
  if (valor === null || typeof valor === "string" || typeof valor === "boolean") return valor;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (Array.isArray(valor)) return valor.map(valorLimpo).filter((item) => item !== undefined);
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "object") {
    if (ehInstante(valor)) return valor.toDate().toISOString();
    if (Object.getPrototypeOf(valor) !== Object.prototype) return undefined;
    const limpo: Record<string, unknown> = {};
    for (const [chave, item] of Object.entries(valor)) {
      const lido = valorLimpo(item);
      if (lido !== undefined) limpo[chave] = lido;
    }
    return limpo;
  }
  return undefined;
}

function registro(id: string, dados: Record<string, unknown>): RegistroLido {
  return { ...(valorLimpo(dados) as Record<string, unknown>), id };
}

/** O leitor do escopo. O banco fica dentro dele: a ferramenta não o alcança. */
export function leitorDoAgente(db: Firestore, escopo: { customerCode: string; audiencia: AudienciaDoAgente; leValor: boolean }): LeitorDoAgente {
  const customerCode = escopo.customerCode.trim();
  if (!customerCode) throw erroDoLeitor("escopo sem cliente.");
  const audiencia = escopo.audiencia;
  const leValor = escopo.leValor === true;
  const conferirValor = (colecao: string) => {
    if (!leValor && (COLECOES_COM_VALOR as readonly string[]).includes(colecao)) throw new HttpsError("permission-denied", "Seu perfil não lê valor.");
  };
  const leitor: LeitorDoAgente = {
    customerCode,
    audiencia,
    leValor,
    async doCliente(colecao, consulta) {
      if (!(COLECOES_DO_CLIENTE as readonly string[]).includes(colecao)) throw erroDoLeitor(`coleção fora da lista (${colecao}).`);
      conferirValor(colecao);
      conferirConsulta(consulta);
      const lidos = await montar(db.collection(colecao).where("customer_code", "==", customerCode), consulta).get();
      // A consulta já leva o cliente; a conferência de novo é a segunda trava.
      return lidos.docs.filter((doc) => doc.get("customer_code") === customerCode).map((doc) => registro(doc.id, doc.data()));
    },
    async documento(colecao, id) {
      if (!(COLECOES_DO_CLIENTE as readonly string[]).includes(colecao)) throw erroDoLeitor(`coleção fora da lista (${colecao}).`);
      conferirValor(colecao);
      const chave = typeof id === "string" ? id.trim() : "";
      if (!chave || chave.length > 200 || chave.includes("/")) return null;
      const lido = await db.collection(colecao).doc(chave).get();
      if (!lido.exists || lido.get("customer_code") !== customerCode) return null;
      return registro(lido.id, lido.data() ?? {});
    },
    async geral(colecao, consulta) {
      if (audiencia !== "equipe") throw new HttpsError("permission-denied", "O cliente não lê o que é geral.");
      const obrigatorio = (COLECOES_GERAIS as Record<string, Filtro>)[colecao];
      if (!obrigatorio) throw erroDoLeitor(`coleção fora da lista (${colecao}).`);
      conferirValor(colecao);
      conferirConsulta(consulta);
      const [campo, operador, valor] = obrigatorio;
      const lidos = await montar(db.collection(colecao).where(campo, operador, valor), consulta).get();
      return lidos.docs.filter((doc) => doc.get(campo) === valor).map((doc) => registro(doc.id, doc.data()));
    },
  };
  return Object.freeze(leitor);
}
