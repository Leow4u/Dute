import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { parseEntrada } from "./cadastro.js";
import { LPU_ITEMS_COLLECTION, limparTexto, lpuItemDoc, lpuItemId } from "./catalogo.js";
import { CONTRACTS_COLLECTION, ID_DOCUMENTO } from "./contratos.js";
import { CASAS_DO_PRECO, centavosDaLinha, lerDecimal } from "./dinheiro.js";
import { createComercialEvent } from "./events.js";
import { actorPayload, runIdempotent, type ComercialActor } from "./operations.js";
import {
  ErroTabela, MOEDA_DAS_TABELAS, PRICE_TABLES_COLLECTION, PRICE_TABLE_SCHEMA_VERSION,
  chaveDeVigencia, conferirData, conferirVariante, normalizarVariante, planejarVigencia, priceTableId,
  type PrecoDaTabela, type VigenciaDaTabela,
} from "./tabelas.js";

export const MAX_ITENS_DA_TABELA = 480;
const MAX_BYTES_DA_TABELA = 900_000;
const texto = (max: number) => z.string().transform(limparTexto).pipe(z.string().min(1).max(max).refine(v => !/\p{Cc}/u.test(v), "Texto com caractere de controle."));
const data = z.string().refine(v => { try { conferirData(v); return true; } catch { return false; } }, "Data inválida (AAAA-MM-DD).");
const preco = z.string().max(40).superRefine((value, ctx) => {
  try {
    const decimal = lerDecimal(value, CASAS_DO_PRECO, "preço");
    if (decimal.coeficiente < 0n || value.startsWith("-")) throw new Error("Preço não pode ser negativo.");
    centavosDaLinha("1", value);
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : "Preço inválido." });
  }
});

/** Mesmo catálogo e mapa de preços da carga; nenhum preço é escrito no item. */
export const SAVE_CONTRACT_PRICE_TABLE_INPUT = z.object({
  contrato_id: ID_DOCUMENTO,
  nome: texto(120),
  codigo: texto(80).nullable().optional().default(null),
  variante: z.string().default("Comercial").superRefine((value, ctx) => {
    try { conferirVariante(value); } catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message }); }
  }).transform(conferirVariante),
  vigente_de: data.nullable().optional().default(null),
  vigente_ate: data.nullable().optional().default(null),
  itens: z.array(z.object({
    codigo: texto(40), descricao: texto(1000), unidade: texto(20), preco,
    categoria: texto(80).optional(), item: texto(200).optional(), servico: texto(160).optional(),
  }).strict()).min(1).max(MAX_ITENS_DA_TABELA),
  idempotency_key: z.string().trim().min(1).max(200),
}).strict();

export type SaveContractPriceTableInput = z.infer<typeof SAVE_CONTRACT_PRICE_TABLE_INPUT>;
export type SaveContractPriceTableResult = {
  ok: true; tabela_id: string; status: "ativa" | "encerrada"; itens: number;
  itens_novos: number; encerrou: string | null; events: string[];
};

/**
 * Grava uma versão imutável da LPU. A próxima versão só encerra a vigência
 * da anterior; preços e catálogo existentes permanecem intactos.
 */
export async function saveContractPriceTableFor(db: Firestore, actor: ComercialActor, value: unknown) {
  const input = parseEntrada(SAVE_CONTRACT_PRICE_TABLE_INPUT, value);
  const itens = input.itens.map(linha => {
    // O código distingue, por exemplo, desmontagem/transporte/montagem de
    // uma mesma descrição e unidade. Não é usado sozinho como id global.
    const chave = {
      categoria: linha.categoria ?? "Serviços",
      item: linha.item ?? `${linha.descricao.slice(0, 157)} (${linha.codigo})`,
      servico: linha.servico ?? "Prestação de Serviço",
      unidade: linha.unidade,
    };
    return { ...linha, ...chave, id: lpuItemId(chave) };
  });
  if (new Set(itens.map(item => item.id)).size !== itens.length) {
    throw new HttpsError("invalid-argument", "Item repetido na tabela: confira código, categoria, item, serviço e unidade.");
  }
  const precos: Record<string, PrecoDaTabela> = Object.fromEntries(itens.map(item => [item.id, {
    codigo: item.codigo, descricao_cliente: item.descricao, preco: item.preco,
  }]));

  return runIdempotent<SaveContractPriceTableResult>(db, {
    kind: "contract_price_table_save", scope: { contrato_id: input.contrato_id },
    idempotency_key: input.idempotency_key, input, actor,
  }, async (transaction, { operationId }) => {
    const contrato = await transaction.get(db.collection(CONTRACTS_COLLECTION).doc(input.contrato_id));
    if (!contrato.exists) throw new HttpsError("not-found", "Contrato não encontrado.");
    const customerCode = contrato.get("customer_code");
    if (typeof customerCode !== "string" || !customerCode.trim()) throw new HttpsError("failed-precondition", "Contrato sem cliente válido.");
    const identidade = { customer_code: customerCode, contract_id: input.contrato_id, variante: input.variante };
    let vigenteDe: string;
    try { vigenteDe = conferirData(input.vigente_de ?? contrato.get("vigente_de"), "vigente_de"); }
    catch (error) { throw new HttpsError("invalid-argument", (error as Error).message); }
    const chave = chaveDeVigencia(identidade);
    const tabelaId = priceTableId(identidade, vigenteDe);
    const tabelaRef = db.collection(PRICE_TABLES_COLLECTION).doc(tabelaId);
    const [existente, tabelas, catalogo] = await Promise.all([
      transaction.get(tabelaRef),
      transaction.get(db.collection(PRICE_TABLES_COLLECTION).where("chave_vigencia", "==", chave)),
      transaction.getAll(...itens.map(item => db.collection(LPU_ITEMS_COLLECTION).doc(item.id))),
    ]);
    if (existente.exists) throw new HttpsError("already-exists", "Já existe uma tabela deste contrato e variante com o mesmo início. Cadastre uma nova vigência.");
    const vigencias: VigenciaDaTabela[] = tabelas.docs.map(doc => ({
      id: doc.id, customer_code: doc.get("customer_code"), contract_id: doc.get("contract_id"),
      variante: doc.get("variante"), vigente_de: doc.get("vigente_de"), vigente_ate: doc.get("vigente_ate") ?? null,
      status: doc.get("status") === "encerrada" ? "encerrada" : "ativa",
    }));
    let plano: ReturnType<typeof planejarVigencia>;
    try { plano = planejarVigencia({ ...identidade, vigente_de: vigenteDe, vigente_ate: input.vigente_ate }, vigencias); }
    catch (error) {
      if (error instanceof ErroTabela) throw new HttpsError(error.codigo === "VIGENCIA_INVERTIDA" || error.codigo === "DATA_INVALIDA" ? "invalid-argument" : "failed-precondition", error.message);
      throw error;
    }
    const varianteChave = normalizarVariante(input.variante);
    const documento = {
      id: tabelaId, nome: input.nome, codigo: input.codigo, ...identidade,
      variante_chave: varianteChave, chave_vigencia: chave, vigente_de: vigenteDe, vigente_ate: input.vigente_ate,
      status: plano.status, substitui: plano.substitui, rodape: null, condicoes: null, validade_dias: null,
      moeda: MOEDA_DAS_TABELAS, precos, fonte: { tipo: "cadastro_contrato" },
      importado_por: actorPayload(actor), operation_id: operationId, schema_version: PRICE_TABLE_SCHEMA_VERSION,
    };
    if (Buffer.byteLength(JSON.stringify(documento), "utf8") > MAX_BYTES_DA_TABELA) throw new HttpsError("invalid-argument", "A tabela passa do tamanho permitido; divida os itens em outra variante.");
    const novos = itens.filter((_, index) => !catalogo[index].exists);
    for (const item of novos) transaction.create(db.collection(LPU_ITEMS_COLLECTION).doc(item.id), {
      ...lpuItemDoc({ ...item, origem_tabela_id: tabelaId }), created_at: FieldValue.serverTimestamp(),
    });
    if (plano.encerrar) transaction.update(db.collection(PRICE_TABLES_COLLECTION).doc(plano.encerrar.id), {
      status: "encerrada", vigente_ate: plano.encerrar.vigente_ate, encerrada_por: tabelaId, encerrada_em: FieldValue.serverTimestamp(),
    });
    transaction.create(tabelaRef, { ...documento, importado_em: FieldValue.serverTimestamp() });
    const events = [createComercialEvent(transaction, db, {
      operation_id: operationId, type: "price_table.imported", entity_id: tabelaId, customer_code: customerCode,
      payload: { tabela_id: tabelaId, variante: varianteChave, linhas: itens.length, itens_novos: novos.length,
        vigencia_inicio: vigenteDe, vigencia_fim: input.vigente_ate, contrato_id: input.contrato_id, substitui: plano.substitui }, actor,
    }).id];
    if (plano.encerrar) events.push(createComercialEvent(transaction, db, {
      operation_id: operationId, type: "price_table.closed", entity_id: plano.encerrar.id, customer_code: customerCode,
      payload: { tabela_id: plano.encerrar.id, variante: varianteChave, vigencia_fim: plano.encerrar.vigente_ate,
        substituida_por: tabelaId, contrato_id: input.contrato_id }, actor,
    }).id);
    return { target_id: tabelaId, result: { ok: true, tabela_id: tabelaId, status: plano.status, itens: itens.length,
      itens_novos: novos.length, encerrou: plano.encerrar?.id ?? null, events } };
  });
}
