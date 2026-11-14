import { collection, query, where } from "firebase/firestore";

import type { ProfileRole } from "../modules";
import { SEM_NOVA_TENTATIVA, novaTentativaDe, useLeitura, type NovaTentativa } from "../operacao/leitura";
import { diasDoMes, faturaDoFinanceiro, pagamentoDaNf, type FaturaDoFinanceiro, type PagamentoDaNf } from "./faturas";
import { abreFinanceiro } from "./navegacao";

/**
 * As NFs registradas (`faturas`) e os pagamentos da NF aberta (`pagamentos`),
 * ao vivo, só para quem abre o Financeiro: as regras abrem as duas coleções a
 * quem lê preço. A escrita é só da callable advanceFatura.
 */

export type LeituraDasFaturas = {
  faturas: FaturaDoFinanceiro[] | undefined;
  carregando: boolean;
  falhas: string[];
  /**
   * A nova tentativa da leitura que falhou (parte 13g), com o que falta: a
   * conexão, com a hora da lista lida, ou o servidor (parte 13l).
   */
  releitura: NovaTentativa;
};

export function useFaturas(role: ProfileRole | null | undefined, ligado = true): LeituraDasFaturas {
  const abre = ligado && abreFinanceiro(role);
  const faturas = useLeitura(abre ? "financeiro:faturas" : null, (db) => collection(db, "faturas"), faturaDoFinanceiro);
  if (!abre) return { faturas: undefined, carregando: false, falhas: [], releitura: SEM_NOVA_TENTATIVA };
  // A falta vai junto, para a tela dizer se é a conexão ou o servidor, e de quando é a lista lida (parte 13l).
  const releitura: NovaTentativa = { ...novaTentativaDe([faturas]), tentar: faturas.tentar };
  if (faturas.erro) return { faturas: undefined, carregando: false, falhas: ["faturas"], releitura };
  return { faturas: faturas.itens ?? undefined, carregando: faturas.itens === null, falhas: [], releitura };
}

/** Os pagamentos da NF aberta; null enquanto carregam (ou sem NF aberta). */
export function usePagamentosDaNf(faturaId: string | null): { pagamentos: PagamentoDaNf[] | null; erro: boolean } & NovaTentativa {
  const leitura = useLeitura(
    faturaId ? `financeiro:pagamentos:${faturaId}` : null,
    (db) => query(collection(db, "pagamentos"), where("fatura_id", "==", faturaId)),
    pagamentoDaNf,
  );
  return { pagamentos: leitura.itens, erro: leitura.erro, tentando: leitura.tentando, tentar: leitura.tentar, falta: leitura.falta, lidaEm: leitura.lidaEm };
}

/** Os pagamentos com o dia dentro do mês ("2026-10"), ao vivo; null enquanto carregam. */
export function usePagamentosDoMes(role: ProfileRole | null | undefined, mes: string, ligado = true): { pagamentos: PagamentoDaNf[] | null; erro: boolean } & NovaTentativa {
  const dias = diasDoMes(mes);
  const abre = ligado && abreFinanceiro(role) && dias !== null;
  const leitura = useLeitura(
    abre ? `financeiro:pagamentos-do-mes:${mes}` : null,
    (db) => query(collection(db, "pagamentos"), where("recebido_em", ">=", dias!.de), where("recebido_em", "<=", dias!.ate)),
    pagamentoDaNf,
  );
  return { pagamentos: leitura.itens, erro: leitura.erro, tentando: leitura.tentando, tentar: leitura.tentar, falta: leitura.falta, lidaEm: leitura.lidaEm };
}
