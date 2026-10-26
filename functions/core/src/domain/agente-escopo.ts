import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { contractedModulesFrom, leValor, MODULOS_POR_PAPEL, type ContractedModule, type PlatformRole } from "./platform-roles.js";
import type { CoreProfile } from "./profile.js";

/**
 * O escopo do Agent Dute do núcleo (docs/plataforma/fase-5-memoria.md, parte
 * 5.5b): de que cliente e em que módulo a pessoa fala. Vem do servidor, nunca
 * do modelo.
 *
 * O cliente fala do próprio cadastro (`users.customer_code`), nos módulos que
 * contratou. A equipe fala do cliente ativo do app, conferido no cadastro, nos
 * módulos do papel: Armazenagem, Operação e Financeiro só com o cliente
 * contratando; o Comercial vale para todo cliente. O módulo do shell precisa
 * ser um dos da pessoa.
 */

export const MODULOS_DO_AGENTE = ["wms", "operacao", "comercial", "financeiro"] as const;
export type ModuloDoAgente = (typeof MODULOS_DO_AGENTE)[number];

export type AudienciaDoAgente = "cliente" | "equipe";

export type EscopoDoAgente = {
  uid: string;
  role: PlatformRole;
  nome: string | null;
  audiencia: AudienciaDoAgente;
  customerCode: string;
  /** O módulo do shell em que a conversa acontece. */
  modulo: ModuloDoAgente;
  /** Os módulos que a pessoa vê neste cliente: as ferramentas saem deles. */
  modulos: ModuloDoAgente[];
  leValor: boolean;
  /** O modelo de operação do cadastro (`operation_template`): a regra dos dias parado sai dele. */
  modeloDeOperacao: string | null;
};

export const CUSTOMERS_COLLECTION = "customers";
export const CLIENT_ACCESS_COLLECTION = "client_access";

const codigoDoCliente = z
  .string()
  .trim()
  .min(1, "Escolha o cliente.")
  .max(80, "Cliente inválido.")
  .refine((valor) => !valor.includes("/"), "Cliente inválido.");

const PedidoDeEscopo = z.object({
  customer_code: codigoDoCliente.nullish(),
  modulo: z.enum(MODULOS_DO_AGENTE, { errorMap: () => ({ message: "Módulo inválido." }) }),
});

export type PedidoDeEscopo = z.infer<typeof PedidoDeEscopo>;

/** Os campos do escopo no pedido; o resto do pedido é da callable. */
export function interpretarEscopo(data: unknown): PedidoDeEscopo {
  const lido = PedidoDeEscopo.safeParse(data && typeof data === "object" ? data : {});
  if (!lido.success) throw new HttpsError("invalid-argument", lido.error.issues[0]?.message ?? "Pedido inválido.");
  return lido.data;
}

/** Os módulos da pessoa neste cliente, na ordem de MODULOS_DO_AGENTE. */
export function modulosDoEscopo(role: PlatformRole, contratados: readonly ContractedModule[]): ModuloDoAgente[] {
  if (role === "cliente") return MODULOS_DO_AGENTE.filter((modulo) => (contratados as readonly string[]).includes(modulo));
  const doPapel: readonly string[] = MODULOS_POR_PAPEL[role];
  return MODULOS_DO_AGENTE.filter((modulo) => doPapel.includes(modulo) && (modulo === "comercial" || (contratados as readonly string[]).includes(modulo)));
}

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** O cadastro do cliente ativo: existe, é cliente (não prospect) e não está arquivado. */
export async function cadastroDoClienteAtivo(db: Firestore, customerCode: string): Promise<Registro> {
  const lidos = await db.collection(CUSTOMERS_COLLECTION).where("customer_code", "==", customerCode).limit(5).get();
  const cadastros = lidos.docs.map((doc) => doc.data() as Registro);
  if (!cadastros.length) throw new HttpsError("not-found", `O cliente ${customerCode} não está no cadastro.`);
  const ativo = cadastros.find((dados) => dados.archived !== true && texto(dados.stage) !== "prospect");
  if (ativo) return ativo;
  if (cadastros.some((dados) => dados.archived !== true)) throw new HttpsError("failed-precondition", `${customerCode} ainda é prospect.`);
  throw new HttpsError("failed-precondition", `O cliente ${customerCode} está arquivado.`);
}

/**
 * Os módulos contratados e o portal do cliente (`client_access`). Sem o
 * documento valem armazenagem e faturas, com o portal ligado; sem o campo
 * `portal_ativo` (a projeção de antes da pergunta 69), também ligado.
 */
async function acessoDoCliente(db: Firestore, customerCode: string): Promise<{ modulos: ContractedModule[]; portalAtivo: boolean }> {
  const acesso = await db.collection(CLIENT_ACCESS_COLLECTION).doc(customerCode).get();
  return {
    modulos: contractedModulesFrom(acesso.exists ? acesso.get("modules") : undefined),
    portalAtivo: !acesso.exists || acesso.get("portal_ativo") !== false,
  };
}

/** O escopo da conversa: o cliente, o módulo e os módulos da pessoa. Recusa o que não vale. */
export async function escopoDoAgente(db: Firestore, caller: CoreProfile, data: unknown): Promise<EscopoDoAgente> {
  const pedido = interpretarEscopo(data);
  let customerCode: string;
  let cadastro: Registro | null;
  if (caller.role === "cliente") {
    customerCode = caller.customerCode ?? "";
    if (!customerCode) throw new HttpsError("permission-denied", "Login de cliente sem cliente.");
    if (pedido.customer_code && pedido.customer_code !== customerCode) throw new HttpsError("permission-denied", "O cliente fala só do próprio cadastro.");
    // O acesso do cliente já foi conferido no login; o cadastro aqui só dá o modelo.
    cadastro = await cadastroDoClienteAtivo(db, customerCode).catch(() => null);
  } else {
    if (!pedido.customer_code) throw new HttpsError("invalid-argument", "Escolha o cliente.");
    customerCode = pedido.customer_code;
    cadastro = await cadastroDoClienteAtivo(db, customerCode);
  }
  const acesso = await acessoDoCliente(db, customerCode);
  // Arquivar o cliente ou pôr "Sem portal" corta o portal, e o agente é do portal (pergunta 69).
  if (caller.role === "cliente" && !acesso.portalAtivo) throw new HttpsError("permission-denied", "O portal do seu cliente está desligado.");
  const modulos = modulosDoEscopo(caller.role, acesso.modulos);
  if (!modulos.length) throw new HttpsError("permission-denied", "O Agent Dute não tem módulo para você neste cliente.");
  if (!modulos.includes(pedido.modulo)) throw new HttpsError("permission-denied", "O Agent Dute não atende esse módulo para você neste cliente.");
  return {
    uid: caller.uid,
    role: caller.role,
    nome: caller.name ?? null,
    audiencia: caller.role === "cliente" ? "cliente" : "equipe",
    customerCode,
    modulo: pedido.modulo,
    modulos,
    leValor: leValor(caller.role),
    modeloDeOperacao: texto(cadastro?.operation_template) || null,
  };
}
