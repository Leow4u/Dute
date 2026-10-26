import { formatarReais } from "@workspace/dominio";

import { rotuloDaRv } from "../comercial/autorizacoes";
import { dataBr } from "../comercial/clientes";
import { linhaDoDocumento, linhasGravadas, valorSemMoeda } from "../comercial/documento";
import { medicaoDoRegistro } from "../comercial/medicoes";
import { FORMA_ROTULO } from "./a-faturar";
import { rotuloDaNf, type FaturaDoFinanceiro } from "./faturas";

/**
 * A via comercial da NF (parte 4.2d): o demonstrativo que acompanha a NF
 * emitida fora do sistema. Para cada demanda, o que foi cobrado: as linhas da
 * RV validada pelo cliente (a cópia congelada no envio) ou, na medição
 * mensal, as linhas da demanda na medição aprovada, com a autorização que o
 * cliente deu (pedido e aceite). O valor de cada demanda e o total são os da
 * fatura, que o servidor calculou; as linhas mostram de onde ele saiu. A
 * medição aprovada (pergunta 64) traz também as linhas sem demanda dela,
 * num bloco da medição.
 *
 * Só quem lê preço chega aqui: owner, admin e financeiro, pela rota, e as
 * regras de `faturas`, `quotes` e `medicoes`.
 */

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function registro(valor: unknown): Registro | null {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Registro) : null;
}

export type LinhaDoDemonstrativo = { chave: string; item: string; unidade: string; quantidade: string; valorUnitario: string; total: string };

export type DemandaDoDemonstrativo = {
  numero: string;
  /** "10045 – RV02" ou "10050 · Medição 10/2026". */
  rotulo: string;
  titulo: string | null;
  /** A referência do cliente (o número do chamado dele). */
  refCliente: string | null;
  /** "Pedido 4500000009 · aceite ACE-1", ou null sem autorização com pedido. */
  autorizacao: string | null;
  linhas: LinhaDoDemonstrativo[];
  /** O valor da demanda na fatura. */
  total: string;
  /** As linhas lidas somam o valor da fatura. */
  confere: boolean;
};

export type DemonstrativoDaNf = {
  /** "NF 1234". */
  titulo: string;
  /** O document.title: o nome que o navegador sugere para o PDF. */
  nomeDoArquivo: string;
  cliente: string;
  campos: Array<{ rotulo: string; valor: string }>;
  demandas: DemandaDoDemonstrativo[];
  total: string;
  observacao: string | null;
};

export type FontesDoDemonstrativo = {
  /** `demands/{numero}`. */
  demandas: ReadonlyMap<string, Registro | null>;
  /** `quotes/{numero}/revisoes/{rv}`, pela chave `${numero}:${rv}`. */
  revisoes: ReadonlyMap<string, Registro | null>;
  /** `medicoes/{id}`. */
  medicoes: ReadonlyMap<string, Registro | null>;
  /** `client_authorizations/{id}`. */
  autorizacoes: ReadonlyMap<string, Registro | null>;
};

export function chaveDaRevisao(numero: string, rv: number): string {
  return `${numero}:${rv}`;
}

function rotuloDaCompetencia(medicaoId: string): string {
  const competencia = /_(\d{4})-(\d{2})$/.exec(medicaoId);
  return competencia ? `Medição ${competencia[2]}/${competencia[1]}` : "Medição";
}

function textoDaAutorizacao(ids: readonly string[], autorizacoes: ReadonlyMap<string, Registro | null>): string | null {
  for (const id of ids) {
    const autorizacao = autorizacoes.get(id);
    const pedido = texto(autorizacao?.pedido);
    if (pedido) return [`Pedido ${pedido}`, texto(autorizacao?.aceite) ? `aceite ${texto(autorizacao?.aceite)}` : null].filter(Boolean).join(" · ");
  }
  return null;
}

function linhasDaRv(revisao: Registro | null | undefined): { linhas: LinhaDoDemonstrativo[]; cents: number } {
  const linhas = linhasGravadas(revisao?.linhas);
  return {
    linhas: linhas.map((linha) => {
      const papel = linhaDoDocumento(linha);
      return { chave: papel.chave, item: papel.item, unidade: papel.unidade, quantidade: papel.quantidade, valorUnitario: papel.valorUnitario, total: papel.total };
    }),
    cents: linhas.reduce((soma, linha) => soma + linha.totalCents, 0),
  };
}

/** As linhas da medição da demanda (`numero`), ou as sem demanda (`null`). */
function linhasDaMedicao(numero: string | null, medicaoId: string, dados: Registro | null | undefined): { linhas: LinhaDoDemonstrativo[]; cents: number } {
  const medicao = dados ? medicaoDoRegistro(medicaoId, dados) : null;
  const daDemanda = (medicao?.linhas ?? []).filter((linha) => (linha.demanda_numero ?? null) === numero);
  return {
    linhas: daDemanda.map((linha) => ({
      chave: linha.id,
      item: [linha.os ? `OS ${linha.os}` : null, linha.executada_em ? `executada em ${dataBr(linha.executada_em)}` : null, linha.mercadoria || null].filter(Boolean).join(" · ") || "Linha da medição",
      unidade: "",
      quantidade: "",
      valorUnitario: "",
      total: valorSemMoeda(linha.total_cents),
    })),
    cents: daDemanda.reduce((soma, linha) => soma + linha.total_cents, 0),
  };
}

export function demonstrativoDaNf(fatura: FaturaDoFinanceiro, fontes: FontesDoDemonstrativo): DemonstrativoDaNf {
  const demandas = fatura.demandas.map((demanda): DemandaDoDemonstrativo => {
    const lida = fontes.demandas.get(demanda.numero) ?? null;
    const revisao = demanda.rv !== null ? fontes.revisoes.get(chaveDaRevisao(demanda.numero, demanda.rv)) : null;
    // A RV congelada guarda a demanda como ela foi enviada: vale mais que a demanda de hoje.
    const daRevisao = registro(revisao?.demanda);
    const origem = demanda.medicaoId ? linhasDaMedicao(demanda.numero, demanda.medicaoId, fontes.medicoes.get(demanda.medicaoId)) : linhasDaRv(revisao);
    return {
      numero: demanda.numero,
      rotulo: demanda.medicaoId ? `${demanda.numero} · ${rotuloDaCompetencia(demanda.medicaoId)}` : rotuloDaRv(demanda.numero, demanda.rv),
      titulo: texto(daRevisao?.titulo) || texto(lida?.titulo) || null,
      refCliente: texto(daRevisao?.ref_cliente) || texto(lida?.ref_cliente) || null,
      autorizacao: textoDaAutorizacao(demanda.autorizacaoIds, fontes.autorizacoes),
      linhas: origem.linhas,
      total: formatarReais(demanda.valorCents),
      confere: origem.linhas.length > 0 && origem.cents === demanda.valorCents,
    };
  });
  // A medição aprovada: as linhas sem demanda, no bloco dela (as demandas dela já vieram acima).
  const daMedicao = fatura.medicoes.flatMap((medicao): DemandaDoDemonstrativo[] => {
    const cents = medicao.semDemanda.reduce((soma, linha) => soma + linha.valorCents, 0);
    if (!medicao.medicaoId || cents <= 0) return [];
    const origem = linhasDaMedicao(null, medicao.medicaoId, fontes.medicoes.get(medicao.medicaoId));
    return [
      {
        numero: medicao.medicaoId,
        rotulo: rotuloDaCompetencia(medicao.medicaoId),
        titulo: medicao.semDemanda.map((linha) => linha.servico).join(" · "),
        refCliente: null,
        autorizacao: null,
        linhas: origem.linhas,
        total: formatarReais(cents),
        confere: origem.linhas.length > 0 && origem.cents === cents,
      },
    ];
  });
  const titulo = rotuloDaNf(fatura);
  return {
    titulo,
    nomeDoArquivo: `${titulo.replace(" · ", " ")} - ${fatura.cliente}`.replace(/[\\/:*?"<>|]/g, " "),
    cliente: fatura.cliente,
    campos: [
      { rotulo: "Emissão", valor: dataBr(fatura.nf.emitidaEm) },
      { rotulo: "Vencimento", valor: dataBr(fatura.vencimento) },
      { rotulo: "Forma de pagamento", valor: FORMA_ROTULO[fatura.forma] },
    ],
    demandas: [...demandas, ...daMedicao],
    total: formatarReais(fatura.valorCents),
    observacao: fatura.observacao,
  };
}
