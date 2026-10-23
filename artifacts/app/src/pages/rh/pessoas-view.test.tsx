import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { painelLido } from "@/lib/rh/ficha";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { PessoasView, type EstadoDaTela } from "./pessoas-view";

/** Pessoas (parte 8.2c): quem está ativo, com a ficha resumida. Sem legenda. Dados sintéticos. */

const PAINEL = painelLido({
  hoje: "2026-10-23",
  colaboradores: [
    { id: "col_aaaaaaaaaaaaaaaa", nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", ativo: true, registros: 3, vencendo: 1, vencidos: 1, proximo_vencimento: "2026-10-01" },
    { id: "col_bbbbbbbbbbbbbbbb", nome: "Bruno Lima", funcao: "Motorista", vinculo: "terceiro", ativo: true, registros: 1, vencendo: 2, vencidos: 0, proximo_vencimento: "2026-10-28" },
    { id: "col_cccccccccccccccc", nome: "Carla Dias", funcao: "Ajudante", vinculo: "freelancer", ativo: true, registros: 0, vencendo: 0, vencidos: 0, proximo_vencimento: null },
  ],
  vencimentos: [],
})!;

function render(estado: EstadoDaTela = "pronto", busca = "", colaboradores = PAINEL.colaboradores) {
  return renderToStaticMarkup(
    <Router ssrPath="/rh/pessoas">
      <PessoasView estado={estado} colaboradores={colaboradores} busca={busca} onBusca={() => undefined} />
    </Router>,
  );
}

describe("Pessoas do RH", () => {
  it("cada pessoa ativa com a função, o vínculo, o próximo vencimento e as marcas da ficha", () => {
    expect(textosDaTela(render())).toEqual([
      "Pessoas",
      "Ativas",
      "3",
      "Ana Souza",
      "Montadora · Própria",
      "Próximo vencimento 01/10/2026",
      "1 vencido",
      "1 vencendo",
      "Bruno Lima",
      "Motorista · Terceiro",
      "Próximo vencimento 28/10/2026",
      "2 vencendo",
      "Carla Dias",
      "Ajudante · Freelancer",
      "Sem registro",
    ]);
    expect(render()).toContain('href="/rh/ficha?colaborador=col_aaaaaaaaaaaaaaaa"');
  });

  it("a busca filtra por nome ou função; o vazio é uma frase de dados", () => {
    expect(textosDaTela(render("pronto", "motor"))).toContain("Bruno Lima");
    expect(textosDaTela(render("pronto", "motor"))).not.toContain("Ana Souza");
    expect(textosDaTela(render("pronto", "zzz"))).toContain("Nenhuma pessoa encontrada");
    expect(textosDaTela(render("pronto", "", []))).toContain("Nenhuma pessoa ativa");
    expect(textosDaTela(render("erro"))).toContain("Não foi possível carregar as pessoas.");
  });

  it("só rótulos, dados e ações: nenhum texto fora da lista", () => {
    const permitidos = [
      "Pessoas",
      "Ativas",
      /^\d+$/,
      "Ana Souza",
      "Bruno Lima",
      "Carla Dias",
      /^[^·]+ · (Própria|Terceiro|Freelancer)$/,
      /^Próximo vencimento \d{2}\/\d{2}\/\d{4}$/,
      /^\d+ (vencidos?|vencendo)$/,
      "Sem registro",
      "Carregando...",
      "Nenhuma pessoa ativa",
      "Nenhuma pessoa encontrada",
      "Não foi possível carregar as pessoas.",
    ];
    for (const html of [render(), render("carregando"), render("erro"), render("pronto", "zzz")]) expect(textosForaDaLista(html, permitidos)).toEqual([]);
  });

  it("acessibilidade: WCAG 2.1 A e AA", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
  });
});
