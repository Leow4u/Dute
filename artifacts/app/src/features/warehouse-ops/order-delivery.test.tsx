import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formularioDaEntrega } from "@/lib/warehouse-ops/entrega";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { FormularioDaEntregaView } from "./order-delivery";

/** A entrega do pedido de saída no diálogo de Pedidos (parte 4.5c): os campos de cada modo, sem legenda. */

const noop = () => undefined;
const vazio = formularioDaEntrega(null, "2026-10-23");

function render(form = vazio, problemas = {}) {
  return renderToStaticMarkup(<FormularioDaEntregaView form={form} problemas={problemas} onForm={noop} />);
}

describe("a entrega do pedido", () => {
  it("pela Dutelog: o destino, a data e a hora, o contato, a montagem e o retorno", () => {
    expect(textosDaTela(render())).toEqual(["Entrega pela Dutelog", "Retirada pelo cliente", "Destino", "Data", "Hora", "Contato", "Telefone", "Montagem", "Desmontagem e retorno"]);
    expect(textosDaTela(render({ ...vazio, comRetorno: true }))).toEqual(expect.arrayContaining(["Retorno em"]));
  });

  it("retirada pelo cliente: retirada em, a hora, quem retira, o documento e a placa", () => {
    expect(textosDaTela(render({ ...vazio, modo: "retirada" }))).toEqual(["Entrega pela Dutelog", "Retirada pelo cliente", "Retirada em", "Hora", "Quem retira", "Documento", "Placa do veículo"]);
  });

  it("o que falta aparece no campo", () => {
    const html = render(vazio, { destino: "Informe o destino.", quando: "A data da entrega já passou." });
    expect(textosDaTela(html)).toEqual(expect.arrayContaining(["Informe o destino.", "A data da entrega já passou."]));
    expect(html).toMatch(/<input[^>]*id="entrega-destino"[^>]*aria-invalid="true"|<input[^>]*aria-invalid="true"[^>]*id="entrega-destino"/);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe nos dois modos", async () => {
    expect(await violacoesDeAcessibilidade(render({ ...vazio, comRetorno: true }, { destino: "Informe o destino." }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ ...vazio, modo: "retirada" }))).toEqual([]);
  });
});
