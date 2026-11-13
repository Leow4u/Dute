import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, MoreHorizontal, Package, Printer } from "lucide-react";
import { Link } from "wouter";

import { Badge } from "@/components/ui/badge";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { SaiComOFoco, useFocoQueSegue } from "@/lib/carregando/use-foco-que-segue";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  nomeDoVolume,
  pesoDigitado,
  textoDoAberto,
  textoDoVolume,
  textoDosFechados,
  textoVerVolumes,
  volumeAberto,
  volumesDaLinha,
  volumesFechados,
  type VolumeDoPedido,
} from "@/lib/warehouse-ops/volumes-do-pedido";

/**
 * Pedidos › Separar, a bancada do pedido (separação com caixas, partes 2 e 5;
 * docs/mockups/WmsSepararBancada.dc.html e WmsSepararCelular.dc.html): o
 * progresso salvo, as linhas por prateleira na ordem de caminhada com
 * "Separar", "Desfazer" e "Separar menos", e "Concluir separação". A linha
 * por separar diz de qual caixa o sistema vai tirar ("12 de CX-000027",
 * "esvazia", "CX-000029 inteira"), a separada diz de onde saiu, e "Outra
 * caixa" corrige (parte 3b). "Etiquetas para trocar" lista as caixas que o
 * pedido abriu, até a etiqueta com o saldo ser impressa (parte 3d). Os
 * volumes (parte 4): a linha separada entra no volume aberto e diz em qual
 * está ("Volume 12"); "Fechar volume" fecha com o peso, opcional, e o
 * seguinte abre sozinho; "Levar a caixa" faz da caixa que sai inteira o
 * volume. "Dividir em volumes" (parte 7b, decisões 27 a 30;
 * docs/mockups/WmsDividirBancada.dc.html e WmsDividirNaSeparada.dc.html) é
 * o primeiro item do "⋯" da linha por separar e um botão na linha já
 * separada que ainda está no volume aberto. Os dados e as ações chegam por
 * props (pages/pedidos-separar.tsx). Sem legenda.
 */

/** Quantas caixas "Etiquetas para trocar" lista antes de "Ver as N caixas". */
const ETIQUETAS_A_VISTA = 5;

/** Quantos volumes fechados a bancada lista antes de "Ver os N volumes". */
const VOLUMES_A_VISTA = 2;

/** Mais do que isso de etiquetas (caixas e volumes) na linha separada, e elas vão embaixo dos códigos. */
const ETIQUETAS_AO_LADO = 2;

export type EstadoDaBancada = "carregando" | "nao_encontrado" | "erro" | "concluida" | "pronto";

/** Um item do "⋯" da linha por separar. */
export type AcaoDoMenu = { acao: "dividir" | "outra" | "menos"; rotulo: string };

/**
 * O "⋯" da linha por separar: "Dividir em volumes" primeiro, na linha de 2
 * un. ou mais (parte 7b), "Outra caixa", na linha com caixa da prateleira
 * para escolher, e "Separar menos". Quem só consulta, e a separação que já
 * fechou, não têm o "⋯".
 */
export function acoesDoMenu(
  linha: Pick<LinhaDaLista, "quantidade" | "item">,
  { operador, dividir, outraCaixa }: { operador: boolean; dividir: boolean; outraCaixa: boolean },
): AcaoDoMenu[] {
  if (!operador || estadoDaLinha(linha.item) !== "pendente") return [];
  return [
    ...(dividir && linha.quantidade >= 2 ? [{ acao: "dividir" as const, rotulo: "Dividir em volumes" }] : []),
    ...(outraCaixa ? [{ acao: "outra" as const, rotulo: "Outra caixa" }] : []),
    { acao: "menos", rotulo: "Separar menos" },
  ];
}

const MENSAGENS: Record<Exclude<EstadoDaBancada, "pronto">, string> = {
  carregando: "Carregando o pedido…",
  nao_encontrado: "Pedido não encontrado",
  erro: "Não foi possível carregar o pedido.",
  concluida: "Separação concluída",
};

const numero = new Intl.NumberFormat("pt-BR");

/** Sem a tela que leva o foco (o teste da linha sozinha), o pedido não vai a lugar nenhum. */
const semFoco = { current: null as readonly string[] | null };

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
  volumes,
  caixasInteiras,
  fechandoVolume = false,
  etiquetaDoVolumeHref,
  paraDividir,
  fotoDe,
  onSeparar,
  onDesfazer,
  onSepararMenos,
  onOutraCaixa,
  onLevarACaixa,
  onDividir,
  onFecharVolume,
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
  /**
   * As linhas com uma gravação em curso; no mapa, com a ação de cada uma
   * ("separar", "levar", "desfazer"), que mostra a espera no botão dela.
   */
  ocupadas?: ReadonlySet<string> | ReadonlyMap<string, string>;
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
  /** Os volumes do pedido (parte 4): os fechados e o aberto. Sem a leitura, a bancada não os mostra. */
  volumes?: readonly VolumeDoPedido[];
  /** Quantas caixas saem inteiras em cada linha por separar: essas linhas ganham "Levar a caixa". */
  caixasInteiras?: ReadonlyMap<string, number>;
  /** Um volume está sendo fechado. */
  fechandoVolume?: boolean;
  /** A etiqueta de um volume fechado. */
  etiquetaDoVolumeHref?: (volume: VolumeDoPedido) => string | null;
  /**
   * As linhas já separadas que ainda têm 2 un. ou mais no volume aberto:
   * ganham "Dividir em volumes" ao lado de "Desfazer" (decisão 30).
   */
  paraDividir?: ReadonlySet<string>;
  fotoDe?: (item: WarehouseTaskItem) => string | undefined;
  onSeparar: (linha: LinhaDaLista) => void;
  onDesfazer: (linha: LinhaDaLista) => void;
  onSepararMenos: (linha: LinhaDaLista) => void;
  onOutraCaixa?: (linha: LinhaDaLista) => void;
  /** "Levar a caixa": a caixa que sai inteira vira o volume, sem reembalar. */
  onLevarACaixa?: (linha: LinhaDaLista) => void;
  /**
   * "Dividir em volumes" (parte 7b): na linha por separar, pelo "⋯", e na já
   * separada de `paraDividir`. Sem ela (os volumes ainda não chegaram), a
   * bancada não oferece a divisão.
   */
  onDividir?: (linha: LinhaDaLista) => void;
  /** "Fechar volume": com o peso, opcional. */
  onFecharVolume?: (volume: VolumeDoPedido, pesoKg?: number) => void;
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
  // A linha que muda de estado tira o botão tocado da tela ("Separar" vira "Desfazer"): o foco vai ao botão que entra
  // no lugar, nunca ao body (carregamento v2, parte 13c).
  const focoQueSegue = useFocoQueSegue();
  const aberto = volumes ? volumeAberto(volumes) : null;
  // Quem só consulta, ou o pedido que já fechou a separação, não fecha volume.
  const fecharVolume = operador && !fechada ? onFecharVolume : undefined;
  const comLateral = Boolean(volumes) || Boolean(etiquetas?.length);

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

{/* A primeira leitura é a espera em bloco do carregamento v2 (parte 13c): nada antes de 300 ms, a caixa e o rótulo,
          com o anúncio pelo Anunciador, no lugar do "Carregando" seco. */}
      {estado === "carregando" ? (
        <CarregandoNaRegiao rotulo={MENSAGENS.carregando} className="rounded-lg border border-border bg-card px-5 py-6" />
      ) : mensagem ? (
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
          {/* No celular, o volume aberto vem em cima, numa linha; o peso fica no computador. */}
          {aberto ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 lg:hidden">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">{nomeDoVolume(aberto.numero)}</p>
                <p className="text-xs text-muted-foreground">{textoDoAberto(aberto)}</p>
              </div>
              {fecharVolume ? (
                <BotaoDeAcao
                  variant="outline"
                  estado={fechandoVolume ? "andamento" : "repouso"}
                  rotulo="Fechar volume"
                  andamento="Fechando…"
                  bloqueado={!fechandoVolume && (!aberto.id || aberto.unidades <= 0)}
                  onClick={() => fecharVolume(aberto)}
                />
              ) : null}
            </div>
          ) : null}
          {diferenca ? (
            <p className="rounded-lg border border-warning-soft-border bg-warning-soft px-4 py-2.5 text-sm font-semibold text-warning-soft-foreground">{diferenca}</p>
          ) : null}

          <div className={cn(comLateral && "grid gap-5 lg:grid-cols-[minmax(0,1fr)_372px] lg:items-start")}>
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
                          acao={ocupadas && "get" in ocupadas ? ocupadas.get(linha.id) : undefined}
                          focoQueSegue={focoQueSegue}
                          caixas={caixasDaLinha?.get(linha.id)}
                          volumes={volumes ? volumesDaLinha(linha.item, volumes) : undefined}
                          inteiras={caixasInteiras?.get(linha.id) ?? 0}
                          dividirASeparada={paraDividir?.has(linha.id) ?? false}
                          onSeparar={onSeparar}
                          onDesfazer={onDesfazer}
                          onSepararMenos={onSepararMenos}
                          onOutraCaixa={onOutraCaixa && comOutraCaixa?.has(linha.id) ? onOutraCaixa : undefined}
                          onLevarACaixa={onLevarACaixa}
                          onDividir={onDividir}
                        />
                      ))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </div>
          {comLateral ? (
            <div className="flex flex-col gap-5 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
              {volumes && aberto ? (
                <Volumes
                  // O peso digitado é do volume aberto de agora: o seguinte começa em branco.
                  key={aberto.id || `seguinte-${aberto.numero}`}
                  volumes={volumes}
                  aberto={aberto}
                  fechando={fechandoVolume}
                  etiquetaHref={etiquetaDoVolumeHref}
                  onFechar={fecharVolume}
                />
              ) : null}
              {etiquetas?.length ? <EtiquetasParaTrocar etiquetas={etiquetas} href={etiquetasHref ?? null} /> : null}
            </div>
          ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * "Volumes": o volume aberto, com o que já tem, o peso e "Fechar volume", e
 * os fechados, do mais recente ao mais antigo, com a etiqueta de cada um.
 */
function Volumes({
  volumes,
  aberto,
  fechando,
  etiquetaHref,
  onFechar,
}: {
  volumes: readonly VolumeDoPedido[];
  aberto: VolumeDoPedido;
  fechando: boolean;
  etiquetaHref?: (volume: VolumeDoPedido) => string | null;
  /** Sem ela (quem só consulta), o volume aberto não tem peso nem botão. */
  onFechar?: (volume: VolumeDoPedido, pesoKg?: number) => void;
}) {
  const [todos, setTodos] = useState(false);
  const [peso, setPeso] = useState("");
  const pesoLido = pesoDigitado(peso);
  const fechados = volumesFechados(volumes);
  const visiveis = todos ? fechados : fechados.slice(0, VOLUMES_A_VISTA);
  const contagem = textoDosFechados(fechados.length);
  return (
    <section aria-labelledby="volumes-do-pedido" className="flex flex-col gap-3">
      <h2 id="volumes-do-pedido" className="flex items-baseline gap-2 text-base font-extrabold text-foreground">
        Volumes
        {contagem ? <span className="text-sm font-semibold text-muted-foreground">{contagem}</span> : null}
      </h2>
      {/* O volume aberto com o peso só no computador; no celular ele vai em cima da lista. */}
      <div className="hidden flex-col gap-2.5 rounded-lg border border-foreground bg-card px-4 py-3.5 lg:flex">
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-foreground">
          {nomeDoVolume(aberto.numero)}
          <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
            aberto
          </Badge>
        </h3>
        {aberto.itens.length ? (
          <ul className="flex flex-col gap-1 text-sm text-foreground">
            {aberto.itens.map((item) => (
              <li key={`${item.codigo}-${item.nome}`}>
                <b className="font-bold tabular-nums">{numero.format(item.quantidade)} ×</b> {item.nome}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="flex justify-between border-t border-border pt-2 text-sm font-extrabold text-foreground">
          <span>No volume</span>
          <span className="tabular-nums">{numero.format(aberto.unidades)} un.</span>
        </p>
        {onFechar ? (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="peso-do-volume">Peso (kg)</Label>
              <Input id="peso-do-volume" inputMode="decimal" value={peso} maxLength={8} aria-invalid={pesoLido === null || undefined} onChange={(event) => setPeso(event.target.value)} />
            </div>
            <BotaoDeAcao
              variant="outline"
              estado={fechando ? "andamento" : "repouso"}
              rotulo="Fechar volume"
              andamento="Fechando…"
              bloqueado={!fechando && (!aberto.id || aberto.unidades <= 0 || pesoLido === null)}
              onClick={() => onFechar(aberto, pesoLido ?? undefined)}
            />
          </>
        ) : null}
      </div>
      {fechados.length ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <ul>
            {visiveis.map((volume) => {
              const href = etiquetaHref?.(volume) ?? null;
              return (
                <li key={volume.id} className="flex items-center gap-3 border-t border-border/60 px-4 py-2.5 first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-foreground">{nomeDoVolume(volume.numero)}</p>
                    <p className="text-xs text-muted-foreground">{textoDoVolume(volume)}</p>
                  </div>
                  {href ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={href} aria-label={`Etiqueta do volume ${volume.numero}`}>
                        Etiqueta
                      </Link>
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!todos && fechados.length > VOLUMES_A_VISTA ? (
            <div className="border-t border-border/60 px-4 py-2">
              <Button type="button" variant="link" className="h-auto px-0" onClick={() => setTodos(true)}>
                {textoVerVolumes(fechados.length)}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
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

/** De onde a linha separada saiu e em quais volumes está: as caixas, e depois os volumes. */
function EtiquetasDaLinha({ caixas, volumes }: { caixas?: readonly CaixaDaLinha[]; volumes?: readonly string[] }) {
  return (
    <>
      {caixas?.map((caixa) => (
        <span key={caixa.box_code} className="whitespace-nowrap rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">
          {textoDaCaixa(caixa)}
        </span>
      ))}
      {volumes?.map((volume) => (
        <Badge key={volume} variant="outline" className="whitespace-nowrap border-success-soft-border bg-success-soft text-success-soft-foreground">
          {volume}
        </Badge>
      ))}
    </>
  );
}

function Linha({
  linha,
  foto,
  principal,
  operador,
  ocupada,
  acao,
  focoQueSegue,
  caixas,
  volumes,
  inteiras,
  dividirASeparada,
  onSeparar,
  onDesfazer,
  onSepararMenos,
  onOutraCaixa,
  onLevarACaixa,
  onDividir,
}: {
  linha: LinhaDaLista;
  foto?: string;
  principal: boolean;
  operador: boolean;
  ocupada: boolean;
  /** A ação da linha em curso ("separar", "levar", "desfazer"): o botão dela mostra a espera. */
  acao?: string;
  /** O foco que segue o botão que entra no lugar quando a linha muda de estado. */
  focoQueSegue?: ReturnType<typeof useFocoQueSegue>;
  /** De qual caixa a linha sai (ou saiu); undefined sem a leitura das caixas. */
  caixas?: readonly CaixaDaLinha[];
  /** Em quais volumes a linha separada está: "Volume 12". */
  volumes?: readonly string[];
  /** Quantas caixas saem inteiras nesta linha: com alguma, "Levar a caixa". */
  inteiras: number;
  /** A linha separada que ainda tem 2 un. ou mais no volume aberto: "Dividir em volumes" ao lado de "Desfazer". */
  dividirASeparada: boolean;
  onSeparar: (linha: LinhaDaLista) => void;
  onDesfazer: (linha: LinhaDaLista) => void;
  onSepararMenos: (linha: LinhaDaLista) => void;
  /** Só na linha com caixa na prateleira para escolher. */
  onOutraCaixa?: (linha: LinhaDaLista) => void;
  onLevarACaixa?: (linha: LinhaDaLista) => void;
  onDividir?: (linha: LinhaDaLista) => void;
}) {
  const estado = estadoDaLinha(linha.item);
  const pendente = estado === "pendente";
  const etiquetas = pendente ? 0 : (caixas?.length ?? 0) + (volumes?.length ?? 0);
  // Com mais de duas etiquetas (caixas e volumes), elas vão embaixo dos códigos, como as caixas da linha por separar.
  const embaixo = etiquetas > ETIQUETAS_AO_LADO;
  const menu = acoesDoMenu(linha, { operador, dividir: Boolean(onDividir), outraCaixa: Boolean(onOutraCaixa) });
  const escolher = (acao: AcaoDoMenu["acao"]) => {
    if (acao === "dividir") onDividir?.(linha);
    else if (acao === "outra") onOutraCaixa?.(linha);
    else onSepararMenos(linha);
  };
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
          {/* O selo é um bloco: a fileira embaixo dos códigos é um div, não um parágrafo. */}
          {embaixo ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <EtiquetasDaLinha caixas={caixas} volumes={volumes} />
            </div>
          ) : null}
          {estado === "com_diferenca" ? (
            <div className="pt-1">
              <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
                {textoDaDiferenca(linha.item)}
              </Badge>
            </div>
          ) : null}
        </div>
        {/* De onde a linha separada saiu e em qual volume está: até duas, ao lado no computador e embaixo no celular. */}
        {etiquetas > 0 && !embaixo ? (
          // O selo é um bloco: dentro de um parágrafo, o navegador o poria para fora.
          <div className="order-last flex basis-full flex-wrap items-center gap-1.5 pl-14 sm:order-none sm:basis-auto sm:flex-nowrap sm:pl-0">
            <EtiquetasDaLinha caixas={caixas} volumes={volumes} />
          </div>
        ) : null}
        <span className="whitespace-nowrap font-semibold tabular-nums">{numero.format(linha.quantidade)} un.</span>
      </div>
      {operador ? (
        pendente ? (
          <SaiComOFoco alvo={`desfazer-${linha.id}`} pedido={focoQueSegue ?? semFoco}>
          <div className="flex items-center gap-2 sm:shrink-0">
            {/* A caixa que sai inteira pode virar o volume, sem reembalar. Ocupado não é desabilitado: o botão tocado
                mostra a espera, com o gerúndio, e o foco fica nele; o outro espera com aria-disabled (parte 13c). */}
            {onLevarACaixa && inteiras > 0 ? (
              <BotaoDeAcao
                variant="outline"
                className="flex-1 sm:flex-none"
                estado={acao === "levar" ? "andamento" : "repouso"}
                rotulo={inteiras === 1 ? "Levar a caixa" : "Levar as caixas"}
                andamento="Levando…"
                bloqueado={ocupada && acao !== "levar"}
                onClick={() => onLevarACaixa(linha)}
              />
            ) : null}
            <BotaoDeAcao
              id={`separar-${linha.id}`}
              variant={principal ? "default" : "outline"}
              className="flex-1 sm:flex-none"
              estado={acao === "separar" ? "andamento" : "repouso"}
              rotulo="Separar"
              andamento="Separando…"
              bloqueado={ocupada && acao !== "separar"}
              onClick={() => onSeparar(linha)}
            />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="icon" disabled={ocupada} aria-label={`Mais ações de ${linha.nome || linha.codigos}`}>
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {menu.map((item) => (
                  <DropdownMenuItem key={item.acao} onSelect={() => escolher(item.acao)}>
                    {item.rotulo}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          </SaiComOFoco>
        ) : (
          <div className="flex items-center gap-3 self-start sm:shrink-0 sm:self-center">
            {/* Enquanto o que a linha pôs está no volume aberto, ela ainda se divide (decisão 30); no celular, com 44 px. */}
            {onDividir && dividirASeparada ? (
              <Button type="button" variant="outline" size="sm" className="min-h-11 lg:min-h-9" disabled={ocupada} onClick={() => onDividir(linha)}>
                Dividir em volumes
              </Button>
            ) : null}
            <SaiComOFoco alvo={`separar-${linha.id}`} pedido={focoQueSegue ?? semFoco}>
              <BotaoDeAcao
                id={`desfazer-${linha.id}`}
                variant="link"
                className="h-auto px-0"
                estado={acao === "desfazer" ? "andamento" : "repouso"}
                rotulo="Desfazer"
                andamento="Desfazendo…"
                bloqueado={ocupada && acao !== "desfazer"}
                onClick={() => onDesfazer(linha)}
              />
            </SaiComOFoco>
          </div>
        )
      ) : null}
    </li>
  );
}
