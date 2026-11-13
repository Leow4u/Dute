// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

/**
 * O Pedidos legado e a bancada de Operações no carregamento v2 (parte 13c;
 * diagnóstico, necessidades 2, 3 e 8). Antes, o Pedidos legado mostrava
 * "Pedidos / linhas 0", "Itens solicitados 0", "Em aberto 0" e "Concluídos 0"
 * enquanto lia (e na falha), e "Carregando pedidos..." seco numa célula da
 * tabela; a bancada de Operações (Qualidade) girava o "Atualizar" e o
 * desligava em toda releitura de 60 s, e a falha era um alerta com "Tentar
 * novamente" que apagava junto. Relógio simulado. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ atrasoMs: 20, falha: false, falhasDaBancada: 0 }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import Orders from "./orders";
import WarehouseOps from "./warehouse-ops";

const PEDIDOS = [{ id: "o1", num_pedido: "1000", cod_cliente: "A.01.0806.004.GG", produto: "Polo Masculino Piquet Preto", qtd_solic: 4, qtd_sep: 0, status: "PENDENTE", data_solic: "2026-11-12" }];
const OPS = { queues: { quality: { key: "quality", name: "Qualidade", tasks: [] } }, alerts: [], metrics: {}, updated_at: "2026-11-13T13:40:00.000Z" };

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

async function servir(entrada: RequestInfo | URL) {
  const url = new URL(String(entrada instanceof Request ? entrada.url : entrada), "http://localhost");
  await new Promise((pronto) => setTimeout(pronto, estado.atrasoMs));
  if (estado.falha) return json({ error: "Falha no servidor" }, 500);
  if (url.pathname === "/api/warehouse/ops" && estado.falhasDaBancada > 0) {
    estado.falhasDaBancada -= 1;
    return json({ error: "Falha no servidor" }, 500);
  }
  if (url.pathname === "/api/orders") return json({ items: PEDIDOS, total: 1 });
  if (url.pathname === "/api/warehouse/ops") return json(OPS);
  return json({ items: [] });
}

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

async function pausa(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 400; volta += 1) {
    if (condicao()) return;
    await pausa(10);
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

/** O HTML da tela sem a região do Anunciador (o que ele diz não é texto da tela). */
const semAnunciador = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return copia.innerHTML;
};

const naTela = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-13T13:42:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  estado.atrasoMs = 20;
  estado.falha = false;
  estado.falhasDaBancada = 0;
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  cliente.clear();
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function montar(tela: ReactElement) {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={cliente}>
          <Anunciador />
          {tela}
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

/** O número de cada cartão, pelo rótulo. */
const numeroDo = (rotulo: string) =>
  Array.from(container.querySelectorAll("p")).find((p) => p.textContent === rotulo)?.nextElementSibling?.textContent?.trim();

/** O bloco no lugar do número do cartão, pelo rótulo. */
const blocoDo = (rotulo: string) =>
  Array.from(container.querySelectorAll("p")).find((p) => p.textContent === rotulo)?.nextElementSibling?.querySelector('[data-forma="contagem"]');

describe("Pedidos legado, antes de ler", () => {
  it("os números ficam no bloco, nunca em zero nem no \"—\" da falha, e as linhas-fantasma entram aos 300 ms com \"Carregando pedidos…\"", async () => {
    estado.atrasoMs = 2_000;
    await montar(<Orders />);
    // Lendo, o bloco no lugar do número; o "—" é só da falha: a pessoa sabe se lê ou se falhou.
    for (const rotulo of ["Pedidos / linhas", "Itens solicitados", "Em aberto", "Concluídos"]) {
      expect(numeroDo(rotulo), rotulo).toBe("");
      expect(blocoDo(rotulo), rotulo).not.toBeNull();
    }
    expect(naTela()).not.toContain("Carregando pedidos...");
    // Antes de 300 ms, as linhas-fantasma ficam no lugar, sem aparecer; sem leitura anterior, duas.
    const fantasmas = () => Array.from(container.querySelectorAll("tr[data-fantasmas]"));
    expect(fantasmas()).toHaveLength(2);
    expect(fantasmas().every((linha) => !linha.hasAttribute("data-visivel"))).toBe(true);
    await pausa(350);
    expect(fantasmas().every((linha) => linha.hasAttribute("data-visivel"))).toBe(true);
    expect(container.querySelector("[data-linha-de-estado]")?.textContent).toContain("Carregando pedidos…");
    expect(container.querySelector('tbody[aria-busy="true"]')).not.toBeNull();
    const html = container.innerHTML;
    expect(
      textosForaDaLista(semAnunciador(), [
        "Estoque", "Pedidos", "Carregando pedidos…", "Pedidos / linhas", "Itens solicitados", "Em aberto", "Concluídos",
        "Todos", "Pendente", "Separação", "Entregue", "Cancelado", "Nº Pedido", "Data", "Cliente / Canal", "Produto",
        "Progresso", "Status", "Atualizar Status", "Buscar por número do pedido", "Mostrar", "Filtros", "Anterior", "Próximo",
      ]),
    ).toEqual([]);
    await pausa(2_000);
    await esperar(() => naTela().includes("#1000"), "a lista");
    expect(numeroDo("Pedidos / linhas")).toBe("1");
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    vi.useFakeTimers();
  });

  it("na falha, os números ficam em \"—\" e o aviso fica no lugar da tabela", async () => {
    estado.falha = true;
    await montar(<Orders />);
    await esperar(() => naTela().includes("Não consegui carregar os pedidos."), "a falha");
    for (const rotulo of ["Pedidos / linhas", "Itens solicitados", "Em aberto", "Concluídos"]) expect(numeroDo(rotulo), rotulo).toBe("—");
  });

  it("a leitura rápida não pisca as linhas-fantasma, e a próxima visita reserva quantas a última leitura trouxe", async () => {
    estado.atrasoMs = 150;
    await montar(<Orders />);
    await pausa(100);
    expect(container.querySelector("tr[data-fantasmas][data-visivel]")).toBeNull();
    await esperar(() => naTela().includes("#1000"), "a lista");
    expect(container.querySelector("tr[data-fantasmas]")).toBeNull();
    act(() => raiz?.unmount());
    raiz = null;
    cliente.clear();
    estado.atrasoMs = 2_000;
    await montar(<Orders />);
    expect(container.querySelectorAll("tr[data-fantasmas]")).toHaveLength(1);
  });
});

describe("a bancada de Operações (Qualidade)", () => {
  it("a falha sem nada lido é a FalhaNaLeitura, com \"Tentar de novo\"", async () => {
    estado.falha = true;
    await montar(<WarehouseOps initialModule="quality" />);
    await esperar(() => naTela().includes("Não consegui carregar a bancada WMS."), "a falha");
    expect(naTela()).not.toContain("Tentar novamente");
    expect(Array.from(container.querySelectorAll("button")).some((botao) => botao.textContent?.includes("Tentar de novo"))).toBe(true);
    expect(
      textosForaDaLista(semAnunciador(), ["Qualidade", "Atualizar", "Não consegui carregar a bancada WMS.", "Tentar de novo", "Tentando de novo…"]),
    ).toEqual([]);
  });

  it("na primeira leitura, o título fica e a linha de estado diz \"Carregando tarefas…\" aos 300 ms, com o anúncio", async () => {
    estado.atrasoMs = 2_000;
    await montar(<WarehouseOps initialModule="quality" />);
    expect(container.querySelector("h1")?.textContent).toBe("Qualidade");
    const regiao = container.querySelector('[aria-busy="true"]');
    expect(regiao?.getAttribute("aria-describedby")).toBe("linha-de-estado-da-bancada");
    await pausa(350);
    expect(container.querySelector("#linha-de-estado-da-bancada")?.textContent).toContain("Carregando tarefas…");
    await pausa(50);
    expect(container.querySelector("[data-anunciador]")?.textContent).toContain("Carregando tarefas");
    expect(textosForaDaLista(semAnunciador(), ["Qualidade", "Atualizar", "Carregando tarefas…"])).toEqual([]);
    const html = container.innerHTML;
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    vi.useFakeTimers();
  });

  it("a releitura que falha com a bancada lida fica na tela, e a linha de estado diz que não atualizou", async () => {
    await montar(<WarehouseOps initialModule="quality" />);
    await esperar(() => naTela().includes("Pendências totais"), "a bancada");
    estado.falhasDaBancada = 1;
    await act(async () => {
      void cliente.refetchQueries({ queryKey: ["warehouse-ops"] });
    });
    await pausa(400);
    expect(naTela()).toContain("Pendências totais");
    expect(container.querySelector("#linha-de-estado-da-bancada")?.textContent).toMatch(/Não consegui atualizar/);
  });

  it("a nova tentativa que dá certo leva o foco à linha de estado, nunca ao body", async () => {
    estado.falhasDaBancada = 1;
    await montar(<WarehouseOps initialModule="quality" />);
    await esperar(() => naTela().includes("Não consegui carregar a bancada WMS."), "a falha");
    const tentar = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((botao) => botao.textContent?.includes("Tentar de novo"))!;
    tentar.focus();
    await act(async () => tentar.click());
    await esperar(() => naTela().includes("Pendências totais"), "a bancada depois da nova tentativa");
    expect(document.activeElement?.id).toBe("linha-de-estado-da-bancada");
  });

  it("o Atualizar não gira nem desliga na releitura automática", async () => {
    await montar(<WarehouseOps initialModule="quality" />);
    await esperar(() => Boolean(container.querySelector("button[data-atualizar]")), "a bancada");
    estado.atrasoMs = 1_000;
    await act(async () => {
      void cliente.invalidateQueries({ queryKey: ["warehouse-ops"] });
    });
    await pausa(400);
    const atualizar = container.querySelector<HTMLButtonElement>("button[data-atualizar]")!;
    expect(atualizar.disabled).toBe(false);
    expect(atualizar.getAttribute("aria-busy")).toBeNull();
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});
