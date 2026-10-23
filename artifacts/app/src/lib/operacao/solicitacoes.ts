import { TIPOS_DE_SERVICO, TIPO_DE_SERVICO_ROTULO, type TipoDeServico } from "../portal/solicitacao";
import { formularioVazio, tipoPelaHora, type FormularioDaDemanda } from "./demanda-direta";
import type { TipoDaDemanda } from "./hoje";
import { ROTA_NOVA_DEMANDA } from "./navegacao";

/**
 * As solicitações de OS do portal na Operação (docs/plataforma/fase-4-financeiro.md,
 * parte 4.4c): a solicitação recebida cai em Para planejar do Hoje e no
 * Início; quem coordena a atende abrindo a demanda direta com o formulário
 * preenchido por ela (openDirectDemand com `solicitacao_id`) ou a recusa com
 * o motivo (declineServiceRequest). Nunca vira OS sem o planejamento.
 */

export const MIN_MOTIVO = 5;
export const MAX_MOTIVO = 300;

export type AnexoDaSolicitacao = { caminho: string; nome: string; tipo: string };

export type SolicitacaoDaOperacao = {
  id: string;
  status: "recebida" | "aceita" | "recusada";
  customerCode: string;
  /** O nome do cliente como a solicitação gravou. */
  cliente: string;
  tipoServico: TipoDeServico;
  /** A data e o horário pedidos, em São Paulo. */
  data: string;
  horario: string;
  /** O mesmo instante, em ISO. */
  desejadaEm: string;
  recebidaEm: string;
  origem: string;
  destino: string | null;
  descricao: string;
  anexos: AnexoDaSolicitacao[];
  contato: { nome: string; email: string | null };
  demanda: string | null;
};

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** A solicitação de `service_requests` como a Operação usa; null quando falta o essencial. */
export function solicitacaoDaOperacao(id: string, dados: Record<string, unknown>): SolicitacaoDaOperacao | null {
  const status = texto(dados.status);
  const tipoServico = texto(dados.tipo_servico) as TipoDeServico;
  const customerCode = texto(dados.customer_code);
  const desejadaEm = texto(dados.desejada_em);
  const recebidaEm = texto(dados.recebida_em);
  if (status !== "recebida" && status !== "aceita" && status !== "recusada") return null;
  if (!customerCode || !(TIPOS_DE_SERVICO as readonly string[]).includes(tipoServico)) return null;
  if (Number.isNaN(Date.parse(desejadaEm)) || Number.isNaN(Date.parse(recebidaEm))) return null;
  const contato = dados.contato && typeof dados.contato === "object" ? (dados.contato as Record<string, unknown>) : {};
  return {
    id,
    status,
    customerCode,
    cliente: texto(dados.customer_name) || customerCode,
    tipoServico,
    data: texto(dados.data),
    horario: texto(dados.horario),
    desejadaEm,
    recebidaEm,
    origem: texto(dados.origem),
    destino: texto(dados.destino) || null,
    descricao: texto(dados.descricao),
    anexos: (Array.isArray(dados.anexos) ? dados.anexos : []).flatMap((bruto) => {
      if (!bruto || typeof bruto !== "object") return [];
      const anexo = bruto as Record<string, unknown>;
      const caminho = texto(anexo.caminho);
      return caminho ? [{ caminho, nome: texto(anexo.nome) || caminho.slice(caminho.lastIndexOf("/") + 1), tipo: texto(anexo.tipo) }] : [];
    }),
    contato: { nome: texto(contato.nome), email: texto(contato.email) || null },
    demanda: texto(dados.demanda) || null,
  };
}

/** O tipo da demanda que ela vira, pela hora do pedido e pela hora pedida (a mesma régua da direta). */
export function tipoDaSolicitacao(solicitacao: Pick<SolicitacaoDaOperacao, "recebidaEm" | "desejadaEm">): TipoDaDemanda {
  return tipoPelaHora(solicitacao.recebidaEm, solicitacao.desejadaEm) ?? "planejada";
}

const DIA_DA_SEMANA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short" });

/** "Transporte / frete · Sáb 24/10 08:00". */
export function pedidoEmTexto(solicitacao: Pick<SolicitacaoDaOperacao, "tipoServico" | "data" | "horario" | "desejadaEm">): string {
  const semana = DIA_DA_SEMANA.format(new Date(solicitacao.desejadaEm)).replace(".", "");
  const [, mes, dia] = solicitacao.data.split("-");
  return `${TIPO_DE_SERVICO_ROTULO[solicitacao.tipoServico]} · ${semana.charAt(0).toUpperCase()}${semana.slice(1)} ${dia}/${mes} ${solicitacao.horario}`;
}

/** "Rua das Indústrias, 450 → Av. Paulista, 1000", ou só a origem. */
export function rotaDaSolicitacao(solicitacao: Pick<SolicitacaoDaOperacao, "origem" | "destino">): string {
  return [solicitacao.origem, solicitacao.destino].filter(Boolean).join(" → ");
}

export function hrefDeAtender(id: string): string {
  return `${ROTA_NOVA_DEMANDA}?solicitacao=${encodeURIComponent(id)}`;
}

/** A solicitação pedida na busca da URL da nova demanda (`?solicitacao=`), ou null. */
export function solicitacaoDaBusca(busca: string): string | null {
  const id = new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca).get("solicitacao")?.trim() ?? "";
  return /^sol_[a-f0-9]{16}$/.test(id) ? id : null;
}

const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const HORA = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * O formulário da demanda direta preenchido pela solicitação: o cliente, o
 * título pelo tipo de serviço, quem pediu, o canal portal, quando chegou,
 * executar até a data e o horário pedidos e os endereços digitados pelo
 * cliente no "andar ou sala" (até 120 caracteres; o local cadastrado quem
 * coordena escolhe). Os itens, quem coordena inclui do catálogo.
 */
export function formularioDaSolicitacao(solicitacao: SolicitacaoDaOperacao, agora: Date): FormularioDaDemanda {
  const recebida = new Date(solicitacao.recebidaEm);
  return {
    ...formularioVazio(agora),
    customerCode: solicitacao.customerCode,
    titulo: TIPO_DE_SERVICO_ROTULO[solicitacao.tipoServico],
    canal: "portal",
    pedidoPorNome: solicitacao.contato.nome.slice(0, 80),
    recebidaData: DIA.format(recebida),
    recebidaHora: HORA.format(recebida),
    executarData: solicitacao.data,
    executarHora: solicitacao.horario,
    origemComplemento: solicitacao.origem.slice(0, 120),
    destinoComplemento: (solicitacao.destino ?? "").slice(0, 120),
  };
}

/** Por que a solicitação não se atende nem se recusa mais, ou null quando ainda espera a Operação. */
export function solicitacaoResolvida(solicitacao: Pick<SolicitacaoDaOperacao, "status" | "demanda">): string | null {
  if (solicitacao.status === "aceita") return solicitacao.demanda ? `Já virou a demanda ${solicitacao.demanda}` : "Já virou demanda";
  if (solicitacao.status === "recusada") return "Recusada";
  return null;
}

/** O motivo da recusa, que o cliente lê: de 5 a 300 caracteres. */
export function problemaDoMotivo(motivo: string): string | null {
  const limpo = motivo.trim().replace(/\s+/g, " ");
  if (limpo.length < MIN_MOTIVO) return "Diga ao cliente o motivo.";
  if (limpo.length > MAX_MOTIVO) return `Use até ${MAX_MOTIVO} caracteres.`;
  return null;
}

/** As que esperam a Operação, a de data pedida mais perto primeiro. */
export function solicitacoesRecebidas(lista: readonly SolicitacaoDaOperacao[]): SolicitacaoDaOperacao[] {
  return lista.filter((item) => item.status === "recebida").sort((a, b) => a.desejadaEm.localeCompare(b.desejadaEm) || a.id.localeCompare(b.id));
}
