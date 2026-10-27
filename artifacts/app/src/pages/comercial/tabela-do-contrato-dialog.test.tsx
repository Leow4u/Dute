// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formDaTabela, type FormDaTabela } from "@/lib/comercial/tabela-do-contrato";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { CamposDaTabela, TabelaDoContratoDialog } from "./tabela-do-contrato-dialog";

const noop = () => undefined;
let raiz: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz.unmount());
  container.remove();
});

function campo(id: string, valor: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  expect(input, id).not.toBeNull();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clicar(rotulo: string) {
  const botao = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === rotulo || item.getAttribute("aria-label") === rotulo);
  expect(botao, rotulo).toBeDefined();
  act(() => botao!.click());
}

describe("adicionar tabela ao contrato", () => {
  it("os campos só mostram rótulos, dados e ações, com acessibilidade", async () => {
    const html = renderToStaticMarkup(<CamposDaTabela form={formDaTabela()} ocupado={false} onForm={noop} onAdicionar={noop} />);
    expect(textosDaTela(html)).toEqual([
      "Nome", "Código da tabela (opcional)", "Variante", "Início (opcional)", "Fim (opcional)", "Itens", "Item 1",
      "Código", "Descrição", "Unidade", "Preço unitário", "Remover item 1", "Adicionar item",
    ]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("adiciona e remove linhas, preservando o item que ficou e envia a tabela preenchida", async () => {
    const salvar = vi.fn<(form: FormDaTabela) => void>();
    await act(async () => raiz.render(<TabelaDoContratoDialog aberto contratoNome="Serviços Itaú" inicioDoContrato="2026-01-01" ocupado={false} erro={null} onCancelar={noop} onSalvar={salvar} />));
    campo("tabela-nome", "Serviços 2026");
    clicar("Adicionar item");
    campo("tabela-item-2-descricao", "Transporte de cadeira");
    clicar("Remover item 1");
    expect((document.getElementById("tabela-item-2-descricao") as HTMLInputElement).value).toBe("Transporte de cadeira");
    campo("tabela-item-2-codigo", "3.05");
    campo("tabela-item-2-unidade", "UN");
    campo("tabela-item-2-preco", "12,3456");
    clicar("Salvar tabela");
    expect(salvar).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      nome: "Serviços 2026", vigenteDe: "", vigenteAte: "",
      itens: [{ chave: "2", codigo: "3.05", descricao: "Transporte de cadeira", unidade: "UN", preco: "12,3456" }],
    }));
  });

  it("erro de validação mantém o diálogo aberto e não grava; o servidor aparece no próprio diálogo", async () => {
    const salvar = vi.fn();
    await act(async () => raiz.render(<TabelaDoContratoDialog aberto contratoNome="Serviços Itaú" inicioDoContrato="2026-01-01" ocupado={false} erro={null} onCancelar={noop} onSalvar={salvar} />));
    clicar("Salvar tabela");
    expect(salvar).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Informe o nome da tabela.");
    campo("tabela-nome", "Minha tabela");
    await act(async () => raiz.render(<TabelaDoContratoDialog aberto contratoNome="Serviços Itaú" inicioDoContrato="2026-01-01" ocupado={false} erro="A tabela já existe." onCancelar={noop} onSalvar={salvar} />));
    expect((document.getElementById("tabela-nome") as HTMLInputElement).value).toBe("Minha tabela");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("A tabela já existe.");
  });
});
