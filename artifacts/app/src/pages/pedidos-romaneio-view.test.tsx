import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { LINHAS_DO_VOLUME_INTEIRO } from "@/features/warehouse-ops/romaneio-documento";
import { folhaDoRomaneio, type FolhaDoRomaneio } from "@/lib/warehouse-ops/romaneio";
import type { VolumeDoPedido } from "@/lib/warehouse-ops/volumes-do-pedido";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { PedidosRomaneioView, type EstadoDoRomaneio } from "./pedidos-romaneio-view";

/**
 * Pedidos › Romaneio (separação com caixas, parte 4c;
 * docs/mockups/WmsSepararRomaneio.dc.html): a folha A4 que acompanha o
 * pedido, com o conteúdo de cada volume. Antes, o pedido saía sem ela.
 * Dados sintéticos.
 */

const noop = () => undefined;

function volume(numero: number, pesoKg: number | null, itens: Array<[string, string, number]>, caixa: string | null = null): VolumeDoPedido {
  return {
    id: `pkg_pack_ord_1_${String(numero).padStart(3, "0")}`,
    numero,
    aberto: false,
    unidades: itens.reduce((soma, [, , quantidade]) => soma + quantidade, 0),
    caixa,
    pesoKg,
    fechadoEm: "2026-11-12T17:40:00.000Z",
    itens: itens.map(([nome, codigo, quantidade]) => ({ nome, codigo, quantidade })),
  };
}

const VOLUMES = [
  // A caixa que saiu inteira e virou o volume: o romaneio não a cita.
  volume(1, 14.2, [["Polo Masculino Piquet Preto · P", "A.01.0806.005.P", 60]], "CX-000010"),
  volume(2, 11.6, [
    ["Calça Social Masculino Preta · 40", "A.01.0712.001.40", 30],
    ["Calça Social Masculino Preta · 42", "A.01.0712.001.42", 12],
  ]),
  volume(3, null, [
    ["Lancheira Grande AZ", "C.0612.002.U", 2],
    ["Porta Cartão Couro", "B.0567.005.U", 1200],
  ]),
];

const FOLHA = folhaDoRomaneio({
  numero: "PED-0001",
  cliente: "BTG Pactual",
  destino: "Agência Faria Lima",
  paraQuando: "2026-11-16T14:36:00.000Z",
  lacre: "88231",
  separadoDe: "2026-11-10T13:00:00.000Z",
  separadoAte: "2026-11-13T20:00:00.000Z",
  por: "Guilherme Dantas",
  volumes: VOLUMES,
});

function render(estado: EstadoDoRomaneio, folha: FolhaDoRomaneio | null, props: Partial<Parameters<typeof PedidosRomaneioView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/pedidos/romaneio">
      <PedidosRomaneioView estado={estado} folha={folha} onImprimir={noop} {...props} />
    </Router>,
  );
}

describe("Pedidos › Romaneio", () => {
  it("a tela nova já entra na v3", () => {
    expect(telaDoWmsNaV3("/pedidos/romaneio?pedido=ord_1")).toBe(true);
  });

  it("só rótulos, dados e ações: a barra, o cabeçalho do pedido e o conteúdo de cada volume", () => {
    expect(textosDaTela(render("pronto", FOLHA, { voltar: { href: "/pedidos/separar?pedido=ord_1", rotulo: "PED-0001" } }))).toEqual([
      "PED-0001",
      "Romaneio",
      "Imprimir",
      "Cliente",
      "BTG Pactual",
      "Destino",
      "Agência Faria Lima",
      "Para quando",
      "Seg 16/11/2026 11:36",
      "Lacre",
      "88231",
      "Volumes",
      "3",
      "Unidades",
      "1.304",
      "Separado",
      "10/11 a 13/11/2026",
      "Por",
      "Guilherme Dantas",
      "Volume",
      "Conteúdo",
      "Código",
      "Qtd.",
      "Peso",
      "1",
      "Polo Masculino Piquet Preto · P",
      "A.01.0806.005.P",
      "60",
      "14,2 kg",
      "2",
      "Calça Social Masculino Preta · 40",
      "A.01.0712.001.40",
      "30",
      "11,6 kg",
      "Calça Social Masculino Preta · 42",
      "A.01.0712.001.42",
      "12",
      // O volume sem peso sai sem peso.
      "Lancheira Grande AZ",
      "C.0612.002.U",
      "Porta Cartão Couro",
      "B.0567.005.U",
      "1.200",
      "app.dutelog.com.br",
    ]);
  });

  it("vai ao cliente: não cita caixa, posição nem valor", () => {
    const html = render("pronto", FOLHA);
    expect(html).not.toContain("CX-");
    const textos = textosDaTela(html).join(" ");
    for (const proibido of ["Posição", "Prateleira", "R$", "Valor"]) expect(textos).not.toContain(proibido);
  });

  it("o número e o peso do volume vêm na primeira linha dele; a última linha fecha o volume com o traço forte", () => {
    const dom = new JSDOM(`<!doctype html><body>${render("pronto", FOLHA)}</body>`);
    const corpos = [...dom.window.document.querySelectorAll("tbody")];
    expect(corpos).toHaveLength(3);
    const linhas = [...corpos[1]!.querySelectorAll("tr")];
    expect(linhas.map((linha) => [...linha.children].map((celula) => celula.textContent))).toEqual([
      ["2", "Calça Social Masculino Preta · 40", "A.01.0712.001.40", "30", "11,6 kg"],
      ["", "Calça Social Masculino Preta · 42", "A.01.0712.001.42", "12", ""],
    ]);
    expect(linhas[0]!.querySelector("th")?.getAttribute("scope")).toBe("rowgroup");
    // O traço forte só na última linha do volume, em todas as colunas.
    const forte = (linha: Element) => [...linha.children].map((celula) => celula.className.includes("border-b-[1.5px]"));
    expect(forte(linhas[0]!)).toEqual([false, false, false, false, false]);
    expect(forte(linhas[1]!)).toEqual([true, true, true, true, true]);
    dom.window.close();
  });

  it("o volume pequeno não se divide entre duas folhas; o grande quebra onde a folha acabar", () => {
    const grande = volume(
      4,
      20,
      Array.from({ length: LINHAS_DO_VOLUME_INTEIRO + 1 }, (_, indice) => [`Produto ${indice + 1}`, `C.${indice + 1}`, 1] as [string, string, number]),
    );
    const dom = new JSDOM(`<!doctype html><body>${render("pronto", folhaDoRomaneio({ numero: "PED-0001", volumes: [...VOLUMES, grande] }))}</body>`);
    const corpos = [...dom.window.document.querySelectorAll("tbody")];
    expect(corpos.map((corpo) => corpo.className.includes("break-inside-avoid"))).toEqual([true, true, true, false]);
    expect([...dom.window.document.querySelectorAll("tbody tr")].every((linha) => linha.className.includes("break-inside-avoid"))).toBe(true);
    dom.window.close();
  });

  it("o rodapé de cada página diz o pedido e a página; sem lacre, prazo ou quem separou, o campo sai com o traço", () => {
    const html = render("pronto", folhaDoRomaneio({ numero: "PED-0002", cliente: "BTG Pactual", volumes: VOLUMES.slice(0, 1) }));
    expect(html).toContain('content: "PED-0002 · página " counter(page) " de " counter(pages)');
    const textos = textosDaTela(html);
    expect(textos.slice(textos.indexOf("Destino"), textos.indexOf("Volumes"))).toEqual(["Destino", "—", "Para quando", "Lacre"]);
  });

  it("o volume sem conteúdo lido (o volume único de antes) sai com as unidades dele", () => {
    const antigo: VolumeDoPedido = { id: "pkg_pack_ord_2_001", numero: 1, aberto: false, unidades: 9, caixa: null, pesoKg: null, fechadoEm: null, itens: [] };
    const dom = new JSDOM(`<!doctype html><body>${render("pronto", folhaDoRomaneio({ numero: "PED-0002", volumes: [antigo] }))}</body>`);
    expect([...dom.window.document.querySelectorAll("tbody tr")].map((linha) => [...linha.children].map((celula) => celula.textContent))).toEqual([["1", "—", "", "9", ""]]);
    dom.window.close();
  });

  it("carregando, não encontrado, erro e pedido em separação: a mensagem no lugar da folha, e Imprimir desligado", () => {
    for (const [estado, mensagem] of [
      ["carregando", "Carregando"],
      ["nao_encontrado", "Pedido não encontrado"],
      ["erro", "Não foi possível carregar o pedido."],
      ["em_separacao", "Pedido em separação"],
    ] as const) {
      const html = render(estado, null);
      expect(textosDaTela(html)).toEqual(["Pedidos", "Romaneio", "Imprimir", mensagem]);
      expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Imprimir<\/button>/s);
    }
    expect(render("erro", null)).toContain('role="alert"');
  });

  it("voltar leva ao pedido; a leitura que falhou vira aviso, e a folha sai mesmo assim", () => {
    const html = render("pronto", FOLHA, { voltar: { href: "/pedidos/separar?pedido=ord_1", rotulo: "PED-0001" }, avisos: ["Não foi possível carregar o prazo do pedido."] });
    expect(html).toMatch(/<a [^>]*href="\/pedidos\/separar\?pedido=ord_1"/);
    expect(textosDaTela(html)).toContain("Não foi possível carregar o prazo do pedido.");
    expect(html).toContain('aria-label="Romaneio PED-0001"');
    // Sem o pedido lido, a volta é a Pedidos.
    expect(render("carregando", null)).toMatch(/<a [^>]*href="\/pedidos"/);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render("pronto", FOLHA))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render("em_separacao", null))).toEqual([]);
  });
});
