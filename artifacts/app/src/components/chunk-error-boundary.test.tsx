// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { telaSobDemanda } from "@/lib/telas-no-aparelho";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import {
  AvisoDaFalha,
  ChunkErrorBoundary,
  classificarFalha,
  enderecoDoArquivo,
  falhaDeArquivo,
  type AmbienteDaFalha,
  type FalhaDaTela,
} from "./chunk-error-boundary";

/**
 * A tela que não abre (docs/plataforma/diagnostico-carregamento.md, 9.1,
 * item 3, e 9.3, PR 2 do celular). Antes, qualquer falha caía em "Nao foi
 * possivel carregar esta tela. Uma nova versao pode ter sido publicada.",
 * sem acentos, e "Recarregar" sem rede não resolvia nada. Agora cada caso
 * diz o seu: a falta de rede, a versão nova e o erro da própria tela.
 */

const TEXTOS = [
  "Sem conexão.",
  "Há uma versão nova da Dutelog.",
  "Não foi possível abrir esta tela.",
  "Tentar de novo",
  "Atualizar",
];

// As mensagens de cada navegador quando o import dinâmico falha.
const CHROME = new TypeError("Failed to fetch dynamically imported module: https://app.dutelog.com.br/assets/pedidos-PH8GBpV1.js");
const FIREFOX = new TypeError("error loading dynamically imported module: https://app.dutelog.com.br/assets/receber-BalgdmIW.js");
const SAFARI = new TypeError("Importing a module script failed.");
const CSS_DO_VITE = new Error("Unable to preload CSS for /assets/pdf-CL8ynlU4.css");
const DA_TELA = new TypeError("Cannot read properties of undefined (reading 'items')");

function ambiente(online: boolean, resposta: number | "falha" | "nunca"): AmbienteDaFalha & { sondar: ReturnType<typeof vi.fn> } {
  const sondar = vi.fn(async () => {
    if (resposta === "falha") throw new TypeError("Failed to fetch");
    if (resposta === "nunca") return new Promise<{ status: number }>(() => undefined);
    return { status: resposta };
  });
  return { online, sondar, prazoMs: 50, raiz: "/" };
}

describe("o que falhou", () => {
  it("reconhece o arquivo da tela que não chegou, em cada navegador, e não confunde com o erro da tela", () => {
    for (const erro of [CHROME, FIREFOX, SAFARI, CSS_DO_VITE]) expect(falhaDeArquivo(erro), erro.message).toBe(true);
    expect(falhaDeArquivo(DA_TELA)).toBe(false);
    expect(falhaDeArquivo("qualquer coisa")).toBe(false);
    expect(falhaDeArquivo(null)).toBe(false);
  });

  it("acha o endereço do arquivo na mensagem, quando o navegador diz", () => {
    expect(enderecoDoArquivo(CHROME)).toBe("https://app.dutelog.com.br/assets/pedidos-PH8GBpV1.js");
    expect(enderecoDoArquivo(FIREFOX)).toBe("https://app.dutelog.com.br/assets/receber-BalgdmIW.js");
    expect(enderecoDoArquivo(CSS_DO_VITE)).toBe("/assets/pdf-CL8ynlU4.css");
    expect(enderecoDoArquivo(SAFARI)).toBeNull();
  });

  it.each<[string, Error, boolean, number | "falha" | "nunca", FalhaDaTela]>([
    ["sem rede", CHROME, false, 200, "sem-conexao"],
    ["com rede e o arquivo sumido (deploy)", CHROME, true, 404, "versao-nova"],
    ["com rede e o arquivo lá (sinal fraco)", FIREFOX, true, 200, "sem-conexao"],
    ["com rede e a pergunta sem resposta", CHROME, true, "falha", "sem-conexao"],
    ["com rede e a pergunta que não volta", CHROME, true, "nunca", "sem-conexao"],
    ["no Safari, que não diz o arquivo, com o servidor respondendo", SAFARI, true, 200, "versao-nova"],
    ["no Safari, com o aparelho \"conectado\" e o servidor fora de alcance", SAFARI, true, "falha", "sem-conexao"],
    ["no Safari, com a pergunta que não volta (sinal fraco)", SAFARI, true, "nunca", "sem-conexao"],
    ["a própria tela quebrou", DA_TELA, true, 200, "erro-de-tela"],
    ["a própria tela quebrou, sem rede", DA_TELA, false, 200, "erro-de-tela"],
  ])("%s", async (_caso, erro, online, resposta, esperado) => {
    const meio = ambiente(online, resposta);
    expect(await classificarFalha(erro, meio)).toBe(esperado);
    // Só pergunta ao servidor quando precisa desempatar: pelo arquivo que faltou ou, sem ele, pelo app.
    if (online && falhaDeArquivo(erro)) {
      expect(meio.sondar).toHaveBeenCalledWith(enderecoDoArquivo(erro) ?? "/");
    } else {
      expect(meio.sondar).not.toHaveBeenCalled();
    }
  });
});

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // O React reporta o erro pego pela fronteira no console.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Quebra({ erro }: { erro: Error }): never {
  throw erro;
}

async function abrir(erro: Error, meio: AmbienteDaFalha) {
  await act(async () => {
    raiz!.render(
      <ChunkErrorBoundary ambiente={() => meio}>
        <Quebra erro={erro} />
      </ChunkErrorBoundary>,
    );
  });
  // A sonda responde e a fronteira troca a espera pelo aviso.
  await act(async () => {
    await new Promise((resolver) => setTimeout(resolver, 0));
  });
  return container!.querySelector<HTMLElement>('[role="alert"]');
}

describe("ChunkErrorBoundary", () => {
  it("sem rede: \"Sem conexão.\" e \"Tentar de novo\"", async () => {
    const aviso = await abrir(CHROME, ambiente(false, 200));
    expect(aviso?.getAttribute("data-falha")).toBe("sem-conexao");
    expect(aviso?.textContent).toBe("Sem conexão.Tentar de novo");
  });

  it("versão nova (o arquivo sumiu no deploy): \"Há uma versão nova da Dutelog.\" e \"Atualizar\"", async () => {
    const aviso = await abrir(CHROME, ambiente(true, 404));
    expect(aviso?.getAttribute("data-falha")).toBe("versao-nova");
    expect(aviso?.textContent).toBe("Há uma versão nova da Dutelog.Atualizar");
  });

  it("sinal fraco (o arquivo existe): \"Sem conexão.\"", async () => {
    const aviso = await abrir(FIREFOX, ambiente(true, 200));
    expect(aviso?.getAttribute("data-falha")).toBe("sem-conexao");
  });

  it("erro da tela: \"Não foi possível abrir esta tela.\", sem perguntar ao servidor", async () => {
    const meio = ambiente(true, 404);
    const aviso = await abrir(DA_TELA, meio);
    expect(aviso?.getAttribute("data-falha")).toBe("erro-de-tela");
    expect(aviso?.textContent).toBe("Não foi possível abrir esta tela.Tentar de novo");
    expect(meio.sondar).not.toHaveBeenCalled();
  });

  it("enquanto o servidor desempata, espera com a CarregandoTela, e não com o aviso errado", async () => {
    await act(async () => {
      raiz!.render(
        <ChunkErrorBoundary ambiente={() => ambiente(true, "nunca")}>
          <Quebra erro={CHROME} />
        </ChunkErrorBoundary>,
      );
    });
    expect(container!.querySelector("[data-carregando-tela]")).not.toBeNull();
    expect(container!.querySelector('[role="alert"]')).toBeNull();
  });

  it("enquanto confere, segue com o nome da tela e o relógio de quando ela começou a abrir, sem anunciar de novo", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
    try {
      let falhar: (erro: unknown) => void = () => undefined;
      const Pedidos = telaSobDemanda("pages/pedidos", () => new Promise<{ default: () => null }>((_, recusar) => (falhar = recusar)));
      const { Suspense } = await import("react");
      const { CarregandoTela } = await import("@/components/ui/carregando-tela");
      const meio = ambiente(true, "nunca");
      meio.prazoMs = 8_000;
      const anuncio = () => document.querySelector("[data-anunciador]")?.textContent ?? "";
      const tela = () => container!.querySelector("[data-carregando-tela]")?.textContent;
      await act(async () => {
        raiz!.render(
          <>
            <ChunkErrorBoundary titulo="Pedidos" ambiente={() => meio}>
              <Suspense fallback={<CarregandoTela titulo="Pedidos" />}>
                <Pedidos />
              </Suspense>
            </ChunkErrorBoundary>
            <Anunciador />
          </>,
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CARREGANDO.atrasoMs);
      });
      expect(tela()).toBe("Abrindo Pedidos…");
      expect(anuncio()).toBe("Abrindo Pedidos…");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      // O arquivo não veio; a sonda ainda não respondeu.
      await act(async () => {
        falhar(CHROME);
        await Promise.resolve();
      });
      // O rótulo não some, não troca de nome e não é anunciado de novo.
      expect(tela()).toBe("Abrindo Pedidos…");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CARREGANDO.atrasoMs);
      });
      expect(tela()).toBe("Abrindo Pedidos…");
      expect(anuncio()).toBe("Abrindo Pedidos…");
      // O relógio é o mesmo: aos 10 s desde o começo, a demora.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CARREGANDO.demoraMs - 3_000 - 2 * CARREGANDO.atrasoMs);
      });
      expect(tela()).toContain("Demorando mais que o normal");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sem falha, mostra a tela", async () => {
    await act(async () => {
      raiz!.render(
        <ChunkErrorBoundary>
          <p>Pedidos</p>
        </ChunkErrorBoundary>,
      );
    });
    expect(container!.textContent).toBe("Pedidos");
  });

  it("a saída recarrega o app, com o alvo de 44 px", async () => {
    const recarregar = vi.fn();
    await act(async () => {
      raiz!.render(<AvisoDaFalha falha="versao-nova" onRecarregar={recarregar} />);
    });
    const botao = container!.querySelector("button")!;
    expect(botao.textContent).toBe("Atualizar");
    expect(botao.className).toMatch(/\bmin-h-11\b/);
    expect(botao.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    await act(async () => botao.click());
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it.each<FalhaDaTela>(["sem-conexao", "versao-nova", "erro-de-tela"])("%s: os textos da lista e o axe", async (falha) => {
    await act(async () => {
      raiz!.render(<AvisoDaFalha falha={falha} />);
    });
    expect(textosForaDaLista(container!.innerHTML, TEXTOS)).toEqual([]);
    expect(await violacoesDeAcessibilidade(container!.innerHTML)).toEqual([]);
  });

  it("o App usa esta fronteira, e não a antiga sem acentos", () => {
    const app = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../App.tsx"), "utf8");
    expect(app).toContain('import { ChunkErrorBoundary } from "@/components/chunk-error-boundary";');
    expect(app).not.toMatch(/class ChunkErrorBoundary/);
    expect(app).not.toMatch(/Nao foi possivel|nova versao/);
  });
});
