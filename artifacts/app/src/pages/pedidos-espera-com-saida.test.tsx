// @vitest-environment jsdom
import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { CarregandoTela } from "@/components/ui/carregando-tela";
import { Anunciador } from "@/lib/carregando/anunciador";
import { progressoDoPedido } from "@/lib/warehouse-ops/separacao";

import { PedidoSeparadoView } from "./pedido-separado-view";
import { PedidosListaView } from "./pedidos-lista-view";
import { PedidosRomaneioView } from "./pedidos-romaneio-view";
import { PedidosSepararView } from "./pedidos-separar-view";

/**
 * A lista de separação, o romaneio, a bancada e o pedido separado esperando o
 * pedido (carregamento v2, junção das partes 10 e 13). Quem lê por eles sabe
 * ler de novo (o react-query da fila, e a leitura ao vivo, que ganhou o
 * `tentar` na parte 13g): a espera tem a saída da tabela da seção 3, "Tentar
 * de novo" aos 10 s e a desistência aos 70 s, e a falha tem "Tentar de
 * novo", nunca só a frase. A lista de separação, como o romaneio e a bancada,
 * continua a espera da rota: sem o vão de 300 ms e sem anunciar de novo.
 * Dados sintéticos.
 */

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const passar = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const anuncio = () => document.querySelector("[data-anunciador]")?.textContent ?? "";
const botoes = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
const tentarDeNovo = () => botoes().find((botao) => botao.textContent?.trim() === "Tentar de novo");

type Estado = "carregando" | "erro";
type Tela = { nome: string; montar: (estado: Estado, onTentar?: () => Promise<unknown>) => ReactElement };

const TELAS: Tela[] = [
  {
    nome: "a lista de separação",
    montar: (estado, onTentar) => <PedidosListaView estado={estado} folha={null} onImprimir={() => undefined} onTentar={onTentar} />,
  },
  {
    nome: "o romaneio",
    montar: (estado, onTentar) => <PedidosRomaneioView estado={estado} folha={null} voltar={null} onImprimir={() => undefined} onTentar={onTentar} />,
  },
  {
    nome: "a bancada de separação",
    montar: (estado, onTentar) => (
      <PedidosSepararView
        estado={estado}
        numero=""
        resumo=""
        comecouEm={null}
        comecou={false}
        progresso={progressoDoPedido([])}
        grupos={[]}
        listaHref={null}
        operador
        coordenacao={false}
        onSeparar={() => undefined}
        onDesfazer={() => undefined}
        onSepararMenos={() => undefined}
        onConcluir={() => undefined}
        onTentar={onTentar}
      />
    ),
  },
  {
    nome: "o pedido separado",
    montar: (estado, onTentar) => (
      <PedidoSeparadoView numero="PED-0001" resumo="" estado={estado} volumes={[]} etiquetasDosVolumesHref={null} romaneioHref={null} onTentar={onTentar} />
    ),
  },
];

function montar(elemento: ReactElement) {
  act(() =>
    raiz!.render(
      <Router ssrPath="/pedidos">
        {elemento}
        <Anunciador />
      </Router>,
    ),
  );
}

describe.each(TELAS)("$nome esperando o pedido", ({ montar: tela }) => {
  it("aos 10 s, \"Tentar de novo\" ao lado da demora, que lê de novo; aos 70 s, \"Sem resposta do servidor.\" com \"Tentar de novo\"", () => {
    const onTentar = vi.fn(() => new Promise<unknown>(() => undefined));
    montar(tela("carregando", onTentar));
    passar(10_100);
    expect(container.textContent).toContain("Demorando mais que o normal");
    act(() => tentarDeNovo()!.click());
    expect(onTentar).toHaveBeenCalledTimes(1);
    // A nova tentativa recomeça o relógio: aos 70 s dela, a desistência, com a saída.
    passar(70_100);
    expect(container.textContent).toContain("Sem resposta do servidor.");
    expect(tentarDeNovo()).toBeDefined();
    act(() => tentarDeNovo()!.click());
    expect(onTentar).toHaveBeenCalledTimes(2);
  });

  it("a falha tem \"Tentar de novo\", que lê de novo, e não só a frase", async () => {
    const onTentar = vi.fn(() => Promise.resolve());
    montar(tela("erro", onTentar));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => tentarDeNovo()!.click());
    expect(onTentar).toHaveBeenCalledTimes(1);
  });
});

describe("a lista de separação que chega lendo", () => {
  /** A rota que abre (a CarregandoTela) e dá lugar à tela que ainda lê o pedido. */
  function Rota({ tela }: { tela: "lista" | "romaneio" }) {
    const [chegou, setChegou] = useState(false);
    trocar = () => setChegou(true);
    if (!chegou) return <CarregandoTela titulo="Pedidos" />;
    return tela === "lista" ? (
      <PedidosListaView estado="carregando" folha={null} onImprimir={() => undefined} />
    ) : (
      <PedidosRomaneioView estado="carregando" folha={null} voltar={null} onImprimir={() => undefined} />
    );
  }
  let trocar: () => void = () => undefined;

  it.each(["lista", "romaneio"] as const)("continua a espera da rota (%s): a caixa na hora da troca, e \"Abrindo Pedidos\" não vira \"Carregando o pedido\"", (tela) => {
    montar(<Rota tela={tela} />);
    passar(400);
    expect(anuncio()).toBe("Abrindo Pedidos");
    act(() => trocar());
    expect(container.querySelector("[data-carregando-na-regiao]")?.textContent).toBe("Carregando o pedido…");
    passar(2_500);
    expect(anuncio()).toBe("Abrindo Pedidos");
  });
});
