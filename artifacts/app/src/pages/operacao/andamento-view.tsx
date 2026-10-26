import { useId, type ReactNode } from "react";
import { FileSignature, ImagePlus, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AVULSO,
  tiposDeAndamento,
  TIPO_DE_ANDAMENTO_ROTULO,
  etapasPossiveis,
  fotosDoFinalNaOs,
  inclusaoVazia,
  itensAMenos,
  rotuloDaEtapa,
  type FormularioDeAndamento,
  type InclusaoNoFormulario,
} from "@/lib/operacao/andamento";
import { PAPEL_ROTULO } from "@/lib/operacao/cadastro";
import { MEIO_ROTULO, itensDaFicha, type EtapaDaOs, type FichaDaOs, type MeioDoEscritorio } from "@/lib/operacao/ficha-da-os";
import { cn } from "@/lib/utils";

/**
 * "Registrar andamento" na ficha da OS (parte 3.7e; docs/mockups/OpOS.dc.html):
 * a etapa, o feito dos itens (com o que passou do planejado), a ocorrência
 * com fotos ou a conclusão (parte 3.9c: a hora do fim, o motivo de cada item
 * a menos, as fotos do final e a via assinada no papel ou "sem aceite no
 * local"). Só apresentação: o formulário e o envio estão em
 * pages/operacao/os.tsx. Sem legenda e sem valor.
 */

/** As fotos do final e a assinatura escolhidas para a conclusão. */
export type AnexosNoPainel = {
  fotosDoFinal: readonly string[];
  /** O nome do arquivo da via assinada, ou null. */
  assinatura: string | null;
  onFotosDoFinal: (arquivos: File[]) => void;
  onTirarFotoDoFinal: (indice: number) => void;
  onAssinatura: (arquivo: File | null) => void;
};

const campoClasse = "flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground";

function Campo({ id, rotulo, children, className }: { id: string; rotulo: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

function Origem({ ficha, form, onForm, prefixo }: { ficha: FichaDaOs; form: FormularioDeAndamento; onForm: (form: FormularioDeAndamento) => void; prefixo: string }) {
  return (
    <>
      <Campo id={`${prefixo}-informado`} rotulo="Informado por">
        <select id={`${prefixo}-informado`} className={campoClasse} value={form.informadoPor} onChange={(event) => onForm({ ...form, informadoPor: event.target.value })}>
          <option value="">Ninguém da equipe</option>
          {ficha.equipe.map((pessoa) => (
            <option key={pessoa.id} value={pessoa.id}>
              {[pessoa.nome, pessoa.papel ? PAPEL_ROTULO[pessoa.papel] : null].filter(Boolean).join(" · ")}
            </option>
          ))}
        </select>
      </Campo>
      <Campo id={`${prefixo}-meio`} rotulo="Meio">
        <select id={`${prefixo}-meio`} className={campoClasse} value={form.meio} onChange={(event) => onForm({ ...form, meio: event.target.value as MeioDoEscritorio | "" })}>
          <option value="">Sem meio</option>
          {(Object.keys(MEIO_ROTULO) as MeioDoEscritorio[]).map((meio) => (
            <option key={meio} value={meio}>
              {MEIO_ROTULO[meio]}
            </option>
          ))}
        </select>
      </Campo>
    </>
  );
}

function Inclusao({
  ficha,
  inclusao,
  onInclusao,
}: {
  ficha: FichaDaOs;
  inclusao: InclusaoNoFormulario;
  onInclusao: (inclusao: InclusaoNoFormulario | null) => void;
}) {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
      <legend className="px-1 text-sm font-semibold text-foreground">Além do planejado</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo id={`${id}-linha`} rotulo="Item">
          <select id={`${id}-linha`} className={campoClasse} value={inclusao.linha} onChange={(event) => onInclusao({ ...inclusao, linha: event.target.value })}>
            {ficha.itens.map((item) => (
              <option key={item.id} value={item.id}>
                {item.item}
              </option>
            ))}
            <option value={AVULSO}>Item avulso</option>
          </select>
        </Campo>
        {inclusao.linha === AVULSO ? (
          <>
            <Campo id={`${id}-nome`} rotulo="Nome do item">
              <Input id={`${id}-nome`} value={inclusao.item} onChange={(event) => onInclusao({ ...inclusao, item: event.target.value })} />
            </Campo>
            <Campo id={`${id}-unidade`} rotulo="Unidade">
              <Input id={`${id}-unidade`} value={inclusao.unidade} onChange={(event) => onInclusao({ ...inclusao, unidade: event.target.value })} />
            </Campo>
          </>
        ) : null}
        <Campo id={`${id}-quantidade`} rotulo="Quantidade">
          <Input id={`${id}-quantidade`} inputMode="decimal" value={inclusao.quantidade} onChange={(event) => onInclusao({ ...inclusao, quantidade: event.target.value })} />
        </Campo>
        <Campo id={`${id}-pedido`} rotulo="Quem pediu no local">
          <Input id={`${id}-pedido`} value={inclusao.pedidoPor} onChange={(event) => onInclusao({ ...inclusao, pedidoPor: event.target.value })} />
        </Campo>
        <Campo id={`${id}-motivo`} rotulo="Motivo">
          <Input id={`${id}-motivo`} value={inclusao.motivo} onChange={(event) => onInclusao({ ...inclusao, motivo: event.target.value })} />
        </Campo>
      </div>
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => onInclusao(null)}>
        <X aria-hidden="true" className="size-4" />
        Tirar
      </Button>
    </fieldset>
  );
}

function Arquivos({ nomes, rotulo, multiplos = true, onEscolher, onTirar }: { nomes: readonly string[]; rotulo: string; multiplos?: boolean; onEscolher: (arquivos: File[]) => void; onTirar: (indice: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {nomes.map((nome, indice) => (
        <span key={nome} className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-muted pl-2.5 text-xs font-medium text-foreground">
          {nome}
          <button type="button" aria-label={`Tirar ${nome}`} onClick={() => onTirar(indice)} className="flex size-8 items-center justify-center rounded-md hover:bg-background">
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </span>
      ))}
      {multiplos || !nomes.length ? (
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted focus-within:ring-2 focus-within:ring-ring/40">
          <ImagePlus aria-hidden="true" className="size-4" />
          {rotulo}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple={multiplos}
            className="sr-only"
            onChange={(event) => {
              onEscolher(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </label>
      ) : null}
    </div>
  );
}

function Conclusao({ ficha, form, onForm, anexos, prefixo }: { ficha: FichaDaOs; form: FormularioDeAndamento; onForm: (form: FormularioDeAndamento) => void; anexos: AnexosNoPainel; prefixo: string }) {
  const aMenos = itensAMenos(ficha);
  const comAssinatura = form.aceite === "assinatura";
  const naOs = fotosDoFinalNaOs(ficha);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo id={`${prefixo}-data`} rotulo="Data do fim">
          <Input id={`${prefixo}-data`} type="date" value={form.data} onChange={(event) => onForm({ ...form, data: event.target.value })} />
        </Campo>
        <Campo id={`${prefixo}-hora`} rotulo="Hora do fim">
          <Input id={`${prefixo}-hora`} type="time" value={form.hora} onChange={(event) => onForm({ ...form, hora: event.target.value })} />
        </Campo>
        <Origem ficha={ficha} form={form} onForm={onForm} prefixo={prefixo} />
      </div>

      {aMenos.length ? (
        <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">Motivo dos itens a menos</legend>
          {aMenos.map((item) => (
            <Campo key={item.id} id={`${prefixo}-motivo-${item.id}`} rotulo={`${item.item} · ${String(item.feito / 1000)} de ${String(item.previsto / 1000)}`}>
              <Input
                id={`${prefixo}-motivo-${item.id}`}
                value={form.motivos[item.id] ?? ""}
                onChange={(event) => onForm({ ...form, motivos: { ...form.motivos, [item.id]: event.target.value } })}
              />
            </Campo>
          ))}
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">
          Fotos do final{naOs ? ` · ${naOs} na OS` : ""}
        </span>
        <Arquivos nomes={anexos.fotosDoFinal} rotulo="Anexar" onEscolher={anexos.onFotosDoFinal} onTirar={anexos.onTirarFotoDoFinal} />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium text-foreground">Aceite</legend>
        <div role="radiogroup" aria-label="Aceite" className="flex flex-wrap gap-2">
          {(
            [
              ["assinatura", "Via assinada no papel"],
              ["sem_aceite", "Sem aceite no local"],
            ] as const
          ).map(([aceite, rotulo]) => (
            <label
              key={aceite}
              className={cn(
                "inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-semibold focus-within:ring-2 focus-within:ring-ring/40",
                form.aceite === aceite ? "border-foreground bg-muted text-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <input type="radio" name={`${prefixo}-aceite`} className="sr-only" checked={form.aceite === aceite} onChange={() => onForm({ ...form, aceite })} />
              {rotulo}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo id={`${prefixo}-nome`} rotulo={comAssinatura ? "Responsável do cliente" : "Quem recebeu"}>
            <Input id={`${prefixo}-nome`} autoComplete="off" value={form.nome} onChange={(event) => onForm({ ...form, nome: event.target.value })} />
          </Campo>
          {comAssinatura ? (
            <Campo id={`${prefixo}-cargo`} rotulo="Cargo">
              <Input id={`${prefixo}-cargo`} autoComplete="off" value={form.cargo} onChange={(event) => onForm({ ...form, cargo: event.target.value })} />
            </Campo>
          ) : null}
        </div>
        {comAssinatura ? (
          <div className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              <FileSignature aria-hidden="true" className="size-4" />
              Via assinada
            </span>
            <Arquivos
              nomes={anexos.assinatura ? [anexos.assinatura] : []}
              rotulo="Anexar"
              multiplos={false}
              onEscolher={(arquivos) => anexos.onAssinatura(arquivos[0] ?? null)}
              onTirar={() => anexos.onAssinatura(null)}
            />
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}

export function AndamentoView({
  ficha,
  form,
  onForm,
  problemas,
  erro,
  ocupado,
  fotos,
  onFotos,
  onTirarFoto,
  anexos,
  onCancelar,
  onRegistrar,
}: {
  ficha: FichaDaOs;
  form: FormularioDeAndamento;
  onForm: (form: FormularioDeAndamento) => void;
  /** O que impede, depois da primeira tentativa. */
  problemas: readonly string[];
  erro: string | null;
  ocupado: boolean;
  /** Os nomes das fotos escolhidas para a ocorrência. */
  fotos: readonly string[];
  onFotos: (arquivos: File[]) => void;
  onTirarFoto: (indice: number) => void;
  /** As fotos do final e a via assinada da conclusão. */
  anexos: AnexosNoPainel;
  onCancelar: () => void;
  onRegistrar: () => void;
}) {
  const id = useId();
  const etapas = etapasPossiveis(ficha);
  const previstos = new Map(itensDaFicha(ficha).map((item) => [item.id, item.previsto]));
  return (
    <section aria-labelledby={`${id}-titulo`} className="flex flex-col gap-5 rounded-lg border border-foreground bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 id={`${id}-titulo`} className="text-base font-semibold text-foreground">
            Registrar andamento
          </h2>
          <span className="text-sm text-muted-foreground">escritório</span>
        </div>
        <div role="group" aria-label="O que registrar" className="inline-flex rounded-md bg-muted p-1">
          {tiposDeAndamento(ficha).map((tipo) => (
            <button
              key={tipo}
              type="button"
              aria-pressed={form.tipo === tipo}
              onClick={() => onForm({ ...form, tipo })}
              className={cn(
                "h-8 rounded px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                form.tipo === tipo ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {TIPO_DE_ANDAMENTO_ROTULO[tipo]}
            </button>
          ))}
        </div>
      </div>

      {form.tipo === "etapa" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Campo id={`${id}-etapa`} rotulo="Etapa">
            <select id={`${id}-etapa`} className={campoClasse} value={form.etapa} onChange={(event) => onForm({ ...form, etapa: event.target.value as EtapaDaOs | "" })}>
              {etapas.length ? null : <option value="">Todas registradas</option>}
              {etapas.map((etapa) => (
                <option key={etapa} value={etapa}>
                  {rotuloDaEtapa(etapa)}
                </option>
              ))}
            </select>
          </Campo>
          <Campo id={`${id}-data`} rotulo="Data">
            <Input id={`${id}-data`} type="date" value={form.data} onChange={(event) => onForm({ ...form, data: event.target.value })} />
          </Campo>
          <Campo id={`${id}-hora`} rotulo="Hora">
            <Input id={`${id}-hora`} type="time" value={form.hora} onChange={(event) => onForm({ ...form, hora: event.target.value })} />
          </Campo>
          <Origem ficha={ficha} form={form} onForm={onForm} prefixo={`${id}-etapa`} />
        </div>
      ) : null}

      {form.tipo === "itens" ? (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {ficha.itens.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                <Label htmlFor={`${id}-feito-${item.id}`} className="min-w-0 flex-1 text-sm font-medium text-foreground">
                  {item.item}
                </Label>
                <span className="flex items-center gap-2">
                  <Input
                    id={`${id}-feito-${item.id}`}
                    inputMode="decimal"
                    className="w-24 text-right tabular-nums"
                    value={form.feitos[item.id] ?? ""}
                    onChange={(event) => onForm({ ...form, feitos: { ...form.feitos, [item.id]: event.target.value } })}
                  />
                  <span className="w-16 text-sm tabular-nums text-muted-foreground">de {previstos.get(item.id)}</span>
                </span>
              </li>
            ))}
          </ul>
          {form.inclusao ? (
            <Inclusao ficha={ficha} inclusao={form.inclusao} onInclusao={(inclusao) => onForm({ ...form, inclusao })} />
          ) : (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onForm({ ...form, inclusao: inclusaoVazia(ficha) })}>
              <Plus aria-hidden="true" className="size-4" />
              Incluir além do planejado
            </Button>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-2xl">
            <Origem ficha={ficha} form={form} onForm={onForm} prefixo={`${id}-itens`} />
          </div>
        </div>
      ) : null}

      {form.tipo === "ocorrencia" ? (
        <div className="flex flex-col gap-4">
          <Campo id={`${id}-descricao`} rotulo="Descrição">
            <textarea
              id={`${id}-descricao`}
              rows={3}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground"
              value={form.descricao}
              onChange={(event) => onForm({ ...form, descricao: event.target.value })}
            />
          </Campo>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-2xl">
            <Origem ficha={ficha} form={form} onForm={onForm} prefixo={`${id}-ocorrencia`} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">Fotos</span>
            <Arquivos nomes={fotos} rotulo="Anexar" onEscolher={onFotos} onTirar={onTirarFoto} />
          </div>
        </div>
      ) : null}

      {form.tipo === "conclusao" ? <Conclusao ficha={ficha} form={form} onForm={onForm} anexos={anexos} prefixo={`${id}-conclusao`} /> : null}

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

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancelar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button type="button" onClick={onRegistrar} disabled={ocupado}>
          {form.tipo === "conclusao" ? "Concluir OS" : "Registrar"}
        </Button>
      </div>
    </section>
  );
}
