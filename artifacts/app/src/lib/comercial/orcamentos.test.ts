import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ETAPAS_DA_FILA,
  ETAPAS_DEMANDA,
  ETAPA_ROTULO,
  ORIGENS_LINHA,
  SEGMENTOS_DA_FILA,
  SEGMENTO_ROTULO,
  STATUS_ORCAMENTO,
  TIPOS_RV,
  acaoDaEtapa,
  contarSegmentos,
  corDaEtapa,
  correspondeABusca,
  diasNaEtapa,
  filtrarFila,
  historicoDoOrcamento,
  hrefDoOrcamento,
  itemDaFila,
  linhasPorOrigem,
  pontoDaEtapa,
  rotuloDoContratoDoOrcamento,
  segmentoInicial,
  tempoNaEtapa,
  type ItemDaFila,
} from "./orcamentos";

/**
 * Fila de orçamentos do Comercial (docs/mockups/ComFila.dc.html; parte 11 de
 * docs/plataforma/fase-6-comercial.md): segmentos por etapa com a contagem,
 * busca, grupos, dias na etapa, segmento inicial por papel e a ficha resumida.
 * Os documentos são os que functions/comercial grava (domain/quotes.ts).
 */

const here = dirname(fileURLToPath(import.meta.url));
const eventsDoComercial = readFileSync(resolve(here, "../../../../../functions/comercial/src/domain/events.ts"), "utf8");

function tsList(source: string, name: string): string[] {
  const match = source.match(new RegExp(`export const ${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!match) throw new Error(`${name} não encontrado`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

// 21/10/2026 às 10:00 em São Paulo.
const AGORA = new Date("2026-10-21T13:00:00.000Z");

type Registro = Record<string, unknown>;

function demanda(numero: string, extra: Registro = {}): Registro {
  return {
    numero,
    customer_code: "ITAU-UNIBANCO",
    customer_name: "Itaú Unibanco",
    contrato_id: "ct-itau",
    entrada: "comercial",
    canal: "email",
    tipo: "planejada",
    titulo: "Mudança de 32 estações do 6º para o 9º andar",
    ref_cliente: "CE9012",
    solicitante: { contato_id: "ct_marina", empresa: "Souza & Lopes" },
    recebida_em: "2026-10-20T11:47:00.000Z",
    origem: { local_id: "loc_ceic", complemento: "6º andar" },
    destino: null,
    execucao: { datas: [], de: null, ate: null, a_definir: true, visita_tecnica: null },
    etapa: "em_montagem",
    etapa_desde: "2026-10-20T12:00:00.000Z",
    marcos: [{ etapa: "em_montagem", em: "2026-10-20T12:00:00.000Z", por_uid: "u-gui" }],
    numero_legado: null,
    perda: null,
    cancelamento: null,
    ...extra,
  };
}

function linha(origem: string, total: number, extra: Registro = {}): Registro {
  return { id: `ln_${origem}_${total}`, origem, total_cents: total, quantidade: "1", preco: String(total / 100), ...extra };
}

function orcamento(numero: string, extra: Registro = {}): Registro {
  return {
    numero,
    rotulo: numero,
    customer_code: "ITAU-UNIBANCO",
    rv: 0,
    tipo_rv: "proposta",
    status: "rascunho",
    edicao: 3,
    data_base: "2026-10-20",
    tabela: { id: "pt_itau_com", nome: "LPU Itaú v2.0", variante: "Comercial" },
    linhas: [linha("tabela", 1_000_000), linha("tabela", 468_000), linha("alterado", 124_000)],
    subtotal_cents: 1_592_000,
    ajustes_cents: 0,
    total_cents: 1_592_000,
    marcas: ["preco_alterado"],
    autor_uid: "u-gui",
    aprovacao: null,
    devolucao: null,
    passo_em: "2026-10-20T12:00:00.000Z",
    ...extra,
  };
}

function item(numero: string, demandaExtra: Registro = {}, quoteExtra: Registro = {}): ItemDaFila {
  return itemDaFila(numero, demanda(numero, demandaExtra), orcamento(numero, quoteExtra))!;
}

const FILA: ItemDaFila[] = [
  item("10052"),
  item("10053", {
    customer_code: "GRUPO-SBF",
    customer_name: "Grupo SBF",
    contrato_id: null,
    titulo: "Transferência do escritório de Pinheiros",
    ref_cliente: null,
    etapa_desde: "2026-10-21T11:15:00.000Z",
  }),
  item("10045", { etapa: "para_aprovar", etapa_desde: "2026-10-21T12:20:00.000Z", titulo: "Mudança do 4º e 5º andares", ref_cliente: "CE8977" }, { rv: 2, rotulo: "10045 – RV02", tipo_rv: "aditivo", status: "para_aprovar" }),
  item("10050", { etapa: "para_aprovar", etapa_desde: "2026-10-20T19:20:00.000Z", ref_cliente: "SL.260", titulo: "Montagem de 18 estações em L" }, { status: "para_aprovar" }),
  item("10048", { etapa: "para_enviar", etapa_desde: "2026-10-21T11:50:00.000Z", customer_name: "BTG Pactual", titulo: "Montagem de estande" }, { status: "aprovado" }),
  item("10041", { etapa: "aguardando_cliente", etapa_desde: "2026-10-15T11:30:00.000Z", titulo: "Retirada de mobiliário do 12º andar" }, { status: "enviado" }),
  item("10036", { etapa: "execucao_a_orcar", etapa_desde: "2026-10-18T13:00:00.000Z", numero_legado: "9898", titulo: "Transporte de 60 monitores para o CAT" }, { tipo_rv: "execucao" }),
  item("10031", { etapa: "aguardando_autorizacao", etapa_desde: "2026-09-13T17:00:00.000Z", titulo: "Mudança do 3º andar" }, { tipo_rv: "execucao", status: "enviado" }),
  item("10034", { etapa: "perdida", etapa_desde: "2026-10-08T12:20:00.000Z", customer_name: "Bradesco", titulo: "Mudança de agência · Alphaville" }),
  item("10030", { etapa: "perdida", etapa_desde: "2026-10-02T12:20:00.000Z", customer_name: "Bradesco", titulo: "Agência Barueri" }),
  item("10020", { etapa: "a_faturar", etapa_desde: "2026-10-01T12:00:00.000Z" }, { status: "enviado" }),
  item("10021", { etapa: "cancelada", etapa_desde: "2026-10-01T12:00:00.000Z" }),
];

describe("listas iguais às de functions/comercial", () => {
  it.each([
    ["ETAPAS_DEMANDA", ETAPAS_DEMANDA],
    ["STATUS_ORCAMENTO", STATUS_ORCAMENTO],
    ["TIPOS_RV", TIPOS_RV],
    ["ORIGENS_LINHA", ORIGENS_LINHA],
  ] as const)("%s é cópia literal de domain/events.ts", (nome, lista) => {
    expect([...lista]).toEqual(tsList(eventsDoComercial, nome));
  });

  it("a fila tem as oito etapas do mockup, na ordem, e Todas na frente", () => {
    expect(ETAPAS_DA_FILA.map((etapa) => SEGMENTO_ROTULO[etapa])).toEqual([
      "Em montagem",
      "Para aprovar",
      "Para enviar",
      "Aguardando cliente",
      "Para planejar",
      "Execução a orçar",
      "Aguardando autorização",
      "Perdidas",
    ]);
    expect(SEGMENTOS_DA_FILA[0]).toBe("todas");
    expect(SEGMENTO_ROTULO.todas).toBe("Todas");
    expect(ETAPA_ROTULO.perdida).toBe("Perdida");
  });
});

describe("item da fila", () => {
  it("junta a demanda e o orçamento com o que a fila e a ficha mostram", () => {
    const resultado = itemDaFila("10045", demanda("10045", { numero_legado: "105-221" }), orcamento("10045", { rv: 1, rotulo: "10045 – RV01" }));
    expect(resultado).toMatchObject({
      numero: "10045",
      rotulo: "10045 – RV01",
      rv: 1,
      tipoRv: "proposta",
      status: "rascunho",
      edicao: 3,
      etapa: "em_montagem",
      customerCode: "ITAU-UNIBANCO",
      cliente: "Itaú Unibanco",
      titulo: "Mudança de 32 estações do 6º para o 9º andar",
      refCliente: "CE9012",
      numeroLegado: "105-221",
      contatoId: "ct_marina",
      empresa: "Souza & Lopes",
      origemLocalId: "loc_ceic",
      destinoLocalId: null,
      contratoId: "ct-itau",
      tabelaNome: "LPU Itaú v2.0",
      variante: "Comercial",
      dataBase: "2026-10-20",
      totalCents: 1_592_000,
    });
  });

  it("sem demanda não entra; sem orçamento entra sem total", () => {
    expect(itemDaFila("10045", null, orcamento("10045"))).toBeNull();
    const semOrcamento = itemDaFila("10045", demanda("10045"), null)!;
    expect(semOrcamento.totalCents).toBeNull();
    expect(semOrcamento.rotulo).toBe("10045");
    expect(semOrcamento.linhas).toEqual([]);
  });

  it("etapa desconhecida não entra na fila", () => {
    expect(itemDaFila("10045", demanda("10045", { etapa: "xyz" }), orcamento("10045"))).toBeNull();
  });
});

describe("segmentos e contagens", () => {
  it("conta cada etapa da fila; Todas soma só as etapas da fila", () => {
    expect(contarSegmentos(FILA)).toEqual({
      todas: 10,
      em_montagem: 2,
      para_aprovar: 2,
      para_enviar: 1,
      aguardando_cliente: 1,
      para_planejar: 0,
      execucao_a_orcar: 1,
      aguardando_autorizacao: 1,
      perdida: 2,
    });
  });

  it("sem orçamento, tudo zero", () => {
    expect(Object.values(contarSegmentos([]))).toEqual(new Array(SEGMENTOS_DA_FILA.length).fill(0));
  });
});

describe("grupos da fila", () => {
  const grupos = (segmento: Parameters<typeof filtrarFila>[1], busca = "") =>
    filtrarFila(FILA, segmento, busca).map((grupo) => [grupo.etapa, grupo.rotulo, grupo.itens.map((orc) => orc.numero)]);

  it("Todas: grupos na ordem das etapas, só os que têm orçamento; a_faturar e cancelada ficam fora", () => {
    expect(grupos("todas")).toEqual([
      ["em_montagem", "Em montagem", ["10052", "10053"]],
      ["para_aprovar", "Para aprovar", ["10050", "10045"]],
      ["para_enviar", "Para enviar", ["10048"]],
      ["aguardando_cliente", "Aguardando cliente", ["10041"]],
      ["execucao_a_orcar", "Execução a orçar", ["10036"]],
      ["aguardando_autorizacao", "Aguardando autorização", ["10031"]],
      ["perdida", "Perdidas", ["10034", "10030"]],
    ]);
  });

  it("dentro do grupo, quem espera há mais tempo vem primeiro; nas perdidas, a mais recente", () => {
    expect(grupos("para_aprovar")).toEqual([["para_aprovar", "Para aprovar", ["10050", "10045"]]]);
    expect(grupos("perdida")).toEqual([["perdida", "Perdidas", ["10034", "10030"]]]);
  });

  it("segmento sem orçamento não tem grupo", () => {
    expect(grupos("para_planejar")).toEqual([]);
  });
});

describe("busca na fila", () => {
  const numeros = (busca: string) => FILA.filter((orc) => correspondeABusca(orc, busca)).map((orc) => orc.numero);

  it("por número, número com RV e nº legado", () => {
    expect(numeros("10045")).toEqual(["10045"]);
    expect(numeros("RV02")).toEqual(["10045"]);
    expect(numeros("9898")).toEqual(["10036"]);
  });

  it("por cliente sem acento e sem maiúscula", () => {
    expect(numeros("SBF")).toEqual(["10053"]);
    expect(numeros("btg")).toEqual(["10048"]);
    expect(numeros("itau").length).toBeGreaterThan(5);
  });

  it("pela referência do cliente e pelo título", () => {
    expect(numeros("ce8977")).toEqual(["10045"]);
    expect(numeros("sl.260")).toEqual(["10050"]);
    expect(numeros("monitores")).toEqual(["10036"]);
  });

  it("várias palavras: todas precisam aparecer", () => {
    expect(numeros("bradesco alphaville")).toEqual(["10034"]);
    expect(numeros("bradesco zzz")).toEqual([]);
  });

  it("busca vazia mostra tudo; a busca filtra os grupos", () => {
    expect(numeros("  ")).toHaveLength(FILA.length);
    expect(filtrarFila(FILA, "todas", "bradesco").map((grupo) => grupo.itens.map((orc) => orc.numero))).toEqual([["10034", "10030"]]);
  });
});

describe("dias na etapa", () => {
  const tempo = (desde: string, etapa: Parameters<typeof tempoNaEtapa>[2] = "em_montagem") => tempoNaEtapa(desde, AGORA, etapa);

  it("menos de uma hora em minutos; no mesmo dia, hoje; depois, em dias corridos de São Paulo", () => {
    expect(tempo("2026-10-21T12:20:00.000Z")).toBe("40 min");
    expect(tempo("2026-10-21T12:59:40.000Z")).toBe("agora");
    expect(tempo("2026-10-21T10:00:00.000Z")).toBe("hoje");
    expect(tempo("2026-10-20T20:00:00.000Z")).toBe("1 dia");
    expect(tempo("2026-10-15T13:00:00.000Z")).toBe("6 dias");
  });

  it("o dia é o de São Paulo: 20/10 às 23:30 é ontem, mesmo já sendo 21/10 em UTC", () => {
    expect(tempo("2026-10-21T02:30:00.000Z")).toBe("1 dia");
  });

  it("na perdida, a data em que se perdeu", () => {
    expect(tempo("2026-10-08T12:20:00.000Z", "perdida")).toBe("08/10");
  });

  it("sem data, nada", () => {
    expect(tempoNaEtapa(null, AGORA, "em_montagem")).toBe("");
    expect(tempoNaEtapa("xyz", AGORA, "em_montagem")).toBe("");
  });

  it("dias corridos em número, para o prazo da autorização", () => {
    expect(diasNaEtapa("2026-09-13T17:00:00.000Z", AGORA)).toBe(38);
    expect(diasNaEtapa("2026-10-21T12:00:00.000Z", AGORA)).toBe(0);
    expect(diasNaEtapa(null, AGORA)).toBeNull();
  });
});

describe("cores das etapas (as do mockup, por token do tema)", () => {
  it("cada etapa tem a cor do mockup", () => {
    expect(corDaEtapa("em_montagem")).toContain("bg-muted");
    expect(corDaEtapa("para_aprovar")).toContain("bg-amber-soft");
    expect(corDaEtapa("para_enviar")).toContain("bg-violet-soft");
    expect(corDaEtapa("aguardando_cliente")).toContain("bg-info-soft");
    expect(corDaEtapa("para_planejar")).toContain("bg-success-soft");
    expect(corDaEtapa("execucao_a_orcar")).toContain("bg-amber-soft");
    expect(corDaEtapa("aguardando_autorizacao")).toContain("bg-amber-soft");
    expect(corDaEtapa("a_faturar")).toContain("bg-teal-soft");
    expect(corDaEtapa("perdida")).toContain("text-muted-foreground");
  });

  it("aguardando autorização há 30 dias ou mais fica vermelho", () => {
    expect(corDaEtapa("aguardando_autorizacao", 29)).toContain("bg-amber-soft");
    expect(corDaEtapa("aguardando_autorizacao", 30)).toContain("bg-destructive-soft");
    expect(corDaEtapa("para_aprovar", 90)).toContain("bg-amber-soft");
  });

  it("o âmbar é o do mockup (#FDF0D5 e #8A4B00), nos dois temas, e o ponto usa a mesma cor", () => {
    const css = readFileSync(resolve(here, "../../index.css"), "utf8");
    expect(css).toMatch(/--color-amber-soft: hsl\(var\(--amber-soft\)\);/);
    expect(css).toMatch(/--color-amber-soft-foreground: hsl\(var\(--amber-soft-foreground\)\);/);
    expect(css.match(/--amber-soft: [^;]+;/g)).toEqual(["--amber-soft: 41 91% 91%;", "--amber-soft: 38 55% 12%;"]);
    expect(css.match(/--amber-soft-foreground: [^;]+;/g)).toEqual(["--amber-soft-foreground: 33 100% 27%;", "--amber-soft-foreground: 40 90% 72%;"]);
    expect(css.match(/--amber-soft-border: [^;]+;/g)).toHaveLength(2);
    for (const etapa of ["para_aprovar", "execucao_a_orcar", "aguardando_autorizacao"] as const) {
      expect(pontoDaEtapa(etapa)).toBe("bg-amber-soft-foreground");
    }
  });

  it("só tokens: nenhuma cor fixa", () => {
    for (const etapa of ETAPAS_DEMANDA) {
      expect(corDaEtapa(etapa)).not.toMatch(/#|\[|-(?:50|100|200|300|600|700|800|900)\b/);
      expect(pontoDaEtapa(etapa)).toMatch(/^bg-/);
    }
  });
});

describe("segmento inicial por papel", () => {
  const contagem = contarSegmentos(FILA);

  it("o comercial abre em Para enviar quando há algo", () => {
    expect(segmentoInicial("comercial", contagem)).toBe("para_enviar");
  });

  it("sem nada para enviar, o comercial abre em Em montagem", () => {
    expect(segmentoInicial("comercial", { ...contagem, para_enviar: 0 })).toBe("em_montagem");
  });

  it("o owner abre em Para aprovar; o admin, em Todas", () => {
    expect(segmentoInicial("owner", contagem)).toBe("para_aprovar");
    expect(segmentoInicial("admin", contagem)).toBe("todas");
    expect(segmentoInicial(null, contagem)).toBe("todas");
  });
});

describe("ficha resumida", () => {
  it("linhas por origem, com a quantidade e o valor", () => {
    const orc = item("10045", {}, {
      linhas: [linha("tabela", 300_000), linha("tabela", 248_000), linha("alterado", 82_000), linha("avulso", 26_000), linha("ajuste", -42_000)],
    });
    expect(linhasPorOrigem(orc.linhas)).toEqual([
      { origem: "tabela", rotulo: "Tabela", quantidade: 2, totalCents: 548_000 },
      { origem: "alterado", rotulo: "Alterado", quantidade: 1, totalCents: 82_000 },
      { origem: "avulso", rotulo: "Avulso", quantidade: 1, totalCents: 26_000 },
      { origem: "ajuste", rotulo: "Ajuste", quantidade: 1, totalCents: -42_000 },
    ]);
    expect(linhasPorOrigem([])).toEqual([]);
  });

  const nomes: Record<string, string> = { "u-gui": "Guilherme", "u-leo": "Leonardo" };
  const nomeDe = (uid: string | null) => (uid ? (nomes[uid] ?? null) : null);

  it("rascunho: recebido feito, o resto pendente", () => {
    expect(historicoDoOrcamento(FILA[0], { nomeDe, contato: "Marina Teixeira" })).toEqual([
      { rotulo: "Recebido", estado: "feito", quando: "20/10 08:47", detalhe: "e-mail de Marina Teixeira" },
      { rotulo: "Montado", estado: "pendente", quando: null, detalhe: null },
      { rotulo: "Aprovado", estado: "pendente", quando: null, detalhe: null },
      { rotulo: "Enviado", estado: "pendente", quando: null, detalhe: null },
    ]);
  });

  it("para aprovar: montado com quem e quando; a RV aparece a partir da RV01", () => {
    const orc = item(
      "10045",
      {
        canal: "telefone",
        etapa: "para_aprovar",
        marcos: [
          { etapa: "em_montagem", em: "2026-10-20T21:10:00.000Z", por_uid: "u-gui" },
          { etapa: "para_aprovar", em: "2026-10-21T12:05:00.000Z", por_uid: "u-gui" },
        ],
      },
      { status: "para_aprovar", rv: 2, rotulo: "10045 – RV02" },
    );
    const historico = historicoDoOrcamento(orc, { nomeDe, contato: "Paula Nogueira" });
    expect(historico.slice(0, 3)).toEqual([
      { rotulo: "Recebido", estado: "feito", quando: "20/10 08:47", detalhe: "telefone · Paula Nogueira" },
      { rotulo: "Montado", estado: "feito", quando: "21/10 09:05", detalhe: "Guilherme · RV02" },
      { rotulo: "Aprovado", estado: "pendente", quando: null, detalhe: null },
    ]);
  });

  it("aprovado: quem aprovou e quando", () => {
    const orc = item(
      "10048",
      {
        etapa: "para_enviar",
        marcos: [
          { etapa: "em_montagem", em: "2026-10-19T17:30:00.000Z", por_uid: "u-gui" },
          { etapa: "para_aprovar", em: "2026-10-20T20:20:00.000Z", por_uid: "u-gui" },
          { etapa: "para_enviar", em: "2026-10-21T11:50:00.000Z", por_uid: "u-leo" },
        ],
      },
      { status: "aprovado", aprovacao: { por_uid: "u-leo", em: "2026-10-21T11:50:00.000Z", edicao: 4 } },
    );
    const historico = historicoDoOrcamento(orc, { nomeDe, contato: null });
    expect(historico[0].detalhe).toBe("e-mail");
    expect(historico[2]).toEqual({ rotulo: "Aprovado por Leonardo", estado: "feito", quando: "21/10 08:50", detalhe: null });
    expect(historico[3].estado).toBe("pendente");
    // Quem não lê o perfil do aprovador (o comercial) vê só que foi aprovado e quando.
    expect(historicoDoOrcamento(orc, { nomeDe: () => null, contato: null })[2]).toEqual({
      rotulo: "Aprovado",
      estado: "feito",
      quando: "21/10 08:50",
      detalhe: null,
    });
  });

  it("devolvido: o passo aparece e o montado volta a pendente", () => {
    const orc = item("10050", {}, { devolucao: { nota: "Rever a cadeira", por_uid: "u-leo", em: "2026-10-21T12:30:00.000Z" } });
    expect(historicoDoOrcamento(orc, { nomeDe, contato: null }).map((passo) => [passo.rotulo, passo.estado, passo.detalhe])).toEqual([
      ["Recebido", "feito", "e-mail"],
      ["Devolvido", "feito", "Leonardo"],
      ["Montado", "pendente", null],
      ["Aprovado", "pendente", null],
      ["Enviado", "pendente", null],
    ]);
    expect(orc.devolucao?.nota).toBe("Rever a cadeira");
  });

  it("perdida: o passo final marca a perda", () => {
    const orc = FILA.find((orc) => orc.numero === "10034")!;
    expect(historicoDoOrcamento(orc, { nomeDe, contato: null }).at(-1)).toEqual({
      rotulo: "Perdida",
      estado: "perdido",
      quando: "08/10 09:20",
      detalhe: null,
    });
  });

  it("o contrato com o vencimento, sem contrato, ou o traço enquanto não leu", () => {
    expect(rotuloDoContratoDoOrcamento("ct-itau", { nome: "Contrato Itaú", vigenteAte: "2027-06-30" })).toBe("Contrato Itaú · até 30/06/2027");
    expect(rotuloDoContratoDoOrcamento("ct-btg", { nome: "Armazenagem", vigenteAte: null })).toBe("Armazenagem");
    expect(rotuloDoContratoDoOrcamento(null, undefined)).toBe("Sem contrato");
    expect(rotuloDoContratoDoOrcamento("ct-itau", undefined)).toBe("—");
  });

  it("a ação da etapa: continuar a montagem ou abrir", () => {
    expect(acaoDaEtapa("em_montagem")).toBe("Continuar montagem");
    expect(acaoDaEtapa("execucao_a_orcar")).toBe("Orçar execução");
    expect(acaoDaEtapa("para_aprovar")).toBe("Abrir orçamento");
    expect(acaoDaEtapa("perdida")).toBe("Abrir orçamento");
    expect(hrefDoOrcamento("10045")).toBe("/comercial/orcamento?numero=10045");
  });
});
