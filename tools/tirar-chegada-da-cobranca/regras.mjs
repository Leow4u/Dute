/**
 * A regra da ferramenta, sem banco: quais movimentos da chegada saem da
 * cobrança, quando recusar, o que gravar e a prévia do mês antes e depois.
 * As contas vêm do WMS em `wms` (wms.mjs), para a prévia daqui ser a da tela.
 *
 * O caminho é o que o WMS já prevê: a prévia e a emissão só contam o
 * movimento sem `billable: false` (`loadBillingCalculation`, em
 * functions/wms/src/index.ts; a régua é billing-callables.integration.test.ts).
 * Marcar a ENTRADA tira as peças e o movimento da conta do mês enquanto o uso
 * não está congelado. A foto do uso nasce na primeira prévia ou emissão
 * depois que o mês termina, e a fatura emitida não muda mais: nos dois casos
 * a ferramenta recusa.
 */

export const FONTE = "script_tirar_chegada_da_cobranca";

const texto = (valor) => (typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "");

/** "2026-11" → "11/2026". */
export function rotuloDoMes(competencia) {
  const [ano, mes] = String(competencia).split("-");
  return ano && mes ? `${mes}/${ano}` : String(competencia);
}

/** A data do movimento como a cobrança lê (`billingDate`, em functions/wms/src/index.ts). */
export function dataDaCobranca(valor) {
  if (typeof valor === "string") return valor;
  if (valor && typeof valor === "object" && typeof valor.toDate === "function") return valor.toDate().toISOString();
  return "";
}

/** O mês do movimento na cobrança, no horário de São Paulo; null sem data. */
function mesDaCobranca(movimento, wms) {
  return wms.competenciaOfInstant(dataDaCobranca(movimento.occurred_at ?? movimento.data));
}

/** As peças do movimento na cobrança: o módulo da quantidade, como o WMS conta. */
export const pecasDe = (movimento) => Math.abs(Number(movimento.qtde ?? movimento.quantity ?? 0));

const somaDasPecas = (movimentos) => movimentos.reduce((soma, movimento) => soma + pecasDe(movimento), 0);

/** Os dígitos da NF sem os zeros da frente: "046143" e "46143" são a mesma nota. */
const digitosDaNf = (valor) => texto(valor).replace(/\D/g, "").replace(/^0+/, "");

export const idDaOperacao = (caso) => `op_billing_exclude_${caso.id}`;
export const idDoEvento = (caso) => `evt_billing_exclude_${caso.id}`;

/**
 * Os movimentos da chegada (pelo id dela ou pelo número), do cliente do caso:
 * - cobrados: o recebimento no mês que a cobrança conta hoje (é o que sai);
 * - jaFora: o recebimento no mês já marcado fora da cobrança;
 * - foraDoMes: o recebimento em outro mês (recusa: o caso é de um mês só);
 * - semCobranca: o resto da chegada (a guarda da caixa), que a cobrança não conta como entrada.
 */
export function movimentosDaChegada(movimentos, caso, recebimento, wms) {
  const achados = { cobrados: [], jaFora: [], foraDoMes: [], semCobranca: [] };
  if (!recebimento) return achados;
  const numero = texto(recebimento.receipt_number);
  for (const movimento of movimentos) {
    if (texto(movimento.customer_code) !== caso.cliente) continue;
    if (texto(movimento.receipt_id) !== recebimento.id && (!numero || texto(movimento.receipt_number) !== numero)) continue;
    if (wms.billingMovementDirection(movimento, { snapshot: false }) !== "incoming") achados.semCobranca.push(movimento);
    else if (mesDaCobranca(movimento, wms) !== caso.competencia) achados.foraDoMes.push(movimento);
    else if (movimento.billable === false) achados.jaFora.push(movimento);
    else achados.cobrados.push(movimento);
  }
  return achados;
}

/**
 * Por que não gravar, ou lista vazia. `periodo` é o `billing_periods` da
 * competência e `foto`, o `billing_operational_snapshots` (null sem documento).
 */
export function recusas({ caso, recebimento, achados, periodo, foto }) {
  const mes = rotuloDoMes(caso.competencia);
  if (!recebimento) return [`A chegada ${caso.chegada} não foi encontrada em inbound_receipts.`];
  const lista = [];
  if (texto(recebimento.customer_code) !== caso.cliente) {
    lista.push(`A chegada ${caso.chegada} é de ${texto(recebimento.customer_code) || "cliente nenhum"}, não da ${caso.cliente}.`);
  }
  if (digitosDaNf(recebimento.invoice_number) !== digitosDaNf(caso.nf)) {
    lista.push(`A chegada ${caso.chegada} é da NF ${texto(recebimento.invoice_number) || "sem número"}; o caso é da NF ${caso.nf}.`);
  }
  const status = texto(periodo?.status) || "aberto";
  if (status !== "aberto" || periodo?.invoice_snapshot) {
    const quando = texto(periodo?.emitido_em);
    lista.push(`A competência ${mes} já foi emitida (${status}${quando ? `, em ${quando}` : ""}): a fatura emitida não muda mais.`);
  }
  if (foto) {
    const quando = dataDaCobranca(foto.frozen_at);
    lista.push(`O uso de ${mes} já está congelado (foto ${texto(foto.mode) || "sem modo"}${quando ? ` de ${quando}` : ""}): marcar os movimentos agora não muda mais a cobrança.`);
  }
  if (achados.foraDoMes.length) {
    const quais = achados.foraDoMes.map((m) => `${m.id} em ${dataDaCobranca(m.occurred_at ?? m.data) || "sem data"}`).join(", ");
    lista.push(`${achados.foraDoMes.length} entrada(s) da chegada ${caso.chegada} fora de ${mes} (${quais}); o caso é só de ${mes}.`);
  }
  const doMes = [...achados.cobrados, ...achados.jaFora];
  if (!doMes.length) {
    lista.push(`A chegada ${caso.chegada} não tem entrada do recebimento em ${mes}.`);
  } else {
    const pecas = somaDasPecas(doMes);
    if (doMes.length !== caso.esperado.movimentos || pecas !== caso.esperado.pecas) {
      lista.push(`A chegada ${caso.chegada} tem ${doMes.length} entrada(s) do recebimento com ${pecas} peças em ${mes}; o caso espera ${caso.esperado.movimentos} com ${caso.esperado.pecas}.`);
    }
  }
  return lista;
}

/** O que a gravação põe em cada movimento que sai: a marca que o WMS lê e o porquê. */
export function marcaDoMovimento(caso, operacaoId) {
  return {
    billable: false,
    billing_exclusion: {
      competencia: caso.competencia,
      chegada: caso.chegada,
      repetiu: caso.repetiu,
      nf: caso.nf,
      motivo: caso.motivo,
      operation_id: operacaoId,
      actor: caso.ator,
    },
  };
}

/** Os movimentos com a marca nos `ids`, para a prévia de depois. */
export function comMarca(movimentos, ids, marca) {
  return movimentos.map((movimento) => (ids.includes(movimento.id) ? { ...movimento, ...marca } : movimento));
}

const resumoDosMovimentos = (achados) =>
  achados.cobrados.map((m) => ({ id: m.id, sku_code: texto(m.sku_code), client_item_code: texto(m.client_item_code), qtde: pecasDe(m) }));

/**
 * O evento da retirada, no molde do `billingAuditEvent` do WMS: da
 * competência (`fatura`), sem valor, porque interno, wms e suporte leem os
 * eventos e não o faturamento. A gravação acrescenta as horas.
 */
export function eventoDaRetirada(caso, achados, operacaoId) {
  const movimentos = resumoDosMovimentos(achados);
  const pecas = movimentos.reduce((soma, m) => soma + m.qtde, 0);
  return {
    id: idDoEvento(caso),
    type: "billing.movements_excluded",
    title: "Entrada fora da cobrança",
    description: `A chegada ${caso.chegada} sai da cobrança de ${rotuloDoMes(caso.competencia)}: ${pecas} peças em ${movimentos.length} movimentos. Ela repetiu a ${caso.repetiu} (NF ${caso.nf}).`,
    severity: "info",
    entity_type: "fatura",
    entity_id: caso.competencia,
    customer_code: caso.cliente,
    payload: {
      competencia: caso.competencia,
      chegada: caso.chegada,
      repetiu: caso.repetiu,
      nf: caso.nf,
      pecas,
      movimentos,
      motivo: caso.motivo,
      operation_id: operacaoId,
    },
    source: FONTE,
    actor: caso.ator,
  };
}

/** O recibo em operational_operations: a chave fixa do caso não deixa gravar duas vezes. */
export function reciboDaRetirada(caso, achados, operacaoId) {
  const movimentos = resumoDosMovimentos(achados);
  return {
    id: operacaoId,
    kind: "billing.exclude_movements",
    target_id: caso.chegada,
    customer_code: caso.cliente,
    competencia: caso.competencia,
    actor: caso.ator,
    result: { movimentos: movimentos.map((m) => m.id), pecas: movimentos.reduce((soma, m) => soma + m.qtde, 0) },
    source: FONTE,
  };
}

/**
 * A entrada da conta da fatura como a prévia do WMS a monta para o mês sem a
 * foto do uso (`loadBillingCalculation`): a Tabela de preços do cliente (o
 * item sem cliente vale para o cliente padrão), o preço do item ligado ao
 * Comercial pela tabela vigente no último dia do mês, as quantidades manuais,
 * a taxa do ad valorem, o valor da mercadoria e o uso do mês, só com o
 * recebimento e a expedição sem `billable: false`.
 *
 * `d`: { competencia, cliente, clientePadrao, precos: [{ id, data }],
 * tabelas: [{ id, data }], manual, config, estoque, precosDoCatalogo,
 * movimentos }, com os documentos que a prévia lê.
 */
/** O que a prévia lê da Tabela de preços: a do cliente padrão, inteira; a dos outros, só a do cliente. */
const precosLidos = (d) => (d.cliente === d.clientePadrao ? d.precos : d.precos.filter(({ data }) => data.customer_code === d.cliente));

/**
 * Os itens da Tabela de preços do cliente, como a prévia os monta, com o
 * `valor_unit` do WMS (antes do preço do Comercial): o item sem cliente vale
 * para o cliente padrão, e o inativo vem com `ativo: false`.
 */
export function tabelaDoCliente(d, wms) {
  return precosLidos(d)
    .filter(({ data }) => wms.billingCustomerOf(data.customer_code, d.clientePadrao) === d.cliente)
    .map(({ id, data }) => ({
      id: data.id ?? id,
      grupo: String(data.grupo ?? "outros"),
      item: String(data.item ?? id),
      unidade: data.unidade == null ? null : String(data.unidade),
      valor_unit: Number(data.valor_unit ?? 0),
      auto_source: typeof data.auto_source === "string" ? data.auto_source : null,
      ordem: Number.isInteger(data.ordem) ? Number(data.ordem) : undefined,
      ativo: data.ativo !== false,
    }));
}

export function entradaDaPrevia(d, wms) {
  const lidos = precosLidos(d);
  const priceList = tabelaDoCliente(d, wms);
  const ligados = new Map(
    lidos.flatMap(({ id, data }) => {
      const lpuItemId = typeof data.lpu_item_id === "string" ? data.lpu_item_id.trim() : "";
      return lpuItemId ? [[String(data.id ?? id), lpuItemId]] : [];
    }),
  );
  const itensLigados = priceList.filter(
    (item) => item.ativo !== false && item.auto_source !== wms.AD_VALOREM && ligados.has(String(item.id)),
  );
  if (itensLigados.length) {
    const tabelas = d.tabelas
      .filter(({ data }) => data.customer_code === d.cliente)
      .flatMap(({ id, data }) => {
        const tabela = wms.tabelaDoComercialLida(id, data);
        return tabela ? [tabela] : [];
      });
    const dataBase = wms.dataBaseDaCompetencia(d.competencia);
    for (const item of itensLigados) {
      const achado = wms.precoNaTabela(tabelas, ligados.get(String(item.id)), dataBase);
      if (achado.tipo === "sem_preco") {
        throw new Error(`O item ${item.item} não tem preço numa tabela do Comercial vigente em ${wms.dataBr(dataBase)}.`);
      }
      if (achado.tipo === "ambiguo") {
        throw new Error(`O item ${item.item} tem preço em mais de uma tabela do Comercial vigente em ${wms.dataBr(dataBase)}.`);
      }
      item.valor_unit = achado.preco;
      item.tabela_id = achado.tabela_id;
    }
  }
  const cobrados = d.movimentos
    .filter((m) => m.customer_code === d.cliente && m.billable !== false && mesDaCobranca(m, wms) === d.competencia)
    .flatMap((m) => {
      const lado = wms.billingMovementDirection(m, { snapshot: false });
      return lado ? [{ lado, pecas: pecasDe(m) }] : [];
    });
  const pecasDoLado = (lado) => cobrados.filter((c) => c.lado === lado).reduce((soma, c) => soma + c.pecas, 0);
  return {
    competencia: d.competencia,
    priceList,
    manualQuantities: Array.isArray(d.manual?.items) ? d.manual.items : [],
    adValoremRate: Number(d.config?.ad_valorem_rate ?? 0.005),
    usage: {
      custo_estoque: wms.merchandiseValue(d.estoque, d.precosDoCatalogo),
      entradas_pecas: pecasDoLado("incoming"),
      saidas_pecas: pecasDoLado("outgoing"),
      movimentacoes: cobrados.length,
    },
  };
}

/** As linhas da fatura que mudam e o total, antes e depois (as saídas de `calculateBillingPeriod`). */
export function diferenca(antes, depois) {
  const depoisPorItem = new Map(depois.linhas.map((linha) => [String(linha.price_list_id), linha]));
  const valores = (linha) => ({ qtde: linha.qtde, valor_unit: linha.valor_unit, total_cents: linha.total_cents });
  const linhas = antes.linhas.flatMap((linha) => {
    const nova = depoisPorItem.get(String(linha.price_list_id));
    if (nova && nova.qtde === linha.qtde && nova.total_cents === linha.total_cents) return [];
    return [{ price_list_id: linha.price_list_id, item: linha.item, antes: valores(linha), depois: nova ? valores(nova) : null }];
  });
  return {
    linhas,
    total_antes_cents: antes.total_cents,
    total_depois_cents: depois.total_cents,
    delta_cents: depois.total_cents - antes.total_cents,
  };
}
