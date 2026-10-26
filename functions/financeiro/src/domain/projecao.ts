/**
 * A NF como o cliente vê no portal (docs/plataforma/fase-4-financeiro.md,
 * parte 4.3a): `client_faturas/{id}`, uma projeção de `faturas/{id}` gravada
 * pelo Financeiro na mesma transação de cada mudança, como o WMS faz com
 * `client_invoices`. Leva só o que é do cliente: a NF, o vencimento, a forma,
 * o valor, o recebido e o saldo, a situação, as demandas com o valor e o
 * título, a armazenagem de cada competência (parte 7.2a) e a medição
 * aprovada com as linhas sem demanda (pergunta 64). Fica de fora o que é
 * interno: quem registrou, a observação, as autorizações, os registros
 * anteriores e o motivo de cancelamento.
 *
 * A NF cancelada some do portal: o cancelamento é a correção de um registro
 * errado, e a projeção é apagada.
 */

export const CLIENT_FATURAS_COLLECTION = "client_faturas";

type Registro = Record<string, unknown>;

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

function centavos(valor: unknown): number {
  return typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0 ? valor : 0;
}

/** O título e a referência do cliente de cada demanda, para o portal dizer o que foi cobrado. */
export type DemandaParaOCliente = { titulo: string | null; ref_cliente: string | null };

/**
 * A projeção a partir da fatura como ela fica depois da mudança. `demandas`
 * traz o título e a referência que o registro leu; nas mudanças seguintes, a
 * projeção anterior os guarda (`anterior`).
 */
export function projecaoDaFatura(fatura: Registro, contexto: { demandas?: ReadonlyMap<string, DemandaParaOCliente>; anterior?: Registro | null; atualizadaEm: string }): Registro {
  const nf = fatura.nf && typeof fatura.nf === "object" ? (fatura.nf as Registro) : {};
  const valor = centavos(fatura.valor_cents);
  const recebido = centavos(fatura.recebido_cents);
  const anteriores = new Map<string, DemandaParaOCliente>();
  for (const item of Array.isArray(contexto.anterior?.demandas) ? contexto.anterior.demandas : []) {
    if (item && typeof item === "object" && texto((item as Registro).numero)) {
      const linha = item as Registro;
      anteriores.set(texto(linha.numero)!, { titulo: texto(linha.titulo), ref_cliente: texto(linha.ref_cliente) });
    }
  }
  const enviada = fatura.enviada && typeof fatura.enviada === "object" ? (fatura.enviada as Registro) : null;
  return {
    id: fatura.id,
    customer_code: fatura.customer_code,
    customer_name: texto(fatura.customer_name),
    nf: { numero: texto(nf.numero), serie: texto(nf.serie) ?? "1", emitida_em: texto(nf.emitida_em) },
    vencimento: texto(fatura.vencimento),
    forma: texto(fatura.forma),
    status: texto(fatura.status) ?? "emitida",
    valor_cents: valor,
    recebido_cents: recebido,
    saldo_cents: Math.max(0, valor - recebido),
    enviada_em: texto(enviada?.em),
    paga_em: texto(fatura.paga_em),
    demandas: (Array.isArray(fatura.demandas) ? fatura.demandas : []).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const linha = item as Registro;
      const numero = texto(linha.numero);
      if (!numero) return [];
      const daDemanda = contexto.demandas?.get(numero) ?? anteriores.get(numero) ?? { titulo: null, ref_cliente: null };
      return [{ numero, valor_cents: centavos(linha.valor_cents), titulo: daDemanda.titulo, ref_cliente: daDemanda.ref_cliente }];
    }),
    demanda_numeros: Array.isArray(fatura.demanda_numeros) ? fatura.demanda_numeros : [],
    armazenagem: (Array.isArray(fatura.armazenagem) ? fatura.armazenagem : []).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const linha = item as Registro;
      const competencia = texto(linha.competencia);
      return competencia ? [{ competencia, valor_cents: centavos(linha.valor_cents) }] : [];
    }),
    ...medicoesParaOCliente(fatura.medicoes),
    atualizada_em: contexto.atualizadaEm,
  };
}

/**
 * A medição aprovada da NF (pergunta 64): o total aprovado, as demandas dela
 * (que estão em `demandas`) e as linhas sem demanda pelo serviço. Só a NF
 * com medição ganha o campo.
 */
function medicoesParaOCliente(lista: unknown): { medicoes?: Registro[] } {
  const medicoes = (Array.isArray(lista) ? lista : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const medicao = item as Registro;
    const competencia = texto(medicao.competencia);
    if (!competencia) return [];
    const demandas = (Array.isArray(medicao.demandas) ? medicao.demandas : []).filter((numero): numero is string => typeof numero === "string" && numero.length > 0);
    const semDemanda = (Array.isArray(medicao.sem_demanda) ? medicao.sem_demanda : []).flatMap((linha) => {
      if (!linha || typeof linha !== "object") return [];
      const servico = texto((linha as Registro).servico);
      return servico ? [{ servico, valor_cents: centavos((linha as Registro).valor_cents) }] : [];
    });
    return [{ competencia, valor_cents: centavos(medicao.valor_cents), demandas, sem_demanda: semDemanda }];
  });
  return medicoes.length ? { medicoes } : {};
}

/** O título e a referência da demanda como `demands/{numero}` guarda. */
export function demandaParaOCliente(dados: Registro): DemandaParaOCliente {
  return { titulo: texto(dados.titulo), ref_cliente: texto(dados.ref_cliente) };
}
