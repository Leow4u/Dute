import { CalendarClock, CalendarX } from "lucide-react";

import type { ItemDoInicio } from "../inicio-do-modulo";
import { nomeDoRegistro, textoDoPrazo, type VencimentoDoRh } from "./ficha";
import { hrefDaFicha } from "./navegacao";

/**
 * O "Precisa de você" do RH (parte 8.2c): uma linha por pessoa com registro
 * vencido ou vencendo, o vencido primeiro (crítico) e, dentro do mesmo tom,
 * o prazo mais curto. A ação abre a ficha. É a mesma lista que conta o card
 * da entrada e o menu (lib/resumo-do-modulo.ts).
 */

export function itensDoInicioDoRh(vencimentos: readonly VencimentoDoRh[]): ItemDoInicio[] {
  const porPessoa = new Map<string, VencimentoDoRh[]>();
  for (const vencimento of vencimentos) porPessoa.set(vencimento.colaborador_id, [...(porPessoa.get(vencimento.colaborador_id) ?? []), vencimento]);
  return [...porPessoa.values()]
    .map((dela) => {
      const ordenados = [...dela].sort((a, b) => a.dias - b.dias);
      const vencido = ordenados[0].dias < 0;
      const item: ItemDoInicio = {
        id: `rh-${ordenados[0].colaborador_id}`,
        tone: vencido ? "critical" : "attention",
        icon: vencido ? CalendarX : CalendarClock,
        title: ordenados[0].nome,
        detail: ordenados.map((vencimento) => `${nomeDoRegistro(vencimento)} ${textoDoPrazo(vencimento.dias)}`).join(" · "),
        href: hrefDaFicha(ordenados[0].colaborador_id),
        actionLabel: "Abrir a ficha",
      };
      return { item, urgencia: ordenados[0].dias };
    })
    .sort((a, b) => Number(b.item.tone === "critical") - Number(a.item.tone === "critical") || a.urgencia - b.urgencia || a.item.title.localeCompare(b.item.title, "pt-BR"))
    .map(({ item }) => item);
}

export type NumerosDoRh = { pessoas: number; vencidos: number; vencendo: number; semRegistro: number };

export function numerosDoRh(painel: { colaboradores: ReadonlyArray<{ registros: number }>; vencimentos: ReadonlyArray<{ dias: number }> }): NumerosDoRh {
  return {
    pessoas: painel.colaboradores.length,
    vencidos: painel.vencimentos.filter((vencimento) => vencimento.dias < 0).length,
    vencendo: painel.vencimentos.filter((vencimento) => vencimento.dias >= 0).length,
    semRegistro: painel.colaboradores.filter((colaborador) => colaborador.registros === 0).length,
  };
}
