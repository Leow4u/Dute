import { httpsCallable } from "firebase/functions";

import { firebaseApp } from "../firebase";
import { functionsDoApp } from "../firebase-functions";
import { mensagemDoErro } from "../operacao/api";

/**
 * A ação "Guardar" no Estoque (docs/plataforma/recebimento-com-caixas.md,
 * decisão 16 e parte 7e): o saldo parado numa área de passagem volta à
 * prateleira por uma guarda que a coordenação abre. As callables são do WMS
 * (functions/wms): previewAreaPutaway só lê; openAreaPutaway abre a guarda.
 */

export type GuardaDaArea = {
  customer_code: string;
  sku_code: string;
  location_id: string;
  area: "RECEBIMENTO" | "EXPEDICAO";
  product_name: string | null;
  client_item_code: string | null;
  /** O livre do saldo no local: o que está lá menos o reservado. */
  livre: number;
  /** O que as guardas abertas do SKU vão tirar do local. */
  em_guardas_abertas: number;
  /** O que dá para guardar. */
  sem_guarda: number;
};

export type GuardaAberta = {
  ok: true;
  putaway_task_id: string;
  location_id: string;
  quantity: number;
  sem_guarda: number;
};

async function chamarWms<T>(nome: "previewAreaPutaway" | "openAreaPutaway", dados: Record<string, unknown>): Promise<T> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, T>(functionsDoApp(firebaseApp), nome);
  try {
    return (await callable(dados)).data;
  } catch (error) {
    throw new Error(mensagemDoErro(error));
  }
}

export function verGuardaDaArea(input: { customer_code: string; sku_code: string; location_id: string }) {
  return chamarWms<GuardaDaArea>("previewAreaPutaway", input);
}

export function abrirGuardaDaArea(input: {
  customer_code: string;
  sku_code: string;
  location_id: string;
  quantity: number;
  reason: string;
  idempotency_key: string;
}) {
  return chamarWms<GuardaAberta>("openAreaPutaway", input);
}

/**
 * "Abrir a guarda" só com a quantidade, em três casas, acima de zero e até o
 * que está sem guarda, e com o motivo preenchido (o servidor confere de novo
 * e recusa com a frase dele).
 */
export function podeAbrirGuarda(quantidade: number, semGuarda: number, motivo: string): boolean {
  const emTresCasas = Math.round(quantidade * 1000) / 1000;
  return Number.isFinite(quantidade) && emTresCasas > 0 && emTresCasas <= semGuarda && motivo.trim().length >= 3;
}
