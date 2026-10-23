import { useEffect, useMemo, useRef, useState } from "react";
import { collection } from "firebase/firestore";
import { useSearch } from "wouter";

import { colaboradorDaLeitura, veiculoDaLeitura } from "@/lib/operacao/cadastro";
import { chamarOperacao, mensagemDoErro, novaChave } from "@/lib/operacao/api";
import {
  agendaDaOs,
  clienteDaLeitura,
  comDemanda,
  demandaDaFila,
  hojeIso,
  nomesPorCodigo,
  osDaLeitura,
  pedidoDeAgenda,
  type AgendaEmEdicao,
  type OsDaFila,
} from "@/lib/operacao/fila";
import { SEM_FILTRO, demandaDoHoje, opcoesDosFiltros, quadroDoHoje, resumoDoHoje, type FiltrosDoHoje } from "@/lib/operacao/hoje";
import { useLeitura } from "@/lib/operacao/leitura";
import { osDaBusca } from "@/lib/operacao/navegacao";

import { EscalaDaOs, HojeView, type EstadoDoHoje } from "./hoje-view";

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
  const [filtros, setFiltros] = useState<FiltrosDoHoje>(SEM_FILTRO);
  const [busca, setBusca] = useState("");
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [agenda, setAgenda] = useState<AgendaEmEdicao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const chaves = useRef(new Map<string, string>());

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
  const quadro = quadroDoHoje({ hoje, agora, demandas: demandasDoHoje, ordens: lista, nomesClientes, nomesPessoas, placas, filtros, busca });
  const opcoes = useMemo(
    () => opcoesDosFiltros({ demandas: demandasDoHoje, ordens: lista, nomesClientes, nomesPessoas }),
    // As opções só mudam com as leituras.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ordens.itens, demandas.itens, clientes.itens, pessoas.itens],
  );
  const os = lista.find((item) => item.numero === selecionada) ?? null;

  function chaveDe(escopo: string): string {
    const atual = chaves.current.get(escopo);
    if (atual) return atual;
    const nova = novaChave();
    chaves.current.set(escopo, nova);
    return nova;
  }

  async function gravar(escopo: string, dados: Record<string, unknown>, aoSalvar?: () => void) {
    setOcupado(true);
    setErro(null);
    try {
      await chamarOperacao("saveServiceOrder", { ...dados, idempotency_key: chaveDe(escopo) });
      chaves.current.delete(escopo);
      aoSalvar?.();
    } catch (error) {
      setErro(mensagemDoErro(error));
    } finally {
      setOcupado(false);
    }
  }

  function escalar(item: OsDaFila) {
    setErro(null);
    setSelecionada(item.numero);
    setAgenda(agendaDaOs(item, hoje));
  }

  function fechar() {
    setErro(null);
    setSelecionada(null);
    setAgenda(null);
  }

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

  const conteudo =
    os && agenda ? (
      <EscalaDaOs
        os={os}
        pessoas={(pessoas.itens ?? [])
          .filter((pessoa) => pessoa.ativo || agenda.equipe.includes(pessoa.id))
          .map((pessoa) => ({ id: pessoa.id, nome: pessoa.nome, funcao: pessoa.funcao, ativo: pessoa.ativo }))}
        veiculos={(veiculos.itens ?? [])
          .filter((veiculo) => veiculo.ativo || veiculo.id === agenda.veiculoId)
          .map((veiculo) => ({ id: veiculo.id, placa: veiculo.placa, tipo: veiculo.tipo, ativo: veiculo.ativo }))}
        agenda={agenda}
        onAgenda={setAgenda}
        ocupado={ocupado}
        erro={erro}
        onSalvar={() => {
          if (os.demandaFora) return;
          void gravar(
            `schedule:${os.numero}:${os.edicao}:${agenda.data}:${agenda.hora.trim()}:${agenda.equipe.join(",")}:${agenda.veiculoId}`,
            { action: "schedule", numero: os.numero, expected_edicao: os.edicao, ...pedidoDeAgenda(agenda) },
            fechar,
          );
        }}
        onCancelar={() => {
          void gravar(
            `cancel:${os.numero}:${os.edicao}:${agenda.motivo.trim()}`,
            { action: "cancel", numero: os.numero, expected_edicao: os.edicao, motivo: agenda.motivo.trim() },
            fechar,
          );
        }}
      />
    ) : null;

  return (
    <HojeView
      estado={estadoDe([ordens, pessoas, veiculos, demandas, clientes])}
      resumo={resumoDoHoje(agora, quadro)}
      quadro={quadro}
      filtros={filtros}
      opcoes={opcoes}
      busca={busca}
      onBusca={setBusca}
      onFiltros={setFiltros}
      erro={erro}
      onEscalar={escalar}
      escala={
        os && conteudo
          ? { titulo: `${os.status === "agendada" ? "Reagendar" : "Escalar"} OS ${os.numero}`, cliente: nomesClientes[os.customer_code] || os.customer_code, conteudo, onFechar: fechar }
          : null
      }
    />
  );
}
