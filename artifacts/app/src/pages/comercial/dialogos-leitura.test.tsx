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

/**
 * O foco quando a leitura pendente muda (revisão da parte 13i; WCAG 2.4.3):
 * com o foco na espera (o "Tentar de novo" dos 10 s) e a nova leitura que
 * falha, o foco vai ao "Tentar de novo" da falha que entra no lugar; com o
 * foco no "Tentar de novo" da falha e a leitura que chega, ao campo de onde a
 * pessoa vinha (a busca, o contato), perto de onde ela estava. Antes, ia ao
 * título da página (a Nova demanda rolava ao topo, com a busca fora da tela)
 * ou ao do diálogo. Dados sintéticos.
 */
describe("o foco quando a leitura pendente muda", () => {
  const leituraDe = (estado: "carregando" | "erro" | null): LeituraPendente | undefined =>
    estado ? { estado, tentando: false, tentar: vi.fn() } : undefined;

  function novaDemanda(estado: "carregando" | "erro" | null) {
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
          leituraDoCatalogo={leituraDe(estado)}
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

  function orcamento(estado: "carregando" | "erro" | null) {
    return (
      <NovoOrcamentoDialog
        aberto
        ocupado={false}
        erro={null}
        onCancelar={noop}
        cadastros={[]}
        leituraDosCadastros={leituraDe(estado)}
        contratos={[]}
        hoje="2026-10-23"
        onCriar={noop}
        onCriarProspect={async () => null}
      />
    );
  }

  function contato(estado: "carregando" | "erro" | null) {
    return (
      <DialogoDepoisDoEnvio
        acao="fechar"
        rotulo="10045 – RV01"
        comprometida={false}
        contatoId={null}
        contatos={estado ? [] : [{ id: "c1", nome: "Ana Souza", empresa: "Acme" }]}
        leituraDosContatos={leituraDe(estado)}
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

  /** Aos 10 s, o "Tentar de novo" da espera: o toque deixa o foco na região, que espera de novo. */
  function tocarNaEspera() {
    act(() => vi.advanceTimersByTime(CARREGANDO.demoraMs + 10));
    const tentar = botao("Tentar de novo");
    expect(tentar, "o Tentar de novo da espera").toBeDefined();
    tentar!.focus();
    act(() => tentar!.click());
    expect(document.activeElement?.hasAttribute("data-carregando-na-regiao")).toBe(true);
  }

  async function depois() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it.each([
    ["na Nova demanda", novaDemanda],
    ["no Novo orçamento", orcamento],
    ["no contato da resposta", contato],
  ] as const)("%s, a nova leitura que falha leva o foco ao Tentar de novo da falha", async (_onde, tela) => {
    act(() => raiz!.render(tela("carregando")));
    tocarNaEspera();
    act(() => raiz!.render(tela("erro")));
    await depois();
    const tentar = document.querySelector<HTMLElement>("[data-falha-na-secao] button");
    expect(tentar, "o Tentar de novo da falha").not.toBeNull();
    expect(document.activeElement).toBe(tentar);
  });

  it.each([
    ["na Nova demanda, a busca", novaDemanda, () => document.querySelector<HTMLElement>('input[type="search"]')],
    ["no Novo orçamento, a busca do cliente", orcamento, () => document.getElementById("novo-cliente")],
    ["no contato da resposta, o campo do contato", contato, () => document.getElementById("resposta-contato")],
  ] as const)("%s recebe o foco quando a leitura chega com o foco no Tentar de novo da falha", async (_onde, tela, campo) => {
    act(() => raiz!.render(tela("erro")));
    const tentar = document.querySelector<HTMLElement>("[data-falha-na-secao] button")!;
    tentar.focus();
    act(() => raiz!.render(tela(null)));
    await depois();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(campo());
  });

  it("na Nova demanda, a espera que chega com o foco nela leva o foco à busca", async () => {
    act(() => raiz!.render(novaDemanda("carregando")));
    tocarNaEspera();
    act(() => raiz!.render(novaDemanda(null)));
    await depois();
    expect(document.activeElement).toBe(document.querySelector('input[type="search"]'));
  });
});

describe("os textos da leitura pendente nos formulários", () => {
  it("o contato: só rótulos e dados, na espera e na falha", () => {
    act(() =>
      raiz!.render(
        <DialogoDepoisDoEnvio
          acao="fechar"
          rotulo="10045 – RV01"
          comprometida={false}
          contatoId={null}
          contatos={[]}
          leituraDosContatos={lendo()}
          envioEm="2026-10-20T10:00:00.000Z"
          agora={AGORA}
          hoje="2026-10-23"
          ocupado={false}
          erro={null}
          onCancelar={noop}
          onConfirmar={noop}
        />,
      ),
    );
    act(() => vi.advanceTimersByTime(CARREGANDO.demoraMs + 2_010));
    const lista = [
      "Fechado · 10045 – RV01",
      "Respondido em",
      "Contato",
      "Escolher…",
      "Carregando os contatos…",
      "Demorando mais que o normal",
      /^\d+:\d{2}$/,
      "Não foi possível carregar os contatos.",
      "Tentar de novo",
      "Tentando de novo…",
      "Link do e-mail",
      "Cancelar",
      "Confirmar",
      "Gravando…",
      "Conferir",
      "Fechar",
    ];
    const dialogo = () => document.querySelector('[role="dialog"]')!.outerHTML;
    expect(textosForaDaLista(dialogo(), lista)).toEqual([]);
    act(() =>
      raiz!.render(
        <DialogoDepoisDoEnvio
          acao="fechar"
          rotulo="10045 – RV01"
          comprometida={false}
          contatoId={null}
          contatos={[]}
          leituraDosContatos={falhou()}
          envioEm="2026-10-20T10:00:00.000Z"
          agora={AGORA}
          hoje="2026-10-23"
          ocupado={false}
          erro={null}
          onCancelar={noop}
          onConfirmar={noop}
        />,
      ),
    );
    expect(textosForaDaLista(dialogo(), lista)).toEqual([]);
  });

  it("a busca no catálogo: só rótulos e dados, na espera e na falha", () => {
    const busca = (leitura: LeituraPendente) => (
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
    const regiao = () => {
      const achada = document.querySelector("[data-carregando-na-regiao], [data-falha-na-secao]");
      if (!achada) throw new Error("sem a espera nem a falha do catálogo");
      return achada.outerHTML;
    };
    const lista = ["Carregando o catálogo…", "Demorando mais que o normal", /^\d+:\d{2}$/, "Tentar de novo", "Tentando de novo…", "Não foi possível carregar o catálogo."];
    act(() => raiz!.render(busca(lendo())));
    act(() => vi.advanceTimersByTime(CARREGANDO.demoraMs + 2_010));
    expect(textosForaDaLista(regiao(), lista)).toEqual([]);
    act(() => raiz!.render(busca(falhou())));
    expect(textosForaDaLista(regiao(), lista)).toEqual([]);
  });
});
