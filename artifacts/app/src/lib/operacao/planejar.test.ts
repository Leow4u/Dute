import { describe, expect, it } from "vitest";

import type { ColaboradorDaLista, VeiculoDaLista } from "./cadastro";
import type { LinhaDoSaldo } from "./demandas";
import type { OsDaFila } from "./fila";
import {
  alertasDoPlano,
  dividir,
  igualarAoSaldo,
  papeisDaPessoa,
  papelInicial,
  pedidoDoPlano,
  planoInicial,
  problemasDoPlano,
  removerOs,
  restantes,
  type FormularioDoPlano,
} from "./planejar";

/** Planejar OS (parte 3.6a, docs/mockups/OpOSPlanejar.dc.html). */

const HOJE = "2026-10-27";

const SALDO: LinhaDoSaldo[] = [
  { id: "ln_1", item: "Cadeira Flexform", unidade: "UN", escopo: "300", nasOs: "140", osNumeros: ["10045-01"], saldo: "160" },
  { id: "ln_2", item: "Mesa de trabalho", unidade: "UN", escopo: "60", nasOs: "0", osNumeros: [], saldo: "60" },
  { id: "ln_3", item: "Caixa de arquivo", unidade: "CX", escopo: "95", nasOs: "95", osNumeros: ["10045-01"], saldo: "0" },
];

const ANA = { id: "col_ana", nome: "Ana Lima", papeis: ["lider", "motorista"] } as ColaboradorDaLista;
const BRUNO = { id: "col_bruno", nome: "Bruno Teixeira", papeis: [] } as unknown as ColaboradorDaLista;
const VAN = { id: "vei_van", placa: "DEF-4G56" } as VeiculoDaLista;

describe("plano inicial", () => {
  it("uma OS, hoje, com todo o saldo das linhas que ainda têm", () => {
    const plano = planoInicial(SALDO, HOJE);
    expect(plano.ordens).toEqual([{ data: HOJE, inicio: "07:00", fim: "", itens: { ln_1: "160", ln_2: "60" } }]);
    expect([...restantes(SALDO, plano)]).toEqual([["ln_1", 0], ["ln_2", 0], ["ln_3", 0]]);
  });
});

describe("várias OS do mesmo saldo", () => {
  it("dividir abre a OS seguinte no dia seguinte, sem itens, com quem já está no plano", () => {
    const comEquipe: FormularioDoPlano = { ...planoInicial(SALDO, HOJE), equipe: [{ colaboradorId: "col_ana", papel: "lider", ordens: [0] }], veiculos: [{ veiculoId: "vei_van", ordens: [0] }] };
    const dividido = dividir(comEquipe);
    expect(dividido.ordens).toHaveLength(2);
    expect(dividido.ordens[1]).toEqual({ data: "2026-10-28", inicio: "07:00", fim: "", itens: {} });
    expect(dividido.equipe[0].ordens).toEqual([0, 1]);
    expect(dividido.veiculos[0].ordens).toEqual([0, 1]);
  });

  it("duas OS da mesma demanda somam no máximo o saldo: passar impede, igualar completa", () => {
    let plano = dividir(planoInicial(SALDO, HOJE));
    plano = { ...plano, ordens: [{ ...plano.ordens[0], itens: { ln_1: "100", ln_2: "60" } }, { ...plano.ordens[1], itens: { ln_1: "70" } }] };
    expect(restantes(SALDO, plano).get("ln_1")).toBe(-10_000);
    expect(problemasDoPlano(plano, SALDO, HOJE, true)).toEqual(["Cadeira Flexform: as OS somam 170 e o saldo é 160."]);
    plano = { ...plano, ordens: [plano.ordens[0], { ...plano.ordens[1], itens: { ln_1: "20,5" } }] };
    expect(problemasDoPlano(plano, SALDO, HOJE, true)).toEqual([]);
    const igualado = igualarAoSaldo(plano, 1, SALDO);
    expect(igualado.ordens[1].itens).toEqual({ ln_1: "60" });
    expect(restantes(SALDO, igualado).get("ln_1")).toBe(0);
  });

  it("remover a OS tira a equipe e os veículos dela e reordena os outros", () => {
    let plano = dividir(dividir({ ...planoInicial(SALDO, HOJE), equipe: [{ colaboradorId: "col_ana", papel: "lider", ordens: [0] }] }));
    plano = { ...plano, equipe: [{ colaboradorId: "col_ana", papel: "lider", ordens: [0, 2] }] };
    const sem = removerOs(plano, 1);
    expect(sem.ordens).toHaveLength(2);
    expect(sem.equipe[0].ordens).toEqual([0, 1]);
    expect(removerOs(planoInicial(SALDO, HOJE), 0).ordens).toHaveLength(1);
  });
});

describe("o que impede", () => {
  it("OS sem item, quantidade fora do formato, data passada, sem data ao agendar e janela invertida", () => {
    const plano: FormularioDoPlano = {
      ...planoInicial(SALDO, HOJE),
      ordens: [
        { data: "", inicio: "08:00", fim: "07:00", itens: {} },
        { data: "2026-10-26", inicio: "", fim: "18:00", itens: { ln_2: "1.2345" } },
      ],
    };
    expect(problemasDoPlano(plano, SALDO, HOJE, true)).toEqual([
      "OS 1: inclua ao menos um item.",
      "OS 1: informe a data.",
      "OS 1: o fim vem depois do início.",
      "OS 2: a quantidade de Mesa de trabalho está fora do formato.",
      "OS 2: a data já passou.",
      "OS 2: informe o início antes do fim.",
    ]);
    // Rascunho: sem data é Para agendar.
    expect(problemasDoPlano({ ...plano, ordens: [{ ...plano.ordens[0], inicio: "", fim: "", itens: { ln_1: "1" } }] }, SALDO, HOJE, false)).toEqual([]);
  });
});

describe("o que só merece atenção", () => {
  const outras: OsDaFila[] = [
    {
      numero: "10049-01",
      demanda: "10049",
      customer_code: "SAFRA",
      status: "agendada",
      edicao: 2,
      itens: [],
      agenda: { data: HOJE, hora: "15:00", fim: null, equipe: ["col_ana"], veiculos: ["vei_van"] },
      pessoas: [{ id: "col_ana", nome: "Ana Lima", papel: "lider" }],
      placas: ["DEF-4G56"],
    },
  ];

  it("sem equipe, sem líder e sem veículo são alertas, não impedimento", () => {
    const plano = planoInicial(SALDO, HOJE);
    expect(alertasDoPlano(plano, [ANA, BRUNO], [VAN], [])).toEqual(["A OS sem equipe", "A OS sem veículo"]);
    expect(problemasDoPlano(plano, SALDO, HOJE, true)).toEqual([]);
    const semLider = { ...plano, equipe: [{ colaboradorId: "col_bruno", papel: "montador" as const, ordens: [0] }] };
    expect(alertasDoPlano(semLider, [ANA, BRUNO], [VAN], [])).toEqual(["A OS sem líder", "A OS sem veículo"]);
  });

  it("quem já está em outra OS no mesmo dia aparece, e o veículo também", () => {
    const plano: FormularioDoPlano = {
      ...planoInicial(SALDO, HOJE),
      equipe: [{ colaboradorId: "col_ana", papel: "lider", ordens: [0] }],
      veiculos: [{ veiculoId: "vei_van", ordens: [0] }],
    };
    expect(alertasDoPlano(plano, [ANA, BRUNO], [VAN], outras)).toEqual(["Ana Lima já está na OS 10049-01 no dia", "DEF-4G56 já está na OS 10049-01 no dia"]);
    expect(alertasDoPlano({ ...plano, ordens: [{ ...plano.ordens[0], data: "2026-10-28" }] }, [ANA], [VAN], outras)).toEqual([]);
  });
});

describe("papéis", () => {
  it("o primeiro do cadastro; sem nenhum marcado, todos se escolhem", () => {
    expect(papelInicial(ANA)).toBe("lider");
    expect(papelInicial(BRUNO)).toBe("");
    expect(papeisDaPessoa(ANA)).toEqual(["lider", "motorista"]);
    expect(papeisDaPessoa(BRUNO)).toEqual(["lider", "motorista", "montador", "ajudante"]);
  });
});

describe("pedido para a callable", () => {
  const plano: FormularioDoPlano = {
    ordens: [
      { data: HOJE, inicio: "07:00", fim: "19:00", itens: { ln_1: "100", ln_2: "60", ln_3: "" } },
      { data: "2026-10-28", inicio: "07:00", fim: "", itens: { ln_1: "60" } },
    ],
    equipe: [
      { colaboradorId: "col_ana", papel: "lider", ordens: [0, 1] },
      { colaboradorId: "col_bruno", papel: "", ordens: [1] },
    ],
    veiculos: [{ veiculoId: "vei_van", ordens: [0] }],
    instrucoes: "  Doca pelo subsolo 2. ",
    contatoOrigem: { nome: "Renata Campos", telefone: "11987654321" },
    contatoDestino: { nome: "", telefone: "" },
  };

  it("agendando, cada OS leva a janela, a fatia, a equipe com papel e os veículos", () => {
    expect(pedidoDoPlano(plano, "10045", SALDO, "k1", true)).toEqual({
      action: "plan",
      idempotency_key: "k1",
      demanda: "10045",
      ordens: [
        {
          itens: [{ id: "ln_1", planejado: "100" }, { id: "ln_2", planejado: "60" }],
          janela: { data: HOJE, inicio: "07:00", fim: "19:00" },
          equipe: [{ colaborador_id: "col_ana", papel: "lider" }],
          veiculos: ["vei_van"],
          instrucoes: "Doca pelo subsolo 2.",
          contatos: { origem: { nome: "Renata Campos", telefone: "11987654321" } },
        },
        {
          itens: [{ id: "ln_1", planejado: "60" }],
          janela: { data: "2026-10-28", inicio: "07:00", fim: null },
          equipe: [{ colaborador_id: "col_ana", papel: "lider" }, { colaborador_id: "col_bruno" }],
          veiculos: [],
          instrucoes: "Doca pelo subsolo 2.",
          contatos: { origem: { nome: "Renata Campos", telefone: "11987654321" } },
        },
      ],
    });
  });

  it("no rascunho, a OS vai sem janela e fica Para agendar", () => {
    const pedido = pedidoDoPlano(plano, "10045", SALDO, "k2", false) as { ordens: Array<Record<string, unknown>> };
    expect(pedido.ordens.every((os) => !("janela" in os))).toBe(true);
    expect(JSON.stringify(pedido)).not.toMatch(/preco|valor/);
  });
});
