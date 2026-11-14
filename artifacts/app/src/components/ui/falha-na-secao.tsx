import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAnuncio } from "@/lib/carregando/anunciador";
import { useTentarDeNovo } from "@/lib/carregando/estado-da-conexao";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { useEspera } from "@/lib/carregando/use-espera";
import { lugarDaSecao, podeReceberFoco, segurarOFocoQueSai } from "@/lib/foco-de-volta";
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
 * foco vai a `focoAoSair` (o id do campo de onde a pessoa vinha, como a busca
 * do catálogo; revisão da parte 13i) ou, sem ele, ao título da seção (ou do
 * diálogo) onde ele morava, nunca ao `body`.
 *
 * A frase é um alerta (`role="alert"`) quando a seção não tem nada lido. Com o
 * que já estava lido na tela (`alerta={false}`: a releitura que falhou, quase
 * sempre a automática), ela fica escrita, sem falar: a releitura automática não
 * fala nem muda a região viva (momento 7).
 *
 * A nova tentativa pedida que falha de novo deixa o mesmo alerta na tela, que
 * o leitor de tela não repete: quando ela acaba e o aviso continua (300 ms
 * depois, o tempo de a leitura que deu certo tirá-lo da tela), o Anunciador
 * diz a frase de novo.
 */
export function FalhaNaSecao({
  mensagem,
  tentando,
  onTentar,
  className,
  tom = "erro",
  alerta = true,
  focoAoSair,
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
  /** O id de quem recebe o foco quando a falha sai com ele dentro (a leitura que chegou). */
  focoAoSair?: string;
}) {
  const pedida = usePedidaPelaPessoa(tentando);
  const mostrando = useEspera(pedida.emCurso, { segurarMinimo: true }).visivel;
  const anunciar = useAnuncio();
  const frase = useRef(mensagem);
  frase.current = mensagem;
  useEffect(() => {
    if (!pedida.fins) return undefined;
    const ouvir = setTimeout(() => anunciar(frase.current), CARREGANDO.atrasoMs);
    return () => clearTimeout(ouvir);
  }, [pedida.fins, anunciar]);
  const tentarDeNovo = useTentarDeNovo();
  const raiz = useRef<HTMLDivElement>(null);
  const destino = useRef(focoAoSair);
  destino.current = focoAoSair;
  useLayoutEffect(() => {
    const elemento = raiz.current;
    return () => {
      if (!elemento) return;
      // O título é lido agora, com a falha ainda na tela; o campo pedido, depois do commit (a leitura que chega o habilita).
      const titulo = lugarDaSecao(elemento);
      const id = destino.current;
      segurarOFocoQueSai(elemento, id ? () => [elemento.ownerDocument.getElementById(id), titulo].find(podeReceberFoco) : titulo);
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
  // Quantas novas tentativas pedidas acabaram com o aviso ainda na tela.
  const [fins, setFins] = useState(0);
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
      setFins((atual) => atual + 1);
    }
  }, [emCurso, semPromessa, tentando]);
  return {
    emCurso,
    fins,
    comecar: () => setEmCurso(true),
    acompanhar: (resultado: unknown) => {
      const acabar = () => {
        if (!montado.current) return;
        setEmCurso(false);
        setFins((atual) => atual + 1);
      };
      if (ehPromessa(resultado)) resultado.then(acabar, acabar);
      else {
        viuLer.current = tentando;
        setSemPromessa(true);
      }
    },
  };
}
