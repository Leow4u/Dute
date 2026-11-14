// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

/**
 * O romaneio e a lista de separação com o prazo (o destino) que não chegou
 * sem conexão (revisão da parte 13l). A parte trocou a frase da leitura que
 * faltava pelo aviso da conexão: com o romaneio lido, só a faixa "Sem conexão
 * · romaneio de 10:42" ficava, e "Para quando —" parecia um pedido sem prazo;
 * sem a hora, o "Sem conexão." genérico também não dizia o que faltava. E o
 * "Tentar de novo" do aviso não assinava de novo o prazo que não tinha
 * chegado. Agora a frase diz o que falta em qualquer falta, e o aviso da
 * conexão diz por quê, com o "Tentar de novo" que assina de novo o que não
 * chegou. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  documentos: {} as Record<string, Record<string, unknown> | null>,
  consultas: {} as Record<string, Array<Record<string, unknown>>>,
  /** Por chave: a falta da escuta. */
  faltas: {} as Record<string, { erro: boolean; falta: "conexao" | "servidor" | null; lidaEm: number | null }>,
  /** As chaves que assinaram de novo. */
  tentativas: [] as string[],
  busca: "pedido=ord_1",
}));

vi.mock("wouter", async (original) => ({ ...(await original<typeof import("wouter")>()), useSearch: () => estado.busca }));
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", fullName: "Guilherme Dantas", publicMetadata: { role: "admin" } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: "BTG", options: [{ code: "BTG", name: "BTG Pactual" }] }) }));
// As escutas são as do teste; a junção das tentativas é a de verdade.
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
import { DEZ_E_QUARENTA_E_DOIS } from "@/test/sem-conexao";
import { textosDaTela } from "@/test/textos";

import PaginaPedidosLista from "./pedidos-lista";
import PaginaPedidosRomaneio from "./pedidos-romaneio";

const PRAZO = "customer_requests/creq_1:romaneio";
const DESTINO = "customer_requests/creq_1";
const VOLUMES = ["orders/ord_1:volumes", "shipments/ship_ord_1:volumes", "pick_tasks/pick_ord_1:volumes", "packages:ord_1", "package_items:ord_1"];

function item(volume: number, linha: number, sku: string, codigo: string, nome: string, quantidade: number) {
  const pacote = `pkg_pack_ord_1_${String(volume).padStart(3, "0")}`;
  return { id: `pki_${pacote}_${String(linha).padStart(2, "0")}`, package_id: pacote, shipment_id: "ship_ord_1", status: "packed", customer_code: "BTG", order_id: "ord_1", order_number: "PED-0001", line_number: linha, sku_code: sku, client_item_code: codigo, product_name: nome, location_id: "B-03", qty_packed: quantidade };
}

const FILA = {
  alerts: [],
  queues: {
    picking: {
      key: "picking",
      tasks: [{ id: "pick_ord_1", reference: "pick_ord_1", order_id: "ord_1", customer_request_id: "creq_1", title: "PED-0001", status: "planned", can_advance: true, exception_count: 0, customer_code: "BTG", items: [] }],
    },
  },
};

let raiz: Root | null = null;
let container: HTMLElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const corpo = new URL(String(entrada), "http://localhost").pathname === "/api/warehouse/ops" ? FILA : { items: [] };
      return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  estado.tentativas = [];
  estado.faltas = {};
  estado.documentos = {
    "orders/ord_1:volumes": { id: "ord_1", order_number: "PED-0001", customer_code: "BTG", destination: "Agência Faria Lima", customer_request_id: "creq_1", status: "EM_EXPEDICAO" },
    "shipments/ship_ord_1:volumes": { id: "ship_ord_1", status: "ready_to_dispatch", seal_code: "88231" },
    "pick_tasks/pick_ord_1:volumes": { id: "pick_ord_1", status: "completed", separation_started_at: "2026-11-12T13:00:00.000Z", picking_confirmed_at: "2026-11-12T15:00:00.000Z", advanced_by: { name: "Guilherme Dantas" } },
    [PRAZO]: { id: "creq_1", due_at: "2026-11-16T14:36:00.000Z" },
    [DESTINO]: { id: "creq_1", destination: "Agência Faria Lima", due_at: "2026-11-16T14:36:00.000Z" },
  };
  estado.consultas = {
    "packages:ord_1": [{ id: "pkg_pack_ord_1_001", order_id: "ord_1", status: "packed", volume_number: 1, packed_units: 4, weight_kg: 1.8, seal_code: "88231", closed_at: "2026-11-12T13:20:00.000Z" }],
    "package_items:ord_1": [item(1, 1, "BTG-000206", "B.0572.003.U.B", "Copo Beercup em Inox", 4)],
  };
  container = document.createElement("main");
  document.body.append(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
  cliente.setQueryData(["estoque", "skus"], { items: [{ id: "BTG-000206", sku_code: "BTG-000206", cod_cliente: "B.0572.003.U.B", customer_code: "BTG", produto: "Copo Beercup em Inox", tamanho: "475ML", status: "active" }] });
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container.remove();
  cliente.clear();
  vi.unstubAllGlobals();
});

async function montar(conexao: EstadoDaConexao, pagina: "romaneio" | "lista") {
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm(conexao)}>
        <QueryClientProvider client={cliente}>
          <Router ssrPath={`/pedidos/${pagina}`}>{pagina === "romaneio" ? <PaginaPedidosRomaneio /> : <PaginaPedidosLista />}</Router>
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
  await vi.waitFor(() => expect(container.querySelector("button")?.textContent).toContain("Imprimir"), { timeout: 3_000 });
  await vi.waitFor(() => expect(container.textContent).toContain("Para quando"), { timeout: 3_000 });
}

/** Toca no "Tentar de novo" do aviso (o bloco ou a faixa) e devolve as chaves que assinaram de novo. */
async function tentarDeNovo() {
  const botao = [...container.querySelectorAll("button")].find((candidato) => candidato.textContent === "Tentar de novo");
  expect(botao, "o Tentar de novo do aviso").toBeDefined();
  estado.tentativas = [];
  await act(async () => botao!.click());
  await vi.waitFor(() => expect(estado.tentativas.length).toBeGreaterThan(0), { timeout: 3_000 });
  return estado.tentativas;
}

describe("o prazo do romaneio que não chegou (revisão da parte 13l)", () => {
  it("os volumes em dia e o prazo sem conexão: o aviso da conexão e a frase do prazo; o Tentar de novo assina o prazo de novo", async () => {
    estado.faltas[PRAZO] = { erro: true, falta: "conexao", lidaEm: null };
    await montar("sem-conexao", "romaneio");
    const textos = textosDaTela(container.innerHTML);
    expect(textos).toEqual(expect.arrayContaining(["Sem conexão.", "Tentar de novo", "Não foi possível carregar o prazo do pedido."]));
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
    expect(await tentarDeNovo()).toContain(PRAZO);
  });

  it("o romaneio lido sem conexão e o prazo que não chegou: a faixa com a hora e a frase do prazo; a faixa assina o prazo de novo", async () => {
    for (const chave of VOLUMES) estado.faltas[chave] = { erro: false, falta: "conexao", lidaEm: DEZ_E_QUARENTA_E_DOIS };
    estado.faltas[PRAZO] = { erro: true, falta: "conexao", lidaEm: null };
    await montar("sem-conexao", "romaneio");
    const textos = textosDaTela(container.innerHTML);
    expect(textos).toEqual(expect.arrayContaining(["Sem conexão · romaneio de 10:42", "Tentar de novo", "Não foi possível carregar o prazo do pedido."]));
    expect(textos).not.toContain("Sem conexão.");
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
    expect(await tentarDeNovo()).toContain(PRAZO);
  });

  it("o servidor que recusa o prazo: a frase, como antes", async () => {
    estado.faltas[PRAZO] = { erro: true, falta: "servidor", lidaEm: null };
    await montar("conectado", "romaneio");
    expect(textosDaTela(container.innerHTML)).toContain("Não foi possível carregar o prazo do pedido.");
    expect(container.textContent).not.toMatch(/Sem conexão|Reconectando/);
  });
});

describe("o destino da lista de separação que não chegou (revisão da parte 13l)", () => {
  it("sem conexão: o aviso da conexão e a frase do destino; o Tentar de novo assina o destino de novo", async () => {
    estado.faltas[DESTINO] = { erro: true, falta: "conexao", lidaEm: null };
    await montar("sem-conexao", "lista");
    const textos = textosDaTela(container.innerHTML);
    expect(textos).toEqual(expect.arrayContaining(["Sem conexão.", "Tentar de novo", "Não foi possível carregar o destino do pedido."]));
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
    expect(await tentarDeNovo()).toContain(DESTINO);
  });

  it("o servidor que recusa o destino: a frase, como antes", async () => {
    estado.faltas[DESTINO] = { erro: true, falta: "servidor", lidaEm: null };
    await montar("conectado", "lista");
    expect(textosDaTela(container.innerHTML)).toContain("Não foi possível carregar o destino do pedido.");
    expect(container.textContent).not.toMatch(/Sem conexão|Reconectando/);
  });
});

/**
 * A folha impressa com o dado que não chegou (parte 13m): antes, o papel saía
 * com "—" no prazo (no destino), como um pedido sem prazo, e só a tela
 * avisava. Agora o próprio campo diz que o dado não chegou, e o Imprimir
 * continua liberado.
 */
describe("a folha impressa com o prazo ou o destino que não chegou (parte 13m)", () => {
  const folha = () => container.querySelector<HTMLElement>(".print-area");
  const campo = (rotulo: string) => {
    const achado = [...(folha()?.querySelectorAll("span") ?? [])].find((elemento) => elemento.textContent === rotulo);
    return achado?.nextElementSibling?.textContent ?? null;
  };
  const imprimir = () => [...container.querySelectorAll("button")].find((botao) => botao.textContent?.includes("Imprimir"));

  for (const falta of ["conexao", "servidor"] as const) {
    it(`o romaneio sem o prazo (${falta}): "prazo não carregado" no campo, e o Imprimir liberado`, async () => {
      estado.faltas[PRAZO] = { erro: true, falta, lidaEm: null };
      await montar(falta === "conexao" ? "sem-conexao" : "conectado", "romaneio");
      expect(campo("Para quando")).toBe("prazo não carregado");
      expect(imprimir()?.disabled).toBe(false);
    });

    it(`a lista sem a solicitação (${falta}): "destino não carregado" e "prazo não carregado", e o Imprimir liberado`, async () => {
      estado.faltas[DESTINO] = { erro: true, falta, lidaEm: null };
      await montar(falta === "conexao" ? "sem-conexao" : "conectado", "lista");
      await vi.waitFor(() => expect(folha()).not.toBeNull(), { timeout: 3_000 });
      expect(campo("Destino")).toBe("destino não carregado");
      expect(campo("Para quando")).toBe("prazo não carregado");
      expect(imprimir()?.disabled).toBe(false);
    });
  }

  it("com o prazo lido, a folha diz o prazo", async () => {
    await montar("conectado", "romaneio");
    expect(campo("Para quando")).toBe("Seg 16/11/2026 11:36");
  });
});
