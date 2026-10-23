import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { agendaDaSemana, tituloDaSemana } from "@/lib/operacao/agenda";
import type { ColaboradorDaLista, VeiculoDaLista } from "@/lib/operacao/cadastro";
import type { OsDaFila } from "@/lib/operacao/fila";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { AgendaView } from "./agenda-view";

/** Operação › Agenda (parte 3.6b, docs/mockups/OpAgenda.dc.html). */

const noop = () => undefined;
const SEGUNDA = "2026-10-19";
const HOJE = "2026-10-20";

const PESSOAS = [
  { id: "col_cs", nome: "Carlos Silva", funcao: "Líder", vinculo: "proprio", empresa: "", papeis: ["lider"], noApp: true, ativo: true },
  { id: "col_al", nome: "Ana Lima", funcao: "Líder", vinculo: "proprio", empresa: "", papeis: ["lider"], noApp: false, ativo: true },
  { id: "col_da", nome: "Diego Alves", funcao: "Montador", vinculo: "freelancer", empresa: "", papeis: [], noApp: false, ativo: true },
] as ColaboradorDaLista[];

const VEICULOS = [{ id: "vei_def", placa: "DEF-4G56", tipo: "Baú", resumo: "", dono: "proprio", empresa: "", ativo: true }] as VeiculoDaLista[];

function os(numero: string, data: string, hora: string, fim: string | null, equipe: Array<[string, string]>, extra: Partial<OsDaFila> = {}): OsDaFila {
  return {
    numero,
    demanda: numero.slice(0, 5),
    customer_code: "ITAU",
    status: "agendada",
    edicao: 1,
    itens: [],
    agenda: { data, hora, fim, equipe: equipe.map(([id]) => id), veiculos: equipe.length ? ["vei_def"] : [] },
    pessoas: equipe.map(([id, nome]) => ({ id, nome, papel: "lider" })),
    placas: equipe.length ? ["DEF-4G56"] : [],
    ...extra,
  };
}

const ORDENS = [
  os("10045-01", HOJE, "07:30", "18:00", [["col_cs", "Carlos Silva"], ["col_da", "Diego Alves"]], { status: "em_execucao" }),
  os("10045-02", "2026-10-22", "19:00", "23:00", [["col_cs", "Carlos Silva"]]),
  os("10049-01", HOJE, "08:00", "12:40", [["col_al", "Ana Lima"]], { status: "em_revisao" }),
  os("10049-02", HOJE, "16:00", null, [["col_al", "Ana Lima"]]),
  os("10050-01", "2026-10-21", "15:00", null, []),
];

const AGENDA = agendaDaSemana({
  segunda: SEGUNDA,
  hoje: HOJE,
  ordens: ORDENS,
  pessoas: PESSOAS,
  veiculos: VEICULOS,
  nomesClientes: { ITAU: "Itaú Unibanco" },
  demandas: { "10050": { titulo: "Troca de cadeiras", tipo: "paraquedas" } },
  busca: "",
});

function render(extra: Partial<Parameters<typeof AgendaView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/operacao/agenda">
      <AgendaView
        estado="pronto"
        agenda={AGENDA}
        titulo={tituloDaSemana(AGENDA.dias)}
        semana={{ anterior: "/operacao/agenda?semana=2026-10-12", proxima: "/operacao/agenda?semana=2026-10-26", hoje: "/operacao/agenda", ehEstaSemana: true }}
        busca=""
        onBusca={noop}
        selecionada={null}
        onSelecionar={noop}
        onEscalar={noop}
        erro={null}
        escala={null}
        {...extra}
      />
    </Router>,
  );
}

describe("Agenda", () => {
  it("tem a semana, os dias com o resumo, as linhas por vínculo e veículo e as OS em cada dia", () => {
    const html = render();
    const textos = textosDaTela(html);
    for (const texto of [
      "Agenda",
      "Nova demanda",
      "19 a 24 de outubro",
      "Seg 19",
      "Ter 20",
      "Hoje",
      "Sáb 24",
      "3 OS",
      "1 em duas OS",
      "1 sem equipe",
      "Equipe própria",
      "Freelancers",
      "Veículos",
      "Carlos Silva",
      "Diego Alves",
      "DEF-4G56",
      "OS 10045-01",
      "Itaú Unibanco · 07:30–18:00",
      "OS 10049-02",
      "Itaú Unibanco · 16:00",
    ]) {
      expect(textos, texto).toContain(texto);
    }
    expect(html).toContain('aria-label="Semana anterior"');
    expect(html).toContain('href="/operacao/agenda?semana=2026-10-26"');
    expect(html).not.toContain("Dom 25");
    expect(html).not.toContain("R$");
    // A Ana em duas OS no mesmo dia: as duas na mesma célula.
    expect(html).toMatch(/Ana Lima[\s\S]*?OS 10049-01[\s\S]*?OS 10049-02[\s\S]*?<\/tr>/);
  });

  it("no celular, um dia embaixo do outro, com status, janela, equipe, placa e as ações", () => {
    const html = render();
    const lista = html.slice(html.indexOf("<ol"), html.indexOf("</ol>"));
    const textos = textosDaTela(lista);
    for (const texto of ["Ter 20", "Em execução", "OS 10045-01", "07:30–18:00", "Carlos Silva, Diego Alves", "DEF-4G56", "Demanda 10045", "Qua 21", "Sem equipe", "Escalar", "Qui 22", "Reagendar"]) {
      expect(textos, texto).toContain(texto);
    }
    expect(lista).not.toContain("Seg 19");
  });

  it("a OS agendada sem equipe fica em Sem equipe, com o tipo, quando e Escalar", () => {
    const textos = textosDaTela(render());
    for (const texto of ["Sem equipe", "Paraquedas", "OS 10050-01", "Troca de cadeiras", "Qua 21/10 15:00", "Escalar"]) expect(textos, texto).toContain(texto);
  });

  it("a OS escolhida acende em todas as linhas e mostra o resumo, com Reagendar e a demanda", () => {
    const html = render({ selecionada: "10045-02" });
    const textos = textosDaTela(html);
    for (const texto of ["Agendada", "OS 10045-02", "Qui 22/10 19:00–23:00", "Carlos Silva", "DEF-4G56", "Reagendar", "Demanda 10045"]) expect(textos, texto).toContain(texto);
    // A OS 10045-02 está na linha do Carlos e na do veículo.
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Fechar seleção"');
    const emRevisao = render({ selecionada: "10049-01" });
    const barra = emRevisao.slice(emRevisao.indexOf('role="region"'), emRevisao.indexOf("Fechar seleção"));
    expect(textosDaTela(barra)).toContain("Em revisão");
    expect(textosDaTela(barra)).not.toContain("Reagendar");
  });

  it("fora desta semana, o atalho Hoje volta para ela", () => {
    expect(textosDaTela(render())).not.toContain("Hoje ");
    const html = render({ semana: { anterior: "/a", proxima: "/b", hoje: "/operacao/agenda", ehEstaSemana: false } });
    expect(html).toMatch(/<a href="\/operacao\/agenda"[^>]*>Hoje<\/a>/);
  });

  it("sem legenda: só rótulos, dados e ações", () => {
    expect(
      textosForaDaLista(render({ selecionada: "10045-02" }), [
        /^(Agenda|Buscar pessoa, placa, OS ou cliente|Nova demanda|19 a 24 de outubro|Hoje)$/,
        /^(Seg|Ter|Qua|Qui|Sex|Sáb) \d+$/,
        /^(\d+ OS|·|1 sem equipe|1 em duas OS)$/,
        /^(Sem equipe|\d|Paraquedas|OS \d{5}-\d{2}|Itaú Unibanco|Troca de cadeiras|Qua 21\/10 15:00|Escalar)$/,
        /^(Equipe própria|Freelancers|Veículos|Carlos Silva|Ana Lima|Diego Alves|DEF-4G56|Líder|Montador|Baú|[A-Z]{2})$/,
        /^Itaú Unibanco · \d{2}:\d{2}(–\d{2}:\d{2})?$/,
        /^(· )?(Agendada|Em execução|Em revisão)$/,
        /^(Qui 22\/10 19:00–23:00|Reagendar|Escalar|Demanda 100\d\d)$/,
        /^(\d{2}:\d{2}(–\d{2}:\d{2})?|Carlos Silva, Diego Alves|Nenhuma OS na semana)$/,
      ]),
    ).toEqual([]);
  });

  it("carregando, erro e sem ninguém", () => {
    expect(textosDaTela(render({ estado: "carregando" }))).toContain("Carregando");
    expect(textosDaTela(render({ estado: "erro" }))).toContain("Não foi possível carregar a agenda.");
    const vazia = { ...AGENDA, grupos: [], semEquipe: [], porDia: {} };
    expect(textosDaTela(render({ agenda: vazia }))).toContain("Nenhum colaborador ou veículo ativo");
    expect(textosDaTela(render({ agenda: vazia }))).toContain("Nenhuma OS na semana");
    expect(textosDaTela(render({ agenda: vazia, busca: "zzz" }))).toContain("Nada encontrado");
  });

  it("não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(render({ selecionada: "10045-01" }))).toEqual([]);
  });
});
