// @vitest-environment jsdom
import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { itensDoInicioDoWms } from "@/lib/inicio-do-wms";
import { InicioDoWmsView } from "@/pages/home-view";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import { Skeleton } from "./skeleton";

/**
 * O Skeleton de sempre (33 usos: o Início de cada módulo, Operações,
 * Contagem, Mapa, Posições, Etiquetas, Relatórios, o portal e o painel do
 * agente) passa a ser o bloco neutro do carregamento v2 (seção 5.2), com a
 * mesma API: o `bg-primary/10 animate-pulse` ficava rosado na v3.
 */

function bloco(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  const achado = host.firstElementChild as HTMLElement | null;
  if (!achado) throw new Error("sem o bloco");
  return achado;
}

describe("o Skeleton", () => {
  it("é o bloco neutro com a faixa de brilho, sem o rosado nem o pulso", () => {
    const html = renderToStaticMarkup(<Skeleton className="h-80 rounded-lg" />);
    expect(html).not.toContain("bg-primary/10");
    expect(html).not.toContain("animate-pulse");
    const div = bloco(html);
    expect(div.tagName).toBe("DIV");
    expect(div.hasAttribute("data-esqueleto")).toBe(true);
    expect(div.classList.contains("carregando-esqueleto")).toBe(true);
    // Cada Skeleton é um cartão: tem a própria faixa, que faz dois ciclos e para.
    expect(div.classList.contains("carregando-com-brilho")).toBe(true);
  });

  it("fica sempre fora da árvore de acessibilidade", () => {
    expect(bloco(renderToStaticMarkup(<Skeleton />)).getAttribute("aria-hidden")).toBe("true");
    expect(bloco(renderToStaticMarkup(<Skeleton aria-hidden={false} />)).getAttribute("aria-hidden")).toBe("true");
  });

  it("guarda a API de quem já usa: a classe de tamanho e raio, os data-* e o estilo", () => {
    const div = bloco(
      renderToStaticMarkup(
        <Skeleton
          className="no-print h-4 max-w-[var(--skeleton-width)] flex-1 rounded-2xl"
          data-sidebar="menu-skeleton-text"
          style={{ "--skeleton-width": "60%" } as CSSProperties}
        />,
      ),
    );
    for (const classe of ["no-print", "h-4", "max-w-[var(--skeleton-width)]", "flex-1", "rounded-2xl"]) {
      expect(div.classList.contains(classe), classe).toBe(true);
    }
    // O raio de quem usa vence o 6 px do bloco (a utilidade fica acima da camada components).
    expect(div.classList.contains("rounded-md")).toBe(false);
    expect(div.getAttribute("data-sidebar")).toBe("menu-skeleton-text");
    expect(div.style.getPropertyValue("--skeleton-width")).toBe("60%");
  });
});

describe("o Início carregando", () => {
  const AGORA = new Date(2026, 9, 23, 9, 0);

  function render() {
    return renderToStaticMarkup(
      <Router ssrPath="/dashboard">
        <InicioDoWmsView
          nome="Sandra Melo"
          hoje={AGORA}
          inicio={{
            itens: itensDoInicioDoWms([]),
            carregando: true,
            falhas: [],
            hoje: { toPick: 0, toShip: 0, inTransit: 0, openReceipts: 0, skus: 0 },
          }}
        />
      </Router>,
    );
  }

  it("os blocos são neutros e ficam fora da árvore", async () => {
    const html = render();
    expect(html).not.toContain("bg-primary/10");
    expect(html).not.toContain("animate-pulse");
    const host = document.createElement("div");
    host.innerHTML = html;
    const blocos = Array.from(host.querySelectorAll("[data-esqueleto]"));
    // Desde a parte 13e, a forma final: as linhas-fantasma do "Precisa de você" (sem contagem lembrada, 2, cada
    // uma com a caixa, o título, o apoio e o botão) e o bloco no lugar de cada número do dia ainda não lido.
    expect(host.querySelectorAll("[data-linha-fantasma]")).toHaveLength(2);
    expect(blocos).toHaveLength(2 * 4 + 4);
    expect(blocos.every((achado) => achado.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
