// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { linhaDoRetorno, type LinhaDoRetorno } from "@/lib/warehouse-ops/retorno";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { RetornosView } from "./order-returns";

/**
 * O diálogo "o que voltou" do retorno da Operação (parte 4.5d), sem legenda:
 * cada linha com o item e o tamanho ("Polo Masculino Piquet Preto · GG": o
 * nome é o mesmo em todos os tamanhos) e, embaixo, o código do cliente, o SKU
 * e o que saiu. Dados sintéticos.
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const RETORNO = { orderId: "ord_118", numero: "PED-0118", customerCode: "BTG Pactual", os: "10050-02", chegouEm: "2026-10-30T21:40:00.000Z" };
const noop = () => undefined;
const acoes = { abrir: noop, fechar: noop, mudarLinha: noop, mudarNotas: noop, receber: noop };

const LINHAS: LinhaDoRetorno[] = [
  linhaDoRetorno("oit_1", { sku_code: "BTG-000125", client_item_code: "A.01.0806.005.GG", product_name: "Polo Masculino Piquet Preto GG", picked_qty: 20 })!,
  linhaDoRetorno("oit_2", { sku_code: "BTG-000301", client_item_code: "C.0659.001.U", product_name: "Toalha de Academia", picked_qty: 3 })!,
  linhaDoRetorno("oit_3", { sku_code: "BTG-BAN-1", product_name: "Banner", allocated_qty: 6 })!,
];

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (raiz) await act(async () => raiz!.unmount());
  container?.remove();
  raiz = null;
  container = null;
});

async function abrir() {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <RetornosView
        retornos={[RETORNO]}
        aberto={{ retorno: RETORNO, linhas: LINHAS, notas: "", problema: null, erro: null, enviando: false }}
        acoes={acoes}
      />,
    );
  });
  const dialogo = document.querySelector('[role="dialog"]');
  if (!dialogo) throw new Error("O diálogo não abriu.");
  return dialogo;
}

describe("o que voltou do pedido", () => {
  it("cada linha com o item e o tamanho e, embaixo, o código do cliente, o SKU e o que saiu", async () => {
    const dialogo = await abrir();
    expect(textosDaTela(dialogo.outerHTML)).toEqual([
      "PED-0118: o que voltou",
      "Polo Masculino Piquet Preto · GG",
      "A.01.0806.005.GG · BTG-000125 · saiu 20",
      "Voltou",
      "Toalha de Academia",
      "C.0659.001.U · BTG-000301 · saiu 3",
      "Banner",
      "BTG-BAN-1 · saiu 6",
      "Observação",
      "Voltar",
      "Receber",
      "Recebendo…",
      "Conferir",
      "Fechar",
    ]);
    expect(dialogo.textContent).not.toContain("· U");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    const dialogo = await abrir();
    expect(await violacoesDeAcessibilidade(dialogo.outerHTML)).toEqual([]);
  });
});
