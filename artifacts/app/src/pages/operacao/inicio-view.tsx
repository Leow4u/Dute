import { Link } from "wouter";

import { InicioDoModulo, LinhaDeNumero, TituloDaSecao } from "@/components/inicio/inicio-do-modulo";
import { Button } from "@/components/ui/button";
import { CartaoComBrilho, Esqueleto } from "@/components/ui/esqueleto";
import { ROTA_HOJE } from "@/lib/operacao/navegacao";
import type { HojeNaOperacao, PessoaDeHoje } from "@/lib/operacao/pendencias";
import type { InicioDaOperacao } from "@/lib/operacao/use-inicio";
import { cn } from "@/lib/utils";

/**
 * Início da Operação (parte 2.6, docs/mockups/ModOpInicio.dc.html): o que
 * espera a coordenação e, ao lado, o dia e a equipe. Sem valores.
 */

/**
 * O número que ainda não foi lido (carregamento v2, parte 13g, como o "Hoje
 * no armazém" da 13e): o bloco do esqueleto do tamanho do número de 24 px,
 * nunca o zero antes de ler.
 */
const BLOCO = <Esqueleto forma="contagem" className="h-4.5 w-7" />;

/** Os números do dia; lendo (`numeros` nulo), a mesma forma com os blocos. */
function NumerosDoDia({ numeros }: { numeros: HojeNaOperacao | null }) {
  return (
    <section aria-labelledby="hoje-na-operacao" aria-busy={!numeros || undefined} className="flex flex-col gap-3.5">
      <TituloDaSecao id="hoje-na-operacao">Hoje na operação</TituloDaSecao>
      <div className="rounded-lg border border-border bg-card">
        <ul>
          <LinhaDeNumero ponto="bg-info-soft-foreground" rotulo="Agendadas hoje" valor={numeros ? numeros.agendadasHoje : BLOCO} />
          <LinhaDeNumero ponto="bg-warning-soft-foreground" rotulo="Para agendar" valor={numeros ? numeros.paraAgendar : BLOCO} />
          <LinhaDeNumero ponto="bg-muted-foreground" rotulo="Próximos dias" valor={numeros ? numeros.proximosDias : BLOCO} />
        </ul>
        <div className="border-t border-border px-5 py-4">
          <Button asChild variant="outline" className="w-full">
            <Link href={ROTA_HOJE}>Abrir o Hoje</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/** A equipe de hoje; lendo (`equipe` nula), linhas-fantasma com a anatomia da linha (o avatar e o nome). */
function EquipeDeHoje({ equipe }: { equipe: PessoaDeHoje[] | null }) {
  return (
    <section aria-labelledby="equipe-hoje" aria-busy={!equipe || undefined} className="flex flex-col gap-3.5">
      <TituloDaSecao id="equipe-hoje">Equipe hoje</TituloDaSecao>
      {!equipe ? (
        <CartaoComBrilho ordem={1} aria-hidden="true" className="rounded-lg border border-border bg-card">
          {["w-2/5", "w-1/3", "w-1/2"].map((largura) => (
            <div key={largura} className="flex items-center gap-3 border-t border-border px-5 py-3 first:border-t-0">
              <Esqueleto forma="bloco" className="size-8 rounded-full" />
              <Esqueleto forma="texto" className={largura} />
            </div>
          ))}
        </CartaoComBrilho>
      ) : equipe.length ? (
        <ul className="rounded-lg border border-border bg-card">
          {equipe.map((pessoa) => (
            <li key={pessoa.id} className="flex items-center gap-3 border-t border-border px-5 py-3 first:border-t-0">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background"
              >
                {pessoa.iniciais}
              </span>
              <span className="min-w-0 flex-1 truncate text-base font-semibold">{pessoa.nome}</span>
              <span className={cn("shrink-0 text-sm tabular-nums", pessoa.escala ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {pessoa.escala ?? "livre"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-border bg-card px-5 py-4 text-sm text-muted-foreground">Nenhum colaborador ativo</p>
      )}
    </section>
  );
}

/**
 * A falta de conexão das leituras ao vivo do Início (carregamento v2, parte
 * 13j): sem nada lido, o aviso no lugar do "Precisa de você"; com tudo lido, o
 * que estava fica, com "Sem conexão · lista de 10:42". O erro do servidor
 * segue no aviso das fontes que falharam.
 */
function semConexaoDo(inicio: InicioDaOperacao) {
  const releitura = inicio.releitura;
  if (!releitura || releitura.falta !== "conexao") return null;
  return {
    lidaEm: inicio.falhas.length ? null : (releitura.lidaEm ?? null),
    tentando: releitura.tentando,
    onTentar: () => void releitura.tentar(),
  };
}

export function InicioDaOperacaoView({ nome, hoje, inicio }: { nome: string; hoje: Date; inicio: InicioDaOperacao }) {
  // Lendo, a forma final com os blocos (nunca o zero nem o bloco rosado); sem leitura, o aviso da falha diz.
  const lendo = inicio.carregando && !inicio.falhas.length;
  const lateral =
    inicio.numeros || inicio.equipe || lendo ? (
      <>
        {inicio.numeros || lendo ? <NumerosDoDia numeros={inicio.numeros ?? null} /> : null}
        {inicio.equipe || lendo ? <EquipeDeHoje equipe={inicio.equipe ?? null} /> : null}
      </>
    ) : null;
  return (
    <InicioDoModulo
      nome={nome}
      hoje={hoje}
      noModulo="na Operação"
      itens={inicio.itens}
      carregando={inicio.carregando}
      falhas={inicio.falhas}
      lateral={lateral}
      semConexao={semConexaoDo(inicio)}
      tentarFalhas={inicio.releitura ? { tentando: inicio.releitura.tentando, onTentar: inicio.releitura.tentar } : undefined}
    />
  );
}
