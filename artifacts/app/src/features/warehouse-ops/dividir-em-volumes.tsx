import { useEffect, useRef } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { textoDaCaixa } from "@/lib/warehouse-ops/caixas-da-separacao";
import {
  digitarParte,
  maisUmVolume,
  normalizarParte,
  numerosDaDivisao,
  passoDaParte,
  pesarParte,
  pesoInvalido,
  podeConfirmarADivisao,
  podeMaisUmVolume,
  podeTirarVolume,
  semMais,
  semMenos,
  subtituloDaDivisao,
  textoDaParte,
  textoDoBotaoDaDivisao,
  tirarVolume,
  type DivisaoEmVolumes,
  type ParteDaDivisao,
} from "@/lib/warehouse-ops/divisao-em-volumes";
import { nomeDoVolume } from "@/lib/warehouse-ops/volumes-do-pedido";

/**
 * "Dividir em volumes" (separação com caixas, parte 7b; decisões 27 a 30;
 * docs/mockups/WmsDividirVolumes.dc.html, WmsDividirComItens.dc.html e
 * WmsDividirCelular.dc.html): a linha que não cabe num volume, em dois ou
 * mais, a partir do volume aberto. Cada volume, menos o último, fecha ao
 * confirmar, com o peso opcional no computador; o último fica aberto, com o
 * resto. Tudo se edita, e a soma sempre fecha (a conta em
 * lib/warehouse-ops/divisao-em-volumes.ts). No celular, sem peso e com os
 * botões de 44 px. Sem legenda.
 */

/** As colunas das linhas: o volume, as unidades, o peso (só no computador) e a lixeira. */
const COLUNAS = "grid-cols-[minmax(0,1fr)_142px_44px] lg:grid-cols-[minmax(0,1fr)_144px_104px_40px]";

/**
 * O foco do −, do número e do +, por dentro, como nas pranchas: o anel de
 * fora do botão some no `overflow-hidden` do grupo e embaixo do número.
 */
const FOCO_POR_DENTRO = "focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground";
const BOTAO_DO_PASSO = `h-full w-11 shrink-0 rounded-none px-0 lg:w-10 ${FOCO_POR_DENTRO} focus-visible:ring-0 focus-visible:ring-offset-0`;

/** O peso que não vale: a borda e o anel de erro, como nas pranchas; com o foco, o anel cresce, como o do campo válido. */
const PESO_INVALIDO =
  "aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive aria-[invalid=true]:focus-visible:ring-2";

export function DividirEmVolumesConteudo({
  divisao,
  confirmando = false,
  onMudar,
  onVoltar,
  onConfirmar,
}: {
  divisao: DivisaoEmVolumes;
  confirmando?: boolean;
  onMudar: (divisao: DivisaoEmVolumes) => void;
  onVoltar: () => void;
  onConfirmar: () => void;
}) {
  const numeros = numerosDaDivisao(divisao);
  const ultima = divisao.partes.length - 1;
  // Enquanto grava, nada se edita: a tela mostra o que foi mandado, e os campos e os botões desligam.
  const mudar = (partes: ParteDaDivisao[]) => onMudar({ ...divisao, partes });
  // Tirou um volume: o botão dele sai da tela, e o foco cairia no diálogo; vai para "Mais um volume", que fica.
  const maisUm = useRef<HTMLButtonElement>(null);
  const focarMaisUm = useRef(false);
  useEffect(() => {
    if (!focarMaisUm.current) return;
    focarMaisUm.current = false;
    maisUm.current?.focus();
  });
  // Na linha por separar, as caixas de onde ela sai, em azul, como na bancada; na já separada, as de onde saiu, em cinza.
  const corDaCaixa = divisao.modo === "separar" ? "bg-info-soft text-info-soft-foreground" : "bg-muted text-foreground";
  return (
    <div className="grid gap-4">
      <div className="grid gap-2.5">
        <p className="text-sm font-medium text-muted-foreground">{subtituloDaDivisao(divisao)}</p>
        {divisao.caixas.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {divisao.caixas.map((caixa) => (
              <span key={caixa.box_code} className={`whitespace-nowrap rounded-md px-1.5 py-0.5 font-mono text-xs font-medium ${corDaCaixa}`}>
                {textoDaCaixa(caixa)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        {/* No computador, o que cada coluna é; no celular não há peso nem cabeçalho. */}
        <div aria-hidden="true" className={`hidden items-center gap-3.5 border-b border-border/60 bg-muted/40 px-4 py-1.5 text-xs font-bold text-muted-foreground lg:grid ${COLUNAS}`}>
          <span className="col-start-2 text-center">Un.</span>
          <span>Peso (kg)</span>
        </div>
        <ul className="divide-y divide-border/60">
          {divisao.partes.map((parte, indice) => {
            const numeroDoVolume = numeros[indice]!;
            const nomeId = `dividir-volume-${numeroDoVolume}`;
            const fecha = indice < ultima;
            const texto = textoDaParte(divisao, indice);
            const invalido = fecha && pesoInvalido(parte);
            return (
              // A chave é a posição: quando os números mudam ao vivo (outro volume fechou), a linha fica, e o campo em que a pessoa digita não perde o foco.
              <li key={indice} className={`grid items-center gap-2 px-3.5 py-3 lg:gap-3.5 lg:px-4 ${COLUNAS}`}>
                <div className="min-w-0">
                  <div id={nomeId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-foreground">
                    {nomeDoVolume(numeroDoVolume)}
                    {fecha ? null : (
                      <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
                        aberto
                      </Badge>
                    )}
                  </div>
                  {texto ? <p className="text-xs text-muted-foreground">{texto}</p> : null}
                </div>
                {/* No celular, 46 px com a borda: os botões de dentro ficam com 44 px, como na prancha. */}
                <div role="group" aria-labelledby={nomeId} className="flex h-11.5 items-stretch overflow-hidden rounded-lg border border-input bg-background lg:h-10">
                  <Button
                    type="button"
                    variant="ghost"
                    className={BOTAO_DO_PASSO}
                    aria-label={`Menos um no volume ${numeroDoVolume}`}
                    disabled={confirmando || semMenos(divisao.partes, indice)}
                    onClick={() => mudar(passoDaParte(divisao.partes, indice, -1))}
                  >
                    <Minus className="size-4" aria-hidden="true" />
                  </Button>
                  <input
                    aria-label={`Separado no volume ${numeroDoVolume}`}
                    inputMode="numeric"
                    disabled={confirmando}
                    value={parte.texto ?? String(parte.quantidade)}
                    onChange={(event) => mudar(digitarParte(divisao.partes, indice, event.target.value))}
                    onBlur={() => {
                      if (parte.texto !== null) mudar(normalizarParte(divisao.partes, indice));
                    }}
                    className={`w-0 min-w-0 flex-1 border-x border-input bg-background text-center text-base font-bold tabular-nums disabled:opacity-50 lg:text-sm ${FOCO_POR_DENTRO}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className={BOTAO_DO_PASSO}
                    aria-label={`Mais um no volume ${numeroDoVolume}`}
                    disabled={confirmando || semMais(divisao.partes, indice)}
                    onClick={() => mudar(passoDaParte(divisao.partes, indice, 1))}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                {/* O peso do volume que fecha só no computador (decisões 17 e 29). */}
                {fecha ? (
                  <Input
                    id={`dividir-peso-${numeroDoVolume}`}
                    inputMode="decimal"
                    maxLength={8}
                    aria-label={`Peso do volume ${numeroDoVolume} (kg)`}
                    aria-invalid={invalido || undefined}
                    disabled={confirmando}
                    value={parte.peso}
                    onChange={(event) => mudar(pesarParte(divisao.partes, indice, event.target.value))}
                    className={`hidden lg:block ${PESO_INVALIDO}`}
                  />
                ) : null}
                {podeTirarVolume(divisao.partes, indice) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 lg:h-10 lg:w-10"
                    aria-label={`Tirar o volume ${numeroDoVolume}`}
                    disabled={confirmando}
                    onClick={() => {
                      focarMaisUm.current = true;
                      mudar(tirarVolume(divisao.partes, indice));
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
      <Button
        ref={maisUm}
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 justify-self-start lg:min-h-9"
        disabled={confirmando || !podeMaisUmVolume(divisao.partes)}
        onClick={() => mudar(maisUmVolume(divisao.partes))}
      >
        <Plus className="size-4" aria-hidden="true" />
        Mais um volume
      </Button>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="min-h-11 lg:min-h-10" onClick={onVoltar}>
          Voltar
        </Button>
        <Button type="button" className="min-h-11 lg:min-h-10" disabled={confirmando || !podeConfirmarADivisao(divisao)} onClick={onConfirmar}>
          {textoDoBotaoDaDivisao(divisao.modo, divisao.partes.length, confirmando)}
        </Button>
      </DialogFooter>
    </div>
  );
}

export function DividirEmVolumesDialog({
  divisao,
  confirmando,
  onMudar,
  onFechar,
  onConfirmar,
}: {
  /** A divisão aberta no diálogo; null fecha. */
  divisao: DivisaoEmVolumes | null;
  confirmando?: boolean;
  onMudar: (divisao: DivisaoEmVolumes) => void;
  onFechar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <Dialog open={Boolean(divisao)} onOpenChange={(open) => (open ? undefined : onFechar())}>
      <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Dividir em volumes</DialogTitle>
        </DialogHeader>
        {divisao ? <DividirEmVolumesConteudo divisao={divisao} confirmando={confirmando} onMudar={onMudar} onVoltar={onFechar} onConfirmar={onConfirmar} /> : null}
      </DialogContent>
    </Dialog>
  );
}
