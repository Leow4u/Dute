import { describe, expect, it } from "vitest";

import { itensDoInicioDoFinanceiro } from "./inicio";
import {
  ETAPAS_DA_EMISSAO,
  ETAPAS_EM_ANDAMENTO,
  ETAPAS_QUE_PRECISAM,
  ETAPA_ROTULO,
  MOTIVOS_DA_PARADA,
  MOTIVO_ROTULO,
  acoesDaEmissao,
  emissoesLidas,
  gruposDasEmissoes,
  itensDaEmissao,
  pendenciasDasEmissoes,
  type EmissaoDoFinanceiro,
} from "./emissoes";
import { ROTA_EMISSOES } from "./navegacao";

/**
 * As emissões da NFS-e pela Omie no app (Fase 7, parte 7.4f): a leitura do
 * que listNfEmissions devolve, as ações de cada etapa, os grupos da tela e o
 * "Precisa de você" delas. As etapas e os motivos são os de
 * functions/financeiro/src/domain/emissao-omie.ts. Dados sintéticos.
 */

const ID = "nfe_0123456789abcdef0123";

/** O R$ de formatarReais (lib/dominio) vem com espaço que não quebra. */
const reais = (texto: string) => texto.replace(/R\$ /g, "R$\u00a0");

function bruta(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID,
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    etapa: "na_prefeitura",
    motivo_da_parada: null,
    mensagem: null,
    mensagens_da_prefeitura: [],
    demandas: ["10045", "10046"],
    armazenagem: ["ITAU__2026-09"],
    total_cents: 1_484_500,
    vencimento: "2026-11-20",
    nfse: null,
    url_nfse: null,
    url_pdf: null,
    criada_em: "2026-10-23T12:00:00.000Z",
    edicao: 3,
    reserva: true,
    ...extra,
  };
}

function emissao(extra: Record<string, unknown> = {}): EmissaoDoFinanceiro {
  const [lida] = emissoesLidas({ emissoes: [bruta(extra)] }) ?? [];
  if (!lida) throw new Error("emissão ilegível no teste");
  return lida;
}

describe("as emissões da NFS-e pela Omie", () => {
  it("as etapas e os motivos são os das Functions, cada um com rótulo; as etapas se dividem entre precisar, andar e ter acabado", () => {
    expect([...ETAPAS_DA_EMISSAO]).toEqual(["na_fila", "os_incluida", "na_prefeitura", "autorizada", "rejeitada", "reenviando", "cancelando", "parada", "desistida"]);
    expect([...MOTIVOS_DA_PARADA]).toEqual([
      "cliente_nao_achado",
      "cliente_repetido",
      "ambiente_errado",
      "chave",
      "sem_chaves",
      "falhas_seguidas",
      "cancelada_na_omie",
      "prefeitura_demorou",
      "fatura_recusada",
    ]);
    for (const etapa of ETAPAS_DA_EMISSAO) expect(ETAPA_ROTULO[etapa], etapa).toMatch(/^\S/);
    for (const motivo of MOTIVOS_DA_PARADA) expect(MOTIVO_ROTULO[motivo], motivo).toMatch(/^\S/);
    const acabadas = ETAPAS_DA_EMISSAO.filter((etapa) => !ETAPAS_QUE_PRECISAM.includes(etapa) && !ETAPAS_EM_ANDAMENTO.includes(etapa));
    expect(acabadas).toEqual(["autorizada", "desistida"]);
    expect(ETAPAS_QUE_PRECISAM.filter((etapa) => ETAPAS_EM_ANDAMENTO.includes(etapa))).toEqual([]);
  });

  it("lê o que a callable devolve, com o nome do cliente, as mensagens da prefeitura e o link da NFS-e só em https", () => {
    const lida = emissao({
      etapa: "autorizada",
      nfse: "00001234",
      url_nfse: "https://nfse.exemplo.gov.br/consulta?n=1234",
      url_pdf: "javascript:alert(1)",
      mensagens_da_prefeitura: [{ codigo: "E10", descricao: "Código de serviço inválido.", correcao: "Revise o serviço." }, { codigo: 7 }],
    });
    expect(lida).toEqual({
      id: ID,
      customerCode: "ITAU",
      cliente: "Itaú Unibanco",
      etapa: "autorizada",
      motivo: null,
      mensagem: null,
      mensagens: [
        { codigo: "E10", descricao: "Código de serviço inválido.", correcao: "Revise o serviço." },
        { codigo: "", descricao: "", correcao: "" },
      ],
      demandas: ["10045", "10046"],
      armazenagem: ["ITAU__2026-09"],
      totalCents: 1_484_500,
      vencimento: "2026-11-20",
      nfse: "00001234",
      urlNfse: "https://nfse.exemplo.gov.br/consulta?n=1234",
      urlPdf: null,
      criadaEm: "2026-10-23T12:00:00.000Z",
      edicao: 3,
    });
    // Sem o nome, o código do cliente; motivo fora da lista não vira motivo.
    expect(emissao({ customer_name: "", etapa: "parada", motivo_da_parada: "outro" })).toMatchObject({ cliente: "ITAU", motivo: null });
    expect(emissao({ etapa: "parada", motivo_da_parada: "chave" }).motivo).toBe("chave");
  });

  it("a emissão fora do formato fica de fora; a resposta fora do formato é null", () => {
    const lidas = emissoesLidas({
      emissoes: [
        bruta(),
        bruta({ id: "nfe_curto" }),
        bruta({ etapa: "inventada" }),
        bruta({ total_cents: 10.5 }),
        bruta({ total_cents: "100" }),
        bruta({ edicao: "3" }),
        null,
        "texto",
      ],
    });
    expect(lidas?.map((item) => item.id)).toEqual([ID]);
    expect(emissoesLidas({ emissoes: [] })).toEqual([]);
    expect(emissoesLidas(null)).toBeNull();
    expect(emissoesLidas({})).toBeNull();
    expect(emissoesLidas({ emissoes: "nada" })).toBeNull();
  });

  it("os itens da emissão: as demandas e as competências da armazenagem, em português", () => {
    expect(itensDaEmissao({ demandas: ["10045", "10046"], armazenagem: ["ITAU__2026-09"] })).toBe("Demandas 10045 e 10046 · Armazenagem 09/2026");
    expect(itensDaEmissao({ demandas: ["10045"], armazenagem: [] })).toBe("Demanda 10045");
    expect(itensDaEmissao({ demandas: ["1", "2", "3"], armazenagem: [] })).toBe("Demandas 1, 2 e 3");
    expect(itensDaEmissao({ demandas: [], armazenagem: ["ITAU__2026-08", "ITAU__2026-09"] })).toBe("Armazenagem 08/2026 e 09/2026");
    // A referência sem a competência no fim aparece como veio.
    expect(itensDaEmissao({ demandas: [], armazenagem: ["periodo-antigo"] })).toBe("Armazenagem periodo-antigo");
  });

  it("só a rejeitada e a parada têm ação; a OS cancelada na Omie só se desiste", () => {
    for (const etapa of ETAPAS_DA_EMISSAO) {
      const esperado = etapa === "rejeitada" || etapa === "parada" ? ["retomar", "desistir"] : [];
      expect(acoesDaEmissao({ etapa, motivo: null }), etapa).toEqual(esperado);
    }
    expect(acoesDaEmissao({ etapa: "parada", motivo: "cancelada_na_omie" })).toEqual(["desistir"]);
    expect(acoesDaEmissao({ etapa: "parada", motivo: "falhas_seguidas" })).toEqual(["retomar", "desistir"]);
  });

  it("os grupos da tela: as que precisam de você, as em andamento e as concluídas, na ordem em que vieram", () => {
    const lista = ETAPAS_DA_EMISSAO.map((etapa, indice) => emissao({ id: `nfe_${String(indice).padStart(20, "0")}`, etapa }));
    const grupos = gruposDasEmissoes(lista);
    expect(grupos.precisam.map((item) => item.etapa)).toEqual(["rejeitada", "parada"]);
    expect(grupos.andamento.map((item) => item.etapa)).toEqual(["na_fila", "os_incluida", "na_prefeitura", "reenviando", "cancelando"]);
    expect(grupos.concluidas.map((item) => item.etapa)).toEqual(["autorizada", "desistida"]);
    expect(gruposDasEmissoes([])).toEqual({ precisam: [], andamento: [], concluidas: [] });
  });

  it("o Precisa de você: a rejeitada e a parada são críticas e levam às Emissões; as outras não entram", () => {
    const rejeitadas = [
      emissao({ id: "nfe_00000000000000000001", etapa: "rejeitada", total_cents: 100_000 }),
      emissao({ id: "nfe_00000000000000000002", etapa: "rejeitada", customer_name: "Banco Safra", total_cents: 50_000 }),
      emissao({ id: "nfe_00000000000000000003", etapa: "rejeitada", customer_name: "BTG Pactual", total_cents: 25_000 }),
    ];
    const paradas = [
      emissao({ id: "nfe_00000000000000000004", etapa: "parada", motivo_da_parada: "cliente_nao_achado" }),
      emissao({ id: "nfe_00000000000000000005", etapa: "parada", motivo_da_parada: null, customer_name: "XP" }),
    ];
    const andando = [emissao({ id: "nfe_00000000000000000006", etapa: "na_prefeitura" }), emissao({ id: "nfe_00000000000000000007", etapa: "autorizada" })];
    const itens = pendenciasDasEmissoes([...rejeitadas, ...paradas, ...andando], ROTA_EMISSOES);
    expect(itens.map((item) => [item.id, item.tone, item.title, item.detail, item.href, item.actionLabel])).toEqual([
      ["financeiro-nfse-rejeitadas", "critical", "3 NFS-e rejeitadas", reais("Itaú Unibanco · Banco Safra e mais 1 · R$ 1.750,00"), ROTA_EMISSOES, "Abrir"],
      ["financeiro-nfse-paradas", "critical", "2 emissões paradas", "Cliente não achado na Omie · XP", ROTA_EMISSOES, "Abrir"],
    ]);
    expect(pendenciasDasEmissoes([rejeitadas[0]], ROTA_EMISSOES).map((item) => item.title)).toEqual(["1 NFS-e rejeitada"]);
    expect(pendenciasDasEmissoes([paradas[0]], ROTA_EMISSOES).map((item) => item.title)).toEqual(["1 emissão parada"]);
    expect(pendenciasDasEmissoes(andando, ROTA_EMISSOES)).toEqual([]);
  });

  it("no Início do Financeiro, as emissões entram entre as críticas, depois da cobrança vencida, e sem emissão nada muda", () => {
    const agora = new Date("2026-10-23T12:00:00-03:00");
    const parada = emissao({ etapa: "parada", motivo_da_parada: "chave" });
    expect(itensDoInicioDoFinanceiro([], [], agora, [parada]).map((item) => [item.id, item.tone])).toEqual([["financeiro-nfse-paradas", "critical"]]);
    expect(itensDoInicioDoFinanceiro([], [], agora)).toEqual([]);
    expect(itensDoInicioDoFinanceiro([], [], agora, [])).toEqual([]);
  });
});
