import { readFileSync } from "node:fs";

import { CalendarClock, Truck, UserX, Wrench } from "lucide-react";
import { describe, expect, it } from "vitest";

import type { ItemDoInicio } from "../inicio-do-modulo";
import type { ColaboradorDaLista, VeiculoDaLista } from "./cadastro";
import type { DemandaParaAbrir, OsDaFila } from "./fila";
import {
  DIAS_PARA_A_CNH,
  DIAS_PARA_A_REVISAO,
  diasAte,
  equipeDeHoje,
  hojeNaOperacao,
  iniciaisDe,
  pendenciasDaOperacao,
  type EntradaDoInicio,
} from "./pendencias";

const HOJE = "2026-10-23";
const semIcone = (itens: ItemDoInicio[]) => itens.map(({ icon: _icon, ...resto }) => resto);

const pessoa = (id: string, nome: string, extra: Partial<ColaboradorDaLista> = {}): ColaboradorDaLista => ({
  id,
  edicao: 1,
  ativo: true,
  nome,
  funcao: "Ajudante",
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

const veiculo = (id: string, placa: string, ativo = true): VeiculoDaLista => ({
  id,
  edicao: 1,
  ativo,
  placa,
  tipo: "Caminhão 3/4",
  modelo: "",
  capacidadeKg: "3000",
  capacidadeM3: "20",
  resumo: "", dono: "proprio", empresa: "", revisaoEm: "",
});

const aberta = (numero: string, cliente: string, extra: Partial<OsDaFila> = {}): OsDaFila => ({
  numero,
  demanda: numero.slice(0, 5),
  customer_code: cliente,
  status: "aberta",
  edicao: 1,
  itens: [],
  agenda: null,
  demandaFora: null,
  ...extra,
});

const agendada = (numero: string, cliente: string, data: string, equipe: string[], veiculoId: string, hora: string | null = null): OsDaFila =>
  aberta(numero, cliente, { status: "agendada", edicao: 2, agenda: { data, hora, equipe, fim: null, veiculos: [veiculoId] } });

const PEDRO = pessoa("col_pedro", "Pedro Nunes");
const JOAO = pessoa("col_joao", "João Pereira");
const ANA = pessoa("col_ana", "Ana Lima", { ativo: false });
const MARCOS = pessoa("col_marcos", "Marcos Andrade", { cnhCategoria: "D", cnhValidade: "2026-11-04" });
const VAN = veiculo("vei_van", "ABC1D23");
const VELHO = veiculo("vei_velho", "XYZ9876", false);

const NOMES = { HORIZONTE: "Construtora Horizonte", TECH: "TechPrime Escritórios", SOUZA: "Metalúrgica Souza", VIDA: "Clínica Vida Plena" };

function entrada(extra: Partial<EntradaDoInicio> = {}): EntradaDoInicio {
  return {
    hoje: HOJE,
    ordens: [],
    demandas: [],
    pessoas: [PEDRO, JOAO, ANA],
    veiculos: [VAN, VELHO],
    nomesClientes: NOMES,
    ...extra,
  };
}

const demanda = (numero: string, cliente: string, os: string[] = []): DemandaParaAbrir => ({ numero, customer_code: cliente, titulo: null, os_numeros: os });

describe("pendências do Início da Operação", () => {
  it("a OS agendada com veículo ou pessoa desativada pede reagendar; hoje é crítico", () => {
    const itens = pendenciasDaOperacao(
      entrada({
        ordens: [
          agendada("10045-01", "HORIZONTE", HOJE, ["col_pedro"], "vei_velho", "17:00"),
          agendada("10046-01", "TECH", "2026-10-26", ["col_ana", "col_pedro"], "vei_van"),
          agendada("10047-01", "TECH", "2026-10-27", ["col_ana", "col_sumiu"], "vei_sumiu"),
          // Passou: não entra (a execução é da Fase 3).
          agendada("10040-01", "TECH", "2026-10-20", ["col_ana"], "vei_van"),
        ],
      }),
    );
    expect(semIcone(itens)).toEqual([
      {
        id: "os-cadastro:10045-01",
        tone: "critical",
        title: "OS 10045-01 com veículo desativado",
        detail: "Construtora Horizonte · 23/10/2026 17:00 · XYZ-9876",
        href: "/operacao/hoje?os=10045-01",
        actionLabel: "Reagendar",
      },
      {
        id: "os-cadastro:10046-01",
        tone: "attention",
        title: "OS 10046-01 com pessoa desativada",
        detail: "TechPrime Escritórios · 26/10/2026 · Ana Lima",
        href: "/operacao/hoje?os=10046-01",
        actionLabel: "Reagendar",
      },
      {
        id: "os-cadastro:10047-01",
        tone: "attention",
        title: "OS 10047-01 com pessoa e veículo desativados",
        detail: "TechPrime Escritórios · 27/10/2026 · Ana Lima, col_sumiu, vei_sumiu",
        href: "/operacao/hoje?os=10047-01",
        actionLabel: "Reagendar",
      },
    ]);
  });

  it("com vários veículos, só o desativado aparece; sem veículo não é este alerta", () => {
    const [item, ...resto] = pendenciasDaOperacao(
      entrada({
        ordens: [
          aberta("10045-01", "HORIZONTE", {
            status: "agendada",
            edicao: 2,
            agenda: { data: HOJE, hora: null, fim: null, equipe: ["col_pedro"], veiculos: ["vei_van", "vei_velho"] },
          }),
          aberta("10046-01", "TECH", { status: "agendada", edicao: 2, agenda: { data: HOJE, hora: null, fim: null, equipe: ["col_pedro"], veiculos: [] } }),
        ],
      }),
    );
    expect(item).toMatchObject({ id: "os-cadastro:10045-01", title: "OS 10045-01 com veículo desativado", detail: "Construtora Horizonte · 23/10/2026 · XYZ-9876" });
    expect(resto.filter((outro) => outro.id.startsWith("os-cadastro"))).toEqual([]);
  });

  it("o ícone diz o que falta: pessoa ou veículo", () => {
    const [veiculo, pessoa] = pendenciasDaOperacao(
      entrada({
        ordens: [
          agendada("10045-01", "HORIZONTE", HOJE, ["col_pedro"], "vei_velho"),
          agendada("10046-01", "TECH", HOJE, ["col_ana"], "vei_van"),
        ],
      }),
    );
    expect(veiculo.icon).toBe(Truck);
    expect(pessoa.icon).toBe(UserX);
  });

  it("duas pessoas desativadas, no plural", () => {
    const [item] = pendenciasDaOperacao(
      entrada({ ordens: [agendada("10046-01", "TECH", "2026-10-26", ["col_ana", "col_sumiu"], "vei_van")] }),
    );
    expect(item.title).toBe("OS 10046-01 com 2 pessoas desativadas");
  });

  it("as OS para agendar viram um item; com uma só, a ação abre a própria OS", () => {
    const tres = pendenciasDaOperacao(
      entrada({ ordens: [aberta("10050-01", "TECH"), aberta("10048-01", "HORIZONTE"), aberta("10049-01", "VIDA")] }),
    );
    expect(semIcone(tres)).toEqual([
      {
        id: "os-para-agendar",
        tone: "attention",
        title: "3 OS para agendar",
        detail: "10048-01 · Construtora Horizonte · 10049-01 · Clínica Vida Plena e mais 1",
        href: "/operacao/hoje",
        actionLabel: "Agendar",
      },
    ]);
    const uma = pendenciasDaOperacao(entrada({ ordens: [aberta("10050-01", "TECH")] }));
    expect(uma[0]).toMatchObject({ title: "1 OS para agendar", href: "/operacao/hoje?os=10050-01" });
  });

  it("demandas em Para planejar sem OS levam à fila; as que já têm OS não entram", () => {
    const itens = pendenciasDaOperacao(
      entrada({ demandas: [demanda("10047", "VIDA"), demanda("10043", "SOUZA"), demanda("10041", "TECH", ["10041-01"])] }),
    );
    expect(semIcone(itens)).toEqual([
      {
        id: "demandas-para-planejar",
        tone: "attention",
        title: "2 demandas para planejar",
        detail: "10043 · Metalúrgica Souza · 10047 · Clínica Vida Plena",
        href: "/operacao/hoje",
        actionLabel: "Abrir OS",
      },
    ]);
    expect(pendenciasDaOperacao(entrada({ demandas: [demanda("10043", "SOUZA")] }))[0].title).toBe("1 demanda para planejar");
  });

  it(`a CNH vencendo em até ${DIAS_PARA_A_CNH} dias, com as OS até lá; vencida é crítica`, () => {
    const itens = pendenciasDaOperacao(
      entrada({
        pessoas: [
          MARCOS,
          pessoa("col_rafa", "Rafael Costa", { cnhCategoria: "C", cnhValidade: "2026-10-20" }),
          pessoa("col_longe", "Carlos Silva", { cnhCategoria: "B", cnhValidade: "2026-11-23" }), // 31 dias
          pessoa("col_inativo", "Bia Rocha", { ativo: false, cnhCategoria: "B", cnhValidade: "2026-10-01" }),
        ],
        ordens: [
          agendada("10051-01", "TECH", "2026-10-28", ["col_marcos"], "vei_van"),
          agendada("10052-01", "TECH", "2026-11-04", ["col_marcos"], "vei_van"),
          // Depois da validade: não conta para "até lá".
          agendada("10053-01", "TECH", "2026-11-05", ["col_marcos"], "vei_van"),
          agendada("10054-01", "TECH", "2026-10-30", ["col_rafa"], "vei_van"),
        ],
      }),
    );
    expect(semIcone(itens)).toEqual([
      {
        id: "cnh:col_rafa",
        tone: "critical",
        title: "CNH de Rafael Costa vencida em 20/10/2026",
        detail: "Categoria C · validade 20/10/2026 · escalado em 1 OS",
        href: "/operacao/colaboradores?id=col_rafa",
        actionLabel: "Ver cadastro",
      },
      {
        id: "cnh:col_marcos",
        tone: "attention",
        title: "CNH de Marcos Andrade vence em 12 dias",
        detail: "Categoria D · validade 04/11/2026 · escalado em 2 OS até lá",
        href: "/operacao/colaboradores?id=col_marcos",
        actionLabel: "Ver cadastro",
      },
    ]);
    // 31 dias: ainda não entra. Inativo: não entra.
    expect(itens.map((item) => item.id)).not.toContain("cnh:col_longe");
  });

  it("CNH que vence hoje, e sem escala", () => {
    const [item] = pendenciasDaOperacao(entrada({ pessoas: [pessoa("col_x", "Ana Souza", { cnhCategoria: "B", cnhValidade: HOJE })] }));
    expect(item).toMatchObject({ title: "CNH de Ana Souza vence hoje", detail: "Categoria B · validade 23/10/2026", tone: "attention" });
  });

  it("a OS de demanda perdida ou cancelada só se cancela, e sai das outras contas", () => {
    const fora = aberta("10044-01", "SOUZA", { demandaFora: "perdida" });
    const foraAgendada = { ...agendada("10042-01", "TECH", HOJE, ["col_ana"], "vei_velho", "09:00"), demandaFora: "cancelada" as const };
    const itens = pendenciasDaOperacao(entrada({ ordens: [fora, foraAgendada] }));
    expect(semIcone(itens)).toEqual([
      {
        id: "os-fora:10042-01",
        tone: "critical",
        title: "OS 10042-01 de demanda cancelada",
        detail: "TechPrime Escritórios · 23/10/2026 09:00",
        href: "/operacao/hoje?os=10042-01",
        actionLabel: "Cancelar OS",
      },
      {
        id: "os-fora:10044-01",
        tone: "critical",
        title: "OS 10044-01 de demanda perdida",
        detail: "Metalúrgica Souza",
        href: "/operacao/hoje?os=10044-01",
        actionLabel: "Cancelar OS",
      },
    ]);
    expect(hojeNaOperacao(entrada({ ordens: [fora, foraAgendada] }))).toEqual({ agendadasHoje: 0, paraAgendar: 0, proximosDias: 0 });
  });

  it("o mais urgente primeiro; no mesmo tom, a ordem das fontes", () => {
    const ids = pendenciasDaOperacao(
      entrada({
        ordens: [
          aberta("10044-01", "SOUZA", { demandaFora: "perdida" }),
          agendada("10046-01", "TECH", "2026-10-26", ["col_ana"], "vei_van"),
          agendada("10045-01", "HORIZONTE", HOJE, ["col_pedro"], "vei_velho"),
          aberta("10050-01", "TECH"),
        ],
        demandas: [demanda("10043", "SOUZA")],
        pessoas: [PEDRO, JOAO, ANA, MARCOS],
      }),
    ).map((item) => item.id);
    expect(ids).toEqual([
      "os-fora:10044-01",
      "os-cadastro:10045-01",
      "os-cadastro:10046-01",
      "os-para-agendar",
      "demandas-para-planejar",
      "cnh:col_marcos",
    ]);
  });

  it("sem nada parado, lista vazia", () => {
    expect(pendenciasDaOperacao(entrada({ pessoas: [PEDRO], ordens: [agendada("10045-01", "TECH", HOJE, ["col_pedro"], "vei_van")] }))).toEqual([]);
  });

  it("nenhum item fala de valor", () => {
    const itens = pendenciasDaOperacao(
      entrada({ ordens: [aberta("10050-01", "TECH"), agendada("10045-01", "TECH", HOJE, ["col_ana"], "vei_velho")], demandas: [demanda("10043", "SOUZA")] }),
    );
    for (const item of itens) expect(`${item.title} ${item.detail}`).not.toMatch(/R\$|valor|preço/i);
  });
});

describe("o dia e a equipe", () => {
  const ordens = [
    agendada("10045-01", "HORIZONTE", HOJE, ["col_pedro", "col_joao"], "vei_van", "14:00"),
    agendada("10046-01", "TECH", HOJE, ["col_joao"], "vei_van", "08:30"),
    agendada("10047-01", "TECH", HOJE, ["col_marcos"], "vei_van"),
    agendada("10048-01", "TECH", "2026-10-24", ["col_pedro"], "vei_van"),
    aberta("10050-01", "TECH"),
  ];

  it("agendadas hoje, para agendar e próximos dias", () => {
    expect(hojeNaOperacao(entrada({ ordens }))).toEqual({ agendadasHoje: 3, paraAgendar: 1, proximosDias: 1 });
  });

  it("quem está escalado vem primeiro, pela hora; depois os livres, por nome; inativo não aparece", () => {
    expect(equipeDeHoje(entrada({ ordens, pessoas: [PEDRO, JOAO, ANA, MARCOS, pessoa("col_bia", "Bia Rocha")] }))).toEqual([
      { id: "col_joao", nome: "João Pereira", iniciais: "JP", escala: "10046-01 · 08:30 +1" },
      { id: "col_pedro", nome: "Pedro Nunes", iniciais: "PN", escala: "10045-01 · 14:00" },
      { id: "col_marcos", nome: "Marcos Andrade", iniciais: "MA", escala: "10047-01" },
      { id: "col_bia", nome: "Bia Rocha", iniciais: "BR", escala: null },
    ]);
  });

  it("iniciais do primeiro e do último nome", () => {
    expect(iniciaisDe("Ana Maria da Silva")).toBe("AS");
    expect(iniciaisDe("Ana")).toBe("A");
    expect(iniciaisDe(" ")).toBe("");
  });

  it("dias até uma data", () => {
    expect(diasAte("2026-10-23", "2026-11-04")).toBe(12);
    expect(diasAte("2026-10-23", "2026-10-20")).toBe(-3);
    // Atravessa o fim do horário de verão de outros fusos sem errar.
    expect(diasAte("2026-10-23", "2027-03-01")).toBe(129);
  });
});

describe("os alertas da rotina no Início (parte 3.13b)", () => {
  const AGORA = new Date("2026-10-23T17:20:00.000Z"); // 14:20 em São Paulo
  const comServico = (os: OsDaFila, servicos: string[]): OsDaFila => ({ ...os, servicos });
  const semVeiculo = (os: OsDaFila): OsDaFila => ({ ...os, agenda: { ...os.agenda!, veiculos: [] } });

  it("as janelas são as da rotina diária das Functions", () => {
    const rotina = readFileSync(new URL("../../../../../functions/operacao/src/domain/rotina.ts", import.meta.url), "utf8");
    expect(rotina).toContain(`export const DIAS_PARA_A_CNH = ${DIAS_PARA_A_CNH};`);
    expect(rotina).toContain(`export const DIAS_PARA_A_REVISAO = ${DIAS_PARA_A_REVISAO};`);
  });

  it("a OS de hoje ou de amanhã sem equipe, ou de transporte sem veículo; hoje é crítico", () => {
    const itens = pendenciasDaOperacao(
      entrada({
        agora: AGORA,
        ordens: [
          comServico(agendada("10045-01", "HORIZONTE", HOJE, [], "vei_van", "15:00"), ["transporte"]),
          comServico(semVeiculo(agendada("10046-01", "TECH", "2026-10-24", ["col_pedro"], "vei_van", "08:00")), ["transporte", "montagem"]),
          // Montagem no local e vistoria não pedem veículo; depois de amanhã ainda não entra.
          comServico(semVeiculo(agendada("10047-01", "SOUZA", HOJE, ["col_pedro"], "vei_van")), ["montagem"]),
          comServico(semVeiculo(agendada("10048-01", "VIDA", HOJE, ["col_joao"], "vei_van")), ["vistoria"]),
          comServico(agendada("10049-01", "VIDA", "2026-10-25", [], "vei_van"), ["transporte"]),
        ],
      }),
    );
    expect(semIcone(itens).filter((item) => item.id.startsWith("os-desfalcada"))).toEqual([
      { id: "os-desfalcada:10045-01", tone: "critical", title: "OS 10045-01 sem equipe", detail: "Construtora Horizonte · 23/10/2026 15:00", href: "/operacao/hoje?os=10045-01", actionLabel: "Escalar" },
      { id: "os-desfalcada:10046-01", tone: "attention", title: "OS 10046-01 sem veículo", detail: "TechPrime Escritórios · 24/10/2026 08:00", href: "/operacao/hoje?os=10046-01", actionLabel: "Escalar" },
    ]);
    expect(itens.find((item) => item.id === "os-desfalcada:10045-01")?.icon).toBe(UserX);
    expect(itens.find((item) => item.id === "os-desfalcada:10046-01")?.icon).toBe(Truck);
    const ambos = pendenciasDaOperacao(entrada({ agora: AGORA, ordens: [comServico(semVeiculo(agendada("10045-01", "HORIZONTE", HOJE, [], "vei_van")), ["transporte"])] }));
    expect(ambos[0].title).toBe("OS 10045-01 sem equipe e sem veículo");
  });

  it("a aberta da demanda direta com o prazo em até 24 horas tem item próprio e sai da conta das para agendar", () => {
    const itens = pendenciasDaOperacao(
      entrada({
        agora: AGORA,
        ordens: [
          aberta("10053-01", "HORIZONTE", { prazo: "2026-10-23T22:00:00.000Z" }),
          aberta("10054-01", "TECH", { prazo: "2026-10-26T22:00:00.000Z" }),
          aberta("10055-01", "SOUZA"),
        ],
      }),
    );
    expect(semIcone(itens).slice(0, 2)).toEqual([
      { id: "os-sem-agenda:10053-01", tone: "critical", title: "OS 10053-01 sem agenda", detail: "Construtora Horizonte · Hoje até 19:00 · faltam 4h40", href: "/operacao/hoje?os=10053-01", actionLabel: "Escalar" },
      expect.objectContaining({ id: "os-para-agendar", title: "2 OS para agendar" }),
    ]);
    expect(itens[0].icon).toBe(CalendarClock);
  });

  it(`a revisão do veículo em até ${DIAS_PARA_A_REVISAO} dias, hoje ou passada; a OS no dia da revisão é crítica`, () => {
    const comRevisao = (base: VeiculoDaLista, revisaoEm: string) => ({ ...base, revisaoEm });
    const itens = pendenciasDaOperacao(
      entrada({
        agora: AGORA,
        veiculos: [
          comRevisao(VAN, "2026-10-28"),
          comRevisao(veiculo("vei_truck", "DEF-4G56"), HOJE),
          comRevisao(veiculo("vei_fiorino", "GHI-7J89"), "2026-10-20"),
          comRevisao(veiculo("vei_longe", "JKL-0M12"), "2026-11-08"),
          comRevisao(veiculo("vei_parado", "MNO-3P45", false), HOJE),
        ],
        ordens: [agendada("10045-01", "HORIZONTE", "2026-10-28", ["col_pedro"], "vei_van", "09:00")],
      }),
    );
    expect(semIcone(itens).filter((item) => item.id.startsWith("revisao:"))).toEqual([
      { id: "revisao:vei_truck", tone: "critical", title: "Revisão do DEF-4G56 é hoje", detail: "Caminhão 3/4 · revisão preventiva 23/10/2026", href: "/operacao/veiculos?id=vei_truck", actionLabel: "Ver cadastro" },
      {
        id: "revisao:vei_van",
        tone: "critical",
        title: "Revisão do ABC1D23 em 5 dias",
        detail: "Caminhão 3/4 · revisão preventiva 28/10/2026 · na OS 10045-01 no dia",
        href: "/operacao/hoje?os=10045-01",
        actionLabel: "Reagendar",
      },
      { id: "revisao:vei_fiorino", tone: "attention", title: "Revisão do GHI-7J89 passou em 20/10/2026", detail: "Caminhão 3/4 · revisão preventiva 20/10/2026", href: "/operacao/veiculos?id=vei_fiorino", actionLabel: "Ver cadastro" },
    ]);
    expect(itens.find((item) => item.id === "revisao:vei_van")?.icon).toBe(Wrench);
  });
});

