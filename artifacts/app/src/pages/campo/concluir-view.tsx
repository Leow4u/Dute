import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft, Camera, Check, Pencil } from "lucide-react";

import { QuadroDeAssinatura } from "@/components/campo/quadro-de-assinatura";
import { selo, seloAlerta } from "@/components/operacao/partes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fotosDoFinal,
  itensParaConcluir,
  nomeDaAssinatura,
  problemaParaConcluir,
  problemasDaConclusao,
  registroDeConclusao,
  responsavelSugerido,
  ultimaEtapa,
  type AceiteNoCampo,
  type FormularioDaConclusao,
} from "@/lib/campo/concluir";
import type { NovoRegistro, RegistroNaFila } from "@/lib/campo/fila";
import { ROTA_CAMPO, hrefDaOsNoCampo } from "@/lib/campo/navegacao";
import { horaDe, type EtapaDaOs, type FichaDaOs } from "@/lib/operacao/ficha-da-os";
import { cn } from "@/lib/utils";

/**
 * Campo › Concluir OS (parte 3.9b; docs/mockups/Campo2Concluir.dc.html): os
 * itens com o feito e o previsto e o motivo de cada um a menos, as fotos do
 * final, o responsável do cliente e a assinatura no dedo, ou "sem
 * responsável no local" com o nome de quem recebeu. A conclusão vai pela
 * fila (onConcluir), depois do que foi tocado antes; a tela confirma ali
 * mesmo, sem trocar de rota no mesmo toque, para a fila guardar o registro
 * no aparelho. Sem legenda e sem valor.
 */

export type EstadoDaConclusao = "carregando" | "erro" | "nao_encontrada" | "pronto";

function Cartao({ titulo, children, acao }: { titulo: string; children: ReactNode; acao?: ReactNode }) {
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

function useUrlsGuardadas(registros: readonly RegistroNaFila[]): Array<{ chave: string; url: string }> {
  const [urls, setUrls] = useState<Array<{ chave: string; url: string }>>([]);
  useEffect(() => {
    const criadas = registros.flatMap((registro) => (registro.foto ? [{ chave: registro.chave, url: URL.createObjectURL(registro.foto.arquivo) }] : []));
    setUrls(criadas);
    return () => criadas.forEach((item) => URL.revokeObjectURL(item.url));
  }, [registros]);
  return urls;
}

export function CampoConcluirView({
  estado,
  numero,
  ficha,
  uid,
  pendentes,
  urls,
  erroDasFotos,
  agora,
  onConcluir,
  onFotos,
}: {
  estado: EstadoDaConclusao;
  numero: string;
  ficha: FichaDaOs | null;
  uid: string | null;
  pendentes: readonly RegistroNaFila[];
  urls: Readonly<Record<string, string>>;
  erroDasFotos: string | null;
  agora: () => Date;
  onConcluir: (novo: NovoRegistro) => void;
  onFotos: (arquivos: File[], extra: { etapa: EtapaDaOs }) => void;
}) {
  const id = useId();
  const [aceite, setAceite] = useState<AceiteNoCampo>("assinatura");
  const [nome, setNome] = useState(() => (ficha ? responsavelSugerido(ficha) : ""));
  const [cargo, setCargo] = useState("");
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const [assinatura, setAssinatura] = useState<Blob | null>(null);
  const [limpar, setLimpar] = useState(0);
  const [tentou, setTentou] = useState(false);
  const [enviada, setEnviada] = useState(false);

  // O nome sugerido chega com a OS (a primeira leitura vem vazia).
  const sugerido = ficha ? responsavelSugerido(ficha) : "";
  useEffect(() => {
    if (sugerido) setNome((atual) => atual || sugerido);
  }, [sugerido]);

  const final = useMemo(() => (ficha ? fotosDoFinal(ficha, pendentes) : { gravadas: [], guardadas: [] }), [ficha, pendentes]);
  const guardadas = useUrlsGuardadas(final.guardadas);

  const voltar = (
    <Link href={hrefDaOsNoCampo(numero)} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft aria-hidden="true" className="size-4" />
      OS {numero}
    </Link>
  );
  if (estado !== "pronto" || !ficha) {
    return (
      <div className="flex flex-col gap-4">
        {voltar}
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Concluir OS {numero}</h1>
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

  const cabecalho = (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Concluir OS {ficha.numero}</h1>
      <p className="text-sm text-muted-foreground">
        {ficha.clienteNome ?? ficha.customerCode} · Demanda {ficha.demanda}
      </p>
    </header>
  );

  if (enviada || ficha.status === "em_revisao" || ficha.status === "revisada") {
    return (
      <div className="flex flex-col gap-4">
        {voltar}
        {cabecalho}
        <section aria-label="Conclusão" className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4">
          <span className="flex size-10 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
            <Check aria-hidden="true" className="size-5" />
          </span>
          <p className="text-lg font-bold text-foreground">OS {ficha.numero} concluída</p>
          <Button asChild size="lg" className="w-full">
            <Link href={ROTA_CAMPO}>Minhas OS</Link>
          </Button>
        </section>
      </div>
    );
  }

  const impedimento = problemaParaConcluir(ficha, pendentes, uid);
  if (impedimento) {
    return (
      <div className="flex flex-col gap-4">
        {voltar}
        {cabecalho}
        <p className={cn(selo, seloAlerta, "h-auto self-start py-1.5 text-sm")}>{impedimento}</p>
      </div>
    );
  }

  const itens = itensParaConcluir(ficha, pendentes);
  const ultima = ultimaEtapa(ficha, pendentes);
  const destino = ficha.locais.destino ?? ficha.locais.origem;
  const ondeTermina = destino ? [destino.endereco ?? destino.nome, destino.complemento].filter(Boolean).join(" · ") : null;
  const totalDoFinal = final.gravadas.length + final.guardadas.length;
  const formulario: FormularioDaConclusao = { aceite, nome, cargo, motivos };
  const problemas = problemasDaConclusao(formulario, itens, totalDoFinal, Boolean(assinatura));
  const semResponsavel = aceite === "sem_aceite";

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setTentou(true);
        if (problemas.length) return;
        const comAssinatura = aceite === "assinatura" && assinatura ? { arquivo: assinatura, nome: nomeDaAssinatura() } : null;
        onConcluir(registroDeConclusao(ficha, formulario, itens, comAssinatura, agora()));
        setEnviada(true);
      }}
    >
      {voltar}
      {cabecalho}
      {ondeTermina || ultima ? (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg bg-muted px-3 py-2">
          {ondeTermina ? (
            <div className="flex min-w-0 flex-col">
              <dt className="text-xs text-muted-foreground">{ficha.locais.destino ? "Destino" : "Local"}</dt>
              <dd className="truncate text-base font-bold text-foreground">{ondeTermina}</dd>
            </div>
          ) : (
            <span />
          )}
          {ultima ? (
            <div className="flex flex-col text-right">
              <dt className="text-xs text-muted-foreground">{ultima.rotulo}</dt>
              <dd className="text-base font-bold tabular-nums text-foreground">{ultima.hora}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <Cartao
        titulo="Itens executados"
        acao={
          <Link href={hrefDaOsNoCampo(ficha.numero)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            <Pencil aria-hidden="true" className="size-4" />
            Corrigir
          </Link>
        }
      >
        <ul className="flex flex-col divide-y divide-border">
          {itens.map((item) => (
            <li key={item.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
              <span className="text-sm font-semibold text-foreground">{item.item}</span>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">{[item.codigo, item.unidade].filter(Boolean).join(" · ")}</span>
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className={cn("text-lg font-bold tabular-nums", item.falta ? "text-destructive" : "text-foreground")}>{item.feito}</span>
                  de {item.previsto}
                  {item.diferenca ? (
                    <span className={cn(selo, "gap-1 border-destructive bg-card text-destructive")}>
                      <AlertTriangle aria-hidden="true" className="size-3.5" />
                      {item.diferenca}
                    </span>
                  ) : (
                    <span className="flex size-6 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
                      <Check aria-hidden="true" className="size-3.5" />
                      <span className="sr-only">completo</span>
                    </span>
                  )}
                </span>
              </div>
              {item.incluidos.map((texto) => (
                <span key={texto} className="self-start rounded-md bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">
                  {texto}
                </span>
              ))}
              {item.falta ? (
                <div className="mt-1 flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-motivo-${item.id}`}>Motivo da diferença</Label>
                  <textarea
                    id={`${id}-motivo-${item.id}`}
                    rows={2}
                    aria-required="true"
                    className="w-full rounded-md border border-input bg-card px-3 py-2 text-base text-foreground"
                    value={motivos[item.id] ?? ""}
                    onChange={(event) => setMotivos({ ...motivos, [item.id]: event.target.value })}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Cartao>

      <Cartao titulo={`Fotos do final · ${totalDoFinal}`} acao={<span className="text-sm font-semibold text-muted-foreground">{ficha.fotos.length} na OS</span>}>
        <ul className="grid grid-cols-4 gap-2">
          {guardadas.map((foto) => (
            <li key={foto.chave} className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
              <img src={foto.url} alt="Foto do final guardada" className="size-full object-cover" />
            </li>
          ))}
          {final.gravadas.map((foto) => (
            <li key={foto.id} className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
              {urls[foto.caminho] ? <img src={urls[foto.caminho]} alt={`Foto do final das ${horaDe(foto.instante)}`} className="size-full object-cover" loading="lazy" /> : null}
              <span className="absolute bottom-1 left-1 rounded bg-foreground px-1 text-xs font-bold text-background">{horaDe(foto.instante)}</span>
            </li>
          ))}
          <li>
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-input bg-card text-xs font-semibold text-foreground focus-within:ring-2 focus-within:ring-ring/40">
              <Camera aria-hidden="true" className="size-5 text-primary" />
              Tirar foto
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                multiple
                className="sr-only"
                onChange={(event) => {
                  onFotos(Array.from(event.target.files ?? []), { etapa: "fim" });
                  event.target.value = "";
                }}
              />
            </label>
          </li>
        </ul>
        {erroDasFotos ? (
          <p role="alert" className="text-sm text-destructive">
            {erroDasFotos}
          </p>
        ) : null}
      </Cartao>

      <Cartao titulo="Responsável do cliente">
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-foreground">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={semResponsavel}
            onChange={(event) => setAceite(event.target.checked ? "sem_aceite" : "assinatura")}
          />
          Sem responsável no local
        </label>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-nome`}>{semResponsavel ? "Quem recebeu" : "Nome"}</Label>
          <Input id={`${id}-nome`} className="h-11 text-base" autoComplete="off" value={nome} onChange={(event) => setNome(event.target.value)} />
        </div>
        {semResponsavel ? null : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-cargo`}>Cargo</Label>
              <Input id={`${id}-cargo`} className="h-11 text-base" autoComplete="off" value={cargo} onChange={(event) => setCargo(event.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">Aceite dos itens executados</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!assinatura}
                  onClick={() => {
                    setAssinatura(null);
                    setLimpar((valor) => valor + 1);
                  }}
                >
                  Limpar
                </Button>
              </div>
              <QuadroDeAssinatura id={`${id}-assinatura`} assinada={Boolean(assinatura)} rotulo={`Assinatura de ${nome.trim() || "responsável"}`} limpar={limpar} onAssinatura={setAssinatura} />
            </div>
          </>
        )}
      </Cartao>

      {tentou && problemas.length ? (
        <div role="alert">
          <ul className="flex flex-col gap-1 text-sm text-destructive">
            {problemas.map((problema) => (
              <li key={problema}>{problema}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <Button type="submit" size="lg" className="h-14 w-full text-base">
        <Check aria-hidden="true" className="size-5" />
        {semResponsavel ? "Concluir sem aceite no local" : "Concluir com assinatura"}
      </Button>
    </form>
  );
}
