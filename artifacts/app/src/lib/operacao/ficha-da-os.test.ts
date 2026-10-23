import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ETAPAS_DA_OS,
  ETAPA_ROTULO,
  detalheDaPessoa,
  detalheDoVeiculo,
  enderecoNoMaps,
  etapasDaFicha,
  feitoEm,
  fichaDaLeitura,
  historicoDaOs,
  horaDaEtapa,
  itensDaFicha,
  janelaEmTexto,
  passosDaOs,
  servicosEmTexto,
  type FichaDaOs,
} from "./ficha-da-os";

/** A ficha da OS (parte 3.7d, docs/mockups/OpOS.dc.html). */

const CARLOS = "col_cccccccccccccccc";
const JOAO = "col_jjjjjjjjjjjjjjjj";
const HOJE = "2026-10-22";

const registro = (instante: string, extra: Record<string, unknown> = {}) => ({
  instante,
  canal: "celular",
  meio: null,
  informado_por: null,
  registrado_por: { uid: "u", role: "campo" },
  registrado_em: instante,
  ...extra,
});

const DOC = {
  status: "em_execucao",
  edicao: 9,
  demanda: "10045",
  customer_code: "ITAU",
  servicos: ["transporte", "montagem"],
  janela: { data: HOJE, inicio: "07:30", fim: "18:00" },
  locais: {
    origem: { nome: "Faria Lima", endereco: "Av. Brig. Faria Lima, 3500", complemento: "4º andar · doca pelo subsolo 2", contato: { nome: "Renata Campos", telefone: "11987654321" } },
    destino: { nome: "Centro Empresarial", endereco: "Av. Eng. Armando de Arruda Pereira, 2937", complemento: "Torre B · 12º andar", contato: null },
  },
  equipe: [
    { colaborador_id: CARLOS, nome: "Carlos Silva", papel: "lider", vinculo: "proprio", empresa: null, no_app: true },
    { colaborador_id: JOAO, nome: "João Pereira", papel: "motorista", vinculo: "proprio", empresa: null, no_app: true },
    { colaborador_id: "col_dddddddddddddddd", nome: "Diego Alves", papel: "montador", vinculo: "freelancer", empresa: null, no_app: false },
    { colaborador_id: "col_vvvvvvvvvvvvvvvv", nome: "Valter Moreira", papel: "motorista", vinculo: "terceiro", empresa: "Rota Sul", no_app: false },
  ],
  veiculos: [
    { veiculo_id: "vei_aaaaaaaaaaaaaaaa", placa: "DEF4G56", tipo: "Baú", modelo: "VW Delivery 11.180", dono: "proprio", empresa: null },
    { veiculo_id: "vei_bbbbbbbbbbbbbbbb", placa: "FGH2B34", tipo: "Truck", modelo: null, dono: "terceiro", empresa: "Rota Sul" },
  ],
  itens: [
    {
      id: "ln_1",
      codigo: "3.05",
      item: "Transporte de cadeira Flexform",
      unidade: "UN",
      planejado: "150",
      executado: "128",
      executado_em: "2026-10-22T17:20:00.000Z",
      incluidos: [registro("2026-10-22T12:32:00.000Z", { quantidade: "10", pedido_por: "Renata Campos", motivo: "Sala 412", informado_por: CARLOS })],
    },
    { id: "ln_2", codigo: "2.02", item: "Montagem de mesa de trabalho", unidade: "UN", planejado: "60", executado: "22", executado_em: "2026-10-22T16:00:00.000Z" },
    { id: "ln_3", item: "Caixa de arquivo", unidade: "CX", quantidade: "95" },
  ],
  etapas: [
    { etapa: "saida_patio", ...registro("2026-10-22T10:05:00.000Z", { informado_por: JOAO }) },
    { etapa: "chegada_origem", ...registro("2026-10-22T10:40:00.000Z", { informado_por: JOAO }) },
    { etapa: "carregamento", ...registro("2026-10-22T10:50:00.000Z", { informado_por: CARLOS }) },
    { etapa: "saida_origem", ...registro("2026-10-22T13:20:00.000Z", { informado_por: JOAO }) },
    { etapa: "chegada_destino", ...registro("2026-10-22T14:05:00.000Z", { canal: "escritorio", meio: "telefone", informado_por: JOAO }) },
    { etapa: "montagem", ...registro("2026-10-22T14:20:00.000Z", { informado_por: CARLOS }) },
  ],
  ocorrencias: [{ id: "oc_01", descricao: "Elevador de carga parado por 20 minutos", ...registro("2026-10-22T11:30:00.000Z", { canal: "escritorio", meio: "whatsapp", informado_por: CARLOS }) }],
  fotos: [
    { id: "ft_0000000000000001", caminho: "os/10045-01/fotos/ft_0000000000000001.jpg", etapa: "carregamento", linha: "ln_1", legenda: "Carga", ...registro("2026-10-22T10:52:00.000Z") },
    { id: "ft_x" },
  ],
  preco: "999",
};

const FICHA = fichaDaLeitura("10045-01", DOC) as FichaDaOs;

describe("leitura", () => {
  it("lê a OS inteira e deixa de fora o que não se lê, sem valor", () => {
    expect(FICHA.status).toBe("em_execucao");
    expect(FICHA.equipe.map((pessoa) => pessoa.nome)).toEqual(["Carlos Silva", "João Pereira", "Diego Alves", "Valter Moreira"]);
    expect(FICHA.veiculos.map((veiculo) => veiculo.placa)).toEqual(["DEF-4G56", "FGH-2B34"]);
    expect(FICHA.itens.map((item) => [item.id, item.planejado, item.executado])).toEqual([
      ["ln_1", "150", "128"],
      ["ln_2", "60", "22"],
      ["ln_3", "95", null],
    ]);
    expect(FICHA.etapas).toHaveLength(6);
    expect(FICHA.fotos.map((foto) => foto.id)).toEqual(["ft_0000000000000001"]);
    expect(JSON.stringify(FICHA)).not.toContain("999");
    expect(fichaDaLeitura("x", { status: "outro", edicao: 1, demanda: "1", customer_code: "A" })).toBeNull();
  });

  it("as etapas são as do backend, na mesma ordem", () => {
    const fonte = readFileSync(new URL("../../../../../functions/operacao/src/domain/execucao.ts", import.meta.url), "utf8");
    const lista = /export const ETAPAS_DA_OS = \[([^\]]+)\] as const;/.exec(fonte)?.[1] ?? "";
    expect(Array.from(lista.matchAll(/"([a-z_]+)"/g), (match) => match[1])).toEqual([...ETAPAS_DA_OS]);
    for (const etapa of ETAPAS_DA_OS) expect(fonte).toContain(`${etapa}: "${ETAPA_ROTULO[etapa]}"`);
  });
});

describe("cabeçalho e passos", () => {
  it("janela e serviços em texto", () => {
    expect(janelaEmTexto(FICHA.janela, HOJE)).toBe("hoje 07:30–18:00");
    expect(janelaEmTexto({ data: "2026-10-24", inicio: "08:00", fim: null }, HOJE)).toBe("24/10/2026 08:00");
    expect(servicosEmTexto(FICHA.servicos)).toBe("Transporte e montagem");
    expect(servicosEmTexto(["desmontagem", "transporte", "montagem"])).toBe("Desmontagem, transporte e montagem");
    expect(servicosEmTexto([])).toBeNull();
  });

  it("em execução: agendar feito, executar atual, com o líder e a etapa em curso", () => {
    expect(passosDaOs(FICHA)).toEqual([
      { numero: 1, titulo: "Agendar", quem: "Coordenação", detalhe: "4 pessoas · DEF-4G56 e FGH-2B34", estado: "feito" },
      { numero: 2, titulo: "Executar", quem: "Líder · Carlos Silva", detalhe: "Montagem desde 11:20", estado: "atual" },
      { numero: 3, titulo: "Concluir", quem: "Líder e cliente", detalhe: "Fotos e assinatura no local · até 18:00", estado: "pendente" },
      { numero: 4, titulo: "Revisar", quem: "Coordenação", detalhe: "Itens, fotos e divergências", estado: "pendente" },
    ]);
    expect(passosDaOs({ ...FICHA, status: "aberta" }).map((passo) => passo.estado)).toEqual(["atual", "pendente", "pendente", "pendente"]);
    expect(passosDaOs({ ...FICHA, status: "em_revisao" }).map((passo) => passo.estado)).toEqual(["feito", "feito", "feito", "atual"]);
    expect(passosDaOs({ ...FICHA, status: "revisada" }).map((passo) => passo.estado)).toEqual(["feito", "feito", "feito", "feito"]);
    expect(passosDaOs({ ...FICHA, status: "cancelada" }).map((passo) => passo.estado)).toEqual(["pendente", "pendente", "pendente", "pendente"]);
    expect(passosDaOs({ ...FICHA, equipe: [], veiculos: [] })[0].detalhe).toBe("Sem equipe");
  });
});

describe("etapas", () => {
  it("a hora e quem de cada etapa; a última em curso é desde; o fim mostra até a janela", () => {
    expect(etapasDaFicha(FICHA).map((etapa) => [etapa.rotulo, etapa.hora, etapa.quem, etapa.estado])).toEqual([
      ["Saída do pátio", "07:05", "João Pereira · celular", "feita"],
      ["Chegada na origem", "07:40", "João Pereira · celular", "feita"],
      ["Carregamento", "07:50", "Carlos Silva · celular", "feita"],
      ["Saída da origem", "10:20", "João Pereira · celular", "feita"],
      ["Chegada no destino", "11:05", "escritório · informado por João Pereira · telefone", "feita"],
      ["Montagem", "desde 11:20", "Carlos Silva · celular", "atual"],
      ["Fim", "até 18:00", null, "pendente"],
    ]);
    expect(horaDaEtapa(FICHA, "saida_origem")).toBe("10:20");
    expect(horaDaEtapa(FICHA, "fim")).toBeNull();
  });

  it("a etapa pulada fica com traço", () => {
    const pulada = { ...FICHA, etapas: [FICHA.etapas[0], FICHA.etapas[2]] };
    expect(etapasDaFicha(pulada).slice(0, 3).map((etapa) => [etapa.rotulo, etapa.hora, etapa.estado])).toEqual([
      ["Saída do pátio", "07:05", "feita"],
      ["Chegada na origem", "—", "pulada"],
      ["Carregamento", "desde 07:50", "atual"],
    ]);
  });
});

describe("itens", () => {
  it("o previsto soma o incluído, o feito vira fração e a inclusão vira uma linha", () => {
    const [cadeira, mesa, caixa] = itensDaFicha(FICHA);
    expect(cadeira).toEqual({
      id: "ln_1",
      codigo: "3.05",
      item: "Transporte de cadeira Flexform",
      unidade: "un",
      previsto: "160",
      composicao: "150 + 10",
      feito: "128",
      fracao: 0.8,
      alem: "+10 além do planejado",
      incluidos: [{ texto: "+10 em campo · Carlos Silva · 09:32 · pedido por Renata Campos · Sala 412 · 1 foto" }],
    });
    expect([mesa.previsto, mesa.feito, mesa.composicao, mesa.alem]).toEqual(["60", "22", null, null]);
    expect([caixa.previsto, caixa.feito, caixa.fracao]).toEqual(["95", "0", 0]);
    expect(feitoEm(FICHA)).toBe("14:20");
  });
});

describe("histórico, locais, equipe e veículos", () => {
  it("o histórico junta etapas, inclusões e ocorrências, do mais novo para o mais antigo", () => {
    expect(historicoDaOs(FICHA, HOJE).map((entrada) => [entrada.titulo, entrada.detalhe])).toEqual([
      ["Início da montagem", "Carlos Silva · celular · 11:20"],
      ["Chegada no destino", "escritório · informado por João Pereira · telefone · 11:05"],
      ["Saída da origem", "João Pereira · celular · 10:20"],
      ["+10 Transporte de cadeira Flexform além do planejado", "Carlos Silva · celular · pedido por Renata Campos · 09:32"],
      ["Elevador de carga parado por 20 minutos", "Ocorrência · escritório · informado por Carlos Silva · whatsapp · 08:30"],
      ["Início do carregamento", "Carlos Silva · celular · 07:50"],
      ["Chegada na origem", "João Pereira · celular · 07:40"],
      ["Saída do pátio", "João Pereira · celular · 07:05"],
    ]);
    expect(historicoDaOs(FICHA, "2026-10-23")[0].detalhe).toBe("Carlos Silva · celular · 22/10 11:20");
  });

  it("o Maps abre o destino; a pessoa e o veículo têm o detalhe do vínculo", () => {
    expect(enderecoNoMaps(FICHA)).toBe("https://www.google.com/maps/search/?api=1&query=Av.%20Eng.%20Armando%20de%20Arruda%20Pereira%2C%202937");
    expect(FICHA.equipe.map(detalheDaPessoa)).toEqual(["Líder · no app", "Motorista · no app", "Freelancer · Montador", "Terceiro · Motorista · Rota Sul"]);
    expect(FICHA.veiculos.map(detalheDoVeiculo)).toEqual(["VW Delivery 11.180 · Baú", "Truck · Terceiro · Rota Sul"]);
  });
});
