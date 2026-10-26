import type { FormEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dataBr } from "@/lib/comercial/clientes";
import {
  CATEGORIAS,
  DIAS_PARA_O_VENCIMENTO,
  RESULTADOS_DO_EXAME,
  ROTULO_DA_CATEGORIA,
  ROTULO_DO_RESULTADO,
  ROTULO_DO_TIPO,
  ROTULO_DO_VINCULO,
  diasAte,
  nomeDoRegistro,
  temDatasDoVinculo,
  textoDoPrazo,
  textosDoVinculo,
  type Categoria,
  type FichaDoRh,
  type RegistroDoRh,
  type ResultadoDoExame,
} from "@/lib/rh/ficha";
import {
  PRIMEIRO_DIA,
  TIPOS_DE_ARQUIVO,
  ULTIMO_DIA,
  comCategoria,
  rotuloDaData,
  tiposDaCategoria,
  type FormularioDoRegistro,
  type FormularioDoVinculo,
} from "@/lib/rh/formulario";
import { cn } from "@/lib/utils";

import { Contador, Pill, TOM_NEUTRO, TOM_OK, TOM_VENCENDO, TOM_VENCIDO, Vazio } from "./pecas";

/**
 * A ficha da pessoa no RH (partes 8.2c, 8.2d e 8.4b): os documentos, os
 * exames e os treinamentos vigentes, com o prazo do vencimento, o histórico
 * de cada categoria e, no vínculo próprio, as datas de admissão e de
 * desligamento. Quem abre o RH abre o arquivo; só o rh inclui, altera,
 * arquiva, anexa e grava as datas. Sem legenda: só rótulos, dados e ações.
 */

export type EstadoDaFicha = "carregando" | "erro" | "pronto";

export type AcoesDaFicha = {
  novo: () => void;
  alterar: (registro: RegistroDoRh) => void;
  editar: (formulario: FormularioDoRegistro) => void;
  salvar: () => void;
  fechar: () => void;
  pedirArquivamento: (registroId: string) => void;
  confirmarArquivamento: () => void;
  desistir: () => void;
  anexar: (registro: RegistroDoRh, arquivo: File) => void;
  abrirArquivo: (registro: RegistroDoRh) => void;
  abrirVinculo: () => void;
  editarVinculo: (formulario: FormularioDoVinculo) => void;
  salvarVinculo: () => void;
  fecharVinculo: () => void;
};

export type FichaViewProps = {
  estado: EstadoDaFicha;
  ficha: FichaDoRh | undefined;
  erro: string | null;
  /** Quem grava no RH (só o rh): vê as ações de incluir, alterar, arquivar, anexar e gravar as datas do vínculo. */
  grava: boolean;
  formulario: FormularioDoRegistro | null;
  /** O formulário das datas do vínculo, aberto. */
  vinculo: FormularioDoVinculo | null;
  /** O registro com o arquivamento por confirmar. */
  arquivando: string | null;
  ocupado: boolean;
  /** A mensagem do servidor da última ação que falhou. */
  falha: string | null;
  acoes: AcoesDaFicha;
};

const VAZIO_DA_CATEGORIA: Record<Categoria, string> = { documento: "Nenhum documento", exame: "Nenhum exame", treinamento: "Nenhum treinamento" };

const CATEGORIA_NO_FORMULARIO: Record<Categoria, string> = { documento: "Documento", exame: "Exame", treinamento: "Treinamento" };

const TOM_DO_RESULTADO: Record<ResultadoDoExame, string> = { apto: TOM_OK, apto_com_restricao: TOM_VENCENDO, inapto: TOM_VENCIDO };

const ROTULO_DE_CAMPO = "block text-xs font-bold text-muted-foreground";
const CAMPO_SELECT =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-50";

/** "Vence em 9 dias", "Venceu há 22 dias": o prazo do registro dentro da janela do Início. */
function prazoNaFicha(dias: number): string {
  const texto = textoDoPrazo(dias);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function datasDoRegistro(registro: RegistroDoRh): string {
  const feito = `${rotuloDaData(registro.categoria)} ${dataBr(registro.emitido_em)}`;
  return [feito, registro.vence_em ? `vence em ${dataBr(registro.vence_em)}` : "sem vencimento"].join(" · ");
}

function Campo({ id, rotulo, children }: { id: string; rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className={ROTULO_DE_CAMPO}>
        {rotulo}
      </Label>
      {children}
    </div>
  );
}

function AcoesDoRegistro({ registro, props }: { registro: RegistroDoRh; props: FichaViewProps }) {
  const { grava, arquivando, ocupado, formulario, vinculo, acoes } = props;
  const editavel = grava && registro.situacao !== "arquivado";
  // Com um formulário aberto, as gravações das linhas esperam: a edição que ele leva não muda por baixo dele.
  const travado = ocupado || formulario !== null || vinculo !== null;
  if (arquivando === registro.id) {
    return (
      <div className="col-span-2 flex flex-wrap gap-2">
        <Button type="button" variant="destructive" size="sm" onClick={acoes.confirmarArquivamento} disabled={ocupado}>
          Confirmar arquivamento
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={acoes.desistir} disabled={ocupado}>
          Voltar
        </Button>
      </div>
    );
  }
  if (!registro.arquivo && !editavel) return null;
  const entrada = `arquivo-${registro.id}`;
  return (
    <div className="col-span-2 flex flex-wrap gap-2">
      {registro.arquivo ? (
        <Button type="button" variant="outline" size="sm" onClick={() => acoes.abrirArquivo(registro)} disabled={ocupado}>
          Abrir arquivo
        </Button>
      ) : null}
      {editavel ? (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={() => acoes.alterar(registro)} disabled={travado}>
            Alterar
          </Button>
          <label
            htmlFor={entrada}
            className={cn(
              "inline-flex h-8 cursor-pointer items-center rounded-md px-3 text-sm font-medium hover:bg-surface-hover focus-within:ring-2 focus-within:ring-ring",
              travado && "pointer-events-none opacity-50",
            )}
          >
            {registro.arquivo ? "Trocar arquivo" : "Anexar arquivo"}
            <input
              id={entrada}
              type="file"
              accept={TIPOS_DE_ARQUIVO.join(",")}
              className="sr-only"
              disabled={travado}
              onChange={(evento) => {
                const arquivo = evento.target.files?.[0];
                evento.target.value = "";
                if (arquivo) acoes.anexar(registro, arquivo);
              }}
            />
          </label>
          <Button type="button" variant="ghost" size="sm" onClick={() => acoes.pedirArquivamento(registro.id)} disabled={travado}>
            Arquivar
          </Button>
        </>
      ) : null}
    </div>
  );
}

function Linha({ registro, hoje, primeira, props }: { registro: RegistroDoRh; hoje: string; primeira: boolean; props: FichaViewProps }) {
  const dias = registro.situacao === "vigente" && registro.vence_em ? diasAte(hoje, registro.vence_em) : null;
  return (
    <li className={cn("grid grid-cols-[minmax(0,1fr)_auto] gap-x-3.5 gap-y-2 px-5 py-3.5", !primeira && "border-t border-muted")}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-base font-extrabold">{nomeDoRegistro(registro)}</span>
        <span className="text-sm font-semibold text-muted-foreground">{datasDoRegistro(registro)}</span>
      </span>
      <span className="flex flex-wrap items-start justify-end gap-1.5">
        {registro.resultado ? <Pill className={TOM_DO_RESULTADO[registro.resultado]}>{ROTULO_DO_RESULTADO[registro.resultado]}</Pill> : null}
        {dias !== null && dias <= DIAS_PARA_O_VENCIMENTO ? <Pill className={dias < 0 ? TOM_VENCIDO : TOM_VENCENDO}>{prazoNaFicha(dias)}</Pill> : null}
        {registro.situacao === "substituido" ? <Pill className={TOM_NEUTRO}>Substituído</Pill> : null}
        {registro.situacao === "arquivado" ? <Pill className={TOM_NEUTRO}>Arquivado</Pill> : null}
      </span>
      <AcoesDoRegistro registro={registro} props={props} />
    </li>
  );
}

function SecaoDaCategoria({ categoria, ficha, props }: { categoria: Categoria; ficha: FichaDoRh; props: FichaViewProps }) {
  const daCategoria = ficha.registros.filter((registro) => registro.categoria === categoria);
  const vigentes = daCategoria.filter((registro) => registro.situacao === "vigente");
  const historico = daCategoria.filter((registro) => registro.situacao !== "vigente");
  const id = `categoria-${categoria}`;
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3.5 border-b border-border px-5 py-3.5">
        <h2 id={id} className="text-base font-extrabold">{ROTULO_DA_CATEGORIA[categoria]}</h2>
        <Contador>{vigentes.length}</Contador>
      </div>
      {vigentes.length ? (
        <ul>
          {vigentes.map((registro, indice) => (
            <Linha key={registro.id} registro={registro} hoje={ficha.hoje} primeira={indice === 0} props={props} />
          ))}
        </ul>
      ) : (
        <Vazio>{VAZIO_DA_CATEGORIA[categoria]}</Vazio>
      )}
      {historico.length ? (
        <details className="border-t border-border">
          <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-muted-foreground hover:bg-surface-hover">Histórico · {historico.length}</summary>
          <ul>
            {historico.map((registro, indice) => (
              <Linha key={registro.id} registro={registro} hoje={ficha.hoje} primeira={indice === 0} props={props} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function Formulario({ formulario, ocupado, acoes }: { formulario: FormularioDoRegistro; ocupado: boolean; acoes: AcoesDaFicha }) {
  const alterando = formulario.id !== null;
  const editar = (mudanca: Partial<FormularioDoRegistro>) => acoes.editar({ ...formulario, ...mudanca });
  return (
    <form
      aria-labelledby="formulario-do-registro"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 xl:w-96 xl:shrink-0"
      onSubmit={(evento: FormEvent) => {
        evento.preventDefault();
        acoes.salvar();
      }}
    >
      <h2 id="formulario-do-registro" className="text-base font-extrabold">
        {alterando ? "Alterar registro" : "Novo registro"}
      </h2>
      <Campo id="registro-categoria" rotulo="Categoria">
        <select
          id="registro-categoria"
          className={CAMPO_SELECT}
          value={formulario.categoria}
          disabled={alterando || ocupado}
          onChange={(evento) => acoes.editar(comCategoria(formulario, evento.target.value as Categoria))}
        >
          {CATEGORIAS.map((categoria) => (
            <option key={categoria} value={categoria}>
              {CATEGORIA_NO_FORMULARIO[categoria]}
            </option>
          ))}
        </select>
      </Campo>
      <Campo id="registro-tipo" rotulo="Tipo">
        <select id="registro-tipo" className={CAMPO_SELECT} value={formulario.tipo} disabled={alterando || ocupado} onChange={(evento) => editar({ tipo: evento.target.value })}>
          {tiposDaCategoria(formulario.categoria).map((tipo) => (
            <option key={tipo} value={tipo}>
              {ROTULO_DO_TIPO[tipo] ?? tipo}
            </option>
          ))}
        </select>
      </Campo>
      {formulario.tipo === "outro" ? (
        <Campo id="registro-nome" rotulo="Nome">
          <Input id="registro-nome" maxLength={80} value={formulario.descricao} disabled={ocupado} onChange={(evento) => editar({ descricao: evento.target.value })} />
        </Campo>
      ) : null}
      <Campo id="registro-data" rotulo={rotuloDaData(formulario.categoria)}>
        <Input id="registro-data" type="date" min={PRIMEIRO_DIA} max={ULTIMO_DIA} value={formulario.emitido_em} disabled={ocupado} onChange={(evento) => editar({ emitido_em: evento.target.value })} />
      </Campo>
      <Campo id="registro-vencimento" rotulo="Vence em">
        <Input id="registro-vencimento" type="date" min={PRIMEIRO_DIA} max={ULTIMO_DIA} value={formulario.vence_em} disabled={ocupado} onChange={(evento) => editar({ vence_em: evento.target.value })} />
      </Campo>
      {formulario.categoria === "exame" ? (
        <Campo id="registro-resultado" rotulo="Resultado">
          <select
            id="registro-resultado"
            className={CAMPO_SELECT}
            value={formulario.resultado}
            disabled={ocupado}
            onChange={(evento) => editar({ resultado: evento.target.value as ResultadoDoExame | "" })}
          >
            <option value="">—</option>
            {RESULTADOS_DO_EXAME.map((resultado) => (
              <option key={resultado} value={resultado}>
                {ROTULO_DO_RESULTADO[resultado]}
              </option>
            ))}
          </select>
        </Campo>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={ocupado}>
          Salvar
        </Button>
        <Button type="button" variant="outline" onClick={acoes.fechar} disabled={ocupado}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function FormularioDasDatas({ vinculo, ocupado, acoes }: { vinculo: FormularioDoVinculo; ocupado: boolean; acoes: AcoesDaFicha }) {
  const editar = (mudanca: Partial<FormularioDoVinculo>) => acoes.editarVinculo({ ...vinculo, ...mudanca });
  return (
    <form
      aria-labelledby="formulario-do-vinculo"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 xl:w-96 xl:shrink-0"
      onSubmit={(evento: FormEvent) => {
        evento.preventDefault();
        acoes.salvarVinculo();
      }}
    >
      <h2 id="formulario-do-vinculo" className="text-base font-extrabold">
        Datas do vínculo
      </h2>
      <Campo id="vinculo-admissao" rotulo="Admissão">
        <Input id="vinculo-admissao" type="date" min={PRIMEIRO_DIA} max={ULTIMO_DIA} value={vinculo.admissao} disabled={ocupado} onChange={(evento) => editar({ admissao: evento.target.value })} />
      </Campo>
      <Campo id="vinculo-desligamento" rotulo="Desligamento">
        <Input
          id="vinculo-desligamento"
          type="date"
          min={vinculo.admissao || PRIMEIRO_DIA}
          max={ULTIMO_DIA}
          value={vinculo.desligamento}
          disabled={ocupado}
          onChange={(evento) => editar({ desligamento: evento.target.value })}
        />
      </Campo>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={ocupado}>
          Salvar
        </Button>
        <Button type="button" variant="outline" onClick={acoes.fecharVinculo} disabled={ocupado}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function FichaView(props: FichaViewProps) {
  const { estado, ficha, erro, grava, formulario, vinculo, ocupado, falha, acoes } = props;
  if (estado !== "pronto" || !ficha) {
    return (
      <div className="v3 flex flex-col gap-5 text-foreground">
        <h1 className="text-3xl font-extrabold tracking-tight">Ficha</h1>
        <section aria-label="Ficha" className="rounded-lg border border-border bg-card">
          <Vazio>{estado === "erro" ? (erro ?? "Não foi possível carregar a ficha.") : "Carregando..."}</Vazio>
        </section>
      </div>
    );
  }
  const { colaborador } = ficha;
  const comDatas = temDatasDoVinculo(colaborador);
  const datas = comDatas ? textosDoVinculo(ficha.datas_do_vinculo) : [];
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <h1 className="text-3xl font-extrabold tracking-tight">{colaborador.nome}</h1>
        {colaborador.ativo ? null : <Pill className={TOM_NEUTRO}>Inativo</Pill>}
        {grava && !formulario && !vinculo ? (
          <div className="ml-auto flex flex-wrap gap-2.5">
            {comDatas ? (
              <Button type="button" variant="outline" onClick={acoes.abrirVinculo} disabled={ocupado}>
                Datas do vínculo
              </Button>
            ) : null}
            <Button type="button" onClick={acoes.novo} disabled={ocupado}>
              Novo registro
            </Button>
          </div>
        ) : null}
        <p className="w-full text-base font-semibold text-muted-foreground">
          {[colaborador.funcao, ROTULO_DO_VINCULO[colaborador.vinculo]].filter(Boolean).join(" · ")}
        </p>
        {datas.length ? <p className="w-full text-sm font-bold">{datas.join(" · ")}</p> : null}
      </header>
      {falha ? (
        <p role="alert" className="text-sm font-bold text-destructive-soft-foreground">
          {falha}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-5 xl:flex-row xl:items-start">
        <div className="grid min-w-0 flex-1 gap-5 2xl:grid-cols-3">
          {CATEGORIAS.map((categoria) => (
            <SecaoDaCategoria key={categoria} categoria={categoria} ficha={ficha} props={props} />
          ))}
        </div>
        {grava && formulario ? <Formulario formulario={formulario} ocupado={ocupado} acoes={acoes} /> : null}
        {grava && comDatas && vinculo ? <FormularioDasDatas vinculo={vinculo} ocupado={ocupado} acoes={acoes} /> : null}
      </div>
    </div>
  );
}
