// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

/**
 * A frase da leitura de apoio da bancada de Separar e do pedido separado
 * (revisão da parte 13m). A parte pôs a frase ("Não foi possível carregar as
 * caixas e o prazo do pedido.") acima da lista, como um alerta que trocava de
 * nó a cada mudança, e sem "Tentar de novo": ela entrava depois da lista e
 * empurrava o "Separar" (66 px a 1440, 86 px a 390), falava de novo na volta
 * da rede, a recusa do servidor não tinha saída, e o pedido já separado, na
 * mesma rota, não dizia nada. Agora a frase mora na coluna do lado, depois
 * dos volumes e das etiquetas (no celular, depois da lista), com o "Tentar de
 * novo" que assina de novo o que falhou, no âmbar da faixa; não é região
 * viva, e o Anunciador diz só a recusa do servidor que entra. Dados
 * sintéticos.
 */

const estado = vi.hoisted(() => ({
  documentos: {} as Record<string, Record<string, unknown> | null>,
  consultas: {} as Record<string, Array<Record<string, unknown>>>,
  faltas: {} as Record<string, { erro: boolean; falta: "conexao" | "servidor" | null; lidaEm: number | null }>,
  /** As chaves que assinaram de novo. */
  tentativas: [] as string[],
  /** O que o Anunciador ouviu. */
  anuncios: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", fullName: "Guilherme Dantas", publicMetadata: { role: "admin" } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ options: [{ code: "BTG", name: "BTG Pactual" }], code: "BTG", isLoading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/lib/use-item-photos", () => ({ useItemPhotos: () => () => null, useCatalogoDeSkus: () => ({ data: { items: [] }, isError: false, isPending: false }) }));
vi.mock("@/lib/carregando/anunciador", async (original) => {
  const real = await original<typeof import("@/lib/carregando/anunciador")>();
  const anunciar = (texto: string) => {
    estado.anuncios.push(texto);
    return () => undefined;
  };
  return { ...real, useAnuncio: () => anunciar };
});
// As escutas são as do teste, com a falta de cada uma; a junção das tentativas é a de verdade.
vi.mock("@/lib/operacao/leitura", async (original) => ({
  ...(await original<object>()),
  useLeitura: (chave: string | null, _consulta: unknown, mapear: (id: string, data: Record<string, unknown>) => unknown) => {
    const docs = chave ? estado.consultas[chave] : undefined;
    const falta = (chave && estado.faltas[chave]) || { erro: false, falta: null, lidaEm: null };
    return {
      itens: falta.erro ? null : docs ? docs.map((data) => mapear(String(data.id), data)).filter((item) => item !== null) : null,
      ...falta,
      tentando: false,
      tentar: () => {
        estado.tentativas.push(String(chave));
        return Promise.resolve();
      },
    };
  },
  useDocumento: (chave: string | null, _referencia: unknown, mapear: (id: string, data: Record<string, unknown>) => unknown) => {
    const data = chave ? estado.documentos[chave] : undefined;
    const falta = (chave && estado.faltas[chave]) || { erro: false, falta: null, lidaEm: null };
    return {
      item: falta.erro ? undefined : data === undefined ? undefined : data === null ? null : mapear(String(data.id), data),
      ...falta,
      tentando: false,
      tentar: () => {
        estado.tentativas.push(String(chave));
        return Promise.resolve();
      },
    };
  },
}));

import { ProvedorDaConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosDaTela } from "@/test/textos";

import PaginaPedidosSeparar from "./pedidos-separar";

const TAREFA = "pick_tasks/pick_ord_1";
const CAIXAS = "warehouse_boxes:BTG:guardadas";
const PRAZO = "customer_requests/creq_1:bancada";
const AS_CAIXAS_E_O_PRAZO = "Não foi possível carregar as caixas e o prazo do pedido.";

const tarefa = (status: string) => ({
  id: "pick_ord_1",
  reference: "pick_ord_1",
  order_id: "ord_1",
  customer_request_id: "creq_1",
  title: "PED-0001",
  status,
  can_advance: true,
  exception_count: 0,
  customer_code: "BTG",
  items: [{ id: "pli_1", line_number: 1, sku_code: "BTG-000206", product_name: "Copo Beercup em Inox", quantity: 4, expected_quantity: 4, location: "B-03" }],
});
const BANCADA = { alerts: [], queues: { picking: { key: "picking", tasks: [tarefa("planned")] } } };
const SEPARADO = {
  alerts: [],
  queues: {
    picking: { key: "picking", tasks: [tarefa("completed")] },
    expedition: {
      key: "expedition",
      tasks: [{ id: "ship_ord_1", reference: "ship_ord_1", order_id: "ord_1", customer_request_id: "creq_1", title: "PED-0001", status: "ready_to_dispatch", can_advance: true, exception_count: 0, customer_code: "BTG", items: [] }],
    },
  },
};
let fila: Record<string, unknown> = BANCADA;

let raiz: Root | null = null;
let container: HTMLElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const corpo = new URL(String(entrada), "http://localhost").pathname === "/api/warehouse/ops" ? fila : { items: [] };
      return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  window.history.replaceState(null, "", "/pedidos/separar?pedido=ord_1");
  fila = BANCADA;
  estado.faltas = {};
  estado.tentativas = [];
  estado.anuncios = [];
  estado.documentos = {
    [TAREFA]: { id: "pick_ord_1", status: "planned", volumes: [{ id: "vol_1", number: 1, status: "open", lines: [] }] },
    [PRAZO]: { id: "creq_1", due_at: "2026-11-16T14:36:00.000Z" },
    "orders/ord_1:volumes": { id: "ord_1", order_number: "PED-0001", customer_code: "BTG", destination: "Faria Lima", customer_request_id: "creq_1" },
    "shipments/ship_ord_1:volumes": { id: "ship_ord_1", status: "ready_to_dispatch", seal_code: "L-1" },
    "pick_tasks/pick_ord_1:volumes": { id: "pick_ord_1", status: "completed", volumes: [] },
  };
  estado.consultas = {
    "pick_lines:pick_ord_1": [{ id: "pli_1", pick_task_id: "pick_ord_1", line_number: 1, sku_code: "BTG-000206", product_name: "Copo Beercup em Inox", qty_to_pick: 4, location_id: "B-03" }],
    [CAIXAS]: [],
    "opening_inventory_lines:BTG": [],
    "packages:ord_1": [{ id: "pkg_1", order_id: "ord_1", volume_number: 1, weight_kg: 2 }],
    "package_items:ord_1": [{ id: "pi_1", order_id: "ord_1", package_id: "pkg_1", volume_number: 1, sku_code: "BTG-000206", product_name: "Copo Beercup em Inox", quantity: 4 }],
  };
  container = document.createElement("main");
  document.body.append(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  cliente.clear();
  vi.unstubAllGlobals();
});

async function montar(conexao: EstadoDaConexao, esperar = "Copo Beercup em Inox") {
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm(conexao)}>
        <QueryClientProvider client={cliente}>
          <Router>
            <PaginaPedidosSeparar />
          </Router>
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
  await vi.waitFor(() => expect(container.textContent).toContain(esperar), { timeout: 3_000 });
}

/** A frase do que não chegou e o bloco dela (a `FalhaNaSecao`). */
const frase = () => [...container.querySelectorAll("p")].find((paragrafo) => paragrafo.textContent?.startsWith("Não foi possível carregar")) ?? null;
const blocoDaFrase = () => frase()?.closest<HTMLElement>("[data-falha-na-secao]") ?? null;
const anunciosDaFrase = () => estado.anuncios.filter((texto) => texto.startsWith("Não foi possível carregar"));
const separar = () => [...container.querySelectorAll("button")].find((botao) => botao.textContent?.includes("Separar") && !botao.textContent.includes("separação")) ?? null;

describe("a frase da leitura de apoio da bancada (revisão da parte 13m)", () => {
  it("não entra acima da lista: fica depois do Separar, na coluna do lado", async () => {
    estado.faltas[CAIXAS] = { erro: true, falta: "servidor", lidaEm: null };
    estado.faltas[PRAZO] = { erro: true, falta: "servidor", lidaEm: null };
    await montar("conectado");
    await vi.waitFor(() => expect(frase()?.textContent).toBe(AS_CAIXAS_E_O_PRAZO), { timeout: 3_000 });
    // O "Separar" vem antes da frase: ela não empurra a linha quando entra nem quando sai.
    expect(separar()!.compareDocumentPosition(frase()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("a recusa do servidor tem o Tentar de novo, que assina de novo o que falhou", async () => {
    estado.faltas[CAIXAS] = { erro: true, falta: "servidor", lidaEm: null };
    estado.faltas[PRAZO] = { erro: true, falta: "servidor", lidaEm: null };
    await montar("conectado");
    await vi.waitFor(() => expect(blocoDaFrase()).not.toBeNull(), { timeout: 3_000 });
    const botao = blocoDaFrase()!.querySelector("button");
    expect(botao?.textContent).toBe("Tentar de novo");
    await act(async () => botao!.click());
    await vi.waitFor(() => expect(estado.tentativas).toEqual(expect.arrayContaining([CAIXAS, PRAZO])), { timeout: 3_000 });
    // A tarefa e as linhas, que chegaram, não assinam de novo.
    expect(estado.tentativas).not.toContain(TAREFA);
  });

  it("no âmbar da faixa (o --carregando-aviso, 6,2:1), e não em outro âmbar mais fraco", async () => {
    estado.faltas[CAIXAS] = { erro: true, falta: "conexao", lidaEm: null };
    await montar("sem-conexao");
    await vi.waitFor(() => expect(frase()).not.toBeNull(), { timeout: 3_000 });
    expect(frase()!.className).toContain("text-carregando-aviso");
    expect(frase()!.className).not.toContain("text-warning-soft-foreground");
  });

  it("a recusa do servidor é dita uma vez, pelo Anunciador; a frase não é região viva", async () => {
    estado.faltas[CAIXAS] = { erro: true, falta: "servidor", lidaEm: null };
    estado.faltas[PRAZO] = { erro: true, falta: "servidor", lidaEm: null };
    await montar("conectado");
    await vi.waitFor(() => expect(anunciosDaFrase()).toEqual([AS_CAIXAS_E_O_PRAZO]), { timeout: 3_000 });
    expect(frase()!.closest('[role="alert"], [aria-live]')).toBeNull();
    // A tela que desenha de novo não repete.
    await montar("conectado");
    expect(anunciosDaFrase()).toEqual([AS_CAIXAS_E_O_PRAZO]);
  });

  it("sem conexão, a frase não fala: o Anunciador já diz o Sem conexão", async () => {
    estado.faltas[CAIXAS] = { erro: true, falta: "conexao", lidaEm: null };
    estado.faltas[PRAZO] = { erro: true, falta: "conexao", lidaEm: null };
    await montar("sem-conexao");
    await vi.waitFor(() => expect(frase()?.textContent).toBe(AS_CAIXAS_E_O_PRAZO), { timeout: 3_000 });
    expect(container.querySelectorAll('[role="alert"]').length).toBe(0);
    expect(anunciosDaFrase()).toEqual([]);
  });

  it("na volta da rede, a frase que encolhe fica no mesmo lugar e não fala", async () => {
    estado.faltas[CAIXAS] = { erro: true, falta: "conexao", lidaEm: null };
    estado.faltas[PRAZO] = { erro: true, falta: "conexao", lidaEm: null };
    await montar("sem-conexao");
    await vi.waitFor(() => expect(frase()?.textContent).toBe(AS_CAIXAS_E_O_PRAZO), { timeout: 3_000 });
    const antes = frase();
    // As caixas voltam antes do prazo.
    delete estado.faltas[CAIXAS];
    await montar("reconectando");
    await vi.waitFor(() => expect(frase()?.textContent).toBe("Não foi possível carregar o prazo do pedido."), { timeout: 3_000 });
    expect(frase()).toBe(antes);
    expect(container.querySelectorAll('[role="alert"]').length).toBe(0);
    expect(anunciosDaFrase()).toEqual([]);
  });

  it("a segunda recusa que entra é dita, com a frase inteira; a que sai não", async () => {
    estado.faltas[CAIXAS] = { erro: true, falta: "servidor", lidaEm: null };
    await montar("conectado");
    await vi.waitFor(() => expect(anunciosDaFrase()).toEqual(["Não foi possível carregar as caixas."]), { timeout: 3_000 });
    estado.faltas[PRAZO] = { erro: true, falta: "servidor", lidaEm: null };
    await montar("conectado");
    await vi.waitFor(() => expect(anunciosDaFrase()).toEqual(["Não foi possível carregar as caixas.", AS_CAIXAS_E_O_PRAZO]), { timeout: 3_000 });
    delete estado.faltas[CAIXAS];
    await montar("conectado");
    await vi.waitFor(() => expect(frase()?.textContent).toBe("Não foi possível carregar o prazo do pedido."), { timeout: 3_000 });
    expect(anunciosDaFrase()).toHaveLength(2);
  });
});

describe("o pedido já separado, na mesma rota, com a leitura de apoio que não chegou (revisão da parte 13m)", () => {
  it("as caixas e o prazo recusados: a frase, na coluna do lado, com o Tentar de novo", async () => {
    fila = SEPARADO;
    estado.documentos[TAREFA] = { id: "pick_ord_1", status: "completed", volumes: [] };
    await montar("conectado", "Volume 1");
    const emDia = new Set(textosDaTela(container.innerHTML));
    act(() => raiz!.render(<></>));
    estado.faltas[CAIXAS] = { erro: true, falta: "servidor", lidaEm: null };
    estado.faltas[PRAZO] = { erro: true, falta: "servidor", lidaEm: null };
    await montar("conectado", "Volume 1");
    await vi.waitFor(() => expect(frase()?.textContent).toBe(AS_CAIXAS_E_O_PRAZO), { timeout: 3_000 });
    // O resumo perde o "Para quando", como na bancada; a frase diz por quê.
    expect(textosDaTela(container.innerHTML).filter((texto) => !emDia.has(texto) && !texto.startsWith("BTG Pactual"))).toEqual([AS_CAIXAS_E_O_PRAZO, "Tentar de novo"]);
    const botao = blocoDaFrase()!.querySelector("button")!;
    await act(async () => botao.click());
    await vi.waitFor(() => expect(estado.tentativas).toEqual(expect.arrayContaining([CAIXAS, PRAZO])), { timeout: 3_000 });
    expect(anunciosDaFrase()).toEqual([AS_CAIXAS_E_O_PRAZO]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("sem conexão, a frase sem falar, e os volumes do pedido seguem na tela", async () => {
    fila = SEPARADO;
    estado.documentos[TAREFA] = { id: "pick_ord_1", status: "completed", volumes: [] };
    estado.faltas[CAIXAS] = { erro: true, falta: "conexao", lidaEm: null };
    await montar("sem-conexao", "Volume 1");
    await vi.waitFor(() => expect(frase()?.textContent).toBe("Não foi possível carregar as caixas."), { timeout: 3_000 });
    expect(anunciosDaFrase()).toEqual([]);
    expect(container.querySelectorAll('[role="alert"]').length).toBe(0);
  });
});
