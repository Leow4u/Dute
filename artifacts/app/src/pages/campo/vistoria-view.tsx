import { useId, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Check, Minus, Plus, Search, Send, X } from "lucide-react";

import { COR_DO_STATUS, rotuloDoStatusDaOs, selo, seloAlerta } from "@/components/operacao/partes";
import { VistoriaEnviada } from "@/components/operacao/vistoria-lida";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { NovoRegistro, RegistroNaFila } from "@/lib/campo/fila";
import { ROTA_CAMPO } from "@/lib/campo/navegacao";
import { registroDeEtapa } from "@/lib/campo/os-no-campo";
import {
  chegadaDaVistoria,
  comAmbiente,
  comAtual,
  comFeito,
  comItem,
  comMedida,
  comNovaMedida,
  comQuantidade,
  fazAVistoria,
  feitosEmTexto,
  fotosDoAmbiente,
  fotosEmTexto,
  liderDaVistoria,
  problemaDoNomeDoAmbiente,
  problemasDaVistoria,
  registroDaVistoria,
  semMedida,
  situacaoDoAmbiente,
  vistoriaGuardada,
  type AmbienteNoRascunho,
  type RascunhoDaVistoria,
} from "@/lib/campo/vistoria";
import { buscarNoCatalogo, type ItemDoCatalogo } from "@/lib/operacao/demanda-direta";
import { horaDe, type FichaDaOs } from "@/lib/operacao/ficha-da-os";
import { cn } from "@/lib/utils";

import { BotaoDeFoto, Cartao, useUrlsGuardadas } from "./os-view";

/**
 * Campo › OS de vistoria (parte 3.11b; docs/mockups/Campo2Vistoria.dc.html):
 * a chegada, os ambientes com as fotos e os itens levantados do catálogo, as
 * medidas, o acesso, as observações e "Enviar vistoria ao comercial". O que
 * se levanta fica no rascunho do aparelho; as fotos e o envio vão pela fila
 * do campo. Enviada, a vistoria fica só para ler. Sem legenda e sem valor.
 */

type Mudar = (muda: (atual: RascunhoDaVistoria) => RascunhoDaVistoria) => void;

const SITUACAO_COR = {
  Feito: "bg-success-soft text-success-soft-foreground",
  "Em andamento": "bg-amber-soft text-amber-soft-foreground",
  "A fazer": "bg-muted text-muted-foreground",
} as const;

function Ambientes({ rascunho, travada, onMudar, novoId }: { rascunho: RascunhoDaVistoria; travada: boolean; onMudar: Mudar; novoId: () => string }) {
  const id = useId();
  const [nome, setNome] = useState("");
  const [tentou, setTentou] = useState(false);
  const problema = problemaDoNomeDoAmbiente(rascunho, nome);
  const feitos = feitosEmTexto(rascunho);
  return (
    <Cartao titulo="Ambientes" acao={feitos ? <span className="text-sm text-muted-foreground">{feitos}</span> : undefined}>
      {rascunho.ambientes.length ? (
        <ul className="flex flex-col gap-2">
          {rascunho.ambientes.map((ambiente, indice) => {
            const situacao = situacaoDoAmbiente(ambiente, rascunho.atual);
            const atual = ambiente.id === rascunho.atual;
            return (
              <li key={ambiente.id}>
                <button
                  type="button"
                  aria-pressed={atual}
                  disabled={travada}
                  onClick={() => onMudar((r) => comAtual(r, ambiente.id))}
                  className={cn("flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left", atual ? "border-foreground bg-muted" : "border-border")}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      ambiente.feito ? "bg-success-soft text-success-soft-foreground" : atual ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {ambiente.feito ? <Check className="size-4" /> : indice + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-foreground">{ambiente.nome}</span>
                    <span className="text-xs text-muted-foreground">{[situacao === "Feito" ? null : situacao, ambiente.fotos.length ? fotosEmTexto(ambiente.fotos.length) : null].filter(Boolean).join(" · ") || situacao}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {travada ? null : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setTentou(true);
            if (problema) return;
            onMudar((r) => comAmbiente(r, nome, novoId()));
            setNome("");
            setTentou(false);
          }}
        >
          <Label htmlFor={`${id}-ambiente`}>Novo ambiente</Label>
          <div className="flex gap-2">
            <Input id={`${id}-ambiente`} className="h-11 text-base" value={nome} maxLength={61} aria-invalid={tentou && Boolean(problema)} onChange={(event) => setNome(event.target.value)} />
            <Button type="submit" size="lg" variant="outline">
              <Plus aria-hidden="true" className="size-5" />
              Adicionar
            </Button>
          </div>
          {tentou && problema ? (
            <p role="alert" className="text-sm text-destructive">
              {problema}
            </p>
          ) : null}
        </form>
      )}
    </Cartao>
  );
}

function AmbienteAtual({
  ambiente,
  rascunho,
  ficha,
  pendentes,
  urls,
  travada,
  onMudar,
  onFotos,
  onAdicionarItem,
}: {
  ambiente: AmbienteNoRascunho;
  rascunho: RascunhoDaVistoria;
  ficha: FichaDaOs;
  pendentes: readonly RegistroNaFila[];
  urls: Readonly<Record<string, string>>;
  travada: boolean;
  onMudar: Mudar;
  onFotos: (arquivos: File[]) => void;
  onAdicionarItem: () => void;
}) {
  const situacao = situacaoDoAmbiente(ambiente, rascunho.atual);
  const guardadas = useUrlsGuardadas(pendentes, ficha.numero);
  const fotos = fotosDoAmbiente(ambiente, ficha, pendentes);
  return (
    <section aria-label="Ambiente atual" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">{ambiente.nome}</h2>
        <span className={cn(selo, SITUACAO_COR[situacao])}>{situacao}</span>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">Fotos · {fotos.length}</span>
        {fotos.length ? (
          <ul className="grid grid-cols-3 gap-2">
            {fotos.map((foto) => {
              const url = foto.foto ? urls[foto.foto.caminho] : guardadas.find((item) => item.chave === foto.guardada?.chave)?.url;
              const hora = foto.foto ? horaDe(foto.foto.instante) : typeof foto.guardada?.dados.instante === "string" ? horaDe(foto.guardada.dados.instante) : null;
              return (
                <li key={foto.id} className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
                  {url ? <img src={url} alt={[ambiente.nome, hora].filter(Boolean).join(" · ")} className="size-full object-cover" /> : <span className="sr-only">{ambiente.nome}</span>}
                  {hora ? (
                    <span aria-hidden="true" className="absolute inset-x-1 bottom-1 rounded bg-background/90 px-1.5 py-0.5 text-center text-xs font-medium tabular-nums text-foreground">
                      {foto.guardada ? `${hora} · guardada` : hora}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {travada ? null : <BotaoDeFoto rotulo="Tirar foto" onFotos={onFotos} />}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">Itens levantados</span>
          <span className="text-xs text-muted-foreground">Catálogo Dutelog</span>
        </div>
        {ambiente.itens.length ? (
          <ul className="flex flex-col divide-y divide-border">
            {ambiente.itens.map((item) => (
              <li key={item.lpuItemId} className="flex items-center gap-3 py-2.5">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-semibold text-foreground">{item.item}</span>
                  {item.unidade ? <span className="text-xs text-muted-foreground">{item.unidade.toLocaleLowerCase("pt-BR")}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Button type="button" size="icon" variant="outline" className="size-11" aria-label={`Diminuir ${item.item}`} disabled={travada} onClick={() => onMudar((r) => comQuantidade(r, ambiente.id, item.lpuItemId, -1))}>
                    <Minus aria-hidden="true" className="size-5" />
                  </Button>
                  <span className="w-10 text-center text-lg font-bold tabular-nums text-foreground">{item.quantidade}</span>
                  <Button type="button" size="icon" variant="outline" className="size-11" aria-label={`Aumentar ${item.item}`} disabled={travada} onClick={() => onMudar((r) => comQuantidade(r, ambiente.id, item.lpuItemId, 1))}>
                    <Plus aria-hidden="true" className="size-5" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {travada ? null : (
          <Button type="button" variant="outline" size="lg" onClick={onAdicionarItem}>
            <Plus aria-hidden="true" className="size-5" />
            Adicionar item
          </Button>
        )}
      </div>
      {travada ? null : (
        <Button type="button" variant="secondary" size="lg" onClick={() => onMudar((r) => comFeito(r, ambiente.id, !ambiente.feito))}>
          <Check aria-hidden="true" className="size-5" />
          {ambiente.feito ? "Reabrir ambiente" : "Concluir ambiente"}
        </Button>
      )}
    </section>
  );
}

function AdicionarItem({ catalogo, onEscolher }: { catalogo: readonly ItemDoCatalogo[]; onEscolher: (item: ItemDoCatalogo) => void }) {
  const id = useId();
  const [busca, setBusca] = useState("");
  const resultados = buscarNoCatalogo(catalogo, busca);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-busca`}>Buscar item</Label>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id={`${id}-busca`} type="search" className="h-11 pl-9 text-base" value={busca} onChange={(event) => setBusca(event.target.value)} />
        </div>
      </div>
      <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
        {resultados.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onEscolher(item)} className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5 text-left text-sm">
              <span className="font-semibold text-foreground">{item.item}</span>
              <span className="text-xs text-muted-foreground">{[item.servico, item.unidade?.toLocaleLowerCase("pt-BR")].filter(Boolean).join(" · ")}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Medidas({ rascunho, travada, onMudar, novoId }: { rascunho: RascunhoDaVistoria; travada: boolean; onMudar: Mudar; novoId: () => string }) {
  const id = useId();
  return (
    <Cartao titulo="Medidas">
      <div className="flex flex-col gap-3">
        {rascunho.medidas.map((medida) =>
          medida.sugerida ? (
            <div key={medida.id} className="flex flex-col gap-2">
              <Label htmlFor={`${id}-${medida.id}`}>{medida.nome}</Label>
              <Input id={`${id}-${medida.id}`} className="h-11 text-base" maxLength={60} disabled={travada} value={medida.valor} onChange={(event) => onMudar((r) => comMedida(r, medida.id, "valor", event.target.value))} />
            </div>
          ) : (
            <div key={medida.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-${medida.id}-nome`}>Medida</Label>
                <Input id={`${id}-${medida.id}-nome`} className="h-11 text-base" maxLength={60} disabled={travada} value={medida.nome} onChange={(event) => onMudar((r) => comMedida(r, medida.id, "nome", event.target.value))} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-${medida.id}-valor`}>Valor</Label>
                <Input id={`${id}-${medida.id}-valor`} className="h-11 text-base" maxLength={60} disabled={travada} value={medida.valor} onChange={(event) => onMudar((r) => comMedida(r, medida.id, "valor", event.target.value))} />
              </div>
              {travada ? null : (
                <Button type="button" size="icon" variant="ghost" className="size-11" aria-label={`Tirar a medida ${medida.nome || "nova"}`} onClick={() => onMudar((r) => semMedida(r, medida.id))}>
                  <X aria-hidden="true" className="size-5" />
                </Button>
              )}
            </div>
          ),
        )}
      </div>
      {travada ? null : (
        <Button type="button" variant="secondary" onClick={() => onMudar((r) => comNovaMedida(r, novoId()))}>
          <Plus aria-hidden="true" className="size-4" />
          Nova medida
        </Button>
      )}
    </Cartao>
  );
}

export type CampoVistoriaProps = {
  ficha: FichaDaOs;
  uid: string | null;
  pendentes: readonly RegistroNaFila[];
  urls: Readonly<Record<string, string>>;
  catalogo: readonly ItemDoCatalogo[];
  rascunho: RascunhoDaVistoria;
  onMudar: Mudar;
  erroDasFotos: string | null;
  /** O relógio do toque (instante do registro). */
  agora: () => Date;
  novoId: () => string;
  onRegistrar: (novo: NovoRegistro) => void;
  /** As fotos do ambiente: vão pela fila com o nome dele na legenda; a página põe os ids no rascunho. */
  onFotos: (arquivos: File[], ambiente: AmbienteNoRascunho) => void;
};

export function CampoVistoriaView({ ficha, uid, pendentes, urls, catalogo, rascunho, onMudar, erroDasFotos, agora, novoId, onRegistrar, onFotos }: CampoVistoriaProps) {
  const id = useId();
  const [adicionar, setAdicionar] = useState(false);
  const [tentou, setTentou] = useState(false);
  const guardada = vistoriaGuardada(ficha, pendentes);
  const recebe = (ficha.status === "agendada" || ficha.status === "em_execucao") && !guardada;
  const faz = fazAVistoria(ficha, uid);
  const travada = !recebe || !faz;
  const chegada = chegadaDaVistoria(ficha, pendentes);
  const lider = liderDaVistoria(ficha);
  const atual = rascunho.ambientes.find((ambiente) => ambiente.id === rascunho.atual) ?? null;
  const problemas = problemasDaVistoria(rascunho, { chegou: Boolean(chegada) });
  const local = ficha.locais.origem;
  const endereco = [local?.endereco ?? local?.nome, local?.complemento].filter(Boolean).join(" · ");
  const janela = ficha.janela?.inicio ? (ficha.janela.fim ? `${ficha.janela.inicio}–${ficha.janela.fim}` : ficha.janela.inicio) : null;
  return (
    <div className="flex flex-col gap-4">
      <Link href={ROTA_CAMPO} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Minhas OS
      </Link>
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">OS {ficha.numero}</h1>
          <span className={cn(selo, COR_DO_STATUS[ficha.status])}>{rotuloDoStatusDaOs(ficha)}</span>
        </div>
        <p className="text-sm text-muted-foreground">Vistoria · Demanda {ficha.demanda}</p>
        <p className="text-sm font-semibold text-foreground">{ficha.clienteNome ?? ficha.customerCode}</p>
        {endereco ? <p className="text-sm text-muted-foreground">{endereco}</p> : null}
      </header>

      {chegada || janela ? (
        <dl className="grid grid-cols-2 gap-2">
          {chegada ? (
            <div className="flex flex-col rounded-lg bg-muted px-3 py-2">
              <dt className="text-xs text-muted-foreground">Chegada</dt>
              <dd className="text-base font-bold tabular-nums text-foreground">{horaDe(chegada)}</dd>
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

      {ficha.status === "revisada" && ficha.vistoria ? (
        <Cartao titulo="Vistoria enviada" acao={<span className="text-sm text-muted-foreground">{horaDe(ficha.vistoria.instante)}</span>}>
          <VistoriaEnviada vistoria={ficha.vistoria} fotos={ficha.fotos} urls={urls} />
        </Cartao>
      ) : null}
      {ficha.status === "cancelada" ? <p className={cn(selo, seloAlerta, "h-auto self-start py-1.5 text-sm")}>OS cancelada</p> : null}
      {guardada ? <p className={cn(selo, seloAlerta, "h-auto self-start py-1.5 text-sm")}>Vistoria enviada · guardada</p> : null}

      {recebe && !faz && lider ? <p className="text-sm text-muted-foreground">Vistoria com {lider.nome}</p> : null}

      {ficha.status === "revisada" || ficha.status === "cancelada" || (!faz && !guardada) ? null : (
        <>
          {recebe && !chegada ? (
            <Button type="button" size="lg" className="w-full" onClick={() => onRegistrar(registroDeEtapa(ficha, "chegada_origem", agora()))}>
              Registrar chegada
            </Button>
          ) : null}
          <Ambientes rascunho={rascunho} travada={travada} onMudar={onMudar} novoId={novoId} />
          {atual ? (
            <AmbienteAtual
              ambiente={atual}
              rascunho={rascunho}
              ficha={ficha}
              pendentes={pendentes}
              urls={urls}
              travada={travada}
              onMudar={onMudar}
              onFotos={(arquivos) => onFotos(arquivos, atual)}
              onAdicionarItem={() => setAdicionar(true)}
            />
          ) : null}
          {erroDasFotos ? (
            <p role="alert" className="text-sm text-destructive">
              {erroDasFotos}
            </p>
          ) : null}
          <Medidas rascunho={rascunho} travada={travada} onMudar={onMudar} novoId={novoId} />
          <Cartao titulo="Acesso">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-horario`}>Horário de carga</Label>
              <Input id={`${id}-horario`} className="h-11 text-base" maxLength={120} disabled={travada} value={rascunho.horarioDeCarga} onChange={(event) => onMudar((r) => ({ ...r, horarioDeCarga: event.target.value }))} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-vaga`}>Vaga de carga</Label>
              <Input id={`${id}-vaga`} className="h-11 text-base" maxLength={120} disabled={travada} value={rascunho.vagaDeCarga} onChange={(event) => onMudar((r) => ({ ...r, vagaDeCarga: event.target.value }))} />
            </div>
          </Cartao>
          <section aria-label="Observações" className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <Label htmlFor={`${id}-observacoes`}>Observações</Label>
            <textarea
              id={`${id}-observacoes`}
              rows={3}
              maxLength={2000}
              disabled={travada}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-base text-foreground disabled:opacity-50"
              value={rascunho.observacoes}
              onChange={(event) => onMudar((r) => ({ ...r, observacoes: event.target.value }))}
            />
          </section>
          {tentou && problemas.length && !travada ? (
            <div role="alert">
              <ul className="flex flex-col gap-1 text-sm text-destructive">
                {problemas.map((problema) => (
                  <li key={problema}>{problema}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {travada ? null : (
            <Button
              type="button"
              size="lg"
              className="w-full"
              onClick={() => {
                setTentou(true);
                if (problemas.length) return;
                onRegistrar(registroDaVistoria(ficha, rascunho, agora()));
              }}
            >
              <Send aria-hidden="true" className="size-5" />
              Enviar vistoria ao comercial
            </Button>
          )}
        </>
      )}

      <Sheet open={adicionar} onOpenChange={setAdicionar}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto bg-card">
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>Adicionar item</SheetTitle>
            <SheetDescription>{atual?.nome ?? `OS ${ficha.numero}`}</SheetDescription>
          </SheetHeader>
          {adicionar && atual ? (
            <AdicionarItem
              catalogo={catalogo}
              onEscolher={(item) => {
                onMudar((r) => comItem(r, atual.id, item));
                setAdicionar(false);
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
