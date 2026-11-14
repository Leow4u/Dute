// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { fichaDaLeitura } from "@/lib/operacao/ficha-da-os";
import { comprovanteDaOs } from "@/lib/portal/comprovante";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { ComprovanteView, type FotosDoComprovante } from "./comprovante-view";

/**
 * O comprovante da OS no portal, no carregamento v2 (parte 13f). Antes:
 * "Carregando" em texto seco; a falha sem "Tentar de novo"; o "Baixar PDF"
 * ativo antes de a assinatura e as fotos chegarem (o PDF saía sem elas); e a
 * foto que não vinha sumia do papel, calada. Dados sintéticos.
 */

const ASSINATURA = "os/10045-01/assinatura.png";
const FOTO = "os/10045-01/fotos/ft_f000000000000001.jpg";

const FICHA = fichaDaLeitura("10045-01", {
  demanda: "10045",
  customer_code: "ACME",
  cliente_nome: "ACME",
  status: "revisada",
  edicao: 9,
  servicos: ["transporte"],
  janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
  locais: { origem: { nome: "Galpão 3", endereco: "Rua das Indústrias, 450" }, destino: { endereco: "Av. Faria Lima, 3500" } },
  equipe: [{ colaborador_id: "c2", nome: "João Pereira", papel: "motorista" }],
  veiculos: [{ veiculo_id: "v1", placa: "DEF4G56", tipo: "caminhao" }],
  itens: [{ id: "ln_1", item: "Cadeira", unidade: "UN", planejado: "150", executado: "160" }],
  revisao: { instante: "2026-10-23T12:00:00.000Z", nota: "Conferido" },
  conclusao: {
    instante: "2026-10-22T19:30:00.000Z",
    canal: "celular",
    aceite: "assinatura",
    responsavel: { nome: "Renata Campos", cargo: "Facilities" },
    assinatura: ASSINATURA,
    diferencas: [],
    arquivos_do_final: ["ft_f000000000000001.jpg"],
  },
})!;
const COMPROVANTE = comprovanteDaOs(FICHA, "ACME");

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const espera = (ms: number) => act(async () => new Promise((pronto) => setTimeout(pronto, ms)));

async function ate(condicao: () => unknown, limiteMs = 3_000) {
  const fim = Date.now() + limiteMs;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error("A tela não chegou ao estado esperado em 3 s.");
    await espera(20);
  }
}

async function montar(tela: ReactNode) {
  await act(async () => raiz!.render(<Router ssrPath="/portal/servicos/comprovante">{tela}</Router>));
}

const baixar = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((botao) => botao.textContent?.trim() === "Baixar PDF")!;

describe("o comprovante lendo e na falha", () => {
  it("lendo, a caixa e 'Carregando o comprovante…' aos 300 ms", async () => {
    await montar(<ComprovanteView estado="carregando" numero="10045-01" comprovante={null} urls={{}} onBaixar={() => undefined} leitura={{ tentando: false, onTentar: () => undefined }} />);
    await ate(() => container.textContent?.includes("Carregando o comprovante…"));
    expect(container.querySelector("[data-carregando-na-regiao] [data-spinner]")?.getAttribute("aria-hidden")).toBe("true");
    expect(textosForaDaLista(container.innerHTML, ["Minhas OS", "Comprovante da OS 10045-01", "Baixar PDF", "Carregando o comprovante…"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("a falha com 'Tentar de novo'", async () => {
    let tentativas = 0;
    await montar(<ComprovanteView estado="erro" numero="10045-01" comprovante={null} urls={{}} onBaixar={() => undefined} leitura={{ tentando: false, onTentar: () => (tentativas += 1) }} />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Não foi possível carregar o comprovante.");
    const tentar = [...container.querySelectorAll<HTMLButtonElement>("button")].find((botao) => botao.textContent?.trim() === "Tentar de novo")!;
    await act(async () => tentar.click());
    expect(tentativas).toBe(1);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });
});

describe("as imagens do papel", () => {
  const tela = (fotos: FotosDoComprovante, urls: Record<string, string> = {}, imprimir: () => void = () => undefined) => (
    <ComprovanteView estado="pronto" numero="10045-01" comprovante={COMPROVANTE} urls={urls} onBaixar={imprimir} fotos={fotos} />
  );

  it("chegando, o Baixar PDF espera (travado no código, nunca disabled) e a barra diz 'Carregando as fotos…'", async () => {
    let impressoes = 0;
    await montar(
      tela({ lendo: true, falharam: [], tentando: false, onTentar: () => undefined }, {}, () => {
        impressoes += 1;
      }),
    );
    expect(baixar().getAttribute("aria-disabled")).toBe("true");
    expect(baixar().hasAttribute("disabled")).toBe(false);
    await act(async () => baixar().click());
    expect(impressoes).toBe(0);
    await ate(() => container.textContent?.includes("Carregando as fotos…"));
    // A foto que chega guarda o lugar no papel, fora da árvore.
    expect(container.querySelector('article li [aria-hidden="true"]')).not.toBeNull();
  });

  it("a que não veio fica dita, na barra e no papel, com 'Tentar de novo'; o PDF segue possível", async () => {
    let tentativas = 0;
    let impressoes = 0;
    await montar(
      tela(
        { lendo: false, falharam: [FOTO], tentando: false, onTentar: () => (tentativas += 1) },
        { [ASSINATURA]: "https://exemplo.invalid/assinatura.png" },
        () => {
          impressoes += 1;
        },
      ),
    );
    expect(container.textContent).toContain("Uma imagem do comprovante não carregou.");
    expect(container.querySelector("article")!.textContent).toContain("Foto 1 não carregou");
    const tentar = [...container.querySelectorAll<HTMLButtonElement>("button")].find((botao) => botao.textContent?.trim() === "Tentar de novo")!;
    await act(async () => tentar.click());
    expect(tentativas).toBe(1);
    await act(async () => baixar().click());
    expect(impressoes).toBe(1);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("a espera das fotos tem prazo: aos 70 s, a desistência, e o Baixar PDF volta a sair com o que chegou", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
    try {
      let impressoes = 0;
      await montar(
        tela({ lendo: true, falharam: [], tentando: false, onTentar: () => undefined }, {}, () => {
          impressoes += 1;
        }),
      );
      await act(async () => vi.advanceTimersByTime(11_000));
      expect(baixar().getAttribute("aria-disabled")).toBe("true");
      await act(async () => vi.advanceTimersByTime(60_000));
      expect(container.textContent).toContain("Sem resposta do servidor.");
      expect(baixar().hasAttribute("aria-disabled")).toBe(false);
      await act(async () => baixar().click());
      expect(impressoes).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lendo, o lugar da foto que chega fica fora da árvore: a lista não tem item em branco para o leitor de tela", async () => {
    await montar(tela({ lendo: true, falharam: [], tentando: false, onTentar: () => undefined }));
    const itens = [...container.querySelectorAll<HTMLLIElement>("article ul li")].filter((item) => !item.querySelector("img") && !item.textContent?.trim());
    expect(itens.length).toBeGreaterThan(0);
    for (const item of itens) expect(item.getAttribute("aria-hidden")).toBe("true");
    await ate(() => container.textContent?.includes("Carregando as fotos…"));
    expect(
      textosForaDaLista(container.innerHTML, ["Minhas OS", "Comprovante da OS 10045-01", "Baixar PDF", "Carregando as fotos…"].concat(textosDoPapel())),
    ).toEqual([]);
  });

  it("as que não vieram, a assinatura e a foto, ficam ditas com os rótulos da lista", async () => {
    await montar(tela({ lendo: false, falharam: [ASSINATURA, FOTO], tentando: false, onTentar: () => undefined }));
    expect(container.textContent).toContain("2 imagens do comprovante não carregaram.");
    expect(
      textosForaDaLista(
        container.innerHTML,
        ["Minhas OS", "Comprovante da OS 10045-01", "Baixar PDF", "2 imagens do comprovante não carregaram.", "Tentar de novo", "Assinatura não carregou", "Foto 1 não carregou"].concat(textosDoPapel()),
      ),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });
});

/** Os textos do papel do comprovante (o documento, que tem o teste dele), menos os da falha, que vêm da lista. */
function textosDoPapel(): string[] {
  const papel = container.querySelector("article");
  return papel ? textosDaTela(papel.outerHTML).filter((texto) => !/não carregou/.test(texto)) : [];
}
