import { useRef, useState } from "react";

import { EscalaDaOs, type EscalaAberta } from "@/components/operacao/escala";
import { chamarOperacao, mensagemDoErro, novaChave } from "@/lib/operacao/api";
import type { ColaboradorDaLista, VeiculoDaLista } from "@/lib/operacao/cadastro";
import { agendaDaOs, pedidoDeAgenda, type AgendaEmEdicao, type OsDaFila } from "@/lib/operacao/fila";

/**
 * Escalar, reagendar e cancelar a OS pelo painel lateral (parte 3.5a), no
 * Hoje e na Agenda (parte 3.6b): a OS escolhida, o formulário e a gravação
 * pela callable, com a chave de idempotência por tentativa.
 */
export function useEscala({
  lista,
  pessoas,
  veiculos,
  nomesClientes,
  hoje,
}: {
  lista: readonly OsDaFila[];
  pessoas: readonly ColaboradorDaLista[];
  veiculos: readonly VeiculoDaLista[];
  nomesClientes: Readonly<Record<string, string>>;
  hoje: string;
}): { escalar: (os: OsDaFila) => void; escala: EscalaAberta | null; erro: string | null } {
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [agenda, setAgenda] = useState<AgendaEmEdicao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const chaves = useRef(new Map<string, string>());
  const os = lista.find((item) => item.numero === selecionada) ?? null;

  function chaveDe(escopo: string): string {
    const atual = chaves.current.get(escopo);
    if (atual) return atual;
    const nova = novaChave();
    chaves.current.set(escopo, nova);
    return nova;
  }

  async function gravar(escopo: string, dados: Record<string, unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      await chamarOperacao("saveServiceOrder", { ...dados, idempotency_key: chaveDe(escopo) });
      chaves.current.delete(escopo);
      fechar();
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

  if (!os || !agenda) return { escalar, escala: null, erro };
  return {
    escalar,
    erro,
    escala: {
      titulo: `${os.status === "agendada" ? "Reagendar" : "Escalar"} OS ${os.numero}`,
      cliente: nomesClientes[os.customer_code] || os.customer_code,
      onFechar: fechar,
      conteudo: (
        <EscalaDaOs
          os={os}
          pessoas={pessoas
            .filter((pessoa) => pessoa.ativo || agenda.equipe.includes(pessoa.id))
            .map((pessoa) => ({ id: pessoa.id, nome: pessoa.nome, funcao: pessoa.funcao, ativo: pessoa.ativo }))}
          veiculos={veiculos
            .filter((veiculo) => veiculo.ativo || veiculo.id === agenda.veiculoId)
            .map((veiculo) => ({ id: veiculo.id, placa: veiculo.placa, tipo: veiculo.tipo, ativo: veiculo.ativo }))}
          agenda={agenda}
          onAgenda={setAgenda}
          ocupado={ocupado}
          erro={erro}
          onSalvar={() => {
            if (os.demandaFora) return;
            void gravar(`schedule:${os.numero}:${os.edicao}:${agenda.data}:${agenda.hora.trim()}:${agenda.equipe.join(",")}:${agenda.veiculoId}`, {
              action: "schedule",
              numero: os.numero,
              expected_edicao: os.edicao,
              ...pedidoDeAgenda(agenda),
            });
          }}
          onCancelar={() => {
            void gravar(`cancel:${os.numero}:${os.edicao}:${agenda.motivo.trim()}`, {
              action: "cancel",
              numero: os.numero,
              expected_edicao: os.edicao,
              motivo: agenda.motivo.trim(),
            });
          }}
        />
      ),
    },
  };
}
