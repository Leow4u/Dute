/**
 * As contas da cobrança vêm do próprio WMS (functions/wms/lib, o compilado):
 * o lado de cada movimento, o mês no horário de São Paulo, o valor da
 * mercadoria, o preço pela tabela do Comercial e as linhas da fatura. A
 * ferramenta só lê os documentos e monta a entrada da conta como a prévia
 * (`loadBillingCalculation`, em functions/wms/src/index.ts).
 *
 * Pré-requisito: `npm --prefix functions/wms ci` e `npm --prefix functions/wms run build`.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIB = path.join(RAIZ, "functions", "wms", "lib");

async function doWms(arquivo) {
  try {
    return await import(pathToFileURL(path.join(LIB, arquivo)).href);
  } catch (erro) {
    throw new Error(`Não consegui carregar functions/wms/lib/${arquivo}. Rode: npm --prefix functions/wms ci e npm --prefix functions/wms run build\n${erro.message}`);
  }
}

const billing = await doWms("billing.js");
const escopo = await doWms("domain/billing-scope.js");
const tabelas = await doWms("domain/billing-price-tables.js");
const catalogo = await doWms("domain/catalog-prices.js");
const clientes = await doWms("domain/customer-scope.js");

export const WMS = {
  AD_VALOREM: billing.BILLING_AUTO_SOURCES.adValorem,
  /** As fontes da Tabela de preços que tiram a quantidade dos movimentos do mês. */
  FONTES_DO_USO: [
    billing.BILLING_AUTO_SOURCES.incomingPieces,
    billing.BILLING_AUTO_SOURCES.outgoingPieces,
    billing.BILLING_AUTO_SOURCES.movementCount,
  ],
  billingCustomerOf: billing.billingCustomerOf,
  calculateBillingPeriod: billing.calculateBillingPeriod,
  competenciaOfInstant: billing.competenciaOfInstant,
  emissionAvailableFrom: billing.emissionAvailableFrom,
  isCompetenciaClosed: billing.isCompetenciaClosed,
  billingDocumentId: escopo.billingDocumentId,
  billingMovementDirection: escopo.billingMovementDirection,
  legacyBillingDocumentId: escopo.legacyBillingDocumentId,
  CATALOG_PRICES: catalogo.CATALOG_PRICES,
  merchandiseValue: catalogo.merchandiseValue,
  COMERCIAL_PRICE_TABLES: tabelas.COMERCIAL_PRICE_TABLES,
  dataBaseDaCompetencia: tabelas.dataBaseDaCompetencia,
  dataBr: tabelas.dataBr,
  precoNaTabela: tabelas.precoNaTabela,
  tabelaDoComercialLida: tabelas.tabelaDoComercialLida,
  CLIENTE_PADRAO: clientes.LEGACY_CUSTOMER_CODE,
};
