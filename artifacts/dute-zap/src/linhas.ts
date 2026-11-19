/**
 * A mesma lista de functions/zap/src/domain/linhas.ts. O teste de lá trava
 * os phone_number_id. O piloto é a linha do Jamil.
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

export const LINHA_PILOTO = "1415578004977589";

export function linhaPorId(phoneNumberId: string): LinhaZap | null {
  return LINHAS_ZAP.find((linha) => linha.phone_number_id === phoneNumberId) ?? null;
}
