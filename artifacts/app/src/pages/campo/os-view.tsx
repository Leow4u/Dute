import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, Camera, Check, ChevronDown, Clock, Minus, Plus, Search } from "lucide-react";

import { Avatar, COR_DO_STATUS, ROTULO_DO_STATUS, selo, seloAlerta } from "@/components/operacao/partes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { conclusaoGuardada, problemaParaConcluir } from "@/lib/campo/concluir";
import type { NovoRegistro, RegistroNaFila } from "@/lib/campo/fila";
import { ROTA_CAMPO, hrefDaConclusaoNoCampo } from "@/lib/campo/navegacao";
import { useToqueUnico } from "@/lib/campo/toque-unico";
import {
  acaoDaEtapa,
  duracaoDesde,
  equipeNoCampo,
  etapasNoCampo,
  feitoDepoisDoToque,
  inclusoesGuardadas,
  itensNoCampo,
  problemasDaInclusao,
  quantidadeEmTexto,
  registroDeEtapa,
  registroDeFeito,
  registroDeInclusao,
  registroDeOcorrencia,
  registroDePresenca,
  type InclusaoGuardada,
  type InclusaoNoCampo,
  type ItemNoCampo,
} from "@/lib/campo/os-no-campo";
import { buscarNoCatalogo, type ItemDoCatalogo } from "@/lib/operacao/demanda-direta";
import { ETAPA_ROTULO, horaDe, type EtapaDaOs, type FichaDaOs } from "@/lib/operacao/ficha-da-os";
import { cn } from "@/lib/utils";

/**
 * Campo › OS em execução (parte 3.8b; docs/mockups/Campo2Execucao.dc.html e
 * Campo2IncluirItem.dc.html): as etapas com a próxima em destaque, os itens
 * com + e −, a inclusão além do planejado, a presença da equipe, as fotos e a
 * ocorrência. Cada toque vira um registro na fila (onRegistrar), com o
 * instante do toque; o que ainda está na fila aparece como guardado, e a
 * inclusão guardada de um item que a OS não tem, como linha nova com o
 * relógio, sem + e − (pergunta 65). Sem legenda e sem valor.
 */

export type EstadoDaOsNoCampo = "carregando" | "erro" | "nao_encontrada" | "pronto";

/** O que acompanha a foto: a etapa em curso, a linha ou a legenda (da inclusão e da ocorrência). */
export type ExtraDaFoto = { etapa?: EtapaDaOs | null; linha?: string | null; legenda?: string | null };

export function Cartao({ titulo, children, acao }: { titulo: string; children: ReactNode; acao?: ReactNode }) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

export function BotaoDeFoto({ rotulo, onFotos, variante = "outline" }: { rotulo: string; onFotos: (arquivos: File[]) => void; variante?: "outline" | "primario" }) {
  return (
    <label
      className={cn(
        "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold focus-within:ring-2 focus-within:ring-ring/40",
        variante === "primario" ? "bg-primary text-primary-foreground hover:bg-primary-hover" : "border border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      <Camera aria-hidden="true" className="size-4" />
      {rotulo}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        multiple
        className="sr-only"
        onChange={(event) => {
          onFotos(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </label>
  );
}

function Etapas({ ficha, pendentes, recebe, onRegistrar, agora }: { ficha: FichaDaOs; pendentes: readonly RegistroNaFila[]; recebe: boolean; onRegistrar: (novo: NovoRegistro) => void; agora: () => Date }) {
  const [outras, setOutras] = useState(false);
  const tocar = useToqueUnico(agora);
  const { etapas, proxima, outras: restantes } = etapasNoCampo(ficha, pendentes);
  return (
    <Cartao titulo="Etapas">
      <ol className="flex flex-col">
        {etapas.map((etapa, indice) => (
          <li key={etapa.etapa} className="flex items-center gap-3 py-1.5">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                etapa.estado === "feita"
                  ? "bg-success-soft text-success-soft-foreground"
                  : etapa.estado === "guardada"
                    ? "bg-amber-soft text-amber-soft-foreground"
                    : etapa.etapa === proxima
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground",
              )}
            >
              {etapa.estado === "feita" ? <Check className="size-4" /> : etapa.estado === "guardada" ? <Clock className="size-4" /> : etapa.estado === "pulada" ? "—" : indice + 1}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn("text-sm font-semibold", etapa.estado === "pendente" || etapa.estado === "pulada" ? "text-muted-foreground" : "text-foreground")}>{etapa.rotulo}</span>
              {etapa.hora ? (
                <span className="text-xs text-muted-foreground">
                  {etapa.hora}
                  {etapa.estado === "guardada" ? " · guardada" : null}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      {recebe && proxima ? (
        <div className="flex flex-col gap-2">
          <Button type="button" size="lg" className="w-full" onClick={() => tocar("etapa", () => onRegistrar(registroDeEtapa(ficha, proxima, agora())))}>
            {acaoDaEtapa(proxima)}
          </Button>
          {restantes.length ? (
            <>
              <Button type="button" variant="ghost" size="sm" aria-expanded={outras} onClick={() => setOutras(!outras)} className="self-center">
                Outra etapa
                <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", outras ? "rotate-180" : null)} />
              </Button>
              {outras ? (
                <div className="flex flex-col gap-2">
                  {restantes.map((etapa) => (
                    <Button
                      key={etapa}
                      type="button"
                      variant="outline"
                      onClick={() =>
                        tocar("etapa", () => {
                          setOutras(false);
                          onRegistrar(registroDeEtapa(ficha, etapa, agora()));
                        })
                      }
                    >
                      {acaoDaEtapa(etapa)}
                    </Button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </Cartao>
  );
}

function Itens({
  ficha,
  itens,
  guardadas,
  emExecucao,
  onRegistrar,
  onIncluir,
  agora,
}: {
  ficha: FichaDaOs;
  itens: readonly ItemNoCampo[];
  guardadas: readonly InclusaoGuardada[];
  emExecucao: boolean;
  onRegistrar: (novo: NovoRegistro) => void;
  onIncluir: (linha: string | null) => void;
  agora: () => Date;
}) {
  return (
    <Cartao titulo={`Itens · ${itens.length + guardadas.length}`}>
      {!emExecucao ? <p className="text-sm text-muted-foreground">Registre a primeira etapa antes dos itens.</p> : null}
      <ul className="flex flex-col divide-y divide-border">
        {itens.map((item) => {
          const cheio = item.feito >= item.previsto;
          return (
            <li key={item.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs text-muted-foreground">{[item.codigo, item.servico].filter(Boolean).join(" · ")}</span>
                  <span className="text-sm font-semibold text-foreground">{item.item}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-11"
                    aria-label={`Menos um: ${item.item}`}
                    disabled={!emExecucao || item.feito <= 0}
                    onClick={() => onRegistrar(registroDeFeito(ficha, item, feitoDepoisDoToque(item, -1), agora()))}
                  >
                    <Minus aria-hidden="true" className="size-5" />
                  </Button>
                  <span className="flex w-16 flex-col items-center">
                    <span className="text-lg font-bold tabular-nums text-foreground">{quantidadeEmTexto(item.feito)}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      de {quantidadeEmTexto(item.previsto)}
                      {item.unidade ? ` ${item.unidade}` : ""}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-11"
                    aria-label={`Mais um: ${item.item}`}
                    disabled={!emExecucao || cheio}
                    onClick={() => onRegistrar(registroDeFeito(ficha, item, feitoDepoisDoToque(item, 1), agora()))}
                  >
                    <Plus aria-hidden="true" className="size-5" />
                  </Button>
                </span>
              </div>
              {emExecucao && cheio && item.previsto > 0 ? (
                <button type="button" onClick={() => onIncluir(item.id)} className="self-end rounded text-sm font-semibold text-primary underline-offset-4 hover:underline">
                  Além do planejado · Incluir
                </button>
              ) : null}
              {item.guardado ? <span className="self-end text-xs text-muted-foreground">guardado</span> : null}
            </li>
          );
        })}
        {guardadas.map((linha) => (
          <li key={linha.chave} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex min-w-0 flex-1 flex-col">
              {linha.detalhe ? <span className="text-xs text-muted-foreground">{linha.detalhe}</span> : null}
              <span className="text-sm font-semibold text-foreground">{linha.item}</span>
            </span>
            <span className="flex h-12 shrink-0 items-center gap-2 rounded-lg border border-dashed border-amber-soft-border bg-amber-soft px-3 text-amber-soft-foreground">
              <Clock aria-hidden="true" className="size-4" />
              <span className="flex flex-col leading-tight">
                <span className="text-base font-bold tabular-nums text-foreground">
                  {quantidadeEmTexto(linha.quantidade)}
                  {linha.unidade ? ` ${linha.unidade}` : ""}
                </span>
                <span className="text-xs font-semibold">guardada {linha.hora}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
      {emExecucao ? (
        <Button type="button" variant="outline" onClick={() => onIncluir(null)}>
          <Plus aria-hidden="true" className="size-4" />
          Incluir item executado
        </Button>
      ) : null}
    </Cartao>
  );
}

function Equipe({ ficha, pendentes, uid, recebe, onRegistrar, agora }: { ficha: FichaDaOs; pendentes: readonly RegistroNaFila[]; uid: string | null; recebe: boolean; onRegistrar: (novo: NovoRegistro) => void; agora: () => Date }) {
  const equipe = equipeNoCampo(ficha, pendentes, uid);
  const tocar = useToqueUnico(agora);
  return (
    <Cartao titulo={`Equipe no local · ${equipe.length}`}>
      <ul className="flex flex-col gap-3">
        {equipe.map((pessoa) => (
          <li key={pessoa.id} className="flex items-center gap-3">
            <Avatar nome={pessoa.nome} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold text-foreground">{pessoa.nome}</span>
              <span className="truncate text-xs text-muted-foreground">{[pessoa.detalhe, pessoa.entrada ? (pessoa.saida ? `${pessoa.entrada}–${pessoa.saida}` : `desde ${pessoa.entrada}`) : null].filter(Boolean).join(" · ")}</span>
            </span>
            {recebe && pessoa.podeMarcar && !pessoa.entrada ? (
              <Button type="button" size="sm" variant="outline" onClick={() => tocar(`presenca:${pessoa.id}`, () => onRegistrar(registroDePresenca(ficha, pessoa, "entrada", agora())))}>
                Entrada<span className="sr-only"> de {pessoa.nome}</span>
              </Button>
            ) : null}
            {recebe && pessoa.podeMarcar && pessoa.entrada && !pessoa.saida ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => tocar(`presenca:${pessoa.id}`, () => onRegistrar(registroDePresenca(ficha, pessoa, "saida", agora())))}>
                Saída<span className="sr-only"> de {pessoa.nome}</span>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Cartao>
  );
}

export function useUrlsGuardadas(pendentes: readonly RegistroNaFila[], numero: string): Array<{ chave: string; url: string }> {
  const fotos = useMemo(() => pendentes.filter((registro) => registro.foto && registro.dados.numero === numero), [pendentes, numero]);
  const [urls, setUrls] = useState<Array<{ chave: string; url: string }>>([]);
  useEffect(() => {
    const criadas = fotos.map((registro) => ({ chave: registro.chave, url: URL.createObjectURL(registro.foto!.arquivo) }));
    setUrls(criadas);
    return () => criadas.forEach((item) => URL.revokeObjectURL(item.url));
  }, [fotos]);
  return urls;
}

function Fotos({ ficha, urls, pendentes, recebe, onFotos }: { ficha: FichaDaOs; urls: Readonly<Record<string, string>>; pendentes: readonly RegistroNaFila[]; recebe: boolean; onFotos: (arquivos: File[]) => void }) {
  const guardadas = useUrlsGuardadas(pendentes, ficha.numero);
  const gravadas = [...ficha.fotos].sort((a, b) => b.instante.localeCompare(a.instante));
  return (
    <Cartao titulo={`Fotos · ${gravadas.length + guardadas.length}`}>
      <ul className="grid grid-cols-3 gap-2">
        {guardadas.map((foto) => (
          <li key={foto.chave} className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
            <img src={foto.url} alt="Foto guardada" className="size-full object-cover" />
            <span aria-hidden="true" className="absolute inset-x-1 bottom-1 rounded bg-background/90 px-1.5 py-0.5 text-center text-xs font-medium text-foreground">
              guardada
            </span>
          </li>
        ))}
        {gravadas.map((foto) => (
          <li key={foto.id} className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
            {urls[foto.caminho] ? <img src={urls[foto.caminho]} alt={foto.legenda ?? `Foto das ${horaDe(foto.instante)}`} className="size-full object-cover" loading="lazy" /> : <span className="sr-only">{foto.legenda ?? "Foto"}</span>}
            <span aria-hidden="true" className="absolute inset-x-1 bottom-1 truncate rounded bg-background/90 px-1.5 py-0.5 text-center text-xs font-medium text-foreground">
              {foto.legenda ?? horaDe(foto.instante)}
            </span>
          </li>
        ))}
      </ul>
      {recebe ? <BotaoDeFoto rotulo="Tirar foto" onFotos={onFotos} /> : null}
    </Cartao>
  );
}

const campoClasse = "flex h-11 w-full rounded-md border border-input bg-card px-3 text-base text-foreground";

function IncluirItem({
  ficha,
  linhaInicial,
  catalogo,
  onRegistrar,
  onFechar,
  agora,
}: {
  ficha: FichaDaOs;
  linhaInicial: string | null;
  catalogo: readonly ItemDoCatalogo[];
  onRegistrar: (novo: NovoRegistro) => void;
  onFechar: () => void;
  agora: () => Date;
}) {
  const id = useId();
  const linhaDaOs = ficha.itens.find((item) => item.id === linhaInicial);
  const [escolha, setEscolha] = useState<InclusaoNoCampo | null>(linhaDaOs ? { tipo: "linha", linha: linhaDaOs.id, nome: linhaDaOs.item } : null);
  const [busca, setBusca] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const contatos = [ficha.locais.origem?.contato?.nome, ficha.locais.destino?.contato?.nome].filter((nome, indice, todos): nome is string => Boolean(nome) && todos.indexOf(nome) === indice);
  const [pedidoPor, setPedidoPor] = useState(contatos[0] ?? "");
  const [outraPessoa, setOutraPessoa] = useState(!contatos.length);
  const [motivo, setMotivo] = useState("");
  const [tentou, setTentou] = useState(false);
  const problemas = problemasDaInclusao(escolha, quantidade, pedidoPor, motivo);
  const resultados = buscarNoCatalogo(catalogo, busca);
  const daOs = busca.trim() ? ficha.itens.filter((item) => item.item.toLocaleLowerCase("pt-BR").includes(busca.trim().toLocaleLowerCase("pt-BR"))) : ficha.itens;
  const numero = Number(quantidade.replace(",", "."));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setTentou(true);
        if (problemas.length || !escolha) return;
        onRegistrar(registroDeInclusao(ficha, escolha, quantidade, pedidoPor, motivo, agora()));
        onFechar();
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-busca`}>Buscar item</Label>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id={`${id}-busca`} type="search" className="h-11 pl-9 text-base" value={busca} onChange={(event) => setBusca(event.target.value)} />
        </div>
      </div>
      <div role="group" aria-label="Item" className="flex max-h-64 flex-col gap-2 overflow-y-auto">
        {daOs.map((item) => {
          const ativa = escolha?.tipo === "linha" && escolha.linha === item.id;
          return (
            <button key={item.id} type="button" aria-pressed={ativa} onClick={() => setEscolha({ tipo: "linha", linha: item.id, nome: item.item })} className={cn("flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left text-sm", ativa ? "border-foreground bg-muted" : "border-border")}>
              <span className="font-semibold text-foreground">{item.item}</span>
              <span className="text-xs text-muted-foreground">nesta OS</span>
            </button>
          );
        })}
        {resultados
          .filter((item) => !ficha.itens.some((linha) => linha.item === item.item))
          .map((item) => {
            const ativa = escolha?.tipo === "catalogo" && escolha.lpuItemId === item.id;
            return (
              <button key={item.id} type="button" aria-pressed={ativa} onClick={() => setEscolha({ tipo: "catalogo", lpuItemId: item.id, nome: item.item })} className={cn("flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left text-sm", ativa ? "border-foreground bg-muted" : "border-border")}>
                <span className="font-semibold text-foreground">{item.item}</span>
                <span className="text-xs text-muted-foreground">{[item.servico, item.unidade?.toLocaleLowerCase("pt-BR")].filter(Boolean).join(" · ")}</span>
              </button>
            );
          })}
        <button
          type="button"
          aria-pressed={escolha?.tipo === "avulso"}
          onClick={() => setEscolha({ tipo: "avulso", nome: busca.trim(), unidade: "UN" })}
          className={cn("rounded-md border border-dashed px-3 py-2.5 text-left text-sm font-semibold", escolha?.tipo === "avulso" ? "border-foreground bg-muted" : "border-border")}
        >
          Item avulso
        </button>
      </div>
      {escolha?.tipo === "avulso" ? (
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-nome`}>Nome do item</Label>
            <Input id={`${id}-nome`} className="h-11 text-base" value={escolha.nome} onChange={(event) => setEscolha({ ...escolha, nome: event.target.value })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-unidade`}>Unidade</Label>
            <Input id={`${id}-unidade`} className="h-11 text-base" value={escolha.unidade} onChange={(event) => setEscolha({ ...escolha, unidade: event.target.value })} />
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-quantidade`}>Quantidade</Label>
        <div className="flex items-center gap-2">
          <Button type="button" size="icon" variant="outline" className="size-11" aria-label="Diminuir quantidade" disabled={!(numero > 1)} onClick={() => setQuantidade(String(Math.max(1, Math.floor(numero) - 1)))}>
            <Minus aria-hidden="true" className="size-5" />
          </Button>
          <Input id={`${id}-quantidade`} inputMode="decimal" className="h-11 w-24 text-center text-lg font-bold tabular-nums" value={quantidade} onChange={(event) => setQuantidade(event.target.value)} />
          <Button type="button" size="icon" variant="outline" className="size-11" aria-label="Aumentar quantidade" onClick={() => setQuantidade(String((Number.isFinite(numero) ? Math.floor(numero) : 0) + 1))}>
            <Plus aria-hidden="true" className="size-5" />
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-pedido`}>Quem pediu no local</Label>
        {contatos.length && !outraPessoa ? (
          <select
            id={`${id}-pedido`}
            className={campoClasse}
            value={pedidoPor}
            onChange={(event) => {
              if (event.target.value === "") {
                setOutraPessoa(true);
                setPedidoPor("");
              } else setPedidoPor(event.target.value);
            }}
          >
            {contatos.map((nome) => (
              <option key={nome} value={nome}>
                {nome}
              </option>
            ))}
            <option value="">Outra pessoa</option>
          </select>
        ) : (
          <Input id={`${id}-pedido`} className="h-11 text-base" value={pedidoPor} onChange={(event) => setPedidoPor(event.target.value)} />
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-motivo`}>Motivo</Label>
        <Input id={`${id}-motivo`} className="h-11 text-base" value={motivo} onChange={(event) => setMotivo(event.target.value)} />
      </div>
      {tentou && problemas.length ? (
        <div role="alert">
          <ul className="flex flex-col gap-1 text-sm text-destructive">
            {problemas.map((problema) => (
              <li key={problema}>{problema}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" size="lg" onClick={onFechar}>
          Cancelar
        </Button>
        <Button type="submit" size="lg">
          Incluir item
        </Button>
      </div>
    </form>
  );
}

function Ocorrencia({ ficha, onRegistrar, onFotos, onFechar, agora }: { ficha: FichaDaOs; onRegistrar: (novo: NovoRegistro) => void; onFotos: (arquivos: File[], extra: ExtraDaFoto) => void; onFechar: () => void; agora: () => Date }) {
  const id = useId();
  const [descricao, setDescricao] = useState("");
  const [fotos, setFotos] = useState<File[]>([]);
  const [tentou, setTentou] = useState(false);
  const curta = descricao.trim().length < 3;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setTentou(true);
        if (curta) return;
        onRegistrar(registroDeOcorrencia(ficha, descricao, agora()));
        if (fotos.length) onFotos(fotos, { legenda: `Ocorrência: ${descricao.trim()}` });
        onFechar();
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-descricao`}>Descrição</Label>
        <textarea id={`${id}-descricao`} rows={4} className="w-full rounded-md border border-input bg-card px-3 py-2 text-base text-foreground" value={descricao} onChange={(event) => setDescricao(event.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <BotaoDeFoto rotulo={fotos.length ? `Fotos · ${fotos.length}` : "Tirar foto"} onFotos={(novas) => setFotos([...fotos, ...novas])} />
      </div>
      {tentou && curta ? (
        <p role="alert" className="text-sm text-destructive">
          Descreva a ocorrência.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" size="lg" onClick={onFechar}>
          Cancelar
        </Button>
        <Button type="submit" size="lg">
          Registrar
        </Button>
      </div>
    </form>
  );
}

export function CampoOsView({
  estado,
  numero,
  ficha,
  uid,
  pendentes,
  urls,
  catalogo,
  erroDasFotos,
  agora,
  onRegistrar,
  onFotos,
}: {
  estado: EstadoDaOsNoCampo;
  numero: string;
  ficha: FichaDaOs | null;
  uid: string | null;
  pendentes: readonly RegistroNaFila[];
  urls: Readonly<Record<string, string>>;
  catalogo: readonly ItemDoCatalogo[];
  erroDasFotos: string | null;
  /** O relógio do toque (instante do registro). */
  agora: () => Date;
  onRegistrar: (novo: NovoRegistro) => void;
  onFotos: (arquivos: File[], extra: ExtraDaFoto) => void;
}) {
  const [incluir, setIncluir] = useState<{ linha: string | null } | null>(null);
  const [ocorrencia, setOcorrencia] = useState(false);
  const voltar = (
    <Link href={ROTA_CAMPO} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft aria-hidden="true" className="size-4" />
      Minhas OS
    </Link>
  );
  if (estado !== "pronto" || !ficha) {
    return (
      <div className="flex flex-col gap-4">
        {voltar}
        <h1 className="text-2xl font-bold tracking-tight text-foreground">OS {numero}</h1>
        {estado === "carregando" ? <p className="text-sm text-muted-foreground">Carregando</p> : null}
        {estado === "erro" ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar a OS.
          </p>
        ) : null}
        {estado === "nao_encontrada" ? <p className="text-sm text-muted-foreground">OS {numero} não encontrada</p> : null}
      </div>
    );
  }
  // A conclusão guardada na fila fecha a OS no celular: nada mais se registra nela.
  const concluidaNaFila = Boolean(conclusaoGuardada(ficha, pendentes));
  const recebe = (ficha.status === "agendada" || ficha.status === "em_execucao") && !concluidaNaFila;
  const podeConcluir = problemaParaConcluir(ficha, pendentes, uid) === null;
  const etapas = etapasNoCampo(ficha, pendentes);
  const emExecucao = ficha.status === "em_execucao" || etapas.etapas.some((etapa) => etapa.estado === "guardada");
  const itens = itensNoCampo(ficha, pendentes);
  const guardadas = inclusoesGuardadas(ficha, pendentes, catalogo);
  const primeira = etapas.desde;
  const janela = ficha.janela?.inicio ? (ficha.janela.fim ? `${ficha.janela.inicio}–${ficha.janela.fim}` : ficha.janela.inicio) : null;
  const etapaEmCurso = [...etapas.etapas].reverse().find((etapa) => etapa.estado === "feita" || etapa.estado === "guardada")?.etapa ?? null;
  return (
    <div className="flex flex-col gap-4">
      {voltar}
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">OS {ficha.numero}</h1>
          <span className={cn(selo, COR_DO_STATUS[ficha.status])}>{ROTULO_DO_STATUS[ficha.status]}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {ficha.clienteNome ?? ficha.customerCode} · Demanda {ficha.demanda}
        </p>
      </header>
      {primeira || janela ? (
        <dl className="grid grid-cols-2 gap-2">
          {primeira ? (
            <div className="flex flex-col rounded-lg bg-muted px-3 py-2">
              <dt className="text-xs text-muted-foreground">
                {ETAPA_ROTULO.saida_patio} {horaDe(primeira)}
              </dt>
              <dd className="text-base font-bold tabular-nums text-foreground">{duracaoDesde(primeira, agora())}</dd>
            </div>
          ) : null}
          {janela ? (
            <div className="flex flex-col rounded-lg bg-muted px-3 py-2">
              <dt className="text-xs text-muted-foreground">Janela</dt>
              <dd className="text-base font-bold tabular-nums text-foreground">{janela}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {!recebe ? (
        <p className={cn(selo, seloAlerta, "h-auto self-start py-1.5 text-sm")}>{ficha.status === "cancelada" ? "OS cancelada" : concluidaNaFila ? "OS concluída · guardada" : "OS concluída"}</p>
      ) : null}

      <Etapas ficha={ficha} pendentes={pendentes} recebe={recebe} onRegistrar={onRegistrar} agora={agora} />
      <Itens ficha={ficha} itens={itens} guardadas={guardadas} emExecucao={recebe && emExecucao} onRegistrar={onRegistrar} onIncluir={(linha) => setIncluir({ linha })} agora={agora} />
      <Equipe ficha={ficha} pendentes={pendentes} uid={uid} recebe={recebe} onRegistrar={onRegistrar} agora={agora} />
      <Fotos ficha={ficha} urls={urls} pendentes={pendentes} recebe={recebe} onFotos={(arquivos) => onFotos(arquivos, { etapa: etapaEmCurso })} />
      {erroDasFotos ? (
        <p role="alert" className="text-sm text-destructive">
          {erroDasFotos}
        </p>
      ) : null}
      {recebe ? (
        <Button type="button" variant="outline" size="lg" onClick={() => setOcorrencia(true)}>
          Registrar ocorrência
        </Button>
      ) : null}
      {podeConcluir ? (
        <Button asChild size="lg" variant={etapas.proxima && etapas.proxima !== "fim" ? "outline" : "default"}>
          <Link href={hrefDaConclusaoNoCampo(ficha.numero)}>
            <Check aria-hidden="true" className="size-5" />
            Concluir OS
          </Link>
        </Button>
      ) : null}

      <Sheet open={Boolean(incluir)} onOpenChange={(aberto) => (aberto ? null : setIncluir(null))}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto bg-card">
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>Incluir item executado</SheetTitle>
            <SheetDescription>
              OS {ficha.numero} · {ficha.clienteNome ?? ficha.customerCode}
            </SheetDescription>
          </SheetHeader>
          {incluir ? <IncluirItem ficha={ficha} linhaInicial={incluir.linha} catalogo={catalogo} onRegistrar={onRegistrar} onFechar={() => setIncluir(null)} agora={agora} /> : null}
        </SheetContent>
      </Sheet>
      <Sheet open={ocorrencia} onOpenChange={setOcorrencia}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto bg-card">
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>Registrar ocorrência</SheetTitle>
            <SheetDescription>OS {ficha.numero}</SheetDescription>
          </SheetHeader>
          {ocorrencia ? <Ocorrencia ficha={ficha} onRegistrar={onRegistrar} onFotos={onFotos} onFechar={() => setOcorrencia(false)} agora={agora} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
