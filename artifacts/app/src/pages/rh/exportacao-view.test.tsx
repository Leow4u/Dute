import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { exportacoesLidas } from "@/lib/rh/exportacao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { ExportacaoView, type EstadoDaLista, type PropsDaExportacao } from "./exportacao-view";

/** Exportação do RH (parte 8.3): gerar e baixar a planilha da competência. Sem legenda. Dados sintéticos. */

const EXPORTACOES = exportacoesLidas({
  exportacoes: [
    { id: "exp_2026-10_v2", competencia: "2026-10", versao: 2, exames: 3, colaboradores: 12, gerada_em: "2026-10-24T15:00:00.000Z", gerada_por: "Pessoa rh" },
    { id: "exp_2026-09_v1", competencia: "2026-09", versao: 1, exames: 1, colaboradores: 1, gerada_em: "2026-10-02T02:00:00.000Z", gerada_por: "" },
  ],
})!;

const ACOES = { mudarCompetencia: () => undefined, gerar: () => undefined, baixar: () => undefined };

function render(extra: Partial<PropsDaExportacao> = {}, estado: EstadoDaLista = "pronto") {
  return renderToStaticMarkup(
    <ExportacaoView
      estado={estado}
      exportacoes={EXPORTACOES}
      grava
      hoje="2026-10-24"
      competencia="2026-09"
      ocupado={false}
      aviso={null}
      falha={null}
      acoes={ACOES}
      {...extra}
    />,
  );
}

describe("Exportação do RH", () => {
  it("o rh gera pela competência; cada versão com as contagens, quem gerou e as duas planilhas", () => {
    expect(textosDaTela(render())).toEqual([
      "Exportação",
      "Gerar",
      "Competência",
      "Gerar exportação",
      "Versões",
      "2",
      "Outubro de 2026 · versão 2",
      "3 exames · 12 colaboradores",
      "Gerada em 24/10/2026 por Pessoa rh",
      "Baixar exames",
      "Baixar colaboradores",
      "Setembro de 2026 · versão 1",
      "1 exame · 1 colaborador",
      // 02:00 UTC do dia 2 ainda é dia 1 em São Paulo.
      "Gerada em 01/10/2026",
    ]);
    const html = render();
    expect(html).toContain('type="month"');
    expect(html).toContain('max="2026-10"');
    expect(html).toContain('aria-label="Baixar exames, Outubro de 2026 · versão 2"');
  });

  it("owner e admin só baixam: sem o Gerar", () => {
    const textos = textosDaTela(render({ grava: false }));
    expect(textos).not.toContain("Gerar exportação");
    expect(textos).not.toContain("Competência");
    expect(textos).toContain("Baixar exames");
  });

  it("uma só ação primária: o Gerar exportação", () => {
    expect(render().match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
  });

  it("a competência fora do intervalo e a tela ocupada travam o Gerar", () => {
    expect(render({ competencia: "2026-11" })).toMatch(/<button[^>]*disabled=""[^>]*>Gerar exportação/);
    expect(render({ ocupado: true })).toMatch(/<button[^>]*disabled=""[^>]*>Gerar exportação/);
    expect(render()).not.toMatch(/<button[^>]*disabled=""[^>]*>Gerar exportação/);
  });

  it("o aviso da geração, a falha e os vazios são frases de dados", () => {
    expect(textosDaTela(render({ aviso: "Setembro de 2026: versão 1 gerada" }))).toContain("Setembro de 2026: versão 1 gerada");
    expect(render({ falha: "Só o RH grava no RH." })).toContain('role="alert"');
    expect(textosDaTela(render({ exportacoes: [] }))).toContain("Nenhuma exportação");
    expect(textosDaTela(render({}, "erro"))).toContain("Não foi possível carregar as exportações.");
    expect(textosDaTela(render({}, "carregando"))).toContain("Carregando...");
  });

  it("só rótulos, dados e ações: nenhum texto fora da lista", () => {
    const permitidos = [
      "Exportação",
      "Gerar",
      "Competência",
      "Gerar exportação",
      "Versões",
      /^\d+$/,
      /^[A-ZÇ][a-zç]+ de \d{4} · versão \d+$/,
      /^\d+ exames? · \d+ colaborador(es)?$/,
      /^Gerada em \d{2}\/\d{2}\/\d{4}( por .+)?$/,
      "Baixar exames",
      "Baixar colaboradores",
      /^[A-ZÇ][a-zç]+ de \d{4}: (versão \d+ gerada|nada mudou desde a versão \d+)$/,
      "Só o RH grava no RH.",
      "Carregando...",
      "Nenhuma exportação",
      "Não foi possível carregar as exportações.",
    ];
    for (const html of [
      render(),
      render({ grava: false }),
      render({ aviso: "Outubro de 2026: nada mudou desde a versão 2", falha: "Só o RH grava no RH." }),
      render({ exportacoes: [] }),
      render({}, "erro"),
      render({}, "carregando"),
    ]) {
      expect(textosForaDaLista(html, permitidos)).toEqual([]);
    }
  });

  it("acessibilidade: WCAG 2.1 A e AA", async () => {
    expect(await violacoesDeAcessibilidade(render({ aviso: "Setembro de 2026: versão 1 gerada" }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ grava: false }))).toEqual([]);
  });
});
