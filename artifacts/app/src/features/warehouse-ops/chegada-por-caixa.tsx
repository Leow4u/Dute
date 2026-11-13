import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAnuncio } from "@/lib/carregando/anunciador";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { boxDraftToPayload } from "@/lib/warehouse-boxes";
import { labelsUrl } from "@/lib/warehouse-labels";
import type {
  TaskQueueEntry,
  WarehouseTask,
  WarehouseTaskItem,
} from "@/lib/warehouse-ops/model";
import {
  bloqueiosDaTela,
  concluirEntradaPorCaixa,
  desmarcarFalta,
  emTresCasas,
  fecharCaixa,
  iniciarCaixa,
  lancarNaCaixa,
  marcarFalta,
  pedidoFoiRejeitado,
  reabrirCaixa,
  removerCaixa,
  type CaixaDaChegada,
  type FaltaMarcada,
  type LinhaDaCaixa,
  type Resultado,
} from "@/lib/wms/caixas-do-recebimento";
import { useDestinoDaCaixa } from "./destino-da-caixa";
import {
  FichaDaChegadaPorCaixaConteudo,
  quantidadeManual,
  rascunhoDaCaixa,
  rascunhoVazio,
  type EtapaDaConferencia,
  type RascunhoDoFechamento,
} from "./chegada-por-caixa-conteudo";

export {
  conteudoDaCaixa,
  FichaDaChegadaPorCaixaConteudo,
  rascunhoDaCaixa,
  rascunhoVazio,
} from "./chegada-por-caixa-conteudo";
export type {
  FichaDaChegadaPorCaixaProps,
  RascunhoDoFechamento,
} from "./chegada-por-caixa-conteudo";

type FichaProps = {
  entry: TaskQueueEntry;
  registeringExceptionId?: string;
  onOpenException: (task: WarehouseTask, suggestedNote?: string) => void;
  onBack?: () => void;
};

/** A chegada e o cliente delimitam também os rascunhos e as tentativas pendentes. */
export function FichaDaChegadaPorCaixa(props: FichaProps) {
  const { code: clienteAtivo } = useActiveCustomer();
  // A fila reúne clientes: a escrita e as prateleiras pertencem à chegada aberta.
  const customerCode =
    props.entry.task.customer_code || props.entry.task.customer || clienteAtivo;
  return (
    <FichaDaChegadaEstado
      key={`${props.entry.task.id}:${clienteAtivo}:${customerCode}`}
      {...props}
      customerCode={customerCode}
    />
  );
}

function FichaDaChegadaEstado({
  entry,
  registeringExceptionId,
  onOpenException,
  onBack,
  customerCode,
}: FichaProps & { customerCode: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const original = entry.task;
  const receiptId =
    original.reference || original.id.replace(/^receiving:/, "");
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [etapa, setEtapa] = useState<EtapaDaConferencia>(() =>
    original.boxes?.some((caixa) => caixa.status === "counting") ||
    !original.boxes?.length
      ? 1
      : 4,
  );
  const [produto, setProduto] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [rascunhos, setRascunhos] = useState<
    Record<string, Record<string, string>>
  >({});
  const [rascunho, setRascunho] = useState<RascunhoDoFechamento>(rascunhoVazio);
  const [atualizacoes, setAtualizacoes] = useState<
    Record<string, CaixaDaChegada | null>
  >({});
  const [faltas, setFaltas] = useState<Record<string, FaltaMarcada | null>>({});
  const [marcando, setMarcando] = useState<string | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [recebida, setRecebida] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [feedback, setFeedback] = useState("");
  // A ação em curso, para o botão tocado mostrar a espera dele (carregamento v2, parte 13c); o retorno ("Quantidade
  // salva nesta caixa") o Anunciador diz, no lugar da região viva solta que a ficha tinha.
  const [acao, setAcao] = useState<string | null>(null);
  const anunciar = useAnuncio();
  const [erro, setErro] = useState("");
  const trava = useRef(false);
  const tentativas = useRef(new Map<string, Record<string, unknown>>());
  const caixasObservadas = useRef(
    new Set((original.boxes ?? []).map((caixa) => caixa.code)),
  );
  const montada = useRef(true);
  useEffect(() => {
    montada.current = true;
    return () => {
      montada.current = false;
    };
  }, []);

  // A confirmação local cobre a janela da releitura, não substitui a fila para
  // sempre. Uma caixa já vista que desapareceu foi removida; uma recém-criada
  // ainda não vista precisa continuar até a primeira leitura que a contenha.
  useEffect(() => {
    const lidas = new Map(
      (original.boxes ?? []).map((caixa) => [caixa.code, caixa]),
    );
    setAtualizacoes((atuais) => {
      let proximas = atuais;
      for (const [code, confirmada] of Object.entries(atuais)) {
        const lida = lidas.get(code);
        const reconciliada =
          confirmada === null
            ? !lida
            : lida
              ? lida.conference_revision >= confirmada.conference_revision
              : caixasObservadas.current.has(code);
        if (reconciliada) {
          if (proximas === atuais) proximas = { ...atuais };
          delete proximas[code];
        }
      }
      return proximas;
    });
    for (const code of lidas.keys()) caixasObservadas.current.add(code);
  }, [original.boxes]);

  // Só aplica escritas já confirmadas. Conteúdo e revisão avançam juntos;
  // uma releitura antiga nunca restaura a quantidade anterior.
  const caixas = useMemo(() => {
    const lidas = original.boxes ?? [];
    const codes = new Set([
      ...lidas.map((caixa) => caixa.code),
      ...Object.keys(atualizacoes),
    ]);
    return [...codes].flatMap((code) => {
      const lida = lidas.find((caixa) => caixa.code === code);
      const confirmada = atualizacoes[code];
      if (confirmada === null) return [];
      const atual =
        confirmada &&
        (!lida || confirmada.conference_revision >= lida.conference_revision)
          ? confirmada
          : lida;
      return atual ? [atual] : [];
    });
  }, [original.boxes, atualizacoes]);
  const task = useMemo<WarehouseTask>(
    () => ({
      ...original,
      status: recebida ? "received" : original.status,
      boxes: caixas,
      items: (original.items ?? []).map((item) => {
        const soma = (lista: readonly CaixaDaChegada[]) =>
          lista.reduce(
            (total, caixa) =>
              total +
              (caixa.lines.find((linha) => linha.inbound_item_id === item.id)
                ?.counted_qty ?? 0),
            0,
          );
        return {
          ...item,
          boxed_qty: emTresCasas(
            Number(item.boxed_qty ?? 0) +
              soma(caixas) -
              soma(original.boxes ?? []),
          ),
          ...(item.id && Object.hasOwn(faltas, item.id)
            ? { shortage: faltas[item.id] }
            : {}),
        };
      }),
    }),
    [original, caixas, faltas, recebida],
  );
  const selecionada =
    escolhida && caixas.some((caixa) => caixa.code === escolhida)
      ? escolhida
      : (caixas.find((caixa) => caixa.status === "counting")?.code ?? null);
  const caixa = caixas.find((item) => item.code === selecionada) ?? null;
  const quantidades = caixa ? (rascunhos[caixa.code] ?? {}) : {};
  const pendentes = Object.entries(rascunhos).some(([code, valores]) => {
    const alvo = caixas.find((item) => item.code === code);
    if (!alvo) return false;
    return Object.entries(valores).some(([id, value]) => {
      const salvo = alvo.lines.find(
        (linha) => linha.inbound_item_id === id,
      )?.counted_qty;
      return value.trim() === ""
        ? salvo != null
        : quantidadeManual(value) !== salvo;
    });
  });
  const podeOperar =
    task.can_advance !== false &&
    ["created", "checking"].includes(task.status ?? "");
  const daChegada = {
    receipt_id: receiptId,
    ...(customerCode ? { customer_code: customerCode } : {}),
  };
  const releitura = () =>
    queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
  const atualizar = (nova: CaixaDaChegada) =>
    setAtualizacoes((atual) => ({ ...atual, [nova.code]: nova }));
  const falhou = (titulo: string) => (error: unknown) => {
    if (!montada.current) return;
    const descricao = error instanceof Error ? error.message : String(error);
    setErro(`${titulo}. ${descricao}`);
    toast({ title: titulo, description: descricao, variant: "destructive" });
  };
  const destino = useDestinoDaCaixa({
    caixa:
      podeOperar && etapa === 3 && caixa?.status === "reviewed" ? caixa : null,
    receiptId,
    customerCode,
    revisao: caixa?.conference_revision ?? 0,
    chave: () => crypto.randomUUID(),
    anotarRevisao: () => undefined,
    onAtualizarCaixa: atualizar,
    travaDeEscrita: trava,
    releitura,
    onConfirmado: () => {
      setEtapa(4);
      setFeedback("Destino confirmado. Revise a entrada antes de concluir.");
      setErro("");
    },
    falhou,
  });
  const ocupado = enviando || destino.ocupado;

  /** Trava síncrona cobre dois eventos no mesmo render. Retentativa repete payload e chave. */
  async function executar<P extends Record<string, unknown>>(
    nome: string,
    tituloDoErro: string,
    payload: P,
    enviar: (dados: P & { idempotency_key: string }) => Promise<Resultado>,
    aplicar: (resultado: Resultado) => void,
    mensagem: string,
    avancar?: () => void,
    /** O botão que mostra a espera; sem ele, o da ação (`nome`). Não entra na chave da tentativa. */
    naTela?: string,
  ) {
    if (!podeOperar || trava.current || destino.ocupado) return;
    trava.current = true;
    setEnviando(true);
    setAcao(naTela ?? nome);
    setErro("");
    const assinatura = JSON.stringify([
      nome,
      { ...payload, expected_revision: undefined },
    ]);
    const dados = (tentativas.current.get(assinatura) ?? {
      ...payload,
      idempotency_key: crypto.randomUUID(),
    }) as P & { idempotency_key: string };
    tentativas.current.set(assinatura, dados);
    try {
      const resultado = await enviar(dados);
      if (!montada.current) return;
      aplicar(resultado);
      tentativas.current.delete(assinatura);
      await releitura();
      if (!montada.current) return;
      setFeedback(mensagem);
      anunciar(mensagem.split(". ")[0]!.replace(/\.$/, ""));
      avancar?.();
    } catch (error) {
      if (!montada.current) return;
      if (pedidoFoiRejeitado(error)) {
        tentativas.current.delete(assinatura);
        await releitura();
      }
      falhou(tituloDoErro)(error);
    } finally {
      trava.current = false;
      if (montada.current) {
        setEnviando(false);
        setAcao(null);
      }
    }
  }
  const daCaixa = (alvo: CaixaDaChegada) => ({
    ...daChegada,
    box_code: alvo.code,
    expected_revision: alvo.conference_revision,
  });
  const revisao = (resultado: Resultado, alvo: CaixaDaChegada) =>
    typeof resultado.conference_revision === "number"
      ? resultado.conference_revision
      : alvo.conference_revision + 1;
  const descartar = (itemId: string, code = caixa?.code) => {
    if (!code) return;
    setRascunhos((atual) => {
      const proximo = { ...atual[code] };
      delete proximo[itemId];
      return { ...atual, [code]: proximo };
    });
  };
  const salvar = (itemId: string, remover = false) => {
    if (!caixa || caixa.status !== "counting") return;
    const item = task.items?.find((linha) => linha.id === itemId);
    if (!item) return;
    const total = remover ? 0 : quantidadeManual(quantidades[itemId] ?? "");
    if (total == null) return;
    const anterior = caixa.lines.find(
      (linha) => linha.inbound_item_id === itemId,
    )?.counted_qty;
    if (total === anterior) {
      descartar(itemId);
      return;
    }
    void executar(
      "quantidade",
      "Não foi possível salvar a quantidade",
      { ...daCaixa(caixa), inbound_item_id: itemId, counted_qty: total },
      lancarNaCaixa,
      (resultado) => {
        const linha: LinhaDaCaixa =
          resultado.line && typeof resultado.line === "object"
            ? (resultado.line as LinhaDaCaixa)
            : {
                inbound_item_id: itemId,
                line_number: Number(item.line_number ?? 0),
                sku_code: item.sku_code ?? item.sku ?? "",
                client_item_code: item.client_item_code ?? "",
                product_name: item.product_name || item.name || "",
                size: item.size ?? null,
                counted_qty: total,
              };
        const linhas = caixa.lines.filter(
          (item) => item.inbound_item_id !== itemId,
        );
        if (total > 0) linhas.push(linha);
        atualizar({
          ...caixa,
          lines: linhas,
          unit_count: emTresCasas(
            linhas.reduce((soma, linha) => soma + linha.counted_qty, 0),
          ),
          conference_revision: revisao(resultado, caixa),
        });
        descartar(itemId, caixa.code);
      },
      remover ? "Produto removido da caixa." : "Quantidade salva nesta caixa.",
      undefined,
      remover ? "remover-produto" : "quantidade",
    );
  };
  const selecionar = (code: string) => {
    if (ocupado) return;
    const alvo = caixas.find((item) => item.code === code);
    setEscolhida(code);
    setProduto(null);
    setBusca("");
    setErro("");
    setFeedback("");
    destino.limpar();
    setEtapa(
      alvo?.status === "counting" ? 1 : alvo?.status === "reviewed" ? 3 : 4,
    );
  };
  const mudarEtapa = (nova: EtapaDaConferencia) => {
    if (ocupado || pendentes) return;
    if (nova === 1) {
      const contando =
        caixa?.status === "counting"
          ? caixa
          : caixas.find((item) => item.status === "counting");
      setEscolhida(contando?.code ?? null);
      setProduto(null);
      setBusca("");
    }
    destino.limpar();
    setEtapa(nova);
    setErro("");
  };
  return (
    <FichaDaChegadaPorCaixaConteudo
      task={task}
      caixas={caixas}
      selecionada={selecionada}
      etapa={etapa}
      produtoSelecionado={produto}
      onProduto={(id) => {
        if (!ocupado) {
          setProduto(id);
          setErro("");
        }
      }}
      quantidades={quantidades}
      busca={busca}
      fechando={etapa === 2}
      rascunho={rascunho}
      ocupado={ocupado}
      acao={acao}
      podeOperar={podeOperar}
      podeRegistrarDivergencia={
        podeOperar &&
        task.can_register_exception !== false &&
        registeringExceptionId !== task.id
      }
      erro={erro}
      feedback={feedback}
      rascunhosPendentes={pendentes}
      onBack={onBack}
      onEtapa={mudarEtapa}
      onSelecionar={selecionar}
      onBusca={setBusca}
      onIniciar={() =>
        void executar(
          "iniciar",
          "Não foi possível iniciar a caixa",
          daChegada,
          iniciarCaixa,
          (resultado) => {
            const criada = resultado.box as Partial<CaixaDaChegada> | undefined;
            if (!criada?.code) return;
            atualizar({
              code: criada.code,
              status: "counting",
              location_id: "",
              lines: [],
              unit_count: 0,
              length_m: null,
              width_m: null,
              height_m: null,
              gross_weight_kg: null,
              allow_tilt: false,
              allow_stacking: false,
              conference_revision: 0,
              refused_positions: [],
              ...criada,
            });
            setEscolhida(criada.code);
            setProduto(null);
            setBusca("");
            destino.limpar();
          },
          "Caixa iniciada. Selecione um produto da NF.",
          () => setEtapa(1),
        )
      }
      onAdicionar={() => produto && salvar(produto)}
      onQuantidade={(id, valor) => {
        if (caixa && !ocupado) {
          setRascunhos((atual) => ({
            ...atual,
            [caixa.code]: { ...atual[caixa.code], [id]: valor },
          }));
          setFeedback("");
        }
      }}
      onLancar={salvar}
      onDescartar={(id) => descartar(id)}
      onRemoverProduto={(id) => salvar(id, true)}
      onAbrirFechamento={() => {
        if (!caixa || pendentes || ocupado) return;
        setRascunho(
          caixa.length_m != null ? rascunhoDaCaixa(caixa) : rascunhoVazio(),
        );
        setEtapa(2);
      }}
      onRascunho={setRascunho}
      onFechar={() => {
        const medidas = boxDraftToPayload(rascunho);
        if (!caixa || caixa.status !== "counting" || !medidas?.gross_weight_kg)
          return;
        void executar(
          "fechar",
          "Não foi possível fechar a caixa",
          {
            ...daCaixa(caixa),
            length_m: medidas.length_m,
            width_m: medidas.width_m,
            height_m: medidas.height_m,
            gross_weight_kg: medidas.gross_weight_kg,
            allow_tilt: rascunho.tombar,
            allow_stacking: rascunho.empilhar,
          },
          fecharCaixa,
          (resultado) => {
            setEscolhida(caixa.code);
            atualizar({
              ...caixa,
              ...medidas,
              status: "reviewed",
              allow_tilt: rascunho.tombar,
              allow_stacking: rascunho.empilhar,
              conference_revision: revisao(resultado, caixa),
            });
            destino.limpar();
          },
          "Caixa fechada. Defina o destino.",
          () => setEtapa(3),
        );
      }}
      onCancelarFechamento={() => mudarEtapa(1)}
      onReabrir={() =>
        caixa &&
        void executar(
          "reabrir",
          "Não foi possível reabrir a caixa",
          daCaixa(caixa),
          reabrirCaixa,
          (resultado) => {
            atualizar({
              ...caixa,
              status: "counting",
              conference_revision: revisao(resultado, caixa),
            });
            destino.limpar();
          },
          "Caixa reaberta para ajustar.",
          () => setEtapa(1),
        )
      }
      onRemover={() =>
        caixa &&
        void executar(
          "remover",
          "Não foi possível remover a caixa",
          daCaixa(caixa),
          removerCaixa,
          () => {
            setAtualizacoes((atual) => ({ ...atual, [caixa.code]: null }));
            setEscolhida(null);
            setProduto(null);
            setRascunhos((atual) => {
              const proximo = { ...atual };
              delete proximo[caixa.code];
              return proximo;
            });
            destino.limpar();
          },
          "Caixa removida.",
          () => setEtapa(1),
        )
      }
      onVoltar={() => mudarEtapa(1)}
      onRegistrarDivergencia={() => onOpenException(task)}
      destino={destino.estado}
      recusando={destino.recusando}
      onDestino={destino.acoes}
      onCancelarRecusa={destino.onCancelarRecusa}
      onRecusar={destino.onRecusar}
      justificativa={justificativa}
      onJustificativa={setJustificativa}
      onConcluir={() => {
        if (pendentes) return;
        if (
          bloqueiosDaTela(
            caixas,
            (task.items ?? []).map((item) => ({ ...item, id: item.id ?? "" })),
            justificativa,
          ).length
        )
          return;
        void executar(
          "concluir",
          "Não foi possível concluir a entrada",
          {
            ...daChegada,
            expected_status:
              task.status === "checking"
                ? ("checking" as const)
                : ("created" as const),
            ...(justificativa.trim() ? { note: justificativa.trim() } : {}),
          },
          concluirEntradaPorCaixa,
          () => {
            setRecebida(true);
            setJustificativa("");
            toast({
              title: "Entrada concluída",
              description: `${task.receipt_number || task.title || receiptId} · ${caixas.length} ${caixas.length === 1 ? "caixa" : "caixas"} para guardar`,
            });
            void queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
          },
          "Entrada concluída. As caixas seguem para a guarda física.",
        );
      }}
      marcando={marcando}
      onMarcarFalta={setMarcando}
      onCancelarFalta={() => setMarcando(null)}
      onConfirmarFalta={(marca) => {
        const item = task.items?.find((linha) => linha.id === marcando);
        if (!item?.id) return;
        const esperado = Number(item.expected_quantity ?? item.quantity ?? 0);
        const boxed = Number(item.boxed_qty ?? 0);
        void executar(
          "marcar",
          "Não foi possível marcar a falta",
          {
            ...daChegada,
            inbound_item_id: item.id,
            reason: marca.motivo,
            ...(marca.detalhe ? { detail: marca.detalhe } : {}),
            expected_boxed_qty: emTresCasas(boxed),
          },
          marcarFalta,
          () => {
            setFaltas((atual) => ({
              ...atual,
              [item.id!]: {
                qty: emTresCasas(esperado - boxed),
                boxed_qty: boxed,
                expected_qty: esperado,
                reason: marca.motivo,
                detail: marca.detalhe,
              },
            }));
            setMarcando(null);
          },
          "Falta marcada.",
        );
      }}
      onDesmarcarFalta={(id) =>
        void executar(
          "desmarcar",
          "Não foi possível desmarcar a falta",
          { ...daChegada, inbound_item_id: id },
          desmarcarFalta,
          () => setFaltas((atual) => ({ ...atual, [id]: null })),
          "Falta desmarcada.",
          undefined,
          `desmarcar:${id}`,
        )
      }
      onEtiquetas={(codigos) =>
        navigate(
          labelsUrl({
            boxes: codigos,
            receipt: original.receipt_number ?? null,
          }),
        )
      }
    />
  );
}

/** Consulta exata mantida para os leitores que usam código de cliente, SKU ou barras. */
export function linhaPeloCodigo(
  itens: readonly WarehouseTaskItem[],
  codigo: string,
): WarehouseTaskItem | null {
  const alvo = codigo.trim().toUpperCase();
  if (!alvo) return null;
  return (
    itens.find((item) =>
      [item.client_item_code, item.sku_code, item.sku, item.barcode].some(
        (valor) => valor?.trim().toUpperCase() === alvo,
      ),
    ) ?? null
  );
}
