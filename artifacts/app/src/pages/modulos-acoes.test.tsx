// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { emissoesLidas } from "@/lib/financeiro/emissoes";
import { andamentoInicial } from "@/lib/operacao/andamento";
import { fichaDaLeitura, type FichaDaOs } from "@/lib/operacao/ficha-da-os";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { botaoPeloRotulo, rotuloDoBotao, travado } from "@/test/botoes";

import { DevolverDialog } from "./comercial/devolver-dialog";
import { EmissoesView } from "./financeiro/emissoes-view";
import { AndamentoView } from "./operacao/andamento-view";
import { ColaboradoresView, fichaVaziaColaborador } from "./operacao/cadastro-view";
import { ExportacaoView } from "./rh/exportacao-view";

/**
 * A ação que grava nos outros módulos (carregamento v2, parte 13g;
 * necessidades 5 e 10). Antes, o botão só trocava o texto ("Salvando...", de
 * três pontos) e ficava `disabled`, e o foco caía no `body`; os outros botões
 * da tela também ficavam `disabled`, sem dizer qual linha gravava. Agora o
 * botão da ação é o `BotaoDeAcao`: o gerúndio na camada atual, `aria-busy` e
 * `aria-disabled`, nunca `disabled`, e o toque de novo não chama de novo; os
 * outros ficam travados por ela com `aria-disabled`. Dados sintéticos.
 */

const noop = () => undefined;
const AGORA = new Date("2026-10-22T17:20:00.000Z");

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

/**
 * O botão da ação em andamento: na hora, afundado e travado sem `disabled`
 * (o foco fica); aos 300 ms, o gerúndio na camada atual, com `aria-busy`, e o
 * rótulo do repouso na camada escondida.
 */
async function emAndamento(rotulo: string, gerundio: string, onde: ParentNode = container) {
  const botao = [...onde.querySelectorAll<HTMLButtonElement>('button[data-estado="andamento"]')].find(
    (item) => item.querySelector('.botao-acao-camada[data-camada="repouso"]')?.textContent?.trim() === rotulo,
  );
  expect(botao, `${rotulo} em andamento`).toBeDefined();
  expect(botao!.getAttribute("aria-disabled")).toBe("true");
  expect(botao!.hasAttribute("disabled")).toBe(false);
  await ate(() => rotuloDoBotao(botao!) === gerundio);
  expect(botao!.getAttribute("aria-busy")).toBe("true");
  expect(botao!.getAttribute("aria-disabled")).toBe("true");
  expect(botao!.hasAttribute("disabled")).toBe(false);
  expect(botao!.querySelector('.botao-acao-camada[data-camada="repouso"]')?.getAttribute("aria-hidden")).toBe("true");
  expect(botao!.querySelector("[data-spinner]")?.getAttribute("aria-hidden")).toBe("true");
  return botao!;
}

describe("a ação que grava, nos seis módulos", () => {
  it("Operação › Colaboradores: Salvar diz Salvando…, sem disabled", async () => {
    montar(
      <ColaboradoresView
        estado="pronto"
        itens={[]}
        busca=""
        onBusca={noop}
        ficha={fichaVaziaColaborador()}
        editando={null}
        onFicha={noop}
        onNovo={noop}
        onAbrir={noop}
        onFechar={noop}
        onSalvar={noop}
        onAtivo={noop}
        ocupado
        emAndamento="salvar"
        erro={null}
      />,
    );
    await emAndamento("Salvar", "Salvando…");
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("Operação › Registrar andamento: Registrar diz Registrando…, sem disabled", async () => {
    const ficha = fichaDaLeitura("10045-01", {
      status: "em_execucao",
      edicao: 9,
      demanda: "10045",
      customer_code: "ITAU",
      janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
      equipe: [{ colaborador_id: "col_cccccccccccccccc", nome: "Carlos Silva", papel: "lider", vinculo: "proprio" }],
      itens: [{ id: "ln_1", item: "Cadeira Flexform", unidade: "UN", planejado: "150" }],
      etapas: [],
    }) as FichaDaOs;
    montar(
      <AndamentoView
        ficha={ficha}
        form={andamentoInicial(ficha, AGORA)}
        onForm={noop}
        problemas={[]}
        erro={null}
        ocupado
        fotos={[]}
        onFotos={noop}
        onTirarFoto={noop}
        anexos={{ fotosDoFinal: [], assinatura: null, onFotosDoFinal: noop, onTirarFotoDoFinal: noop, onAssinatura: noop }}
        onCancelar={noop}
        onRegistrar={noop}
      />,
    );
    await emAndamento("Registrar", "Registrando…");
  });

  it("Financeiro › Emissões: a linha que grava diz Retomando…; as outras ficam travadas por ela, sem disabled", async () => {
    const [base, outra] =
      emissoesLidas({
        emissoes: ["Itaú Unibanco", "Banco Safra"].map((nome, indice) => ({
          id: `nfe_${String(indice + 1).padStart(20, "0")}`,
          customer_code: indice ? "SAFRA" : "ITAU",
          customer_name: nome,
          etapa: "rejeitada",
          motivo_da_parada: null,
          mensagem: "Código de serviço inválido.",
          mensagens_da_prefeitura: [],
          demandas: ["10045"],
          armazenagem: [],
          total_cents: 100_000,
          vencimento: "2026-11-20",
          nfse: null,
          url_nfse: null,
          url_pdf: null,
          criada_em: "2026-10-23T12:00:00.000Z",
          edicao: 2,
        })),
      }) ?? [];
    montar(
      <EmissoesView
        estado="pronto"
        emissoes={[base!, outra!]}
        baixas={[]}
        desistindo={null}
        dispensando={null}
        ocupado
        emAndamento={`${base!.id}:retomar`}
        aviso={null}
        falha={null}
        acoes={{ pedir: noop, confirmarDesistencia: noop, desistirDeDesistir: noop, pedirNaBaixa: noop, confirmarDispensa: noop, desistirDeDispensar: noop }}
      />,
    );
    const botoes = [...container.querySelectorAll("button")];
    const daLinha = botoes.find((botao) => botao.getAttribute("aria-label") === "Tentar de novo, Itaú Unibanco")!;
    await ate(() => rotuloDoBotao(daLinha) === "Retomando…");
    expect(daLinha.getAttribute("aria-busy")).toBe("true");
    expect(daLinha.hasAttribute("disabled")).toBe(false);
    // As outras ações esperam a que grava, com o foco possível.
    for (const botao of botoes.filter((item) => item !== daLinha)) {
      expect(travado(botao), botao.getAttribute("aria-label") ?? rotuloDoBotao(botao)).toBe(true);
      expect(botao.hasAttribute("disabled")).toBe(false);
      expect(botao.getAttribute("aria-busy")).toBeNull();
    }
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("RH › Exportação: Gerar exportação diz Gerando a exportação…", async () => {
    montar(
      <Router ssrPath="/rh/exportacao">
        <ExportacaoView
          estado="pronto"
          exportacoes={[]}
          grava
          semAdmissao={[]}
          hoje="2026-10-24"
          competencia="2026-09"
          ocupado
          emAndamento="gerar"
          aviso={null}
          falha={null}
          acoes={{ mudarCompetencia: noop, gerar: noop, baixar: noop } as never}
        />
      </Router>,
    );
    await emAndamento("Gerar exportação", "Gerando a exportação…");
  });
});

describe("o diálogo que grava, no Comercial", () => {
  it("Devolver diz Devolvendo…; o toque de novo não chama de novo e o Cancelar fica à vista", async () => {
    const onDevolver = vi.fn();
    montar(<DevolverDialog aberto ocupado notaObrigatoria={false} onCancelar={noop} onDevolver={onDevolver} />);
    const botao = await emAndamento("Devolver", "Devolvendo…", document.body);
    act(() => botao.click());
    expect(onDevolver).not.toHaveBeenCalled();
    const cancelar = botaoPeloRotulo(document.body, "Cancelar");
    expect(cancelar, "Cancelar").toBeDefined();
    expect(cancelar!.hasAttribute("disabled")).toBe(false);
  });
});
