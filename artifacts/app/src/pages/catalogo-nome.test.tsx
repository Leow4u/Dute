// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O nome do produto no Catálogo, pelo padrão de 06/11/2026
 * (docs/mockups/NomeWmsCatalogo.dc.html): o tamanho fica no campo Tamanho,
 * que sai do fim do código no produto novo, e o nome é o mesmo em todos os
 * tamanhos. O formulário recusa antes de enviar o nome que repete ou
 * contradiz o tamanho do código, mas só quando o nome ou o tamanho mudam:
 * editar a cor de um produto cujo nome antigo ainda tem o tamanho salva.
 */

const estado = vi.hoisted(() => ({
  criados: [] as Array<Record<string, unknown>>,
  editados: [] as Array<{ id: unknown; data: Record<string, unknown> }>,
}));

type Opcoes = { onSuccess?: () => void; onError?: (erro: Error) => void };

vi.mock("@workspace/api-client-react", () => {
  const criar = () => ({
    isPending: false,
    mutate: (variaveis: { data: Record<string, unknown> }, opcoes: Opcoes) => {
      estado.criados.push(variaveis.data);
      opcoes.onSuccess?.();
    },
  });
  const editar = () => ({
    isPending: false,
    mutate: (variaveis: { id: unknown; data: Record<string, unknown> }, opcoes: Opcoes) => {
      estado.editados.push(variaveis);
      opcoes.onSuccess?.();
    },
  });
  const remover = () => ({ isPending: false, mutate: () => undefined });
  const lista = () => ({ data: { items: [], total: 0 }, isLoading: false });
  return {
    useCreateProduct: criar,
    useUpdateProduct: editar,
    useDeleteProduct: remover,
    useListProducts: lista,
    getListProductsQueryKey: () => ["products"],
    useCreateSku: criar,
    useUpdateSku: editar,
    useDeleteSku: remover,
    useListSkus: lista,
    getListSkusQueryKey: () => ["skus"],
  };
});

vi.mock("@/features/warehouse-ops/opening-inventory-status", () => ({
  useOpeningInventorySession: () => ({ data: { status: "open" } }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { INTERVALO_DO_TOQUE_MS } from "@/lib/campo/toque-unico";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { ProductModal } from "./products";
import { SkuModal } from "./skus";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function montar(tela: ReactNode) {
  await act(async () => raiz!.render(<QueryClientProvider client={new QueryClient()}>{tela}</QueryClientProvider>));
  await act(async () => container!.querySelector("button")!.click());
  if (!document.querySelector("form")) throw new Error("O formulário não abriu");
}

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 50; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

function campo(id: string) {
  const elemento = document.querySelector<HTMLInputElement>(`input#${id}`);
  if (!elemento) throw new Error(`Sem o campo ${id}`);
  return elemento;
}

async function digitar(id: string, valor: string) {
  const elemento = campo(id);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(elemento, valor);
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** O código digitado letra a letra, como a pessoa digita. */
async function digitarLetraALetra(id: string, valor: string) {
  for (let fim = 1; fim <= valor.length; fim += 1) await digitar(id, valor.slice(0, fim));
}

/**
 * O relógio da trava do toque duplo: o Salvar é o BotaoDeAcao (parte 13a), que
 * barra o segundo toque em menos de um segundo. Quem corrige o nome e salva de
 * novo leva mais que isso; aqui, o relógio anda um intervalo a cada Salvar.
 */
let deslocamentoDoRelogio = 0;
const agoraDeVerdade = Date.now.bind(Date);

async function salvar() {
  deslocamentoDoRelogio += INTERVALO_DO_TOQUE_MS;
  const botao = document.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
  await act(async () => botao.click());
  // O resolver do zod é assíncrono: espera a validação terminar.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function mensagem(id: string) {
  return document.getElementById(`${id}-problema`)?.textContent ?? null;
}

function invalido(id: string) {
  const elemento = campo(id);
  return {
    invalido: elemento.getAttribute("aria-invalid"),
    descrito: elemento.getAttribute("aria-describedby"),
  };
}

const NOME_COM_TAMANHO = "O tamanho XG fica no campo Tamanho. O nome é o mesmo em todos os tamanhos de A.01.0806.005.";

/** O cadastro antigo: o nome ainda tem o tamanho no fim até a planilha do passo 3. */
const PRODUTO_ANTIGO = {
  id: 126,
  cod_cliente: "A.01.0806.005.XG",
  produto: "Polo masculino piquet preto - XG",
  genero: "Masculino",
  categoria: "Polo",
  grupo: "VESTUÁRIO",
  cor: "Preto",
  tamanho: "XG",
  preco_unit: 48.9,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  deslocamentoDoRelogio = 0;
  vi.spyOn(Date, "now").mockImplementation(() => agoraDeVerdade() + deslocamentoDoRelogio);
  estado.criados = [];
  estado.editados = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  container?.remove();
  raiz = null;
  container = null;
  document.body.innerHTML = "";
});

describe("Catálogo › Cadastro: o Tamanho pelo código no produto novo", () => {
  it("o fim do código preenche o Tamanho vazio e acompanha a digitação", async () => {
    await montar(<ProductModal />);
    await digitarLetraALetra("cod_cliente", "A.01.0806.005.G");
    expect(campo("tamanho").value).toBe("G");
    await digitar("cod_cliente", "A.01.0806.005.GG");
    expect(campo("tamanho").value).toBe("GG");
    await digitar("cod_cliente", "A.01.0806.005.X");
    expect(campo("tamanho").value).toBe("");
    await digitar("cod_cliente", "A.01.0806.005.XG");
    expect(campo("tamanho").value).toBe("XG");
  });

  it("não passa por cima do Tamanho que a pessoa digitou", async () => {
    await montar(<ProductModal />);
    await digitar("tamanho", "G");
    await digitarLetraALetra("cod_cliente", "A.01.0806.005.XG");
    expect(campo("tamanho").value).toBe("G");
  });
});

describe("Catálogo › Cadastro: a recusa do nome no padrão", () => {
  it("recusa Polo Masculino Piquet Preto XG com o código A.01.0806.005.XG, com a mensagem embaixo do nome", async () => {
    await montar(<ProductModal />);
    await digitar("cod_cliente", "A.01.0806.005.XG");
    await digitar("produto", "Polo Masculino Piquet Preto XG");
    await salvar();

    expect(estado.criados).toEqual([]);
    expect(mensagem("produto")).toBe(NOME_COM_TAMANHO);
    expect(invalido("produto")).toEqual({ invalido: "true", descrito: "produto-problema" });
    expect(invalido("tamanho")).toEqual({ invalido: null, descrito: null });
    expect(await violacoesDeAcessibilidade(document.querySelector("form")!.outerHTML)).toEqual([]);

    await digitar("produto", "Polo Masculino Piquet Preto");
    await salvar();
    await esperar(() => estado.criados.length === 1, "o produto criado");
    expect(estado.criados[0]).toMatchObject({ cod_cliente: "A.01.0806.005.XG", produto: "Polo Masculino Piquet Preto", tamanho: "XG" });
  });

  it("o Tamanho que contradiz o código fica com a mensagem embaixo do Tamanho", async () => {
    await montar(<ProductModal />);
    await digitar("cod_cliente", "A.01.0806.005.XG");
    await digitar("tamanho", "G");
    await digitar("produto", "Polo Masculino Piquet Preto");
    await salvar();

    expect(estado.criados).toEqual([]);
    expect(mensagem("tamanho")).toBe("O código A.01.0806.005.XG é do tamanho XG, e o Tamanho informado é G.");
    expect(invalido("tamanho")).toEqual({ invalido: "true", descrito: "tamanho-problema" });
    expect(mensagem("produto")).toBeNull();
    expect(invalido("produto")).toEqual({ invalido: null, descrito: null });
  });

  it("o nome que é só o tamanho também fica de fora", async () => {
    await montar(<ProductModal />);
    await digitar("cod_cliente", "A.01.0806.005.XG");
    await digitar("produto", "XG");
    await salvar();
    expect(estado.criados).toEqual([]);
    expect(mensagem("produto")).toBe("O nome do produto não pode ser só o tamanho.");
  });
});

describe("Catálogo › Cadastro: a edição de um produto antigo", () => {
  it("editar a cor de um produto cujo nome antigo tem o tamanho salva: o nome não mudou", async () => {
    await montar(<ProductModal product={PRODUTO_ANTIGO} showPrice />);
    await digitar("cor", "Preto Fosco");
    await salvar();
    await esperar(() => estado.editados.length === 1, "a edição salva");
    expect(estado.editados[0]).toMatchObject({ id: 126, data: { cor: "Preto Fosco", produto: "Polo masculino piquet preto - XG" } });
    expect(mensagem("produto")).toBeNull();
  });

  it("o cadastro antigo com campo nulo também salva a cor", async () => {
    await montar(<ProductModal product={{ ...PRODUTO_ANTIGO, tamanho: null, genero: null, grupo: null }} />);
    await digitar("cor", "Preto Fosco");
    await salvar();
    await esperar(() => estado.editados.length === 1, "a edição salva");
    expect(estado.editados[0]!.data).toMatchObject({ cor: "Preto Fosco", tamanho: "", genero: "" });
  });

  it("mudar o nome de um produto antigo passa pela recusa", async () => {
    await montar(<ProductModal product={PRODUTO_ANTIGO} />);
    await digitar("produto", "Polo Masculino Piquet Preto XG");
    await salvar();
    expect(estado.editados).toEqual([]);
    expect(mensagem("produto")).toBe(NOME_COM_TAMANHO);
  });

  it("mudar o tamanho de um produto antigo para outro que não é o do código fica de fora", async () => {
    await montar(<ProductModal product={{ ...PRODUTO_ANTIGO, produto: "Polo Masculino Piquet Preto" }} />);
    await digitar("tamanho", "GG");
    await salvar();
    expect(estado.editados).toEqual([]);
    expect(mensagem("tamanho")).toBe("O código A.01.0806.005.XG é do tamanho XG, e o Tamanho informado é GG.");
  });
});

describe("Catálogo › SKUs e saldos: o mesmo padrão no cadastro mestre", () => {
  it("o item novo tem o Tamanho pelo código e a recusa do nome com o tamanho", async () => {
    await montar(<SkuModal />);
    await digitar("cod_btg", "BTG-000126");
    await digitarLetraALetra("cod_cliente", "A.01.0806.005.XG");
    expect(campo("tamanho").value).toBe("XG");
    await digitar("produto", "Polo Masculino Piquet Preto XG");
    await salvar();

    expect(estado.criados).toEqual([]);
    expect(mensagem("produto")).toBe(NOME_COM_TAMANHO);
    expect(invalido("produto")).toEqual({ invalido: "true", descrito: "produto-problema" });

    await digitar("produto", "Polo Masculino Piquet Preto");
    await salvar();
    await esperar(() => estado.criados.length === 1, "o item criado");
    expect(estado.criados[0]).toMatchObject({ cod_cliente: "A.01.0806.005.XG", produto: "Polo Masculino Piquet Preto", tamanho: "XG" });
  });

  it("editar a cor de um item antigo com o tamanho no nome salva", async () => {
    await montar(<SkuModal sku={{ ...PRODUTO_ANTIGO, cod_btg: "BTG-000126", estado: "NOVO", estoque_minimo: null }} />);
    await digitar("cor", "Preto Fosco");
    await salvar();
    await esperar(() => estado.editados.length === 1, "a edição salva");
    expect(estado.editados[0]).toMatchObject({ id: 126, data: { cor: "Preto Fosco", produto: "Polo masculino piquet preto - XG" } });
  });
});
