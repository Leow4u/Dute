// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { CaixaDaLinha } from "@workspace/dominio";

import { divisaoDaLinha, type ParteDaDivisao } from "@/lib/warehouse-ops/divisao-em-volumes";
import type { LinhaDaLista } from "@/lib/warehouse-ops/lista-de-separacao";
import type { VolumeDaTarefa } from "@/lib/warehouse-ops/volumes-do-pedido";

import { DividirEmVolumesConteudo } from "./dividir-em-volumes";

/**
 * "Dividir em volumes" na mão de quem usa o teclado (separação com caixas,
 * parte 7b): tirar um volume não joga o foco no diálogo, e os números que
 * mudam ao vivo não tiram o foco do campo em que a pessoa digita. Como a
 * página, o estado guarda só as linhas; o volume aberto e os números vêm dos
 * volumes da tarefa. Dados sintéticos.
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const noop = () => undefined;

const POLO: LinhaDaLista = {
  id: "pli_ord_1_64",
  nome: "Polo Masculino Piquet Preto · M",
  codigos: "A.01.0806.005.M · BTG-000064",
  quantidade: 95,
  caixas: ["CX-000218", "CX-000219"],
  item: { id: "pli_ord_1_64", location: "A-07", product_name: "Polo Masculino Piquet Preto M", client_item_code: "A.01.0806.005.M", sku_code: "BTG-000064", expected_quantity: 95, quantity: 95 },
};
const SUGESTAO: CaixaDaLinha[] = [
  { box_code: "CX-000218", qty: 54, inteira: false, esvazia: false },
  { box_code: "CX-000219", qty: 41, inteira: false, esvazia: false },
];
const QUINZE: VolumeDaTarefa[] = Array.from({ length: 15 }, (_, indice) => ({ id: `v${indice + 1}`, number: indice + 1, status: "closed", units: 60 }));
/** WmsDividirComItens: o volume 16 aberto, com 35 un. de outra linha. */
const COM_O_16_ABERTO: VolumeDaTarefa[] = [...QUINZE, { id: "v16", number: 16, status: "open", units: 35 }];
/** Outra pessoa fechou o 16: as linhas do diálogo passam a ser o 17 e o 18. */
const COM_O_16_FECHADO: VolumeDaTarefa[] = [...QUINZE, { id: "v16", number: 16, status: "closed", units: 35 }];

function Bancada({ volumes }: { volumes: VolumeDaTarefa[] }) {
  const [partes, setPartes] = useState<ParteDaDivisao[] | null>(null);
  const divisao = divisaoDaLinha({ linha: POLO, modo: "separar", volumes, caixas: SUGESTAO, partes });
  return divisao ? <DividirEmVolumesConteudo divisao={divisao} onMudar={(nova) => setPartes(nova.partes)} onVoltar={noop} onConfirmar={noop} /> : null;
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (raiz) await act(async () => raiz!.unmount());
  container?.remove();
  raiz = null;
  container = null;
});

async function abrir(volumes: VolumeDaTarefa[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz!.render(<Bancada volumes={volumes} />));
}

function botao(rotulo: string): HTMLButtonElement {
  const achado = [...document.querySelectorAll("button")].find((candidato) => (candidato.getAttribute("aria-label") ?? candidato.textContent) === rotulo);
  if (!achado) throw new Error(`Sem o botão ${rotulo}.`);
  return achado;
}

function campo(rotulo: string): HTMLInputElement {
  const achado = document.querySelector<HTMLInputElement>(`input[aria-label='${rotulo}']`);
  if (!achado) throw new Error(`Sem o campo ${rotulo}.`);
  return achado;
}

describe("Dividir em volumes pelo teclado", () => {
  it("Tirar o volume 17: o foco vai para Mais um volume, e não cai no diálogo", async () => {
    await abrir(COM_O_16_ABERTO);
    await act(async () => botao("Mais um volume").click());
    expect([...document.querySelectorAll<HTMLInputElement>("input[aria-label^='Separado no volume']")].map((entrada) => entrada.value)).toEqual(["54", "20", "21"]);
    const lixeira = botao("Tirar o volume 17");
    lixeira.focus();
    await act(async () => lixeira.click());
    expect(document.querySelector("button[aria-label='Tirar o volume 17']")).toBeNull();
    expect(document.activeElement).toBe(botao("Mais um volume"));
  });

  it("os números mudam ao vivo, e o campo em que a pessoa digita fica com o foco", async () => {
    await abrir(COM_O_16_ABERTO);
    const digitando = campo("Separado no volume 16");
    digitando.focus();
    await act(async () => raiz!.render(<Bancada volumes={COM_O_16_FECHADO} />));
    // A mesma linha, agora o volume 17: o campo é o mesmo, e o foco continua nele.
    expect(campo("Separado no volume 17")).toBe(digitando);
    expect(document.activeElement).toBe(digitando);
  });
});
