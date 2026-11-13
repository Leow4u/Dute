import { useRef, type ReactNode } from "react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { BlocoSemConexao, FaixaSemConexao } from "@/components/ui/erro-na-leitura";
import { CartaoComBrilho, Esqueleto } from "@/components/ui/esqueleto";
import { FalhaNaSecao } from "@/components/ui/falha-na-secao";
import { FANTASMAS_SEM_LEMBRANCA, useContagemLembrada } from "@/lib/carregando/contagem-lembrada";
import { useEsperaDaRota } from "@/lib/carregando/espera-da-rota";
import { useChegada } from "@/lib/carregando/use-chegada";
import { useEspera } from "@/lib/carregando/use-espera";
import { fraseDoInicio, type ItemDoInicio, type TomDoItem } from "@/lib/inicio-do-modulo";
import { formatToday, greeting } from "@/lib/saudacao";
import { cn } from "@/lib/utils";

/**
 * O Início de um módulo na v3 (docs/mockups/ModComInicio.dc.html e
 * ModOpInicio.dc.html): a data, a saudação, quantas coisas esperam a pessoa,
 * o "Precisa de você" com a ação de cada item e, ao lado, os números do
 * módulo. Sem legenda: só rótulos, dados e ações.
 */

/** A caixa do ícone de cada tom (também nas linhas do painel do Agent Dute). */
export const CAIXA_DO_TOM: Record<TomDoItem, string> = {
  critical: "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground",
  attention: "border-warning-soft-border bg-warning-soft text-warning-soft-foreground",
  info: "border-info-soft-border bg-info-soft text-info-soft-foreground",
  agent: "border-agent-border bg-agent-soft text-agent",
};

export function TituloDaSecao({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
      {children}
    </h2>
  );
}

/**
 * Linha de número: ponto da cor, rótulo e o valor. O valor que ainda não foi
 * lido é o bloco do esqueleto (`<Esqueleto forma="contagem" />`), nunca o
 * zero (carregamento v2, parte 13e).
 */
export function LinhaDeNumero({ ponto, rotulo, valor, alerta = false }: { ponto: string; rotulo: string; valor: ReactNode; alerta?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 border-t border-border px-5 py-3.5 first:border-t-0">
      <span className={cn("flex items-center gap-2.5 text-base font-semibold", alerta && "text-destructive-soft-foreground")}>
        <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", ponto)} />
        {rotulo}
      </span>
      <span className={cn("text-2xl font-extrabold tabular-nums", alerta && "text-destructive-soft-foreground")}>{valor}</span>
    </li>
  );
}

/** A linha do "Precisa de você": o ícone, o que espera e a ação que leva à tela que resolve. */
export function LinhaDoPrecisa({ item, principal }: { item: ItemDoInicio; principal: boolean }) {
  const Icone = item.icon;
  return (
    <li className="flex flex-col gap-3 border-t border-border px-5 py-4 first:border-t-0 sm:flex-row sm:items-center sm:gap-4 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className={cn("flex size-13 shrink-0 items-center justify-center rounded-lg border", CAIXA_DO_TOM[item.tone])}>
          <Icone className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-base font-bold text-foreground">{item.title}</p>
          {item.detail ? <p className="mt-0.5 text-sm text-muted-foreground sm:truncate">{item.detail}</p> : null}
        </div>
      </div>
      <Button asChild variant={principal ? "default" : "outline"} className="shrink-0 self-start sm:self-auto">
        <Link href={item.href}>{item.actionLabel}</Link>
      </Button>
    </li>
  );
}

export type InicioDoModuloProps = {
  nome: string;
  hoje: Date;
  /** "no Comercial", "na Operação": entra na frase de quantas coisas esperam. */
  noModulo: string;
  itens: readonly ItemDoInicio[];
  carregando: boolean;
  falhas: readonly string[];
  /** A coluna ao lado: os números do módulo. */
  lateral?: ReactNode;
  /**
   * Sem rede (docs/plataforma/diagnostico-carregamento.md, decisão 2 do
   * celular): o que já estava fica, com a hora da leitura (`lidaEm`); sem
   * nada lido (`lidaEm: null`), o aviso no lugar do "Precisa de você", e
   * nenhuma frase de que nada espera.
   */
  semConexao?: { lidaEm: number | null; tentando: boolean; onTentar: () => void } | null;
  /**
   * A nova tentativa das leituras do Início: o "Tentar de novo" no aviso das
   * fontes que falharam (`falhas`) e na demora da primeira leitura (10 s e
   * 70 s). `alerta` falso quando toda fonte que falhou já tinha sido lida (a
   * releitura que falhou): o aviso fica escrito, sem falar (momento 7).
   */
  tentarFalhas?: { tentando: boolean; onTentar: () => unknown; alerta?: boolean };
};

/** O id da linha que diz que o Início lê, para o "Precisa de você" apontar para ela (momento 2). */
const ID_DA_ESPERA = "inicio-lendo";

/** As formas das linhas-fantasma do "Precisa de você", em rodízio. */
const FORMAS_DA_LINHA_FANTASMA = [
  { titulo: "w-2/5", apoio: "w-3/5", botao: "w-24" },
  { titulo: "w-1/3", apoio: "w-1/4", botao: "w-24" },
  { titulo: "w-1/3", apoio: "w-1/6", botao: "w-26" },
] as const;

/**
 * O "Precisa de você" na primeira leitura (carregamento v2, momento 2, e a
 * prancha da abertura): o cartão já com a altura das linhas-fantasma, que
 * entram aos 300 ms com a anatomia da linha real (a caixa de 52 px, o título,
 * o apoio e o botão de 40 px), e o brilho de dois ciclos. Quantas: a última
 * contagem lida deste Início, guardada no aparelho (de 1 a 5; sem ela, 2),
 * para o cartão não mudar de tamanho quando as linhas chegam. Decorativas:
 * quem diz que lê é a linha de estado sob a saudação.
 */
function PrecisaCarregando({ visivel, linhas }: { visivel: boolean; linhas: number }) {
  const formas = Array.from({ length: linhas }, (_, indice) => FORMAS_DA_LINHA_FANTASMA[indice % FORMAS_DA_LINHA_FANTASMA.length]!);
  return (
    <CartaoComBrilho className="rounded-lg border border-border bg-card" aria-hidden="true">
      {formas.map((linha, indice) => (
        <div
          key={indice}
          data-linha-fantasma=""
          className={cn(
            "flex flex-col gap-3 border-t border-border px-5 py-4 transition-opacity duration-150 first:border-t-0 motion-reduce:transition-none sm:flex-row sm:items-center sm:gap-4 md:px-6",
            visivel ? "opacity-100" : "opacity-0",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <Esqueleto forma="icone" className="size-13" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Esqueleto forma="texto" className={linha.titulo} />
              <Esqueleto forma="texto" className={cn("h-2.5", linha.apoio)} />
            </div>
          </div>
          <Esqueleto forma="botao" className={cn("self-start sm:self-auto", linha.botao)} />
        </div>
      ))}
    </CartaoComBrilho>
  );
}

export function InicioDoModulo({ nome, hoje, noModulo, itens, carregando, falhas, lateral, semConexao = null, tentarFalhas }: InicioDoModuloProps) {
  const primeiroNome = nome.split(" ")[0] ?? "";
  const frase = fraseDoInicio(itens.length, noModulo);
  const semNadaLido = semConexao !== null && semConexao.lidaEm === null;
  // A primeira leitura continua a espera da rota ("Abrindo Início…"): o mesmo relógio, sem o vão de 300 ms.
  const rota = useEsperaDaRota(carregando);
  const fantasmas = useEspera(carregando, { desde: rota?.inicio }).visivel;
  // A contagem lida (só a leitura inteira, sem falta) dá o tamanho do cartão na próxima abertura.
  const lida = !carregando && !semConexao && falhas.length === 0;
  const lembrada = useContagemLembrada(`inicio:${noModulo}`, "todos", lida ? { precisa: itens.length } : null);
  const reservada = fraseDoInicio(lembrada.lembrada("precisa") ?? FANTASMAS_SEM_LEMBRANCA, noModulo);
  const fraseReservada = [reservada.destaque, reservada.resto].filter(Boolean).join(" ");
  // Na última leitura, nada esperava a pessoa: o "Precisa de você" não nasce lendo para sumir quando ela chega vazia,
  // e o que está ao lado e embaixo não salta (só a primeira visita, sem lembrança, pode errar).
  const nadaNaUltima = lembrada.lembrada("precisa") === 0;
  // A chegada (momento 2): as linhas reais entram por opacidade, com a subida de 4 px e a cascata de 30 ms.
  const secao = useRef<HTMLElement>(null);
  const chegando = useChegada(carregando, secao);
  // Com uma fonte que falhou e nada na lista, a frase não diz "Nada parado": o aviso da falha fala.
  const semFrase = semNadaLido || (falhas.length > 0 && itens.length === 0);
  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-col gap-1.5">
        <p className="text-base font-semibold text-muted-foreground">{formatToday(hoje)}</p>
        <h1 className="text-4xl font-extrabold tracking-tight">
          {greeting(hoje)}
          {primeiroNome ? `, ${primeiroNome}` : ""}
        </h1>
        {semFrase ? null : carregando ? (
          // No lugar da frase, com a altura dela: nunca "nada espera" antes de ler (momento 2). A frase da última
          // leitura guarda o lugar, invisível e fora da árvore (só no CSS, sem texto no documento): no celular, onde
          // ela quebra em duas linhas, nada desce quando ela chega.
          <div className="grid">
            <p
              aria-hidden="true"
              data-reserva-da-frase=""
              data-frase={fraseReservada}
              className="invisible col-start-1 row-start-1 text-lg before:content-[attr(data-frase)]"
            />
            <CarregandoNaRegiao
              id={ID_DA_ESPERA}
              rotulo="Carregando o que precisa de você…"
              continuaARota
              onTentar={tentarFalhas ? () => void tentarFalhas.onTentar() : undefined}
              className="col-start-1 row-start-1 min-h-7"
            />
          </div>
        ) : (
          <p className="text-lg text-muted-foreground" data-chegada-vazio={chegando ? "" : undefined}>
            {frase.destaque ? <strong className="font-extrabold text-destructive-soft-foreground">{frase.destaque}</strong> : null}
            {frase.destaque ? " " : null}
            {frase.resto}
          </p>
        )}
      </header>

      {semConexao ? (
        semConexao.lidaEm === null ? (
          <BlocoSemConexao tentando={semConexao.tentando} onTentar={semConexao.onTentar} />
        ) : (
          <FaixaSemConexao lidaEm={semConexao.lidaEm} tentando={semConexao.tentando} onTentar={semConexao.onTentar} />
        )
      ) : falhas.length ? (
        tentarFalhas ? (
          <FalhaNaSecao
            mensagem={`Não foi possível carregar: ${falhas.join(", ")}.`}
            tentando={tentarFalhas.tentando}
            onTentar={tentarFalhas.onTentar}
            alerta={tentarFalhas.alerta ?? true}
            tom="aviso"
            className="rounded-lg border border-warning-soft-border bg-warning-soft px-4 py-3"
          />
        ) : (
          <p role="alert" className="rounded-lg border border-warning-soft-border bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-soft-foreground">
            Não foi possível carregar: {falhas.join(", ")}.
          </p>
        )
      ) : null}

      <div className="flex flex-wrap items-start gap-7">
        {!semNadaLido && ((carregando && !nadaNaUltima) || itens.length) ? (
          <section
            ref={secao}
            aria-labelledby="precisa-de-voce"
            aria-busy={carregando || undefined}
            aria-describedby={carregando && !semFrase ? ID_DA_ESPERA : undefined}
            className="flex min-w-0 flex-[2.2_1_560px] flex-col gap-3.5"
          >
            <TituloDaSecao id="precisa-de-voce">Precisa de você</TituloDaSecao>
            {carregando ? (
              <PrecisaCarregando visivel={fantasmas} linhas={lembrada.linhas("precisa")} />
            ) : (
              <ul className="rounded-lg border border-border bg-card" data-chegada={chegando ? "" : undefined}>
                {itens.map((item, indice) => (
                  <LinhaDoPrecisa key={item.id} item={item} principal={indice === 0} />
                ))}
              </ul>
            )}
          </section>
        ) : null}
        {lateral ? <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">{lateral}</div> : null}
      </div>
    </div>
  );
}
