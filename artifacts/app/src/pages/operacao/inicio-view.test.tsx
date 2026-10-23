import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import type { ColaboradorDaLista, VeiculoDaLista } from "@/lib/operacao/cadastro";
import type { OsDaFila } from "@/lib/operacao/fila";
import { equipeDeHoje, hojeNaOperacao, pendenciasDaOperacao, type EntradaDoInicio } from "@/lib/operacao/pendencias";
import type { InicioDaOperacao } from "@/lib/operacao/use-inicio";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { InicioDaOperacaoView } from "./inicio-view";

/**
 * Início da Operação (parte 2.6, docs/mockups/ModOpInicio.dc.html): o que
 * espera a coordenação, o dia e a equipe. Sem legenda e sem valores.
 */

const AGORA = new Date(2026, 9, 23, 9, 0);
const HOJE = "2026-10-23";

const pessoa = (id: string, nome: string, extra: Partial<ColaboradorDaLista> = {}): ColaboradorDaLista => ({
  id,
  edicao: 1,
  ativo: true,
  nome,
  funcao: "Motorista",
  cpf: "000.000.000-00",
  telefone: "",
  cnhCategoria: "",
  cnhValidade: "",
  cnh: null,
  vinculo: "proprio",
  empresa: "",
  papeis: [],
  usuarioEmail: "",
  noApp: false,
  ...extra,
});
const VAN: VeiculoDaLista = { id: "vei_van", edicao: 1, ativo: true, placa: "ABC1D23", tipo: "Van", modelo: "", capacidadeKg: "1500", capacidadeM3: "10", resumo: "", dono: "proprio", empresa: "", revisaoEm: "" };
const VELHO: VeiculoDaLista = { ...VAN, id: "vei_velho", placa: "XYZ9876", ativo: false };
const os = (numero: string, extra: Partial<OsDaFila>): OsDaFila => ({
  numero,
  demanda: numero.slice(0, 5),
  customer_code: "HORIZONTE",
  status: "agendada",
  edicao: 2,
  itens: [],
  agenda: null,
  demandaFora: null,
  ...extra,
});

const ENTRADA: EntradaDoInicio = {
  hoje: HOJE,
  ordens: [
    os("10045-01", { agenda: { data: HOJE, hora: "17:00", equipe: ["col_pedro"], fim: null, veiculos: ["vei_velho"] } }),
    os("10046-01", { agenda: { data: HOJE, hora: "08:30", equipe: ["col_joao"], fim: null, veiculos: ["vei_van"] } }),
    os("10050-01", { status: "aberta", edicao: 1, customer_code: "TECH" }),
  ],
  demandas: [{ numero: "10043", customer_code: "SOUZA", titulo: null, os_numeros: [] }],
  pessoas: [
    pessoa("col_pedro", "Pedro Nunes"),
    pessoa("col_joao", "João Pereira"),
    pessoa("col_marcos", "Marcos Andrade", { cnhCategoria: "D", cnhValidade: "2026-11-04" }),
  ],
  veiculos: [VAN, VELHO],
  nomesClientes: { HORIZONTE: "Construtora Horizonte", TECH: "TechPrime Escritórios", SOUZA: "Metalúrgica Souza" },
};

const PRONTO: InicioDaOperacao = {
  itens: pendenciasDaOperacao(ENTRADA),
  numeros: hojeNaOperacao(ENTRADA),
  equipe: equipeDeHoje(ENTRADA),
  carregando: false,
  falhas: [],
};

function render(inicio: Partial<InicioDaOperacao> = {}, nome = "Leonardo") {
  return renderToStaticMarkup(
    <Router ssrPath="/operacao">
      <InicioDaOperacaoView nome={nome} hoje={AGORA} inicio={{ ...PRONTO, ...inicio }} />
    </Router>,
  );
}

describe("Início da Operação", () => {
  it("data, saudação, o que precisa de você, o dia e a equipe, na ordem", () => {
    expect(textosDaTela(render())).toEqual([
      "Sexta-feira, 23 de outubro",
      "Bom dia, Leonardo",
      "4 coisas",
      "precisam de você na Operação.",
      "Precisa de você",
      "OS 10045-01 com veículo desativado",
      "Construtora Horizonte · 23/10/2026 17:00 · XYZ-9876",
      "Reagendar",
      "1 OS para agendar",
      "10050-01 · TechPrime Escritórios",
      "Agendar",
      "1 demanda para planejar",
      "10043 · Metalúrgica Souza",
      "Abrir OS",
      "CNH de Marcos Andrade vence em 12 dias",
      "Categoria D · validade 04/11/2026",
      "Ver cadastro",
      "Hoje na operação",
      "Agendadas hoje",
      "2",
      "Para agendar",
      "1",
      "Próximos dias",
      "0",
      "Abrir o Hoje",
      "Equipe hoje",
      "JP",
      "João Pereira",
      "10046-01 · 08:30",
      "PN",
      "Pedro Nunes",
      "10045-01 · 17:00",
      "MA",
      "Marcos Andrade",
      "livre",
    ]);
  });

  it("só rótulos, dados e ações: nenhum texto fora da lista, e nenhum valor", () => {
    const permitidos = [
      "Sexta-feira, 23 de outubro",
      "Bom dia, Leonardo",
      /^\d+ coisas?$/,
      /^precisam? de você na Operação\.$/,
      "Precisa de você",
      /^OS \d{5}-\d{2} com (veículo desativado|pessoa desativada|\d+ pessoas desativadas|pessoa e veículo desativados)$/,
      /^\d+ OS para agendar$/,
      /^\d+ demandas? para planejar$/,
      /^CNH de .+ (vence em \d+ dias?|vence hoje|vencida em \d{2}\/\d{2}\/\d{4})$/,
      /^Categoria [A-E]{1,2} · validade \d{2}\/\d{2}\/\d{4}( · escalado em \d+ OS( até lá)?)?$/,
      /^.+ · \d{2}\/\d{2}\/\d{4}( \d{2}:\d{2})? · .+$/,
      /^\d{5}(-\d{2})? · .+$/,
      "Reagendar",
      "Agendar",
      "Abrir OS",
      "Ver cadastro",
      "Hoje na operação",
      "Agendadas hoje",
      "Para agendar",
      "Próximos dias",
      "Abrir o Hoje",
      "Equipe hoje",
      /^[A-ZÀ-Ú]{1,2}$/,
      "João Pereira",
      "Pedro Nunes",
      "Marcos Andrade",
      /^\d{5}-\d{2}( · \d{2}:\d{2})?( \+\d+)?$/,
      "livre",
      /^\d+$/,
    ];
    const html = render();
    expect(textosForaDaLista(html, permitidos)).toEqual([]);
    expect(html).not.toMatch(/R\$|preço|valor/i);
  });

  it("a primeira ação é a principal e leva à OS; as outras, secundárias", () => {
    const html = render();
    const acoes = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*class="([^"]*)"[^>]*>(Reagendar|Agendar|Abrir OS|Ver cadastro)<\/a>/g)];
    expect(acoes.map(([, href, , rotulo]) => [rotulo, href])).toEqual([
      ["Reagendar", "/operacao/hoje?os=10045-01"],
      ["Agendar", "/operacao/hoje?os=10050-01"],
      ["Abrir OS", "/operacao/hoje"],
      ["Ver cadastro", "/operacao/colaboradores?id=col_marcos"],
    ]);
    expect(acoes[0][2]).toContain("bg-primary");
    for (const acao of acoes.slice(1)) expect(acao[2]).not.toContain("bg-primary");
  });

  it("nada parado: a frase diz, e o Precisa de você some", () => {
    const textos = textosDaTela(render({ itens: [] }));
    expect(textos).toContain("Nada parado na Operação.");
    expect(textos).not.toContain("Precisa de você");
  });

  it("sem colaborador ativo, a equipe diz que não há", () => {
    expect(textosDaTela(render({ equipe: [] }))).toContain("Nenhum colaborador ativo");
  });

  it("carregando não diz que não há nada; erro diz o que não carregou", () => {
    expect(textosDaTela(render({ itens: [], numeros: undefined, equipe: undefined, carregando: true }))).toEqual([
      "Sexta-feira, 23 de outubro",
      "Bom dia, Leonardo",
      "Precisa de você",
    ]);
    const erro = render({ itens: [], numeros: undefined, equipe: undefined, falhas: ["ordens de serviço"] });
    expect(erro).toMatch(/<p role="alert"[^>]*>Não foi possível carregar: ordens de serviço\.<\/p>/);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ itens: [], numeros: undefined, equipe: undefined, carregando: true }))).toEqual([]);
  });
});
