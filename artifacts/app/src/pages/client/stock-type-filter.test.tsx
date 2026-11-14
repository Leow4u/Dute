// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";

import { StockTypeFilter } from "./stock-type-filter";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const categories = [
  { value: "todos", label: "Todos os tipos", count: 18 },
  { value: "polo", label: "Polo", count: 6 },
  { value: "toalha", label: "Toalha", count: 5 },
  { value: "sacola", label: "Sacola", count: 4 },
  { value: "camiseta", label: "Camiseta egípcia", count: 2 },
  { value: "bone", label: "Boné", count: 1 },
];

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function mount(initial: string[] = [], options = categories) {
  function Harness() {
    const [selectedValues, setSelectedValues] = useState(initial);
    const [resetKey, setResetKey] = useState(0);
    return (
      <>
        <StockTypeFilter categories={options} selectedValues={selectedValues} onChange={setSelectedValues} resetKey={resetKey} />
        <output aria-label="Tipos escolhidos">{JSON.stringify(selectedValues)}</output>
        <button type="button" onClick={() => { setSelectedValues([]); setResetKey((value) => value + 1); }}>Limpar filtros</button>
      </>
    );
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <>
        <Anunciador />
        <Harness />
      </>,
    ),
  );
}

function checkbox(label: string) {
  const text = [...document.querySelectorAll("label")].find((element) => element.textContent?.trim() === label);
  const control = text && document.getElementById(text.htmlFor);
  expect(control, `tipo ${label}`).not.toBeNull();
  expect(control, `tipo ${label}`).toBeDefined();
  return control!;
}

function visibleTypes() {
  return [...document.querySelectorAll('label[for]')]
    .filter((label) => document.getElementById(label.getAttribute("for")!)?.getAttribute("role") === "checkbox")
    .map((label) => label.textContent?.trim());
}

function button(text: string) {
  const control = [...document.querySelectorAll("button")].find((element) => element.textContent?.trim() === text);
  expect(control, `botão ${text}`).toBeDefined();
  return control!;
}

async function click(control: HTMLElement) {
  await act(async () => control.click());
}

async function search(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Buscar tipo de produto"]')!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function selection() {
  return JSON.parse(document.querySelector('output[aria-label="Tipos escolhidos"]')!.textContent!) as string[];
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("tipos do estoque", () => {
  it("começa com todos os tipos e os três primeiros na ordem do catálogo", async () => {
    await mount();
    expect(document.querySelector("legend")?.textContent).toBe("Tipo de produto");
    expect(visibleTypes()).toEqual(["Todos os tipos", "Polo", "Toalha", "Sacola"]);
    expect(checkbox("Todos os tipos").getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector('input[aria-label="Buscar tipo de produto"]')).not.toBeNull();
  });

  it("expande somente a lista de tipos, com rolagem limitada e ação de recolher fora dela", async () => {
    await mount();
    const expand = button("Ver mais tipos");
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    const listId = expand.getAttribute("aria-controls")!;
    await click(expand);
    expect(visibleTypes()).toEqual(["Todos os tipos", "Polo", "Toalha", "Sacola", "Camiseta egípcia", "Boné"]);
    const list = document.getElementById(listId)!;
    expect(list.classList.contains("overflow-y-auto")).toBe(true);
    expect(list.classList.contains("max-h-40")).toBe(true);
    expect(list.contains(checkbox("Todos os tipos"))).toBe(false);
    expect(list.querySelector("input")).toBeNull();
    expect(list.contains(button("Ver menos tipos"))).toBe(false);
    expect(button("Ver menos tipos").getAttribute("aria-expanded")).toBe("true");
    await click(button("Ver menos tipos"));
    expect(visibleTypes()).toEqual(["Todos os tipos", "Polo", "Toalha", "Sacola"]);
  });

  it("busca todos os tipos recolhidos sem distinguir caixa ou acento", async () => {
    await mount();
    await search("  EGIPCIA  ");
    expect(visibleTypes()).toEqual(["Todos os tipos", "Camiseta egípcia"]);
    expect(document.body.textContent).not.toContain("Ver mais tipos");
    expect(checkbox("Camiseta egípcia").closest(".overflow-y-auto")).not.toBeNull();
    await search("BONE");
    expect(visibleTypes()).toEqual(["Todos os tipos", "Boné"]);
    await search("");
    expect(visibleTypes()).toEqual(["Todos os tipos", "Polo", "Toalha", "Sacola"]);
  });

  it("explica busca sem resultado e mantém Todos os tipos disponível", async () => {
    await mount(["polo"]);
    await search("inexistente");
    expect(visibleTypes()).toEqual(["Todos os tipos"]);
    const frase = [...document.querySelectorAll("p")].find((elemento) => elemento.textContent === "Nenhum tipo encontrado.");
    expect(frase).toBeDefined();
    // Sem região viva solta: quem diz é o Anunciador, a região viva da tela (carregamento v2, seção 7).
    expect(frase!.closest("[role='status'], [aria-live]:not([data-anunciador])")).toBeNull();
    expect(document.querySelectorAll("[role='status']:not([data-anunciador])")).toHaveLength(0);
    expect(document.querySelector("[data-anunciador]")?.textContent).toBe("Nenhum tipo encontrado");
    await click(checkbox("Todos os tipos"));
    expect(selection()).toEqual([]);
  });

  it("mantém tipos selecionados juntos e Todos os tipos limpa a seleção", async () => {
    await mount();
    await click(checkbox("Polo"));
    await click(checkbox("Sacola"));
    expect(selection()).toEqual(["polo", "sacola"]);
    expect(checkbox("Polo").getAttribute("aria-checked")).toBe("true");
    expect(checkbox("Sacola").getAttribute("aria-checked")).toBe("true");
    expect(checkbox("Todos os tipos").getAttribute("aria-checked")).toBe("false");
    await click(checkbox("Polo"));
    expect(selection()).toEqual(["sacola"]);
    await click(checkbox("Todos os tipos"));
    expect(selection()).toEqual([]);
    expect(checkbox("Todos os tipos").getAttribute("aria-checked")).toBe("true");
    await click(checkbox("Todos os tipos"));
    expect(selection()).toEqual([]);
    expect(checkbox("Todos os tipos").getAttribute("aria-checked")).toBe("true");
  });

  it("recolher preserva tipos fora dos três primeiros e informa quantos estão ocultos", async () => {
    await mount();
    await click(button("Ver mais tipos"));
    await click(checkbox("Camiseta egípcia"));
    await click(checkbox("Boné"));
    await click(button("Ver menos tipos"));
    expect(selection()).toEqual(["camiseta", "bone"]);
    expect(document.body.textContent).toContain("2 selecionados fora da lista");
    const description = button("Ver mais tipos").getAttribute("aria-describedby")!;
    expect(document.getElementById(description)?.textContent).toBe("2 selecionados fora da lista");
    await click(button("Ver mais tipos"));
    expect(checkbox("Camiseta egípcia").getAttribute("aria-checked")).toBe("true");
    expect(checkbox("Boné").getAttribute("aria-checked")).toBe("true");
  });

  it("limpar no formulário reinicia a busca e a expansão", async () => {
    await mount(["bone"]);
    await click(button("Ver mais tipos"));
    await search("boné");
    await click(button("Limpar filtros"));
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Buscar tipo de produto"]')!.value).toBe("");
    expect(visibleTypes()).toEqual(["Todos os tipos", "Polo", "Toalha", "Sacola"]);
    expect(button("Ver mais tipos").getAttribute("aria-expanded")).toBe("false");
    expect(checkbox("Todos os tipos").getAttribute("aria-checked")).toBe("true");
  });

  it("não oferece expandir quando os tipos já cabem", async () => {
    await mount([], categories.slice(0, 3));
    expect(visibleTypes()).toEqual(["Todos os tipos", "Polo", "Toalha"]);
    expect(document.body.textContent).not.toContain("Ver mais tipos");
  });
});
