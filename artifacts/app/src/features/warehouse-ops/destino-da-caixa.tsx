import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { formatBoxPlacement, tierLabel, type SlottingCandidate, type SuggestionResult } from "@/lib/warehouse-boxes";
import type { WarehousePosition } from "@/lib/warehouse-positions";
import { fetchWarehouseRows } from "@/lib/warehouse-rows";
import { confirmarDestino, pedidoFoiRejeitado, recusarSugestao, sugerirPrateleira, type CaixaDaChegada } from "@/lib/wms/caixas-do-recebimento";

import { ShelfPicker, eligibleShelfPositions } from "./shelf-picker";

/**
 * Onde guardar a caixa fechada (docs/plataforma/recebimento-com-caixas.md,
 * parte 5c; mockups WmsRecebimentoFecharCaixa e WmsRecebimentoSemPrateleira):
 * a prateleira que o motor sugere, ou a escolhida pela pessoa, "Confirmar
 * destino" e "Não cabe aqui", que tira a prateleira da escolha desta caixa.
 * A caixa sem prateleira livre fica fechada e sem prateleira, e a entrada se
 * conclui assim mesmo (decisão 14).
 */

export type ModoDoDestino = "sugestao" | "escolha";

/** O que a tela sabe do destino da caixa: a sugestão, a escolha e a prévia dela. */
export type DestinoDaCaixaEstado = {
  modo: ModoDoDestino;
  sugestao: SuggestionResult | null;
  carregandoSugestao: boolean;
  erroSugestao: string | null;
  /** As prateleiras ativas da zona do cliente, sem as já recusadas para esta caixa. */
  prateleiras: WarehousePosition[];
  carregandoPrateleiras: boolean;
  erroPrateleiras: string | null;
  escolhida: string;
  previa: SlottingCandidate | null;
  carregandoPrevia: boolean;
  erroPrevia: string | null;
};

export function destinoVazio(): DestinoDaCaixaEstado {
  return {
    modo: "sugestao",
    sugestao: null,
    carregandoSugestao: false,
    erroSugestao: null,
    prateleiras: [],
    carregandoPrateleiras: false,
    erroPrateleiras: null,
    escolhida: "",
    previa: null,
    carregandoPrevia: false,
    erroPrevia: null,
  };
}

/** A prateleira à vista: a sugerida pelo motor, ou a escolhida já conferida. */
export function candidatoDoDestino(estado: DestinoDaCaixaEstado): SlottingCandidate | null {
  return estado.modo === "sugestao" ? estado.sugestao?.position ?? null : estado.previa;
}

/** O motor respondeu que nenhuma prateleira da zona cabe a caixa. */
export function semPrateleiraLivre(estado: DestinoDaCaixaEstado): boolean {
  return Boolean(estado.sugestao && !estado.sugestao.position);
}

/** O selo da caixa fechada e sem destino. */
export function seloDaCaixaFechada(estado: DestinoDaCaixaEstado): string {
  return semPrateleiraLivre(estado) ? "fechada · sem prateleira" : "fechada · sem destino";
}

/** O que a sugestão grava no destino confirmado: a sugerida, o motivo, as alternativas e o nível. */
export function sugestaoDoConfirmar(sugestao: SuggestionResult | null) {
  const posicao = sugestao?.position;
  if (!posicao) return undefined;
  return {
    position: posicao.code,
    reason: posicao.reason,
    alternatives: sugestao.alternatives.map((alternativa) => alternativa.code),
    tier: posicao.tier,
  };
}

const MODOS = [
  { value: "sugestao", label: "Sugestão do sistema" },
  { value: "escolha", label: "Escolher prateleira" },
] as const;

export type DestinoDaCaixaProps = {
  estado: DestinoDaCaixaEstado;
  ocupado: boolean;
  onModo: (modo: ModoDoDestino) => void;
  onEscolher: (codigo: string) => void;
  onConfirmar: (candidato: SlottingCandidate) => void;
  onNaoCabe: (codigo: string) => void;
  onTentarDeNovo: () => void;
};

/** O painel "Guardar em" da caixa fechada. */
export function DestinoDaCaixa({ estado, ocupado, onModo, onEscolher, onConfirmar, onNaoCabe, onTentarDeNovo }: DestinoDaCaixaProps) {
  const candidato = candidatoDoDestino(estado);
  const sugestao = estado.modo === "sugestao";
  const alternativas = sugestao ? estado.sugestao?.alternatives ?? [] : [];
  const carregando = sugestao ? estado.carregandoSugestao : estado.carregandoPrevia;
  const erro = sugestao ? estado.erroSugestao : estado.erroPrevia;

  return (
    <section aria-labelledby="guardar-em" className="@container flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="guardar-em" className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Guardar em</h3>
        <Segmented<ModoDoDestino> aria-label="Escolha da prateleira" options={MODOS} value={estado.modo} onChange={onModo} />
      </div>

      {!sugestao ? (
        estado.erroPrateleiras ? (
          <Alert variant="destructive">
            <AlertTitle>Não foi possível carregar as prateleiras</AlertTitle>
            <AlertDescription>{estado.erroPrateleiras}</AlertDescription>
          </Alert>
        ) : (
          <ShelfPicker
            positions={estado.prateleiras}
            value={estado.escolhida}
            onSelect={onEscolher}
            disabled={ocupado}
            loading={estado.carregandoPrateleiras}
          />
        )
      ) : null}

      {carregando ? (
        <p role="status" className="text-sm text-muted-foreground">
          {sugestao ? "Consultando a sugestão…" : "Conferindo o encaixe nesta prateleira…"}
        </p>
      ) : erro ? (
        <Alert variant="destructive">
          <AlertTitle>{sugestao ? "Não foi possível consultar a sugestão" : "Prateleira não serve"}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{erro}</span>
            {sugestao ? (
              <Button type="button" size="sm" variant="outline" onClick={onTentarDeNovo}>
                Tentar de novo
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : candidato ? (
        <div className="flex flex-col gap-4 @lg:flex-row @lg:items-start @lg:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-4xl font-extrabold tracking-tight">{candidato.code}</p>
            <p className="text-sm">{candidato.reason}</p>
            <p className="text-sm text-muted-foreground">{formatBoxPlacement(candidato.placement)}</p>
            {sugestao ? (
              <div className="mt-1 flex flex-wrap gap-2">
                <Badge variant="outline" className="border-info-soft-border bg-info-soft text-info-soft-foreground">
                  {tierLabel(candidato.tier)}
                </Badge>
                {alternativas.length ? (
                  <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                    alternativas {alternativas.map((alternativa) => alternativa.code).join(" · ")}
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 @lg:items-end">
            <Button type="button" disabled={ocupado} onClick={() => onConfirmar(candidato)}>
              Confirmar destino em {candidato.code}
            </Button>
            {sugestao ? (
              <Button type="button" variant="outline" disabled={ocupado} onClick={() => onNaoCabe(candidato.code)}>
                Não cabe aqui
              </Button>
            ) : null}
          </div>
        </div>
      ) : sugestao && semPrateleiraLivre(estado) ? (
        <div className="flex flex-col gap-1">
          <p className="text-4xl font-extrabold tracking-tight text-warning-soft-foreground">Sem prateleira</p>
          <p className="text-sm">{estado.sugestao?.rejected}</p>
        </div>
      ) : null}
    </section>
  );
}

export type RecusaDaPrateleiraProps = {
  prateleira: string | null;
  caixa: string;
  detalhe: string;
  enviando: boolean;
  /** "Recusar" na bancada; "Liberar" na guarda, que solta a reserva (mockup WmsGuardaNaoCabe). */
  acao?: string;
  onCancelar: () => void;
  onRecusar: (motivo: string) => void;
};

/** "Não cabe aqui": o motivo, e a prateleira sai da escolha desta caixa. */
export function RecusaDaPrateleira({ prateleira, caixa, detalhe, enviando, acao = "Recusar", onCancelar, onRecusar }: RecusaDaPrateleiraProps) {
  return (
    <Dialog open={Boolean(prateleira)} onOpenChange={(aberto) => (aberto ? undefined : onCancelar())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Não cabe em {prateleira}</DialogTitle>
        </DialogHeader>
        {prateleira ? (
          <RecusaDaPrateleiraConteudo
            key={`${caixa}:${prateleira}`}
            prateleira={prateleira}
            caixa={caixa}
            detalhe={detalhe}
            enviando={enviando}
            acao={acao}
            onCancelar={onCancelar}
            onRecusar={onRecusar}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** O corpo do diálogo, com o motivo digitado. */
export function RecusaDaPrateleiraConteudo({
  prateleira,
  caixa,
  detalhe,
  enviando,
  acao = "Recusar",
  onCancelar,
  onRecusar,
  motivoInicial = "",
}: Omit<RecusaDaPrateleiraProps, "prateleira"> & { prateleira: string; motivoInicial?: string }) {
  const [motivo, setMotivo] = useState(motivoInicial);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (motivo.trim() && !enviando) onRecusar(motivo.trim());
      }}
    >
      <div>
        <p className="font-semibold text-foreground">Caixa {caixa}</p>
        <p className="text-sm text-muted-foreground">{detalhe}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nao-cabe-motivo">Motivo</Label>
        <Input id="nao-cabe-motivo" maxLength={300} value={motivo} onChange={(event) => setMotivo(event.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!motivo.trim() || enviando}>
          {acao} {prateleira}
        </Button>
      </div>
    </form>
  );
}

/**
 * A sugestão, a escolha, a prévia, confirmar e recusar o destino de uma
 * caixa fechada: na bancada (parte 5c) e na guarda da caixa sem prateleira
 * (parte 5f, decisão 14), pelas mesmas callables (a 4g aceita depois da
 * conclusão). Sem caixa, nada é pedido.
 */
export function useDestinoDaCaixa({
  caixa,
  receiptId,
  customerCode,
  revisao,
  chave,
  anotarRevisao,
  onAtualizarCaixa,
  travaDeEscrita,
  releitura,
  onConfirmado,
  falhou,
}: {
  caixa: CaixaDaChegada | null;
  receiptId: string;
  customerCode: string;
  /** A revisão que a próxima escrita manda: a maior entre a lida e a devolvida. */
  revisao: number;
  chave: () => string;
  anotarRevisao: (revisao: unknown, code: string) => void;
  /** Aplica a escrita confirmada junto com a revisão, antes de liberar a próxima ação. */
  onAtualizarCaixa?: (caixa: CaixaDaChegada) => void;
  /** Compartilhada com as demais escritas da ficha, inclusive antes de renderizar busy. */
  travaDeEscrita?: { current: boolean };
  releitura: () => Promise<unknown>;
  /** Depois da releitura da fila, com o destino confirmado. */
  onConfirmado: () => void;
  falhou: (titulo: string) => (error: unknown) => void;
}) {
  const [modo, setModo] = useState<ModoDoDestino>("sugestao");
  const [escolhida, setEscolhida] = useState("");
  const [recusando, setRecusando] = useState<string | null>(null);
  const travaLocal = useRef(false);
  const trava = travaDeEscrita ?? travaLocal;
  const tentativas = useRef(new Map<string, Record<string, unknown>>());
  const montada = useRef(true);
  useEffect(() => {
    montada.current = true;
    return () => { montada.current = false; };
  }, []);
  const daChegada = {
    receipt_id: receiptId,
    ...(customerCode ? { customer_code: customerCode } : {}),
  };
  const mensagem = (error: unknown) =>
    error ? (error instanceof Error ? error.message : String(error)) : null;

  const sugestao = useQuery({
    queryKey: ["sugestao-da-caixa", receiptId, caixa?.code ?? "", revisao],
    queryFn: () => sugerirPrateleira({ ...daChegada, box_code: caixa!.code }),
    enabled: Boolean(caixa),
    retry: false,
    staleTime: 0,
  });
  const posicoes = useQuery({
    queryKey: ["warehouse-positions", "all-pages"],
    staleTime: 30_000,
    queryFn: async () => ({
      items: await fetchWarehouseRows<WarehousePosition>(
        "/api/warehouse/positions?limit=2000",
      ),
    }),
    enabled: Boolean(caixa) && modo === "escolha",
  });
  const previa = useQuery({
    queryKey: [
      "sugestao-da-caixa",
      receiptId,
      caixa?.code ?? "",
      revisao,
      "prateleira",
      escolhida,
    ],
    queryFn: () =>
      sugerirPrateleira({
        ...daChegada,
        box_code: caixa!.code,
        location_id: escolhida,
      }),
    enabled: Boolean(caixa) && modo === "escolha" && Boolean(escolhida),
    retry: false,
    staleTime: 0,
  });
  const prateleiras = useMemo(() => {
    const recusadas = new Set(caixa?.refused_positions ?? []);
    // A fila do Receber é a do cliente ativo: as prateleiras são as da zona dele.
    return eligibleShelfPositions(
      posicoes.data?.items ?? [],
      customerCode,
    ).filter((posicao) => !recusadas.has(posicao.code));
  }, [posicoes.data?.items, caixa?.refused_positions, customerCode]);
  const estado: DestinoDaCaixaEstado = caixa
    ? {
        modo,
        sugestao: sugestao.data ?? null,
        carregandoSugestao: sugestao.isFetching,
        erroSugestao: mensagem(sugestao.error),
        prateleiras,
        carregandoPrateleiras: posicoes.isLoading,
        erroPrateleiras: mensagem(posicoes.error),
        escolhida,
        previa: previa.data?.position ?? null,
        carregandoPrevia: previa.isFetching,
        erroPrevia: mensagem(previa.error),
      }
    : destinoVazio();

  const limpar = () => {
    setModo("sugestao");
    setEscolhida("");
    setRecusando(null);
  };
  function pedido<T extends Record<string, unknown>>(tipo: string, dados: T) {
    const assinatura = JSON.stringify([
      tipo,
      { ...dados, expected_revision: undefined },
    ]);
    const payload = (tentativas.current.get(assinatura) ?? {
      ...dados,
      idempotency_key: chave(),
    }) as T & { idempotency_key: string };
    tentativas.current.set(assinatura, payload);
    return { assinatura, payload };
  }
  const confirmar = useMutation({
    mutationFn: (input: {
      caixa: CaixaDaChegada;
      candidato: SlottingCandidate;
    }) => {
      // A sugestão do motor vai junto mesmo quando a pessoa escolheu outra
      // prateleira. Sem ela (a consulta falhou ou não voltou), a chave não vai:
      // o SDK do Firebase manda `undefined` como `null`, e o servidor recusa
      // `suggestion: null` ("Campo inválido: suggestion.").
      const sugerida = sugestaoDoConfirmar(sugestao.data ?? null);
      const tentativa = pedido("confirmar", {
        ...daChegada,
        box_code: input.caixa.code,
        expected_revision: revisao,
        location_id: input.candidato.code,
        orientation: input.candidato.placement.orientation,
        // A caixa na base vai sem apoio, com o `null` de propósito: para o
        // servidor é "no piso, sem empilhar". Sem a chave, ele empilharia se
        // o piso deixasse de caber (warehouse-boxes.ts, `placementFor`).
        support_box_code: input.candidato.placement.support_box_code ?? null,
        ...(sugerida ? { suggestion: sugerida } : {}),
      });
      return confirmarDestino(tentativa.payload).then((resultado) => {
        tentativas.current.delete(tentativa.assinatura);
        return resultado;
      }, (error: unknown) => {
        if (pedidoFoiRejeitado(error)) tentativas.current.delete(tentativa.assinatura);
        throw error;
      });
    },
    onSuccess: async (resultado, input) => {
      if (!montada.current) return;
      anotarRevisao(resultado.conference_revision, input.caixa.code);
      onAtualizarCaixa?.({
        ...input.caixa,
        status: "committing",
        location_id: input.candidato.code,
        conference_revision:
          Number(resultado.conference_revision) || revisao + 1,
      });
      await releitura();
      if (!montada.current) return;
      limpar();
      onConfirmado();
    },
    onError: async (error) => {
      if (!montada.current) return;
      if (pedidoFoiRejeitado(error)) await releitura();
      if (montada.current) falhou("Não foi possível confirmar o destino")(error);
    },
    onSettled: () => {
      trava.current = false;
    },
  });
  const recusar = useMutation({
    mutationFn: (input: {
      caixa: CaixaDaChegada;
      prateleira: string;
      motivo: string;
    }) => {
      const tentativa = pedido("recusar", {
        ...daChegada,
        box_code: input.caixa.code,
        expected_revision: revisao,
        position: input.prateleira,
        reason: input.motivo,
      });
      return recusarSugestao(tentativa.payload).then((resultado) => {
        tentativas.current.delete(tentativa.assinatura);
        return resultado;
      }, (error: unknown) => {
        if (pedidoFoiRejeitado(error)) tentativas.current.delete(tentativa.assinatura);
        throw error;
      });
    },
    onSuccess: async (resultado, input) => {
      if (!montada.current) return;
      setRecusando(null);
      // A revisão nova pede outra sugestão, já sem a prateleira recusada.
      anotarRevisao(resultado.conference_revision, input.caixa.code);
      onAtualizarCaixa?.({
        ...input.caixa,
        refused_positions: [...input.caixa.refused_positions, input.prateleira],
        conference_revision:
          Number(resultado.conference_revision) || revisao + 1,
      });
      await releitura();
    },
    onError: async (error) => {
      if (!montada.current) return;
      if (pedidoFoiRejeitado(error)) await releitura();
      if (montada.current) falhou("Não foi possível recusar a prateleira")(error);
    },
    onSettled: () => {
      trava.current = false;
    },
  });

  return {
    estado,
    recusando,
    limpar,
    ocupado: confirmar.isPending || recusar.isPending,
    acoes: {
      onModo: setModo,
      onEscolher: setEscolhida,
      onConfirmar: (candidato: SlottingCandidate) => {
        if (!caixa || trava.current) return;
        trava.current = true;
        confirmar.mutate({ caixa, candidato });
      },
      onNaoCabe: setRecusando,
      onTentarDeNovo: () => void sugestao.refetch(),
    } satisfies Omit<DestinoDaCaixaProps, "estado" | "ocupado">,
    onCancelarRecusa: () => setRecusando(null),
    onRecusar: (motivo: string) => {
      if (!caixa || !recusando || trava.current) return;
      trava.current = true;
      recusar.mutate({ caixa, prateleira: recusando, motivo });
    },
  };
}
