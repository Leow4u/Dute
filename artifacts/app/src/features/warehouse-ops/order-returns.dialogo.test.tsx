// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ProvedorDaConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import { linhaDoRetorno, type LinhaDoRetorno } from "@/lib/warehouse-ops/retorno";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosDaTela } from "@/test/textos";

import { RetornosView } from "./order-returns";

/**
 * O diálogo "o que voltou" do retorno da Operação (parte 4.5d), sem legenda:
 * cada linha com o item e o tamanho ("Polo Masculino Piquet Preto · GG": o
 * nome é o mesmo em todos os tamanhos) e, embaixo, o código do cliente, o SKU
 * e o que saiu. Dados sintéticos.
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const RETORNO = { orderId: "ord_118", numero: "PED-0118", customerCode: "BTG Pactual", os: "10050-02", chegouEm: "2026-10-30T21:40:00.000Z" };
const noop = () => undefined;
const acoes = { abrir: noop, fechar: noop, mudarLinha: noop, mudarNotas: noop, receber: noop };

const LINHAS: LinhaDoRetorno[] = [
  linhaDoRetorno("oit_1", { sku_code: "BTG-000125", client_item_code: "A.01.0806.005.GG", product_name: "Polo Masculino Piquet Preto GG", picked_qty: 20 })!,
  linhaDoRetorno("oit_2", { sku_code: "BTG-000301", client_item_code: "C.0659.001.U", product_name: "Toalha de Academia", picked_qty: 3 })!,
  linhaDoRetorno("oit_3", { sku_code: "BTG-BAN-1", product_name: "Banner", allocated_qty: 6 })!,
];

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (raiz) await act(async () => raiz!.unmount());
  container?.remove();
  raiz = null;
  container = null;
});

async function abrir(aberto: Partial<NonNullable<Parameters<typeof RetornosView>[0]["aberto"]>> = {}, extra: Partial<Parameters<typeof RetornosView>[0]["acoes"]> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <RetornosView
        retornos={[RETORNO]}
        aberto={{ retorno: RETORNO, linhas: LINHAS, notas: "", problema: null, erro: null, enviando: false, ...aberto }}
        acoes={{ ...acoes, ...extra }}
      />,
    );
  });
  const dialogo = document.querySelector('[role="dialog"]');
  if (!dialogo) throw new Error("O diálogo não abriu.");
  return dialogo;
}

describe("o que voltou do pedido", () => {
  it("cada linha com o item e o tamanho e, embaixo, o código do cliente, o SKU e o que saiu", async () => {
    const dialogo = await abrir();
    expect(textosDaTela(dialogo.outerHTML)).toEqual([
      "PED-0118: o que voltou",
      "Polo Masculino Piquet Preto · GG",
      "A.01.0806.005.GG · BTG-000125 · saiu 20",
      "Voltou",
      "Toalha de Academia",
      "C.0659.001.U · BTG-000301 · saiu 3",
      "Banner",
      "BTG-BAN-1 · saiu 6",
      "Observação",
      "Voltar",
      "Receber",
      "Recebendo…",
      "Conferir",
      "Fechar",
    ]);
    expect(dialogo.textContent).not.toContain("· U");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    const dialogo = await abrir();
    expect(await violacoesDeAcessibilidade(dialogo.outerHTML)).toEqual([]);
  });
});

/**
 * As linhas do pedido que esperam e as que não vieram (carregamento v2, parte
 * 13c; diagnóstico, 4.5). Antes, as linhas que falhavam ficavam em
 * "Carregando..." para sempre, com o "Receber" travado.
 */
describe("as linhas do retorno que esperam e as que não vieram", () => {
  it("chegando: a espera em bloco, sem o \"Carregando...\" seco", async () => {
    const dialogo = await abrir({ linhas: null });
    expect(dialogo.textContent).not.toContain("Carregando...");
    expect(dialogo.querySelector("[data-carregando-na-regiao]")).not.toBeNull();
  });

  it("não vieram: o aviso com Tentar de novo, nunca a espera para sempre", async () => {
    const dialogo = await abrir({ linhas: null, linhasFalharam: true }, { tentarLinhas: async () => undefined });
    expect(dialogo.textContent).toContain("Não consegui carregar os itens do pedido.");
    expect(dialogo.querySelector('[role="alert"]')).not.toBeNull();
    expect([...dialogo.querySelectorAll("button")].some((botao) => botao.textContent?.includes("Tentar de novo"))).toBe(true);
    expect(dialogo.querySelector("[data-carregando-na-regiao]")).toBeNull();
    expect(await violacoesDeAcessibilidade(dialogo.outerHTML)).toEqual([]);
  });
});

/**
 * Os itens do pedido no diálogo, sem conexão (carregamento v2, parte 13l;
 * revisão da parte 13l, que pediu a trava dos textos e o axe dos estados da
 * falta). Sem nada lido e sem conexão, o aviso da conexão no lugar dos itens,
 * sem falar (o Anunciador diz "Sem conexão" uma vez); o erro do servidor, a
 * frase de antes, que é alerta. Só os rótulos da falta entram. Dados
 * sintéticos.
 */
describe("os itens do pedido no diálogo, sem conexão", () => {
  const CABECALHO = ["PED-0118: o que voltou", "Observação", "Voltar", "Receber", "Recebendo…", "Conferir", "Fechar"];

  async function abrirNa(conexao: EstadoDaConexao, falta: "conexao" | "servidor") {
    container = document.createElement("div");
    document.body.appendChild(container);
    raiz = createRoot(container);
    await act(async () => {
      raiz!.render(
        <ProvedorDaConexao value={conexaoEm(conexao)}>
          <RetornosView
            retornos={[RETORNO]}
            aberto={{ retorno: RETORNO, linhas: null, linhasFalharam: true, faltaDasLinhas: falta, notas: "", problema: null, erro: null, enviando: false }}
            acoes={{ ...acoes, tentarLinhas: async () => undefined }}
          />
        </ProvedorDaConexao>,
      );
    });
    const dialogo = document.querySelector('[role="dialog"]');
    if (!dialogo) throw new Error("O diálogo não abriu.");
    return dialogo;
  }

  for (const [conexao, falta, aviso] of [
    ["sem-conexao", "conexao", "Sem conexão."],
    ["reconectando", "conexao", "Reconectando…"],
    ["conectado", "servidor", "Não consegui carregar os itens do pedido."],
  ] as const) {
    it(`${conexao}: ${aviso}`, async () => {
      const dialogo = await abrirNa(conexao, falta);
      const [titulo, ...resto] = CABECALHO;
      expect(textosDaTela(dialogo.outerHTML)).toEqual([titulo, aviso, "Tentar de novo", ...resto]);
      // Só o erro do servidor é alerta: a falta de conexão não fala (momento 8).
      expect(dialogo.querySelectorAll('[role="alert"]').length).toBe(falta === "servidor" ? 1 : 0);
      expect(await violacoesDeAcessibilidade(dialogo.outerHTML)).toEqual([]);
    });
  }
});
