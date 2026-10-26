import { describe, expect, it } from "vitest";

import { fichaDaLeitura, type FichaDaOs } from "../operacao/ficha-da-os";
import { adiado, avisoDaFila, destinoDoErro, enfileirar, esperaDaTentativa, faltaParaEnviar, registroNovo, type RegistroNaFila } from "./fila";
import {
  acaoDaEtapa,
  duracaoDesde,
  equipeNoCampo,
  etapasNoCampo,
  feitoDepoisDoToque,
  inclusoesGuardadas,
  itensNoCampo,
  minhasOs,
  problemasDaInclusao,
  registroDeEtapa,
  registroDeFeito,
  registroDeFoto,
  registroDeInclusao,
  registroDePresenca,
  saudacao,
} from "./os-no-campo";

/** O app do campo (parte 3.8b, docs/mockups/Campo2Hoje.dc.html e Campo2Execucao.dc.html). */

const HOJE = "2026-10-20";
const AGORA = new Date("2026-10-20T12:28:00.000Z"); // 09:28 em São Paulo
const CARLOS = "col_cccccccccccccccc";
const RAFAEL = "col_rrrrrrrrrrrrrrrr";
const DIEGO = "col_dddddddddddddddd";

function ficha(numero: string, extra: Record<string, unknown> = {}): FichaDaOs {
  return fichaDaLeitura(numero, {
    status: "agendada",
    edicao: 3,
    demanda: numero.slice(0, 5),
    customer_code: "ITAU",
    cliente_nome: "Itaú Unibanco",
    servicos: ["transporte", "montagem"],
    janela: { data: HOJE, inicio: "07:30", fim: "18:00" },
    locais: {
      origem: { nome: "Faria Lima", endereco: "Faria Lima 3500", complemento: "4º andar" },
      destino: { nome: "Centro Empresarial", endereco: "Torre B", complemento: "12º andar" },
    },
    equipe: [
      { colaborador_id: CARLOS, nome: "Carlos Silva", papel: "lider", vinculo: "proprio", no_app: true, usuario_uid: "uid-carlos" },
      { colaborador_id: RAFAEL, nome: "Rafael Costa", papel: "montador", vinculo: "proprio", no_app: true, usuario_uid: "uid-rafael" },
      { colaborador_id: DIEGO, nome: "Diego Alves", papel: "montador", vinculo: "freelancer" },
    ],
    veiculos: [
      { veiculo_id: "vei_a", placa: "DEF4G56", tipo: "Baú", dono: "proprio" },
      { veiculo_id: "vei_b", placa: "FGH2B34", tipo: "Truck", dono: "terceiro", empresa: "Rota Sul" },
    ],
    itens: [
      { id: "ln_1", codigo: "3.05", item: "Cadeira Flexform", servico: "Transporte", unidade: "UN", planejado: "150", executado: "96" },
      { id: "ln_2", codigo: "2.02", item: "Mesa de trabalho", servico: "Montagem", unidade: "UN", planejado: "60" },
    ],
    ...extra,
  }) as FichaDaOs;
}

const EM_EXECUCAO = ficha("10211-01", {
  status: "em_execucao",
  etapas: [
    { etapa: "saida_patio", instante: "2026-10-20T10:05:00.000Z" },
    { etapa: "chegada_origem", instante: "2026-10-20T10:40:00.000Z" },
    { etapa: "carregamento", instante: "2026-10-20T10:50:00.000Z" },
  ],
  presencas: [{ colaborador_id: CARLOS, entrada: { instante: "2026-10-20T10:30:00.000Z" } }],
});

function naFila(novo: ReturnType<typeof registroDeEtapa>, chave: string): RegistroNaFila {
  return registroNovo(novo, chave, AGORA);
}

describe("Minhas OS", () => {
  it("saudação com o dia e o primeiro nome", () => {
    expect(saudacao("Carlos Silva", HOJE)).toEqual({ dia: "Terça, 20 de outubro", ola: "Olá, Carlos" });
    expect(saudacao(null, HOJE).ola).toBe("Olá");
  });

  it("agora, depois e feito, com o nome do cliente, a etapa em curso, o local e a frota", () => {
    const lista = minhasOs(
      [
        ficha("10214-01", { janela: { data: "2026-10-22", inicio: "19:00" } }),
        EM_EXECUCAO,
        ficha("10210-01", { status: "revisada", janela: { data: "2026-10-17", inicio: "08:00" } }),
        ficha("10216-01", { janela: { data: HOJE, inicio: "16:00" } }),
        ficha("10200-01", { status: "revisada", janela: { data: "2026-10-01" } }),
        ficha("10209-01", { status: "cancelada" }),
      ],
      HOJE,
    );
    expect(lista.agora.map((cartao) => [cartao.numero, cartao.quando])).toEqual([
      ["10211-01", "Carregamento desde 07:50"],
      ["10216-01", "Hoje 16:00"],
    ]);
    expect(lista.agora[0]).toMatchObject({
      cliente: "Itaú Unibanco",
      servicos: "Transporte e montagem",
      local: "Faria Lima 3500 · 4º andar",
      destino: "Torre B · 12º andar",
      equipe: 3,
      placas: ["DEF-4G56", "FGH-2B34 · Rota Sul"],
    });
    expect(lista.depois.map((cartao) => [cartao.numero, cartao.quando, cartao.hora])).toEqual([["10214-01", "qui 22/10", "19:00"]]);
    expect(lista.feito.map((cartao) => cartao.numero)).toEqual(["10210-01"]);
  });
});

describe("etapas no celular", () => {
  it("a próxima vem depois da última; a guardada na fila aparece e empurra a próxima", () => {
    const sem = etapasNoCampo(EM_EXECUCAO, []);
    expect(sem.proxima).toBe("saida_origem");
    expect(sem.outras).toEqual(["chegada_destino", "montagem", "fim"]);
    expect(acaoDaEtapa("saida_origem")).toBe("Registrar saída da origem");
    expect(duracaoDesde(sem.desde, AGORA)).toBe("2h 23min");

    const guardada = naFila(registroDeEtapa(EM_EXECUCAO, "saida_origem", new Date("2026-10-20T13:20:00.000Z")), "k1");
    const com = etapasNoCampo(EM_EXECUCAO, [guardada]);
    expect(com.etapas.map((etapa) => [etapa.rotulo, etapa.hora, etapa.estado])).toEqual([
      ["Saída do pátio", "07:05", "feita"],
      ["Chegada na origem", "07:40", "feita"],
      ["Carregamento", "07:50", "feita"],
      ["Saída da origem", "10:20", "guardada"],
      ["Chegada no destino", null, "pendente"],
      ["Montagem", null, "pendente"],
      ["Fim", null, "pendente"],
    ]);
    expect(com.proxima).toBe("chegada_destino");
    // O registro de outra OS não entra.
    expect(etapasNoCampo(ficha("10216-01"), [guardada]).proxima).toBe("saida_patio");
  });

  it("o registro da etapa leva o instante do toque", () => {
    expect(registroDeEtapa(EM_EXECUCAO, "saida_origem", AGORA)).toEqual({
      callable: "registerStep",
      dados: { numero: "10211-01", etapa: "saida_origem", instante: "2026-10-20T12:28:00.000Z" },
      rotulo: "Saída da origem",
    });
  });
});

describe("itens no celular", () => {
  it("o feito sobe e desce por toque, até o previsto; o guardado aparece por cima", () => {
    const [cadeira] = itensNoCampo(EM_EXECUCAO, []);
    expect([cadeira.feito, cadeira.previsto, cadeira.guardado]).toEqual([96_000, 150_000, false]);
    expect(feitoDepoisDoToque(cadeira, 1)).toBe(97_000);
    expect(feitoDepoisDoToque({ feito: 150_000, previsto: 150_000 }, 1)).toBe(150_000);
    expect(feitoDepoisDoToque({ feito: 0, previsto: 150_000 }, -1)).toBe(0);
    const toque = registroDeFeito(EM_EXECUCAO, cadeira, 97_000, AGORA);
    expect(toque).toEqual({
      callable: "registerItem",
      dados: { action: "executed", numero: "10211-01", linha: "ln_1", executado: "97", instante: "2026-10-20T12:28:00.000Z" },
      grupo: "feito:10211-01:ln_1",
      rotulo: "Cadeira Flexform",
    });
    const [comGuardado] = itensNoCampo(EM_EXECUCAO, [naFila(toque, "k2")]);
    expect([comGuardado.feito, comGuardado.guardado]).toEqual([97_000, true]);
  });

  it("a inclusão guardada soma ao previsto e ao feito da linha", () => {
    const inclusao = registroDeInclusao(EM_EXECUCAO, { tipo: "linha", linha: "ln_1", nome: "Cadeira Flexform" }, "10", "Renata Campos", "Sala 412", AGORA);
    expect(inclusao.dados).toEqual({
      action: "added",
      numero: "10211-01",
      linha: "ln_1",
      quantidade: "10",
      pedido_por: "Renata Campos",
      motivo: "Sala 412",
      instante: "2026-10-20T12:28:00.000Z",
    });
    const [cadeira] = itensNoCampo(EM_EXECUCAO, [naFila(inclusao, "k3")]);
    expect([cadeira.feito, cadeira.previsto]).toEqual([106_000, 160_000]);
    expect(registroDeInclusao(EM_EXECUCAO, { tipo: "avulso", nome: "Retirada de entulho", unidade: "vb" }, "1", "Renata", "Pedido no local", AGORA).dados).toMatchObject({ item: "Retirada de entulho", unidade: "VB" });
    expect(registroDeInclusao(EM_EXECUCAO, { tipo: "catalogo", lpuItemId: "lpu_giratoria", nome: "Cadeira giratória" }, "4", "Renata", "Sala 412", AGORA).dados).toMatchObject({ lpu_item_id: "lpu_giratoria" });
    expect(problemasDaInclusao(null, "0", "", "")).toEqual(["Escolha o item.", "Informe a quantidade.", "Informe quem pediu no local.", "Informe o motivo."]);
  });

  it("a inclusão guardada depois do feito guardado entra no número, e o toque seguinte não a apaga", () => {
    // Cadeira: 150 previstas e 96 gravadas, sem sinal. O + guarda 97, e a inclusão de 10 vem depois.
    const [cadeira] = itensNoCampo(EM_EXECUCAO, []);
    const feito = naFila(registroDeFeito(EM_EXECUCAO, cadeira, 97_000, AGORA), "k-f1");
    const inclusao = naFila(registroDeInclusao(EM_EXECUCAO, { tipo: "linha", linha: "ln_1", nome: "Cadeira Flexform" }, "10", "Renata Campos", "Sala 412", AGORA), "k-i");
    const [depois] = itensNoCampo(EM_EXECUCAO, [feito, inclusao]);
    expect([depois.feito, depois.previsto]).toEqual([107_000, 160_000]);

    // O toque seguinte manda 108: substitui o 97 e vai depois da inclusão, e o servidor grava 106 e depois 108.
    const proximo = feitoDepoisDoToque(depois, 1);
    expect(proximo).toBe(108_000);
    const fila = enfileirar([feito, inclusao], naFila(registroDeFeito(EM_EXECUCAO, depois, proximo, AGORA), "k-f2"));
    expect(fila.map((registro) => registro.chave)).toEqual(["k-i", "k-f2"]);
    expect(itensNoCampo(EM_EXECUCAO, fila)[0].feito).toBe(108_000);

    // A inclusão guardada antes do feito já está nele, que é absoluto.
    expect(itensNoCampo(EM_EXECUCAO, [inclusao, naFila(registroDeFeito(EM_EXECUCAO, depois, 107_000, AGORA), "k-f3")])[0].feito).toBe(107_000);
  });
});

describe("a inclusão guardada de um item que a OS não tem (pergunta 65)", () => {
  const CATALOGO = [{ id: "lpu_divisoria", item: "Divisória", servico: "Montagem", unidade: "UN" }];
  const incluir = (inclusao: Parameters<typeof registroDeInclusao>[1], quantidade: string, chave: string, quando = AGORA) =>
    registroNovo(registroDeInclusao(EM_EXECUCAO, inclusao, quantidade, "Renata Campos", "Sala 412", quando), chave, quando);
  const DIVISORIA = { tipo: "catalogo", lpuItemId: "lpu_divisoria", nome: "Divisória" } as const;
  const SUPORTE = { tipo: "avulso", nome: "Suporte de monitor", unidade: "un" } as const;

  it("vira linha nova com a quantidade e a hora em que foi guardada; não mexe nas linhas da OS", () => {
    const pendentes = [incluir(DIVISORIA, "4", "k-1"), incluir(SUPORTE, "2", "k-2")];
    expect(inclusoesGuardadas(EM_EXECUCAO, pendentes, CATALOGO)).toEqual([
      { chave: "k-1", item: "Divisória", detalhe: "Montagem", quantidade: 4_000, unidade: "un", hora: "09:28" },
      { chave: "k-2", item: "Suporte de monitor", detalhe: "Item avulso", quantidade: 2_000, unidade: "un", hora: "09:28" },
    ]);
    expect(itensNoCampo(EM_EXECUCAO, pendentes)).toEqual(itensNoCampo(EM_EXECUCAO, []));
  });

  it("as do mesmo item do catálogo somam numa linha, com a hora da última; cada avulso é uma linha", () => {
    const depois = new Date("2026-10-20T12:40:00.000Z"); // 09:40
    const pendentes = [incluir(DIVISORIA, "4", "k-1"), incluir(SUPORTE, "2", "k-2"), incluir(DIVISORIA, "4", "k-3", depois), incluir(SUPORTE, "1", "k-4", depois)];
    expect(inclusoesGuardadas(EM_EXECUCAO, pendentes, CATALOGO).map((linha) => [linha.item, linha.quantidade, linha.hora])).toEqual([
      ["Divisória", 8_000, "09:40"],
      ["Suporte de monitor", 2_000, "09:28"],
      ["Suporte de monitor", 1_000, "09:40"],
    ]);
  });

  it("a do item que a OS já tem soma na linha dela; a de linha da OS e a de outra OS não viram linha", () => {
    const comDivisoria = ficha("10211-01", {
      status: "em_execucao",
      itens: [{ id: "ln_3", lpu_item_id: "lpu_divisoria", item: "Divisória", servico: "Montagem", unidade: "UN", planejado: "10", executado: "6" }],
    });
    const pendentes = [incluir(DIVISORIA, "4", "k-1"), incluir({ tipo: "linha", linha: "ln_1", nome: "Cadeira Flexform" }, "2", "k-2")];
    expect(inclusoesGuardadas(comDivisoria, pendentes, CATALOGO)).toEqual([]);
    const [divisoria] = itensNoCampo(comDivisoria, pendentes);
    expect([divisoria.feito, divisoria.previsto, divisoria.guardado]).toEqual([10_000, 14_000, true]);
    expect(inclusoesGuardadas(ficha("10212-01", { status: "em_execucao" }), pendentes, CATALOGO)).toEqual([]);
  });

  it("sem o item no catálogo carregado, a linha aparece mesmo assim", () => {
    expect(inclusoesGuardadas(EM_EXECUCAO, [incluir(DIVISORIA, "4", "k-1")], [])).toEqual([
      { chave: "k-1", item: "Item do catálogo", detalhe: null, quantidade: 4_000, unidade: "", hora: "09:28" },
    ]);
  });
});

describe("equipe no celular", () => {
  it("o líder marca todos; o montador só a própria; a presença guardada aparece", () => {
    const doLider = equipeNoCampo(EM_EXECUCAO, [], "uid-carlos");
    expect(doLider.map((pessoa) => [pessoa.nome, pessoa.detalhe, pessoa.entrada, pessoa.podeMarcar, pessoa.souEu])).toEqual([
      ["Carlos Silva", "Líder", "07:30", true, true],
      ["Rafael Costa", "Montador", null, true, false],
      ["Diego Alves", "Freelancer · Montador", null, true, false],
    ]);
    const doMontador = equipeNoCampo(EM_EXECUCAO, [naFila(registroDePresenca(EM_EXECUCAO, { id: RAFAEL, nome: "Rafael Costa" }, "entrada", AGORA), "k4")], "uid-rafael");
    expect(doMontador.map((pessoa) => [pessoa.nome, pessoa.entrada, pessoa.podeMarcar])).toEqual([
      ["Carlos Silva", "07:30", false],
      ["Rafael Costa", "09:28", true],
      ["Diego Alves", null, false],
    ]);
  });
});

describe("foto", () => {
  it("sobe ao caminho da OS e anexa com o instante da foto", () => {
    const arquivo = new Blob(["x"], { type: "image/jpeg" });
    const registro = registroDeFoto(EM_EXECUCAO, { arquivo, nome: "ft_0123456789abcdef.jpg", contentType: "image/jpeg", instante: "2026-10-20T12:20:00.000Z" }, { legenda: "Carga", etapa: "carregamento" });
    expect(registro.foto?.caminho).toBe("os/10211-01/fotos/ft_0123456789abcdef.jpg");
    expect(registro.dados).toEqual({ numero: "10211-01", arquivo: "ft_0123456789abcdef.jpg", instante: "2026-10-20T12:20:00.000Z", legenda: "Carga", etapa: "carregamento" });
  });
});

describe("a fila", () => {
  it("cada registro leva a própria chave; do mesmo grupo, só o último espera (menos o que está indo)", () => {
    const um = naFila(registroDeFeito(EM_EXECUCAO, { id: "ln_1", item: "Cadeira" }, 97_000, AGORA), "k-a");
    const dois = naFila(registroDeFeito(EM_EXECUCAO, { id: "ln_1", item: "Cadeira" }, 98_000, AGORA), "k-b");
    const etapa = naFila(registroDeEtapa(EM_EXECUCAO, "saida_origem", AGORA), "k-c");
    expect(um.dados.idempotency_key).toBe("k-a");
    expect(enfileirar(enfileirar([um], etapa), dois).map((registro) => registro.chave)).toEqual(["k-c", "k-b"]);
    expect(enfileirar([um], dois, "k-a").map((registro) => registro.chave)).toEqual(["k-a", "k-b"]);
  });

  it("sem sinal tenta de novo com espera crescente; recusado pela callable, desiste", () => {
    expect(destinoDoErro({ code: "unavailable" })).toBe("tentar_de_novo");
    expect(destinoDoErro(new Error("Failed to fetch"))).toBe("tentar_de_novo");
    expect(destinoDoErro({ code: "failed-precondition" })).toBe("desistir");
    expect(destinoDoErro({ code: "functions/permission-denied" })).toBe("desistir");
    // Logada, a chamada sem o token é renovação que falhou por rede: espera.
    expect(destinoDoErro({ code: "functions/unauthenticated" })).toBe("tentar_de_novo");
    expect(destinoDoErro({ code: "unauthenticated" })).toBe("tentar_de_novo");
    expect([1, 2, 3, 10].map(esperaDaTentativa)).toEqual([2_000, 4_000, 8_000, 60_000]);
    const registro = adiado(naFila(registroDeEtapa(EM_EXECUCAO, "saida_origem", AGORA), "k-d"), AGORA);
    expect(registro.tentativas).toBe(1);
    expect(faltaParaEnviar(registro, AGORA)).toBe(2_000);
    expect(faltaParaEnviar(registro, new Date(AGORA.getTime() + 5_000))).toBe(0);
  });

  it("o aviso é dado: sem sinal e quantos esperam", () => {
    expect(avisoDaFila(0, true)).toBeNull();
    expect(avisoDaFila(0, false)).toBe("Sem sinal");
    expect(avisoDaFila(4, false)).toBe("Sem sinal · 4 registros guardados");
    expect(avisoDaFila(1, true)).toBe("Enviando · 1 registro guardado");
  });
});
