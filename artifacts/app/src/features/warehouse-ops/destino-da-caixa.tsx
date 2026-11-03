import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { formatBoxPlacement, tierLabel, type SlottingCandidate, type SuggestionResult } from "@/lib/warehouse-boxes";
import type { WarehousePosition } from "@/lib/warehouse-positions";

import { ShelfPicker } from "./shelf-picker";

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
  onCancelar: () => void;
  onRecusar: (motivo: string) => void;
};

/** "Não cabe aqui": o motivo, e a prateleira sai da escolha desta caixa. */
export function RecusaDaPrateleira({ prateleira, caixa, detalhe, enviando, onCancelar, onRecusar }: RecusaDaPrateleiraProps) {
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
          Recusar {prateleira}
        </Button>
      </div>
    </form>
  );
}
