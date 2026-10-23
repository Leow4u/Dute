import { useState } from "react";
import { collection } from "firebase/firestore";
import { useSearch } from "wouter";

import { agendaDaSemana, dataValida, inicioDaSemana, proximaSemana, semanaAnterior, tituloDaSemana } from "@/lib/operacao/agenda";
import { colaboradorDaLeitura, veiculoDaLeitura } from "@/lib/operacao/cadastro";
import { clienteDaLeitura, comDemanda, demandaDaFila, hojeIso, nomesPorCodigo, osDaLeitura } from "@/lib/operacao/fila";
import { demandaDoHoje } from "@/lib/operacao/hoje";
import { useLeitura } from "@/lib/operacao/leitura";
import { ROTA_AGENDA, hrefDaSemana, semanaDaBusca } from "@/lib/operacao/navegacao";

import { AgendaView, type EstadoDaAgenda } from "./agenda-view";
import { useEscala } from "./use-escala";

/** Operação › Agenda (parte 3.6b): as leituras, a semana da URL (?semana=) e o escalar sobre AgendaView. */

function estadoDe(leituras: ReadonlyArray<{ itens: unknown[] | null; erro: boolean }>): EstadoDaAgenda {
  if (leituras.some((leitura) => leitura.erro)) return "erro";
  if (leituras.some((leitura) => !leitura.itens)) return "carregando";
  return "pronto";
}

export default function PaginaAgenda() {
  const ordens = useLeitura("service_orders", (db) => collection(db, "service_orders"), osDaLeitura);
  const pessoas = useLeitura("collaborators", (db) => collection(db, "collaborators"), colaboradorDaLeitura);
  const veiculos = useLeitura("vehicles", (db) => collection(db, "vehicles"), veiculoDaLeitura);
  const demandas = useLeitura("demands", (db) => collection(db, "demands"), (id, data) => ({ fila: demandaDaFila(id, data), agenda: demandaDoHoje(id, data) }));
  const clientes = useLeitura("customers", (db) => collection(db, "customers"), clienteDaLeitura);
  const [busca, setBusca] = useState("");
  const [selecionada, setSelecionada] = useState<string | null>(null);

  const hoje = hojeIso();
  const pedida = semanaDaBusca(useSearch());
  const segunda = inicioDaSemana(pedida && dataValida(pedida) ? pedida : hoje);
  const estaSemana = inicioDaSemana(hoje);

  const lista = comDemanda(
    (ordens.itens ?? []).filter((os) => os.status !== "cancelada"),
    (demandas.itens ?? []).map((demanda) => demanda.fila),
  );
  const nomesClientes = nomesPorCodigo(clientes.itens ?? []);
  const agenda = agendaDaSemana({
    segunda,
    hoje,
    ordens: lista,
    pessoas: pessoas.itens ?? [],
    veiculos: veiculos.itens ?? [],
    nomesClientes,
    demandas: Object.fromEntries(
      (demandas.itens ?? []).flatMap((demanda) => (demanda.agenda ? [[demanda.agenda.numero, { titulo: demanda.agenda.titulo, tipo: demanda.agenda.tipo }]] : [])),
    ),
    busca,
  });
  const { escalar, escala, erro } = useEscala({ lista, pessoas: pessoas.itens ?? [], veiculos: veiculos.itens ?? [], nomesClientes, hoje });

  return (
    <AgendaView
      estado={estadoDe([ordens, pessoas, veiculos, demandas, clientes])}
      agenda={agenda}
      titulo={tituloDaSemana(agenda.dias)}
      semana={{
        anterior: hrefDaSemana(semanaAnterior(segunda)),
        proxima: hrefDaSemana(proximaSemana(segunda)),
        hoje: ROTA_AGENDA,
        ehEstaSemana: segunda === estaSemana,
      }}
      busca={busca}
      onBusca={setBusca}
      selecionada={selecionada}
      onSelecionar={setSelecionada}
      onEscalar={(numero) => {
        const os = lista.find((item) => item.numero === numero);
        if (os) escalar(os);
      }}
      erro={erro}
      escala={escala}
    />
  );
}
