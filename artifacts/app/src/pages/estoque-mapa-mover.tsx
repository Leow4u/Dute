import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";

import { useToast } from "@/hooks/use-toast";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { useAppUser } from "@/lib/auth";
import { relerDoZero } from "@/lib/carregando/reler-do-zero";
import { avisoDoErroDaEscrita, useTentativaDaEscrita } from "@/lib/carregando/tentativa-da-escrita";
import { desfechoDoErro } from "@/lib/carregando/use-acao-na-linha";
import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { canOperateWarehouse } from "@/lib/permissions";
import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import { labelsUrl } from "@/lib/warehouse-labels";
import type { AnyRecord } from "@/lib/warehouse-ops/model";
import { caixasMovidasSemEtiqueta, codigoDaCaixa, textoDaMovida, type ResultadoDoMover } from "@/lib/warehouse-ops/mover-caixa";
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
/** O destino que não está na lista da prévia: a tela não manda o mover sem o encaixe que mostrou. */
const FORA_DA_LISTA = "Escolha uma prateleira da lista.";
const ID_DO_CAMPO = "mover-caixa-codigo";
/** O "Imprimir etiqueta" da caixa movida (estoque-mapa-mover-view.tsx). */
const ID_DA_ETIQUETA = "mover-caixa-etiqueta";

/** Foca o elemento do id depois do próximo quadro: o campo, o botão que entrou no lugar. */
function focarDepois(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
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

  // A prévia que falhou fica na tela enquanto a nova tentativa lê (carregamento v2): o aviso e o foco não somem.
  const chaveDaPrevia = ["mover-caixa", cliente, caixa] as const;
  const previa = useLeituraComFalha(
    useQuery({
      queryKey: chaveDaPrevia,
      enabled: Boolean(cliente && caixa && operador),
      queryFn: () => previaDoMover({ customer_code: cliente!, box_code: caixa! }),
      staleTime: 0,
    }),
  );
  // A nova tentativa que a pessoa pede relê do zero (a leitura presa recomeça), e nunca sem o cliente, a caixa e o papel.
  const lerDeNovo = () => (cliente && caixa && operador ? relerDoZero(queryClient, [chaveDaPrevia]) : undefined);
  // As caixas movidas ainda com a etiqueta antiga: a leitura do Mapa, com a mesma chave.
  const caixas = useQuery({
    queryKey: ["warehouse-boxes", "all", "all-pages"],
    staleTime: 10_000,
    queryFn: async () => (await fetchWarehouseRows<AnyRecord>("/api/warehouse/boxes?limit=5000")).map(warehouseBoxFromRecord),
  });
  const etiquetas = cliente ? caixasMovidasSemEtiqueta(caixas.data ?? [], cliente) : [];

  const dados = previa.data ?? null;
  const [sugestao, ...outras] = dados?.prateleiras ?? [];
  // A escolhida que saiu da lista na releitura (não cabe mais, ganhou reserva) deixa de valer: volta a sugestão.
  const escolhidaValida = escolhida && dados?.prateleiras.some((prateleira) => prateleira.code === escolhida) ? escolhida : null;
  const alvo = modo === "escolha" ? (escolhidaValida ?? sugestao?.code ?? null) : (sugestao?.code ?? null);
  const pedidoDe = (destino: string) => (dados ? { cliente, caixa: dados.box.code, de: dados.box.location_id, para: destino } : null);

  const mover = useMutation({
    mutationFn: (destino: string) => {
      if (!dados || !cliente) return Promise.reject(new Error(CAIXA_INVALIDA));
      // O encaixe que a tela mostrou para o destino: o servidor confere este, sem trocar a orientação nem o apoio.
      // Sem ele (a prateleira fora da lista), nada vai: o motor nunca escolhe um encaixe que a pessoa não viu.
      const encaixe = dados.prateleiras.find((prateleira) => prateleira.code === destino)?.placement;
      if (!encaixe) return Promise.reject(Object.assign(new Error(FORA_DA_LISTA), { code: "failed-precondition" }));
      const corpo = {
        customer_code: cliente,
        box_code: dados.box.code,
        from_location_id: dados.box.location_id,
        to_location_id: destino,
        ...(sugestao ? { suggestion: { position: sugestao.code, alternatives: outras.slice(0, 2).map((outra) => outra.code) } } : {}),
        // O null no apoio vai de propósito: é "no piso, sem empilhar".
        ...(encaixe.orientation ? { orientation: encaixe.orientation } : {}),
        support_box_code: encaixe.support_box_code ?? null,
      };
      return tentativa.enviar(pedidoDe(destino), () => corpo, (comChave) => moverCaixa(comChave));
    },
    onMutate: () => setRecusa(null),
    onSuccess: (movida) => {
      setResultado(movida);
      // O resultado sai pelo toast (carregamento v2), e o foco vai ao próximo passo: a etiqueta nova.
      toast({ title: `${movida.box_code} em ${movida.to_location_id}`, description: textoDaMovida(movida) });
      focarDepois(ID_DA_ETIQUETA);
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
    if (codigo === caixa) void lerDeNovo();
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
    focarDepois(ID_DO_CAMPO);
  };

  // A caixa que o servidor recusou ao ler (a que não existe, a de outro cliente) diz o motivo sob o campo.
  const recusadaAoLer = previa.isError && !dados && desfechoDoErro(previa.error) === "recusado" ? (previa.error as Error).message : null;
  const estado: EstadoDoMover =
    !caixa || recusadaAoLer || !operador
      ? { fase: "vazia" }
      : // O resultado vale só para a caixa dele: o da caixa que movia enquanto outra se abriu fica no toast.
        resultado && dados && resultado.box_code === dados.box.code
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
        // A pessoa escolhe de novo: a recusa da tentativa anterior sai.
        setRecusa(null);
        setModo(proximo);
        if (proximo === "escolha" && !escolhidaValida && sugestao) setEscolhida(sugestao.code);
      }}
      escolhida={escolhidaValida}
      onEscolher={(codigo) => {
        setRecusa(null);
        setEscolhida(codigo);
      }}
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
      onTentar={lerDeNovo}
      clienteFalhou={clienteFalhou}
    />
  );
}
