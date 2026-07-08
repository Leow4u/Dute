import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { firestore } from "./firebase";
import { isDemoMode } from "./demo-mode";

type AnyRecord = Record<string, any>;
type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

const collectionNames = {
  products: "products",
  skus: "skus",
  movements: "movements",
  orders: "orders",
  priceList: "billing_price_list",
  periods: "billing_periods",
  manual: "billing_manual",
  users: "users",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readBody(init?: RequestInit): Promise<AnyRecord> {
  if (!init?.body) return {};
  if (typeof init.body === "string") return JSON.parse(init.body);
  return JSON.parse(await new Response(init.body).text());
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return "";
}

function normalizeDoc(snapshot: any): AnyRecord {
  const data = snapshot.data() as AnyRecord;
  const numericId = Number(snapshot.id);
  return {
    ...data,
    id: data.id ?? (Number.isFinite(numericId) ? numericId : snapshot.id),
    _docId: snapshot.id,
  };
}

async function readAll(name: string): Promise<AnyRecord[]> {
  if (!firestore) return [];
  const snapshot = await getDocs(collection(firestore, name));
  return snapshot.docs.map(normalizeDoc);
}

async function findDocRef(name: string, id: string | number) {
  if (!firestore) throw new Error("Firestore não configurado.");

  const direct = doc(firestore, name, String(id));
  const directSnapshot = await getDoc(direct);
  if (directSnapshot.exists()) return direct;

  const byId = await getDocs(
    query(collection(firestore, name), where("id", "==", Number(id))),
  );
  if (!byId.empty) return byId.docs[0].ref;

  throw new Error(`Registro não encontrado: ${name}/${id}`);
}

function includes(value: unknown, needle: string): boolean {
  return String(value ?? "").toLowerCase().includes(needle.toLowerCase());
}

function filterAndPage(
  rows: AnyRecord[],
  params: URLSearchParams,
  filters: string[],
  searchFields: string[],
): { items: AnyRecord[]; total: number } {
  let result = [...rows];

  for (const field of filters) {
    const value = params.get(field);
    if (value) result = result.filter((row) => includes(row[field], value));
  }

  const search = params.get("search");
  if (search) {
    result = result.filter((row) =>
      searchFields.some((field) => includes(row[field], search)),
    );
  }

  const from = params.get("date_from");
  const to = params.get("date_to");
  if (from) result = result.filter((row) => toIso(row.data ?? row.data_solic) >= from);
  if (to) result = result.filter((row) => toIso(row.data ?? row.data_solic) <= to);

  const total = result.length;
  const offset = Number(params.get("offset") ?? 0);
  const limit = Number(params.get("limit") ?? total);
  return { items: result.slice(offset, offset + limit), total };
}

async function createItem(name: string, data: AnyRecord) {
  if (!firestore) throw new Error("Firestore não configurado.");
  const id = data.id ?? Date.now();
  const payload = {
    ...data,
    id,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };
  await setDoc(doc(firestore, name, String(id)), payload);
  return { ...payload, created_at: undefined, updated_at: undefined };
}

async function updateItem(name: string, id: string | number, data: AnyRecord) {
  const ref = await findDocRef(name, id);
  await updateDoc(ref, { ...data, updated_at: serverTimestamp() });
  const snapshot = await getDoc(ref);
  return normalizeDoc(snapshot);
}

async function deleteItem(name: string, id: string | number) {
  const ref = await findDocRef(name, id);
  await deleteDoc(ref);
}

function categoryStats(products: AnyRecord[]) {
  const byCategory = new Map<string, { categoria: string; total_pecas: number; custo_total: number }>();
  for (const product of products) {
    const categoria = product.categoria || "Sem categoria";
    const current =
      byCategory.get(categoria) ?? { categoria, total_pecas: 0, custo_total: 0 };
    current.total_pecas += Number(product.estoque_btg ?? 0);
    current.custo_total += Number(product.custo_total ?? 0);
    byCategory.set(categoria, current);
  }
  return [...byCategory.values()];
}

async function getDashboard() {
  const [products, skus, movements, orders] = await Promise.all([
    readAll(collectionNames.products),
    readAll(collectionNames.skus),
    readAll(collectionNames.movements),
    readAll(collectionNames.orders),
  ]);

  const orderStatus = new Map<string, number>();
  for (const order of orders) {
    const status = order.status || "SEM_STATUS";
    orderStatus.set(status, (orderStatus.get(status) ?? 0) + 1);
  }

  return {
    total_produtos: products.length,
    total_skus: skus.length,
    total_pecas: skus.reduce((sum, sku) => sum + Number(sku.estoque_atual ?? 0), 0),
    custo_total: products.reduce((sum, product) => sum + Number(product.custo_total ?? 0), 0),
    ad_valorem: products.reduce((sum, product) => sum + Number(product.custo_total ?? 0), 0) * 0.005,
    recent_movements: movements
      .sort((a, b) => toIso(b.data).localeCompare(toIso(a.data)))
      .slice(0, 10),
    by_category: categoryStats(products),
    order_status_counts: [...orderStatus.entries()].map(([status, count]) => ({
      status,
      count,
    })),
  };
}

async function getWarehouseMap() {
  const skus = await readAll(collectionNames.skus);
  const ruas = new Map<string, AnyRecord>();

  for (const sku of skus) {
    const rua = sku.rua || "Sem rua";
    const prateleira = sku.prateleira || "Sem prateleira";
    const caixa = sku.caixa || "Sem caixa";

    if (!ruas.has(rua)) {
      ruas.set(rua, { rua, total_pecas: 0, total_skus: 0, total_caixas: 0, prateleiras: [] });
    }

    const ruaData = ruas.get(rua)!;
    ruaData.total_pecas += Number(sku.estoque_atual ?? 0);
    ruaData.total_skus += 1;

    let shelf = ruaData.prateleiras.find((item: AnyRecord) => item.prateleira === prateleira);
    if (!shelf) {
      shelf = { prateleira, caixas: [] };
      ruaData.prateleiras.push(shelf);
    }

    let box = shelf.caixas.find((item: AnyRecord) => item.caixa === caixa);
    if (!box) {
      box = { caixa, skus: [] };
      shelf.caixas.push(box);
      ruaData.total_caixas += 1;
    }
    box.skus.push(sku);
  }

  return [...ruas.values()];
}

async function getBillingConfig() {
  if (!firestore) throw new Error("Firestore não configurado.");
  const ref = doc(firestore, "billing_config", "default");
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) return { id: 1, ...snapshot.data() };
  return {
    id: 1,
    cliente_nome: "BTG Pactual",
    cliente_email: "",
    ad_valorem_rate: 0.005,
  };
}

async function getBillingPeriod(competencia: string) {
  if (!firestore) throw new Error("Firestore não configurado.");
  const periodRef = doc(firestore, collectionNames.periods, competencia);
  const periodSnapshot = await getDoc(periodRef);
  const saved = periodSnapshot.exists() ? periodSnapshot.data() : {};
  const config = await getBillingConfig();
  const [products, movements, priceList, manualSnapshot] = await Promise.all([
    readAll(collectionNames.products),
    readAll(collectionNames.movements),
    readAll(collectionNames.priceList),
    getDoc(doc(firestore, collectionNames.manual, competencia)),
  ]);

  const manual = manualSnapshot.exists() ? manualSnapshot.data().items ?? [] : [];
  const custoEstoque = products.reduce((sum, product) => sum + Number(product.custo_total ?? 0), 0);
  const saidas = movements
    .filter((mov) => toIso(mov.data).startsWith(competencia))
    .filter((mov) => Number(mov.sinal ?? 0) < 0)
    .reduce((sum, mov) => sum + Number(mov.qtde ?? 0), 0);

  const itens = priceList
    .filter((item) => item.ativo !== false)
    .map((item) => {
      const manualItem = manual.find((entry: AnyRecord) => entry.price_list_id === item.id);
      const autoSource = item.auto_source;
      const qtde =
        autoSource === "ad_valorem"
          ? custoEstoque
          : autoSource === "mov_saida_pecas"
            ? saidas
            : Number(manualItem?.qtde ?? 0);
      const valorUnit =
        autoSource === "ad_valorem"
          ? Number(config.ad_valorem_rate ?? 0.005)
          : Number(item.valor_unit ?? 0);
      return {
        price_list_id: item.id,
        item: item.item,
        unidade: item.unidade,
        qtde,
        valor_unit: valorUnit,
        total: qtde * valorUnit,
        observacao: manualItem?.observacao ?? "",
        auto: Boolean(autoSource),
      };
    });

  const gruposMap = new Map<string, AnyRecord>();
  for (const item of itens) {
    const price = priceList.find((entry) => entry.id === item.price_list_id);
    const grupo = price?.grupo || "outros";
    const group = gruposMap.get(grupo) ?? {
      grupo,
      label: grupo.replace(/_/g, " "),
      total: 0,
      itens: [],
    };
    group.total += item.total;
    group.itens.push(item);
    gruposMap.set(grupo, group);
  }

  return {
    competencia,
    status: saved.status ?? "aberto",
    custo_estoque: custoEstoque,
    ad_valorem_rate: Number(config.ad_valorem_rate ?? 0.005),
    grupos: [...gruposMap.values()],
    total: [...gruposMap.values()].reduce((sum, group) => sum + group.total, 0),
    emitido_em: saved.emitido_em ?? null,
    email_enviado_em: saved.email_enviado_em ?? null,
    pago_em: saved.pago_em ?? null,
  };
}

async function route(pathname: string, method: HttpMethod, searchParams: URLSearchParams, init?: RequestInit) {
  if (!firestore) return json({ message: "Firebase não configurado." }, 503);

  if (pathname === "/api/healthz") return json({ ok: true });
  if (pathname === "/api/dashboard") return json(await getDashboard());

  if (pathname === "/api/products/stats") {
    return json(categoryStats(await readAll(collectionNames.products)));
  }

  const listRoutes: Array<[RegExp, string, string[], string[]]> = [
    [/^\/api\/products$/, collectionNames.products, ["categoria", "grupo", "genero"], ["cod_cliente", "produto", "categoria", "grupo"]],
    [/^\/api\/skus$/, collectionNames.skus, ["cod_cliente", "rua", "prateleira", "estoque_tipo"], ["cod_btg", "cod_cliente", "produto"]],
    [/^\/api\/movements$/, collectionNames.movements, ["cod_sku", "tipo_mov", "responsavel"], ["cod_sku", "produto", "doc_nf"]],
    [/^\/api\/orders$/, collectionNames.orders, ["status", "num_pedido", "solicitante"], ["num_pedido", "produto", "solicitante"]],
    [/^\/api\/billing\/price-list$/, collectionNames.priceList, [], ["item", "grupo"]],
    [/^\/api\/billing\/users$/, collectionNames.users, [], ["nome", "email"]],
  ];

  for (const [regex, name, filters, searchFields] of listRoutes) {
    if (regex.test(pathname) && method === "GET") {
      return json(filterAndPage(await readAll(name), searchParams, filters, searchFields));
    }
  }

  if (pathname === "/api/warehouse/map") return json(await getWarehouseMap());

  if (pathname === "/api/reports/export") {
    const type = searchParams.get("type");
    const name =
      type === "orders"
        ? collectionNames.orders
        : type === "movements"
          ? collectionNames.movements
          : collectionNames.products;
    return json({ generated_at: new Date().toISOString(), data: await readAll(name) });
  }

  if (pathname === "/api/billing/me") {
    const config = await getBillingConfig();
    return json({ cliente_nome: config.cliente_nome, role: "cliente" });
  }

  if (pathname === "/api/billing/config") {
    if (method === "GET") return json(await getBillingConfig());
    const body = await readBody(init);
    await setDoc(doc(firestore, "billing_config", "default"), {
      ...body,
      updated_at: serverTimestamp(),
    }, { merge: true });
    return json(await getBillingConfig());
  }

  if (pathname === "/api/billing/periods" && method === "GET") {
    const periods = await readAll(collectionNames.periods);
    return json({ items: periods });
  }

  const periodMatch = pathname.match(/^\/api\/billing\/periods\/([^/]+)(?:\/([^/]+))?$/);
  if (periodMatch) {
    const competencia = decodeURIComponent(periodMatch[1]);
    const action = periodMatch[2];
    if (!action && method === "GET") return json(await getBillingPeriod(competencia));
    if (action === "manual" && method === "PUT") {
      const body = await readBody(init);
      await setDoc(doc(firestore, collectionNames.manual, competencia), {
        items: body.items ?? [],
        updated_at: serverTimestamp(),
      });
      return json(await getBillingPeriod(competencia));
    }
    if (action === "emit" && method === "POST") {
      await setDoc(doc(firestore, collectionNames.periods, competencia), {
        competencia,
        status: "emitido",
        emitido_em: new Date().toISOString(),
        updated_at: serverTimestamp(),
      }, { merge: true });
      return json({ ok: true, email: { sent: false } });
    }
    if (action === "pay" && method === "POST") {
      await setDoc(doc(firestore, collectionNames.periods, competencia), {
        competencia,
        status: "pago",
        pago_em: new Date().toISOString(),
        updated_at: serverTimestamp(),
      }, { merge: true });
      return json(await getBillingPeriod(competencia));
    }
  }

  if (pathname === "/api/billing/me/current") {
    return json(await getBillingPeriod(new Date().toISOString().slice(0, 7)));
  }

  if (pathname === "/api/billing/me/invoices") {
    return json({ items: await readAll(collectionNames.periods) });
  }

  if (pathname === "/api/import" && method === "POST") {
    const body = await readBody(init);
    const batches = [
      [collectionNames.products, body.products ?? []],
      [collectionNames.skus, body.skus ?? []],
      [collectionNames.movements, body.movements ?? []],
      [collectionNames.orders, body.orders ?? []],
    ] as const;
    let inserted = 0;
    for (const [name, items] of batches) {
      for (const item of items) {
        await createItem(name, item);
        inserted += 1;
      }
    }
    return json({ ok: true, inserted, errors: [] });
  }

  const entityMatch = pathname.match(/^\/api\/(products|skus|orders|billing\/price-list|billing\/users)(?:\/([^/]+))?$/);
  if (entityMatch) {
    const segment = entityMatch[1];
    const id = entityMatch[2];
    const name =
      segment === "billing/price-list"
        ? collectionNames.priceList
        : segment === "billing/users"
          ? collectionNames.users
          : collectionNames[segment as "products" | "skus" | "orders"];

    if (method === "POST") return json(await createItem(name, await readBody(init)), 201);
    if (id && (method === "PATCH" || method === "PUT")) return json(await updateItem(name, id, await readBody(init)));
    if (id && method === "DELETE") {
      await deleteItem(name, id);
      return json(null, 204);
    }
  }

  const roleMatch = pathname.match(/^\/api\/billing\/users\/([^/]+)\/role$/);
  if (roleMatch && method === "PATCH") {
    return json(await updateItem(collectionNames.users, roleMatch[1], await readBody(init)));
  }

  if (pathname === "/api/movements" && method === "POST") {
    return json(await createItem(collectionNames.movements, await readBody(init)), 201);
  }

  return json({ message: "Rota Firebase não implementada", pathname }, 404);
}

export function installCloudApi() {
  if (isDemoMode || window.__duteCloudApiInstalled) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input.toString(),
      window.location.origin,
    );

    if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);

    try {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() as HttpMethod;
      return await route(url.pathname, method, url.searchParams, init);
    } catch (error) {
      return json(
        {
          message:
            error instanceof Error
              ? error.message
              : "Erro ao acessar o Firebase.",
        },
        500,
      );
    }
  };

  window.__duteCloudApiInstalled = true;
}

declare global {
  interface Window {
    __duteCloudApiInstalled?: boolean;
  }
}
