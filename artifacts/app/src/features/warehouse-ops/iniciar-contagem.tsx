import { useMemo, useState } from "react";

import { BotaoDeAcao, type EstadoDaAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogCancelar, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { buscarProdutos, type ProdutoDoCatalogo } from "@/lib/warehouse-ops/recontagem-por-caixa";
import type { EscolhaDoAlcance } from "@/lib/warehouse-ops/rodadas-da-contagem";

/**
 * "Iniciar contagem" (o registro da rodada, 18/11/2026;
 * docs/mockups/contagem-entrada/02-iniciar-contagem.png): o alcance da
 * rodada, geral, por rua (as ruas com caixa do cliente) ou por item (a busca
 * no catálogo do cliente, como o item fora da lista da bancada), e o
 * "Iniciar contagem" que grava pela `startCountRound`. Enquanto grava, o
 * diálogo não fecha (carregamento v2, parte 13a). Sem legenda.
 */

type TipoDoAlcance = EscolhaDoAlcance["tipo"];

const ALCANCES: ReadonlyArray<{ value: TipoDoAlcance; label: string }> = [
  { value: "geral", label: "Geral" },
  { value: "rua", label: "Por rua" },
  { value: "item", label: "Por item" },
];

/** Quantos produtos a busca do item mostra. */
const RESULTADOS_A_VISTA = 8;
const SEM_EXCLUSAO: ReadonlySet<string> = new Set();

export const SEM_CATALOGO = "Não consegui carregar o catálogo.";

export type IniciarContagemProps = {
  /** As ruas com caixa do cliente ("A", "B"), na ordem de caminhada. */
  ruas: readonly string[];
  /** Os produtos do cliente, para o alcance por item. */
  produtos: readonly ProdutoDoCatalogo[];
  /** O catálogo não veio: o item não tem como ser escolhido. */
  catalogoFalhou: boolean;
  /** O estado do "Iniciar contagem": em andamento, sucesso, erro ou sem resposta. */
  estado: EstadoDaAcao;
  onCancelar: () => void;
  onIniciar: (escolha: EscolhaDoAlcance) => void;
};

/** O corpo do diálogo: o alcance e o alvo dele. */
export function IniciarContagemConteudo({ ruas, produtos, catalogoFalhou, estado, onCancelar, onIniciar, escolhaInicial }: IniciarContagemProps & { escolhaInicial?: EscolhaDoAlcance }) {
  const [tipo, setTipo] = useState<TipoDoAlcance>(escolhaInicial?.tipo ?? "geral");
  const [rua, setRua] = useState(escolhaInicial?.tipo === "rua" ? escolhaInicial.rua : "");
  const [sku, setSku] = useState(escolhaInicial?.tipo === "item" ? escolhaInicial.sku : "");
  const [termo, setTermo] = useState("");
  const ocupado = estado === "andamento" || estado === "sucesso";
  const escolhido = useMemo(() => produtos.find((produto) => produto.sku === sku) ?? null, [produtos, sku]);
  const resultados = useMemo(() => buscarProdutos(produtos, termo, SEM_EXCLUSAO, RESULTADOS_A_VISTA), [produtos, termo]);
  const escolha: EscolhaDoAlcance | null = tipo === "geral" ? { tipo: "geral" } : tipo === "rua" ? (rua ? { tipo: "rua", rua } : null) : escolhido ? { tipo: "item", sku: escolhido.sku } : null;
  const acionar = () => {
    if (!ocupado && escolha) onIniciar(escolha);
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        acionar();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Alcance</span>
        <Segmented<TipoDoAlcance> aria-label="Alcance" options={ALCANCES} value={tipo} onChange={setTipo} className="w-fit" />
      </div>
      {tipo === "rua" ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Rua</span>
          <Segmented<string> aria-label="Rua" options={ruas.map((candidata) => ({ value: candidata, label: `Rua ${candidata}` }))} value={rua} onChange={setRua} className="w-fit" />
        </div>
      ) : null}
      {tipo === "item" ? (
        <div className="flex flex-col gap-1.5">
          {escolhido ? (
            <>
              <span className="text-sm font-medium">Item</span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-bold leading-snug text-foreground">{escolhido.nome}</p>
                  <p className="text-sm text-muted-foreground">{[escolhido.codigo, escolhido.sku].filter(Boolean).join(" · ")}</p>
                </div>
                <Button type="button" variant="link" className="h-auto px-0 text-sm text-foreground underline max-md:min-h-11" onClick={() => setSku("")}>
                  Trocar
                </Button>
              </div>
            </>
          ) : (
            <>
              <Label htmlFor="iniciar-contagem-item">Item</Label>
              <Input id="iniciar-contagem-item" type="search" placeholder="Código ou nome do produto" autoComplete="off" value={termo} onChange={(event) => setTermo(event.target.value)} />
              {catalogoFalhou ? (
                <p role="alert" className="text-sm font-semibold text-destructive-soft-foreground">
                  {SEM_CATALOGO}
                </p>
              ) : null}
              {resultados.length ? (
                <ul className="flex flex-col divide-y divide-border/60 rounded-lg border border-border">
                  {resultados.map((produto) => (
                    <li key={produto.sku} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3.5 py-2">
                      <button
                        type="button"
                        data-produto={produto.sku}
                        className="min-h-11 text-left font-bold leading-snug text-foreground underline underline-offset-4 ring-foco focus-visible:ring-2"
                        onClick={() => {
                          setSku(produto.sku);
                          setTermo("");
                        }}
                      >
                        {produto.nome}
                      </button>
                      <span className="text-sm text-muted-foreground">{[produto.codigo, produto.sku].filter(Boolean).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <DialogCancelar ocupado={ocupado} onClick={onCancelar} />
        <BotaoDeAcao type="submit" estado={estado} rotulo="Iniciar contagem" andamento="Iniciando…" sucesso="Iniciada" erro="Não iniciada" bloqueado={!escolha} />
      </div>
    </form>
  );
}

export function IniciarContagemDialog({
  aberto,
  onFechar,
  focoAoFechar,
  ...props
}: Omit<IniciarContagemProps, "onCancelar"> & { aberto: boolean; onFechar: () => void; focoAoFechar?: () => HTMLElement | null | undefined }) {
  // Iniciando, o diálogo não fecha: nem o Esc, nem o clique fora, nem o X, que fica aria-disabled.
  const ocupado = props.estado === "andamento" || props.estado === "sucesso";
  return (
    <Dialog open={aberto} ocupado={ocupado} onOpenChange={(open) => (open ? undefined : onFechar())}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined} focoAoFechar={focoAoFechar}>
        <DialogHeader>
          <DialogTitle>Iniciar contagem</DialogTitle>
        </DialogHeader>
        {aberto ? <IniciarContagemConteudo {...props} onCancelar={onFechar} /> : null}
      </DialogContent>
    </Dialog>
  );
}
