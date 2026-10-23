import { JSDOM } from "jsdom";
import { Box } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import { ClientModuleShell, type ClientOverview } from "./shared";

function renderShell() {
  return renderToStaticMarkup(
    <ClientModuleShell
      overview={{} as ClientOverview}
      title="Estoque"
      description="7.314 peças em 168 itens"
      icon={Box}
    >
      <section data-testid="barra" className="sticky top-0">
        Busca
      </section>
      <p>Lista</p>
    </ClientModuleShell>,
  );
}

const ROLA = /^overflow(?:-[xy])?-(?:auto|scroll|hidden)$/;

/** Abaixo de md valem as classes sem prefixo. */
function rolaNoCelular(elemento: Element) {
  return [...elemento.classList].some((classe) => ROLA.test(classe));
}

/** De md para cima, as classes md: de overflow mandam; sem elas, valem as do celular. */
function rolaNoDesktop(elemento: Element) {
  const md = [...elemento.classList].filter((classe) => classe.startsWith("md:overflow"));
  if (md.length === 0) return rolaNoCelular(elemento);
  return md.some((classe) => ROLA.test(classe.slice("md:".length)));
}

/** O ancestral que rola (e onde o sticky prende): o primeiro com overflow que não é visible. */
function areaQueRola(elemento: Element, rola: (elemento: Element) => boolean) {
  for (let pai = elemento.parentElement; pai; pai = pai.parentElement) {
    if (rola(pai)) return pai;
  }
  return null;
}

function montar() {
  const dom = new JSDOM(`<!doctype html><body>${renderShell()}</body>`);
  const { document } = dom.window;
  return {
    dom,
    titulo: document.querySelector("header")!,
    barra: document.querySelector('[data-testid="barra"]')!,
    rolagem: document.querySelector('[data-testid="client-module-scroll"]')!,
    conteudo: document.querySelector('[data-testid="client-module-content"]')!,
  };
}

describe("tela do portal com título (Estoque, Eventos)", () => {
  it("no celular, o título rola junto com o conteúdo e a barra presa para no topo dessa área", () => {
    const { dom, titulo, barra, rolagem } = montar();
    expect(areaQueRola(titulo, rolaNoCelular)).toBe(rolagem);
    expect(areaQueRola(barra, rolaNoCelular)).toBe(rolagem);
    dom.window.close();
  });

  it("no celular, o respiro de cima fica no título, não na área que rola", () => {
    const { dom, titulo, rolagem } = montar();
    expect(titulo.classList.contains("pt-5")).toBe(true);
    expect([...rolagem.classList].some((classe) => /^(?:p|py|pt)-/.test(classe))).toBe(false);
    dom.window.close();
  });

  it("no desktop, o título fica e só o conteúdo rola", () => {
    const { dom, titulo, barra, conteudo } = montar();
    expect(areaQueRola(barra, rolaNoDesktop)).toBe(conteudo);
    expect(conteudo.contains(titulo)).toBe(false);
    dom.window.close();
  });

  it("passa no axe", async () => {
    expect(await violacoesDeAcessibilidade(renderShell())).toEqual([]);
  });
});
