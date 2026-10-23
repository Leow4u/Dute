import { describe, expect, it } from "vitest";

import { atrasoDaOs, cartaoDaTv, dataDaTv, horaDaTv, painelDaTv, quadroLido, servicoDaOs, type OsDaTv } from "./quadro";

/** O quadro da TV da sala (parte 3.12b): colunas, atraso pelo relógio, indicadores e a próxima saída. */

const AGORA = new Date("2026-10-23T17:32:00.000Z"); // sexta, 14:32 em São Paulo

const BRUTO = {
  hoje: "2026-10-23",
  gerado_em: "2026-10-23T17:31:40.000Z",
  ordens: [
    {
      numero: "10056-01",
      tipo: "servico",
      coluna: "agendada",
      cliente: "Supermercados Boa Vista",
      servicos: ["transporte"],
      rota: "CD Guarulhos → Loja Tatuapé",
      dia: "2026-10-23",
      inicio: "2026-10-23T18:00:00.000Z",
      ate: null,
      etapa: null,
      etapas: { feitas: 0, previstas: 6 },
      concluida_em: null,
      aceite: null,
      equipe: ["João Pereira"],
      placas: ["DEF4G56"],
    },
    {
      numero: "10058-01",
      tipo: "servico",
      coluna: "agendada",
      cliente: "Construtora Horizonte",
      servicos: ["transporte"],
      rota: "Campinas → Osasco",
      dia: "2026-10-23",
      inicio: "2026-10-23T20:00:00.000Z",
      ate: null,
      etapa: null,
      etapas: { feitas: 0, previstas: 6 },
      concluida_em: null,
      aceite: null,
      equipe: ["Pedro Nunes"],
      placas: [],
    },
    {
      numero: "10051-01",
      tipo: "servico",
      coluna: "em_execucao",
      cliente: "Metalúrgica Souza & Filhos",
      servicos: ["transporte"],
      rota: "Guarulhos → Av. Paulista",
      dia: "2026-10-23",
      inicio: "2026-10-23T12:30:00.000Z",
      ate: "2026-10-23T17:00:00.000Z",
      etapa: { etapa: "saida_origem", instante: "2026-10-23T15:10:00.000Z" },
      etapas: { feitas: 4, previstas: 6 },
      concluida_em: null,
      aceite: null,
      equipe: ["João Pereira", "Bruno Teixeira"],
      placas: ["DEF4G56"],
    },
    {
      numero: "10052-01",
      tipo: "servico",
      coluna: "em_execucao",
      cliente: "TechPrime Escritórios",
      servicos: ["desmontagem", "transporte", "montagem"],
      rota: "Barueri → Alphaville",
      dia: "2026-10-23",
      inicio: "2026-10-23T10:00:00.000Z",
      ate: "2026-10-23T21:00:00.000Z",
      etapa: { etapa: "carregamento", instante: "2026-10-23T14:40:00.000Z" },
      etapas: { feitas: 3, previstas: 7 },
      concluida_em: null,
      aceite: null,
      equipe: ["Carlos Silva", "Ana Lima", "Bruno Teixeira"],
      placas: ["GHI7J89", "JKL0M12"],
    },
    {
      numero: "10047-01",
      tipo: "servico",
      coluna: "concluida",
      cliente: "Padaria Pão Nosso",
      servicos: ["transporte"],
      rota: "São Paulo → Guarulhos",
      dia: "2026-10-23",
      inicio: "2026-10-23T11:00:00.000Z",
      ate: null,
      etapa: { etapa: "fim", instante: "2026-10-23T15:40:00.000Z" },
      etapas: { feitas: 6, previstas: 6 },
      concluida_em: "2026-10-23T15:40:00.000Z",
      aceite: "assinatura",
      equipe: ["Rafael Costa"],
      placas: ["MNO3P45"],
    },
    {
      numero: "10060-01",
      tipo: "vistoria",
      coluna: "concluida",
      cliente: "Itaú Unibanco",
      servicos: ["vistoria"],
      rota: "CEIC",
      dia: "2026-10-23",
      inicio: null,
      ate: null,
      etapa: { etapa: "fim", instante: "2026-10-23T13:10:00.000Z" },
      etapas: { feitas: 3, previstas: 3 },
      concluida_em: "2026-10-23T13:10:00.000Z",
      aceite: null,
      equipe: ["Ana Lima"],
      placas: [],
    },
    { numero: "lixo", coluna: "agendada" },
    { numero: "10070-01", coluna: "outra" },
  ],
};

function quadro() {
  const lido = quadroLido(BRUTO);
  if (!lido) throw new Error("quadro ilegível");
  return lido;
}

function os(numero: string): OsDaTv {
  const achada = quadro().ordens.find((item) => item.numero === numero);
  if (!achada) throw new Error(numero);
  return achada;
}

describe("o quadro lido", () => {
  it("lê o que a callable devolve e deixa de fora a OS que não se lê", () => {
    const lido = quadro();
    expect(lido.geradoEm).toBe("2026-10-23T17:31:40.000Z");
    expect(lido.ordens.map((item) => item.numero)).toEqual(["10056-01", "10058-01", "10051-01", "10052-01", "10047-01", "10060-01"]);
    expect(quadroLido(null)).toBeNull();
    expect(quadroLido({ ordens: [] })).toBeNull();
  });
});

describe("o relógio", () => {
  it("a data por extenso e a hora de São Paulo", () => {
    expect(dataDaTv(AGORA)).toBe("Sexta-feira, 23 de outubro");
    expect(horaDaTv(AGORA)).toBe("14:32");
  });
});

describe("o cartão", () => {
  it("a agendada: hora, cliente, serviço e rota, equipe e placa; sem veículo no transporte", () => {
    expect(cartaoDaTv(os("10056-01"), AGORA)).toMatchObject({
      numero: "10056-01",
      hora: "15:00",
      cliente: "Supermercados Boa Vista",
      icone: "transporte",
      descricao: "Transporte · CD Guarulhos → Loja Tatuapé",
      equipe: "João Pereira",
      iniciais: "JP",
      placa: "DEF-4G56",
      selo: null,
      atrasada: false,
      etapa: null,
      progresso: null,
    });
    expect(cartaoDaTv(os("10058-01"), AGORA).selo).toEqual({ texto: "Sem veículo", tom: "alerta" });
    expect(cartaoDaTv({ ...os("10058-01"), equipe: [] }, AGORA).selo).toEqual({ texto: "Sem equipe", tom: "alerta" });
    // A vistoria e a montagem no local não pedem veículo.
    expect(cartaoDaTv({ ...os("10058-01"), servicos: ["montagem"] }, AGORA).selo).toBeNull();
  });

  it("a em execução: o prazo, a última etapa e o progresso; passou do prazo, atrasada", () => {
    const atrasada = cartaoDaTv(os("10051-01"), AGORA);
    expect(atrasada).toMatchObject({
      hora: "09:30",
      descricao: "Transporte · Guarulhos → Av. Paulista · até 14:00",
      selo: { texto: "Atrasada 32 min", tom: "critico" },
      atrasada: true,
      etapa: "Saída da origem · 12:10",
      progresso: { feitas: 4, previstas: 6 },
      equipe: "João Pereira + 1",
    });
    const noPrazo = cartaoDaTv(os("10052-01"), AGORA);
    expect(noPrazo).toMatchObject({
      descricao: "Desmontagem, transporte e montagem · Barueri → Alphaville · até 18:00",
      selo: null,
      icone: "transporte",
      equipe: "Carlos Silva + 2",
      placa: "GHI-7J89 + 1",
    });
  });

  it("a concluída: a hora do Fim; assinada, concluída sem aceite e a vistoria enviada", () => {
    expect(cartaoDaTv(os("10047-01"), AGORA)).toMatchObject({ hora: "12:40", selo: { texto: "Assinada", tom: "ok" }, descricao: "Transporte · São Paulo → Guarulhos", etapa: null, progresso: null });
    expect(cartaoDaTv({ ...os("10047-01"), aceite: "sem_aceite" }, AGORA).selo).toEqual({ texto: "Concluída", tom: "ok" });
    expect(cartaoDaTv(os("10060-01"), AGORA)).toMatchObject({ hora: "10:10", icone: "vistoria", descricao: "Vistoria · CEIC", selo: { texto: "Enviada ao Comercial", tom: "ok" } });
  });

  it("o atraso: a agendada que passou da hora ou do dia; a concluída nunca atrasa", () => {
    expect(atrasoDaOs({ ...os("10056-01"), inicio: "2026-10-23T17:00:00.000Z" }, AGORA)).toBe("Atrasada 32 min");
    expect(atrasoDaOs({ ...os("10056-01"), dia: "2026-10-22", inicio: null }, AGORA)).toBe("Atrasada desde 22/10");
    expect(atrasoDaOs({ ...os("10056-01"), inicio: null }, AGORA)).toBeNull();
    expect(atrasoDaOs({ ...os("10047-01"), ate: "2026-10-23T12:00:00.000Z" }, AGORA)).toBeNull();
    expect(cartaoDaTv({ ...os("10056-01"), dia: "2026-10-22", inicio: null }, AGORA).hora).toBe("22/10");
    expect(cartaoDaTv({ ...os("10056-01"), inicio: null }, AGORA).hora).toBe("Sem hora");
  });

  it("o serviço por extenso", () => {
    expect(servicoDaOs({ tipo: "servico", servicos: ["montagem"] })).toBe("Montagem");
    expect(servicoDaOs({ tipo: "servico", servicos: [] })).toBe("Serviço");
    expect(servicoDaOs({ tipo: "vistoria", servicos: ["vistoria"] })).toBe("Vistoria");
  });
});

describe("o painel", () => {
  it("as colunas com a atrasada no topo, os indicadores e a próxima saída", () => {
    const painel = painelDaTv(quadro(), AGORA);
    expect(painel.agendadas.map((cartao) => cartao.numero)).toEqual(["10056-01", "10058-01"]);
    expect(painel.emExecucao.map((cartao) => cartao.numero)).toEqual(["10051-01", "10052-01"]);
    expect(painel.concluidas.map((cartao) => cartao.numero)).toEqual(["10047-01", "10060-01"]);
    expect(painel.indicadores).toEqual({ total: 6, agendadas: 2, emExecucao: 2, concluidas: 2, atrasadas: 1 });
    expect(painel.proximaSaida).toEqual({ hora: "15:00", cliente: "Supermercados Boa Vista" });
  });

  it("o relógio anda: a agendada das 15:00 atrasa às 15:05 e a próxima saída passa para a das 17:00", () => {
    const depois = painelDaTv(quadro(), new Date("2026-10-23T18:05:00.000Z"));
    expect(depois.agendadas[0]).toMatchObject({ numero: "10056-01", selo: { texto: "Atrasada 5 min", tom: "critico" } });
    expect(depois.indicadores.atrasadas).toBe(2);
    expect(depois.proximaSaida).toEqual({ hora: "17:00", cliente: "Construtora Horizonte" });
    expect(painelDaTv(quadro(), new Date("2026-10-23T21:00:00.000Z")).proximaSaida).toBeNull();
  });
});
