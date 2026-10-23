import { useId, type ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, Check, ImageIcon, Printer } from "lucide-react";

import { COR_DO_STATUS, ROTULO_DO_STATUS, selo } from "@/components/operacao/partes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { horaDe, janelaEmTexto, servicosEmTexto, type FichaDaOs } from "@/lib/operacao/ficha-da-os";
import { hrefDaDemanda, hrefDaFichaDaOs, hrefDaImpressaoDaOs, hrefDaRevisao } from "@/lib/operacao/navegacao";
import {
  DECISAO_ROTULO,
  comSinal,
  conclusaoEmTexto,
  diferencaCorrigida,
  divergenciasEmTexto,
  horasDaOs,
  opcoesPara,
  pedeAditivo,
  quantidadeEmTexto,
  saldoDepois,
  type CartaoParaRevisar,
  type DecisaoDaLinha,
  type FormularioDaRevisao,
  type LinhaParaRevisar,
} from "@/lib/operacao/revisao";
import { cn } from "@/lib/utils";

/**
 * Operação › Revisão (docs/plataforma/fase-3-operacao.md, parte 3.10b;
 * docs/mockups/OpRevisao.dc.html): as OS para revisar e, a da vez, com as
 * fotos, a assinatura, as horas, os itens com o executado e o saldo da
 * demanda, e cada divergência com as decisões que valem para ela. Só
 * apresentação: os dados e o envio estão em pages/operacao/revisao.tsx.
 * Sem legenda e sem valor.
 */

export type EstadoDaRevisao = "carregando" | "erro" | "pronto";

export type OsDaRevisao = {
  ficha: FichaDaOs;
  cliente: string;
  linhas: readonly LinhaParaRevisar[];
  direta: boolean;
  /** A URL de cada foto e da assinatura pelo caminho no Storage. */
  urls: Readonly<Record<string, string>>;
  /** Hoje (AAAA-MM-DD), para a janela ("hoje 07:30–18:00"). */
  hoje: string;
};

const FOTOS_NO_RESUMO = 2;

function Cartao({ titulo, acao, children, className }: { titulo: string; acao?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={titulo} className={cn("rounded-lg border border-border bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Conferencia({ titulo, ok, children }: { titulo: string; ok: boolean; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 bg-card p-4">
      <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span aria-hidden="true" className={cn("flex size-5 items-center justify-center rounded-full", ok ? "bg-success-soft text-success-soft-foreground" : "bg-destructive-soft text-destructive-soft-foreground")}>
          {ok ? <Check className="size-3.5" /> : <AlertTriangle className="size-3" />}
        </span>
        {titulo}
      </span>
      {children}
    </div>
  );
}

function Lista({ cartoes, selecionada }: { cartoes: readonly CartaoParaRevisar[]; selecionada: string | null }) {
  return (
    <section aria-label="Para revisar" className="flex min-w-0 flex-col gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        Para revisar
        <span className={cn(selo, "border-border bg-muted text-foreground")}>{cartoes.length}</span>
      </h2>
      {cartoes.length ? (
        <ul className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
          {cartoes.map((cartao) => (
            <li key={cartao.numero} className="border-b border-border last:border-b-0">
              <Link
                href={hrefDaRevisao(cartao.numero)}
                aria-current={cartao.numero === selecionada ? "page" : undefined}
                className={cn("flex flex-col gap-1 border-l-2 px-4 py-3 hover:bg-muted", cartao.numero === selecionada ? "border-l-foreground bg-muted" : "border-l-transparent")}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">OS {cartao.numero}</span>
                  {cartao.divergencias ? (
                    <span className={cn(selo, "border-destructive bg-card text-destructive")}>
                      {cartao.divergencias} {cartao.divergencias === 1 ? "divergência" : "divergências"}
                    </span>
                  ) : null}
                </span>
                <span className="text-sm text-foreground">
                  {cartao.cliente} · Demanda {cartao.demanda}
                </span>
                {cartao.servicos ? <span className="text-xs text-muted-foreground">{cartao.servicos}</span> : null}
                <span className="text-xs text-muted-foreground">{cartao.aceite}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-border bg-card px-4 py-5 text-sm text-muted-foreground">Nenhuma OS para revisar</p>
      )}
    </section>
  );
}

function Opcoes({ id, rotulo, opcoes, valor, onValor }: { id: string; rotulo: string; opcoes: readonly (keyof typeof DECISAO_ROTULO)[]; valor: string; onValor: (valor: keyof typeof DECISAO_ROTULO) => void }) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="flex flex-wrap gap-2">
      {opcoes.map((opcao) => (
        <label
          key={opcao}
          className={cn(
            "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-semibold focus-within:ring-2 focus-within:ring-ring/40",
            valor === opcao ? "border-foreground bg-muted text-foreground" : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          <input type="radio" name={id} className="sr-only" checked={valor === opcao} onChange={() => onValor(opcao)} />
          {DECISAO_ROTULO[opcao]}
        </label>
      ))}
    </div>
  );
}

function Divergencia({ linha, decisao, direta, onDecisao }: { linha: LinhaParaRevisar; decisao: DecisaoDaLinha; direta: boolean; onDecisao: (decisao: DecisaoDaLinha) => void }) {
  const id = useId();
  const quantidade = `${comSinal(linha.diferenca)} ${linha.item}`;
  const corrigida = decisao.escolha === "corrigir" ? diferencaCorrigida(linha, decisao) : null;
  const resto = corrigida !== null && corrigida !== 0 ? opcoesPara(corrigida, { direta, saldoLivre: linha.saldoLivre }) : [];
  const final = decisao.escolha === "corrigir" ? decisao.resto : decisao.escolha;
  return (
    <section aria-label={quantidade} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">{[quantidade, linha.contexto].filter(Boolean).join(" · ")}</h3>
        {linha.detalhes.map((detalhe) => (
          <p key={detalhe} className="text-sm text-muted-foreground">
            {detalhe}
          </p>
        ))}
      </div>
      <Opcoes id={`${id}-escolha`} rotulo={`Decisão sobre ${quantidade}`} opcoes={linha.opcoes} valor={decisao.escolha} onValor={(escolha) => onDecisao({ ...decisao, escolha })} />
      {decisao.escolha === "corrigir" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-quantidade`}>Quantidade executada</Label>
            <Input id={`${id}-quantidade`} inputMode="decimal" value={decisao.quantidade} onChange={(event) => onDecisao({ ...decisao, quantidade: event.target.value })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-correcao`}>Motivo da correção</Label>
            <Input id={`${id}-correcao`} value={decisao.motivoDaCorrecao} onChange={(event) => onDecisao({ ...decisao, motivoDaCorrecao: event.target.value })} />
          </div>
        </div>
      ) : null}
      {resto.length ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">O que resta · {comSinal(corrigida as number)}</span>
          <Opcoes id={`${id}-resto`} rotulo={`Decisão sobre o que resta de ${linha.item}`} opcoes={resto} valor={decisao.resto} onValor={(escolha) => onDecisao({ ...decisao, resto: escolha as DecisaoDaLinha["resto"] })} />
        </div>
      ) : null}
      {final === "absorver" ? (
        <div className="flex max-w-md flex-col gap-2">
          <Label htmlFor={`${id}-motivo`}>Motivo</Label>
          <Input id={`${id}-motivo`} value={decisao.motivo} onChange={(event) => onDecisao({ ...decisao, motivo: event.target.value })} />
        </div>
      ) : null}
    </section>
  );
}

function OsDaVez({
  os,
  form,
  onForm,
  problemas,
  erro,
  ocupado,
  onConcluir,
}: {
  os: OsDaRevisao;
  form: FormularioDaRevisao;
  onForm: (form: FormularioDaRevisao) => void;
  problemas: readonly string[];
  erro: string | null;
  ocupado: boolean;
  onConcluir: () => void;
}) {
  const id = useId();
  const { ficha, linhas, direta, urls } = os;
  const lider = ficha.equipe.find((pessoa) => pessoa.papel === "lider");
  const subtitulo = [os.cliente, servicosEmTexto(ficha.servicos), janelaEmTexto(ficha.janela, os.hoje), lider ? `líder ${lider.nome}` : null].filter(Boolean);
  const fotos = [...ficha.fotos].sort((a, b) => b.instante.localeCompare(a.instante));
  const horas = horasDaOs(ficha);
  const divergentes = linhas.filter((linha) => linha.diferenca !== 0);
  const assinatura = ficha.conclusao?.assinatura ? urls[ficha.conclusao.assinatura] : null;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight text-foreground">OS {ficha.numero}</h2>
            <span className={cn(selo, COR_DO_STATUS[ficha.status])}>{ROTULO_DO_STATUS[ficha.status]}</span>
          </div>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <Link href={hrefDaDemanda(ficha.demanda)} className="rounded font-medium text-primary underline-offset-4 hover:underline">
              Demanda {ficha.demanda}
            </Link>
            {subtitulo.map((parte) => (
              <span key={parte} className="contents">
                <span aria-hidden="true">·</span>
                <span>{parte}</span>
              </span>
            ))}
          </p>
          {conclusaoEmTexto(ficha) ? <p className="text-sm font-semibold text-foreground">{conclusaoEmTexto(ficha)}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={hrefDaFichaDaOs(ficha.numero)}>Ver OS</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={hrefDaImpressaoDaOs(ficha.numero)}>
              <Printer aria-hidden="true" className="size-4" />
              Imprimir
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
        <Conferencia titulo={`Fotos · ${fotos.length}`} ok={fotos.length > 0}>
          <div className="flex items-center gap-1.5">
            {fotos.slice(0, FOTOS_NO_RESUMO).map((foto) => (
              <span key={foto.id} className="flex size-11 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                {urls[foto.caminho] ? <img src={urls[foto.caminho]} alt={foto.legenda ?? `Foto das ${horaDe(foto.instante)}`} className="size-full object-cover" /> : <ImageIcon aria-hidden="true" className="size-4 text-muted-foreground" />}
              </span>
            ))}
            {fotos.length > FOTOS_NO_RESUMO ? (
              <Link href={hrefDaFichaDaOs(ficha.numero)} className="px-1 text-sm font-semibold text-primary hover:underline">
                +{fotos.length - FOTOS_NO_RESUMO}
              </Link>
            ) : null}
          </div>
        </Conferencia>
        <Conferencia titulo={ficha.conclusao?.aceite === "sem_aceite" ? "Sem aceite no local" : "Assinatura"} ok={ficha.conclusao?.aceite === "assinatura"}>
          {ficha.conclusao?.aceite === "assinatura" ? (
            <span className="flex h-12 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
              {assinatura ? <img src={assinatura} alt={`Assinatura de ${ficha.conclusao.responsavel.nome}`} className="h-full w-auto object-contain" /> : <ImageIcon aria-hidden="true" className="size-4 text-muted-foreground" />}
            </span>
          ) : null}
          {ficha.conclusao ? (
            <span className="text-xs text-muted-foreground">
              {ficha.conclusao.responsavel.nome} · {horaDe(ficha.conclusao.instante)}
            </span>
          ) : null}
        </Conferencia>
        <Conferencia titulo="Equipe e horários" ok>
          <span className="text-2xl font-bold tabular-nums text-foreground">{horas.real ?? "—"}</span>
          <span className="text-xs text-muted-foreground">{horas.detalhe}</span>
        </Conferencia>
        <Conferencia titulo="Itens com divergência" ok={divergentes.length === 0}>
          <span className={cn("text-2xl font-bold tabular-nums", divergentes.length ? "text-destructive" : "text-foreground")}>{divergentes.length}</span>
          {divergenciasEmTexto(linhas) ? <span className="text-xs text-muted-foreground">{divergenciasEmTexto(linhas)}</span> : null}
        </Conferencia>
      </div>

      <Cartao
        titulo="Itens · executado e saldo"
        acao={
          <Link href={hrefDaDemanda(ficha.demanda)} className="text-sm font-medium text-primary hover:underline">
            Escopo da demanda {ficha.demanda}
          </Link>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2.5">Item</th>
                <th className="px-2 py-2.5">Un</th>
                <th className="px-2 py-2.5 text-right">Planejado</th>
                <th className="px-2 py-2.5 text-right">Executado</th>
                <th className="px-2 py-2.5 text-right">Diferença</th>
                <th className="px-2 py-2.5 text-right">{direta ? "Pedido" : "Orçado"} na demanda</th>
                <th className="px-5 py-2.5 text-right">Saldo na demanda</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha) => {
                const saldo = saldoDepois(linha, form.linhas[linha.id]);
                return (
                  <tr key={linha.id} className="border-b border-border last:border-b-0">
                    <td className="px-5 py-2.5">
                      <span className="flex items-baseline gap-2">
                        {linha.codigo ? <span className="text-xs tabular-nums text-muted-foreground">{linha.codigo}</span> : null}
                        <span className="font-medium text-foreground">{linha.item}</span>
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-muted-foreground">{linha.unidade}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{quantidadeEmTexto(linha.planejado)}</td>
                    <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{quantidadeEmTexto(linha.executado)}</td>
                    <td className="px-2 py-2.5 text-right">
                      {linha.diferenca ? <span className={cn(selo, "border-destructive bg-card text-destructive")}>{comSinal(linha.diferenca)}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{linha.orcado !== null ? quantidadeEmTexto(linha.orcado) : "—"}</td>
                    <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{saldo !== null ? quantidadeEmTexto(saldo) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Cartao>

      {divergentes.length ? (
        <div className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            Divergências
            <span className={cn(selo, "border-destructive bg-card text-destructive")}>{divergentes.length}</span>
          </h2>
          {divergentes.map((linha) => (
            <Divergencia
              key={linha.id}
              linha={linha}
              direta={direta}
              decisao={form.linhas[linha.id]}
              onDecisao={(decisao) => onForm({ ...form, linhas: { ...form.linhas, [linha.id]: decisao } })}
            />
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-nota`}>Nota da revisão</Label>
        <textarea id={`${id}-nota`} rows={2} className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground" value={form.nota} onChange={(event) => onForm({ ...form, nota: event.target.value })} />
      </div>

      {problemas.length ? (
        <div role="alert">
          <ul className="flex flex-col gap-1 text-sm text-destructive">
            {problemas.map((problema) => (
              <li key={problema}>{problema}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {erro ? (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="button" onClick={onConcluir} disabled={ocupado}>
          <Check aria-hidden="true" className="size-4" />
          {pedeAditivo(form, linhas) ? "Concluir revisão e pedir aditivo" : "Concluir revisão"}
        </Button>
      </div>
    </div>
  );
}

export function RevisaoView({
  estado,
  cartoes,
  selecionada,
  os,
  form,
  onForm,
  problemas,
  erro,
  ocupado,
  onConcluir,
}: {
  estado: EstadoDaRevisao;
  cartoes: readonly CartaoParaRevisar[];
  selecionada: string | null;
  os: OsDaRevisao | null;
  form: FormularioDaRevisao | null;
  onForm: (form: FormularioDaRevisao) => void;
  problemas: readonly string[];
  erro: string | null;
  ocupado: boolean;
  onConcluir: () => void;
}) {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Revisão</h1>
      {estado === "carregando" ? <p className="text-sm text-muted-foreground">Carregando</p> : null}
      {estado === "erro" ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar as OS para revisar.
        </p>
      ) : null}
      {estado === "pronto" ? (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Lista cartoes={cartoes} selecionada={selecionada} />
          {os && form ? <OsDaVez os={os} form={form} onForm={onForm} problemas={problemas} erro={erro} ocupado={ocupado} onConcluir={onConcluir} /> : null}
        </div>
      ) : null}
    </section>
  );
}
