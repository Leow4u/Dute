import { useState } from "react";
import { collection } from "firebase/firestore";

import { clienteDaLeitura, comDemanda, demandaDaFila, hojeIso, nomesPorCodigo, osDaLeitura } from "@/lib/operacao/fila";
import { SEM_FILTRO_DE_DEMANDAS, clientesDasDemandas, demandaDaOperacao, linhasDeDemandas, type FiltrosDeDemandas } from "@/lib/operacao/demandas";
import { useLeitura } from "@/lib/operacao/leitura";

import { DemandasView, type EstadoDasDemandas } from "./demandas-view";

/** Operação › Demandas (parte 3.5b): as leituras, os filtros e a busca sobre DemandasView. */

function estadoDe(leituras: ReadonlyArray<{ itens: unknown[] | null; erro: boolean }>): EstadoDasDemandas {
  if (leituras.some((leitura) => leitura.erro)) return "erro";
  if (leituras.some((leitura) => !leitura.itens)) return "carregando";
  return "pronto";
}

const DIA_E_HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** "Sexta, 23 de outubro · 14:20 · 13 demandas". */
export function resumoDasDemandas(agora: Date, quantas: number): string {
  const partes = DIA_E_HORA.formatToParts(agora);
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  const semana = valor("weekday").replace("-feira", "");
  const dia = `${semana.charAt(0).toLocaleUpperCase("pt-BR")}${semana.slice(1)}, ${valor("day")} de ${valor("month")}`;
  return `${dia} · ${valor("hour")}:${valor("minute")} · ${quantas} ${quantas === 1 ? "demanda" : "demandas"}`;
}

export default function PaginaDemandas() {
  const demandas = useLeitura("demands", (db) => collection(db, "demands"), (id, data) => ({ fila: demandaDaFila(id, data), ficha: demandaDaOperacao(id, data) }));
  const ordens = useLeitura("service_orders", (db) => collection(db, "service_orders"), osDaLeitura);
  const clientes = useLeitura("customers", (db) => collection(db, "customers"), clienteDaLeitura);
  const [filtros, setFiltros] = useState<FiltrosDeDemandas>(SEM_FILTRO_DE_DEMANDAS);
  const [busca, setBusca] = useState("");

  const agora = new Date();
  const nomesClientes = nomesPorCodigo(clientes.itens ?? []);
  const fichas = (demandas.itens ?? []).flatMap((demanda) => (demanda.ficha ? [demanda.ficha] : []));
  const lista = comDemanda(ordens.itens ?? [], (demandas.itens ?? []).map((demanda) => demanda.fila));
  const linhas = linhasDeDemandas({ demandas: fichas, ordens: lista, nomesClientes, hoje: hojeIso(agora), agora, filtros, busca });

  return (
    <DemandasView
      estado={estadoDe([demandas, ordens, clientes])}
      resumo={resumoDasDemandas(agora, linhas.length)}
      linhas={linhas}
      filtros={filtros}
      clientes={clientesDasDemandas(fichas, nomesClientes)}
      busca={busca}
      onBusca={setBusca}
      onFiltros={setFiltros}
    />
  );
}
