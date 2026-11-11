/**
 * O caminho da correção quando o código certo já existe no cadastro: as peças
 * das caixas passam do SKU errado para o certo, na mesma prateleira, como no
 * acerto de outubro (tools/acerto-btg-2026-10). O código de um SKU não muda.
 *
 * Os passos, cada um com recibo próprio (rodar de novo continua de onde
 * parou, sem repetir):
 *
 * 1. o plano congelado: o que a primeira leitura achou (as caixas, a
 *    quantidade, a prateleira, os dois SKUs), num recibo, para a retomada
 *    não depender do banco já mudado;
 * 2. por prateleira, a SAIDA do SKU errado e a ENTRADA no certo, pelas
 *    funções de domínio do WMS (functions/wms/lib, as mesmas das callables),
 *    com a origem functions_manual_inventory, que não entra na cobrança;
 * 3. as linhas das caixas, das tarefas de guarda e a linha da NF passam para
 *    o SKU certo, numa transação, com o de antes em acerto_codigo e os eventos;
 * 4. o cadastro errado sai, como no "Remover para corrigir" da Contagem
 *    (removeOpeningInventoryLineTransaction, que apaga o cadastro criado por
 *    engano quando o saldo zera): o SKU, o cartão de products, o item do
 *    portal, o preço guardado e os saldos zerados, com o conteúdo inteiro no
 *    recibo. Só quando o SKU nasceu no Receber, ficou sem saldo e sem reserva,
 *    todos os movimentos dele são desta chegada ou desta correção e nada
 *    aberto o usa (chegada a conferir, linha da abertura, pedido do portal).
 *    A linha da NF de chegada cancelada que aponta para ele passa para o
 *    certo, com o de antes em acerto_codigo: o Receber reusa o número que
 *    ela guarda quando o código volta como produto novo (pendingNewSkuFor).
 *    Os movimentos e os eventos ficam: são o histórico e a cobrança;
 * 5. o recibo final.
 */

import { tamanhoDoCodigo } from "../padronizar-nomes/regras.mjs";
import {
  ATOR,
  FONTE,
  STATUS_DA_CAIXA,
  STATUS_DA_CHEGADA,
  arquivado,
  cancelada,
  chaveDoCodigo,
  clienteDe,
  codigoDe,
  conferirCongelamento,
  conferirCorrecao,
  descreverMovimento,
  doCliente,
  fmt,
  idDoEvento,
  idDoRecibo,
  idDoReciboDeMovimento,
  leitorDoBanco,
  linhaViva,
  linhasDe,
  nomeDe,
  num,
  productsComCodigo,
  quando,
  recusar,
  safeDocId,
  skusComCodigo,
  status,
  texto,
} from "./comum.mjs";

const RECEBIMENTO = "RECEBIMENTO";
/** A chave de idempotência de cada movimento: fixa por correção, passo e prateleira. */
export const chaveDoMovimento = (correcao, passo, posicao) => `corrigir-codigo:${correcao.id}:${passo}:${posicao}`;

// --- Puro ----------------------------------------------------------------------------

/** O que sai e entra por prateleira: a quantidade de cada caixa, somada onde ela está. */
export function transferenciasPorPosicao(caixas) {
  const porPosicao = new Map();
  for (const c of caixas) if (c.posicao) porPosicao.set(c.posicao, (porPosicao.get(c.posicao) ?? 0) + num(c.qtde));
  return [...porPosicao.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([posicao, qtde]) => ({ posicao, qtde }));
}

/** As linhas (da caixa ou da tarefa de guarda) com o SKU certo no lugar do errado. */
export function linhasTransferidas(linhas, skuDe, alvo) {
  return linhas.map((linha) =>
    texto(linha?.sku_code) === skuDe
      ? { ...linha, sku_code: alvo.sku, client_item_code: alvo.codigo, product_name: alvo.nome, ...(alvo.tamanho ? { size: alvo.tamanho } : {}) }
      : linha,
  );
}

/** Os SKUs da caixa com o certo no lugar do errado, sem repetir; sem a lista (caixa por guardar), nada muda. */
export function skuCodesTrocados(codigos, skuDe, skuPara) {
  if (!Array.isArray(codigos)) return undefined;
  return [...new Set(codigos.map((c) => (c === skuDe ? skuPara : c)))];
}

const temOSku = (dados, sku) => linhasDe(dados).some((l) => texto(l?.sku_code) === sku) || (Array.isArray(dados?.sku_codes) && dados.sku_codes.includes(sku));

// --- Leitura -------------------------------------------------------------------------

/** O plano, a partir do banco de hoje, com cada condição conferida. Só leitura. */
async function montarPlano(leitor, db, correcao) {
  const cliente = texto(correcao.cliente);
  const de = texto(correcao.de);
  const para = texto(correcao.para);
  const kDe = chaveDoCodigo(de);
  await conferirCongelamento(leitor, db);

  const alvos = (await skusComCodigo(leitor, db, para, cliente)).filter((d) => !arquivado(d.data()));
  if (alvos.length !== 1) recusar(`${alvos.length} SKUs ativos com ${para} (${alvos.map((d) => d.id).join(", ") || "nenhum"}); a transferência precisa de exatamente 1`);
  const alvoDados = alvos[0].data();
  const alvo = { sku: alvos[0].id, codigo: codigoDe(alvoDados) || para, nome: nomeDe(alvoDados), tamanho: texto(alvoDados.tamanho || alvoDados.size) || tamanhoDoCodigo(para) || "" };

  const pedidas = [...new Set(correcao.caixas.map((c) => texto(c).toUpperCase()))];
  const caixas = [];
  for (const codigo of pedidas) {
    const snap = await leitor.get(db.collection("warehouse_boxes").doc(codigo));
    if (!snap.exists) recusar(`a caixa ${codigo} não existe`);
    const dados = snap.data();
    if (clienteDe(dados) !== cliente) recusar(`a caixa ${codigo} é de ${clienteDe(dados)}, não de ${cliente}`);
    const origem = dados.origin ?? {};
    if (origem.kind !== "receipt" || !texto(origem.receipt_id)) recusar(`a caixa ${codigo} não veio do Receber (origem ${texto(origem.kind) || "vazia"}); esta ferramenta só corrige caixa de chegada`);
    if (!["counting", "reviewed", "committing", "stored"].includes(texto(dados.status))) recusar(`a caixa ${codigo} está ${status(STATUS_DA_CAIXA, dados.status)}`);
    const comDe = linhasDe(dados).filter((l) => chaveDoCodigo(l.client_item_code) === kDe);
    if (comDe.length !== 1) {
      const linhas = linhasDe(dados).map((l) => `${texto(l.client_item_code)} ${fmt(num(l.counted_qty))}`).join(", ") || "nenhuma";
      recusar(`a caixa ${codigo} tem ${comDe.length} linha(s) com ${de}; precisa de exatamente 1 (linhas: ${linhas})`);
    }
    if (linhasDe(dados).some((l) => texto(l.sku_code) === alvo.sku)) recusar(`a caixa ${codigo} já tem uma linha de ${para} (${alvo.sku}); juntar as duas linhas não é desta ferramenta`);
    caixas.push({ codigo, dados, linha: comDe[0] });
  }
  const chegadas = [...new Set(caixas.map((c) => texto(c.dados.origin.receipt_id)))];
  if (chegadas.length !== 1) recusar(`as caixas são de chegadas diferentes (${chegadas.join(", ")})`);
  const receiptId = chegadas[0];
  const skusDe = [...new Set(caixas.map((c) => texto(c.linha.sku_code)))];
  if (skusDe.length !== 1 || !skusDe[0]) recusar(`as linhas de ${de} apontam para SKUs diferentes (${skusDe.join(", ") || "nenhum"})`);
  const skuDe = skusDe[0];
  if (skuDe === alvo.sku) recusar(`a linha de ${de} já aponta para ${alvo.sku}`);
  for (const c of caixas) {
    if ((Array.isArray(c.dados.taken_lines) ? c.dados.taken_lines : []).some((t) => texto(t?.sku_code) === skuDe)) recusar(`a separação já tirou ${de} da caixa ${c.codigo}`);
  }

  const chegadaSnap = await leitor.get(db.collection("inbound_receipts").doc(receiptId));
  if (!chegadaSnap.exists) recusar(`a chegada ${receiptId} das caixas não existe`);
  const chegada = chegadaSnap.data();
  if (clienteDe(chegada) !== cliente) recusar(`a chegada ${receiptId} é de ${clienteDe(chegada)}`);
  if (cancelada(chegada)) recusar(`a chegada ${texto(chegada.receipt_number) || receiptId} está cancelada`);
  const recebida = texto(chegada.status) === "received";

  const skuSnap = await leitor.get(db.collection("skus").doc(skuDe));
  if (!skuSnap.exists) recusar(`o SKU ${skuDe} da linha da caixa não está no cadastro`);
  const sku = skuSnap.data();
  if (clienteDe(sku) !== cliente) recusar(`o SKU ${skuDe} é de ${clienteDe(sku)}`);
  if (arquivado(sku)) recusar(`o SKU ${skuDe} está arquivado`);
  if (chaveDoCodigo(codigoDe(sku)) !== kDe) recusar(`o SKU ${skuDe} tem o código "${codigoDe(sku)}" no cadastro, não ${de}`);

  // A linha da NF desta chegada com o SKU errado, a mesma das caixas.
  const itens = doCliente((await leitor.get(db.collection("inbound_items").where("receipt_id", "==", receiptId))).docs, cliente).filter((d) => texto(d.data().sku_code) === skuDe);
  if (itens.length !== 1) recusar(`${itens.length} linha(s) da NF da chegada com o SKU ${skuDe}; esperava 1`);
  const itemNf = itens[0];
  if (chaveDoCodigo(itemNf.data().client_item_code) !== kDe) recusar(`a linha da NF (${itemNf.id}) tem "${texto(itemNf.data().client_item_code)}", não ${de}`);
  for (const c of caixas) {
    if (texto(c.linha.inbound_item_id) !== itemNf.id) recusar(`a linha de ${de} da caixa ${c.codigo} aponta para outra linha da NF (${texto(c.linha.inbound_item_id) || "nenhuma"})`);
  }
  // Toda caixa da chegada com o SKU errado entra: a linha da NF muda para todas.
  const daChegada = (await leitor.get(db.collection("warehouse_boxes").where("origin.receipt_id", "==", receiptId))).docs.filter((d) => !cancelada(d.data()) && temOSku(d.data(), skuDe));
  const deFora = daChegada.map((d) => d.id).filter((codigo) => !pedidas.includes(codigo)).sort();
  if (deFora.length) recusar(`o SKU ${skuDe} também está na(s) caixa(s) ${deFora.join(", ")} desta chegada: confira com quem conferiu e ponha na correção (caixas)`);

  // Onde está o saldo de cada caixa: na prateleira da caixa guardada; no RECEBIMENTO com a entrada feita; antes dela, em lugar nenhum.
  const comPosicao = caixas.map((c) => {
    const guardada = texto(c.dados.status) === "stored";
    const posicao = guardada ? texto(c.dados.location_id).toUpperCase() : recebida ? RECEBIMENTO : null;
    if (guardada && !posicao) recusar(`a caixa ${c.codigo} está guardada sem prateleira`);
    return { codigo: c.codigo, qtde: num(c.linha.counted_qty), posicao };
  });
  const transferencias = transferenciasPorPosicao(comPosicao);
  const saldos = doCliente((await leitor.get(db.collection("stock_balances").where("sku_code", "==", skuDe))).docs, cliente);
  for (const t of transferencias) {
    const aqui = saldos.filter((d) => texto(d.data().location_id).toUpperCase() === t.posicao);
    const livre = aqui.reduce((s, d) => s + num(d.data().qty_on_hand) - num(d.data().qty_reserved), 0);
    if (livre < t.qtde) recusar(`o SKU ${skuDe} tem ${fmt(livre)} livre em ${t.posicao}, e as caixas pedem ${fmt(t.qtde)} (reservado: ${fmt(aqui.reduce((s, d) => s + num(d.data().qty_reserved), 0))})`);
  }
  const item = itemNf.data();
  return {
    modo: "transferencia",
    cliente,
    de,
    para,
    sku_de: skuDe,
    nome_de: nomeDe(sku),
    sku_de_nasceu_em: texto(sku.source_receipt_id) || null,
    alvo,
    receipt_id: receiptId,
    receipt_number: texto(chegada.receipt_number) || receiptId,
    invoice_number: texto(chegada.invoice_number) || null,
    item_nf: { id: itemNf.id, line_number: num(item.line_number), client_item_code: texto(item.client_item_code), product_name: texto(item.product_name) },
    caixas: comPosicao,
    transferencias,
    custo_unit: num(item.unit_cost) > 0 ? num(item.unit_cost) : null,
  };
}

/** O que já foi feito de cada passo, pelos recibos. */
async function situacaoDosPassos(leitor, db, correcao, plano) {
  const feito = async (id) => (await leitor.get(db.collection("operational_operations").doc(id))).exists;
  const movimentos = [];
  for (const t of plano.transferencias) {
    movimentos.push({
      ...t,
      saida: await feito(idDoReciboDeMovimento(plano.cliente, chaveDoMovimento(correcao, "saida", t.posicao))),
      entrada: await feito(idDoReciboDeMovimento(plano.cliente, chaveDoMovimento(correcao, "entrada", t.posicao))),
    });
  }
  return { movimentos, caixa: await feito(idDoRecibo(correcao, "caixa")), apagar: await feito(idDoRecibo(correcao, "apagar")) };
}

/**
 * O cadastro errado pode sair? Nasceu no Receber; sem saldo (o de hoje menos
 * o que ainda vai sair) e sem reserva; todo movimento dele é a entrada ou a
 * guarda desta chegada, ou a saída desta correção; e nada aberto o usa:
 * chegada a conferir, caixa de outra chegada, linha da abertura viva,
 * solicitação do portal em aberto.
 */
async function conferirRemocao(leitor, db, correcao, plano, passos) {
  const { cliente, sku_de: skuDe } = plano;
  const motivos = [];
  const skuSnap = await leitor.get(db.collection("skus").doc(skuDe));
  if (!skuSnap.exists) return { apaga: false, motivos: ["o SKU não está mais no cadastro"] };
  if (texto(skuSnap.data().source) !== "wms_unplanned_receipt") motivos.push(`nasceu por ${texto(skuSnap.data().source) || "outra origem"}, não pelo Receber`);
  const saldos = doCliente((await leitor.get(db.collection("stock_balances").where("sku_code", "==", skuDe))).docs, cliente);
  const aSair = passos.movimentos.filter((m) => !m.saida).reduce((s, m) => s + m.qtde, 0);
  const saldo = saldos.reduce((s, d) => s + num(d.data().qty_on_hand), 0) - aSair;
  const reservado = saldos.reduce((s, d) => s + num(d.data().qty_reserved), 0);
  if (saldo > 0) motivos.push(`fica com ${fmt(saldo)} (${saldos.filter((d) => num(d.data().qty_on_hand) > 0).map((d) => `${texto(d.data().location_id)} ${fmt(num(d.data().qty_on_hand))}`).join(", ")} hoje)`);
  if (reservado > 0) motivos.push(`tem ${fmt(reservado)} reservado`);
  const saidasDaCorrecao = new Set(plano.transferencias.map((t) => idDoReciboDeMovimento(cliente, chaveDoMovimento(correcao, "saida", t.posicao))));
  const movimentos = doCliente((await leitor.get(db.collection("movements").where("sku_code", "==", skuDe))).docs, cliente);
  const deFora = movimentos.filter((d) => {
    const m = d.data();
    if (["wms_receiving", "wms_putaway"].includes(texto(m.source)) && texto(m.receipt_id) === plano.receipt_id) return false;
    return !(texto(m.source) === "functions_manual_inventory" && saidasDaCorrecao.has(texto(m.operational_operation_id)));
  });
  if (deFora.length) motivos.push(`teve ${deFora.length} movimento(s) fora desta chegada (${deFora.slice(0, 3).map((d) => descreverMovimento(d.data())).join("; ")}): pode ter sido produto de verdade`);
  // As linhas da NF com o SKU: a da chegada aberta trava; a da chegada cancelada passa para o certo junto,
  // porque o Receber reusa o número que ela guarda (pendingNewSkuFor) quando o código volta como produto novo.
  const itens = doCliente((await leitor.get(db.collection("inbound_items").where("sku_code", "==", skuDe))).docs, cliente).filter((d) => !(d.id === plano.item_nf.id && !passos.caixa));
  const chegadasAbertas = [];
  const chegadasComEntrada = [];
  const itensCancelados = [];
  for (const receiptId of new Set(itens.map((d) => texto(d.data().receipt_id)))) {
    const chegada = await leitor.get(db.collection("inbound_receipts").doc(receiptId));
    const numero = (chegada.exists && texto(chegada.data().receipt_number)) || receiptId;
    if (!chegada.exists || cancelada(chegada.data())) {
      for (const d of itens.filter((i) => texto(i.data().receipt_id) === receiptId)) itensCancelados.push({ id: d.id, receipt_number: numero, line_number: num(d.data().line_number) });
    } else if (["created", "checking"].includes(texto(chegada.data().status))) chegadasAbertas.push(numero);
    else chegadasComEntrada.push(numero);
  }
  if (chegadasAbertas.length) motivos.push(`está na chegada ${chegadasAbertas.join(", ")}, ainda sem entrada (cancele ou corrija a chegada antes)`);
  if (chegadasComEntrada.length) motivos.push(`está na chegada ${chegadasComEntrada.join(", ")}, que já teve entrada`);
  const pedidas = new Set(plano.caixas.map((c) => c.codigo));
  const caixas = (await leitor.get(db.collection("warehouse_boxes").where("sku_codes", "array-contains", skuDe))).docs.filter((d) => !cancelada(d.data()) && !(pedidas.has(d.id) && !passos.caixa));
  if (caixas.length) motivos.push(`está na(s) caixa(s) ${caixas.map((d) => d.id).join(", ")}`);
  const abertura = doCliente((await leitor.get(db.collection("opening_inventory_lines").where("sku_code", "==", skuDe))).docs, cliente).filter((d) => linhaViva(d.data()));
  if (abertura.length) motivos.push(`tem ${abertura.length} linha(s) da abertura`);
  const pedidos = (await leitor.get(db.collection("customer_requests").where("customer_code", "==", cliente).where("status", "==", "open"))).docs.filter((d) =>
    (Array.isArray(d.data().items) ? d.data().items : []).some((i) => texto(i?.sku_code) === skuDe),
  );
  if (pedidos.length) motivos.push(`está na solicitação do portal ${pedidos.map((d) => texto(d.data().request_number) || d.id).join(", ")}, em aberto`);
  return { apaga: motivos.length === 0, motivos, itensCancelados };
}

/**
 * Lê a transferência sem gravar: o plano (o congelado, se a aplicação já
 * começou), o que cada passo já fez, se o cadastro errado vai sair e, com
 * `info`, o diagnóstico para o dry-run.
 */
export async function lerTransferencia(leitor, db, correcao, { info = false } = {}) {
  conferirCorrecao(correcao, tamanhoDoCodigo);
  const final = await leitor.get(db.collection("operational_operations").doc(idDoRecibo(correcao)));
  const congelado = await leitor.get(db.collection("operational_operations").doc(idDoRecibo(correcao, "plano")));
  if (final.exists) {
    const feita = [`recibo ${final.id} de ${quando(final.data().created_at) || "antes"}`];
    // A correção feita sem apagar o cadastro errado (a chegada aberta travava, por exemplo) termina depois, quando ele fica livre.
    if (final.data().result?.apagado !== false || !congelado.exists) return { jaAplicado: true, recibo: final.data(), estado: feita };
    const plano = congelado.data().result;
    const passos = await situacaoDosPassos(leitor, db, correcao, plano);
    const remocao = await conferirRemocao(leitor, db, correcao, plano, passos);
    if (!remocao.apaga) return { jaAplicado: true, recibo: final.data(), estado: [...feita, `o cadastro errado ${plano.sku_de} ficou: ${remocao.motivos.join("; ")}`] };
    return { jaAplicado: false, soRemocao: true, congelado: true, plano, passos, remocao, estado: info ? await diagnostico(leitor, db, plano, passos) : [] };
  }
  const plano = congelado.exists ? congelado.data().result : await montarPlano(leitor, db, correcao);
  const passos = await situacaoDosPassos(leitor, db, correcao, plano);
  const remocao = passos.apagar ? { apaga: true, motivos: [], feito: true } : await conferirRemocao(leitor, db, correcao, plano, passos);
  return { jaAplicado: false, congelado: congelado.exists, plano, passos, remocao, estado: info ? await diagnostico(leitor, db, plano, passos) : [] };
}

async function diagnostico(leitor, db, plano, passos) {
  const { cliente, sku_de: skuDe, alvo } = plano;
  const saldosDe = (sku) => leitor.get(db.collection("stock_balances").where("sku_code", "==", sku)).then((s) => doCliente(s.docs, cliente));
  const descreverSaldos = (docs) => docs.filter((d) => num(d.data().qty_on_hand) || num(d.data().qty_reserved)).map((d) => `${texto(d.data().location_id)} ${fmt(num(d.data().qty_on_hand))}${num(d.data().qty_reserved) ? ` (reservado ${fmt(num(d.data().qty_reserved))})` : ""}`).join(", ") || "nenhum";
  const [saldosErrado, saldosCerto, movimentos] = await Promise.all([
    saldosDe(skuDe),
    saldosDe(alvo.sku),
    leitor.get(db.collection("movements").where("sku_code", "==", skuDe)).then((s) => doCliente(s.docs, cliente)),
  ]);
  const nomeDaChegada = async (receiptId) => {
    if (!receiptId) return null;
    const snap = await leitor.get(db.collection("inbound_receipts").doc(receiptId));
    if (!snap.exists) return `${receiptId} (não existe mais)`;
    const d = snap.data();
    return `${texto(d.receipt_number) || receiptId}${texto(d.invoice_number) ? ` (NF ${texto(d.invoice_number)})` : ""}, ${status(STATUS_DA_CHEGADA, d.status)}${quando(d.created_at) ? `, criada em ${quando(d.created_at)}` : ""}`;
  };
  const porChegada = new Map();
  for (const d of movimentos) {
    const chave = texto(d.data().receipt_id) || "(sem chegada)";
    porChegada.set(chave, [...(porChegada.get(chave) ?? []), d.data()]);
  }
  const linhasDeMovimento = [];
  for (const [receiptId, lista] of porChegada) {
    const nome = receiptId === "(sem chegada)" ? "fora de chegada" : receiptId === plano.receipt_id ? `da chegada ${plano.receipt_number}` : `da chegada ${(await nomeDaChegada(receiptId)) ?? receiptId}`;
    linhasDeMovimento.push(`${lista.length} ${nome}: ${lista.slice(0, 4).map(descreverMovimento).join("; ")}${lista.length > 4 ? "; …" : ""}`);
  }
  const caixasHoje = [];
  for (const c of plano.caixas) {
    const snap = await leitor.get(db.collection("warehouse_boxes").doc(c.codigo));
    const d = snap.exists ? snap.data() : {};
    caixasHoje.push(`${c.codigo} · ${status(STATUS_DA_CAIXA, d.status)}${texto(d.location_id) ? ` em ${texto(d.location_id)}` : ""} · ${fmt(linhasDe(d).length)} produto(s) · ${plano.de}: ${fmt(c.qtde)} un.${texto(d.label_printed_at) ? ` · etiqueta impressa ${quando(d.label_printed_at)}` : ""}`);
  }
  const avisos = (await leitor.get(db.collection("events").where("entity_id", "==", plano.receipt_id))).docs.filter((d) => texto(d.data().type) === "inventory.arrival_stored");
  const nasceu = plano.sku_de_nasceu_em === plano.receipt_id ? `nesta chegada (${plano.receipt_number})` : plano.sku_de_nasceu_em ? `na chegada ${await nomeDaChegada(plano.sku_de_nasceu_em)}` : "fora do Receber";
  return [
    `SKU errado ${skuDe} · ${plano.de} · "${plano.nome_de}" · nasceu ${nasceu} · saldo: ${descreverSaldos(saldosErrado)}`,
    `movimentos do ${skuDe}: ${linhasDeMovimento.join(" · ") || "nenhum"}`,
    `SKU certo ${alvo.sku} · ${alvo.codigo} · "${alvo.nome}"${alvo.tamanho ? ` · tamanho ${alvo.tamanho}` : ""} · saldo: ${descreverSaldos(saldosCerto)}`,
    `chegada ${plano.receipt_number}${plano.invoice_number ? ` · NF ${plano.invoice_number}` : ""} · linha ${plano.item_nf.line_number} da NF: ${plano.item_nf.client_item_code} · "${plano.item_nf.product_name}"${plano.custo_unit ? " · com custo unitário" : ""}`,
    ...caixasHoje,
    avisos.length ? `aviso de chegada ao cliente: gravado ${quando(avisos[0].data().occurred_at)}, com ${plano.de} (a correção não reenvia)` : "aviso de chegada ao cliente: ainda não saiu (sai na última guarda, já com o código certo)",
    ...(passos.movimentos.some((m) => m.saida || m.entrada) || passos.caixa ? ["a aplicação já começou: os passos feitos aparecem como feitos, e o plano é o congelado no recibo"] : []),
  ];
}

/** O que cada passo grava, para o dry-run. */
export function descreverPassos(leitura) {
  const { plano, passos, remocao } = leitura;
  const linhas = [];
  for (const m of passos.movimentos) {
    linhas.push({ feito: m.saida, texto: `SAIDA ${fmt(m.qtde)} de ${plano.sku_de} (${plano.de}) em ${m.posicao} · Ajuste −, não cobra` });
    linhas.push({ feito: m.entrada, texto: `ENTRADA ${fmt(m.qtde)} em ${plano.alvo.sku} (${plano.alvo.codigo}) em ${m.posicao} · Ajuste +, não cobra` });
  }
  if (!passos.movimentos.length) linhas.push({ feito: false, texto: "nenhum movimento: a chegada ainda não teve entrada, e a entrada já sai no SKU certo" });
  for (const c of plano.caixas) linhas.push({ feito: passos.caixa, texto: `${c.codigo}: a linha de ${fmt(c.qtde)} un. passa para ${plano.alvo.sku} · ${plano.alvo.codigo} · "${plano.alvo.nome}" (a etiqueta impressa fica velha)` });
  linhas.push({ feito: passos.caixa, texto: `tarefas de guarda das caixas e linha ${plano.item_nf.line_number} da NF: SKU, código e nome do certo, com o de antes em acerto_codigo` });
  linhas.push(
    remocao.apaga
      ? { feito: Boolean(remocao.feito), texto: `apaga o cadastro errado ${plano.sku_de} (${plano.de}): o SKU, o cartão de products, o item do portal, o preço guardado e os saldos zerados, com tudo no recibo${remocao.itensCancelados?.length ? `; a linha ${remocao.itensCancelados.map((i) => `${i.line_number} da chegada cancelada ${i.receipt_number}`).join(", ")} passa para ${plano.alvo.sku}, para o número ${plano.sku_de} não voltar` : ""}` }
      : { feito: false, texto: `não apaga ${plano.sku_de}: ${remocao.motivos.join("; ")}` },
  );
  return linhas;
}

// --- Aplicação -----------------------------------------------------------------------

async function congelarPlano(db, FieldValue, correcao, plano) {
  const ref = db.collection("operational_operations").doc(idDoRecibo(correcao, "plano"));
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return;
    tx.create(ref, { id: ref.id, kind: "corrigir_codigo.plano", target_id: plano.sku_de, customer_code: plano.cliente, actor: ATOR, result: plano, source: FONTE, created_at: FieldValue.serverTimestamp() });
  });
}

/**
 * O movimento pelo domínio do WMS. O evento dele é "attention" e pode abrir
 * aviso na caixa de entrada antiga do agente: a correção é a própria revisão,
 * então o aviso já fica resolvido, como no acerto de outubro.
 */
async function movimento(db, FieldValue, operations, correcao, plano, passo, posicao, qtde) {
  const chave = chaveDoMovimento(correcao, passo, posicao);
  if ((await db.collection("operational_operations").doc(idDoReciboDeMovimento(plano.cliente, chave)).get()).exists) return { feito: true };
  const doPasso = passo === "saida" ? { type: "SAIDA", sku_code: plano.sku_de, client_item_code: plano.de, product_name: plano.nome_de } : { type: "ENTRADA", sku_code: plano.alvo.sku, client_item_code: plano.alvo.codigo, product_name: plano.alvo.nome };
  const resultado = await operations.createInventoryMovementTransaction(
    db,
    {
      ...doPasso,
      quantity: qtde,
      customer_code: plano.cliente,
      location_id: posicao,
      reason: `${correcao.motivo} (correção ${correcao.id})`,
      reference: correcao.referencia,
      ...(plano.custo_unit ? { unit_cost: plano.custo_unit } : {}),
      idempotency_key: chave,
    },
    ATOR,
  );
  for (const evento of Array.isArray(resultado?.events) ? resultado.events : []) {
    const id = texto(evento?.id);
    if (!id) continue;
    const ref = db.collection("ai_agent_inbox").doc(`inbox_${safeDocId(id)}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || texto(snap.data().status) !== "open") return;
      tx.update(ref, { status: "resolved", resolved_by: { uid: ATOR.uid, email: ATOR.email, name: ATOR.name, role: ATOR.role }, resolved_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(), resolution: `${correcao.id}: movimento da correção de código` });
    });
  }
  return resultado;
}

/** As linhas das caixas, das tarefas de guarda e da NF passam para o SKU certo, numa transação. */
async function corrigirCaixas(db, FieldValue, correcao, plano) {
  const reciboRef = db.collection("operational_operations").doc(idDoRecibo(correcao, "caixa"));
  const ts = () => FieldValue.serverTimestamp();
  const agora = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    if ((await tx.get(reciboRef)).exists) return { feito: true };
    const caixaRefs = plano.caixas.map((c) => db.collection("warehouse_boxes").doc(c.codigo));
    const itemRef = db.collection("inbound_items").doc(plano.item_nf.id);
    const [caixas, tarefas, item] = await Promise.all([
      Promise.all(caixaRefs.map((ref) => tx.get(ref))),
      tx.get(db.collection("putaway_tasks").where("receipt_id", "==", plano.receipt_id)),
      tx.get(itemRef),
    ]);
    for (const snap of caixas) {
      if (!snap.exists) recusar(`a caixa ${snap.id} sumiu no meio da correção`);
      if (!temOSku(snap.data(), plano.sku_de)) recusar(`a caixa ${snap.id} não tem mais o ${plano.sku_de}: confira antes de seguir`);
    }
    if (!item.exists || texto(item.data().sku_code) !== plano.sku_de) recusar(`a linha da NF ${plano.item_nf.id} não aponta mais para ${plano.sku_de}: confira antes de seguir`);
    for (const snap of caixas) {
      const d = snap.data();
      const linha = linhasDe(d).find((l) => texto(l?.sku_code) === plano.sku_de) ?? {};
      const codigos = skuCodesTrocados(d.sku_codes, plano.sku_de, plano.alvo.sku);
      tx.update(snap.ref, {
        lines: linhasTransferidas(linhasDe(d), plano.sku_de, plano.alvo),
        ...(codigos ? { sku_codes: codigos } : {}),
        conference_revision: num(d.conference_revision) + 1,
        acerto_codigo: { op: correcao.id, antes: { inbound_item_id: texto(linha.inbound_item_id), sku_code: plano.sku_de, client_item_code: texto(linha.client_item_code), product_name: texto(linha.product_name) }, at: agora },
        updated_at: ts(),
      });
      const ref = db.collection("events").doc(idDoEvento(correcao, "warehouse.box_content_corrected", snap.id));
      tx.create(ref, {
        id: ref.id,
        type: "warehouse.box_content_corrected",
        title: `Conteúdo da caixa ${snap.id} corrigido`,
        description: `${plano.de} (${plano.sku_de}) → ${plano.alvo.codigo} (${plano.alvo.sku}) · ${fmt(num(linha.counted_qty))} un. · reimprimir a etiqueta`,
        severity: "info",
        entity_type: "warehouse_box",
        entity_id: snap.id,
        customer_code: plano.cliente,
        payload: { box_code: snap.id, receipt_id: plano.receipt_id, antes: { sku_code: plano.sku_de, client_item_code: texto(linha.client_item_code), product_name: texto(linha.product_name) }, depois: { sku_code: plano.alvo.sku, client_item_code: plano.alvo.codigo, product_name: plano.alvo.nome }, correcao: correcao.id, referencia: correcao.referencia, motivo: correcao.motivo, decisao: correcao.decisao },
        occurred_at: agora,
        source: FONTE,
        actor: ATOR,
        created_at: ts(),
      });
    }
    for (const snap of tarefas.docs) {
      const d = snap.data();
      if (!temOSku(d, plano.sku_de) && texto(d.sku_code) !== plano.sku_de) continue;
      const codigos = skuCodesTrocados(d.sku_codes, plano.sku_de, plano.alvo.sku);
      tx.update(snap.ref, {
        ...(linhasDe(d).length ? { lines: linhasTransferidas(linhasDe(d), plano.sku_de, plano.alvo) } : {}),
        ...(codigos ? { sku_codes: codigos } : {}),
        ...(texto(d.sku_code) === plano.sku_de ? { sku_code: plano.alvo.sku, client_item_code: plano.alvo.codigo, product_name: plano.alvo.nome } : {}),
        updated_at: ts(),
      });
    }
    const antes = { sku_code: texto(item.data().sku_code), client_item_code: texto(item.data().client_item_code), product_name: texto(item.data().product_name) };
    tx.update(itemRef, {
      sku_code: plano.alvo.sku,
      client_item_code: plano.alvo.codigo,
      product_name: plano.alvo.nome,
      ...(plano.alvo.tamanho ? { size: plano.alvo.tamanho } : {}),
      acerto_codigo: { op: correcao.id, antes, at: agora },
      updated_at: ts(),
    });
    const eventoRef = db.collection("events").doc(idDoEvento(correcao, "inbound.item_corrected", plano.receipt_id));
    tx.create(eventoRef, {
      id: eventoRef.id,
      type: "inbound.item_corrected",
      title: `Linha ${plano.item_nf.line_number} da chegada ${plano.receipt_number} corrigida`,
      description: `${antes.client_item_code} (${antes.sku_code}) → ${plano.alvo.codigo} (${plano.alvo.sku}) · "${antes.product_name}" → "${plano.alvo.nome}"`,
      severity: "info",
      entity_type: "recebimento",
      entity_id: plano.receipt_id,
      customer_code: plano.cliente,
      payload: { receipt_id: plano.receipt_id, receipt_number: plano.receipt_number, inbound_item_id: plano.item_nf.id, antes, depois: { sku_code: plano.alvo.sku, client_item_code: plano.alvo.codigo, product_name: plano.alvo.nome }, correcao: correcao.id, referencia: correcao.referencia, motivo: correcao.motivo, decisao: correcao.decisao },
      occurred_at: agora,
      source: FONTE,
      actor: ATOR,
      created_at: ts(),
    });
    tx.create(reciboRef, { id: reciboRef.id, kind: "corrigir_codigo.caixa", target_id: plano.sku_de, customer_code: plano.cliente, actor: ATOR, result: { caixas: plano.caixas.map((c) => c.codigo), linha_da_nf: plano.item_nf.id, para: plano.alvo.sku }, source: FONTE, created_at: ts() });
    return { feito: false };
  });
}

/**
 * Apaga o cadastro errado, se ele ficou livre: o SKU, os cartões de products
 * do código, o item do portal, o preço guardado e os saldos zerados. O
 * conteúdo de cada documento vai para o recibo e o caminho de cada um para o
 * evento, como os cartões apagados do "Remover para corrigir".
 */
async function apagarSeLivre(db, FieldValue, correcao, plano) {
  const reciboRef = db.collection("operational_operations").doc(idDoRecibo(correcao, "apagar"));
  if ((await reciboRef.get()).exists) return { apagado: true };
  const passos = await situacaoDosPassos(leitorDoBanco(), db, correcao, plano);
  const decisao = await conferirRemocao(leitorDoBanco(), db, correcao, plano, passos);
  if (!decisao.apaga) return { apagado: false, motivos: decisao.motivos };
  const ts = () => FieldValue.serverTimestamp();
  const skuRef = db.collection("skus").doc(plano.sku_de);
  const cartoes = await productsComCodigo(leitorDoBanco(), db, plano.de, plano.cliente);
  const portalRef = db.collection("client_inventory").doc(safeDocId(`cinv_${plano.cliente}__${plano.sku_de}`));
  const precoRef = db.collection("catalog_prices").doc(safeDocId(`cprice_${plano.cliente}__${plano.sku_de}`));
  const agora = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    if ((await tx.get(reciboRef)).exists) return { apagado: true };
    const [sku, saldos, portal, preco, cancelados, ...produtos] = await Promise.all([
      tx.get(skuRef),
      tx.get(db.collection("stock_balances").where("sku_code", "==", plano.sku_de)),
      tx.get(portalRef),
      tx.get(precoRef),
      Promise.all(decisao.itensCancelados.map((i) => tx.get(db.collection("inbound_items").doc(i.id)))),
      ...cartoes.map((d) => tx.get(d.ref)),
    ]);
    const doSku = doCliente(saldos.docs, plano.cliente);
    const restante = doSku.reduce((s, d) => s + num(d.data().qty_on_hand) + num(d.data().qty_reserved), 0);
    if (restante > 0) return { apagado: false, motivos: [`ainda tem ${fmt(restante)} em saldo ou reserva`] };
    const comEstoque = produtos.filter((p) => p.exists && num(p.data().estoque_btg) > 0);
    if (comEstoque.length) return { apagado: false, motivos: [`o cartão ${comEstoque.map((p) => p.ref.path).join(", ")} ainda conta estoque`] };
    const apagados = [sku, ...produtos, portal, preco, ...doSku].filter((d) => d.exists);
    for (const d of apagados) tx.delete(d.ref);
    const reapontadas = cancelados.filter((d) => d.exists && texto(d.data().sku_code) === plano.sku_de);
    for (const d of reapontadas) {
      const antes = { sku_code: texto(d.data().sku_code), client_item_code: texto(d.data().client_item_code), product_name: texto(d.data().product_name) };
      tx.update(d.ref, { sku_code: plano.alvo.sku, client_item_code: plano.alvo.codigo, product_name: plano.alvo.nome, ...(plano.alvo.tamanho ? { size: plano.alvo.tamanho } : {}), acerto_codigo: { op: correcao.id, antes, at: agora }, updated_at: ts() });
    }
    const ref = db.collection("events").doc(idDoEvento(correcao, "catalog.removed_by_correcao", plano.sku_de));
    tx.create(ref, {
      id: ref.id,
      type: "catalog.removed_by_correcao",
      title: `Cadastro errado ${plano.sku_de} removido`,
      description: `${plano.de} · "${plano.nome_de}": as peças foram para ${plano.alvo.sku} (${plano.alvo.codigo})`,
      severity: "info",
      entity_type: "sku",
      entity_id: plano.sku_de,
      customer_code: plano.cliente,
      payload: { cod_cliente: plano.de, apagados: apagados.map((d) => d.ref.path), linhas_canceladas_reapontadas: reapontadas.map((d) => d.ref.path), para: { sku_code: plano.alvo.sku, cod_cliente: plano.alvo.codigo }, correcao: correcao.id, referencia: correcao.referencia, motivo: correcao.motivo, decisao: correcao.decisao },
      occurred_at: new Date().toISOString(),
      source: FONTE,
      actor: ATOR,
      created_at: ts(),
    });
    tx.create(reciboRef, {
      id: reciboRef.id,
      kind: "corrigir_codigo.apagar",
      target_id: plano.sku_de,
      customer_code: plano.cliente,
      actor: ATOR,
      result: { sku: plano.sku_de, apagados: apagados.map((d) => ({ caminho: d.ref.path, dados: d.data() })), linhas_canceladas_reapontadas: reapontadas.map((d) => d.ref.path) },
      source: FONTE,
      created_at: ts(),
    });
    return { apagado: true, apagados: apagados.map((d) => d.ref.path), reapontadas: reapontadas.map((d) => d.ref.path) };
  });
}

/**
 * Aplica a transferência, passo a passo. `operations` é o domain/operations.js
 * de functions/wms/lib. `depoisDaSaida` só existe para o cenário do emulador
 * simular uma queda entre a saída e a entrada.
 */
export async function aplicarTransferencia(db, FieldValue, correcao, { operations, depoisDaSaida } = {}) {
  const leitura = await lerTransferencia(leitorDoBanco(), db, correcao);
  if (leitura.jaAplicado) return { estado: "ja_aplicado" };
  const { plano } = leitura;
  const finalRef = db.collection("operational_operations").doc(idDoRecibo(correcao));
  if (leitura.soRemocao) {
    const remocao = await apagarSeLivre(db, FieldValue, correcao, plano);
    if (!remocao.apagado) return { estado: "ja_aplicado", nao_apagado: remocao.motivos };
    await finalRef.update({
      "result.apagado": true,
      "result.apagados": remocao.apagados ?? [],
      "result.linhas_canceladas_reapontadas": remocao.reapontadas ?? [],
      "result.nao_apagado": FieldValue.delete(),
      updated_at: FieldValue.serverTimestamp(),
    });
    return { estado: "corrigido", modo: "transferencia", sku_de: plano.sku_de, sku_para: plano.alvo.sku, apagado: true, apagados: remocao.apagados, linhas_canceladas_reapontadas: remocao.reapontadas };
  }
  if (!leitura.congelado) await congelarPlano(db, FieldValue, correcao, plano);
  for (const t of plano.transferencias) {
    await movimento(db, FieldValue, operations, correcao, plano, "saida", t.posicao, t.qtde);
    if (depoisDaSaida) await depoisDaSaida(t);
    await movimento(db, FieldValue, operations, correcao, plano, "entrada", t.posicao, t.qtde);
  }
  await corrigirCaixas(db, FieldValue, correcao, plano);
  const remocao = await apagarSeLivre(db, FieldValue, correcao, plano);
  const resultado = {
    modo: "transferencia",
    de: plano.de,
    para: plano.alvo.codigo,
    sku_de: plano.sku_de,
    sku_para: plano.alvo.sku,
    nome: plano.alvo.nome,
    receipt_id: plano.receipt_id,
    receipt_number: plano.receipt_number,
    caixas: plano.caixas,
    transferencias: plano.transferencias,
    apagado: remocao.apagado,
    ...(remocao.apagados ? { apagados: remocao.apagados, linhas_canceladas_reapontadas: remocao.reapontadas } : {}),
    ...(remocao.motivos ? { nao_apagado: remocao.motivos } : {}),
  };
  await db.runTransaction(async (tx) => {
    if ((await tx.get(finalRef)).exists) return;
    tx.create(finalRef, { id: finalRef.id, kind: "corrigir_codigo.transferir", target_id: plano.sku_de, customer_code: plano.cliente, actor: ATOR, result: resultado, source: FONTE, created_at: FieldValue.serverTimestamp() });
  });
  return { estado: "corrigido", ...resultado };
}
