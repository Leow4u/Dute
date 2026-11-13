// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import axe from "axe-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/hooks/use-toast";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { Toaster } from "./toaster";

/**
 * O toast no celular (decisão 9.4.5 de 06/11/2026, mantida no carregamento v2
 * de 12/11/2026, seção 10, parte 5): abaixo de 768 px ele aparece embaixo,
 * perto do polegar, logo acima da barra de navegação do celular, e não
 * segura o toque fora dele; no computador fica onde estava, embaixo à
 * direita. O X aparece sem hover, com alvo de 44 px, e fecha no toque.
 *
 * O jsdom não carrega o Tailwind: as posições se conferem pelas classes de
 * cada tamanho de tela (sem prefixo é o celular; md: começa em 768 px).
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(AQUI, "../../index.css"), "utf8");
const BARRA_DE_BAIXO = readFileSync(join(AQUI, "../layout/mobile-tab-bar.tsx"), "utf8");

const ACIMA_DA_BARRA = "bottom-[calc(var(--altura-da-barra-de-baixo)+env(safe-area-inset-bottom))]";
const MENSAGEM = "Pedido 1042 aprovado";

const TELAS = ["sm", "md", "lg", "xl", "2xl"] as const;
type Tela = "celular" | (typeof TELAS)[number];

/** As classes do elemento por tamanho de tela; "celular" são as sem prefixo, que valem até alguma tela maior sobrescrever. */
function porTela(elemento: Element): Record<Tela, string[]> {
  const grupos: Record<Tela, string[]> = { celular: [], sm: [], md: [], lg: [], xl: [], "2xl": [] };
  for (const classe of Array.from(elemento.classList)) {
    const tela = TELAS.find((nome) => classe.startsWith(`${nome}:`));
    grupos[tela ?? "celular"].push(classe);
  }
  return grupos;
}

/** O valor de uma variável declarada no :root de fora das @-regras do index.css. */
function naRaiz(variavel: string): string | undefined {
  const texto = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  let profundidade = 0;
  let desde = 0;
  for (let i = 0; i < texto.length; i += 1) {
    if (texto[i] === "{") {
      const seletor = (texto.slice(desde, i).split(";").pop() ?? "").trim();
      const fim = texto.indexOf("}", i);
      if (profundidade === 0 && seletor === ":root") {
        const achado = new RegExp(`${variavel}\\s*:\\s*([^;]+);`).exec(texto.slice(i + 1, fim));
        if (achado) return achado[1].trim();
      }
      profundidade += 1;
      desde = i + 1;
    } else if (texto[i] === "}") {
      profundidade -= 1;
      desde = i + 1;
    }
  }
  return undefined;
}

let reacao: Root | null = null;
let container: HTMLDivElement | null = null;
const capturaOriginal = {
  has: Element.prototype.hasPointerCapture,
  release: Element.prototype.releasePointerCapture,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // O jsdom não tem captura de ponteiro; o toque no toast passa por ela ao soltar.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
  reacao = createRoot(container);
});

afterEach(() => {
  act(() => reacao?.unmount());
  container?.remove();
  reacao = null;
  container = null;
  Element.prototype.hasPointerCapture = capturaOriginal.has;
  Element.prototype.releasePointerCapture = capturaOriginal.release;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mostrar(extra: Parameters<typeof toast>[0] = {}) {
  act(() => reacao!.render(<Toaster />));
  act(() => {
    toast({ title: MENSAGEM, ...extra });
  });
}

function viewport(): HTMLOListElement {
  const achado = container!.querySelector("ol");
  if (!achado) throw new Error("sem o viewport do toast");
  return achado;
}

function aviso(): HTMLLIElement | null {
  return viewport().querySelector("li");
}

function avisoNaTela(): HTMLLIElement {
  const achado = aviso();
  if (!achado) throw new Error("sem o toast");
  return achado;
}

function fechar(): HTMLButtonElement {
  const achado = avisoNaTela().querySelector("button");
  if (!achado) throw new Error("sem o botão de fechar");
  return achado;
}

/** O nome acessível do elemento, calculado pelo axe-core. */
function nome(elemento: Element): string {
  axe.setup(document);
  try {
    return (axe as unknown as { commons: { text: { accessibleText(no: Element): string } } }).commons.text.accessibleText(elemento);
  } finally {
    axe.teardown();
  }
}

/** Um toque de dedo: pointerdown e pointerup de toque, e o click que o navegador manda depois. */
function tocar(alvo: Element) {
  const ponto = { bubbles: true, cancelable: true, button: 0, clientX: 340, clientY: 720 };
  const ponteiro = (tipo: string) => {
    const evento = new MouseEvent(tipo, ponto);
    Object.defineProperties(evento, {
      pointerId: { value: 1 },
      pointerType: { value: "touch" },
      isPrimary: { value: true },
    });
    return evento;
  };
  act(() => {
    alvo.dispatchEvent(ponteiro("pointerdown"));
    alvo.dispatchEvent(ponteiro("pointerup"));
    alvo.dispatchEvent(new MouseEvent("click", ponto));
  });
}

describe("onde o toast aparece", () => {
  it("no celular, embaixo, logo acima da barra de navegação e da área segura, nunca no topo", () => {
    mostrar();
    const { celular } = porTela(viewport());
    expect(celular).toContain("fixed");
    expect(celular).toContain(ACIMA_DA_BARRA);
    expect(celular.filter((classe) => /^(top|inset|inset-y)-/.test(classe))).toEqual([]);
    // 16 px dos lados e 8 px acima da barra, como na prancha do celular.
    expect(celular).toEqual(expect.arrayContaining(["px-4", "pb-2"]));
  });

  it("de 640 a 767 px nada muda: a barra de baixo ainda está na tela", () => {
    mostrar();
    expect(porTela(viewport()).sm).toEqual([]);
  });

  it("a altura que o toast pula é a da barra de baixo, que some a partir de 768 px", () => {
    expect(naRaiz("--altura-da-barra-de-baixo")).toBe("3.5rem");
    // Os itens da barra têm h-14 (3,5 rem), a área segura vem do safe-bottom e a barra some no md.
    expect(BARRA_DE_BAIXO).toMatch(/"flex h-14 /);
    expect(BARRA_DE_BAIXO).toMatch(/"safe-bottom shrink-0 md:hidden"/);
  });

  it("no computador, a partir de 768 px, fica onde estava: embaixo à direita, com 420 px no máximo", () => {
    mostrar();
    const { celular, md } = porTela(viewport());
    expect(celular).toContain("right-0");
    expect(md).toEqual(expect.arrayContaining(["md:bottom-0", "md:left-auto", "md:max-w-[420px]", "md:p-4"]));
    expect([...porTela(viewport()).lg, ...porTela(viewport()).xl, ...porTela(viewport())["2xl"]]).toEqual([]);
  });

  it("só o toast segura o toque: a faixa em volta dele deixa a lista de baixo responder", () => {
    mostrar();
    expect(porTela(viewport()).celular).toContain("pointer-events-none");
    expect(porTela(avisoNaTela()).celular).toContain("pointer-events-auto");
  });

  it("entra subindo de baixo em toda tela, sem descer do topo", () => {
    mostrar();
    const classes = Array.from(avisoNaTela().classList);
    expect(classes).toContain("data-[state=open]:slide-in-from-bottom-full");
    expect(classes.filter((classe) => classe.includes("slide-in-from-top"))).toEqual([]);
  });

  it("no celular sobe só o vão até a barra, aparecendo, sem passar por cima da barra de baixo", () => {
    mostrar();
    const classes = Array.from(avisoNaTela().classList);
    // O slide-in-from-bottom-full sobe a altura inteira do toast (54 px) e, no
    // celular, os primeiros quadros cobrem a barra de navegação. Abaixo de 768
    // px ele sobe no máximo o pb-2 do viewport (8 px), como na prancha.
    const subida = classes
      .map((classe) => /^max-md:data-\[state=open\]:slide-in-from-bottom-(\d+)$/.exec(classe))
      .find(Boolean);
    expect(subida, "sem a subida própria do celular").toBeTruthy();
    const vao = porTela(viewport()).celular.map((classe) => /^pb-(\d+)$/.exec(classe)).find(Boolean);
    expect(Number(subida![1])).toBeLessThanOrEqual(Number(vao![1]));
    expect(classes).toContain("max-md:data-[state=open]:fade-in-0");
  });

  it("com movimento reduzido não desliza: entra e sai de uma vez, nos dois tamanhos", () => {
    mostrar();
    const classes = Array.from(avisoNaTela().classList);
    expect(classes).toEqual(
      expect.arrayContaining([
        "motion-reduce:data-[state=open]:animate-none",
        "motion-reduce:data-[state=closed]:animate-none",
      ]),
    );
  });
});

describe("o botão de fechar", () => {
  it("chama-se Fechar e aparece sem hover, no aviso comum e no de erro", () => {
    for (const variant of ["default", "destructive"] as const) {
      mostrar({ variant });
      const botao = fechar();
      expect(nome(botao), variant).toBe("Fechar");
      const classes = Array.from(botao.classList);
      // Nada que esconda: sem opacidade zero, sem invisible, sem hidden.
      expect(classes.filter((classe) => /(^|:)(opacity-0|invisible|hidden|sr-only)$/.test(classe)), variant).toEqual([]);
      // E nada que só mostre no hover ou no foco.
      expect(classes.filter((classe) => /(hover|focus|focus-visible|focus-within):opacity-/.test(classe)), variant).toEqual([]);
    }
  });

  it("tem alvo de 44 px, e o texto do toast não passa por baixo dele", () => {
    mostrar();
    expect(porTela(fechar()).celular).toContain("size-11");
    const lados = porTela(avisoNaTela());
    expect(lados.celular).toContain("pr-12");
    // O md:p-6 do computador sobrescreveria o pr-12; o md:pr-12 vem junto.
    expect(lados.md).toEqual(expect.arrayContaining(["md:p-6", "md:pr-12"]));
  });

  it("fecha no toque", () => {
    mostrar();
    expect(avisoNaTela().textContent).toContain(MENSAGEM);
    tocar(fechar());
    expect(aviso()?.getAttribute("data-state") ?? "closed").toBe("closed");
    expect(viewport().textContent ?? "").not.toContain(MENSAGEM);
  });
});

describe("acessibilidade", () => {
  it("o toast só tem a mensagem e o Fechar, e a região se chama Avisos, em pt-BR", () => {
    mostrar();
    expect(textosDaTela(avisoNaTela().outerHTML)).toEqual([MENSAGEM, "Fechar"]);
    expect(container!.querySelector('[role="region"]')?.getAttribute("aria-label")).toBe("Avisos (F8)");
  });

  it("axe sem violação, no aviso comum e no de erro", async () => {
    const telas = (["default", "destructive"] as const).map((variant) => {
      mostrar({ variant, description: "Tente de novo." });
      return [variant, container!.innerHTML] as const;
    });
    // O axe-core usa os timers de verdade.
    vi.useRealTimers();
    for (const [variant, html] of telas) {
      expect(await violacoesDeAcessibilidade(html), variant).toEqual([]);
    }
  });
});
