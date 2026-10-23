import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { colunaDaOs, etapasDaOs, instanteDaJanela, osNaTv, quadroDaTv, rotaDaOs, type OsNaTv } from "./tv.js";

/**
 * O quadro da TV da sala (parte 3.12): a OS de hoje em três colunas e só os
 * campos que a TV mostra. Dados sintéticos.
 */

const HOJE = "2026-10-23";
const AGORA = new Date("2026-10-23T17:32:00.000Z"); // 14:32 em São Paulo

const etapa = (nome: string, instante: string) => ({
  etapa: nome,
  instante,
  canal: "celular",
  meio: null,
  informado_por: "col_aaaaaaaaaaaaaaaa",
  registrado_por: { uid: "uid-ana", role: "campo" },
  registrado_em: instante,
});

function os(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    numero: "10045-01",
    demanda: "10045",
    seq: 1,
    customer_code: "ITAU",
    cliente_nome: "Itaú Unibanco",
    tipo: "servico",
    status: "agendada",
    edicao: 3,
    itens: [{ id: "ln_1", lpu_item_id: "lpu_cadeira", codigo: "TR-01", item: "Cadeira", descricao: "Cadeira giratória", servico: "Transporte", unidade: "UN", planejado: "24" }],
    servicos: ["transporte"],
    locais: {
      origem: { local_id: "loc_ceic", nome: "CEIC", endereco: "Av. Paulista, 1842", complemento: "12º andar", contato: { nome: "Carla Souza", telefone: "11987654321" } },
      destino: { local_id: "loc_cat", nome: "Faria Lima", endereco: "Av. Brigadeiro Faria Lima, 3500", complemento: null, contato: null },
    },
    janela: { data: HOJE, inicio: "15:00", fim: "18:00" },
    equipe: [
      { colaborador_id: "col_aaaaaaaaaaaaaaaa", nome: "Ana Lima", papel: "lider", vinculo: "clt", empresa: null, no_app: true, usuario_uid: "uid-ana" },
      { colaborador_id: "col_bbbbbbbbbbbbbbbb", nome: "Bruno Teixeira", papel: "ajudante", vinculo: "terceiro", empresa: "Mão Amiga Ltda", no_app: false, usuario_uid: null },
    ],
    equipe_uids: ["uid-ana"],
    veiculos: [{ veiculo_id: "vei_aaaaaaaaaaaaaaaa", placa: "ABC1D23", tipo: "VUC", modelo: "Accelo", dono: "proprio", empresa: null }],
    instrucoes: "Portaria pede RG; ligar para a Carla antes de subir.",
    ...extra,
  };
}

const CONCLUSAO = {
  ...etapa("fim", "2026-10-23T15:40:00.000Z"),
  aceite: "assinatura",
  responsavel: { nome: "Carla Souza", cargo: "Facilities", documento: "52998224725" },
  assinatura: "os/10045-01/assinatura/as_a000000000000001.png",
  diferencas: [{ linha: "ln_1", previsto: "24", executado: "22", motivo: "Duas cadeiras ficaram no andar." }],
};

describe("a OS na TV", () => {
  it("leva só os campos da TV: sem contato, telefone, endereço, instruções, documento ou itens", () => {
    const naTv = osNaTv("10045-01", os(), null, HOJE);
    assert.deepEqual(naTv, {
      numero: "10045-01",
      tipo: "servico",
      coluna: "agendada",
      cliente: "Itaú Unibanco",
      servicos: ["transporte"],
      rota: "CEIC → Faria Lima",
      inicio: "2026-10-23T18:00:00.000Z",
      ate: "2026-10-23T21:00:00.000Z",
      etapa: null,
      etapas: { feitas: 0, previstas: 6 },
      concluida_em: null,
      aceite: null,
      equipe: ["Ana Lima", "Bruno Teixeira"],
      placas: ["ABC1D23"],
    } satisfies OsNaTv);
    const concluida = osNaTv(
      "10045-01",
      os({ status: "revisada", etapas: [etapa("saida_patio", "2026-10-23T12:00:00.000Z"), etapa("fim", "2026-10-23T15:40:00.000Z")], conclusao: CONCLUSAO }),
      null,
      HOJE,
    );
    const texto = JSON.stringify([naTv, concluida]);
    for (const proibido of ["11987654321", "Carla", "Paulista", "12º andar", "Portaria", "52998224725", "Mão Amiga", "uid-ana", "col_aaaa", "lpu_cadeira", "Cadeira", "assinatura/", "Duas cadeiras", "clt", "R$"]) {
      assert.ok(!texto.includes(proibido), proibido);
    }
  });

  it("a coluna: agendada hoje (ou de um dia que passou), em execução e concluída hoje", () => {
    assert.equal(colunaDaOs({ status: "agendada", janela: { data: HOJE, inicio: "15:00", fim: null } }, null, HOJE), "agendada");
    assert.equal(colunaDaOs({ status: "agendada", janela: { data: "2026-10-22", inicio: null, fim: null } }, null, HOJE), "agendada");
    assert.equal(colunaDaOs({ status: "agendada", janela: { data: "2026-10-28", inicio: null, fim: null } }, null, HOJE), null);
    assert.equal(colunaDaOs({ status: "em_execucao", janela: { data: "2026-10-22", inicio: null, fim: null } }, null, HOJE), "em_execucao");
    assert.equal(colunaDaOs({ status: "em_revisao", janela: null }, "2026-10-23T15:40:00.000Z", HOJE), "concluida");
    // 22/10 às 23:30 em São Paulo é 02:30 UTC do dia 23: não é de hoje.
    assert.equal(colunaDaOs({ status: "revisada", janela: null }, "2026-10-23T02:30:00.000Z", HOJE), null);
    assert.equal(colunaDaOs({ status: "aberta", janela: null }, null, HOJE), null);
    assert.equal(colunaDaOs({ status: "cancelada", janela: { data: HOJE, inicio: null, fim: null } }, null, HOJE), null);
  });

  it("em execução: a última etapa, as feitas e as previstas; o prazo da demanda direta vence a janela", () => {
    const naTv = osNaTv(
      "10053-01",
      os({ numero: "10053-01", demanda: "10053", status: "em_execucao", etapas: [etapa("saida_patio", "2026-10-23T12:30:00.000Z"), etapa("chegada_origem", "2026-10-23T13:10:00.000Z")] }),
      { executar_ate: "2026-10-23T14:00:00-03:00" },
      HOJE,
    );
    assert.equal(naTv?.coluna, "em_execucao");
    assert.deepEqual(naTv?.etapa, { etapa: "chegada_origem", instante: "2026-10-23T13:10:00.000Z" });
    assert.deepEqual(naTv?.etapas, { feitas: 2, previstas: 6 });
    assert.equal(naTv?.ate, "2026-10-23T17:00:00.000Z");
  });

  it("a concluída: a hora do Fim e o aceite; a vistoria enviada não tem aceite", () => {
    const servico = osNaTv("10045-01", os({ status: "em_revisao", etapas: [etapa("fim", "2026-10-23T15:40:00.000Z")], conclusao: { ...CONCLUSAO, aceite: "sem_aceite", assinatura: null } }), null, HOJE);
    assert.equal(servico?.coluna, "concluida");
    assert.equal(servico?.concluida_em, "2026-10-23T15:40:00.000Z");
    assert.equal(servico?.aceite, "sem_aceite");
    const vistoria = osNaTv(
      "10060-01",
      os({ numero: "10060-01", tipo: "vistoria", itens: [], servicos: ["vistoria"], status: "revisada", etapas: [etapa("chegada_origem", "2026-10-23T13:00:00.000Z"), etapa("fim", "2026-10-23T14:10:00.000Z")] }),
      null,
      HOJE,
    );
    assert.equal(vistoria?.tipo, "vistoria");
    assert.equal(vistoria?.aceite, null);
    assert.deepEqual(vistoria?.etapas, { feitas: 2, previstas: 3 });
  });

  it("sem equipe, veículo, hora ou locais, os campos vêm vazios; documento ilegível fica de fora", () => {
    const vazia = osNaTv("10045-02", os({ equipe: [], veiculos: [], janela: { data: HOJE, inicio: null, fim: null }, locais: { origem: null, destino: null }, cliente_nome: null }), null, HOJE);
    assert.equal(vazia?.cliente, "ITAU");
    assert.deepEqual([vazia?.equipe, vazia?.placas, vazia?.inicio, vazia?.ate, vazia?.rota], [[], [], null, null, null]);
    assert.equal(osNaTv("10045-03", { status: "agendada" }, null, HOJE), null);
  });
});

describe("as partes do quadro", () => {
  it("as etapas previstas pelo serviço; a registrada fora do previsto também conta", () => {
    assert.deepEqual(etapasDaOs({ tipo: "vistoria", servicos: ["vistoria"] }, []), ["saida_patio", "chegada_origem", "fim"]);
    assert.deepEqual(etapasDaOs({ tipo: "servico", servicos: ["transporte", "montagem"] }, []), ["saida_patio", "chegada_origem", "carregamento", "saida_origem", "chegada_destino", "montagem", "fim"]);
    assert.deepEqual(etapasDaOs({ tipo: "servico", servicos: ["montagem"] }, []), ["saida_patio", "chegada_origem", "montagem", "fim"]);
    assert.deepEqual(etapasDaOs({ tipo: "servico", servicos: ["desmontagem"] }, ["carregamento"]), ["saida_patio", "chegada_origem", "carregamento", "fim"]);
  });

  it("a rota só com o nome dos locais; a janela em São Paulo", () => {
    const local = (nome: string | null) => ({ local_id: null, nome, endereco: "Rua X, 1", complemento: null, contato: null });
    assert.equal(rotaDaOs({ locais: { origem: local("CEIC"), destino: null } }), "CEIC");
    assert.equal(rotaDaOs({ locais: { origem: local("CEIC"), destino: local("CEIC") } }), "CEIC");
    assert.equal(rotaDaOs({ locais: { origem: local(null), destino: local("Faria Lima") } }), "Faria Lima");
    assert.equal(instanteDaJanela(HOJE, "09:30"), "2026-10-23T12:30:00.000Z");
    assert.equal(instanteDaJanela(HOJE, null), null);
  });

  it("o quadro: o dia de São Paulo, sem repetir a OS, pela hora; a concluída da mais recente", () => {
    const quadro = quadroDaTv(
      [
        { id: "10045-01", data: os() },
        { id: "10045-01", data: os() },
        { id: "10046-01", data: os({ numero: "10046-01", demanda: "10046", janela: { data: HOJE, inicio: "09:00", fim: null } }) },
        { id: "10047-01", data: os({ numero: "10047-01", status: "revisada", etapas: [etapa("fim", "2026-10-23T12:00:00.000Z")] }) },
        { id: "10048-01", data: os({ numero: "10048-01", status: "em_revisao", etapas: [etapa("fim", "2026-10-23T16:00:00.000Z")] }) },
        { id: "10049-01", data: os({ numero: "10049-01", status: "aberta", janela: null }) },
      ],
      new Map(),
      AGORA,
    );
    assert.equal(quadro.hoje, HOJE);
    assert.equal(quadro.gerado_em, AGORA.toISOString());
    assert.deepEqual(
      quadro.ordens.map((item) => [item.numero, item.coluna]),
      [
        ["10046-01", "agendada"],
        ["10045-01", "agendada"],
        ["10048-01", "concluida"],
        ["10047-01", "concluida"],
      ],
    );
  });
});
