import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, doc, query, where } from "firebase/firestore";
import { useSearch } from "wouter";

import type { CaixaDaLinha } from "@workspace/dominio";

import { ConcluirSeparacaoDialog } from "@/features/warehouse-ops/concluir-separacao";
import { DividirEmVolumesDialog } from "@/features/warehouse-ops/dividir-em-volumes";
import { OutraCaixaDialog, type OutraCaixaDaLinha } from "@/features/warehouse-ops/outra-caixa";
import { SepararMenosDialog, type DiferencaDaLinha } from "@/features/warehouse-ops/separar-menos";
import { useToast } from "@/hooks/use-toast";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { useAppUser } from "@/lib/auth";
import type { EstadoDaAcao } from "@/components/ui/botao-de-acao";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { prazoEsgotado } from "@/lib/conexao";
import { useDocumento, useLeitura } from "@/lib/operacao/leitura";
import { textoDoParaQuando } from "@/lib/order-queue";
import { canDecideRequests, canOperateWarehouse } from "@/lib/permissions";
import { useItemPhotos } from "@/lib/use-item-photos";
import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import { labelsUrl } from "@/lib/warehouse-labels";
import {
  caixasComOItem,
  caixasDoPedido,
  caixasGravadas,
  caixasParaEnviar,
  caixasVaziasDoPedido,
  entradaDasCaixas,
  etiquetasParaTrocar,
  linhaDeEntrada,
  sugestaoDaLinha,
  type CaixaDaPrateleira,
} from "@/lib/warehouse-ops/caixas-da-separacao";
import {
  divisaoDaLinha,
  pedidoDaDivisao,
  separadasParaDividir,
  textoDosVolumesFechados,
  type DivisaoEmVolumes,
  type ModoDaDivisao,
  type ParteDaDivisao,
} from "@/lib/warehouse-ops/divisao-em-volumes";
import { hrefDaListaDeSeparacao, pedidoDaBusca, resumoDoGrupo, type LinhaDaLista } from "@/lib/warehouse-ops/lista-de-separacao";
import { fetchJson, type WarehouseOpsResponse, type WarehouseTaskItem } from "@/lib/warehouse-ops/model";
import { groupWarehouseOrders } from "@/lib/warehouse-ops/orders";
import { hrefDoRomaneio } from "@/lib/warehouse-ops/romaneio";
import { estadoDaLinha, idDaTarefaDeSeparacao, itemDaLinhaDeSeparacao, progressoDoPedido, separacaoComecou } from "@/lib/warehouse-ops/separacao";
import { comTamanhoDoCatalogo } from "@/lib/warehouse-ops/tamanho-do-catalogo";
import { useLeituraDaLista } from "@/lib/warehouse-ops/use-lista-de-separacao";
import { useTamanhosDoCatalogo } from "@/lib/warehouse-ops/use-tamanhos-do-catalogo";
import { useVolumesDoPedido } from "@/lib/warehouse-ops/use-volumes-do-pedido";
import {
  avisoDosVolumes,
  nomeDoVolume,
  textoDeVolumes,
  volumesAoConcluir,
  volumesDaSeparacao,
  volumesDaTarefa,
  type VolumeDoPedido,
} from "@/lib/warehouse-ops/volumes-do-pedido";
import { concluirSeparacao, desfazerLinha, dividirLinha, fecharVolume, separarLinha, separarMenos } from "@/lib/wms/separacao";

import { PedidoSeparadoView } from "./pedido-separado-view";
import { PedidosSepararView, type EstadoDaBancada } from "./pedidos-separar-view";

const SEM_ITENS: WarehouseTaskItem[] = [];

type Acao =
  | { tipo: "separar" | "desfazer"; linha: LinhaDaLista }
  | { tipo: "menos"; linha: LinhaDaLista; diferenca: DiferencaDaLinha }
  | { tipo: "outra" | "levar"; linha: LinhaDaLista; caixas: Array<{ box_code: string; qty: number }> }
  | { tipo: "dividir"; linha: LinhaDaLista; divisao: DivisaoEmVolumes };

/** O diálogo de "Dividir em volumes" guarda só as linhas dele; o resto vem ao vivo (parte 7b). */
type DivisaoAberta = { id: string; modo: ModoDaDivisao; partes: ParteDaDivisao[] };

/**
 * Pedidos › Separar (separação com caixas, partes 2, 3b e 5): a bancada do
 * pedido da URL (?pedido=). As linhas vêm ao vivo do servidor: o que outra
 * pessoa separa aparece sem recarregar, e quem volta no dia seguinte continua
 * de onde parou. Cada "Separar", "Desfazer" e "Separar menos" grava na hora
 * pela callable; "Concluir separação" fecha a separação e a embalagem, com o
 * lacre, numa chamada.
 *
 * As caixas (parte 3b) também vêm ao vivo: a linha por separar mostra de qual
 * caixa o sistema vai tirar, e a separada, de onde saiu. "Separar" deixa o
 * servidor baixar a caixa mais antiga; "Outra caixa" manda as que a pessoa
 * informou.
 *
 * Os volumes (parte 4) moram na tarefa, ao vivo: a linha separada entra no
 * volume aberto, "Fechar volume" fecha com o peso, e "Levar a caixa" manda
 * as caixas que a bancada mostrou, para a que sai inteira virar o volume.
 *
 * O pedido já separado (parte 4d) abre aqui com os volumes, as etiquetas com
 * o total e o romaneio: é onde "Confirmar separação" deixa a pessoa, e para
 * onde "Ver volumes" de Para entregar leva.
 *
 * "Dividir em volumes" (parte 7b) parte dos volumes da tarefa lida ao vivo,
 * com as unidades gravadas. O diálogo guarda só as linhas dele: o volume
 * aberto, o que as outras linhas têm nele e os números são refeitos a cada
 * leitura, e depois de "Os volumes mudaram" ele mostra o novo estado com as
 * mesmas quantidades.
 */
export default function PaginaPedidosSeparar() {
  const chave = pedidoDaBusca(useSearch());
  const { user } = useAppUser();
  const papel = user?.publicMetadata.role;
  const operador = canOperateWarehouse(papel);
  const coordenacao = canDecideRequests(papel);
  const { options: clientes } = useActiveCustomer();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fotoDoItem = useItemPhotos();

  // A mesma chave da fila de Pedidos: quem veio dela já tem o pedido lido.
  const ops = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"),
    refetchOnWindowFocus: false,
  });
  const pedido = useMemo(() => (chave ? groupWarehouseOrders(ops.data).find((order) => order.key === chave) : undefined), [chave, ops.data]);
  const tarefa = pedido?.pick;
  const pickTaskId = idDaTarefaDeSeparacao(tarefa);
  const codigoDoCliente = tarefa?.customer_code ?? null;

  // As linhas e a tarefa ao vivo; enquanto não chegam, vale o que a fila leu.
  const linhasAoVivo = useLeitura(
    pickTaskId ? `pick_lines:${pickTaskId}` : null,
    (db) => query(collection(db, "pick_lines"), where("pick_task_id", "==", pickTaskId)),
    itemDaLinhaDeSeparacao,
  );
  const tarefaAoVivo = useDocumento(
    pickTaskId ? `pick_tasks/${pickTaskId}` : null,
    (db) => doc(db, "pick_tasks", pickTaskId ?? "-"),
    (_id, data) => ({
      status: String(data.status ?? ""),
      separation_started_at: data.separation_started_at ? String(data.separation_started_at) : null,
      volumes: volumesDaTarefa(data.volumes),
    }),
  );
  const linhasDaTarefa = linhasAoVivo.itens ?? tarefa?.items ?? SEM_ITENS;
  // O tamanho que mora só no campo Tamanho do SKU ("475ML", a capacidade do copo): a linha não o grava, e o
  // cadastro é o mesmo que as fotos dos itens já leram. A linha e o volume saem com ele.
  const tamanhos = useTamanhosDoCatalogo(Boolean(pickTaskId));
  const itens = useMemo(() => comTamanhoDoCatalogo(linhasDaTarefa, tamanhos), [linhasDaTarefa, tamanhos]);
  const situacao = tarefaAoVivo.item ?? (tarefa ? { status: String(tarefa.status ?? ""), separation_started_at: tarefa.separation_started_at ?? null } : undefined);
  const lista = useLeituraDaLista(itens, codigoDoCliente);
  const progresso = useMemo(() => progressoDoPedido(itens), [itens]);
  // Os volumes só com a tarefa lida ao vivo: é nela que eles moram.
  const volumesDaTarefaAoVivo = tarefaAoVivo.item?.volumes;
  const volumes = useMemo(() => (volumesDaTarefaAoVivo ? volumesDaSeparacao(volumesDaTarefaAoVivo, itens) : undefined), [volumesDaTarefaAoVivo, itens]);

  // As caixas guardadas do cliente e o conteúdo de entrada das da abertura, ao vivo.
  const caixasAoVivo = useLeitura(
    codigoDoCliente ? `warehouse_boxes:${codigoDoCliente}:guardadas` : null,
    (db) => query(collection(db, "warehouse_boxes"), where("customer_code", "==", codigoDoCliente), where("status", "==", "stored")),
    (id, data) => warehouseBoxFromRecord({ id, ...data }),
  );
  const entradaAoVivo = useLeitura(
    codigoDoCliente ? `opening_inventory_lines:${codigoDoCliente}` : null,
    (db) => query(collection(db, "opening_inventory_lines"), where("customer_code", "==", codigoDoCliente)),
    linhaDeEntrada,
  );
  // De qual caixa cada linha sai: a sugestão, na linha por separar; o gravado, na separada.
  const { caixasDaLinha, candidatasDaLinha } = useMemo(() => {
    const daLinha = new Map<string, CaixaDaLinha[]>();
    const candidatas = new Map<string, CaixaDaPrateleira[]>();
    const guardadas = caixasAoVivo.itens;
    const entrada = guardadas && entradaAoVivo.itens ? entradaDasCaixas(guardadas, entradaAoVivo.itens) : null;
    for (const linha of lista.grupos.flatMap((grupo) => grupo.linhas)) {
      if (estadoDaLinha(linha.item) !== "pendente") {
        daLinha.set(linha.id, caixasGravadas(linha.item));
      } else if (guardadas && entrada) {
        const daPrateleira = caixasComOItem(linha.item, guardadas, entrada, codigoDoCliente);
        candidatas.set(linha.id, daPrateleira);
        daLinha.set(linha.id, sugestaoDaLinha(linha.item, daPrateleira).caixas);
      }
    }
    return { caixasDaLinha: daLinha, candidatasDaLinha: candidatas };
  }, [lista.grupos, caixasAoVivo.itens, entradaAoVivo.itens, codigoDoCliente]);
  // As caixas que o pedido abriu e que estão com a etiqueta velha, e as caixas do pedido para o diálogo de concluir.
  const etiquetas = useMemo(() => (caixasAoVivo.itens ? etiquetasParaTrocar(itens, caixasAoVivo.itens) : []), [itens, caixasAoVivo.itens]);
  const caixasDoDialogo = useMemo(() => (caixasAoVivo.itens ? caixasDoPedido(itens, caixasAoVivo.itens) : null), [itens, caixasAoVivo.itens]);
  // "Levar a caixa" só na linha por separar de que alguma caixa sai inteira.
  const caixasInteiras = useMemo(() => {
    const inteiras = new Map<string, number>();
    for (const id of candidatasDaLinha.keys()) {
      const quantas = (caixasDaLinha.get(id) ?? []).filter((caixa) => caixa.inteira).length;
      if (quantas) inteiras.set(id, quantas);
    }
    return inteiras;
  }, [caixasDaLinha, candidatasDaLinha]);
  // "Outra caixa" só faz sentido com mais de uma caixa na prateleira para escolher.
  const comOutraCaixa = useMemo(
    () => new Set([...candidatasDaLinha].filter(([, daPrateleira]) => daPrateleira.length > 1).map(([id]) => id)),
    [candidatasDaLinha],
  );

  const solicitacaoId = pedido?.requestId ?? null;
  const solicitacao = useDocumento(
    solicitacaoId ? `customer_requests/${solicitacaoId}:bancada` : null,
    (db) => doc(db, "customer_requests", solicitacaoId ?? "-"),
    (_id, data) => ({ paraQuando: data.due_at as unknown }),
  );
  const paraQuando = solicitacao.item ? textoDoParaQuando(solicitacao.item.paraQuando) : "";
  const resumo = [
    clientes.find((cliente) => cliente.code === codigoDoCliente)?.name || codigoDoCliente,
    resumoDoGrupo({ itens: progresso.itens, unidades: progresso.unidades }),
    paraQuando ? `Para quando ${paraQuando}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const [ocupadas, setOcupadas] = useState<ReadonlySet<string>>(new Set());
  const [diferenca, setDiferenca] = useState<DiferencaDaLinha | null>(null);
  const [outraCaixa, setOutraCaixa] = useState<OutraCaixaDaLinha | null>(null);
  const [divisao, setDivisao] = useState<DivisaoAberta | null>(null);
  const [lacre, setLacre] = useState<string | null>(null);
  // A chave da conclusão vale enquanto o diálogo está aberto: repetir continua de onde parou.
  const chaveDaConclusao = useRef<string | null>(null);
  // Concluído agora: a tela do pedido separado entra sem esperar a fila ler de novo.
  const [concluiuAgora, setConcluiuAgora] = useState(false);
  // O fim da conclusão no botão do diálogo: o erro por 2 s, ou o "Conferir" do prazo sem resposta.
  const [fimDaConclusao, setFimDaConclusao] = useState<"erro" | "sem-resposta" | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const separado = Boolean(pedido && pickTaskId && (pedido.stage !== "separar" || concluiuAgora));
  const pedidoId = pedido?.orderId ?? pedido?.key ?? null;
  const doPedidoSeparado = useVolumesDoPedido(separado ? pedidoId : null);
  const caixasVazias = useMemo(() => (separado && caixasAoVivo.itens ? caixasVaziasDoPedido(itens, caixasAoVivo.itens) : []), [separado, itens, caixasAoVivo.itens]);

  // "Dividir em volumes" (parte 7b): a linha separada ganha o botão enquanto tem 2 un. ou mais no volume aberto.
  const linhasDaLista = useMemo(() => lista.grupos.flatMap((grupo) => grupo.linhas), [lista.grupos]);
  const paraDividir = useMemo(
    () => (volumesDaTarefaAoVivo ? separadasParaDividir(linhasDaLista, volumesDaTarefaAoVivo) : undefined),
    [linhasDaLista, volumesDaTarefaAoVivo],
  );
  // O diálogo com a linha, o volume aberto, o que as outras linhas têm nele e os números de agora; as linhas, as dele.
  const divisaoNaTela = useMemo(() => {
    if (!divisao || !volumesDaTarefaAoVivo) return null;
    const linha = linhasDaLista.find((candidata) => candidata.id === divisao.id);
    return linha ? divisaoDaLinha({ linha, modo: divisao.modo, volumes: volumesDaTarefaAoVivo, caixas: caixasDaLinha.get(linha.id), partes: divisao.partes }) : null;
  }, [divisao, volumesDaTarefaAoVivo, linhasDaLista, caixasDaLinha]);
  // A linha que outra pessoa separou, desfez ou dividiu enquanto o diálogo estava aberto: ele fecha, e não volta sozinho.
  useEffect(() => {
    if (divisao && !divisaoNaTela) setDivisao(null);
  }, [divisao, divisaoNaTela]);
  const abrirDivisao = (linha: LinhaDaLista) => {
    if (!volumesDaTarefaAoVivo) return;
    const modo: ModoDaDivisao = estadoDaLinha(linha.item) === "pendente" ? "separar" : "dividir";
    // Começa com um volume por caixa de onde a linha sai (decisão 27).
    const inicial = divisaoDaLinha({ linha, modo, volumes: volumesDaTarefaAoVivo, caixas: caixasDaLinha.get(linha.id) });
    if (inicial) setDivisao({ id: linha.id, modo, partes: inicial.partes });
  };

  const erro = (titulo: string) => (falha: Error) => toast({ title: titulo, description: falha.message, variant: "destructive" });

  const gravar = useMutation({
    mutationFn: async (acao: Acao) => {
      if (!pickTaskId) throw new Error("Pedido sem separação criada.");
      const entrada = { pick_task_id: pickTaskId, pick_line_id: acao.linha.id, idempotency_key: crypto.randomUUID() };
      if (acao.tipo === "desfazer") return desfazerLinha(entrada);
      if (acao.tipo === "menos") {
        return separarMenos({ ...entrada, separated_qty: acao.diferenca.separado, shortage_reason: acao.diferenca.motivo, shortage_detail: acao.diferenca.detalhe });
      }
      // "Outra caixa" manda as caixas informadas; "Separar" deixa o servidor baixar a mais antiga.
      if (acao.tipo === "outra") return separarLinha({ ...entrada, boxes: acao.caixas });
      // "Levar a caixa" manda as caixas que a bancada mostrou: a que sai inteira vira o volume.
      if (acao.tipo === "levar") return separarLinha({ ...entrada, boxes: acao.caixas, take_boxes: true });
      // "Dividir em volumes" manda as linhas do diálogo, o volume aberto e a linha como a tela os mostrou.
      if (acao.tipo === "dividir") return dividirLinha({ ...entrada, ...pedidoDaDivisao(acao.divisao) });
      return separarLinha(entrada);
    },
    onMutate: (acao) => setOcupadas((atuais) => new Set(atuais).add(acao.linha.id)),
    onSettled: (_resultado, _falha, acao) =>
      setOcupadas((atuais) => {
        const proximas = new Set(atuais);
        proximas.delete(acao.linha.id);
        return proximas;
      }),
    onSuccess: (resultado, acao) => {
      if (acao.tipo === "menos") setDiferenca(null);
      if (acao.tipo === "outra") setOutraCaixa(null);
      // O volume fechado que saiu, mudou de número ou de conteúdo: a etiqueta dele precisa sair de novo.
      const aviso = avisoDosVolumes(resultado);
      if (acao.tipo === "dividir") {
        // Fecha o diálogo desta linha; o de outra, aberto enquanto esta ia ao servidor, fica.
        setDivisao((atual) => (atual?.id === acao.linha.id ? null : atual));
        // "Volume 16 fechado": a etiqueta dele fica no botão do volume fechado (decisão 23).
        const fechados = textoDosVolumesFechados(resultado.closed_volumes ?? []);
        if (fechados) {
          toast({ title: fechados, description: aviso ?? undefined });
          return;
        }
      }
      if (aviso) toast({ title: aviso });
    },
    // A recusa ("Os volumes mudaram...") deixa o diálogo aberto: a leitura ao vivo mostra o novo estado.
    onError: (falha, acao) => erro(acao.tipo === "dividir" ? "Não foi possível dividir a linha" : "Não foi possível gravar a linha")(falha),
  });

  const fechar = useMutation({
    mutationFn: async ({ volume, pesoKg }: { volume: VolumeDoPedido; pesoKg?: number }) => {
      if (!pickTaskId) throw new Error("Pedido sem separação criada.");
      return fecharVolume({ pick_task_id: pickTaskId, volume_id: volume.id, weight_kg: pesoKg, idempotency_key: crypto.randomUUID() });
    },
    onSuccess: (resultado) => toast({ title: `${nomeDoVolume(resultado.volume_number)} fechado` }),
    onError: erro("Não foi possível fechar o volume"),
  });

  const concluido = async () => {
    toast({ title: "Separado. O pedido está pronto para entrega." });
    setLacre(null);
    setFimDaConclusao(null);
    chaveDaConclusao.current = null;
    // A pessoa fica no pedido separado: é dali que saem as etiquetas com o total e o romaneio.
    setConcluiuAgora(true);
    await queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
  };

  const concluir = useMutation({
    mutationFn: async () => {
      if (!pickTaskId) throw new Error("Pedido sem separação criada.");
      chaveDaConclusao.current ??= crypto.randomUUID();
      setFimDaConclusao(null);
      return concluirSeparacao({ pick_task_id: pickTaskId, seal_code: (lacre ?? "").trim(), idempotency_key: chaveDaConclusao.current });
    },
    onSuccess: concluido,
    onError: (falha: Error) => {
      // Sem resposta no prazo, a conclusão pode ter valido: "Conferir" relê, e a chave fica a mesma.
      if (prazoEsgotado(falha)) {
        setFimDaConclusao("sem-resposta");
        return;
      }
      setFimDaConclusao("erro");
      erro("Não foi possível concluir a separação")(falha);
      // Outra pessoa pode ter concluído por baixo: a fila lê de novo e a bancada mostra onde o pedido está.
      void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
    },
  });
  // "Não concluído" fica 2 s no botão e volta a "Confirmar separação"; o motivo fica no toast.
  useEffect(() => {
    if (fimDaConclusao !== "erro") return undefined;
    const volta = setTimeout(() => setFimDaConclusao((atual) => (atual === "erro" ? null : atual)), CARREGANDO.erroVisivelMs);
    return () => clearTimeout(volta);
  }, [fimDaConclusao]);
  // Conferindo, o estado continua sem resposta: o diálogo mostra "Conferindo…", não a conclusão de novo.
  const estadoDaConclusao: EstadoDaAcao = concluir.isPending ? "andamento" : (fimDaConclusao ?? "repouso");
  /** O "Conferir" do prazo sem resposta: relê a fila e nunca reenvia. Concluído por lá, segue o sucesso. */
  const conferirConclusao = async () => {
    if (conferindo) return;
    setConferindo(true);
    try {
      const lida = await queryClient.fetchQuery({ queryKey: ["warehouse-ops"], queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"), staleTime: 0 });
      const agora = chave ? groupWarehouseOrders(lida).find((order) => order.key === chave) : undefined;
      if (agora && agora.stage !== "separar") await concluido();
      else setFimDaConclusao(null);
    } catch (falha) {
      erro("Não foi possível conferir a separação")(falha as Error);
    } finally {
      setConferindo(false);
    }
  };

  const estado: EstadoDaBancada = !chave
    ? "nao_encontrado"
    : ops.isLoading
      ? "carregando"
      : ops.isError && !ops.data
        ? "erro"
        : !pedido || !pickTaskId
          ? "nao_encontrado"
          : separado
            ? "concluida"
            : "pronto";

  if (estado === "concluida" && pedido && pedidoId) {
    const volumesDoPedido = doPedidoSeparado.volumes;
    const lidos = doPedidoSeparado.estado === "pronto";
    const unidades = lidos ? volumesDoPedido.reduce((soma, volume) => soma + volume.unidades, 0) : progresso.unidadesSeparadas;
    return (
      <PedidoSeparadoView
        numero={pedido.orderNumber}
        selo={pedido.stage === "entregue" ? "entregue" : "separado"}
        resumo={[
          clientes.find((cliente) => cliente.code === codigoDoCliente)?.name || codigoDoCliente,
          resumoDoGrupo({ itens: progresso.itens, unidades }),
          lidos && volumesDoPedido.length ? textoDeVolumes(volumesDoPedido.length) : null,
          doPedidoSeparado.pedido?.lacre ? `lacre ${doPedidoSeparado.pedido.lacre}` : null,
          paraQuando ? `Para quando ${paraQuando}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        // O pedido que a fila ainda não leu como separado: a remessa chega em seguida.
        estado={
          doPedidoSeparado.estado === "erro" || doPedidoSeparado.estado === "nao_encontrado" ? "erro" : lidos && doPedidoSeparado.pedido?.concluido ? "pronto" : "carregando"
        }
        volumes={volumesDoPedido}
        etiquetasDosVolumesHref={labelsUrl({ order: pedidoId, volumes: "all" })}
        romaneioHref={hrefDoRomaneio(pedidoId)}
        etiquetaDoVolumeHref={(volume) => labelsUrl({ order: pedidoId, volumes: [volume.numero] })}
        etiquetas={etiquetas}
        etiquetasHref={etiquetas.length ? labelsUrl({ boxes: etiquetas.map((etiqueta) => etiqueta.code), order: pedidoId }) : null}
        vazias={caixasVazias}
      />
    );
  }

  // Enquanto a divisão da linha do diálogo vai ao servidor, ele mostra o que foi mandado: a leitura ao vivo pode chegar antes da resposta.
  // O que outra linha grava (o diálogo dela fechado no meio, "Separar" em outra) não entra neste.
  const pendente = gravar.isPending ? gravar.variables : undefined;
  const divisaoEnviada = pendente?.tipo === "dividir" && pendente.linha.id === divisao?.id ? pendente.divisao : null;

  return (
    <>
      <PedidosSepararView
        estado={estado}
        numero={pedido?.orderNumber ?? ""}
        resumo={resumo}
        comecouEm={situacao?.separation_started_at}
        comecou={separacaoComecou(situacao, itens)}
        progresso={progresso}
        grupos={lista.grupos}
        listaHref={pedido ? hrefDaListaDeSeparacao(pedido.key) : null}
        operador={operador}
        coordenacao={coordenacao}
        fechada={situacao?.status === "completed"}
        ocupadas={ocupadas}
        caixasDaLinha={caixasDaLinha}
        comOutraCaixa={comOutraCaixa}
        etiquetas={etiquetas}
        // Com o pedido junto, a volta das etiquetas é à bancada.
        etiquetasHref={etiquetas.length ? labelsUrl({ boxes: etiquetas.map((etiqueta) => etiqueta.code), order: pedidoId }) : null}
        volumes={volumes}
        caixasInteiras={caixasInteiras}
        fechandoVolume={fechar.isPending}
        // A etiqueta sai ao fechar o volume, sem o total (decisão 12).
        etiquetaDoVolumeHref={(volume) => (pedido ? labelsUrl({ order: pedido.orderId ?? pedido.key, volumes: [volume.numero] }) : null)}
        fotoDe={(item) => fotoDoItem(item.sku_code, item.sku, item.client_item_code)}
        onSeparar={(linha) => gravar.mutate({ tipo: "separar", linha })}
        onDesfazer={(linha) => gravar.mutate({ tipo: "desfazer", linha })}
        onLevarACaixa={(linha) =>
          gravar.mutate({ tipo: "levar", linha, caixas: (caixasDaLinha.get(linha.id) ?? []).map((caixa) => ({ box_code: caixa.box_code, qty: caixa.qty })) })
        }
        // Sem os volumes lidos ao vivo, a bancada não sabe os números: a divisão espera por eles.
        paraDividir={paraDividir}
        onDividir={volumesDaTarefaAoVivo ? abrirDivisao : undefined}
        onFecharVolume={(volume, pesoKg) => fechar.mutate({ volume, pesoKg })}
        onOutraCaixa={(linha) =>
          setOutraCaixa({
            id: linha.id,
            nome: linha.nome || linha.codigos,
            posicao: String(linha.item.location ?? ""),
            quantidade: linha.quantidade,
            caixas: candidatasDaLinha.get(linha.id) ?? [],
            // Começa na sugestão do sistema: a pessoa só corrige.
            informadas: Object.fromEntries((caixasDaLinha.get(linha.id) ?? []).map((caixa) => [caixa.box_code, caixa.qty])),
          })
        }
        onSepararMenos={(linha) =>
          setDiferenca({ id: linha.id, nome: linha.nome || linha.codigos, posicao: String(linha.item.location ?? ""), pedido: linha.quantidade, separado: Math.max(0, linha.quantidade - 1), motivo: "", detalhe: "" })
        }
        onConcluir={() => {
          chaveDaConclusao.current = null;
          setLacre("");
        }}
      />
      <SepararMenosDialog
        diferenca={diferenca}
        registrando={gravar.isPending}
        onMudar={setDiferenca}
        onFechar={() => setDiferenca(null)}
        onRegistrar={() => {
          const linha = diferenca ? lista.grupos.flatMap((grupo) => grupo.linhas).find((candidata) => candidata.id === diferenca.id) : undefined;
          if (linha && diferenca) gravar.mutate({ tipo: "menos", linha, diferenca });
        }}
      />
      <OutraCaixaDialog
        linha={outraCaixa}
        confirmando={gravar.isPending}
        onMudar={setOutraCaixa}
        onFechar={() => setOutraCaixa(null)}
        onConfirmar={() => {
          const linha = outraCaixa ? lista.grupos.flatMap((grupo) => grupo.linhas).find((candidata) => candidata.id === outraCaixa.id) : undefined;
          if (linha && outraCaixa) gravar.mutate({ tipo: "outra", linha, caixas: caixasParaEnviar(outraCaixa.informadas) });
        }}
      />
      <DividirEmVolumesDialog
        divisao={divisao ? (divisaoEnviada ?? divisaoNaTela) : null}
        confirmando={Boolean(divisaoEnviada)}
        onMudar={(nova) => setDivisao({ id: nova.id, modo: nova.modo, partes: nova.partes })}
        onFechar={() => setDivisao(null)}
        onConfirmar={() => {
          const linha = divisaoNaTela ? linhasDaLista.find((candidata) => candidata.id === divisaoNaTela.id) : undefined;
          if (linha && divisaoNaTela) gravar.mutate({ tipo: "dividir", linha, divisao: divisaoNaTela });
        }}
      />
      <ConcluirSeparacaoDialog
        aberto={lacre !== null}
        numero={pedido?.orderNumber ?? ""}
        resumo={resumo}
        volumes={volumes ? volumesAoConcluir(volumes) : null}
        caixas={caixasDoDialogo}
        lacre={lacre ?? ""}
        estado={estadoDaConclusao}
        conferindo={conferindo}
        onLacre={setLacre}
        onFechar={() => {
          setLacre(null);
          setFimDaConclusao(null);
        }}
        onConfirmar={() => concluir.mutate()}
        onConferir={() => void conferirConclusao()}
      />
    </>
  );
}
