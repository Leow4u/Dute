// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProvedorDaConexao, criarConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosDaTela } from "@/test/textos";

import { BlocoSemConexao, ErroNaLeitura, FaixaAoVivo, FaixaSemConexao, FalhaNaLeitura, type LeituraAoVivoNaTela, type LeituraQueFalhou } from "./erro-na-leitura";

/** A tela com o app no estado de conexão pedido. */
function naConexao(estado: EstadoDaConexao, elemento: ReactElement) {
  return renderToStaticMarkup(<ProvedorDaConexao value={conexaoEm(estado)}>{elemento}</ProvedorDaConexao>);
}

/** Erro nunca vira vazio (docs/plataforma/diagnostico-carregamento.md, decisão 6 de 06/11/2026). */

describe("o erro na leitura", () => {
  it("diz que não conseguiu ler e oferece a nova tentativa, como alerta", async () => {
    const html = renderToStaticMarkup(
      <ErroNaLeitura mensagem="Não consegui carregar os pedidos." tentando={false} onTentar={() => undefined} />,
    );
    expect(textosDaTela(html)).toEqual(["Não consegui carregar os pedidos.", "Tentar de novo"]);
    expect(html).toContain('role="alert"');
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("tentando de novo: o botão gira e muda o rótulo; ocupado, não desabilitado", async () => {
    const html = renderToStaticMarkup(
      <ErroNaLeitura mensagem="Não consegui carregar os pedidos." tentando onTentar={() => undefined} />,
    );
    expect(textosDaTela(html)).toEqual(["Não consegui carregar os pedidos.", "Tentando de novo…"]);
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("data-spinner");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

/**
 * As duas faltas (carregamento v2, momento 8; parte 7a): "Sem conexão" só
 * com o app sem conexão (o aparelho sem rede há 3 s); com o aparelho
 * conectado e o servidor sem resposta, "Reconectando…", em tinta, com os
 * arcos do Wi-Fi e sem falar.
 */

describe("na falta de conexão, sem nada lido", () => {
  it("com o app sem conexão: o aviso âmbar no lugar da lista, com o Wi-Fi cortado, sem alerta (o Anunciador diz)", async () => {
    const html = naConexao("sem-conexao", <BlocoSemConexao tentando={false} onTentar={() => undefined} />);
    expect(textosDaTela(html)).toEqual(["Sem conexão.", "Tentar de novo"]);
    // Uma região viva por tela: "Sem conexão" é dito uma vez pelo Anunciador, não pelo bloco.
    expect(html).not.toMatch(/role="(status|alert)"|aria-live/);
    expect(html).toContain("text-carregando-aviso");
    expect(html).toContain("lucide-wifi-off");
    expect(html).toContain("bg-warning-soft");
    expect(html).not.toContain("lucide-circle-alert");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("com o aparelho conectado e o servidor sem resposta: Reconectando…, sem dizer Sem conexão e sem falar", async () => {
    for (const estado of ["reconectando", "conectado"] as const) {
      const html = naConexao(estado, <BlocoSemConexao tentando={false} onTentar={() => undefined} />);
      expect(textosDaTela(html), estado).toEqual(["Reconectando…", "Tentar de novo"]);
      expect(html, estado).not.toContain("Sem conexão");
      expect(html, estado).not.toContain('role="alert"');
      expect(html, estado).toContain("data-arcos");
      expect(html, estado).not.toContain("bg-warning-soft");
      expect(await violacoesDeAcessibilidade(html), estado).toEqual([]);
    }
  });

  it("o Tentar de novo tem 44 px de altura, no bloco e no erro", () => {
    for (const html of [
      naConexao("reconectando", <BlocoSemConexao tentando={false} onTentar={() => undefined} />),
      renderToStaticMarkup(<ErroNaLeitura mensagem="Não consegui carregar os pedidos." tentando={false} onTentar={() => undefined} />),
    ]) {
      expect(html).toMatch(/<button[^>]*class="[^"]*min-h-11/);
      expect(html).not.toMatch(/<button[^>]*class="[^"]*min-h-10/);
    }
  });

  it("sem provedor, lê a conexão do app", () => {
    expect(textosDaTela(renderToStaticMarkup(<BlocoSemConexao tentando={false} onTentar={() => undefined} />))).toEqual([
      "Reconectando…",
      "Tentar de novo",
    ]);
  });
});

describe("na falta de conexão, com a lista já lida", () => {
  // 13:42 UTC são 10:42 no armazém.
  const lidaEm = Date.parse("2026-11-06T13:42:00Z");
  const faixa = () => <FaixaSemConexao lidaEm={lidaEm} tentando={false} onTentar={() => undefined} />;

  it("com o app sem conexão: a pílula âmbar diz desde quando é a lista, no âmbar do carregamento (6,2:1)", async () => {
    const html = naConexao("sem-conexao", faixa());
    expect(textosDaTela(html)).toEqual(["Sem conexão · lista de 10:42", "Tentar de novo"]);
    expect(html).toContain("bg-warning-soft");
    expect(html).toContain("text-carregando-aviso");
    expect(html).not.toContain("text-warning-soft-foreground");
    expect(html).toContain("lucide-wifi-off");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("com o aparelho conectado e o servidor sem resposta: Reconectando… em tinta, com os arcos", async () => {
    const html = naConexao("reconectando", faixa());
    expect(textosDaTela(html)).toEqual(["Reconectando…", "· lista de 10:42", "Tentar de novo"]);
    expect(html).not.toContain("Sem conexão");
    expect(html).not.toContain("bg-warning-soft");
    expect(html).not.toContain("lucide-wifi-off");
    expect(html).toContain("data-arcos");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("não é região viva: Reconectando não fala, e Sem conexão o Anunciador diz uma vez", () => {
    for (const estado of ["sem-conexao", "reconectando"] as const) {
      const html = naConexao(estado, faixa());
      expect(html, estado).not.toMatch(/role="(status|alert)"|aria-live/);
    }
  });

  it("o toque da nova tentativa tem 44 px de altura, sem a faixa crescer: o da linha de estado, estendido pelo ::before", () => {
    for (const estado of ["sem-conexao", "reconectando"] as const) {
      const html = naConexao(estado, faixa());
      // A `.linha-de-estado-tentar` (index.css): 24 px na faixa e o toque de 44 px por um ::before com inset de -10 px.
      expect(html, estado).toMatch(/<button[^>]*class="[^"]*linha-de-estado-tentar/);
      expect(html, estado).not.toContain("min-h-11");
    }
  });

  it("a frase fica inteira: o que não cabe é o Tentar de novo, que passa à linha de baixo (revisão da 13j)", () => {
    const sem = naConexao("sem-conexao", faixa());
    expect(sem).toMatch(/<span[^>]*class="[^"]*whitespace-nowrap[^"]*">Sem conexão · lista de 10:42<\/span>/);
    const reconectando = naConexao("reconectando", faixa());
    expect(reconectando).toMatch(/<span[^>]*class="[^"]*whitespace-nowrap[^"]*"><span[^>]*>Reconectando…<\/span><span[^>]*>· lista de 10:42<\/span><\/span>/);
  });

  it("diz o que está na tela: a lista, ou a OS, a demanda, o orçamento (revisão da 13j)", async () => {
    const os = (estado: EstadoDaConexao) => naConexao(estado, <FaixaSemConexao lidaEm={lidaEm} objeto="OS" tentando={false} onTentar={() => undefined} />);
    expect(textosDaTela(os("sem-conexao"))).toEqual(["Sem conexão · OS de 10:42", "Tentar de novo"]);
    expect(textosDaTela(os("reconectando"))).toEqual(["Reconectando…", "· OS de 10:42", "Tentar de novo"]);
    expect(await violacoesDeAcessibilidade(os("sem-conexao"))).toEqual([]);
  });
});

/**
 * A faixa da lista ao vivo (revisão da parte 13j): a histerese do momento 8.
 * Cada aviso fica pelo menos 2 s antes de dar lugar a outro (o soluço do
 * servidor não pisca a faixa nem empurra a lista duas vezes seguidas); na
 * volta da rede, "Sem conexão" fica até a leitura voltar, sem passar por
 * "Reconectando…"; o foco no "Tentar de novo" nunca cai no body quando ela
 * sai; e o toque diz "Tentando de novo…" enquanto o SDK é acordado.
 */
describe("a faixa da lista ao vivo (revisão da 13j)", () => {
  let raiz: Root | null = null;
  let container: HTMLElement | null = null;
  const lidaEm = Date.parse("2026-11-06T13:42:00Z");
  const noop = () => undefined;

  afterEach(() => {
    act(() => raiz?.unmount());
    container?.remove();
    raiz = null;
    container = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function montar(elemento: ReactElement, tag: "div" | "main" = "div") {
    if (!vi.isFakeTimers()) vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement(tag);
    document.body.append(container);
    raiz = createRoot(container);
    act(() => raiz!.render(elemento));
  }

  const passar = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  const faixaNaTela = () => container!.querySelector("[data-falta]:not([data-falha-na-leitura])");
  const ao = (leitura: Partial<LeituraAoVivoNaTela>): LeituraAoVivoNaTela => ({ tentando: false, tentar: noop, falta: null, lidaEm: null, ...leitura });

  it("fica pelo menos 2 s: o soluço do servidor não a pisca", () => {
    const conexao = conexaoEm("reconectando");
    const tela = (leitura: LeituraAoVivoNaTela) => (
      <ProvedorDaConexao value={conexao}>
        <FaixaAoVivo leitura={leitura} />
      </ProvedorDaConexao>
    );
    montar(tela(ao({})));
    expect(faixaNaTela()).toBeNull();
    act(() => raiz!.render(tela(ao({ falta: "conexao", lidaEm }))));
    expect(faixaNaTela()?.textContent).toContain("· lista de 10:42");
    // O servidor responde 300 ms depois: a faixa fica até completar os 2 s.
    passar(300);
    act(() => raiz!.render(tela(ao({}))));
    expect(faixaNaTela()?.textContent).toContain("· lista de 10:42");
    passar(1_699);
    expect(faixaNaTela()).not.toBeNull();
    // A queda que volta dentro dos 2 s não recomeça a conta nem tira a faixa.
    act(() => raiz!.render(tela(ao({ falta: "conexao", lidaEm }))));
    act(() => raiz!.render(tela(ao({}))));
    passar(1);
    expect(faixaNaTela()).toBeNull();
    // A que fica mais de 2 s sai com a leitura que voltou.
    act(() => raiz!.render(tela(ao({ falta: "conexao", lidaEm }))));
    passar(2_500);
    act(() => raiz!.render(tela(ao({}))));
    expect(faixaNaTela()).toBeNull();
  });

  for (const [nome, peca] of [
    ["a faixa", (falta: boolean) => <FaixaAoVivo leitura={ao(falta ? { falta: "conexao", lidaEm } : {})} />],
    ["o bloco", (falta: boolean) => (falta ? <BlocoSemConexao tentando={false} onTentar={noop} /> : null)],
  ] as const) {
    it(`${nome}: na volta da rede, Sem conexão fica até a leitura voltar, sem passar por Reconectando`, () => {
      let rede = false;
      vi.useFakeTimers();
      const conexao = criarConexao({ temRede: () => rede });
      const tela = (falta: boolean) => <ProvedorDaConexao value={conexao}>{peca(falta)}</ProvedorDaConexao>;
      montar(tela(true));
      // Sem rede há 6 s: o "Sem conexão" já completou os 2 s do aviso.
      passar(6_000);
      expect(conexao.estado()).toBe("sem-conexao");
      expect(container!.textContent).toMatch(/^Sem conexão/);
      // A rede volta: o estado único passa a "Reconectando" (o servidor ainda não respondeu)…
      rede = true;
      act(() => conexao.redeMudou());
      expect(conexao.estado()).toBe("reconectando");
      // …e a peça segue em "Sem conexão" até a leitura voltar, 1,2 s depois, e sai dali direto.
      for (const ms of [0, 600, 1_199]) {
        if (ms) passar(ms === 600 ? 600 : 599);
        expect(container!.textContent, `${ms} ms depois da volta da rede`).toMatch(/^Sem conexão/);
      }
      passar(1);
      act(() => raiz!.render(tela(false)));
      expect(container!.textContent).toBe("");
      passar(2_000);
      expect(container!.textContent).toBe("");
      conexao.fechar();
    });

    it(`${nome}: na volta da rede sem o servidor, Reconectando… só depois dos 2 s do aviso`, () => {
      let rede = false;
      vi.useFakeTimers();
      const conexao = criarConexao({ temRede: () => rede });
      montar(<ProvedorDaConexao value={conexao}>{peca(true)}</ProvedorDaConexao>);
      passar(6_000);
      rede = true;
      act(() => conexao.redeMudou());
      passar(1_999);
      expect(container!.textContent).toMatch(/^Sem conexão/);
      passar(1);
      expect(container!.textContent).toMatch(/^Reconectando…/);
      conexao.fechar();
    });
  }

  it("com o foco no Tentar de novo, a faixa que sai leva o foco ao título da seção, nunca ao body", async () => {
    const conexao = conexaoEm("sem-conexao");
    const tela = (falta: boolean) => (
      <ProvedorDaConexao value={conexao}>
        <section>
          <h1>Demandas</h1>
          <FaixaAoVivo leitura={ao(falta ? { falta: "conexao", lidaEm } : {})} />
          <ul>
            <li>10045</li>
          </ul>
        </section>
      </ProvedorDaConexao>
    );
    montar(tela(true), "main");
    const botao = faixaNaTela()!.querySelector("button")!;
    act(() => botao.focus());
    expect(document.activeElement).toBe(botao);
    passar(2_000);
    act(() => raiz!.render(tela(false)));
    await act(async () => undefined);
    expect(faixaNaTela()).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.textContent).toBe("Demandas");
  });

  it("o Tentar de novo diz Tentando de novo… enquanto acorda o SDK, ocupado e não desabilitado; o toque repetido não acorda de novo", async () => {
    let acordou: (() => void) | null = null;
    const acordar = vi.fn(() => new Promise<void>((pronto) => (acordou = pronto)));
    const conexao = criarConexao({ temRede: () => true });
    conexao.aoAcordar(acordar);
    const tentar = vi.fn();
    montar(
      <ProvedorDaConexao value={conexao}>
        <FaixaAoVivo leitura={ao({ falta: "conexao", lidaEm, tentar })} />
      </ProvedorDaConexao>,
    );
    const botao = faixaNaTela()!.querySelector("button")!;
    act(() => botao.click());
    expect(acordar).toHaveBeenCalledTimes(1);
    passar(299);
    expect(botao.textContent).toBe("Tentar de novo");
    passar(1);
    expect(botao.textContent).toBe("Tentando de novo…");
    expect(botao.getAttribute("aria-busy")).toBe("true");
    expect(botao.getAttribute("aria-disabled")).toBe("true");
    expect(botao.disabled).toBe(false);
    act(() => botao.click());
    expect(acordar).toHaveBeenCalledTimes(1);
    passar(5_000);
    expect(botao.textContent).toBe("Tentando de novo…");
    await act(async () => {
      acordou!();
      await Promise.resolve();
    });
    expect(tentar).toHaveBeenCalledTimes(1);
    passar(500);
    expect(botao.textContent).toBe("Tentar de novo");
    conexao.fechar();
  });
});

describe("a nova tentativa no relógio da espera", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => raiz?.unmount());
    container?.remove();
    raiz = null;
    container = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function montar(elemento: ReactElement) {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    raiz = createRoot(container);
    act(() => raiz!.render(elemento));
  }

  function botao() {
    return container!.querySelector("button")!;
  }

  function passar(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  const lidaEm = Date.parse("2026-11-06T13:42:00Z");

  for (const [nome, peca] of [
    ["a faixa", (tentando: boolean, onTentar: () => void) => <FaixaSemConexao lidaEm={lidaEm} tentando={tentando} onTentar={onTentar} />],
    ["o bloco", (tentando: boolean, onTentar: () => void) => <BlocoSemConexao tentando={tentando} onTentar={onTentar} />],
  ] as const) {
    it(`${nome}: a leitura que acaba antes de 300 ms não pisca o botão, nem durante, nem depois`, () => {
      const onTentar = vi.fn();
      montar(peca(false, onTentar));
      act(() => raiz!.render(peca(true, onTentar)));
      passar(100);
      expect(botao().textContent).toBe("Tentar de novo");
      expect(botao().hasAttribute("aria-busy")).toBe(false);
      expect(botao().hasAttribute("aria-disabled")).toBe(false);
      passar(150);
      expect(botao().textContent).toBe("Tentar de novo");
      act(() => raiz!.render(peca(false, onTentar)));
      passar(1_000);
      expect(botao().textContent).toBe("Tentar de novo");
      expect(botao().hasAttribute("aria-busy")).toBe(false);
    });

    it(`${nome}: a trava do toque segue o que o botão diz`, () => {
      const onTentar = vi.fn();
      montar(peca(true, onTentar));
      // Aos 100 ms o botão ainda diz "Tentar de novo", e o toque tenta.
      passar(100);
      act(() => botao().click());
      expect(onTentar).toHaveBeenCalledTimes(1);
      // Aos 300 ms diz "Tentando de novo…" e fica aria-disabled: o toque não faz nada.
      passar(250);
      expect(botao().getAttribute("aria-disabled")).toBe("true");
      // A leitura acabou, mas o aviso fica o mínimo de 500 ms: ainda ocupado, e o toque continua barrado.
      act(() => raiz!.render(peca(false, onTentar)));
      expect(botao().textContent).toBe("Tentando de novo…");
      expect(botao().getAttribute("aria-disabled")).toBe("true");
      act(() => botao().click());
      expect(onTentar).toHaveBeenCalledTimes(1);
      passar(500);
      expect(botao().hasAttribute("aria-disabled")).toBe(false);
      act(() => botao().click());
      expect(onTentar).toHaveBeenCalledTimes(2);
    });

    it(`${nome}: o toque acorda a conexão de quem lê e só então relê`, async () => {
      const onTentar = vi.fn();
      let acordou: (() => void) | null = null;
      const conexao = criarConexao({ temRede: () => true });
      conexao.aoAcordar(() => new Promise<void>((resolver) => (acordou = resolver)));
      montar(<ProvedorDaConexao value={conexao}>{peca(false, onTentar)}</ProvedorDaConexao>);
      act(() => botao().click());
      expect(onTentar).not.toHaveBeenCalled();
      await act(async () => {
        acordou!();
        await Promise.resolve();
      });
      expect(onTentar).toHaveBeenCalledTimes(1);
      // Sem o que acordar, relê na hora.
      conexao.aoAcordar(() => null);
      act(() => botao().click());
      expect(onTentar).toHaveBeenCalledTimes(2);
      conexao.fechar();
    });

    it(`${nome}: a que demora mostra "Tentando de novo…" aos 300 ms, ocupada e não desabilitada, e o toque repetido não relê`, () => {
      const onTentar = vi.fn();
      montar(peca(false, onTentar));
      act(() => botao().click());
      expect(onTentar).toHaveBeenCalledTimes(1);
      act(() => raiz!.render(peca(true, onTentar)));
      passar(299);
      expect(botao().textContent).toBe("Tentar de novo");
      passar(1);
      expect(botao().textContent).toBe("Tentando de novo…");
      expect(botao().getAttribute("aria-busy")).toBe("true");
      expect(botao().getAttribute("aria-disabled")).toBe("true");
      expect(botao().disabled).toBe(false);
      act(() => botao().click());
      expect(onTentar).toHaveBeenCalledTimes(1);
      // Pelo menos 500 ms na tela, mesmo que a leitura acabe logo.
      act(() => raiz!.render(peca(false, onTentar)));
      expect(botao().textContent).toBe("Tentando de novo…");
      passar(500);
      expect(botao().textContent).toBe("Tentar de novo");
    });
  }
});

/** O aviso da leitura que falhou sem a lista dela (a primeira, ou a troca de filtro que falhou; carregamento v2, parte 10). */
describe("a falha na leitura", () => {
  const falhou = (erro: unknown, refetch: () => Promise<never> = vi.fn(async () => ({}) as never)) =>
    ({ error: erro, refetch }) as unknown as LeituraQueFalhou;

  it("o aviso no lugar da lista, com Tentar de novo de 44 px, como alerta; textos e axe", async () => {
    const html = naConexao(
      "conectado",
      <FalhaNaLeitura leitura={falhou(new Error("Falha interna no servidor."))} mensagem="Não consegui carregar os produtos." />,
    );
    expect(textosDaTela(html)).toEqual(["Não consegui carregar os produtos.", "Tentar de novo"]);
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/<button[^>]*class="[^"]*min-h-11/);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("na falta de conexão, o bloco da conexão, sem alerta", async () => {
    const semRede = Object.assign(new Error("Sem conexão."), { code: "sem_conexao" });
    const html = naConexao("sem-conexao", <FalhaNaLeitura leitura={falhou(semRede)} mensagem="Não consegui carregar os produtos." />);
    expect(textosDaTela(html)).toEqual(["Sem conexão.", "Tentar de novo"]);
    expect(html).not.toContain('role="alert"');
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("Tentando de novo… só na nova tentativa que a pessoa pediu, no relógio da espera, até a leitura responder; ocupado, não desabilitado; axe", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let responder: () => void = () => undefined;
    const refetch = vi.fn(() => new Promise<never>((pronto) => (responder = () => pronto(undefined as never))));
    const container = document.createElement("div");
    document.body.append(container);
    const raiz: Root = createRoot(container);
    act(() =>
      raiz.render(
        <ProvedorDaConexao value={conexaoEm("conectado")}>
          <FalhaNaLeitura leitura={falhou(new Error("Falha interna no servidor."), refetch)} mensagem="Não consegui carregar os produtos." />
        </ProvedorDaConexao>,
      ),
    );
    const botao = container.querySelector("button")!;
    expect(botao.textContent).toBe("Tentar de novo");
    await act(async () => botao.click());
    expect(refetch).toHaveBeenCalledTimes(1);
    // Antes de 300 ms, nada muda na tela; o toque repetido, com a leitura a caminho, não lê de novo.
    expect(botao.textContent).toBe("Tentar de novo");
    await act(async () => botao.click());
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(textosDaTela(container.innerHTML)).toEqual(["Não consegui carregar os produtos.", "Tentando de novo…"]);
    expect(botao.hasAttribute("disabled")).toBe(false);
    expect(botao.getAttribute("aria-disabled")).toBe("true");
    expect(botao.getAttribute("aria-busy")).toBe("true");
    await act(async () => botao.click());
    expect(refetch).toHaveBeenCalledTimes(1);
    const tentando = container.innerHTML;
    await act(async () => responder());
    // Pelo menos 500 ms na tela, mesmo que a leitura acabe logo.
    expect(botao.textContent).toBe("Tentando de novo…");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(botao.textContent).toBe("Tentar de novo");
    act(() => raiz.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    expect(await violacoesDeAcessibilidade(tentando)).toEqual([]);
  });

  it("a nova tentativa que falha de novo antes de 300 ms não pisca o botão nem muda o alerta, que o leitor de tela releria", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let falhar: () => void = () => undefined;
    const refetch = vi.fn(() => new Promise<never>((pronto) => (falhar = () => pronto(undefined as never))));
    const container = document.createElement("div");
    document.body.append(container);
    const raiz: Root = createRoot(container);
    act(() =>
      raiz.render(
        <ProvedorDaConexao value={conexaoEm("conectado")}>
          <FalhaNaLeitura leitura={falhou(new Error("Falha interna no servidor."), refetch)} mensagem="Não consegui carregar os produtos." />
        </ProvedorDaConexao>,
      ),
    );
    const alerta = container.querySelector('[role="alert"]')!;
    const mudancas: string[] = [];
    const observador = new MutationObserver(() => mudancas.push(alerta.textContent ?? ""));
    observador.observe(alerta, { subtree: true, childList: true, characterData: true });
    await act(async () => container.querySelector("button")!.click());
    act(() => {
      vi.advanceTimersByTime(150);
    });
    await act(async () => falhar());
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => undefined);
    observador.disconnect();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mudancas).toEqual([]);
    expect(alerta.textContent).toBe("Não consegui carregar os produtos.Tentar de novo");
    act(() => raiz.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
