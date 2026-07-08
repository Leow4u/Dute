import { isDemoMode } from "./demo-mode";

const products = [
  {
    id: 1,
    cod_cliente: "BTG-MOB-001",
    produto: "Cadeira Operacional Ergonômica",
    genero: "Mobiliário",
    categoria: "Cadeiras",
    grupo: "Workplace",
    cor: "Preta",
    tamanho: "Único",
    preco_unit: 740,
    estoque_btg: 128,
    num_skus: 3,
    custo_total: 94720,
  },
  {
    id: 2,
    cod_cliente: "BTG-MOB-018",
    produto: "Mesa Plataforma 140x70",
    genero: "Mobiliário",
    categoria: "Mesas",
    grupo: "Workplace",
    cor: "Carvalho",
    tamanho: "140x70",
    preco_unit: 1180,
    estoque_btg: 84,
    num_skus: 2,
    custo_total: 99120,
  },
  {
    id: 3,
    cod_cliente: "BTG-TEC-022",
    produto: "Monitor LED 27 polegadas",
    genero: "Tecnologia",
    categoria: "Equipamentos",
    grupo: "TI",
    cor: "Preto",
    tamanho: "27",
    preco_unit: 1320,
    estoque_btg: 56,
    num_skus: 2,
    custo_total: 73920,
  },
];

const skus = [
  {
    id: 1,
    cod_btg: "SKU-BTG-0001",
    cod_cliente: "BTG-MOB-001",
    produto: "Cadeira Operacional Ergonômica",
    estoque_tipo: "BTG",
    genero: "Mobiliário",
    categoria: "Cadeiras",
    cor: "Preta",
    tamanho: "Único",
    estoque_atual: 74,
    estado: "NOVO",
    rua: "A",
    prateleira: "01",
    caixa: "C01",
  },
  {
    id: 2,
    cod_btg: "SKU-BTG-0002",
    cod_cliente: "BTG-MOB-018",
    produto: "Mesa Plataforma 140x70",
    estoque_tipo: "BTG",
    genero: "Mobiliário",
    categoria: "Mesas",
    cor: "Carvalho",
    tamanho: "140x70",
    estoque_atual: 42,
    estado: "NOVO",
    rua: "A",
    prateleira: "02",
    caixa: "C03",
  },
  {
    id: 3,
    cod_btg: "SKU-BTG-0003",
    cod_cliente: "BTG-TEC-022",
    produto: "Monitor LED 27 polegadas",
    estoque_tipo: "BTG",
    genero: "Tecnologia",
    categoria: "Equipamentos",
    cor: "Preto",
    tamanho: "27",
    estoque_atual: 56,
    estado: "NOVO",
    rua: "B",
    prateleira: "01",
    caixa: "C07",
  },
];

const movements = [
  {
    id: 1,
    data: "2026-07-08T10:15:00.000Z",
    tipo_mov: "ENTRADA",
    cod_sku: "SKU-BTG-0001",
    produto: "Cadeira Operacional Ergonômica",
    qtde: 24,
    sinal: 1,
    origem: "Fornecedor",
    destino: "ESTOQUE_BTG",
    responsavel: "Operação Dute",
    doc_nf: "NF-18422",
  },
  {
    id: 2,
    data: "2026-07-07T14:45:00.000Z",
    tipo_mov: "SAIDA",
    cod_sku: "SKU-BTG-0002",
    produto: "Mesa Plataforma 140x70",
    qtde: 12,
    sinal: -1,
    origem: "ESTOQUE_BTG",
    destino: "Andar Corporativo",
    responsavel: "Equipe Relocation",
    doc_nf: "REQ-319",
  },
  {
    id: 3,
    data: "2026-07-06T09:20:00.000Z",
    tipo_mov: "ENTRADA",
    cod_sku: "SKU-BTG-0003",
    produto: "Monitor LED 27 polegadas",
    qtde: 18,
    sinal: 1,
    origem: "TI",
    destino: "ESTOQUE_BTG",
    responsavel: "Operação Dute",
    doc_nf: "NF-18398",
  },
];

const orders = [
  {
    id: 1,
    num_pedido: "REQ-319",
    data_solic: "2026-07-07T12:00:00.000Z",
    cod_cliente: "BTG Pactual",
    canal: "Workplace",
    produto: "Mesa Plataforma 140x70",
    qtd_solic: 20,
    qtd_sep: 12,
    status: "SEPARACAO",
  },
  {
    id: 2,
    num_pedido: "REQ-320",
    data_solic: "2026-07-08T09:00:00.000Z",
    cod_cliente: "BTG Pactual",
    canal: "Facilities",
    produto: "Cadeira Operacional Ergonômica",
    qtd_solic: 32,
    qtd_sep: 32,
    status: "FATURADO",
  },
];

const priceList = [
  {
    id: 1,
    grupo: "armazenamento",
    item: "Armazenagem por posição",
    unidade: "posição/mês",
    valor_unit: 42,
    auto_source: null,
    ordem: 1,
    ativo: true,
  },
  {
    id: 2,
    grupo: "ad_valorem",
    item: "Ad Valorem sobre estoque",
    unidade: "% estoque",
    valor_unit: 0,
    auto_source: "ad_valorem",
    ordem: 2,
    ativo: true,
  },
  {
    id: 3,
    grupo: "expedicao",
    item: "Separação e expedição",
    unidade: "peça",
    valor_unit: 3.5,
    auto_source: "mov_saida_pecas",
    ordem: 3,
    ativo: true,
  },
];

const billingPeriod = {
  competencia: "2026-07",
  status: "aberto",
  custo_estoque: 267760,
  ad_valorem_rate: 0.0015,
  total: 14882.64,
  grupos: [
    {
      grupo: "armazenamento",
      label: "Armazenamento",
      total: 10248,
      itens: [
        {
          price_list_id: 1,
          item: "Armazenagem por posição",
          unidade: "posição/mês",
          qtde: 244,
          valor_unit: 42,
          total: 10248,
          observacao: "Base demo",
          auto: false,
        },
      ],
    },
    {
      grupo: "ad_valorem",
      label: "Ad Valorem",
      total: 401.64,
      itens: [
        {
          price_list_id: 2,
          item: "Ad Valorem sobre estoque",
          unidade: "% estoque",
          qtde: 267760,
          valor_unit: 0.0015,
          total: 401.64,
          observacao: "Calculado automaticamente",
          auto: true,
        },
      ],
    },
    {
      grupo: "expedicao",
      label: "Expedição",
      total: 4233,
      itens: [
        {
          price_list_id: 3,
          item: "Separação e expedição",
          unidade: "peça",
          qtde: 1209.43,
          valor_unit: 3.5,
          total: 4233,
          observacao: "Saídas do período",
          auto: true,
        },
      ],
    },
  ],
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function list(items: unknown[]) {
  return { items, total: items.length };
}

function matchApi(pathname: string, method: string) {
  if (method !== "GET") {
    return json({ ok: true, demo: true });
  }

  if (pathname === "/api/healthz") return json({ ok: true });
  if (pathname === "/api/dashboard") {
    return json({
      total_produtos: 600,
      total_skus: 932,
      total_pecas: 1261,
      custo_total: 267760,
      ad_valorem: 401.64,
      by_category: [
        { categoria: "Cadeiras", total_pecas: 420 },
        { categoria: "Mesas", total_pecas: 318 },
        { categoria: "Equipamentos", total_pecas: 210 },
        { categoria: "Arquivos", total_pecas: 156 },
      ],
      recent_movements: movements,
      order_status_counts: [
        { status: "PENDENTE", count: 18 },
        { status: "SEPARACAO", count: 9 },
        { status: "FATURADO", count: 12 },
        { status: "ENTREGUE", count: 44 },
      ],
    });
  }
  if (pathname === "/api/products") return json(list(products));
  if (pathname === "/api/products/stats") {
    return json([
      { categoria: "Cadeiras", total_pecas: 420, custo_total: 94720 },
      { categoria: "Mesas", total_pecas: 318, custo_total: 99120 },
      { categoria: "Equipamentos", total_pecas: 210, custo_total: 73920 },
    ]);
  }
  if (pathname === "/api/skus") return json(list(skus));
  if (pathname === "/api/movements") return json(list(movements));
  if (pathname === "/api/orders") return json(list(orders));
  if (pathname === "/api/warehouse/map") {
    return json([
      {
        rua: "A",
        total_pecas: 116,
        total_skus: 2,
        total_caixas: 2,
        prateleiras: [
          {
            prateleira: "01",
            caixas: [{ caixa: "C01", skus: [skus[0]] }],
          },
          {
            prateleira: "02",
            caixas: [{ caixa: "C03", skus: [skus[1]] }],
          },
        ],
      },
      {
        rua: "B",
        total_pecas: 56,
        total_skus: 1,
        total_caixas: 1,
        prateleiras: [
          {
            prateleira: "01",
            caixas: [{ caixa: "C07", skus: [skus[2]] }],
          },
        ],
      },
    ]);
  }
  if (pathname === "/api/reports/export") {
    return json({ generated_at: new Date().toISOString(), data: products });
  }
  if (pathname === "/api/billing/me") {
    return json({ cliente_nome: "BTG Pactual", role: "cliente" });
  }
  if (pathname === "/api/billing/price-list") return json(list(priceList));
  if (pathname === "/api/billing/config") {
    return json({
      id: 1,
      cliente_nome: "BTG Pactual",
      cliente_email: "facilities@btgpactual.com",
      ad_valorem_rate: 0.0015,
    });
  }
  if (pathname === "/api/billing/periods") {
    return json({
      items: [
        { competencia: "2026-07", status: "aberto", total: 14882.64 },
        { competencia: "2026-06", status: "emitido", total: 13970.2 },
      ],
    });
  }
  if (pathname.startsWith("/api/billing/periods/")) return json(billingPeriod);
  if (pathname === "/api/billing/me/current") return json(billingPeriod);
  if (pathname === "/api/billing/me/invoices") {
    return json({
      items: [{ competencia: "2026-06", status: "emitido", total: 13970.2 }],
    });
  }
  if (pathname === "/api/billing/users") {
    return json({
      items: [
        {
          id: "demo-1",
          nome: "Equipe Dute",
          email: "operacao@dute.com.br",
          role: "interno",
        },
        {
          id: "demo-2",
          nome: "Cliente BTG",
          email: "facilities@btgpactual.com",
          role: "cliente",
        },
      ],
    });
  }

  return json({ message: "Rota demo não implementada", pathname }, 404);
}

export function installDemoApi() {
  if (!isDemoMode || window.__duteDemoApiInstalled) return;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input.toString(),
      window.location.origin,
    );

    if (url.pathname.startsWith("/api/")) {
      const method =
        init?.method ?? (input instanceof Request ? input.method : "GET");
      return Promise.resolve(matchApi(url.pathname, method.toUpperCase()));
    }

    return originalFetch(input, init);
  };

  window.__duteDemoApiInstalled = true;
}

declare global {
  interface Window {
    __duteDemoApiInstalled?: boolean;
  }
}
