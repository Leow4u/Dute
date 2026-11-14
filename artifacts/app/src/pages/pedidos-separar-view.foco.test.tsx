// @vitest-environment jsdom
import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { DestinoDaCaixa, destinoVazio, type DestinoDaCaixaEstado } from "@/features/warehouse-ops/destino-da-caixa";
import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import type { SuggestionResult } from "@/lib/warehouse-boxes";
import { gruposDaSeparacao, hrefDaListaDeSeparacao } from "@/lib/warehouse-ops/lista-de-separacao";
import type { WarehouseTaskItem } from "@/lib/warehouse-ops/model";
import { progressoDoPedido } from "@/lib/warehouse-ops/separacao";
import { conexaoEm } from "@/test/conexao";

import { PedidosSepararView } from "./pedidos-separar-view";

/**
 * O foco que nunca cai no body quando o que tem o foco sai da tela
 * (carregamento v2, seção 7; parte 13c). Na bancada de separação, separar a
 * última linha por separar de uma prateleira fecha o grupo, e o "Desfazer"
 * que entraria no lugar não aparece: o foco ia ao body, e agora vai ao botão
 * do grupo. No destino da caixa, a sugestão que chega depois do "Tentar de
 * novo" tira o aviso com o foco nele: o foco vai ao título do painel. Relógio
 * simulado. Dados sintéticos.
 */

let raiz: Root | null = null;
let container: HTMLDivElement;

async function pausa(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const rotulo = (botao: Element) => (botao.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? botao.textContent)?.trim();
const botoes = (texto: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((botao) => rotulo(botao) === texto);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
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
        <Anunciador />
        {tela}
      </ProvedorDaConexao>,
    );
  });
}

const SEPARADA = { separated_at: "2026-11-10T13:00:00.000Z", separated_by: "Guilherme Dantas", separated_qty: 30 };
const linha = (numero: number, posicao: string, nome: string, sku: string, quantidade: number, extra: Partial<WarehouseTaskItem> = {}): WarehouseTaskItem => ({
  id: `pli_${numero}`,
  line_number: numero,
  location: posicao,
  product_name: nome,
  client_item_code: `C.${numero}`,
  sku_code: sku,
  expected_quantity: quantidade,
  quantity: quantidade,
  ...extra,
});
const POSICOES = [
  { code: "A-05", sequence: 5 },
  { code: "B-09", sequence: 24 },
];

function Bancada({ iniciais }: { iniciais: WarehouseTaskItem[] }) {
  const [itens, setItens] = useState(iniciais);
  const [ocupadas, setOcupadas] = useState<ReadonlyMap<string, string>>(new Map());
  return (
    <Router ssrPath="/pedidos/separar">
      <PedidosSepararView
        estado="pronto"
        numero="PED-0001"
        resumo="BTG Pactual"
        comecouEm="2026-11-10T13:00:00.000Z"
        comecou
        progresso={progressoDoPedido(itens)}
        grupos={gruposDaSeparacao(itens, POSICOES, { caixas: [], cliente: "BTG" })}
        listaHref={hrefDaListaDeSeparacao("ord_1")}
        operador
        coordenacao={false}
        ocupadas={ocupadas}
        onSeparar={(alvo) => {
          setOcupadas(new Map([[alvo.id, "separar"]]));
          setTimeout(() => {
            setItens((atuais) => atuais.map((item) => (item.id === alvo.id ? { ...item, ...SEPARADA, separated_qty: item.expected_quantity } : item)));
            setOcupadas(new Map());
          }, 600);
        }}
        onDesfazer={() => undefined}
        onSepararMenos={() => undefined}
        onConcluir={() => undefined}
      />
    </Router>
  );
}

describe("a bancada de separação, o foco depois de separar", () => {
  it("separar a última linha por separar da prateleira fecha o grupo, e o foco vai ao botão do grupo, nunca ao body", async () => {
    await montar(
      <Bancada
        iniciais={[
          linha(3, "A-05", "Calça Social Masculino Preta 40", "BTG-000083", 30, SEPARADA),
          linha(4, "A-05", "Calça Social Masculino Preta 42", "BTG-000084", 40),
          linha(6, "B-09", "Copo Café", "BTG-000202", 1),
        ]}
      />,
    );
    const separar = container.querySelector<HTMLButtonElement>("#separar-pli_4")!;
    separar.focus();
    await act(async () => separar.click());
    await pausa(350);
    expect(document.activeElement).toBe(separar);
    await pausa(400);
    expect(container.querySelector("#desfazer-pli_4")).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Mostrar itens de A-05");
  });

  it("com outra linha por separar na prateleira, o foco vai ao Desfazer que entra no lugar", async () => {
    await montar(
      <Bancada
        iniciais={[
          linha(3, "A-05", "Calça Social Masculino Preta 40", "BTG-000083", 30),
          linha(4, "A-05", "Calça Social Masculino Preta 42", "BTG-000084", 40),
        ]}
      />,
    );
    const separar = container.querySelector<HTMLButtonElement>("#separar-pli_3")!;
    separar.focus();
    await act(async () => separar.click());
    await pausa(800);
    expect(document.activeElement?.id).toBe("desfazer-pli_3");
  });
});

describe("o destino da caixa, a sugestão que chega depois da falha", () => {
  const SUGESTAO = {
    ok: true,
    customer_code: "BTG",
    zone_positions: 43,
    position: {
      code: "B-02",
      reason: "Já tem BTG-000087 nesta prateleira e ainda cabe.",
      tier: 1,
      leftover_m: 0.82,
      sequence: 14,
      placement: { front_m: 0.48, depth_m: 0.38, height_m: 0.3, orientation: "length_width_height" },
    },
    alternatives: [],
    rejected: null,
    checked: 43,
  } as unknown as SuggestionResult;

  function Destino() {
    const [estado, setEstado] = useState<DestinoDaCaixaEstado>({
      ...destinoVazio(),
      modo: "sugestao",
      erroSugestao: "Falha no servidor",
      falhaDaSugestao: new Error("Falha no servidor"),
    });
    return (
      <DestinoDaCaixa
        estado={estado}
        ocupado={false}
        onModo={() => undefined}
        onEscolher={() => undefined}
        onConfirmar={() => undefined}
        onNaoCabe={() => undefined}
        onTentarDeNovo={() =>
          new Promise<void>((pronto) =>
            setTimeout(() => {
              setEstado((atual) => ({ ...atual, erroSugestao: null, falhaDaSugestao: undefined, sugestao: SUGESTAO }));
              pronto();
            }, 400),
          )
        }
      />
    );
  }

  it("\"Tentar de novo\" que dá certo leva o foco ao título \"Guardar em\", nunca ao body", async () => {
    await montar(<Destino />);
    const tentar = botoes("Tentar de novo")[0]!;
    tentar.focus();
    await act(async () => tentar.click());
    await pausa(1_200);
    expect(botoes("Confirmar destino em B-02")).toHaveLength(1);
    expect(document.activeElement?.id).toBe("guardar-em");
  });
});
