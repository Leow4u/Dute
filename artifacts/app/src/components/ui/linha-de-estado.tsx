import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { Clock3, RefreshCw, WifiOff } from "lucide-react";

import { ArcosDoWifi } from "@/components/ui/arcos-do-wifi";
import { Button } from "@/components/ui/button";
import { useFaltaNaTela } from "@/components/ui/erro-na-leitura";
import { Spinner } from "@/components/ui/spinner";
import { useAnuncio } from "@/lib/carregando/anunciador";
import { useTentarDeNovo } from "@/lib/carregando/estado-da-conexao";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { listaLida, type LeituraDaLista } from "@/lib/carregando/use-atualizar-lista";
import { useEspera } from "@/lib/carregando/use-espera";
import { ehFaltaDeConexao, horaDaLeitura } from "@/lib/conexao";
import { cn } from "@/lib/utils";

export type { LeituraDaLista } from "@/lib/carregando/use-atualizar-lista";

/** O que a linha de estado diz (carregamento v2, seção 5.3). */
export type EstadoDaLinha =
  /** Nada: antes de 300 ms, sem leitura, ou com o aviso no lugar da lista (o `BlocoSemConexao`, o `ErroNaLeitura`). */
  | { tipo: "vazia" }
  | { tipo: "carregando"; calmo: boolean }
  | { tipo: "demorando"; calmo: boolean }
  | { tipo: "lida"; hora: string }
  | { tipo: "atualizando" }
  | { tipo: "reconectando"; hora: string }
  | { tipo: "sem-conexao"; hora: string };

export interface LinhaDeEstadoProps {
  /** A leitura da lista, ou as leituras que ela junta (Pedidos lê as filas e as solicitações). */
  leitura: LeituraDaLista | readonly LeituraDaLista[];
  /** O que a lista mostra, no plural e em minúsculas: "Carregando pedidos…". */
  objeto: string;
  /**
   * A releitura em curso foi pedida pela pessoa e tem a barra no topo do
   * cartão (a volta do app ao primeiro plano): passados 5 s, quando a barra
   * para, a linha diz "Atualizando…". Sem ela, a releitura é automática e
   * não mostra nada.
   */
  pedidaPelaPessoa?: boolean;
  className?: string;
}

/**
 * "Atualizado às": a hora da leitura mais recente da lista, a última vez que
 * ela se atualizou (no Estoque, os saldos relêem a cada 2 min e o catálogo a
 * cada 5). Na falta, "lista de": a da mais antiga das que falharam, porque é
 * dela o dado mais velho na tela (o `semConexaoNaLeitura`).
 */
function horaDaLista(leituras: readonly LeituraDaLista[], qual: "recente" | "antiga"): string {
  const horas = leituras.map((leitura) => leitura.dataUpdatedAt);
  return horaDaLeitura(qual === "recente" ? Math.max(...horas) : Math.min(...horas));
}

/** A camada que a linha mostra, com a chave que diz quando ela troca. */
function chaveDoEstado(estado: EstadoDaLinha): string {
  return "hora" in estado ? `${estado.tipo}:${estado.hora}` : estado.tipo;
}

/**
 * A linha de estado das listas (carregamento v2, seção 5.3, momentos 2, 7 e
 * 8; aprovada em 12/11/2026): uma linha de 24 px, sempre reservada, sob o
 * título de Pedidos, Receber, Estoque e Estoque › Alertas. É a casa do estado
 * da lista, e nada empurra a lista:
 *
 * - a primeira leitura, depois de 300 ms: o indicador de 24 px e "Carregando
 *   pedidos…", com o anúncio; aos 10 s, a pílula âmbar "Demorando mais que o
 *   normal" e "Tentar de novo", com o indicador na volta calma;
 * - lida: "Atualizado às 10:42";
 * - a releitura pedida pela pessoa, com a barra do topo passando de 5 s:
 *   "Atualizando…". A releitura automática não mostra nada, não fala e não
 *   mexe na região viva: no fim, só a hora muda;
 * - a falta de conexão com a lista lida (absorve o `FaixaSemConexao`):
 *   "Reconectando… · lista de 10:42" em tinta, com os arcos do Wi-Fi, ou a
 *   pílula âmbar "Sem conexão · lista de 10:42", pelo estado único da
 *   conexão; as duas com "Tentar de novo";
 * - sem nada lido, nada: o aviso fica no lugar da lista.
 *
 * Não é região viva. O Anunciador diz "Carregando pedidos" aos 300 ms e
 * "Demorando mais que o normal" aos 10 s, só na primeira leitura; "Sem
 * conexão" ele diz sozinho, uma vez, e nunca "Reconectando" nem a volta. O
 * texto troca em sequência (sai em 80 ms, entra em 150 ms), e só o atual
 * fica na árvore. "Tentar de novo" tem o toque de 44 px por um `::before`
 * com `inset: -10px`, sem mudar a altura da linha. O CSS mora em index.css
 * (`.linha-de-estado`).
 */
export function LinhaDeEstado({ leitura, objeto, pedidaPelaPessoa = false, className }: LinhaDeEstadoProps) {
  const leituras: readonly LeituraDaLista[] = Array.isArray(leitura) ? leitura : [leitura as LeituraDaLista];
  const lida = listaLida(leituras);
  const primeira = leituras.some((uma) => uma.isLoading);
  const espera = useEspera(primeira);
  const releitura = useEspera(pedidaPelaPessoa && lida && leituras.some((uma) => uma.isFetching));
  const falta = useFaltaNaTela();
  const comFalta = leituras.filter((uma) => uma.isError && ehFaltaDeConexao(uma.error));
  const anunciar = useAnuncio();
  const tentarDeNovo = useTentarDeNovo();
  const cliente = useContext(QueryClientContext);
  const [tentativas, setTentativas] = useState(0);
  const novaTentativa = useEspera(tentativas > 0, { segurarMinimo: true });

  const estado: EstadoDaLinha = comFalta.length
    ? lida
      ? { tipo: falta, hora: horaDaLista(comFalta, "antiga") }
      : { tipo: "vazia" }
    : primeira
      ? espera.visivel
        ? { tipo: espera.fase === "andamento" || espera.fase === "com-objeto" ? "carregando" : "demorando", calmo: espera.calmo }
        : { tipo: "vazia" }
      : !lida
        ? { tipo: "vazia" }
        : releitura.visivel && !releitura.movimento
          ? { tipo: "atualizando" }
          : { tipo: "lida", hora: horaDaLista(leituras, "recente") };

  // Os anúncios da primeira leitura, uma vez cada: a entrada na espera aos 300 ms e a demora aos 10 s.
  const falados = useRef({ carregando: false, demorando: false });
  useEffect(() => {
    if (!primeira) {
      falados.current = { carregando: false, demorando: false };
      return;
    }
    if (estado.tipo === "carregando" && !falados.current.carregando) {
      falados.current.carregando = true;
      anunciar(`Carregando ${objeto}`);
    } else if (estado.tipo === "demorando" && !falados.current.demorando) {
      falados.current.demorando = true;
      anunciar("Demorando mais que o normal");
    }
  }, [anunciar, estado.tipo, objeto, primeira]);

  /**
   * A nova tentativa no relógio da espera, como a do bloco (parte 7a): acorda
   * a conexão de quem lê e relê. "Tentando de novo…" só depois de 300 ms, e
   * pelo menos 500 ms; a trava do toque segue o que o botão diz: enquanto
   * ele diz "Tentando de novo…" (`aria-disabled`), o toque não faz nada.
   */
  const tentar = () => {
    if (novaTentativa.visivel) return;
    setTentativas((quantas) => quantas + 1);
    tentarDeNovo(() => {
      // Na primeira leitura que demora, o refetch só se juntaria à leitura presa (o react-query não recomeça a
      // leitura sem dado): ela é cancelada e lida de novo. Com a lista lida, o refetch já recomeça.
      const presas = primeira && cliente
        ? cliente.cancelQueries({ type: "active", fetchStatus: "fetching", predicate: (consulta) => consulta.state.data === undefined })
        : Promise.resolve();
      void presas
        .then(() => Promise.all(leituras.map((uma) => uma.refetch())))
        .finally(() => setTentativas((quantas) => quantas - 1));
    });
  };

  const conteudo = desenhar(estado, objeto, novaTentativa.visivel, tentar);
  const camadas = useTrocaEmSequencia(chaveDoEstado(estado), conteudo);

  return (
    <div data-linha-de-estado="" data-estado={estado.tipo} className={cn("linha-de-estado", className)}>
      {camadas}
    </div>
  );
}

/** O "Tentar de novo" da linha: texto sublinhado, com o toque estendido a 44 px. Ocupado não é desabilitado. */
function TentarDeNovo({ mostrando, aviso = false, onTentar }: { mostrando: boolean; aviso?: boolean; onTentar: () => void }) {
  return (
    <button
      type="button"
      className="linha-de-estado-tentar"
      data-tom={aviso ? "aviso" : undefined}
      aria-disabled={mostrando || undefined}
      aria-busy={mostrando || undefined}
      onClick={onTentar}
    >
      {mostrando ? <Spinner /> : null}
      {mostrando ? "Tentando de novo…" : "Tentar de novo"}
    </button>
  );
}

function desenhar(estado: EstadoDaLinha, objeto: string, mostrando: boolean, onTentar: () => void): ReactNode {
  const tentar = (aviso: boolean) => <TentarDeNovo mostrando={mostrando} aviso={aviso} onTentar={onTentar} />;
  switch (estado.tipo) {
    case "vazia":
      return null;
    case "carregando":
      return (
        <>
          <Spinner tamanho={24} calmo={estado.calmo} />
          <span className="linha-de-estado-forte">{`Carregando ${objeto}…`}</span>
        </>
      );
    case "demorando":
      return (
        <>
          <Spinner tamanho={24} calmo={estado.calmo} />
          <span className="linha-de-estado-pilula">
            <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
            Demorando mais que o normal
          </span>
          {tentar(true)}
        </>
      );
    case "lida":
      return <span className="linha-de-estado-calmo">{`Atualizado às ${estado.hora}`}</span>;
    case "atualizando":
      return (
        <>
          <Spinner tamanho={24} />
          <span className="linha-de-estado-forte">Atualizando…</span>
        </>
      );
    case "reconectando":
      return (
        <>
          <ArcosDoWifi className="size-5" />
          <span className="linha-de-estado-forte">Reconectando…</span>
          <span className="linha-de-estado-calmo">{`· lista de ${estado.hora}`}</span>
          {tentar(false)}
        </>
      );
    case "sem-conexao":
      return (
        <>
          <span className="linha-de-estado-pilula">
            <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
            {`Sem conexão · lista de ${estado.hora}`}
          </span>
          {tentar(true)}
        </>
      );
  }
}

/**
 * A troca do texto em sequência, nunca sobreposta (momento 8): o que sai
 * some em 80 ms subindo 3 px e só então o novo entra, em 150 ms, de 3 px
 * abaixo; no movimento reduzido, de uma vez. Quem sai fica fora da árvore e
 * sem toque (`aria-hidden` e `inert`); só o atual é lido.
 */
function useTrocaEmSequencia(chave: string, conteudo: ReactNode): ReactNode {
  const [mostrada, setMostrada] = useState(chave);
  const [saindo, setSaindo] = useState<{ chave: string; conteudo: ReactNode } | null>(null);
  const [trocou, setTrocou] = useState(false);
  const desenhado = useRef<ReactNode>(conteudo);
  if (chave !== mostrada) {
    setSaindo(desenhado.current === null ? null : { chave: mostrada, conteudo: desenhado.current });
    setMostrada(chave);
    setTrocou(true);
  }
  useEffect(() => {
    desenhado.current = conteudo;
  });
  useEffect(() => {
    if (saindo === null) return undefined;
    const fim = setTimeout(() => setSaindo(null), CARREGANDO.trocaSaiMs);
    return () => clearTimeout(fim);
  }, [saindo]);
  return (
    <>
      {saindo ? (
        <p key={`sai:${saindo.chave}`} data-camada="" data-sai="" aria-hidden="true" inert>
          {saindo.conteudo}
        </p>
      ) : null}
      {conteudo === null ? null : (
        <p key={chave} data-camada="" data-entra={trocou ? (saindo ? "depois" : "") : undefined}>
          {conteudo}
        </p>
      )}
    </>
  );
}

export interface BotaoAtualizarProps {
  /** O Atualizar tocado está lendo (o `atualizando` do useAtualizarLista). */
  atualizando: boolean;
  /** A primeira leitura: o botão fica travado (aria-disabled), sem indicador. */
  travado?: boolean;
  onAtualizar: () => void;
  className?: string;
}

/**
 * O Atualizar das listas (carregamento v2, momento 7, caso 1, e a decisão
 * 9.4.5 do celular): 40 × 40 no computador e 44 × 44 no celular, também no
 * Estoque, no lugar do puxar para atualizar. Só mostra a espera quando a
 * pessoa toca nele: passados 300 ms, a caixa de 16 px (20 px no celular) no
 * lugar do ícone, com `aria-busy`, e no mínimo 500 ms. A releitura
 * automática não o gira nem o desabilita. Ocupado não é desabilitado: o
 * toque repetido é barrado aqui, com `aria-disabled`.
 */
export function BotaoAtualizar({ atualizando, travado = false, onAtualizar, className }: BotaoAtualizarProps) {
  const espera = useEspera(atualizando, { segurarMinimo: true });
  const ocupado = atualizando || travado;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      data-atualizar=""
      className={cn("max-md:size-11", travado && !atualizando && "opacity-45", className)}
      aria-disabled={ocupado || undefined}
      aria-busy={espera.visivel || undefined}
      onClick={() => {
        if (!ocupado) onAtualizar();
      }}
    >
      {espera.visivel ? (
        <>
          <Spinner tamanho={16} calmo={espera.calmo} className="max-md:hidden" />
          <Spinner tamanho={20} calmo={espera.calmo} className="md:hidden" />
        </>
      ) : (
        <RefreshCw aria-hidden="true" />
      )}
      <span className="sr-only">Atualizar</span>
    </Button>
  );
}
