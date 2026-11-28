/*
 * Os itens do evento (docs/superpowers/specs/2026-11-26-eventos-design.md, "As
 * telas › Portal"; prancha docs/mockups/EventosPortalItens.dc.html): a lista
 * inteira da edição num diálogo, uma linha por família com a quantidade de
 * cada tamanho, a busca, o filtro por tipo, a ordem, "Ver mais" e a falta de
 * saldo marcada no tamanho. Quem abre o diálogo grava: cada mudança chama
 * `onMudar` com os itens novos (a quantidade confirmada no blur ou no Enter;
 * 0 tira o tamanho). Escolher mais itens é no Estoque.
 */
import { useState } from "react";
import { LIMITES } from "@workspace/dominio";
import { Check, Package, Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ITENS_A_VISTA,
  PAGINA_DO_VER_MAIS,
  categoriasDosItens,
  comQuantidade,
  descricaoDaFamilia,
  faltasDeSaldo,
  familiasDaEdicao,
  filtrarFamilias,
  fotoDoItem,
  janelaDeFamilias,
  ordenarFamilias,
  resumoComValor,
  resumoDosItens,
  semFamilia,
  textoDasFaltas,
  textoDoMostrando,
  textoDoVerMais,
  type FamiliaDaEdicao,
  type ProdutoDoEstoque,
} from "@/lib/eventos/itens";
import type { EdicaoView, ItemDaEdicao } from "@/lib/eventos/tipos";
import { cn } from "@/lib/utils";

/** A quantidade de um tamanho: a digitada vale no blur ou no Enter; a inválida volta à de antes. */
function Quantidade({ rotulo, valor, invalido, onConfirmar }: { rotulo: string; valor: number; invalido: boolean; onConfirmar: (quantidade: number) => void }) {
  const [digitada, setDigitada] = useState<string | null>(null);
  const confirmar = () => {
    if (digitada === null) return;
    const limpa = digitada.replace(/[\s.]/g, "");
    setDigitada(null);
    if (!/^\d+$/.test(limpa)) return;
    const quantidade = Number(limpa);
    if (quantidade > LIMITES.quantidade || quantidade === valor) return;
    onConfirmar(quantidade);
  };
  return (
    <input
      inputMode="numeric"
      aria-label={rotulo}
      aria-invalid={invalido || undefined}
      value={digitada ?? String(valor)}
      onChange={(evento) => setDigitada(evento.target.value)}
      onBlur={confirmar}
      onKeyDown={(evento) => {
        if (evento.key === "Enter") {
          evento.preventDefault();
          confirmar();
        }
      }}
      className={cn(
        "h-6 w-14 rounded border bg-card px-1.5 text-right text-xs font-bold text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-foco",
        invalido ? "border-destructive" : "border-input",
      )}
    />
  );
}

function LinhaDaFamilia({
  familia,
  produtos,
  comFalta,
  onQuantidade,
  onTirar,
}: {
  familia: FamiliaDaEdicao;
  produtos: readonly ProdutoDoEstoque[];
  comFalta: ReadonlySet<string>;
  onQuantidade: (skuCode: string, quantidade: number) => void;
  onTirar: () => void;
}) {
  const foto = fotoDoItem(familia.tamanhos[0].item, produtos);
  return (
    <li className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto_2.25rem] items-center gap-3 border-t border-border/60 px-5 py-2.5 first:border-t-0 md:grid-cols-[2.75rem_minmax(0,1.4fr)_minmax(0,2fr)_5.5rem_2.25rem]">
      <span className="flex size-11 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground">
        {foto ? <img src={foto} alt="" loading="lazy" className="size-full object-cover" /> : <Package aria-hidden="true" className="size-4" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{familia.nome}</span>
        <span className="block truncate text-xs text-muted-foreground">{descricaoDaFamilia(familia)}</span>
      </span>
      <span className="col-span-4 flex flex-wrap gap-1.5 md:col-span-1">
        {familia.tamanhos.map(({ item, tamanho }) => {
          const nome = tamanho && tamanho !== "Único" ? `${familia.nome} ${tamanho}` : familia.nome;
          return (
            <span key={item.sku_code} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted pl-2 pr-1 text-xs font-semibold text-muted-foreground">
              {tamanho ?? "Único"}
              <Quantidade rotulo={nome} valor={item.quantity} invalido={comFalta.has(item.sku_code)} onConfirmar={(quantidade) => onQuantidade(item.sku_code, quantidade)} />
            </span>
          );
        })}
      </span>
      <span className="row-start-1 text-right font-bold tabular-nums md:row-start-auto">
        {familia.pecas.toLocaleString("pt-BR")}
        <span className="block text-xs font-medium text-muted-foreground">{familia.pecas === 1 ? "peça" : "peças"}</span>
      </span>
      <Button type="button" variant="ghost" size="icon" className="row-start-1 size-9 text-muted-foreground md:row-start-auto" aria-label={`Tirar ${familia.nome} do evento`} onClick={onTirar}>
        <X aria-hidden="true" />
      </Button>
    </li>
  );
}

export function ItensDoEventoDialogo({
  edicao,
  produtos,
  onMudar,
  onFechar,
  onEscolherMais,
}: {
  edicao: EdicaoView;
  /** Os produtos do Estoque de hoje: a foto, o valor e a falta de saldo. Sem eles, nada se marca. */
  produtos?: ProdutoDoEstoque[];
  onMudar: (itens: ItemDaEdicao[]) => void;
  onFechar: () => void;
  onEscolherMais: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<"estoque" | "nome">("estoque");
  const [aVista, setAVista] = useState(ITENS_A_VISTA);
  const itens = edicao.itens;
  const doEstoque = produtos ?? [];
  const familias = ordenarFamilias(filtrarFamilias(familiasDaEdicao(itens), { busca, categoria }), ordem, doEstoque);
  const total = familias.reduce((soma, familia) => soma + familia.tamanhos.length, 0);
  const janela = janelaDeFamilias(familias, aVista);
  const faltas = produtos ? faltasDeSaldo(itens, produtos) : [];
  const comFalta = new Set(faltas.map((falta) => falta.item.sku_code));
  const textoDaFalta = textoDasFaltas(faltas);
  const filtrar = (nova: string | null) => {
    setCategoria(nova);
    setAVista(ITENS_A_VISTA);
  };

  return (
    <Dialog open onOpenChange={(aberto) => (aberto ? undefined : onFechar())}>
      <DialogContent rotuloDoFechar="Fechar a lista de itens" className="flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 pb-3.5 pt-4 pr-14">
          <DialogTitle>Itens do evento · {edicao.event_name}</DialogTitle>
          <DialogDescription>{resumoComValor(itens, doEstoque)}</DialogDescription>
          {textoDaFalta ? <p className="text-sm font-semibold text-warning-soft-foreground">{textoDaFalta}</p> : null}
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2.5 border-b border-border/60 px-5 py-3">
          <label className="relative block min-w-0 flex-1 sm:min-w-64">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label={`Buscar entre os ${itens.length.toLocaleString("pt-BR")} itens`}
              placeholder={`Buscar entre os ${itens.length.toLocaleString("pt-BR")} itens`}
              value={busca}
              onChange={(evento) => {
                setBusca(evento.target.value);
                setAVista(ITENS_A_VISTA);
              }}
              className="pl-9"
            />
          </label>
          <Chip selected={categoria === null} count={`· ${itens.length.toLocaleString("pt-BR")}`} onClick={() => filtrar(null)}>
            Todos
          </Chip>
          {categoriasDosItens(itens).map((tipo) => (
            <Chip key={tipo.categoria} selected={categoria === tipo.categoria} count={`· ${tipo.itens.toLocaleString("pt-BR")}`} onClick={() => filtrar(tipo.categoria)}>
              {tipo.categoria}
            </Chip>
          ))}
          <select
            aria-label="Ordem dos itens"
            value={ordem}
            onChange={(evento) => setOrdem(evento.target.value === "nome" ? "nome" : "estoque")}
            className="flex h-10 rounded-md border border-input bg-card px-3 text-sm font-semibold text-foreground"
          >
            <option value="estoque">Como no Estoque</option>
            <option value="nome">Nome: A-Z</option>
          </select>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul>
            {janela.familias.map((familia) => (
              <LinhaDaFamilia
                key={familia.chave}
                familia={familia}
                produtos={doEstoque}
                comFalta={comFalta}
                onQuantidade={(skuCode, quantidade) => onMudar(comQuantidade(itens, skuCode, quantidade))}
                onTirar={() => onMudar(semFamilia(itens, familia))}
              />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-3 text-sm">
            <span className="text-muted-foreground">{textoDoMostrando(janela.mostrando, total)}</span>
            {janela.proximos > 0 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setAVista((atual) => atual + PAGINA_DO_VER_MAIS)}>
                {textoDoVerMais(janela.proximos)}
              </Button>
            ) : null}
          </div>
        </div>

        <DialogFooter className="flex-row flex-wrap items-center gap-2.5 border-t border-border bg-muted/40 px-5 py-3.5 sm:justify-between">
          <span className="text-sm font-semibold">{resumoDosItens(itens)}</span>
          <span className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="lg" onClick={onEscolherMais}>
              <Plus aria-hidden="true" />
              Escolher mais no Estoque
            </Button>
            <Button type="button" size="lg" onClick={onFechar}>
              <Check aria-hidden="true" />
              Pronto
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
