/**
 * Cenário sintético da BTG no emulador do Firestore, para validar o acerto
 * (`acerto.mjs`) sem tocar a nuvem. Reproduz, com os números do e-mail da
 * Cristiane e da conferência do Guilherme, só o que o plano toca: SKUs,
 * saldos por posição, caixas e linhas da abertura.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8299 node tools/acerto-btg-2026-10/cenario-emulador.mjs --projeto demo-acerto [--refazer]
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8299 node tools/acerto-btg-2026-10/cenario-emulador.mjs --projeto demo-acerto --conferir
 *
 * Aborta sem FIRESTORE_EMULATOR_HOST apontando para 127.0.0.1 ou localhost.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
  console.error("FIRESTORE_EMULATOR_HOST precisa apontar para 127.0.0.1 ou localhost. Este cenário nunca roda na nuvem.");
  process.exit(2);
}
const argv = process.argv.slice(2);
const PROJETO = argv.includes("--projeto") ? argv[argv.indexOf("--projeto") + 1] : "demo-acerto";
const REFAZER = argv.includes("--refazer");
const CONFERIR = argv.includes("--conferir");
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
process.env.GCLOUD_PROJECT = PROJETO;
process.env.METADATA_SERVER_DETECTION = "none";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const requireWms = createRequire(path.join(RAIZ, "functions", "wms", "package.json"));
const { initializeApp } = requireWms("firebase-admin/app");
const { getFirestore, FieldValue } = requireWms("firebase-admin/firestore");
const db = getFirestore(initializeApp({ projectId: PROJETO }));

const CLIENTE = "BTG Pactual";
const SESSAO = "opening_btg_2026_10";
const text = (v) => String(v ?? "").trim();
const norm = (v) => text(v).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
const safeDocId = (v) => String(v).replace(/[^\w.-]/g, "_").slice(0, 900);

// cod_cliente, nome, gênero, [caixa, posição, qtde]..., fotos?, sku fixo?
const FEM_AZUL = (t) => ({ fotos: [`https://fotos.teste/0805-feminina-${t}-1.jpg`, `https://fotos.teste/0805-feminina-${t}-2.jpg`], paths: [`fotos/0805-feminina-${t}-1.jpg`, `fotos/0805-feminina-${t}-2.jpg`] });
const MASC_AZUL = (t) => ({ fotos: [`https://fotos.teste/0805-masculina-${t}-1.jpg`, `https://fotos.teste/0805-masculina-${t}-2.jpg`], paths: [`fotos/0805-masculina-${t}-1.jpg`, `fotos/0805-masculina-${t}-2.jpg`] });
const ITENS = [
  ["A.01.0805.002.PP", "POLO FEMININA PIQUET AZUL MARINHO PP", "Masculino", [["CX-000301", "B-05", 12]], FEM_AZUL("PP")],
  ["A.01.0805.002.P", "POLO MASCULINO PIQUET AZUL MARINHO P", "Masculino", [["CX-000302", "B-05", 44], ["CX-000322", "B-10", 34]], FEM_AZUL("P")],
  ["A.01.0805.002.M", "POLO MASCULINO PIQUET AZUL MARINHO M", "Masculino", [["CX-000303", "B-05", 176], ["CX-000323", "B-10", 72]], FEM_AZUL("M")],
  ["A.01.0805.002.G", "POLO MASCULINO PIQUET AZUL MARINHO G", "Masculino", [["CX-000304", "B-05", 157], ["CX-000324", "B-10", 72]], FEM_AZUL("G")],
  ["A.01.0805.002.GG", "POLO MASCULINO PIQUET AZUL MARINHO GG", "Masculino", [["CX-000305", "B-05", 59], ["CX-000325", "B-10", 41]], FEM_AZUL("GG")],
  ["A.01.0805.002.XG", "POLO MASCULINO PIQUET AZUL MARINHO XG", "Masculino", [["CX-000306", "B-05", 42], ["CX-000326", "B-10", 22]], FEM_AZUL("XG")],
  ["A.01.0805.002.XGG", "POLO MASCULINO PIQUET AZUL MARINHO XGG", "Masculino", [["CX-000307", "B-05", 13]], FEM_AZUL("XGG")],
  ["A.02.0805.002.PP", "POLO FEMININA PIQUET AZUL MARINHO PP", "Feminino", [["CX-000310", "A-02", 5]], MASC_AZUL("PP")],
  ["A.02.0805.002.P", "POLO FEMININA PIQUET AZUL MARINHO P", "Feminino", [["CX-000311", "A-02", 10]], MASC_AZUL("P")],
  ["A.02.0805.002.M", "POLO FEMININA PIQUET AZUL MARINHO M", "Feminino", [["CX-000312", "A-02", 20]], MASC_AZUL("M")],
  ["A.02.0805.002.G", "POLO FEMININA PIQUET AZUL MARINHO G", "Feminino", [["CX-000313", "A-02", 30]], MASC_AZUL("G")],
  ["A.02.0809.002.PP", "Polo feminina piquet arpoador – PP", "Feminino", [["CX-000078", "A-10", 32]]],
  ["A.02.0809.002.P", "Polo feminina piquet arpoador – P", "Feminino", [["CX-000076", "A-10", 70]]],
  ["A.02.0809.002.G", "Polo feminina piquet arpoador – G", "Feminino", [["CX-000079", "A-10", 56]]],
  ["A.02.0809.002.GG", "Polo feminina piquet arpoador – GG", "Feminino", [["CX-000083", "A-11", 18]]],
  ["A.02.0809.002.XG", "Polo feminina piquet arpoador – XG", "Feminino", [["CX-000080", "A-11", 10]]],
  ["A.01.0809.002.M", "POLO MASCULINO PIQUET ARPOARDOR M", "Masculino", [["CX-000085", "B-11", 67], ["CX-000086", "A-13", 48], ["CX-000089", "A-13", 50], ["CX-000090", "A-13", 44], ["CX-000091", "A-13", 50], ["CX-000092", "A-13", 25]]],
  ["POLO MASCULINO PIQUET OCEANO G", "Polo masculino piquet oceano g", "Masculino", [["CX-000198", "B-07", 70]], null, "BTG-000165"],
  ["A.01.0811.002.G", "Polo masculino piquet oceano G", "Masculino", [["CX-000197", "B-07", 128]]],
  // Códigos errados como estão na produção (--buscar de 30/10/2026): com o tamanho no fim e o SKU fixo.
  ["A.01.0808.002.M", "Polo feminino piquet mescla preto m", "Feminino", [["CX-000150", "A-12", 59]], null, "BTG-000109"],
  ["A.02.0808.002.P", "Polo feminina piquet mescla preto p", "Feminino", [["CX-000151", "A-12", 51]]],
  ["A.02.0808.002.G", "Polo feminina piquet mescla preto G", "Feminino", [["CX-000152", "A-12", 18]]],
  ["A.01.05334.005.M", "Tricot meio zíper preto m", "Masculino", [["CX-000120", "A-05", 12]], null, "BTG-000045"],
  ["A.01.0534.005.M", "Tricot meio zíper preto M", "Masculino", [["CX-000121", "A-05", 30]]],
  ["A.01.O719.004.P", "Polo masculina piquet PAN cinza p", "Masculino", [["CX-000140", "C-03", 15]], null, "BTG-000087"],
  ["A.01.0719.004.PP", "Polo masculino piquet PAN cinza PP", "Masculino", [["CX-000141", "C-03", 9]], null, "BTG-000088"],
  ["A.02.0813.005.PP", "Polo feminina pima preto PP", "Feminino", [["CX-000169", "C-10", 20]]],
  ["A.02.0813.005.P", "Polo feminina pima preto P", "Feminino", [["CX-000169", "C-10", 30]]],
  ["A.02.0813.005.M", "Polo feminina pima preto M", "Feminino", [["CX-000177", "C-10", 30]]],
  ["A.02.0813.005.G", "Polo feminina pima preto G", "Feminino", [["CX-000177", "C-10", 30]]],
  ["A.02.0814.002.GG", "Polo feminina pima azul GG", "Feminino", [["CX-000180", "C-11", 30]]],
  ["A.02.0814.002.XG", "Polo feminina pima azul XG", "Feminino", [["CX-000180", "C-11", 30]]],
  ["A.01.0798.002.P", "Jaqueta RIP stop militar p", "Masculino", [["CX-000018", "B-02", 12], ["CX-000019", "B-02", 12]]],
  ["J.0149.003.N1", "Sacola quadrada – BTG", "", [["CX-000210", "D-01", 585]]],
  ["J.0149.003.N3", "Sacola quadrada – BTG", "", [["CX-000211", "D-01", 120]]],
  ["J.0562.003.N6", "Sacola quadrada – BTG", "", [["CX-000212", "D-02", 72], ["CX-000213", "D-02", 75]], null, "BTG-000169"],
  ["A.01.0219.004", "Camiseta masculina FIO egípcio cinza", "Masculino", [["CX-000005", "E-01", 25]]],
  ["A.01.0594.005.PP", "Polo masculina basica preta PP", "Masculino", [["CX-000032", "E-02", 1]]],
  ["A.01.0594.005.P", "Polo masculina basica preta P", "Masculino", [["CX-000032", "E-02", 20]]],
  ["A.01.0601.001.P", "Polo masculino piquet azul p", "Masculino", [["CX-000032", "E-02", 13]]],
  ["A.01.0690.004.P", "Polo masculino piquet rosa OUT rosa p", "Masculino", [["CX-000130", "E-03", 24]]],
  ["A.01.0690.004.G", "Polo masculino piquet rosa OUT rosa G", "Masculino", [["CX-000130", "E-03", 9]]],
  ["A.01.0609.003.P", "Polo masculino piquet branca p", "Masculino", [["CX-000004", "E-04", 3]]],
  ["A.01.0709.004.P", "Polo masculino piquet cinza p", "Masculino", [["CX-000033", "E-01", 3]]],
  ["A.01.0705.017.P", "Polo masculino piquet indigo p", "Masculino", [["CX-000036", "B-02", 2]]],
];
/** Caixas apoiadas em outra, como na produção (CX-000033 sobre a CX-000005, CX-000036 sobre a CX-000019). */
const APOIOS = { "CX-000033": "CX-000005", "CX-000036": "CX-000019" };
/** Cadastros que na produção não respondem pela busca por cod_cliente_key. */
const SEM_CHAVE = new Set(["A.01.0808.002.M", "A.01.05334.005.M", "J.0562.003.N6"]);
/** Como o código foi digitado na abertura: letra O por zero, espaço, ponto a mais. */
const DIGITADO = { "A.01.0808.002.M": "A.01.O808.002.M", "A.01.05334.005.M": "A.01.05334.005.M ", "J.0562.003.N6": "J.0562.003.N6." };

const categoriaDe = (nome) => (/^sacola/i.test(nome) ? "Sacola" : /^jaqueta/i.test(nome) ? "Jaqueta" : /^tricot/i.test(nome) ? "Tricot" : /^camiseta/i.test(nome) ? "Camiseta" : "Polo");
const tamanhoDe = (codigo) => {
  const fim = codigo.split(".").pop();
  return /^(PP|P|M|G|GG|XG|XGG|N1|N3|N6)$/.test(fim) ? fim : "";
};

async function limpar() {
  const r = await fetch(`http://${host}/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: "DELETE" });
  if (!r.ok) throw new Error(`Não consegui limpar o emulador (${r.status})`);
}

async function semear() {
  const batch = db.batch();
  let escritas = 0;
  const set = (ref, data) => {
    batch.set(ref, data);
    escritas += 1;
  };
  set(db.collection("customers").doc("btg"), { id: "btg", code: CLIENTE, customer_code: CLIENTE, name: "BTG Pactual", sku_prefix: "BTG", status: "active", archived: false });
  set(db.collection("sku_counters").doc("BTG"), { prefix: "BTG", customer_code: CLIENTE, last: 300 });
  set(db.collection("opening_inventory_sessions").doc(SESSAO), { id: SESSAO, customer_code: CLIENTE, status: "completed", line_count: 0, unit_count: 0 });
  const caixas = new Map();
  const posicoes = new Set();
  let seq = 200; // os SKUs fixos (BTG-000045, -087, -088, -109, -165, -169) ficam abaixo
  for (const [codigo, nome, genero, lugares, fotos, skuFixo] of ITENS) {
    seq += 1;
    const sku = skuFixo ?? `BTG-${String(seq).padStart(6, "0")}`;
    const total = lugares.reduce((s, [, , q]) => s + q, 0);
    const gravado = DIGITADO[codigo] ?? codigo;
    const catalogo = {
      customer_code: CLIENTE,
      cod_cliente: gravado,
      cod_cliente_key: norm(gravado),
      produto: nome,
      category: categoriaDe(nome),
      categoria: categoriaDe(nome),
      genero: genero || undefined,
      grupo: "Uniformes",
      size: tamanhoDe(codigo) || undefined,
      tamanho: tamanhoDe(codigo) || undefined,
      photo_urls: fotos?.fotos,
      primary_photo_url: fotos?.fotos?.[0],
      photo_storage_paths: fotos?.paths,
      status: "active",
      archived: false,
      source: "cenario_emulador",
    };
    const limpo = Object.fromEntries(Object.entries(catalogo).filter(([, v]) => v !== undefined));
    if (SEM_CHAVE.has(codigo)) delete limpo.cod_cliente_key;
    set(db.collection("products").doc(safeDocId(codigo)), { id: codigo, ...limpo, estoque_btg: total, num_skus: 1 });
    set(db.collection("skus").doc(sku), { id: sku, ...limpo, cod_btg: sku, sku_code: sku, sku_code_key: norm(sku), estoque_atual: total, estoque_reservado: 0, estoque_disponivel: total });
    set(db.collection("client_inventory").doc(safeDocId(`cinv_${CLIENTE}__${sku}`)), {
      customer_code: CLIENTE, sku_code: sku, client_item_code: codigo, product_name: nome, category: limpo.category,
      qty_on_hand: total, qty_reserved: 0, qty_available: total, photo_urls: fotos?.fotos ?? [], primary_photo_url: fotos?.fotos?.[0] ?? null,
    });
    const porPosicao = new Map();
    for (const [caixa, posicao, qtde] of lugares) {
      porPosicao.set(posicao, (porPosicao.get(posicao) ?? 0) + qtde);
      posicoes.add(posicao);
      const cx = caixas.get(caixa) ?? { code: caixa, location_id: posicao, line_count: 0, unit_count: 0, sku_codes: [] };
      cx.line_count += 1;
      cx.unit_count += qtde;
      cx.sku_codes.push(sku);
      caixas.set(caixa, cx);
      set(db.collection("opening_inventory_lines").doc(`line_${caixa}_${sku}`), {
        id: `line_${caixa}_${sku}`, session_id: SESSAO, customer_code: CLIENTE, sku_code: sku, client_item_code: gravado, product_name: nome,
        product_registration: "existing", category: limpo.category, location_id: posicao, box_code: caixa, counted_qty: qtde, unit_cost: 0, total_cost: 0,
        status: "counted", occurred_at: "2026-10-21T12:00:00.000Z",
      });
    }
    for (const [posicao, qtde] of porPosicao) {
      set(db.collection("stock_balances").doc(safeDocId(`bal_${CLIENTE}__${sku}__${posicao}`)), {
        id: safeDocId(`bal_${CLIENTE}__${sku}__${posicao}`), customer_code: CLIENTE, sku_code: sku, client_item_code: gravado, product_name: nome,
        location_id: posicao, category: limpo.category, size: limpo.size ?? null, qty_on_hand: qtde, qty_reserved: 0, qty_available: qtde,
        status: "available", source: "cenario_emulador", opening_inventory_session_id: SESSAO, photo_urls: fotos?.fotos ?? [], primary_photo_url: fotos?.fotos?.[0] ?? null,
      });
    }
  }
  for (const cx of caixas.values()) {
    set(db.collection("warehouse_boxes").doc(cx.code), { ...cx, customer_code: CLIENTE, status: "stored", opening_closed: true, origin: { session_id: SESSAO }, support_box_code: APOIOS[cx.code] ?? null, created_at: FieldValue.serverTimestamp() });
  }
  for (const posicao of posicoes) {
    set(db.collection("warehouse_positions").doc(posicao), { code: posicao, status: "active", occupancy_revision: 1 });
  }
  await batch.commit();
  console.log(`Cenário semeado em ${PROJETO}: ${ITENS.length} SKUs, ${caixas.size} caixas, ${posicoes.size} posições, ${escritas} documentos.`);
}

async function conferir() {
  const codigos = [
    "A.01.0805.002.PP", "A.02.0809.002.M", "A.01.0809.002.M", "A.02.0809.002.P", "A.02.0809.002.G", "A.02.0809.002.GG",
    "A.01.0811.002.G", "A.02.0808.002.M", "A.02.0808.002.G", "A.01.0808.002.M", "A.01.0534.005.M", "A.01.05334.005.M",
    "J.0149.003.N6", "J.0562.003.N6", "A.01.0798.002.P", "A.01.0219.004", "A.01.0690.004.P", "A.01.O719.004.P", "A.02.0814.002.GG",
  ];
  console.log("\nSKU por código do cliente (inclui arquivados):");
  for (const codigo of codigos) {
    const snap = await db.collection("skus").where("cod_cliente_key", "==", norm(codigo)).get();
    if (!snap.docs.length) {
      console.log(`  ${codigo.padEnd(18)} —`);
      continue;
    }
    for (const d of snap.docs) {
      const s = d.data();
      const saldos = await db.collection("stock_balances").where("sku_code", "==", d.id).get();
      const porPos = saldos.docs.map((b) => `${b.data().location_id} ${b.data().qty_on_hand}`).join(", ") || "sem saldo";
      const cinv = await db.collection("client_inventory").doc(safeDocId(`cinv_${CLIENTE}__${d.id}`)).get();
      console.log(`  ${codigo.padEnd(18)} ${d.id} · "${s.produto}"${s.genero ? ` · ${s.genero}` : ""}${s.archived ? " · ARQUIVADO" : ""} · saldo ${porPos} · estoque_atual ${s.estoque_atual}${cinv.exists ? ` · portal ${cinv.data().qty_on_hand}${cinv.data().category ? ` ${cinv.data().category}` : " sem categoria"}${cinv.data().primary_photo_url ? " com foto" : ""}${cinv.data().client_archived ? " (arquivado)" : ""}` : " · sem client_inventory"}${s.primary_photo_url ? ` · foto ${s.primary_photo_url}` : ""}`);
    }
  }
  const oceano = await db.collection("skus").doc("BTG-000165").get();
  console.log(`  ${"BTG-000165".padEnd(18)} ${oceano.exists ? `"${oceano.data().produto}"${oceano.data().archived ? " · ARQUIVADO" : ""} · estoque_atual ${oceano.data().estoque_atual}` : "—"}`);
  console.log("\nCaixas:");
  for (const code of ["CX-000004", "CX-000005", "CX-000033", "CX-000018", "CX-000019", "CX-000036", "CX-000032", "CX-000076", "CX-000090", "CX-000091", "CX-000092", "CX-000120", "CX-000130", "CX-000150", "CX-000152", "CX-000180", "CX-000198", "CX-000212", "CX-000213"]) {
    const snap = await db.collection("warehouse_boxes").doc(code).get();
    if (!snap.exists) {
      console.log(`  ${code} removida`);
      continue;
    }
    const linhas = await db.collection("opening_inventory_lines").where("box_code", "==", code).get();
    const conteudo = linhas.docs.map((l) => `${l.data().client_item_code} ${l.data().counted_qty}${l.data().acerto ? "*" : ""}`).join(", ");
    console.log(`  ${code} ${snap.data().location_id} · ${snap.data().line_count} produto(s) · ${snap.data().unit_count} un. · ${conteudo}${snap.data().support_box_code ? ` · apoiada na ${snap.data().support_box_code}` : ""}`);
  }
  const movimentos = await db.collection("movements").where("customer_code", "==", CLIENTE).get();
  const eventos = await db.collection("events").where("customer_code", "==", CLIENTE).get();
  const recibos = await db.collection("operational_operations").get();
  const avisos = await db.collection("ai_agent_inbox").get();
  const abertos = avisos.docs.filter((a) => String(a.data().status ?? "") === "open").length;
  console.log(`\nMovimentos: ${movimentos.size} · eventos: ${eventos.size} · recibos: ${recibos.size} · avisos do agente: ${avisos.size} (${abertos} abertos)`);
  const cobrados = movimentos.docs.filter((m) => ["wms_receiving", "wms_shipping"].includes(String(m.data().source ?? "")));
  console.log(`Movimentos com origem cobrada (wms_receiving/wms_shipping): ${cobrados.length}`);
}

if (CONFERIR) {
  await conferir();
} else {
  if (REFAZER) await limpar();
  await semear();
}
