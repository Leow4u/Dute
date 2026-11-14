// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LinhaAutorizada, LinhaDoPrazoVencido } from "@/lib/comercial/autorizacoes";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import { CancelarAutorizacaoDialog, PerderPorPrazoDialog } from "./autorizacoes-dialogos";
import { ContratoDialog } from "./contratos-dialogos";
import { AprovarDialog, ContestarDialog } from "./medicoes-dialogos";
import { NovoOrcamentoDialog } from "./novo-orcamento-dialog";

/**
 * Os diálogos do Comercial que a parte 13g mudou (o gerúndio no confirmar, o
 * Cancelar travado durante a gravação): o axe (WCAG 2.1 A e AA) no repouso e
 * gravando, com o diálogo aberto. Antes, nenhum deles tinha teste de
 * acessibilidade. Dados sintéticos.
 */

const noop = () => undefined;
let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  // O Select do Radix mede o gatilho.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const AUTORIZACAO = { id: "aut_1", pedido: "4500000009", cliente: "Itaú Unibanco", demandas: ["10045"], daMedicao: false } as unknown as LinhaAutorizada;
const PRAZO = { numero: "10045", rotulo: "Demanda 10045", cliente: "Itaú Unibanco", limite: "2026-10-20" } as unknown as LinhaDoPrazoVencido;

const DIALOGOS: Array<[string, (ocupado: boolean) => React.ReactElement]> = [
  ["Cancelar autorização", (ocupado) => <CancelarAutorizacaoDialog autorizacao={AUTORIZACAO} ocupado={ocupado} erro={null} onVoltar={noop} onConfirmar={noop} />],
  ["Perder por prazo", (ocupado) => <PerderPorPrazoDialog linha={PRAZO} ocupado={ocupado} erro={null} onVoltar={noop} onConfirmar={noop} />],
  ["Novo contrato", (ocupado) => <ContratoDialog aberto ocupado={ocupado} erro={null} onCancelar={noop} contrato={null} clientes={[]} onSalvar={noop} />],
  ["Registrar aprovação", (ocupado) => <AprovarDialog aberto ocupado={ocupado} erro={null} onCancelar={noop} onConfirmar={noop} />],
  ["Registrar contestação", (ocupado) => <ContestarDialog aberto ocupado={ocupado} erro={null} onCancelar={noop} onConfirmar={noop} />],
  [
    "Novo orçamento",
    (ocupado) => (
      <NovoOrcamentoDialog aberto ocupado={ocupado} erro={null} onCancelar={noop} cadastros={[]} contratos={[]} hoje="2026-10-23" onCriar={noop} onCriarProspect={async () => null} />
    ),
  ],
];

describe.each(DIALOGOS)("%s: o axe no repouso e gravando", (_nome, dialogo) => {
  it("sem violação, também com o gerúndio na tela", async () => {
    act(() => raiz!.render(dialogo(false)));
    const repouso = document.body.innerHTML;
    act(() => raiz!.render(dialogo(true)));
    act(() => vi.advanceTimersByTime(CARREGANDO.atrasoMs));
    const gravando = document.body.innerHTML;
    expect(gravando).toContain('aria-busy="true"');
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(repouso)).toEqual([]);
    expect(await violacoesDeAcessibilidade(gravando)).toEqual([]);
  });
});
