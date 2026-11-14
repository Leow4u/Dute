// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { formInicial } from "@/lib/financeiro/a-faturar";
import { faturaDoFinanceiro, formDoEnvio, formDoPagamento } from "@/lib/financeiro/faturas";
import { Anunciador } from "@/lib/carregando/anunciador";

import { AFaturarView, type AFaturarViewProps } from "./a-faturar-view";
import { FaturasView, type FaturasViewProps } from "./faturas-view";

/**
 * O resultado da ação no Financeiro (carregamento v2, revisão da parte 13g):
 * a confirmação fica escrita na tela, e quem a diz é o toast, uma vez. Antes,
 * o Anunciador também a dizia, e o leitor de tela ouvia "NF 1234 registrada"
 * duas vezes (seção 7: os resultados saem pelo toast). Dados sintéticos.
 */

const HOJE = "2026-10-23";
const noop = () => undefined;

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.setSystemTime(new Date("2026-10-23T15:00:00.000Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const fala = () => container.querySelector("[data-anunciador]")?.textContent ?? "";

function aFaturar(resultado: string | null) {
  const props: AFaturarViewProps = {
    estado: "pronto",
    linhas: [],
    busca: "",
    painel: { aberto: false, marcadas: [], form: formInicial(HOJE, null), resultado, erro: null },
    hoje: HOJE,
    agora: new Date("2026-10-23T15:00:00.000Z"),
    ocupado: false,
    acoes: { buscar: noop, abrirPainel: noop, fecharPainel: noop, marcar: noop, editar: noop, registrar: noop },
  };
  act(() =>
    raiz!.render(
      <Router ssrPath="/financeiro/a-faturar">
        <Anunciador />
        <AFaturarView {...props} />
      </Router>,
    ),
  );
}

const NF = faturaDoFinanceiro("fat_000000000000000000000001", {
  customer_code: "ITAU",
  customer_name: "Itaú Unibanco",
  status: "emitida",
  valor_cents: 1_000_000,
  recebido_cents: 0,
  nf: { numero: "1234", serie: "1", emitida_em: "2026-10-01" },
  vencimento: "2026-11-30",
  forma: "boleto",
  demandas: [{ numero: "10045", valor_cents: 1_000_000 }],
})!;

function faturas(resultado: string | null) {
  const props: FaturasViewProps = {
    filtro: "a_receber",
    estado: "pronto",
    faturas: [NF],
    busca: "",
    hoje: HOJE,
    aberta: null,
    pagamentos: null,
    painel: { pagamento: formDoPagamento(NF, HOJE), envio: formDoEnvio(HOJE), confirmando: null, erro: null },
    resultado,
    ocupado: false,
    acoes: {
      buscar: noop,
      abrir: noop,
      fechar: noop,
      editarPagamento: noop,
      registrarPagamento: noop,
      editarEnvio: noop,
      marcarEnviada: noop,
      pedirEstorno: noop,
      editarMotivo: noop,
      confirmarEstorno: noop,
      pedirCancelamento: noop,
      confirmarCancelamento: noop,
      desistir: noop,
      exportar: noop,
      mudarMes: noop,
    },
  };
  act(() =>
    raiz!.render(
      <Router ssrPath="/financeiro/a-receber">
        <Anunciador />
        <FaturasView {...props} />
      </Router>,
    ),
  );
}

describe("o resultado da ação sai pelo toast, uma vez", () => {
  it("A faturar: a confirmação do registro fica escrita, e o Anunciador não a repete", () => {
    aFaturar(null);
    act(() => vi.advanceTimersByTime(3_000));
    aFaturar("NF 1234 registrada: 1 demanda faturada · R$ 12.345,00");
    act(() => vi.advanceTimersByTime(3_000));
    expect(container.textContent).toContain("NF 1234 registrada");
    expect(fala()).toBe("");
  });

  it("Faturas: a confirmação do pagamento fica escrita, e o Anunciador não a repete", () => {
    faturas(null);
    act(() => vi.advanceTimersByTime(3_000));
    faturas("Pagamento registrado na NF 1234");
    act(() => vi.advanceTimersByTime(3_000));
    expect(container.textContent).toContain("Pagamento registrado na NF 1234");
    expect(fala()).toBe("");
  });
});
