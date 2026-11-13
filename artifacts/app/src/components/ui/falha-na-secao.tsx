import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTentarDeNovo } from "@/lib/carregando/estado-da-conexao";
import { useEspera } from "@/lib/carregando/use-espera";
import { segurarOFocoQueSai } from "@/lib/foco-de-volta";
import { cn } from "@/lib/utils";

/**
 * A leitura de uma parte da tela que falhou (a ocupação do cliente, as pessoas
 * do portal, o painel que não se atualizou), na própria seção: a frase e o
 * "Tentar de novo", sem o cartão do `ErroNaLeitura`, que é o do lugar da lista
 * inteira. Erro nunca vira vazio nem some (carregamento v2, parte 13e).
 *
 * A nova tentativa é a que a pessoa pede, no relógio da espera, como a do
 * bloco (parte 7a): "Tentando de novo…" com a caixa só depois de 300 ms, e
 * pelo menos 500 ms, até a leitura pedida responder (a promessa que o
 * `onTentar` devolve; sem promessa, até a leitura parar de ler). A releitura
 * automática (o intervalo da tela) não muda o botão (momento 7). A trava do
 * toque segue o que o botão diz (`aria-disabled`, nunca `disabled`, e o foco
 * fica nele). Antes de reler, acorda a conexão de quem lê. No celular, o botão
 * tem 44 px.
 *
 * Quando a nova tentativa dá certo, o aviso sai da tela; com o foco nele, o
 * foco vai ao título da seção (ou do diálogo) onde ele morava, nunca ao `body`.
 *
 * A frase é um alerta (`role="alert"`) quando a seção não tem nada lido. Com o
 * que já estava lido na tela (`alerta={false}`: a releitura que falhou, quase
 * sempre a automática), ela fica escrita, sem falar: a releitura automática não
 * fala nem muda a região viva (momento 7).
 */
export function FalhaNaSecao({
  mensagem,
  tentando,
  onTentar,
  className,
  tom = "erro",
  alerta = true,
}: {
  mensagem: string;
  /** A leitura lê agora. Só conta para quem não devolve a promessa da releitura no `onTentar`. */
  tentando: boolean;
  /** Relê. A promessa devolvida (o `refetch`) diz quando a tentativa pedida acabou. */
  onTentar: () => unknown;
  className?: string;
  /** "aviso": a frase no tom do aviso âmbar onde ela mora (a fonte do Início que não carregou). */
  tom?: "erro" | "aviso";
  /** A frase é falada ao entrar; `false` com o que já estava lido na tela. */
  alerta?: boolean;
}) {
  const pedida = usePedidaPelaPessoa(tentando);
  const mostrando = useEspera(pedida.emCurso, { segurarMinimo: true }).visivel;
  const tentarDeNovo = useTentarDeNovo();
  const raiz = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const elemento = raiz.current;
    return () => {
      if (elemento) segurarOFocoQueSai(elemento);
    };
  }, []);
  return (
    <div ref={raiz} data-falha-na-secao="" className={cn("flex flex-wrap items-center gap-3", className)}>
      <p role={alerta ? "alert" : undefined} className={cn("text-sm font-semibold", tom === "aviso" ? "text-warning-soft-foreground" : "text-destructive")}>
        {mensagem}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="max-md:min-h-11"
        aria-disabled={mostrando || undefined}
        aria-busy={mostrando || undefined}
        onClick={() => {
          if (mostrando) return;
          pedida.comecar();
          tentarDeNovo(() => pedida.acompanhar(onTentar()));
        }}
      >
        {mostrando ? <Spinner /> : <RefreshCw className="size-4" aria-hidden="true" />}
        {mostrando ? "Tentando de novo…" : "Tentar de novo"}
      </Button>
    </div>
  );
}

function ehPromessa(valor: unknown): valor is PromiseLike<unknown> {
  return typeof valor === "object" && valor !== null && typeof (valor as PromiseLike<unknown>).then === "function";
}

/**
 * A nova tentativa que a pessoa pediu, do toque ao fim: o fim é a promessa da
 * releitura ou, sem ela, a leitura que parou de ler depois de ter começado.
 * A releitura que começa sozinha (o intervalo) não é pedida.
 */
function usePedidaPelaPessoa(tentando: boolean) {
  const [emCurso, setEmCurso] = useState(false);
  // Sem promessa: a leitura que lê depois do toque, e o fim é quando ela para.
  const [semPromessa, setSemPromessa] = useState(false);
  const viuLer = useRef(false);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  useEffect(() => {
    if (!emCurso || !semPromessa) return;
    if (tentando) viuLer.current = true;
    else if (viuLer.current) {
      viuLer.current = false;
      setSemPromessa(false);
      setEmCurso(false);
    }
  }, [emCurso, semPromessa, tentando]);
  return {
    emCurso,
    comecar: () => setEmCurso(true),
    acompanhar: (resultado: unknown) => {
      const acabar = () => {
        if (montado.current) setEmCurso(false);
      };
      if (ehPromessa(resultado)) resultado.then(acabar, acabar);
      else {
        viuLer.current = tentando;
        setSemPromessa(true);
      }
    },
  };
}
