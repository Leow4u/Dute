import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { linhasCompactas, pontosDeConferir } from "@/lib/comercial/aprovar";
import { linhasGravadas } from "@/lib/comercial/documento";

import { AprovarView, type AprovarViewProps, type CartaoDaAprovacao } from "./aprovar-view";

/**
 * Aprovar no celular (docs/mockups/ComAprovarCelular.dc.html), só a
 * apresentação: sem legenda, "Para aprovar · 1 de N" com anterior e próximo,
 * o cartão, o bloco Conferir, as linhas e o rodapé com uma ação principal
 * (Aprovar); depois da ação, a confirmação com Próximo.
 */

const LINHAS = linhasGravadas([
  { id: "ln_1", origem: "tabela", codigo: "1.01", item: "Estação de trabalho em L 1,40 m", servico: "Desmontagem", unidade: "UN", quantidade: "24", preco: "85", preco_tabela: "85", total_cents: 204_000 },
  { id: "ln_2", origem: "alterado", codigo: "5.02", item: "Transporte dedicado VUC até 2,5 t", servico: "Frete", unidade: "VG", quantidade: "3", preco: "980", preco_tabela: "860", motivo: "Espera de 2 h na doca do CEIC", total_cents: 294_000 },
  { id: "ln_3", origem: "ajuste", item: "Arredondamento combinado", descricao: "Arredondamento combinado", quantidade: "1", preco: "-500", motivo: "Combinado com a gerenciadora", total_cents: -50_000 },
]);

const CARTAO: CartaoDaAprovacao = {
  numero: "10045",
  rotulo: "10045 – RV01",
  tipo: "Proposta",
  etapa: "para_aprovar",
  titulo: "Mudança de layout · 12º andar",
  cliente: "Itaú Unibanco",
  para: "Renata Moura · Souza & Lopes",
  refCliente: "CE8977",
  local: "CEIC – Torre Olavo Setubal",
  orcou: "Guilherme · 20/10 16:40",
  total: "R$ 4.480,00",
  tabela: "LPU Itaú v2.0 · Comercial",
  dataBase: "14/10/2026",
  quantidadeDeLinhas: 3,
  pdfHref: "/comercial/orcamento/documento?numero=10045&rv=1&de=aprovar",
  orcamentoHref: "/comercial/orcamento?numero=10045",
};

const noop = () => undefined;

function props(overrides: Partial<AprovarViewProps> = {}): AprovarViewProps {
  return {
    estado: "pronto",
    posicao: { indice: 1, total: 3 },
    podeAnterior: false,
    podeProximo: true,
    cartao: CARTAO,
    conferir: pontosDeConferir(LINHAS, []),
    linhas: linhasCompactas(LINHAS),
    confirmacao: null,
    parado: null,
    ocupado: false,
    aviso: null,
    handlers: { anterior: noop, proximo: noop, recarregar: noop, aprovar: noop, devolver: noop, aprovarEEnviar: noop },
    ...overrides,
  };
}

function render(overrides: Partial<AprovarViewProps> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/comercial/aprovar">
      <AprovarView {...props(overrides)} />
    </Router>,
  );
}

/** Textos visíveis, na ordem: o que a pessoa lê na tela. */
function texts(html: string) {
  return html
    .split(/<[^>]+>/)
    .map((text) => text.replace(/&amp;/g, "&").replace(/ /g, " ").trim())
    .filter(Boolean);
}

describe("aprovar no celular", () => {
  it("sem legenda: cabeçalho, cartão, Conferir, linhas e rodapé só têm rótulos, dados e ações", () => {
    expect(texts(render())).toEqual([
      "Para aprovar",
      "1 de 3",
      "10045 – RV01",
      "Proposta",
      "Para aprovar",
      "Mudança de layout · 12º andar",
      "Cliente",
      "Itaú Unibanco",
      "Para",
      "Renata Moura · Souza & Lopes",
      "Ref.",
      "CE8977",
      "Local",
      "CEIC – Torre Olavo Setubal",
      "Orçou",
      "Guilherme · 20/10 16:40",
      "Total",
      "R$ 4.480,00",
      "PDF",
      "LPU Itaú v2.0 · Comercial",
      "Data-base 14/10/2026",
      "3 linhas",
      "Conferir",
      "2",
      "Alterado",
      "Transporte dedicado VUC até 2,5 t · Frete",
      "R$ 980,00",
      "R$ 860,00",
      "tabela",
      "Motivo",
      "Espera de 2 h na doca do CEIC",
      "Ajuste",
      "Arredondamento combinado",
      "-R$ 500,00",
      "Motivo",
      "Combinado com a gerenciadora",
      "Linhas",
      "3",
      "Abrir orçamento",
      "Estação de trabalho em L 1,40 m · Desmontagem",
      "24 UN",
      "R$ 2.040,00",
      "Transporte dedicado VUC até 2,5 t · Frete",
      "3 VG",
      "Alterado",
      "R$ 2.940,00",
      "R$ 2.580,00",
      "Arredondamento combinado",
      "Ajuste",
      "-R$ 500,00",
      "Total",
      "R$ 4.480,00",
      "Devolver",
      "Aprovar",
      "Aprovar e enviar",
    ]);
  });

  it("identidade v3 e uma ação principal só: Aprovar, no rodapé que fica à vista", () => {
    const html = render();
    expect(html).toMatch(/^<div class="v3 /);
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
    expect(html).toMatch(/bg-primary text-primary-foreground[^"]*"[^>]*>.*?Aprovar<\/button>/);
    expect(html).toMatch(/<footer class="sticky bottom-0/);
  });

  it("o preço da tabela riscado ao lado do alterado, no Conferir e na linha", () => {
    const html = render();
    expect(html).toMatch(/<s class="[^"]*">R\$\s860,00<\/s>/);
    expect(html).toMatch(/<s class="[^"]*">R\$\s2.580,00<\/s>/);
  });

  it("anterior e próximo seguem a posição na fila", () => {
    const primeiro = render();
    expect(primeiro).toMatch(/<button[^>]*aria-label="Anterior"[^>]*disabled=""/);
    expect(primeiro).not.toMatch(/<button[^>]*aria-label="Próximo"[^>]*disabled=""/);
    const ultimo = render({ posicao: { indice: 3, total: 3 }, podeAnterior: true, podeProximo: false });
    expect(texts(ultimo)).toContain("3 de 3");
    expect(ultimo).not.toMatch(/<button[^>]*aria-label="Anterior"[^>]*disabled=""/);
    expect(ultimo).toMatch(/<button[^>]*aria-label="Próximo"[^>]*disabled=""/);
  });

  it("o PDF (a prévia, que volta à aprovação) e o orçamento abrem pelos links do cartão", () => {
    const html = render();
    expect(html).toContain('href="/comercial/orcamento/documento?numero=10045&amp;rv=1&amp;de=aprovar"');
    expect(html).toContain('href="/comercial/orcamento?numero=10045"');
  });

  it("orçamento todo de tabela: sem o bloco Conferir", () => {
    const lista = texts(render({ conferir: [] }));
    expect(lista).not.toContain("Conferir");
    expect(lista).toContain("Linhas");
  });

  it("depois da ação: a confirmação e Próximo, sem Aprovar nem Devolver", () => {
    const html = render({ confirmacao: "Aprovado 17:05", cartao: { ...CARTAO, etapa: "para_enviar" } });
    const lista = texts(html);
    expect(lista.slice(-2)).toEqual(["Aprovado 17:05", "Próximo"]);
    expect(lista).toContain("Para enviar");
    for (const acao of ["Aprovar", "Devolver", "Aprovar e enviar"]) expect(lista).not.toContain(acao);
    expect(html).toContain('role="status"');
  });

  it("o orçamento da tela saiu da fila: o cartão fica, o aviso e Próximo; nada que grave", () => {
    const html = render({ parado: { texto: "O orçamento 10045 – RV01 saiu da fila", acao: "proximo" } });
    const lista = texts(html);
    expect(lista.slice(0, 3)).toEqual(["Para aprovar", "1 de 3", "10045 – RV01"]);
    expect(lista.slice(-2)).toEqual(["O orçamento 10045 – RV01 saiu da fila", "Próximo"]);
    for (const acao of ["Aprovar", "Devolver", "Aprovar e enviar"]) expect(lista).not.toContain(acao);
    expect(html).not.toContain("bg-primary text-primary-foreground");
    expect(html).toContain('role="status"');
  });

  it("o orçamento da tela mudou (editado e mandado de novo): Recarregar, sem Aprovar", () => {
    const lista = texts(render({ parado: { texto: "O orçamento 10045 – RV01 mudou", acao: "recarregar" } }));
    expect(lista.slice(-2)).toEqual(["O orçamento 10045 – RV01 mudou", "Recarregar"]);
    for (const acao of ["Aprovar", "Devolver", "Aprovar e enviar"]) expect(lista).not.toContain(acao);
  });

  it("o link para um orçamento fora da fila: o aviso no lugar do cartão, e o Próximo leva à fila", () => {
    const html = render({
      cartao: null,
      conferir: [],
      linhas: [],
      posicao: { indice: 0, total: 3 },
      parado: { texto: "O orçamento 99999 não está para aprovar", acao: "proximo" },
    });
    expect(texts(html)).toEqual(["Para aprovar", "O orçamento 99999 não está para aprovar"]);
    expect(html).not.toMatch(/<button[^>]*aria-label="Próximo"[^>]*disabled=""/);
    expect(html).not.toContain("<footer");
  });

  it("gravando: nenhuma ação do rodapé responde", () => {
    const html = render({ ocupado: true });
    for (const acao of ["Devolver", "Aprovar", "Aprovar e enviar"]) {
      expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>(?:<svg[^>]*>.*?</svg>)?${acao}</button>`));
    }
  });

  it("erro do servidor aparece em alerta", () => {
    expect(render({ aviso: "O orçamento 10045 mudou: está em rascunho, não para aprovar. Abra de novo." })).toContain('role="alert"');
  });

  it("carregando, vazio e erro não se confundem", () => {
    expect(texts(render({ estado: "carregando", cartao: null, posicao: { indice: 0, total: 0 } }))).toContain("Carregando...");
    expect(texts(render({ estado: "vazio", cartao: null, posicao: { indice: 0, total: 0 } }))).toEqual([
      "Para aprovar",
      "Nenhum orçamento para aprovar",
    ]);
    expect(texts(render({ estado: "erro", cartao: null, posicao: { indice: 0, total: 0 } }))).toContain(
      "Não foi possível carregar os orçamentos.",
    );
  });
});
