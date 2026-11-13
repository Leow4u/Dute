import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { FaltaDaLinhaConteudo } from "./falta-da-linha";

/** "Marcar falta" na linha da NF (parte 5d; mockup WmsRecebimentoFalta). */

const linha = {
  id: "inb_avulso_0d0e620b_01",
  line_number: 1,
  product_name: "POLO MASCULINO PIQUET PRETO XG",
  client_item_code: "A.01.0806.004.XG",
  sku_code: "BTG-000086",
  expected_quantity: 41,
  boxed_qty: 29,
};


/** A abertura do <button> que tem o rótulo (no BotaoDeAcao, o da camada atual). */
const tagDoBotao = (html: string, rotulo: string) =>
  html
    .split("<button")
    .slice(1)
    .map((parte) => `<button${parte.slice(0, parte.indexOf("</button>") + "</button>".length)}`)
    .find((botao) => botao.includes(`>${rotulo}<`))
    ?.match(/^<button[^>]*>/)?.[0] ?? "";

describe("marcar a falta da linha da NF", () => {
  it("o que a NF pede, o que está nas caixas e a falta; o motivo, o detalhe e marcar a falta da quantidade", async () => {
    const noop = () => undefined;
    const html = renderToStaticMarkup(
      <FaltaDaLinhaConteudo linha={linha} nf={41} emCaixas={29} falta={12} enviando={false} onCancelar={noop} onMarcar={noop} detalheInicial="Volume 3 não veio no caminhão" />,
    );
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Falta<\/button>/);
    expect(
      textosForaDaLista(html, [
        "POLO MASCULINO PIQUET PRETO XG",
        "A.01.0806.004.XG · BTG-000086",
        "NF",
        "41 un.",
        "Em caixas",
        "29 un.",
        "Falta",
        "12 un.",
        "Motivo",
        "Avaria",
        "Detalhe",
        "Cancelar",
        "Marcar falta de 12 un.",
        "Marcando…",
        "Conferir",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("enviando, o Cancelar e o Marcar ficam aria-disabled, nunca disabled: o foco não cai no body", () => {
    const noop = () => undefined;
    const html = renderToStaticMarkup(
      <FaltaDaLinhaConteudo linha={linha} nf={41} emCaixas={29} falta={12} enviando onCancelar={noop} onMarcar={noop} />,
    );
    for (const rotulo of ["Cancelar", "Marcar falta de 12 un."]) {
      expect(tagDoBotao(html, rotulo), rotulo).toContain('aria-disabled="true"');
      expect(tagDoBotao(html, rotulo), rotulo).not.toContain('disabled=""');
    }
    expect(tagDoBotao(html, "Marcar falta de 12 un.")).toContain('data-estado="andamento"');
  });
});
