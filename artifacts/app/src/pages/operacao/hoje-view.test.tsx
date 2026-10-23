import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { EscalaDaOs } from "@/components/operacao/escala";
import type { OsDaFila } from "@/lib/operacao/fila";
import { SEM_FILTRO, quadroDoHoje, type DemandaDoHoje } from "@/lib/operacao/hoje";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { HojeView } from "./hoje-view";

/** Operação › Hoje (parte 3.5a, docs/mockups/ModOpHoje.dc.html). */

const HOJE = "2026-10-23";
const AGORA = new Date("2026-10-23T17:20:00.000Z");
const noop = () => undefined;

const DIRETA: DemandaDoHoje = {
  numero: "10053",
  customerCode: "ITAU",
  titulo: "Transporte de 6 cadeiras",
  tipo: "paraquedas",
  entrada: "direta",
  etapa: "para_planejar",
  executarAte: "2026-10-23T22:00:00.000Z",
  osNumeros: ["10053-01"],
  escopo: [{ id: "ln_1", item: "Cadeira", quantidade: "6" }],
  fora: null,
  visitaTecnica: null,
  escopoRv: null,
};

const PLANEJAR: DemandaDoHoje = { ...DIRETA, numero: "10043", tipo: "planejada", entrada: "comercial", titulo: "Instalação de 40 lockers", executarAte: null, osNumeros: [] };

const ABERTA: OsDaFila = {
  numero: "10053-01",
  demanda: "10053",
  customer_code: "ITAU",
  status: "aberta",
  edicao: 1,
  itens: [{ id: "ln_1", item: "Cadeira", quantidade: "6" }],
  agenda: null,
  pessoas: [],
  placas: [],
  servicos: ["transporte"],
  rota: "Agência Rebouças → Faria Lima",
};

const AGENDADA: OsDaFila = {
  ...ABERTA,
  numero: "10049-01",
  demanda: "10049",
  status: "agendada",
  agenda: { data: HOJE, hora: "15:00", fim: null, equipe: ["col_jp"], veiculos: [] },
  pessoas: [{ id: "col_jp", nome: "João Pereira", papel: "motorista" }],
  placas: [],
};

const PROXIMA: OsDaFila = { ...AGENDADA, numero: "10051-01", demanda: "10051", agenda: { ...AGENDADA.agenda!, data: "2026-10-28" } };

function quadro() {
  return quadroDoHoje({
    hoje: HOJE,
    agora: AGORA,
    demandas: [DIRETA, PLANEJAR],
    ordens: [ABERTA, AGENDADA, PROXIMA],
    nomesClientes: { ITAU: "Itaú Unibanco" },
    nomesPessoas: {},
    placas: {},
    filtros: SEM_FILTRO,
    busca: "",
  });
}

function render(extra: Partial<Parameters<typeof HojeView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/operacao/hoje">
    <HojeView
      estado="pronto"
      resumo="Sexta, 23 de outubro · 2 OS · 1 demanda para planejar"
      quadro={quadro()}
      filtros={SEM_FILTRO}
      opcoes={{ clientes: [{ valor: "ITAU", rotulo: "Itaú Unibanco" }], pessoas: [{ valor: "col_jp", rotulo: "João Pereira" }] }}
      busca=""
      onBusca={noop}
      onFiltros={noop}
      onEscalar={noop}
      erro={null}
      escala={null}
      {...extra}
    />
    </Router>,
  );
}

describe("Hoje", () => {
  it("tem as cinco colunas, os filtros, a busca e o resumo do dia, sem valor", () => {
    const html = render();
    const textos = textosDaTela(html);
    for (const texto of [
      "Hoje",
      "Sexta, 23 de outubro · 2 OS · 1 demanda para planejar",
      "Para planejar",
      "Para agendar",
      "Agendadas hoje",
      "Em execução",
      "Em revisão",
      "Todos os tipos",
      "Todas as entradas",
      "Todos os clientes",
      "Toda a equipe",
    ]) {
      expect(textos, texto).toContain(texto);
    }
    expect(html).toContain('placeholder="Buscar OS, demanda ou cliente"');
    expect(html).not.toContain("R$");
    expect(textos).not.toContain("Limpar filtros");
  });

  it("a demanda para planejar mostra tipo, número, cliente, entrada e saldo, com Planejar OS", () => {
    const textos = textosDaTela(render());
    for (const texto of ["Planejada", "10043", "Instalação de 40 lockers", "Comercial · 1 item com saldo", "Planejar OS"]) expect(textos, texto).toContain(texto);
  });

  it("a OS para agendar mostra o prazo da direta, os serviços, Sem equipe e Escalar", () => {
    const textos = textosDaTela(render());
    for (const texto of ["Paraquedas", "OS 10053-01", "Itaú Unibanco", "Transporte de 6 cadeiras · Agência Rebouças → Faria Lima", "Hoje até 19:00", "· faltam 4h40", "Transporte", "Sem equipe", "Escalar"]) {
      expect(textos, texto).toContain(texto);
    }
  });

  it("a agendada de hoje mostra a hora, a equipe e Sem veículo; os próximos dias ficam recolhidos", () => {
    const textos = textosDaTela(render());
    for (const texto of ["15:00", "OS 10049-01", "João Pereira", "Sem veículo", "Próximos dias · 1"]) expect(textos, texto).toContain(texto);
    expect(textos).not.toContain("Reagendar");
    // O número da OS aberta ou agendada abre o painel de escalar.
    expect(render()).toMatch(/<button type="button"[^>]*>OS 10049-01<\/button>/);
    expect(textos).not.toContain("OS 10051-01");
  });

  it("com filtro, aparece Limpar filtros; vazio, Nenhuma OS", () => {
    const vazio = quadroDoHoje({ hoje: HOJE, agora: AGORA, demandas: [], ordens: [], nomesClientes: {}, nomesPessoas: {}, placas: {}, filtros: SEM_FILTRO, busca: "" });
    const html = render({ filtros: { ...SEM_FILTRO, tipo: "paraquedas" }, quadro: vazio });
    const textos = textosDaTela(html);
    expect(textos).toContain("Limpar filtros");
    expect(textos).toContain("Nenhuma demanda");
    expect(html.match(/>Nenhuma OS</g)).toHaveLength(4);
  });

  it("sem legenda: só rótulos, dados e ações", () => {
    const fora = textosForaDaLista(render(), [
      "Hoje",
      "Sexta, 23 de outubro · 2 OS · 1 demanda para planejar",
      "Buscar OS, demanda ou cliente",
      "Nova demanda",
      "Tipo",
      "Entrada",
      "Cliente",
      "Equipe",
      /^(Todos os tipos|Todas as entradas|Todos os clientes|Toda a equipe)$/,
      /^(Paraquedas|Emergencial|Planejada|Comercial|Direta|Armazenagem|Itaú Unibanco|João Pereira)$/,
      /^(Para planejar|Para agendar|Agendadas hoje|Em execução|Em revisão)$/,
      /^\d+$/,
      /^OS \d{5}-\d{2}$/,
      /^(Instalação de 40 lockers|(Transporte de 6 cadeiras|Cadeira) · Agência Rebouças → Faria Lima)$/,
      // As iniciais do avatar (aria-hidden).
      /^[A-Z]{1,2}$/,
      /^(Comercial|Direta)( · \d+ OS)? · \d+ (item|itens) com saldo$/,
      /^(Hoje até 19:00|· faltam 4h40)$/,
      /^(Transporte|Sem equipe|Sem veículo|15:00)$/,
      /^(Planejar OS|Escalar|Próximos dias · 1|Nenhuma OS|Nenhuma demanda)$/,
    ]);
    expect(fora).toEqual([]);
  });

  it("carregando e erro", () => {
    expect(textosDaTela(render({ estado: "carregando" }))).toContain("Carregando");
    expect(textosDaTela(render({ estado: "erro" }))).toContain("Não foi possível carregar o Hoje.");
  });

  it("não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
  });
});

describe("escalar a OS", () => {
  const agenda = { data: HOJE, hora: "15:00", equipe: ["col_jp"], veiculoId: "", motivo: "" };
  const formulario = (extra: Partial<Parameters<typeof EscalaDaOs>[0]> = {}) =>
    renderToStaticMarkup(
      <EscalaDaOs
        os={ABERTA}
        pessoas={[
          { id: "col_jp", nome: "João Pereira", funcao: "Motorista", ativo: true },
          { id: "col_lf", nome: "Lucas Ferreira", funcao: "Montador", ativo: false },
        ]}
        veiculos={[{ id: "vei_a", placa: "ABC-1D23", tipo: "Fiorino", ativo: true }]}
        agenda={agenda}
        onAgenda={noop}
        onSalvar={noop}
        onCancelar={noop}
        ocupado={false}
        erro={null}
        {...extra}
      />,
    );

  it("tem data, hora, equipe e veículo; sem veículo ainda agenda; cancelar pede o motivo", () => {
    const html = formulario();
    const textos = textosDaTela(html);
    for (const texto of ["Data", "Hora", "Equipe", "Veículo", "Sem veículo", "Agendar", "Motivo do cancelamento", "Cancelar OS", "Montador · Desativado"]) {
      expect(textos, texto).toContain(texto);
    }
    expect(html).toMatch(/<button[^>]*type="submit"(?![^>]*disabled)[^>]*>Agendar/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Cancelar OS/);
  });

  it("a OS agendada salva; a de demanda perdida só cancela", () => {
    expect(textosDaTela(formulario({ os: AGENDADA }))).toContain("Salvar");
    const perdida = textosDaTela(formulario({ os: { ...ABERTA, demandaFora: "perdida" } }));
    expect(perdida).toContain("Demanda perdida");
    expect(perdida).not.toContain("Agendar");
    expect(perdida).toContain("Cancelar OS");
  });

  it("o veículo no dia da revisão preventiva não se escolhe; escolhido antes, impede salvar (parte 3.13b)", () => {
    const veiculos = [{ id: "vei_a", placa: "ABC-1D23", tipo: "Fiorino", ativo: true, revisaoEm: HOJE }];
    const livre = formulario({ veiculos });
    expect(textosDaTela(livre)).toContain("ABC-1D23 · Fiorino · Revisão preventiva");
    expect(livre).toMatch(/<option value="vei_a" disabled="">/);
    expect(livre).toMatch(/<button[^>]*type="submit"(?![^>]*disabled)[^>]*>Agendar/);
    const escolhido = formulario({ veiculos, agenda: { ...agenda, veiculoId: "vei_a" } });
    expect(textosDaTela(escolhido)).toContain("ABC-1D23 em revisão preventiva no dia");
    expect(escolhido).toMatch(/<button[^>]*disabled=""[^>]*>Agendar/);
    expect(textosDaTela(formulario({ veiculos, agenda: { ...agenda, data: "2026-10-24", veiculoId: "vei_a" } }))).not.toContain("ABC-1D23 em revisão preventiva no dia");
  });

  it("não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(formulario({ erro: "A data do agendamento já passou." }))).toEqual([]);
  });
});

describe("a vistoria pedida no Hoje (parte 3.11c)", () => {
  it("o cartão diz a vistoria e o dia, e leva a planejar a vistoria; sem legenda", async () => {
    const pedida = { ...PLANEJAR, numero: "10060", etapa: "em_montagem", escopo: [], osNumeros: [], entrada: "comercial" as const, visitaTecnica: "2026-10-28", escopoRv: null };
    const html = render({
      quadro: quadroDoHoje({ hoje: HOJE, agora: AGORA, demandas: [pedida], ordens: [], nomesClientes: { ITAU: "Itaú Unibanco" }, nomesPessoas: {}, placas: {}, filtros: SEM_FILTRO, busca: "" }),
    });
    const textos = textosDaTela(html);
    expect(textos).toContain("Vistoria · 28/10/2026");
    expect(textos).toContain("Planejar vistoria");
    expect(textos).not.toContain("Planejar OS");
    expect(html).toContain('href="/operacao/planejar?demanda=10060&amp;vistoria=1"');
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
