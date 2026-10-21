import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PAPEIS_DO_CONTATO,
  PAPEL_DO_CONTATO_ROTULO,
  UFS,
  formDaEdicao,
  formDoContato,
  formDoLocal,
  nomesParecidos,
  problemaDoCodigo,
  type AvisoDaIdentidade,
  type CadastroComercial,
  type ContatoResumo,
  type FormContato,
  type FormEdicao,
  type FormLocal,
  type FormNovoProspect,
  type LocalResumo,
} from "@/lib/comercial/clientes";
import { sugerirCodigo } from "@/lib/comercial/codigo";

/**
 * Diálogos da tela de Clientes e prospects. Cada um só monta o formulário; a
 * gravação (callable com chave de idempotência) é da página. Os diálogos
 * abrem fora do contêiner da tela (portal), então levam a classe .v3.
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

function Aviso({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-md border border-warning-soft-border bg-warning-soft px-3 py-2 text-sm font-semibold text-warning-soft-foreground">
      {children}
    </p>
  );
}

function SelectUf({ id, value, onChange, disabled }: { id: string; value: string; onChange: (uf: string) => void; disabled: boolean }) {
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={CAMPO_SELECT}>
      <option value="">—</option>
      {UFS.map((uf) => (
        <option key={uf} value={uf}>
          {uf}
        </option>
      ))}
    </select>
  );
}

function Rodape({ ocupado, rotulo, onCancelar, desabilitado }: { ocupado: boolean; rotulo: string; onCancelar: () => void; desabilitado: boolean }) {
  return (
    <DialogFooter className="gap-2">
      <Button type="button" variant="outline" onClick={onCancelar} disabled={ocupado}>
        Cancelar
      </Button>
      <Button type="submit" disabled={ocupado || desabilitado}>
        {ocupado ? "Salvando..." : rotulo}
      </Button>
    </DialogFooter>
  );
}

// --- Novo prospect ------------------------------------------------------------------

const PROSPECT_VAZIO = { nome: "", codigo: "", codigoTocado: false, cnpj: "", cidade: "", uf: "" };

export function NovoProspectDialog({
  aberto,
  ocupado,
  erro,
  onCancelar,
  cadastros,
  onSalvar,
}: BaseProps & { cadastros: CadastroComercial[]; onSalvar: (form: FormNovoProspect) => void }) {
  const [form, setForm] = useState(PROSPECT_VAZIO);
  useEffect(() => {
    if (aberto) setForm(PROSPECT_VAZIO);
  }, [aberto]);

  // O código acompanha o nome até ser editado; depois da criação não muda mais.
  const codigo = form.codigoTocado ? form.codigo.toUpperCase() : sugerirCodigo(form.nome);
  const problema = problemaDoCodigo(codigo);
  const parecidos = form.nome.trim().length >= 2 ? nomesParecidos(form.nome, cadastros) : [];
  const valido = form.nome.trim().length >= 2 && Boolean(codigo) && !problema;

  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open && !ocupado ? onCancelar() : undefined)}>
      <DialogContent className="v3 max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valido) onSalvar({ nome: form.nome, codigo, cnpj: form.cnpj, cidade: form.cidade, uf: form.uf });
          }}
        >
          <DialogHeader>
            <DialogTitle>Novo prospect</DialogTitle>
          </DialogHeader>
          <Campo id="prospect-nome" rotulo="Nome">
            <Input
              id="prospect-nome"
              value={form.nome}
              onChange={(event) => setForm((atual) => ({ ...atual, nome: event.target.value }))}
              maxLength={120}
              autoComplete="off"
              required
            />
          </Campo>
          {parecidos.length ? (
            <Aviso>
              Nome parecido no cadastro:{" "}
              {parecidos
                .map((cadastro) => `${cadastro.nome} (${cadastro.estagio === "prospect" ? "prospect" : "cliente"})`)
                .join(", ")}
            </Aviso>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="prospect-codigo" rotulo="Código">
              <Input
                id="prospect-codigo"
                value={codigo}
                onChange={(event) =>
                  setForm((atual) => ({ ...atual, codigo: event.target.value.toUpperCase(), codigoTocado: true }))
                }
                maxLength={20}
                autoComplete="off"
                aria-invalid={Boolean(problema)}
              />
            </Campo>
            <Campo id="prospect-cnpj" rotulo="CNPJ">
              <Input
                id="prospect-cnpj"
                value={form.cnpj}
                onChange={(event) => setForm((atual) => ({ ...atual, cnpj: event.target.value }))}
                maxLength={20}
                inputMode="text"
                autoComplete="off"
              />
            </Campo>
            <Campo id="prospect-cidade" rotulo="Cidade">
              <Input
                id="prospect-cidade"
                value={form.cidade}
                onChange={(event) => setForm((atual) => ({ ...atual, cidade: event.target.value }))}
                maxLength={80}
              />
            </Campo>
            <Campo id="prospect-uf" rotulo="UF">
              <SelectUf id="prospect-uf" value={form.uf} onChange={(uf) => setForm((atual) => ({ ...atual, uf }))} disabled={ocupado} />
            </Campo>
          </div>
          {problema ? <Erro erro={problema} /> : null}
          <Erro erro={erro} />
          <Rodape ocupado={ocupado} rotulo="Criar prospect" onCancelar={onCancelar} desabilitado={!valido} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Editar cadastro ----------------------------------------------------------------

/**
 * `cadastro` é o de quando o diálogo abriu (a página o guarda): uma mudança
 * em `customers` enquanto a pessoa digita não refaz o formulário, e o envio
 * leva só o que mudou desde a abertura.
 */
export function EditarCadastroDialog({
  aberto,
  ocupado,
  erro,
  onCancelar,
  cadastro,
  aviso,
  onSalvar,
}: BaseProps & { cadastro: CadastroComercial | null; aviso: AvisoDaIdentidade; onSalvar: (form: FormEdicao) => void }) {
  const [form, setForm] = useState<FormEdicao>({ nome: "", razaoSocial: "", cnpj: "", cidade: "", uf: "" });
  useEffect(() => {
    if (aberto && cadastro) setForm(formDaEdicao(cadastro));
  }, [aberto, cadastro]);
  if (!cadastro) return null;
  const identidade = !cadastro.armazenagem;
  const valido = !identidade || form.nome.trim().length >= 2;
  const muda = (campo: keyof FormEdicao) => (event: { target: { value: string } }) =>
    setForm((atual) => ({ ...atual, [campo]: event.target.value }));

  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open && !ocupado ? onCancelar() : undefined)}>
      <DialogContent className="v3 max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valido) onSalvar(form);
          }}
        >
          <DialogHeader>
            <DialogTitle>{cadastro.nome}</DialogTitle>
            <DialogDescription>Código {cadastro.code}</DialogDescription>
          </DialogHeader>
          {identidade ? (
            <>
              <Campo id="cadastro-nome" rotulo="Nome">
                <Input id="cadastro-nome" value={form.nome} onChange={muda("nome")} maxLength={120} required />
              </Campo>
              <Campo id="cadastro-razao" rotulo="Razão social">
                <Input id="cadastro-razao" value={form.razaoSocial} onChange={muda("razaoSocial")} maxLength={160} />
              </Campo>
              <Campo id="cadastro-cnpj" rotulo="CNPJ">
                <Input id="cadastro-cnpj" value={form.cnpj} onChange={muda("cnpj")} maxLength={20} autoComplete="off" />
              </Campo>
            </>
          ) : (
            <Aviso>
              {aviso.texto}
              {aviso.link ? (
                <>
                  {" "}
                  <Link href={aviso.link.href} className="underline underline-offset-4">
                    {aviso.link.rotulo}
                  </Link>
                  .
                </>
              ) : null}
            </Aviso>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="cadastro-cidade" rotulo="Cidade">
              <Input id="cadastro-cidade" value={form.cidade} onChange={muda("cidade")} maxLength={80} />
            </Campo>
            <Campo id="cadastro-uf" rotulo="UF">
              <SelectUf id="cadastro-uf" value={form.uf} onChange={(uf) => setForm((atual) => ({ ...atual, uf }))} disabled={ocupado} />
            </Campo>
          </div>
          <Erro erro={erro} />
          <Rodape ocupado={ocupado} rotulo="Salvar" onCancelar={onCancelar} desabilitado={!valido} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Marcar como cliente -----------------------------------------------------------

export function MarcarClienteDialog({
  aberto,
  ocupado,
  erro,
  onCancelar,
  cadastro,
  onConfirmar,
}: BaseProps & { cadastro: CadastroComercial | null; onConfirmar: () => void }) {
  return (
    <AlertDialog open={aberto} onOpenChange={(open) => (!open && !ocupado ? onCancelar() : undefined)}>
      <AlertDialogContent className="v3">
        <AlertDialogHeader>
          <AlertDialogTitle>Marcar {cadastro?.nome ?? ""} como cliente?</AlertDialogTitle>
        </AlertDialogHeader>
        <Erro erro={erro} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={ocupado}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={ocupado}
            onClick={(event) => {
              // A página fecha o diálogo quando a callable responde.
              event.preventDefault();
              onConfirmar();
            }}
          >
            {ocupado ? "Salvando..." : "Marcar como cliente"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- Local ----------------------------------------------------------------------------

export function LocalDialog({
  aberto,
  ocupado,
  erro,
  onCancelar,
  local,
  onSalvar,
}: BaseProps & { local: LocalResumo | null; onSalvar: (form: FormLocal) => void }) {
  const [form, setForm] = useState<FormLocal>(() => formDoLocal(null));
  useEffect(() => {
    if (aberto) setForm(formDoLocal(local));
  }, [aberto, local]);
  const valido = form.nome.trim().length >= 2;
  const muda = (campo: keyof FormLocal) => (event: { target: { value: string } }) =>
    setForm((atual) => ({ ...atual, [campo]: event.target.value }));

  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open && !ocupado ? onCancelar() : undefined)}>
      <DialogContent className="v3 max-w-xl">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valido) onSalvar(form);
          }}
        >
          <DialogHeader>
            <DialogTitle>{local ? local.nome : "Novo local"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo id="local-nome" rotulo="Nome" className="sm:col-span-2">
              <Input id="local-nome" value={form.nome} onChange={muda("nome")} maxLength={120} required />
            </Campo>
            <Campo id="local-sigla" rotulo="Sigla">
              <Input
                id="local-sigla"
                value={form.sigla}
                onChange={(event) => setForm((atual) => ({ ...atual, sigla: event.target.value.toUpperCase() }))}
                maxLength={12}
                autoComplete="off"
              />
            </Campo>
            <Campo id="local-logradouro" rotulo="Logradouro" className="sm:col-span-2">
              <Input id="local-logradouro" value={form.logradouro} onChange={muda("logradouro")} maxLength={160} />
            </Campo>
            <Campo id="local-numero" rotulo="Número">
              <Input id="local-numero" value={form.numero} onChange={muda("numero")} maxLength={20} />
            </Campo>
            <Campo id="local-complemento" rotulo="Complemento">
              <Input id="local-complemento" value={form.complemento} onChange={muda("complemento")} maxLength={80} />
            </Campo>
            <Campo id="local-bairro" rotulo="Bairro" className="sm:col-span-2">
              <Input id="local-bairro" value={form.bairro} onChange={muda("bairro")} maxLength={80} />
            </Campo>
            <Campo id="local-cidade" rotulo="Cidade">
              <Input id="local-cidade" value={form.cidade} onChange={muda("cidade")} maxLength={80} />
            </Campo>
            <Campo id="local-uf" rotulo="UF">
              <SelectUf id="local-uf" value={form.uf} onChange={(uf) => setForm((atual) => ({ ...atual, uf }))} disabled={ocupado} />
            </Campo>
            <Campo id="local-cep" rotulo="CEP">
              <Input id="local-cep" value={form.cep} onChange={muda("cep")} maxLength={9} inputMode="numeric" />
            </Campo>
          </div>
          <Erro erro={erro} />
          <Rodape ocupado={ocupado} rotulo="Salvar local" onCancelar={onCancelar} desabilitado={!valido} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Contato --------------------------------------------------------------------------

export function ContatoDialog({
  aberto,
  ocupado,
  erro,
  onCancelar,
  contato,
  empresas,
  onSalvar,
}: BaseProps & { contato: ContatoResumo | null; empresas: string[]; onSalvar: (form: FormContato) => void }) {
  const [form, setForm] = useState<FormContato>(() => formDoContato(null));
  useEffect(() => {
    if (aberto) setForm(formDoContato(contato));
  }, [aberto, contato]);
  const valido = form.nome.trim().length >= 2;
  const muda = (campo: keyof FormContato) => (event: { target: { value: string } }) =>
    setForm((atual) => ({ ...atual, [campo]: event.target.value }));

  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open && !ocupado ? onCancelar() : undefined)}>
      <DialogContent className="v3 max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valido) onSalvar(form);
          }}
        >
          <DialogHeader>
            <DialogTitle>{contato ? contato.nome : "Novo contato"}</DialogTitle>
          </DialogHeader>
          <Campo id="contato-nome" rotulo="Nome">
            <Input id="contato-nome" value={form.nome} onChange={muda("nome")} maxLength={120} required />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="contato-empresa" rotulo="Empresa">
              <Input id="contato-empresa" value={form.empresa} onChange={muda("empresa")} maxLength={120} list="contato-empresas" />
              <datalist id="contato-empresas">
                {empresas.map((empresa) => (
                  <option key={empresa} value={empresa} />
                ))}
              </datalist>
            </Campo>
            <Campo id="contato-papel" rotulo="Papel">
              <select
                id="contato-papel"
                value={form.papel}
                onChange={(event) => setForm((atual) => ({ ...atual, papel: event.target.value }))}
                disabled={ocupado}
                className={CAMPO_SELECT}
              >
                <option value="">—</option>
                {PAPEIS_DO_CONTATO.map((papel) => (
                  <option key={papel} value={papel}>
                    {PAPEL_DO_CONTATO_ROTULO[papel]}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id="contato-email" rotulo="E-mail">
              <Input id="contato-email" type="email" value={form.email} onChange={muda("email")} maxLength={160} autoComplete="off" />
            </Campo>
            <Campo id="contato-telefone" rotulo="Telefone">
              <Input id="contato-telefone" type="tel" value={form.telefone} onChange={muda("telefone")} maxLength={20} autoComplete="off" />
            </Campo>
          </div>
          <Erro erro={erro} />
          <Rodape ocupado={ocupado} rotulo="Salvar contato" onCancelar={onCancelar} desabilitado={!valido} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
