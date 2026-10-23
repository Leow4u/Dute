import { describe, expect, it } from "vitest";

import { fichaDaLeitura } from "../operacao/ficha-da-os";
import { aPagar, cobrancaPorDemanda, nfDoPortal, numerosDasOs, ordenarNfs, ordenarOs, osDoPortal, situacaoNoPortal, textoDaDemandaNaNf } from "./servicos";

/**
 * O portal com as OS e as NFs dos serviços (parte 4.3b): a revisão interna
 * não aparece (concluída é concluída), o andamento em quatro marcos, o
 * motorista e a placa, quem recebeu; e a NF de cada demanda pela mesma
 * régua das telas internas (vencida pelo vencimento, pagamento parcial).
 * Dados sintéticos.
 */

const HOJE = "2026-10-23";
const reais = (texto: string) => texto.replace(/R\$ /g, "R$ ");

function ficha(numero: string, extra: Record<string, unknown> = {}) {
  const lida = fichaDaLeitura(numero, {
    demanda: numero.slice(0, 5),
    customer_code: "ITAU",
    status: "agendada",
    edicao: 1,
    servicos: ["transporte"],
    janela: { data: "2026-10-24", inicio: "09:30", fim: "12:00" },
    locais: { origem: { nome: "Galpão 3", endereco: "Rua das Indústrias, 450" }, destino: { endereco: "Av. Paulista, 1000" } },
    equipe: [
      { colaborador_id: "c1", nome: "Ana Lima", papel: "lider" },
      { colaborador_id: "c2", nome: "João Pereira", papel: "motorista" },
    ],
    veiculos: [{ veiculo_id: "v1", placa: "DEF4G56", tipo: "caminhao" }],
    ocorrencias: [{ id: "o1", instante: "2026-10-23T12:00:00.000Z", canal: "escritorio", descricao: "Cliente atrasou a liberação" }],
    revisao: { instante: "2026-10-23T18:00:00.000Z", nota: "Conferido" },
    ...extra,
  });
  if (!lida) throw new Error("ficha inválida");
  return lida;
}

describe("as OS no portal", () => {
  it("a revisão é interna: em revisão e revisada são concluídas para o cliente", () => {
    expect(["aberta", "agendada", "em_execucao", "em_revisao", "revisada", "cancelada"].map((status) => situacaoNoPortal({ status } as never))).toEqual([
      "para_agendar",
      "agendada",
      "em_execucao",
      "concluida",
      "concluida",
      "cancelada",
    ]);
  });

  it("a OS em execução mostra a última etapa; o motorista e a placa; nada interno", () => {
    const os = osDoPortal(
      ficha("10045-01", {
        status: "em_execucao",
        etapas: [
          { etapa: "saida_patio", instante: "2026-10-24T12:35:00.000Z", canal: "celular" },
          { etapa: "chegada_origem", instante: "2026-10-24T13:10:00.000Z", canal: "celular" },
        ],
      }),
      HOJE,
    );
    expect(os).toMatchObject({ numero: "10045-01", demanda: "10045", situacao: "em_execucao", servicos: "Transporte", origem: "Galpão 3 · Rua das Indústrias, 450", destino: "Av. Paulista, 1000", motorista: "João Pereira · DEF-4G56" });
    expect(os.andamento).toEqual([
      { titulo: "Pedido recebido", detalhe: null, feito: true },
      { titulo: "Agendada", detalhe: "24/10/2026 09:30–12:00", feito: true },
      { titulo: "Em execução", detalhe: "Chegada na origem · 10:10", feito: true },
      { titulo: "Concluída", detalhe: null, feito: false },
    ]);
    expect(JSON.stringify(os)).not.toMatch(/atrasou|Conferido|Ana Lima|ocorrencia|revisao/);
  });

  it("a concluída mostra quem recebeu; a vistoria se chama vistoria; a cancelada não tem andamento", () => {
    const concluida = osDoPortal(
      ficha("10045-02", { status: "revisada", conclusao: { instante: "2026-10-22T14:40:00.000Z", canal: "celular", aceite: "assinatura", responsavel: { nome: "Bruna Costa", documento: "123" } } }),
      HOJE,
    );
    expect([concluida.situacao, concluida.recebimento, concluida.andamento.at(-1)]).toEqual([
      "concluida",
      "Recebido por Bruna Costa · 22/10/2026 11:40",
      { titulo: "Concluída", detalhe: "22/10/2026 11:40", feito: true },
    ]);
    expect(JSON.stringify(concluida)).not.toContain("123");
    expect(osDoPortal(ficha("10046-01", { tipo: "vistoria" }), HOJE).servicos).toBe("Vistoria");
    expect(osDoPortal(ficha("10047-01", { status: "cancelada" }), HOJE).andamento).toEqual([]);
    expect(osDoPortal(ficha("10048-01", { status: "aberta", janela: null }), HOJE).andamento[1]).toEqual({ titulo: "Agendada", detalhe: null, feito: false });
  });

  it("em andamento primeiro, depois as concluídas da mais recente; os números", () => {
    const lista = [
      osDoPortal(ficha("10040-01", { status: "revisada", janela: { data: "2026-10-01" } }), HOJE),
      osDoPortal(ficha("10041-01", { status: "agendada", janela: { data: "2026-10-30" } }), HOJE),
      osDoPortal(ficha("10042-01", { status: "em_execucao" }), HOJE),
      osDoPortal(ficha("10043-01", { status: "agendada", janela: { data: "2026-10-25" } }), HOJE),
      osDoPortal(ficha("10044-01", { status: "revisada", janela: { data: "2026-10-20" } }), HOJE),
      osDoPortal(ficha("10049-01", { status: "aberta", janela: null }), HOJE),
    ];
    expect(ordenarOs(lista).map((os) => os.numero)).toEqual(["10042-01", "10043-01", "10041-01", "10049-01", "10044-01", "10040-01"]);
    expect(numerosDasOs(lista)).toEqual({ emAndamento: 1, agendadas: 3, concluidas: 2 });
  });
});

describe("as NFs dos serviços no portal", () => {
  const nf = (numero: string, extra: Record<string, unknown> = {}) =>
    nfDoPortal(`fat_${numero.padStart(24, "0")}`, {
      customer_code: "ITAU",
      customer_name: "Itaú Unibanco",
      status: "emitida",
      valor_cents: 1_484_500,
      recebido_cents: 0,
      nf: { numero, serie: "1", emitida_em: "2026-10-01" },
      vencimento: "2026-10-30",
      forma: "boleto",
      demandas: [
        { numero: "10045", valor_cents: 1_000_000, titulo: "Desmontagem" },
        { numero: "10046", valor_cents: 484_500, titulo: null },
      ],
      ...extra,
    })!;

  it("a NF da demanda de cada OS, com a situação pela mesma régua das telas internas", () => {
    const cobrancas = cobrancaPorDemanda([nf("1234"), nf("1200", { vencimento: "2026-10-10", demandas: [{ numero: "10040", valor_cents: 1 }] })], HOJE);
    expect(cobrancas.get("10045")).toEqual({ nf: "NF 1234", situacao: "a_vencer", texto: "NF 1234 · Vence em 7 dias" });
    expect(cobrancas.get("10040")).toEqual({ nf: "NF 1200", situacao: "vencida", texto: "NF 1200 · Vencida há 13 dias" });
    expect(cobrancas.get("10099")).toBeUndefined();
  });

  it("as abertas pelo vencimento, depois as pagas; o que falta pagar soma os saldos, com o parcial", () => {
    const lista = [
      nf("1203", { status: "paga", recebido_cents: 1_484_500, paga_em: "2026-10-15" }),
      nf("1204", { vencimento: "2026-11-20", recebido_cents: 484_500 }),
      nf("1201", { vencimento: "2026-10-10" }),
      nf("1205", { status: "paga", recebido_cents: 1_484_500, paga_em: "2026-10-20" }),
    ];
    expect(ordenarNfs(lista, HOJE).map((item) => item.fatura.nf.numero)).toEqual(["1201", "1204", "1205", "1203"]);
    expect(aPagar(lista, HOJE)).toBe(1_484_500 + 1_000_000);
    expect(textoDaDemandaNaNf(lista[1], "10045", 1_000_000)).toBe(reais("10045 · Desmontagem · R$ 10.000,00"));
    expect(textoDaDemandaNaNf(lista[1], "10046", 484_500)).toBe(reais("10046 · R$ 4.845,00"));
  });
});
