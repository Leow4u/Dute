import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import type { ColaboradorGravado, VeiculoGravado } from "./cadastro.js";
import {
  agendada,
  cancelada,
  comContatos,
  comItens,
  deMilesimos,
  emMilesimos,
  enderecoEmLinha,
  equipeComLogin,
  equipeDaOs,
  exigirCancelavel,
  exigirPlanejavel,
  fatiaDoSaldo,
  interpretarOs,
  itensSemPreco,
  localDaOs,
  novaOs,
  numeroDaOs,
  osLida,
  problemaDaData,
  problemaParaAbrirOs,
  problemaParaAgendarOs,
  proximaSequencia,
  saldoDoEscopo,
  servicosDosItens,
  todoOSaldo,
  ultimaSequencia,
  veiculosDaOs,
  type ItemDaOs,
  type OsGravada,
} from "./os.js";

/**
 * A OS (docs/plataforma/fase-3-operacao.md, partes 2 e 3.4b). O número é o da
 * demanda com o sufixo (10045-01). Os itens saem da revisão fechada, sem
 * preço; cada OS leva uma fatia do saldo, e a soma das fatias nunca passa do
 * escopo.
 */

const LINHA = {
  id: "ln_1",
  lpu_item_id: "lpu_mesa",
  codigo: "DTL-10",
  item: "Estação",
  descricao: "Montagem de estação",
  servico: "Montagem",
  unidade: "UN",
  quantidade: "60",
  preco: "88.50",
  preco_tabela: "80.00",
  preco_anterior: "70.00",
  origem: "alterado",
  motivo: "negociado",
  origem_local: "loc_a",
  destino_local: "loc_b",
  total_cents: 17700,
};

const CADEIRA = { ...LINHA, id: "ln_2", codigo: "3.05", item: "Cadeira Flexform", descricao: "Transporte de cadeira", servico: "Transporte", quantidade: "160.5" };

const DEMANDA = {
  customer_code: "ITAU",
  escopo_rv: 0,
  executado_de: null,
  perda: null,
  cancelamento: null,
  validacao: null,
  origem: { local_id: "loc_ceic", complemento: "portaria" },
  destino: { local_id: "loc_faria", complemento: null },
  customer_name: "Itaú Unibanco",
};

const ORCAMENTO = { status: "enviado", rv: 0, customer_code: "ITAU" };

const ANA: ColaboradorGravado = {
  id: "col_aaaaaaaaaaaaaaaa",
  nome: "Ana Souza",
  cpf: "52998224725",
  funcao: "Motorista",
  telefone: null,
  cnh: { categoria: "C", validade: "2028-04-01" },
  vinculo: "proprio",
  empresa: null,
  papeis: ["motorista", "lider"],
  usuario_uid: "uid-ana",
  usuario_email: "ana@dutelog.com.br",
  ativo: true,
  edicao: 3,
};

const VALTER: ColaboradorGravado = {
  ...ANA,
  id: "col_bbbbbbbbbbbbbbbb",
  nome: "Valter Moreira",
  cpf: "11144477735",
  vinculo: "terceiro",
  empresa: "Rota Sul",
  papeis: [],
  usuario_uid: null,
  usuario_email: null,
};

const VAN: VeiculoGravado = {
  id: "vei_aaaaaaaaaaaaaaaa",
  placa: "DEF4G56",
  tipo: "Baú",
  modelo: "VW Delivery",
  capacidade_kg: 5000,
  capacidade_m3: 30,
  dono: "proprio",
  empresa: null,
  revisao_em: null,
  ativo: true,
  edicao: 1,
};

function rejeita(fn: () => unknown): HttpsError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    return error;
  }
  assert.fail("deveria recusar");
}

const ESCOPO = itensSemPreco([LINHA, CADEIRA]);

function os(parcial: Partial<OsGravada> = {}): OsGravada {
  return {
    ...novaOs({
      numero: "10045-01",
      demanda: "10045",
      seq: 1,
      customer_code: "ITAU",
      cliente_nome: "Itaú Unibanco",
      escopo_rv: 0,
      itens: ESCOPO,
      locais: { origem: null, destino: null },
      janela: null,
      equipe: [],
      equipe_uids: [],
      veiculos: [],
      instrucoes: null,
    }),
    ...parcial,
  };
}

/** Toda chave do documento, em qualquer nível. */
function chaves(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.flatMap(chaves);
  if (!valor || typeof valor !== "object") return [];
  return Object.entries(valor).flatMap(([chave, filho]) => [chave, ...chaves(filho)]);
}

describe("abrir OS a partir da demanda", () => {
  it("Para planejar, com a RV fechada igual à em curso, pode abrir", () => {
    assert.equal(problemaParaAbrirOs(DEMANDA, ORCAMENTO), null);
  });

  it("com um aditivo em negociação, o escopo fechado continua recebendo OS", () => {
    assert.equal(problemaParaAbrirOs(DEMANDA, { ...ORCAMENTO, status: "rascunho", rv: 1 }), null);
    assert.equal(problemaParaAbrirOs(DEMANDA, { ...ORCAMENTO, status: "para_aprovar", rv: 1 }), null);
  });

  it("recusa demanda que saiu de Para planejar, sem revisão ou de outro cliente", () => {
    assert.match(problemaParaAbrirOs(DEMANDA, null) ?? "", /orçamento/);
    assert.match(problemaParaAbrirOs(DEMANDA, { ...ORCAMENTO, status: "rascunho" }) ?? "", /Para planejar/);
    assert.match(problemaParaAbrirOs({ ...DEMANDA, escopo_rv: null }, ORCAMENTO) ?? "", /Para planejar/);
    assert.match(problemaParaAbrirOs({ ...DEMANDA, escopo_rv: 1 }, ORCAMENTO) ?? "", /Para planejar/);
    assert.match(problemaParaAbrirOs({ ...DEMANDA, executado_de: "2026-10-16" }, ORCAMENTO) ?? "", /Para planejar/);
    assert.match(problemaParaAbrirOs({ ...DEMANDA, perda: { motivo: "preco" } }, ORCAMENTO) ?? "", /Para planejar/);
    assert.match(problemaParaAbrirOs({ ...DEMANDA, cancelamento: { motivo: "cliente" } }, { ...ORCAMENTO, rv: 1, status: "rascunho" }) ?? "", /Para planejar/);
    assert.match(problemaParaAbrirOs({ ...DEMANDA, validacao: { rv: 0, etapa: "a_faturar" } }, ORCAMENTO) ?? "", /Para planejar/);
    assert.match(problemaParaAbrirOs(DEMANDA, { ...ORCAMENTO, customer_code: "SAFRA" }) ?? "", /cliente/);
  });

  it("o número é o da demanda com o sufixo, e a sequência segue o contador", () => {
    assert.equal(numeroDaOs("10045", 1), "10045-01");
    assert.equal(numeroDaOs("10045", 12), "10045-12");
    assert.equal(proximaSequencia(undefined), 1);
    assert.equal(proximaSequencia(0), 1);
    assert.equal(proximaSequencia(2), 3);
    assert.throws(() => proximaSequencia(99), /sequência/);
    assert.throws(() => numeroDaOs("1045", 1), /demanda/);
  });

  it("o contador atrasado ou ausente não repete o número de uma OS que existe", () => {
    assert.equal(ultimaSequencia(undefined, []), 0);
    assert.equal(ultimaSequencia(1, [{ seq: 1 }, { seq: 3 }]), 3);
    assert.equal(ultimaSequencia(5, [{ seq: 2 }]), 5);
    assert.throws(() => ultimaSequencia("2", []), /contador/);
  });
});

describe("itens da OS sem preço", () => {
  it("copia o serviço e descarta preço, motivo e ajuste", () => {
    const itens = itensSemPreco([
      LINHA,
      { id: "ln_aj", origem: "ajuste", item: "Ajuste comercial", descricao: "Ajuste comercial", quantidade: "1", preco: "-10.00", total_cents: -1000 },
    ]);
    assert.equal(itens.length, 1);
    assert.deepEqual(itens[0], {
      id: "ln_1",
      lpu_item_id: "lpu_mesa",
      codigo: "DTL-10",
      item: "Estação",
      descricao: "Montagem de estação",
      servico: "Montagem",
      unidade: "UN",
      planejado: "60",
      origem_local: "loc_a",
      destino_local: "loc_b",
    });
    const texto = JSON.stringify(itens);
    for (const proibido of ["88.50", "17700", "negociado", "Ajuste"]) assert.equal(texto.includes(proibido), false, proibido);
  });

  it("item avulso entra sem preço; revisão sem serviço ou com quantidade fora do formato é recusada", () => {
    const avulso = itensSemPreco([
      { id: "ln_3", origem: "avulso", lpu_item_id: null, item: "Frete extra", descricao: "Frete extra", quantidade: "1", preco: "200.00", total_cents: 20000 },
    ]);
    assert.equal(avulso[0].lpu_item_id, null);
    assert.equal(JSON.stringify(avulso).includes("200.00"), false);
    assert.equal(rejeita(() => itensSemPreco([{ id: "ln_2", origem: "ajuste", item: "Ajuste", quantidade: "1", preco: "-1.00" }])).code, "failed-precondition");
    assert.match(rejeita(() => itensSemPreco([{ ...LINHA, quantidade: "1,5" }])).message, /formato/);
  });
});

describe("quantidade em milésimos", () => {
  it("converte ida e volta sem perder casa", () => {
    for (const [texto, milesimos] of [["0", 0], ["2", 2000], ["12.5", 12500], ["160.25", 160250], ["0.001", 1], ["999999999.999", 999999999999]] as const) {
      assert.equal(emMilesimos(texto), milesimos, texto);
      assert.equal(deMilesimos(milesimos), texto === "0" ? "0" : texto, texto);
    }
    for (const ruim of ["1,5", "1.2345", "-1", "", "abc", "1e3"]) assert.equal(emMilesimos(ruim), null, ruim);
    assert.equal(deMilesimos(1500), "1.5");
  });
});

describe("saldo do escopo", () => {
  it("desconta as OS que existem, devolve a cancelada e ignora a linha fora do escopo", () => {
    const saldo = saldoDoEscopo(ESCOPO, [
      { numero: "10045-01", status: "agendada", itens: [{ id: "ln_1", planejado: "20" }, { id: "ln_x", planejado: "5" }] },
      { numero: "10045-02", status: "cancelada", itens: [{ id: "ln_1", planejado: "40" }] },
      { numero: "10045-03", status: "aberta", itens: [{ id: "ln_2", planejado: "60.5" }] },
    ]);
    assert.deepEqual([...saldo], [["ln_1", 40000], ["ln_2", 100000]]);
    const semA01 = saldoDoEscopo(ESCOPO, [{ numero: "10045-01", status: "agendada", itens: [{ id: "ln_1", planejado: "20" }] }], "10045-01");
    assert.equal(semA01.get("ln_1"), 60000);
  });

  it("duas OS do mesmo planejamento somam no máximo o saldo", () => {
    const saldo = saldoDoEscopo(ESCOPO, []);
    const primeira = fatiaDoSaldo(ESCOPO, saldo, [{ id: "ln_1", planejado: "30" }, { id: "ln_2", planejado: "160.5" }]);
    assert.deepEqual(primeira.map((item) => [item.id, item.planejado]), [["ln_1", "30"], ["ln_2", "160.5"]]);
    const segunda = fatiaDoSaldo(ESCOPO, saldo, [{ id: "ln_1", planejado: "30.000" }]);
    assert.equal(segunda[0].planejado, "30");
    const passou = rejeita(() => fatiaDoSaldo(ESCOPO, saldo, [{ id: "ln_1", planejado: "0.001" }]));
    assert.equal(passou.code, "failed-precondition");
    assert.equal(passou.message, "DTL-10 Estação: o saldo é 0 e a OS pede 0.001.");
  });

  it("recusa item fora do escopo e quantidade zero", () => {
    const saldo = saldoDoEscopo(ESCOPO, []);
    assert.match(rejeita(() => fatiaDoSaldo(ESCOPO, saldo, [{ id: "ln_x", planejado: "1" }])).message, /não está no escopo/);
    assert.match(rejeita(() => fatiaDoSaldo(ESCOPO, saldo, [{ id: "ln_1", planejado: "0" }])).message, /maior que zero/);
  });

  it("o saldo nunca fica negativo, em qualquer sequência de fatias", () => {
    let semente = 7;
    const aleatorio = () => {
      semente = (semente * 1103515245 + 12345) % 2147483648;
      return semente / 2147483648;
    };
    for (let rodada = 0; rodada < 200; rodada += 1) {
      const saldo = saldoDoEscopo(ESCOPO, []);
      for (let passo = 0; passo < 8; passo += 1) {
        const linha = ESCOPO[Math.floor(aleatorio() * ESCOPO.length)];
        const pedido = deMilesimos(1 + Math.floor(aleatorio() * 80_000));
        try {
          fatiaDoSaldo(ESCOPO, saldo, [{ id: linha.id, planejado: pedido }]);
        } catch (error) {
          assert.ok(error instanceof HttpsError);
        }
        for (const restante of saldo.values()) assert.ok(restante >= 0, `rodada ${rodada}: saldo ${restante}`);
      }
    }
  });

  it("todo o saldo numa OS só, e sem saldo não abre", () => {
    const saldo = saldoDoEscopo(ESCOPO, [{ numero: "10045-01", status: "agendada", itens: [{ id: "ln_1", planejado: "60" }] }]);
    assert.deepEqual(todoOSaldo(ESCOPO, saldo).map((item) => [item.id, item.planejado]), [["ln_2", "160.5"]]);
    const vazio = saldoDoEscopo(ESCOPO, [{ numero: "10045-01", status: "agendada", itens: [{ id: "ln_1", planejado: "60" }, { id: "ln_2", planejado: "160.5" }] }]);
    assert.equal(rejeita(() => todoOSaldo(ESCOPO, vazio)).message, "Todo o saldo da demanda já está em OS.");
  });
});

describe("serviços da OS", () => {
  it("saem dos itens, na ordem da execução; desmontagem não conta como montagem", () => {
    const item = (servico: string | null, nome: string): Pick<ItemDaOs, "servico" | "item" | "descricao"> => ({ servico, item: nome, descricao: nome });
    assert.deepEqual(servicosDosItens([item("Montagem", "Mesa"), item("Transporte", "Cadeira")]), ["transporte", "montagem"]);
    assert.deepEqual(servicosDosItens([item("Prestação de Serviço", "Desmontagem de estação")]), ["desmontagem"]);
    assert.deepEqual(servicosDosItens([item(null, "Embalagem de arquivo"), item("Içamento", "Içamento de cofre")]), ["embalagem"]);
    assert.deepEqual(servicosDosItens([item("Armazenagem", "Guarda de mobiliário"), item(null, "Vistoria técnica")]), ["vistoria", "armazenagem"]);
  });
});

describe("pedido de planejamento", () => {
  const ORDEM = { itens: [{ id: "ln_1", planejado: "10" }] };

  it("aceita várias OS com janela, equipe e veículos", () => {
    const acao = interpretarOs({
      action: "plan",
      idempotency_key: "p1",
      demanda: "10045",
      ordens: [
        { ...ORDEM, janela: { data: "2026-10-27", inicio: "07:30", fim: "18:00" }, equipe: [{ colaborador_id: ANA.id, papel: "lider" }], veiculos: [VAN.id] },
        { itens: [{ id: "ln_2", planejado: "160.5" }], instrucoes: "  Doca pelo subsolo 2.  " },
      ],
    });
    assert.equal(acao.action, "plan");
    if (acao.action !== "plan") return;
    assert.deepEqual(acao.ordens[0].janela, { data: "2026-10-27", inicio: "07:30", fim: "18:00" });
    assert.equal(acao.ordens[1].instrucoes, "Doca pelo subsolo 2.");
  });

  it("recusa item repetido, pessoa repetida, papel fora da lista, janela invertida e campo desconhecido", () => {
    const plano = (ordem: Record<string, unknown>) => () => interpretarOs({ action: "plan", idempotency_key: "p", demanda: "10045", ordens: [ordem] });
    assert.match(rejeita(plano({ itens: [{ id: "ln_1", planejado: "1" }, { id: "ln_1", planejado: "2" }] })).message, /duas vezes/);
    assert.match(rejeita(plano({ ...ORDEM, equipe: [{ colaborador_id: ANA.id }, { colaborador_id: ANA.id }] })).message, /repetida/);
    assert.match(rejeita(plano({ ...ORDEM, equipe: [{ colaborador_id: ANA.id, papel: "chefe" }] })).message, /use lider, motorista, montador, ajudante/);
    assert.match(rejeita(plano({ ...ORDEM, janela: { data: "2026-10-27", inicio: "18:00", fim: "07:30" } })).message, /fim da janela/);
    assert.match(rejeita(plano({ ...ORDEM, janela: { data: "2026-10-27", fim: "07:30" } })).message, /início/);
    assert.match(rejeita(plano({ ...ORDEM, preco: "10.00" })).message, /Campo não aceito: preco/);
    assert.match(rejeita(plano({ itens: [] })).message, /ao menos um item/);
    assert.match(rejeita(plano({ itens: [{ id: "ln_1", planejado: "1,5" }] })).message, /Quantidade inválida/);
    const muitas = rejeita(() =>
      interpretarOs({ action: "plan", idempotency_key: "p", demanda: "10045", ordens: Array.from({ length: 11 }, () => ORDEM) }),
    );
    assert.match(muitas.message, /até 10 OS/);
  });

  it("agendar exige a janela; equipe e veículos podem ir vazios (são alertas, não bloqueio)", () => {
    const base = { action: "schedule", idempotency_key: "a", numero: "10045-01", expected_edicao: 1, equipe: [], veiculos: [] };
    assert.match(rejeita(() => interpretarOs(base)).message, /Informe janela/);
    const acao = interpretarOs({ ...base, janela: { data: "2026-10-27" } });
    assert.equal(acao.action, "schedule");
    if (acao.action === "schedule") assert.deepEqual(acao.janela, { data: "2026-10-27", inicio: null, fim: null });
  });
});

describe("equipe, veículos e locais copiados do cadastro", () => {
  const pessoas = new Map([[ANA.id, ANA], [VALTER.id, VALTER]]);

  it("a OS leva nome, papel, vínculo e empresa, nunca o CPF; o login vai em equipe_uids", () => {
    const { equipe, equipe_uids } = equipeDaOs([{ colaborador_id: ANA.id, papel: "lider" }, { colaborador_id: VALTER.id }], pessoas);
    assert.deepEqual(equipe, [
      { colaborador_id: ANA.id, nome: "Ana Souza", papel: "lider", vinculo: "proprio", empresa: null, no_app: true, usuario_uid: "uid-ana" },
      { colaborador_id: VALTER.id, nome: "Valter Moreira", papel: null, vinculo: "terceiro", empresa: "Rota Sul", no_app: false, usuario_uid: null },
    ]);
    assert.deepEqual(equipe_uids, ["uid-ana"]);
    assert.equal(JSON.stringify(equipe).includes("52998224725"), false);
  });

  it("sem papel pedido vale o primeiro do cadastro; papel que a pessoa não tem é recusado; inativo também", () => {
    assert.equal(equipeDaOs([{ colaborador_id: ANA.id }], pessoas).equipe[0].papel, "motorista");
    assert.equal(equipeDaOs([{ colaborador_id: VALTER.id, papel: "ajudante" }], pessoas).equipe[0].papel, "ajudante");
    assert.equal(rejeita(() => equipeDaOs([{ colaborador_id: ANA.id, papel: "montador" }], pessoas)).message, "Ana Souza não tem o papel montador no cadastro.");
    assert.match(rejeita(() => equipeDaOs([{ colaborador_id: ANA.id }], new Map([[ANA.id, { ...ANA, ativo: false }]]))).message, /não está ativo/);
    assert.match(rejeita(() => equipeDaOs([{ colaborador_id: "col_cccccccccccccccc" }], pessoas)).message, /não está ativo/);
  });

  it("o veículo leva placa, tipo e dono; inativo é recusado", () => {
    assert.deepEqual(veiculosDaOs([VAN.id], new Map([[VAN.id, VAN]])), [
      { veiculo_id: VAN.id, placa: "DEF4G56", tipo: "Baú", modelo: "VW Delivery", dono: "proprio", empresa: null },
    ]);
    assert.match(rejeita(() => veiculosDaOs([VAN.id], new Map([[VAN.id, { ...VAN, ativo: false }]]))).message, /não está ativo/);
  });

  it("o local leva o endereço do cadastro do mesmo cliente e o contato no local", () => {
    const cadastro = {
      customer_code: "ITAU",
      nome: "Faria Lima",
      endereco: { logradouro: "Av. Brig. Faria Lima", numero: "3500", complemento: "5º andar", bairro: "Itaim Bibi", cidade: "São Paulo", uf: "SP", cep: "04538-132" },
    };
    const contato = { nome: "Renata Campos", telefone: "11987654321" };
    assert.deepEqual(localDaOs({ local_id: "loc_faria", complemento: "doca" }, cadastro, "ITAU", contato), {
      local_id: "loc_faria",
      nome: "Faria Lima",
      endereco: "Av. Brig. Faria Lima, 3500 · 5º andar · Itaim Bibi · São Paulo/SP",
      complemento: "doca",
      contato,
    });
    const deOutro = localDaOs({ local_id: "loc_faria", complemento: null }, { ...cadastro, customer_code: "SAFRA" }, "ITAU", null);
    assert.deepEqual(deOutro, { local_id: "loc_faria", nome: null, endereco: null, complemento: null, contato: null });
    assert.equal(localDaOs(null, null, "ITAU", null), null);
    assert.equal(enderecoEmLinha({}), null);
  });

  it("o contato pedido troca o do local; sem pedido, fica como está; null apaga", () => {
    const locais = { origem: localDaOs({ local_id: "loc_a", complemento: null }, null, "ITAU", { nome: "Renata", telefone: null }), destino: null };
    assert.deepEqual(comContatos(locais, undefined), locais);
    assert.equal(comContatos(locais, { origem: null }).origem?.contato, null);
    assert.deepEqual(comContatos(locais, { destino: { nome: "Paulo", telefone: null } }).destino?.contato, { nome: "Paulo", telefone: null });
  });
});

describe("o login do app trocado no cadastro, na OS que ainda vai a campo", () => {
  const ana = { colaborador_id: ANA.id, nome: "Ana Souza", papel: "lider", vinculo: "proprio", empresa: null, no_app: false, usuario_uid: null };
  const valter = { colaborador_id: VALTER.id, nome: "Valter Moreira", papel: null, vinculo: "terceiro", empresa: "Rota Sul", no_app: true, usuario_uid: "uid-valter" };

  it("ligar dá o acesso: a pessoa mostra o login, e ele entra em equipe_uids com o dos outros", () => {
    assert.deepEqual(equipeComLogin({ equipe: [ana, valter], equipe_uids: ["uid-valter"] }, ANA.id, null, "uid-ana"), {
      equipe: [{ ...ana, no_app: true, usuario_uid: "uid-ana" }, valter],
      equipe_uids: ["uid-valter", "uid-ana"],
    });
  });

  it("trocar tira o login antigo, e tirar deixa só o dos outros", () => {
    const ligada = { ...ana, no_app: true, usuario_uid: "uid-ana" };
    assert.deepEqual(equipeComLogin({ equipe: [ligada, valter], equipe_uids: ["uid-ana", "uid-valter"] }, ANA.id, "uid-ana", "uid-novo"), {
      equipe: [{ ...ana, no_app: true, usuario_uid: "uid-novo" }, valter],
      equipe_uids: ["uid-valter", "uid-novo"],
    });
    assert.deepEqual(equipeComLogin({ equipe: [ligada, valter], equipe_uids: ["uid-ana", "uid-valter"] }, ANA.id, "uid-ana", null), {
      equipe: [ana, valter],
      equipe_uids: ["uid-valter"],
    });
  });

  it("o login que a OS guardou da pessoa sai também; o de outra pessoa da equipe nunca sai", () => {
    // A OS guardou um login antigo da Ana, que depois passou ao Valter no cadastro.
    const antiga = { ...ana, no_app: true, usuario_uid: "uid-velho" };
    const comOVelho = { ...valter, usuario_uid: "uid-velho" };
    assert.deepEqual(equipeComLogin({ equipe: [antiga, comOVelho], equipe_uids: ["uid-velho"] }, ANA.id, "uid-ana", null), {
      equipe: [ana, comOVelho],
      equipe_uids: ["uid-velho"],
    });
    assert.deepEqual(equipeComLogin({ equipe: [antiga], equipe_uids: ["uid-velho", "uid-ana"] }, ANA.id, "uid-ana", null)?.equipe_uids, []);
  });

  it("sem a pessoa na equipe, sem nada a mudar ou na OS de antes da parte 3.4, nada muda", () => {
    assert.equal(equipeComLogin({ equipe: [valter], equipe_uids: ["uid-valter"] }, ANA.id, null, "uid-ana"), null);
    const ligada = { ...ana, no_app: true, usuario_uid: "uid-ana" };
    assert.equal(equipeComLogin({ equipe: [ligada, valter], equipe_uids: ["uid-ana", "uid-valter"] }, ANA.id, null, "uid-ana"), null);
    assert.equal(equipeComLogin({ equipe: [ANA.id], equipe_uids: [] }, ANA.id, null, "uid-ana"), null);
    assert.equal(equipeComLogin({ agenda: { equipe: [ANA.id] } } as { equipe?: unknown }, ANA.id, null, "uid-ana"), null);
  });

  it("os outros campos de cada pessoa ficam como a OS guardou", () => {
    const comMais = { ...ana, extra: "fica" };
    assert.deepEqual(equipeComLogin({ equipe: [comMais], equipe_uids: [] }, ANA.id, null, "uid-ana")?.equipe, [{ ...comMais, no_app: true, usuario_uid: "uid-ana" }]);
  });
});

describe("documento da OS", () => {
  it("nasce aberta sem janela e agendada com ela, na edição 1, com os serviços dos itens", () => {
    assert.equal(os().status, "aberta");
    assert.equal(os().edicao, 1);
    assert.deepEqual(os().servicos, ["transporte", "montagem"]);
    const comJanela = novaOs({ ...os(), janela: { data: "2026-10-27", inicio: null, fim: null } });
    assert.equal(comJanela.status, "agendada");
  });

  it("não tem nenhum campo de valor, em nenhum nível", () => {
    const completa = agendada(os(), {
      janela: { data: "2026-10-27", inicio: "07:30", fim: "18:00" },
      ...equipeDaOs([{ colaborador_id: ANA.id }], new Map([[ANA.id, ANA]])),
      veiculos: veiculosDaOs([VAN.id], new Map([[VAN.id, VAN]])),
      instrucoes: "Doca pelo subsolo 2.",
      contatos: { origem: { nome: "Renata Campos", telefone: null } },
    });
    const proibidas = chaves(completa).filter((chave) => /preco|price|valor|total|cents|custo(?!mer)|diaria/i.test(chave));
    assert.deepEqual(proibidas, []);
    const texto = JSON.stringify(completa);
    for (const proibido of ["88.50", "80.00", "17700", "negociado", "cpf", "52998224725"]) assert.equal(texto.includes(proibido), false, proibido);
  });

  it("agendar troca janela, equipe e veículos, sobe a edição e mantém as instruções sem pedido", () => {
    const antes = os({ instrucoes: "Portaria 2." });
    const agenda = { janela: { data: "2026-10-27", inicio: null, fim: null }, equipe: [], equipe_uids: [], veiculos: [], instrucoes: undefined, contatos: undefined };
    const depois = agendada(antes, agenda);
    assert.equal(depois.status, "agendada");
    assert.equal(depois.edicao, 2);
    assert.equal(depois.instrucoes, "Portaria 2.");
    assert.equal(agendada(antes, { ...agenda, instrucoes: null }).instrucoes, null);
  });

  it("mudar os itens recalcula os serviços e guarda a RV do escopo", () => {
    const depois = comItens(os(), [ESCOPO[1]], 1);
    assert.deepEqual(depois.servicos, ["transporte"]);
    assert.equal(depois.escopo_rv, 1);
    assert.equal(depois.edicao, 2);
  });

  it("cancelar pede a edição vista e não repete; só aberta ou agendada se planeja", () => {
    const por = { uid: "interno-1", nome: "Paula" };
    const efeito = cancelada(exigirCancelavel(os(), "10045-01", 1), "Cliente adiou", por, "2026-10-26T17:31:00.000Z");
    assert.equal(efeito.status, "cancelada");
    assert.equal(efeito.edicao, 2);
    assert.deepEqual(efeito.cancelamento, { motivo: "Cliente adiou", instante: "2026-10-26T17:31:00.000Z", por });
    assert.match(rejeita(() => exigirCancelavel(efeito, "10045-01", 2)).message, /já está cancelada/);
    assert.equal(rejeita(() => exigirPlanejavel(os(), "10045-01", 9, "agendada")).code, "failed-precondition");
    assert.match(rejeita(() => exigirPlanejavel(os({ status: "em_execucao" }), "10045-01", 1, "agendada")).message, /Só uma OS aberta ou agendada/);
    assert.equal(rejeita(() => exigirPlanejavel(null, "10045-01", 1, "agendada")).code, "not-found");
  });

  it("a vistoria em execução se cancela, com a edição vista; a OS de serviço iniciada, não (pergunta 58)", () => {
    const vistoria = os({ tipo: "vistoria", status: "em_execucao", edicao: 3 });
    assert.equal(exigirCancelavel(vistoria, "10045-01", 3), vistoria);
    assert.match(rejeita(() => exigirCancelavel(vistoria, "10045-01", 2)).message, /foi atualizada/);
    assert.match(rejeita(() => exigirCancelavel(os({ status: "em_execucao" }), "10045-01", 1)).message, /^Só uma OS aberta ou agendada pode ser cancelada\.$/);
    for (const status of ["em_revisao", "revisada"] as const) {
      assert.match(rejeita(() => exigirCancelavel(os({ tipo: "vistoria", status }), "10045-01", 1)).message, /^Só uma OS aberta ou agendada pode ser cancelada\.$/);
    }
  });

  it("a OS cancelada antes da pergunta 58 tem só o motivo; a de agora, o instante e quem cancelou", () => {
    const base = { status: "cancelada", edicao: 2, demanda: "10045", customer_code: "ITAU" };
    assert.deepEqual(osLida("10045-01", { ...base, cancelamento: { motivo: "Cliente adiou" } }).cancelamento, { motivo: "Cliente adiou" });
    assert.deepEqual(
      osLida("10045-01", { ...base, cancelamento: { motivo: "Local fechado", instante: "2026-10-26T17:31:00.000Z", por: { uid: "interno-1", nome: "Paula" } } }).cancelamento,
      { motivo: "Local fechado", instante: "2026-10-26T17:31:00.000Z", por: { uid: "interno-1", nome: "Paula" } },
    );
  });

  it("recusa data que já passou ou que não existe", () => {
    assert.equal(problemaDaData("2026-10-22", "2026-10-22"), null);
    assert.equal(problemaDaData("2026-10-21", "2026-10-22"), "A data do agendamento já passou.");
    assert.equal(problemaDaData("2026-02-31", "2026-10-22"), "Data inválida.");
  });
});

describe("OS de antes da parte 3.4", () => {
  it("a agenda, a quantidade e os ids dos locais viram janela, equipe, veículos, planejado e locais", () => {
    const lida = osLida("10045-01", {
      numero: "10045-01",
      demanda: "10045",
      seq: 1,
      customer_code: "ITAU",
      status: "agendada",
      escopo_rv: 0,
      edicao: 2,
      itens: [{ id: "ln_1", item: "Estação", descricao: "Montagem de estação", servico: "Montagem", quantidade: "2" }],
      origem_local_id: "loc_ceic",
      destino_local_id: null,
      cancelamento: null,
      agenda: { data: "2026-10-22", hora: "15:00", equipe: [ANA.id], veiculo_id: VAN.id },
    });
    assert.deepEqual(lida.janela, { data: "2026-10-22", inicio: "15:00", fim: null });
    assert.equal(lida.itens[0].planejado, "2");
    assert.deepEqual(lida.equipe.map((pessoa) => pessoa.colaborador_id), [ANA.id]);
    assert.deepEqual(lida.veiculos.map((veiculo) => veiculo.veiculo_id), [VAN.id]);
    assert.equal(lida.locais.origem?.local_id, "loc_ceic");
    assert.equal(lida.locais.destino, null);
    assert.deepEqual(lida.servicos, ["montagem"]);
  });

  it("status desconhecido é ilegível", () => {
    assert.match(rejeita(() => osLida("10045-01", { status: "pausada", edicao: 1, demanda: "10045", customer_code: "ITAU" })).message, /ilegível/);
  });
});

describe("agendar pela demanda", () => {
  it("demanda perdida ou cancelada no Comercial não agenda: a OS só se cancela", () => {
    assert.equal(problemaParaAgendarOs(DEMANDA), null);
    assert.equal(
      problemaParaAgendarOs({ ...DEMANDA, perda: { motivo: "cancelado_cliente", etapa_antes: "para_planejar", rv: 0 } }),
      "A demanda foi perdida no Comercial. Cancele a OS.",
    );
    assert.equal(problemaParaAgendarOs({ ...DEMANDA, cancelamento: { motivo: "cliente" } }), "A demanda foi cancelada no Comercial. Cancele a OS.");
  });

  it("reaberta agenda de novo", () => {
    assert.equal(problemaParaAgendarOs({ ...DEMANDA, perda: null }), null);
    assert.equal(problemaParaAgendarOs({ ...DEMANDA, perda: undefined, cancelamento: undefined }), null);
  });
});
