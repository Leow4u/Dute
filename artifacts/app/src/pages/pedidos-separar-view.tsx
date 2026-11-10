import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, MoreHorizontal, Package, Printer } from "lucide-react";
import { Link } from "wouter";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { CaixaDaLinha } from "@workspace/dominio";

import { cn } from "@/lib/utils";
import { textoDaCaixa, textoDaEtiqueta, textoDasAbertas, type EtiquetaParaTrocar } from "@/lib/warehouse-ops/caixas-da-separacao";
import { resumoDoGrupo, type GrupoDaLista, type LinhaDaLista } from "@/lib/warehouse-ops/lista-de-separacao";
import type { WarehouseTaskItem } from "@/lib/warehouse-ops/model";
import {
  emSeparacaoDesde,
  estadoDaLinha,
  itensDoProgresso,
  percentualSeparado,
  podeConcluirSeparacao,
  progressoDoGrupo,
  textoComDiferenca,
  textoDaDiferenca,
  textoPorSeparar,
  unidadesDoProgresso,
  type ProgressoDoPedido,
} from "@/lib/warehouse-ops/separacao";

/**
 * Pedidos › Separar, a bancada do pedido (separação com caixas, partes 2 e 5;
 * docs/mockups/WmsSepararBancada.dc.html e WmsSepararCelular.dc.html): o
 * progresso salvo, as linhas por prateleira na ordem de caminhada com
 * "Separar", "Desfazer" e "Separar menos", e "Concluir separação". A linha
 * por separar diz de qual caixa o sistema vai tirar ("12 de CX-000027",
 * "esvazia", "CX-000029 inteira"), a separada diz de onde saiu, e "Outra
 * caixa" corrige (parte 3b). "Etiquetas para trocar" lista as caixas que o
 * pedido abriu, até a etiqueta com o saldo ser impressa (parte 3d). "Levar a
 * caixa" e os volumes da prancha entram com a parte 4. Os dados e as ações
 * chegam por props (pages/pedidos-separar.tsx). Sem legenda.
 */

/** Quantas caixas "Etiquetas para trocar" lista antes de "Ver as N caixas". */
const ETIQUETAS_A_VISTA = 5;

export type EstadoDaBancada = "carregando" | "nao_encontrado" | "erro" | "concluida" | "pronto";

const MENSAGENS: Record<Exclude<EstadoDaBancada, "pronto">, string> = {
  carregando: "Carregando",
  nao_encontrado: "Pedido não encontrado",
  erro: "Não foi possível carregar o pedido.",
  concluida: "Separação concluída",
};

const numero = new Intl.NumberFormat("pt-BR");

export function PedidosSepararView({
  estado,
  numero: pedido,
  resumo,
  comecouEm,
  comecou,
  progresso,
  grupos,
  listaHref,
  operador,
  coordenacao,
  fechada = false,
  ocupadas,
  caixasDaLinha,
  comOutraCaixa,
  etiquetas,
  etiquetasHref,
  fotoDe,
  onSeparar,
  onDesfazer,
  onSepararMenos,
  onOutraCaixa,
  onConcluir,
}: {
  estado: EstadoDaBancada;
  /** "PED-0001" */
  numero: string;
  /** "BTG Pactual · 116 itens · 3.335 un. · Para quando Seg 16/11 11:36" */
  resumo: string;
  /** Quando a primeira linha foi separada. */
  comecouEm?: string | null;
  comecou: boolean;
  progresso: ProgressoDoPedido;
  grupos: GrupoDaLista[];
  /** A lista de separação para imprimir. */
  listaHref: string | null;
  /** Quem separa: o suporte só consulta. */
  operador: boolean;
  /** Quem conclui o pedido com diferença. */
  coordenacao: boolean;
  /**
   * A separação já foi concluída no servidor e falta a embalagem (a conclusão
   * parou no meio): as linhas não mudam mais, e "Concluir separação" continua.
   */
  fechada?: boolean;
  /** As linhas com uma gravação em curso. */
  ocupadas?: ReadonlySet<string>;
  /**
   * De qual caixa cada linha sai: a sugestão do sistema, na linha por
   * separar; o que ficou gravado, na separada. A linha fora do mapa mostra só
   * os códigos das caixas da prateleira (a leitura das caixas não chegou).
   */
  caixasDaLinha?: ReadonlyMap<string, readonly CaixaDaLinha[]>;
  /** As linhas com caixa na prateleira para escolher: ganham "Outra caixa". */
  comOutraCaixa?: ReadonlySet<string>;
  /** As caixas que o pedido abriu e que estão com a etiqueta velha. */
  etiquetas?: readonly EtiquetaParaTrocar[];
  /** A tela de Etiquetas com essas caixas. */
  etiquetasHref?: string | null;
  fotoDe?: (item: WarehouseTaskItem) => string | undefined;
  onSeparar: (linha: LinhaDaLista) => void;
  onDesfazer: (linha: LinhaDaLista) => void;
  onSepararMenos: (linha: LinhaDaLista) => void;
  onOutraCaixa?: (linha: LinhaDaLista) => void;
  onConcluir: () => void;
}) {
  // A prateleira toda separada fecha sozinha; a pessoa abre a que quiser rever.
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(new Set());
  const mensagem = estado === "pronto" ? null : MENSAGENS[estado];
  const podeConcluir = estado === "pronto" && operador && (fechada || podeConcluirSeparacao(progresso, coordenacao));
  const falta = textoPorSeparar(progresso);
  const diferenca = textoComDiferenca(progresso);
  // Só a primeira linha por separar leva a ação principal.
  const primeira = grupos.flatMap((grupo) => grupo.linhas).find((linha) => estadoDaLinha(linha.item) === "pendente")?.id;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 pb-24">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Button asChild variant="outline" size="icon" className="shrink-0">
            <Link href="/pedidos" aria-label="Voltar a Pedidos">
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xl font-extrabold tracking-tight text-foreground">
              {pedido || "Separar"}
              {estado === "pronto" && comecou ? (
                <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
                  {emSeparacaoDesde(comecouEm)}
                </Badge>
              ) : null}
            </h1>
            {estado === "pronto" && resumo ? <p className="mt-0.5 text-sm text-muted-foreground">{resumo}</p> : null}
          </div>
        </div>
        {estado === "pronto" ? (
          <div className="flex flex-wrap items-center gap-2">
            {falta ? <span className="text-sm font-semibold text-muted-foreground">{falta}</span> : null}
            {listaHref ? (
              <Button asChild variant="outline">
                <Link href={listaHref}>
                  <Printer className="size-4" aria-hidden="true" />
                  Imprimir lista
                </Link>
              </Button>
            ) : null}
            {operador ? (
              <Button type="button" variant={podeConcluir ? "default" : "outline"} disabled={!podeConcluir} onClick={onConcluir}>
                Concluir separação
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>

      {mensagem ? (
        <p role={estado === "erro" ? "alert" : undefined} className="rounded-lg border border-border bg-card px-5 py-7 text-center text-sm font-semibold text-muted-foreground">
          {mensagem}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <p className="text-sm text-muted-foreground">
              <b className="font-bold text-foreground">{itensDoProgresso(progresso)}</b> · {unidadesDoProgresso(progresso)}
            </p>
            {/* No celular a barra vem embaixo do texto, na largura toda. */}
            <div aria-hidden="true" className="h-2 w-full shrink-0 overflow-hidden rounded-full bg-muted sm:w-auto sm:flex-1">
              <div className="h-full rounded-full bg-success" style={{ width: `${percentualSeparado(progresso)}%` }} />
            </div>
          </div>
          {diferenca ? (
            <p className="rounded-lg border border-warning-soft-border bg-warning-soft px-4 py-2.5 text-sm font-semibold text-warning-soft-foreground">{diferenca}</p>
          ) : null}

          <div className={cn(etiquetas?.length && "grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start")}>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {grupos.map((grupo) => {
              const nome = grupo.posicao || "sem endereço";
              const doGrupo = progressoDoGrupo(grupo);
              const aberta = !doGrupo.completo || abertas.has(grupo.posicao);
              return (
                <section key={grupo.posicao || "sem-endereco"} className="border-t border-border/60 first:border-t-0">
                  <h2 className="flex min-h-12 items-center gap-2.5 px-4 py-2 text-sm font-medium text-muted-foreground md:px-5">
                    <span className="font-mono text-sm font-bold text-foreground">{nome}</span>
                    {resumoDoGrupo(grupo)}
                    <span className="ml-auto flex items-center gap-2">
                      {doGrupo.completo ? (
                        <>
                          <Badge variant="outline" className="border-success-soft-border bg-success-soft text-success-soft-foreground">
                            separado
                          </Badge>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label={`${aberta ? "Esconder" : "Mostrar"} itens de ${nome}`}
                            aria-expanded={aberta}
                            onClick={() =>
                              setAbertas((atuais) => {
                                const proximas = new Set(atuais);
                                if (proximas.has(grupo.posicao)) proximas.delete(grupo.posicao);
                                else proximas.add(grupo.posicao);
                                return proximas;
                              })
                            }
                          >
                            {aberta ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                          </Button>
                        </>
                      ) : (
                        <span className="font-semibold tabular-nums">{doGrupo.texto}</span>
                      )}
                    </span>
                  </h2>
                  {aberta ? (
                    <ul>
                      {grupo.linhas.map((linha) => (
                        <Linha
                          key={linha.id}
                          linha={linha}
                          foto={fotoDe?.(linha.item)}
                          principal={linha.id === primeira}
                          operador={operador && !fechada}
                          ocupada={ocupadas?.has(linha.id) ?? false}
                          caixas={caixasDaLinha?.get(linha.id)}
                          onSeparar={onSeparar}
                          onDesfazer={onDesfazer}
                          onSepararMenos={onSepararMenos}
                          onOutraCaixa={onOutraCaixa && comOutraCaixa?.has(linha.id) ? onOutraCaixa : undefined}
                        />
                      ))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </div>
          {etiquetas?.length ? <EtiquetasParaTrocar etiquetas={etiquetas} href={etiquetasHref ?? null} /> : null}
          </div>
        </>
      )}
    </div>
  );
}

/** "Etiquetas para trocar": as caixas abertas do pedido, com a prateleira e o saldo, e "Imprimir". */
function EtiquetasParaTrocar({ etiquetas, href }: { etiquetas: readonly EtiquetaParaTrocar[]; href: string | null }) {
  const [todas, setTodas] = useState(false);
  const visiveis = todas ? etiquetas : etiquetas.slice(0, ETIQUETAS_A_VISTA);
  return (
    <section aria-labelledby="etiquetas-para-trocar" className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 id="etiquetas-para-trocar" className="text-sm font-bold text-foreground">
            Etiquetas para trocar
          </h2>
          <p className="text-xs text-muted-foreground">{textoDasAbertas(etiquetas.length)}</p>
        </div>
        {href ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href}>
              <Printer className="size-4" aria-hidden="true" />
              Imprimir
            </Link>
          </Button>
        ) : null}
      </div>
      <ul>
        {visiveis.map((etiqueta) => (
          <li key={etiqueta.code} className="border-t border-border/60 px-4 py-2.5">
            <p className="font-mono text-sm font-bold text-foreground">{etiqueta.code}</p>
            <p className="text-xs text-muted-foreground">{textoDaEtiqueta(etiqueta)}</p>
          </li>
        ))}
      </ul>
      {!todas && etiquetas.length > ETIQUETAS_A_VISTA ? (
        <div className="border-t border-border/60 px-4 py-2">
          <Button type="button" variant="link" className="h-auto px-0" onClick={() => setTodas(true)}>
            Ver as {etiquetas.length} caixas
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function Linha({
  linha,
  foto,
  principal,
  operador,
  ocupada,
  caixas,
  onSeparar,
  onDesfazer,
  onSepararMenos,
  onOutraCaixa,
}: {
  linha: LinhaDaLista;
  foto?: string;
  principal: boolean;
  operador: boolean;
  ocupada: boolean;
  /** De qual caixa a linha sai (ou saiu); undefined sem a leitura das caixas. */
  caixas?: readonly CaixaDaLinha[];
  onSeparar: (linha: LinhaDaLista) => void;
  onDesfazer: (linha: LinhaDaLista) => void;
  onSepararMenos: (linha: LinhaDaLista) => void;
  /** Só na linha com caixa na prateleira para escolher. */
  onOutraCaixa?: (linha: LinhaDaLista) => void;
}) {
  const estado = estadoDaLinha(linha.item);
  const pendente = estado === "pendente";
  return (
    <li className={cn("flex flex-col gap-2.5 border-t border-border/50 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-3 md:px-5", !pendente && "bg-muted/30")}>
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-1.5 sm:flex-nowrap sm:items-center">
        {foto ? (
          <img src={foto} alt="" loading="lazy" className="size-11 shrink-0 rounded-lg bg-muted object-cover" />
        ) : (
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
            <Package className="size-4" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {linha.nome ? <p className="font-semibold leading-snug text-foreground sm:truncate">{linha.nome}</p> : null}
          {linha.codigos ? <p className="truncate text-xs text-muted-foreground">{linha.codigos}</p> : null}
          {/* De qual caixa a linha por separar sai: a mais antiga, e a seguinte completa. */}
          {pendente && caixas?.length ? (
            <p className="flex flex-wrap items-center gap-1.5 pt-1">
              {caixas.map((caixa) => (
                <span key={caixa.box_code} className="contents">
                  <span className="whitespace-nowrap rounded-md bg-info-soft px-1.5 py-0.5 font-mono text-xs font-medium text-info-soft-foreground">{textoDaCaixa(caixa)}</span>
                  {caixa.esvazia ? <span className="rounded-md bg-warning-soft px-1.5 py-0.5 text-xs font-bold text-warning-soft-foreground">esvazia</span> : null}
                </span>
              ))}
            </p>
          ) : null}
          {/* Sem a leitura das caixas, ficam os códigos das caixas da prateleira (parte 1). */}
          {pendente && !caixas && linha.caixas.length ? (
            <p className="flex flex-wrap gap-1.5 pt-1">
              {linha.caixas.map((caixa) => (
                <span key={caixa} className="whitespace-nowrap rounded-md bg-info-soft px-1.5 py-0.5 font-mono text-xs font-medium text-info-soft-foreground">
                  {caixa}
                </span>
              ))}
            </p>
          ) : null}
          {estado === "com_diferenca" ? (
            <p className="pt-1">
              <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
                {textoDaDiferenca(linha.item)}
              </Badge>
            </p>
          ) : null}
        </div>
        {/* De onde a linha separada saiu: ao lado no computador, embaixo no celular. */}
        {!pendente && caixas?.length ? (
          <p className="order-last flex basis-full flex-wrap gap-1.5 pl-14 sm:order-none sm:basis-auto sm:flex-nowrap sm:pl-0">
            {caixas.map((caixa) => (
              <span key={caixa.box_code} className="whitespace-nowrap rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">
                {textoDaCaixa(caixa)}
              </span>
            ))}
          </p>
        ) : null}
        <span className="whitespace-nowrap font-semibold tabular-nums">{numero.format(linha.quantidade)} un.</span>
      </div>
      {operador ? (
        pendente ? (
          <div className="flex items-center gap-2 sm:shrink-0">
            <Button type="button" variant={principal ? "default" : "outline"} className="flex-1 sm:flex-none" disabled={ocupada} onClick={() => onSeparar(linha)}>
              Separar
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="icon" disabled={ocupada} aria-label={`Mais ações de ${linha.nome || linha.codigos}`}>
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onOutraCaixa ? <DropdownMenuItem onSelect={() => onOutraCaixa(linha)}>Outra caixa</DropdownMenuItem> : null}
                <DropdownMenuItem onSelect={() => onSepararMenos(linha)}>Separar menos</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <Button type="button" variant="link" className="h-auto self-start px-0 sm:shrink-0 sm:self-center" disabled={ocupada} onClick={() => onDesfazer(linha)}>
            Desfazer
          </Button>
        )
      ) : null}
    </li>
  );
}
