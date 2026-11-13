// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProvedorDaConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import type { LeituraDaLista } from "@/lib/carregando/use-atualizar-lista";
import { SemResposta } from "@/lib/conexao";
import type { AlertaProposto } from "@/lib/memoria/alertas";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosDaTela } from "@/test/textos";

import { AlertasParadosView, type AlertasParadosViewProps } from "./estoque-alertas-view";

/**
 * Estoque › Alertas (parte 5.4e): o alerta do item parado para a coordenação
 * aprovar. Um alerta por vez, com os itens para escolher; uma ação principal.
 */

const ITAU: AlertaProposto = {
  id: "alerta_0123456789abcdef01234567",
  customerCode: "ITAU",
  regra: { parado_dias: 90, sem_giro_dias: 180 },
  itens: [
    { skuCode: "ITAU-000001", clientItemCode: "POLO-M", productName: "Camisa polo", saldo: 30, ultimaMovimentacao: "2026-04-03T15:00:00.000Z", diasParado: 200 },
    { skuCode: "ITAU-000002", clientItemCode: null, productName: null, saldo: 4, ultimaMovimentacao: "2026-07-12T15:00:00.000Z", diasParado: 100 },
  ],
};
const SAFRA: AlertaProposto = { ...ITAU, id: "alerta_fedcba9876543210fedcba98", customerCode: "SAFRA", itens: ITAU.itens.slice(0, 1) };

const nomes: Record<string, string> = { ITAU: "Itaú Unibanco", SAFRA: "Banco Safra" };

function elemento(props: Partial<AlertasParadosViewProps> = {}) {
  return (
    <div className="v3">
      <AlertasParadosView
        estado="pronto"
        alertas={[ITAU]}
        alerta={ITAU}
        nomeDoCliente={(codigo) => nomes[codigo] ?? codigo}
        marcados={new Set(["ITAU-000001", "ITAU-000002"])}
        ocupado={false}
        erro={null}
        acoes={{ escolher: () => undefined, marcar: () => undefined, marcarTodos: () => undefined, enviar: () => undefined, descartar: () => undefined }}
        {...props}
      />
    </div>
  );
}

function tela(props: Partial<AlertasParadosViewProps> = {}) {
  return renderToStaticMarkup(elemento(props));
}

function documento(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

/** O botão pelo rótulo do repouso (o BotaoDeAcao empilha as camadas). */
function botaoDe(html: string, rotulo: string): HTMLButtonElement {
  const achado = Array.from(documento(html).querySelectorAll("button")).find((botao) => {
    const repouso = botao.querySelector('[data-camada="repouso"]') ?? botao;
    return repouso.textContent?.trim() === rotulo;
  });
  if (!achado) throw new Error(`Sem o botão ${rotulo}`);
  return achado as HTMLButtonElement;
}

const marcasDe = (html: string) => Array.from(documento(html).querySelectorAll('[role="checkbox"]'));

// 13:42 UTC são 10:42 no armazém.
const LEITURA: LeituraDaLista = {
  isLoading: false,
  isFetching: false,
  isError: false,
  error: null,
  dataUpdatedAt: Date.parse("2026-11-06T13:42:00Z"),
  refetch: async () => ({}) as never,
};

describe("Estoque › Alertas na v3", () => {
  it("a tela está na lista da v3", () => {
    expect(telaDoWmsNaV3("/estoque/alertas")).toBe(true);
  });

  it("o alerta do cliente com os itens, os dias e as duas ações", () => {
    expect(textosDaTela(tela())).toEqual([
      "Alertas de itens parados",
      "Itaú Unibanco",
      "2 itens parados",
      "Parado 90+ dias",
      "Itens do alerta",
      "Item",
      "Saldo",
      "Último movimento",
      "Sem movimento",
      "POLO-M",
      "Camisa polo",
      "30",
      "03/04/2026",
      "200 dias",
      "ITAU-000002",
      "4",
      "12/07/2026",
      "100 dias",
      "Enviar ao cliente",
      "Enviando…",
      "Conferir",
      "Descartar",
      "Descartando…",
    ]);
  });

  it("uma ação principal; sem item marcado ela espera; enquanto grava, tudo espera", () => {
    const html = tela();
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
    expect(botaoDe(html, "Enviar ao cliente").className).toContain("bg-primary text-primary-foreground");
    // Sem item marcado, o Enviar espera: aria-disabled, nunca disabled (carregamento v2, seção 7).
    const semMarcado = botaoDe(tela({ marcados: new Set() }), "Enviar ao cliente");
    expect(semMarcado.getAttribute("aria-disabled")).toBe("true");
    expect(semMarcado.hasAttribute("disabled")).toBe(false);
  });

  it("enviando: o Enviar no BotaoDeAcao (\"Enviando…\"), o Descartar e as marcas travados sem disabled (parte 13b)", () => {
    const enviando = tela({ ocupado: true, decidindo: "aprovar" });
    expect(enviando).not.toContain("Gravando...");
    expect(enviando).not.toMatch(/disabled=""/);
    const enviar = botaoDe(enviando, "Enviar ao cliente");
    expect(enviar.getAttribute("data-estado")).toBe("andamento");
    expect(enviar.getAttribute("aria-disabled")).toBe("true");
    expect(enviar.textContent).toContain("Enviando…");
    const descartar = botaoDe(enviando, "Descartar");
    expect(descartar.getAttribute("data-estado")).toBe("repouso");
    expect(descartar.getAttribute("aria-disabled")).toBe("true");
    const marcas = marcasDe(enviando);
    expect(marcas.length).toBe(3);
    for (const marca of marcas) expect(marca.getAttribute("aria-disabled")).toBe("true");

    const descartando = tela({ ocupado: true, decidindo: "descartar" });
    expect(botaoDe(descartando, "Descartar").getAttribute("data-estado")).toBe("andamento");
    expect(botaoDe(descartando, "Descartar").textContent).toContain("Descartando…");
    expect(botaoDe(descartando, "Enviar ao cliente").getAttribute("data-estado")).toBe("repouso");
  });

  it("com mais de um cliente, a escolha do cliente com a contagem", () => {
    expect(textosDaTela(tela({ alertas: [SAFRA, ITAU] })).slice(0, 4)).toEqual(["Alertas de itens parados", "Banco Safra", "1", "Itaú Unibanco"]);
  });

  it("sem alerta, carregando, com erro e com erro da decisão", () => {
    expect(textosDaTela(tela({ alertas: [], alerta: null }))).toEqual(["Alertas de itens parados", "Nenhum alerta para aprovar."]);
    // Carregando: nada no lugar da lista, e a linha de estado só fala depois de 300 ms (parte 7b).
    expect(textosDaTela(tela({ estado: "carregando", leitura: [{ ...LEITURA, isLoading: true, isFetching: true, dataUpdatedAt: 0 }] }))).toEqual([
      "Alertas de itens parados",
    ]);
    // A falha nunca vira vazio e tem a nova tentativa (parte 13b).
    expect(textosDaTela(tela({ estado: "erro", tentar: { tentando: false, onTentar: () => undefined } }))).toEqual([
      "Alertas de itens parados",
      "Não consegui carregar os alertas.",
      "Tentar de novo",
    ]);
    expect(textosDaTela(tela({ erro: "O alerta já foi decidido." })).at(-1)).toBe("O alerta já foi decidido.");
  });

  it("a linha de estado sob o título diz de quando é a lista (parte 7b)", async () => {
    const html = tela({ leitura: [LEITURA] });
    expect(textosDaTela(html).slice(0, 3)).toEqual(["Alertas de itens parados", "Atualizado às 10:42", "Itaú Unibanco"]);
    expect(html).toContain('data-linha-de-estado=""');
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(tela())).toEqual([]);
    expect(await violacoesDeAcessibilidade(tela({ alertas: [SAFRA, ITAU] }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(tela({ ocupado: true, decidindo: "aprovar" }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(tela({ estado: "erro", tentar: { tentando: false, onTentar: () => undefined } }))).toEqual([]);
  });
});

/**
 * Na falta de conexão (docs/plataforma/diagnostico-carregamento.md, decisão 2
 * do celular, de 06/11/2026): "Sem conexão" só com o app sem conexão; com o
 * aparelho conectado e o servidor sem resposta, "Reconectando…" (carregamento
 * v2, parte 7a).
 */
describe("Estoque › Alertas sem conexão", () => {
  const tentar = { tentando: false, onTentar: () => undefined };
  // 13:42 UTC são 10:42 no armazém.
  const lidaEm = Date.parse("2026-11-06T13:42:00Z");
  const naConexao = (estado: EstadoDaConexao, props: Partial<AlertasParadosViewProps>) =>
    renderToStaticMarkup(<ProvedorDaConexao value={conexaoEm(estado)}>{elemento(props)}</ProvedorDaConexao>);

  // A leitura com a falta e a lista lida: a hora dela fica na linha de estado, sob o título (parte 7b).
  const comFalta = { leitura: [{ ...LEITURA, isError: true, error: new SemResposta(), dataUpdatedAt: lidaEm }], semConexao: { lidaEm, ...tentar } };

  it("com a lista lida: o alerta fica, com a hora da leitura na linha de estado", () => {
    const textos = textosDaTela(naConexao("sem-conexao", comFalta));
    expect(textos.slice(0, 3)).toEqual(["Alertas de itens parados", "Sem conexão · lista de 10:42", "Tentar de novo"]);
    expect(textos).toContain("Itaú Unibanco");
    const reconectando = textosDaTela(naConexao("reconectando", comFalta));
    expect(reconectando.slice(0, 4)).toEqual(["Alertas de itens parados", "Reconectando…", "· lista de 10:42", "Tentar de novo"]);
    expect(reconectando).toContain("Itaú Unibanco");
  });

  it("sem nada lido: o aviso, nunca \"Nenhum alerta para aprovar\"", () => {
    const semNada = { alertas: [], alerta: null, semConexao: { lidaEm: null, ...tentar } };
    expect(textosDaTela(naConexao("sem-conexao", semNada))).toEqual(["Alertas de itens parados", "Sem conexão.", "Tentar de novo"]);
    expect(textosDaTela(naConexao("reconectando", semNada))).toEqual(["Alertas de itens parados", "Reconectando…", "Tentar de novo"]);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    for (const estado of ["sem-conexao", "reconectando"] as const) {
      expect(await violacoesDeAcessibilidade(naConexao(estado, comFalta)), estado).toEqual([]);
      expect(
        await violacoesDeAcessibilidade(naConexao(estado, { alertas: [], alerta: null, semConexao: { lidaEm: null, ...tentar } })),
        estado,
      ).toEqual([]);
    }
  });
});
