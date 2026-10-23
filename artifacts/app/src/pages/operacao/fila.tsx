import { useEffect, useRef, useState } from "react";
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
  quadroDoDia,
  type AgendaEmEdicao,
  type OsDaFila,
} from "@/lib/operacao/fila";
import { useLeitura } from "@/lib/operacao/leitura";
import { osDaBusca } from "@/lib/operacao/navegacao";

import { FilaView, type EstadoDaFila } from "./fila-view";

function estadoDe(leituras: ReadonlyArray<{ itens: unknown[] | null; erro: boolean }>): EstadoDaFila {
  if (leituras.some((leitura) => leitura.erro)) return "erro";
  if (leituras.some((leitura) => !leitura.itens)) return "carregando";
  return "pronto";
}

function porNumero<T extends { numero: string }>(itens: readonly T[]): T[] {
  return [...itens].sort((esquerda, direita) => esquerda.numero.localeCompare(direita.numero, "pt-BR"));
}

export default function PaginaFila() {
  const ordens = useLeitura("service_orders", (db) => collection(db, "service_orders"), osDaLeitura);
  const pessoas = useLeitura("collaborators", (db) => collection(db, "collaborators"), colaboradorDaLeitura);
  const veiculos = useLeitura("vehicles", (db) => collection(db, "vehicles"), veiculoDaLeitura);
  const demandas = useLeitura("demands", (db) => collection(db, "demands"), demandaDaFila);
  const clientes = useLeitura("customers", (db) => collection(db, "customers"), clienteDaLeitura);
  const hoje = hojeIso();
  const lista = comDemanda(ordens.itens ?? [], demandas.itens ?? []);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [agenda, setAgenda] = useState<AgendaEmEdicao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const chaves = useRef(new Map<string, string>());

  const os = lista.find((item) => item.numero === selecionada && item.status !== "cancelada") ?? null;
  const nomesPessoas = Object.fromEntries((pessoas.itens ?? []).map((pessoa) => [pessoa.id, pessoa.nome]));
  const placas = Object.fromEntries((veiculos.itens ?? []).map((veiculo) => [veiculo.id, veiculo.placa]));

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

  function abrirOs(item: OsDaFila) {
    setErro(null);
    setSelecionada(item.numero);
    setAgenda(agendaDaOs(item, hoje));
  }

  // O Início leva direto à OS (/operacao/hoje?os=10045-01): abre a ficha
  // quando a OS chega, uma vez por pedido.
  const pedida = osDaBusca(useSearch());
  const atendida = useRef<string | null>(null);
  useEffect(() => {
    if (!pedida || atendida.current === pedida || !ordens.itens || !demandas.itens) return;
    atendida.current = pedida;
    const item = lista.find((os) => os.numero === pedida && os.status !== "cancelada");
    if (item) abrirOs(item);
    // Só o pedido e a chegada das leituras disparam; abrirOs e lista mudam a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedida, ordens.itens, demandas.itens]);

  return (
    <FilaView
      estado={estadoDe([ordens, pessoas, veiculos, demandas, clientes])}
      hoje={hoje}
      demandas={porNumero((demandas.itens ?? []).flatMap((demanda) => (demanda.paraAbrir ? [demanda.paraAbrir] : [])))}
      quadro={quadroDoDia(lista, hoje)}
      nomesClientes={nomesPorCodigo(clientes.itens ?? [])}
      nomesPessoas={nomesPessoas}
      placas={placas}
      pessoas={(pessoas.itens ?? [])
        .filter((pessoa) => pessoa.ativo || agenda?.equipe.includes(pessoa.id))
        .map((pessoa) => ({
          id: pessoa.id,
          nome: pessoa.nome,
          funcao: pessoa.funcao,
          ativo: pessoa.ativo,
        }))}
      veiculos={(veiculos.itens ?? [])
        .filter((veiculo) => veiculo.ativo || veiculo.id === agenda?.veiculoId)
        .map((veiculo) => ({
          id: veiculo.id,
          placa: veiculo.placa,
          tipo: veiculo.tipo,
          ativo: veiculo.ativo,
        }))}
      os={os}
      agenda={os ? agenda : null}
      onAgenda={setAgenda}
      ocupado={ocupado}
      erro={erro}
      onAbrirDemanda={(numero) => {
        void gravar(`open:${numero}`, { action: "create", demanda: numero });
      }}
      onAbrirOs={abrirOs}
      onVoltar={() => {
        setErro(null);
        setSelecionada(null);
        setAgenda(null);
      }}
      onSalvar={() => {
        if (!os || !agenda || os.demandaFora) return;
        const hora = agenda.hora.trim();
        void gravar(
          `schedule:${os.numero}:${os.edicao}:${agenda.data}:${hora}:${agenda.equipe.join(",")}:${agenda.veiculoId}`,
          {
            action: "schedule",
            numero: os.numero,
            expected_edicao: os.edicao,
            data: agenda.data,
            hora: hora ? hora.slice(0, 5) : null,
            equipe: agenda.equipe,
            veiculo_id: agenda.veiculoId,
          },
          () => {
            setSelecionada(null);
            setAgenda(null);
          },
        );
      }}
      onCancelar={() => {
        if (!os || !agenda) return;
        void gravar(
          `cancel:${os.numero}:${os.edicao}:${agenda.motivo.trim()}`,
          {
            action: "cancel",
            numero: os.numero,
            expected_edicao: os.edicao,
            motivo: agenda.motivo.trim(),
          },
          () => {
            setSelecionada(null);
            setAgenda(null);
          },
        );
      }}
    />
  );
}
