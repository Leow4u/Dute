import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { AlertCircle, RefreshCw, WifiOff } from "lucide-react";

import { ArcosDoWifi } from "@/components/ui/arcos-do-wifi";
import { Button } from "@/components/ui/button";
import { FalhaNaSecao } from "@/components/ui/falha-na-secao";
import { Spinner } from "@/components/ui/spinner";
import { useConexao, useTentarDeNovo } from "@/lib/carregando/estado-da-conexao";
import { marcarPedidoDaPessoa } from "@/lib/carregando/pedido-da-pessoa";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { useEspera } from "@/lib/carregando/use-espera";
import { ehFaltaDeConexao, horaDaLeitura } from "@/lib/conexao";
import { focoPerdido, lugarDaSecao, podeReceberFoco, segurarOFocoQueSai } from "@/lib/foco-de-volta";
import { cn } from "@/lib/utils";

/**
 * A falta de conexão que a tela mostra (carregamento v2, momento 8; parte
 * 7a): "Sem conexão" só quando o app está sem conexão (o aparelho sem rede há
 * 3 s, ou duas leituras seguidas sem resposta com ele sem rede); com o
 * aparelho conectado e o servidor sem resposta, "Reconectando…", e o app relê
 * sozinho.
 */
export type FaltaNaTela = "sem-conexao" | "reconectando";

/** A falta que a lista mostra, pelo estado único da conexão; `forcada` é para quem já sabe qual é. */
export function useFaltaNaTela(forcada?: FaltaNaTela): FaltaNaTela {
  const estado = useConexao();
  return forcada ?? (estado === "sem-conexao" ? "sem-conexao" : "reconectando");
}

/**
 * Na volta da rede, "Sem conexão" fica até a leitura voltar (momento 8: da
 * pílula direto para a lista em dia): a conexão passa a "reconectando" assim
 * que o aparelho tem rede, antes de o servidor responder. Só se ele ainda não
 * respondeu depois do mínimo de 2 s do aviso, a peça diz "Reconectando…". A
 * linha de estado, o aviso no lugar da lista e a faixa da lista lida seguem a
 * mesma regra (revisão da parte 13j).
 */
export function useVoltaDaRede(falta: FaltaNaTela, comFalta: boolean): FaltaNaTela {
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

/** A falta que a peça mostra enquanto está na tela: a do estado único, com a volta da rede segurada; ou a `forcada`. */
function useFaltaDaPeca(forcada?: FaltaNaTela): FaltaNaTela {
  const naTela = useVoltaDaRede(useFaltaNaTela(), true);
  return forcada ?? naTela;
}

/**
 * O "Tentando de novo…" no relógio da espera, para quem passa ao
 * `ErroNaLeitura` a leitura crua (o `isFetching`): só depois de 300 ms, e pelo
 * menos 500 ms. A nova tentativa que falha de novo antes não pisca o botão nem
 * muda a frase do alerta (carregamento v2, parte 13f).
 */
export function useTentandoNoRelogio(tentando: boolean): boolean {
  return useEspera(tentando, { segurarMinimo: true }).visivel;
}

/**
 * A nova tentativa no relógio da espera: "Tentando de novo…" só depois de
 * 300 ms, e pelo menos 500 ms; a leitura que acaba antes não pisca o botão. A
 * trava do toque segue o que o botão diz: enquanto ele diz "Tentando de
 * novo…" (`aria-disabled`), o toque não faz nada; enquanto diz "Tentar de
 * novo", o toque tenta. Antes de reler, acorda a conexão de quem lê, para o
 * toque alcançar o servidor; o pedido conta como tentando desde o toque, com
 * o SDK sendo acordado, até a releitura responder (a lista ao vivo já lida
 * não assina de novo: o toque é o despertar do SDK, e a escuta volta sozinha
 * quando ele volta a ouvir o servidor; revisão da parte 13j).
 */
function useNovaTentativa(tentando: boolean, onTentar: () => unknown) {
  const [pedidos, setPedidos] = useState(0);
  const montada = useRef(true);
  useEffect(() => {
    montada.current = true;
    return () => {
      montada.current = false;
    };
  }, []);
  const mostrando = useTentandoNoRelogio(tentando || pedidos > 0);
  const tentarDeNovo = useTentarDeNovo();
  return {
    mostrando,
    tentar: () => {
      if (mostrando) return;
      setPedidos((quantos) => quantos + 1);
      const acabou = () => {
        if (montada.current) setPedidos((quantos) => quantos - 1);
      };
      tentarDeNovo(() => {
        let resposta: unknown;
        try {
          resposta = onTentar();
        } finally {
          // A releitura que devolve a promessa conta até responder; a outra já pediu o que tinha de pedir.
          if (resposta && typeof (resposta as PromiseLike<unknown>).then === "function") {
            void Promise.resolve(resposta).catch(() => undefined).finally(acabou);
          } else acabou();
        }
      });
    },
  };
}

/**
 * O aviso no lugar da lista sai da tela quando a nova tentativa começa a ler
 * (a lista volta às linhas-fantasma): com o foco nele, o foco vai à linha de
 * estado da lista (`id`), que diz "Carregando pedidos…" e depois a hora, e
 * nunca ao `body` (2.4.3). Sem linha de estado, ao título da seção ou do
 * diálogo onde o aviso morava (o painel que chegou, a nova tentativa que deu
 * certo; parte 13e).
 */
export function useFocoAoSair(raiz: RefObject<HTMLElement | null>, id: string | undefined) {
  useLayoutEffect(() => {
    const elemento = raiz.current;
    return () => {
      if (!elemento || typeof document === "undefined" || !elemento.contains(document.activeElement)) return;
      const lugar = elemento.parentElement;
      // A nova tentativa que falhou: a falha entra no lugar de quem saiu (com o commit, depois desta limpeza), e o foco
      // vai ao "Tentar de novo" dela (o do cartão da lista ou o da frase da seção), e não à linha de estado que ainda
      // não tem o que dizer nem ao título (revisões das partes 13h e 13i).
      const falhaNoLugar = () => (lugar?.isConnected ? lugar.querySelector<HTMLElement>(FALHA_NO_LUGAR) : null);
      const alvo = id ? document.getElementById(id) : null;
      if (podeReceberFoco(alvo)) alvo.focus({ preventScroll: true });
      else {
        // Sem o alvo que pode receber o foco agora (o campo que a leitura que chega habilita), ele é lido depois do
        // commit, depois da falha e antes do título da seção, lido agora, com a região ainda na tela: nunca o `body`.
        const titulo = lugarDaSecao(elemento);
        segurarOFocoQueSai(elemento, () => [falhaNoLugar(), id ? document.getElementById(id) : null, titulo].find(podeReceberFoco));
      }
      queueMicrotask(() => {
        const tentar = falhaNoLugar();
        if (tentar && (document.activeElement === alvo || focoPerdido(document, lugar))) tentar.focus({ preventScroll: true });
      });
    };
  }, [id, raiz]);
}

/** O "Tentar de novo" da falha que entra no lugar da espera: o cartão da lista ou a frase da seção. */
const FALHA_NO_LUGAR = ":scope > [data-falha-na-leitura] button, :scope > [data-falha-na-secao] button";

/**
 * A leitura falhou e a tela não tem nada para mostrar: a falha no lugar da
 * lista, com a nova tentativa. Erro nunca vira vazio
 * (docs/plataforma/diagnostico-carregamento.md; mockup
 * docs/mockups/WmsCarregandoPedidosErro.dc.html). Na falta de conexão, o
 * ícone e o tom dizem qual (`falta`): o Wi-Fi cortado no âmbar para "Sem
 * conexão", os arcos em tinta para "Reconectando…". Nenhuma das duas é
 * alerta: "Reconectando" não fala, para não oscilar, e "Sem conexão" é dito
 * uma vez pelo Anunciador (momento 8).
 *
 * Ocupado não é desabilitado: o botão fica `aria-disabled` enquanto tenta, e o
 * toque repetido é barrado aqui. A nova tentativa é pedida pela pessoa: a
 * linha de estado fala de novo ("Carregando pedidos" e o resumo), e o foco
 * vai a ela (`focoAoSair`) quando o aviso sai.
 */
export function ErroNaLeitura({
  mensagem,
  tentando,
  onTentar,
  className,
  falta,
  focoAoSair,
}: {
  mensagem: string;
  tentando: boolean;
  onTentar: () => void;
  className?: string;
  falta?: FaltaNaTela;
  /** O id da linha de estado da lista, que recebe o foco quando o aviso sai com ele. */
  focoAoSair?: string;
}) {
  const reconectando = falta === "reconectando";
  const Icone = falta === "sem-conexao" ? WifiOff : AlertCircle;
  const raiz = useRef<HTMLDivElement>(null);
  useFocoAoSair(raiz, focoAoSair);
  return (
    <div
      ref={raiz}
      // A falta de conexão não é alerta: "Reconectando" não fala, e "Sem conexão" o Anunciador diz uma vez (momento 8).
      role={falta ? undefined : "alert"}
      data-falta={falta}
      data-falha-na-leitura=""
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-lg",
          reconectando
            ? "bg-muted text-foreground"
            : falta === "sem-conexao"
              ? "bg-warning-soft text-carregando-aviso"
              : "bg-destructive-soft text-destructive",
        )}
      >
        {reconectando ? <ArcosDoWifi className="size-5" /> : <Icone className="size-5" aria-hidden="true" />}
      </span>
      <p className="flex-1 text-base font-semibold text-foreground">{mensagem}</p>
      <Button
        type="button"
        variant="outline"
        // "Tentar de novo" com a área de toque de 44 px (seção 7).
        className="min-h-11"
        aria-disabled={tentando || undefined}
        aria-busy={tentando || undefined}
        onClick={() => {
          if (tentando) return;
          marcarPedidoDaPessoa();
          onTentar();
        }}
      >
        {tentando ? <Spinner /> : <RefreshCw className="size-4" aria-hidden="true" />}
        {tentando ? "Tentando de novo…" : "Tentar de novo"}
      </Button>
    </div>
  );
}

/**
 * Na falta de conexão e sem nada lido: o aviso no lugar da lista
 * (docs/plataforma/diagnostico-carregamento.md, decisão 2 do celular),
 * "Sem conexão." ou "Reconectando…" pelo estado único da conexão.
 */
export function BlocoSemConexao({
  tentando,
  onTentar,
  className,
  falta,
  focoAoSair,
}: {
  tentando: boolean;
  onTentar: () => void;
  className?: string;
  falta?: FaltaNaTela;
  /** O id da linha de estado da lista, que recebe o foco quando o aviso sai com ele. */
  focoAoSair?: string;
}) {
  const naTela = useFaltaDaPeca(falta);
  const { mostrando, tentar } = useNovaTentativa(tentando, onTentar);
  return (
    <ErroNaLeitura
      falta={naTela}
      mensagem={naTela === "sem-conexao" ? "Sem conexão." : "Reconectando…"}
      tentando={mostrando}
      onTentar={tentar}
      className={className}
      focoAoSair={focoAoSair}
    />
  );
}

/**
 * Na falta de conexão, com a lista já lida: ela fica na tela, marcada com a
 * hora da última leitura (decisão 2 do celular; momento 8 do carregamento
 * v2). "Sem conexão · lista de 10:42" na pílula âmbar (o --carregando-aviso,
 * 6,2:1), ou "Reconectando… · lista de 10:42" em tinta, com os arcos do
 * Wi-Fi, pelo estado único da conexão; na volta da rede, "Sem conexão" fica
 * até a leitura voltar. `objeto` diz o que está na tela: a lista, ou o
 * documento ("Sem conexão · OS de 10:42"). Não é região viva:
 * "Reconectando" não fala, e "Sem conexão" o Anunciador diz uma vez, ao
 * entrar.
 *
 * A faixa é baixa (o "Tentar de novo" é o da linha de estado, de 24 px, com o
 * toque de 44 px pelo ::before), e a frase fica inteira: o que não cabe na
 * largura é o "Tentar de novo", que passa à linha de baixo (revisão da parte
 * 13j). Com o foco no "Tentar de novo", a faixa que sai o leva ao título da
 * seção, nunca ao `body`.
 */
export function FaixaSemConexao({
  lidaEm,
  tentando,
  onTentar,
  className,
  falta,
  objeto = "lista",
  focoAoSair,
}: {
  lidaEm: number;
  tentando: boolean;
  onTentar: () => unknown;
  className?: string;
  falta?: FaltaNaTela;
  /** O que está na tela: "lista" (o padrão), "OS", "demanda", "orçamento", "comprovante". */
  objeto?: string;
  /** O id de quem recebe o foco quando a faixa sai com ele; sem ele, o título da seção. */
  focoAoSair?: string;
}) {
  const naTela = useFaltaDaPeca(falta);
  const { mostrando, tentar } = useNovaTentativa(tentando, onTentar);
  const raiz = useRef<HTMLDivElement>(null);
  useFocoAoSair(raiz, focoAoSair);
  const semConexao = naTela === "sem-conexao";
  const hora = horaDaLeitura(lidaEm);
  return (
    <div
      ref={raiz}
      data-falta={naTela}
      data-faixa-sem-conexao=""
      className={cn(
        "flex flex-wrap items-center gap-x-2 rounded-lg border py-1 pl-3 pr-2 text-sm",
        semConexao
          ? "border-warning-soft-border bg-warning-soft font-bold text-carregando-aviso"
          : "border-border bg-card text-foreground",
        className,
      )}
    >
      {semConexao ? <WifiOff className="size-4 shrink-0" aria-hidden="true" /> : <ArcosDoWifi />}
      {semConexao ? (
        <span className="min-w-0 flex-auto whitespace-nowrap">{`Sem conexão · ${objeto} de ${hora}`}</span>
      ) : (
        <span className="flex min-w-0 flex-auto items-baseline gap-x-1.5 whitespace-nowrap">
          <span className="font-bold">Reconectando…</span>
          <span className="text-xs font-semibold text-muted-foreground">{`· ${objeto} de ${hora}`}</span>
        </span>
      )}
      <button
        type="button"
        data-tom={semConexao ? "aviso" : undefined}
        aria-disabled={mostrando || undefined}
        aria-busy={mostrando || undefined}
        onClick={tentar}
        className="linha-de-estado-tentar"
      >
        {/* No celular, sem a caixa: o rótulo mais largo cabe sem empurrar a frase. */}
        {mostrando ? <Spinner className="max-sm:hidden" /> : null}
        {mostrando ? "Tentando de novo…" : "Tentar de novo"}
      </button>
    </div>
  );
}

/**
 * O pedaço da leitura que a falha da lista precisa: o do react-query, ou o de
 * quem lê de outro jeito (a lista dos clientes, a leitura ao vivo), com a
 * promessa da nova tentativa.
 */
export type LeituraQueFalhou = { error: unknown; refetch: () => Promise<unknown> };

/**
 * A leitura que falhou sem nada da lista dela para mostrar (a primeira, ou a
 * troca de filtro que falhou): o aviso no lugar da lista, nunca o vazio. Na
 * falta de conexão, o `BlocoSemConexao`; em outro erro, o `ErroNaLeitura`,
 * com a `mensagem` ("Não consegui carregar os produtos."). "Tentar de novo"
 * relê a leitura.
 *
 * "Tentando de novo…" só na nova tentativa que a pessoa pediu: a releitura
 * automática (o tempo real, o intervalo da tela) não mexe no aviso, que é um
 * alerta e falaria de novo. E no relógio da espera, como o do bloco da
 * conexão: só depois de 300 ms, e pelo menos 500 ms. A nova tentativa que
 * responde antes, com o dado ou com a falha de novo, não pisca o botão nem
 * muda o alerta, que o leitor de tela releria inteiro (junção das partes 10 e
 * 13). O toque repetido com a leitura a caminho não lê de novo. Quando a nova
 * tentativa dá certo e o aviso sai com o foco nele, o foco vai à linha de
 * estado da tela (`focoAoSair`), nunca ao `body`.
 */
export function FalhaNaLeitura({
  leitura,
  erro = leitura.error,
  mensagem,
  className,
  focoAoSair,
}: {
  leitura: LeituraQueFalhou;
  /** A falha que fica na tela enquanto tenta de novo (a `useListaComFiltro`): o react-query zera o erro na nova tentativa. */
  erro?: unknown;
  mensagem: string;
  className?: string;
  /** O id da linha de estado da tela, que recebe o foco quando o aviso sai com ele. */
  focoAoSair?: string;
}) {
  const [tentativas, setTentativas] = useState(0);
  const montada = useRef(true);
  useEffect(() => {
    montada.current = true;
    return () => {
      montada.current = false;
    };
  }, []);
  const reler = () => {
    setTentativas((quantas) => quantas + 1);
    void leitura.refetch().finally(() => {
      if (montada.current) setTentativas((quantas) => quantas - 1);
    });
  };
  const tentando = tentativas > 0;
  const mostrando = useTentandoNoRelogio(tentando);
  if (ehFaltaDeConexao(erro)) return <BlocoSemConexao tentando={tentando} onTentar={reler} className={className} focoAoSair={focoAoSair} />;
  return (
    <ErroNaLeitura
      mensagem={mensagem}
      tentando={mostrando}
      onTentar={() => {
        if (!tentando) reler();
      }}
      className={className}
      focoAoSair={focoAoSair}
    />
  );
}

/**
 * A leitura ao vivo como a tela a vê (a `useLeitura` da Operação, a do
 * Comercial, a do portal, ou a `novaTentativaDe` das que a tela junta): a nova
 * tentativa e o que falta (carregamento v2, parte 13j).
 */
export type LeituraAoVivoNaTela = {
  tentando: boolean;
  tentar: () => unknown;
  /** "conexao": o aparelho sem rede ou o SDK só no cache; "servidor": a escuta recusada. */
  falta?: "conexao" | "servidor" | null;
  /** Com a falta de conexão e a lista lida: a hora até a qual ela estava em dia. */
  lidaEm?: number | null;
};

/**
 * A leitura ao vivo que falhou sem nada lido, no lugar da seção (parte 13j),
 * como a `FalhaNaLeitura` faz com o react-query: na falta de conexão, o
 * `BlocoSemConexao` ("Sem conexão." ou "Reconectando…", pelo estado único da
 * conexão), com "Tentar de novo", que acorda o SDK antes de assinar de novo;
 * no erro do servidor (a permissão, outro erro), a `FalhaNaSecao` com a
 * `mensagem`, como antes. `semCartao` tira a borda do bloco quando a seção já
 * é um cartão (o lugar da lista dentro dele); `estreito` o empilha também no
 * computador, onde a seção é estreita (a lista lateral de 320 a 384 px, o
 * sino), para o "Tentar de novo" não sair dela.
 */
export function FalhaAoVivo({
  leitura,
  mensagem,
  className,
  semCartao = false,
  estreito = false,
  focoAoSair,
}: {
  leitura: LeituraAoVivoNaTela;
  /** A frase do erro do servidor: "Não foi possível carregar as demandas." */
  mensagem: string;
  /** A classe da `FalhaNaSecao` (o espaço dela no lugar da lista). */
  className?: string;
  semCartao?: boolean;
  estreito?: boolean;
  focoAoSair?: string;
}) {
  if (leitura.falta === "conexao") {
    return (
      <BlocoSemConexao
        tentando={leitura.tentando}
        onTentar={() => leitura.tentar()}
        className={cn(semCartao && "rounded-none border-0", estreito && "sm:flex-col sm:items-stretch sm:gap-3 sm:px-4")}
        focoAoSair={focoAoSair}
      />
    );
  }
  return <FalhaNaSecao mensagem={mensagem} tentando={leitura.tentando} onTentar={leitura.tentar} className={className} focoAoSair={focoAoSair} />;
}

/**
 * A hora que o aviso mostra, com a histerese do momento 8: ele fica pelo
 * menos 2 s depois de entrar, e a falta que volta nesse tempo não recomeça a
 * conta. O soluço do servidor (a vista que cai no cache e volta em 300 ms)
 * não pisca o aviso nem empurra a lista duas vezes seguidas.
 */
function useAvisoQueFica(lidaEm: number | null): number | null {
  const [aviso, setAviso] = useState<{ desde: number; lidaEm: number } | null>(() =>
    lidaEm === null ? null : { desde: performance.now(), lidaEm },
  );
  if (lidaEm !== null && aviso?.lidaEm !== lidaEm) setAviso({ desde: aviso?.desde ?? performance.now(), lidaEm });
  useEffect(() => {
    if (lidaEm !== null || aviso === null) return undefined;
    const resta = aviso.desde + CARREGANDO.avisoMinimoMs - performance.now();
    if (resta <= 0) {
      setAviso(null);
      return undefined;
    }
    const fim = setTimeout(() => setAviso(null), resta);
    return () => clearTimeout(fim);
  }, [lidaEm, aviso]);
  return lidaEm ?? aviso?.lidaEm ?? null;
}

/**
 * A lista ao vivo já lida, sem conexão (parte 13j; decisão 2 do celular): ela
 * fica na tela, e a faixa diz "Sem conexão · lista de 10:42" (ou
 * "Reconectando… · lista de 10:42"), com "Tentar de novo", que acorda o SDK:
 * a escuta volta sozinha quando ele volta a ouvir o servidor. Sem a falta de
 * conexão com a lista lida, nada. Fica pelo menos 2 s na tela (revisão da
 * parte 13j). `objeto` é o que a tela mostra, nas fichas de um documento só:
 * "Sem conexão · OS de 10:42".
 */
export function FaixaAoVivo({ leitura, objeto, className }: { leitura: LeituraAoVivoNaTela; objeto?: string; className?: string }) {
  const lidaEm = useAvisoQueFica(leitura.falta === "conexao" && leitura.lidaEm != null ? leitura.lidaEm : null);
  if (lidaEm === null) return null;
  return <FaixaSemConexao lidaEm={lidaEm} objeto={objeto} tentando={leitura.tentando} onTentar={() => leitura.tentar()} className={className} />;
}
