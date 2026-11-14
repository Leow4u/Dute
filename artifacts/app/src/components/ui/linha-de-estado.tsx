import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { AlertCircle, Clock3, RefreshCw, WifiOff } from "lucide-react";

import { ArcosDoWifi } from "@/components/ui/arcos-do-wifi";
import { Button } from "@/components/ui/button";
import { useFaltaNaTela } from "@/components/ui/erro-na-leitura";
import { Spinner } from "@/components/ui/spinner";
import { useAnuncio, useRetirarAnuncio } from "@/lib/carregando/anunciador";
import { useEsperaDaRota } from "@/lib/carregando/espera-da-rota";
import { useTentarDeNovo } from "@/lib/carregando/estado-da-conexao";
import { usePedidosDaPessoa } from "@/lib/carregando/pedido-da-pessoa";
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
  | { tipo: "sem-conexao"; hora: string }
  /** A releitura falhou por outro motivo que não a conexão, com a lista lida: ela fica (momento 7). */
  | { tipo: "falhou"; hora: string };

export interface LinhaDeEstadoProps {
  /** A leitura da lista, ou as leituras que ela junta (Pedidos lê as filas e as solicitações). */
  leitura: LeituraDaLista | readonly LeituraDaLista[];
  /** O que a lista mostra, no plural e em minúsculas: "Carregando pedidos…". */
  objeto: string;
  /**
   * A releitura em curso foi pedida pela pessoa e tem a barra no topo do
   * cartão (a volta do app ao primeiro plano; a troca de filtro, mês ou
   * cliente): passados 5 s, quando a barra para, a linha diz "Atualizando…".
   * Sem ela, a releitura é automática e não mostra nada. A leitura que troca
   * (`isPlaceholderData`) conta como pedida.
   */
  pedidaPelaPessoa?: boolean;
  /**
   * O id da linha, para a lista apontar para ela (`aria-describedby`)
   * enquanto mostra as linhas-fantasma da primeira leitura (momento 2).
   */
  id?: string;
  /**
   * O que o Anunciador diz quando a primeira leitura termina ("3 para
   * aprovar, 2 para separar, 1 para entregar"; momento 2), e só se ele disse
   * "Carregando pedidos" aos 300 ms: a leitura rápida não fala nada.
   */
  resumo?: string;
  /**
   * A espera da primeira leitura fica no lugar da lista (a `CarregandoNaRegiao`
   * das Movimentações e das Exceções): a linha fica vazia e calada até a lista
   * chegar.
   */
  primeiraNaLista?: boolean;
  /**
   * A hora da lista está em outra linha da tela (a aba Histórico, sob a linha
   * do Estoque): lida, esta linha fica vazia, e só diz o que muda (a troca que
   * passa de 5 s, a demora, a falha e a falta de conexão).
   */
  semHora?: boolean;
  className?: string;
}

/**
 * "Atualizado às": a hora da leitura mais recente da lista, a última vez que
 * ela se atualizou (no Estoque, os saldos relêem a cada 2 min e o catálogo a
 * cada 5). Na falta, "lista de": a da mais antiga, porque é dela o dado mais
 * velho na tela (o `semConexaoNaLeitura`).
 */
function horaDaLista(leituras: readonly LeituraDaLista[], qual: "recente" | "antiga"): string | null {
  // A leitura que troca ainda não tem hora própria (a lista na tela é a anterior): fica de fora.
  const horas = leituras.map((leitura) => leitura.dataUpdatedAt).filter((quando) => quando > 0);
  if (!horas.length) return null;
  return horaDaLeitura(qual === "recente" ? Math.max(...horas) : Math.min(...horas));
}

/** Os estados de espera: o que sai deles sai em 180 ms, como o indicador (momentos 2 e 7). */
const ESPERAS: ReadonlySet<EstadoDaLinha["tipo"]> = new Set(["carregando", "demorando", "atualizando"]);

/** O estado inteiro, com a hora: muda quando a linha troca de texto. */
function chaveDoEstado(estado: EstadoDaLinha): string {
  return "hora" in estado ? `${estado.tipo}:${estado.hora}` : estado.tipo;
}

/**
 * A camada de fora: a primeira leitura e a demora dela são uma camada só,
 * com a mesma caixa, que passa à volta calma aos 10 s sem sair do lugar; só o
 * texto troca, dentro dela (momento 2).
 */
function camadaDoEstado(estado: EstadoDaLinha): string {
  return estado.tipo === "carregando" || estado.tipo === "demorando" ? "primeira" : chaveDoEstado(estado);
}

/** O "Tentar de novo" que está na tela: o da camada atual, nunca o da que sai. */
function tentarNaTela(raiz: HTMLElement): HTMLElement | null {
  return Array.from(raiz.querySelectorAll<HTMLElement>(".linha-de-estado-tentar")).find((botao) => !botao.closest("[data-sai]")) ?? null;
}

/**
 * A linha de estado das listas (carregamento v2, seção 5.3, momentos 2, 7 e
 * 8; aprovada em 12/11/2026): uma linha de 24 px, sempre reservada, sob o
 * título de Pedidos, Receber, Estoque e Estoque › Alertas. É a casa do estado
 * da lista, e nada empurra a lista:
 *
 * - a primeira leitura, depois de 300 ms: o indicador de 24 px e "Carregando
 *   pedidos…", com o anúncio; aos 10 s, a pílula âmbar "Demorando mais que o
 *   normal" e "Tentar de novo", com a mesma caixa na volta calma;
 * - lida: "Atualizado às 10:42";
 * - a releitura pedida pela pessoa (a volta do app, a troca de filtro, mês
 *   ou cliente), com a barra do topo passando de 5 s: "Atualizando…". A
 *   releitura automática não mostra nada, não fala e não mexe na região
 *   viva: no fim, só a hora muda;
 * - a releitura que falhou por outro motivo que não a conexão, com a lista
 *   lida: a lista fica, e a linha diz "Não consegui atualizar · lista de
 *   10:42", com "Tentar de novo" (momento 7: o erro na releitura nunca apaga
 *   a lista);
 * - a falta de conexão com a lista lida (absorve o `FaixaSemConexao`):
 *   "Reconectando… · lista de 10:42" em tinta, com os arcos do Wi-Fi, ou a
 *   pílula âmbar "Sem conexão · lista de 10:42", pelo estado único da
 *   conexão; as duas com "Tentar de novo". "Sem conexão" também com o
 *   aparelho sem rede e nenhuma leitura falhando ainda; na volta da rede, fica
 *   até a leitura voltar (então "Atualizado às"), e só passa a "Reconectando…"
 *   se o servidor ainda não respondeu depois do mínimo de 2 s do aviso;
 * - sem nada lido, nada: o aviso fica no lugar da lista.
 *
 * Não é região viva. O Anunciador diz "Carregando pedidos" aos 300 ms,
 * "Demorando mais que o normal" aos 10 s e, na chegada, o `resumo` da lista
 * (só se disse o primeiro), só na primeira leitura (a releitura automática
 * depois de uma falha não fala; a que a pessoa pede com "Tentar de novo",
 * sim); "Sem conexão" ele diz sozinho, uma vez, e nunca "Reconectando" nem a
 * volta. O que a linha pediu e o Anunciador ainda não disse sai com ela da
 * tela. Com a leitura que falhou sem nada lido, a linha fica vazia: o aviso
 * está no lugar da lista. O texto troca em sequência
 * (sai em 80 ms, ou em 180 ms quando sai uma espera; entra em 150 ms), e só
 * o atual fica na árvore. Com o foco no "Tentar de novo", a troca leva o foco
 * ao "Tentar de novo" novo ou, sem ele, à própria linha: nunca ao `body`.
 * "Tentar de novo" tem o toque de 44 px por um `::before` com `inset: -10px`,
 * sem mudar a altura da linha. No celular estreito, o que não cabe numa linha
 * passa à de baixo, sem sair da tela. O CSS mora em index.css
 * (`.linha-de-estado`).
 */
export function LinhaDeEstado({
  leitura,
  objeto,
  pedidaPelaPessoa = false,
  id,
  resumo,
  primeiraNaLista = false,
  semHora = false,
  className,
}: LinhaDeEstadoProps) {
  const leituras: readonly LeituraDaLista[] = Array.isArray(leitura) ? leitura : [leitura as LeituraDaLista];
  const lida = listaLida(leituras);
  const primeira = leituras.some((uma) => uma.isLoading);
  // A primeira leitura que começa quando a tela chega continua a espera da rota: o mesmo relógio, sem vão.
  const rota = useEsperaDaRota(primeira, true);
  const espera = useEspera(primeira, { desde: rota?.inicio });
  const trocando = leituras.some((uma) => uma.isPlaceholderData === true);
  const releitura = useEspera((pedidaPelaPessoa || trocando) && lida && leituras.some((uma) => uma.isFetching));
  const comFalta = leituras.filter((uma) => uma.isError && ehFaltaDeConexao(uma.error));
  // A releitura que falhou por outro motivo, com a lista lida: a lista fica, e a linha diz (momento 7).
  const comErro = leituras.filter((uma) => uma.isError && !ehFaltaDeConexao(uma.error) && uma.dataUpdatedAt > 0);
  const falta = useVoltaDaRede(useFaltaNaTela(), comFalta.length > 0);
  const anunciar = useAnuncio();
  const retirarAnuncio = useRetirarAnuncio();
  const pedidosDaPessoa = usePedidosDaPessoa();
  const tentarDeNovo = useTentarDeNovo();
  const cliente = useContext(QueryClientContext);
  const [tentativas, setTentativas] = useState(0);
  const novaTentativa = useEspera(tentativas > 0, { segurarMinimo: true });
  const raiz = useRef<HTMLDivElement>(null);
  // O que a linha diz depois de uma leitura (o "Não consegui atualizar") só com ela ainda na tela.
  const montada = useRef(true);
  useEffect(() => {
    montada.current = true;
    return () => {
      montada.current = false;
    };
  }, []);

  // A leitura que falhou sem nada lido: o aviso está no lugar da lista (o `ErroNaLeitura`, o `BlocoSemConexao`), e a
  // linha não diz "Carregando" ao lado dele, nem enquanto a outra leitura da lista ainda lê.
  const falhou = !lida && leituras.some((uma) => uma.isError);
  // A hora da lista que está na tela: na troca em que nenhuma leitura tem hora própria, a última dita.
  const horaVista = useRef<string | null>(null);
  const hora = (dessas: readonly LeituraDaLista[], qual: "recente" | "antiga") => {
    const achada = horaDaLista(dessas, qual) ?? horaVista.current ?? horaDaLeitura(Date.now());
    horaVista.current = achada;
    return achada;
  };
  // A releitura pedida (a troca de filtro, a volta do app) que passa de 10 s: a demora, com "Tentar de novo", como na
  // primeira leitura (o relógio da espera, seção 3); antes, aos 5 s, "Atualizando…".
  const releituraDemorando = releitura.visivel && (releitura.fase === "demorando" || releitura.fase === "sem-resposta");
  const estado: EstadoDaLinha = !lida
    ? comFalta.length || falhou || primeiraNaLista
      ? { tipo: "vazia" }
      : primeira && espera.visivel
        ? { tipo: espera.fase === "andamento" || espera.fase === "com-objeto" ? "carregando" : "demorando", calmo: espera.calmo }
        : { tipo: "vazia" }
    : comFalta.length
      ? { tipo: falta, hora: hora(comFalta, "antiga") }
      : falta === "sem-conexao"
        ? // O aparelho sem rede há 3 s, antes de qualquer leitura falhar (momento 8).
          { tipo: "sem-conexao", hora: hora(leituras, "antiga") }
        : releituraDemorando
          ? { tipo: "demorando", calmo: releitura.calmo }
          : releitura.visivel && !releitura.movimento
            ? { tipo: "atualizando" }
            : comErro.length
              ? { tipo: "falhou", hora: hora(comErro, "antiga") }
              : semHora
                ? { tipo: "vazia" }
                : { tipo: "lida", hora: hora(leituras, "recente") };

  // Os anúncios da primeira leitura, uma vez cada: a entrada na espera aos 300 ms, a demora aos 10 s e, quando a
  // lista chega, o resumo dela, só se a entrada foi falada. Depois que ela falhou, quem relê é a releitura
  // automática (o intervalo da tela, a do bloco), que não fala; a conta recomeça quando a lista é lida, ou quando a
  // pessoa pede de novo ("Tentar de novo"): a nova tentativa dela começa a ler e fala como a primeira.
  // A espera que continua a da rota já teve a entrada (e a demora) anunciada por ela: não anuncia de novo, e o
  // resumo é dito na chegada, como se esta linha tivesse dito "Carregando".
  const falados = useRef({ carregando: rota?.entrada ?? false, demorando: rota?.demora ?? false, calado: false, pedido: false });
  const pedidoVisto = useRef(pedidosDaPessoa);
  // O que esta linha mandou dizer: quando ela sai da tela, o que ainda espera o intervalo do Anunciador sai junto.
  const ditos = useRef(new Set<string>());
  // A demora da releitura pedida é dita uma vez, ao entrar (seção 7: o aviso de 10 s).
  const demoraDaReleitura = useRef(false);
  // Os anúncios da espera que ainda podem esperar a vez ("Carregando pedidos", a demora e o da rota que esta linha
  // continua): quando a espera acaba (a lista chegou, a leitura falhou), saem da fila. O leitor de tela não ouve
  // "Carregando estoque" com a lista já na tela, nem depois do aviso da falha.
  const daEspera = useRef<Array<() => void>>(rota ? [() => rota.retirar?.()] : []);
  useEffect(() => {
    const dizer = (texto: string) => {
      ditos.current.add(texto);
      return anunciar(texto);
    };
    const acabouAEspera = () => {
      for (const retirar of daEspera.current.splice(0)) retirar();
    };
    if (lida && estado.tipo === "demorando") {
      if (!demoraDaReleitura.current) dizer("Demorando mais que o normal");
      demoraDaReleitura.current = true;
    } else {
      demoraDaReleitura.current = false;
    }
    if (pedidosDaPessoa !== pedidoVisto.current) {
      pedidoVisto.current = pedidosDaPessoa;
      // Só o pedido depois da falha conta: é ele que tira a linha do silêncio.
      if (!lida && falados.current.calado) falados.current.pedido = true;
    }
    if (lida) {
      acabouAEspera();
      if (falados.current.carregando && !falados.current.calado && resumo) dizer(resumo);
      falados.current = { carregando: false, demorando: false, calado: false, pedido: false };
      return;
    }
    if (falhou) {
      acabouAEspera();
      falados.current.calado = true;
    } else if (falados.current.pedido) falados.current = { carregando: false, demorando: false, calado: false, pedido: false };
    if (falados.current.calado) return;
    if (estado.tipo === "carregando" && !falados.current.carregando) {
      falados.current.carregando = true;
      daEspera.current.push(dizer(`Carregando ${objeto}`));
    } else if (estado.tipo === "demorando" && !falados.current.demorando) {
      falados.current.demorando = true;
      daEspera.current.push(dizer("Demorando mais que o normal"));
    }
  }, [anunciar, estado.tipo, falhou, lida, objeto, pedidosDaPessoa, resumo]);
  useEffect(() => {
    const pedidos = ditos.current;
    const espera = daEspera.current;
    return () => {
      for (const texto of pedidos) retirarAnuncio(texto);
      for (const retirar of espera.splice(0)) retirar();
    };
  }, [retirarAnuncio]);

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
      // leitura sem dado): ela é cancelada e lida de novo. Só as da lista: cada `refetch` é o do observador dela,
      // e o que a tela lê além da lista (o cliente ativo, as caixas, os contadores do menu) segue lendo.
      const daLista = new Set<unknown>(leituras.map((uma) => uma.refetch));
      // A troca que demora também: a leitura do filtro novo ainda não tem dado (a lista na tela é a anterior).
      const presas = (primeira || trocando) && cliente
        ? cliente.cancelQueries({
            predicate: (consulta) =>
              consulta.state.data === undefined &&
              consulta.state.fetchStatus === "fetching" &&
              consulta.observers.some((observador) => daLista.has(observador.refetch)),
          })
        : Promise.resolve();
      void presas
        .then(() => Promise.all(leituras.map((uma) => uma.refetch())))
        .then((resultados) => {
          // A pessoa pediu e a releitura falhou de novo: o Anunciador diz (a falta de conexão ele diz sozinho), só com
          // a linha ainda na tela, e o que ainda espera o intervalo dele sai com ela.
          if (!montada.current) return;
          if (resultados.some((resultado) => resultado.isError && !ehFaltaDeConexao(resultado.error))) {
            ditos.current.add("Não consegui atualizar");
            anunciar("Não consegui atualizar");
          }
        })
        .finally(() => setTentativas((quantas) => quantas - 1));
    });
  };

  // O foco no "Tentar de novo" não cai no body quando a linha troca (de Reconectando para Sem conexão, ou a
  // tentativa que deu certo): vai ao "Tentar de novo" da camada nova ou, sem ele, à própria linha.
  const chave = chaveDoEstado(estado);
  const [troca, setTroca] = useState({ chave, levarOFoco: false });
  if (troca.chave !== chave) {
    const ativo = typeof document === "undefined" ? null : document.activeElement;
    setTroca({ chave, levarOFoco: Boolean(ativo && raiz.current?.contains(ativo) && ativo.classList.contains("linha-de-estado-tentar")) });
  }
  useLayoutEffect(() => {
    if (!troca.levarOFoco || !raiz.current) return;
    (tentarNaTela(raiz.current) ?? raiz.current).focus({ preventScroll: true });
  }, [troca]);

  const conteudo = desenhar(estado, objeto, novaTentativa.visivel, tentar);
  const camadas = useTrocaEmSequencia(camadaDoEstado(estado), conteudo, ESPERAS.has(estado.tipo));

  return (
    <div ref={raiz} id={id} tabIndex={-1} data-linha-de-estado="" data-estado={estado.tipo} className={cn("linha-de-estado", className)}>
      {camadas.map(({ chave: camada, conteudo: dentro, sai, entra }) => (
        <p key={camada} data-camada="" data-sai={sai} data-entra={entra} aria-hidden={sai === undefined ? undefined : true} inert={sai !== undefined}>
          {dentro}
        </p>
      ))}
    </div>
  );
}

/**
 * Na volta da rede, "Sem conexão" fica até a leitura voltar (momento 8: da
 * pílula direto para "Atualizado às 10:44"): a conexão passa a "reconectando"
 * assim que o aparelho tem rede, antes de o servidor responder. Só se ele
 * ainda não respondeu depois do mínimo de 2 s do aviso, a linha diz
 * "Reconectando…".
 */
function useVoltaDaRede(falta: "sem-conexao" | "reconectando", comFalta: boolean): "sem-conexao" | "reconectando" {
  const [anterior, setAnterior] = useState(falta);
  const [segurando, setSegurando] = useState(false);
  if (anterior !== falta) {
    setAnterior(falta);
    setSegurando(anterior === "sem-conexao" && falta === "reconectando");
  }
  useEffect(() => {
    if (!segurando) return undefined;
    const fim = setTimeout(() => setSegurando(false), CARREGANDO.avisoMinimoMs);
    return () => clearTimeout(fim);
  }, [segurando]);
  return segurando && comFalta ? "sem-conexao" : falta;
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
      {/* No celular, sem a caixa: a linha já tem o indicador dela, e o rótulo mais largo não sai da tela. */}
      {mostrando ? <Spinner className="max-sm:hidden" /> : null}
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
    case "demorando":
      // A mesma caixa nos dois: aos 10 s ela passa à volta calma no lugar, e só o texto troca (momento 2).
      return (
        <>
          <Spinner tamanho={24} calmo={estado.calmo} />
          <TextoDaPrimeira tipo={estado.tipo} objeto={objeto} tentar={tentar(true)} />
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
    case "falhou":
      return (
        <>
          <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span className="linha-de-estado-forte">Não consegui atualizar</span>
          <span className="linha-de-estado-calmo">{`· lista de ${estado.hora}`}</span>
          {tentar(false)}
        </>
      );
  }
}

/** O texto da primeira leitura, ao lado da caixa: "Carregando pedidos…" e, aos 10 s, a demora, em sequência. */
function TextoDaPrimeira({ tipo, objeto, tentar }: { tipo: "carregando" | "demorando"; objeto: string; tentar: ReactNode }) {
  const conteudo =
    tipo === "carregando" ? (
      <span className="linha-de-estado-forte">{`Carregando ${objeto}…`}</span>
    ) : (
      <>
        <span className="linha-de-estado-pilula">
          <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
          Demorando mais que o normal
        </span>
        {tentar}
      </>
    );
  const camadas = useTrocaEmSequencia(tipo, conteudo, false);
  return (
    <span data-textos="">
      {camadas.map(({ chave, conteudo: dentro, sai, entra }) => (
        <span key={chave} data-camada="" data-sai={sai} data-entra={entra} aria-hidden={sai === undefined ? undefined : true} inert={sai !== undefined}>
          {dentro}
        </span>
      ))}
    </span>
  );
}

/** Uma camada da troca em sequência: a que sai (`sai`) ou a atual (`entra`, quando acabou de entrar). */
export interface CamadaDaTroca {
  chave: string;
  conteudo: ReactNode;
  /** A que sai: "" (80 ms) ou "espera" (a espera que acabou, 180 ms). */
  sai?: "" | "espera";
  /** A que entra: "" (na hora), "depois" (depois dos 80 ms) ou "depois-da-espera" (depois dos 180 ms). */
  entra?: "" | "depois" | "depois-da-espera";
}

/**
 * A troca em sequência, nunca sobreposta (momento 8): o que sai some em 80
 * ms subindo 3 px (em 180 ms quando é uma espera que acaba, `espera`, como o
 * indicador: momentos 2 e 7) e só então o novo entra, em 150 ms, de 3 px
 * abaixo; no movimento reduzido, de uma vez. As duas correm no relógio do
 * CSS: a entrada guarda o atraso dela até o fim (`entra` não muda quando a
 * outra sai), e a camada que saiu deixa a árvore só quando a nova acabou de
 * entrar, sem cortar a saída no meio. A camada que sai guarda a chave dela, e
 * nada dentro remonta (a caixa não recomeça a entrada); fica fora da árvore
 * de acessibilidade e sem toque (`aria-hidden` e `inert`); só a atual é lida.
 */
export function useTrocaEmSequencia(chave: string, conteudo: ReactNode, espera: boolean): CamadaDaTroca[] {
  const [mostrada, setMostrada] = useState<{ chave: string; espera: boolean; entra?: CamadaDaTroca["entra"] }>({ chave, espera });
  const [saindo, setSaindo] = useState<{ chave: string; conteudo: ReactNode; espera: boolean } | null>(null);
  const desenhado = useRef<ReactNode>(conteudo);
  if (chave !== mostrada.chave) {
    const sai = desenhado.current === null ? null : { chave: mostrada.chave, conteudo: desenhado.current, espera: mostrada.espera };
    setSaindo(sai);
    setMostrada({ chave, espera, entra: sai === null ? "" : sai.espera ? "depois-da-espera" : "depois" });
  } else if (espera !== mostrada.espera) {
    setMostrada({ ...mostrada, espera });
  }
  useEffect(() => {
    desenhado.current = conteudo;
  });
  useEffect(() => {
    if (saindo === null) return undefined;
    const fim = setTimeout(() => setSaindo(null), (saindo.espera ? CARREGANDO.saidaMs : CARREGANDO.trocaSaiMs) + CARREGANDO.trocaEntraMs);
    return () => clearTimeout(fim);
  }, [saindo]);
  const camadas: CamadaDaTroca[] = [];
  // A que sai vem antes, com a chave dela: o React a mantém, só com os atributos de quem sai.
  if (saindo && saindo.chave !== chave) camadas.push({ chave: saindo.chave, conteudo: saindo.conteudo, sai: saindo.espera ? "espera" : "" });
  if (conteudo !== null) camadas.push({ chave, conteudo, entra: mostrada.entra });
  return camadas;
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
 * pessoa toca nele: passados 300 ms, o ícone sai em 80 ms e só então entra a
 * caixa de 16 px (20 px no celular), em 150 ms, com `aria-busy`, e no mínimo
 * 500 ms; no fim, a caixa sai em 180 ms e o ícone volta. A releitura
 * automática não o gira nem o desabilita. Travado na primeira leitura, a
 * 0,45, e volta a 1 em 150 ms quando a lista chega. Ocupado não é
 * desabilitado: o toque repetido é barrado aqui, com `aria-disabled`.
 */
export function BotaoAtualizar({ atualizando, travado = false, onAtualizar, className }: BotaoAtualizarProps) {
  const espera = useEspera(atualizando, { segurarMinimo: true });
  const ocupado = atualizando || travado;
  const icone = espera.visivel ? (
    <>
      <Spinner tamanho={16} calmo={espera.calmo} className="max-md:hidden" />
      <Spinner tamanho={20} calmo={espera.calmo} className="md:hidden" />
    </>
  ) : (
    <RefreshCw aria-hidden="true" />
  );
  const camadas = useTrocaEmSequencia(espera.visivel ? "caixa" : "icone", icone, espera.visivel);
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      data-atualizar=""
      className={cn("max-md:size-11 transition-[color,background-color,border-color,opacity]", travado && !atualizando && "opacity-45", className)}
      aria-disabled={ocupado || undefined}
      aria-busy={espera.visivel || undefined}
      onClick={() => {
        if (!ocupado) onAtualizar();
      }}
    >
      <span data-icones="" aria-hidden="true">
        {camadas.map(({ chave, conteudo, sai, entra }) => (
          <span key={chave} data-camada="" data-sai={sai} data-entra={entra}>
            {conteudo}
          </span>
        ))}
      </span>
      <span className="sr-only">Atualizar</span>
    </Button>
  );
}
