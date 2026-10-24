import { describe, expect, it } from "vitest";

import {
  ETAPAS_DA_BAIXA,
  ETAPA_DA_BAIXA_ROTULO,
  MOTIVOS_DA_PARADA_DA_BAIXA,
  MOTIVO_DA_BAIXA_ROTULO,
  acoesDaBaixa,
  baixasLidas,
  baixasNaOrdem,
  pendenciasDasBaixas,
  tituloDaBaixa,
  type BaixaDoFinanceiro,
} from "./baixas";
import { itensDoInicioDoFinanceiro } from "./inicio";
import { ROTA_EMISSOES } from "./navegacao";

/**
 * As baixas do pagamento na Omie no app (Fase 7, parte 7.4h): a leitura do
 * que listNfSettlements devolve, o título, as ações da parada, a ordem da
 * tela e o "Precisa de você". Dados sintéticos.
 */

/** O R$ de formatarReais (lib/dominio) vem com espaço que não quebra. */
const reais = (texto: string) => texto.replace(/R\$ /g, "R$ ");

function bruta(numero: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `bxa_${String(numero).padStart(24, "0")}`,
    pagamento_id: `pag_${String(numero).padStart(24, "0")}`,
    fatura_id: `fat_${String(numero).padStart(24, "0")}`,
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    nf_numero: "00815",
    etapa: "na_fila",
    motivo_da_parada: null,
    mensagem: null,
    valor_cents: 500_000,
    recebido_em: "2026-10-22",
    criada_em: "2026-10-22T15:00:00.000Z",
    edicao: 3,
    ...extra,
  };
}

function baixa(numero: number, extra: Record<string, unknown> = {}): BaixaDoFinanceiro {
  const [lida] = baixasLidas({ baixas: [bruta(numero, extra)] }) ?? [];
  if (!lida) throw new Error("baixa ilegível no teste");
  return lida;
}

describe("as baixas na Omie", () => {
  it("as etapas e os motivos têm rótulo", () => {
    for (const etapa of ETAPAS_DA_BAIXA) expect(ETAPA_DA_BAIXA_ROTULO[etapa], etapa).toMatch(/^\S/);
    for (const motivo of MOTIVOS_DA_PARADA_DA_BAIXA) expect(MOTIVO_DA_BAIXA_ROTULO[motivo], motivo).toMatch(/^\S/);
  });

  it("lê o que a callable devolve; o nome do cliente cai no código; a fora do formato fica de fora", () => {
    expect(baixa(1)).toEqual({
      id: "bxa_000000000000000000000001",
      pagamentoId: "pag_000000000000000000000001",
      faturaId: "fat_000000000000000000000001",
      customerCode: "ITAU",
      cliente: "Itaú Unibanco",
      nfNumero: "00815",
      etapa: "na_fila",
      motivo: null,
      mensagem: null,
      valorCents: 500_000,
      recebidoEm: "2026-10-22",
      criadaEm: "2026-10-22T15:00:00.000Z",
      edicao: 3,
    });
    expect(baixa(1, { customer_name: null, etapa: "parada", motivo_da_parada: "outro" })).toMatchObject({ cliente: "ITAU", motivo: null });
    expect(baixasLidas({ baixas: [bruta(1), bruta(2, { id: "bxa_x" }), bruta(3, { etapa: "lancando" }), bruta(4, { valor_cents: 1.5 }), null] })?.map((item) => item.id)).toEqual([
      "bxa_000000000000000000000001",
    ]);
    expect(baixasLidas(null)).toBeNull();
    expect(baixasLidas({ baixas: "nada" })).toBeNull();
  });

  it("o título é o cliente e a NF, sem os zeros da frente; sem a NF, só o cliente", () => {
    expect(tituloDaBaixa(baixa(1))).toBe("Itaú Unibanco · NF 815");
    expect(tituloDaBaixa(baixa(1, { nf_numero: null }))).toBe("Itaú Unibanco");
  });

  it("só a parada tem ação; a ordem põe as paradas primeiro e deixa de fora as que acabaram", () => {
    for (const etapa of ETAPAS_DA_BAIXA) expect(acoesDaBaixa({ etapa }), etapa).toEqual(etapa === "parada" ? ["retomar", "dispensar"] : []);
    const lista = [baixa(1), baixa(2, { etapa: "parada" }), baixa(3, { etapa: "cancelando" }), baixa(4, { etapa: "lancada" }), baixa(5, { etapa: "parada" })];
    expect(baixasNaOrdem(lista).map((item) => item.id.slice(-1))).toEqual(["2", "5", "1", "3"]);
  });

  it("o Precisa de você: as paradas, críticas, com os clientes e o valor, levam às Emissões; as que andam não entram", () => {
    const paradas = [baixa(1, { etapa: "parada" }), baixa(2, { etapa: "parada", customer_name: "Banco Safra", valor_cents: 50_000 }), baixa(3, { etapa: "parada", customer_name: "XP", valor_cents: 25_000 })];
    expect(pendenciasDasBaixas([...paradas, baixa(4)], ROTA_EMISSOES).map((item) => [item.id, item.tone, item.title, item.detail, item.href, item.actionLabel])).toEqual([
      ["financeiro-baixas-paradas", "critical", "3 baixas paradas na Omie", reais("Itaú Unibanco · Banco Safra e mais 1 · R$ 5.750,00"), ROTA_EMISSOES, "Abrir"],
    ]);
    expect(pendenciasDasBaixas([paradas[0]], ROTA_EMISSOES).map((item) => item.title)).toEqual(["1 baixa parada na Omie"]);
    expect(pendenciasDasBaixas([baixa(4), baixa(5, { etapa: "cancelando" })], ROTA_EMISSOES)).toEqual([]);
    // No Início do Financeiro, entra com as críticas.
    const agora = new Date("2026-10-23T12:00:00-03:00");
    expect(itensDoInicioDoFinanceiro([], [], agora, [], [paradas[0]]).map((item) => [item.id, item.tone])).toEqual([["financeiro-baixas-paradas", "critical"]]);
  });
});
