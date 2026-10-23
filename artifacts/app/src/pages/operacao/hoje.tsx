import { useEffect, useMemo, useRef, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { useSearch } from "wouter";

import { colaboradorDaLeitura, veiculoDaLeitura } from "@/lib/operacao/cadastro";
import { clienteDaLeitura, comDemanda, demandaDaFila, hojeIso, nomesPorCodigo, osDaLeitura } from "@/lib/operacao/fila";
import { SEM_FILTRO, demandaDoHoje, opcoesDosFiltros, quadroDoHoje, resumoDoHoje, type FiltrosDoHoje } from "@/lib/operacao/hoje";
import { useLeitura } from "@/lib/operacao/leitura";
import { osDaBusca } from "@/lib/operacao/navegacao";
import { solicitacaoDaOperacao } from "@/lib/operacao/solicitacoes";

import { HojeView, type EstadoDoHoje } from "./hoje-view";
import { useEscala } from "./use-escala";

/** Operação › Hoje (parte 3.5a): as leituras, os filtros e as ações sobre HojeView. */

function estadoDe(leituras: ReadonlyArray<{ itens: unknown[] | null; erro: boolean }>): EstadoDoHoje {
  if (leituras.some((leitura) => leitura.erro)) return "erro";
  if (leituras.some((leitura) => !leitura.itens)) return "carregando";
  return "pronto";
}

export default function PaginaHoje() {
  const ordens = useLeitura("service_orders", (db) => collection(db, "service_orders"), osDaLeitura);
  const pessoas = useLeitura("collaborators", (db) => collection(db, "collaborators"), colaboradorDaLeitura);
  const veiculos = useLeitura("vehicles", (db) => collection(db, "vehicles"), veiculoDaLeitura);
  const demandas = useLeitura("demands", (db) => collection(db, "demands"), (id, data) => ({ fila: demandaDaFila(id, data), hoje: demandaDoHoje(id, data) }));
  const clientes = useLeitura("customers", (db) => collection(db, "customers"), clienteDaLeitura);
  // As solicitações do portal que esperam a Operação (parte 4.4c).
  const solicitacoes = useLeitura(
    "service_requests:recebidas",
    (db) => query(collection(db, "service_requests"), where("status", "==", "recebida")),
    solicitacaoDaOperacao,
  );
  const [filtros, setFiltros] = useState<FiltrosDoHoje>(SEM_FILTRO);
  const [busca, setBusca] = useState("");

  const hoje = hojeIso();
  const lista = comDemanda(
    (ordens.itens ?? []).filter((os) => os.status !== "cancelada" && os.status !== "revisada"),
    (demandas.itens ?? []).map((demanda) => demanda.fila),
  );
  const nomesClientes = nomesPorCodigo(clientes.itens ?? []);
  const nomesPessoas = Object.fromEntries((pessoas.itens ?? []).map((pessoa) => [pessoa.id, pessoa.nome]));
  const placas = Object.fromEntries((veiculos.itens ?? []).map((veiculo) => [veiculo.id, veiculo.placa]));
  const demandasDoHoje = (demandas.itens ?? []).flatMap((demanda) => (demanda.hoje ? [demanda.hoje] : []));
  const agora = new Date();
  const quadro = quadroDoHoje({ hoje, agora, demandas: demandasDoHoje, ordens: lista, solicitacoes: solicitacoes.itens ?? [], nomesClientes, nomesPessoas, placas, filtros, busca });
  const opcoes = useMemo(
    () => opcoesDosFiltros({ demandas: demandasDoHoje, ordens: lista, solicitacoes: solicitacoes.itens ?? [], nomesClientes, nomesPessoas }),
    // As opções só mudam com as leituras.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ordens.itens, demandas.itens, clientes.itens, pessoas.itens, solicitacoes.itens],
  );
  const { escalar, escala, erro } = useEscala({ lista, pessoas: pessoas.itens ?? [], veiculos: veiculos.itens ?? [], nomesClientes, hoje });

  // O Início leva direto à OS (/operacao/hoje?os=10045-01): abre o painel
  // quando a OS chega, uma vez por pedido.
  const pedida = osDaBusca(useSearch());
  const atendida = useRef<string | null>(null);
  useEffect(() => {
    if (!pedida || atendida.current === pedida || !ordens.itens || !demandas.itens) return;
    atendida.current = pedida;
    const item = lista.find((itemDaLista) => itemDaLista.numero === pedida);
    if (item) escalar(item);
    // Só o pedido e a chegada das leituras disparam; escalar e lista mudam a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedida, ordens.itens, demandas.itens]);

  return (
    <HojeView
      estado={estadoDe([ordens, pessoas, veiculos, demandas, clientes, solicitacoes])}
      resumo={resumoDoHoje(agora, quadro)}
      quadro={quadro}
      filtros={filtros}
      opcoes={opcoes}
      busca={busca}
      onBusca={setBusca}
      onFiltros={setFiltros}
      erro={erro}
      onEscalar={escalar}
      escala={escala}
    />
  );
}
