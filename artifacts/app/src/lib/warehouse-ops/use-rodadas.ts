import { useMemo } from "react";
import { collection, limit, query, where } from "firebase/firestore";

import { novaTentativaDe, useLeitura, type NovaTentativa } from "@/lib/operacao/leitura";

import { RODADA_DA_RECONTAGEM_GERAL, type RodadaDaRecontagem } from "./recontagem-por-caixa";
import { anterioresDaContagem, rodadaAberta, rodadaRegistrada, type RodadaRegistrada } from "./rodadas-da-contagem";

/**
 * As rodadas da contagem do cliente ativo, ao vivo (`count_rounds` por
 * cliente): a aberta, para a entrada, a Contagem por caixa e a bancada
 * gravarem nela, e as concluídas, para "Anteriores". A recontagem geral de
 * 17/11 sem documento vale como a aberta enquanto tem recontagem gravada
 * com o id fixo (uma basta). Toda consulta é por igualdade e pelo cliente
 * ativo: o `customer_code` é a fronteira.
 */

export type LeituraDasRodadas = {
  /** A rodada aberta do cliente; null sem nenhuma. */
  aberta: RodadaDaRecontagem | null;
  /** As concluídas, a mais recente primeiro. */
  anteriores: RodadaRegistrada[];
  /** Todas as registradas do cliente, para abrir uma por id. */
  registradas: RodadaRegistrada[];
  carregando: boolean;
  /** A leitura falhou sem nada lido. */
  falhou: boolean;
  leitura: NovaTentativa;
};

const SEM_RODADAS: RodadaRegistrada[] = [];
const SEM_LEGADAS: string[] = [];

export function useRodadasDaContagem(cliente: string | null): LeituraDasRodadas {
  const codigo = String(cliente ?? "").trim();
  const doCliente = codigo || null;
  const rodadas = useLeitura<RodadaRegistrada>(
    doCliente ? `count_rounds:${codigo}` : null,
    (db) => query(collection(db, "count_rounds"), where("customer_code", "==", codigo)),
    rodadaRegistrada,
  );
  const legadas = useLeitura<string>(
    doCliente ? `cycle_counts:${codigo}:${RODADA_DA_RECONTAGEM_GERAL.id}:uma` : null,
    (db) => query(collection(db, "cycle_counts"), where("customer_code", "==", codigo), where("round_id", "==", RODADA_DA_RECONTAGEM_GERAL.id), limit(1)),
    (id) => id,
  );
  const registradas = rodadas.itens ?? SEM_RODADAS;
  const legadasLidas = legadas.itens ?? SEM_LEGADAS;
  const aberta = useMemo(() => rodadaAberta(registradas, doCliente, legadasLidas.length > 0), [registradas, doCliente, legadasLidas]);
  const anteriores = useMemo(() => anterioresDaContagem(registradas, doCliente), [registradas, doCliente]);
  const aoVivo = [rodadas, legadas];
  return {
    aberta,
    anteriores,
    registradas,
    carregando: Boolean(doCliente) && aoVivo.some((lida) => lida.itens === null && !lida.erro),
    falhou: aoVivo.some((lida) => lida.erro && lida.itens === null),
    leitura: novaTentativaDe(aoVivo),
  };
}
