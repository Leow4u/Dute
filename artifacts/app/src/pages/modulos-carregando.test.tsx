// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { minhasOs, saudacao } from "@/lib/campo/os-no-campo";
import { TELAS_DO_COMERCIAL } from "@/lib/comercial/navegacao";
import { SEM_FILTRO, quadroDoHoje } from "@/lib/operacao/hoje";
import type { NovaTentativa } from "@/lib/operacao/leitura";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { rotuloDoBotao } from "@/test/botoes";
import { textosForaDaLista } from "@/test/textos";

import { CampoHojeView } from "./campo/hoje-view";
import { ContratosView } from "./comercial/contratos-view";
import { EmissoesView } from "./financeiro/emissoes-view";
import { HojeView } from "./operacao/hoje-view";
import { PessoasView } from "./rh/pessoas-view";
import { TvView } from "./tv/tv-view";

/**
 * A espera dos seis módulos (carregamento v2, parte 13g; necessidades 2, 3 e
 * 10), com o relógio de verdade: nada antes dos 300 ms (o "Carregando..." de
 * antes saía na hora, solto, e o "Vigentes 0" dizia zero antes de ler); aos
 * 300 ms, a caixa chanfrada decorativa e o que se lê no gerúndio, sem região
 * viva solta; na falha, o "Tentar de novo" assina a leitura de novo (antes
 * não havia saída). Dados sintéticos.
 */

const HOJE = "2026-10-23";
const AGORA = new Date("2026-10-23T17:20:00.000Z");
const noop = () => undefined;

type Tela = {
  modulo: string;
  /** O que se lê no gerúndio, aos 300 ms. */
  lendo: string;
  /** A falha da leitura, com o "Tentar de novo". */
  falha: string;
  /** Os textos que a tela pode ter enquanto lê (a lista contra legenda). */
  textos: Array<string | RegExp>;
  montar: (estado: "carregando" | "erro", leitura: NovaTentativa) => ReactElement;
};

const quadroVazio = () =>
  quadroDoHoje({ hoje: HOJE, agora: AGORA, demandas: [], ordens: [], nomesClientes: {}, nomesPessoas: {}, placas: {}, filtros: SEM_FILTRO, busca: "" });

const TELAS: Tela[] = [
  {
    modulo: "Comercial › Contratos",
    lendo: "Carregando os contratos…",
    falha: "Não foi possível carregar os contratos.",
    textos: ["Contratos", "Vigentes", "Encerrados", "Novo contrato", "Nenhum contrato selecionado"],
    montar: (estado, leitura) => (
      <Router ssrPath="/comercial/contratos">
        <ContratosView
          estado={estado}
          contratos={[]}
          clientes={[]}
          hoje={HOJE}
          filtro="vigentes"
          onFiltro={noop}
          selecionado={null}
          onSelecionar={noop}
          tabelas="carregando"
          aditivos="carregando"
          ocupado={false}
          leitura={leitura}
          acoes={{ novoContrato: noop, editar: noop, registrarAditivo: noop, adicionarTabela: noop }}
          telas={TELAS_DO_COMERCIAL}
        />
      </Router>
    ),
  },
  {
    modulo: "Operação › Hoje",
    lendo: "Carregando o Hoje…",
    falha: "Não foi possível carregar o Hoje.",
    textos: [
      "Hoje",
      "Nova demanda",
      "Buscar OS, demanda ou cliente",
      "Tipo",
      "Todos os tipos",
      "Paraquedas",
      "Emergencial",
      "Planejada",
      "Entrada",
      "Todas as entradas",
      "Comercial",
      "Direta",
      "Armazenagem",
      "Cliente",
      "Todos os clientes",
      "Equipe",
      "Toda a equipe",
    ],
    montar: (estado, leitura) => (
      <Router ssrPath="/operacao/hoje">
        <HojeView
          estado={estado}
          resumo=""
          quadro={quadroVazio()}
          filtros={SEM_FILTRO}
          opcoes={{ clientes: [], pessoas: [] }}
          busca=""
          onBusca={noop}
          onFiltros={noop}
          onEscalar={noop}
          erro={null}
          escala={null}
          leitura={leitura}
        />
      </Router>
    ),
  },
  {
    modulo: "Campo › Minhas OS",
    lendo: "Carregando suas OS…",
    falha: "Não foi possível carregar suas OS.",
    textos: ["Sexta, 23 de outubro", "Olá, Carlos"],
    montar: (estado, leitura) => {
      const { dia, ola } = saudacao("Carlos Silva", HOJE);
      return (
        <Router ssrPath="/campo">
          <CampoHojeView estado={estado} dia={dia} ola={ola} lista={minhasOs([], HOJE)} leitura={leitura} />
        </Router>
      );
    },
  },
  {
    modulo: "Financeiro › Emissões",
    lendo: "Carregando as emissões…",
    falha: "Não foi possível carregar as emissões.",
    textos: ["Emissões"],
    montar: (estado, leitura) => (
      <EmissoesView
        estado={estado}
        emissoes={[]}
        baixas={[]}
        desistindo={null}
        dispensando={null}
        ocupado={false}
        aviso={null}
        falha={null}
        leitura={leitura}
        acoes={{ pedir: noop, confirmarDesistencia: noop, desistirDeDesistir: noop, pedirNaBaixa: noop, confirmarDispensa: noop, desistirDeDispensar: noop }}
      />
    ),
  },
  {
    modulo: "RH › Pessoas",
    lendo: "Carregando as pessoas…",
    falha: "Não foi possível carregar as pessoas.",
    textos: ["Pessoas", "Ativas", "Buscar pessoa"],
    montar: (estado, leitura) => (
      <Router ssrPath="/rh/pessoas">
        <PessoasView estado={estado} colaboradores={[]} busca="" onBusca={noop} leitura={leitura} />
      </Router>
    ),
  },
];

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
  container.remove();
  vi.unstubAllGlobals();
});

const espera = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ate(condicao: () => boolean, limiteMs = 3_000) {
  const fim = Date.now() + limiteMs;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error(`A tela não chegou ao estado esperado em ${limiteMs / 1000} s.`);
    await act(async () => {
      await espera(20);
    });
  }
}

function montar(elemento: ReactElement) {
  act(() => raiz!.render(elemento));
}

/** Os números soltos da tela, cada um num elemento só dele: as contagens. */
function contagens(): string[] {
  return [...container.querySelectorAll("*")]
    .filter((elemento) => elemento.children.length === 0 && /^\d+$/.test(elemento.textContent!.trim()))
    .map((elemento) => elemento.textContent!.trim());
}

const SEM_TENTATIVA: NovaTentativa = { tentando: false, tentar: noop };

describe.each(TELAS)("$modulo lendo e na falha", (tela) => {
  it("lendo: nada antes dos 300 ms, nem o zero nem o vazio; depois, a caixa decorativa e o gerúndio, sem região viva solta", async () => {
    const inicio = performance.now();
    montar(tela.montar("carregando", SEM_TENTATIVA));
    if (performance.now() - inicio < 250) {
      expect(container.textContent).not.toContain("Carregando");
    }
    expect(container.textContent).not.toMatch(/Nenhum|Nenhuma/);
    // Nenhuma contagem antes de ler (o "Vigentes 0", o "Ativas 0").
    expect(contagens()).toEqual([]);
    await ate(() => container.textContent!.includes(tela.lendo));
    const regiao = container.querySelector("[data-carregando-na-regiao]")!;
    expect(regiao.textContent).toContain(tela.lendo);
    const indicador = regiao.querySelector("[data-spinner]");
    expect(indicador?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector('[role="status"], [aria-live]')).toBeNull();
    expect(textosForaDaLista(container.innerHTML, [...tela.textos, tela.lendo])).toEqual([]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("na falha, o Tentar de novo assina a leitura de novo", async () => {
    const tentar = vi.fn();
    montar(tela.montar("erro", { tentando: false, tentar }));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(tela.falha);
    const botao = [...container.querySelectorAll("button")].find((item) => rotuloDoBotao(item) === "Tentar de novo");
    expect(botao, "Tentar de novo").toBeDefined();
    expect(botao!.hasAttribute("disabled")).toBe(false);
    act(() => botao!.click());
    expect(tentar).toHaveBeenCalledTimes(1);
    expect(textosForaDaLista(container.innerHTML, [...tela.textos, tela.falha, "Tentar de novo", "Tentando de novo…", "—"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });
});

describe("TV da sala lendo", () => {
  it("aos 300 ms, a caixa de 40 px decorativa e Carregando o quadro…, sem região viva solta", async () => {
    montar(<TvView estado="carregando" painel={null} agora={AGORA} atualizadoEm={null} semConexao={false} porColuna={5} basePath="" />);
    await ate(() => container.textContent!.includes("Carregando o quadro…"));
    const indicador = container.querySelector("[data-spinner]");
    expect(indicador?.getAttribute("aria-hidden")).toBe("true");
    expect(indicador?.getAttribute("data-tamanho")).toBe("40");
    expect(container.querySelector('[role="status"], [aria-live]')).toBeNull();
    expect(container.textContent).not.toContain("Não foi possível");
  });
});
