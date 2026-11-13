// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { CarregandoTela } from "@/components/ui/carregando-tela";
import type { HomeInboxItem } from "@/lib/home-inbox";
import { itensDoInicioDoWms } from "@/lib/inicio-do-wms";
import { InicioDoWmsView, type InicioDoWms } from "@/pages/home-view";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

/**
 * O Início na primeira leitura (carregamento v2, parte 13e; a prancha da
 * abertura): a forma final desde 0 ms, com os títulos e os rótulos reais e
 * nenhum número antes de ler; as linhas-fantasma do "Precisa de você" com a
 * anatomia da linha real aos 300 ms; e, no lugar da frase, "Carregando o que
 * precisa de você…", que continua a espera da tela que abriu. Antes: três
 * barras sem a forma da linha, nada dizia que lia, e a fonte que falhava com
 * a lista vazia dizia "Nada parado". Dados sintéticos.
 */

const AGORA = new Date(2026, 10, 13, 9, 0);
const ITENS: HomeInboxItem[] = [
  { id: "triage", tone: "attention", title: "2 solicitações para aprovar", detail: "BTG Pactual", href: "/pedidos", actionLabel: "Aprovar" },
];
const LENDO: InicioDoWms = {
  itens: [],
  carregando: true,
  falhas: [],
  hoje: { toPick: 0, toShip: 0, inTransit: 0, openReceipts: 0, skus: null, skusLendo: true },
};

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  vi.unstubAllGlobals();
});

const espera = (ms: number) => act(async () => new Promise((pronto) => setTimeout(pronto, ms)));

function inicio(dados: Partial<InicioDoWms> = {}) {
  return (
    <Router ssrPath="/dashboard">
      <InicioDoWmsView nome="Sandra Melo" hoje={AGORA} inicio={{ ...LENDO, ...dados }} />
    </Router>
  );
}

const fantasmas = () => [...container.querySelectorAll<HTMLElement>("[data-linha-fantasma]")];

describe("o Início na primeira leitura", () => {
  it("desde 0 ms, a forma final: os títulos e os rótulos, nenhum número, o cartão com as linhas-fantasma guardadas", async () => {
    await act(async () => raiz!.render(inicio()));
    const textos = textosDaTela(container.innerHTML);
    expect(textos).toEqual([
      "Sexta-feira, 13 de novembro",
      "Bom dia, Sandra",
      "Precisa de você",
      "Hoje no armazém",
      "Pedidos para separar",
      "Prontos para envio",
      "Em rota de entrega",
      "Recebimentos em aberto",
      "SKUs em estoque",
    ]);
    expect(textos.some((texto) => /\d/.test(texto) && !texto.includes("novembro"))).toBe(false);
    // Os números ainda não lidos são os blocos, fora da árvore.
    const numeros = container.querySelector('[aria-labelledby="hoje-no-armazem"]')!;
    expect(numeros.querySelectorAll('[data-esqueleto][data-forma="contagem"]')).toHaveLength(5);
    expect(numeros.getAttribute("aria-busy")).toBe("true");
    // As linhas-fantasma com a anatomia da linha real, guardadas e invisíveis antes dos 300 ms; sem lembrança, 2.
    expect(fantasmas()).toHaveLength(2);
    expect(fantasmas()[0]!.querySelector('[data-forma="icone"]')).not.toBeNull();
    expect(fantasmas()[0]!.querySelector('[data-forma="botao"]')).not.toBeNull();
    expect(fantasmas()[0]!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(fantasmas().every((linha) => linha.classList.contains("opacity-0"))).toBe(true);
    expect(container.querySelector('[aria-labelledby="precisa-de-voce"]')!.getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).not.toContain("Nada parado");
  });

  it("aos 300 ms, as linhas-fantasma e Carregando o que precisa de você…, com a caixa de 24 px", async () => {
    await act(async () => raiz!.render(inicio()));
    await espera(360);
    expect(container.textContent).toContain("Carregando o que precisa de você…");
    expect(container.querySelector('[data-carregando-na-regiao] [data-spinner][data-tamanho="24"]')).not.toBeNull();
    expect(fantasmas().every((linha) => linha.classList.contains("opacity-100"))).toBe(true);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(
      textosForaDaLista(container.innerHTML, [
        "Sexta-feira, 13 de novembro", "Bom dia, Sandra", "Carregando o que precisa de você…", "Precisa de você", "Hoje no armazém",
        "Pedidos para separar", "Prontos para envio", "Em rota de entrega", "Recebimentos em aberto", "SKUs em estoque",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("continua a espera da tela que abriu: sem o vão de 300 ms entre a caixa da rota e a do Início", async () => {
    await act(async () => raiz!.render(<CarregandoTela titulo="Início" />));
    await espera(400);
    expect(container.textContent).toContain("Abrindo Início…");
    await act(async () => raiz!.render(inicio()));
    expect(container.textContent).toContain("Carregando o que precisa de você…");
    expect(fantasmas().every((linha) => linha.classList.contains("opacity-100"))).toBe(true);
  });

  it("a frase guarda o lugar dela sem texto no documento: invisível, fora da árvore, só no CSS", async () => {
    await act(async () => raiz!.render(inicio()));
    const reserva = container.querySelector<HTMLElement>("[data-reserva-da-frase]")!;
    expect(reserva.getAttribute("aria-hidden")).toBe("true");
    expect(reserva.classList.contains("invisible")).toBe(true);
    expect(reserva.textContent).toBe("");
    // Sem lembrança, a frase de 2: a altura que ela terá quando chegar (no celular, duas linhas).
    expect(reserva.getAttribute("data-frase")).toBe("2 coisas precisam de você na Armazenagem.");
  });

  it("na próxima abertura, as linhas-fantasma são quantas a leitura anterior trouxe", async () => {
    const quatro = Array.from({ length: 4 }, (_, i) => ({ ...ITENS[0]!, id: `x${i}`, title: `Item ${i}` }));
    await act(async () => raiz!.render(inicio({ carregando: false, itens: itensDoInicioDoWms(quatro) })));
    await act(async () => raiz!.render(<span />));
    await act(async () => raiz!.render(inicio()));
    expect(fantasmas()).toHaveLength(4);
  });

  it("lido, a frase e as linhas reais; o total de SKUs que falhou fica —", async () => {
    await act(async () =>
      raiz!.render(inicio({ carregando: false, itens: itensDoInicioDoWms(ITENS), hoje: { toPick: 3, toShip: 1, inTransit: 2, openReceipts: 4, skus: null } })),
    );
    expect(container.textContent).toContain("precisa de você na Armazenagem.");
    expect(fantasmas()).toHaveLength(0);
    const textos = textosDaTela(container.innerHTML);
    expect(textos[textos.indexOf("SKUs em estoque") + 1]).toBe("—");
  });

  it("a fonte que falhou com a lista vazia não diz Nada parado; o aviso tem Tentar de novo", async () => {
    const tentar = vi.fn();
    await act(async () =>
      raiz!.render(
        inicio({ carregando: false, falhas: ["armazém"], tentarFalhas: { tentando: false, onTentar: tentar }, hoje: null }),
      ),
    );
    expect(container.textContent).not.toContain("Nada parado");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Não foi possível carregar: armazém.");
    const botao = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "Tentar de novo")!;
    await act(async () => botao.click());
    expect(tentar).toHaveBeenCalledTimes(1);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });
});
