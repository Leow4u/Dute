import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { AlertCircle, RefreshCw, WifiOff } from "lucide-react";

import { ArcosDoWifi } from "@/components/ui/arcos-do-wifi";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useConexao, useTentarDeNovo } from "@/lib/carregando/estado-da-conexao";
import { marcarPedidoDaPessoa } from "@/lib/carregando/pedido-da-pessoa";
import { useEspera } from "@/lib/carregando/use-espera";
import { ehFaltaDeConexao, horaDaLeitura } from "@/lib/conexao";
import { segurarOFocoQueSai } from "@/lib/foco-de-volta";
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
 * toque alcançar o servidor.
 */
function useNovaTentativa(tentando: boolean, onTentar: () => void) {
  const mostrando = useTentandoNoRelogio(tentando);
  const tentarDeNovo = useTentarDeNovo();
  return {
    mostrando,
    tentar: () => {
      if (!mostrando) tentarDeNovo(onTentar);
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
      const alvo = id ? document.getElementById(id) : null;
      // Sem o alvo na tela (o id que não chegou), também o título: nunca o `body`.
      if (alvo) alvo.focus({ preventScroll: true });
      else segurarOFocoQueSai(elemento);
      // A nova tentativa que falhou: a falha entra no lugar de quem saiu (com o commit, depois desta limpeza), e o foco
      // vai ao "Tentar de novo" dela, e não à linha de estado que ainda não tem o que dizer (revisão da parte 13h).
      queueMicrotask(() => {
        const tentar = lugar?.isConnected ? lugar.querySelector<HTMLElement>(":scope > [data-falha-na-leitura] button") : null;
        const ativo = document.activeElement;
        if (tentar && (!ativo || ativo === document.body || ativo === alvo || !ativo.isConnected)) tentar.focus({ preventScroll: true });
      });
    };
  }, [id, raiz]);
}

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
  const naTela = useFaltaNaTela(falta);
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
 * Wi-Fi, pelo estado único da conexão. Não é região viva: "Reconectando" não
 * fala, e "Sem conexão" o Anunciador diz uma vez, ao entrar.
 */
export function FaixaSemConexao({
  lidaEm,
  tentando,
  onTentar,
  className,
  falta,
}: {
  lidaEm: number;
  tentando: boolean;
  onTentar: () => void;
  className?: string;
  falta?: FaltaNaTela;
}) {
  const naTela = useFaltaNaTela(falta);
  const { mostrando, tentar } = useNovaTentativa(tentando, onTentar);
  const semConexao = naTela === "sem-conexao";
  const hora = horaDaLeitura(lidaEm);
  return (
    <div
      data-falta={naTela}
      className={cn(
        "flex flex-wrap items-center gap-x-3 rounded-lg border py-0.5 pl-4 pr-1 text-sm",
        semConexao
          ? "border-warning-soft-border bg-warning-soft font-bold text-carregando-aviso"
          : "border-border bg-card text-foreground",
        className,
      )}
    >
      {semConexao ? <WifiOff className="size-4 shrink-0" aria-hidden="true" /> : <ArcosDoWifi />}
      {semConexao ? (
        <span className="flex-1">{`Sem conexão · lista de ${hora}`}</span>
      ) : (
        <span className="flex flex-1 flex-wrap items-baseline gap-x-1.5">
          <span className="font-bold">Reconectando…</span>
          <span className="text-xs font-semibold text-muted-foreground">{`· lista de ${hora}`}</span>
        </span>
      )}
      <button
        type="button"
        aria-disabled={mostrando || undefined}
        aria-busy={mostrando || undefined}
        onClick={tentar}
        className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 font-extrabold underline underline-offset-4 aria-disabled:no-underline"
      >
        {mostrando ? <Spinner /> : null}
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
