#!/usr/bin/env node
/**
 * Corrige o código do cliente de um produto que entrou pelo Receber com o
 * código errado (decisões do Leonardo de 11/11/2026, roteiro no README desta
 * pasta). As correções estão em `correcoes.mjs`.
 *
 * Só mostra, sem gravar (padrão):
 *
 *   node tools/corrigir-codigo-do-produto/corrigir.mjs --projeto dute-prod
 *
 * Grava:
 *
 *   node tools/corrigir-codigo-do-produto/corrigir.mjs --projeto dute-prod --aplicar --confirmo "CORRIGIR CODIGO dute-prod"
 *
 * O código do cliente é identidade imutável no Catálogo (index.ts,
 * CATALOG_IDENTITY_IMMUTABLE). A ferramenta escolhe o caminho pelo banco:
 *
 * - o código certo já existe no cadastro: as peças das caixas passam para o
 *   SKU dele e o cadastro errado sai (transferir.mjs);
 * - o código certo está livre, e o SKU errado nasceu na própria chegada sem
 *   outro movimento: o mesmo SKU passa a ter o código e o nome certos, sem
 *   mexer em saldo, razão ou cobrança (este arquivo). Numa transação só, com
 *   tudo relido dentro dela: o cadastro (`skus`; o cartão de `products`, cujo
 *   id é o código, muda de documento), os saldos, a projeção do portal, o
 *   preço guardado, o relógio de parados do núcleo, o conteúdo das caixas, as
 *   tarefas de guarda e a linha da NF, com três eventos e o recibo.
 *
 * Nos dois, os movimentos e os eventos antigos ficam: são o histórico.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { abrirFirestore, lerColecao, RAIZ } from "../padronizar-nomes/firestore.mjs";
import { familiaDoCodigo, generoDoNome, ordemDoTamanho, padronizarNome, tamanhoDoCodigo } from "../padronizar-nomes/regras.mjs";
import { linhaDoSku, nomeDaFamilia } from "../padronizar-nomes/relatorio.mjs";
import {
  ATOR,
  ErroDaCorrecao,
  FONTE,
  STATUS_DA_CAIXA,
  STATUS_DA_CHEGADA,
  arquivado,
  chaveDoCodigo,
  clienteDe,
  codigoDe,
  confirmacaoDe,
  conferirCongelamento,
  conferirCorrecao,
  descreverMovimento,
  digest,
  doCliente,
  fmt,
  idDoEvento,
  idDoItemParado,
  idDoRecibo,
  leitorDaTransacao,
  leitorDoBanco,
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
import { CORRECOES } from "./correcoes.mjs";
import { aplicarTransferencia, descreverPassos, lerTransferencia } from "./transferir.mjs";

export { ErroDaCorrecao, FONTE, confirmacaoDe, idDoItemParado, idDoRecibo, leitorDaTransacao, leitorDoBanco };

// --- Puro: o nome e as linhas -------------------------------------------------------

/**
 * O nome que o produto passa a ter. Com `nome: "familia"`, o da família do
 * código novo (o mais comum entre os tamanhos ativos do mesmo cliente, como
 * na padronização de 06/11); sem família, o nome de hoje com o gênero da
 * correção no lugar do outro. Um texto em `nome` é o nome exato. O resultado
 * passa pelo padrão e não pode sobrar nada para conferir.
 */
export function nomeProposto({ skus, correcao, skuAtual }) {
  const tamanho = tamanhoDoCodigo(correcao.para) ?? "";
  const final = (nome, origem, extra = {}) => {
    const padrao = padronizarNome({ nome, codigo: correcao.para, tamanho, genero: correcao.genero });
    if (padrao.conferir.length) {
      return { nome: "", origem, erro: `o nome "${nome}" não fecha com o padrão: ${padrao.conferir.join("; ")}. Ponha o nome exato na correção (nome: "...")`, ...extra };
    }
    if (generoDoNome(padrao.nome) !== correcao.genero) {
      return { nome: "", origem, erro: `o nome "${padrao.nome}" não diz ${correcao.genero}. Ponha o nome exato na correção (nome: "...")`, ...extra };
    }
    return { nome: padrao.nome, origem, ...extra };
  };
  if (texto(correcao.nome) && correcao.nome !== "familia") return final(texto(correcao.nome), "o nome da correção");

  const familia = familiaDoCodigo(correcao.para);
  const chaveDaFamilia = chaveDoCodigo(familia);
  const membros = skus
    .filter((doc) => doc.id !== skuAtual?.id)
    .map((doc) => linhaDoSku(doc.id, doc))
    .filter((l) => !l.arquivado && l.cliente === correcao.cliente && l.codigo && chaveDoCodigo(familiaDoCodigo(l.codigo)) === chaveDaFamilia)
    .map((linha) => ({ linha, proprio: padronizarNome({ nome: linha.nome, codigo: linha.codigo, genero: linha.genero, tamanho: linha.tamanho }) }));
  if (membros.length) {
    const daFamilia = nomeDaFamilia(membros);
    const tamanhos = [...new Set(membros.map((m) => m.proprio.tamanho || texto(tamanhoDoCodigo(m.linha.codigo))).filter(Boolean))].sort((a, b) => ordemDoTamanho(a) - ordemDoTamanho(b));
    const nomes = new Map();
    for (const m of membros) if (m.proprio.nome) nomes.set(m.proprio.nome, (nomes.get(m.proprio.nome) ?? 0) + 1);
    const origem = `família ${familia}${tamanhos.length ? ` (${tamanhos.join(", ")})` : ""}`;
    const extra = nomes.size > 1 ? { nomes_da_familia: [...nomes.entries()].sort((a, b) => b[1] - a[1]).map(([nome, vezes]) => `"${nome}" (${vezes})`) } : {};
    if (daFamilia) return final(daFamilia, origem, extra);
  }

  if (!skuAtual) return { nome: "", origem: "", erro: `o SKU com ${correcao.de} não está no cadastro` };
  const atual = linhaDoSku(skuAtual.id, skuAtual);
  const hoje = padronizarNome({ nome: atual.nome, codigo: correcao.para, tamanho: atual.tamanho || tamanho });
  const generoHoje = generoDoNome(hoje.nome);
  const origem = `nome de hoje com ${correcao.genero} (o ${familia} não tem outro tamanho no cadastro)`;
  if (!generoHoje) {
    return { nome: "", origem, erro: `o nome de hoje ("${atual.nome}") não diz o gênero e o ${familia} não tem outro tamanho no cadastro. Ponha o nome exato na correção (nome: "...")` };
  }
  return final(generoHoje === correcao.genero ? hoje.nome : hoje.nome.replace(generoHoje, correcao.genero), origem);
}

/** As linhas de uma caixa ou de uma tarefa de guarda com o código e o nome novos no SKU corrigido. */
export function linhasCorrigidas(linhas, skuCode, para, nome) {
  let mudaram = 0;
  const novas = linhas.map((linha) => {
    if (texto(linha?.sku_code) !== skuCode) return linha;
    mudaram += 1;
    return { ...linha, client_item_code: para, product_name: nome };
  });
  return { linhas: novas, mudaram };
}

/** Os campos do cadastro (skus e products) que mudam, nos campos que o documento tem. */
export function camposDoCadastro(dados, { para, nome, genero }) {
  const campos = { cod_cliente: para, cod_cliente_key: chaveDoCodigo(para), produto: nome, genero };
  for (const campo of ["name", "product_name"]) if (campo in dados) campos[campo] = nome;
  if ("client_item_code" in dados) campos.client_item_code = para;
  return campos;
}

// --- Leitura e plano -----------------------------------------------------------------

// --- Leitura e plano, no mesmo SKU ----------------------------------------------------

/**
 * Lê tudo o que a correção toca e confere as condições. Devolve o estado de
 * hoje, o que grava (`escritas`, já com os valores novos) e o resumo; lança
 * `ErroDaCorrecao` quando a correção não pode ser feita no mesmo SKU. Roda
 * igual no dry-run e dentro da transação da aplicação, que relê tudo.
 */
export async function planejar(leitor, db, FieldValue, correcao, { nome, info = false, agora = new Date().toISOString() } = {}) {
  const cliente = texto(correcao.cliente);
  const de = texto(correcao.de);
  const para = texto(correcao.para);
  const kDe = chaveDoCodigo(de);
  const kPara = chaveDoCodigo(para);
  const pedidas = [...new Set((correcao.caixas ?? []).map((c) => texto(c).toUpperCase()))];
  conferirCorrecao(correcao, tamanhoDoCodigo);

  const reciboRef = db.collection("operational_operations").doc(idDoRecibo(correcao));
  const recibo = await leitor.get(reciboRef);
  if (recibo.exists) return { jaAplicado: true, recibo: recibo.data(), estado: [`recibo ${reciboRef.id} de ${quando(recibo.data().created_at) || "antes"}`], escritas: [] };

  await conferirCongelamento(leitor, db);

  // As caixas pedidas, a linha do código errado em cada uma e o SKU dela.
  const caixas = [];
  for (const codigo of pedidas) {
    const snap = await leitor.get(db.collection("warehouse_boxes").doc(codigo));
    if (!snap.exists) recusar(`a caixa ${codigo} não existe`);
    const dados = snap.data();
    if (clienteDe(dados) !== cliente) recusar(`a caixa ${codigo} é de ${clienteDe(dados)}, não de ${cliente}`);
    const origem = dados.origin ?? {};
    if (origem.kind !== "receipt" || !texto(origem.receipt_id)) recusar(`a caixa ${codigo} não veio do Receber (origem ${texto(origem.kind) || "vazia"}); esta ferramenta só corrige caixa de chegada`);
    const comDe = linhasDe(dados).filter((l) => chaveDoCodigo(l.client_item_code) === kDe);
    if (comDe.length !== 1) {
      const linhas = linhasDe(dados).map((l) => `${texto(l.client_item_code)} ${fmt(num(l.counted_qty))}`).join(", ") || "nenhuma";
      recusar(`a caixa ${codigo} tem ${comDe.length} linha(s) com ${de}; precisa de exatamente 1 (linhas: ${linhas})`);
    }
    caixas.push({ ref: snap.ref, codigo, dados, linha: comDe[0] });
  }
  const chegadas = [...new Set(caixas.map((c) => texto(c.dados.origin.receipt_id)))];
  if (chegadas.length !== 1) recusar(`as caixas são de chegadas diferentes (${chegadas.join(", ")})`);
  const receiptId = chegadas[0];
  const skusDasLinhas = [...new Set(caixas.map((c) => texto(c.linha.sku_code)))];
  if (skusDasLinhas.length !== 1 || !skusDasLinhas[0]) recusar(`as linhas de ${de} apontam para SKUs diferentes (${skusDasLinhas.join(", ") || "nenhum"})`);
  const skuCode = skusDasLinhas[0];

  const receiptSnap = await leitor.get(db.collection("inbound_receipts").doc(receiptId));
  if (!receiptSnap.exists) recusar(`a chegada ${receiptId} das caixas não existe`);
  const chegada = receiptSnap.data();
  if (clienteDe(chegada) !== cliente) recusar(`a chegada ${receiptId} é de ${clienteDe(chegada)}`);
  const numeroDaChegada = texto(chegada.receipt_number) || receiptId;

  // O SKU: do cliente, ativo, com o código errado e nascido nesta chegada.
  const skuRef = db.collection("skus").doc(skuCode);
  const skuSnap = await leitor.get(skuRef);
  if (!skuSnap.exists) recusar(`o SKU ${skuCode} da linha da caixa não está no cadastro`);
  const sku = skuSnap.data();
  if (clienteDe(sku) !== cliente) recusar(`o SKU ${skuCode} é de ${clienteDe(sku)}`);
  if (arquivado(sku)) recusar(`o SKU ${skuCode} está arquivado`);
  if (chaveDoCodigo(codigoDe(sku)) !== kDe || (texto(sku.cod_cliente_key) && texto(sku.cod_cliente_key) !== kDe)) recusar(`o SKU ${skuCode} tem o código "${codigoDe(sku)}" no cadastro, não ${de}`);
  if (texto(sku.source_receipt_id) !== receiptId || texto(sku.reactivated_receipt_id)) {
    const nasceu = texto(sku.reactivated_receipt_id) ? `foi reativado na chegada ${texto(sku.reactivated_receipt_id)}` : `nasceu ${texto(sku.source_receipt_id) ? `na chegada ${texto(sku.source_receipt_id)}` : `por ${texto(sku.source) || "outra origem"}`}`;
    recusar(`o SKU ${skuCode} não nasceu na chegada ${numeroDaChegada} (${nasceu}): trocar o código nele levaria junto o que ele já era. O caminho é passar as peças para o código certo.`);
  }
  if (nome && nome.sku && nome.sku !== skuCode) recusar(`o nome foi calculado para ${nome.sku}, e a caixa aponta para ${skuCode}; rode de novo`);

  const outrosComDe = (await skusComCodigo(leitor, db, de, cliente)).filter((d) => d.id !== skuCode);
  if (outrosComDe.length) recusar(`o código ${de} também está em ${outrosComDe.map((d) => `${d.id}${arquivado(d.data()) ? " (arquivado)" : ""}`).join(", ")}`);

  // O código certo tem de estar livre: nenhum SKU do cliente e nenhum cartão em products.
  const comPara = await skusComCodigo(leitor, db, para, cliente);
  if (comPara.length) {
    recusar(`o código ${para} já existe no cadastro: ${comPara.map((d) => `${d.id} "${nomeDe(d.data())}"${arquivado(d.data()) ? " (arquivado)" : ""}`).join(", ")}. Trocar o código no mesmo SKU não serve; o caminho é passar as peças para esse SKU.`);
  }
  const productsPara = await productsComCodigo(leitor, db, para, null);
  if (productsPara.length) recusar(`já existe cartão em products com ${para}: ${productsPara.map((d) => `${d.ref.path} (${clienteDe(d.data())}, "${nomeDe(d.data())}")`).join(", ")}`);
  const productsDe = await productsComCodigo(leitor, db, de, cliente);
  if (productsDe.length !== 1) recusar(`${productsDe.length} cartões em products com ${de} (${productsDe.map((d) => d.ref.path).join(", ") || "nenhum"}); esperava 1`);
  const productDe = productsDe[0];
  const productParaRef = db.collection("products").doc(safeDocId(kPara));

  // Nada além desta chegada: só a entrada da NF e a guarda das caixas dela.
  const movimentos = doCliente((await leitor.get(db.collection("movements").where("sku_code", "==", skuCode))).docs, cliente);
  const deFora = movimentos.filter((d) => !["wms_receiving", "wms_putaway"].includes(texto(d.data().source)) || texto(d.data().receipt_id) !== receiptId);
  if (deFora.length) {
    recusar(`o SKU ${skuCode} tem ${deFora.length} movimento(s) fora da chegada ${numeroDaChegada} (${deFora.slice(0, 5).map((d) => descreverMovimento(d.data())).join("; ")}): o código não pode mudar no mesmo SKU`);
  }
  const pedidosAbertos = (await leitor.get(db.collection("customer_requests").where("customer_code", "==", cliente).where("status", "==", "open"))).docs;
  const comOItem = pedidosAbertos.filter((d) => (Array.isArray(d.data().items) ? d.data().items : []).some((i) => texto(i?.sku_code) === skuCode || chaveDoCodigo(i?.client_item_code) === kDe));
  if (comOItem.length) recusar(`há solicitação do portal em aberto com o produto (${comOItem.map((d) => texto(d.data().request_number) || d.id).join(", ")}); decida antes da correção`);
  for (const [colecao, rotulo] of [
    ["stock_reservations", "reserva"],
    ["pick_lines", "linha de separação"],
    ["order_items", "item de pedido"],
    ["cycle_counts", "contagem"],
    ["return_items", "item de devolução"],
    ["opening_inventory_lines", "linha da abertura"],
  ]) {
    const docs = doCliente((await leitor.get(db.collection(colecao).where("sku_code", "==", skuCode))).docs, cliente);
    if (docs.length) recusar(`o SKU ${skuCode} já tem ${docs.length} ${rotulo}(s) em ${colecao} (${docs.slice(0, 3).map((d) => d.id).join(", ")})`);
  }
  const itensDoSku = doCliente((await leitor.get(db.collection("inbound_items").where("sku_code", "==", skuCode))).docs, cliente);
  const deOutraChegada = itensDoSku.filter((d) => texto(d.data().receipt_id) !== receiptId);
  if (deOutraChegada.length) recusar(`o SKU ${skuCode} também está na chegada ${[...new Set(deOutraChegada.map((d) => texto(d.data().receipt_number) || texto(d.data().receipt_id)))].join(", ")}`);
  const itensDaNf = itensDoSku.filter((d) => texto(d.data().receipt_id) === receiptId);
  if (itensDaNf.length !== 1) recusar(`${itensDaNf.length} linha(s) da NF da chegada ${numeroDaChegada} com o SKU ${skuCode}; esperava 1`);
  const itemDaNf = itensDaNf[0];
  if (chaveDoCodigo(itemDaNf.data().client_item_code) !== kDe) recusar(`a linha da NF (${itemDaNf.id}) tem "${texto(itemDaNf.data().client_item_code)}", não ${de}`);
  for (const c of caixas) {
    if (texto(c.linha.inbound_item_id) !== itemDaNf.id) recusar(`a linha de ${de} da caixa ${c.codigo} aponta para outra linha da NF (${texto(c.linha.inbound_item_id) || "nenhuma"})`);
  }

  // Todas as caixas com o SKU têm de estar na correção.
  const daChegada = (await leitor.get(db.collection("warehouse_boxes").where("origin.receipt_id", "==", receiptId))).docs;
  const comSku = (await leitor.get(db.collection("warehouse_boxes").where("sku_codes", "array-contains", skuCode))).docs;
  const caixasDoSku = new Map();
  for (const d of [...daChegada, ...comSku]) {
    const dados = d.data();
    if (linhasDe(dados).some((l) => texto(l.sku_code) === skuCode) || (Array.isArray(dados.sku_codes) && dados.sku_codes.includes(skuCode))) caixasDoSku.set(d.id, d);
  }
  const caixasDeFora = [...caixasDoSku.keys()].filter((codigo) => !pedidas.includes(codigo)).sort();
  if (caixasDeFora.length) recusar(`o SKU ${skuCode} também está na(s) caixa(s) ${caixasDeFora.join(", ")}: confira com quem conferiu e ponha na correção (caixas)`);
  for (const c of caixas) {
    const retirado = (Array.isArray(c.dados.taken_lines) ? c.dados.taken_lines : []).some((t) => texto(t?.sku_code) === skuCode);
    if (retirado) recusar(`a separação já tirou ${de} da caixa ${c.codigo}`);
  }

  // O saldo: só no RECEBIMENTO ou na prateleira das caixas, sem reserva, igual ao que as caixas têm.
  const saldos = doCliente((await leitor.get(db.collection("stock_balances").where("sku_code", "==", skuCode))).docs, cliente);
  const reservado = saldos.reduce((s, d) => s + num(d.data().qty_reserved), 0);
  if (reservado > 0) recusar(`o SKU ${skuCode} tem ${fmt(reservado)} reservado; decida o pedido antes da correção`);
  const locais = new Set(["RECEBIMENTO", ...caixas.map((c) => texto(c.dados.location_id).toUpperCase()).filter(Boolean)]);
  const foraDoLugar = saldos.filter((d) => num(d.data().qty_on_hand) !== 0 && !locais.has(texto(d.data().location_id).toUpperCase()));
  if (foraDoLugar.length) recusar(`o SKU ${skuCode} tem saldo fora das caixas: ${foraDoLugar.map((d) => `${texto(d.data().location_id)} ${fmt(num(d.data().qty_on_hand))}`).join(", ")}`);
  const totalSaldo = saldos.reduce((s, d) => s + num(d.data().qty_on_hand), 0);
  const totalCaixas = caixas.reduce((s, c) => s + num(c.linha.counted_qty), 0);
  const recebido = movimentos.some((d) => texto(d.data().source) === "wms_receiving");
  if (recebido ? totalSaldo !== totalCaixas : totalSaldo !== 0) {
    recusar(`o saldo do SKU ${skuCode} (${fmt(totalSaldo)}) não bate com ${recebido ? `o que as caixas têm (${fmt(totalCaixas)})` : "a chegada sem entrada (0)"}`);
  }

  const tarefas = (await leitor.get(db.collection("putaway_tasks").where("receipt_id", "==", receiptId))).docs.filter(
    (d) => linhasDe(d.data()).some((l) => texto(l.sku_code) === skuCode) || texto(d.data().sku_code) === skuCode,
  );
  const projecaoRef = db.collection("client_inventory").doc(safeDocId(`cinv_${cliente}__${skuCode}`));
  const precoRef = db.collection("catalog_prices").doc(safeDocId(`cprice_${cliente}__${skuCode}`));
  const idadeRef = db.collection("ai_stock_age").doc(idDoItemParado(cliente, skuCode));
  const [projecao, preco, idade] = await Promise.all([leitor.get(projecaoRef), leitor.get(precoRef), leitor.get(idadeRef)]);

  const nomeNovo = texto(nome?.nome);
  if (!nomeNovo) recusar(nome?.erro ?? "sem o nome novo");
  const nomeAntes = nomeDe(sku);
  const generoAntes = texto(sku.genero) || null;
  const acerto = { op: correcao.id, antes: { cod_cliente: codigoDe(sku), produto: nomeAntes, genero: generoAntes }, at: agora };
  const ts = () => FieldValue.serverTimestamp();
  const novo = { para, nome: nomeNovo, genero: correcao.genero };

  // --- O que grava -------------------------------------------------------------------
  const escritas = [];
  const grava = (tipo, ref, dados, descricao) => escritas.push({ tipo, ref, dados, descricao });

  grava("update", skuRef, { ...camposDoCadastro(sku, novo), acerto_codigo: acerto, updated_at: ts(), updated_by: ATOR }, `skus/${skuCode}: código ${codigoDe(sku)} → ${para} · "${nomeAntes}" → "${nomeNovo}" · gênero ${generoAntes ?? "vazio"} → ${correcao.genero}`);
  const cartao = productDe.data();
  grava(
    "create",
    productParaRef,
    { ...cartao, ...camposDoCadastro(cartao, novo), id: para, acerto_codigo: { ...acerto, antes: { ...acerto.antes, documento: productDe.ref.path } }, updated_at: ts(), updated_by: ATOR },
    `products/${productParaRef.id}: o cartão de ${productDe.ref.path}, com o código e o nome novos`,
  );
  grava("delete", productDe.ref, null, `${productDe.ref.path}: sai (o id do cartão é o código; o conteúdo vai para o recibo)`);
  for (const d of saldos) {
    grava("update", d.ref, { client_item_code: para, product_name: nomeNovo, updated_at: ts() }, `stock_balances/${d.id} (${texto(d.data().location_id)}, ${fmt(num(d.data().qty_on_hand))} un.): código e nome`);
  }
  if (projecao.exists) grava("update", projecaoRef, { client_item_code: para, product_name: nomeNovo, updated_at: ts() }, `client_inventory/${projecaoRef.id} (portal): código e nome`);
  if (preco.exists) grava("update", precoRef, { item_code: para, updated_at: ts() }, `catalog_prices/${precoRef.id}: código`);
  if (idade.exists) grava("update", idadeRef, { client_item_code: para, product_name: nomeNovo }, `ai_stock_age/${idadeRef.id} (dias parado): código e nome`);
  for (const c of caixas) {
    const { linhas } = linhasCorrigidas(linhasDe(c.dados), skuCode, para, nomeNovo);
    grava(
      "update",
      c.ref,
      {
        lines: linhas,
        conference_revision: num(c.dados.conference_revision) + 1,
        acerto_codigo: { op: correcao.id, antes: { inbound_item_id: itemDaNf.id, client_item_code: texto(c.linha.client_item_code), product_name: texto(c.linha.product_name) }, at: agora },
        updated_at: ts(),
      },
      `${c.codigo}${texto(c.dados.location_id) ? ` em ${texto(c.dados.location_id)}` : ""}: a linha de ${fmt(num(c.linha.counted_qty))} un. com o código e o nome novos (a etiqueta impressa fica velha)`,
    );
  }
  for (const d of tarefas) {
    const dados = d.data();
    const mudancas = { updated_at: ts() };
    if (linhasDe(dados).length) mudancas.lines = linhasCorrigidas(linhasDe(dados), skuCode, para, nomeNovo).linhas;
    if (texto(dados.sku_code) === skuCode) {
      if ("client_item_code" in dados) mudancas.client_item_code = para;
      if ("product_name" in dados) mudancas.product_name = nomeNovo;
    }
    grava("update", d.ref, mudancas, `putaway_tasks/${d.id} (guarda ${texto(dados.box_code) ? `da ${texto(dados.box_code)}` : "da linha"}, ${texto(dados.status) === "completed" ? "concluída" : "aberta"}): código e nome`);
  }
  const item = itemDaNf.data();
  grava(
    "update",
    itemDaNf.ref,
    { client_item_code: para, product_name: nomeNovo, acerto_codigo: { op: correcao.id, antes: { client_item_code: texto(item.client_item_code), product_name: texto(item.product_name) }, at: agora }, updated_at: ts() },
    `inbound_items/${itemDaNf.id} (linha ${num(item.line_number)} da NF): código e nome, com o antigo guardado em acerto_codigo`,
  );

  const referencia = { referencia: correcao.referencia, motivo: correcao.motivo, decisao: correcao.decisao, correcao: correcao.id };
  const antes = { cod_cliente: codigoDe(sku), produto: nomeAntes, genero: generoAntes };
  const depois = { cod_cliente: para, produto: nomeNovo, genero: correcao.genero };
  const evento = (tipo, entityType, entityId, titulo, descricao, payload) => {
    const ref = db.collection("events").doc(idDoEvento(correcao, tipo, entityId));
    grava(
      "create",
      ref,
      { id: ref.id, type: tipo, title: titulo, description: descricao, severity: "info", entity_type: entityType, entity_id: entityId, customer_code: cliente, payload: { ...payload, ...referencia }, occurred_at: agora, source: FONTE, actor: ATOR, created_at: ts() },
      `events/${ref.id}: ${tipo} (${entityType} ${entityId})`,
    );
  };
  evento("catalog.code_corrected", "sku", skuCode, `Código do produto ${skuCode} corrigido`, `${codigoDe(sku)} → ${para} · "${nomeAntes}" → "${nomeNovo}"`, {
    sku_code: skuCode,
    antes,
    depois,
    receipt_id: receiptId,
    receipt_number: numeroDaChegada,
    caixas: caixas.map((c) => c.codigo),
    nome_origem: nome.origem,
  });
  for (const c of caixas) {
    evento("warehouse.box_content_corrected", "warehouse_box", c.codigo, `Conteúdo da caixa ${c.codigo} corrigido`, `${codigoDe(sku)} → ${para} · ${fmt(num(c.linha.counted_qty))} un. · reimprimir a etiqueta`, {
      box_code: c.codigo,
      sku_code: skuCode,
      receipt_id: receiptId,
      antes: { client_item_code: texto(c.linha.client_item_code), product_name: texto(c.linha.product_name) },
      depois: { client_item_code: para, product_name: nomeNovo },
    });
  }
  evento("inbound.item_corrected", "recebimento", receiptId, `Linha ${num(item.line_number)} da chegada ${numeroDaChegada} corrigida`, `${texto(item.client_item_code)} → ${para} · "${texto(item.product_name)}" → "${nomeNovo}"`, {
    receipt_id: receiptId,
    receipt_number: numeroDaChegada,
    inbound_item_id: itemDaNf.id,
    sku_code: skuCode,
    antes: { client_item_code: texto(item.client_item_code), product_name: texto(item.product_name) },
    depois: { client_item_code: para, product_name: nomeNovo },
  });

  const resultado = {
    sku: skuCode,
    de: codigoDe(sku),
    para,
    nome_antes: nomeAntes,
    nome: nomeNovo,
    genero_antes: generoAntes,
    genero: correcao.genero,
    receipt_id: receiptId,
    receipt_number: numeroDaChegada,
    caixas: caixas.map((c) => c.codigo),
    unidades: totalCaixas,
    documentos: {
      saldos: saldos.length,
      projecao: projecao.exists,
      preco: preco.exists,
      dias_parado: idade.exists,
      caixas: caixas.length,
      tarefas: tarefas.length,
      linha_da_nf: itemDaNf.id,
      product: { de: productDe.ref.path, para: productParaRef.path },
    },
  };
  grava(
    "create",
    reciboRef,
    { id: reciboRef.id, input_hash: digest({ correcao, nome: nomeNovo }, 64), kind: "corrigir_codigo.trocar", target_id: skuCode, customer_code: cliente, actor: ATOR, result: { ...resultado, product_antes: cartao }, source: FONTE, created_at: ts() },
    `operational_operations/${reciboRef.id}: o recibo, com o cartão de products de antes`,
  );

  // --- O estado de hoje, para o dry-run ----------------------------------------------
  const estado = [
    `SKU ${skuCode} · "${nomeAntes}" · gênero ${generoAntes ?? "vazio"} · tamanho ${texto(sku.tamanho || sku.size) || "vazio"} · nasceu na chegada ${numeroDaChegada}${quando(sku.created_at) ? ` em ${quando(sku.created_at)}` : ""}`,
    `chegada ${numeroDaChegada}${texto(chegada.invoice_number) ? ` · NF ${texto(chegada.invoice_number)}` : ""} · ${status(STATUS_DA_CHEGADA, chegada.status)}${num(chegada.box_count) ? ` · ${fmt(num(chegada.boxes_stored))} de ${fmt(num(chegada.box_count))} caixas guardadas` : ""} · linha ${num(item.line_number)} da NF: ${texto(item.client_item_code)} · "${texto(item.product_name)}" · ${fmt(num(item.expected_qty))} na NF, ${fmt(num(item.boxed_qty))} nas caixas`,
    ...caixas.map((c) => `${c.codigo} · ${status(STATUS_DA_CAIXA, c.dados.status)}${texto(c.dados.location_id) ? ` em ${texto(c.dados.location_id)}` : ""} · ${fmt(linhasDe(c.dados).length)} produto(s) · ${de}: ${fmt(num(c.linha.counted_qty))} un.${texto(c.dados.label_printed_at) ? ` · etiqueta impressa ${quando(c.dados.label_printed_at)}` : ""}`),
    `saldo: ${saldos.length ? saldos.map((d) => `${texto(d.data().location_id)} ${fmt(num(d.data().qty_on_hand))}`).join(", ") : "nenhum (a entrada ainda não foi concluída)"} · reservado 0`,
    `movimentos: ${movimentos.length}, todos da chegada ${numeroDaChegada} (${[...new Set(movimentos.map((d) => texto(d.data().source)))].join(", ") || "nenhum"})`,
    `${cartao ? `${productDe.ref.path} · "${nomeDe(cartao)}"` : ""}${projecao.exists ? ` · portal "${texto(projecao.data().client_item_code)}"` : " · ainda fora do portal"}`,
  ];
  if (texto(chegada.customer_request_id)) estado.push(`aviso de envio do portal vinculado (${texto(chegada.customer_request_id)}): fica como o cliente mandou`);
  if (info) {
    const avisos = (await leitor.get(db.collection("events").where("entity_id", "==", receiptId))).docs.filter((d) => texto(d.data().type) === "inventory.arrival_stored");
    estado.push(
      avisos.length
        ? `aviso de chegada ao cliente: gravado ${quando(avisos[0].data().occurred_at)}, com ${de} (a correção não reenvia)`
        : "aviso de chegada ao cliente: ainda não saiu (sai na última guarda, já com o código certo)",
    );
  }

  return { jaAplicado: false, skuCode, receiptId, estado, escritas, resultado };
}

// --- Aplicação ---------------------------------------------------------------------

/** O nome a gravar e o SKU de hoje, lidos fora da transação: o catálogo inteiro, como a padronização. */
export async function prepararNome(db, FieldPath, correcao) {
  const skus = await lerColecao(db, FieldPath, "skus");
  const kDe = chaveDoCodigo(correcao.de);
  const atuais = skus.filter((d) => clienteDe(d) === correcao.cliente && !arquivado(d) && chaveDoCodigo(codigoDe(d)) === kDe);
  const skuAtual = atuais.length === 1 ? atuais[0] : null;
  return { ...nomeProposto({ skus, correcao, skuAtual }), sku: skuAtual?.id ?? null };
}

/** Grava a correção no mesmo SKU numa transação, relendo e conferindo tudo dentro dela. */
export async function aplicar(db, FieldValue, correcao, nome) {
  return db.runTransaction(async (tx) => {
    const plano = await planejar(leitorDaTransacao(tx), db, FieldValue, correcao, { nome });
    if (plano.jaAplicado) return { estado: "ja_aplicado" };
    for (const e of plano.escritas) {
      if (e.tipo === "update") tx.update(e.ref, e.dados);
      else if (e.tipo === "create") tx.create(e.ref, e.dados);
      else if (e.tipo === "delete") tx.delete(e.ref);
    }
    return { estado: "corrigido", modo: "mesmo_sku", ...plano.resultado, escritas: plano.escritas.length };
  });
}

/**
 * O caminho da correção, pelo banco: a já aplicada fica no modo do recibo; a
 * transferência começada (plano congelado) continua transferência; com o
 * código certo num SKU ativo, transferência; senão, no mesmo SKU.
 */
export async function modoDaCorrecao(leitor, db, correcao) {
  const final = await leitor.get(db.collection("operational_operations").doc(idDoRecibo(correcao)));
  if (final.exists) return texto(final.data().result?.modo) || "mesmo_sku";
  if ((await leitor.get(db.collection("operational_operations").doc(idDoRecibo(correcao, "plano")))).exists) return "transferencia";
  const comPara = (await skusComCodigo(leitor, db, correcao.para, texto(correcao.cliente))).filter((d) => !arquivado(d.data()));
  return comPara.length ? "transferencia" : "mesmo_sku";
}

/** As funções de domínio do WMS (functions/wms/lib): a transferência move o saldo por elas, como as callables. */
export async function carregarOperacoes(abortar) {
  try {
    return await import(pathToFileURL(path.join(RAIZ, "functions", "wms", "lib", "domain", "operations.js")).href);
  } catch (erro) {
    return abortar(`A transferência usa functions/wms/lib. Rode: npm --prefix functions/wms run build\n${erro.message}`);
  }
}

// --- Linha de comando ---------------------------------------------------------------

function abortar(mensagem) {
  console.error(`\nABORTADO: ${mensagem}\n`);
  process.exit(2);
}

async function principal() {
  const args = { projeto: "", aplicar: false, confirmo: "", correcoes: [], json: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const proximo = () => argv[(i += 1)];
    if (a === "--projeto") args.projeto = texto(proximo());
    else if (a === "--aplicar") args.aplicar = true;
    else if (a === "--confirmo") args.confirmo = proximo() ?? "";
    else if (a === "--correcao") args.correcoes.push(texto(proximo()));
    else if (a === "--json") args.json = true;
    else abortar(`Argumento desconhecido: ${a}`);
  }
  if (!args.projeto) abortar("Informe --projeto (dute-homolog ou dute-prod; demo-* com o emulador).");
  const naNuvem = !process.env.FIRESTORE_EMULATOR_HOST;
  if (args.aplicar && naNuvem && args.confirmo !== confirmacaoDe(args.projeto)) {
    abortar(`Para gravar, passe --confirmo "${confirmacaoDe(args.projeto)}". Sem isso o script só mostra o que muda.`);
  }
  const desconhecidas = args.correcoes.filter((id) => !CORRECOES.some((c) => c.id === id));
  if (desconhecidas.length) abortar(`Correção desconhecida: ${desconhecidas.join(", ")}. As de correcoes.mjs: ${CORRECOES.map((c) => c.id).join(", ")}.`);
  const escolhidas = CORRECOES.filter((c) => !args.correcoes.length || args.correcoes.includes(c.id));

  const { app, db, FieldPath, FieldValue } = abrirFirestore(args.projeto, abortar);
  const saida = { projeto: args.projeto, aplicar: args.aplicar, correcoes: [] };
  for (const correcao of escolhidas) {
    const registro = { id: correcao.id, de: correcao.de, para: correcao.para, caixas: correcao.caixas };
    try {
      registro.modo = await modoDaCorrecao(leitorDoBanco(), db, correcao);
      if (registro.modo === "transferencia") {
        const leitura = await lerTransferencia(leitorDoBanco(), db, correcao, { info: true });
        registro.estado_hoje = leitura.estado;
        if (leitura.jaAplicado) registro.estado = "ja_aplicado";
        else {
          registro.estado = "a_gravar";
          registro.sku = leitura.plano.sku_de;
          registro.alvo = leitura.plano.alvo;
          registro.passos = descreverPassos(leitura);
          registro.grava = registro.passos.filter((p) => !p.feito && !p.informativo).map((p) => p.texto);
          if (args.aplicar) {
            const resultado = await aplicarTransferencia(db, FieldValue, correcao, { operations: await carregarOperacoes(abortar) });
            registro.estado = resultado.estado;
            registro.resultado = resultado;
          }
        }
      } else {
        const nome = await prepararNome(db, FieldPath, correcao);
        Object.assign(registro, { nome: nome.nome || null, nome_origem: nome.origem || null, nomes_da_familia: nome.nomes_da_familia });
        const plano = await planejar(leitorDoBanco(), db, FieldValue, correcao, { nome, info: true });
        registro.estado_hoje = plano.estado;
        if (plano.jaAplicado) {
          registro.estado = "ja_aplicado";
        } else {
          registro.estado = "a_gravar";
          registro.sku = plano.skuCode;
          registro.grava = plano.escritas.map((e) => e.descricao);
          if (args.aplicar) {
            const resultado = await aplicar(db, FieldValue, correcao, nome);
            registro.estado = resultado.estado;
            registro.resultado = resultado;
          }
        }
      }
    } catch (erro) {
      if (!(erro instanceof ErroDaCorrecao)) throw erro;
      registro.estado = "erro";
      registro.erro = erro.message;
    }
    saida.correcoes.push(registro);
  }
  const conta = (estado) => saida.correcoes.filter((c) => c.estado === estado).length;
  if (conta("erro")) process.exitCode = 1;

  if (args.json) {
    console.log(JSON.stringify(saida, null, 2));
  } else {
    console.log(`\nCorreção de código do produto · projeto ${args.projeto}${naNuvem ? "" : ` · EMULADOR ${process.env.FIRESTORE_EMULATOR_HOST}`} · ${args.aplicar ? "APLICAR" : "DRY-RUN, nada será gravado"}\n`);
    for (const c of saida.correcoes) {
      const correcao = CORRECOES.find((x) => x.id === c.id);
      console.log(`[${c.id}] ${c.de} → ${c.para} · ${correcao.cliente} · caixa ${c.caixas.join(", ")}`);
      if (c.modo === "transferencia" && c.alvo) {
        console.log(`   caminho : transferência. O ${c.para} já existe (${c.alvo.sku} · "${c.alvo.nome}"): as peças passam para ele, e o código de nenhum SKU muda`);
      } else if (c.modo === "mesmo_sku" && c.estado !== "ja_aplicado") {
        console.log(`   caminho : no mesmo SKU. O ${c.para} está livre: o SKU de hoje passa a ter o código e o nome certos`);
      }
      for (const linha of c.estado_hoje ?? []) console.log(`   agora   : ${linha}`);
      if (c.nome) console.log(`   nome    : "${c.nome}" · ${c.nome_origem}`);
      if (c.nomes_da_familia) console.log(`   atenção : a família tem mais de um nome: ${c.nomes_da_familia.join(", ")}`);
      if (c.estado === "erro") console.log(`   ERRO    : ${c.erro}`);
      else if (c.estado === "ja_aplicado") console.log("   feito   : já aplicada");
      else if (c.passos && c.estado !== "corrigido") {
        for (const p of c.passos) console.log(`   ${p.informativo ? "fica  " : p.feito ? "feito " : "grava "}  : ${p.texto}`);
        console.log(`   fica    : os movimentos e os eventos guardam ${c.de} (histórico e cobrança)`);
      } else {
        for (const linha of c.grava ?? []) console.log(`   ${c.estado === "corrigido" ? "gravou" : "grava "}  : ${linha}`);
        if (c.resultado?.nao_apagado) console.log(`   atenção : o ${c.sku} (${c.de}) continua no cadastro: ${c.resultado.nao_apagado.join("; ")}`);
        console.log(`   fica    : os movimentos e os eventos guardam ${c.de} (histórico e cobrança)`);
      }
      console.log("");
    }
    console.log(`Resumo: ${saida.correcoes.length} correção(ões) · ${conta("a_gravar")} a gravar · ${conta("corrigido")} gravada(s) · ${conta("ja_aplicado")} já aplicada(s) · ${conta("erro")} com erro`);
    if (!args.aplicar && conta("a_gravar") && !conta("erro")) {
      const transferencia = saida.correcoes.some((c) => c.estado === "a_gravar" && c.modo === "transferencia");
      console.log(`\nPara gravar${transferencia ? " (a transferência usa functions/wms/lib: antes, npm --prefix functions/wms run build)" : ""}:\n  node tools/corrigir-codigo-do-produto/corrigir.mjs --projeto ${args.projeto} --aplicar --confirmo "${confirmacaoDe(args.projeto)}"`);
    }
    if (conta("corrigido")) console.log("\nDepois: reimprima a etiqueta da caixa e rode o dry-run de novo (a correção aparece como já aplicada).");
    if (!args.aplicar) console.log("\nDry-run encerrado. Nada foi gravado.");
  }
  await app.delete();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
}
