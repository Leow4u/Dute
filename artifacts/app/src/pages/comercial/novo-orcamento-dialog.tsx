import { useEffect, useState, type ReactNode } from "react";
import { Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  contratoVigente,
  filtrarCadastros,
  formatarCnpj,
  type CadastroComercial,
  type ContratoResumo,
} from "@/lib/comercial/clientes";
import { problemasDaExecucao } from "@/lib/comercial/depois-do-envio";
import { VARIANTE_PADRAO, contratosParaOrcamento } from "@/lib/comercial/montar";
import { cn } from "@/lib/utils";

import { SeloProspect } from "./clientes-view";
import { CamposDoContrato, CamposDoPeriodo } from "./depois-do-envio-dialogos";

/**
 * Novo orçamento (parte 11): o cliente (busca por nome ou CNPJ, ou um
 * prospect novo criado aqui mesmo pela callable do cadastro), o contrato do
 * cliente, se houver, e Comercial ou Noturna. Em "Orçar execução" (modo
 * "execucao", parte 12b) é a demanda direta, executada antes do orçamento: o
 * mesmo diálogo com o período executado (De, Até; saveQuote create_execution).
 * A gravação é da página; o diálogo abre fora do contêiner da tela (portal), então leva
 * a classe .v3.
 */

export type NovoOrcamento = { customerCode: string; contratoId: string | null; variante: string; de?: string; ate?: string };

export type NovoOrcamentoDialogProps = {
  aberto: boolean;
  ocupado: boolean;
  erro: string | null;
  /** "execucao": Orçar execução, com o período executado. */
  modo?: "orcamento" | "execucao";
  onCancelar: () => void;
  cadastros: CadastroComercial[];
  contratos: ContratoResumo[];
  /** "AAAA-MM-DD", para o contrato vigente. */
  hoje: string;
  onCriar: (novo: NovoOrcamento) => void;
  /** Cria o prospect (saveCommercialCustomer) e devolve o código dele, ou null se não criou. */
  onCriarProspect: (prospect: { nome: string; cnpj: string }) => Promise<string | null>;
};

function Campo({ id, rotulo, children }: { id: string; rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

const ESTADO_INICIAL = {
  busca: "",
  code: "",
  contratoId: "",
  variante: VARIANTE_PADRAO as string,
  prospect: null as { nome: string; cnpj: string } | null,
  de: "",
  ate: "",
  tentou: false,
};

export function NovoOrcamentoDialog({
  aberto,
  ocupado,
  erro,
  modo = "orcamento",
  onCancelar,
  cadastros,
  contratos,
  hoje,
  onCriar,
  onCriarProspect,
}: NovoOrcamentoDialogProps) {
  const [estado, setEstado] = useState(ESTADO_INICIAL);
  useEffect(() => {
    if (aberto) setEstado(ESTADO_INICIAL);
  }, [aberto]);

  const escolher = (code: string) =>
    setEstado((atual) => ({ ...atual, code, contratoId: contratoVigente(contratos, code, hoje)?.id ?? "" }));
  const { clientes, prospects } = filtrarCadastros(cadastros, "todos", estado.busca);
  const lista = [...clientes, ...prospects];
  const escolhido = cadastros.find((cadastro) => cadastro.code === estado.code) ?? null;
  const doCliente = estado.code ? contratosParaOrcamento(contratos, estado.code) : [];
  const prospect = estado.prospect;
  const execucao = modo === "execucao";
  const problemasDoPeriodo = execucao ? problemasDaExecucao({ de: estado.de, ate: estado.ate }, hoje) : {};

  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open && !ocupado ? onCancelar() : undefined)}>
      <DialogContent className="v3 max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(evento) => {
            evento.preventDefault();
            if (!estado.code) return;
            if (execucao && Object.keys(problemasDoPeriodo).length > 0) {
              setEstado((atual) => ({ ...atual, tentou: true }));
              return;
            }
            onCriar({
              customerCode: estado.code,
              contratoId: estado.contratoId || null,
              variante: estado.variante,
              ...(execucao ? { de: estado.de, ate: estado.ate } : {}),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{execucao ? "Orçar execução" : "Novo orçamento"}</DialogTitle>
          </DialogHeader>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="novo-cliente">Cliente</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="novo-cliente"
                type="search"
                placeholder="Nome ou CNPJ"
                value={estado.busca}
                onChange={(evento) => setEstado((atual) => ({ ...atual, busca: evento.target.value }))}
                autoComplete="off"
                className="pl-9"
              />
            </div>
            <div role="listbox" aria-label="Clientes" className="max-h-56 overflow-y-auto rounded-md border border-border">
              {lista.length ? (
                lista.map((cadastro) => (
                  <button
                    key={cadastro.id}
                    type="button"
                    role="option"
                    aria-selected={cadastro.code === estado.code}
                    onClick={() => escolher(cadastro.code)}
                    className={cn(
                      "flex w-full items-center gap-2 border-l-4 border-t border-t-muted px-3 py-2 text-left text-sm first:border-t-0",
                      cadastro.code === estado.code ? "border-l-foreground bg-background" : "border-l-transparent hover:bg-surface-hover",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{cadastro.nome}</span>
                      {cadastro.cnpj ? (
                        <span className="block truncate text-xs font-semibold text-muted-foreground">{formatarCnpj(cadastro.cnpj)}</span>
                      ) : null}
                    </span>
                    {cadastro.estagio === "prospect" ? <SeloProspect /> : null}
                  </button>
                ))
              ) : (
                <p className="px-3 py-4 text-center text-sm font-bold text-muted-foreground">Nenhum cliente</p>
              )}
            </div>
            {prospect ? null : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEstado((atual) => ({ ...atual, prospect: { nome: atual.busca.trim(), cnpj: "" } }))}
                disabled={ocupado}
              >
                <Plus aria-hidden="true" />
                Novo prospect
              </Button>
            )}
          </div>

          {prospect ? (
            <section aria-label="Novo prospect" className="grid gap-3 rounded-md border border-border bg-background p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo id="prospect-nome" rotulo="Nome">
                  <Input
                    id="prospect-nome"
                    value={prospect.nome}
                    onChange={(evento) => setEstado((atual) => ({ ...atual, prospect: { ...prospect, nome: evento.target.value } }))}
                    maxLength={120}
                    autoComplete="off"
                  />
                </Campo>
                <Campo id="prospect-cnpj" rotulo="CNPJ">
                  <Input
                    id="prospect-cnpj"
                    value={prospect.cnpj}
                    onChange={(evento) => setEstado((atual) => ({ ...atual, prospect: { ...prospect, cnpj: evento.target.value } }))}
                    maxLength={20}
                    autoComplete="off"
                  />
                </Campo>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEstado((atual) => ({ ...atual, prospect: null }))}
                  disabled={ocupado}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={ocupado || prospect.nome.trim().length < 2}
                  onClick={async () => {
                    const code = await onCriarProspect(prospect);
                    if (code) setEstado((atual) => ({ ...atual, prospect: null, busca: "", code, contratoId: "" }));
                  }}
                >
                  Criar prospect
                </Button>
              </div>
            </section>
          ) : null}

          {escolhido ? (
            <CamposDoContrato
              prefixo="novo"
              contratoId={estado.contratoId}
              variante={estado.variante}
              contratos={doCliente}
              desabilitado={ocupado}
              onContrato={(contratoId) => setEstado((atual) => ({ ...atual, contratoId }))}
              onVariante={(variante) => setEstado((atual) => ({ ...atual, variante }))}
            />
          ) : null}

          {execucao && escolhido ? (
            <CamposDoPeriodo
              prefixo="novo-execucao"
              de={estado.de}
              ate={estado.ate}
              max={hoje}
              problemas={estado.tentou ? problemasDoPeriodo : {}}
              desabilitado={ocupado}
              onDe={(de) => setEstado((atual) => ({ ...atual, de }))}
              onAte={(ate) => setEstado((atual) => ({ ...atual, ate }))}
            />
          ) : null}

          {erro ? (
            <p
              role="alert"
              className="rounded-md border border-destructive-soft-border bg-destructive-soft px-3 py-2 text-sm font-semibold text-destructive-soft-foreground"
            >
              {erro}
            </p>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onCancelar} disabled={ocupado}>
              Cancelar
            </Button>
            <Button type="submit" disabled={ocupado || !estado.code}>
              {ocupado ? "Criando..." : "Criar orçamento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
