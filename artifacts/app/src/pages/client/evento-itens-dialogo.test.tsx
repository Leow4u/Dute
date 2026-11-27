// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ItemDaEdicao } from "@/lib/eventos/tipos";
import type { ProdutoDoEstoque } from "@/lib/eventos/itens";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { edicaoDaNecton, produtosDaNecton } from "@/test/eventos-necton";
import { textosForaDaLista } from "@/test/textos";

import { ItensDoEventoDialogo } from "./evento-itens-dialogo";

/**
 * Os itens do evento (docs/mockups/EventosPortalItens.dc.html): o diálogo com
 * a lista inteira por família e tamanho, a busca, o filtro por tipo, o "Ver
 * mais", a quantidade de cada tamanho, a família que sai e a falta de saldo.
 * Os 100 itens da Necton em 40 famílias; dados sintéticos.
 */

const NECTON = edicaoDaNecton();
const PRODUTOS = produtosDaNecton();

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
const chamadas = { mudou: [] as ItemDaEdicao[][], fechou: 0, escolheu: 0 };

function Tela({ produtos }: { produtos?: ProdutoDoEstoque[] }) {
  const [itens, setItens] = useState(NECTON.itens as ItemDaEdicao[]);
  return (
    <ItensDoEventoDialogo
      edicao={{ ...NECTON, itens: itens as typeof NECTON.itens }}
      produtos={produtos}
      onMudar={(novos) => {
        chamadas.mudou.push(novos);
        setItens(novos);
      }}
      onFechar={() => (chamadas.fechou += 1)}
      onEscolherMais={() => (chamadas.escolheu += 1)}
    />
  );
}

async function abrir(produtos?: ProdutoDoEstoque[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz!.render(<Tela produtos={produtos} />));
}

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const texto = () => dialogo().textContent ?? "";

function botao(rotulo: string): HTMLButtonElement {
  const achado = Array.from(dialogo().querySelectorAll<HTMLButtonElement>("button")).find(
    // O Chip junta o rótulo e a contagem sem espaço entre os dois ("Polo· 28").
    (item) => item.getAttribute("aria-label") === rotulo || item.textContent?.replace(/\s+/g, "") === rotulo.replace(/\s+/g, ""),
  );
  if (!achado) throw new Error(`Sem o botão ${rotulo}`);
  return achado;
}

async function clicar(rotulo: string) {
  await act(async () => botao(rotulo).click());
}

async function quantidade(rotulo: string, valor: string) {
  const campo = dialogo().querySelector<HTMLInputElement>(`input[aria-label="${rotulo}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

async function buscar(valor: string) {
  const campo = dialogo().querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  chamadas.mudou = [];
  chamadas.fechou = 0;
  chamadas.escolheu = 0;
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const TEXTOS = [
  "Itens do evento · B2B Conference Necton",
  // O textosDaTela junta o espaço duro do R$ ao espaço comum.
  "100 itens · 2.000 peças · R$ 86.400,00 em peças",
  "Todos",
  "Polo",
  "Camiseta",
  "Brindes",
  "Móveis",
  /^· \d+$/,
  "Ordem dos itens",
  "Como no Estoque",
  "Nome: A-Z",
  "Polo Masculino Piquet Arpoador",
  "A.01.0809.002 · 4 tamanhos",
  "Polo Feminina Piquet Azul Marinho",
  "A.01.0805.002 · 3 tamanhos",
  "Camiseta Feminina Piquet Preto",
  "A.02.0311.006 · 3 tamanhos",
  "Sacola Quadrada BTG",
  "J.0149.003",
  "Balcão de Recepção",
  "MAT-021",
  "Caneca Necton",
  "B.0412.001",
  "Toalha de Academia",
  "C.0659.001",
  "Poltrona Lounge Preta",
  "MAT-034",
  "Mesa Bistrô Branca",
  "MAT-040",
  "P",
  "M",
  "G",
  "GG",
  "N1",
  "Único",
  /^\d{1,3}$/,
  "peças",
  "peça",
  "Mostrando 16 de 100 itens",
  "Ver mais 30 itens",
  "100 itens · 2.000 peças",
  "Escolher mais no Estoque",
  "Pronto",
  "Fechar a lista de itens",
];

describe("Os itens do evento", () => {
  it("aberto: só os textos da prancha, e sem violação do axe", async () => {
    await abrir(PRODUTOS);
    expect(textosForaDaLista(dialogo().outerHTML, TEXTOS)).toEqual([]);
    expect(await violacoesDeAcessibilidade(dialogo().outerHTML)).toEqual([]);
    expect(dialogo().querySelector('input[aria-label="Buscar entre os 100 itens"]')).not.toBeNull();
    expect(dialogo().querySelector('select[aria-label="Ordem dos itens"]')).not.toBeNull();
    expect(dialogo().querySelector('input[aria-label="Polo Masculino Piquet Arpoador GG"]')?.getAttribute("inputmode")).toBe("numeric");
    expect(dialogo().querySelector('input[aria-label="Caneca Necton"]')).not.toBeNull();
    expect(dialogo().querySelector('[aria-invalid="true"]')).toBeNull();
  });

  it("Ver mais 30 itens passa a 'Mostrando 46 de 100 itens'; no fim não há o botão", async () => {
    await abrir(PRODUTOS);
    await clicar("Ver mais 30 itens");
    expect(texto()).toContain("Mostrando 46 de 100 itens");
    await clicar("Ver mais 30 itens");
    expect(texto()).toContain("Mostrando 74 de 100 itens");
    await clicar("Ver mais 26 itens");
    expect(texto()).toContain("Mostrando 100 de 100 itens");
    expect(texto()).not.toContain("Ver mais");
  });

  it("o filtro Polo deixa 28 itens e a busca 'Caneca' deixa uma família", async () => {
    await abrir(PRODUTOS);
    await clicar("Polo · 28");
    expect(texto()).toContain("Mostrando 16 de 28 itens");
    expect(texto()).not.toContain("Sacola Quadrada BTG");
    await clicar("Todos · 100");
    await buscar("Caneca");
    expect(texto()).toContain("Mostrando 1 de 1 item");
    expect(texto()).toContain("Caneca Necton");
    expect(texto()).not.toContain("Polo Masculino Piquet Arpoador");
  });

  it("mudar o GG para 0 chama onMudar sem o item e o total da família vai a 620; Tirar … do evento chama sem os quatro tamanhos", async () => {
    await abrir(PRODUTOS);
    await quantidade("Polo Masculino Piquet Arpoador GG", "0");
    expect(chamadas.mudou).toHaveLength(1);
    expect(chamadas.mudou[0]).toHaveLength(99);
    expect(chamadas.mudou[0].some((item) => item.client_item_code === "A.01.0809.002.GG")).toBe(false);
    expect(texto()).toContain("620");
    await quantidade("Polo Masculino Piquet Arpoador M", "250");
    expect(chamadas.mudou[1].find((item) => item.client_item_code === "A.01.0809.002.M")?.quantity).toBe(250);
    await quantidade("Polo Masculino Piquet Arpoador P", "muitas");
    expect(chamadas.mudou).toHaveLength(2);
    expect(dialogo().querySelector<HTMLInputElement>('input[aria-label="Polo Masculino Piquet Arpoador P"]')!.value).toBe("120");
    await clicar("Tirar Polo Masculino Piquet Arpoador do evento");
    expect(chamadas.mudou[2]).toHaveLength(96);
    expect(texto()).not.toContain("Polo Masculino Piquet Arpoador");
  });

  it("com o GG acima do disponível, o campo dele tem aria-invalid e a linha 'Falta saldo em 1 item: …' aparece; sem produtos, nenhum campo marcado", async () => {
    const gg = NECTON.itens[3].sku_code;
    await abrir(PRODUTOS.map((produto) => (produto.sku === gg ? { ...produto, available: 60 } : produto)));
    expect(dialogo().querySelector('input[aria-label="Polo Masculino Piquet Arpoador GG"]')?.getAttribute("aria-invalid")).toBe("true");
    expect(dialogo().querySelectorAll('[aria-invalid="true"]')).toHaveLength(1);
    expect(texto()).toContain("Falta saldo em 1 item: Polo Masculino Piquet Arpoador · GG (no evento 80, disponível 60)");
    expect(await violacoesDeAcessibilidade(dialogo().outerHTML)).toEqual([]);
    act(() => raiz?.unmount());
    container?.remove();
    document.body.innerHTML = "";
    await abrir();
    expect(dialogo().querySelector('[aria-invalid="true"]')).toBeNull();
    expect(texto()).not.toContain("Falta saldo");
    expect(texto()).toContain("100 itens · 2.000 peças");
  });

  it("Pronto chama onFechar, Escolher mais no Estoque chama onEscolherMais; o X tem 'Fechar a lista de itens'", async () => {
    await abrir(PRODUTOS);
    await clicar("Pronto");
    expect(chamadas.fechou).toBe(1);
    await clicar("Escolher mais no Estoque");
    expect(chamadas.escolheu).toBe(1);
    await clicar("Fechar a lista de itens");
    expect(chamadas.fechou).toBe(2);
  });
});
