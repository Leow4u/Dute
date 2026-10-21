import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { novaChave } from "@/lib/comercial/api";
import type { Carga } from "@/lib/comercial/clientes";
import { buscarItensDaTabela, catalogoDaTabela, type ItemDoCatalogoDoc } from "@/lib/comercial/montar";
import {
  DIA_TIPOS,
  JANELAS,
  itemAvulso,
  itemComPrecoAlterado,
  itemComPrecoDaTabela,
  itemDeTabela,
  problemasDaLinha,
  rotuloDoDia,
  tabelaParaALinha,
  type Anexo,
  type DiaTipo,
  type FormItem,
  type FormLinha,
  type Janela,
  type LinhaDaMedicao,
  type TabelaDaLinha,
} from "@/lib/comercial/medicoes";
import { dataHoraLocal, instanteComFuso } from "@/lib/comercial/montar";

/**
 * Diálogos da aba Medições: a linha (incluir, editar e retirar a OS, por
 * saveMedicao), o anexo do pedido, e o registro da aprovação e da
 * contestação do cliente (advanceMedicao). Cada um só monta e confere o
 * formulário (as mesmas regras que a callable confere de novo); a gravação,
 * com a chave de idempotência e a edição que a tela viu, é da página. Os
 * diálogos abrem fora do contêiner da tela (portal), então levam a classe .v3.
 */

const CAMPO_SELECT =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-50";

type BaseProps = {
  aberto: boolean;
  ocupado: boolean;
  erro: string | null;
  onCancelar: () => void;
};

function Campo({ id, rotulo, children, className }: { id: string; rotulo: string; children: ReactNode; className?: string }) {
  return (
    <div className={className ? `min-w-0 space-y-1.5 ${className}` : "min-w-0 space-y-1.5"}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

function Erro({ erro }: { erro: string | null }) {
  if (!erro) return null;
  return (
    <p role="alert" className="rounded-md border border-destructive-soft-border bg-destructive-soft px-3 py-2 text-sm font-semibold text-destructive-soft-foreground">
      {erro}
    </p>
  );
}

function Problemas({ problemas }: { problemas: readonly string[] }) {
  if (problemas.length === 0) return null;
  return (
    <ul role="alert" className="grid gap-1 rounded-md border border-destructive-soft-border bg-destructive-soft px-3 py-2 text-sm font-semibold text-destructive-soft-foreground">
      {problemas.map((problema) => (
        <li key={problema}>{problema}</li>
      ))}
    </ul>
  );
}

// --- Linha ---------------------------------------------------------------------------------------

const ROTULO_DA_JANELA: Record<Janela, string> = { diurna: "Diurna", noturna: "Noturna" };

function ItemDaLinha({
  item,
  indice,
  disabled,
  precoDaTabela,
  onChange,
  onRemover,
}: {
  item: FormItem;
  indice: number;
  disabled: boolean;
  /** O preço do item na tabela da data, para partir dele ao alterar. */
  precoDaTabela: string | null;
  onChange: (item: FormItem) => void;
  onRemover: () => void;
}) {
  const muda = (campo: "quantidade" | "preco" | "motivo" | "descricao") => (event: { target: { value: string } }) =>
    onChange({ ...item, [campo]: event.target.value });
  const id = `medicao-item-${indice}`;
  return (
    <li className="grid gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {item.origem === "avulso" ? (
          <div className="min-w-0 flex-1 basis-56 space-y-1.5">
            <Label htmlFor={`${id}-descricao`}>Item avulso</Label>
            <Input id={`${id}-descricao`} value={item.descricao} maxLength={300} onChange={muda("descricao")} disabled={disabled} />
          </div>
        ) : (
          <b className="min-w-0 flex-1 basis-56 text-sm font-bold">{item.rotulo}</b>
        )}
        <div className="w-28 space-y-1.5">
          <Label htmlFor={`${id}-quantidade`}>Quantidade</Label>
          <Input id={`${id}-quantidade`} inputMode="decimal" value={item.quantidade} onChange={muda("quantidade")} disabled={disabled} />
        </div>
        {item.origem === "tabela" ? (
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange(itemComPrecoAlterado(item, precoDaTabela))}>
            Alterar preço
          </Button>
        ) : null}
        {item.origem === "alterado" ? (
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange(itemComPrecoDaTabela(item))}>
            Voltar ao preço da tabela
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon" aria-label={`Retirar item ${indice + 1}`} disabled={disabled} onClick={onRemover}>
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      {item.origem !== "tabela" ? (
        <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <Campo id={`${id}-preco`} rotulo="Preço unitário">
            <Input id={`${id}-preco`} inputMode="decimal" value={item.preco} onChange={muda("preco")} disabled={disabled} />
          </Campo>
          <Campo id={`${id}-motivo`} rotulo="Motivo">
            <Input id={`${id}-motivo`} value={item.motivo} maxLength={300} onChange={muda("motivo")} disabled={disabled} />
          </Campo>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Incluir ou editar a OS do mês (saveMedicao upsert_line). `inicial` é a
 * linha de quando o diálogo abriu: o formulário não se refaz a cada
 * snapshot. A busca do item usa a tabela do contrato vigente na data da
 * solicitação (a mesma regra do servidor, que é quem precifica).
 */
export function LinhaDialog({
  aberto,
  ocupado,
  erro,
  onCancelar,
  inicial,
  competencia,
  hoje,
  variante,
  tabelas,
  catalogo,
  onSalvar,
  onRetirar,
}: BaseProps & {
  inicial: FormLinha | null;
  competencia: string;
  hoje: string;
  variante: string;
  tabelas: Carga<TabelaDaLinha>;
  catalogo: Map<string, ItemDoCatalogoDoc> | "carregando" | "erro";
  onSalvar: (form: FormLinha) => void;
  /** Só ao editar uma linha gravada. */
  onRetirar?: () => void;
}) {
  const [form, setForm] = useState<FormLinha | null>(inicial);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [termo, setTermo] = useState("");
  const [confirmaRetirada, setConfirmaRetirada] = useState(false);
  useEffect(() => {
    if (aberto) {
      setForm(inicial);
      setProblemas([]);
      setTermo("");
      setConfirmaRetirada(false);
    }
  }, [aberto, inicial]);

  const tabela = useMemo(
    () =>
      form && Array.isArray(tabelas)
        ? tabelaParaALinha(tabelas, form.solicitadaEm || form.executadaEm || hoje, form.janela, variante)
        : null,
    [form, tabelas, hoje, variante],
  );
  const itensDaTabela = useMemo(() => (tabela && catalogo instanceof Map ? catalogoDaTabela(tabela.precos, catalogo) : []), [tabela, catalogo]);
  const achados = useMemo(() => (termo.trim() ? buscarItensDaTabela(itensDaTabela, termo, 6) : []), [itensDaTabela, termo]);

  if (!form) return null;
  const muda = (campo: keyof FormLinha) => (event: { target: { value: string } }) =>
    setForm((atual) => (atual ? { ...atual, [campo]: event.target.value } : atual));
  const editando = form.id !== null;
  const semTabela = Array.isArray(tabelas) && !tabela;

  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open && !ocupado ? onCancelar() : undefined)}>
      <DialogContent className="v3 max-h-[90vh] max-w-3xl overflow-y-auto">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const achadosNoForm = problemasDaLinha(form, competencia, hoje);
            setProblemas(achadosNoForm);
            if (achadosNoForm.length === 0) onSalvar(form);
          }}
        >
          <DialogHeader>
            <DialogTitle>{editando ? `Editar ${form.os || "OS"}` : "Nova linha"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-3">
            <Campo id="medicao-os" rotulo="OS">
              <Input id="medicao-os" value={form.os} maxLength={60} onChange={muda("os")} disabled={ocupado} />
            </Campo>
            <Campo id="medicao-demanda" rotulo="Demanda (número)">
              <Input id="medicao-demanda" inputMode="numeric" value={form.demanda} maxLength={8} onChange={muda("demanda")} disabled={ocupado} />
            </Campo>
            <Campo id="medicao-area" rotulo="Área solicitante">
              <Input id="medicao-area" value={form.area} maxLength={60} onChange={muda("area")} disabled={ocupado} />
            </Campo>
            <Campo id="medicao-solicitada" rotulo="Solicitada em">
              <Input id="medicao-solicitada" type="date" value={form.solicitadaEm} onChange={muda("solicitadaEm")} disabled={ocupado} />
            </Campo>
            <Campo id="medicao-executada" rotulo="Executada em">
              <Input id="medicao-executada" type="date" value={form.executadaEm} onChange={muda("executadaEm")} disabled={ocupado} />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo id="medicao-dia" rotulo="Dia da tarifa">
                <select
                  id="medicao-dia"
                  value={form.diaTipo}
                  onChange={(event) => setForm({ ...form, diaTipo: event.target.value as "" | DiaTipo })}
                  disabled={ocupado}
                  className={CAMPO_SELECT}
                >
                  <option value="">Pela data</option>
                  {DIA_TIPOS.map((dia) => (
                    <option key={dia} value={dia}>
                      {rotuloDoDia(dia)}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo id="medicao-janela" rotulo="Janela">
                <select
                  id="medicao-janela"
                  value={form.janela}
                  onChange={(event) => setForm({ ...form, janela: event.target.value as Janela })}
                  disabled={ocupado}
                  className={CAMPO_SELECT}
                >
                  {JANELAS.map((janela) => (
                    <option key={janela} value={janela}>
                      {ROTULO_DA_JANELA[janela]}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <Campo id="medicao-origem" rotulo="Origem" className="sm:col-span-1">
              <Input id="medicao-origem" value={form.origem} maxLength={160} onChange={muda("origem")} disabled={ocupado} />
            </Campo>
            <Campo id="medicao-destino" rotulo="Destino">
              <Input id="medicao-destino" value={form.destino} maxLength={160} onChange={muda("destino")} disabled={ocupado} />
            </Campo>
            <Campo id="medicao-mercadoria" rotulo="Mercadoria">
              <Input id="medicao-mercadoria" value={form.mercadoria} maxLength={300} onChange={muda("mercadoria")} disabled={ocupado} />
            </Campo>
          </div>

          <fieldset className="grid gap-3 rounded-lg border border-border p-4">
            <legend className="px-1 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Itens</legend>
            {form.itens.length > 0 ? (
              <ul className="grid gap-3">
                {form.itens.map((item, indice) => (
                  <ItemDaLinha
                    key={item.chave}
                    item={item}
                    indice={indice}
                    disabled={ocupado}
                    precoDaTabela={itensDaTabela.find((candidato) => candidato.lpuItemId === item.lpuItemId)?.preco ?? null}
                    onChange={(proximo) => setForm({ ...form, itens: form.itens.map((atual, i) => (i === indice ? proximo : atual)) })}
                    onRemover={() => setForm({ ...form, itens: form.itens.filter((_, i) => i !== indice) })}
                  />
                ))}
              </ul>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="medicao-busca">Item da tabela</Label>
              <Input
                id="medicao-busca"
                placeholder="Código, nome ou descrição"
                value={termo}
                onChange={(event) => setTermo(event.target.value)}
                disabled={ocupado || catalogo === "carregando" || semTabela}
              />
              {catalogo === "erro" ? <p className="text-xs font-semibold text-destructive-soft-foreground">Não foi possível carregar o catálogo.</p> : null}
              {semTabela ? (
                <p className="text-xs font-semibold text-muted-foreground">Sem tabela do contrato na data da solicitação: só item avulso.</p>
              ) : null}
              {achados.length > 0 ? (
                <ul className="grid gap-1" aria-label="Itens encontrados">
                  {achados.map((achado) => (
                    <li key={achado.lpuItemId}>
                      <button
                        type="button"
                        onClick={() => {
                          setForm({ ...form, itens: [...form.itens, itemDeTabela(achado, novaChave())] });
                          setTermo("");
                        }}
                        className="flex w-full items-baseline justify-between gap-3 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface-hover"
                      >
                        <span className="min-w-0 font-semibold">
                          {achado.codigo ? `${achado.codigo} · ` : ""}
                          {achado.descricao || achado.item}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              disabled={ocupado}
              onClick={() => setForm({ ...form, itens: [...form.itens, itemAvulso(novaChave())] })}
            >
              <Plus aria-hidden="true" />
              Item avulso
            </Button>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="medicao-anexo-nome" rotulo="Pedido anexado (nome)">
              <Input id="medicao-anexo-nome" value={form.anexoNome} maxLength={200} onChange={muda("anexoNome")} disabled={ocupado} />
            </Campo>
            <Campo id="medicao-anexo-referencia" rotulo="Onde está (e-mail ou pasta)">
              <Input id="medicao-anexo-referencia" value={form.anexoReferencia} maxLength={500} onChange={muda("anexoReferencia")} disabled={ocupado} />
            </Campo>
          </div>

          <Problemas problemas={problemas} />
          <Erro erro={erro} />
          <DialogFooter className="gap-2 sm:justify-between">
            {editando && onRetirar ? (
              confirmaRetirada ? (
                <span className="flex flex-wrap gap-2">
                  <Button type="button" variant="destructive" onClick={onRetirar} disabled={ocupado}>
                    Confirmar retirada
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setConfirmaRetirada(false)} disabled={ocupado}>
                    Manter
                  </Button>
                </span>
              ) : (
                <Button type="button" variant="destructive" onClick={() => setConfirmaRetirada(true)} disabled={ocupado}>
                  Retirar OS
                </Button>
              )
            ) : (
              <span />
            )}
            <span className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={onCancelar} disabled={ocupado}>
                Cancelar
              </Button>
              <Button type="submit" disabled={ocupado}>
                {ocupado ? "Salvando..." : "Salvar"}
              </Button>
            </span>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Anexo -----------------------------------------------------------------------------------------

/** O pedido da linha: o nome e a referência (o e-mail ou a pasta). Os PDFs não ficam no Storage no v1. */
export function AnexoDialog({
  aberto,
  ocupado,
  erro,
  onCancelar,
  linha,
  onSalvar,
}: BaseProps & { linha: LinhaDaMedicao | null; onSalvar: (anexo: Anexo) => void }) {
  const [nome, setNome] = useState("");
  const [referencia, setReferencia] = useState("");
  useEffect(() => {
    if (aberto && linha) {
      setNome(linha.anexo?.nome ?? `${linha.os}.pdf`);
      setReferencia(linha.anexo?.referencia ?? "");
    }
  }, [aberto, linha]);
  if (!linha) return null;
  const pronto = nome.trim().length > 0 && referencia.trim().length > 0;
  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open && !ocupado ? onCancelar() : undefined)}>
      <DialogContent className="v3 max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (pronto) onSalvar({ nome: nome.trim(), referencia: referencia.trim() });
          }}
        >
          <DialogHeader>
            <DialogTitle>Anexar pedido · {linha.os}</DialogTitle>
          </DialogHeader>
          <Campo id="anexo-nome" rotulo="Nome do arquivo">
            <Input id="anexo-nome" value={nome} maxLength={200} onChange={(event) => setNome(event.target.value)} disabled={ocupado} />
          </Campo>
          <Campo id="anexo-referencia" rotulo="Onde está (e-mail ou pasta)">
            <Input id="anexo-referencia" value={referencia} maxLength={500} onChange={(event) => setReferencia(event.target.value)} disabled={ocupado} />
          </Campo>
          <Erro erro={erro} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onCancelar} disabled={ocupado}>
              Cancelar
            </Button>
            <Button type="submit" disabled={ocupado || !pronto}>
              {ocupado ? "Salvando..." : "Anexar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Aprovação e contestação do cliente ---------------------------------------------------------------

function agoraLocal(): string {
  return dataHoraLocal(new Date().toISOString());
}

/** Quando o cliente respondeu: a hora de São Paulo, com o fuso que a callable pede. */
function QuandoRespondeu({ valor, onChange, disabled, id }: { valor: string; onChange: (valor: string) => void; disabled: boolean; id: string }) {
  return (
    <Campo id={id} rotulo="Quando o cliente respondeu">
      <Input id={id} type="datetime-local" value={valor} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
    </Campo>
  );
}

/** Registrar a aprovação do cliente (advanceMedicao approve): o link do e-mail ou do portal e quando. */
export function AprovarDialog({ aberto, ocupado, erro, onCancelar, onConfirmar }: BaseProps & { onConfirmar: (resposta: { link: string; em: string }) => void }) {
  const [link, setLink] = useState("");
  const [quando, setQuando] = useState("");
  const [problema, setProblema] = useState<string | null>(null);
  useEffect(() => {
    if (aberto) {
      setLink("");
      setQuando(agoraLocal());
      setProblema(null);
    }
  }, [aberto]);
  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open && !ocupado ? onCancelar() : undefined)}>
      <DialogContent className="v3 max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const em = instanteComFuso(quando);
            if (!em) return setProblema("Informe quando o cliente aprovou.");
            if (link.trim() && !/^https?:\/\/\S+$/i.test(link.trim())) return setProblema("O link começa com https://.");
            setProblema(null);
            onConfirmar({ link: link.trim(), em });
          }}
        >
          <DialogHeader>
            <DialogTitle>Registrar aprovação</DialogTitle>
          </DialogHeader>
          <QuandoRespondeu id="aprovar-quando" valor={quando} onChange={setQuando} disabled={ocupado} />
          <Campo id="aprovar-link" rotulo="Link do e-mail ou do portal">
            <Input id="aprovar-link" inputMode="url" placeholder="https://" value={link} maxLength={2000} onChange={(event) => setLink(event.target.value)} disabled={ocupado} />
          </Campo>
          <Problemas problemas={problema ? [problema] : []} />
          <Erro erro={erro} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onCancelar} disabled={ocupado}>
              Cancelar
            </Button>
            <Button type="submit" disabled={ocupado}>
              {ocupado ? "Registrando..." : "Registrar aprovação"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Registrar a contestação do cliente (advanceMedicao contest): o que ele contestou, que fica na medição. */
export function ContestarDialog({ aberto, ocupado, erro, onCancelar, onConfirmar }: BaseProps & { onConfirmar: (resposta: { nota: string; em: string }) => void }) {
  const [nota, setNota] = useState("");
  const [quando, setQuando] = useState("");
  const [problema, setProblema] = useState<string | null>(null);
  useEffect(() => {
    if (aberto) {
      setNota("");
      setQuando(agoraLocal());
      setProblema(null);
    }
  }, [aberto]);
  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open && !ocupado ? onCancelar() : undefined)}>
      <DialogContent className="v3 max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const em = instanteComFuso(quando);
            if (!em) return setProblema("Informe quando o cliente contestou.");
            if (!nota.trim()) return setProblema("Informe o que o cliente contestou.");
            setProblema(null);
            onConfirmar({ nota: nota.trim(), em });
          }}
        >
          <DialogHeader>
            <DialogTitle>Registrar contestação</DialogTitle>
          </DialogHeader>
          <QuandoRespondeu id="contestar-quando" valor={quando} onChange={setQuando} disabled={ocupado} />
          <Campo id="contestar-nota" rotulo="O que o cliente contestou">
            <Textarea id="contestar-nota" rows={4} value={nota} maxLength={1000} onChange={(event) => setNota(event.target.value)} disabled={ocupado} />
          </Campo>
          <Problemas problemas={problema ? [problema] : []} />
          <Erro erro={erro} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onCancelar} disabled={ocupado}>
              Cancelar
            </Button>
            <Button type="submit" disabled={ocupado || !nota.trim()}>
              {ocupado ? "Registrando..." : "Registrar contestação"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
