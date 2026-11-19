import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import type { DestinoDoMover, PreviaDoMover, ResultadoDoMover } from "@/lib/warehouse-ops/mover-caixa";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela as textosComAsCamadas } from "@/test/textos";

import { EstoqueMapaMoverView, type EstadoDoMover } from "./estoque-mapa-mover-view";

/**
 * Estoque › Mapa › Mover caixa (docs/superpowers/specs/2026-11-19-mover-caixa-design.md;
 * mockup aprovado em docs/mockups/mover-caixa/): a caixa, a sugestão do
 * sistema, a escolha à mão, a caixa movida com a etiqueta e as recusas. Sem
 * legenda: só rótulos, dados e ações. Dados sintéticos.
 */

/** As camadas escondidas do BotaoDeAcao que podem estar no HTML: o gerúndio e o "Conferir". */
const CAMADAS = ["Movendo…", "Conferir"];

function textosDaTela(html: string): string[] {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  for (const camada of dom.window.document.querySelectorAll(".botao-acao-camada:not([data-atual])")) {
    const texto = camada.textContent?.trim() ?? "";
    const atual = camada.closest("button")?.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim();
    if (texto && !CAMADAS.includes(texto) && texto !== atual) throw new Error(`Camada fora da lista: ${texto}`);
    camada.remove();
  }
  const limpo = dom.window.document.body.innerHTML;
  dom.window.close();
  return textosComAsCamadas(limpo);
}

function foraDaLista(html: string, permitidos: ReadonlyArray<string | RegExp>): string[] {
  return textosDaTela(html).filter((texto) => !permitidos.some((permitido) => (typeof permitido === "string" ? permitido === texto : permitido.test(texto))));
}

const DE_PE: DestinoDoMover["placement"] = { front_m: 0.4, depth_m: 0.6, height_m: 0.35, orientation: "length_width_height" };
const destino = (code: string, tier: 1 | 2, free_front_m: number, box_count: number, reason = "", placement: DestinoDoMover["placement"] = DE_PE): DestinoDoMover => ({
  code,
  tier,
  reason,
  free_front_m,
  box_count,
  sequence: 0,
  placement,
});

const PREVIA: PreviaDoMover = {
  ok: true,
  box: {
    code: "CX-000121",
    status: "stored",
    location_id: "A-01",
    units: 20,
    items: [
      { sku_code: "BTG-000112", qty: 12, client_item_code: "A.01.0713.005.M", product_name: "Polo Masculino Piquet Preto", size: "M" },
      { sku_code: "BTG-000113", qty: 8, client_item_code: "A.01.0713.005.G", product_name: "Polo Masculino Piquet Preto", size: "G" },
    ],
    origin_kind: "opening_inventory",
    stored_at: "2026-10-22T13:00:00.000Z",
    length_m: 0.4,
    width_m: 0.6,
    height_m: 0.35,
    gross_weight_kg: 10,
  },
  bloqueio: null,
  prateleiras: [
    destino("B-09", 1, 1.42, 2, "Já tem Polo Masculino Piquet Preto · M e ainda cabe."),
    destino("B-10", 1, 0.62, 4, "Já tem Polo Masculino Piquet Preto · M e ainda cabe.", { ...DE_PE, support_box_code: "CX-000150", base_height_m: 0.35 }),
    destino("C-02", 2, 1.78, 0, "A mais vazia da zona: 1,78 m livres de frente.", { front_m: 0.6, depth_m: 0.4, height_m: 0.35, orientation: "width_length_height" }),
    destino("C-01", 2, 1.38, 1, "1,38 m livres de frente."),
    destino("A-03", 2, 0.98, 3, "0,98 m livres de frente."),
    destino("B-08", 2, 0.46, 5, "0,46 m livres de frente."),
    destino("C-03", 2, 0.44, 5, "0,44 m livres de frente."),
    destino("C-04", 2, 0.42, 5, "0,42 m livres de frente."),
    destino("C-05", 2, 0.41, 5, "0,41 m livres de frente."),
  ],
  nao_cabem: ["A-02", "B-11"],
  com_reserva: ["B-12"],
  em_contagem: [],
  rejected: null,
};

const MOVIDA: ResultadoDoMover = {
  ok: true,
  box_move_id: "bmv_1",
  box_code: "CX-000121",
  from_location_id: "A-01",
  to_location_id: "B-09",
  units: 20,
  items: PREVIA.box.items,
  moved_at: "2026-11-19T17:32:00.000Z",
  moved_by_name: "Leonardo",
  suggestion_followed: true,
  placement: DE_PE,
  movement_ids: [],
};

const nada = () => undefined;

function tela(estado: EstadoDoMover, extra: Partial<Parameters<typeof EstoqueMapaMoverView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/estoque/mapa/mover">
      <EstoqueMapaMoverView
        estado={estado}
        digitado={estado.fase === "vazia" ? "" : "CX-000121"}
        avisoDoCampo={null}
        onDigitar={nada}
        onAbrir={nada}
        modo="sugestao"
        onModo={nada}
        escolhida="B-09"
        onEscolher={nada}
        verTodas={false}
        onVerTodas={nada}
        mover={{ estado: "repouso" }}
        onMover={nada}
        recusa={null}
        etiquetas={[]}
        hrefDasEtiquetas={(codigos) => `/estoque/etiquetas?caixas=${codigos.join(",")}`}
        onOutraCaixa={nada}
        onTentar={nada}
        {...extra}
      />
    </Router>,
  );
}

const CABECALHO = ["Mapa", "Mover caixa", "Caixa", "Abrir"];
const CARTAO = [
  "CX-000121",
  "guardada",
  "em",
  "A-01",
  "20 un.",
  "12",
  "× Polo Masculino Piquet Preto · M",
  "A.01.0713.005.M",
  "8",
  "× Polo Masculino Piquet Preto · G",
  "A.01.0713.005.G",
  "Abertura · 22/10/2026 · 40 × 60 × 35 cm · 10 kg",
];
const PAINEL = ["Mover para", "Sugestão do sistema", "Escolher prateleira"];

describe("Mover caixa", () => {
  it("vazia: o campo da caixa e nada mais", async () => {
    const html = tela({ fase: "vazia" });
    expect(foraDaLista(html, CABECALHO)).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a sugestão: a caixa, a prateleira sugerida com o motivo e Mover para B-09", async () => {
    const html = tela({ fase: "pronta", previa: PREVIA });
    expect(
      foraDaLista(html, [...CABECALHO, ...CARTAO, ...PAINEL, "B-09", "Já tem Polo Masculino Piquet Preto · M e ainda cabe.", "1,42 m livres · 2 caixas", "Frente 40 × profundidade 60 × altura 35 cm", "mesmo produto", "alternativas B-10 · C-02", "Mover para B-09"]),
    ).toEqual([]);
    // O encaixe que a tela mostra é o que o mover manda (como o Receber).
    expect(html).toContain("Frente 40 × profundidade 60 × altura 35 cm");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("escolher à mão: as oito primeiras, Ver as 9 prateleiras, as de fora e Mover para C-02", async () => {
    const html = tela({ fase: "pronta", previa: PREVIA }, { modo: "escolha", escolhida: "C-02" });
    expect(
      foraDaLista(html, [
        ...CABECALHO,
        ...CARTAO,
        ...PAINEL,
        /^[A-C]-0\d$/,
        "B-10",
        "mesmo produto",
        /^\d,\d\d m livres · (sem caixas|\d caixas?)$/,
        "Ver as 9 prateleiras",
        "Não cabe: A-02 · B-11",
        "Com reserva: B-12",
        "Frente 60 × profundidade 40 × altura 35 cm",
        "Mover para C-02",
      ]),
    ).toEqual([]);
    // O encaixe da escolhida, ao lado do botão; a outra prateleira com caixa de apoio diz sobre qual.
    expect(html).toContain("Frente 60 × profundidade 40 × altura 35 cm");
    expect(tela({ fase: "pronta", previa: PREVIA }, { modo: "escolha", escolhida: "B-10" })).toContain("Sobre a caixa CX-000150 · base a 35 cm · Frente 40 × profundidade 60 × altura 35 cm");
    expect(html).not.toContain("C-05");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    // Com "Ver as 9 prateleiras", todas.
    expect(tela({ fase: "pronta", previa: PREVIA }, { modo: "escolha", escolhida: "C-02", verTodas: true })).toContain("C-05");
  });

  it("movida: a caixa na prateleira nova, de onde saiu, Imprimir etiqueta e Mover outra caixa", async () => {
    const html = tela({ fase: "movida", previa: PREVIA, resultado: MOVIDA }, { etiquetas: ["CX-000121", "CX-000130", "CX-000140"] });
    expect(
      foraDaLista(html, [
        ...CABECALHO,
        ...CARTAO.map((texto) => (texto === "A-01" ? "B-09" : texto)),
        "CX-000121 em B-09",
        "saiu de A-01 · 20 un. · 19/11 14:32 · Leonardo",
        "Imprimir etiqueta",
        "Mover outra caixa",
        "Etiquetas para trocar · 3",
      ]),
    ).toEqual([]);
    expect(html).toContain('href="/estoque/etiquetas?caixas=CX-000121"');
    expect(html).toContain('href="/estoque/etiquetas?caixas=CX-000121,CX-000130,CX-000140"');
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("com uma caixa só sem etiqueta, o botão dela basta", () => {
    expect(tela({ fase: "movida", previa: PREVIA, resultado: MOVIDA }, { etiquetas: ["CX-000121"] })).not.toContain("Etiquetas para trocar");
  });

  it("o bloqueio da prévia e a recusa do servidor ficam no lugar do Mover para", async () => {
    const reservada = "Polo Masculino Piquet Preto · M está reservado em A-01 para o pedido PED-0042: mova a caixa depois da entrega.";
    const html = tela({ fase: "pronta", previa: { ...PREVIA, bloqueio: { code: "BOX_MOVE_RESERVED", message: reservada }, prateleiras: [], nao_cabem: [], com_reserva: [] } });
    expect(foraDaLista(html, [...CABECALHO, ...CARTAO, reservada])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    const recusada = "Polo Masculino Piquet Preto · M está reservado em B-09 para o pedido PED-0043: escolha outra prateleira ou mova depois da entrega.";
    const depois = tela({ fase: "pronta", previa: PREVIA }, { recusa: recusada });
    expect(depois).toContain(recusada);
    expect(depois).toContain("Mover para B-09");
  });

  it("sem prateleira que receba a caixa: a frase do servidor e as de fora", async () => {
    const semLugar = "Nenhuma outra prateleira da zona de BTG Pactual recebe esta caixa agora.";
    const html = tela({ fase: "pronta", previa: { ...PREVIA, prateleiras: [], rejected: semLugar, em_contagem: ["C-01"] } });
    expect(foraDaLista(html, [...CABECALHO, ...CARTAO, ...PAINEL, semLugar, "Não cabe: A-02 · B-11", "Com reserva: B-12", "Em contagem: C-01"])).toEqual([]);
    expect(html).not.toContain("Mover para B-09");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o código que não é de caixa e a leitura que falhou", async () => {
    const aviso = tela({ fase: "vazia" }, { digitado: "A-01", avisoDoCampo: "Caixa inválida: confira o código e tente de novo." });
    expect(foraDaLista(aviso, [...CABECALHO, "Caixa inválida: confira o código e tente de novo."])).toEqual([]);
    expect(await violacoesDeAcessibilidade(aviso)).toEqual([]);
    const falha = tela({ fase: "falha", caixa: "CX-000121", erro: new Error("internal") });
    expect(foraDaLista(falha, [...CABECALHO, "Não consegui carregar a caixa.", "Tentar de novo"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(falha)).toEqual([]);
  });
});
