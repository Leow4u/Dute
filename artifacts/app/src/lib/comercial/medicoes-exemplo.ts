/**
 * Medição sintética (documento como `saveMedicao` grava em `medicoes/`) para
 * os testes da lib e da tela de Medições (partes 16a e 16b de
 * docs/plataforma/fase-6-comercial.md). Cliente, contrato e valores
 * inventados; os preços seguem a conta do mockup ComMedicaoMensal.
 */

export type Documento = Record<string, unknown>;

export const CLASSE_AJUDANTE_UTIL = { diaria: { dias: ["util"], janelas: ["diurna"] }, veiculo: false, ajudante: true };
export const CLASSE_AJUDANTE_SABADO = { diaria: { dias: ["sabado"], janelas: ["diurna"] }, veiculo: false, ajudante: true };
export const CLASSE_AJUDANTE_DOMINGO = { diaria: { dias: ["domingo_feriado"], janelas: ["diurna"] }, veiculo: false, ajudante: true };
export const CLASSE_VEICULO = { diaria: null, veiculo: true, ajudante: false };

/** Um item gravado da linha. */
export function itemDoDoc(sobrescrever: Documento): Documento {
  return {
    lpu_item_id: "item-x",
    codigo: null,
    categoria: "Transporte",
    item: "Item",
    descricao: "Item",
    servico: "Transporte",
    unidade: "dia",
    quantidade: "1",
    preco: "100.00",
    preco_tabela: "100.00",
    origem: "tabela",
    motivo: null,
    total_cents: 10000,
    classe: CLASSE_VEICULO,
    dia_nao_bate: false,
    trocar_por: null,
    trocar_por_diaria: null,
    ...sobrescrever,
  };
}

export const AJUDANTE_UTIL = (quantidade: string, total: number) =>
  itemDoDoc({
    lpu_item_id: "ajud-util",
    item: "Diária de ajudante",
    descricao: "Ajudante de Segunda a Sexta das 09:00 às 18:00",
    preco: "280.00",
    preco_tabela: "280.00",
    quantidade,
    total_cents: total,
    classe: CLASSE_AJUDANTE_UTIL,
  });

export const AJUDANTE_DOMINGO = (quantidade: string, total: number) =>
  itemDoDoc({
    lpu_item_id: "ajud-dom",
    item: "Diária de ajudante",
    descricao: "Ajudante de Domingo/feriado das 08:00 às 17:00",
    preco: "476.00",
    preco_tabela: "476.00",
    quantidade,
    total_cents: total,
    classe: CLASSE_AJUDANTE_DOMINGO,
  });

export const VUC = (quantidade: string, total: number) =>
  itemDoDoc({
    lpu_item_id: "vuc",
    item: "Viagem",
    descricao: "VUC",
    unidade: "viagem",
    preco: "620.00",
    preco_tabela: "620.00",
    quantidade,
    total_cents: total,
    classe: CLASSE_VEICULO,
  });

export const TRES_QUARTOS = itemDoDoc({
  lpu_item_id: "tres-quartos",
  item: "Viagem",
  descricao: "3/4",
  unidade: "viagem",
  preco: "890.00",
  preco_tabela: "890.00",
  quantidade: "1",
  total_cents: 89000,
  classe: CLASSE_VEICULO,
});

export const TRUCK_AVULSO = itemDoDoc({
  lpu_item_id: null,
  item: "Truck até Jundiaí",
  descricao: "Truck até Jundiaí",
  preco: "1350.00",
  preco_tabela: null,
  origem: "avulso",
  motivo: "Rota fora da LPU",
  quantidade: "1",
  total_cents: 135000,
  classe: CLASSE_VEICULO,
});

type LinhaDoc = {
  id: string;
  os: string;
  solicitada_em: string;
  area_solicitante: string;
  executada_em: string;
  dia_tipo: string;
  origem: string;
  destino: string;
  mercadoria: string;
  itens: Documento[];
  total_cents: number;
  marcas: string[];
  anexo: { nome: string; referencia: string } | null;
};

export function linhaDoDoc(linha: LinhaDoc & Partial<Documento>): Documento {
  return { demanda_numero: null, janela: "diurna", tabela_id: "safra-2026", ...linha };
}

export const L1 = linhaDoDoc({
  id: "l1",
  os: "OS 10031-01",
  solicitada_em: "2026-09-29",
  area_solicitante: "Infraestrutura",
  executada_em: "2026-10-01",
  dia_tipo: "util",
  origem: "Sede Paulista",
  destino: "Agência Augusta",
  mercadoria: "18 caixas de arquivo",
  itens: [VUC("1", 62000), AJUDANTE_UTIL("2", 56000)],
  total_cents: 118000,
  marcas: [],
  anexo: { nome: "OS 10031-01.pdf", referencia: "OneDrive/Safra/10031.pdf" },
});

export const L2 = linhaDoDoc({
  id: "l2",
  os: "OS 10034-01",
  solicitada_em: "2026-10-02",
  area_solicitante: "Facilities",
  executada_em: "2026-10-03",
  dia_tipo: "sabado",
  origem: "Agência Augusta",
  destino: "Sede Paulista",
  mercadoria: "14 cadeiras e 2 armários altos",
  itens: [
    TRES_QUARTOS,
    {
      ...AJUDANTE_UTIL("3", 84000),
      dia_nao_bate: true,
      trocar_por: "ajud-sab",
      trocar_por_diaria: { dias: ["sabado"], janelas: ["diurna"] },
    },
  ],
  total_cents: 173000,
  marcas: ["dia_nao_bate_tarifa"],
  anexo: { nome: "OS 10034-01.pdf", referencia: "OneDrive/Safra/10034.pdf" },
});

export const L3 = linhaDoDoc({
  id: "l3",
  os: "OS 10038-01",
  solicitada_em: "2026-10-08",
  area_solicitante: "Arquivo",
  executada_em: "2026-10-12",
  dia_tipo: "domingo_feriado",
  origem: "Sede Paulista",
  destino: "Arquivo Jundiaí",
  mercadoria: "120 caixas de arquivo",
  itens: [TRUCK_AVULSO, AJUDANTE_DOMINGO("4", 190400)],
  total_cents: 325400,
  marcas: ["rota_fora_da_tabela"],
  anexo: { nome: "OS 10038-01.pdf", referencia: "OneDrive/Safra/10038.pdf" },
});

export const L4 = linhaDoDoc({
  id: "l4",
  os: "OS 10043-01",
  solicitada_em: "2026-10-15",
  area_solicitante: "Facilities",
  executada_em: "2026-10-18",
  dia_tipo: "domingo_feriado",
  origem: "Sede Paulista",
  destino: "Agência Vila Olímpia",
  mercadoria: "40 caixas de material",
  itens: [VUC("1", 62000), AJUDANTE_DOMINGO("2", 95200)],
  total_cents: 157200,
  marcas: ["sem_pedido_anexo"],
  anexo: null,
});

export const LINHAS_DE_OUTUBRO = [L1, L2, L3, L4];
/** 1.180,00 + 1.730,00 + 3.254,00 + 1.572,00. */
export const TOTAL_DE_OUTUBRO_CENTS = 773600;

/** `medicoes/safra_2026-10`: a medição de outubro em rascunho. */
export function medicaoDoDoc(sobrescrever: Documento = {}): Documento {
  return {
    id: "safra_2026-10",
    schema_version: 1,
    customer_code: "BANCO-SAFRA",
    contrato_id: "safra",
    competencia: "2026-10",
    variante: "Comercial",
    status: "rascunho",
    status_desde: "2026-10-05T12:00:00.000Z",
    edicao: 6,
    linhas: LINHAS_DE_OUTUBRO,
    total_cents: TOTAL_DE_OUTUBRO_CENTS,
    demandas: [],
    marcas: { dia_nao_bate_tarifa: 1, rota_fora_da_tabela: 1, sem_pedido_anexo: 1 },
    enviada_em: null,
    aprovada_em: null,
    aprovacao: null,
    contestacao: null,
    contestacoes_anteriores: [],
    autorizacao_id: null,
    ...sobrescrever,
  };
}
