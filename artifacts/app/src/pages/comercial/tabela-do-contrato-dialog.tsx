import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAXIMO_DE_ITENS_DA_TABELA,
  formDaTabela,
  itemDaTabelaVazio,
  problemasDaTabela,
  type FormDaTabela,
  type ItemDaTabelaForm,
} from "@/lib/comercial/tabela-do-contrato";

type MudaFormulario = (muda: (atual: FormDaTabela) => FormDaTabela) => void;

function Campo({ id, rotulo, children }: { id: string; rotulo: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-1.5"><Label htmlFor={id}>{rotulo}</Label>{children}</div>;
}

/** Editor manual; a página envia o formulário pela callable com a intenção do diálogo. */
export function CamposDaTabela({ form, ocupado, onForm, onAdicionar }: {
  form: FormDaTabela;
  ocupado: boolean;
  onForm: MudaFormulario;
  onAdicionar: () => void;
}) {
  function mudar(campo: Exclude<keyof FormDaTabela, "itens">, valor: string) {
    onForm((atual) => ({ ...atual, [campo]: valor }));
  }
  function mudarItem(chave: string, campo: Exclude<keyof ItemDaTabelaForm, "chave">, valor: string) {
    onForm((atual) => ({ ...atual, itens: atual.itens.map((item) => item.chave === chave ? { ...item, [campo]: valor } : item) }));
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="tabela-nome" rotulo="Nome">
          <Input id="tabela-nome" value={form.nome} onChange={(event) => mudar("nome", event.target.value)} maxLength={120} disabled={ocupado} autoComplete="off" />
        </Campo>
        <Campo id="tabela-codigo" rotulo="Código da tabela (opcional)">
          <Input id="tabela-codigo" value={form.codigo} onChange={(event) => mudar("codigo", event.target.value)} maxLength={40} disabled={ocupado} autoComplete="off" />
        </Campo>
        <Campo id="tabela-variante" rotulo="Variante">
          <Input id="tabela-variante" value={form.variante} onChange={(event) => mudar("variante", event.target.value)} maxLength={40} disabled={ocupado} />
        </Campo>
        <div className="grid grid-cols-2 gap-4">
          <Campo id="tabela-inicio" rotulo="Início (opcional)">
            <Input id="tabela-inicio" type="date" value={form.vigenteDe} onChange={(event) => mudar("vigenteDe", event.target.value)} disabled={ocupado} />
          </Campo>
          <Campo id="tabela-fim" rotulo="Fim (opcional)">
            <Input id="tabela-fim" type="date" value={form.vigenteAte} onChange={(event) => mudar("vigenteAte", event.target.value)} disabled={ocupado} />
          </Campo>
        </div>
      </div>
      <section aria-label="Itens" className="grid gap-3">
        <h3 className="text-sm font-extrabold uppercase tracking-wider">Itens</h3>
        {form.itens.map((item, index) => {
          const prefixo = `tabela-item-${item.chave}`;
          return (
            <fieldset key={item.chave} className="grid gap-3 rounded-lg border border-border p-4">
              <legend className="px-1 text-xs font-extrabold uppercase tracking-wider">Item {index + 1}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo id={`${prefixo}-codigo`} rotulo="Código">
                  <Input id={`${prefixo}-codigo`} value={item.codigo} onChange={(event) => mudarItem(item.chave, "codigo", event.target.value)} maxLength={40} disabled={ocupado} />
                </Campo>
                <Campo id={`${prefixo}-descricao`} rotulo="Descrição">
                  <Input id={`${prefixo}-descricao`} value={item.descricao} onChange={(event) => mudarItem(item.chave, "descricao", event.target.value)} maxLength={500} disabled={ocupado} />
                </Campo>
                <Campo id={`${prefixo}-unidade`} rotulo="Unidade">
                  <Input id={`${prefixo}-unidade`} value={item.unidade} onChange={(event) => mudarItem(item.chave, "unidade", event.target.value)} maxLength={20} disabled={ocupado} />
                </Campo>
                <Campo id={`${prefixo}-preco`} rotulo="Preço unitário">
                  <Input id={`${prefixo}-preco`} value={item.preco} onChange={(event) => mudarItem(item.chave, "preco", event.target.value)} inputMode="decimal" disabled={ocupado} />
                </Campo>
              </div>
              <Button
                type="button" variant="ghost" size="sm" className="justify-self-end" disabled={ocupado}
                onClick={() => onForm((atual) => ({ ...atual, itens: atual.itens.filter((linha) => linha.chave !== item.chave) }))}
              >
                <X aria-hidden="true" />
                Remover item {index + 1}
              </Button>
            </fieldset>
          );
        })}
        <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={onAdicionar} disabled={ocupado || form.itens.length >= MAXIMO_DE_ITENS_DA_TABELA}>
          <Plus aria-hidden="true" />
          Adicionar item
        </Button>
      </section>
    </>
  );
}

export function TabelaDoContratoDialog({ aberto, contratoNome, inicioDoContrato, ocupado, erro, onCancelar, onSalvar }: {
  aberto: boolean;
  contratoNome: string;
  inicioDoContrato: string;
  ocupado: boolean;
  erro: string | null;
  onCancelar: () => void;
  onSalvar: (form: FormDaTabela) => void;
}) {
  const [form, setForm] = useState(formDaTabela);
  const [problema, setProblema] = useState<string | null>(null);
  const proximaLinha = useRef(2);
  useEffect(() => {
    if (!aberto) return;
    setForm(formDaTabela());
    setProblema(null);
    proximaLinha.current = 2;
  }, [aberto]);

  const onForm: MudaFormulario = (muda) => {
    setProblema(null);
    setForm(muda);
  };

  return (
    <Dialog open={aberto} onOpenChange={(open) => { if (!open && !ocupado) onCancelar(); }}>
      <DialogContent className="v3 max-h-screen max-w-4xl overflow-y-auto" onEscapeKeyDown={(event) => { if (ocupado) event.preventDefault(); }} onPointerDownOutside={(event) => { if (ocupado) event.preventDefault(); }}>
        <form className="grid gap-4" onSubmit={(event) => {
          event.preventDefault();
          if (ocupado) return;
          const problemas = problemasDaTabela(form, inicioDoContrato);
          if (problemas.length) setProblema(problemas.join(" "));
          else onSalvar(form);
        }}>
          <DialogHeader>
            <DialogTitle>Adicionar tabela</DialogTitle>
            <DialogDescription className="sr-only">{contratoNome}</DialogDescription>
          </DialogHeader>
          <CamposDaTabela form={form} ocupado={ocupado} onForm={onForm} onAdicionar={() => {
            const chave = String(proximaLinha.current++);
            onForm((atual) => ({ ...atual, itens: [...atual.itens, itemDaTabelaVazio(chave)] }));
          }} />
          {problema || erro ? <p role="alert" className="rounded-md border border-destructive-soft-border bg-destructive-soft px-3 py-2 text-sm font-semibold text-destructive-soft-foreground">{problema || erro}</p> : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onCancelar} disabled={ocupado}>Cancelar</Button>
            <Button type="submit" disabled={ocupado}>{ocupado ? "Salvando..." : "Salvar tabela"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
