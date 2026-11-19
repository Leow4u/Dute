import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";

import { useToast } from "@/hooks/use-toast";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { useAppUser } from "@/lib/auth";
import { avisoDoErroDaEscrita, useTentativaDaEscrita } from "@/lib/carregando/tentativa-da-escrita";
import { desfechoDoErro } from "@/lib/carregando/use-acao-na-linha";
import { canOperateWarehouse } from "@/lib/permissions";
import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import { labelsUrl } from "@/lib/warehouse-labels";
import type { AnyRecord } from "@/lib/warehouse-ops/model";
import { caixasMovidasSemEtiqueta, codigoDaCaixa, type ResultadoDoMover } from "@/lib/warehouse-ops/mover-caixa";
import { fetchWarehouseRows } from "@/lib/warehouse-rows";
import { moverCaixa, previaDoMover } from "@/lib/wms/mover-caixa";

import { EstoqueMapaMoverView, type EstadoDoMover, type ModoDoMover } from "./estoque-mapa-mover-view";

/**
 * Estoque › Mapa › Mover caixa (docs/superpowers/specs/2026-11-19-mover-caixa-design.md;
 * mockup aprovado em docs/mockups/mover-caixa/): a página de uma caixa, aberta
 * pelo "Mover" do cartão da caixa no Mapa (`?caixa=CX-000121`) ou pelo "Mover
 * caixa" do topo, com o código digitado ou lido. A prévia vem da callable
 * `previewWarehouseBoxMove` (a caixa, a sugestão, a lista e o que impede); o
 * mover, de `moveWarehouseBox`, com a prateleira de origem que a tela viu e a
 * chave da tentativa (a repetição depois de um resultado incerto leva a
 * mesma). A recusa do servidor aparece no lugar, com a frase dele.
 */

const CAIXA_INVALIDA = "Caixa inválida: confira o código e tente de novo.";
/** A frase do servidor (requireWarehouseWrite) para quem não opera o armazém: a página não chama nada sem o papel. */
const SEM_PAPEL = "Ação permitida somente para administração ou operação de armazém.";
const ID_DO_CAMPO = "mover-caixa-codigo";

/** Foca o campo da caixa depois do próximo quadro. */
function focarOCampo() {
  requestAnimationFrame(() => document.getElementById(ID_DO_CAMPO)?.focus());
}

export default function EstoqueMapaMover() {
  const daBusca = new URLSearchParams(useSearch()).get("caixa") ?? "";
  const { code, isLoading: clienteCarregando, falhou: clienteFalhou } = useActiveCustomer();
  // Sem o cliente ativo confirmado, nada é lido com o cliente padrão: o customer_code é a fronteira.
  const cliente = clienteCarregando || clienteFalhou ? null : code;
  const { user } = useAppUser();
  const operador = canOperateWarehouse(user?.publicMetadata.role);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const tentativa = useTentativaDaEscrita();

  const [digitado, setDigitado] = useState(daBusca);
  const [caixa, setCaixa] = useState<string | null>(() => codigoDaCaixa(daBusca));
  const [aviso, setAviso] = useState<string | null>(() => (daBusca && !codigoDaCaixa(daBusca) ? CAIXA_INVALIDA : null));
  const [modo, setModo] = useState<ModoDoMover>("sugestao");
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const [recusa, setRecusa] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoDoMover | null>(null);

  const previa = useQuery({
    queryKey: ["mover-caixa", cliente, caixa],
    enabled: Boolean(cliente && caixa && operador),
    queryFn: () => previaDoMover({ customer_code: cliente!, box_code: caixa! }),
    staleTime: 0,
  });
  // As caixas movidas ainda com a etiqueta antiga: a leitura do Mapa, com a mesma chave.
  const caixas = useQuery({
    queryKey: ["warehouse-boxes", "all", "all-pages"],
    staleTime: 10_000,
    queryFn: async () => (await fetchWarehouseRows<AnyRecord>("/api/warehouse/boxes?limit=5000")).map(warehouseBoxFromRecord),
  });
  const etiquetas = cliente ? caixasMovidasSemEtiqueta(caixas.data ?? [], cliente) : [];

  const dados = previa.data ?? null;
  const [sugestao, ...outras] = dados?.prateleiras ?? [];
  const alvo = modo === "escolha" ? (escolhida ?? sugestao?.code ?? null) : (sugestao?.code ?? null);
  const pedidoDe = (destino: string) => (dados ? { cliente, caixa: dados.box.code, de: dados.box.location_id, para: destino } : null);

  const mover = useMutation({
    mutationFn: (destino: string) => {
      if (!dados || !cliente) return Promise.reject(new Error(CAIXA_INVALIDA));
      // O encaixe que a tela mostrou para o destino: o servidor confere este, sem trocar a orientação nem o apoio.
      const encaixe = dados.prateleiras.find((prateleira) => prateleira.code === destino)?.placement;
      const corpo = {
        customer_code: cliente,
        box_code: dados.box.code,
        from_location_id: dados.box.location_id,
        to_location_id: destino,
        ...(sugestao ? { suggestion: { position: sugestao.code, alternatives: outras.slice(0, 2).map((outra) => outra.code) } } : {}),
        // O null no apoio vai de propósito: é "no piso, sem empilhar".
        ...(encaixe ? { ...(encaixe.orientation ? { orientation: encaixe.orientation } : {}), support_box_code: encaixe.support_box_code ?? null } : {}),
      };
      return tentativa.enviar(pedidoDe(destino), () => corpo, (comChave) => moverCaixa(comChave));
    },
    onMutate: () => setRecusa(null),
    onSuccess: (movida) => {
      setResultado(movida);
      // O Mapa, o Caixas × saldo e a etiqueta leem de novo quando abrirem.
      void queryClient.invalidateQueries({ queryKey: ["warehouse-boxes"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-balances"] });
      void queryClient.invalidateQueries({ queryKey: ["mover-caixa"] });
    },
    onError: (erro: Error) => {
      if (desfechoDoErro(erro) === "recusado") {
        // A recusa diz o motivo do servidor; a prévia lê de novo (a reserva ou a contagem pode ter mudado).
        setRecusa(erro.message);
        void queryClient.invalidateQueries({ queryKey: ["mover-caixa", cliente, caixa] });
        return;
      }
      toast({ ...avisoDoErroDaEscrita(erro, "Caixa não movida"), description: erro.message });
    },
  });

  const abrir = () => {
    const codigo = codigoDaCaixa(digitado);
    if (!codigo) {
      setAviso(CAIXA_INVALIDA);
      return;
    }
    setAviso(null);
    setDigitado(codigo);
    setResultado(null);
    setRecusa(null);
    setModo("sugestao");
    setEscolhida(null);
    setVerTodas(false);
    tentativa.esquecer();
    if (codigo === caixa) void previa.refetch();
    else setCaixa(codigo);
  };

  const outraCaixa = () => {
    setCaixa(null);
    setDigitado("");
    setAviso(null);
    setResultado(null);
    setRecusa(null);
    setModo("sugestao");
    setEscolhida(null);
    setVerTodas(false);
    tentativa.esquecer();
    focarOCampo();
  };

  // A caixa que o servidor recusou ao ler (a que não existe, a de outro cliente) diz o motivo sob o campo.
  const recusadaAoLer = previa.isError && !dados && desfechoDoErro(previa.error) === "recusado" ? (previa.error as Error).message : null;
  const estado: EstadoDoMover =
    !caixa || recusadaAoLer || !operador
      ? { fase: "vazia" }
      : resultado && dados
        ? { fase: "movida", previa: dados, resultado }
        : dados
          ? { fase: "pronta", previa: dados }
          : previa.isError
            ? { fase: "falha", caixa, erro: previa.error }
            : { fase: "carregando", caixa };
  const pedido = alvo ? pedidoDe(alvo) : null;

  return (
    <EstoqueMapaMoverView
      estado={estado}
      digitado={digitado}
      avisoDoCampo={operador ? (aviso ?? recusadaAoLer) : SEM_PAPEL}
      onDigitar={(valor) => {
        setDigitado(valor);
        if (aviso) setAviso(null);
      }}
      onAbrir={abrir}
      modo={modo}
      onModo={(proximo) => {
        setModo(proximo);
        if (proximo === "escolha" && !escolhida && sugestao) setEscolhida(sugestao.code);
      }}
      escolhida={escolhida}
      onEscolher={setEscolhida}
      verTodas={verTodas}
      onVerTodas={() => setVerTodas(true)}
      mover={{ estado: mover.isPending ? "andamento" : "repouso", rotulo: pedido && tentativa.repete(pedido) ? "Tentar de novo" : undefined }}
      onMover={(destino) => {
        if (!mover.isPending) mover.mutate(destino);
      }}
      recusa={recusa}
      etiquetas={etiquetas}
      hrefDasEtiquetas={(codigos) => labelsUrl({ boxes: [...codigos] })}
      onOutraCaixa={outraCaixa}
      onTentar={() => previa.refetch()}
    />
  );
}
