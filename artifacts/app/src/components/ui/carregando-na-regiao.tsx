import { Clock3 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { DEMORANDO, SEM_RESPOSTA } from "@/components/ui/carregando-tela";
import { ErroNaLeitura, useFocoAoSair } from "@/components/ui/erro-na-leitura";
import { Spinner } from "@/components/ui/spinner";
import { useAnuncio } from "@/lib/carregando/anunciador";
import { novaEsperaDaRota, useEsperaDaRota, useEsperaDaRotaNaTela, type EsperaDaRota } from "@/lib/carregando/espera-da-rota";
import { useTentarDeNovo } from "@/lib/carregando/estado-da-conexao";
import { useEspera } from "@/lib/carregando/use-espera";
import { cn } from "@/lib/utils";

/**
 * A região da tela que ainda lê (carregamento v2, seção 3 e momento 1), no
 * lugar do "Carregando…" solto e do ícone girando: antes de 300 ms nada
 * aparece; depois, a caixa de 24 px e o rótulo no gerúndio ("Carregando
 * anotações…"), com o anúncio na região do `Anunciador`; aos 10 s, a volta
 * calma e "Demorando mais que o normal", anunciado uma vez. A falha não é
 * daqui: quem lê mostra o `ErroNaLeitura` ou o `BlocoSemConexao`.
 *
 * Com `onTentar` (a leitura que quem usa sabe repetir), a demora tem a saída
 * da tabela da seção 3: aos 10 s, "Tentar de novo" ao lado do aviso; aos
 * 70 s, a desistência, "Sem resposta do servidor." no `ErroNaLeitura`, com
 * "Tentar de novo". A nova tentativa recomeça o relógio, e o foco que estava
 * no botão fica na região (nunca no `body`). Quem usa repete a leitura do
 * zero: o react-query não recomeça a leitura sem dado que ainda lê
 * (`relerDoZero`).
 *
 * A altura da linha fica reservada desde 0 ms, para o conteúdo de baixo não
 * pular quando o indicador entra.
 *
 * Com `continuaARota` (a região que é a primeira leitura da tela, como o
 * Início), a região que entra lendo continua a espera da `CarregandoTela`
 * (lib/carregando/espera-da-rota.ts): o mesmo relógio, sem o vão de 300 ms,
 * e sem anunciar de novo a entrada ("Abrindo Início") nem a demora que ela já
 * anunciou. O anúncio da rota que ainda espera a vez passa a esta região, que
 * o retira quando sai.
 *
 * Com `passaAdiante` (a leitura que toda tela de uma área espera antes da
 * própria, como a do portal do cliente), a região é, ela também, a espera que
 * a próxima região continua: quando a tela chega e ainda lê o que é dela
 * ("Carregando eventos…"), o indicador não some, o relógio é o mesmo, e o que
 * já foi anunciado não é anunciado de novo.
 *
 * Quando a leitura chega e a região sai com o foco nela (a pessoa tocou em
 * "Tentar de novo"), o foco vai a `focoAoSair` (o id de quem fica, como a
 * volta da fatura; parte 13d) ou, sem ele, ao título da seção ou da tela que
 * chegou, nunca ao `body` (WCAG 2.4.3).
 */
export function CarregandoNaRegiao({
  rotulo,
  className,
  continuaARota = false,
  passaAdiante = false,
  onTentar,
  id,
  focoAoSair,
}: {
  rotulo: string;
  className?: string;
  continuaARota?: boolean;
  /** A próxima região que entra lendo continua esta espera (a leitura da área antes da da tela). */
  passaAdiante?: boolean;
  /** Repete a leitura: "Tentar de novo" aos 10 s e a desistência aos 70 s. A promessa que ela devolve não precisa ser tratada. */
  onTentar?: () => unknown;
  /** O id da região, para a lista que lê apontar para ela (`aria-describedby`; momento 2). */
  id?: string;
  /** O id de quem recebe o foco quando a região sai com ele dentro (a nova tentativa que deu certo). */
  focoAoSair?: string;
}) {
  const [tentativa, setTentativa] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const levarOFoco = useRef(false);
  const tentarDeNovo = useTentarDeNovo();
  const tentar = onTentar
    ? () => {
        levarOFoco.current = Boolean(raiz.current && raiz.current.contains(raiz.current.ownerDocument.activeElement));
        setTentativa((atual) => atual + 1);
        // A releitura que falha mostra a falha pela leitura: a promessa dela não fica sem tratar.
        tentarDeNovo(() => void Promise.resolve(onTentar()).catch(() => undefined));
      }
    : undefined;
  // O botão tocado sai com a espera que recomeça: o foco fica na região.
  useLayoutEffect(() => {
    if (!levarOFoco.current) return;
    levarOFoco.current = false;
    raiz.current?.focus({ preventScroll: true });
  }, [tentativa]);
  // A leitura chegou e a região sai com o foco: ele vai a `focoAoSair` ou ao título de onde ela morava, não ao `body`.
  useFocoAoSair(raiz, focoAoSair);
  return (
    <div
      ref={raiz}
      id={id}
      tabIndex={onTentar ? -1 : undefined}
      data-carregando-na-regiao=""
      className={cn(
        "flex min-h-6 flex-wrap items-center gap-x-3 gap-y-2 rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-foco",
        className,
      )}
    >
      <EsperaDaRegiao
        key={tentativa}
        rotulo={rotulo}
        continuaARota={continuaARota && tentativa === 0}
        passaAdiante={passaAdiante}
        onTentar={tentar}
      />
    </div>
  );
}

/**
 * A espera que a região passa adiante: o mesmo começo e o que a espera que ela
 * continua já anunciou, com o anúncio que ainda espera a vez.
 */
function esperaQuePassaAdiante(rota: EsperaDaRota | null): EsperaDaRota {
  const espera = novaEsperaDaRota(rota?.inicio);
  espera.daRegiao = true;
  if (rota) {
    espera.entrada = rota.entrada;
    espera.demora = rota.demora;
    espera.retirar = rota.retirar;
  }
  return espera;
}

/** Uma espera da região: a primeira, ou a que a pessoa pediu de novo (o relógio volta ao zero). */
function EsperaDaRegiao({
  rotulo,
  continuaARota,
  passaAdiante,
  onTentar,
}: {
  rotulo: string;
  continuaARota: boolean;
  passaAdiante: boolean;
  onTentar?: () => void;
}) {
  const rota = useEsperaDaRota(continuaARota, true);
  const [propria] = useState(() => (passaAdiante ? esperaQuePassaAdiante(rota) : null));
  useEsperaDaRotaNaTela(propria);
  const espera = useEspera(true, { desde: propria?.inicio ?? rota?.inicio });
  // A espera que continua outra já à vista (a do portal, que passa à da tela): a caixa não entra de novo.
  const [continua] = useState(() => Boolean(rota) && espera.visivel);
  const anunciar = useAnuncio();
  const marco = !espera.visivel
    ? null
    : espera.fase === "sem-resposta" && onTentar
      ? "sem-resposta"
      : espera.fase === "demorando" || espera.fase === "sem-resposta"
        ? "demorando"
        : "espera";

  // A espera que acabou (a lista chegou, ou passou à demora) retira o anúncio dela, se ele ainda esperava a vez,
  // menos o que a região que continua esta espera herdou. A desistência é um alerta (o ErroNaLeitura): o leitor de
  // tela já a ouve.
  useEffect(() => {
    if (marco !== "espera" && marco !== "demorando") return undefined;
    if (marco === "espera" ? rota?.entrada : rota?.demora) return undefined;
    const retirar = anunciar(marco === "espera" ? rotulo.replace(/…$/, "") : DEMORANDO);
    if (propria) {
      if (marco === "espera") propria.entrada = true;
      else propria.demora = true;
      propria.retirar = retirar;
    }
    return () => {
      if (!propria?.herdada) retirar();
    };
  }, [marco, anunciar, rotulo, rota, propria]);
  // O anúncio da rota que esta região herdou sai com ela, se não passou adiante.
  useEffect(
    () => () => {
      if (!propria?.herdada) rota?.retirar?.();
    },
    [rota, propria],
  );

  if (!espera.visivel) return null;
  if (marco === "sem-resposta" && onTentar) {
    return <ErroNaLeitura mensagem={SEM_RESPOSTA} tentando={false} onTentar={onTentar} className="w-full" />;
  }
  return (
    <>
      <span className="flex items-center gap-2.5">
        <Spinner tamanho={24} calmo={espera.calmo} className="text-foreground" data-continua={continua ? "" : undefined} />
        <span className="text-sm font-bold text-foreground">{rotulo}</span>
      </span>
      {marco === "demorando" ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-warning-soft px-2.5 text-sm font-bold text-amber-soft-foreground">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {DEMORANDO}
          </span>
          {onTentar ? (
            // "Tentar de novo" na demora da leitura, com o toque de 44 px (seção 3 e 7).
            <button type="button" className="linha-de-estado-tentar" data-tom="aviso" onClick={onTentar}>
              Tentar de novo
            </button>
          ) : null}
        </span>
      ) : null}
    </>
  );
}
