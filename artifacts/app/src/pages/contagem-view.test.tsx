import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import type { RegistroDaAberturaConcluida } from "@/lib/opening-inventory";
import type { RodadaDaContagem } from "@/lib/warehouse-ops/recontagem-por-caixa";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { ContagemView, ROTA_DA_ABERTURA, type EstadoDaEntrada } from "./contagem-view";

/**
 * Estoque › Contagem, a entrada (desenho de 18/11/2026,
 * docs/mockups/contagem-entrada/01-em-andamento.png): a contagem em andamento,
 * com o cartão da rodada e "Continuar", e "Anteriores" com a linha do
 * inventário de abertura. As prateleiras ficam dentro da Contagem por caixa.
 * Dados sintéticos.
 */

const AGORA = new Date("2026-11-18T14:30:00.000Z");
const RODADA: RodadaDaContagem = {
  rodada: "recontagem-geral-2026-11-17",
  titulo: "Recontagem geral · 17/11/2026",
  comeco: { quando: "2026-11-17T11:10:00.000Z", quem: "Guilherme Dantas" },
  prateleiras: 5,
  prateleirasContadas: 2,
  caixas: 6,
  caixasConfirmadas: 3,
  caixasComDiferenca: 1,
  diferenca: -3,
  ruas: [],
  continuar: "A-02",
  alcance: { tipo: "geral" },
  concluida: null,
};
const ABERTURA: RegistroDaAberturaConcluida = {
  titulo: "Inventário de abertura",
  quando: "20/10/2026 às 18:40 · Leonardo",
  numeros: "249 lançamentos · 7.314 unidades",
};
const CABECALHO = ["Contagem · BTG", "Folha de contagem", "Caixas × saldo"];
const CARTAO = [
  "Em andamento",
  "Recontagem geral · 17/11/2026",
  "começou 17/11 08:10 · Guilherme Dantas",
  "prateleiras",
  "2",
  "de 5",
  "caixas",
  "3",
  "de 6",
  "caixas com diferença",
  "1",
  "diferença líquida",
  "−3 un.",
];
const ANTERIORES = ["Anteriores", "Inventário de abertura", "20/10/2026 às 18:40 · Leonardo", "249 lançamentos · 7.314 unidades"];

function render(estado: EstadoDaEntrada = "pronto", extra: Partial<Parameters<typeof ContagemView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/wms/contagem">
      <ContagemView
        estado={estado}
        cliente="BTG"
        abertura={estado === "pronto" ? ABERTURA : null}
        rodada={estado === "pronto" ? RODADA : null}
        hrefDaFolha="/estoque/contagem/folha?rua=A"
        agora={AGORA}
        {...extra}
      />
    </Router>,
  );
}

describe("Estoque › Contagem, a entrada", () => {
  it("a entrada entra na v3, e a tela de hoje tem a rota própria", () => {
    expect(telaDoWmsNaV3("/wms/contagem")).toBe(true);
    expect(telaDoWmsNaV3(ROTA_DA_ABERTURA)).toBe(false);
    expect(ROTA_DA_ABERTURA).toBe("/wms/contagem/abertura");
  });

  it("só rótulos, dados e ações: o cartão em andamento com Continuar e Ver prateleiras, e a abertura em Anteriores", () => {
    expect(textosDaTela(render())).toEqual([...CABECALHO, ...CARTAO, "Continuar A-02", "Ver prateleiras", ...ANTERIORES]);
  });

  it("os links: Continuar leva à bancada, Ver prateleiras à Contagem por caixa, a folha e o Caixas × saldo às deles", () => {
    const dom = new JSDOM(`<!doctype html><body>${render()}</body>`);
    const links = [...dom.window.document.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]);
    expect(links).toEqual([
      ["Folha de contagem", "/estoque/contagem/folha?rua=A"],
      ["Caixas × saldo", "/estoque/contagem/caixas"],
      ["Continuar A-02", "/estoque/contagem/prateleira?posicao=A-02"],
      ["Ver prateleiras", "/estoque/contagem/rodada"],
    ]);
    dom.window.close();
  });

  it("tudo contado: o cartão sem Continuar, só Ver prateleiras", () => {
    const textos = textosDaTela(render("pronto", { rodada: { ...RODADA, continuar: null, prateleirasContadas: 5, caixasConfirmadas: 6 } }));
    expect(textos.some((texto) => texto.startsWith("Continuar"))).toBe(false);
    expect(textos).toContain("Ver prateleiras");
  });

  it("sem prateleira com caixa, nada em andamento; sem abertura registrada, nada em Anteriores", () => {
    const semCaixas = textosDaTela(render("pronto", { rodada: { ...RODADA, prateleiras: 0, prateleirasContadas: 0, caixas: 0, caixasConfirmadas: 0, caixasComDiferenca: 0, diferenca: 0, continuar: null } }));
    expect(semCaixas).toEqual([...CABECALHO, ...ANTERIORES]);
    const semAbertura = textosDaTela(render("pronto", { abertura: null }));
    expect(semAbertura).toEqual([...CABECALHO, ...CARTAO, "Continuar A-02", "Ver prateleiras"]);
  });

  it("carregando: a forma final com o esqueleto, e nenhum número antes de ler", async () => {
    const html = render("carregando");
    expect(textosDaTela(html)).toEqual(CABECALHO);
    expect(html).toContain("data-esqueleto");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a falha nunca vira o vazio: o aviso com Tentar de novo", async () => {
    const erro = new Error("falhou");
    const daLeitura = render("erro", { falha: { erro, leitura: { error: erro, refetch: async () => undefined } as never } });
    expect(textosDaTela(daLeitura)).toEqual([...CABECALHO, "Não consegui carregar as contagens.", "Tentar de novo"]);
    expect(await violacoesDeAcessibilidade(daLeitura)).toEqual([]);
    const aoVivo = render("erro", { aoVivo: { tentando: false, tentar: () => undefined, falta: "servidor", lidaEm: null } });
    expect(textosDaTela(aoVivo)).toEqual([...CABECALHO, "Não consegui carregar as contagens.", "Tentar de novo"]);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe, e não leva valor", async () => {
    const html = render();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    expect(html).not.toMatch(/R\$|custo|preço|valor/i);
  });
});
