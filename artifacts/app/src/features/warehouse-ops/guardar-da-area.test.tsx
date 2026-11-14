import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GuardaDaArea } from "@/lib/wms/guarda-da-area";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { GuardarDaAreaConteudo } from "./guardar-da-area";

/** O diálogo "Guardar do RECEBIMENTO" (decisão 16, parte 7e; mockup WmsEstoqueGuardar). */

const guarda: GuardaDaArea = {
  customer_code: "BTG Pactual",
  sku_code: "BTG-000214",
  location_id: "RECEBIMENTO",
  area: "RECEBIMENTO",
  product_name: "CAMISA POLO MANGA LONGA GG",
  client_item_code: "A.01.0806.005.GG",
  livre: 30,
  em_guardas_abertas: 6,
  sem_guarda: 24,
};

function corpo(quantidade: string, motivo: string) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <GuardarDaAreaConteudo
      nome="CAMISA POLO MANGA LONGA GG"
      codigo="BTG-000214 · A.01.0806.005.GG"
      guarda={guarda}
      quantidade={quantidade}
      motivo={motivo}
      enviando={false}
      onQuantidade={noop}
      onMotivo={noop}
      onCancelar={noop}
      onAbrir={noop}
    />,
  );
}

/** A abertura do <button> "Abrir a guarda" (o BotaoDeAcao, pela camada atual). */
const abrir = (html: string) =>
  html
    .split("<button")
    .slice(1)
    .map((parte) => `<button${parte.slice(0, parte.indexOf("</button>") + "</button>".length)}`)
    .find((botao) => botao.includes(">Abrir a guarda<"))
    ?.match(/^<button[^>]*>/)?.[0] ?? "";

describe("o diálogo Guardar do RECEBIMENTO", () => {
  it("mostra o livre na área, as guardas abertas e o que está sem guarda", () => {
    const html = corpo("24", "Contagem achou no RECEBIMENTO");
    expect(html).toContain("Livre no RECEBIMENTO</th>");
    expect(html).toMatch(/Em guardas abertas<\/th><td[^>]*>6<\/td>/);
    expect(html).toMatch(/Sem guarda<\/th><td[^>]*>24<\/td>/);
    expect(abrir(html)).not.toContain("aria-disabled");
  });

  it("Abrir a guarda só com a quantidade até o sem guarda e o motivo: travado com aria-disabled, nunca disabled", () => {
    for (const [quantidade, motivo] of [["25", "Contagem achou no RECEBIMENTO"], ["24", ""], ["", "Contagem achou no RECEBIMENTO"]]) {
      expect(abrir(corpo(quantidade, motivo))).toContain('aria-disabled="true"');
      expect(abrir(corpo(quantidade, motivo))).not.toContain('disabled=""');
    }
  });

  it("mostra só rótulos, dados e ações e passa no axe", async () => {
    const html = corpo("24", "Contagem achou no RECEBIMENTO");
    expect(
      textosForaDaLista(html, [
        "CAMISA POLO MANGA LONGA GG",
        "BTG-000214 · A.01.0806.005.GG",
        "Livre no RECEBIMENTO",
        "30",
        "Em guardas abertas",
        "6",
        "Sem guarda",
        "24",
        "Quantidade",
        "Motivo",
        "Cancelar",
        "Abrir a guarda",
        "Abrindo…",
        "Conferir",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
