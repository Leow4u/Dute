import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WarehouseTask } from "@/lib/warehouse-ops/model";
import { situacaoDaEtiqueta, temEtiqueta, type CaixaDaChegada } from "@/lib/wms/caixas-do-recebimento";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import {
  conteudoDaCaixa,
  FichaDaChegadaPorCaixaConteudo,
  quantidadeManual,
  rascunhoDaCaixa,
  rascunhoVazio,
  type FichaDaChegadaPorCaixaProps,
} from "./chegada-por-caixa-conteudo";
import { linhaPeloCodigo } from "./chegada-por-caixa";
import { destinoVazio } from "./destino-da-caixa";

/** As quatro etapas da conferência manual mantêm as regras da chegada por caixa. */

const RECEIPT = "inb_avulso_0d0e620b";

function linha(item: string, numero: number, tamanho: string, quantidade: number) {
  return {
    inbound_item_id: item,
    line_number: numero,
    sku_code: tamanho === "XG" ? "BTG-000086" : "BTG-000087",
    client_item_code: `A.01.0806.004.${tamanho}`,
    product_name: `POLO MASCULINO PIQUET PRETO ${tamanho}`,
    size: tamanho,
    counted_qty: quantidade,
  };
}

function caixa(code: string, status: string, linhas: ReturnType<typeof linha>[], extra: Partial<CaixaDaChegada> = {}): CaixaDaChegada {
  return {
    code,
    status,
    location_id: "",
    lines: linhas,
    unit_count: linhas.reduce((soma, item) => soma + item.counted_qty, 0),
    length_m: null,
    width_m: null,
    height_m: null,
    gross_weight_kg: null,
    allow_tilt: false,
    allow_stacking: false,
    conference_revision: 2,
    refused_positions: [],
    ...extra,
  };
}

const caixas: CaixaDaChegada[] = [
  caixa("CX-000131", "committing", [linha(`${RECEIPT}_01`, 1, "XG", 29), linha(`${RECEIPT}_02`, 2, "GG", 12)], {
    location_id: "B-02",
    length_m: 0.48,
    width_m: 0.38,
    height_m: 0.3,
    gross_weight_kg: 9.4,
  }),
  caixa("CX-000132", "counting", [linha(`${RECEIPT}_02`, 2, "GG", 18)]),
];

const task: WarehouseTask = {
  id: `receiving:${RECEIPT}`,
  reference: RECEIPT,
  title: "AVL-0D0E620B",
  status: "checking",
  conference_mode: "per_box",
  receipt_number: "AVL-0D0E620B",
  invoice_number: "48.230",
  boxes: caixas,
  items: [
    {
      id: `${RECEIPT}_01`,
      line_number: 1,
      product_name: "POLO MASCULINO PIQUET PRETO XG",
      client_item_code: "A.01.0806.004.XG",
      sku_code: "BTG-000086",
      barcode: "7891234500086",
      expected_quantity: 41,
      boxed_qty: 29,
      box_codes: ["CX-000131"],
      unit_cost: 89.9,
    },
    {
      id: `${RECEIPT}_02`,
      line_number: 2,
      product_name: "POLO MASCULINO PIQUET PRETO GG",
      client_item_code: "A.01.0806.004.GG",
      sku_code: "BTG-000087",
      expected_quantity: 30,
      boxed_qty: 30,
      box_codes: ["CX-000131", "CX-000132"],
      unit_cost: 89.9,
    },
  ],
};

function render(over: Partial<FichaDaChegadaPorCaixaProps> = {}) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <FichaDaChegadaPorCaixaConteudo
      task={task}
      caixas={caixas}
      selecionada="CX-000132"
      quantidades={{}}
      busca=""
      fechando={false}
      rascunho={rascunhoVazio()}
      ocupado={false}
      podeOperar
      podeRegistrarDivergencia
      onSelecionar={noop}
      onIniciar={noop}
      onBusca={noop}
      onAdicionar={noop}
      onQuantidade={noop}
      onLancar={noop}
      onAbrirFechamento={noop}
      onRascunho={noop}
      onFechar={noop}
      onCancelarFechamento={noop}
      onReabrir={noop}
      onRemover={noop}
      onVoltar={noop}
      onRegistrarDivergencia={noop}
      destino={destinoVazio()}
      recusando={null}
      onDestino={{ onModo: noop, onEscolher: noop, onConfirmar: noop, onNaoCabe: noop, onTentarDeNovo: noop }}
      onCancelarRecusa={noop}
      onRecusar={noop}
      justificativa=""
      onJustificativa={noop}
      onConcluir={noop}
      marcando={null}
      onMarcarFalta={noop}
      onCancelarFalta={noop}
      onConfirmarFalta={noop}
      onDesmarcarFalta={noop}
      {...over}
    />,
  );
}

const CABECALHO = [
  "em conferência", "AVL-0D0E620B · NF 48.230", "Conferência", "Fechar caixa", "Destino", "Revisar entrada", "1", "2", "3", "4",
];
const PRODUTOS = ["POLO MASCULINO PIQUET PRETO XG", "A.01.0806.004.XG", "POLO MASCULINO PIQUET PRETO GG", "A.01.0806.004.GG"];
const CAIXAS = [
  "CX-000131 · destino B-02", "XG 29 · GG 12 · 41 un. · 48 × 38 × 30 cm · 9,4 kg", "destino confirmado", "CX-000132", "GG 18 · 18 un.", "em conferência",
];
const LINHAS_DA_NF = [
  "Conferência da NF", "Produto", "NF (un.)", "Conferido (un.)", "Custo NF", "Situação",
  "1 · POLO MASCULINO PIQUET PRETO XG", "A.01.0806.004.XG", "41", "29", "89,90", "faltam 12",
  "2 · POLO MASCULINO PIQUET PRETO GG", "A.01.0806.004.GG", "30", "Quantidade confere",
  "Esperado", "71 un.", "Em caixas", "59 un.", "Sem caixa", "12 un.",
];
const RESUMO_DA_CAIXA = [
  "Caixa CX-000132", "Conteúdo da caixa", "Produto", "Quantidade", "POLO MASCULINO PIQUET PRETO GG", "A.01.0806.004.GG", "18 un.", "Total na caixa: 18 un.",
];
const AVISO_DA_REVISAO = "Ao concluir a entrada, as caixas seguem para a fila de guarda física. Caixas sem prateleira terão o destino definido na guarda.";
/**
 * A tag de abertura do botão pelo rótulo: o do texto, ou o da camada atual do
 * BotaoDeAcao, que empilha as camadas (carregamento v2, parte 13c).
 */
function tagDoBotao(html: string, texto: string) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const botao = [...dom.window.document.querySelectorAll("button")].find(
    (candidato) => (candidato.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? candidato.textContent)?.trim() === texto,
  );
  const tag = botao?.outerHTML.match(/^<button[^>]*>/)?.[0];
  dom.window.close();
  expect(tag, `botão ${texto}`).toBeTruthy();
  return tag!;
}
/** Travado: o `disabled` (o que não tem o que fazer) ou o `aria-disabled` da ação que espera (parte 13c). */
const TRAVADO = /(^|\s)disabled=""|aria-disabled="true"/;
/** As camadas do BotaoDeAcao que ficam fora da árvore: o gerúndio e o "Conferir" (carregamento v2, parte 13c). */
const CAMADAS_DAS_ACOES = ["Iniciando…", "Adicionando…", "Salvando…", "Removendo…", "Fechando…", "Reabrindo…", "Concluindo…", "Desmarcando…", "Confirmando…", "Conferir"];
async function conferirTextosEAcessibilidade(html: string, textos: string[]) {
  expect(textosForaDaLista(html, [...textos, ...CAMADAS_DAS_ACOES])).toEqual([]);
  expect(await violacoesDeAcessibilidade(html)).toEqual([]);
}

describe("a conferência em quatro etapas", () => {
  it("conferência prioriza seleção dos produtos da NF, com comparação e caixa ativa separados", async () => {
    const html = render({ etapa: 1 });
    expect(html).toContain("@3xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('aria-label="Selecionar caixa CX-000132"');
    expect(html).toContain("Quantidade confere");
    expect(html).not.toContain(">OK<");
    expect(html).not.toContain('id="caixa-quantidade"');
    expect(html).not.toContain("Cód. cliente, SKU ou barras");
    await conferirTextosEAcessibilidade(html, [
      ...CABECALHO, ...CAIXAS, ...PRODUTOS, "Conferir recebimento", "Caixa ativa CX-000132", "Em conferência · 18 un. salvas nesta caixa", "Iniciar outra caixa", "Produtos da NF",
      "Buscar produto por nome ou código", "Produto", "NF", "Nesta caixa", "Conferência", "41", "30", "0", "18", "faltam 12", "Quantidade confere",
      "A conferência compara o total de todas as caixas com a NF.", "Esperado", "71 un.", "Salvo nesta caixa", "18 un.", "Faltam na chegada", "12 un.",
      "Selecione um produto da NF para informar a quantidade nesta caixa.", "Remover caixa", "Revisar caixa",
    ]);
  });

  it("produto novo começa vazio, existente mostra total e a revisão espera salvar ou descartar", () => {
    const novo = render({ produtoSelecionado: `${RECEIPT}_01` });
    expect(novo).toMatch(/<input[^>]*id="caixa-quantidade"[^>]*value=""/);
    expect(tagDoBotao(novo, "Adicionar à caixa")).toMatch(TRAVADO);
    expect(novo).toContain("Quantidade ainda não adicionada.");
    const existente = render({ produtoSelecionado: `${RECEIPT}_02` });
    expect(existente).toMatch(/<input[^>]*id="caixa-quantidade"[^>]*value="18"/);
    expect(existente).toContain("Salvo nesta caixa: 18 un.");
    expect(tagDoBotao(existente, "Salvar quantidade")).toMatch(TRAVADO);
    expect(existente).toContain("Remover produto da caixa");
    const editando = render({ produtoSelecionado: `${RECEIPT}_02`, quantidades: { [`${RECEIPT}_02`]: "20" }, rascunhosPendentes: true, onBack: () => undefined });
    expect(tagDoBotao(editando, "Salvar quantidade")).not.toMatch(TRAVADO);
    expect(tagDoBotao(editando, "Revisar caixa")).toMatch(TRAVADO);
    expect(tagDoBotao(editando, "Revisar entrada")).toMatch(TRAVADO);
    expect(editando).toContain("Descartar alteração");
    expect(editando).toContain("Há quantidade não salva. Salve ou descarte a alteração antes de revisar.");
  });

  it("busca parcial filtra a NF por nome ou código e ausência de resultado tem status", () => {
    const peloNome = render({ busca: "preto xg" });
    expect(peloNome).toContain("POLO MASCULINO PIQUET PRETO XG");
    expect(peloNome).not.toContain("POLO MASCULINO PIQUET PRETO GG");
    const peloCodigo = render({ busca: "000087" });
    expect(peloCodigo).toContain("POLO MASCULINO PIQUET PRETO GG");
    expect(peloCodigo).not.toContain("POLO MASCULINO PIQUET PRETO XG");
    expect(render({ busca: "inexistente" })).toContain("Nenhum produto da NF encontrado.");
  });

  it("fechamento mantém conteúdo, medidas, peso e orientação e confirma somente com dados válidos", async () => {
    const vazio = render({ fechando: true });
    expect(tagDoBotao(vazio, "Fechar caixa")).toMatch(TRAVADO);
    expect(vazio).not.toContain("Volume");
    const preenchido = render({ fechando: true, rascunho: { length_cm: "48", width_cm: "38", height_cm: "30", weight_kg: "6,1", content: "", tombar: true, empilhar: false } });
    expect(tagDoBotao(preenchido, "Fechar caixa")).not.toMatch(TRAVADO);
    expect(preenchido).toMatch(/<input[^>]*id="fechar-length_cm"[^>]*value="48"/);
    expect(preenchido).toMatch(/<button[^>]*aria-checked="true"[^>]*id="fechar-tombar"/);
    expect(preenchido).not.toContain("Produtos da NF");
    expect(preenchido).not.toContain("Guardar em");
    await conferirTextosEAcessibilidade(preenchido, [
      ...CABECALHO, ...RESUMO_DA_CAIXA, "1 produtos · 18 un.", "Medidas e peso", "Comprimento (cm)", "Largura (cm)", "Altura (cm)", "Peso (kg)",
      "Pode virar esta caixa de lado", "Pode empilhar esta caixa sobre outra que suporte seu peso", "Volume 0,055 m³", "Editar conteúdo", "Próxima etapa: destino",
    ]);
  });

  it("destino mostra a caixa já fechada e medidas sem reeditar, com reabertura explícita", async () => {
    const fechada = caixa("CX-000132", "reviewed", [linha(`${RECEIPT}_02`, 2, "GG", 18)], { length_m: 0.48, width_m: 0.38, height_m: 0.3, gross_weight_kg: 6.1, allow_tilt: true });
    const html = render({ caixas: [caixas[0]!, fechada] });
    expect(html).not.toContain('id="fechar-length_cm"');
    expect(html).not.toContain('id="caixa-quantidade"');
    expect(html).toContain("48 × 38 × 30 cm · 6,1 kg");
    await conferirTextosEAcessibilidade(html, [
      ...CABECALHO, ...RESUMO_DA_CAIXA, "Definir destino", "sem prateleira", "1 produtos · 18 un. · 48 × 38 × 30 cm · 6,1 kg", "Guardar em", "Sugestão do sistema", "Escolher prateleira",
      "Confirmar o destino reserva a prateleira. A guarda física será feita após concluir a entrada.", "Reabrir para ajustar", "Remover caixa", "Continuar sem prateleira",
    ]);
    const confirmada = render({ caixas, selecionada: "CX-000131" });
    expect(confirmada).toContain("Caixas e destinos");
    expect(confirmada).not.toContain("Reabrir para ajustar");
    expect(confirmada).not.toContain("Remover caixa");
  });

  it("revisão mantém Concluir entrada bloqueado por caixa aberta e linha sem falta marcada", () => {
    const html = render({ etapa: 4 });
    expect(tagDoBotao(html, "Concluir entrada")).toMatch(TRAVADO);
    expect(html).toContain("CX-000132 em conferência · linha 1 sem falta marcada");
    expect(html).not.toContain("Justificativa da divergência");
    expect(html).toContain("Marcar falta");
    expect(render({ etapa: 4, podeRegistrarDivergencia: false })).not.toContain("Registrar divergência");
  });

  it("falta marcada mantém motivo, desmarcar e justificativa obrigatória antes de concluir", async () => {
    const marcada = { ...task, items: [{ ...task.items![0]!, shortage: { qty: 12, boxed_qty: 29, expected_qty: 41, reason: "avaria", detail: "Volume 3 molhado" } }, task.items![1]!] };
    const fechada = caixa("CX-000132", "reviewed", [linha(`${RECEIPT}_02`, 2, "GG", 18)], { length_m: 0.48, width_m: 0.38, height_m: 0.3, gross_weight_kg: 6.1 });
    const semJustificativa = render({ task: marcada, caixas: [caixas[0]!, fechada], selecionada: null });
    expect(tagDoBotao(semJustificativa, "Concluir entrada")).toMatch(TRAVADO);
    expect(semJustificativa).toMatch(/<label[^>]*for="justificativa-da-divergencia"[^>]*>Justificativa da divergência<\/label>/);
    const pronta = render({ task: marcada, caixas: [caixas[0]!, fechada], selecionada: null, justificativa: "Fornecedor envia o volume 3 na próxima NF." });
    expect(tagDoBotao(pronta, "Concluir entrada")).not.toMatch(TRAVADO);
    expect(pronta).not.toContain("Sem caixa");
    await conferirTextosEAcessibilidade(semJustificativa, [
      ...CABECALHO, ...CAIXAS, ...LINHAS_DA_NF.filter((texto) => !["faltam 12", "Sem caixa"].includes(texto)), "2 caixas", "59 un. conferidas", "Há divergências na conferência", "Caixas e destinos",
      "GG 18 · 18 un. · 48 × 38 × 30 cm · 6,1 kg", "sem prateleira", "falta marcada · 12", "Avaria · Volume 3 molhado", "Desmarcar", "Falta marcada", "Justificativa da divergência",
      "divergência sem justificativa", "Voltar à conferência", "Registrar divergência", "Concluir entrada", AVISO_DA_REVISAO,
    ]);
  });

  it("quem só consulta vê comparação, caixas e medidas sem controles de operação", async () => {
    const html = render({ podeOperar: false, podeRegistrarDivergencia: false });
    for (const acao of ["Iniciar caixa", "Revisar caixa", "Adicionar à caixa", "Salvar quantidade", "Fechar caixa", "Remover caixa", "Concluir entrada", "Marcar falta", "Registrar divergência"]) expect(html).not.toContain(acao);
    expect(html).not.toContain('aria-label="Etapas do recebimento"');
    await conferirTextosEAcessibilidade(html, ["Detalhes do recebimento", "em conferência", "AVL-0D0E620B · NF 48.230", ...CAIXAS, ...LINHAS_DA_NF, "2 caixas", "59 un. conferidas", "Há divergências na conferência", "Caixas e destinos"]);
    const fechada = caixa("CX-000132", "reviewed", [linha(`${RECEIPT}_02`, 2, "GG", 18)], { length_m: 0.48, width_m: 0.38, height_m: 0.3, gross_weight_kg: 6.1 });
    const vista = render({ podeOperar: false, caixas: [caixas[0]!, fechada] });
    expect(vista).toContain("48 × 38 × 30 cm · 6,1 kg");
    expect(vista).not.toContain("Reabrir para ajustar");
    expect(vista).not.toContain("Guardar em");
  });
});

/** As etiquetas na revisão da entrada (recebimento com caixas, parte 6; mockup WmsEtiquetaRecebimentoRevisao). */
describe("as etiquetas na revisão da entrada", () => {
  it("a caixa com destino ganha Etiqueta e a chegada, Etiquetas da chegada; a caixa em conferência fica sem a ação", async () => {
    const base = textosDaTela(render({ etapa: 4 }));
    const html = render({ etapa: 4, onEtiquetas: () => undefined });
    expect(textosForaDaLista(html, base)).toEqual(["Etiquetas da chegada", "Etiqueta"]);
    expect(html).toMatch(/<button[^>]*aria-label="Etiqueta da caixa CX-000131"/);
    expect(html).not.toMatch(/aria-label="Etiqueta da caixa CX-000132"/);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("quem só consulta também imprime; sem caixa com destino, nada de etiqueta", () => {
    const consulta = render({ podeOperar: false, onEtiquetas: () => undefined });
    expect(consulta).toContain("Etiquetas da chegada");
    expect(consulta).toMatch(/aria-label="Etiqueta da caixa CX-000131"/);
    const semDestino = render({ etapa: 4, caixas: [caixas[1]!], selecionada: null, onEtiquetas: () => undefined });
    expect(semDestino).not.toContain("Etiqueta");
  });

  it("a etiqueta sai com o destino confirmado ou guardada (decisão 30)", () => {
    expect(temEtiqueta({ status: "committing", location_id: "B-02" })).toBe(true);
    expect(temEtiqueta({ status: "stored", location_id: "B-02" })).toBe(true);
    expect(temEtiqueta({ status: "committing", location_id: "" })).toBe(false);
    expect(temEtiqueta({ status: "reviewed", location_id: "" })).toBe(false);
    expect(temEtiqueta({ status: "counting", location_id: "" })).toBe(false);
  });

  it("a situação da etiqueta: impressa com a prateleira atual, ou com outra; o chip da caixa mostra (decisão 29)", () => {
    const impressa = { status: "committing", location_id: "B-02", label_printed_at: "2026-11-06T17:32:00.000Z", label_printed_location: "B-02" };
    expect(situacaoDaEtiqueta(impressa)).toBe("etiqueta impressa 14:32");
    expect(situacaoDaEtiqueta({ ...impressa, location_id: "B-05" })).toBe("etiqueta com B-02");
    expect(situacaoDaEtiqueta({ ...impressa, status: "reviewed", location_id: "" })).toBe("etiqueta com B-02");
    expect(situacaoDaEtiqueta({ ...impressa, label_printed_at: null })).toBeNull();
    const html = render({
      etapa: 4,
      caixas: [{ ...caixas[0]!, label_printed_at: "2026-11-06T17:32:00.000Z", label_printed_location: "B-02", label_print_count: 1 }, caixas[1]!],
    });
    expect(html).toContain("XG 29 · GG 12 · 41 un. · 48 × 38 × 30 cm · 9,4 kg · etiqueta impressa 14:32");
  });
});

describe("o que a bancada lê", () => {
  it.each(["", " ", "0", "-1", "Infinity", "1000001", "1,2345", "1.2345"])("quantidade inválida %j não vira uma contagem", (texto) => {
    expect(quantidadeManual(texto)).toBeNull();
  });

  it("a quantidade física aceita vírgula decimal e conserva três casas", () => {
    expect(quantidadeManual("1,25")).toBe(1.25);
    expect(quantidadeManual("0,001")).toBe(0.001);
    expect(quantidadeManual("1000000")).toBe(1_000_000);
  });

  it("o código lido acha a linha da NF pelo código do cliente, pelo SKU ou pelo código de barras", () => {
    const itens = task.items!;
    expect(linhaPeloCodigo(itens, "a.01.0806.004.xg ")?.id).toBe(`${RECEIPT}_01`);
    expect(linhaPeloCodigo(itens, "BTG-000087")?.id).toBe(`${RECEIPT}_02`);
    expect(linhaPeloCodigo(itens, "7891234500086")?.id).toBe(`${RECEIPT}_01`);
    expect(linhaPeloCodigo(itens, "BTG-000999")).toBeNull();
    expect(linhaPeloCodigo(itens, "  ")).toBeNull();
  });

  it("o conteúdo da caixa pelo tamanho, com o total", () => {
    expect(conteudoDaCaixa(caixas[0]!)).toBe("XG 29 · GG 12 · 41 un.");
  });

  it("o tamanho da linha é o do código; sem ele, o campo Tamanho; sem tamanho, o código (padrão do nome, 06/11/2026)", () => {
    const base = caixas[0]!.lines[0]!;
    const linhas: CaixaDaChegada["lines"] = [
      { ...base, size: null, counted_qty: 5 },
      // O código manda quando o campo diz outro tamanho.
      { ...base, client_item_code: "A.01.0806.004.GG", size: "XG", counted_qty: 2 },
      { ...base, client_item_code: "CAM-01", size: "m", counted_qty: 3 },
      { ...base, client_item_code: "A.09.0001.002", size: null, counted_qty: 1 },
      { ...base, client_item_code: "", size: null, sku_code: "BTG-000300", counted_qty: 1 },
    ];
    const caixa = { ...caixas[0]!, lines: linhas, unit_count: 12 };
    expect(conteudoDaCaixa(caixa)).toBe("XG 5 · GG 2 · M 3 · A.09.0001.002 1 · BTG-000300 1 · 12 un.");
  });

  it("a caixa já medida volta ao formato que a tela digita, em centímetros e quilos", () => {
    expect(rascunhoDaCaixa(caixas[0]!)).toEqual({
      length_cm: "48",
      width_cm: "38",
      height_cm: "30",
      weight_kg: "9,4",
      content: "",
      tombar: false,
      empilhar: false,
    });
    expect(rascunhoDaCaixa(caixa("CX-000140", "counting", [], { length_m: 0.485, width_m: null, height_m: 0.3 })).length_cm).toBe("48,5");
  });
});
