// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { CARREGANDO } from "@/lib/carregando/tempo";
import type { LeituraPendente } from "@/lib/carregando/leitura-pendente";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { DemandaNovaView } from "../operacao/demanda-nova-view";
import { formularioVazio } from "@/lib/operacao/demanda-direta";
import { DialogoDepoisDoEnvio } from "./depois-do-envio-dialogos";
import { NovoOrcamentoDialog } from "./novo-orcamento-dialog";

/**
 * Os formulários do Comercial e da Operação antes de ler e com a leitura que
 * falhou (carregamento v2, parte 13i; a regra "nunca afirmar vazio antes da
 * primeira leitura"). Antes, o Novo orçamento dizia "Nenhum cliente" com os
 * clientes ainda lendo ou fora do ar, a Nova demanda dizia "Nenhum item do
 * catálogo" e a resposta do orçamento dizia "Nenhum contato". Agora, lendo, a
 * espera da região ("Carregando clientes…", aos 300 ms); na falha, a frase e
 * "Tentar de novo"; o "Nenhum…" só com a leitura feita. Dados sintéticos.
 */

const noop = () => undefined;
const AGORA = new Date("2026-10-23T16:06:00.000Z");
let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.setSystemTime(AGORA);
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

const lendo = (): LeituraPendente => ({ estado: "carregando", tentando: false, tentar: vi.fn() });
const falhou = (): LeituraPendente => ({ estado: "erro", tentando: false, tentar: vi.fn() });

function botao(texto: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === texto || item.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === texto,
  );
}

function novoOrcamento(leitura?: LeituraPendente) {
  return (
    <NovoOrcamentoDialog
      aberto
      ocupado={false}
      erro={null}
      onCancelar={noop}
      cadastros={[]}
      leituraDosCadastros={leitura}
      contratos={[]}
      hoje="2026-10-23"
      onCriar={noop}
      onCriarProspect={async () => null}
    />
  );
}

describe("Novo orçamento", () => {
  it("com os clientes lendo, não diz Nenhum cliente: a espera entra aos 300 ms", async () => {
    act(() => raiz!.render(novoOrcamento(lendo())));
    expect(document.body.textContent).not.toContain("Nenhum cliente");
    expect(document.body.textContent).not.toContain("Carregando clientes…");
    act(() => vi.advanceTimersByTime(CARREGANDO.atrasoMs));
    expect(document.body.textContent).toContain("Carregando clientes…");
    expect(document.body.textContent).not.toContain("Nenhum cliente");
    const html = document.body.innerHTML;
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("com a leitura que falhou, a frase e Tentar de novo, que relê", async () => {
    const leitura = falhou();
    act(() => raiz!.render(novoOrcamento(leitura)));
    expect(document.body.textContent).not.toContain("Nenhum cliente");
    expect(document.body.textContent).toContain("Não foi possível carregar os clientes.");
    await act(async () => botao("Tentar de novo")!.click());
    expect(leitura.tentar).toHaveBeenCalled();
    const dialogo = document.querySelector('[role="dialog"]')!;
    expect(
      textosForaDaLista(dialogo.outerHTML, ["Novo orçamento", "Cliente", "Não foi possível carregar os clientes.", "Tentar de novo", "Tentando de novo…", "Novo prospect", "Contrato", "Sem contrato", "Variante", "Comercial", "Noturna", "Cancelar", "Criar orçamento", "Criando o orçamento…", "Conferir", "Fechar"]),
    ).toEqual([]);
    const html = document.body.innerHTML;
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("com a leitura feita e vazia, Nenhum cliente", () => {
    act(() => raiz!.render(novoOrcamento()));
    expect(document.body.textContent).toContain("Nenhum cliente");
  });
});

describe("A resposta do orçamento: o contato", () => {
  function resposta(leitura?: LeituraPendente) {
    return (
      <DialogoDepoisDoEnvio
        acao="fechar"
        rotulo="10045 – RV01"
        comprometida={false}
        contatoId={null}
        contatos={[]}
        leituraDosContatos={leitura}
        envioEm="2026-10-20T10:00:00.000Z"
        agora={AGORA}
        hoje="2026-10-23"
        ocupado={false}
        erro={null}
        onCancelar={noop}
        onConfirmar={noop}
      />
    );
  }

  it("com os contatos lendo, o campo não diz Nenhum contato, e a espera entra aos 300 ms", () => {
    act(() => raiz!.render(resposta(lendo())));
    expect(document.body.textContent).not.toContain("Nenhum contato");
    act(() => vi.advanceTimersByTime(CARREGANDO.atrasoMs));
    expect(document.body.textContent).toContain("Carregando os contatos…");
  });

  it("com a leitura que falhou, a frase e Tentar de novo", async () => {
    const leitura = falhou();
    act(() => raiz!.render(resposta(leitura)));
    expect(document.body.textContent).not.toContain("Nenhum contato");
    expect(document.body.textContent).toContain("Não foi possível carregar os contatos.");
    await act(async () => botao("Tentar de novo")!.click());
    expect(leitura.tentar).toHaveBeenCalled();
    const html = document.body.innerHTML;
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("com a leitura feita e vazia, Nenhum contato", () => {
    act(() => raiz!.render(resposta()));
    expect(document.body.textContent).toContain("Nenhum contato");
  });
});

describe("Nova demanda: a busca no catálogo", () => {
  function nova(leitura?: LeituraPendente) {
    return (
      <Router ssrPath="/operacao/nova-demanda">
        <DemandaNovaView
          agora={AGORA}
          form={formularioVazio(AGORA)}
          onForm={noop}
          clientes={[]}
          locais={[]}
          busca="cadeira"
          onBusca={noop}
          resultados={[]}
          leituraDoCatalogo={leitura}
          onAdicionar={noop}
          onAvulso={noop}
          corrigindo={false}
          onCorrigir={noop}
          problemas={[]}
          ocupado={false}
          erro={null}
          onAbrir={noop}
        />
      </Router>
    );
  }

  it("com o catálogo lendo, não diz Nenhum item do catálogo: a espera entra aos 300 ms", () => {
    act(() => raiz!.render(nova(lendo())));
    expect(container.textContent).not.toContain("Nenhum item do catálogo");
    act(() => vi.advanceTimersByTime(CARREGANDO.atrasoMs));
    expect(container.textContent).toContain("Carregando o catálogo…");
  });

  it("com a leitura que falhou, a frase e Tentar de novo", async () => {
    const leitura = falhou();
    act(() => raiz!.render(nova(leitura)));
    expect(container.textContent).not.toContain("Nenhum item do catálogo");
    expect(container.textContent).toContain("Não foi possível carregar o catálogo.");
    await act(async () => botao("Tentar de novo")!.click());
    expect(leitura.tentar).toHaveBeenCalled();
    const html = container.innerHTML;
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("com a leitura feita, sem resultado, Nenhum item do catálogo", () => {
    act(() => raiz!.render(nova()));
    expect(container.textContent).toContain("Nenhum item do catálogo");
  });
});
