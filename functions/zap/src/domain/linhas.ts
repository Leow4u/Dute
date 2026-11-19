/**
 * Linhas da WABA Dutelog. O phone_number_id é o da Cloud API; o telefone é o
 * que a pessoa vê. O painel (artifacts/dute-zap/src/linhas.ts) repete esta
 * lista, e linhas.test.ts trava as duas.
 *
 * O piloto grava só a linha do Jamil: o relay e o envio dele é que passam a
 * chamar a ingestão. As outras linhas aparecem no painel para quando entrarem.
 */

export type LinhaZap = {
  phone_number_id: string;
  agente: string;
  nome: string;
  area: string;
  telefone: string;
};

export const LINHAS_ZAP: readonly LinhaZap[] = [
  { phone_number_id: "1027983403741650", agente: "clara", nome: "Clara", area: "Comercial", telefone: "11 96607-6831" },
  { phone_number_id: "1138046412727833", agente: "rafael", nome: "Rafael", area: "Orçamentista", telefone: "11 93623-6252" },
  { phone_number_id: "1338744619330876", agente: "sueli", nome: "Sueli", area: "RH", telefone: "11 95504-9459" },
  { phone_number_id: "1372203299320671", agente: "sueli-colaboradores", nome: "Sueli", area: "RH Colaboradores", telefone: "11 95507-4950" },
  { phone_number_id: "1345453701990219", agente: "joao", nome: "João", area: "Operacional", telefone: "11 95504-9551" },
  { phone_number_id: "1415578004977589", agente: "jamil", nome: "Jamil", area: "Compras", telefone: "11 95507-5266" },
];

/** A primeira linha que o relay passa a registrar. */
export const LINHA_PILOTO = "1415578004977589";

export function linhaPorId(phoneNumberId: string): LinhaZap | null {
  return LINHAS_ZAP.find((linha) => linha.phone_number_id === phoneNumberId) ?? null;
}

export type CamposDaLinha = {
  agent: string;
  agent_name: string;
  area: string;
  line_phone: string;
};

export function camposDaLinha(phoneNumberId: string): CamposDaLinha {
  const linha = linhaPorId(phoneNumberId);
  if (!linha) return { agent: "desconhecido", agent_name: "Linha", area: "Fora do catálogo", line_phone: "" };
  return { agent: linha.agente, agent_name: linha.nome, area: linha.area, line_phone: linha.telefone };
}
