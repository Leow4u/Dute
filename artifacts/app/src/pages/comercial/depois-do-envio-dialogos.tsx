import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { vigenciaDoContrato, type ContatoResumo, type ContratoResumo } from "@/lib/comercial/clientes";
import {
  LINK_MAXIMO,
  MOTIVOS_DE_REVISAO,
  NOTA_MAXIMA,
  ROTULO_DA_ACAO,
  camposDoDialogo,
  formInicialDoDialogo,
  motivosDePerdaPermitidos,
  problemasDoDialogo,
  type AcaoDepoisDoEnvio,
  type CamposDoDialogo,
  type FormDoDialogo,
  type Motivo,
  type ValoresDaAcao,
} from "@/lib/comercial/depois-do-envio";
import { VARIANTES, rotuloDoContato } from "@/lib/comercial/montar";
import type { EtapaDemanda } from "@/lib/comercial/orcamentos";
import { cn } from "@/lib/utils";

/**
 * Os diálogos das ações depois do envio (parte 12b de
 * docs/plataforma/fase-6-comercial.md): curtos, com só os campos de que a
 * ação precisa. A validação é de lib/comercial/depois-do-envio.ts (o
 * servidor confere de novo); nada se grava até a pessoa confirmar. Os
 * diálogos abrem fora do contêiner da tela (portal), então levam a classe
 * .v3. Sem legenda: rótulos, campos e ações.
 */

const CAMPO_SELECT =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-50";

type Problemas = Record<string, string>;

function Campo({ id, rotulo, problema, children }: { id: string; rotulo: string; problema?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {problema ? (
        <p role="alert" className="text-xs font-bold text-destructive-soft-foreground">
          {problema}
        </p>
      ) : null}
    </div>
  );
}

/** O período executado (De, Até): do diálogo Registrar execução e do Orçar execução da fila. */
export function CamposDoPeriodo({
  prefixo,
  de,
  ate,
  max,
  problemas,
  desabilitado,
  onDe,
  onAte,
}: {
  prefixo: string;
  de: string;
  ate: string;
  /** "AAAA-MM-DD": o último dia que cabe (hoje). */
  max: string;
  problemas: Problemas;
  desabilitado: boolean;
  onDe: (valor: string) => void;
  onAte: (valor: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Campo id={`${prefixo}-de`} rotulo="De" problema={problemas.de}>
        <Input
          id={`${prefixo}-de`}
          type="date"
          max={max}
          value={de}
          onChange={(evento) => onDe(evento.target.value)}
          disabled={desabilitado}
          aria-invalid={Boolean(problemas.de)}
        />
      </Campo>
      <Campo id={`${prefixo}-ate`} rotulo="Até" problema={problemas.ate}>
        <Input
          id={`${prefixo}-ate`}
          type="date"
          min={de || undefined}
          max={max}
          value={ate}
          onChange={(evento) => onAte(evento.target.value)}
          disabled={desabilitado}
          aria-invalid={Boolean(problemas.ate)}
        />
      </Campo>
    </div>
  );
}

/** O contrato do cliente e a tabela (Comercial ou Noturna): do Novo orçamento e do Orçar execução da direta da Operação. */
export function CamposDoContrato({
  prefixo,
  contratoId,
  variante,
  contratos,
  problemas = {},
  desabilitado,
  onContrato,
  onVariante,
}: {
  prefixo: string;
  contratoId: string;
  variante: string;
  /** Os contratos que o cliente pode usar no orçamento (contratosParaOrcamento). */
  contratos: readonly ContratoResumo[];
  problemas?: Problemas;
  desabilitado: boolean;
  onContrato: (contratoId: string) => void;
  onVariante: (variante: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Campo id={`${prefixo}-contrato`} rotulo="Contrato" problema={problemas.contrato}>
        <select
          id={`${prefixo}-contrato`}
          value={contratoId}
          onChange={(evento) => onContrato(evento.target.value)}
          disabled={desabilitado}
          aria-invalid={Boolean(problemas.contrato)}
          className={CAMPO_SELECT}
        >
          <option value="">Sem contrato</option>
          {contratos.map((contrato) => (
            <option key={contrato.id} value={contrato.id}>
              {`${contrato.nome} · ${vigenciaDoContrato(contrato)}`}
            </option>
          ))}
        </select>
      </Campo>
      <div className="min-w-0 space-y-1.5">
        <span className="text-sm font-medium">Tabela</span>
        <div role="group" aria-label="Tabela" className="flex gap-0.5 rounded-lg bg-muted p-1">
          {VARIANTES.map((opcao) => (
            <button
              key={opcao}
              type="button"
              aria-pressed={variante === opcao}
              onClick={() => onVariante(opcao)}
              disabled={desabilitado}
              className={cn(
                "inline-flex h-8 flex-1 items-center justify-center rounded-md border px-3 text-sm font-bold transition-colors",
                variante === opcao ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {opcao}
            </button>
          ))}
        </div>
        {problemas.variante ? (
          <p role="alert" className="text-xs font-bold text-destructive-soft-foreground">
            {problemas.variante}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Os campos do diálogo, só a apresentação (o estado é do diálogo). */
export function CorpoDoDialogo({
  campos,
  form,
  onForm,
  problemas,
  contatos,
  contratos = [],
  motivosDePerda,
  hoje,
  desabilitado,
}: {
  campos: CamposDoDialogo;
  form: FormDoDialogo;
  onForm: (muda: (form: FormDoDialogo) => FormDoDialogo) => void;
  problemas: Problemas;
  contatos: ReadonlyArray<Pick<ContatoResumo, "id" | "nome" | "empresa">>;
  /** Os contratos do cliente, para o Orçar execução da direta da Operação. */
  contratos?: readonly ContratoResumo[];
  motivosDePerda: readonly Motivo[];
  hoje: string;
  desabilitado: boolean;
}) {
  const muda = (campo: keyof FormDoDialogo) => (evento: { target: { value: string } }) =>
    onForm((atual) => ({ ...atual, [campo]: evento.target.value }));

  if (campos === "resposta") {
    return (
      <div className="grid gap-4">
        <Campo id="resposta-em" rotulo="Respondido em" problema={problemas.em}>
          <Input
            id="resposta-em"
            type="datetime-local"
            value={form.em}
            onChange={muda("em")}
            disabled={desabilitado}
            aria-invalid={Boolean(problemas.em)}
          />
        </Campo>
        <Campo id="resposta-contato" rotulo="Contato" problema={problemas.contato}>
          <select
            id="resposta-contato"
            value={form.contatoId}
            onChange={muda("contatoId")}
            disabled={desabilitado || contatos.length === 0}
            aria-invalid={Boolean(problemas.contato)}
            className={CAMPO_SELECT}
          >
            <option value="">{contatos.length ? "Escolher…" : "Nenhum contato"}</option>
            {contatos.map((contato) => (
              <option key={contato.id} value={contato.id}>
                {rotuloDoContato(contato)}
              </option>
            ))}
          </select>
        </Campo>
        <Campo id="resposta-link" rotulo="Link do e-mail" problema={problemas.link}>
          <Input
            id="resposta-link"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={form.link}
            onChange={muda("link")}
            maxLength={LINK_MAXIMO + 1}
            disabled={desabilitado}
            autoComplete="off"
            aria-invalid={Boolean(problemas.link)}
          />
        </Campo>
      </div>
    );
  }

  if (campos === "perda") {
    return (
      <div className="grid gap-4">
        <Campo id="perda-motivo" rotulo="Motivo" problema={problemas.motivo}>
          <select
            id="perda-motivo"
            value={form.motivo}
            onChange={muda("motivo")}
            disabled={desabilitado}
            aria-invalid={Boolean(problemas.motivo)}
            className={CAMPO_SELECT}
          >
            {motivosDePerda.length > 1 ? <option value="">Escolher…</option> : null}
            {motivosDePerda.map((motivo) => (
              <option key={motivo.valor} value={motivo.valor}>
                {motivo.rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo id="perda-nota" rotulo="Nota" problema={problemas.nota}>
          <Textarea
            id="perda-nota"
            rows={3}
            value={form.nota}
            onChange={muda("nota")}
            maxLength={NOTA_MAXIMA + 1}
            disabled={desabilitado}
            aria-invalid={Boolean(problemas.nota)}
          />
        </Campo>
      </div>
    );
  }

  if (campos === "revisao") {
    return (
      <Campo id="revisao-motivo" rotulo="Motivo" problema={problemas.motivo}>
        <select
          id="revisao-motivo"
          value={form.motivo}
          onChange={muda("motivo")}
          disabled={desabilitado}
          aria-invalid={Boolean(problemas.motivo)}
          className={CAMPO_SELECT}
        >
          <option value="">Escolher…</option>
          {MOTIVOS_DE_REVISAO.map((motivo) => (
            <option key={motivo.valor} value={motivo.valor}>
              {motivo.rotulo}
            </option>
          ))}
        </select>
      </Campo>
    );
  }

  if (campos === "execucao") {
    return (
      <CamposDoPeriodo
        prefixo="execucao"
        de={form.de}
        ate={form.ate}
        max={hoje}
        problemas={problemas}
        desabilitado={desabilitado}
        onDe={(valor) => onForm((atual) => ({ ...atual, de: valor }))}
        onAte={(valor) => onForm((atual) => ({ ...atual, ate: valor }))}
      />
    );
  }

  if (campos === "contrato") {
    return (
      <CamposDoContrato
        prefixo="execucao-operacao"
        contratoId={form.contratoId}
        variante={form.variante}
        contratos={contratos}
        problemas={problemas}
        desabilitado={desabilitado}
        onContrato={(valor) => onForm((atual) => ({ ...atual, contratoId: valor }))}
        onVariante={(valor) => onForm((atual) => ({ ...atual, variante: valor }))}
      />
    );
  }

  return null;
}

/** Os valores que o pedido da ação usa, do formulário. */
export function valoresDoDialogo(form: FormDoDialogo): ValoresDaAcao {
  return {
    em: form.em,
    contatoId: form.contatoId,
    link: form.link,
    motivo: form.motivo,
    nota: form.nota,
    de: form.de,
    ate: form.ate,
    contratoId: form.contratoId,
    variante: form.variante,
  };
}

export type DialogoDepoisDoEnvioProps = {
  /** A ação aberta; null: fechado. */
  acao: AcaoDepoisDoEnvio | null;
  /** "10045 – RV01": entra no título. */
  rotulo: string;
  /** A demanda já fechada (ou executada, ou validada): a perda só por cancelamento do cliente. */
  comprometida: boolean;
  /** O contato do pedido, que abre escolhido na resposta. */
  contatoId: string | null;
  /** Os contatos do cliente do orçamento. */
  contatos: ReadonlyArray<Pick<ContatoResumo, "id" | "nome" | "empresa">>;
  /** Os contratos que o cliente pode usar (Orçar execução da direta da Operação). */
  contratos?: readonly ContratoResumo[];
  /** O contrato que abre escolhido: o vigente do cliente, ou o da demanda. */
  contratoId?: string | null;
  /** Quando a RV foi enviada (a resposta não vem antes). */
  envioEm: string | null;
  agora: Date;
  /** "AAAA-MM-DD". */
  hoje: string;
  ocupado: boolean;
  erro: string | null;
  onCancelar: () => void;
  onConfirmar: (acao: AcaoDepoisDoEnvio, valores: ValoresDaAcao) => void;
};

/** Os títulos que dizem a ação; o botão confirma com o mesmo verbo. */
const TITULO: Record<AcaoDepoisDoEnvio, string> = {
  ...ROTULO_DA_ACAO,
  aditivo: "Abrir aditivo",
  orcar_execucao: "Orçar execução",
};

export function tituloDoDialogo(acao: AcaoDepoisDoEnvio, rotulo: string): string {
  return `${TITULO[acao]} · ${rotulo}`;
}

/**
 * O diálogo curto de uma ação: só os campos dela, os problemas só depois da
 * primeira tentativa de confirmar, e a recusa do servidor em alerta. Sem
 * campo (Aditivo, Orçar execução, Reabrir, Descartar RV), só a confirmação.
 */
export function DialogoDepoisDoEnvio(props: DialogoDepoisDoEnvioProps) {
  const { acao, rotulo, comprometida, contatoId, contatos, envioEm, agora, hoje, ocupado, erro, onCancelar, onConfirmar } = props;
  const contratos = props.contratos ?? [];
  const [form, setForm] = useState<FormDoDialogo | null>(null);
  const [tentou, setTentou] = useState(false);
  useEffect(() => {
    setTentou(false);
    setForm(acao ? formInicialDoDialogo(acao, { agora: new Date(), contatoId, contatos, comprometida, contratoId: props.contratoId, contratos }) : null);
    // O formulário recomeça a cada abertura, não a cada leitura nova dos contatos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acao]);

  if (!acao || !form) return <Dialog open={false}>{null}</Dialog>;
  const campos = camposDoDialogo(acao);
  const problemas = problemasDoDialogo(acao, form, { agora, hoje, envioEm, contatos, comprometida, contratos });
  const mostrados = tentou ? problemas : {};
  return (
    <Dialog open onOpenChange={(open) => (!open && !ocupado ? onCancelar() : undefined)}>
      <DialogContent className="v3 max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(evento) => {
            evento.preventDefault();
            setTentou(true);
            if (Object.keys(problemas).length === 0) onConfirmar(acao, valoresDoDialogo(form));
          }}
        >
          <DialogHeader>
            <DialogTitle>{tituloDoDialogo(acao, rotulo)}</DialogTitle>
          </DialogHeader>
          <CorpoDoDialogo
            campos={campos}
            form={form}
            onForm={(muda) => setForm((atual) => (atual ? muda(atual) : atual))}
            problemas={mostrados}
            contatos={contatos}
            contratos={contratos}
            motivosDePerda={motivosDePerdaPermitidos(comprometida)}
            hoje={hoje}
            desabilitado={ocupado}
          />
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
            <Button type="submit" disabled={ocupado}>
              {ocupado ? "Gravando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
