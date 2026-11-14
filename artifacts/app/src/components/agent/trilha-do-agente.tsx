import { useEffect, useId, useRef } from "react";
import { CircleStop, Clock3, History } from "lucide-react";

import { CaixaDeAlerta } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { DEMORANDO } from "@/components/ui/carregando-tela";
import { Spinner } from "@/components/ui/spinner";
import { consultaDoAgente, resumoDaTrilha } from "@/lib/agent-chat";
import { useAnuncio } from "@/lib/carregando/anunciador";
import { useEspera } from "@/lib/carregando/use-espera";
import { cn } from "@/lib/utils";

/** Uma consulta que o stream informou: a ferramenta (`nome`, como o servidor manda) e onde ela está. */
export interface ConsultaDoAgente {
  nome: string;
  estado: "lendo" | "lida" | "erro";
}

/** A trilha mostra até 4 linhas; daí em diante, as mais antigas recolhem em "+2 consultas". */
export const LINHAS_DA_TRILHA = 4;

/** O primeiro passo, antes de a primeira consulta chegar. */
export const LENDO_A_PERGUNTA = "Lendo a pergunta…";

/** O que o leitor de tela ouve: o texto sem a reticência. */
function falado(texto: string): string {
  return texto.replace(/…$/, "");
}

type Linha =
  | { tipo: "vez"; chave: string; texto: string }
  | { tipo: "feita"; chave: string; texto: string }
  | { tipo: "erro"; chave: string; texto: string }
  | { tipo: "recolhido"; chave: string; texto: string };

/**
 * As linhas da trilha: "Lendo a pergunta…" antes da primeira consulta; uma
 * por consulta depois ("Consultando o estoque…" na da vez, "Estoque" nas
 * feitas). Passando de 4, as mais antigas recolhem numa linha ("+2
 * consultas") e ficam as 3 últimas.
 */
export function linhasDaTrilha(consultas: readonly ConsultaDoAgente[]): Linha[] {
  if (!consultas.length) return [{ tipo: "vez", chave: "pergunta", texto: LENDO_A_PERGUNTA }];
  const linhas: Linha[] = consultas.map((consulta, indice) => {
    const rotulo = consultaDoAgente(consulta.nome);
    const chave = `${indice}:${consulta.nome}`;
    if (consulta.estado === "lendo") return { tipo: "vez", chave, texto: rotulo.vez };
    return { tipo: consulta.estado === "erro" ? "erro" : "feita", chave, texto: rotulo.feita };
  });
  if (linhas.length <= LINHAS_DA_TRILHA) return linhas;
  const recolhidas = linhas.length - (LINHAS_DA_TRILHA - 1);
  return [{ tipo: "recolhido", chave: "recolhidas", texto: `+${recolhidas} consultas` }, ...linhas.slice(recolhidas)];
}

/** O que o check da consulta feita diz ao leitor de tela: a linha "Estoque" sozinha não diz que já foi lida. */
export const CONSULTA_FEITA = "Consulta feita";

/**
 * O check violeta de 16 px (a caixa do agente fechada), na célula de 20 px da
 * linha. Na linha da consulta feita, ele é o que diz que ela acabou e tem o
 * nome "Consulta feita"; na trilha recolhida, o "Leu…" já diz, e ele é
 * decorativo.
 */
function CheckDoAgente({ rotulo }: { rotulo?: string }) {
  return (
    <svg
      data-check=""
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      focusable="false"
      {...(rotulo ? { role: "img", "aria-label": rotulo } : { "aria-hidden": true })}
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LinhaDaTrilha({ linha, calmo }: { linha: Linha; calmo: boolean }) {
  return (
    <li data-passo={linha.tipo} className="trilha-do-agente-passo flex min-h-7 items-center gap-2.5 text-sm">
      <span className="flex size-5 shrink-0 items-center justify-center text-carregando-agente">
        {linha.tipo === "vez" ? (
          <Spinner tamanho={20} calmo={calmo} />
        ) : linha.tipo === "feita" ? (
          <CheckDoAgente rotulo={CONSULTA_FEITA} />
        ) : linha.tipo === "erro" ? (
          <CaixaDeAlerta className="size-5 text-destructive" />
        ) : (
          <History className="size-4 text-muted-foreground" aria-hidden="true" />
        )}
      </span>
      <span
        className={cn(
          "min-w-0 truncate",
          linha.tipo === "vez" && "font-bold text-carregando-agente dark:text-agent-strong",
          linha.tipo === "recolhido" && "font-bold text-muted-foreground",
          (linha.tipo === "feita" || linha.tipo === "erro") && "font-semibold text-foreground",
        )}
      >
        {linha.texto}
      </span>
    </li>
  );
}

/**
 * A trilha recolhida numa linha, na mesma caixa violeta, quando o texto
 * começa ("Leu o estoque e o razão de movimentos"), e na resposta gravada,
 * com o mesmo desenho: a resposta que termina de chegar não muda de lugar.
 * A linha tem a altura de uma linha da trilha (28 px, a caixa com 50). Sem
 * leitura, nada.
 */
export function TrilhaRecolhida({ nomes, className }: { nomes: readonly string[] | null | undefined; className?: string }) {
  const resumo = resumoDaTrilha(nomes);
  if (!resumo) return null;
  return (
    <p
      data-trilha-recolhida=""
      className={cn(
        "flex w-fit max-w-full items-center gap-2.5 rounded-lg border border-agent-border bg-agent-soft px-3.5 py-2.5 text-sm font-semibold text-foreground",
        className,
      )}
    >
      <span className="flex min-h-7 w-5 shrink-0 items-center justify-center text-carregando-agente">
        <CheckDoAgente />
      </span>
      <span className="min-w-0">{resumo}</span>
    </p>
  );
}

export interface TrilhaDoAgenteProps {
  /** As consultas que o stream informou, na ordem (`tools` e `runningTool` do agent-screen). */
  consultas: readonly ConsultaDoAgente[];
  /** O texto da resposta começou: a trilha recolhe numa linha. */
  escrevendo: boolean;
  /** 10 s sem texto: "Demorando mais que o normal" e o Parar. */
  demorando: boolean;
  /** Para de esperar neste aparelho (o AbortController da conversa). O agente só lê e não grava nada. */
  onParar?: () => void;
  /** Quando a espera começou (`performance.now()`), se ela continua uma que já estava na tela. */
  desde?: number;
  className?: string;
}

/**
 * A trilha do Agent Dute (carregamento v2, aprovado em 12/11/2026, momento 9),
 * no lugar do "Pensando…" e das etiquetas soltas das consultas: a caixa
 * violeta e o que o agente está lendo, sem texto com brilho, sem três
 * pontinhos e sem "Pensando…".
 *
 * - Aos 300 ms, a caixa de 20 px e "Lendo a pergunta…". Cada consulta que o
 *   stream informa vira uma linha: "Consultando o estoque…" na da vez, com a
 *   caixa, e "Estoque" com o check violeta nas feitas. Até 4 linhas; as mais
 *   antigas recolhem em "+2 consultas".
 * - Quando o texto começa, a trilha recolhe numa linha ("Leu o estoque e o
 *   razão de movimentos").
 * - Aos 10 s sem texto (`demorando`), "Demorando mais que o normal" e
 *   "Parar", com 44 px: só corta a espera neste aparelho.
 * - A linha nova entra em 150 ms (opacidade e 4 px) e o check com a mola; aos
 *   5 s a trilha para de animar, e a caixa da vez continua, calma depois de
 *   10 s. No movimento reduzido, a caixa respira até o piso do violeta (0,75
 *   no claro e 0,85 no escuro), as linhas entram por opacidade e o check
 *   aparece pronto.
 *
 * Não é região viva: o `Anunciador` fala o primeiro passo ("Consultando o
 * estoque") e o aviso de 10 s; quem fala "Resposta pronta" é a conversa. O
 * desenho mora em index.css (`.trilha-do-agente`).
 */
export function TrilhaDoAgente({ consultas, escrevendo, demorando, onParar, desde, className }: TrilhaDoAgenteProps) {
  const espera = useEspera(true, { desde });
  const anunciar = useAnuncio();
  const avisoId = useId();
  const primeira = consultas[0];
  const falouOPrimeiro = useRef(false);
  const falouADemora = useRef(false);
  const visivel = espera.visivel && !escrevendo;
  const primeiroPasso = primeira ? consultaDoAgente(primeira.nome).vez : null;

  // O que esperava a vez no anunciador sai da fila quando a trilha sai (o texto começou, a pessoa parou).
  const retirarOPrimeiro = useRef<() => void>(() => undefined);
  const retirarADemora = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!visivel || !primeiroPasso || falouOPrimeiro.current) return;
    falouOPrimeiro.current = true;
    retirarOPrimeiro.current = anunciar(falado(primeiroPasso));
  }, [visivel, primeiroPasso, anunciar]);

  useEffect(() => {
    if (!demorando || escrevendo || falouADemora.current) return;
    falouADemora.current = true;
    retirarADemora.current = anunciar(DEMORANDO);
  }, [demorando, escrevendo, anunciar]);

  useEffect(() => {
    if (!escrevendo) return;
    retirarOPrimeiro.current();
    retirarADemora.current();
  }, [escrevendo]);
  useEffect(
    () => () => {
      retirarOPrimeiro.current();
      retirarADemora.current();
    },
    [],
  );

  // A trilha recolhe numa linha: ela entra em 150 ms (opacidade e 4 px), no lugar da trilha aberta.
  if (escrevendo) return <TrilhaRecolhida nomes={consultas.map((consulta) => consulta.nome)} className={cn("trilha-do-agente-recolhe", className)} />;
  if (!espera.visivel) return null;

  const calmo = espera.calmo || demorando;
  return (
    <div
      data-trilha-do-agente=""
      data-movimento={espera.movimento ? "" : undefined}
      className={cn("trilha-do-agente flex flex-col gap-2", className)}
    >
      {/* A caixa tem pelo menos 300 px: a borda direita não pula a cada consulta. */}
      <ol className="trilha-do-agente-caixa flex min-w-75 max-w-full flex-col gap-1.5 self-start rounded-lg border border-agent-border bg-agent-soft px-3.5 py-2.5">
        {linhasDaTrilha(consultas).map((linha) => (
          <LinhaDaTrilha key={linha.chave} linha={linha} calmo={calmo} />
        ))}
      </ol>
      {demorando ? (
        <div className="trilha-do-agente-aviso flex flex-wrap items-center gap-2.5">
          <span id={avisoId} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-warning-soft-border bg-warning-soft px-3 text-sm font-bold text-carregando-aviso">
            <Clock3 className="size-4" aria-hidden="true" />
            {DEMORANDO}
          </span>
          {onParar ? (
            <Button type="button" variant="outline" className="min-h-11" aria-describedby={avisoId} onClick={onParar}>
              <CircleStop aria-hidden="true" />
              Parar
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * De onde o Agent Dute tirou a resposta (carregamento v2, momento 9;
 * invariante 3: a IA mostra de onde tirou), em chips no fim dela: "De onde
 * tirei: Estoque · Razão de movimentos". Os nomes vêm das consultas da
 * resposta (`tools_used`); o rascunho, a rotina e a anotação não são fonte.
 */
export function FontesDaResposta({ fontes, className }: { fontes: readonly string[]; className?: string }) {
  const rotuloId = useId();
  if (!fontes.length) return null;
  return (
    <div data-fontes="" className={cn("flex flex-wrap items-center gap-1.5 text-xs font-bold text-muted-foreground", className)}>
      <span id={rotuloId}>De onde tirei:</span>
      <ul aria-labelledby={rotuloId} className="flex flex-wrap gap-1.5">
        {fontes.map((fonte) => (
          <li key={fonte} className="inline-flex h-6.5 items-center rounded-full border border-agent-border bg-agent-soft px-2.5 text-carregando-agente dark:text-agent-strong">
            {fonte}
          </li>
        ))}
      </ul>
    </div>
  );
}
