import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import type { VolumeDoPedido } from "@/lib/warehouse-ops/volumes-do-pedido";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { PedidoSeparadoView } from "./pedido-separado-view";

/**
 * O pedido separado (separação com caixas, parte 4d;
 * docs/mockups/WmsSepararConcluido.dc.html). Antes, o pedido concluído só
 * dizia "Separação concluída": não havia onde ver os volumes nem de onde
 * tirar as etiquetas com o total e o romaneio. Dados sintéticos.
 */

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
  volume(1, 14.2, [["Polo Masculino Piquet Preto · P", "A.01.0806.005.P", 60]], "CX-000010"),
  volume(2, null, [["Polo Feminino Piquet Preto · G", "A.01.0805.002.G", 50]]),
  volume(3, 11.6, [
    ["Calça Social Masculino Preta · 40", "A.01.0712.001.40", 30],
    ["Calça Social Masculino Preta · 42", "A.01.0712.001.42", 12],
  ]),
];
const RESUMO = "BTG Pactual · 116 itens · 152 un. · 3 volumes · lacre 88231 · Para quando Seg 16/11 11:36";
const etiquetaDoVolumeHref = (item: VolumeDoPedido) => `/estoque/etiquetas?pedido=ord_1&volumes=${item.numero}`;

type Props = Partial<Parameters<typeof PedidoSeparadoView>[0]>;

function render(props: Props = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/pedidos/separar">
      <PedidoSeparadoView
        numero="PED-0001"
        resumo={RESUMO}
        estado="pronto"
        volumes={VOLUMES}
        etiquetasDosVolumesHref="/estoque/etiquetas?pedido=ord_1&volumes=todos"
        romaneioHref="/pedidos/romaneio?pedido=ord_1"
        etiquetaDoVolumeHref={etiquetaDoVolumeHref}
        {...props}
      />
    </Router>,
  );
}

describe("Pedidos › o pedido separado", () => {
  it("só rótulos, dados e ações: o pedido, as etiquetas, o romaneio e os volumes com o conteúdo de cada um", () => {
    expect(textosDaTela(render())).toEqual([
      "PED-0001",
      "separado",
      RESUMO,
      "Etiquetas dos volumes",
      "Romaneio",
      "Volumes",
      "3 volumes · 152 un.",
      "Volume 1",
      // A caixa que saiu inteira e virou o volume.
      "CX-000010",
      "60 × Polo Masculino Piquet Preto · P",
      "60 un. · 14,2 kg",
      "Etiqueta",
      "Volume 2",
      "50 × Polo Feminino Piquet Preto · G",
      // Sem peso, só as unidades.
      "50 un.",
      "Volume 3",
      "30 × Calça Social Masculino Preta · 40 · 12 × Calça Social Masculino Preta · 42",
      "42 un. · 11,6 kg",
    ]);
  });

  it("as etiquetas saem em lote, o romaneio pelo pedido, e cada volume tem a etiqueta dele; voltar leva a Pedidos", () => {
    const dom = new JSDOM(`<!doctype html><body>${render()}</body>`);
    const links = [...dom.window.document.querySelectorAll("a")].map((link) => [link.getAttribute("aria-label") ?? link.textContent, link.getAttribute("href")]);
    expect(links).toEqual([
      ["Voltar a Pedidos", "/pedidos"],
      ["Etiquetas dos volumes", "/estoque/etiquetas?pedido=ord_1&volumes=todos"],
      ["Romaneio", "/pedidos/romaneio?pedido=ord_1"],
      ["Etiqueta do volume 1", "/estoque/etiquetas?pedido=ord_1&volumes=1"],
      ["Etiqueta do volume 2", "/estoque/etiquetas?pedido=ord_1&volumes=2"],
      ["Etiqueta do volume 3", "/estoque/etiquetas?pedido=ord_1&volumes=3"],
    ]);
    dom.window.close();
  });

  it("com mais de doze volumes, mostra os doze primeiros e Ver os N volumes", () => {
    const muitos = Array.from({ length: 42 }, (_, indice) => volume(indice + 1, 5, [[`Produto ${indice + 1}`, `C.${indice + 1}`, 10]]));
    const textos = textosDaTela(render({ volumes: muitos }));
    expect(textos).toContain("42 volumes · 420 un.");
    expect(textos.filter((texto) => /^Volume \d+$/.test(texto))).toEqual(Array.from({ length: 12 }, (_, indice) => `Volume ${indice + 1}`));
    expect(textos.at(-1)).toBe("Ver os 42 volumes");
  });

  it("as caixas que o pedido abriu, com Imprimir etiquetas, e as que ele esvaziou", () => {
    const html = render({
      etiquetas: [
        { code: "CX-000186", posicao: "B-09", saldo: 4 },
        { code: "CX-000211", posicao: "C-04", saldo: 18 },
      ],
      etiquetasHref: "/estoque/etiquetas?caixas=CX-000186%2CCX-000211",
      vazias: [
        { code: "CX-000027", posicao: "A-05" },
        { code: "CX-000090", posicao: "B-05" },
      ],
    });
    const textos = textosDaTela(html);
    expect(textos.slice(textos.indexOf("Etiquetas para trocar"))).toEqual([
      "Etiquetas para trocar",
      "2 caixas abertas",
      "Imprimir etiquetas",
      "CX-000186",
      "B-09 · saldo 4 un.",
      "CX-000211",
      "C-04 · saldo 18 un.",
      "Caixas vazias",
      "2 encerradas",
      "CX-000027 · A-05",
      "CX-000090 · B-05",
    ]);
    expect(html).toContain('href="/estoque/etiquetas?caixas=CX-000186%2CCX-000211"');
    // Sem caixa aberta nem vazia, a tela não ganha os painéis.
    expect(textosDaTela(render()).join(" ")).not.toMatch(/Etiquetas para trocar|Caixas vazias/);
    expect(textosDaTela(render({ vazias: [{ code: "CX-000027", posicao: "A-05" }] }))).toContain("1 encerrada");
  });

  it("enquanto os volumes não chegam, com falha ou sem volume, a mensagem no lugar da lista, sem as ações", () => {
    for (const [props, mensagem] of [
      [{ estado: "erro", volumes: [] }, "Não foi possível carregar os volumes."],
      [{ estado: "pronto", volumes: [] }, "Nenhum volume"],
    ] as Array<[Props, string]>) {
      expect(textosDaTela(render(props))).toEqual(["PED-0001", "separado", RESUMO, "Volumes", mensagem]);
    }
    expect(render({ estado: "erro", volumes: [] })).toContain('role="alert"');
  });

  it("o pedido já entregue diz entregue", () => {
    expect(textosDaTela(render({ selo: "entregue" })).slice(0, 2)).toEqual(["PED-0001", "entregue"]);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(
      await violacoesDeAcessibilidade(
        render({ etiquetas: [{ code: "CX-000186", posicao: "B-09", saldo: 4 }], etiquetasHref: "/estoque/etiquetas?caixas=CX-000186", vazias: [{ code: "CX-000027", posicao: "A-05" }] }),
      ),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ estado: "carregando", volumes: [] }))).toEqual([]);
  });
});

describe("os volumes carregando (carregamento v2, parte 13c)", () => {
  it("a espera em bloco no lugar da lista, sem o \"Carregando\" seco", () => {
    const html = render({ estado: "carregando", volumes: [] });
    expect(textosDaTela(html)).toEqual(["PED-0001", "separado", RESUMO, "Volumes"]);
    expect(html).toContain("data-carregando-na-regiao");
  });
});
