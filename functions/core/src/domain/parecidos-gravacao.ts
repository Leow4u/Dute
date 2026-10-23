import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { AI_CASE_MEMORY_COLLECTION, type ItemDoCaso } from "./lembrancas.js";
import { interpretarPedidoDeParecidos, parecidosDoPedido, type CasoLido, type Parecidos } from "./parecidos.js";
import { orcamentoProblem } from "./platform-roles.js";
import type { CoreProfile } from "./profile.js";
import { clienteDaDemanda } from "./sugestao-gravacao.js";

/**
 * Os orçamentos parecidos (docs/plataforma/fase-5-memoria.md, parte 5.3b).
 * `findSimilarQuotes` só lê: a demanda, de onde vem o cliente (nunca do
 * pedido), e as lembranças desse cliente. Quem pede é quem orça, que lê
 * preço. Nada grava, nem no orçamento: a pessoa usa o caso na tela e salva
 * pela callable do Comercial.
 */

const DEMANDS_COLLECTION = "demands";

/** As lembranças lidas por pedido: as mais recentes do cliente. */
export const LEMBRANCAS_LIDAS = 300;

type Registro = Record<string, unknown>;

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

function inteiro(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) ? valor : null;
}

function itemLido(valor: unknown): ItemDoCaso | null {
  if (!valor || typeof valor !== "object") return null;
  const item = valor as Registro;
  const nome = texto(item.item);
  if (!nome) return null;
  return { lpu_item_id: texto(item.lpu_item_id), item: nome, unidade: texto(item.unidade), orcado: texto(item.orcado), realizado: texto(item.realizado) };
}

/** A lembrança como a tela usa; null quando não tem o cliente ou o vetor. */
export function casoLido(snapshot: DocumentSnapshot): CasoLido | null {
  return casoDoRegistro(snapshot.id, snapshot.data());
}

/** A mesma leitura, do registro já lido (o leitor do Agent Dute, parte 5.5d). */
export function casoDoRegistro(id: string, dados: Registro | undefined): CasoLido | null {
  const customerCode = texto(dados?.customer_code);
  if (!dados || !customerCode || !dados.vetor || typeof dados.vetor !== "object") return null;
  const vetor = Object.fromEntries(Object.entries(dados.vetor as Registro).filter((par): par is [string, number] => typeof par[1] === "number" && par[1] > 0));
  return {
    demanda: id,
    customer_code: customerCode,
    titulo: texto(dados.titulo),
    itens: (Array.isArray(dados.itens) ? dados.itens : []).map(itemLido).filter((item): item is ItemDoCaso => item !== null),
    vetor,
    orcado_cents: inteiro(dados.orcado_cents),
    realizado_cents: inteiro(dados.realizado_cents),
    executado_de: texto(dados.executado_de),
    executado_ate: texto(dados.executado_ate),
    os: Array.isArray(dados.os) ? dados.os.map(texto).filter((numero): numero is string => numero !== null) : [],
    minutos_de_trabalho: inteiro(dados.minutos_de_trabalho),
    fechada_em: texto(dados.fechada_em),
  };
}

export async function findSimilarQuotesFor(db: Firestore, caller: CoreProfile, data: unknown): Promise<Parecidos> {
  const problema = orcamentoProblem(caller.role);
  if (problema) throw new HttpsError("permission-denied", problema);
  const pedido = interpretarPedidoDeParecidos(data);
  const customerCode = clienteDaDemanda(await db.collection(DEMANDS_COLLECTION).doc(pedido.demanda).get(), pedido.demanda);
  const lidas = await db.collection(AI_CASE_MEMORY_COLLECTION).where("customer_code", "==", customerCode).orderBy("fechada_em", "desc").limit(LEMBRANCAS_LIDAS).get();
  const casos = lidas.docs.map(casoLido).filter((caso): caso is CasoLido => caso !== null);
  return parecidosDoPedido(pedido, customerCode, casos);
}
