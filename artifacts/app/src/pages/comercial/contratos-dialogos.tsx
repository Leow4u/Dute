import { useEffect, useState, type ReactNode } from "react";
import { MESES_PAGAMENTO, STATUS_CONTRATO, TIPOS_PAGAMENTO, TIPOS_REAJUSTE, TIPOS_RENOVACAO } from "@workspace/dominio";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import type { CadastroComercial } from "@/lib/comercial/clientes";
import {
  ADITIVOS_COM_VIGENCIA,
  REGIMES_COBRANCA,
  ROTULO_DA_AUTORIZACAO,
  ROTULO_DA_RENOVACAO,
  ROTULO_DO_ADITIVO,
  ROTULO_DO_NUMERO,
  ROTULO_DO_PAGAMENTO,
  ROTULO_DO_REAJUSTE,
  ROTULO_DO_REGIME,
  TIPOS_ADITIVO,
  TIPOS_AUTORIZACAO,
  TIPOS_NUMERO_CONTRATO,
  aditivoDoForm,
  contratoDoForm,
  formDoContrato,
  formNovoAditivo,
  periodoDaTabela,
  proximaFaixa,
  type Aditivo,
  type AditivoDados,
  type Contrato,
  type ContratoDados,
  type FormAditivo,
  type FormContrato,
  type TabelaDoContrato,
} from "@/lib/comercial/contratos";

/**
 * Diálogos da aba Contratos: Registrar aditivo (recordAditivo) e Novo
 * contrato / Editar (saveContract). Cada um só monta e confere o formulário
 * (as mesmas regras da callable, que confere de novo); a gravação, com a
 * chave de idempotência e o estado esperado, é da página. Os diálogos abrem
 * fora do contêiner da tela (portal), então levam a classe .v3.
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

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-lg border border-border p-4">
      <legend className="px-1 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">{titulo}</legend>
      {children}
    </fieldset>
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

function Escolha<T extends string>({
  id,
  valor,
  opcoes,
  rotulos,
  onChange,
  disabled,
  vazio,
}: {
  id: string;
  valor: T | "";
  opcoes: readonly T[];
  rotulos: Record<T, string>;
  onChange: (valor: T) => void;
  disabled?: boolean;
  vazio?: string;
}) {
  return (
    <select id={id} value={valor} onChange={(event) => onChange(event.target.value as T)} disabled={disabled} className={CAMPO_SELECT}>
      {vazio !== undefined ? <option value="">{vazio}</option> : null}
      {opcoes.map((opcao) => (
        <option key={opcao} value={opcao}>
          {rotulos[opcao]}
        </option>
      ))}
    </select>
  );
}

function Remover({ rotulo, onClick, disabled }: { rotulo: string; onClick: () => void; disabled: boolean }) {
  return (
    <Button type="button" variant="ghost" size="icon" aria-label={rotulo} onClick={onClick} disabled={disabled} className="shrink-0">
      <X aria-hidden="true" />
    </Button>
  );
}

function Adicionar({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled: boolean }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={disabled} className="justify-self-start">
      <Plus aria-hidden="true" />
      {children}
    </Button>
  );
}

function Rodape({ ocupado, rotulo, onCancelar }: { ocupado: boolean; rotulo: string; onCancelar: () => void }) {
  return (
    <DialogFooter className="gap-2">
      <Button type="button" variant="outline" onClick={onCancelar} disabled={ocupado}>
        Cancelar
      </Button>
      <Button type="submit" disabled={ocupado}>
        {ocupado ? "Salvando..." : rotulo}
      </Button>
    </DialogFooter>
  );
}

// --- Registrar aditivo -----------------------------------------------------------------

/**
 * `contrato` e `aditivos` são os de quando o diálogo abriu (a página os
 * guarda): o número sugerido é o seguinte ao último do histórico, e o
 * servidor recusa o número que já existe.
 */
export function RegistrarAditivoDialog({
  aberto,
  ocupado,
  erro,
  onCancelar,
  contrato,
  aditivos,
  tabelas,
  onSalvar,
}: BaseProps & {
  contrato: Contrato | null;
  aditivos: Aditivo[];
  tabelas: TabelaDoContrato[];
  onSalvar: (aditivo: AditivoDados) => void;
}) {
  const [form, setForm] = useState<FormAditivo | null>(null);
  const [problema, setProblema] = useState<string | null>(null);
  useEffect(() => {
    if (aberto && contrato) {
      setForm(formNovoAditivo(contrato, aditivos));
      setProblema(null);
    }
  }, [aberto, contrato, aditivos]);
  if (!contrato || !form) return null;
  const muda = (campo: keyof FormAditivo) => (event: { target: { value: string } }) =>
    setForm((atual) => (atual ? { ...atual, [campo]: event.target.value } : atual));
  const comVigencia = ADITIVOS_COM_VIGENCIA.includes(form.tipo);

  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open && !ocupado ? onCancelar() : undefined)}>
      <DialogContent className="v3 max-h-[90vh] max-w-lg overflow-y-auto">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const conferido = aditivoDoForm(form, aditivos);
            setProblema(conferido.ok ? null : conferido.problema);
            if (conferido.ok) onSalvar(conferido.valor);
          }}
        >
          <DialogHeader>
            <DialogTitle>Registrar aditivo</DialogTitle>
            <DialogDescription>{contrato.dados.nome}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="aditivo-numero" rotulo="Número">
              <Input id="aditivo-numero" value={form.numero} onChange={muda("numero")} inputMode="numeric" maxLength={3} required />
            </Campo>
            <Campo id="aditivo-tipo" rotulo="Tipo">
              <Escolha
                id="aditivo-tipo"
                valor={form.tipo}
                opcoes={TIPOS_ADITIVO}
                rotulos={ROTULO_DO_ADITIVO}
                onChange={(tipo) => setForm((atual) => (atual ? { ...atual, tipo } : atual))}
                disabled={ocupado}
              />
            </Campo>
            <Campo id="aditivo-assinado" rotulo="Assinado em">
              <Input id="aditivo-assinado" type="date" value={form.assinadoEm} onChange={muda("assinadoEm")} />
            </Campo>
          </div>
          {comVigencia ? (
            <Grupo titulo="Vigência nova">
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo id="aditivo-de" rotulo="Início">
                  <Input id="aditivo-de" type="date" value={form.vigenteDe} onChange={muda("vigenteDe")} />
                </Campo>
                <Campo id="aditivo-ate" rotulo="Fim">
                  <Input id="aditivo-ate" type="date" value={form.vigenteAte} onChange={muda("vigenteAte")} />
                </Campo>
              </div>
            </Grupo>
          ) : null}
          {form.tipo === "preco" ? (
            <Grupo titulo="Tabelas de preço">
              {tabelas.length ? (
                tabelas.map((tabela) => {
                  const id = `aditivo-tabela-${tabela.id}`;
                  const marcada = form.tabelaIds.includes(tabela.id);
                  return (
                    <div key={tabela.id} className="flex items-center gap-2.5">
                      <Checkbox
                        id={id}
                        checked={marcada}
                        onCheckedChange={(checked) =>
                          setForm((atual) =>
                            atual
                              ? {
                                  ...atual,
                                  tabelaIds: checked
                                    ? [...atual.tabelaIds, tabela.id]
                                    : atual.tabelaIds.filter((item) => item !== tabela.id),
                                }
                              : atual,
                          )
                        }
                      />
                      <Label htmlFor={id} className="font-semibold">
                        {[tabela.nome, tabela.variante, periodoDaTabela(tabela)].filter(Boolean).join(" · ")}
                      </Label>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm font-semibold text-muted-foreground">Nenhuma tabela</p>
              )}
            </Grupo>
          ) : null}
          <Grupo titulo="Documento">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="aditivo-doc-nome" rotulo="Nome">
                <Input id="aditivo-doc-nome" value={form.documentoNome} onChange={muda("documentoNome")} maxLength={200} />
              </Campo>
              <Campo id="aditivo-doc-ref" rotulo="Referência">
                <Input id="aditivo-doc-ref" value={form.documentoReferencia} onChange={muda("documentoReferencia")} maxLength={500} />
              </Campo>
            </div>
          </Grupo>
          <Campo id="aditivo-observacao" rotulo="Observação">
            <Textarea id="aditivo-observacao" value={form.observacao} onChange={muda("observacao")} maxLength={2000} />
          </Campo>
          <Erro erro={problema ?? erro} />
          <Rodape ocupado={ocupado} rotulo="Registrar aditivo" onCancelar={onCancelar} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Novo contrato e Editar ----------------------------------------------------------------

const ROTULO_DO_MES: Record<(typeof MESES_PAGAMENTO)[number], string> = { mesmo: "Mesmo mês", seguinte: "Mês seguinte" };
const ROTULO_DO_STATUS: Record<(typeof STATUS_CONTRATO)[number], string> = { vigente: "Vigente", encerrado: "Encerrado" };
const IMPOSTOS = ["sim", "nao"] as const;
const ROTULO_DOS_IMPOSTOS: Record<(typeof IMPOSTOS)[number], string> = { sim: "Inclusos no preço", nao: "Não inclusos" };

/**
 * Sem `contrato`, novo contrato (o cliente se escolhe entre os clientes do
 * cadastro; prospect não tem contrato). Com ele, editar: o contrato é o de
 * quando o diálogo abriu, e a página manda a edição lida junto.
 */
export function ContratoDialog({
  aberto,
  ocupado,
  erro,
  onCancelar,
  contrato,
  clientes,
  onSalvar,
}: BaseProps & { contrato: Contrato | null; clientes: CadastroComercial[]; onSalvar: (dados: ContratoDados) => void }) {
  const [form, setForm] = useState<FormContrato>(() => formDoContrato(null));
  const [problema, setProblema] = useState<string | null>(null);
  useEffect(() => {
    if (aberto) {
      setForm(formDoContrato(contrato));
      setProblema(null);
    }
  }, [aberto, contrato]);
  const editando = contrato !== null;
  const define = <K extends keyof FormContrato>(campo: K, valor: FormContrato[K]) => setForm((atual) => ({ ...atual, [campo]: valor }));
  const texto = (campo: keyof FormContrato) => (event: { target: { value: string } }) => define(campo, event.target.value as never);
  const linha = <K extends "numeros" | "regimes" | "documentos" | "faixas">(campo: K, index: number, mudanca: Partial<FormContrato[K][number]>) =>
    setForm((atual) => ({
      ...atual,
      [campo]: (atual[campo] as Array<FormContrato[K][number]>).map((item, posicao) => (posicao === index ? { ...item, ...mudanca } : item)),
    }));
  const tirar = (campo: "numeros" | "regimes" | "documentos" | "faixas", index: number) =>
    setForm((atual) => ({ ...atual, [campo]: (atual[campo] as unknown[]).filter((_, posicao) => posicao !== index) }));
  const opcoesDeCliente = clientes.filter((cliente) => cliente.estagio === "cliente").sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open && !ocupado ? onCancelar() : undefined)}>
      <DialogContent className="v3 max-h-[90vh] max-w-2xl overflow-y-auto">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const conferido = contratoDoForm(form);
            setProblema(conferido.ok ? null : conferido.problema);
            if (conferido.ok) onSalvar(conferido.valor);
          }}
        >
          <DialogHeader>
            <DialogTitle>{editando ? contrato.dados.nome : "Novo contrato"}</DialogTitle>
            {editando ? <DialogDescription>Edição {contrato.edicao}</DialogDescription> : null}
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="contrato-cliente" rotulo="Cliente">
              <select
                id="contrato-cliente"
                value={form.customerCode}
                onChange={texto("customerCode")}
                disabled={editando || ocupado}
                className={CAMPO_SELECT}
              >
                <option value="">—</option>
                {editando && !opcoesDeCliente.some((cliente) => cliente.code === form.customerCode) ? (
                  <option value={form.customerCode}>{form.customerCode}</option>
                ) : null}
                {opcoesDeCliente.map((cliente) => (
                  <option key={cliente.id} value={cliente.code}>
                    {cliente.nome}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id="contrato-nome" rotulo="Nome">
              <Input id="contrato-nome" value={form.nome} onChange={texto("nome")} maxLength={160} required />
            </Campo>
          </div>

          <Grupo titulo="Números">
            {form.numeros.map((numero, index) => (
              <div key={index} className="flex items-end gap-2">
                <Campo id={`contrato-numero-tipo-${index}`} rotulo="Tipo" className="w-40 shrink-0">
                  <Escolha
                    id={`contrato-numero-tipo-${index}`}
                    valor={numero.tipo}
                    opcoes={TIPOS_NUMERO_CONTRATO}
                    rotulos={ROTULO_DO_NUMERO}
                    onChange={(tipo) => linha("numeros", index, { tipo })}
                    disabled={ocupado}
                  />
                </Campo>
                <Campo id={`contrato-numero-${index}`} rotulo="Número" className="flex-1">
                  <Input
                    id={`contrato-numero-${index}`}
                    value={numero.numero}
                    onChange={(event) => linha("numeros", index, { numero: event.target.value })}
                    maxLength={80}
                  />
                </Campo>
                <Remover rotulo="Tirar número" onClick={() => tirar("numeros", index)} disabled={ocupado} />
              </div>
            ))}
            <Adicionar onClick={() => define("numeros", [...form.numeros, { tipo: "contrato", numero: "" }])} disabled={ocupado}>
              Número
            </Adicionar>
          </Grupo>

          <Campo id="contrato-objeto" rotulo="Objeto">
            <Textarea id="contrato-objeto" value={form.objeto} onChange={texto("objeto")} maxLength={4000} />
          </Campo>

          <Grupo titulo="Vigência">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="contrato-de" rotulo="Início">
                <Input id="contrato-de" type="date" value={form.vigenteDe} onChange={texto("vigenteDe")} required />
              </Campo>
              <Campo id="contrato-ate" rotulo="Fim">
                <Input id="contrato-ate" type="date" value={form.vigenteAte} onChange={texto("vigenteAte")} disabled={form.semPrazo} />
              </Campo>
            </div>
            <div className="flex items-center gap-2.5">
              <Checkbox id="contrato-sem-prazo" checked={form.semPrazo} onCheckedChange={(checked) => define("semPrazo", checked === true)} />
              <Label htmlFor="contrato-sem-prazo" className="font-semibold">
                Prazo indeterminado
              </Label>
            </div>
          </Grupo>

          <Grupo titulo="Renovação e reajuste">
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo id="contrato-renovacao" rotulo="Renovação">
                <Escolha
                  id="contrato-renovacao"
                  valor={form.renovacao}
                  opcoes={TIPOS_RENOVACAO}
                  rotulos={ROTULO_DA_RENOVACAO}
                  onChange={(renovacao) => define("renovacao", renovacao)}
                  disabled={ocupado}
                />
              </Campo>
              <Campo id="contrato-aviso" rotulo="Aviso (dias antes do fim)">
                <Input id="contrato-aviso" value={form.avisoDias} onChange={texto("avisoDias")} inputMode="numeric" maxLength={4} />
              </Campo>
              {form.renovacao === "automatica" ? (
                <Campo id="contrato-oposicao" rotulo="Oposição (dias antes do fim)">
                  <Input id="contrato-oposicao" value={form.oposicaoDias} onChange={texto("oposicaoDias")} inputMode="numeric" maxLength={4} />
                </Campo>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo id="contrato-reajuste" rotulo="Reajuste">
                <Escolha
                  id="contrato-reajuste"
                  valor={form.reajuste}
                  opcoes={TIPOS_REAJUSTE}
                  rotulos={ROTULO_DO_REAJUSTE}
                  onChange={(reajuste) => define("reajuste", reajuste)}
                  disabled={ocupado}
                />
              </Campo>
              {form.reajuste === "indice" ? (
                <>
                  <Campo id="contrato-indice" rotulo="Índice">
                    <Input id="contrato-indice" value={form.indice} onChange={texto("indice")} maxLength={40} />
                  </Campo>
                  <Campo id="contrato-data-base" rotulo="Data-base (dia/mês)">
                    <Input id="contrato-data-base" value={form.dataBase} onChange={texto("dataBase")} placeholder="01/07" maxLength={5} />
                  </Campo>
                </>
              ) : null}
            </div>
          </Grupo>

          <Grupo titulo="Cobrança">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="contrato-regime" rotulo="Regime de cobrança">
                <Escolha
                  id="contrato-regime"
                  valor={form.regimePadrao}
                  opcoes={REGIMES_COBRANCA}
                  rotulos={ROTULO_DO_REGIME}
                  onChange={(regime) => define("regimePadrao", regime)}
                  disabled={ocupado}
                />
              </Campo>
              <Campo id="contrato-codigo" rotulo="Código de serviço">
                <Input id="contrato-codigo" value={form.codigoServico} onChange={texto("codigoServico")} inputMode="numeric" maxLength={5} />
              </Campo>
            </div>
            {form.regimes.map((regime, index) => (
              <div key={index} className="flex items-end gap-2">
                <Campo id={`contrato-servico-${index}`} rotulo="Serviço" className="flex-1">
                  <Input
                    id={`contrato-servico-${index}`}
                    value={regime.servico}
                    onChange={(event) => linha("regimes", index, { servico: event.target.value })}
                    maxLength={120}
                  />
                </Campo>
                <Campo id={`contrato-servico-regime-${index}`} rotulo="Regime" className="w-44 shrink-0">
                  <Escolha
                    id={`contrato-servico-regime-${index}`}
                    valor={regime.regime}
                    opcoes={REGIMES_COBRANCA}
                    rotulos={ROTULO_DO_REGIME}
                    onChange={(valor) => linha("regimes", index, { regime: valor })}
                    disabled={ocupado}
                  />
                </Campo>
                <Remover rotulo="Tirar serviço" onClick={() => tirar("regimes", index)} disabled={ocupado} />
              </div>
            ))}
            <Adicionar
              onClick={() => define("regimes", [...form.regimes, { servico: "", regime: form.regimePadrao }])}
              disabled={ocupado}
            >
              Regime por serviço
            </Adicionar>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="contrato-autorizacao" rotulo="Autorização de faturamento">
                <Escolha
                  id="contrato-autorizacao"
                  valor={form.autorizacao}
                  opcoes={TIPOS_AUTORIZACAO}
                  rotulos={ROTULO_DA_AUTORIZACAO}
                  onChange={(autorizacao) => define("autorizacao", autorizacao)}
                  disabled={ocupado}
                />
              </Campo>
              <Campo id="contrato-prazo-perda" rotulo="Prazo de perda (dias)">
                <Input id="contrato-prazo-perda" value={form.prazoPerdaDias} onChange={texto("prazoPerdaDias")} inputMode="numeric" maxLength={4} />
              </Campo>
            </div>
          </Grupo>

          <Grupo titulo="Pagamento">
            <Campo id="contrato-pagamento" rotulo="Regra">
              <Escolha
                id="contrato-pagamento"
                valor={form.pagamento}
                opcoes={TIPOS_PAGAMENTO}
                rotulos={ROTULO_DO_PAGAMENTO}
                onChange={(pagamento) => define("pagamento", pagamento)}
                disabled={ocupado}
              />
            </Campo>
            {form.pagamento === "faixas_do_dia_da_nf" ? (
              <>
                {form.faixas.map((faixa, index) => (
                  <div key={index} className="flex flex-wrap items-end gap-2">
                    <Campo id={`contrato-faixa-de-${index}`} rotulo="NF do dia" className="w-20">
                      <Input id={`contrato-faixa-de-${index}`} value={faixa.de} onChange={(event) => linha("faixas", index, { de: event.target.value })} inputMode="numeric" maxLength={2} />
                    </Campo>
                    <Campo id={`contrato-faixa-ate-${index}`} rotulo="ao dia" className="w-20">
                      <Input id={`contrato-faixa-ate-${index}`} value={faixa.ate} onChange={(event) => linha("faixas", index, { ate: event.target.value })} inputMode="numeric" maxLength={2} />
                    </Campo>
                    <Campo id={`contrato-faixa-dia-${index}`} rotulo="Paga dia" className="w-20">
                      <Input id={`contrato-faixa-dia-${index}`} value={faixa.dia} onChange={(event) => linha("faixas", index, { dia: event.target.value })} inputMode="numeric" maxLength={2} />
                    </Campo>
                    <Campo id={`contrato-faixa-mes-${index}`} rotulo="Mês" className="w-40">
                      <Escolha
                        id={`contrato-faixa-mes-${index}`}
                        valor={faixa.mes}
                        opcoes={MESES_PAGAMENTO}
                        rotulos={ROTULO_DO_MES}
                        onChange={(mes) => linha("faixas", index, { mes })}
                        disabled={ocupado}
                      />
                    </Campo>
                    <Remover rotulo="Tirar faixa" onClick={() => tirar("faixas", index)} disabled={ocupado} />
                  </div>
                ))}
                <Adicionar onClick={() => define("faixas", [...form.faixas, proximaFaixa(form.faixas)])} disabled={ocupado}>
                  Faixa
                </Adicionar>
              </>
            ) : null}
            {form.pagamento === "dias_apos_nf" ? (
              <Campo id="contrato-pagamento-dias" rotulo="Dias depois da NF" className="sm:w-48">
                <Input id="contrato-pagamento-dias" value={form.pagamentoDias} onChange={texto("pagamentoDias")} inputMode="numeric" maxLength={4} />
              </Campo>
            ) : null}
            {form.pagamento === "texto" ? (
              <Campo id="contrato-pagamento-texto" rotulo="Como paga">
                <Textarea id="contrato-pagamento-texto" value={form.pagamentoTexto} onChange={texto("pagamentoTexto")} maxLength={1000} />
              </Campo>
            ) : null}
          </Grupo>

          <Grupo titulo="Impostos">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="contrato-impostos" rotulo="No preço">
                <Escolha
                  id="contrato-impostos"
                  valor={form.impostosInclusos}
                  opcoes={IMPOSTOS}
                  rotulos={ROTULO_DOS_IMPOSTOS}
                  onChange={(valor) => define("impostosInclusos", valor)}
                  disabled={ocupado}
                  vazio="—"
                />
              </Campo>
              <Campo id="contrato-impostos-texto" rotulo="Impostos">
                <Input id="contrato-impostos-texto" value={form.impostosTexto} onChange={texto("impostosTexto")} maxLength={1000} />
              </Campo>
            </div>
          </Grupo>

          <Grupo titulo="Documentos">
            {form.documentos.map((documento, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <Campo id={`contrato-doc-nome-${index}`} rotulo="Nome" className="min-w-40 flex-1">
                  <Input
                    id={`contrato-doc-nome-${index}`}
                    value={documento.nome}
                    onChange={(event) => linha("documentos", index, { nome: event.target.value })}
                    maxLength={200}
                  />
                </Campo>
                <Campo id={`contrato-doc-ref-${index}`} rotulo="Referência" className="min-w-40 flex-1">
                  <Input
                    id={`contrato-doc-ref-${index}`}
                    value={documento.referencia}
                    onChange={(event) => linha("documentos", index, { referencia: event.target.value })}
                    maxLength={500}
                  />
                </Campo>
                <Remover rotulo="Tirar documento" onClick={() => tirar("documentos", index)} disabled={ocupado} />
              </div>
            ))}
            <Adicionar onClick={() => define("documentos", [...form.documentos, { nome: "", referencia: "" }])} disabled={ocupado}>
              Documento
            </Adicionar>
          </Grupo>

          {editando ? (
            <Campo id="contrato-status" rotulo="Situação" className="sm:w-48">
              <Escolha
                id="contrato-status"
                valor={form.status}
                opcoes={STATUS_CONTRATO}
                rotulos={ROTULO_DO_STATUS}
                onChange={(status) => define("status", status)}
                disabled={ocupado}
              />
            </Campo>
          ) : null}

          <Erro erro={problema ?? erro} />
          <Rodape ocupado={ocupado} rotulo={editando ? "Salvar" : "Criar contrato"} onCancelar={onCancelar} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
