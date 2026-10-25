import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/hooks/use-toast";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { MEMORIA_LIBERADA } from "@/lib/liberacao";
import { alertaLido, alternarItem, alternarTodos, itensMarcados, type AlertaProposto } from "@/lib/memoria/alertas";
import { chamarNucleo } from "@/lib/memoria/api";

import { AlertasParadosView } from "./estoque-alertas-view";

/**
 * Estoque › Alertas (parte 5.4e): as propostas abertas do alerta do item
 * parado, de todos os clientes, para a coordenação aprovar com os itens ou
 * descartar. Só a callable answerStockAlert decide e grava o evento; o aviso
 * ao cliente sai do aprovado (parte 5.4f).
 */

type AnyRecord = Record<string, unknown>;

/**
 * O alerta do detalhe: o escolhido ou o que já está na tela, enquanto estão
 * na lista; o da tela que saiu dela (outra pessoa o decidiu) continua na
 * tela, e a decisão daqui para em "O alerta já foi decidido."; sem nenhum
 * dos dois, o primeiro. Senão o detalhe passaria sozinho a outro cliente
 * (também quando chega um alerta que fica antes na ordem), e "Enviar ao
 * cliente" avisaria um cliente cujo alerta ninguém conferiu.
 */
export function alertaDoDetalhe(
  alertas: readonly AlertaProposto[],
  escolhido: string | null,
  naTela: AlertaProposto | null,
): AlertaProposto | null {
  for (const id of [escolhido, naTela?.id]) {
    const naLista = id ? alertas.find((opcao) => opcao.id === id) : undefined;
    if (naLista) return naLista;
  }
  return naTela ?? alertas[0] ?? null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error((await response.text().catch(() => "")) || `HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export default function EstoqueAlertas() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { options } = useActiveCustomer();
  const nomes = useMemo(() => new Map(options.map((opcao) => [opcao.code, opcao.name])), [options]);
  const nomeDoCliente = (codigo: string) => nomes.get(codigo) ?? codigo;

  const consulta = useQuery({
    queryKey: ["stock-alerts"],
    queryFn: () => fetchJson<{ items: AnyRecord[] }>("/api/stock-alerts"),
    enabled: MEMORIA_LIBERADA,
    refetchInterval: 120_000,
  });
  // O decidido aqui sai da lista já, sem esperar a leitura nova.
  const [decididos, setDecididos] = useState<ReadonlySet<string>>(() => new Set());
  const alertas = useMemo(
    () =>
      (consulta.data?.items ?? [])
        .map(alertaLido)
        .filter((alerta): alerta is AlertaProposto => alerta !== null && !decididos.has(alerta.id))
        .sort((a, b) => (nomes.get(a.customerCode) ?? a.customerCode).localeCompare(nomes.get(b.customerCode) ?? b.customerCode, "pt-BR")),
    [consulta.data?.items, nomes, decididos],
  );
  const [escolhido, setEscolhido] = useState<string | null>(null);
  // O alerta que o detalhe mostrou por último (alertaDoDetalhe).
  const naTela = useRef<AlertaProposto | null>(null);
  const alerta = alertaDoDetalhe(alertas, escolhido, naTela.current);
  useEffect(() => {
    naTela.current = alerta;
  });
  const [marcadosPorAlerta, setMarcadosPorAlerta] = useState<Record<string, Set<string>>>({});
  const marcados = alerta ? (marcadosPorAlerta[alerta.id] ?? new Set(alerta.itens.map((item) => item.skuCode))) : new Set<string>();
  const [erro, setErro] = useState<string | null>(null);

  const decidir = useMutation({
    mutationFn: ({ decisao, alvo }: { decisao: "aprovar" | "descartar"; alvo: AlertaProposto }) =>
      chamarNucleo("answerStockAlert", { alerta_id: alvo.id, decisao, itens: decisao === "aprovar" ? itensMarcados(alvo, marcados) : [] }),
    onMutate: () => setErro(null),
    onSuccess: (_resultado, { decisao, alvo }) => {
      toast({ title: decisao === "aprovar" ? "Alerta enviado ao cliente." : "Alerta descartado." });
      setDecididos((atuais) => new Set(atuais).add(alvo.id));
      setEscolhido(null);
      naTela.current = null;
      void queryClient.invalidateQueries({ queryKey: ["stock-alerts"] });
    },
    onError: (falha) => setErro(falha instanceof Error ? falha.message : "Não consegui gravar a decisão."),
  });

  const mudarMarcados = (proximos: Set<string>) => {
    if (alerta) setMarcadosPorAlerta((atual) => ({ ...atual, [alerta.id]: proximos }));
  };

  return (
    <AlertasParadosView
      estado={MEMORIA_LIBERADA && consulta.isLoading ? "carregando" : consulta.isError ? "erro" : "pronto"}
      alertas={alertas}
      alerta={alerta}
      nomeDoCliente={nomeDoCliente}
      marcados={marcados}
      ocupado={decidir.isPending}
      erro={erro}
      acoes={{
        escolher: (id) => {
          setErro(null);
          setEscolhido(id);
        },
        marcar: (sku) => mudarMarcados(alternarItem(marcados, sku)),
        marcarTodos: () => alerta && mudarMarcados(alternarTodos(alerta, marcados)),
        enviar: () => alerta && decidir.mutate({ decisao: "aprovar", alvo: alerta }),
        descartar: () => alerta && decidir.mutate({ decisao: "descartar", alvo: alerta }),
      }}
    />
  );
}
