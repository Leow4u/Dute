/*
 * Dados fictícios da demonstração para a TikTok: mobiliário de eventos e
 * material de marketing guardados na Dutelog. Nada aqui é dado real e nada
 * sai do navegador: cada /api/... é respondido daqui mesmo.
 */
import { EN_PHRASES } from "./i18n/en";
import { LANG, isEnglish, pick } from "./i18n/lang";
import { productPhoto } from "./photos";

const NOW = Date.now();
const H = 3_600_000;
const D = 24 * H;
const iso = (offsetMs: number) => new Date(NOW - offsetMs).toISOString();
const ago = (hours: number) => iso(hours * H);
const daysAgo = (days: number) => iso(days * D);
const inDays = (days: number) => iso(-days * D);

export const CUSTOMER = "TikTok";
export const CUSTOMER_LEGAL_NAME = "TikTok (conta de demonstração)";

type R = Record<string, any>;

/* ---------- Catálogo ---------- */
type CatalogItem = {
  n: number;
  name: string;
  cat: string;
  qty: number;
  res: number;
  min: number;
  price: number;
  loc: [string, string, string];
  color?: string;
  size?: string;
  /** Código do cliente; tamanhos do mesmo produto dividem a base (TT.VST.029.P/M/G). */
  clientCode?: string;
  /** Número da foto em ./photos quando é a de outro item (tamanhos do mesmo produto). */
  photo?: number;
};

const CATALOG: CatalogItem[] = [
  // Ícones TikTok: as peças que viajam para os eventos (fotos recortadas de eventos reais, ver photos/CREDITS.md).
  // Peça única de cenografia não tem mínimo: não se repõe como brinde.
  { n: 33, name: "Ícone TikTok gigante iluminado 3 m", cat: "Ícones TikTok", qty: 2, res: 1, min: 0, price: 38000, loc: ["I", "01", "1"] },
  { n: 37, name: "Mala gigante TikTok", cat: "Ícones TikTok", color: "Turquesa", qty: 6, res: 0, min: 2, price: 3200, loc: ["J", "01", "1"] },
  { n: 38, name: "Cubo inflável TikTok", cat: "Ícones TikTok", color: "Rosa", qty: 24, res: 6, min: 6, price: 680, loc: ["J", "01", "2"] },
  // Cenografia de palco e de estande
  { n: 36, name: "Portal de palco com ícone e arcos coloridos", cat: "Cenografia", qty: 1, res: 0, min: 0, price: 46000, loc: ["I", "02", "1"] },
  { n: 35, name: "Celular gigante cenográfico com tela LED", cat: "Cenografia", qty: 2, res: 0, min: 0, price: 14500, loc: ["I", "02", "2"] },
  { n: 34, name: "Pórtico triangular neon rosa e turquesa", cat: "Cenografia", qty: 2, res: 0, min: 0, price: 22000, loc: ["I", "03", "1"] },
  { n: 39, name: "Cabine de fotos TikTok", cat: "Cenografia", qty: 1, res: 0, min: 0, price: 28000, loc: ["I", "03", "2"] },
  // Mobiliário
  { n: 1, name: "Sofá modular 3 lugares", cat: "Mobiliário", color: "Preto", qty: 8, res: 0, min: 2, price: 4890, loc: ["A", "01", "1"] },
  { n: 2, name: "Poltrona lounge rosa", cat: "Mobiliário", color: "Rosa", qty: 12, res: 0, min: 4, price: 1650, loc: ["A", "01", "2"] },
  { n: 3, name: "Poltrona lounge azul", cat: "Mobiliário", color: "Azul", qty: 12, res: 2, min: 4, price: 1650, loc: ["A", "01", "3"] },
  { n: 4, name: "Pufe redondo terracota", cat: "Mobiliário", color: "Terracota", qty: 40, res: 0, min: 10, price: 320, loc: ["A", "02", "1"] },
  { n: 5, name: "Pufe redondo rosa", cat: "Mobiliário", color: "Rosa", qty: 30, res: 0, min: 10, price: 320, loc: ["A", "02", "2"] },
  { n: 6, name: "Mesa bistrô alta", cat: "Mobiliário", color: "Branca", qty: 24, res: 0, min: 6, price: 780, loc: ["B", "01", "1"] },
  { n: 7, name: "Banqueta alta", cat: "Mobiliário", color: "Preta", qty: 60, res: 0, min: 12, price: 290, loc: ["B", "01", "2"] },
  { n: 8, name: "Balcão de recepção iluminado", cat: "Mobiliário", qty: 4, res: 0, min: 1, price: 6200, loc: ["B", "02", "1"] },
  { n: 9, name: "Estante expositora modular", cat: "Mobiliário", qty: 10, res: 0, min: 2, price: 1980, loc: ["B", "02", "2"] },
  { n: 10, name: "Mesa de reunião 8 lugares", cat: "Mobiliário", qty: 3, res: 0, min: 1, price: 3400, loc: ["C", "01", "1"] },
  { n: 11, name: "Luminária de piso LED", cat: "Mobiliário", qty: 14, res: 0, min: 4, price: 690, loc: ["C", "01", "2"] },
  { n: 12, name: "Tapete 3 × 2 m", cat: "Mobiliário", qty: 6, res: 0, min: 2, price: 1150, loc: ["C", "01", "3"] },
  // Cenografia
  { n: 13, name: "Backdrop step and repeat TikTok Shop 6 × 3 m", cat: "Cenografia", qty: 4, res: 0, min: 1, price: 5400, loc: ["D", "01", "1"] },
  { n: 14, name: "Totem display iluminado", cat: "Cenografia", qty: 6, res: 0, min: 2, price: 3100, loc: ["D", "01", "2"] },
  { n: 15, name: "Letreiro neon TikTok", cat: "Cenografia", color: "Rosa", qty: 4, res: 0, min: 1, price: 1850, loc: ["D", "02", "1"] },
  { n: 16, name: "Tenda sanfonada 3 × 3 m", cat: "Cenografia", qty: 6, res: 2, min: 2, price: 2700, loc: ["D", "02", "2"] },
  { n: 17, name: "Bandeirolas de tecido 10 m", cat: "Cenografia", qty: 12, res: 4, min: 4, price: 380, loc: ["D", "03", "1"] },
  // Material de PDV
  { n: 18, name: "Banner roll-up 85 × 200 cm", cat: "Material de PDV", qty: 35, res: 4, min: 10, price: 260, loc: ["E", "01", "1"] },
  { n: 19, name: "Display de mesa A5", cat: "Material de PDV", qty: 150, res: 0, min: 40, price: 45, loc: ["E", "01", "2"] },
  { n: 20, name: "Folder institucional", cat: "Material de PDV", qty: 8000, res: 0, min: 2000, price: 0.6, loc: ["E", "02", "1"] },
  // Equipamentos de gravação
  { n: 21, name: "Ring light 18\" com tripé", cat: "Equipamentos", qty: 30, res: 6, min: 8, price: 420, loc: ["F", "01", "1"] },
  { n: 22, name: "Microfone sem fio com base", cat: "Equipamentos", qty: 24, res: 4, min: 6, price: 390, loc: ["F", "01", "2"] },
  { n: 23, name: "Caixa de som bluetooth", cat: "Equipamentos", qty: 0, res: 0, min: 10, price: 210, loc: ["F", "02", "1"] },
  // Brindes personalizados com a marca
  { n: 24, name: "Ecobag personalizada TikTok", cat: "Brindes", qty: 1500, res: 300, min: 300, price: 18, loc: ["G", "01", "1"] },
  { n: 25, name: "Garrafa térmica personalizada TikTok 500 ml", cat: "Brindes", color: "Preta", qty: 800, res: 120, min: 200, price: 49, loc: ["G", "01", "2"] },
  { n: 26, name: "Boné trucker TikTok", cat: "Brindes", color: "Preto", qty: 600, res: 120, min: 150, price: 35, loc: ["G", "02", "1"] },
  { n: 27, name: "Adesivos TikTok (pacote com 10)", cat: "Brindes", qty: 5000, res: 1000, min: 1000, price: 1.2, loc: ["G", "02", "2"] },
  { n: 40, name: "Caneta personalizada TikTok", cat: "Brindes", color: "Preta", qty: 3000, res: 0, min: 500, price: 4.5, loc: ["G", "03", "1"] },
  { n: 41, name: "Caderno personalizado TikTok A5", cat: "Brindes", color: "Preto", qty: 800, res: 0, min: 200, price: 28, loc: ["G", "03", "2"] },
  { n: 42, name: "Copo térmico personalizado TikTok 350 ml", cat: "Brindes", color: "Preto", qty: 600, res: 0, min: 150, price: 39, loc: ["G", "04", "1"] },
  { n: 43, name: "Power bank personalizado TikTok 10.000 mAh", cat: "Brindes", qty: 250, res: 0, min: 50, price: 89, loc: ["G", "04", "2"] },
  { n: 44, name: "Chaveiro acrílico TikTok", cat: "Brindes", qty: 1500, res: 0, min: 300, price: 6, loc: ["G", "05", "1"] },
  { n: 28, name: "Kit creator (caixa presente)", cat: "Kits", qty: 220, res: 0, min: 50, price: 185, loc: ["H", "01", "1"] },
  // Vestuário (um produto, quatro tamanhos)
  { n: 29, name: "Moletom canguru", cat: "Vestuário", color: "Branco", size: "P", qty: 90, res: 0, min: 100, price: 120, loc: ["H", "02", "1"], clientCode: "TT.VST.029.P" },
  { n: 30, name: "Moletom canguru", cat: "Vestuário", color: "Branco", size: "M", qty: 260, res: 0, min: 100, price: 120, loc: ["H", "02", "2"], clientCode: "TT.VST.029.M", photo: 29 },
  { n: 31, name: "Moletom canguru", cat: "Vestuário", color: "Branco", size: "G", qty: 210, res: 0, min: 100, price: 120, loc: ["H", "02", "3"], clientCode: "TT.VST.029.G", photo: 29 },
  { n: 32, name: "Moletom canguru", cat: "Vestuário", color: "Branco", size: "GG", qty: 70, res: 0, min: 50, price: 120, loc: ["H", "02", "4"], clientCode: "TT.VST.029.GG", photo: 29 },
];

// Em inglês, nome e cor dos itens já nascem traduzidos: a busca e o Agent Dute funcionam em inglês.
// A categoria fica em português (é chave do prefixo do código) e a tela traduz na exibição.
if (isEnglish) {
  for (const item of CATALOG) {
    item.name = EN_PHRASES[item.name] ?? item.name;
    if (item.color) item.color = EN_PHRASES[item.color] ?? item.color;
  }
}

const PREFIX: Record<string, string> = {
  "Ícones TikTok": "ICO",
  "Mobiliário": "MOB",
  Cenografia: "CEN",
  "Material de PDV": "PDV",
  Equipamentos: "EQP",
  Brindes: "BRI",
  Kits: "KIT",
  "Vestuário": "VST",
};

const code = (n: number) => `TT-${String(n).padStart(4, "0")}`;
const itemOf = (n: number) => {
  const item = CATALOG.find((x) => x.n === n);
  if (!item) throw new Error(`item ${n} não existe na demo`);
  return item;
};
const clientCode = (n: number) => {
  const item = itemOf(n);
  return item.clientCode ?? `TT-${PREFIX[item.cat]}-${String(n).padStart(3, "0")}`;
};
const address = (loc: string[]) => `${loc[0]}-${loc[1]}-${loc[2]}`;
const fullName = (item: CatalogItem) => (item.size ? `${item.name} · ${item.size}` : item.name);
const photoOf = (item: CatalogItem) => productPhoto(item.photo ?? item.n);
const round2 = (value: number) => Math.round(value * 100) / 100;

export const skus = CATALOG.map((s) => ({
  id: s.n,
  cod_btg: code(s.n),
  sku_code: code(s.n),
  cod_cliente: clientCode(s.n),
  produto: s.name,
  categoria: s.cat,
  cor: s.color ?? "",
  tamanho: s.size ?? "",
  estoque_atual: s.qty,
  estoque_reservado: s.res,
  estoque_disponivel: Math.max(0, s.qty - s.res),
  estoque_minimo: s.min,
  preco_unit: s.price,
  custo_total: round2(s.qty * s.price),
  rua: s.loc[0],
  prateleira: s.loc[1],
  caixa: s.loc[2],
  endereco: address(s.loc),
  estoque_tipo: "normal",
  customer_code: CUSTOMER,
  photo_urls: photoOf(s) ? [photoOf(s)!] : [],
  primary_photo_url: photoOf(s),
  updated_at: daysAgo(s.n % 5),
}));

export const products = CATALOG.map((s) => ({
  id: 100 + s.n,
  cod_cliente: clientCode(s.n),
  produto: s.name,
  categoria: s.cat,
  grupo: s.cat,
  genero: "",
  preco_unit: s.price,
  custo_total: round2(s.qty * s.price),
  estoque_btg: s.qty,
  estoque_minimo: s.min,
  customer_code: CUSTOMER,
}));

export const stockBalances = CATALOG.flatMap((s) => {
  const base = {
    customer_code: CUSTOMER,
    sku_code: code(s.n),
    client_item_code: clientCode(s.n),
    product_name: fullName(s),
    unit_cost: s.price,
    status: "active",
  };
  if (s.n === 19) {
    return [
      { ...base, id: `bal_${s.n}_a`, location_id: address(s.loc), qty_on_hand: 100, qty_reserved: 0, qty_available: 100 },
      { ...base, id: `bal_${s.n}_b`, location_id: "RECEBIMENTO", qty_on_hand: 50, qty_reserved: 0, qty_available: 50 },
    ];
  }
  return [{ ...base, id: `bal_${s.n}`, location_id: address(s.loc), qty_on_hand: s.qty, qty_reserved: s.res, qty_available: Math.max(0, s.qty - s.res) }];
});

const totalPieces = CATALOG.reduce((sum, s) => sum + s.qty, 0);
const totalCost = round2(CATALOG.reduce((sum, s) => sum + s.qty * s.price, 0));

const categories = [...new Set(CATALOG.map((s) => s.cat))].map((cat) => {
  const rows = CATALOG.filter((s) => s.cat === cat);
  return {
    categoria: cat,
    category: cat,
    total_produtos: rows.length,
    sku_count: rows.length,
    total_pecas: rows.reduce((sum, s) => sum + s.qty, 0),
    custo_total: round2(rows.reduce((sum, s) => sum + s.qty * s.price, 0)),
  };
});

/* ---------- Pessoas (fictícias) ---------- */
export const CLIENT_USER = { name: "Camila Rocha", email: "camila.rocha@tiktok.demo" };
const client2 = { name: "Diego Martins", email: "diego.martins@tiktok.demo" };
const decided = { name: "Leonardo", email: "leonardo@dutelog.com.br" };
const by = CLIENT_USER;

/* ---------- Movimentações ---------- */
const PEOPLE = ["João Operador", "Carlos Mendes", "Patrícia Souza"];
const TIPOS = ["ENTRADA", "SAIDA", "SAIDA", "ENTRADA", "AJUSTE", "SAIDA", "TRANSFERENCIA"];
export const movements = Array.from({ length: 48 }, (_, i) => {
  const s = CATALOG[(i * 7) % CATALOG.length];
  const tipo = TIPOS[i % TIPOS.length];
  const bulk = s.qty > 500;
  const qtde = bulk ? [100, 300, 500, 1000, 50, 200, 250][i % 7] : [1, 2, 4, 6, 1, 3, 2][i % 7];
  return {
    id: `mov_${3000 - i}`,
    data: iso(i * 11 * H + (i % 3) * H),
    occurred_at: iso(i * 11 * H + (i % 3) * H),
    tipo_mov: tipo,
    cod_sku: code(s.n),
    produto: fullName(s),
    qtde,
    quantidade: qtde,
    sinal: tipo === "ENTRADA" ? 1 : tipo === "SAIDA" ? -1 : 0,
    doc_nf: tipo === "ENTRADA" ? `NF 7.${640 + (i % 6) * 9}` : tipo === "SAIDA" ? `PED-04${10 + (i % 15)}` : "",
    responsavel: PEOPLE[i % PEOPLE.length],
    customer_code: CUSTOMER,
    location_id: address(s.loc),
    source: tipo === "SAIDA" ? "wms_expedition" : tipo === "ENTRADA" ? "wms_receiving" : "manual",
  };
});

/* ---------- Solicitações do cliente ---------- */
function reqItem(n: number, quantity: number, extra: R = {}) {
  const s = itemOf(n);
  return { sku_code: code(n), client_item_code: clientCode(n), product_name: fullName(s), quantity, requested_qty: quantity, location_id: address(s.loc), ...extra };
}
const qtyOf = (items: R[]) => items.reduce((sum, item) => sum + Number(item.quantity), 0);

function request(fields: R): R {
  const items: R[] = fields.items;
  return { customer_code: CUSTOMER, priority: "normal", quantity_total: qtyOf(items), item_count: items.length, requested_by_name: fields.requested_by?.name, ...fields };
}

const baseRequests: R[] = [
  request({
    id: "creq_118", request_number: "SOL-118", type: "retirada", priority: "alta", status: "submitted",
    title: "Creators Summit — lounge no Expo Center Norte",
    destination: "Expo Center Norte · Pavilhão Azul, São Paulo", due_at: inDays(2),
    items: [reqItem(1, 2), reqItem(2, 6), reqItem(4, 20), reqItem(7, 10), reqItem(13, 1), reqItem(14, 2), reqItem(15, 1)],
    created_at: ago(3), updated_at: ago(3), requested_by: by,
  }),
  request({
    id: "creq_119", request_number: "SOL-119", type: "recebimento", status: "open",
    title: "Aviso de envio NF 7.712 · Studio Móveis", supplier: "Studio Móveis", invoice_number: "7712", qty_expected: 8, due_at: inDays(2),
    items: [reqItem(3, 8, { supplier_code: "SM-POLT-CI" })], attachment_count: 1,
    attachments: [{ file_name: "NF-7712.pdf", storage_path: "customer_requests/creq_119/NF-7712.pdf" }],
    created_at: ago(1), updated_at: ago(1), requested_by: client2,
  }),
  request({
    id: "creq_120", request_number: "SOL-120", type: "retirada", status: "submitted",
    title: "Kits creator — lançamento TikTok Shop", destination: "Agência parceira · Vila Madalena, São Paulo",
    items: [reqItem(28, 120)], created_at: ago(26), updated_at: ago(26), requested_by: by,
  }),
  request({
    id: "creq_115", request_number: "SOL-115", type: "retirada", status: "approved",
    title: "Estúdio de creators — Faria Lima", order_id: "ord_415", order_number: "PED-0415", pick_task_id: "pick_ord_415",
    items: [reqItem(21, 6), reqItem(22, 4), reqItem(3, 2)], created_at: daysAgo(2), updated_at: ago(20), decided_at: ago(20), decided_by: decided, requested_by: by,
  }),
  request({
    id: "creq_116", request_number: "SOL-116", type: "retirada", priority: "alta", status: "approved", operational_status: "separating",
    title: "Ativação na Avenida Paulista — fim de semana", order_id: "ord_416", order_number: "PED-0416",
    items: [reqItem(33, 1), reqItem(38, 6), reqItem(16, 2), reqItem(17, 4), reqItem(18, 4), reqItem(24, 300), reqItem(27, 1000)], created_at: daysAgo(1), updated_at: ago(2), decided_at: ago(5), decided_by: decided, requested_by: client2,
  }),
  request({
    id: "creq_114", request_number: "SOL-114", type: "retirada", status: "approved", operational_status: "ready_to_dispatch",
    title: "Brindes — encontro com agências", order_id: "ord_414", order_number: "PED-0414",
    items: [reqItem(25, 120), reqItem(26, 120)], created_at: daysAgo(3), updated_at: ago(1), decided_at: daysAgo(3), decided_by: decided, requested_by: by,
  }),
  request({
    id: "creq_113", request_number: "SOL-113", type: "retirada", status: "approved", operational_status: "dispatched",
    title: "Sala de reunião — escritório Vila Olímpia", order_id: "ord_413", order_number: "PED-0413",
    items: [reqItem(10, 1), reqItem(11, 2)], created_at: daysAgo(4), updated_at: ago(3), decided_at: daysAgo(4), decided_by: decided, requested_by: client2,
  }),
  request({
    id: "creq_117", request_number: "SOL-117", type: "retirada", status: "rejected",
    title: "Caixas de som para sorteio", decision_reason: "A caixa de som está zerada. A reposição de 50 unidades chega na NF 7.731, prevista para 20/10.",
    items: [reqItem(23, 20)], created_at: daysAgo(2), updated_at: daysAgo(2), decided_at: daysAgo(2), decided_by: decided, requested_by: by,
  }),
  request({
    id: "creq_112", request_number: "SOL-112", type: "recebimento", status: "approved", operational_status: "checking",
    title: "Retorno do evento Rio2C", supplier: "Retorno Rio2C", invoice_number: "0981", qty_expected: 22, due_at: daysAgo(0),
    items: [reqItem(1, 2), reqItem(2, 4), reqItem(4, 16)], inbound_id: "inb_creq_112", attachment_count: 1,
    attachments: [{ file_name: "Romaneio-0981.pdf", storage_path: "customer_requests/creq_112/Romaneio-0981.pdf" }],
    created_at: daysAgo(2), updated_at: ago(2), decided_at: daysAgo(2), decided_by: decided, requested_by: client2,
  }),
  request({
    id: "creq_110", request_number: "SOL-110", type: "recebimento", status: "approved", operational_status: "planned",
    title: "Aviso de envio NF 7.731 · Gráfica Ideal", supplier: "Gráfica Ideal", invoice_number: "7731", qty_expected: 9050, due_at: inDays(2),
    items: [reqItem(27, 5000), reqItem(20, 4000), reqItem(23, 50)], inbound_id: "inb_creq_110",
    created_at: daysAgo(5), updated_at: daysAgo(4), decided_at: daysAgo(4), decided_by: decided, requested_by: by,
  }),
  request({
    id: "creq_108", request_number: "SOL-108", type: "recebimento", status: "closed", operational_status: "received",
    title: "Aviso de envio NF 7.690 · Têxtil Paulista", supplier: "Têxtil Paulista", invoice_number: "7690", qty_expected: 400, qty_received: 396, received_at: daysAgo(3),
    received_differences: [{ sku_code: code(30), product_name: fullName(itemOf(30)), expected: 200, received: 196 }],
    items: [reqItem(30, 200), reqItem(31, 200)], inbound_id: "inb_creq_108",
    created_at: daysAgo(7), updated_at: daysAgo(3), decided_at: daysAgo(6), decided_by: decided, requested_by: client2,
  }),
  request({
    id: "creq_109", request_number: "SOL-109", type: "retirada", status: "closed", operational_status: "delivered",
    title: "Moletons — equipe de marketing", order_id: "ord_409", order_number: "PED-0409", items: [reqItem(30, 40), reqItem(31, 30)],
    created_at: daysAgo(6), updated_at: daysAgo(5), decided_at: daysAgo(6), decided_by: decided, requested_by: by,
  }),
  request({
    id: "creq_107", request_number: "SOL-107", type: "retirada", status: "closed", operational_status: "delivered",
    title: "TikTok Shop Day — material de PDV", order_id: "ord_407", order_number: "PED-0407", items: [reqItem(18, 6), reqItem(19, 40), reqItem(20, 1500)],
    created_at: daysAgo(8), updated_at: daysAgo(6), decided_at: daysAgo(8), decided_by: decided, requested_by: client2,
  }),
  request({
    id: "creq_105", request_number: "SOL-105", type: "retirada", status: "closed", operational_status: "delivered",
    title: "Lounge de creators — Bienal do Livro", order_id: "ord_405", order_number: "PED-0405", items: [reqItem(1, 2), reqItem(2, 4), reqItem(12, 2)],
    created_at: daysAgo(12), updated_at: daysAgo(9), decided_at: daysAgo(12), decided_by: decided, requested_by: by,
  }),
];

/* ---------- Estado da demo (pedidos novos e decisões) ---------- */
// Um estado por idioma: kits e agenda criados numa língua não se misturam com a outra.
// v2: catálogo com os ícones TikTok e os eventos modelo; o estado salvo da v1 tinha os nomes antigos.
const STATE_KEY = LANG === "en" ? "dute.demo.state.v2.en" : "dute.demo.state.v2";
type DemoConversation = { id: string; title: string; last_message_at: string; messages: R[] };
export type Recipient = { id: string; name: string; kind: string; address: string; contact?: string; size?: string; notes?: string; created_at: string };
export type KitModel = { id: string; name: string; description?: string; message?: string; items: Array<{ sku: string; name: string; quantity: number }>; created_at: string };
/** Evento modelo: o que vai para o local, onde é, e como a Dutelog leva, monta e traz de volta. */
export type EventModel = {
  id: string;
  name: string;
  description?: string;
  venue: string;
  address: string;
  /** Próxima edição (ISO). */
  next_date?: string;
  schedule?: string;
  logistics?: string;
  items: Array<{ sku: string; name: string; quantity: number }>;
  created_at: string;
};

type DemoState = {
  created: R[];
  decisions: Record<string, R>;
  conversations: DemoConversation[];
  followUps: Record<string, R[]>;
  nextNumber: number;
  recipients: Recipient[];
  kits: KitModel[];
  events: EventModel[];
  nextId: number;
};

/* Agenda de destinatários: pessoas e endereços fictícios. */
const SEED_RECIPIENTS: Recipient[] = [
  { id: "dst_1", name: "Luana Prado", kind: "Creator", address: "Rua Harmonia, 412, apto 81 · Vila Madalena, São Paulo/SP · 05435-000", contact: "(11) 90000-0101", size: "M", notes: pick("Moda e lifestyle. Recebe na portaria até 18h.", "Fashion and lifestyle. Front desk takes deliveries until 6 pm."), created_at: daysAgo(40) },
  { id: "dst_2", name: "Rafa Nunes", kind: "Creator", address: "Av. Rebouças, 1985, apto 34 · Pinheiros, São Paulo/SP · 05401-000", contact: "(11) 90000-0102", size: "G", notes: pick("Games.", "Gaming."), created_at: daysAgo(38) },
  { id: "dst_3", name: "Bia Moreira", kind: "Creator", address: "Rua Oscar Freire, 720, apto 12 · Jardins, São Paulo/SP · 01426-000", contact: "(11) 90000-0103", size: "P", notes: pick("Beleza.", "Beauty."), created_at: daysAgo(30) },
  { id: "dst_4", name: "Thiago Ramos", kind: "Creator", address: "Rua Voluntários da Pátria, 1450 · Botafogo, Rio de Janeiro/RJ · 22270-000", contact: "(21) 90000-0104", size: "GG", notes: pick("Humor. Entrega fora de SP: prazo de 2 dias.", "Comedy. Outside São Paulo: 2-day delivery."), created_at: daysAgo(21) },
  { id: "dst_5", name: pick("Agência Pulso", "Pulso Agency"), kind: "Agência", address: "Rua Fidalga, 300 · Vila Madalena, São Paulo/SP · 05432-000", contact: "producao@pulso.demo", created_at: daysAgo(60) },
  { id: "dst_6", name: pick("Escritório Vila Olímpia", "Vila Olímpia office"), kind: "Escritório", address: "Rua Funchal, 500, 8º andar · Vila Olímpia, São Paulo/SP · 04551-060", contact: pick("Recepção", "Reception"), created_at: daysAgo(90) },
  { id: "dst_7", name: "Expo Center Norte", kind: "Evento", address: "Rua José Bernardo Pinto, 333 · Vila Guilherme, São Paulo/SP · 02055-000", contact: pick("Doca 4, montagem", "Dock 4, setup crew"), created_at: daysAgo(15) },
];

/* Kits modelo: a composição fica salva e vira pedido em um clique. */
const kitLine = (n: number, quantity: number) => ({ sku: code(n), name: fullName(itemOf(n)), quantity });
const SEED_KITS: KitModel[] = [
  {
    id: "kit_1",
    name: pick("Kit lançamento TikTok Shop", "TikTok Shop launch kit"),
    description: pick("Para creators no lançamento de campanha. O moletom segue o tamanho da agenda.", "For creators at a campaign launch. The hoodie follows the size saved in the address book."),
    message: pick(
      "Oi {nome}! O TikTok Shop chegou e você está entre as primeiras pessoas a receber o kit de lançamento. Mostra pra gente como ficou?",
      "Hi {name}! TikTok Shop is here and you're among the first to get the launch kit. Show us how it turned out!",
    ),
    items: [kitLine(30, 1), kitLine(25, 1), kitLine(26, 1), kitLine(24, 1), kitLine(27, 2)],
    created_at: daysAgo(2),
  },
  { id: "kit_2", name: pick("Kit creator estúdio", "Creator studio kit"), description: pick("Equipamento para gravar em casa.", "Gear to film at home."), items: [kitLine(21, 1), kitLine(22, 1), kitLine(27, 1)], created_at: daysAgo(12) },
  { id: "kit_3", name: pick("Kit boas-vindas parceiros", "Partner welcome kit"), description: pick("Caixa presente com material institucional.", "Gift box with company material."), items: [kitLine(28, 1), kitLine(25, 1), kitLine(20, 1)], created_at: daysAgo(20) },
];

/* Eventos modelo: a lista do que vai para cada evento fica pronta; vira pedido de ida e volta em um clique. */
const SEED_EVENTS: EventModel[] = [
  {
    id: "evt_1",
    name: "TikTok Live Fest",
    description: pick(
      "Palco principal, lounge de creators e área instagramável com o ícone gigante.",
      "Main stage, creator lounge and photo area with the giant icon.",
    ),
    venue: "Distrito Anhembi",
    address: "Av. Olavo Fontoura, 1209 · Santana, São Paulo/SP · 02012-021",
    next_date: inDays(24),
    schedule: pick("Montagem na véspera a partir das 7h · desmontagem e retorno ao galpão no dia seguinte", "Setup the day before from 7 am · teardown and return to the warehouse the next day"),
    logistics: pick("2 caminhões baú, 8 montadores e conferência peça a peça na volta", "2 box trucks, 8 crew and piece-by-piece check on return"),
    items: [
      kitLine(36, 1), kitLine(35, 2), kitLine(33, 1), kitLine(34, 2), kitLine(39, 1), kitLine(38, 10), kitLine(13, 1), kitLine(15, 2),
      kitLine(1, 4), kitLine(2, 6), kitLine(5, 12), kitLine(6, 8), kitLine(7, 24), kitLine(11, 6), kitLine(21, 4), kitLine(22, 6),
    ],
    created_at: daysAgo(30),
  },
  {
    id: "evt_2",
    name: "TikTok Shop Day",
    description: pick("Vitrine de produtos, recepção e brindes personalizados para sellers.", "Product showcase, reception and custom giveaways for sellers."),
    venue: "Hotel Unique",
    address: "Av. Brigadeiro Luís Antônio, 4700 · Jardim Paulista, São Paulo/SP · 01402-002",
    next_date: inDays(10),
    schedule: pick("Montagem às 6h · retirada às 22h no mesmo dia", "Setup at 6 am · pickup at 10 pm the same day"),
    logistics: pick("1 caminhão baú e 4 montadores", "1 box truck and 4 crew"),
    items: [
      kitLine(13, 1), kitLine(37, 4), kitLine(38, 6), kitLine(9, 6), kitLine(8, 1), kitLine(18, 8), kitLine(19, 40), kitLine(14, 2),
      kitLine(6, 6), kitLine(7, 12), kitLine(25, 200), kitLine(40, 300), kitLine(41, 200), kitLine(24, 200),
    ],
    created_at: daysAgo(18),
  },
  {
    id: "evt_3",
    name: pick("Estande TikTok · Game XP", "TikTok booth · Game XP"),
    description: pick("Estande com pórticos neon, ícone gigante, cabine de fotos e lounge gamer.", "Booth with neon arches, giant icon, photo booth and gaming lounge."),
    venue: "Parque Olímpico",
    address: "Av. Embaixador Abelardo Bueno, 3401 · Barra da Tijuca, Rio de Janeiro/RJ · 22775-040",
    next_date: inDays(45),
    schedule: pick("Montagem em 2 dias antes da abertura · desmontagem na última noite", "Setup 2 days before opening · teardown on the last night"),
    logistics: pick("Carreta São Paulo–Rio com seguro de transporte e 6 montadores", "São Paulo–Rio trailer with transit insurance and 6 crew"),
    items: [
      kitLine(33, 1), kitLine(34, 2), kitLine(39, 1), kitLine(38, 8), kitLine(1, 2), kitLine(5, 10), kitLine(15, 1), kitLine(11, 4),
      kitLine(23, 4), kitLine(42, 300), kitLine(44, 500), kitLine(26, 150),
    ],
    created_at: daysAgo(9),
  },
];

function freshState(): DemoState {
  return {
    created: [], decisions: {}, conversations: [], followUps: {}, nextNumber: 121,
    recipients: SEED_RECIPIENTS.map((item) => ({ ...item })),
    kits: SEED_KITS.map((kit) => ({ ...kit, items: kit.items.map((item) => ({ ...item })) })),
    events: SEED_EVENTS.map((event) => ({ ...event, items: event.items.map((item) => ({ ...item })) })),
    nextId: 100,
  };
}

function loadState(): DemoState {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (raw) return { ...freshState(), ...JSON.parse(raw) };
  } catch {
    // Sem storage: a demo vale só nesta aba.
  }
  return freshState();
}

let state = loadState();

function saveState() {
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Sem storage: a demo vale só nesta aba.
  }
}

/** Volta a demo ao roteiro original (pedidos criados e conversas somem). */
export function resetDemoState() {
  state = freshState();
  try {
    window.localStorage.removeItem(STATE_KEY);
  } catch {
    // nada a limpar
  }
}

export function customerRequests(): R[] {
  const all = [...state.created, ...baseRequests];
  return all.map((item) => (state.decisions[item.id] ? { ...item, ...state.decisions[item.id] } : item));
}

function createRequest(body: R) {
  const number = state.nextNumber++;
  const items: R[] = Array.isArray(body?.items) ? body.items : [];
  const created = request({
    id: `creq_${number}`,
    request_number: `SOL-${number}`,
    type: body?.type ?? "retirada",
    priority: body?.priority ?? "normal",
    status: body?.type === "recebimento" ? "open" : "submitted",
    title: body?.title || (body?.type === "recebimento" ? "Aviso de envio" : "Pedido pelo portal"),
    description: body?.description ?? "",
    destination: body?.destination ?? "",
    due_at: body?.due_at ?? null,
    supplier: body?.supplier,
    invoice_number: body?.invoice_number,
    items: items.map((item) => ({ ...item, requested_qty: item.quantity })),
    card_message: typeof body?.card_message === "string" && body.card_message.trim() ? body.card_message.trim() : undefined,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    requested_by: by,
  });
  state.created.unshift(created);
  saveState();
  return created;
}

function decideRequest(id: string, action: string, body: R) {
  const now = new Date().toISOString();
  const target = customerRequests().find((item) => item.id === id);
  if (!target) return { ok: false };
  const decision: R =
    action === "approve"
      ? { status: "approved", operational_status: target.type === "recebimento" ? "planned" : undefined, decided_at: now, decided_by: decided, updated_at: now, order_number: target.order_number ?? `PED-0${target.request_number.slice(4)}` }
      : action === "reject"
        ? { status: "rejected", decision_reason: body?.reason ?? body?.decision_reason ?? "Recusado pela Dutelog.", decided_at: now, decided_by: decided, updated_at: now }
        : { status: "closed", updated_at: now };
  state.decisions[id] = { ...(state.decisions[id] ?? {}), ...decision };
  saveState();
  return { ok: true, request: { ...target, ...decision } };
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function recipients() {
  return [...state.recipients].sort((left, right) => left.name.localeCompare(right.name, pick("pt-BR", "en-US")));
}

function saveRecipient(id: string | null, body: R) {
  const fields = { name: text(body?.name), kind: text(body?.kind) || "Creator", address: text(body?.address), contact: text(body?.contact) || undefined, size: text(body?.size) || undefined, notes: text(body?.notes) || undefined };
  if (!fields.name || !fields.address) return { ok: false, message: pick("Informe o nome e o endereço.", "Enter the name and the address.") };
  const existing = id ? state.recipients.find((item) => item.id === id) : null;
  if (existing) Object.assign(existing, fields);
  else state.recipients.push({ id: `dst_${state.nextId++}`, created_at: new Date().toISOString(), ...fields });
  saveState();
  return existing ?? state.recipients[state.recipients.length - 1];
}

function deleteRecipient(id: string) {
  state.recipients = state.recipients.filter((item) => item.id !== id);
  saveState();
  return { ok: true };
}

export function kits() {
  return [...state.kits].sort((left, right) => right.created_at.localeCompare(left.created_at));
}

function saveKit(body: R) {
  const name = text(body?.name);
  const items = (Array.isArray(body?.items) ? body.items : [])
    .map((item: R) => ({ sku: text(item.sku), name: text(item.name), quantity: Math.max(1, Math.floor(Number(item.quantity) || 0)) }))
    .filter((item: R) => item.sku);
  if (!name || !items.length) return { ok: false, message: pick("Dê um nome e escolha ao menos um item.", "Give it a name and pick at least one item.") };
  const kit: KitModel = { id: `kit_${state.nextId++}`, name, description: text(body?.description) || undefined, message: text(body?.message) || undefined, items, created_at: new Date().toISOString() };
  state.kits.push(kit);
  saveState();
  return kit;
}

export function events() {
  return [...state.events].sort((left, right) => (left.next_date ?? "9").localeCompare(right.next_date ?? "9"));
}

function saveEvent(body: R) {
  const name = text(body?.name);
  const items = (Array.isArray(body?.items) ? body.items : [])
    .map((item: R) => ({ sku: text(item.sku), name: text(item.name), quantity: Math.max(1, Math.floor(Number(item.quantity) || 0)) }))
    .filter((item: R) => item.sku);
  if (!name || !items.length) return { ok: false, message: pick("Dê um nome e escolha ao menos um item.", "Give it a name and pick at least one item.") };
  const event: EventModel = {
    id: `evt_${state.nextId++}`,
    name,
    description: text(body?.description) || undefined,
    venue: text(body?.venue),
    address: text(body?.address),
    next_date: text(body?.next_date) || undefined,
    schedule: text(body?.schedule) || undefined,
    logistics: text(body?.logistics) || undefined,
    items,
    created_at: new Date().toISOString(),
  };
  state.events.push(event);
  saveState();
  return event;
}

function deleteEvent(id: string) {
  state.events = state.events.filter((event) => event.id !== id);
  saveState();
  return { ok: true };
}

function deleteKit(id: string) {
  state.kits = state.kits.filter((kit) => kit.id !== id);
  saveState();
  return { ok: true };
}

/* ---------- Bancada WMS ---------- */
function timeline(id: string, createdTitle: string, createdAt: string, status: string, updatedAt?: string) {
  return [
    { id: `${id}_created`, title: createdTitle, status: "created", occurred_at: createdAt },
    ...(updatedAt ? [{ id: `${id}_updated`, title: "Atualização operacional", status, occurred_at: updatedAt }] : []),
  ];
}

function pickItem(id: string, n: number, quantity: number, picked = 0) {
  const s = itemOf(n);
  return { id, sku_code: code(n), sku: code(n), product_name: fullName(s), name: fullName(s), client_item_code: clientCode(n), quantity, expected_quantity: quantity, picked_quantity: picked, location: address(s.loc), source_location_id: address(s.loc), status: picked >= quantity ? "completed" : "open" };
}

const receivingTasks: R[] = [
  {
    id: "receiving:inb_creq_112", reference: "inb_creq_112", title: "Retorno do evento Rio2C", customer: CUSTOMER, status: "checking", priority: "high",
    quantity: 22, total_units: 22, customer_request_id: "creq_112", created_at: ago(2), due_at: ago(0), progress: 45,
    next_action: "Conferir o estado de cada peça e registrar o retorno", can_advance: true, can_register_exception: true, exception_count: 0,
    items: [
      { id: "ii_1", sku_code: code(1), product_name: fullName(itemOf(1)), client_item_code: clientCode(1), expected_quantity: 2, quantity: 2, received_qty: 2, conference_status: "checked", location: "RECEBIMENTO" },
      { id: "ii_2", sku_code: code(2), product_name: fullName(itemOf(2)), client_item_code: clientCode(2), expected_quantity: 4, quantity: 4, received_qty: 0, conference_status: "checking", location: "RECEBIMENTO" },
      { id: "ii_3", sku_code: code(4), product_name: fullName(itemOf(4)), client_item_code: clientCode(4), expected_quantity: 16, quantity: 16, received_qty: 8, conference_status: "checking", location: "RECEBIMENTO" },
    ],
    timeline: timeline("inb_creq_112", "Retorno de evento aprovado", daysAgo(2), "checking", ago(2)),
  },
  {
    id: "receiving:inb_creq_110", reference: "inb_creq_110", title: "NF 7.731 · Gráfica Ideal", customer: CUSTOMER, status: "planned", priority: "normal",
    quantity: 9050, total_units: 9050, customer_request_id: "creq_110", created_at: daysAgo(4), due_at: inDays(2), progress: 0,
    next_action: "Aguardando chegada prevista", can_advance: true, can_register_exception: true, exception_count: 0,
    items: [
      { id: "ii_4", sku_code: code(27), product_name: fullName(itemOf(27)), client_item_code: clientCode(27), expected_quantity: 5000, quantity: 5000, received_qty: 0, location: "RECEBIMENTO" },
      { id: "ii_5", sku_code: code(20), product_name: fullName(itemOf(20)), client_item_code: clientCode(20), expected_quantity: 4000, quantity: 4000, received_qty: 0, location: "RECEBIMENTO" },
      { id: "ii_6", sku_code: code(23), product_name: fullName(itemOf(23)), client_item_code: clientCode(23), expected_quantity: 50, quantity: 50, received_qty: 0, location: "RECEBIMENTO" },
    ],
    timeline: timeline("inb_creq_110", "Aviso de envio aprovado", daysAgo(4), "planned"),
  },
  {
    id: "receiving:inb_creq_108", reference: "inb_creq_108", title: "NF 7.690 · Têxtil Paulista", customer: CUSTOMER, status: "received", priority: "normal",
    quantity: 396, total_units: 396, customer_request_id: "creq_108", created_at: daysAgo(6), progress: 100, next_action: "Concluído", can_advance: false, can_register_exception: false, exception_count: 1,
    items: [
      { id: "ii_7", sku_code: code(30), product_name: fullName(itemOf(30)), expected_quantity: 200, quantity: 200, received_qty: 196, conference_status: "divergence", difference_qty: -4, location: address(itemOf(30).loc) },
      { id: "ii_8", sku_code: code(31), product_name: fullName(itemOf(31)), expected_quantity: 200, quantity: 200, received_qty: 200, conference_status: "checked", location: address(itemOf(31).loc) },
    ],
    timeline: timeline("inb_creq_108", "Aviso de envio aprovado", daysAgo(6), "received", daysAgo(3)),
  },
];

const putawayTasks: R[] = [
  { id: "putaway:put_1", reference: "put_1", title: pick("Guardar ", "Put away ") + itemOf(19).name, sku_code: code(19), customer: CUSTOMER, status: "planned", priority: "normal", quantity: 50, total_units: 50, source_location_id: "RECEBIMENTO", created_at: daysAgo(1), next_action: "Informar endereço final e concluir guarda.", can_advance: true, can_register_exception: true, exception_count: 0, items: [pickItem("pi_1", 19, 50)] },
  { id: "putaway:put_2", reference: "put_2", title: pick("Guardar ", "Put away ") + itemOf(1).name, sku_code: code(1), customer: CUSTOMER, status: "planned", priority: "high", quantity: 2, total_units: 2, source_location_id: "RECEBIMENTO", created_at: ago(2), next_action: "Informar endereço final e concluir guarda.", can_advance: true, can_register_exception: true, exception_count: 0, items: [pickItem("pi_2", 1, 2)] },
];

function order(num: number, requestId: string, opts: { pick: string; pack?: string; ship?: string; items: R[]; created: string; blocked?: string; progress?: number; driver?: string; seal?: string; destination?: string }) {
  const title = `PED-0${num}`;
  const ref = `ord_${num}`;
  const units = qtyOf(opts.items);
  const tasks: { pick: R; pack?: R; ship?: R } = {
    pick: {
      id: `picking:pick_${ref}`, reference: `pick_${ref}`, title, customer: CUSTOMER, status: opts.pick, priority: "normal", quantity: units, total_units: units,
      customer_request_id: requestId, created_at: opts.created, progress: opts.progress ?? (opts.pick === "completed" ? 100 : 0), items: opts.items,
      can_advance: opts.pick !== "completed", can_register_exception: opts.pick !== "completed", exception_count: opts.blocked ? 1 : 0, blocked_reason: opts.blocked,
      next_action: opts.pick === "completed" ? "Concluído" : "Separar os itens pelo endereço", timeline: timeline(`pick_${ref}`, "Pedido aprovado e separação criada", opts.created, opts.pick, ago(2)),
    },
  };
  if (opts.pack) {
    tasks.pack = { id: `packing:pack_${ref}`, reference: `pack_${ref}`, title, customer: CUSTOMER, status: opts.pack, priority: "normal", quantity: units, total_units: units, package_count: 1, volume_label: "VOL-1", seal_code: opts.seal, customer_request_id: requestId, created_at: opts.created, progress: opts.pack === "completed" ? 100 : 0, items: opts.items, can_advance: opts.pack !== "completed", can_register_exception: true, exception_count: 0 };
  }
  if (opts.ship) {
    tasks.ship = { id: `expedition:ship_${ref}`, reference: `ship_${ref}`, title, customer: CUSTOMER, status: opts.ship, priority: "normal", quantity: units, total_units: units, seal_code: opts.seal, carrier: "Dutelog", driver_name: opts.driver, vehicle_plate: opts.driver ? "GHT-4C21" : undefined, destination: opts.destination ?? "TikTok · escritório Vila Olímpia, São Paulo", customer_request_id: requestId, created_at: opts.created, progress: opts.ship === "delivered" ? 100 : opts.ship === "dispatched" ? 70 : 30, items: opts.items, can_advance: opts.ship !== "delivered", can_register_exception: true, exception_count: 0, proof_reference: opts.ship === "delivered" ? "Recebido por Juliana (recepção)" : undefined };
  }
  return tasks;
}

const orders = [
  order(415, "creq_115", { pick: "planned", items: [pickItem("pl_415_1", 21, 6), pickItem("pl_415_2", 22, 4), pickItem("pl_415_3", 3, 2)], created: daysAgo(2) }),
  order(416, "creq_116", { pick: "in_progress", progress: 60, items: [pickItem("pl_416_6", 33, 1, 1), pickItem("pl_416_7", 38, 6), pickItem("pl_416_1", 16, 2, 2), pickItem("pl_416_2", 17, 4, 4), pickItem("pl_416_3", 18, 4), pickItem("pl_416_4", 24, 300, 300), pickItem("pl_416_5", 27, 1000)], created: daysAgo(1), destination: "Avenida Paulista, 1578 · São Paulo" }),
  order(414, "creq_114", { pick: "completed", pack: "completed", ship: "ready_to_dispatch", seal: "LCR-5120", items: [pickItem("pl_414_1", 25, 120, 120), pickItem("pl_414_2", 26, 120, 120)], created: daysAgo(3), destination: "Hotel Unique · Jardim Paulista, São Paulo" }),
  order(413, "creq_113", { pick: "completed", pack: "completed", ship: "dispatched", seal: "LCR-5117", driver: "Edson Ribeiro", items: [pickItem("pl_413_1", 10, 1, 1), pickItem("pl_413_2", 11, 2, 2)], created: daysAgo(4) }),
  order(409, "creq_109", { pick: "completed", pack: "completed", ship: "delivered", seal: "LCR-5101", driver: "Edson Ribeiro", items: [pickItem("pl_409_1", 30, 40, 40), pickItem("pl_409_2", 31, 30, 30)], created: daysAgo(6) }),
  order(407, "creq_107", { pick: "completed", pack: "completed", ship: "delivered", seal: "LCR-5094", driver: "Marcos Silva", items: [pickItem("pl_407_1", 18, 6, 6), pickItem("pl_407_2", 19, 40, 40), pickItem("pl_407_3", 20, 1500, 1500)], created: daysAgo(8), destination: "Centro de convenções · Frei Caneca, São Paulo" }),
  order(405, "creq_105", { pick: "completed", pack: "completed", ship: "delivered", seal: "LCR-5080", driver: "Edson Ribeiro", items: [pickItem("pl_405_1", 1, 2, 2), pickItem("pl_405_2", 2, 4, 4), pickItem("pl_405_3", 12, 2, 2)], created: daysAgo(12), destination: "Distrito Anhembi · São Paulo" }),
];

export const warehouseOps = {
  updated_at: ago(0),
  agent_summary: "2 pedidos em separação, 1 pronto para sair e 1 em rota. O retorno do Rio2C está em conferência e 2 itens esperam guarda em RECEBIMENTO.",
  metrics: { pending_total: 7, due_soon: 2, critical: 0, throughput_today: 4, avg_sla_minutes: 38, agent_alerts: 1 },
  queues: {
    receiving: { key: "receiving", name: "Recebimento", pending: 2, in_progress: 1, completed_today: 1, sla_minutes: 120, utilization: 58, next_action: "Conferir o retorno do Rio2C", tasks: receivingTasks },
    putaway: { key: "putaway", name: "Guarda", pending: 2, in_progress: 0, completed_today: 1, sla_minutes: 240, utilization: 30, next_action: "Guardar 2 itens", tasks: putawayTasks },
    picking: { key: "picking", name: "Separação", pending: 1, in_progress: 1, completed_today: 1, sla_minutes: 90, utilization: 70, next_action: "Separar PED-0416", tasks: orders.map((o) => o.pick) },
    packing: { key: "packing", name: "Embalagem", pending: 0, in_progress: 0, completed_today: 1, sla_minutes: 45, utilization: 40, next_action: "Nenhuma", tasks: orders.map((o) => o.pack).filter(Boolean) },
    expedition: { key: "expedition", name: "Expedição", pending: 1, in_progress: 1, completed_today: 1, sla_minutes: 180, utilization: 55, next_action: "Despachar PED-0414", tasks: orders.map((o) => o.ship).filter(Boolean) },
  },
  alerts: [
    { id: "al_1", title: "Poltrona rosa com 2 peças para revisar", message: "O retorno do Rio2C trouxe 2 poltronas com o tecido marcado. Fotos anexadas na conferência.", severity: "attention", queue: "receiving", task_id: "receiving:inb_creq_112", created_at: ago(2) },
    { id: "al_2", title: "Moletom P abaixo do mínimo", message: "90 unidades para um mínimo de 100.", severity: "info", queue: "putaway", created_at: ago(9) },
  ],
};

/* ---------- Pedidos legados (coleção orders) ---------- */
export const legacyOrders = orders.map((o, i) => ({
  id: `ord_${o.pick.title.slice(5)}`,
  num_pedido: o.pick.title,
  status: o.ship?.status === "delivered" ? "ENTREGUE" : o.ship ? "FATURADO" : o.pick.status === "in_progress" ? "SEPARACAO" : "ABERTO",
  produto: o.pick.items[0].product_name,
  cod_sku: o.pick.items[0].sku_code,
  qtd_solic: o.pick.quantity,
  qtd_sep: o.ship ? o.pick.quantity : o.pick.status === "in_progress" ? Math.round(o.pick.quantity / 2) : 0,
  data_solic: o.pick.created_at,
  solicitante: i % 2 ? by.name : client2.name,
  canal: "Portal",
  customer_code: CUSTOMER,
}));

/* ---------- Faturamento ---------- */
const AD_VALOREM = 0.003;
function invoiceGroups(month: number) {
  const area = 160 + (month % 4) * 12;
  const pallets = 34 + (month % 3) * 3;
  const inVolumes = 300 + month * 14;
  const outPieces = 2400 + month * 110;
  const assemblyHours = 16 + (month % 3) * 6;
  const deliveries = 8 + (month % 3);
  const stockValue = round2(totalCost - (10 - month) * 4200);
  const adValorem = round2(stockValue * AD_VALOREM);
  return {
    custo_estoque: stockValue,
    grupos: [
      { grupo: "armazenamento", label: "Armazenamento", itens: [
        { item: "Área de mobiliário (m² no mês)", unidade: "m²", qtde: area, valor_unit: 42, total: area * 42, price_list_id: "pl_1", observacao: "Média medida no mês" },
        { item: "Posição pallet (mês)", unidade: "posição", qtde: pallets, valor_unit: 85, total: pallets * 85, price_list_id: "pl_2", observacao: "Contagem do dia 30" },
      ] },
      { grupo: "recebimento", label: "Recebimento", itens: [{ item: "Recebimento e conferência (volume)", unidade: "volume", qtde: inVolumes, valor_unit: 3.5, total: round2(inVolumes * 3.5), auto: true, auto_source: "mov_entrada_pecas" }] },
      { grupo: "expedicao", label: "Expedição", itens: [
        { item: "Separação de pedido (peça)", unidade: "peça", qtde: outPieces, valor_unit: 0.9, total: round2(outPieces * 0.9), auto: true, auto_source: "mov_saida_pecas" },
        { item: "Montagem e desmontagem de mobiliário (hora)", unidade: "hora", qtde: assemblyHours, valor_unit: 95, total: assemblyHours * 95, price_list_id: "pl_5" },
      ] },
      { grupo: "transporte", label: "Transporte", itens: [{ item: "Entrega com caminhão baú · São Paulo capital", unidade: "entrega", qtde: deliveries, valor_unit: 380, total: deliveries * 380, price_list_id: "pl_6" }] },
      { grupo: "ad_valorem", label: "Ad Valorem", itens: [{ item: `Ad valorem 0,3% sobre ${stockValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`, unidade: "%", qtde: 1, valor_unit: adValorem, total: adValorem, auto: true, auto_source: "ad_valorem" }] },
    ],
    usage: { positions: pallets, incoming_pieces: inVolumes, outgoing_pieces: outPieces, deliveries },
  };
}
function totalOf(groups: R[]) {
  return round2(groups.flatMap((g) => g.itens).reduce((sum: number, l: R) => sum + l.total, 0));
}
export const periods = ["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"].map((competencia, i) => {
  const month = Number(competencia.slice(5));
  const inv = invoiceGroups(month);
  const total = totalOf(inv.grupos);
  const status = i === 0 ? "aberto" : i === 1 ? "emitido" : "pago";
  const issued = i === 0 ? null : new Date(Date.UTC(2026, month, 3, 14, 0)).toISOString();
  const paid = status === "pago" ? new Date(Date.UTC(2026, month, 12, 11, 0)).toISOString() : null;
  return {
    id: competencia, competencia, status, total, total_cents: Math.round(total * 100), custo_estoque: inv.custo_estoque, ad_valorem_rate: AD_VALOREM,
    grupos: inv.grupos, usage: inv.usage, emitido_em: issued, issued_at: issued, email_enviado_em: issued, pago_em: paid, customer_code: CUSTOMER, customer_name: CUSTOMER,
    emission: { can_emit: i !== 0, available_from: i === 0 ? "2026-11-01T03:00:00.000Z" : issued! },
  };
});

export const billingConfig = { id: 1, cliente_nome: CUSTOMER, cliente_email: "financeiro@tiktok.demo", ad_valorem_rate: AD_VALOREM, vencimento_dias: 10 };

export const priceList = [
  { id: "pl_1", item: "Área de mobiliário (m² no mês)", grupo: "armazenamento", unidade: "m²", valor_unit: 42, preco: 42, valor: 42, ativo: true },
  { id: "pl_2", item: "Posição pallet (mês)", grupo: "armazenamento", unidade: "posição", valor_unit: 85, preco: 85, valor: 85, ativo: true },
  { id: "pl_3", item: "Recebimento e conferência (volume)", grupo: "recebimento", unidade: "volume", valor_unit: 3.5, preco: 3.5, valor: 3.5, ativo: true },
  { id: "pl_4", item: "Separação de pedido (peça)", grupo: "expedicao", unidade: "peça", valor_unit: 0.9, preco: 0.9, valor: 0.9, ativo: true },
  { id: "pl_5", item: "Montagem e desmontagem de mobiliário (hora)", grupo: "expedicao", unidade: "hora", valor_unit: 95, preco: 95, valor: 95, ativo: true },
  { id: "pl_6", item: "Entrega com caminhão baú · São Paulo capital", grupo: "transporte", unidade: "entrega", valor_unit: 380, preco: 380, valor: 380, ativo: true },
  { id: "pl_7", item: "Entrega com caminhão baú · Grande São Paulo", grupo: "transporte", unidade: "entrega", valor_unit: 520, preco: 520, valor: 520, ativo: true },
  { id: "pl_8", item: "Embalagem com manta e filme (peça de mobiliário)", grupo: "servicos", unidade: "peça", valor_unit: 28, preco: 28, valor: 28, ativo: true },
  { id: "pl_9", item: "Ad valorem", grupo: "ad_valorem", unidade: "%", valor_unit: 0.3, preco: 0.3, valor: 0.3, ativo: true, auto_source: "ad_valorem" },
];

/* ---------- Documentos ---------- */
export const documents = [
  { id: "doc_1", file_name: "Romaneio-0981-Retorno-Rio2C.pdf", type: "nf_entrada", entity_type: "recebimento", entity_id: "inb_creq_112", reference: "Romaneio 0981", customer_code: CUSTOMER, customer_visible: true, created_at: daysAgo(2), size_bytes: 184_000, content_type: "application/pdf", url: "#", download_url: "#", uploaded_by: { name: client2.name }, knowledge_status: "" },
  { id: "doc_2", file_name: "Comprovante-PED-0409.jpg", type: "comprovante_entrega", entity_type: "expedicao", entity_id: "ship_ord_409", reference: "PED-0409", customer_code: CUSTOMER, customer_visible: true, created_at: daysAgo(5), size_bytes: 920_000, content_type: "image/jpeg", url: "#", download_url: "#", uploaded_by: { name: "Edson Ribeiro" }, knowledge_status: "" },
  { id: "doc_3", file_name: "Romaneio-PED-0413.pdf", type: "romaneio", entity_type: "expedicao", entity_id: "ship_ord_413", reference: "PED-0413", customer_code: CUSTOMER, customer_visible: true, created_at: ago(3), size_bytes: 60_000, content_type: "application/pdf", url: "#", download_url: "#", uploaded_by: { name: "Sistema" }, knowledge_status: "" },
  { id: "doc_4", file_name: "Fatura-2026-09.pdf", type: "fatura", entity_type: "fatura", entity_id: "2026-09", reference: "Fatura 09/2026", customer_code: CUSTOMER, customer_visible: true, created_at: new Date(Date.UTC(2026, 9, 3, 14, 0)).toISOString(), size_bytes: 210_000, content_type: "application/pdf", url: "#", download_url: "#", uploaded_by: { name: "Renata Lima" }, knowledge_status: "" },
  { id: "doc_5", file_name: "Proposta-comercial-Dutelog.pdf", type: "contrato", entity_type: "contrato", entity_id: "ctr_1", reference: "Proposta 2026", customer_code: CUSTOMER, customer_visible: true, created_at: daysAgo(70), size_bytes: 1_400_000, content_type: "application/pdf", url: "#", download_url: "#", uploaded_by: { name: "Leonardo" }, knowledge_status: "active", knowledge_id: "kn_2" },
  { id: "doc_6", file_name: "Fotos-poltronas-retorno-Rio2C.jpg", type: "foto_avaria", entity_type: "excecao", entity_id: "wex_1", reference: "Romaneio 0981", customer_code: CUSTOMER, customer_visible: true, created_at: ago(2), size_bytes: 1_100_000, content_type: "image/jpeg", url: "#", download_url: "#", uploaded_by: { name: "João Operador" }, knowledge_status: "" },
  { id: "doc_7", file_name: "Procedimento-mobiliario.pdf", type: "operacional", entity_type: "operacional", entity_id: "", reference: "Procedimento interno", customer_code: CUSTOMER, customer_visible: false, visibility: "internal", created_at: daysAgo(20), size_bytes: 320_000, content_type: "application/pdf", url: "#", download_url: "#", uploaded_by: { name: "Patrícia Souza" }, knowledge_status: "pending_approval" },
  { id: "doc_8", file_name: "NF-7690-TextilPaulista.pdf", type: "nf_entrada", entity_type: "recebimento", entity_id: "inb_creq_108", reference: "NF 7.690", customer_code: CUSTOMER, customer_visible: true, created_at: daysAgo(7), size_bytes: 150_000, content_type: "application/pdf", url: "#", download_url: "#", uploaded_by: { name: client2.name }, knowledge_status: "" },
];

/* ---------- Agent Dute ---------- */
const baseConversations = [
  { id: "conv_1", title: pick("Mobiliário para o Creators Summit", "Furniture for the Creators Summit"), last_message_at: ago(3) },
  { id: "conv_2", title: pick("Quanto custa guardar mais 20 sofás?", "How much to store 20 more sofas?"), last_message_at: ago(30) },
  { id: "conv_3", title: pick("Resumo do dia · operação TikTok", "Daily summary · TikTok operation"), last_message_at: ago(26), routine_id: "rt_1" },
  { id: "conv_4", title: pick("Itens abaixo do mínimo", "Items below minimum"), last_message_at: daysAgo(4) },
  { id: "conv_5", title: pick("Como avisar o retorno de um evento", "How to notify an event return"), last_message_at: daysAgo(9) },
];

export function conversations() {
  return [
    ...state.conversations.map(({ id, title, last_message_at }) => ({ id, title, last_message_at })),
    ...baseConversations,
  ];
}

const chatConv1 = {
  conversation: { id: "conv_1", customer_code: CUSTOMER, status: "open", last_message_at: ago(3) },
  messages: [
    { id: "m1", role: "user", content: pick("Tenho poltronas e pufes suficientes para o Creators Summit? Preciso de 6 poltronas rosa e 20 pufes terracota.", "Do I have enough armchairs and poufs for the Creators Summit? I need 6 pink armchairs and 20 terracotta poufs."), created_at: ago(3.3) },
    { id: "m2", role: "assistant", created_at: ago(3.28), tools_used: ["resumo_estoque", "listar_pedidos"], content: pick("Dá para atender os dois.\n\n- **Poltrona lounge rosa**: 12 no galpão, todas livres.\n- **Pufe redondo terracota**: 40 no galpão, todos livres. Outros 16 voltam do Rio2C e estão em conferência hoje.\n\nSe quiser, monto o pedido com o lounge completo: sofás, banquetas, backdrop, totens e o neon.", "Yes, both are covered.\n\n- **Pink lounge armchair**: 12 in the warehouse, all available.\n- **Terracotta round pouf**: 40 in the warehouse, all available. Another 16 are coming back from Rio2C and are being checked today.\n\nIf you like, I can put together the order for the full lounge: sofas, stools, backdrop, totems and the neon sign.") },
    { id: "m3", role: "user", content: pick("Monta sim, com 2 sofás, 10 banquetas, o backdrop, 2 totens e o neon. Montagem quinta às 7h no Expo Center Norte.", "Yes, please: 2 sofas, 10 stools, the backdrop, 2 totems and the neon sign. Setup Thursday at 7 am at Expo Center Norte."), created_at: ago(3.2) },
    { id: "m4", role: "assistant", created_at: ago(3.15), tools_used: ["buscar_itens", "rascunho_pedido"], content: pick("Montei o rascunho com **7 itens e 42 peças**. Tudo tem saldo livre agora.\n\nA Dutelog leva no caminhão baú e a equipe de montagem fica no local até as 9h. Confira o endereço e o horário antes de enviar.", "I drafted the order with **7 items and 42 pieces**. Everything is available right now.\n\nDutelog delivers by box truck and the setup crew stays on site until 9 am. Check the address and time before sending.") },
    { id: "m5", role: "user", content: pick("Perfeito, pode enviar.", "Perfect, go ahead and send it."), created_at: ago(3.05) },
    { id: "m6", role: "assistant", created_at: ago(3), content: pick("Enviado. O pedido entrou como **SOL-118** e está aguardando a confirmação da Dutelog. Eu aviso aqui quando for confirmado e quando sair para a montagem.", "Sent. The order came in as **SOL-118** and is waiting for Dutelog to confirm. I'll let you know here when it's confirmed and when it leaves for setup.") },
  ],
};

const chatConv2 = {
  conversation: { id: "conv_2", customer_code: CUSTOMER, status: "open", last_message_at: ago(30) },
  messages: [
    { id: "c2m1", role: "user", content: pick("Quanto custa guardar mais 20 sofás por mês?", "How much does it cost to store 20 more sofas per month?"), created_at: ago(30.2) },
    { id: "c2m2", role: "assistant", created_at: ago(30), tools_used: ["tabela_precos"], content: pick("Pela tabela do contrato, mobiliário é cobrado por **área ocupada**: R$ 42,00 por m² no mês.\n\nUm sofá de 3 lugares ocupa cerca de 2 m² protegido com manta, então 20 sofás somam **40 m², cerca de R$ 1.680,00 por mês**. O recebimento é R$ 3,50 por volume e a embalagem com manta e filme, R$ 28,00 por peça, cobrados uma vez.", "Under the contract price list, furniture is charged by **occupied area**: R$ 42.00 per m² per month.\n\nA 3-seat sofa takes about 2 m² wrapped in a moving blanket, so 20 sofas add up to **40 m², about R$ 1,680.00 per month**. Receiving is R$ 3.50 per package and blanket-and-film wrapping is R$ 28.00 per piece, both charged once.") },
  ],
};

const scriptedChats: Record<string, { conversation: R; messages: R[] }> = { conv_1: chatConv1, conv_2: chatConv2 };

export function chatFor(id: string | null) {
  if (!id) return { messages: [] };
  const scripted = scriptedChats[id];
  if (scripted) return { ...scripted, messages: [...scripted.messages, ...(state.followUps[id] ?? [])] };
  const saved = state.conversations.find((item) => item.id === id);
  return saved ? { conversation: { id, customer_code: CUSTOMER, status: "open", last_message_at: saved.last_message_at }, messages: saved.messages } : { messages: [] };
}

export function saveConversationTurn(id: string, title: string, turn: R[]) {
  const now = new Date().toISOString();
  if (baseConversations.some((item) => item.id === id)) {
    // Pergunta nova numa conversa do roteiro: entra no fim dela, sem duplicar a conversa.
    state.followUps[id] = [...(state.followUps[id] ?? []), ...turn];
    saveState();
    return;
  }
  const existing = state.conversations.find((item) => item.id === id);
  if (existing) {
    existing.messages.push(...turn);
    existing.last_message_at = now;
  } else {
    state.conversations.unshift({ id, title: title.length > 60 ? `${title.slice(0, 57)}...` : title, last_message_at: now, messages: [...turn] });
  }
  saveState();
}

export const routines = [
  { id: "rt_1", name: "Resumo do dia", prompt: "Resuma pedidos em andamento, retornos de evento e itens abaixo do mínimo.", frequency: "weekdays", days: [1, 2, 3, 4, 5], day_of_month: null, time: "08:00", active: true, next_run_at: inDays(1), last_run_at: ago(26), last_status: "ok", conversation_id: "conv_3" },
  { id: "rt_2", name: "Itens abaixo do mínimo", prompt: "Liste os itens abaixo do estoque mínimo e sugira o que repor.", frequency: "weekly", days: [1], day_of_month: null, time: "17:30", active: true, next_run_at: inDays(6), last_run_at: daysAgo(1), last_status: "ok", conversation_id: "conv_4" },
];

export const notes = [
  { id: "note_1", text: "Mobiliário sempre sai com manta e filme", reason: "Combinado com a equipe de eventos da TikTok.", visibility: "todos", status: "active", suggested_by_name: "Leonardo", suggested_by_role: "owner", created_at: daysAgo(12) },
  { id: "note_2", text: "Montagem em pavilhão precisa de credencial da equipe até a véspera", reason: "Aconteceu no Rio2C.", visibility: "equipe", status: "pending", suggested_by_name: "Agent Dute", suggested_by_role: "agent", created_at: ago(5) },
];

const PB = [
  ["aprovar", "Aprovar uma solicitação do cliente", "Quando alguém da equipe pergunta como aprovar, recusar ou o que conferir antes de aprovar um pedido.", "equipe", "active", 14],
  ["receber", "Receber uma carga", "Quando perguntam como dar entrada em uma NF, conferir volumes ou registrar o recebimento.", "equipe", "active", 9],
  ["retorno-evento", "Receber o retorno de um evento", "Quando o mobiliário volta de um evento e precisa ser conferido peça a peça.", "equipe", "active", 4],
  ["montagem", "Montar mobiliário no local", "Quando perguntam sobre equipe de montagem, horário e credenciamento.", "equipe", "pending", 0],
  ["pedido-portal", "Fazer um pedido pelo portal", "Quando o cliente pergunta como pedir itens, quanto pode pedir ou como acompanhar.", "todos", "active", 22],
  ["envio-portal", "Avisar um envio para a Dutelog", "Quando o cliente vai mandar mercadoria para o galpão e pergunta como avisar.", "todos", "active", 7],
] as const;
export const playbooks = PB.map(([slug, title, when, audience, status, use_count]) => ({
  id: `pb_demo_${slug}`, slug, title, when, audience, status, use_count, source: "inicial",
  steps: ["Abra a tela correspondente no menu.", "Confira os dados antes de agir.", "Registre o resultado no sistema.", "Avise o cliente quando houver impacto."],
  open_points: status === "pending" ? ["Confirmar com a coordenação o prazo padrão."] : [],
  updated_by_name: status === "active" ? "Leonardo" : null, decided_by_name: status === "active" ? "Leonardo" : null, updated_at: daysAgo(5), created_at: daysAgo(6),
}));

export const notifications = [
  { id: "ntf_1", status: "sent", channel: "email", audience: "client", topic: "pedido", customer_code: CUSTOMER, title: "PED-0413 saiu para entrega", subject: "Seu pedido PED-0413 saiu para entrega", body: "Olá, Diego. A mesa de reunião e as luminárias saíram do galpão às 10h40 com o motorista Edson.", recipients: [client2.email], created_at: ago(3), sent_at: ago(3) },
  { id: "ntf_2", status: "draft", channel: "email", audience: "client", topic: "recebimento", customer_code: CUSTOMER, title: "Retorno do Rio2C em conferência", subject: "Retorno do Rio2C: 2 poltronas para revisar", body: "Duas poltronas rosa voltaram com o tecido marcado. As fotos estão nos documentos.", recipients: [by.email], created_at: ago(2) },
];

/* ---------- Painel de IA ---------- */
const aiEvents = [
  ["ev_1", "order.dispatched", "PED-0413 saiu para entrega", "Motorista Edson Ribeiro, placa GHT-4C21.", "info", ago(3)],
  ["ev_2", "receiving.started", "Conferência do retorno do Rio2C iniciada", "22 peças de mobiliário.", "info", ago(2)],
  ["ev_3", "request.created", "SOL-118 enviada pelo portal", "Creators Summit · 42 peças.", "attention", ago(3)],
  ["ev_4", "request.approved", "SOL-116 aprovada", "Ativação na Avenida Paulista · 1.317 peças.", "info", ago(5)],
  ["ev_5", "request.rejected", "SOL-117 recusada", "Caixa de som zerada.", "attention", daysAgo(2)],
  ["ev_6", "receiving.completed", "NF 7.690 recebida com diferença", "396 de 400 moletons.", "attention", daysAgo(3)],
  ["ev_7", "order.delivered", "PED-0409 entregue", "Recebido por Juliana (recepção).", "info", daysAgo(5)],
  ["ev_8", "billing.issued", "Fatura 09/2026 emitida", "Enviada para financeiro@tiktok.demo.", "info", daysAgo(10)],
].map(([id, type, title, description, severity, occurred_at]) => ({ id, type, title, description, severity, occurred_at, source: "functions", customer_code: CUSTOMER, entity_type: null, entity_id: null }));

export const aiOverview = {
  snapshot: { total_events: 268, derived_events: 0, open_insights: 2, inventory_value: totalCost, total_pieces: totalPieces, missing_costs: 0, open_orders: 4, last_event_at: ago(2) },
  inbox: [
    { id: "ins_1", title: "Retorno do Rio2C com 2 poltronas marcadas", message: "Sugiro avisar a TikTok com as fotos e separar as duas peças para limpeza antes do Creators Summit.", priority: "high", status: "open", created_at: ago(2), customer_code: CUSTOMER },
    { id: "ins_2", title: "Moletom P abaixo do mínimo", message: "90 de 100. Vale perguntar à TikTok se haverá reposição antes dos próximos eventos.", priority: "normal", status: "open", created_at: daysAgo(1), customer_code: CUSTOMER },
  ],
  events: aiEvents,
  memory: [
    { id: "mem_tt", scope_type: "cliente", scope_id: CUSTOMER, title: CUSTOMER, summary: `${CATALOG.length} SKUs, ${totalPieces.toLocaleString("pt-BR")} peças em acompanhamento.`, event_count: 268, last_event_title: "PED-0413 saiu para entrega", last_event_at: ago(3) },
    { id: "mem_kn_1", scope_type: "conhecimento", scope_id: "kn_2", title: "Proposta comercial Dutelog", summary: "Mobiliário por m², brindes por posição pallet, montagem por hora e ad valorem de 0,3%.", event_count: 1, last_event_title: "Documento aprovado", last_event_at: daysAgo(70) },
  ],
  sources: ["products", "skus", "movements", "orders", "billing_periods", "events", "ai_agent_knowledge"],
};

/* ---------- Portal do cliente ---------- */
const inventoryItems = skus.map((s) => ({
  // No portal o nome é o TIPO (filtro "Todos os tipos") e a categoria é o nome legível do cartão.
  id: `cinv_${s.cod_btg}`, sku_code: s.cod_btg, client_item_code: s.cod_cliente, product_name: s.categoria, name: s.categoria, category: s.produto, categoria: s.produto,
  color: s.cor || null, size: s.tamanho || null,
  qty_on_hand: s.estoque_atual, qty_reserved: s.estoque_reservado, qty_available: s.estoque_disponivel, unit_cost: s.preco_unit, total_value: s.custo_total, estoque_minimo: s.estoque_minimo,
  location_id: s.endereco, primary_photo_url: s.primary_photo_url, photo_urls: s.photo_urls, customer_code: CUSTOMER, updated_at: s.updated_at,
}));

export function clientOverview() {
  const requests = customerRequests();
  const open = requests.filter((item) => item.status === "submitted" || item.status === "open").length;
  return {
    customer: { name: CUSTOMER, code: CUSTOMER, document: "00.000.000/0001-00", role: "cliente" },
    updated_at: new Date().toISOString(),
    inventory: {
      total_skus: skus.length, total_pieces: totalPieces, available_pieces: skus.reduce((s, x) => s + x.estoque_disponivel, 0), reserved_pieces: skus.reduce((s, x) => s + x.estoque_reservado, 0),
      low_stock_count: skus.filter((s) => s.estoque_atual < s.estoque_minimo).length, total_value: totalCost, by_category: categories, items: inventoryItems,
    },
    stock_by_category: categories,
    billing: { current_total: periods[0].total, open_total: periods[1].total, overdue_total: 0, open_count: 1, due_soon_count: 1, items: periods.slice(1) },
    invoices: periods.slice(1),
    orders: { open: 4, pending: open, in_progress: 2, shipped: 1, recent: legacyOrders.slice(0, 5) },
    recent_orders: legacyOrders.slice(0, 5),
    requests: { open, pending: open, recent: requests.slice(0, 5) },
    recent_requests: requests.slice(0, 5),
    request_history: requests,
    document_history: documents.filter((d) => d.customer_visible),
    agent_alerts: [
      { id: "aa_1", title: "SOL-118 aguarda a confirmação da Dutelog", message: "Creators Summit · 42 peças. Enviada há 3 horas.", severity: "info", created_at: ago(3) },
      { id: "aa_2", title: "Retorno do Rio2C em conferência", message: "2 poltronas rosa voltaram com o tecido marcado. As fotos estão em Documentos.", severity: "attention", created_at: ago(2) },
    ],
    shipments: orders.filter((o) => o.ship).map((o) => ({ id: o.ship!.reference, order_number: o.ship!.title, status: o.ship!.status, destination: o.ship!.destination, total_units: o.ship!.quantity, driver_name: o.ship!.driver_name, updated_at: ago(3), items: o.ship!.items })),
    metrics: { open_requests: open, open_orders: 4, deliveries_month: 9 },
  };
}

/* ---------- Sistema ---------- */
export const systemHealth = {
  ok: true, checked_at: ago(0), firestore_ms: 34,
  last_event: { type: "order.dispatched", title: "PED-0413 saiu para entrega", occurred_at: ago(3) },
  incidents: [],
};

export const systemDashboard = {
  generated_at: ago(0),
  settings: { input_per_million: 0.35, output_per_million: 2.1, monthly_budget: 150 },
  usage: {
    priced: true,
    month: { cost: 18.2, by_kind: { chat: 12.1, rotinas: 4.0, leitura_nota: 2.1 }, projection: 61, budget: 150, over_budget: false },
    days: Array.from({ length: 9 }, (_, i) => ({ day: new Date(NOW - (8 - i) * D).toISOString().slice(0, 10), cost: [1.1, 2.2, 2.9, 0.4, 0.2, 3.4, 3.1, 2.3, 2.6][i], count: [11, 24, 27, 3, 2, 33, 30, 21, 25][i] })),
    week: { count: 141, avg_latency_ms: 2_180, fallback: 1, failed: 0, by_role: [{ role: "cliente", count: 82, cost: 8.1 }, { role: "owner", count: 33, cost: 3.6 }, { role: "interno", count: 18, cost: 1.9 }, { role: "wms", count: 8, cost: 0.8 }] },
    today: { count: 25, fallback: 0, failed: 0 },
    problems: [],
  },
  usage_truncated: false,
  routines: {
    list: routines.map((r) => ({ id: r.id, name: r.name, user_name: "Camila Rocha", frequency: r.frequency, days: r.days, day_of_month: r.day_of_month, time: r.time, active: r.active, last_status: r.last_status, last_run_at: r.last_run_at, last_attempt_at: r.last_run_at, last_error: null })),
    active: 2, failed: 0, problems: [],
  },
};

export const systemInfra = {
  checked_at: ago(0),
  settings: { billing_table: "" },
  errors: { status: "ok", total: 0, blocked: 0, services: 0, groups: [] },
  functions: { status: "ok", total: 48, ok: 48, sem_acesso: 0, nao_publicada: 0, last_deploy_at: daysAgo(6), list: [] },
  billing: { status: "ok", table: "", has_data: false, gross: 0, credits: 0, net: 0, currency: "BRL", vertex_ai: 0, data_until: daysAgo(1), services: [] },
};

export const users = [
  { id: "u_1", uid: "u_1", nome: "Leonardo", name: "Leonardo", email: "leonardo@dutelog.com.br", role: "owner", status: "active", access_state: "active", created_at: daysAgo(120) },
  { id: "u_2", uid: "u_2", nome: "Patrícia Souza", name: "Patrícia Souza", email: "patricia@dutelog.demo", role: "admin", status: "active", access_state: "active", created_at: daysAgo(100) },
  { id: "u_3", uid: "u_3", nome: "Carlos Mendes", name: "Carlos Mendes", email: "carlos@dutelog.demo", role: "interno", status: "active", access_state: "active", created_at: daysAgo(90) },
  { id: "u_4", uid: "u_4", nome: "João Operador", name: "João Operador", email: "joao@dutelog.demo", role: "wms", status: "active", access_state: "active", created_at: daysAgo(80) },
  { id: "u_5", uid: "u_5", nome: "Renata Lima", name: "Renata Lima", email: "renata@dutelog.demo", role: "financeiro", status: "active", access_state: "active", created_at: daysAgo(80) },
  { id: "u_6", uid: "u_6", nome: by.name, name: by.name, email: by.email, role: "cliente", customer_code: CUSTOMER, status: "active", access_state: "active", created_at: daysAgo(70) },
  { id: "u_7", uid: "u_7", nome: client2.name, name: client2.name, email: client2.email, role: "cliente", customer_code: CUSTOMER, status: "active", access_state: "active", created_at: daysAgo(40) },
];

export const customers = [
  { id: "cus_tiktok", code: CUSTOMER, name: CUSTOMER, legal_name: CUSTOMER_LEGAL_NAME, document: "00.000.000/0001-00", status: "active", billing_mode: "mensal", primary_contact_name: by.name, primary_contact_email: by.email, notes: "Mobiliário sempre sai com manta e filme.", created_at: daysAgo(120) },
];

export const warehouseMap = ["A", "B", "C", "D", "E", "F", "G", "H"].map((rua) => {
  const rows = skus.filter((s) => s.rua === rua);
  const prateleiras = [...new Set(rows.map((s) => s.prateleira))].map((prateleira) => ({
    prateleira,
    caixas: [...new Set(rows.filter((s) => s.prateleira === prateleira).map((s) => s.caixa))].map((caixa) => ({ caixa, skus: rows.filter((s) => s.prateleira === prateleira && s.caixa === caixa) })),
  }));
  return { rua, total_pecas: rows.reduce((s, x) => s + x.estoque_atual, 0), total_skus: rows.length, total_caixas: rows.length, prateleiras };
});

export const dashboard = {
  total_produtos: products.length, total_skus: skus.length, total_pecas: totalPieces, custo_total: totalCost, ad_valorem: totalCost * AD_VALOREM,
  recent_movements: movements.slice(0, 10), by_category: categories,
  order_status_counts: [{ status: "ABERTO", count: 1 }, { status: "SEPARACAO", count: 1 }, { status: "FATURADO", count: 2 }, { status: "ENTREGUE", count: 3 }],
};

export const foundation = {
  customer: { code: CUSTOMER, name: CUSTOMER, source: "customers" },
  metrics: { collections: 24, modules: 9, customers: 1, customer_accounts: 2, locations: 32, stock_balances: stockBalances.length, inbound_receipts: 3, order_items: 18, pick_tasks: 7, pack_tasks: 5, shipments: 5, documents: documents.length, derived_locations: 0, derived_stock_balances: 0, derived_order_items: 0, derived_inbound_receipts: 0, derived_pick_tasks: 0, derived_pack_tasks: 0 },
  modules: [],
  collections: [],
  generated_at: ago(0),
};

export const openingInventory = { ok: true, id: "oi_demo", session_id: "oi_demo", status: "completed", line_count: CATALOG.length, unit_count: totalPieces, total_cost: totalCost, started_at: daysAgo(120), completed_at: daysAgo(119), lines: [] };

export const cycleCounts = [
  { id: "cc_1", location_id: "A-01-2", sku_code: code(2), product_name: fullName(itemOf(2)), expected_qty: 12, counted_qty: null, status: "open", requested_by: "Agent Dute", created_at: ago(4) },
];

/* ---------- Posições (Estoque › Posições) ---------- */
// Prateleiras da zona da TikTok, onde a guarda da demo conclui; uma está bloqueada.
function position(aisle: string, shelf: number, sequence: number, status = "active") {
  const positionCode = `${aisle}-${String(shelf).padStart(2, "0")}`;
  return { id: positionCode, code: positionCode, aisle, shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.5, sequence, customer_code: CUSTOMER, status, source: "demo" };
}

export const warehousePositions = [
  position("A", 1, 1),
  position("A", 2, 2),
  position("E", 1, 3),
  position("E", 2, 4),
  position("E", 3, 5, "blocked"),
];

/* ---------- Roteador ---------- */
type Handler = (m: RegExpMatchArray, params: URLSearchParams, method: string, body: any) => any;
const list = (items: unknown[]) => ({ items, total: items.length, has_more: false });

const routes: Array<[string | null, RegExp, Handler]> = [
  ["POST", /^\/api\/client\/requests$/, (_m, _p, _method, body) => createRequest(body ?? {})],
  ["POST", /^\/api\/customer-requests\/([^/]+)\/(approve|reject|close)$/, (m, _p, _method, body) => decideRequest(decodeURIComponent(m[1]), m[2], body ?? {})],
  ["GET", /^\/api\/demo\/recipients$/, () => list(recipients())],
  ["POST", /^\/api\/demo\/recipients$/, (_m, _p, _method, body) => saveRecipient(null, body ?? {})],
  ["POST", /^\/api\/demo\/recipients\/([^/]+)$/, (m, _p, _method, body) => saveRecipient(decodeURIComponent(m[1]), body ?? {})],
  ["DELETE", /^\/api\/demo\/recipients\/([^/]+)$/, (m) => deleteRecipient(decodeURIComponent(m[1]))],
  ["GET", /^\/api\/demo\/kits$/, () => list(kits())],
  ["POST", /^\/api\/demo\/kits$/, (_m, _p, _method, body) => saveKit(body ?? {})],
  ["DELETE", /^\/api\/demo\/kits\/([^/]+)$/, (m) => deleteKit(decodeURIComponent(m[1]))],
  ["GET", /^\/api\/demo\/events$/, () => list(events())],
  ["POST", /^\/api\/demo\/events$/, (_m, _p, _method, body) => saveEvent(body ?? {})],
  ["DELETE", /^\/api\/demo\/events\/([^/]+)$/, (m) => deleteEvent(decodeURIComponent(m[1]))],
  [null, /^\/api\/healthz$/, () => ({ ok: true })],
  [null, /^\/api\/dashboard$/, () => dashboard],
  [null, /^\/api\/warehouse\/ops$/, () => warehouseOps],
  [null, /^\/api\/warehouse\/map$/, () => warehouseMap],
  [null, /^\/api\/warehouse\/opening-inventory\/session$/, () => openingInventory],
  [null, /^\/api\/warehouse\/cycle-counts$/, () => list(cycleCounts)],
  ["GET", /^\/api\/warehouse\/positions$/, () => list(warehousePositions)],
  ["GET", /^\/api\/customer-requests$/, () => list(customerRequests())],
  [null, /^\/api\/skus$/, () => list(skus)],
  [null, /^\/api\/products$/, () => list(products)],
  [null, /^\/api\/products\/stats$/, () => categories],
  [null, /^\/api\/stock-balances$/, () => list(stockBalances)],
  [null, /^\/api\/movements$/, (_m, params) => {
    const type = params.get("tipo_mov");
    const items = type ? movements.filter((m) => m.tipo_mov === type) : movements;
    return { items: items.slice(0, Number(params.get("limit") ?? 50)), total: items.length, has_more: false };
  }],
  [null, /^\/api\/orders$/, () => list(legacyOrders)],
  [null, /^\/api\/reports\/movements$/, () => ({ items: movements, capped: false })],
  [null, /^\/api\/reports\/requests$/, () => ({ items: customerRequests(), capped: false })],
  [null, /^\/api\/documents$/, () => list(documents)],
  [null, /^\/api\/customers$/, () => list(customers)],
  [null, /^\/api\/billing\/users$/, () => list(users)],
  [null, /^\/api\/billing\/config$/, () => billingConfig],
  [null, /^\/api\/billing\/price-list$/, () => list(priceList)],
  [null, /^\/api\/billing\/periods$/, () => ({ items: periods })],
  [null, /^\/api\/billing\/periods\/([^/]+)$/, (m) => periods.find((p) => p.competencia === decodeURIComponent(m[1])) ?? periods[0]],
  [null, /^\/api\/billing\/periods\/([^/]+)\/evidence$/, () => ({ movements: movements.slice(0, 20), positions: 36 })],
  [null, /^\/api\/billing\/me$/, () => ({ cliente_nome: CUSTOMER, role: "cliente" })],
  [null, /^\/api\/billing\/me\/current$/, () => periods[0]],
  [null, /^\/api\/billing\/me\/invoices$/, () => ({ items: periods })],
  [null, /^\/api\/client\/overview$/, () => clientOverview()],
  [null, /^\/api\/agent-dute\/conversations$/, () => ({ conversations: conversations() })],
  [null, /^\/api\/agent-dute\/chat$/, (_m, params) => chatFor(params.get("conversation_id"))],
  [null, /^\/api\/agent-dute\/routines$/, () => ({ routines })],
  [null, /^\/api\/agent-dute\/notes$/, () => ({ notes })],
  [null, /^\/api\/agent-dute\/playbooks$/, () => ({ playbooks })],
  [null, /^\/api\/agent-dute\/notifications$/, () => list(notifications)],
  [null, /^\/api\/ai\/overview$/, () => aiOverview],
  [null, /^\/api\/ai\/events$/, () => ({ items: aiEvents })],
  [null, /^\/api\/operational\/foundation$/, () => foundation],
  [null, /^\/api\/system\/health$/, () => systemHealth],
  [null, /^\/api\/system\/dashboard$/, () => systemDashboard],
  [null, /^\/api\/system\/infra$/, () => systemInfra],
  [null, /^\/api\/system\/request-numbers$/, () => ({ dry_run: true, assigned_count: 0, total: 0, pending: 0 })],
];

/** Resposta da demo para uma chamada /api; null quando a rota não tem dado de exemplo. */
export function resolve(pathname: string, method: string, params: URLSearchParams, body: any) {
  for (const [verb, regex, handler] of routes) {
    if (verb && verb !== method) continue;
    const match = pathname.match(regex);
    if (match) return handler(match, params, method, body);
  }
  return null;
}

/** Números que o agente da demo usa nas respostas. */
export const demoFacts = { catalog: CATALOG, code, fullName, totalPieces, totalCost, periods, kits, events };
