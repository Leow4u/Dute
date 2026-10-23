import { dataBr } from "@/lib/comercial/clientes";
import {
  CATEGORIAS,
  DIAS_PARA_O_VENCIMENTO,
  ROTULO_DA_CATEGORIA,
  ROTULO_DO_RESULTADO,
  ROTULO_DO_VINCULO,
  diasAte,
  nomeDoRegistro,
  textoDoPrazo,
  type Categoria,
  type FichaDoRh,
  type RegistroDoRh,
  type ResultadoDoExame,
} from "@/lib/rh/ficha";
import { cn } from "@/lib/utils";

import { Contador, Pill, TOM_NEUTRO, TOM_OK, TOM_VENCENDO, TOM_VENCIDO, Vazio } from "./pecas";

/**
 * A ficha da pessoa no RH (parte 8.2c): os documentos, os exames e os
 * treinamentos vigentes, com o prazo do vencimento, e o histórico de cada
 * categoria. Sem legenda: só rótulos, dados e ações.
 */

export type EstadoDaFicha = "carregando" | "erro" | "pronto";

const VAZIO_DA_CATEGORIA: Record<Categoria, string> = { documento: "Nenhum documento", exame: "Nenhum exame", treinamento: "Nenhum treinamento" };

const TOM_DO_RESULTADO: Record<ResultadoDoExame, string> = { apto: TOM_OK, apto_com_restricao: TOM_VENCENDO, inapto: TOM_VENCIDO };

/** "Vence em 9 dias", "Venceu há 22 dias": o prazo do registro dentro da janela do Início. */
function prazoNaFicha(dias: number): string {
  const texto = textoDoPrazo(dias);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function datasDoRegistro(registro: RegistroDoRh): string {
  const feito = `${registro.categoria === "documento" ? "Emitido em" : "Feito em"} ${dataBr(registro.emitido_em)}`;
  return [feito, registro.vence_em ? `vence em ${dataBr(registro.vence_em)}` : "sem vencimento"].join(" · ");
}

function Linha({ registro, hoje, primeira }: { registro: RegistroDoRh; hoje: string; primeira: boolean }) {
  const dias = registro.situacao === "vigente" && registro.vence_em ? diasAte(hoje, registro.vence_em) : null;
  return (
    <li className={cn("grid grid-cols-[minmax(0,1fr)_auto] gap-x-3.5 gap-y-1.5 px-5 py-3.5", !primeira && "border-t border-muted")}>
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
    </li>
  );
}

function SecaoDaCategoria({ categoria, registros, hoje }: { categoria: Categoria; registros: readonly RegistroDoRh[]; hoje: string }) {
  const daCategoria = registros.filter((registro) => registro.categoria === categoria);
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
            <Linha key={registro.id} registro={registro} hoje={hoje} primeira={indice === 0} />
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
              <Linha key={registro.id} registro={registro} hoje={hoje} primeira={indice === 0} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export function FichaView({ estado, ficha, erro }: { estado: EstadoDaFicha; ficha: FichaDoRh | undefined; erro: string | null }) {
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
  return (
    <div className="v3 flex flex-col gap-5 text-foreground">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <h1 className="text-3xl font-extrabold tracking-tight">{colaborador.nome}</h1>
        {colaborador.ativo ? null : <Pill className={TOM_NEUTRO}>Inativo</Pill>}
        <p className="w-full text-base font-semibold text-muted-foreground">
          {[colaborador.funcao, ROTULO_DO_VINCULO[colaborador.vinculo]].filter(Boolean).join(" · ")}
        </p>
      </header>
      <div className="grid gap-5 xl:grid-cols-3">
        {CATEGORIAS.map((categoria) => (
          <SecaoDaCategoria key={categoria} categoria={categoria} registros={ficha.registros} hoje={ficha.hoje} />
        ))}
      </div>
    </div>
  );
}
